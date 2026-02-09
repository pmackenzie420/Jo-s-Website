const {
    fetchPickupDates,
    findPickupDateId,
    fetchAllPickupStocks
} = require('../logic/pickup');
const {
    verifyPassword,
    parseAllowlist,
    isIpAllowed
} = require('../utils/password-auth');

const ADMIN_ALLOWED_ORDER_STATUSES = new Set([
    'reserved',
    'pending',
    'paid',
    'fulfilled',
    'picked_up',
    'cancelled'
]);

const parsePositiveInt = (value, fallback) => {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return fallback;
    if (parsed <= 0) return fallback;
    return Math.floor(parsed);
};

const parseNonNegativeInt = (value, fallback) => {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return fallback;
    if (parsed < 0) return fallback;
    return Math.floor(parsed);
};

const registerAdminRoutes = (app, deps) => {
    const {
        pool,
        checkAuth,
        adminLoginLimiter,
        signAdminSession,
        getCookieOptions,
        getClearCookieOptions,
        ADMIN_SESSION_COOKIE,
        ADMIN_SESSION_TTL_MS,
        sendServerError,
        sanitizeText,
        isValidEmail,
        sendEmailMessage,
        formatPickupDate,
        handlePickupStockRequest
    } = deps;

    const fetchAdminOrders = async ({ limit = 2000, offset = 0 } = {}) => {
        const query = `
            SELECT 
                orders.*, 
                customers.name as customer_name,
                customers.phone as customer_phone,
                customers.address as customer_address
            FROM orders
            LEFT JOIN customers ON orders.customer_id = customers.id
            ORDER BY orders.created_at DESC
            LIMIT $1
            OFFSET $2
        `;
        const result = await pool.query(query, [limit, offset]);
        return result.rows;
    };

    const fetchAdminOrdersPage = async ({ limit = 500, offset = 0 } = {}) => {
        const pageSize = Math.min(parsePositiveInt(limit, 500), 2000);
        const pageOffset = parseNonNegativeInt(offset, 0);
        const query = `
            SELECT 
                orders.*, 
                customers.name as customer_name,
                customers.phone as customer_phone,
                customers.address as customer_address
            FROM orders
            LEFT JOIN customers ON orders.customer_id = customers.id
            ORDER BY orders.created_at DESC
            LIMIT $1
            OFFSET $2
        `;
        const result = await pool.query(query, [pageSize + 1, pageOffset]);
        const hasMore = result.rows.length > pageSize;
        const orders = hasMore ? result.rows.slice(0, pageSize) : result.rows;
        return {
            orders,
            limit: pageSize,
            offset: pageOffset,
            nextOffset: pageOffset + orders.length,
            hasMore
        };
    };

    const fetchActiveHens = async () => {
        const result = await pool.query('SELECT * FROM hens WHERE is_active = true ORDER BY id ASC');
        return result.rows;
    };

    app.post('/api/admin/login', adminLoginLimiter, (req, res) => {
        const { password, otp } = req.body || {};
        const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
        const ADMIN_PASSWORD_HASH = process.env.ADMIN_PASSWORD_HASH;
        if (!ADMIN_PASSWORD && !ADMIN_PASSWORD_HASH) {
            return res.status(500).json({ error: 'Admin auth not configured.' });
        }
        const allowlist = parseAllowlist(process.env.ADMIN_LOGIN_IP_ALLOWLIST);
        if (!isIpAllowed(req, allowlist)) {
            return res.status(403).json({ error: 'Admin login blocked from this IP.' });
        }
        const ADMIN_LOGIN_2FA_CODE = process.env.ADMIN_LOGIN_2FA_CODE;
        if (ADMIN_LOGIN_2FA_CODE && String(otp || '') !== ADMIN_LOGIN_2FA_CODE) {
            return res.status(401).send('Wrong password');
        }
        const valid = verifyPassword({
            candidate: password,
            plainSecret: ADMIN_PASSWORD,
            hashedSecret: ADMIN_PASSWORD_HASH
        });
        if (!valid) {
            return res.status(401).send('Wrong password');
        }
        const token = signAdminSession({ sub: 'admin' });
        res.cookie(ADMIN_SESSION_COOKIE, token, getCookieOptions(ADMIN_SESSION_TTL_MS));
        return res.json({ success: true });
    });

    app.get('/api/admin/session', checkAuth, (req, res) => {
        res.json({ success: true });
    });

    app.post('/api/admin/logout', (req, res) => {
        res.clearCookie(ADMIN_SESSION_COOKIE, getClearCookieOptions());
        return res.json({ success: true });
    });

    app.get('/api/admin/orders', checkAuth, async (req, res) => {
        try {
            const limit = Math.min(parsePositiveInt(req.query.limit, 2000), 5000);
            const offset = parseNonNegativeInt(req.query.offset, 0);
            const orders = await fetchAdminOrders({ limit, offset });
            return res.json(orders);
        } catch (err) {
            return sendServerError(res, err, 'Failed to load admin orders');
        }
    });

    app.get('/api/admin/orders-page', checkAuth, async (req, res) => {
        try {
            const page = await fetchAdminOrdersPage({
                limit: req.query.limit,
                offset: req.query.offset
            });
            return res.json(page);
        } catch (err) {
            return sendServerError(res, err, 'Failed to load admin orders page');
        }
    });

    app.get('/api/admin/meta', checkAuth, async (req, res) => {
        try {
            const [hens, dates, pickupStocks] = await Promise.all([
                fetchActiveHens(),
                fetchPickupDates(pool),
                fetchAllPickupStocks(pool)
            ]);
            const pickupStocksByKey = {};
            for (const row of pickupStocks) {
                const dateValue = formatPickupDate(row.date_value);
                const location = sanitizeText(row.location, 40);
                const key = `${dateValue}::${location}`;
                if (!pickupStocksByKey[key]) {
                    pickupStocksByKey[key] = {};
                }
                pickupStocksByKey[key][Number(row.hen_id)] = Number(row.stock || 0);
            }
            return res.json({
                hens,
                dates,
                pickupStocks: pickupStocksByKey
            });
        } catch (err) {
            return sendServerError(res, err, 'Failed to load admin metadata');
        }
    });

    app.put('/api/admin/hens/:id', checkAuth, async (req, res) => {
        const { id } = req.params;
        const { stock } = req.body;
        const normalizedStock = Number(stock);
        if (!Number.isFinite(normalizedStock) || normalizedStock < 0) {
            return res.status(400).json({ error: 'Valid stock is required.' });
        }
        try {
            await pool.query('UPDATE hens SET stock = $1 WHERE id = $2', [Math.floor(normalizedStock), id]);
            return res.json({ success: true, message: "Stock updated" });
        } catch (err) {
            return sendServerError(res, err, 'Failed to update stock');
        }
    });

    app.post('/api/admin/pickup-dates', checkAuth, async (req, res) => {
        const { date_value, location } = req.body;
        if (!date_value || !location) {
            return res.status(400).send('Date and location are required.');
        }
        try {
            const result = await pool.query(
                'INSERT INTO pickup_dates (date_value, location) VALUES ($1, $2) RETURNING *',
                [date_value, location]
            );
            const pickupDate = result.rows[0];
            const hensRes = await pool.query(
                'SELECT id, COALESCE(stock, 0) as stock FROM hens WHERE is_active = true ORDER BY id ASC'
            );
            if (hensRes.rows.length > 0) {
                const henIds = hensRes.rows.map((row) => Number(row.id));
                const stocks = hensRes.rows.map((row) => Number(row.stock || 0));
                await pool.query(
                    `
                    INSERT INTO pickup_stock (pickup_date_id, hen_id, stock)
                    SELECT $1, UNNEST($2::int[]), UNNEST($3::int[])
                    ON CONFLICT (pickup_date_id, hen_id) DO NOTHING
                    `,
                    [pickupDate.id, henIds, stocks]
                );
            }
            return res.json(pickupDate);
        } catch (err) {
            return sendServerError(res, err, 'Failed to add pickup date');
        }
    });

    app.delete('/api/admin/pickup-dates/:id', checkAuth, async (req, res) => {
        const { id } = req.params;
        try {
            await pool.query('DELETE FROM pickup_dates WHERE id = $1', [id]);
            return res.json({ success: true });
        } catch (err) {
            return sendServerError(res, err, 'Failed to delete pickup date');
        }
    });

    app.get('/api/admin/pickup-stock', checkAuth, handlePickupStockRequest);

    app.put('/api/admin/pickup-stock', checkAuth, async (req, res) => {
        const { date, location, items } = req.body || {};
        if (!date || !location) {
            return res.status(400).json({ error: 'date and location are required' });
        }
        if (!Array.isArray(items) || items.length === 0) {
            return res.status(400).json({ error: 'items array is required' });
        }
        try {
            const pickupDateId = await findPickupDateId(pool, date, location);
            if (!pickupDateId) {
                return res.status(404).json({ error: 'Pickup date not found.' });
            }
            const normalizedItems = items
                .map((item) => ({
                    henId: Number(item?.hen_id ?? item?.henId),
                    stock: Number(item?.stock)
                }))
                .filter((item) => Number.isFinite(item.henId));
            const henIds = normalizedItems.map((item) => item.henId);
            const stocks = normalizedItems.map((item) =>
                Number.isFinite(item.stock) && item.stock >= 0 ? Math.floor(item.stock) : 0
            );
            if (henIds.length === 0) {
                return res.status(400).json({ error: 'Invalid item payload.' });
            }
            await pool.query(
                `
                INSERT INTO pickup_stock (pickup_date_id, hen_id, stock)
                SELECT $1, UNNEST($2::int[]), UNNEST($3::int[])
                ON CONFLICT (pickup_date_id, hen_id)
                DO UPDATE SET stock = EXCLUDED.stock
                `,
                [pickupDateId, henIds, stocks]
            );
            return res.json({ success: true });
        } catch (err) {
            return sendServerError(res, err, 'Failed to update pickup stock');
        }
    });

    app.put('/api/admin/orders/status', checkAuth, async (req, res) => {
        const { ids } = req.body || {};
        const status = sanitizeText(req.body?.status, 50).toLowerCase();
        if (!Array.isArray(ids) || ids.length === 0) {
            return res.status(400).json({ error: 'ids array is required' });
        }
        if (!ADMIN_ALLOWED_ORDER_STATUSES.has(status)) {
            return res.status(400).json({ error: 'Invalid status value.' });
        }
        try {
            await pool.query(
                'UPDATE orders SET status = $1 WHERE id::text = ANY($2::text[])',
                [status, ids.map(String)]
            );
            return res.json({ success: true, message: 'Status updated' });
        } catch (err) {
            return sendServerError(res, err, 'Failed to update order statuses');
        }
    });

    app.post('/api/admin/email', checkAuth, async (req, res) => {
        const { messages, recipients, subject, message } = req.body;
        let sendMessages = [];

        if (Array.isArray(messages) && messages.length > 0) {
            sendMessages = messages.map((item) => ({
                ...item,
                to: typeof item?.to === 'string' ? { email: item.to } : item?.to
            }));
        } else if (Array.isArray(recipients) && subject && message) {
            sendMessages = recipients.map((recipient) => ({
                to: typeof recipient === 'string' ? { email: recipient } : recipient,
                subject,
                text: message
            }));
        }

        if (sendMessages.length === 0) {
            return res.status(400).json({ error: 'No email recipients provided.' });
        }

        const validMessages = sendMessages.filter((item) => {
            const toEmail = sanitizeText(item?.to?.email, 320).toLowerCase();
            return (
                isValidEmail(toEmail)
                && sanitizeText(item?.subject, 300).length > 0
                && (sanitizeText(item?.text, 20000).length > 0 || item?.attachments?.length || item?.csv)
            );
        });

        if (validMessages.length === 0) {
            return res.status(400).json({ error: 'No valid email recipients provided.' });
        }
        if (validMessages.length > 500) {
            return res.status(400).json({ error: 'Too many email recipients in one request.' });
        }

        const sendWithConcurrency = async (items, limit, worker) => {
            let index = 0;
            const runWorker = async () => {
                while (index < items.length) {
                    const currentIndex = index;
                    index += 1;
                    await worker(items[currentIndex], currentIndex);
                }
            };
            const workers = Array.from(
                { length: Math.min(limit, items.length) },
                () => runWorker()
            );
            await Promise.all(workers);
        };

        try {
            await sendWithConcurrency(validMessages, 10, async (item) => {
                const toEmail = sanitizeText(item.to.email, 320).toLowerCase();
                const toName = sanitizeText(item?.to?.name, 120);
                const attachments = Array.isArray(item.attachments)
                    ? item.attachments.map((attachment) => ({
                        Name: attachment.filename || attachment.name || 'attachment',
                        Content: attachment.content,
                        ContentType: attachment.type || 'text/plain'
                    }))
                    : (item.csv
                        ? [{
                            Name: item.filename || 'pickup-orders.csv',
                            Content: Buffer.from(item.csv, 'utf8').toString('base64'),
                            ContentType: 'text/csv'
                        }]
                        : undefined);
                await sendEmailMessage({
                    to: {
                        email: toEmail,
                        name: toName || undefined
                    },
                    subject: sanitizeText(item.subject, 300),
                    text: sanitizeText(item.text, 20000),
                    attachments
                });
            });

            return res.json({ success: true, sent: validMessages.length });
        } catch (err) {
            return sendServerError(res, err, 'Email send failed');
        }
    });
};

module.exports = {
    registerAdminRoutes
};
