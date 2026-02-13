const test = require('node:test');
const assert = require('node:assert/strict');

const { registerAdminRoutes } = require('../routes/admin');
const { sanitizeText, isValidEmail } = require('../logic/checkout-utils');
const { formatPickupDate } = require('../utils/helpers');

const normalizeSql = (sql) => String(sql).replace(/\s+/g, ' ').trim();

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

const registerRoutesForTest = (pool, overrides = {}) => {
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
        handlePickupStockRequest: async (_req, res) => res.json({ ok: true }),
        ...overrides
    });

    return routeHandlers;
};

test('admin orders-page returns paged payload with hasMore metadata', async () => {
    const pool = {
        async query(sql, params) {
            const normalizedSql = normalizeSql(sql);
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
            throw new Error(`Unexpected SQL: ${normalizedSql}`);
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

test('admin meta returns hens, dates, pickup stock map, and reserved quantities map', async () => {
    const pool = {
        async query(sql) {
            const normalizedSql = normalizeSql(sql);
            if (normalizedSql.includes('FROM hens WHERE is_active = true ORDER BY id ASC')) {
                return {
                    rows: [{ id: 1, name: 'Ready-to-Lay Hens / Poules Prêtes à Pondre' }]
                };
            }
            if (normalizedSql.includes('FROM orders')) {
                return {
                    rows: [
                        {
                            date_value: '2026-06-01',
                            location: 'bristol',
                            items: JSON.stringify([{ id: 1, quantity: 3 }])
                        },
                        {
                            date_value: '2026-06-01',
                            location: 'bristol',
                            items: [{ id: 1, quantity: 2 }]
                        }
                    ]
                };
            }
            if (normalizedSql.includes('FROM pickup_stock')) {
                return {
                    rows: [{ date_value: '2026-06-01', location: 'bristol', hen_id: 1, stock: 9 }]
                };
            }
            if (normalizedSql.includes('FROM pickup_dates WHERE is_active = true')) {
                return {
                    rows: [{ id: 'date_1', date_value: '2026-06-01', location: 'bristol' }]
                };
            }
            throw new Error(`Unexpected SQL: ${normalizedSql}`);
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
    assert.equal(res.body.pickupReserved['2026-06-01::bristol']['1'], 5);
});

test('admin add pickup date rejects duplicates for same date and location', async () => {
    let insertCalled = false;
    const pool = {
        async query(sql, params) {
            const normalizedSql = normalizeSql(sql);
            if (
                normalizedSql.includes('FROM pickup_dates')
                && normalizedSql.includes('WHERE date_value = $1 AND location = $2')
            ) {
                assert.deepEqual(params, ['2026-06-01', 'hemmingford']);
                return { rows: [{ id: 'existing-date-id' }] };
            }
            if (normalizedSql.includes('INSERT INTO pickup_dates')) {
                insertCalled = true;
            }
            throw new Error(`Unexpected SQL: ${normalizedSql}`);
        }
    };

    const handlers = registerRoutesForTest(pool);
    const handler = handlers['POST /api/admin/pickup-dates'];
    assert.ok(handler);

    const req = {
        body: {
            date_value: '2026-06-01',
            location: 'hemmingford'
        }
    };
    const res = createMockRes();

    await handler(req, res);

    assert.equal(res.statusCode, 409);
    assert.equal(res.body?.error, 'Pickup date already exists for this location.');
    assert.equal(insertCalled, false);
});

test('admin pickup date update merges into existing target and emails affected users', async () => {
    const pool = {
        async query(sql, params) {
            const normalizedSql = normalizeSql(sql);
            if (normalizedSql.includes('BEGIN') || normalizedSql.includes('COMMIT') || normalizedSql.includes('ROLLBACK')) {
                return { rows: [] };
            }
            if (normalizedSql.includes('FROM pickup_dates') && normalizedSql.includes('WHERE id = $1') && normalizedSql.includes('FOR UPDATE')) {
                assert.deepEqual(params, ['pickup-date-source']);
                return {
                    rows: [{ id: 'pickup-date-source', date_value: '2026-06-01', location: 'hemmingford' }]
                };
            }
            if (
                normalizedSql.includes('FROM orders')
                && normalizedSql.includes('NOT IN (\'cancelled\', \'picked_up\', \'fulfilled\')')
            ) {
                assert.deepEqual(params, ['2026-06-01', 'hemmingford']);
                return {
                    rows: [
                        {
                            customer_email: 'alice@example.com',
                            language: 'en',
                            customer_name: 'Alice'
                        },
                        {
                            customer_email: 'ALICE@example.com',
                            language: 'fr',
                            customer_name: 'Alice Duplicate'
                        },
                        {
                            customer_email: 'jean@example.com',
                            language: 'fr',
                            customer_name: 'Jean'
                        }
                    ]
                };
            }
            if (
                normalizedSql.includes('FROM pickup_dates')
                && normalizedSql.includes('date_value = $1')
                && normalizedSql.includes('id <> $3')
            ) {
                assert.deepEqual(params, ['2026-06-08', 'hemmingford', 'pickup-date-source']);
                return {
                    rows: [{ id: 'pickup-date-target' }]
                };
            }
            if (
                normalizedSql.includes('UPDATE orders')
                && normalizedSql.includes('SET pickup_date = $1, pickup_location = $2')
            ) {
                assert.deepEqual(params, ['2026-06-08', 'hemmingford', '2026-06-01', 'hemmingford']);
                return { rowCount: 3, rows: [] };
            }
            if (
                normalizedSql.includes('INSERT INTO pickup_stock')
                && normalizedSql.includes('ON CONFLICT (pickup_date_id, hen_id)')
            ) {
                assert.deepEqual(params, ['pickup-date-target', 'pickup-date-source']);
                return { rowCount: 4, rows: [] };
            }
            if (normalizedSql.includes('DELETE FROM pickup_dates WHERE id = $1')) {
                assert.deepEqual(params, ['pickup-date-source']);
                return { rowCount: 1, rows: [] };
            }
            throw new Error(`Unexpected SQL: ${normalizedSql}`);
        }
    };

    const sentMessages = [];
    const handlers = registerRoutesForTest(pool, {
        sendEmailMessage: async (payload) => {
            sentMessages.push(payload);
        }
    });
    const handler = handlers['PUT /api/admin/pickup-dates/:id'];
    assert.ok(handler);

    const req = {
        params: { id: 'pickup-date-source' },
        body: {
            date_value: '2026-06-08',
            email_users: true
        }
    };
    const res = createMockRes();

    await handler(req, res);

    assert.equal(res.statusCode, 200);
    assert.equal(res.body?.success, true);
    assert.equal(res.body?.merged, true);
    assert.equal(res.body?.movedOrders, 3);
    assert.equal(res.body?.emailRequested, true);
    assert.equal(res.body?.emailRecipients, 2);
    assert.equal(res.body?.emailSent, 2);
    assert.equal(res.body?.emailFailed, 0);
    assert.equal(sentMessages.length, 2);
    assert.equal(
        sentMessages.some((message) => String(message?.subject || '').includes('Pickup Date Change')),
        true
    );
    assert.equal(
        sentMessages.some((message) => String(message?.subject || '').includes('Changement de date de ramassage')),
        true
    );
});

test('admin cancelling orders releases reserved stock before direct status updates', async () => {
    const updateCalls = [];
    const pool = {
        async query(sql, params) {
            const normalizedSql = normalizeSql(sql);
            if (normalizedSql.includes('UPDATE orders SET status = $1 WHERE id::text = ANY($2::text[])')) {
                updateCalls.push(params);
                return { rowCount: 1, rows: [] };
            }
            throw new Error(`Unexpected SQL: ${normalizedSql}`);
        }
    };

    const releasedIds = [];
    const handlers = registerRoutesForTest(pool, {
        releaseReservedOrder: async (orderId) => {
            releasedIds.push(String(orderId));
            if (String(orderId) === '1') return { status: 'released' };
            if (String(orderId) === '2') return { status: 'not_reserved' };
            return { status: 'missing_order' };
        }
    });

    const handler = handlers['PUT /api/admin/orders/status'];
    assert.ok(handler);

    const req = {
        body: {
            ids: ['1', '2', '3'],
            status: 'cancelled'
        }
    };
    const res = createMockRes();

    await handler(req, res);

    assert.equal(res.statusCode, 200);
    assert.deepEqual(releasedIds, ['1', '2', '3']);
    assert.equal(updateCalls.length, 1);
    assert.deepEqual(updateCalls[0], ['cancelled', ['2']]);
});

test('admin delete pickup date blocks when active orders exist', async () => {
    let deleteCalled = false;
    const pool = {
        async query(sql, params) {
            const normalizedSql = normalizeSql(sql);
            if (normalizedSql.includes('SELECT date_value, location FROM pickup_dates WHERE id = $1')) {
                assert.deepEqual(params, ['pickup-date-1']);
                return {
                    rows: [{ date_value: '2026-06-01', location: 'hemmingford' }]
                };
            }
            if (normalizedSql.includes('FROM orders') && normalizedSql.includes('LOWER(COALESCE(status, \'pending\')) <> \'cancelled\'')) {
                assert.deepEqual(params, ['2026-06-01', 'hemmingford']);
                return { rows: [{ count: 2 }] };
            }
            if (normalizedSql.includes('DELETE FROM pickup_dates WHERE id = $1')) {
                deleteCalled = true;
                return { rowCount: 1, rows: [] };
            }
            throw new Error(`Unexpected SQL: ${normalizedSql}`);
        }
    };

    const handlers = registerRoutesForTest(pool);
    const handler = handlers['DELETE /api/admin/pickup-dates/:id'];
    assert.ok(handler);

    const req = { params: { id: 'pickup-date-1' } };
    const res = createMockRes();

    await handler(req, res);

    assert.equal(res.statusCode, 409);
    assert.equal(res.body?.error, 'Cannot delete pickup date with active orders.');
    assert.equal(deleteCalled, false);
});

test('admin email route builds branded html for plain-text reminder messages', async () => {
    const pool = {
        async query(sql) {
            throw new Error(`Unexpected SQL: ${normalizeSql(sql)}`);
        }
    };

    const sentMessages = [];
    const handlers = registerRoutesForTest(pool, {
        sendEmailMessage: async (payload) => {
            sentMessages.push(payload);
        }
    });
    const handler = handlers['POST /api/admin/email'];
    assert.ok(handler);

    const req = {
        body: {
            messages: [
                {
                    to: { email: 'customer@example.com', name: 'Customer Name' },
                    subject: 'Pickup reminder - March 1, 2026 (Bristol)',
                    text: 'Hello,\n\nThis is a reminder for your pickup.\nThank you.'
                }
            ]
        }
    };
    const res = createMockRes();

    await handler(req, res);

    assert.equal(res.statusCode, 200);
    assert.equal(res.body?.success, true);
    assert.equal(res.body?.sent, 1);
    assert.equal(sentMessages.length, 1);
    assert.equal(sentMessages[0]?.subject, 'Pickup reminder - March 1, 2026 (Bristol)');
    assert.match(String(sentMessages[0]?.html || ''), /max-width:\s*600px/);
    assert.match(String(sentMessages[0]?.html || ''), /Les Fermes Soulard/);
    assert.match(String(sentMessages[0]?.html || ''), /This is a reminder for your pickup\.<br>Thank you\./);
});
