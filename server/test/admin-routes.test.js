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

const defaultVerifyManagedEmailAddress = async ({ email, language, verifyEmail }) => {
    const normalizedEmail = String(email || '').trim().toLowerCase();
    if (!normalizedEmail || !isValidEmail(normalizedEmail)) {
        return {
            normalizedEmail,
            status: 'invalid',
            shouldBlock: true,
            message: 'Invalid email address.'
        };
    }
    if (typeof verifyEmail !== 'function') {
        return {
            normalizedEmail,
            status: 'valid',
            shouldBlock: false,
            message: ''
        };
    }
    const verification = await verifyEmail(normalizedEmail, { language });
    return {
        normalizedEmail: verification?.normalizedEmail || normalizedEmail,
        status: String(
            verification?.status
            || (verification?.shouldBlock ? 'invalid' : 'valid')
        ).trim().toLowerCase() || 'valid',
        shouldBlock: Boolean(verification?.shouldBlock),
        message: String(verification?.message || '').trim(),
        reason: String(verification?.reason || '').trim(),
        suggestion: verification?.suggestion || null,
        verification
    };
};

const defaultPreviewTrackedEmailMessage = async ({ verifyEmail, message }) => {
    const assessment = await defaultVerifyManagedEmailAddress({
        email: message?.to?.email,
        language: message?.language || 'en',
        verifyEmail
    });
    return {
        email: String(message?.to?.email || '').trim().toLowerCase(),
        name: String(message?.to?.name || '').trim() || undefined,
        status: assessment.shouldBlock
            ? (assessment.status === 'suppressed' ? 'suppressed' : 'blocked')
            : (assessment.status === 'warning' ? 'warning' : 'ready'),
        reason: assessment.message || undefined,
        verificationStatus: assessment.status
    };
};

const defaultSendTrackedEmailMessage = async ({
    verifyEmail,
    sendEmailMessage,
    message
}) => {
    const assessment = await defaultVerifyManagedEmailAddress({
        email: message?.to?.email,
        language: message?.language || 'en',
        verifyEmail
    });
    if (assessment.shouldBlock) {
        return {
            success: false,
            email: String(message?.to?.email || '').trim().toLowerCase(),
            name: String(message?.to?.name || '').trim() || undefined,
            status: assessment.status === 'suppressed' ? 'suppressed' : 'blocked',
            reason: assessment.message || undefined,
            verificationStatus: assessment.status
        };
    }

    try {
        if (typeof sendEmailMessage === 'function') {
            await sendEmailMessage(message);
        }
        return {
            success: true,
            email: String(message?.to?.email || '').trim().toLowerCase(),
            name: String(message?.to?.name || '').trim() || undefined,
            status: assessment.status === 'warning' ? 'warning' : 'sent',
            reason: assessment.status === 'warning' ? assessment.message || undefined : undefined,
            verificationStatus: assessment.status
        };
    } catch (error) {
        return {
            success: false,
            email: String(message?.to?.email || '').trim().toLowerCase(),
            name: String(message?.to?.name || '').trim() || undefined,
            status: 'failed',
            reason: String(error?.message || 'Email send failed.').trim(),
            verificationStatus: assessment.status
        };
    }
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
        sendOrderConfirmationEmail: async () => ({ sent: true }),
        formatPickupDate,
        handlePickupStockRequest: async (_req, res) => res.json({ ok: true }),
        listEmailActivity: async () => [],
        previewTrackedEmailMessage: defaultPreviewTrackedEmailMessage,
        sendTrackedEmailMessage: defaultSendTrackedEmailMessage,
        verifyManagedEmailAddress: defaultVerifyManagedEmailAddress,
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
                        {
                            id: 'ord_1',
                            order_created_actor_type: 'checkout',
                            order_created_actor_id: 'alice@example.com',
                            order_created_request_id: 'req-order-1',
                            order_created_at: '2026-04-01T12:00:05.000Z',
                            order_created_backfilled: true,
                            order_created_inferred_from: 'stripe_payment_id_present'
                        },
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
    assert.equal(res.body.orders[0]?.order_created_actor_type, 'checkout');
    assert.equal(res.body.orders[0]?.order_created_actor_id, 'alice@example.com');
    assert.equal(res.body.orders[0]?.order_created_backfilled, true);
    assert.equal(res.body.orders[0]?.order_created_inferred_from, 'stripe_payment_id_present');
});

