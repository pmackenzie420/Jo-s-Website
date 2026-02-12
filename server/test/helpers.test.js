const test = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');

const {
    normalizeLanguage,
    formatPickupDateLong,
    parseOrderItems,
    parseCookies,
    getClientIp
} = require('../utils/helpers');

test('normalizeLanguage supports en/fr variants and defaults to en', () => {
    assert.equal(normalizeLanguage('fr'), 'fr');
    assert.equal(normalizeLanguage('fr-CA'), 'fr');
    assert.equal(normalizeLanguage('en-US'), 'en');
    assert.equal(normalizeLanguage('es'), 'en');
    assert.equal(normalizeLanguage(undefined), 'en');
});

test('parseOrderItems handles arrays, JSON strings and invalid input', () => {
    assert.deepEqual(parseOrderItems([{ id: 1 }]), [{ id: 1 }]);
    assert.deepEqual(parseOrderItems('[{"id":2}]'), [{ id: 2 }]);
    assert.deepEqual(parseOrderItems('not-json'), []);
    assert.deepEqual(parseOrderItems(null), []);
});

test('formatPickupDateLong keeps date-only pickup values stable across time zones', () => {
    assert.equal(formatPickupDateLong('2026-03-01', 'en'), 'March 1, 2026');
    assert.equal(formatPickupDateLong('2026-03-01T05:00:00.000Z', 'en'), 'March 1, 2026');
});

test('formatPickupDate keeps PG DATE calendar day in positive time zones', () => {
    const output = execFileSync(
        process.execPath,
        [
            '-e',
            [
                "const { formatPickupDate, formatPickupDateLong } = require('./utils/helpers');",
                'const localMidnight = new Date(2026, 2, 1);',
                'console.log(formatPickupDate(localMidnight));',
                "console.log(formatPickupDateLong(localMidnight, 'en'));"
            ].join('')
        ],
        {
            cwd: process.cwd(),
            env: {
                ...process.env,
                TZ: 'Pacific/Auckland'
            }
        }
    )
        .toString()
        .trim()
        .split('\n');

    assert.equal(output[0], '2026-03-01');
    assert.equal(output[1], 'March 1, 2026');
});

test('formatPickupDate keeps UTC-midnight Date objects on the same calendar day', () => {
    const output = execFileSync(
        process.execPath,
        [
            '-e',
            [
                "const { formatPickupDate, formatPickupDateLong } = require('./utils/helpers');",
                "const utcMidnightDate = new Date('2026-03-01');",
                'console.log(formatPickupDate(utcMidnightDate));',
                "console.log(formatPickupDateLong(utcMidnightDate, 'en'));"
            ].join('')
        ],
        {
            cwd: process.cwd(),
            env: {
                ...process.env,
                TZ: 'America/New_York'
            }
        }
    )
        .toString()
        .trim()
        .split('\n');

    assert.equal(output[0], '2026-03-01');
    assert.equal(output[1], 'March 1, 2026');
});

test('parseCookies decodes cookie header values', () => {
    const parsed = parseCookies('a=1; b=hello%20world; c=foo=bar');
    assert.equal(parsed.a, '1');
    assert.equal(parsed.b, 'hello world');
    assert.equal(parsed.c, 'foo=bar');
});

test('getClientIp prefers Express/socket values and ignores raw forwarded header fallback', () => {
    assert.equal(getClientIp({ ip: '127.0.0.1', headers: {} }), '127.0.0.1');
    assert.equal(
        getClientIp({ socket: { remoteAddress: '10.0.0.5' }, headers: {} }),
        '10.0.0.5'
    );
    assert.equal(
        getClientIp({ headers: { 'x-forwarded-for': '1.2.3.4' } }),
        'unknown'
    );
});
