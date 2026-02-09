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
    isPickupLocationRestricted,
    getPaymentDetails
} = require('../logic/pricing');

const createMockRes = () => {
    const cookies = [];
    const res = {
        statusCode: 200,
        body: null,
        cookies,
        status(code) {
            this.statusCode = code;
            return this;
        },
        json(payload) {
            this.body = payload;
            return this;
        },
        cookie(name, value, options) {
            cookies.push({ name, value, options });
            return this;
        }
    };
    return res;
};

test('checkout route creates reserved order and returns Stripe checkout URL', async () => {
    const routeHandlers = {};
    const app = {
        post(path, ...handlers) {
            routeHandlers[`POST ${path}`] = handlers[handlers.length - 1];
        },
        get(path, ...handlers) {
            routeHandlers[`GET ${path}`] = handlers[handlers.length - 1];
        }
    };

    const pool = {
        async query(sql) {
            if (sql.includes('SELECT id FROM pickup_dates')) {
                return { rows: [{ id: 'pickup-date-1' }] };
            }
            if (sql.includes('SELECT id, name, image_url FROM hens')) {
                return {
                    rows: [{
                        id: 1,
                        name: 'Ready-to-Lay Hens / Poules Prêtes à Pondre',
                        image_url: null
                    }]
                };
            }
            if (sql.includes('SELECT hen_id, stock FROM pickup_stock')) {
                return { rows: [{ hen_id: 1, stock: 100 }] };
            }
            if (sql.includes('UPDATE orders SET stripe_payment_id')) {
                return { rowCount: 1, rows: [] };
            }
            if (sql.includes('SELECT id, status FROM orders WHERE stripe_payment_id')) {
                return { rows: [] };
            }
            throw new Error(`Unexpected pool query: ${sql}`);
        }
    };

    const stripe = {
        checkout: {
            sessions: {
                async create() {
                    return {
                        id: 'cs_test_checkout_1',
                        url: 'https://checkout.stripe.test/pay/cs_test_checkout_1?session_id=cs_test_checkout_1'
                    };
                },
                async expire() {
                    return { id: 'cs_test_checkout_1', status: 'expired' };
                },
                async retrieve() {
                    return { id: 'cs_test_checkout_1', payment_status: 'unpaid' };
                }
            }
        }
    };

    const withTransaction = async (_pool, work) => {
        const client = {
            async query(sql) {
                if (sql.includes('SELECT id FROM customers')) {
                    return { rows: [] };
                }
                if (sql.includes('INSERT INTO customers')) {
                    return { rows: [{ id: 'customer-1' }] };
                }
                if (sql.includes('INSERT INTO orders')) {
                    return { rows: [{ id: 'order-1' }] };
                }
                throw new Error(`Unexpected tx query: ${sql}`);
            }
        };
        return work(client);
    };

    const reserveCalls = [];
    registerCheckoutRoutes(app, {
        pool,
        stripe,
        sendServerError: (res, err, message) =>
            res.status(500).json({ error: message, detail: err.message }),
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
        isPickupLocationRestricted,
        getPaymentDetails,
        getOrderSummary: async () => null,
        parseCookies,
        signOrderConfirmToken: () => 'confirm-token',
        verifyOrderConfirmToken: () => null,
        getCookieOptions: () => ({ httpOnly: true }),
        ORDER_CONFIRM_COOKIE: 'order_confirm',
        ORDER_CONFIRM_TTL_MS: 1000,
        CHECKOUT_MAX_ITEM_ROWS: 200,
        RESERVED_ORDER_STATUS: 'reserved',
        CHECKOUT_RESERVATION_TTL_MINUTES: 45,
        PAID_STATUSES: new Set(['paid', 'fulfilled', 'picked_up']),
        reserveStockForItems: async (_client, payload) => {
            reserveCalls.push(payload);
        },
        withTransaction,
        finalizeOrderFromSession: async () => ({ status: 'missing_order' }),
        releaseReservedOrder: async () => ({ status: 'released' }),
        sweepExpiredReservedOrders: async () => {}
    });

    const checkoutHandler = routeHandlers['POST /api/checkout'];
    assert.ok(checkoutHandler);

    const req = {
        body: {
            customer: {
                name: 'Integration Test',
                phone: '(555) 123-0000',
                email: 'integration.checkout@example.com',
                address: '123 Test Street'
            },
            pickup: {
                date: '2026-03-01',
                location: 'hemmingford'
            },
            paymentOption: 'full',
            language: 'en',
            items: [{ id: 1, quantity: 1 }]
        },
        get(name) {
            if (name === 'accept-language') return 'en';
            return '';
        },
        headers: {}
    };
    const res = createMockRes();

    await checkoutHandler(req, res);

    assert.equal(res.statusCode, 200);
    assert.equal(typeof res.body?.url, 'string');
    assert.equal(res.body.url.includes('session_id='), true);
    assert.equal(res.cookies.length, 1);
    assert.equal(res.cookies[0].name, 'order_confirm');
    assert.equal(reserveCalls.length, 1);
    assert.equal(reserveCalls[0].items[0].id, 1);
    assert.equal(reserveCalls[0].items[0].quantity, 1);
});
