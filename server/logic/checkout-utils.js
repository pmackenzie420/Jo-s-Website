const sanitizeText = (value, maxLength = 255) => {
    if (typeof value !== 'string') return '';
    return value.trim().slice(0, maxLength);
};

const isValidEmail = (value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);

const normalizeCheckoutItems = (value) => {
    if (!Array.isArray(value)) return [];
    const totals = new Map();
    for (const item of value) {
        const itemId = Number(item?.id);
        const quantityRaw = Number(item?.quantity ?? item?.qty ?? 0);
        const quantity = Number.isFinite(quantityRaw) ? Math.floor(quantityRaw) : 0;
        if (!Number.isInteger(itemId) || itemId <= 0 || quantity <= 0) {
            continue;
        }
        totals.set(itemId, (totals.get(itemId) || 0) + quantity);
    }
    return Array.from(totals.entries()).map(([id, quantity]) => ({ id, quantity }));
};

const collectOrderItemTotals = (parseOrderItems, value) => {
    const parsed = parseOrderItems(value);
    const totals = new Map();
    for (const item of parsed) {
        const itemId = Number(item?.id);
        const quantityRaw = Number(item?.quantity ?? item?.qty ?? 0);
        const quantity = Number.isFinite(quantityRaw) ? Math.floor(quantityRaw) : 0;
        if (!Number.isInteger(itemId) || itemId <= 0 || quantity <= 0) {
            continue;
        }
        totals.set(itemId, (totals.get(itemId) || 0) + quantity);
    }
    return Array.from(totals.entries()).map(([id, quantity]) => ({ id, quantity }));
};

module.exports = {
    sanitizeText,
    isValidEmail,
    normalizeCheckoutItems,
    collectOrderItemTotals
};
