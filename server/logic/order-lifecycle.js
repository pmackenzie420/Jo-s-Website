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
    recordOrderEvent = async () => null,
    recordPaymentEvent = async () => null,
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

    const releaseReservedOrder = async (orderId, options = {}) => {
        const expireStripeSession = options?.expireStripeSession === true;
        const result = await withTransaction(pool, async (client) => {
            const orderResult = await client.query(
                'SELECT status, items, pickup_date, pickup_location, stripe_payment_id FROM orders WHERE id = $1 FOR UPDATE',
                [orderId]
            );
            if (orderResult.rows.length === 0) {
                return { status: 'missing_order', orderId };
            }
            const order = orderResult.rows[0];
            const currentStatus = String(order.status || '').toLowerCase();
            if (currentStatus === 'cancelled') {
                return { status: 'already_cancelled', orderId };
            }

            // We only track stock reservations for Stripe checkout orders, where stock is reserved
            // at order creation (status=reserved) and later finalized to paid. "pending" is treated
            // as legacy/admin-only and does not reliably imply stock was reserved.
            const hasReservedStock =
                currentStatus === RESERVED_ORDER_STATUS
                || currentStatus === 'paid';
            if (!hasReservedStock) {
                return { status: 'not_reserved', orderId };
            }

            const items = getOrderItemTotals(parseOrderItems, collectOrderItemTotals, order.items);
            const pickupDateId = await findPickupDateIdByValue(
                client,
                order.pickup_date,
                order.pickup_location
            );
            await releaseStockForItems(client, {
                pickupDateId,
                items,
                pickupDate: order.pickup_date,
                pickupLocation: order.pickup_location,
                inventoryReason: options?.inventoryReason || 'order_cancelled_release',
                inventoryActor: options?.actorId || options?.actorType || 'system',
                requestId: options?.requestId || null
            });
            await client.query(
                'UPDATE orders SET status = $1 WHERE id = $2',
                ['cancelled', orderId]
            );
            await recordOrderEvent(client, {
                orderId,
                eventType: options?.orderEventType || 'order_cancelled',
                fromStatus: currentStatus,
                toStatus: 'cancelled',
                actorType: options?.actorType || 'system',
                actorId: options?.actorId || 'system',
                requestId: options?.requestId || null,
                payload: {
                    stripe_session_id: order.stripe_payment_id || null,
                    expired_session: expireStripeSession
                }
            });
            return {
                status: 'released',
                orderId,
                previousStatus: currentStatus,
                stripeSessionId: order.stripe_payment_id || null
            };
        });

        if (
            result?.status === 'released'
            && expireStripeSession
            && result.previousStatus === RESERVED_ORDER_STATUS
            && result.stripeSessionId
        ) {
            try {
                await stripe.checkout.sessions.expire(result.stripeSessionId);
            } catch (err) {
                logError(`Failed to expire Stripe session ${result.stripeSessionId}`, err);
            }
        }

        return result;
    };

    const finalizeOrderFromSession = async (session, options = {}) => {
        const orderIdFromMetadata = session?.metadata?.order_id;
        let orderId = orderIdFromMetadata;

        if (!orderId) {
            const lookup = await pool.query('SELECT id FROM orders WHERE stripe_payment_id = $1', [
                session.id
            ]);
            orderId = lookup.rows[0]?.id;
        }

        if (!orderId) {
            const missingResult = { status: 'missing_order' };
            await recordPaymentEvent(pool, {
                orderId: null,
                provider: 'stripe',
                providerEventId: options?.providerEventId || session?.id || null,
                eventType: options?.paymentEventType || 'payment_finalize',
                status: missingResult.status,
                payload: {
                    source: options?.source || 'system',
                    request_id: options?.requestId || null,
                    session_id: session?.id || null,
                    payment_status: session?.payment_status || null,
                    session_status: session?.status || null
                }
            });
            return missingResult;
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

            if (currentStatus === 'cancelled') {
                return { status: 'cancelled', orderId };
            }
            const alreadyPaid = PAID_STATUSES.has(currentStatus);
            const isReservedOrder = currentStatus === RESERVED_ORDER_STATUS;

            if (!alreadyPaid && !isReservedOrder) {
                const items = getOrderItemTotals(parseOrderItems, collectOrderItemTotals, order.items);
                const pickupDateId = await findPickupDateIdByValue(
                    client,
                    order.pickup_date,
                    order.pickup_location
                );
                await reserveStockForItems(client, {
                    pickupDateId,
                    items,
                    orderId,
                    pickupDate: order.pickup_date,
                    pickupLocation: order.pickup_location,
                    inventoryReason: options?.inventoryReason || 'payment_finalize_reserve',
                    inventoryActor: options?.actorId || options?.actorType || 'system',
                    requestId: options?.requestId || null
                });
            }

            const nextStatus = alreadyPaid ? currentStatus : 'paid';
            await client.query(
                'UPDATE orders SET status = $1, stripe_payment_id = $2 WHERE id = $3',
                [nextStatus, session.id, orderId]
            );
            if (!alreadyPaid && nextStatus === 'paid') {
                await recordOrderEvent(client, {
                    orderId,
                    eventType: options?.orderEventType || 'payment_finalized',
                    fromStatus: currentStatus,
                    toStatus: nextStatus,
                    actorType: options?.actorType || 'system',
                    actorId: options?.actorId || 'system',
                    requestId: options?.requestId || null,
                    payload: {
                        stripe_session_id: session?.id || null,
                        payment_status: session?.payment_status || null,
                        source: options?.source || 'system'
                    }
                });
            }
            return {
                status: nextStatus,
                orderId,
                previousStatus: currentStatus
            };
        });

        await recordPaymentEvent(pool, {
            orderId: result.orderId || orderId,
            provider: 'stripe',
            providerEventId: options?.providerEventId || session?.id || null,
            eventType: options?.paymentEventType || 'payment_finalize',
            status: result.status,
            payload: {
                source: options?.source || 'system',
                request_id: options?.requestId || null,
                session_id: session?.id || null,
                payment_status: session?.payment_status || null,
                session_status: session?.status || null,
                previous_status: result.previousStatus || null
            }
        });

        if (result.status === 'cancelled') {
            logError(`Stripe session ${session?.id || '(unknown)'} completed for cancelled order ${orderId}`);
            return result;
        }
        try {
            await sendOrderConfirmationEmail(orderId, {
                initiatedBy: options?.actorType || 'system',
                actorType: options?.actorType || 'system',
                actorId: options?.actorId || 'system',
                requestId: options?.requestId || null
            });
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
                await releaseReservedOrder(orderId, {
                    actorType: 'system',
                    actorId: 'reservation_sweep',
                    inventoryReason: 'reservation_sweep_release'
                });
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
                await finalizeOrderFromSession(session, {
                    source: 'reservation_sweep',
                    actorType: 'system',
                    actorId: 'reservation_sweep',
                    paymentEventType: 'reservation_sweep.finalize'
                });
                continue;
            }

            const expiresAtMs = Number(session?.expires_at) * 1000;
            const isSessionExpired =
                session?.status === 'expired'
                || (Number.isFinite(expiresAtMs) && expiresAtMs <= Date.now());

            if (isSessionExpired) {
                await releaseReservedOrder(orderId, {
                    actorType: 'system',
                    actorId: 'reservation_sweep',
                    inventoryReason: 'reservation_sweep_release'
                });
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
