const test = require('node:test');
const assert = require('node:assert/strict');
const {
    calculateItemPrice,
    getMinimumOrderQuantity,
    getDepositEligibleMinQty,
    getDepositRequiredAboveQty,
    isPickupLocationRestricted
} = require('../logic/pricing');

test('calculateItemPrice uses shared tier rules', () => {
    assert.equal(calculateItemPrice('Lohmann Brown', 5), 1750);
    assert.equal(calculateItemPrice('Lohmann Brown', 13), 1525);
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

test('getDepositRequiredAboveQty reads shared rules', () => {
    assert.equal(getDepositRequiredAboveQty(), 50);
});

test('isPickupLocationRestricted follows configured location rules', () => {
    assert.equal(isPickupLocationRestricted('Lamb', 'hemmingford'), false);
    assert.equal(isPickupLocationRestricted('Lamb', 'bristol'), false);
    assert.equal(isPickupLocationRestricted('Lohmann Brown', 'hemmingford'), false);
});
