const test = require('node:test');
const assert = require('node:assert/strict');
const { resolveCheckoutImageUrl } = require('../logic/checkout-quote');

const CLIENT_BASE = 'https://www.lesfermessoulard.farm';

test('resolveCheckoutImageUrl maps meat items to chicks photo', () => {
    const value = resolveCheckoutImageUrl(
        { name: 'Meat Chicken', image_url: '/photos/old_broiler.jpg' },
        CLIENT_BASE
    );
    assert.equal(value, 'https://www.lesfermessoulard.farm/photos/chicks_cropped.jpg');
});

test('resolveCheckoutImageUrl maps white ready-to-lay items to white hen photo', () => {
    const value = resolveCheckoutImageUrl(
        { name: 'White Ready-to-Lay Hens', image_url: null },
        CLIENT_BASE
    );
    assert.equal(value, 'https://www.lesfermessoulard.farm/photos/white_hen.jpg');
});

test('resolveCheckoutImageUrl keeps absolute image URLs for unknown item names', () => {
    const value = resolveCheckoutImageUrl(
        { name: 'Special Product', image_url: 'https://cdn.example.com/custom.png' },
        CLIENT_BASE
    );
    assert.equal(value, 'https://cdn.example.com/custom.png');
});
