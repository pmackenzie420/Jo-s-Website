const {
    fetchPickupDates,
    findPickupDateId,
    fetchAllPickupStocks,
    fetchReservedPickupItems
} = require('../logic/pickup');
const {
    verifyPassword,
    parseAllowlist,
    isIpAllowed
} = require('../utils/password-auth');
const {
    normalizeLanguage,
    formatPickupDateLong,
    escapeHtml,
    extractEmailAddress
} = require('../utils/helpers');
const {
    LOCATION_DETAILS,
    COMPANY_CONTACT
} = require('../config/constants');
const { buildBrandedEmailHtml } = require('../utils/email-template');

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

const parseBoolean = (value, fallback = false) => {
    if (typeof value === 'boolean') return value;
    if (typeof value === 'string') {
        const normalized = value.trim().toLowerCase();
        if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
        if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
    }
    if (typeof value === 'number') {
        if (value === 1) return true;
        if (value === 0) return false;
    }
    return fallback;
};

const isIsoDateValue = (value) => {
    const str = String(value || '').trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(str)) return false;
    const [y, m, d] = str.split('-').map(Number);
    const date = new Date(y, m - 1, d);
    return date.getFullYear() === y && date.getMonth() === m - 1 && date.getDate() === d;
};

const getLocationLabel = (value) => {
    const key = String(value || '').trim();
    if (!key) return 'Unknown';
    return LOCATION_DETAILS[key]?.label || key;
};

const PICKUP_DATE_CHANGE_COPY = {
    en: {
        subject: (fromDate, toDate) => `Pickup Date Change: ${fromDate} to ${toDate}`,
        greeting: (name) => `Hi ${name || 'there'},`,
        intro: 'This is an important update regarding your pickup order.',
        reasonLine: (fromDate, fromLocation, toDate, toLocation) =>
            `Due to circumstances beyond our control, your pickup date has changed from ${fromDate} (${fromLocation}) to ${toDate} (${toLocation}).`,
        apologyLine: 'We are sorry for any inconvenience that may arise following this modification.',
        actionLine: 'Your order is still active and linked to the new pickup date.',
        helpLine: (phone) =>
            `If you have any questions, please call ${phone}.`,
        signoff: 'Thank you,',
        team: `${COMPANY_CONTACT.name} team`
    },
    fr: {
        subject: (fromDate, toDate) => `Changement de date de ramassage : ${fromDate} au ${toDate}`,
        greeting: (name) => `Bonjour ${name || ''},`.trim(),
        intro: 'Voici une mise à jour importante concernant votre commande de ramassage.',
        reasonLine: (fromDate, fromLocation, toDate, toLocation) =>
            `En raison de circonstances hors de notre contrôle, votre date de ramassage a été modifiée du ${fromDate} (${fromLocation}) au ${toDate} (${toLocation}).`,
        apologyLine: 'Nous sommes désolés des inconvénients que cette modification pourrait entraîner.',
        actionLine: 'Votre commande est toujours active et liée à la nouvelle date de ramassage.',
        helpLine: (phone) =>
            `Si vous avez des questions, veuillez appeler au ${phone}.`,
        signoff: 'Merci,',
        team: `L'équipe des ${COMPANY_CONTACT.name}`
    }
};

const getDefaultNoReplyAddress = () => {
    const fromAddress = extractEmailAddress(process.env.EMAIL_FROM);
    const atIndex = fromAddress.lastIndexOf('@');
    if (atIndex <= 0 || atIndex === fromAddress.length - 1) return '';
    const domain = fromAddress.slice(atIndex + 1).trim().toLowerCase();
    if (!domain) return '';
    return `no-reply@${domain}`;
};

const DATE_CHANGE_EMAIL_FROM = String(
    process.env.DATE_CHANGE_EMAIL_FROM
    || process.env.CONFIRMATION_EMAIL_FROM
    || getDefaultNoReplyAddress()
    || process.env.EMAIL_FROM
    || ''
).trim();

const DATE_CHANGE_EMAIL_REPLY_TO = String(
    process.env.DATE_CHANGE_EMAIL_REPLY_TO
    || getDefaultNoReplyAddress()
).trim();

