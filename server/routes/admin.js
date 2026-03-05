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
    extractEmailAddress,
    parseOrderItems
} = require('../utils/helpers');
const { normalizePhoneForStorage } = require('../logic/checkout-validation');
const { reserveStockForItems, releaseStockForItems } = require('../logic/order-stock');
const {
    calculateItemPrice,
    isLohmannHenName,
    getMinimumOrderQuantity,
    getDepositEligibleMinQty,
    getDepositRequiredAboveQty,
    getDepositRate,
    isPickupLocationRestricted,
    isLambName
} = require('../logic/pricing');
const { createCheckoutSession } = require('../logic/checkout-persistence');
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
    'cancelled',
    'archived'
]);
const ADMIN_EDITABLE_ORDER_STATUSES = new Set(['pending', 'paid']);
const ADMIN_DELETABLE_ORDER_STATUSES = new Set(['pending', 'paid']);
const VALID_ADMIN_PAYMENT_METHODS = new Set(['etransfer', 'cash', 'cheque', 'credit_card']);

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

const formatCents = (cents) => {
    const numeric = Number(cents);
    const safe = Number.isFinite(numeric) ? numeric : 0;
    return `$${(safe / 100).toFixed(2)}`;
};

const normalizeOrderItems = (rawItems) => {
    if (!Array.isArray(rawItems)) return [];
    const totals = new Map();
    for (const item of rawItems) {
        const id = Number(item?.id);
        const quantityRaw = Number(item?.quantity ?? item?.qty);
        const quantity = Number.isFinite(quantityRaw) ? Math.floor(quantityRaw) : 0;
        if (!Number.isInteger(id) || id <= 0 || quantity <= 0) {
            continue;
        }
        totals.set(id, (totals.get(id) || 0) + quantity);
    }
    return Array.from(totals.entries())
        .map(([id, quantity]) => ({ id, quantity }))
        .sort((a, b) => a.id - b.id);
};

const normalizeStoredOrderItems = (rawItems) => {
    const parsed = parseOrderItems(rawItems);
    if (!Array.isArray(parsed)) return [];
    const totalsById = new Map();
    for (const item of parsed) {
        const id = Number(item?.id);
        const quantityRaw = Number(item?.quantity ?? item?.qty);
        const quantity = Number.isFinite(quantityRaw) ? Math.floor(quantityRaw) : 0;
        if (!Number.isInteger(id) || id <= 0 || quantity <= 0) {
            continue;
        }
        const current = totalsById.get(id) || { id, quantity: 0, name: '' };
        totalsById.set(id, {
            id,
            quantity: current.quantity + quantity,
            name: current.name || String(item?.name || '').trim().slice(0, 200)
        });
    }
    return Array.from(totalsById.values())
        .sort((first, second) => first.id - second.id);
};

const buildStatusEditBlockedMessage = (status) => {
    const normalized = String(status || '').trim().toLowerCase();
    if (normalized === 'reserved') {
        return 'This order is awaiting Stripe payment and cannot be edited.';
    }
    if (normalized === 'picked_up' || normalized === 'fulfilled') {
        return 'Picked-up orders cannot be edited.';
    }
    if (normalized === 'cancelled') {
        return 'Cancelled orders cannot be edited.';
    }
    return `Orders with status "${normalized || 'unknown'}" cannot be edited.`;
};

const buildStatusDeleteBlockedMessage = (status) => {
    const normalized = String(status || '').trim().toLowerCase();
    if (normalized === 'reserved') {
        return 'This order is awaiting Stripe payment and cannot be deleted.';
    }
    if (normalized === 'picked_up' || normalized === 'fulfilled') {
        return 'Picked-up orders cannot be deleted.';
    }
    if (normalized === 'cancelled') {
        return 'Cancelled orders cannot be deleted.';
    }
    if (normalized === 'archived') {
        return 'Archived orders cannot be deleted.';
    }
    return `Orders with status "${normalized || 'unknown'}" cannot be deleted.`;
};

