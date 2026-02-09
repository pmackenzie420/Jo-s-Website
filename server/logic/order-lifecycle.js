const createOrderLifecycle = ({
    pool,
    stripe,
    parseOrderItems,
    collectOrderItemTotals,
    getOrderItemTotals,
    findPickupDateIdByValue,
    reserveStockForItems,
    releaseStockForItems,
    sendOrderConfirmationEmail,
    PAID_STATUSES,
    RESERVED_ORDER_STATUS,
    CHECKOUT_RESERVATION_TTL_MINUTES,
    EXPIRED_RESERVATION_BATCH_SIZE
}) => {
    const { logError } = require('../utils/logger');

    const withTransaction = async (poolInstance, work) => {
        const client = await poolInstance.connect();
        try {
            await client.query('BEGIN');
            const result = await work(client);
            await client.query('COMMIT');
            return result;
        } catch (err) {
            try {
                await client.query('ROLLBACK');
            } catch (rollbackErr) {
                logError('Rollback failed', rollbackErr);
            }
            throw err;
        } finally {
            client.release();
        }
    };

    const releaseReservedOrder = async (orderId) => {
        return withTransaction(pool, async (client) => {
            const orderResult = await client.query(
                'SELECT status, items, pickup_date, pickup_location FROM orders WHERE id = $1 FOR UPDATE',
                [orderId]
            );
            if (orderResult.rows.length === 0) {
                return { status: 'missing_order', orderId };
            }
            const order = orderResult.rows[0];
            const currentStatus = String(order.status || '').toLowerCase();
            if (currentStatus !== RESERVED_ORDER_STATUS) {
                return { status: 'not_reserved', orderId };
            }
            const items = getOrderItemTotals(parseOrderItems, collectOrderItemTotals, order.items);
            const pickupDateId = await findPickupDateIdByValue(
                client,
                order.pickup_date,
                order.pickup_location
            );
            await releaseStockForItems(client, { pickupDateId, items });
            await client.query(
                'UPDATE orders SET status = $1 WHERE id = $2',
                ['cancelled', orderId]
            );
            return { status: 'released', orderId };
        });
    };

    const finalizeOrderFromSession = async (session) => {
        const orderIdFromMetadata = session?.metadata?.order_id;
        let orderId = orderIdFromMetadata;

        if (!orderId) {
            const lookup = await pool.query('SELECT id FROM orders WHERE stripe_payment_id = $1', [
                session.id
            ]);
            orderId = lookup.rows[0]?.id;
        }

        if (!orderId) {
            return { status: 'missing_order' };
        }

        const result = await withTransaction(pool, async (client) => {
            const orderResult = await client.query(
                'SELECT status, items, pickup_date, pickup_location FROM orders WHERE id = $1 FOR UPDATE',
                [orderId]
            );

            if (orderResult.rows.length === 0) {
                return { status: 'missing_order' };
            }

            const order = orderResult.rows[0];
            const currentStatus = String(order.status || 'pending').toLowerCase();
            const alreadyPaid = PAID_STATUSES.has(currentStatus);
            const isReservedOrder = currentStatus === RESERVED_ORDER_STATUS;

            if (!alreadyPaid && !isReservedOrder) {
                const items = getOrderItemTotals(parseOrderItems, collectOrderItemTotals, order.items);
                const pickupDateId = await findPickupDateIdByValue(
                    client,
                    order.pickup_date,
                    order.pickup_location
                );
                await reserveStockForItems(client, { pickupDateId, items, orderId });
            }

            const nextStatus = alreadyPaid ? currentStatus : 'paid';
            await client.query(
                'UPDATE orders SET status = $1, stripe_payment_id = $2 WHERE id = $3',
                [nextStatus, session.id, orderId]
            );
            return { status: nextStatus, orderId };
        });

        if (result.status === 'missing_order') {
            return result;
        }
        try {
            await sendOrderConfirmationEmail(orderId);
        } catch (err) {
            logError(`Error sending confirmation email for order ${orderId}`, err);
        }
        return result;
    };

    const sweepExpiredReservedOrders = async () => {
        const cutoffMinutes = CHECKOUT_RESERVATION_TTL_MINUTES + 5;
        const candidates = await pool.query(
            `
            SELECT id, stripe_payment_id
            FROM orders
            WHERE status = $1
              AND created_at < NOW() - make_interval(mins => $2::int)
            ORDER BY created_at ASC
            LIMIT $3
            `,
            [RESERVED_ORDER_STATUS, cutoffMinutes, EXPIRED_RESERVATION_BATCH_SIZE]
        );

        for (const row of candidates.rows) {
            const orderId = row.id;
            const sessionId = row.stripe_payment_id;

            if (!sessionId) {
                await releaseReservedOrder(orderId);
                continue;
            }

            let session;
            try {
                session = await stripe.checkout.sessions.retrieve(sessionId);
            } catch (err) {
                logError(`Unable to inspect Stripe session for order ${orderId}`, err);
                continue;
            }

            if (session?.payment_status === 'paid') {
                await finalizeOrderFromSession(session);
                continue;
            }

            const expiresAtMs = Number(session?.expires_at) * 1000;
            const isSessionExpired =
                session?.status === 'expired'
                || (Number.isFinite(expiresAtMs) && expiresAtMs <= Date.now());

            if (isSessionExpired) {
                await releaseReservedOrder(orderId);
            }
        }
    };

    return {
        withTransaction,
        releaseReservedOrder,
        finalizeOrderFromSession,
        sweepExpiredReservedOrders
    };
};

module.exports = {
    createOrderLifecycle
};