const DATE_CHANGE_EMAIL_HEADERS = {
    'Auto-Submitted': 'auto-generated',
    'X-Auto-Response-Suppress': 'All',
    Precedence: 'bulk'
};
const normalizeEmailText = (value) => String(value || '').replace(/\r\n/g, '\n').trim();

const buildPlainTextEmailHtml = ({ text }) => {
    const normalized = normalizeEmailText(text);
    const blocks = normalized
        .split(/\n{2,}/)
        .map((block) => block.trim())
        .filter(Boolean);

    const contentHtml = (blocks.length > 0 ? blocks : [''])
        .map((block, index, all) => {
            const lines = block.split('\n').map((line) => escapeHtml(line.trim()));
            const marginBottom = index === all.length - 1 ? '0' : '16px';
            return `<p style="margin: 0 0 ${marginBottom};">${lines.join('<br>')}</p>`;
        })
        .join('');

    return buildBrandedEmailHtml({ contentHtml });
};

const buildPickupDateChangeEmail = ({
    language,
    customerName,
    fromDateValue,
    fromLocation,
    toDateValue,
    toLocation
}) => {
    const normalizedLanguage = normalizeLanguage(language);
    const copy = PICKUP_DATE_CHANGE_COPY[normalizedLanguage] || PICKUP_DATE_CHANGE_COPY.en;
    const fromDateLabel = formatPickupDateLong(fromDateValue, normalizedLanguage);
    const toDateLabel = formatPickupDateLong(toDateValue, normalizedLanguage);
    const fromLocationLabel = getLocationLabel(fromLocation);
    const toLocationLabel = getLocationLabel(toLocation);

    const lines = [
        copy.greeting(customerName),
        '',
        copy.intro,
        copy.reasonLine(fromDateLabel, fromLocationLabel, toDateLabel, toLocationLabel),
        '',
        copy.apologyLine,
        '',
        copy.actionLine,
        copy.helpLine(COMPANY_CONTACT.phone),
        '',
        copy.signoff,
        copy.team
    ].filter(Boolean);

    const text = lines.join('\n');
    const contentHtml = [
        `<p style="margin: 0 0 12px;">${escapeHtml(copy.greeting(customerName))}</p>`,
        `<p style="margin: 0 0 12px;">${escapeHtml(copy.intro)}</p>`,
        `<p style="margin: 0 0 12px;">${escapeHtml(copy.reasonLine(fromDateLabel, fromLocationLabel, toDateLabel, toLocationLabel))}</p>`,
        `<p style="margin: 0 0 12px;">${escapeHtml(copy.apologyLine)}</p>`,
        `<p style="margin: 0 0 12px;">${escapeHtml(copy.actionLine)}</p>`,
        `<p style="margin: 0 0 14px;">${escapeHtml(copy.helpLine(COMPANY_CONTACT.phone))}</p>`,
        `<p style="margin: 0;">${escapeHtml(copy.signoff)}<br>${escapeHtml(copy.team)}</p>`
    ].join('');
    const subject = copy.subject(fromDateLabel, toDateLabel);
    const html = buildBrandedEmailHtml({ contentHtml });

    return {
        subject,
        text,
        html
    };
};

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
        handlePickupStockRequest,
        releaseReservedOrder = async () => ({ status: 'not_reserved' }),
        verifyCheckoutEmail
    } = deps;
    const verifyEmail = typeof verifyCheckoutEmail === 'function'
        ? verifyCheckoutEmail
        : null;

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

    const runInTransaction = async (work) => {
        if (typeof pool?.connect !== 'function') {
            return work({
                query: (...args) => pool.query(...args)
            });
        }

        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            const result = await work(client);
            await client.query('COMMIT');
            return result;
        } catch (err) {
            try {
                await client.query('ROLLBACK');
            } catch (_rollbackErr) {
                // Ignore rollback failures here; sendServerError will handle primary error.
            }
            throw err;
        } finally {
            client.release();
        }
    };

    const loadDateChangeRecipients = async (client, { sourceDateValue, sourceLocation }) => {
        const result = await client.query(
            `
            SELECT
                orders.customer_email,
                orders.language,
                customers.name AS customer_name
            FROM orders
            LEFT JOIN customers
                ON customers.id = orders.customer_id
            WHERE orders.pickup_date = $1
              AND orders.pickup_location = $2
              AND COALESCE(TRIM(orders.customer_email), '') <> ''
              AND LOWER(COALESCE(orders.status, 'pending')) NOT IN ('cancelled', 'picked_up', 'fulfilled')
            ORDER BY orders.created_at DESC, orders.id DESC
            `,
            [sourceDateValue, sourceLocation]
        );

        const recipientsByEmail = new Map();
        for (const row of result.rows) {
            const email = sanitizeText(row?.customer_email, 320).toLowerCase();
            if (!isValidEmail(email) || recipientsByEmail.has(email)) {
                continue;
            }
            recipientsByEmail.set(email, {
                email,
                name: sanitizeText(row?.customer_name, 120),
                language: normalizeLanguage(row?.language)
            });
        }

        return Array.from(recipientsByEmail.values());
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
            const [hens, dates, pickupStocks, pickupReservedItems] = await Promise.all([
                fetchActiveHens(),
                fetchPickupDates(pool),
                fetchAllPickupStocks(pool),
                fetchReservedPickupItems(pool)
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

            const pickupReservedByKey = {};
            for (const row of pickupReservedItems) {
                const dateValue = formatPickupDate(row.date_value);
                const location = sanitizeText(row.location, 40);
                const key = `${dateValue}::${location}`;
                if (!pickupReservedByKey[key]) {
                    pickupReservedByKey[key] = {};
                }
                const henId = Number(row.hen_id);
                const reserved = Number(row.reserved || 0);
                if (!Number.isInteger(henId) || henId <= 0) continue;
                pickupReservedByKey[key][henId] =
                    (pickupReservedByKey[key][henId] || 0) + Math.max(reserved, 0);
            }

            return res.json({
                hens,
                dates,
                pickupStocks: pickupStocksByKey,
                pickupReserved: pickupReservedByKey
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
        const dateValue = sanitizeText(req.body?.date_value, 40);
        const location = sanitizeText(req.body?.location, 40);
        if (!dateValue || !location) {
            return res.status(400).send('Date and location are required.');
        }
        try {
            const existing = await pool.query(
                `
                SELECT id
                FROM pickup_dates
                WHERE date_value = $1 AND location = $2
                ORDER BY created_at ASC, id ASC
                LIMIT 1
                `,
                [dateValue, location]
            );
            if (existing.rows.length > 0) {
                return res.status(409).json({
                    error: 'Pickup date already exists for this location.'
                });
            }

            const result = await pool.query(
                'INSERT INTO pickup_dates (date_value, location) VALUES ($1, $2) RETURNING *',
                [dateValue, location]
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
            if (err?.code === '23505') {
                return res.status(409).json({
                    error: 'Pickup date already exists for this location.'
                });
            }
            return sendServerError(res, err, 'Failed to add pickup date');
        }
    });

    app.put('/api/admin/pickup-dates/:id', checkAuth, async (req, res) => {
        const sourceId = sanitizeText(req.params?.id, 120);
        const targetDateValue = sanitizeText(req.body?.date_value ?? req.body?.dateValue, 40);
        const requestedTargetLocation = sanitizeText(req.body?.location, 40);
        const emailUsers = parseBoolean(req.body?.email_users ?? req.body?.emailUsers, false);

        if (!sourceId) {
            return res.status(400).json({ error: 'Pickup date id is required.' });
        }
        if (!targetDateValue) {
            return res.status(400).json({ error: 'Date is required.' });
        }
        if (!isIsoDateValue(targetDateValue)) {
            return res.status(400).json({ error: 'Date must use YYYY-MM-DD format.' });
        }

        try {
            const updateResult = await runInTransaction(async (client) => {
                const sourceResult = await client.query(
                    `
                    SELECT id, date_value, location
                    FROM pickup_dates
                    WHERE id = $1
                    FOR UPDATE
                    `,
                    [sourceId]
                );
                if (sourceResult.rows.length === 0) {
                    return { status: 'missing_source' };
                }

                const source = sourceResult.rows[0];
                const sourceDateValue = formatPickupDate(source.date_value);
                const sourceLocation = sanitizeText(source.location, 40);
                const targetLocation = sourceLocation;

                if (requestedTargetLocation && requestedTargetLocation !== sourceLocation) {
                    return {
                        status: 'location_change_not_allowed',
                        sourceLocation
                    };
                }

                if (
                    sourceDateValue === targetDateValue
                ) {
                    return {
                        status: 'no_change',
                        sourceDateValue,
                        sourceLocation
                    };
                }

                const recipients = emailUsers
                    ? await loadDateChangeRecipients(client, { sourceDateValue, sourceLocation })
                    : [];

                const targetResult = await client.query(
                    `
                    SELECT id
                    FROM pickup_dates
                    WHERE date_value = $1
                      AND location = $2
                      AND id <> $3
                    ORDER BY created_at ASC, id ASC
                    LIMIT 1
                    FOR UPDATE
                    `,
                    [targetDateValue, targetLocation, sourceId]
                );

                let merged = false;
                if (targetResult.rows.length > 0) {
                    merged = true;
                    const targetId = targetResult.rows[0].id;

                    const movedOrders = await client.query(
                        `
                        UPDATE orders
                        SET pickup_date = $1, pickup_location = $2
                        WHERE pickup_date = $3
                          AND pickup_location = $4
                        `,
                        [targetDateValue, targetLocation, sourceDateValue, sourceLocation]
                    );

                    await client.query(
                        `
                        INSERT INTO pickup_stock (pickup_date_id, hen_id, stock)
                        SELECT $1, hen_id, stock
                        FROM pickup_stock
                        WHERE pickup_date_id = $2
                        ON CONFLICT (pickup_date_id, hen_id)
                        DO UPDATE SET stock = pickup_stock.stock + EXCLUDED.stock
                        `,
                        [targetId, sourceId]
                    );

                    await client.query('DELETE FROM pickup_dates WHERE id = $1', [sourceId]);

                    return {
                        status: 'updated',
                        merged,
                        movedOrders: movedOrders.rowCount || 0,
                        recipients,
                        fromDateValue: sourceDateValue,
                        fromLocation: sourceLocation,
                        toDateValue: targetDateValue,
                        toLocation: targetLocation
                    };
                }

                await client.query(
                    `
                    UPDATE pickup_dates
                    SET date_value = $1, location = $2
                    WHERE id = $3
                    `,
                    [targetDateValue, targetLocation, sourceId]
                );

                const movedOrders = await client.query(
                    `
                    UPDATE orders
                    SET pickup_date = $1, pickup_location = $2
                    WHERE pickup_date = $3
                      AND pickup_location = $4
                    `,
                    [targetDateValue, targetLocation, sourceDateValue, sourceLocation]
                );

                return {
                    status: 'updated',
                    merged,
                    movedOrders: movedOrders.rowCount || 0,
                    recipients,
                    fromDateValue: sourceDateValue,
                    fromLocation: sourceLocation,
                    toDateValue: targetDateValue,
                    toLocation: targetLocation
                };
            });

            if (updateResult.status === 'missing_source') {
                return res.status(404).json({ error: 'Pickup date not found.' });
            }

            if (updateResult.status === 'location_change_not_allowed') {
                return res.status(400).json({
                    error: 'Changing pickup location is not supported from this action.'
                });
            }

            if (updateResult.status === 'no_change') {
                return res.status(400).json({
                    error: 'Pickup date is unchanged.'
                });
            }

            let emailSent = 0;
            let emailFailed = 0;
            if (emailUsers && updateResult.recipients.length > 0) {
                await sendWithConcurrency(updateResult.recipients, 10, async (recipient) => {
                    const payload = buildPickupDateChangeEmail({
                        language: recipient.language,
                        customerName: recipient.name,
                        fromDateValue: updateResult.fromDateValue,
                        fromLocation: updateResult.fromLocation,
                        toDateValue: updateResult.toDateValue,
                        toLocation: updateResult.toLocation
                    });
                    try {
                        await sendEmailMessage({
                            to: {
                                email: recipient.email,
                                name: recipient.name || undefined
                            },
                            subject: payload.subject,
                            text: payload.text,
                            html: payload.html,
                            from: DATE_CHANGE_EMAIL_FROM || undefined,
                            replyTo: DATE_CHANGE_EMAIL_REPLY_TO || undefined,
                            headers: DATE_CHANGE_EMAIL_HEADERS
                        });
                        emailSent += 1;
                    } catch (_emailErr) {
                        emailFailed += 1;
                    }
                });
            }

            return res.json({
                success: true,
                merged: updateResult.merged,
                movedOrders: updateResult.movedOrders,
                emailRequested: emailUsers,
                emailRecipients: updateResult.recipients.length,
                emailSent,
                emailFailed,
                fromDateValue: updateResult.fromDateValue,
                fromLocation: updateResult.fromLocation,
                toDateValue: updateResult.toDateValue,
                toLocation: updateResult.toLocation
            });
        } catch (err) {
            if (err?.code === '23505') {
                return res.status(409).json({
                    error: 'Pickup date already exists for this location.'
                });
            }
            return sendServerError(res, err, 'Failed to update pickup date');
        }
    });

    app.delete('/api/admin/pickup-dates/:id', checkAuth, async (req, res) => {
        const { id } = req.params;
        try {
            const targetDate = await pool.query(
                'SELECT date_value, location FROM pickup_dates WHERE id = $1',
                [id]
            );
            if (targetDate.rows.length === 0) {
                return res.json({ success: true });
            }

            const dateValue = targetDate.rows[0].date_value;
            const location = targetDate.rows[0].location;
            const activeOrders = await pool.query(
                `
                SELECT COUNT(*)::int AS count
                FROM orders
                WHERE pickup_date = $1
                  AND pickup_location = $2
                  AND LOWER(COALESCE(status, 'pending')) <> 'cancelled'
                `,
                [dateValue, location]
            );
            if (Number(activeOrders.rows[0]?.count || 0) > 0) {
                return res.status(409).json({
                    error: 'Cannot delete pickup date with active orders.'
                });
            }

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
        const uniqueIds = Array.from(
            new Set(
                ids.map((value) => String(value || '').trim())
                    .filter(Boolean)
            )
        );
        if (uniqueIds.length === 0) {
            return res.status(400).json({ error: 'ids array is required' });
        }
        if (!ADMIN_ALLOWED_ORDER_STATUSES.has(status)) {
            return res.status(400).json({ error: 'Invalid status value.' });
        }
        try {
            if (status === 'cancelled') {
                const directUpdateIds = [];
                for (const orderId of uniqueIds) {
                    const releaseResult = await releaseReservedOrder(orderId);
                    if (releaseResult?.status === 'not_reserved') {
                        directUpdateIds.push(orderId);
                    }
                }
                if (directUpdateIds.length > 0) {
                    await pool.query(
                        'UPDATE orders SET status = $1 WHERE id::text = ANY($2::text[])',
                        [status, directUpdateIds]
                    );
                }
            } else {
                await pool.query(
                    'UPDATE orders SET status = $1 WHERE id::text = ANY($2::text[])',
                    [status, uniqueIds]
                );
            }
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

        try {
            let sentCount = 0;
            const failedRecipients = [];
            await sendWithConcurrency(validMessages, 10, async (item) => {
                const toEmail = sanitizeText(item.to.email, 320).toLowerCase();
                const toName = sanitizeText(item?.to?.name, 120);
                const normalizedSubject = sanitizeText(item.subject, 300);
                const normalizedText = sanitizeText(item.text, 20000);
                const providedHtml = String(item?.html || '').trim();
                const normalizedHtml = providedHtml
                    || buildPlainTextEmailHtml({
                        text: normalizedText
                    });
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
                if (verifyEmail) {
                    try {
                        const verification = await verifyEmail(toEmail);
                        if (verification.shouldBlock) {
                            failedRecipients.push({
                                email: toEmail,
                                name: toName || undefined,
                                reason: verification.message || 'Undeliverable address'
                            });
                            return;
                        }
                    } catch (_verifyErr) {
                        // verification unavailable — proceed with send
                    }
                }
                try {
                    await sendEmailMessage({
                        to: {
                            email: toEmail,
                            name: toName || undefined
                        },
                        subject: normalizedSubject,
                        text: normalizedText,
                        html: normalizedHtml,
                        attachments
                    });
                    sentCount += 1;
                } catch (_sendErr) {
                    failedRecipients.push({ email: toEmail, name: toName || undefined });
                }
            });

            return res.json({
                success: failedRecipients.length === 0,
                sent: sentCount,
                failed: failedRecipients.length,
                failedRecipients
            });
        } catch (err) {
            return sendServerError(res, err, 'Email send failed');
        }
    });
};

module.exports = {
    registerAdminRoutes
};
