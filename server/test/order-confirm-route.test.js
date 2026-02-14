const test = require('node:test');
const assert = require('node:assert/strict');

process.env.NODE_ENV = 'test';

const { registerCheckoutRoutes } = require('../routes/checkout');
const { normalizeCheckoutItems, sanitizeText, isValidEmail } = require('../logic/checkout-utils');
const { normalizeLanguage, parseCookies } = require('../utils/helpers');
const {
    calculateItemPrice,
    isLohmannHenName,
    getMinimumOrderQuantity,
    getDepositRequiredAboveQty,
    isPickupLocationRestricted,
    getPaymentDetails
} = require('../logic/pricing');

const createMockRes = () => {
    const res = {
        statusCode: 200,
        body: null,
        status(code) {
            this.statusCode = code;
            return this;
        },
        json(payload) {
            this.body = payload;
            return this;
        },
        cookie() {
            return this;
        }
    };
    return res;
};

const registerRoutesForTest = ({ pool, stripe, finalizeOrderFromSession, getOrderSummary }) => {
    const routeHandlers = {};
    const app = {
        post(path, ...handlers) {
            routeHandlers[`POST ${path}`] = handlers[handlers.length - 1];
        },
        get(path, ...handlers) {
            routeHandlers[`GET ${path}`] = handlers[handlers.length - 1];
        }
    };

    registerCheckoutRoutes(app, {
        pool,
        stripe,
        sendServerError: (res, err, message) =>
            res.status(500).json({ error: message, detail: err.message }),
        checkoutLimiter: (_req, _res, next) => next(),
        emailVerifyLimiter: (_req, _res, next) => next(),
        orderConfirmLimiter: (_req, _res, next) => next(),
        getRequestBaseUrl: () => 'http://localhost:5173',
        normalizeCheckoutItems,
        normalizeLanguage,
        sanitizeText,
        isValidEmail,
        calculateItemPrice,
        isLohmannHenName,
        getMinimumOrderQuantity,
        getDepositEligibleMinQty: () => 13,
        getDepositRequiredAboveQty,
        isPickupLocationRestricted,
        getPaymentDetails,
        getOrderSummary,
        parseCookies,
        signOrderConfirmToken: () => null,
        verifyOrderConfirmToken: () => null,
        verifyCheckoutEmail: async () => ({ accepted: true, shouldBlock: false }),
        getCookieOptions: () => ({ httpOnly: true }),
        ORDER_CONFIRM_COOKIE: 'order_confirm',
        ORDER_CONFIRM_TTL_MS: 1000,
        CHECKOUT_MAX_ITEM_ROWS: 200,
        RESERVED_ORDER_STATUS: 'reserved',
        CHECKOUT_RESERVATION_TTL_MINUTES: 45,
        PAID_STATUSES: new Set(['paid', 'fulfilled', 'picked_up']),
        reserveStockForItems: async () => {},
        withTransaction: async (_pool, work) => work({ query: async () => ({ rows: [] }) }),
        finalizeOrderFromSession,
        releaseReservedOrder: async () => ({ status: 'released' }),
        sweepExpiredReservedOrders: async () => {}
    });

    return routeHandlers;
};

