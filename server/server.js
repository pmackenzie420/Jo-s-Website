const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const express = require('express');
const cors = require('cors');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

const pool = require('./db');
const { 
    parseOriginList, 
    getClientIp, 
    parseCookies,
    normalizeLanguage,
    parseOrderItems
} = require('./utils/helpers');
const { 
    calculateItemPrice, 
    isLohmannHenName, 
    getPaymentDetails, 
    getOrderSummary 
} = require('./logic/pricing');
const { 
    sendOrderConfirmationEmail, 
    sendEmailMessage 
} = require('./logic/email');
const {
    createRateLimiter,
    signAdminSession,
    signMainSession,
    verifyMainSession,
    signOrderConfirmToken,
    verifyOrderConfirmToken,
    checkAuth,
    getCookieOptions,
    ADMIN_SESSION_COOKIE,
    ADMIN_SESSION_TTL_MS,
    MAIN_SESSION_COOKIE,
    MAIN_SESSION_TTL_MS,
    ORDER_CONFIRM_COOKIE,
    ORDER_CONFIRM_TTL_MS
} = require('./middleware/auth');
const { PAID_STATUSES } = require('./config/constants');

const app = express();
const port = process.env.PORT || 3000;
app.set('trust proxy', 1);

// --- CORS CONFIG ---
const isProduction = process.env.NODE_ENV === 'production';
const corsOrigins = parseOriginList(process.env.CORS_ORIGINS || process.env.CLIENT_URL);
if (!isProduction && corsOrigins.length === 0) {
    corsOrigins.push(
        'http://localhost:5173',
        'http://127.0.0.1:5173',
        'http://localhost:3000',
        'http://127.0.0.1:3000'
    );
}
const corsOptions = {
    origin: (origin, callback) => {
        if (!origin) {
            callback(null, true);
            return;
        }
        if (corsOrigins.length === 0) {
            callback(new Error('CORS_ORIGINS not configured'));
            return;
        }
        if (corsOrigins.includes(origin)) {
            callback(null, true);
            return;
        }
        callback(new Error('Not allowed by CORS'));
    },
    credentials: true,
    optionsSuccessStatus: 200
};

app.use(cors(corsOptions));

const getRequestBaseUrl = (req) => {
    const envUrl = process.env.CLIENT_URL;
    const originHeader = req.get('origin');
    const sanitizedOrigin =
        typeof originHeader === 'string' ? originHeader.trim().replace(/\/+$/, '') : '';

    if (envUrl) {
        return envUrl.replace(/\/+$/, '');
    }

    if (sanitizedOrigin && corsOrigins.includes(sanitizedOrigin)) {
        return sanitizedOrigin;
    }

    const forwardedProto = req.headers['x-forwarded-proto'];
    const forwardedHost = req.headers['x-forwarded-host'];
    const proto = typeof forwardedProto === 'string'
        ? forwardedProto.split(',')[0]
        : req.protocol;
    const host = typeof forwardedHost === 'string'
        ? forwardedHost.split(',')[0]
        : req.get('host');
    const candidate = `${proto}://${host}`;
    if (!isProduction && corsOrigins.length === 0) {
        return candidate;
    }
    if (corsOrigins.includes(candidate)) {
        return candidate;
    }
    return null;
};

// --- LIMITERS ---
const adminLoginLimiter = createRateLimiter({
    windowMs: 15 * 60 * 1000,
    max: 10,
    keyPrefix: 'admin-login'
});

const mainLoginLimiter = createRateLimiter({
    windowMs: 15 * 60 * 1000,
    max: 20,
    keyPrefix: 'main-login'
});

const orderConfirmLimiter = createRateLimiter({
    windowMs: 60 * 1000,
    max: 30,
    keyPrefix: 'order-confirm'
});

