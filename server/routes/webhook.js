const express = require('express');
const { logInfo, logError } = require('../utils/logger');

const registerWebhookRoutes = (app, deps) => {
    const {
        stripe,
        webhookSecret,
        finalizeOrderFromSession,
        releaseReservedOrder
    } = deps;

    app.post('/api/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
        const sig = req.headers['stripe-signature'];
        let event;

        try {
            event = stripe.webhooks.constructEvent(req.body, sig, webhookSecret);
        } catch (err) {
            logError('Webhook signature verification failed', err);
            return res.status(400).send(`Webhook Error: ${err.message}`);
        }

        if (event.type === 'checkout.session.completed') {
            const session = event.data.object;
            try {
                const result = await finalizeOrderFromSession(session);
                if (result.status === 'missing_order') {
                    logError(`Order not found for session ${session.id}`);
                } else {
                    logInfo(`Order ${result.orderId} marked as ${result.status.toUpperCase()}`);
                }
            } catch (err) {
                logError('Error finalizing order from webhook', err);
            }
        } else if (event.type === 'checkout.session.expired') {
            const session = event.data.object;
            const orderId = session?.metadata?.order_id;
            if (orderId) {
                try {
                    await releaseReservedOrder(orderId);
                } catch (err) {
                    logError(`Failed to release expired reservation for order ${orderId}`, err);
                }
            }
        }

        return res.json({ received: true });
    });
};

module.exports = {
    registerWebhookRoutes
};
