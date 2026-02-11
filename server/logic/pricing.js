const pool = require('../db');
const { parseOrderItems } = require('../utils/helpers');
const PRICING_RULES = require('../../shared/pricing-rules.json');

const CATEGORY_LIST = Array.isArray(PRICING_RULES?.categories)
    ? PRICING_RULES.categories
    : [];
const TEMP_BROWN_LAYER_TEST_PRICE_CENTS = 1;

const normalizeName = (value) => {
    if (typeof value !== 'string') return '';
    return value.toLowerCase();
};

const findCategoryByName = (name) => {
    const normalized = normalizeName(name);
    if (!normalized) return null;
    return CATEGORY_LIST.find((category) =>
        (category?.keywords || []).some((keyword) =>
            normalized.includes(String(keyword).toLowerCase())
        )
    ) || null;
};

const getUnitCentsFromCategory = (category, quantity) => {
    const qty = Number(quantity);
    if (!category || !Number.isFinite(qty) || qty <= 0) return 0;
    const tiers = Array.isArray(category.tiers) ? category.tiers : [];
    const sorted = [...tiers].sort((first, second) =>
        Number(second.minQty || 0) - Number(first.minQty || 0)
    );
    const match = sorted.find((tier) => qty >= Number(tier.minQty || 0));
    return Number(match?.unitCents || 0);
};

const isBrownLayerName = (name, category) => {
    const normalized = normalizeName(name);
    if (!normalized) return false;
    if (!category || category.key !== 'layer') return false;
    return normalized.includes('brown') || normalized.includes('brune');
};

const calculateItemPrice = (henName, qty) => {
    const category = findCategoryByName(henName);
    // Temporary test override for checkout validation runs.
    if (isBrownLayerName(henName, category)) {
        return TEMP_BROWN_LAYER_TEST_PRICE_CENTS;
    }
    return getUnitCentsFromCategory(category, qty);
};

const isCategory = (name, key) => findCategoryByName(name)?.key === key;
const isLohmannHenName = (name) => isCategory(name, 'layer');
const isMeatHenName = (name) => isCategory(name, 'meat');
const isLambName = (name) => isCategory(name, 'lamb');
const getMinimumOrderQuantity = (name) =>
    Number(findCategoryByName(name)?.minOrderQty || 0);
const getDepositEligibleMinQty = () =>
    Number(CATEGORY_LIST.find((category) => category?.key === 'layer')?.depositEligibleMinQty || 0);

const isPickupLocationRestricted = (name, pickupLocation) => {
    const normalizedLocation = normalizeName(pickupLocation);
    if (!normalizedLocation) return false;
    const restricted = findCategoryByName(name)?.restrictedPickupLocations || [];
    return restricted.some(
        (location) => String(location).toLowerCase() === normalizedLocation
    );
};

const getPaymentDetails = (order) => {
    const totalCents = Number(order?.total_cents ?? 0);
    const amountPaidRaw = Number(order?.amount_paid_cents);
    const amountDueRaw = Number(order?.amount_due_cents);
    const paidCents = Number.isFinite(amountPaidRaw) ? amountPaidRaw : totalCents;
    const dueCents = Number.isFinite(amountDueRaw)
        ? amountDueRaw
        : Math.max(totalCents - paidCents, 0);
    const paymentType = order?.payment_type || (dueCents > 0 ? 'deposit' : 'full');
    return { totalCents, paidCents, dueCents, paymentType };
};

const getOrderSummary = async (orderId) => {
    const orderResult = await pool.query(
        `SELECT 
            orders.*,
            customers.name as customer_name,
            customers.phone as customer_phone,
            customers.address as customer_address
         FROM orders
         LEFT JOIN customers ON orders.customer_id = customers.id
         WHERE orders.id = $1`,
        [orderId]
    );

    if (orderResult.rows.length === 0) {
        return null;
    }

    const order = orderResult.rows[0];
    const parsedItems = parseOrderItems(order.items);
    const itemIds = parsedItems
        .map((item) => String(item.id))
        .filter((id) => id && id !== 'undefined' && id !== 'null');
    let henMap = new Map();
    if (itemIds.length > 0) {
        const hensResult = await pool.query(
            'SELECT id::text as id, name FROM hens WHERE id::text = ANY($1::text[])',
            [itemIds]
        );
        henMap = new Map(hensResult.rows.map((hen) => [hen.id, hen.name]));
    }
    const items = parsedItems.map((item) => {
        const id = String(item.id);
        const quantity = Number(item.quantity ?? item.qty ?? 0);
        const rawName = henMap.get(id) || item.name || 'Item';
        const name = String(rawName);
        const unitCents = calculateItemPrice(name, quantity);
        const lineCents = unitCents * quantity;
        return {
            id,
            name,
            quantity,
            unit_cents: unitCents,
            line_cents: lineCents
        };
    });

    return { order, items };
};

module.exports = {
    calculateItemPrice,
    isLohmannHenName,
    isMeatHenName,
    isLambName,
    getMinimumOrderQuantity,
    getDepositEligibleMinQty,
    isPickupLocationRestricted,
    getPaymentDetails,
    getOrderSummary
};