test('orders/confirm returns success=false for reserved/unpaid sessions', async () => {
    const pool = {
        async query(sql, params) {
            if (String(sql).includes('SELECT id, status FROM orders WHERE stripe_payment_id = $1')) {
                assert.deepEqual(params, ['cs_test_unpaid']);
                return { rows: [{ id: 'order_1', status: 'reserved' }] };
            }
            throw new Error(`Unexpected SQL: ${sql}`);
        }
    };

    const stripe = {
        checkout: {
            sessions: {
                async retrieve(sessionId) {
                    assert.equal(sessionId, 'cs_test_unpaid');
                    return { id: sessionId, payment_status: 'unpaid' };
                }
            }
        }
    };

    const routeHandlers = registerRoutesForTest({
        pool,
        stripe,
        finalizeOrderFromSession: async () => {
            throw new Error('finalizeOrderFromSession should not be called for unpaid sessions');
        },
        getOrderSummary: async (orderId) => {
            assert.equal(orderId, 'order_1');
            return {
                order: {
                    id: 'order_1',
                    status: 'reserved'
                },
                items: []
            };
        }
    });

    const handler = routeHandlers['GET /api/orders/confirm'];
    assert.ok(handler);

    const req = {
        query: { session_id: 'cs_test_unpaid' },
        headers: { cookie: '' }
    };
    const res = createMockRes();

    await handler(req, res);

    assert.equal(res.statusCode, 200);
    assert.equal(res.body?.success, false);
    assert.equal(res.body?.status, 'reserved');
    assert.equal(res.body?.order, null);
    assert.equal(res.body?.orderId, 'order_1');
});

test('orders/confirm falls back to paid status when Stripe lookup fails', async () => {
    const pool = {
        async query(sql, params) {
            if (String(sql).includes('SELECT id, status FROM orders WHERE stripe_payment_id = $1')) {
                assert.deepEqual(params, ['cs_test_paid']);
                return { rows: [{ id: 'order_2', status: 'paid' }] };
            }
            throw new Error(`Unexpected SQL: ${sql}`);
        }
    };

    const stripe = {
        checkout: {
            sessions: {
                async retrieve() {
                    throw new Error('Stripe unavailable');
                }
            }
        }
    };

    const routeHandlers = registerRoutesForTest({
        pool,
        stripe,
        finalizeOrderFromSession: async () => ({ status: 'missing_order' }),
        getOrderSummary: async (orderId) => {
            assert.equal(orderId, 'order_2');
            return {
                order: {
                    id: 'order_2',
                    status: 'paid',
                    total_cents: 1000,
                    amount_paid_cents: 1000,
                    amount_due_cents: 0,
                    payment_type: 'full',
                    language: 'en'
                },
                items: []
            };
        }
    });

    const handler = routeHandlers['GET /api/orders/confirm'];
    assert.ok(handler);

    const req = {
        query: { session_id: 'cs_test_paid' },
        headers: { cookie: '' }
    };
    const res = createMockRes();

    await handler(req, res);

    assert.equal(res.statusCode, 200);
    assert.equal(res.body?.success, true);
    assert.equal(res.body?.status, 'paid');
    assert.equal(res.body?.order?.id, 'order_2');
});

test('orders/confirm does not return success=true for cancelled orders (even if Stripe says paid)', async () => {
    const pool = {
        async query() {
            throw new Error('Unexpected SQL lookup; finalize should provide orderId');
        }
    };

    const stripe = {
        checkout: {
            sessions: {
                async retrieve(sessionId) {
                    assert.equal(sessionId, 'cs_test_cancelled');
                    return { id: sessionId, payment_status: 'paid' };
                }
            }
        }
    };

    const routeHandlers = registerRoutesForTest({
        pool,
        stripe,
        finalizeOrderFromSession: async () => ({ status: 'cancelled', orderId: 'order_3' }),
        getOrderSummary: async (orderId) => {
            assert.equal(orderId, 'order_3');
            return {
                order: {
                    id: 'order_3',
                    status: 'cancelled'
                },
                items: []
            };
        }
    });

    const handler = routeHandlers['GET /api/orders/confirm'];
    assert.ok(handler);

    const req = {
        query: { session_id: 'cs_test_cancelled' },
        headers: { cookie: '' }
    };
    const res = createMockRes();

    await handler(req, res);

    assert.equal(res.statusCode, 200);
    assert.equal(res.body?.success, false);
    assert.equal(res.body?.status, 'cancelled');
    assert.equal(res.body?.order, null);
    assert.equal(res.body?.orderId, 'order_3');
});

