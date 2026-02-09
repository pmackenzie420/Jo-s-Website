const fetchPickupDates = async (pool, location) => {
    let query = 'SELECT * FROM pickup_dates WHERE is_active = true';
    const values = [];
    if (location) {
        values.push(location);
        query += ' AND location = $1';
    }
    query += ' ORDER BY date_value ASC';
    const result = await pool.query(query, values);
    return result.rows;
};

const findPickupDateId = async (pool, date, location) => {
    const result = await pool.query(
        'SELECT id FROM pickup_dates WHERE is_active = true AND date_value = $1 AND location = $2',
        [date, location]
    );
    return result.rows[0]?.id || null;
};

const fetchPickupStockItems = async (pool, pickupDateId) => {
    const result = await pool.query(
        `
        SELECT
            hens.id as hen_id,
            hens.name,
            COALESCE(pickup_stock.stock, 0) as stock
        FROM hens
        LEFT JOIN pickup_stock
            ON pickup_stock.pickup_date_id = $1
            AND pickup_stock.hen_id = hens.id
        WHERE hens.is_active = true
        ORDER BY hens.id ASC
        `,
        [pickupDateId]
    );
    return result.rows;
};

const fetchAllPickupStocks = async (pool) => {
    const result = await pool.query(
        `
        SELECT
            pickup_dates.date_value,
            pickup_dates.location,
            pickup_stock.hen_id,
            pickup_stock.stock
        FROM pickup_stock
        INNER JOIN pickup_dates
            ON pickup_dates.id = pickup_stock.pickup_date_id
        WHERE pickup_dates.is_active = true
        `
    );
    return result.rows;
};

module.exports = {
    fetchPickupDates,
    findPickupDateId,
    fetchPickupStockItems,
    fetchAllPickupStocks
};
