const getOrderItemTotals = (parseOrderItems, collectOrderItemTotals, rawItems) => {
    const totals = collectOrderItemTotals(parseOrderItems, rawItems)
        .filter((item) => Number.isInteger(item.id) && item.id > 0)
        .filter((item) => Number.isInteger(item.quantity) && item.quantity > 0)
        .map((item) => ({ id: item.id, quantity: item.quantity }))
        .sort((a, b) => a.id - b.id);
    return totals;
};

const findPickupDateIdByValue = async (client, pickupDate, pickupLocation) => {
    if (!pickupDate || !pickupLocation) return null;
    const result = await client.query(
        `
        SELECT id
        FROM pickup_dates
        WHERE date_value = $1
          AND location = $2
        ORDER BY created_at ASC, id ASC
        LIMIT 1
        `,
        [pickupDate, pickupLocation]
    );
    return result.rows[0]?.id || null;
};

const reserveStockForItems = async (client, { pickupDateId, items, orderId }) => {
    for (const item of items) {
        const quantity = item.quantity;
        const itemId = item.id;

        if (pickupDateId) {
            const pickupStockUpdate = await client.query(
                `
                UPDATE pickup_stock
                SET stock = stock - $1
                WHERE pickup_date_id = $2 AND hen_id = $3 AND stock >= $1
                RETURNING hen_id
                `,
                [quantity, pickupDateId, itemId]
            );
            if (pickupStockUpdate.rowCount === 0) {
                throw new Error(
                    `Insufficient pickup stock while reserving order ${orderId} for hen ${itemId}.`
                );
            }
        }
    }
};

const releaseStockForItems = async (client, { pickupDateId, items }) => {
    for (const item of items) {
        const quantity = item.quantity;
        const itemId = item.id;

        if (pickupDateId) {
            await client.query(
                `
                INSERT INTO pickup_stock (pickup_date_id, hen_id, stock)
                VALUES ($1, $2, $3)
                ON CONFLICT (pickup_date_id, hen_id)
                DO UPDATE SET stock = pickup_stock.stock + EXCLUDED.stock
                `,
                [pickupDateId, itemId, quantity]
            );
        }
    }
};

module.exports = {
    getOrderItemTotals,
    findPickupDateIdByValue,
    reserveStockForItems,
    releaseStockForItems
};
