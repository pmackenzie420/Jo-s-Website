const { normalizePhoneForStorage } = require('./checkout-validation');
const { recordOrderEvent } = require('./audit-ops');

const createReservedOrder = async ({
    pool,
    withTransaction,
    reserveStockForItems,
    pickupDateId,
    reservationItems,
    customerName,
    customerPhone,
    customerEmail,
    customerAddress,
    totalCents,
    orderItemsForStorage,
    RESERVED_ORDER_STATUS,
    pickupDate,
    pickupLocation,
    paymentType,
    amountPaidCents,
    amountDueCents,
    orderLanguage,
    requestId,
    actorType = 'checkout',
    actorId = 'self_service'
}) => {
    const normalizedPhone = normalizePhoneForStorage(customerPhone);
    return withTransaction(pool, async (client) => {
        let customerId;
        const existingCust = await client.query(
            'SELECT id FROM customers WHERE phone = $1 FOR UPDATE',
            [normalizedPhone]
        );

        if (existingCust.rows.length > 0) {
            customerId = existingCust.rows[0].id;
            await client.query(
                'UPDATE customers SET name=$1, email=$2, address=$3 WHERE id=$4',
                [customerName, customerEmail, customerAddress, customerId]
            );
        } else {
            const newCust = await client.query(
                'INSERT INTO customers (name, phone, email, address) VALUES ($1, $2, $3, $4) RETURNING id',
                [customerName, normalizedPhone, customerEmail, customerAddress]
            );
            customerId = newCust.rows[0].id;
        }

        await reserveStockForItems(client, {
            pickupDateId,
            items: reservationItems,
            orderId: 'pending',
            pickupDate,
            pickupLocation,
            inventoryReason: 'checkout_reservation_created',
            inventoryActor: actorId,
            requestId
        });

        const newOrder = await client.query(
            `INSERT INTO orders (
                customer_id,
                customer_email,
                total_cents,
                items,
                status,
                pickup_date,
                pickup_location,
                payment_type,
                amount_paid_cents,
                amount_due_cents,
                language
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
            RETURNING id`,
            [
                customerId,
                customerEmail,
                totalCents,
                JSON.stringify(orderItemsForStorage || []),
                RESERVED_ORDER_STATUS,
                pickupDate,
                pickupLocation,
                paymentType,
                amountPaidCents,
                amountDueCents,
                orderLanguage
            ]
        );
        const orderId = newOrder.rows[0].id;
        await recordOrderEvent(client, {
            orderId,
            eventType: 'order_created',
            fromStatus: null,
            toStatus: RESERVED_ORDER_STATUS,
            actorType,
            actorId,
            requestId,
            payload: {
                total_cents: totalCents,
                pickup_date: pickupDate,
                pickup_location: pickupLocation,
                payment_type: paymentType,
                amount_paid_cents: amountPaidCents,
                amount_due_cents: amountDueCents,
                language: orderLanguage,
                customer_email: customerEmail || null
            }
        });
        return orderId;
    });
};

const createCheckoutSession = async ({
    stripe,
    orderId,
    paymentType,
    lineItems,
    baseUrl,
    CHECKOUT_RESERVATION_TTL_MINUTES,
    successUrl,
    cancelUrl
}) => {
    const reservationExpiresAt = Math.floor(Date.now() / 1000)
        + (CHECKOUT_RESERVATION_TTL_MINUTES * 60);
    return stripe.checkout.sessions.create({
        payment_method_types: ['card'],
        line_items: lineItems,
        mode: 'payment',
        metadata: { order_id: orderId, payment_type: paymentType },
        success_url: successUrl || `${baseUrl}/success?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: cancelUrl || `${baseUrl}?canceled=true`,
        expires_at: reservationExpiresAt
    });
};

const buildOrderConfirmResponse = ({
    order,
    items,
    orderStatus,
    session,
    sessionId,
    confirmedSession,
    normalizeLanguage,
    getPaymentDetails,
    PAID_STATUSES
}) => {
    const paymentDetails = getPaymentDetails(order);
    const normalizedStatus = String(orderStatus || order.status || 'pending').toLowerCase();
    const isPaid = session?.payment_status === 'paid' || PAID_STATUSES.has(normalizedStatus);
    const orderNumberRaw = Number(order?.order_number);
    const orderNumber = Number.isFinite(orderNumberRaw) && orderNumberRaw > 0
        ? Math.floor(orderNumberRaw)
        : null;
    const requestedSessionId = session?.id || sessionId;
    const allowSensitive =
        Boolean(isPaid)
        && Boolean(confirmedSession?.sid)
        && confirmedSession.sid === requestedSessionId;

    const orderPayload = {
        id: order.id,
        pickup_date: order.pickup_date,
        pickup_location: order.pickup_location,
        total_cents: order.total_cents,
        order_number: orderNumber,
        items,
        language: normalizeLanguage(order.language),
        payment_type: paymentDetails.paymentType,
        amount_paid_cents: paymentDetails.paidCents,
        amount_due_cents: paymentDetails.dueCents
    };

    if (allowSensitive) {
        orderPayload.customer_email = order.customer_email;
        orderPayload.customer_name = order.customer_name;
        orderPayload.customer_phone = order.customer_phone;
        orderPayload.customer_address = order.customer_address;
    }

    return {
        success: true,
        status: normalizedStatus,
        orderNumber,
        order: orderPayload
    };
};

module.exports = {
    createReservedOrder,
    createCheckoutSession,
    buildOrderConfirmResponse
};
