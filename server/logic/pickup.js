const fetchPickupDates = async (pool, location, options = {}) => {
    const includePast = options.includePast !== false;
    const values = [];
    const whereClauses = ['is_active = true'];
    if (location) {
        values.push(location);
        whereClauses.push(`location = $${values.length}`);
    }
    if (!includePast) {
        whereClauses.push('date_value >= CURRENT_DATE');
    }
    const result = await pool.query(
        `
        WITH canonical_dates AS (
            SELECT DISTINCT ON (date_value, location)
                id,
                date_value,
                location,
                is_active,
                created_at
            FROM pickup_dates
            WHERE ${whereClauses.join('\n              AND ')}
            ORDER BY date_value, location, created_at ASC, id ASC
        )
        SELECT id, date_value, location, is_active, created_at
        FROM canonical_dates
        ORDER BY date_value ASC
        `,
        values
    );
    return result.rows;
};

const findPickupDateId = async (pool, date, location) => {
    const result = await pool.query(
        `
        SELECT id
        FROM pickup_dates
        WHERE is_active = true
          AND date_value = $1
          AND location = $2
        ORDER BY created_at ASC, id ASC
        LIMIT 1
        `,
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
        WITH canonical_dates AS (
            SELECT DISTINCT ON (date_value, location)
                id,
                date_value,
                location
            FROM pickup_dates
            WHERE is_active = true
            ORDER BY date_value, location, created_at ASC, id ASC
        )
        SELECT
            canonical_dates.date_value,
            canonical_dates.location,
            pickup_stock.hen_id,
            pickup_stock.stock
        FROM pickup_stock
        INNER JOIN canonical_dates
            ON canonical_dates.id = pickup_stock.pickup_date_id
        `
    );
    return result.rows;
};

const pad2 = (value) => String(value).padStart(2, '0');

const normalizeDateValue = (value) => {
    if (!value) return '';
    if (typeof value === 'string') {
        const trimmed = value.trim();
        return trimmed.includes('T') ? trimmed.split('T')[0] : trimmed;
    }
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) {
        return String(value).trim();
    }
    return `${date.getUTCFullYear()}-${pad2(date.getUTCMonth() + 1)}-${pad2(date.getUTCDate())}`;
};

const parseOrderItems = (items) => {
    if (!items) return [];
    if (Array.isArray(items)) return items;
    if (typeof items === 'string') {
        try {
            const parsed = JSON.parse(items);
            return Array.isArray(parsed) ? parsed : [];
        } catch {
            return [];
        }
    }
    return [];
};

const fetchReservedPickupItems = async (pool) => {
    const result = await pool.query(
        `
        SELECT pickup_date AS date_value, pickup_location AS location, items
        FROM orders
        WHERE pickup_date IS NOT NULL
          AND COALESCE(pickup_location, '') <> ''
          AND LOWER(COALESCE(status, 'pending')) <> 'cancelled'
        `
    );

    const totalsByKey = new Map();
    for (const row of result.rows) {
        const dateValue = normalizeDateValue(row?.date_value);
        const location = String(row?.location || '').trim();
        if (!dateValue || !location) continue;

        const items = parseOrderItems(row?.items);
        for (const item of items) {
            const henId = Number(item?.id);
            const quantity = Number(item?.quantity ?? item?.qty ?? 0);
            if (!Number.isInteger(henId) || henId <= 0) continue;
            if (!Number.isInteger(quantity) || quantity <= 0) continue;

            const key = `${dateValue}::${location}::${henId}`;
            totalsByKey.set(key, (totalsByKey.get(key) || 0) + quantity);
        }
    }

    return Array.from(totalsByKey.entries()).map(([key, reserved]) => {
        const [dateValue, location, henId] = key.split('::');
        return {
            date_value: dateValue,
            location,
            hen_id: Number(henId),
            reserved
        };
    });
};

module.exports = {
    fetchPickupDates,
    findPickupDateId,
    fetchPickupStockItems,
    fetchAllPickupStocks,
    fetchReservedPickupItems
};