// --- STRIPE WEBHOOK ---
const finalizeOrderFromSession = async (session) => {
    const orderIdFromMetadata = session?.metadata?.order_id;
    let orderId = orderIdFromMetadata;

    if (!orderId) {
        const lookup = await pool.query('SELECT id FROM orders WHERE stripe_payment_id = $1', [
            session.id
        ]);
        orderId = lookup.rows[0]?.id;
    }

    if (!orderId) {
        return { status: 'missing_order' };
    }

    let transactionStarted = false;
    try {
        await pool.query('BEGIN');
        transactionStarted = true;

        const orderResult = await pool.query(
            'SELECT status, items FROM orders WHERE id = $1 FOR UPDATE',
            [orderId]
        );

        if (orderResult.rows.length === 0) {
            await pool.query('ROLLBACK');
            return { status: 'missing_order' };
        }

        const order = orderResult.rows[0];
        const currentStatus = order.status || 'pending';
        const alreadyPaid = PAID_STATUSES.has(currentStatus);

        if (!alreadyPaid) {
            const items = parseOrderItems(order.items);
            for (const item of items) {
                const quantity = Number(item.quantity ?? item.qty ?? 0);
                const itemId = Number(item.id);
                if (!Number.isFinite(quantity) || quantity <= 0 || !Number.isFinite(itemId)) {
                    continue;
                }
                await pool.query(
                    'UPDATE hens SET stock = GREATEST(stock - $1, 0) WHERE id = $2',
                    [quantity, itemId]
                );
            }
        }

        const nextStatus = alreadyPaid ? currentStatus : 'paid';
        await pool.query('UPDATE orders SET status = $1, stripe_payment_id = $2 WHERE id = $3', [
            nextStatus,
            session.id,
            orderId
        ]);

        await pool.query('COMMIT');
        const result = { status: nextStatus, orderId };
        try {
            await sendOrderConfirmationEmail(orderId);
        } catch (err) {
            console.error('Error sending confirmation email:', err);
        }
        return result;
    } catch (err) {
        if (transactionStarted) {
            try {
                await pool.query('ROLLBACK');
            } catch (rollbackError) {
                console.error('Rollback failed:', rollbackError);
            }
        }
        throw err;
    }
};

app.post('/api/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
    const sig = req.headers['stripe-signature'];
    let event;

    try {
        event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
    } catch (err) {
        console.error("Webhook Error:", err.message);
        return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    if (event.type === 'checkout.session.completed') {
        const session = event.data.object;
        try {
            const result = await finalizeOrderFromSession(session);
            if (result.status === 'missing_order') {
                console.error('Order not found for session', session.id);
            } else {
                console.log(`Order ${result.orderId} marked as ${result.status.toUpperCase()}`);
            }
        } catch (err) {
            console.error('Error updating order:', err);
        }
    }

    res.json({ received: true });
});

app.use(express.json());

// --- ROUTES ---

app.get('/', (req, res) => res.send('Hen Store API Running 🐔'));

app.get('/api/heartbeat', async (req, res) => {
    try {
        await pool.query('SELECT 1');
        res.json({ ok: true });
    } catch (err) {
        console.error('Heartbeat failed:', err);
        res.status(500).json({ ok: false });
    }
});

app.get('/api/hens', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM hens WHERE is_active = true ORDER BY id ASC');
        res.json(result.rows);
    } catch (err) {
        res.status(500).send(err.message);
    }
});

// --- CHECKOUT ROUTES ---

