const test = require('node:test');
const assert = require('node:assert/strict');
const { fetchPickupDates } = require('../logic/pickup');

const normalizeSql = (sql) => String(sql).replace(/\s+/g, ' ').trim();

test('fetchPickupDates excludes past dates for public checkout lookups', async () => {
    let capturedSql = '';
    let capturedParams = [];
    const pool = {
        async query(sql, params) {
            capturedSql = normalizeSql(sql);
            capturedParams = params;
            return { rows: [] };
        }
    };

    await fetchPickupDates(pool, 'hemmingford', { includePast: false });

    assert.equal(capturedSql.includes('date_value >= CURRENT_DATE'), true);
    assert.deepEqual(capturedParams, ['hemmingford']);
});

test('fetchPickupDates keeps historical dates for admin screens by default', async () => {
    let capturedSql = '';
    const pool = {
        async query(sql) {
            capturedSql = normalizeSql(sql);
            return { rows: [] };
        }
    };

    await fetchPickupDates(pool);

    assert.equal(capturedSql.includes('date_value >= CURRENT_DATE'), false);
    assert.equal(capturedSql.includes('WHERE is_active = true'), true);
});

