const test = require('node:test');
const assert = require('node:assert/strict');
const pool = require('../db');
const { getOrderSummary } = require('../logic/pricing');

test('getOrderSummary prefers persisted order item pricing and names', async () => {
    const originalQuery = pool.query;
    pool.query = async (sql, params) => {
        const normalizedSql = String(sql).replace(/\s+/g, ' ').trim();
        if (normalizedSql.includes('FROM orders LEFT JOIN customers')) {
            assert.deepEqual(params, ['order-1']);
            return {
                rows: [{
                    id: 'order-1',
                    items: JSON.stringify([
                        {
                            id: 1,
                            quantity: 2,
                            name: 'Historical Product Name',
                            unit_cents: 999,
                            line_cents: 1998
                        },
                        { id: 2, quantity: 25 }
                    ])
                }]
            };
        }
        if (normalizedSql.includes('FROM hens WHERE id::text = ANY')) {
            return {
                rows: [
                    { id: '1', name: 'Current Product Name' },
                    { id: '2', name: 'Meat Chicken / Poulets à Chair' }
                ]
            };
        }
        throw new Error(`Unexpected query: ${normalizedSql}`);
    };

    try {
        const summary = await getOrderSummary('order-1');
        assert.ok(summary);
        assert.equal(summary.items.length, 2);
        assert.deepEqual(summary.items[0], {
            id: '1',
            name: 'Historical Product Name',
            quantity: 2,
            unit_cents: 999,
            line_cents: 1998
        });
        assert.deepEqual(summary.items[1], {
            id: '2',
            name: 'Meat Chicken / Poulets à Chair',
            quantity: 25,
            unit_cents: 275,
            line_cents: 6875
        });
    } finally {
        pool.query = originalQuery;
    }
});

