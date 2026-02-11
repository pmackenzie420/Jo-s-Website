const { fetchPickupDates, findPickupDateId, fetchPickupStockItems } = require('../logic/pickup');

const registerCatalogRoutes = (app, deps) => {
    const { pool, sendServerError } = deps;

    const handlePickupStockRequest = async (req, res) => {
        const date = typeof req.query.date === 'string' ? req.query.date : null;
        const location = typeof req.query.location === 'string' ? req.query.location : null;
        if (!date || !location) {
            return res.status(400).json({ error: 'date and location are required' });
        }
        try {
            const pickupDateId = await findPickupDateId(pool, date, location);
            if (!pickupDateId) {
                return res.status(404).json({ error: 'Pickup date not found.' });
            }
            const items = await fetchPickupStockItems(pool, pickupDateId);
            return res.json({ date, location, items });
        } catch (err) {
            return sendServerError(res, err, 'Failed to load pickup stock');
        }
    };

    app.get('/api/heartbeat', async (req, res) => {
        const shouldCheckDb = ['1', 'true', 'yes'].includes(
            String(req.query.db || '').toLowerCase()
        );
        if (!shouldCheckDb) {
            return res.json({ ok: true });
        }
        try {
            await pool.query('SELECT 1');
            return res.json({ ok: true, db: 'ok' });
        } catch (err) {
            return sendServerError(res, err, 'Heartbeat DB check failed');
        }
    });

    app.get('/api/hens', async (req, res) => {
        try {
            const pickupDate = typeof req.query.pickup_date === 'string' ? req.query.pickup_date : null;
            const pickupLocation =
                typeof req.query.pickup_location === 'string' ? req.query.pickup_location : null;
            if (pickupDate && pickupLocation) {
                const result = await pool.query(
                    `
                    SELECT
                        hens.*,
                        COALESCE(pickup_stock.stock, 0) AS stock
                    FROM hens
                    LEFT JOIN pickup_dates
                        ON pickup_dates.date_value = $1
                        AND pickup_dates.location = $2
                        AND pickup_dates.is_active = true
                    LEFT JOIN pickup_stock
                        ON pickup_stock.pickup_date_id = pickup_dates.id
                        AND pickup_stock.hen_id = hens.id
                    WHERE hens.is_active = true
                    ORDER BY hens.id ASC
                    `,
                    [pickupDate, pickupLocation]
                );
                return res.json(result.rows);
            }
            const result = await pool.query('SELECT * FROM hens WHERE is_active = true ORDER BY id ASC');
            return res.json(result.rows);
        } catch (err) {
            return sendServerError(res, err, 'Failed to load inventory');
        }
    });

    app.get('/api/pickup-dates', async (req, res) => {
        try {
            const location = typeof req.query.location === 'string' ? req.query.location : null;
            const dates = await fetchPickupDates(pool, location);
            return res.json(dates);
        } catch (err) {
            return sendServerError(res, err, 'Failed to load pickup dates');
        }
    });

    app.get('/api/pickup-stock', handlePickupStockRequest);

    return {
        handlePickupStockRequest
    };
};

module.exports = {
    registerCatalogRoutes
};
