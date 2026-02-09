const test = require('node:test');
const assert = require('node:assert/strict');

const {
    sanitizeText,
    isValidEmail,
    normalizeCheckoutItems,
    collectOrderItemTotals
} = require('../logic/checkout-utils');
const { parseOrderItems } = require('../utils/helpers');

test('sanitizeText trims and limits length', () => {
    assert.equal(sanitizeText('  hello  ', 10), 'hello');
    assert.equal(sanitizeText('abcdef', 3), 'abc');
    assert.equal(sanitizeText(null, 10), '');
});

test('isValidEmail validates basic email format', () => {
    assert.equal(isValidEmail('user@example.com'), true);
    assert.equal(isValidEmail('bad-email'), false);
    assert.equal(isValidEmail('a@b'), false);
});

test('normalizeCheckoutItems drops invalid rows and merges duplicate ids', () => {
    const result = normalizeCheckoutItems([
        { id: 1, quantity: 2 },
        { id: '1', qty: 3 },
        { id: 2, quantity: '4.7' },
        { id: 2, quantity: -1 },
        { id: 'x', quantity: 10 },
        { id: 3, quantity: 0 }
    ]);

    assert.deepEqual(result, [
        { id: 1, quantity: 5 },
        { id: 2, quantity: 4 }
    ]);
});

test('collectOrderItemTotals handles JSON/text payloads and merges duplicate ids', () => {
    const result = collectOrderItemTotals(parseOrderItems, JSON.stringify([
        { id: 10, quantity: 1 },
        { id: '10', qty: 2 },
        { id: 20, quantity: '3' },
        { id: 20, quantity: 0 }
    ]));

    assert.deepEqual(result, [
        { id: 10, quantity: 3 },
        { id: 20, quantity: 3 }
    ]);
});
