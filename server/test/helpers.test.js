const test = require('node:test');
const assert = require('node:assert/strict');

const {
    normalizeLanguage,
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
