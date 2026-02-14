const test = require('node:test');
const assert = require('node:assert/strict');

const { createOrderLifecycle } = require('../logic/order-lifecycle');

const normalizeSql = (sql) => String(sql).replace(/\s+/g, ' ').trim();

const createPool = (queryImpl) => ({
    async connect() {
        return {
            async query(sql, params) {
                return queryImpl(sql, params);
            },
            release() {}
        };
    }
});

test('releaseReservedOrder releases stock for reserved order and expires Stripe session when requested', async () => {
    const queries = [];
    const pool = createPool(async (sql, params) => {
        const normalized = normalizeSql(sql);
        queries.push([normalized, params]);

        if (normalized === 'BEGIN' || normalized === 'COMMIT') {
            return { rows: [], rowCount: 0 };
        }
        if (normalized === 'ROLLBACK') {
            throw new Error('Unexpected ROLLBACK');
        }
        if (normalized.includes('SELECT status, items, pickup_date, pickup_location, stripe_payment_id FROM orders')) {
            assert.deepEqual(params, ['ord_1']);
            return {
                rows: [{
                    status: 'reserved',
                    items: JSON.stringify([{ id: 10, quantity: 2 }]),
                    pickup_date: '2026-04-28',
                    pickup_location: 'hemmingford',
                    stripe_payment_id: 'cs_test_reserved'
                }]
            };
        }
        if (normalized.includes('UPDATE orders SET status = $1 WHERE id = $2')) {
            assert.deepEqual(params, ['cancelled', 'ord_1']);
            return { rows: [], rowCount: 1 };
        }
        throw new Error(`Unexpected SQL: ${normalized}`);
    });

    const released = [];
    const expireCalls = [];
    const lifecycle = createOrderLifecycle({
        pool,
        stripe: {
            checkout: {
                sessions: {
                    expire: async (sessionId) => expireCalls.push(sessionId)
                }
            }
        },
        parseOrderItems: () => [],
        collectOrderItemTotals: () => [],
        getOrderItemTotals: (_parse, _collect, rawItems) => JSON.parse(rawItems),
        findPickupDateIdByValue: async () => 'pickup_date_1',
        reserveStockForItems: async () => {},
        releaseStockForItems: async (_client, payload) => released.push(payload),
        sendOrderConfirmationEmail: async () => ({ sent: true }),
        PAID_STATUSES: new Set(['paid', 'fulfilled', 'picked_up']),
        RESERVED_ORDER_STATUS: 'reserved',
        CHECKOUT_RESERVATION_TTL_MINUTES: 45,
        EXPIRED_RESERVATION_BATCH_SIZE: 100
    });

    const result = await lifecycle.releaseReservedOrder('ord_1', { expireStripeSession: true });
    assert.equal(result.status, 'released');
    assert.equal(expireCalls.length, 1);
    assert.equal(expireCalls[0], 'cs_test_reserved');
    assert.deepEqual(released, [
        { pickupDateId: 'pickup_date_1', items: [{ id: 10, quantity: 2 }] }
    ]);
});

test('releaseReservedOrder releases stock for paid order but does not attempt to expire Stripe session', async () => {
    const pool = createPool(async (sql, params) => {
        const normalized = normalizeSql(sql);
        if (normalized === 'BEGIN' || normalized === 'COMMIT') {
            return { rows: [], rowCount: 0 };
        }
        if (normalized.includes('SELECT status, items, pickup_date, pickup_location, stripe_payment_id FROM orders')) {
            assert.deepEqual(params, ['ord_2']);
            return {
                rows: [{
                    status: 'paid',
                    items: JSON.stringify([{ id: 12, quantity: 1 }]),
                    pickup_date: '2026-04-28',
                    pickup_location: 'hemmingford',
                    stripe_payment_id: 'cs_test_paid'
                }]
            };
        }
        if (normalized.includes('UPDATE orders SET status = $1 WHERE id = $2')) {
            assert.deepEqual(params, ['cancelled', 'ord_2']);
            return { rows: [], rowCount: 1 };
        }
        throw new Error(`Unexpected SQL: ${normalized}`);
    });

    const released = [];
    const expireCalls = [];
    const lifecycle = createOrderLifecycle({
        pool,
        stripe: {
            checkout: {
                sessions: {
                    expire: async (sessionId) => expireCalls.push(sessionId)
                }
            }
        },
        parseOrderItems: () => [],
        collectOrderItemTotals: () => [],
        getOrderItemTotals: (_parse, _collect, rawItems) => JSON.parse(rawItems),
        findPickupDateIdByValue: async () => 'pickup_date_1',
        reserveStockForItems: async () => {},
        releaseStockForItems: async (_client, payload) => released.push(payload),
        sendOrderConfirmationEmail: async () => ({ sent: true }),
        PAID_STATUSES: new Set(['paid', 'fulfilled', 'picked_up']),
        RESERVED_ORDER_STATUS: 'reserved',
        CHECKOUT_RESERVATION_TTL_MINUTES: 45,
        EXPIRED_RESERVATION_BATCH_SIZE: 100
    });

    const result = await lifecycle.releaseReservedOrder('ord_2', { expireStripeSession: true });
    assert.equal(result.status, 'released');
    assert.equal(expireCalls.length, 0);
    assert.deepEqual(released, [
        { pickupDateId: 'pickup_date_1', items: [{ id: 12, quantity: 1 }] }
    ]);
});