test('admin meta returns hens, dates, pickup stock map, and reserved quantities map', async () => {
    const pool = {
        async query(sql) {
            const normalizedSql = normalizeSql(sql);
            if (normalizedSql.includes('WITH active_hens AS')) {
                return {
                    rows: [
                        {
                            hens: [{ id: 1, name: 'Ready-to-Lay Hens / Poules Prêtes à Pondre' }],
                            dates: [{ id: 'date_1', date_value: '2026-06-01', location: 'bristol' }],
                            pickupStocks: {
                                '2026-06-01::bristol': { 1: 9 }
                            },
                            pickupReserved: {
                                '2026-06-01::bristol': { 1: 5 }
                            }
                        }
                    ]
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

test('admin add pickup date stores optional special note', async () => {
    let insertParams = null;
    const pool = {
        async query(sql, params) {
            const normalizedSql = normalizeSql(sql);
            if (
                normalizedSql.includes('FROM pickup_dates')
                && normalizedSql.includes('WHERE date_value = $1 AND location = $2')
            ) {
                return { rows: [] };
            }
            if (normalizedSql.includes('INSERT INTO pickup_dates (date_value, location, special_note)')) {
                insertParams = params;
                return {
                    rows: [{
                        id: 'pickup-date-1',
                        date_value: '2026-06-01',
                        location: 'hemmingford',
                        special_note: 'Evening pickup from 6 PM to 8 PM.'
                    }]
                };
            }
            if (normalizedSql.includes('SELECT id, COALESCE(stock, 0) as stock FROM hens')) {
                return { rows: [] };
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
            location: 'hemmingford',
            special_note: 'Evening pickup from 6 PM to 8 PM.'
        }
    };
    const res = createMockRes();

    await handler(req, res);

    assert.equal(res.statusCode, 200);
    assert.deepEqual(insertParams, [
        '2026-06-01',
        'hemmingford',
        'Evening pickup from 6 PM to 8 PM.'
    ]);
    assert.equal(res.body?.special_note, 'Evening pickup from 6 PM to 8 PM.');
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

test('admin pickup date update allows special-note-only changes', async () => {
    let noteUpdateParams = null;
    const pool = {
        async query(sql, params) {
            const normalizedSql = normalizeSql(sql);
            if (normalizedSql.includes('BEGIN') || normalizedSql.includes('COMMIT') || normalizedSql.includes('ROLLBACK')) {
                return { rows: [] };
            }
            if (normalizedSql.includes('FROM pickup_dates') && normalizedSql.includes('WHERE id = $1') && normalizedSql.includes('FOR UPDATE')) {
                assert.deepEqual(params, ['pickup-date-1']);
                return {
                    rows: [{
                        id: 'pickup-date-1',
                        date_value: '2026-06-01',
                        location: 'hemmingford',
                        special_note: null
                    }]
                };
            }
            if (normalizedSql.includes('UPDATE pickup_dates SET special_note = NULLIF($1, \'\') WHERE id = $2')) {
                noteUpdateParams = params;
                return { rowCount: 1, rows: [] };
            }
            throw new Error(`Unexpected SQL: ${normalizedSql}`);
        }
    };

    const handlers = registerRoutesForTest(pool);
    const handler = handlers['PUT /api/admin/pickup-dates/:id'];
    assert.ok(handler);

    const req = {
        params: { id: 'pickup-date-1' },
        body: {
            date_value: '2026-06-01',
            special_note: 'Evening pickup from 6 PM to 8 PM.'
        }
    };
    const res = createMockRes();

    await handler(req, res);

    assert.equal(res.statusCode, 200);
    assert.equal(res.body?.success, true);
    assert.equal(res.body?.noteUpdated, true);
    assert.equal(res.body?.movedOrders, 0);
    assert.deepEqual(noteUpdateParams, [
        'Evening pickup from 6 PM to 8 PM.',
        'pickup-date-1'
    ]);
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

test('admin status update to paid sends confirmation emails for updated orders', async () => {
    const updateCalls = [];
    const pool = {
        async query(sql, params) {
            const normalizedSql = normalizeSql(sql);
            if (normalizedSql.includes('SELECT id, status, pickup_date, pickup_location, items FROM orders WHERE id = $1 FOR UPDATE')) {
                return {
                    rows: [{
                        id: String(params[0]),
                        status: 'pending',
                        pickup_date: '2026-06-01',
                        pickup_location: 'hemmingford',
                        items: JSON.stringify([{ id: 1, quantity: 1 }])
                    }]
                };
            }
            if (normalizedSql.includes('UPDATE orders SET status = $1 WHERE id::text = ANY($2::text[])')) {
                updateCalls.push(params);
                return { rowCount: 2, rows: [] };
            }
            throw new Error(`Unexpected SQL: ${normalizedSql}`);
        }
    };

    const confirmationCalls = [];
    const handlers = registerRoutesForTest(pool, {
        sendOrderConfirmationEmail: async (orderId) => {
            confirmationCalls.push(String(orderId));
            return { sent: true };
        }
    });

    const handler = handlers['PUT /api/admin/orders/status'];
    assert.ok(handler);

    const req = {
        body: {
            ids: ['order-10', 'order-11'],
            status: 'paid'
        }
    };
    const res = createMockRes();

    await handler(req, res);

    assert.equal(res.statusCode, 200);
    assert.equal(res.body?.success, true);
    assert.deepEqual(updateCalls, [['paid', ['order-10', 'order-11']]]);
    assert.deepEqual(confirmationCalls, ['order-10', 'order-11']);
});

test('admin restoring archived orders to pending re-reserves stock first', async () => {
    const reserveCalls = [];
    let statusUpdateCall = null;
    const pool = {
        async query(sql, params) {
            const normalizedSql = normalizeSql(sql);
            if (normalizedSql.includes('SELECT id, status, pickup_date, pickup_location, items FROM orders WHERE id = $1 FOR UPDATE')) {
                assert.deepEqual(params, ['arch-1']);
                return {
                    rows: [{
                        id: 'arch-1',
                        status: 'archived',
                        pickup_date: '2026-06-15',
                        pickup_location: 'bristol',
                        items: JSON.stringify([
                            { id: 1, quantity: 3, name: 'Ready-to-Lay Hens / Poules Prêtes à Pondre' }
                        ])
                    }]
                };
            }
            if (
                normalizedSql.includes('FROM pickup_dates')
                && normalizedSql.includes('WHERE is_active = true')
                && normalizedSql.includes('date_value = $1')
            ) {
                assert.deepEqual(params, ['2026-06-15', 'bristol']);
                return { rows: [{ id: 'pickup-date-restore-1' }] };
            }
            if (
                normalizedSql.includes('UPDATE pickup_stock')
                && normalizedSql.includes('SET stock = stock - $1')
                && normalizedSql.includes('RETURNING stock')
            ) {
                reserveCalls.push(params);
                return { rowCount: 1, rows: [{ stock: 2 }] };
            }
            if (normalizedSql.includes('UPDATE orders SET status = $1 WHERE id = $2')) {
                statusUpdateCall = params;
                return { rowCount: 1, rows: [] };
            }
            throw new Error(`Unexpected SQL: ${normalizedSql}`);
        }
    };

    const handlers = registerRoutesForTest(pool);
    const handler = handlers['PUT /api/admin/orders/status'];
    assert.ok(handler);

    const req = {
        body: {
            ids: ['arch-1'],
            status: 'pending'
        }
    };
    const res = createMockRes();

    await handler(req, res);

    assert.equal(res.statusCode, 200);
    assert.equal(res.body?.success, true);
    assert.deepEqual(reserveCalls, [[3, 'pickup-date-restore-1', 1]]);
    assert.deepEqual(statusUpdateCall, ['pending', 'arch-1']);
});

test('admin restoring archived orders fails when stock is insufficient', async () => {
    let statusUpdateCalled = false;
    const pool = {
        async query(sql, params) {
            const normalizedSql = normalizeSql(sql);
            if (normalizedSql.includes('SELECT id, status, pickup_date, pickup_location, items FROM orders WHERE id = $1 FOR UPDATE')) {
                assert.deepEqual(params, ['arch-2']);
                return {
                    rows: [{
                        id: 'arch-2',
                        status: 'archived',
                        pickup_date: '2026-06-15',
                        pickup_location: 'bristol',
                        items: JSON.stringify([
                            { id: 1, quantity: 9, name: 'Ready-to-Lay Hens / Poules Prêtes à Pondre' }
                        ])
                    }]
                };
            }
            if (
                normalizedSql.includes('FROM pickup_dates')
                && normalizedSql.includes('WHERE is_active = true')
                && normalizedSql.includes('date_value = $1')
            ) {
                assert.deepEqual(params, ['2026-06-15', 'bristol']);
                return { rows: [{ id: 'pickup-date-restore-2' }] };
            }
            if (
                normalizedSql.includes('UPDATE pickup_stock')
                && normalizedSql.includes('SET stock = stock - $1')
                && normalizedSql.includes('RETURNING stock')
            ) {
                return { rowCount: 0, rows: [] };
            }
            if (
                normalizedSql.includes('UPDATE orders SET status = $1 WHERE id = $2')
                || normalizedSql.includes('UPDATE orders SET status = $1 WHERE id::text = ANY($2::text[])')
            ) {
                statusUpdateCalled = true;
                return { rowCount: 1, rows: [] };
            }
            throw new Error(`Unexpected SQL: ${normalizedSql}`);
        }
    };

    const handlers = registerRoutesForTest(pool);
    const handler = handlers['PUT /api/admin/orders/status'];
    assert.ok(handler);

    const req = {
        body: {
            ids: ['arch-2'],
            status: 'pending'
        }
    };
    const res = createMockRes();

    await handler(req, res);

    assert.equal(res.statusCode, 409);
    assert.equal(
        res.body?.error,
        'Cannot unarchive order due to insufficient stock for Ready-to-Lay Hens / Poules Prêtes à Pondre.'
    );
    assert.equal(statusUpdateCalled, false);
});

test('admin create paid manual order sends confirmation email', async () => {
    const pool = {
        async query(sql, params) {
            const normalizedSql = normalizeSql(sql);

            if (
                normalizedSql.includes('FROM pickup_dates')
                && normalizedSql.includes('WHERE is_active = true')
                && normalizedSql.includes('date_value = $1')
            ) {
                assert.deepEqual(params, ['2026-06-01', 'hemmingford']);
                return { rows: [{ id: 'pickup-date-1' }] };
            }
            if (
                normalizedSql.includes('SELECT id, name FROM hens')
                && normalizedSql.includes('WHERE is_active = true AND id = ANY($1::int[])')
            ) {
                assert.deepEqual(params, [[1]]);
                return {
                    rows: [{ id: 1, name: 'Ready-to-Lay Hens / Poules Prêtes à Pondre' }]
                };
            }
            if (normalizedSql.includes('SELECT hen_id, stock FROM pickup_stock')) {
                assert.deepEqual(params, ['pickup-date-1', [1]]);
                return {
                    rows: [{ hen_id: 1, stock: 10 }]
                };
            }
            if (normalizedSql.includes('INSERT INTO customers (name, phone, email, address)')) {
                assert.deepEqual(params, ['Alice', '5145551234', 'alice@example.com', '123 Farm Road']);
                return { rows: [{ id: 'customer-1' }] };
            }
            if (
                normalizedSql.includes('UPDATE pickup_stock')
                && normalizedSql.includes('SET stock = stock - $1')
                && normalizedSql.includes('RETURNING hen_id')
            ) {
                assert.deepEqual(params, [2, 'pickup-date-1', 1]);
                return { rowCount: 1, rows: [{ hen_id: 1 }] };
            }
            if (
                normalizedSql.includes('INSERT INTO orders')
                && normalizedSql.includes('RETURNING id, order_number')
            ) {
                assert.equal(params[0], 'customer-1');
                assert.equal(params[1], 'alice@example.com');
                assert.equal(params[2], 'Alice');
                assert.equal(params[3], '5145551234');
                assert.equal(params[4], '123 Farm Road');
                assert.equal(params[7], 'paid');
                assert.equal(params[8], '2026-06-01');
                assert.equal(params[9], 'hemmingford');
                assert.equal(params[13], 'en');
                assert.equal(params[14], 'etransfer');
                return { rows: [{ id: 'order-paid-1', order_number: 1001 }] };
            }
            throw new Error(`Unexpected SQL: ${normalizedSql}`);
        }
    };

    const confirmationCalls = [];
    const handlers = registerRoutesForTest(pool, {
        sendOrderConfirmationEmail: async (orderId) => {
            confirmationCalls.push(String(orderId));
            return { sent: true };
        }
    });
    const handler = handlers['POST /api/admin/orders'];
    assert.ok(handler);

    const req = {
        get() {
            return '';
        },
        body: {
            language: 'en',
            customer: {
                name: 'Alice',
                phone: '5145551234',
                email: 'alice@example.com',
                address: '123 Farm Road'
            },
            pickup: {
                date: '2026-06-01',
                location: 'hemmingford'
            },
            payment: {
                method: 'etransfer',
                payment_type: 'full'
            },
            items: [
                { id: 1, quantity: 2 }
            ]
        }
    };
    const res = createMockRes();

    await handler(req, res);

    assert.equal(res.statusCode, 200);
    assert.equal(res.body?.success, true);
    assert.equal(res.body?.orderId, 'order-paid-1');
    assert.deepEqual(confirmationCalls, ['order-paid-1']);
});

test('admin create pending manual order does not send confirmation email', async () => {
    const pool = {
        async query(sql, params) {
            const normalizedSql = normalizeSql(sql);

            if (
                normalizedSql.includes('FROM pickup_dates')
                && normalizedSql.includes('WHERE is_active = true')
                && normalizedSql.includes('date_value = $1')
            ) {
                assert.deepEqual(params, ['2026-06-01', 'hemmingford']);
                return { rows: [{ id: 'pickup-date-1' }] };
            }
            if (
                normalizedSql.includes('SELECT id, name FROM hens')
                && normalizedSql.includes('WHERE is_active = true AND id = ANY($1::int[])')
            ) {
                assert.deepEqual(params, [[1]]);
                return {
                    rows: [{ id: 1, name: 'Ready-to-Lay Hens / Poules Prêtes à Pondre' }]
                };
            }
            if (normalizedSql.includes('SELECT hen_id, stock FROM pickup_stock')) {
                assert.deepEqual(params, ['pickup-date-1', [1]]);
                return {
                    rows: [{ hen_id: 1, stock: 10 }]
                };
            }
            if (normalizedSql.includes('INSERT INTO customers (name, phone, email, address)')) {
                assert.deepEqual(params, ['Alice', '5145551234', 'alice@example.com', '123 Farm Road']);
                return { rows: [{ id: 'customer-1' }] };
            }
            if (
                normalizedSql.includes('UPDATE pickup_stock')
                && normalizedSql.includes('SET stock = stock - $1')
                && normalizedSql.includes('RETURNING hen_id')
            ) {
                assert.deepEqual(params, [1, 'pickup-date-1', 1]);
                return { rowCount: 1, rows: [{ hen_id: 1 }] };
            }
            if (
                normalizedSql.includes('INSERT INTO orders')
                && normalizedSql.includes('RETURNING id, order_number')
            ) {
                assert.equal(params[0], 'customer-1');
                assert.equal(params[1], 'alice@example.com');
                assert.equal(params[2], 'Alice');
                assert.equal(params[3], '5145551234');
                assert.equal(params[4], '123 Farm Road');
                assert.equal(params[7], 'pending');
                assert.equal(params[10], 'deposit');
                assert.equal(params[11], 0);
                assert.equal(params[13], 'en');
                assert.equal(params[14], 'etransfer');
                return { rows: [{ id: 'order-pending-1', order_number: 1002 }] };
            }
            throw new Error(`Unexpected SQL: ${normalizedSql}`);
        }
    };

    const confirmationCalls = [];
    const handlers = registerRoutesForTest(pool, {
        sendOrderConfirmationEmail: async (orderId) => {
            confirmationCalls.push(String(orderId));
            return { sent: true };
        }
    });
    const handler = handlers['POST /api/admin/orders'];
    assert.ok(handler);

    const req = {
        get() {
            return '';
        },
        body: {
            language: 'en',
            customer: {
                name: 'Alice',
                phone: '5145551234',
                email: 'alice@example.com',
                address: '123 Farm Road'
            },
            pickup: {
                date: '2026-06-01',
                location: 'hemmingford'
            },
            payment: {
                method: 'etransfer',
                payment_type: 'deposit',
                amount_paid_cents: 0
            },
            items: [
                { id: 1, quantity: 1 }
            ]
        }
    };
    const res = createMockRes();

    await handler(req, res);

    assert.equal(res.statusCode, 200);
    assert.equal(res.body?.success, true);
    assert.equal(res.body?.orderId, 'order-pending-1');
    assert.deepEqual(confirmationCalls, []);
});

test('admin order update changes pickup date/amount and allows paid/email updates', async () => {
    let pickupDateLookupCount = 0;
    let ordersUpdatedParams = null;
    let customerUpdatedParams = null;

    const pool = {
        async query(sql, params) {
            const normalizedSql = normalizeSql(sql);

            if (normalizedSql.includes('FROM orders') && normalizedSql.includes('FOR UPDATE')) {
                assert.deepEqual(params, ['order-1']);
                return {
                    rows: [
                        {
                            id: 'order-1',
                            customer_id: 'customer-1',
                            customer_email: 'old@example.com',
                            status: 'paid',
                            pickup_date: '2026-06-01',
                            pickup_location: 'hemmingford',
                            items: JSON.stringify([{ id: 1, quantity: 2, name: 'Ready-to-Lay Hens / Poules Prêtes à Pondre' }]),
                            total_cents: 7300,
                            amount_paid_cents: 3000,
                            amount_due_cents: 4300,
                            payment_type: 'deposit'
                        }
                    ]
                };
            }

            if (
                normalizedSql.includes('FROM pickup_dates')
                && normalizedSql.includes('WHERE is_active = true')
                && normalizedSql.includes('date_value = $1')
            ) {
                pickupDateLookupCount += 1;
                assert.deepEqual(params, ['2026-06-01', 'hemmingford']);
                return { rows: [{ id: 'pickup-date-1' }] };
            }

            if (
                normalizedSql.includes('UPDATE orders')
                && normalizedSql.includes('SET')
                && normalizedSql.includes('amount_due_cents = $7')
                && normalizedSql.includes('items = CASE WHEN $8::boolean THEN $9 ELSE items END')
                && normalizedSql.includes('customer_email = CASE WHEN $10::boolean THEN $11::text ELSE customer_email END')
                && normalizedSql.includes('WHERE id = $12')
            ) {
                ordersUpdatedParams = params;
                return { rowCount: 1, rows: [] };
            }
            throw new Error(`Unexpected SQL: ${normalizedSql}`);
        }
    };

    const confirmationCalls = [];
    const handlers = registerRoutesForTest(pool, {
        sendOrderConfirmationEmail: async (orderId) => {
            confirmationCalls.push(String(orderId));
            return { sent: true };
        }
    });
    const handler = handlers['PUT /api/admin/orders/:id'];
    assert.ok(handler);

    const req = {
        params: { id: 'order-1' },
        body: {
            pickup: {
                date: '2026-06-01',
                location: 'hemmingford'
            },
            payment: {
                amount_paid_cents: 4500
            },
            customer: {
                email: 'new@example.com'
            },
            order: {
                total_cents: 9000
            }
        }
    };
    const res = createMockRes();

    await handler(req, res);

    assert.equal(res.statusCode, 200);
    assert.equal(res.body?.success, true);
    assert.equal(res.body?.orderId, 'order-1');
    assert.equal(res.body?.total_cents, 9000);
    assert.equal(res.body?.amount_paid_cents, 4500);
    assert.equal(res.body?.amount_due_cents, 4500);
    assert.equal(res.body?.payment_type, 'deposit');
    assert.equal(res.body?.status, 'paid');
    assert.equal(res.body?.customer_email, 'new@example.com');
    assert.equal(pickupDateLookupCount, 1);
    assert.deepEqual(ordersUpdatedParams, [
        9000,
        'paid',
        '2026-06-01',
        'hemmingford',
        'deposit',
        4500,
        4500,
        false,
        null,
        true,
        'new@example.com',
        'order-1'
    ]);
    assert.equal(customerUpdatedParams, null);
    assert.deepEqual(confirmationCalls, ['order-1']);
});

test('admin order update can change item type/qty and applies same-pickup stock deltas', async () => {
    let pickupDateLookupCount = 0;
    let orderUpdateParams = null;
    let stockReserveSelectParams = null;
    let stockReserveUpdateParams = null;
    let stockReleaseParams = null;

    const pool = {
        async query(sql, params) {
            const normalizedSql = normalizeSql(sql);

            if (normalizedSql.includes('FROM orders') && normalizedSql.includes('FOR UPDATE')) {
                assert.deepEqual(params, ['order-items-1']);
                return {
                    rows: [{
                        id: 'order-items-1',
                        customer_id: 'customer-1',
                        customer_email: 'old@example.com',
                        status: 'paid',
                        pickup_date: '2026-06-01',
                        pickup_location: 'hemmingford',
                        items: JSON.stringify([
                            { id: 1, quantity: 2, name: 'Ready-to-Lay Hens / Poules Prêtes à Pondre' }
                        ]),
                        total_cents: 7300,
                        amount_paid_cents: 3000,
                        amount_due_cents: 4300,
                        payment_type: 'deposit'
                    }]
                };
            }

            if (
                normalizedSql.includes('FROM pickup_dates')
                && normalizedSql.includes('WHERE is_active = true')
                && normalizedSql.includes('date_value = $1')
            ) {
                pickupDateLookupCount += 1;
                assert.deepEqual(params, ['2026-06-01', 'hemmingford']);
                return { rows: [{ id: 'pickup-date-1' }] };
            }

            if (
                normalizedSql.includes('SELECT id, name, is_active FROM hens')
                && normalizedSql.includes('WHERE id = ANY($1::int[])')
            ) {
                assert.deepEqual(params, [[1, 2]]);
                return {
                    rows: [
                        { id: 1, name: 'Ready-to-Lay Hens / Poules Prêtes à Pondre', is_active: true },
                        { id: 2, name: 'Meat Chickens / Poulets de chair', is_active: true }
                    ]
                };
            }

            if (normalizedSql.includes('SELECT hen_id, stock FROM pickup_stock')) {
                stockReserveSelectParams = params;
                return {
                    rows: [{ hen_id: 2, stock: 50 }]
                };
            }

            if (
                normalizedSql.includes('UPDATE pickup_stock')
                && normalizedSql.includes('SET stock = stock - $1')
            ) {
                stockReserveUpdateParams = params;
                return { rowCount: 1, rows: [{ stock: 5 }] };
            }

            if (
                normalizedSql.includes('INSERT INTO pickup_stock (pickup_date_id, hen_id, stock)')
                && normalizedSql.includes('ON CONFLICT (pickup_date_id, hen_id)')
            ) {
                stockReleaseParams = params;
                return { rowCount: 1, rows: [] };
            }

            if (
                normalizedSql.includes('UPDATE orders')
                && normalizedSql.includes('items = CASE WHEN $8::boolean THEN $9 ELSE items END')
                && normalizedSql.includes('WHERE id = $12')
            ) {
                orderUpdateParams = params;
                return { rowCount: 1, rows: [] };
            }

            throw new Error(`Unexpected SQL: ${normalizedSql}`);
        }
    };

    const handlers = registerRoutesForTest(pool);
    const handler = handlers['PUT /api/admin/orders/:id'];
    assert.ok(handler);

    const req = {
        params: { id: 'order-items-1' },
        body: {
            pickup: {
                date: '2026-06-01',
                location: 'hemmingford'
            },
            items: [
                { id: 1, quantity: 1 },
                { id: 2, quantity: 25 }
            ],
            payment: {
                amount_paid_cents: 3000
            },
            order: {
                total_cents: 12000
            }
        }
    };
    const res = createMockRes();

    await handler(req, res);

    assert.equal(res.statusCode, 200);
    assert.equal(res.body?.success, true);
    assert.equal(res.body?.orderId, 'order-items-1');
    assert.equal(res.body?.total_cents, 12000);
    assert.equal(res.body?.amount_paid_cents, 3000);
    assert.equal(res.body?.amount_due_cents, 9000);
    assert.equal(res.body?.payment_type, 'deposit');
    assert.equal(res.body?.status, 'paid');

    assert.equal(pickupDateLookupCount, 2);
    assert.deepEqual(stockReserveSelectParams, ['pickup-date-1', [2]]);
    assert.deepEqual(stockReserveUpdateParams, [25, 'pickup-date-1', 2]);
    assert.deepEqual(stockReleaseParams, ['pickup-date-1', 1, 1]);
    assert.ok(Array.isArray(orderUpdateParams));
    assert.equal(orderUpdateParams[0], 12000);
    assert.equal(orderUpdateParams[1], 'paid');
    assert.equal(orderUpdateParams[7], true);
    assert.equal(typeof orderUpdateParams[8], 'string');
    assert.equal(orderUpdateParams[11], 'order-items-1');

    const updatedItems = JSON.parse(orderUpdateParams[8]);
    assert.equal(Array.isArray(updatedItems), true);
    assert.equal(updatedItems.length, 2);
    assert.deepEqual(
        updatedItems.map((item) => ({ id: item.id, quantity: item.quantity })),
        [
            { id: 1, quantity: 1 },
            { id: 2, quantity: 25 }
        ]
    );
    assert.equal(updatedItems.every((item) => Number(item.unit_cents) > 0), true);
    assert.equal(updatedItems.every((item) => Number(item.line_cents) > 0), true);
});

test('admin order update blocks edits for reserved Stripe orders', async () => {
    const pool = {
        async query(sql, params) {
            const normalizedSql = normalizeSql(sql);
            if (normalizedSql.includes('FROM orders') && normalizedSql.includes('FOR UPDATE')) {
                assert.deepEqual(params, ['order-reserved']);
                return {
                    rows: [{
                        id: 'order-reserved',
                        status: 'reserved',
                        pickup_date: '2026-06-01',
                        pickup_location: 'hemmingford',
                        items: JSON.stringify([{ id: 1, quantity: 2 }]),
                        payment_method: 'credit_card'
                    }]
                };
            }
            throw new Error(`Unexpected SQL: ${normalizedSql}`);
        }
    };

    const handlers = registerRoutesForTest(pool);
    const handler = handlers['PUT /api/admin/orders/:id'];
    assert.ok(handler);

    const req = {
        params: { id: 'order-reserved' },
        body: {
            pickup: {
                date: '2026-06-01',
                location: 'hemmingford'
            },
            order: {
                total_cents: 3000
            }
        }
    };
    const res = createMockRes();

    await handler(req, res);

    assert.equal(res.statusCode, 400);
    assert.equal(
        res.body?.error,
        'This order is awaiting Stripe payment and cannot be edited.'
    );
});

test('admin order update rejects totals below already-paid amount', async () => {
    let updateCalled = false;
    const pool = {
        async query(sql, params) {
            const normalizedSql = normalizeSql(sql);
            if (normalizedSql.includes('FROM orders') && normalizedSql.includes('FOR UPDATE')) {
                assert.deepEqual(params, ['order-overpay']);
                return {
                    rows: [{
                        id: 'order-overpay',
                        status: 'pending',
                        pickup_date: '2026-06-01',
                        pickup_location: 'hemmingford',
                        items: JSON.stringify([{ id: 1, quantity: 1 }]),
                        total_cents: 3000,
                        amount_paid_cents: 2500,
                        amount_due_cents: 500,
                        payment_type: 'deposit'
                    }]
                };
            }
            if (
                normalizedSql.includes('FROM pickup_dates')
                && normalizedSql.includes('WHERE is_active = true')
            ) {
                return { rows: [{ id: 'pickup-date-1' }] };
            }
            if (normalizedSql.includes('UPDATE orders')) {
                updateCalled = true;
                return { rowCount: 1, rows: [] };
            }
            throw new Error(`Unexpected SQL: ${normalizedSql}`);
        }
    };

    const handlers = registerRoutesForTest(pool);
    const handler = handlers['PUT /api/admin/orders/:id'];
    assert.ok(handler);

    const req = {
        params: { id: 'order-overpay' },
        body: {
            pickup: {
                date: '2026-06-01',
                location: 'hemmingford'
            },
            order: {
                total_cents: 1800
            }
        }
    };
    const res = createMockRes();

    await handler(req, res);

    assert.equal(res.statusCode, 400);
    assert.equal(
        res.body?.error,
        'Order total ($18.00) cannot be less than amount already paid ($25.00). Short by $7.00.'
    );
    assert.equal(updateCalled, false);
});

test('admin order update blocks reducing already-recorded paid amount', async () => {
    let updateCalled = false;
    const pool = {
        async query(sql, params) {
            const normalizedSql = normalizeSql(sql);
            if (normalizedSql.includes('FROM orders') && normalizedSql.includes('FOR UPDATE')) {
                assert.deepEqual(params, ['order-paid-reduction']);
                return {
                    rows: [{
                        id: 'order-paid-reduction',
                        status: 'paid',
                        pickup_date: '2026-06-01',
                        pickup_location: 'hemmingford',
                        items: JSON.stringify([{ id: 1, quantity: 1 }]),
                        total_cents: 5000,
                        amount_paid_cents: 3000,
                        amount_due_cents: 2000,
                        payment_type: 'deposit'
                    }]
                };
            }
            if (
                normalizedSql.includes('FROM pickup_dates')
                && normalizedSql.includes('WHERE is_active = true')
            ) {
                return { rows: [{ id: 'pickup-date-1' }] };
            }
            if (normalizedSql.includes('UPDATE orders')) {
                updateCalled = true;
                return { rowCount: 1, rows: [] };
            }
            throw new Error(`Unexpected SQL: ${normalizedSql}`);
        }
    };

    const handlers = registerRoutesForTest(pool);
    const handler = handlers['PUT /api/admin/orders/:id'];
    assert.ok(handler);

    const req = {
        params: { id: 'order-paid-reduction' },
        body: {
            pickup: {
                date: '2026-06-01',
                location: 'hemmingford'
            },
            payment: {
                amount_paid_cents: 2000
            },
            order: {
                total_cents: 5000
            }
        }
    };
    const res = createMockRes();

    await handler(req, res);

    assert.equal(res.statusCode, 400);
    assert.equal(
        res.body?.error,
        'Amount paid cannot be reduced below the already recorded amount ($30.00). Reduction requested: $10.00.'
    );
    assert.equal(updateCalled, false);
});

test('admin order update returns stock conflict details when target pickup lacks inventory', async () => {
    const pool = {
        async query(sql, params) {
            const normalizedSql = normalizeSql(sql);
            if (normalizedSql.includes('FROM orders') && normalizedSql.includes('FOR UPDATE')) {
                return {
                    rows: [{
                        id: 'order-stock-conflict',
                        status: 'paid',
                        pickup_date: '2026-06-01',
                        pickup_location: 'hemmingford',
                        items: JSON.stringify([{ id: 1, quantity: 3, name: 'Ready-to-Lay Hens / Poules Prêtes à Pondre' }]),
                        total_cents: 7300,
                        amount_paid_cents: 3000,
                        amount_due_cents: 4300,
                        payment_type: 'deposit'
                    }]
                };
            }
            if (
                normalizedSql.includes('FROM pickup_dates')
                && normalizedSql.includes('WHERE is_active = true')
                && normalizedSql.includes('date_value = $1')
            ) {
                if (params[0] === '2026-06-08') {
                    return { rows: [{ id: 'pickup-date-target' }] };
                }
                return { rows: [{ id: 'pickup-date-source' }] };
            }
            if (normalizedSql.includes('SELECT hen_id, stock FROM pickup_stock')) {
                assert.deepEqual(params, ['pickup-date-target', [1]]);
                return {
                    rows: [{ hen_id: 1, stock: 1 }]
                };
            }
            throw new Error(`Unexpected SQL: ${normalizedSql}`);
        }
    };

    const handlers = registerRoutesForTest(pool);
    const handler = handlers['PUT /api/admin/orders/:id'];
    assert.ok(handler);

    const req = {
        params: { id: 'order-stock-conflict' },
        body: {
            pickup: {
                date: '2026-06-08',
                location: 'bristol'
            },
            order: {
                total_cents: 9000
            }
        }
    };
    const res = createMockRes();

    await handler(req, res);

    assert.equal(res.statusCode, 409);
    assert.equal(
        res.body?.error,
        'Insufficient stock for Ready-to-Lay Hens / Poules Prêtes à Pondre on 2026-06-08 (Bristol). Need 3, available 1.'
    );
});

test('admin order delete endpoint archives pending order and releases stock', async () => {
    let archiveParams = null;
    const releasedStockParams = [];

    const pool = {
        async query(sql, params) {
            const normalizedSql = normalizeSql(sql);
            if (normalizedSql.includes('FROM orders') && normalizedSql.includes('FOR UPDATE')) {
                assert.deepEqual(params, ['order-delete-1']);
                return {
                    rows: [{
                        id: 'order-delete-1',
                        order_number: 42,
                        status: 'pending',
                        pickup_date: '2026-06-01',
                        pickup_location: 'hemmingford',
                        items: JSON.stringify([
                            { id: 1, quantity: 2, name: 'Ready-to-Lay Hens / Poules Prêtes à Pondre' }
                        ])
                    }]
                };
            }
            if (
                normalizedSql.includes('FROM pickup_dates')
                && normalizedSql.includes('WHERE is_active = true')
                && normalizedSql.includes('date_value = $1')
            ) {
                assert.deepEqual(params, ['2026-06-01', 'hemmingford']);
                return { rows: [{ id: 'pickup-date-1' }] };
            }
            if (
                normalizedSql.includes('INSERT INTO pickup_stock (pickup_date_id, hen_id, stock)')
                && normalizedSql.includes('ON CONFLICT (pickup_date_id, hen_id)')
            ) {
                releasedStockParams.push(params);
                return { rowCount: 1, rows: [] };
            }
            if (normalizedSql.includes('UPDATE orders SET status = $1 WHERE id = $2')) {
                archiveParams = params;
                return { rowCount: 1, rows: [] };
            }
            throw new Error(`Unexpected SQL: ${normalizedSql}`);
        }
    };

    const handlers = registerRoutesForTest(pool);
    const handler = handlers['DELETE /api/admin/orders/:id'];
    assert.ok(handler);

    const req = { params: { id: 'order-delete-1' } };
    const res = createMockRes();

    await handler(req, res);

    assert.equal(res.statusCode, 200);
    assert.equal(res.body?.success, true);
    assert.equal(res.body?.orderId, 'order-delete-1');
    assert.equal(res.body?.status, 'archived');
    assert.equal(res.body?.orderNumber, 42);
    assert.deepEqual(releasedStockParams, [['pickup-date-1', 1, 2]]);
    assert.deepEqual(archiveParams, ['archived', 'order-delete-1']);
});

test('admin order delete blocks picked-up orders', async () => {
    let deleteCalled = false;
    const pool = {
        async query(sql, params) {
            const normalizedSql = normalizeSql(sql);
            if (normalizedSql.includes('FROM orders') && normalizedSql.includes('FOR UPDATE')) {
                assert.deepEqual(params, ['order-picked-up']);
                return {
                    rows: [{
                        id: 'order-picked-up',
                        status: 'picked_up',
                        pickup_date: '2026-06-01',
                        pickup_location: 'hemmingford',
                        items: JSON.stringify([{ id: 1, quantity: 1 }])
                    }]
                };
            }
            if (normalizedSql.includes('UPDATE orders SET status = $1 WHERE id = $2')) {
                deleteCalled = true;
                return { rowCount: 1, rows: [] };
            }
            throw new Error(`Unexpected SQL: ${normalizedSql}`);
        }
    };

    const handlers = registerRoutesForTest(pool);
    const handler = handlers['DELETE /api/admin/orders/:id'];
    assert.ok(handler);

    const req = { params: { id: 'order-picked-up' } };
    const res = createMockRes();

    await handler(req, res);

    assert.equal(res.statusCode, 400);
    assert.equal(res.body?.error, 'Picked-up orders cannot be archived.');
    assert.equal(deleteCalled, false);
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

test('admin email route rejects pickup reminders with unresolved time placeholders', async () => {
    const pool = {
        async query(sql) {
            throw new Error(`Unexpected SQL: ${normalizeSql(sql)}`);
        }
    };

    let sendAttempted = false;
    const handlers = registerRoutesForTest(pool, {
        sendTrackedEmailMessage: async () => {
            sendAttempted = true;
            return { success: true, email: 'customer@example.com', status: 'sent' };
        }
    });
    const handler = handlers['POST /api/admin/email'];
    assert.ok(handler);

    const req = {
        body: {
            messages: [
                {
                    to: { email: 'customer@example.com', name: 'Customer Name' },
                    subject: 'Pickup reminder',
                    text: 'Reminder from {time} to {time}.',
                    emailType: 'pickup_reminder'
                }
            ]
        }
    };
    const res = createMockRes();

    await handler(req, res);

    assert.equal(res.statusCode, 400);
    assert.match(res.body?.error, /Replace the pickup times/);
    assert.equal(sendAttempted, false);
});

test('admin email route reports invalid, blocked, and provider-rejected recipients', async () => {
    const pool = {
        async query(sql) {
            throw new Error(`Unexpected SQL: ${normalizeSql(sql)}`);
        }
    };

    const sentMessages = [];
    const handlers = registerRoutesForTest(pool, {
        verifyCheckoutEmail: async (email) => {
            if (email === 'blocked@example.com') {
                return {
                    accepted: false,
                    shouldBlock: true,
                    message: 'Mailbox does not exist.'
                };
            }
            return {
                accepted: true,
                shouldBlock: false
            };
        },
        sendEmailMessage: async (payload) => {
            sentMessages.push(payload);
            if (payload?.to?.email === 'rejected@example.com') {
                throw new Error('Email send failed: {"message":"Recipient rejected by provider."}');
            }
        }
    });
    const handler = handlers['POST /api/admin/email'];
    assert.ok(handler);

    const req = {
        body: {
            messages: [
                {
                    to: { email: 'not-an-email', name: 'Broken Address' },
                    subject: 'Pickup reminder',
                    text: 'Reminder'
                },
                {
                    to: { email: 'blocked@example.com', name: 'Blocked Mailbox' },
                    subject: 'Pickup reminder',
                    text: 'Reminder'
                },
                {
                    to: { email: 'rejected@example.com', name: 'Rejected By Provider' },
                    subject: 'Pickup reminder',
                    text: 'Reminder'
                },
                {
                    to: { email: 'ok@example.com', name: 'Delivered' },
                    subject: 'Pickup reminder',
                    text: 'Reminder'
                }
            ]
        }
    };
    const res = createMockRes();

    await handler(req, res);

    assert.equal(res.statusCode, 200);
    assert.equal(res.body?.success, false);
    assert.equal(res.body?.attempted, 4);
    assert.equal(res.body?.sent, 1);
    assert.equal(res.body?.failed, 3);
    assert.ok(res.body?.completedAt);
    assert.equal(sentMessages.length, 2);

    const failedByEmail = new Map(
        (Array.isArray(res.body?.failedRecipients) ? res.body.failedRecipients : [])
            .map((recipient) => [recipient.email, recipient])
    );

    assert.equal(failedByEmail.get('not-an-email')?.reason, 'Invalid email address.');
    assert.equal(failedByEmail.get('blocked@example.com')?.reason, 'Mailbox does not exist.');
    assert.equal(failedByEmail.get('rejected@example.com')?.reason, 'Recipient rejected by provider.');
});

test('admin email preview summarizes warnings, blocks, suppressions, and duplicates', async () => {
    const pool = {
        async query(sql) {
            throw new Error(`Unexpected SQL: ${normalizeSql(sql)}`);
        }
    };

    const handlers = registerRoutesForTest(pool, {
        previewTrackedEmailMessage: async ({ message }) => {
            const email = String(message?.to?.email || '').trim().toLowerCase();
            if (email === 'warning@example.com') {
                return {
                    email,
                    status: 'warning',
                    reason: 'Domain accepts all mailboxes.'
                };
            }
            if (email === 'blocked@example.com') {
                return {
                    email,
                    status: 'blocked',
                    reason: 'Mailbox does not exist.'
                };
            }
            if (email === 'suppressed@example.com') {
                return {
                    email,
                    status: 'suppressed',
                    reason: 'Previous send bounced.'
                };
            }
            return {
                email,
                status: 'ready'
            };
        }
    });
    const handler = handlers['POST /api/admin/email/preview'];
    assert.ok(handler);

    const req = {
        body: {
            messages: [
                { to: { email: 'ready@example.com' }, subject: 'Test', text: 'Hello' },
                { to: { email: 'warning@example.com' }, subject: 'Test', text: 'Hello' },
                { to: { email: 'blocked@example.com' }, subject: 'Test', text: 'Hello' },
                { to: { email: 'suppressed@example.com' }, subject: 'Test', text: 'Hello' },
                { to: { email: 'ready@example.com' }, subject: 'Test', text: 'Hello again' }
            ]
        }
    };
    const res = createMockRes();

    await handler(req, res);

    assert.equal(res.statusCode, 200);
    assert.equal(res.body?.success, true);
    assert.equal(res.body?.total, 5);
    assert.deepEqual(res.body?.counts, {
        ready: 1,
        warning: 1,
        blocked: 1,
        suppressed: 1,
        duplicate: 1
    });
});

test('admin email preview keeps working when one recipient verification throws', async () => {
    const pool = {
        async query(sql) {
            throw new Error(`Unexpected SQL: ${normalizeSql(sql)}`);
        }
    };

    const handlers = registerRoutesForTest(pool, {
        previewTrackedEmailMessage: async ({ message }) => {
            const email = String(message?.to?.email || '').trim().toLowerCase();
            if (email === 'slow-api@example.com') {
                throw new Error('Verification provider timed out.');
            }
            return {
                email,
                status: 'ready'
            };
        }
    });
    const handler = handlers['POST /api/admin/email/preview'];
    assert.ok(handler);

    const req = {
        requestId: 'req-preview-timeout',
        body: {
            messages: [
                { to: { email: 'ready@example.com' }, subject: 'Test', text: 'Hello' },
                { to: { email: 'slow-api@example.com' }, subject: 'Test', text: 'Hello' }
            ]
        }
    };
    const res = createMockRes();

    await handler(req, res);

    assert.equal(res.statusCode, 200);
    assert.equal(res.body?.success, true);
    assert.deepEqual(res.body?.counts, {
        ready: 1,
        warning: 1,
        blocked: 0,
        suppressed: 0,
        duplicate: 0
    });
    const warning = res.body?.recipients?.find((recipient) => recipient.email === 'slow-api@example.com');
    assert.equal(warning?.status, 'warning');
    assert.match(warning?.reason, /Verification provider timed out/);
});

test('admin resend confirmation route forces tracked resend', async () => {
    const pool = {
        async query(sql) {
            throw new Error(`Unexpected SQL: ${normalizeSql(sql)}`);
        }
    };
    let resendCall = null;
    const handlers = registerRoutesForTest(pool, {
        sendOrderConfirmationEmail: async (orderId, options) => {
            resendCall = { orderId, options };
            return {
                sent: true,
                emailMessageId: 'email-message-1',
                providerEmailId: 'provider-email-1'
            };
        }
    });
    const handler = handlers['POST /api/admin/orders/:id/resend-confirmation'];
    assert.ok(handler);

    const req = {
        params: { id: 'order-123' }
    };
    const res = createMockRes();

    await handler(req, res);

    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.body, {
        success: true,
        orderId: 'order-123',
        emailMessageId: 'email-message-1',
        providerEmailId: 'provider-email-1'
    });
    assert.deepEqual(resendCall, {
        orderId: 'order-123',
        options: {
            force: true,
            initiatedBy: 'admin'
        }
    });
});

test('admin pickup stock update records inventory and admin audit entries', async () => {
    const pool = {
        async query(sql, params) {
            const normalizedSql = normalizeSql(sql);
            if (
                normalizedSql.includes('FROM pickup_dates')
                && normalizedSql.includes('WHERE is_active = true')
                && normalizedSql.includes('date_value = $1')
            ) {
                assert.deepEqual(params, ['2026-06-01', 'hemmingford']);
                return { rows: [{ id: 'pickup-date-1' }] };
            }
            if (
                normalizedSql.includes('SELECT hen_id, stock')
                && normalizedSql.includes('FROM pickup_stock')
                && normalizedSql.includes('hen_id = ANY($2::int[])')
            ) {
                assert.deepEqual(params, ['pickup-date-1', [1, 2]]);
                return {
                    rows: [
                        { hen_id: 1, stock: 5 },
                        { hen_id: 2, stock: 3 }
                    ]
                };
            }
            if (
                normalizedSql.includes('INSERT INTO pickup_stock')
                && normalizedSql.includes('DO UPDATE SET stock = EXCLUDED.stock')
            ) {
                assert.deepEqual(params, ['pickup-date-1', [1, 2], [7, 1]]);
                return { rowCount: 2, rows: [] };
            }
            throw new Error(`Unexpected SQL: ${normalizedSql}`);
        }
    };

    const inventoryCalls = [];
    const adminActions = [];
    const handlers = registerRoutesForTest(pool, {
        recordInventoryEvents: async (_executor, events) => {
            inventoryCalls.push(events);
            return ['inv-1', 'inv-2'];
        },
        recordAdminAction: async (_executor, payload) => {
            adminActions.push(payload);
            return 'admin-action-1';
        }
    });
    const handler = handlers['PUT /api/admin/pickup-stock'];
    assert.ok(handler);

    const req = {
        adminSession: { sub: 'operator-1' },
        requestId: 'req-stock-1',
        headers: { 'user-agent': 'node-test' },
        body: {
            date: '2026-06-01',
            location: 'hemmingford',
            items: [
                { hen_id: 1, stock: 7 },
                { hen_id: 2, stock: 1 }
            ]
        }
    };
    const res = createMockRes();

    await handler(req, res);

    assert.equal(res.statusCode, 200);
    assert.deepEqual(inventoryCalls, [[
        {
            pickupDate: '2026-06-01',
            location: 'hemmingford',
            itemId: 1,
            delta: 2,
            reason: 'admin_pickup_stock_edit',
            actor: 'operator-1',
            requestId: 'req-stock-1'
        },
        {
            pickupDate: '2026-06-01',
            location: 'hemmingford',
            itemId: 2,
            delta: -2,
            reason: 'admin_pickup_stock_edit',
            actor: 'operator-1',
            requestId: 'req-stock-1'
        }
    ]]);
    assert.equal(adminActions.length, 1);
    assert.equal(adminActions[0]?.actionType, 'pickup_stock_edit');
    assert.equal(adminActions[0]?.targetId, '2026-06-01::hemmingford');
    assert.deepEqual(adminActions[0]?.after?.items, [
        { item_id: 1, stock: 7 },
        { item_id: 2, stock: 1 }
    ]);
});

test('admin bulk email send records batch and admin audit metadata', async () => {
    const pool = {
        async query(sql) {
            throw new Error(`Unexpected SQL: ${normalizeSql(sql)}`);
        }
    };

    const startedBatches = [];
    const finalizedBatches = [];
    const adminActions = [];
    const sentMessages = [];
    const handlers = registerRoutesForTest(pool, {
        startBatchRun: async (_executor, payload) => {
            startedBatches.push(payload);
            return 'batch-1';
        },
        finalizeBatchRun: async (_executor, batchRunId, payload) => {
            finalizedBatches.push({ batchRunId, payload });
            return batchRunId;
        },
        recordAdminAction: async (_executor, payload) => {
            adminActions.push(payload);
            return 'admin-action-1';
        },
        sendTrackedEmailMessage: async ({ message }) => {
            sentMessages.push(message);
            return {
                success: true,
                email: String(message?.to?.email || '').trim().toLowerCase(),
                name: String(message?.to?.name || '').trim() || undefined,
                status: 'sent',
                emailMessageId: `email-${sentMessages.length}`,
                providerEmailId: `provider-${sentMessages.length}`
            };
        }
    });
    const handler = handlers['POST /api/admin/email'];
    assert.ok(handler);

    const req = {
        adminSession: { sub: 'operator-2' },
        requestId: 'req-email-1',
        headers: { 'user-agent': 'node-test' },
        body: {
            messages: [
                {
                    to: { email: 'first@example.com', name: 'First' },
                    subject: 'Pickup reminder',
                    text: 'Reminder one',
                    emailType: 'pickup_reminder'
                },
                {
                    to: { email: 'second@example.com', name: 'Second' },
                    subject: 'Pickup reminder',
                    text: 'Reminder two',
                    emailType: 'pickup_reminder'
                }
            ]
        }
    };
    const res = createMockRes();

    await handler(req, res);

    assert.equal(res.statusCode, 200);
    assert.equal(sentMessages.length, 2);
    assert.equal(sentMessages.every((message) => message.batchRunId === 'batch-1'), true);
    assert.equal(sentMessages.every((message) => message.requestId === 'req-email-1'), true);
    assert.deepEqual(startedBatches, [{
        batchType: 'pickup_reminder_batch',
        scope: {
            email_types: ['pickup_reminder'],
            subjects: ['Pickup reminder'],
            total_messages: 2
        },
        expectedCount: 2,
        initiatedBy: 'operator-2',
        requestId: 'req-email-1'
    }]);
    assert.deepEqual(finalizedBatches, [{
        batchRunId: 'batch-1',
        payload: {
            attemptedCount: 2,
            succeededCount: 2,
            failedCount: 0,
            initiatedBy: 'operator-2',
            requestId: 'req-email-1',
            scope: {
                email_types: ['pickup_reminder'],
                subjects: ['Pickup reminder'],
                counts: {
                    sent: 2,
                    warning: 0,
                    blocked: 0,
                    suppressed: 0,
                    failed: 0,
                    duplicate: 0
                }
            }
        }
    }]);
    assert.equal(adminActions.length, 1);
    assert.equal(adminActions[0]?.actionType, 'bulk_email_send');
    assert.equal(adminActions[0]?.targetId, 'batch-1');
    assert.deepEqual(adminActions[0]?.after?.counts, {
        sent: 2,
        warning: 0,
        blocked: 0,
        suppressed: 0,
        failed: 0,
        duplicate: 0
    });
});

test('admin bulk email send converts thrown worker errors into recipient failures', async () => {
    const pool = {
        async query(sql) {
            throw new Error(`Unexpected SQL: ${normalizeSql(sql)}`);
        }
    };

    const handlers = registerRoutesForTest(pool, {
        startBatchRun: async () => 'batch-throw',
        finalizeBatchRun: async () => 'batch-throw',
        recordAdminAction: async () => 'admin-action-throw',
        sendTrackedEmailMessage: async ({ message }) => {
            if (message?.to?.email === 'boom@example.com') {
                throw new Error('Email send failed: {"message":"Provider connection reset."}');
            }
            return {
                success: true,
                email: String(message?.to?.email || '').trim().toLowerCase(),
                name: String(message?.to?.name || '').trim() || undefined,
                status: 'sent',
                emailMessageId: 'email-ok',
                providerEmailId: 'provider-ok'
            };
        }
    });
    const handler = handlers['POST /api/admin/email'];
    assert.ok(handler);

    const req = {
        adminSession: { sub: 'operator-3' },
        requestId: 'req-email-throw',
        headers: { 'user-agent': 'node-test' },
        body: {
            messages: [
                {
                    to: { email: 'ok@example.com', name: 'Okay' },
                    subject: 'Pickup reminder',
                    text: 'Reminder one',
                    emailType: 'pickup_reminder'
                },
                {
                    to: { email: 'boom@example.com', name: 'Boom' },
                    subject: 'Pickup reminder',
                    text: 'Reminder two',
                    emailType: 'pickup_reminder'
                }
            ]
        }
    };
    const res = createMockRes();

    await handler(req, res);

    assert.equal(res.statusCode, 200);
    assert.equal(res.body?.success, false);
    assert.equal(res.body?.sent, 1);
    assert.equal(res.body?.failed, 1);
    assert.equal(res.body?.counts?.failed, 1);
    assert.equal(res.body?.failedRecipients?.[0]?.email, 'boom@example.com');
    assert.equal(res.body?.failedRecipients?.[0]?.reason, 'Provider connection reset.');
});