app.post('/api/checkout', async (req, res) => {
    const { customer, items, pickup, paymentOption, language, lang } = req.body || {};
    const headerLanguage = req.get('accept-language') || '';
    const orderLanguage = normalizeLanguage(language || lang || headerLanguage);

    try {
        if (!pickup?.date || !pickup?.location) {
            return res.status(400).json({ error: 'Pickup date and location are required.' });
        }
        const pickupCheck = await pool.query(
            'SELECT 1 FROM pickup_dates WHERE is_active = true AND date_value = $1 AND location = $2',
            [pickup.date, pickup.location]
        );
        if (pickupCheck.rows.length === 0) {
            return res.status(400).json({ error: 'Selected pickup date is not available for that location.' });
        }

        // A. Upsert Customer
        let customerId;
        const existingCust = await pool.query('SELECT id FROM customers WHERE phone = $1', [customer.phone]);

        if (existingCust.rows.length > 0) {
            customerId = existingCust.rows[0].id;
            await pool.query(
                'UPDATE customers SET name=$1, email=$2, address=$3 WHERE id=$4',
                [customer.name, customer.email, customer.address, customerId]
            );
        } else {
            const newCust = await pool.query(
                'INSERT INTO customers (name, phone, email, address) VALUES ($1, $2, $3, $4) RETURNING id',
                [customer.name, customer.phone, customer.email, customer.address]
            );
            customerId = newCust.rows[0].id;
        }

        // B. Calculate Total
        const lineItemsFull = [];
        const lineItemsLohmann = [];
        let totalCents = 0;
        let lohmannSubtotalCents = 0;
        let nonLohmannSubtotalCents = 0;
        let lohmannQty = 0;

        for (const item of items) {
            const result = await pool.query('SELECT * FROM hens WHERE id = $1', [item.id]);
            const hen = result.rows[0];
            if (!hen) continue;

            const quantity = Number(item.quantity);
            if (!Number.isFinite(quantity) || quantity <= 0) continue;

            const availableStock = Number(hen.stock);
            if (Number.isFinite(availableStock) && availableStock < quantity) {
                return res.status(400).json({
                    error: `Insufficient stock for ${hen.name}`
                });
            }

            const unitPrice = calculateItemPrice(hen.name, quantity);
            const itemTotal = unitPrice * quantity;
            totalCents += itemTotal;
            const isLohmann = isLohmannHenName(hen.name);
            if (isLohmann) {
                lohmannSubtotalCents += itemTotal;
                lohmannQty += quantity;
            } else {
                nonLohmannSubtotalCents += itemTotal;
            }

            const productData = {
                name: hen.name,
                description: `Bulk Price: $${(unitPrice / 100).toFixed(2)}/unit`,
            };
            if (hen.image_url && hen.image_url.startsWith('http')) {
                productData.images = [hen.image_url];
            } else if (hen.image_url && hen.image_url.startsWith('/')) {
                productData.images = [`${process.env.CLIENT_URL}${hen.image_url}`];
            }

            const lineItem = {
                price_data: {
                    currency: 'cad',
                    product_data: productData,
                    unit_amount: unitPrice,
                },
                quantity,
            };
            if (isLohmann) {
                lineItemsLohmann.push(lineItem);
            } else {
                lineItemsFull.push(lineItem);
            }
        }

        const requestedPayment = paymentOption === 'deposit' ? 'deposit' : 'full';
        const depositEligible = lohmannQty >= 13;
        if (requestedPayment === 'deposit' && !depositEligible) {
            return res.status(400).json({
                error: 'Deposit is available only for 13 or more Lohmann hens.'
            });
        }

        const depositCents = depositEligible
            ? Math.floor(lohmannSubtotalCents * 0.25)
            : 0;
        const amountPaidCents = requestedPayment === 'deposit'
            ? nonLohmannSubtotalCents + depositCents
            : totalCents;
        const amountDueCents = Math.max(totalCents - amountPaidCents, 0);
        const paymentType = amountDueCents > 0 ? 'deposit' : 'full';

        let lineItems = [...lineItemsFull, ...lineItemsLohmann];
        if (paymentType === 'deposit') {
            lineItems = [...lineItemsFull];
            if (depositCents > 0) {
                lineItems.push({
                    price_data: {
                        currency: 'cad',
                        product_data: {
                            name: 'Lohmann hen deposit (25%)',
                            description: `${lohmannQty} hens`
                        },
                        unit_amount: depositCents
                    },
                    quantity: 1
                });
            }
        }

        // C. Insert Pending Order
        const newOrder = await pool.query(
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
                language
            )
             VALUES ($1, $2, $3, $4, 'pending', $5, $6, $7, $8, $9, $10) RETURNING id`,
            [
                customerId,
                customer.email,
                totalCents,
                JSON.stringify(items),
                pickup.date,
                pickup.location,
                paymentType,
                amountPaidCents,
                amountDueCents,
                orderLanguage
            ]
        );
        const orderId = newOrder.rows[0].id;

        // D. Stripe Session
        const baseUrl = getRequestBaseUrl(req);
        if (!baseUrl) {
            return res.status(500).json({ error: 'Checkout redirect URL not configured.' });
        }

        const session = await stripe.checkout.sessions.create({
            payment_method_types: ['card'],
            line_items: lineItems,
            mode: 'payment',
            metadata: { order_id: orderId, payment_type: paymentType },
            success_url: `${baseUrl}/success?session_id={CHECKOUT_SESSION_ID}`,
            cancel_url: `${baseUrl}?canceled=true`,
        });

        await pool.query('UPDATE orders SET stripe_payment_id = $1 WHERE id = $2', [session.id, orderId]);

        const confirmToken = signOrderConfirmToken(session.id);
        if (confirmToken) {
            res.cookie(ORDER_CONFIRM_COOKIE, confirmToken, getCookieOptions(ORDER_CONFIRM_TTL_MS));
        }

        res.json({ url: session.url });

    } catch (err) {
        console.error(err);
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/orders/confirm', orderConfirmLimiter, async (req, res) => {
    const sessionId = req.query.session_id;
    if (!sessionId) {
        return res.status(400).json({ error: 'session_id required' });
    }

    let session;
    try {
        session = await stripe.checkout.sessions.retrieve(sessionId);
    } catch (err) {
        console.error('Invalid Stripe session:', err);
    }

    try {
        let orderId = null;
        let orderStatus = null;
        const cookies = parseCookies(req.headers.cookie);
        const confirmToken = cookies[ORDER_CONFIRM_COOKIE];
        const confirmedSession = verifyOrderConfirmToken(confirmToken);
        const requestedSessionId = session?.id || sessionId;

        if (session?.payment_status === 'paid') {
            const result = await finalizeOrderFromSession(session);
            if (result.status !== 'missing_order') {
                orderId = result.orderId;
                orderStatus = result.status;
            }
        }

        if (!orderId) {
            const lookup = await pool.query(
                'SELECT id, status FROM orders WHERE stripe_payment_id = $1',
                [session?.id || sessionId]
            );
            if (lookup.rows.length > 0) {
                orderId = lookup.rows[0].id;
                orderStatus = lookup.rows[0].status || orderStatus;
            }
        }

        if (!orderId) {
            return res.status(404).json({ error: 'Order not found' });
        }

        const summary = await getOrderSummary(orderId);
        if (!summary) {
            return res.status(404).json({ error: 'Order not found' });
        }

        const { order, items } = summary;
        const paymentDetails = getPaymentDetails(order);

        const normalizedStatus = String(orderStatus || order.status || 'pending').toLowerCase();
        const isPaid = session?.payment_status === 'paid' || PAID_STATUSES.has(normalizedStatus);
        const allowSensitive =
            Boolean(isPaid)
            && Boolean(confirmedSession?.sid)
            && confirmedSession.sid === requestedSessionId;

        const orderPayload = {
            id: order.id,
            pickup_date: order.pickup_date,
            pickup_location: order.pickup_location,
            total_cents: order.total_cents,
            items,
            language: normalizeLanguage(order.language),
            payment_type: paymentDetails.paymentType,
            amount_paid_cents: paymentDetails.paidCents,
            amount_due_cents: paymentDetails.dueCents
        };

        if (allowSensitive) {
            orderPayload.customer_email = order.customer_email;
            orderPayload.customer_name = order.customer_name;
            orderPayload.customer_phone = order.customer_phone;
            orderPayload.customer_address = order.customer_address;
        }

        return res.json({
            success: true,
            status: normalizedStatus,
            order: orderPayload
        });
    } catch (err) {
        console.error('Error confirming order:', err);
        return res.status(500).json({ error: 'Failed to confirm order' });
    }
});

// --- MAIN SITE GATE ---
app.post('/api/main/login', mainLoginLimiter, (req, res) => {
    const { password } = req.body;
    const MAIN_PASSWORD = process.env.MAIN_PASSWORD;
    if (!MAIN_PASSWORD) {
        return res.status(500).json({ error: 'Main site auth not configured.' });
    }
    if (password !== MAIN_PASSWORD) {
        return res.status(401).send('Wrong password');
    }
    const token = signMainSession({ sub: 'main' });
    res.cookie(MAIN_SESSION_COOKIE, token, getCookieOptions(MAIN_SESSION_TTL_MS));
    return res.json({ success: true });
});

app.get('/api/main/session', (req, res) => {
    const cookies = parseCookies(req.headers.cookie);
    const token = cookies[MAIN_SESSION_COOKIE];
    const session = verifyMainSession(token);
    if (!session || session.sub !== 'main') {
        return res.status(401).send('Unauthorized');
    }
    return res.json({ success: true });
});

// --- ADMIN ROUTES ---
app.post('/api/admin/login', adminLoginLimiter, (req, res) => {
    const { password } = req.body;
    const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
    if (!ADMIN_PASSWORD) {
        return res.status(500).json({ error: 'Admin auth not configured.' });
    }
    if (password !== ADMIN_PASSWORD) {
        return res.status(401).send('Wrong password');
    }
    const token = signAdminSession({ sub: 'admin' });
    res.cookie(ADMIN_SESSION_COOKIE, token, getCookieOptions(ADMIN_SESSION_TTL_MS));
    return res.json({ success: true });
});

app.get('/api/admin/session', checkAuth, (req, res) => {
    res.json({ success: true });
});

app.get('/api/admin/orders', checkAuth, async (req, res) => {
    try {
        const query = `
            SELECT 
                orders.*, 
                customers.name as customer_name,
                customers.phone as customer_phone,
                customers.address as customer_address
            FROM orders
            LEFT JOIN customers ON orders.customer_id = customers.id
            ORDER BY orders.created_at DESC
        `;
        const result = await pool.query(query);
        res.json(result.rows);
    } catch (err) {
        console.error(err);
        res.status(500).json([]);
    }
});

app.put('/api/admin/hens/:id', checkAuth, async (req, res) => {
    const { id } = req.params;
    const { stock } = req.body;
    try {
        await pool.query('UPDATE hens SET stock = $1 WHERE id = $2', [stock, id]);
        res.json({ success: true, message: "Stock updated" });
    } catch (err) {
        console.error(err);
        res.status(500).send(err.message);
    }
});

app.get('/api/pickup-dates', async (req, res) => {
    try {
        const { location } = req.query;
        let query = 'SELECT * FROM pickup_dates WHERE is_active = true';
        const values = [];
        if (location) {
            values.push(location);
            query += ' AND location = $1';
        }
        query += ' ORDER BY date_value ASC';
        const result = await pool.query(query, values);
        res.json(result.rows);
    } catch (err) {
        res.status(500).send(err.message);
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
        res.json(result.rows[0]);
    } catch (err) {
        res.status(500).send(err.message);
    }
});

app.delete('/api/admin/pickup-dates/:id', checkAuth, async (req, res) => {
    const { id } = req.params;
    try {
        await pool.query('DELETE FROM pickup_dates WHERE id = $1', [id]);
        res.json({ success: true });
    } catch (err) {
        res.status(500).send(err.message);
    }
});

app.put('/api/admin/orders/:id/status', checkAuth, async (req, res) => {
    const { id } = req.params;
    const { status } = req.body;
    try {
        await pool.query('UPDATE orders SET status = $1 WHERE id = $2', [status, id]);
        res.json({ success: true, message: "Status updated" });
    } catch (err) {
        res.status(500).send(err.message);
    }
});

app.post('/api/admin/email', checkAuth, async (req, res) => {
    const { messages, recipients, subject, message } = req.body;
    let sendMessages = [];

    if (Array.isArray(messages) && messages.length > 0) {
        sendMessages = messages;
    } else if (Array.isArray(recipients) && subject && message) {
        sendMessages = recipients.map((recipient) => ({
            to: recipient,
            subject,
            text: message
        }));
    }

    if (sendMessages.length === 0) {
        return res.status(400).json({ error: 'No email recipients provided.' });
    }

    const validMessages = sendMessages.filter((item) =>
        item?.to?.email
        && item?.subject
        && (item?.text || item?.attachments?.length || item?.csv)
    );

    if (validMessages.length === 0) {
        return res.status(400).json({ error: 'No valid email recipients provided.' });
    }

    try {
        for (const item of validMessages) {
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
                to: item.to,
                subject: item.subject,
                text: item.text,
                attachments
            });
        }

        res.json({ success: true, sent: validMessages.length });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Email send failed.' });
    }
});

app.listen(port, () => console.log(`Server on port ${port}`));
