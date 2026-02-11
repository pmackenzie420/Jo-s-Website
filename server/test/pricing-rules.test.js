const test = require('node:test');
const assert = require('node:assert/strict');
const {
    calculateItemPrice,
    getMinimumOrderQuantity,
    getDepositEligibleMinQty,
    isPickupLocationRestricted
} = require('../logic/pricing');

test('calculateItemPrice uses shared tier rules', () => {
    assert.equal(calculateItemPrice('Lohmann Brown', 5), 1);
    assert.equal(calculateItemPrice('Lohmann Brown', 13), 1);
    assert.equal(calculateItemPrice('Meat Chicken', 120), 230);
    assert.equal(calculateItemPrice('Agneau', 1), 5000);
});

test('getMinimumOrderQuantity returns configured minimums', () => {
    assert.equal(getMinimumOrderQuantity('Meat Chicken'), 25);
    assert.equal(getMinimumOrderQuantity('Lohmann Brown'), 0);
});

test('getDepositEligibleMinQty reads shared rules', () => {
    assert.equal(getDepositEligibleMinQty(), 13);
});

test('isPickupLocationRestricted follows configured location rules', () => {
    assert.equal(isPickupLocationRestricted('Lamb', 'hemmingford'), true);
    assert.equal(isPickupLocationRestricted('Lamb', 'bristol'), false);
    assert.equal(isPickupLocationRestricted('Lohmann Brown', 'hemmingford'), false);
});
