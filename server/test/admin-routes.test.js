const test = require('node:test');
const assert = require('node:assert/strict');

const { registerAdminRoutes } = require('../routes/admin');
const { sanitizeText, isValidEmail } = require('../logic/checkout-utils');
const { formatPickupDate } = require('../utils/helpers');

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
        send(payload) {
            this.body = payload;
            return this;
        },
        cookie() {
            return this;
        },
        clearCookie() {
            return this;
        }
    };
    return res;
};

const registerRoutesForTest = (pool) => {
    const routeHandlers = {};
    const app = {
        get(path, ...handlers) {
            routeHandlers[`GET ${path}`] = handlers[handlers.length - 1];
        },
        post(path, ...handlers) {
            routeHandlers[`POST ${path}`] = handlers[handlers.length - 1];
        },
        put(path, ...handlers) {
            routeHandlers[`PUT ${path}`] = handlers[handlers.length - 1];
        },
        delete(path, ...handlers) {
            routeHandlers[`DELETE ${path}`] = handlers[handlers.length - 1];
        }
    };

    registerAdminRoutes(app, {
        pool,
        checkAuth: (_req, _res, next) => next(),
        adminLoginLimiter: (_req, _res, next) => next(),
        signAdminSession: () => 'token',
        getCookieOptions: () => ({ httpOnly: true }),
        getClearCookieOptions: () => ({ httpOnly: true }),
        ADMIN_SESSION_COOKIE: 'admin_session',
        ADMIN_SESSION_TTL_MS: 1000,
        sendServerError: (res, err, message) =>
            res.status(500).json({ error: message, detail: err.message }),
        sanitizeText,
        isValidEmail,
        sendEmailMessage: async () => {},
        formatPickupDate,
        handlePickupStockRequest: async (_req, res) => res.json({ ok: true })
    });

    return routeHandlers;
};

test('admin orders-page returns paged payload with hasMore metadata', async () => {
    const pool = {
        async query(sql, params) {
            if (sql.includes('FROM orders')) {
                assert.deepEqual(params, [3, 0]);
                return {
                    rows: [
                        { id: 'ord_1' },
                        { id: 'ord_2' },
                        { id: 'ord_3' }
                    ]
                };
            }
            throw new Error(`Unexpected SQL: ${sql}`);
        }
    };

    const handlers = registerRoutesForTest(pool);
    const handler = handlers['GET /api/admin/orders-page'];
    assert.ok(handler);

    const req = {
        query: {
            limit: '2',
            offset: '0'
        }
    };
    const res = createMockRes();

    await handler(req, res);

    assert.equal(res.statusCode, 200);
    assert.equal(Array.isArray(res.body?.orders), true);
    assert.equal(res.body.orders.length, 2);
    assert.equal(res.body.hasMore, true);
    assert.equal(res.body.limit, 2);
    assert.equal(res.body.offset, 0);
    assert.equal(res.body.nextOffset, 2);
});

test('admin meta returns hens, dates, and pickup stock key map', async () => {
    const pool = {
        async query(sql) {
            if (sql.includes('FROM hens WHERE is_active = true ORDER BY id ASC')) {
                return {
                    rows: [{ id: 1, name: 'Ready-to-Lay Hens / Poules Prêtes à Pondre' }]
                };
            }
            if (sql.includes('FROM pickup_dates WHERE is_active = true')) {
                return {
                    rows: [{ id: 'date_1', date_value: '2026-06-01', location: 'bristol' }]
                };
            }
            if (sql.includes('FROM pickup_stock')) {
                return {
                    rows: [{ date_value: '2026-06-01', location: 'bristol', hen_id: 1, stock: 9 }]
                };
            }
            throw new Error(`Unexpected SQL: ${sql}`);
        }
    };

    const handlers = registerRoutesForTest(pool);
    const handler = handlers['GET /api/admin/meta'];
    assert.ok(handler);

    const req = { query: {} };
    const res = createMockRes();

    await handler(req, res);

    assert.equal(res.statusCode, 200);
    assert.equal(Array.isArray(res.body?.hens), true);
    assert.equal(Array.isArray(res.body?.dates), true);
    assert.equal(res.body.hens.length, 1);
    assert.equal(res.body.dates.length, 1);
    assert.equal(res.body.pickupStocks['2026-06-01::bristol']['1'], 9);
});
