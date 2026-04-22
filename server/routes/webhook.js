const express = require('express');
const { Webhook } = require('svix');
const { logInfo, logError } = require('../utils/logger');

const registerWebhookRoutes = (app, deps) => {
    const {
        stripe,
        webhookSecret,
        finalizeOrderFromSession,
        releaseReservedOrder,
        resendWebhookSecret,
        recordPaymentEvent,
        applyEmailWebhookEvent
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
                const result = await finalizeOrderFromSession(session, {
                    source: 'stripe_webhook',
                    actorType: 'stripe',
                    actorId: 'webhook',
                    requestId: req.requestId,
                    providerEventId: event.id,
                    paymentEventType: event.type
                });
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
            let releaseStatus = 'missing_order';
            if (orderId) {
                try {
                    const releaseResult = await releaseReservedOrder(orderId, {
                        actorType: 'stripe',
                        actorId: 'webhook',
                        requestId: req.requestId,
                        inventoryReason: 'stripe_webhook_expired_release'
                    });
                    releaseStatus = releaseResult?.status || 'unknown';
                } catch (err) {
                    logError(`Failed to release expired reservation for order ${orderId}`, err);
                    releaseStatus = 'error';
                }
            }
            if (typeof recordPaymentEvent === 'function') {
                await recordPaymentEvent({
                    orderId: orderId || null,
                    provider: 'stripe',
                    providerEventId: event.id,
                    eventType: event.type,
                    status: releaseStatus,
                    payload: {
                        request_id: req.requestId,
                        source: 'stripe_webhook',
                        session_id: session?.id || null,
                        payment_status: session?.payment_status || null,
                        session_status: session?.status || null
                    }
                });
            }
        }

        return res.json({ received: true });
    });

    app.post('/api/email/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
        if (!resendWebhookSecret) {
            logError('Resend webhook secret is not configured');
            return res.status(503).send('Resend webhook not configured');
        }

        const payload = Buffer.isBuffer(req.body)
            ? req.body.toString('utf8')
            : String(req.body || '');
        let verifiedPayload;
        try {
            const verifier = new Webhook(resendWebhookSecret);
            verifiedPayload = verifier.verify(payload, {
                'svix-id': req.headers['svix-id'],
                'svix-timestamp': req.headers['svix-timestamp'],
                'svix-signature': req.headers['svix-signature']
            });
        } catch (err) {
            logError('Resend webhook verification failed', err);
            return res.status(400).send('Invalid webhook');
        }

        try {
            if (typeof applyEmailWebhookEvent === 'function') {
                const result = await applyEmailWebhookEvent({
                    webhookEventId: req.headers['svix-id'],
                    payload: verifiedPayload
                });
                if (result?.duplicate) {
                    return res.json({ received: true, duplicate: true });
                }
            }

            return res.json({ received: true });
        } catch (err) {
            logError('Failed to apply Resend webhook event', err);
            return res.status(500).send('Webhook processing failed');
        }
    });
};

module.exports = {
    registerWebhookRoutes
};
