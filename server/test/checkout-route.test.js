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

const normalizeSql = (sql) => String(sql).replace(/\s+/g, ' ').trim();

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
            const normalizedSql = normalizeSql(sql);
            if (normalizedSql.includes('SELECT id FROM pickup_dates')) {
                return { rows: [{ id: 'pickup-date-1' }] };
            }
            if (normalizedSql.includes('SELECT id, name, image_url FROM hens')) {
                return {
                    rows: [{
                        id: 1,
                        name: 'Ready-to-Lay Hens / Poules Prêtes à Pondre',
                        image_url: null
                    }]
                };
            }
            if (normalizedSql.includes('SELECT hen_id, stock FROM pickup_stock')) {
                return { rows: [{ hen_id: 1, stock: 100 }] };
            }
            if (normalizedSql.includes('UPDATE orders SET stripe_payment_id')) {
                return { rowCount: 1, rows: [] };
            }
            if (normalizedSql.includes('SELECT id, status FROM orders WHERE stripe_payment_id')) {
                return { rows: [] };
            }
            throw new Error(`Unexpected pool query: ${normalizedSql}`);
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
        getDepositRequiredAboveQty,
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

test('checkout route rejects full payment when Lohmann qty is above 50', async () => {
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
            const normalizedSql = normalizeSql(sql);
            if (normalizedSql.includes('SELECT id FROM pickup_dates')) {
                return { rows: [{ id: 'pickup-date-1' }] };
            }
            if (normalizedSql.includes('SELECT id, name, image_url FROM hens')) {
                return {
                    rows: [{
                        id: 1,
                        name: 'Ready-to-Lay Hens / Poules Prêtes à Pondre',
                        image_url: null
                    }]
                };
            }
            if (normalizedSql.includes('SELECT hen_id, stock FROM pickup_stock')) {
                return { rows: [{ hen_id: 1, stock: 1000 }] };
            }
            if (normalizedSql.includes('SELECT id, status FROM orders WHERE stripe_payment_id')) {
                return { rows: [] };
            }
            if (normalizedSql.includes('UPDATE orders SET stripe_payment_id')) {
                return { rowCount: 0, rows: [] };
            }
            throw new Error(`Unexpected pool query: ${normalizedSql}`);
        }
    };

    const stripe = {
        checkout: {
            sessions: {
                async create() {
                    throw new Error('Stripe session should not be created when full payment is blocked.');
                },
                async expire() {
                    return { status: 'expired' };
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
        getDepositRequiredAboveQty,
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
            items: [{ id: 1, quantity: 51 }]
        },
        get(name) {
            if (name === 'accept-language') return 'en';
            return '';
        },
        headers: {}
    };
    const res = createMockRes();

    await checkoutHandler(req, res);

    assert.equal(res.statusCode, 400);
    assert.equal(
        res.body?.error,
        'Orders above 50 Lohmann hens require a 25% deposit.'
    );
    assert.equal(reserveCalls.length, 0);
});