test('releaseReservedOrder returns not_reserved for non-reserved/non-paid statuses', async () => {
    const pool = createPool(async (sql, params) => {
        const normalized = normalizeSql(sql);
        if (normalized === 'BEGIN' || normalized === 'COMMIT') {
            return { rows: [], rowCount: 0 };
        }
        if (normalized.includes('SELECT status, items, pickup_date, pickup_location, stripe_payment_id FROM orders')) {
            assert.deepEqual(params, ['ord_3']);
            return {
                rows: [{
                    status: 'pending',
                    items: JSON.stringify([{ id: 12, quantity: 1 }]),
                    pickup_date: '2026-04-28',
                    pickup_location: 'hemmingford',
                    stripe_payment_id: 'cs_test_pending'
                }]
            };
        }
        throw new Error(`Unexpected SQL: ${normalized}`);
    });

    const lifecycle = createOrderLifecycle({
        pool,
        stripe: { checkout: { sessions: { expire: async () => {} } } },
        parseOrderItems: () => [],
        collectOrderItemTotals: () => [],
        getOrderItemTotals: (_parse, _collect, rawItems) => JSON.parse(rawItems),
        findPickupDateIdByValue: async () => 'pickup_date_1',
        reserveStockForItems: async () => {},
        releaseStockForItems: async () => {},
        sendOrderConfirmationEmail: async () => ({ sent: true }),
        PAID_STATUSES: new Set(['paid', 'fulfilled', 'picked_up']),
        RESERVED_ORDER_STATUS: 'reserved',
        CHECKOUT_RESERVATION_TTL_MINUTES: 45,
        EXPIRED_RESERVATION_BATCH_SIZE: 100
    });

    const result = await lifecycle.releaseReservedOrder('ord_3', { expireStripeSession: true });
    assert.equal(result.status, 'not_reserved');
    assert.equal(result.orderId, 'ord_3');
});

test('finalizeOrderFromSession does not revive cancelled orders', async () => {
    const queries = [];
    const pool = createPool(async (sql, params) => {
        const normalized = normalizeSql(sql);
        queries.push([normalized, params]);
        if (normalized === 'BEGIN' || normalized === 'COMMIT') {
            return { rows: [], rowCount: 0 };
        }
        if (normalized.includes('SELECT status, items, pickup_date, pickup_location FROM orders')) {
            assert.deepEqual(params, ['ord_4']);
            return {
                rows: [{
                    status: 'cancelled',
                    items: JSON.stringify([{ id: 10, quantity: 2 }]),
                    pickup_date: '2026-04-28',
                    pickup_location: 'hemmingford'
                }]
            };
        }
        // No updates should be attempted for cancelled orders.
        if (normalized.includes('UPDATE orders SET')) {
            throw new Error(`Unexpected UPDATE for cancelled order: ${normalized}`);
        }
        throw new Error(`Unexpected SQL: ${normalized}`);
    });

    let reserveCalled = false;
    let emailCalled = false;

    const lifecycle = createOrderLifecycle({
        pool,
        stripe: { checkout: { sessions: { expire: async () => {} } } },
        parseOrderItems: () => [],
        collectOrderItemTotals: () => [],
        getOrderItemTotals: (_parse, _collect, rawItems) => JSON.parse(rawItems),
        findPickupDateIdByValue: async () => 'pickup_date_1',
        reserveStockForItems: async () => {
            reserveCalled = true;
        },
        releaseStockForItems: async () => {},
        sendOrderConfirmationEmail: async () => {
            emailCalled = true;
        },
        PAID_STATUSES: new Set(['paid', 'fulfilled', 'picked_up']),
        RESERVED_ORDER_STATUS: 'reserved',
        CHECKOUT_RESERVATION_TTL_MINUTES: 45,
        EXPIRED_RESERVATION_BATCH_SIZE: 100
    });

    const result = await lifecycle.finalizeOrderFromSession({
        id: 'cs_test_completed',
        metadata: { order_id: 'ord_4' }
    });
    assert.equal(result.status, 'cancelled');
    assert.equal(result.orderId, 'ord_4');
    assert.equal(reserveCalled, false);
    assert.equal(emailCalled, false);
});

