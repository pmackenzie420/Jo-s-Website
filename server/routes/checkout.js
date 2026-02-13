const {
    CheckoutHttpError,
    parseCheckoutContext,
    resolvePickupDateId,
    buildCheckoutQuote,
    createReservedOrder,
    createCheckoutSession,
    buildOrderConfirmResponse
} = require('../logic/checkout-service');
const { logError } = require('../utils/logger');

const registerCheckoutRoutes = (app, deps) => {
    const {
        pool,
        stripe,
        sendServerError,
        checkoutLimiter: providedCheckoutLimiter,
        emailVerifyLimiter: providedEmailVerifyLimiter,
        orderConfirmLimiter,
        getRequestBaseUrl,
        normalizeCheckoutItems,
        normalizeLanguage,
        sanitizeText,
        isValidEmail,
        calculateItemPrice,
        isLohmannHenName,
        getMinimumOrderQuantity,
        getDepositEligibleMinQty,
        getDepositRequiredAboveQty,
        isPickupLocationRestricted,
        getPaymentDetails,
        getOrderSummary,
        parseCookies,
        signOrderConfirmToken,
        verifyOrderConfirmToken,
        verifyCheckoutEmail,
        getCookieOptions,
        ORDER_CONFIRM_COOKIE,
        ORDER_CONFIRM_TTL_MS,
        CHECKOUT_MAX_ITEM_ROWS,
        RESERVED_ORDER_STATUS,
        CHECKOUT_RESERVATION_TTL_MINUTES,
        PAID_STATUSES,
        reserveStockForItems,
        withTransaction,
        finalizeOrderFromSession,
        releaseReservedOrder,
        sweepExpiredReservedOrders
    } = deps;
    const checkoutLimiter = typeof providedCheckoutLimiter === 'function'
        ? providedCheckoutLimiter
        : (_req, _res, next) => next();
    const emailVerifyLimiter = typeof providedEmailVerifyLimiter === 'function'
        ? providedEmailVerifyLimiter
        : (_req, _res, next) => next();
    const verifyEmail = typeof verifyCheckoutEmail === 'function'
        ? verifyCheckoutEmail
        : async () => ({
            accepted: true,
            shouldBlock: false,
            status: 'warning',
            reason: 'unconfigured',
            message: 'Email verification unavailable.',
            normalizedEmail: '',
            suggestion: null
        });
    const configuredSweepIntervalSeconds = Number(process.env.CHECKOUT_SWEEP_MIN_INTERVAL_SECONDS);
    const checkoutSweepMinIntervalSeconds = Number.isFinite(configuredSweepIntervalSeconds)
        ? Math.max(configuredSweepIntervalSeconds, 10)
        : 60;
    const checkoutSweepMinIntervalMs = checkoutSweepMinIntervalSeconds * 1000;
    let checkoutSweepRunning = false;
    let lastCheckoutSweepAt = 0;
    const triggerCheckoutSweep = () => {
        if (checkoutSweepRunning) return;
        const now = Date.now();
        if (now - lastCheckoutSweepAt < checkoutSweepMinIntervalMs) return;
        checkoutSweepRunning = true;
        lastCheckoutSweepAt = now;
        Promise.resolve()
            .then(() => sweepExpiredReservedOrders())
            .catch((sweepError) => {
                logError('Checkout-triggered reservation sweep failed', sweepError);
            })
            .finally(() => {
                checkoutSweepRunning = false;
            });
    };

    app.post('/api/checkout/email-verify', emailVerifyLimiter, async (req, res) => {
        try {
            const email = typeof req.body?.email === 'string' ? req.body.email : '';
            const requestedLanguage = req.body?.language || req.get('accept-language');
            const language = normalizeLanguage(requestedLanguage);
            const verification = await verifyEmail(email, { language });
            return res.json(verification);
        } catch (err) {
            return sendServerError(res, err, 'Email verification failed');
        }
    });

    app.post('/api/checkout', checkoutLimiter, async (req, res) => {
        try {
            triggerCheckoutSweep();

            const checkoutContext = parseCheckoutContext(req, {
                normalizeCheckoutItems,
                normalizeLanguage,
                sanitizeText,
                isValidEmail,
                CHECKOUT_MAX_ITEM_ROWS
            });

            const pickupDateId = await resolvePickupDateId(
                pool,
                checkoutContext.pickupDate,
                checkoutContext.pickupLocation
            );

            const quote = await buildCheckoutQuote({
                pool,
                checkoutItems: checkoutContext.checkoutItems,
                pickupDateId,
                pickupLocation: checkoutContext.pickupLocation,
                requestedPayment: checkoutContext.requestedPayment,
                calculateItemPrice,
                isLohmannHenName,
                getMinimumOrderQuantity,
                getDepositEligibleMinQty,
                getDepositRequiredAboveQty,
                isPickupLocationRestricted
            });

            const baseUrl = getRequestBaseUrl(req);
            if (!baseUrl) {
                return res.status(500).json({ error: 'Checkout redirect URL not configured.' });
            }

            let orderId = null;
            let stripeSessionId = null;
            try {
                orderId = await createReservedOrder({
                    pool,
                    withTransaction,
                    reserveStockForItems,
                    pickupDateId,
                    reservationItems: quote.reservationItems,
                    customerName: checkoutContext.customerName,
                    customerPhone: checkoutContext.customerPhone,
                    customerEmail: checkoutContext.customerEmail,
                    customerAddress: checkoutContext.customerAddress,
                    totalCents: quote.totalCents,
                    orderItemsForStorage: quote.orderItemsForStorage,
                    RESERVED_ORDER_STATUS,
                    pickupDate: checkoutContext.pickupDate,
                    pickupLocation: checkoutContext.pickupLocation,
                    paymentType: quote.paymentType,
                    amountPaidCents: quote.amountPaidCents,
                    amountDueCents: quote.amountDueCents,
                    orderLanguage: checkoutContext.orderLanguage
                });

                const session = await createCheckoutSession({
                    stripe,
                    orderId,
                    paymentType: quote.paymentType,
                    lineItems: quote.lineItems,
                    baseUrl,
                    CHECKOUT_RESERVATION_TTL_MINUTES
                });
                stripeSessionId = session.id;

                await pool.query(
                    'UPDATE orders SET stripe_payment_id = $1 WHERE id = $2',
                    [session.id, orderId]
                );

                const confirmToken = signOrderConfirmToken(session.id);
                if (confirmToken) {
                    res.cookie(ORDER_CONFIRM_COOKIE, confirmToken, getCookieOptions(ORDER_CONFIRM_TTL_MS));
                }

                return res.json({ url: session.url });
            } catch (checkoutErr) {
                if (stripeSessionId) {
                    try {
                        await stripe.checkout.sessions.expire(stripeSessionId);
                    } catch (expireErr) {
                        logError(`Failed to expire Stripe session ${stripeSessionId}`, expireErr);
                    }
                }
                if (orderId) {
                    try {
                        await releaseReservedOrder(orderId);
                    } catch (releaseErr) {
                        logError(`Failed to release reservation for order ${orderId}`, releaseErr);
                    }
                }

                if (checkoutErr instanceof CheckoutHttpError) {
                    return res.status(checkoutErr.status).json({ error: checkoutErr.message });
                }
                if (String(checkoutErr?.message || '').includes('Insufficient')) {
                    return res.status(409).json({
                        error: 'One or more items just sold out. Please refresh and try again.'
                    });
                }
                throw checkoutErr;
            }
        } catch (err) {
            if (err instanceof CheckoutHttpError) {
                return res.status(err.status).json({ error: err.message });
            }
            return sendServerError(res, err, 'Checkout failed');
        }
    });

    app.get('/api/orders/confirm', orderConfirmLimiter, async (req, res) => {
        const sessionId = req.query.session_id;
        if (!sessionId) {
            return res.status(400).json({ error: 'session_id required' });
        }

        let session;
        try {
            session = await stripe.checkout.sessions.retrieve(sessionId);
        } catch (err) {
            logError('Invalid Stripe session', err);
        }

        try {
            let orderId = null;
            let orderStatus = null;
            const cookies = parseCookies(req.headers.cookie);
            const confirmToken = cookies[ORDER_CONFIRM_COOKIE];
            const confirmedSession = verifyOrderConfirmToken(confirmToken);

            if (session?.payment_status === 'paid') {
                const result = await finalizeOrderFromSession(session);
                if (result.status !== 'missing_order') {
                    orderId = result.orderId;
                    orderStatus = result.status;
                }
            }

            if (!orderId) {
                const lookup = await pool.query(
                    'SELECT id, status FROM orders WHERE stripe_payment_id = $1',
                    [session?.id || sessionId]
                );
                if (lookup.rows.length > 0) {
                    orderId = lookup.rows[0].id;
                    orderStatus = lookup.rows[0].status || orderStatus;
                }
            }

            if (!orderId) {
                return res.status(404).json({ error: 'Order not found' });
            }

            const summary = await getOrderSummary(orderId);
            if (!summary) {
                return res.status(404).json({ error: 'Order not found' });
            }

            return res.json(
                buildOrderConfirmResponse({
                    order: summary.order,
                    items: summary.items,
                    orderStatus,
                    session,
                    sessionId,
                    confirmedSession,
                    normalizeLanguage,
                    getPaymentDetails,
                    PAID_STATUSES
                })
            );
        } catch (err) {
            logError('Error confirming order', err);
            return res.status(500).json({ error: 'Failed to confirm order' });
        }
    });
};

module.exports = {
    registerCheckoutRoutes
};