test('checkout route accepts deposit for Lohmann qty above 50 with lamb in same order', async () => {
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
            const normalizedSql = normalizeSql(sql);
            if (normalizedSql.includes('SELECT id FROM pickup_dates')) {
                return { rows: [{ id: 'pickup-date-1' }] };
            }
            if (normalizedSql.includes('SELECT id, name, image_url FROM hens')) {
                return {
                    rows: [
                        {
                            id: 1,
                            name: 'Ready-to-Lay Hens / Poules Prêtes à Pondre',
                            image_url: null
                        },
                        {
                            id: 5,
                            name: 'Lamb / Agneau',
                            image_url: null
                        }
                    ]
                };
            }
            if (normalizedSql.includes('SELECT hen_id, stock FROM pickup_stock')) {
                return {
                    rows: [
                        { hen_id: 1, stock: 1000 },
                        { hen_id: 5, stock: 1000 }
                    ]
                };
            }
            if (normalizedSql.includes('UPDATE orders SET stripe_payment_id')) {
                return { rowCount: 1, rows: [] };
            }
            if (normalizedSql.includes('SELECT id, status FROM orders WHERE stripe_payment_id')) {
                return { rows: [] };
            }
            throw new Error(`Unexpected pool query: ${normalizedSql}`);
        }
    };

    let stripeCreatePayload = null;
    const stripe = {
        checkout: {
            sessions: {
                async create(payload) {
                    stripeCreatePayload = payload;
                    return {
                        id: 'cs_test_checkout_2',
                        url: 'https://checkout.stripe.test/pay/cs_test_checkout_2?session_id=cs_test_checkout_2'
                    };
                },
                async expire() {
                    return { id: 'cs_test_checkout_2', status: 'expired' };
                },
                async retrieve() {
                    return { id: 'cs_test_checkout_2', payment_status: 'unpaid' };
                }
            }
        }
    };

    const withTransaction = async (_pool, work) => {
        const client = {
            async query(sql) {
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
        getDepositRequiredAboveQty,
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
            paymentOption: 'deposit',
            language: 'en',
            items: [
                { id: 1, quantity: 51 },
                { id: 5, quantity: 1 }
            ]
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
    assert.equal(reserveCalls.length, 1);
    assert.equal(reserveCalls[0].items.length, 2);
    assert.equal(reserveCalls[0].items[0].id, 1);
    assert.equal(reserveCalls[0].items[0].quantity, 51);
    assert.equal(reserveCalls[0].items[1].id, 5);
    assert.equal(reserveCalls[0].items[1].quantity, 1);

    assert.equal(stripeCreatePayload?.metadata?.payment_type, 'deposit');
    assert.equal(Array.isArray(stripeCreatePayload?.line_items), true);
    assert.equal(stripeCreatePayload.line_items.length, 2);
});

test('checkout route stores lamb-only orders as deposit even when full payment is requested', async () => {
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
            const normalizedSql = normalizeSql(sql);
            if (normalizedSql.includes('SELECT id FROM pickup_dates')) {
                return { rows: [{ id: 'pickup-date-1' }] };
            }
            if (normalizedSql.includes('SELECT id, name, image_url FROM hens')) {
                return {
                    rows: [{
                        id: 5,
                        name: 'Lamb / Agneau',
                        image_url: null
                    }]
                };
            }
            if (normalizedSql.includes('SELECT hen_id, stock FROM pickup_stock')) {
                return { rows: [{ hen_id: 5, stock: 100 }] };
            }
            if (normalizedSql.includes('UPDATE orders SET stripe_payment_id')) {
                return { rowCount: 1, rows: [] };
            }
            if (normalizedSql.includes('SELECT id, status FROM orders WHERE stripe_payment_id')) {
                return { rows: [] };
            }
            throw new Error(`Unexpected pool query: ${normalizedSql}`);
        }
    };

    let stripeCreatePayload = null;
    const stripe = {
        checkout: {
            sessions: {
                async create(payload) {
                    stripeCreatePayload = payload;
                    return {
                        id: 'cs_test_checkout_lamb',
                        url: 'https://checkout.stripe.test/pay/cs_test_checkout_lamb?session_id=cs_test_checkout_lamb'
                    };
                },
                async expire() {
                    return { id: 'cs_test_checkout_lamb', status: 'expired' };
                },
                async retrieve() {
                    return { id: 'cs_test_checkout_lamb', payment_status: 'unpaid' };
                }
            }
        }
    };

    let insertedOrderValues = null;
    const withTransaction = async (_pool, work) => {
        const client = {
            async query(sql, params) {
                if (sql.includes('INSERT INTO customers')) {
                    return { rows: [{ id: 'customer-1' }] };
                }
                if (sql.includes('INSERT INTO orders')) {
                    insertedOrderValues = params;
                    return { rows: [{ id: 'order-lamb-1' }] };
                }
                throw new Error(`Unexpected tx query: ${sql}`);
            }
        };
        return work(client);
    };

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
        getDepositRequiredAboveQty,
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
        reserveStockForItems: async () => {},
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
                name: 'Lamb Customer',
                phone: '(555) 555-1234',
                email: 'lamb.checkout@example.com',
                address: '42 Farm Lane'
            },
            pickup: {
                date: '2026-03-01',
                location: 'bristol'
            },
            paymentOption: 'full',
            language: 'en',
            items: [{ id: 5, quantity: 1 }]
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
    assert.equal(stripeCreatePayload?.metadata?.payment_type, 'deposit');
    const storedItems = JSON.parse(insertedOrderValues?.[6] || '[]');
    assert.equal(storedItems.length, 1);
    assert.deepEqual(storedItems[0], {
        id: 5,
        quantity: 1,
        name: 'Lamb / Agneau',
        unit_cents: 10000,
        line_cents: 10000
    });
    assert.equal(insertedOrderValues?.[10], 'deposit');
    assert.equal(insertedOrderValues?.[11], 10000);
    assert.equal(insertedOrderValues?.[12], 0);
});

test('checkout route blocks suppressed customer emails before creating an order', async () => {
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
            throw new Error(`Unexpected pool query: ${normalizeSql(sql)}`);
        }
    };

    registerCheckoutRoutes(app, {
        pool,
        stripe: {
            checkout: {
                sessions: {
                    async create() {
                        throw new Error('Stripe session should not be created for suppressed emails.');
                    }
                }
            }
        },
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
        getDepositRequiredAboveQty,
        isPickupLocationRestricted,
        getPaymentDetails,
        getOrderSummary: async () => null,
        parseCookies,
        signOrderConfirmToken: () => 'confirm-token',
        verifyOrderConfirmToken: () => null,
        verifyManagedEmailAddress: async () => ({
            normalizedEmail: 'blocked.checkout@example.com',
            status: 'suppressed',
            shouldBlock: true,
            message: 'This address is suppressed because previous deliveries bounced.'
        }),
        getCookieOptions: () => ({ httpOnly: true }),
        ORDER_CONFIRM_COOKIE: 'order_confirm',
        ORDER_CONFIRM_TTL_MS: 1000,
        CHECKOUT_MAX_ITEM_ROWS: 200,
        RESERVED_ORDER_STATUS: 'reserved',
        CHECKOUT_RESERVATION_TTL_MINUTES: 45,
        PAID_STATUSES: new Set(['paid', 'fulfilled', 'picked_up']),
        reserveStockForItems: async () => {},
        withTransaction: async () => {
            throw new Error('Transaction should not start for suppressed emails.');
        },
        finalizeOrderFromSession: async () => ({ status: 'missing_order' }),
        releaseReservedOrder: async () => ({ status: 'released' }),
        sweepExpiredReservedOrders: async () => {}
    });

    const checkoutHandler = routeHandlers['POST /api/checkout'];
    assert.ok(checkoutHandler);

    const req = {
        body: {
            customer: {
                name: 'Blocked Customer',
                phone: '(555) 111-2222',
                email: 'blocked.checkout@example.com',
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

    assert.equal(res.statusCode, 400);
    assert.equal(
        res.body?.error,
        'This address is suppressed because previous deliveries bounced.'
    );
});
