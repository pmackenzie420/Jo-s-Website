const pool = require('../db');
const { parseOrderItems } = require('../utils/helpers');

// --- PRICING LOGIC ---
const calculateItemPrice = (henName, qty) => {
    // 1. Lohmann Brown (Layers)
    if (henName.includes('Lohmann') || henName.includes('Ready-to-Lay')) {
        if (qty >= 50) return 1400; // $14.00
        if (qty >= 13) return 1525; // $15.25
        if (qty >= 6) return 1700; // $17.00
        return 1750;                // $17.50 (Base)
    }

    // 2. Ross (Meat Birds)
    if (henName.includes('Meat') || henName.includes('Chair')) {
        if (qty >= 300) return 215; // $2.15
        if (qty >= 100) return 230; // $2.30
        if (qty >= 49) return 250; // $2.50
        return 260;                 // $2.60 (Base for 25-49, and small orders)
    }

    // 3. Lamb (Agneau) - Deposit Only
    if (henName.includes('Lamb') || henName.includes('Agneau')) {
        return 5000; // $50.00 Deposit per lamb
    }

    // Fallback
    return 0;
};

const isLohmannHenName = (name) => {
    if (typeof name !== 'string') return false;
    const normalized = name.toLowerCase();
    return normalized.includes('lohmann') || normalized.includes('ready-to-lay');
};

const isLambName = (name) => {
    if (typeof name !== 'string') return false;
    const normalized = name.toLowerCase();
    return normalized.includes('lamb') || normalized.includes('agneau');
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
    isLambName,
    getPaymentDetails,
    getOrderSummary
};
