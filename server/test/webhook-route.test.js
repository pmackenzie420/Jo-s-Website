const test = require('node:test');
const assert = require('node:assert/strict');

process.env.NODE_ENV = 'test';

const { registerWebhookRoutes } = require('../routes/webhook');

const createMockRes = () => {
    const res = {
        statusCode: 200,
        body: null,
        status(code) {
            this.statusCode = code;
            return this;
        },
        send(payload) {
            this.body = payload;
            return this;
        },
        json(payload) {
            this.body = payload;
            return this;
        }
    };
    return res;
};

test('webhook route finalizes completed sessions and releases expired reservations', async () => {
    const routeHandlers = {};
    const app = {
        post(path, ...handlers) {
            routeHandlers[`POST ${path}`] = handlers[handlers.length - 1];
        }
    };

    const finalizeCalls = [];
    const releaseCalls = [];
    const stripe = {
        webhooks: {
            constructEvent(body) {
                return body;
            }
        }
    };

    registerWebhookRoutes(app, {
        stripe,
        webhookSecret: 'whsec_test',
        finalizeOrderFromSession: async (session) => {
            finalizeCalls.push(session.id);
            return { status: 'paid', orderId: session.metadata?.order_id || 'order-1' };
        },
        releaseReservedOrder: async (orderId) => {
            releaseCalls.push(orderId);
            return { status: 'released', orderId };
        }
    });

    const webhookHandler = routeHandlers['POST /api/webhook'];
    assert.ok(webhookHandler);

    const completedReq = {
        headers: { 'stripe-signature': 'sig' },
        body: {
            type: 'checkout.session.completed',
            data: { object: { id: 'cs_completed', metadata: { order_id: 'ord_1' } } }
        }
    };
    const completedRes = createMockRes();
    await webhookHandler(completedReq, completedRes);
    assert.equal(completedRes.statusCode, 200);
    assert.deepEqual(completedRes.body, { received: true });
    assert.deepEqual(finalizeCalls, ['cs_completed']);

    const expiredReq = {
        headers: { 'stripe-signature': 'sig' },
        body: {
            type: 'checkout.session.expired',
            data: { object: { id: 'cs_expired', metadata: { order_id: 'ord_2' } } }
        }
    };
    const expiredRes = createMockRes();
    await webhookHandler(expiredReq, expiredRes);
    assert.equal(expiredRes.statusCode, 200);
    assert.deepEqual(expiredRes.body, { received: true });
    assert.deepEqual(releaseCalls, ['ord_2']);
});