const createInsufficientStockError = ({
    henName,
    required,
    available,
    pickupDate,
    pickupLocation
}) => {
    const err = new Error('Insufficient pickup stock while updating order.');
    err.code = 'ADMIN_ORDER_INSUFFICIENT_STOCK';
    err.meta = {
        henName: String(henName || 'Item'),
        required: Math.max(Number(required) || 0, 0),
        available: Math.max(Number(available) || 0, 0),
        pickupDate: String(pickupDate || ''),
        pickupLocation: String(pickupLocation || '')
    };
    return err;
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
        verifyCheckoutEmail,
        stripe,
        CHECKOUT_RESERVATION_TTL_MINUTES = 30,
        getRequestBaseUrl,
        finalizeOrderFromSession
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
        const { password } = req.body || {};
        const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
        const ADMIN_PASSWORD_HASH = process.env.ADMIN_PASSWORD_HASH;
        if (!ADMIN_PASSWORD && !ADMIN_PASSWORD_HASH) {
            return res.status(500).json({ error: 'Admin auth not configured.' });
        }
        const allowlist = parseAllowlist(process.env.ADMIN_LOGIN_IP_ALLOWLIST);
        if (!isIpAllowed(req, allowlist)) {
            return res.status(403).json({ error: 'Admin login blocked from this IP.' });
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

    app.post('/api/admin/orders', checkAuth, async (req, res) => {
        try {
            const headerLanguage = req.get('accept-language') || '';
            const orderLanguage = normalizeLanguage(req.body?.language || headerLanguage);

            const customerName = sanitizeText(req.body?.customer?.name, 200);
            const customerPhoneRaw = sanitizeText(req.body?.customer?.phone, 50);
            const customerPhone = normalizePhoneForStorage(customerPhoneRaw);
            const customerEmailRaw = sanitizeText(req.body?.customer?.email, 320);
            const customerEmail = customerEmailRaw ? customerEmailRaw.toLowerCase() : '';
            const customerAddress = sanitizeText(req.body?.customer?.address, 300);

            const pickupDate = sanitizeText(req.body?.pickup?.date, 40);
            const pickupLocation = sanitizeText(req.body?.pickup?.location, 40);

            const paymentMethodRaw = sanitizeText(req.body?.payment?.method, 30).toLowerCase();
            const paymentMethod = VALID_ADMIN_PAYMENT_METHODS.has(paymentMethodRaw)
                ? paymentMethodRaw
                : 'etransfer';
            const isCreditCard = paymentMethod === 'credit_card';

            const requestedPaymentType = sanitizeText(req.body?.payment?.payment_type, 20).toLowerCase() || 'full';
            const hasAmountPaidField = Boolean(
                req.body?.payment
                && Object.prototype.hasOwnProperty.call(req.body.payment, 'amount_paid_cents')
            );
            const amountPaidCentsRaw = Number(req.body?.payment?.amount_paid_cents);

            const items = normalizeOrderItems(req.body?.items);

            if (!customerName) {
                return res.status(400).json({ error: 'Customer name is required.' });
            }
            if (!customerPhone || customerPhone.length < 7) {
                return res.status(400).json({ error: 'Valid customer phone is required.' });
            }
            if (customerEmail && !isValidEmail(customerEmail)) {
                return res.status(400).json({ error: 'Customer email is invalid.' });
            }
            if (isCreditCard && !customerEmail) {
                return res.status(400).json({ error: 'Customer email is required for credit card orders.' });
            }
            if (!pickupDate || !pickupLocation) {
                return res.status(400).json({ error: 'Pickup date and location are required.' });
            }
            if (items.length === 0) {
                return res.status(400).json({ error: 'At least one order item is required.' });
            }
            if (hasAmountPaidField && (!Number.isFinite(amountPaidCentsRaw) || amountPaidCentsRaw < 0)) {
                return res.status(400).json({ error: 'Amount paid must be a valid non-negative amount.' });
            }

            const pickupDateId = await findPickupDateId(pool, pickupDate, pickupLocation);
            if (!pickupDateId) {
                return res.status(400).json({ error: 'Selected pickup date is not available.' });
            }

            const itemIds = items.map((item) => item.id);
            const hensResult = await pool.query(
                'SELECT id, name FROM hens WHERE is_active = true AND id = ANY($1::int[])',
                [itemIds]
            );
            const henMap = new Map(hensResult.rows.map((row) => [Number(row.id), row]));
            if (henMap.size !== itemIds.length) {
                return res.status(400).json({ error: 'Some requested items are unavailable.' });
            }

            const stockResult = await pool.query(
                'SELECT hen_id, stock FROM pickup_stock WHERE pickup_date_id = $1 AND hen_id = ANY($2::int[])',
                [pickupDateId, itemIds]
            );
            const stockMap = new Map(
                stockResult.rows.map((row) => [Number(row.hen_id), Number(row.stock || 0)])
            );

            const orderItemsForStorage = [];
            let totalCents = 0;
            let lohmannQty = 0;
            let lohmannSubtotalCents = 0;
            let nonLohmannSubtotalCents = 0;
            let hasLambItems = false;

            for (const item of items) {
                const hen = henMap.get(Number(item.id));
                if (!hen) continue;

                const quantity = item.quantity;
                if (!Number.isFinite(quantity) || quantity <= 0) continue;

                if (isPickupLocationRestricted(hen.name, pickupLocation)) {
                    return res.status(400).json({
                        error: `Item is not available for ${getLocationLabel(pickupLocation)} pickups.`
                    });
                }

                const minimumOrderQty = getMinimumOrderQuantity(hen.name);
                if (minimumOrderQty > 0 && quantity < minimumOrderQty) {
                    return res.status(400).json({
                        error: `Minimum order is ${minimumOrderQty} for ${hen.name}.`
                    });
                }

                const availableStock = stockMap.get(Number(hen.id)) ?? 0;
                if (availableStock < quantity) {
                    return res.status(409).json({
                        error: `Insufficient stock for ${hen.name}.`
                    });
                }

                const unitCents = calculateItemPrice(hen.name, quantity);
                const lineCents = unitCents * quantity;
                totalCents += lineCents;
                if (isLohmannHenName(hen.name)) {
                    lohmannQty += quantity;
                    lohmannSubtotalCents += lineCents;
                } else {
                    nonLohmannSubtotalCents += lineCents;
                    if (isLambName(hen.name)) {
                        hasLambItems = true;
                    }
                }
                orderItemsForStorage.push({
                    id: Number(hen.id),
                    quantity,
                    name: hen.name,
                    unit_cents: unitCents,
                    line_cents: lineCents
                });
            }

            if (orderItemsForStorage.length === 0 || totalCents <= 0) {
                return res.status(400).json({ error: 'At least one purchasable item is required.' });
            }

            // Deposit eligibility — same logic as regular checkout
            const depositEligibleMinQty = Math.max(Number(getDepositEligibleMinQty() || 13), 1);
            const depositRate = Math.min(Math.max(Number(getDepositRate() || 0.25), 0), 1);
            const lohmannDepositEligible = lohmannQty >= depositEligibleMinQty;
            const depositEligible = lohmannDepositEligible || hasLambItems;
            const isDepositRequested = requestedPaymentType === 'deposit';
            const isDeposit = isDepositRequested;

            const lohmannDepositCents = lohmannDepositEligible
                ? Math.floor(lohmannSubtotalCents * depositRate)
                : 0;
            const depositNowCents = nonLohmannSubtotalCents + lohmannDepositCents;
            const defaultDepositCents = depositEligible
                ? depositNowCents
                : (isCreditCard ? totalCents : depositNowCents);

            let amountPaidCents;
            let amountDueCents;
            let paymentType;
            let status;

            if (isDeposit) {
                if (hasAmountPaidField) {
                    amountPaidCents = Math.floor(amountPaidCentsRaw);
                    if (amountPaidCents > totalCents) {
                        return res.status(400).json({ error: 'Amount paid cannot exceed the order total.' });
                    }
                } else {
                    amountPaidCents = defaultDepositCents;
                }
                amountDueCents = Math.max(totalCents - amountPaidCents, 0);
                paymentType = amountDueCents > 0 ? 'deposit' : 'full';
            } else {
                amountPaidCents = totalCents;
                amountDueCents = 0;
                paymentType = 'full';
            }

            if (isCreditCard && amountPaidCents <= 0) {
                return res.status(400).json({ error: 'Amount charged must be greater than zero for credit card orders.' });
            }

            status = isCreditCard
                ? 'reserved'
                : (amountPaidCents > 0 ? 'paid' : 'pending');

            const orderId = await runInTransaction(async (client) => {
                let customerId;
                const existingCust = await client.query(
                    'SELECT id FROM customers WHERE phone = $1 FOR UPDATE',
                    [customerPhone]
                );

                if (existingCust.rows.length > 0) {
                    customerId = existingCust.rows[0].id;
                    await client.query(
                        'UPDATE customers SET name=$1, email=$2, address=$3 WHERE id=$4',
                        [customerName, customerEmail || null, customerAddress || null, customerId]
                    );
                } else {
                    const newCust = await client.query(
                        'INSERT INTO customers (name, phone, email, address) VALUES ($1, $2, $3, $4) RETURNING id',
                        [customerName, customerPhone, customerEmail || null, customerAddress || null]
                    );
                    customerId = newCust.rows[0].id;
                }

                await reserveStockForItems(client, {
                    pickupDateId,
                    items,
                    orderId: 'admin'
                });

                const newOrder = await client.query(
                    `INSERT INTO orders (
                        customer_id,
                        customer_email,
                        total_cents,
                        items,
                        status,
                        pickup_date,
                        pickup_location,
                        payment_type,
                        amount_paid_cents,
                        amount_due_cents,
                        language,
                        payment_method
                    )
                    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
                    RETURNING id`,
                    [
                        customerId,
                        customerEmail || null,
                        totalCents,
                        JSON.stringify(orderItemsForStorage),
                        status,
                        pickupDate,
                        pickupLocation,
                        paymentType,
                        amountPaidCents,
                        amountDueCents,
                        orderLanguage,
                        paymentMethod
                    ]
                );
                return newOrder.rows[0].id;
            });

            if (isCreditCard && stripe) {
                let stripeLineItems;
                if (paymentType === 'deposit') {
                    stripeLineItems = [{
                        price_data: {
                            currency: 'cad',
                            product_data: {
                                name: 'Order deposit',
                                description: `Total ${formatCents(totalCents)} - Remaining ${formatCents(amountDueCents)}`
                            },
                            unit_amount: amountPaidCents
                        },
                        quantity: 1
                    }];
                } else {
                    stripeLineItems = orderItemsForStorage.map((item) => ({
                        price_data: {
                            currency: 'cad',
                            product_data: { name: item.name },
                            unit_amount: item.unit_cents
                        },
                        quantity: item.quantity
                    }));
                }

                const baseUrl = getRequestBaseUrl(req) || `${req.protocol}://${req.get('host')}`;
                const session = await createCheckoutSession({
                    stripe,
                    orderId,
                    paymentType,
                    lineItems: stripeLineItems,
                    baseUrl,
                    CHECKOUT_RESERVATION_TTL_MINUTES,
                    successUrl: `${baseUrl}/admin?stripe_order=${orderId}`,
                    cancelUrl: `${baseUrl}/admin?stripe_cancelled=true`
                });

                await pool.query(
                    'UPDATE orders SET stripe_payment_id = $1 WHERE id = $2',
                    [session.id, orderId]
                );

                return res.json({ success: true, orderId, stripeUrl: session.url });
            }

            return res.json({ success: true, orderId });
        } catch (err) {
            if (String(err?.message || '').includes('Insufficient pickup stock')) {
                return res.status(409).json({ error: 'Insufficient stock for one or more items.' });
            }
            return sendServerError(res, err, 'Failed to create admin order');
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
                    const releaseResult = await releaseReservedOrder(orderId, { expireStripeSession: true });
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

    app.put('/api/admin/orders/:id', checkAuth, async (req, res) => {
        const body = req.body || {};
        const orderId = sanitizeText(req.params?.id, 120);
        const pickupDate = sanitizeText(body?.pickup?.date, 40);
        const pickupLocation = sanitizeText(body?.pickup?.location, 40);
        const hasTotalField = Boolean(
            (body?.order && Object.prototype.hasOwnProperty.call(body.order, 'total_cents'))
            || Object.prototype.hasOwnProperty.call(body, 'total_cents')
        );
        const totalCentsRaw = Number(body?.order?.total_cents ?? body?.total_cents);
        const hasItemsField = Object.prototype.hasOwnProperty.call(body, 'items');
        const requestedItems = hasItemsField ? normalizeOrderItems(body?.items) : [];
        const hasAmountPaidField = Boolean(
            body?.payment
            && Object.prototype.hasOwnProperty.call(body.payment, 'amount_paid_cents')
        );
        const amountPaidCentsRaw = Number(body?.payment?.amount_paid_cents);
        const hasCustomerEmailField = Boolean(
            body?.customer
            && Object.prototype.hasOwnProperty.call(body.customer, 'email')
        );
        const customerEmailRaw = hasCustomerEmailField
            ? sanitizeText(body?.customer?.email, 320)
            : '';
        const customerEmail = customerEmailRaw ? customerEmailRaw.toLowerCase() : '';

        if (!orderId) {
            return res.status(400).json({ error: 'Order id is required.' });
        }
        if (!pickupDate || !pickupLocation) {
            return res.status(400).json({ error: 'Pickup date and location are required.' });
        }
        if (!isIsoDateValue(pickupDate)) {
            return res.status(400).json({ error: 'Pickup date must use YYYY-MM-DD format.' });
        }
        if (!hasTotalField && !hasItemsField) {
            return res.status(400).json({ error: 'Order amount is required.' });
        }
        if (hasTotalField) {
            if (!Number.isFinite(totalCentsRaw)) {
                return res.status(400).json({ error: 'Order amount is required.' });
            }
            if (totalCentsRaw <= 0) {
                return res.status(400).json({ error: 'Order amount must be greater than $0.00.' });
            }
        }
        if (hasItemsField && requestedItems.length === 0) {
            return res.status(400).json({ error: 'At least one order item is required.' });
        }
        if (hasAmountPaidField) {
            if (!Number.isFinite(amountPaidCentsRaw)) {
                return res.status(400).json({ error: 'Amount paid must be a valid number.' });
            }
            if (amountPaidCentsRaw < 0) {
                return res.status(400).json({ error: 'Amount paid cannot be negative.' });
            }
        }
        if (hasCustomerEmailField && customerEmail && !isValidEmail(customerEmail)) {
            return res.status(400).json({ error: 'Customer email is invalid.' });
        }

        const reserveStockForItemsAtPickup = async ({
            client,
            pickupDateId,
            pickupDateValue,
            pickupLocationValue,
            items
        }) => {
            if (!pickupDateId || items.length === 0) return;

            const itemIds = items.map((item) => item.id);
            const targetStockResult = await client.query(
                'SELECT hen_id, stock FROM pickup_stock WHERE pickup_date_id = $1 AND hen_id = ANY($2::int[])',
                [pickupDateId, itemIds]
            );
            const targetStockByHenId = new Map(
                targetStockResult.rows.map((row) => [Number(row.hen_id), Number(row.stock || 0)])
            );

            for (const item of items) {
                const required = Number(item.quantity || 0);
                const available = targetStockByHenId.get(Number(item.id)) ?? 0;
                if (required <= 0) continue;
                if (available < required) {
                    throw createInsufficientStockError({
                        henName: item.name || `Item #${item.id}`,
                        required,
                        available,
                        pickupDate: pickupDateValue,
                        pickupLocation: pickupLocationValue
                    });
                }
            }

            for (const item of items) {
                const required = Number(item.quantity || 0);
                if (required <= 0) continue;
                const reserveResult = await client.query(
                    `
                    UPDATE pickup_stock
                    SET stock = stock - $1
                    WHERE pickup_date_id = $2
                      AND hen_id = $3
                      AND stock >= $1
                    RETURNING stock
                    `,
                    [required, pickupDateId, item.id]
                );
                if (reserveResult.rowCount > 0) continue;

                const currentStockResult = await client.query(
                    `
                    SELECT stock
                    FROM pickup_stock
                    WHERE pickup_date_id = $1
                      AND hen_id = $2
                    `,
                    [pickupDateId, item.id]
                );
                const available = Number(currentStockResult.rows[0]?.stock || 0);
                throw createInsufficientStockError({
                    henName: item.name || `Item #${item.id}`,
                    required,
                    available,
                    pickupDate: pickupDateValue,
                    pickupLocation: pickupLocationValue
                });
            }
        };

        const releaseStockForItemsAtPickup = async ({ client, pickupDateId, items }) => {
            if (!pickupDateId || items.length === 0) return;
            for (const item of items) {
                const quantity = Number(item.quantity || 0);
                if (!Number.isInteger(quantity) || quantity <= 0) continue;
                await client.query(
                    `
                    INSERT INTO pickup_stock (pickup_date_id, hen_id, stock)
                    VALUES ($1, $2, $3)
                    ON CONFLICT (pickup_date_id, hen_id)
                    DO UPDATE SET stock = pickup_stock.stock + EXCLUDED.stock
                    `,
                    [pickupDateId, item.id, quantity]
                );
            }
        };

        try {
            const updateResult = await runInTransaction(async (client) => {
                const existingOrderResult = await client.query(
                    `
                    SELECT
                        id,
                        customer_id,
                        customer_email,
                        status,
                        pickup_date,
                        pickup_location,
                        items,
                        total_cents,
                        amount_paid_cents,
                        amount_due_cents,
                        payment_type
                    FROM orders
                    WHERE id = $1
                    FOR UPDATE
                    `,
                    [orderId]
                );
                if (existingOrderResult.rows.length === 0) {
                    return { status: 'missing_order' };
                }

                const existingOrder = existingOrderResult.rows[0];
                const existingStatus = String(existingOrder.status || 'pending').trim().toLowerCase();
                if (!ADMIN_EDITABLE_ORDER_STATUSES.has(existingStatus)) {
                    return {
                        status: 'blocked_status',
                        existingStatus
                    };
                }

                const targetPickupDateId = await findPickupDateId(client, pickupDate, pickupLocation);
                if (!targetPickupDateId) {
                    return { status: 'pickup_unavailable' };
                }

                const sourcePickupDate = formatPickupDate(existingOrder.pickup_date);
                const sourcePickupLocation = sanitizeText(existingOrder.pickup_location, 40);
                if (!sourcePickupDate || !sourcePickupLocation) {
                    return { status: 'source_pickup_missing' };
                }

                const pickupChanged = (
                    sourcePickupDate !== pickupDate
                    || sourcePickupLocation !== pickupLocation
                );

                const storedItems = normalizeStoredOrderItems(existingOrder.items);
                if (storedItems.length === 0 && pickupChanged && !hasItemsField) {
                    return {
                        status: 'missing_items'
                    };
                }

                const storedItemsById = new Map(
                    storedItems.map((item) => [Number(item.id), item])
                );
                let nextItemsForStock = storedItems;
                let nextItemsJson = null;
                let calculatedItemsTotalCents = null;
                let hasLambItems = storedItems.some((item) => isLambName(item.name));

                if (hasItemsField) {
                    if (requestedItems.length === 0) {
                        return {
                            status: 'validation_error',
                            error: 'At least one order item is required.'
                        };
                    }

                    const requestedItemIds = requestedItems.map((item) => item.id);
                    const hensResult = await client.query(
                        'SELECT id, name, is_active FROM hens WHERE id = ANY($1::int[])',
                        [requestedItemIds]
                    );
                    const hensById = new Map(
                        hensResult.rows.map((row) => [Number(row.id), row])
                    );

                    const updatedItemsForStorage = [];
                    let updatedTotalCents = 0;
                    let invalidItemMessage = '';
                    for (const requestedItem of requestedItems) {
                        const existingItem = storedItemsById.get(Number(requestedItem.id)) || null;
                        const matchingHen = hensById.get(Number(requestedItem.id)) || null;
                        if (!matchingHen && !existingItem) {
                            invalidItemMessage = 'Some requested items are unavailable.';
                            break;
                        }
                        const henIsActive = matchingHen
                            ? parseBoolean(matchingHen.is_active, true)
                            : false;
                        if (!henIsActive && !existingItem) {
                            invalidItemMessage = 'Some requested items are unavailable.';
                            break;
                        }

                        const henName = sanitizeText(
                            matchingHen?.name || existingItem?.name || `Item #${requestedItem.id}`,
                            200
                        );
                        if (!henName) {
                            invalidItemMessage = 'Some requested items are unavailable.';
                            break;
                        }

                        if (isPickupLocationRestricted(henName, pickupLocation)) {
                            return {
                                status: 'validation_error',
                                error: `${henName} is not available for ${getLocationLabel(pickupLocation)} pickups.`
                            };
                        }

                        const minimumOrderQty = getMinimumOrderQuantity(henName);
                        if (minimumOrderQty > 0 && requestedItem.quantity < minimumOrderQty) {
                            return {
                                status: 'validation_error',
                                error: `Minimum order is ${minimumOrderQty} for ${henName}.`
                            };
                        }

                        const unitCents = calculateItemPrice(henName, requestedItem.quantity);
                        const lineCents = unitCents * requestedItem.quantity;
                        if (!Number.isFinite(unitCents) || unitCents <= 0 || lineCents <= 0) {
                            return {
                                status: 'validation_error',
                                error: `Unable to price ${henName}.`
                            };
                        }

                        updatedTotalCents += lineCents;
                        updatedItemsForStorage.push({
                            id: Number(requestedItem.id),
                            quantity: Number(requestedItem.quantity),
                            name: henName,
                            unit_cents: unitCents,
                            line_cents: lineCents
                        });
                    }

                    if (invalidItemMessage) {
                        return {
                            status: 'validation_error',
                            error: invalidItemMessage
                        };
                    }
                    if (updatedItemsForStorage.length === 0 || updatedTotalCents <= 0) {
                        return {
                            status: 'validation_error',
                            error: 'At least one purchasable item is required.'
                        };
                    }

                    calculatedItemsTotalCents = updatedTotalCents;
                    hasLambItems = updatedItemsForStorage.some((item) => isLambName(item.name));
                    nextItemsForStock = updatedItemsForStorage.map((item) => ({
                        id: item.id,
                        quantity: item.quantity,
                        name: item.name
                    }));
                    nextItemsJson = JSON.stringify(updatedItemsForStorage);
                }

                const nextTotalCents = hasTotalField
                    ? Math.floor(totalCentsRaw)
                    : Math.floor(Number(calculatedItemsTotalCents || 0));
                if (!Number.isFinite(nextTotalCents) || nextTotalCents <= 0) {
                    return {
                        status: 'validation_error',
                        error: 'Order amount must be greater than $0.00.'
                    };
                }

                const nextItemsById = new Map(
                    nextItemsForStock.map((item) => [Number(item.id), item])
                );
                const allItemIds = new Set([
                    ...storedItemsById.keys(),
                    ...nextItemsById.keys()
                ]);
                const itemsChanged = Array.from(allItemIds).some((itemId) => {
                    const storedQty = Number(storedItemsById.get(itemId)?.quantity || 0);
                    const nextQty = Number(nextItemsById.get(itemId)?.quantity || 0);
                    return storedQty !== nextQty;
                });

                if (pickupChanged || itemsChanged) {
                    const sourcePickupDateId = await findPickupDateId(
                        client,
                        sourcePickupDate,
                        sourcePickupLocation
                    );
                    if (!sourcePickupDateId) {
                        return { status: 'source_pickup_missing' };
                    }

                    if (pickupChanged) {
                        await reserveStockForItemsAtPickup({
                            client,
                            pickupDateId: targetPickupDateId,
                            pickupDateValue: pickupDate,
                            pickupLocationValue: pickupLocation,
                            items: nextItemsForStock
                        });

                        await releaseStockForItemsAtPickup({
                            client,
                            pickupDateId: sourcePickupDateId,
                            items: storedItems
                        });
                    } else {
                        const itemsToReserve = [];
                        const itemsToRelease = [];
                        for (const itemId of allItemIds) {
                            const storedItem = storedItemsById.get(itemId) || null;
                            const nextItem = nextItemsById.get(itemId) || null;
                            const storedQty = Number(storedItem?.quantity || 0);
                            const nextQty = Number(nextItem?.quantity || 0);
                            const delta = nextQty - storedQty;
                            if (delta > 0) {
                                itemsToReserve.push({
                                    id: itemId,
                                    quantity: delta,
                                    name: nextItem?.name || storedItem?.name || `Item #${itemId}`
                                });
                            } else if (delta < 0) {
                                itemsToRelease.push({
                                    id: itemId,
                                    quantity: Math.abs(delta),
                                    name: storedItem?.name || nextItem?.name || `Item #${itemId}`
                                });
                            }
                        }

                        await reserveStockForItemsAtPickup({
                            client,
                            pickupDateId: targetPickupDateId,
                            pickupDateValue: pickupDate,
                            pickupLocationValue: pickupLocation,
                            items: itemsToReserve
                        });

                        await releaseStockForItemsAtPickup({
                            client,
                            pickupDateId: sourcePickupDateId,
                            items: itemsToRelease
                        });
                    }
                }

                const storedTotalRaw = Number(existingOrder.total_cents);
                const storedTotalCents = (
                    Number.isFinite(storedTotalRaw) && storedTotalRaw >= 0
                ) ? Math.floor(storedTotalRaw) : 0;
                const storedPaidRaw = Number(existingOrder.amount_paid_cents);
                const storedDueRaw = Number(existingOrder.amount_due_cents);
                let amountPaidCents;
                if (Number.isFinite(storedPaidRaw) && storedPaidRaw >= 0) {
                    amountPaidCents = Math.floor(storedPaidRaw);
                } else if (Number.isFinite(storedDueRaw) && storedDueRaw >= 0) {
                    amountPaidCents = Math.max(storedTotalCents - Math.floor(storedDueRaw), 0);
                } else {
                    amountPaidCents = storedTotalCents;
                }

                if (hasAmountPaidField) {
                    const requestedPaidCents = Math.max(Math.floor(amountPaidCentsRaw), 0);
                    if (requestedPaidCents < amountPaidCents) {
                        return {
                            status: 'paid_reduction_not_allowed',
                            existingPaidCents: amountPaidCents,
                            requestedPaidCents,
                            reductionCents: amountPaidCents - requestedPaidCents
                        };
                    }
                    amountPaidCents = requestedPaidCents;
                }

                if (nextTotalCents < amountPaidCents) {
                    return {
                        status: 'total_below_paid',
                        totalCents: nextTotalCents,
                        amountPaidCents,
                        shortfallCents: amountPaidCents - nextTotalCents
                    };
                }

                const amountDueCents = Math.max(nextTotalCents - amountPaidCents, 0);
                const paymentType = (amountDueCents > 0 || hasLambItems) ? 'deposit' : 'full';
                const nextStatus = amountPaidCents > 0 ? 'paid' : 'pending';
                const customerEmailToStore = hasCustomerEmailField ? (customerEmail || null) : null;

                await client.query(
                    `
                    UPDATE orders
                    SET
                        total_cents = $1,
                        status = $2,
                        pickup_date = $3,
                        pickup_location = $4,
                        payment_type = $5,
                        amount_paid_cents = $6,
                        amount_due_cents = $7,
                        items = CASE WHEN $8::boolean THEN $9 ELSE items END,
                        customer_email = CASE WHEN $10::boolean THEN $11::text ELSE customer_email END
                    WHERE id = $12
                    `,
                    [
                        nextTotalCents,
                        nextStatus,
                        pickupDate,
                        pickupLocation,
                        paymentType,
                        amountPaidCents,
                        amountDueCents,
                        hasItemsField,
                        nextItemsJson,
                        hasCustomerEmailField,
                        customerEmailToStore,
                        orderId
                    ]
                );
                if (hasCustomerEmailField && existingOrder.customer_id) {
                    await client.query(
                        'UPDATE customers SET email = $1 WHERE id = $2',
                        [customerEmailToStore, existingOrder.customer_id]
                    );
                }

                return {
                    status: 'updated',
                    orderId,
                    pickupDate,
                    pickupLocation,
                    totalCents: nextTotalCents,
                    amountPaidCents,
                    amountDueCents,
                    paymentType,
                    nextStatus,
                    customerEmail: hasCustomerEmailField
                        ? customerEmailToStore
                        : (existingOrder.customer_email || null)
                };
            });

            if (updateResult.status === 'missing_order') {
                return res.status(404).json({ error: 'Order not found.' });
            }
            if (updateResult.status === 'blocked_status') {
                return res.status(400).json({
                    error: buildStatusEditBlockedMessage(updateResult.existingStatus)
                });
            }
            if (updateResult.status === 'pickup_unavailable') {
                return res.status(400).json({
                    error: 'Selected pickup date is not available.'
                });
            }
            if (updateResult.status === 'source_pickup_missing') {
                return res.status(409).json({
                    error: 'Current pickup inventory record is missing. Please refresh pickup dates before editing this order.'
                });
            }
            if (updateResult.status === 'missing_items') {
                return res.status(400).json({
                    error: 'This order has no valid items and cannot be moved to a different pickup date.'
                });
            }
            if (updateResult.status === 'validation_error') {
                return res.status(400).json({
                    error: updateResult.error || 'Invalid order update request.'
                });
            }
            if (updateResult.status === 'total_below_paid') {
                return res.status(400).json({
                    error: `Order total (${formatCents(updateResult.totalCents)}) cannot be less than amount already paid (${formatCents(updateResult.amountPaidCents)}). Short by ${formatCents(updateResult.shortfallCents)}.`
                });
            }
            if (updateResult.status === 'paid_reduction_not_allowed') {
                return res.status(400).json({
                    error: `Amount paid cannot be reduced below the already recorded amount (${formatCents(updateResult.existingPaidCents)}). Reduction requested: ${formatCents(updateResult.reductionCents)}.`
                });
            }

            return res.json({
                success: true,
                orderId: updateResult.orderId,
                pickup_date: updateResult.pickupDate,
                pickup_location: updateResult.pickupLocation,
                total_cents: updateResult.totalCents,
                amount_paid_cents: updateResult.amountPaidCents,
                amount_due_cents: updateResult.amountDueCents,
                payment_type: updateResult.paymentType,
                status: updateResult.nextStatus,
                customer_email: updateResult.customerEmail
            });
        } catch (err) {
            if (err?.code === 'ADMIN_ORDER_INSUFFICIENT_STOCK') {
                const meta = err.meta || {};
                return res.status(409).json({
                    error: `Insufficient stock for ${meta.henName || 'this item'} on ${meta.pickupDate || 'the selected date'} (${getLocationLabel(meta.pickupLocation)}). Need ${meta.required || 0}, available ${meta.available || 0}.`
                });
            }
            return sendServerError(res, err, 'Failed to update admin order');
        }
    });

    app.delete('/api/admin/orders/:id', checkAuth, async (req, res) => {
        const orderId = sanitizeText(req.params?.id, 120);
        if (!orderId) {
            return res.status(400).json({ error: 'Order id is required.' });
        }

        try {
            const deleteResult = await runInTransaction(async (client) => {
                const existingOrderResult = await client.query(
                    `
                    SELECT
                        id,
                        status,
                        pickup_date,
                        pickup_location,
                        items
                    FROM orders
                    WHERE id = $1
                    FOR UPDATE
                    `,
                    [orderId]
                );
                if (existingOrderResult.rows.length === 0) {
                    return { status: 'missing_order' };
                }

                const existingOrder = existingOrderResult.rows[0];
                const existingStatus = String(existingOrder.status || 'pending').trim().toLowerCase();
                if (!ADMIN_DELETABLE_ORDER_STATUSES.has(existingStatus)) {
                    return {
                        status: 'blocked_status',
                        existingStatus
                    };
                }

                const pickupDate = formatPickupDate(existingOrder.pickup_date);
                const pickupLocation = sanitizeText(existingOrder.pickup_location, 40);
                const storedItems = normalizeStoredOrderItems(existingOrder.items);
                if (pickupDate && pickupLocation && storedItems.length > 0) {
                    const pickupDateId = await findPickupDateId(client, pickupDate, pickupLocation);
                    if (pickupDateId) {
                        await releaseStockForItems(client, {
                            pickupDateId,
                            items: storedItems
                        });
                    }
                }

                await client.query('DELETE FROM orders WHERE id = $1', [orderId]);
                return { status: 'deleted', orderId };
            });

            if (deleteResult.status === 'missing_order') {
                return res.status(404).json({ error: 'Order not found.' });
            }
            if (deleteResult.status === 'blocked_status') {
                return res.status(400).json({
                    error: buildStatusDeleteBlockedMessage(deleteResult.existingStatus)
                });
            }

            return res.json({
                success: true,
                orderId: deleteResult.orderId
            });
        } catch (err) {
            return sendServerError(res, err, 'Failed to delete admin order');
        }
    });

    app.post('/api/admin/orders/:id/finalize-payment', checkAuth, async (req, res) => {
        try {
            const orderId = req.params.id;
            const orderResult = await pool.query(
                'SELECT stripe_payment_id, status FROM orders WHERE id = $1',
                [orderId]
            );
            if (orderResult.rows.length === 0) {
                return res.status(404).json({ error: 'Order not found' });
            }
            const order = orderResult.rows[0];
            const stripeSessionId = order.stripe_payment_id;
            if (!stripeSessionId) {
                return res.status(400).json({ error: 'No Stripe session for this order' });
            }
            const session = await stripe.checkout.sessions.retrieve(stripeSessionId);
            if (session.payment_status === 'paid') {
                const result = await finalizeOrderFromSession(session);
                return res.json({ success: true, status: result.status });
            }
            return res.json({ success: true, status: order.status, payment_status: session.payment_status });
        } catch (err) {
            return sendServerError(res, err, 'Failed to finalize payment');
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

    app.get('/api/admin/stats', checkAuth, async (req, res) => {
        try {
            const result = await pool.query(`
                SELECT
                    COUNT(*)::int AS order_count,
                    COALESCE(SUM(total_cents), 0)::bigint AS total_expected_cents,
                    COALESCE(SUM(amount_paid_cents), 0)::bigint AS total_paid_cents,
                    COALESCE(SUM(amount_due_cents), 0)::bigint AS total_due_cents,
                    COALESCE(SUM(
                        CASE WHEN stripe_payment_id IS NOT NULL
                             THEN ROUND(amount_paid_cents * 0.029) + 30
                             ELSE 0
                        END
                    ), 0)::bigint AS stripe_fee_cents
                FROM orders
                WHERE LOWER(COALESCE(status, 'pending')) NOT IN ('cancelled', 'archived', 'reserved')
            `);
            const row = result.rows[0] || {};
            return res.json({
                orderCount: Number(row.order_count || 0),
                totalExpectedCents: Number(row.total_expected_cents || 0),
                totalPaidCents: Number(row.total_paid_cents || 0),
                totalDueCents: Number(row.total_due_cents || 0),
                stripeFeeCents: Number(row.stripe_fee_cents || 0)
            });
        } catch (err) {
            return sendServerError(res, err, 'Failed to load admin stats');
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
