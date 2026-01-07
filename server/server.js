const path = require('path');
const fs = require('fs');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const crypto = require('crypto');
const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const EMAIL_API_KEY = process.env.EMAIL_API_KEY;
const EMAIL_FROM = process.env.EMAIL_FROM;
const EMAIL_FROM_NAME = process.env.EMAIL_FROM_NAME || 'Les Fermes Soulard';
const PAID_STATUSES = new Set(['paid', 'fulfilled', 'picked_up']);
const MAIN_PASSWORD = process.env.MAIN_PASSWORD;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
const ADMIN_SESSION_SECRET = process.env.ADMIN_SESSION_SECRET;
const ADMIN_SESSION_COOKIE = 'admin_session';
const ADMIN_SESSION_DAYS = Number(process.env.ADMIN_SESSION_DAYS || 30);
const ADMIN_SESSION_TTL_MS = Number.isFinite(ADMIN_SESSION_DAYS)
    ? ADMIN_SESSION_DAYS * 24 * 60 * 60 * 1000
    : 30 * 24 * 60 * 60 * 1000;
const MAIN_SESSION_SECRET = process.env.MAIN_SESSION_SECRET || MAIN_PASSWORD || ADMIN_SESSION_SECRET;
const MAIN_SESSION_COOKIE = 'main_session';
const MAIN_SESSION_DAYS = Number(process.env.MAIN_SESSION_DAYS || 7);
const MAIN_SESSION_TTL_MS = Number.isFinite(MAIN_SESSION_DAYS)
    ? MAIN_SESSION_DAYS * 24 * 60 * 60 * 1000
    : 7 * 24 * 60 * 60 * 1000;
const ORDER_CONFIRM_SECRET = process.env.ORDER_CONFIRM_SECRET;
const ORDER_CONFIRM_COOKIE = 'order_confirm';
const ORDER_CONFIRM_TTL_MINUTES = Number(process.env.ORDER_CONFIRM_TTL_MINUTES || 120);
const ORDER_CONFIRM_TTL_MS = Number.isFinite(ORDER_CONFIRM_TTL_MINUTES)
    ? ORDER_CONFIRM_TTL_MINUTES * 60 * 1000
    : 2 * 60 * 60 * 1000;

const LOCATION_DETAILS = {
    hemmingford: {
        label: 'Hemmingford',
        address: '315 ch. Back Bush, Hemmingford, QC'
    },
    bristol: {
        label: 'Bristol',
        address: '84 Rte 148, Bristol, QC'
    }
};

const COMPANY_CONTACT = {
    name: 'Les Fermes Soulard',
    address: '315 ch. Back Bush, Hemmingford, QC',
    phone: '(819) 770-0070',
    email: 'lesfermessoulard@gmail.com'
};

const app = express();
const port = process.env.PORT || 3000;
app.set('trust proxy', 1);

const parseOriginList = (value) => (value || '')
    .split(',')
    .map((entry) => entry.trim().replace(/\/+$/, ''))
    .filter(Boolean);

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

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: {
        rejectUnauthorized: true,
        ca: isProduction
            ? fs.readFileSync('/etc/secrets/supabase-ca.crt').toString()
            : fs.readFileSync(path.join(__dirname, 'certs/supabase-ca.crt')).toString()
    }
});

const parseOrderItems = (items) => {
    if (!items) return [];
    if (Array.isArray(items)) return items;
    if (typeof items === 'string') {
        try {
            return JSON.parse(items);
        } catch (error) {
            return [];
        }
    }
    return [];
};

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

const formatPickupDate = (value) => {
    if (!value) return '';
    if (value instanceof Date) {
        return value.toISOString().split('T')[0];
    }
    if (typeof value === 'string') {
        return value.split('T')[0];
    }
    return String(value);
};

const formatPickupDateLong = (value) => {
    if (!value) return '';
    const dateValue = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(dateValue.getTime())) {
        return formatPickupDate(value);
    }
    try {
        return new Intl.DateTimeFormat('en-CA', {
            month: 'long',
            day: 'numeric',
            year: 'numeric'
        }).format(dateValue);
    } catch (err) {
        return formatPickupDate(value);
    }
};

const formatCurrency = (cents) => {
    const numeric = Number(cents);
    if (!Number.isFinite(numeric)) return '';
    return `$${(numeric / 100).toFixed(2)}`;
};

const escapeHtml = (value) => String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const parseCookies = (cookieHeader) => {
    if (!cookieHeader) return {};
    return cookieHeader.split(';').reduce((acc, part) => {
        const [key, ...rest] = part.trim().split('=');
        if (!key) return acc;
        const value = rest.join('=');
        try {
            acc[key] = decodeURIComponent(value);
        } catch (error) {
            acc[key] = value;
        }
        return acc;
    }, {});
};

const rateLimitStore = new Map();

const getClientIp = (req) => {
    const forwarded = req.headers['x-forwarded-for'];
    if (typeof forwarded === 'string' && forwarded.length > 0) {
        return forwarded.split(',')[0].trim();
    }
    return req.ip || 'unknown';
};

const createRateLimiter = ({ windowMs, max, keyPrefix }) => (req, res, next) => {
    const key = `${keyPrefix}:${getClientIp(req)}`;
    const now = Date.now();
    const entry = rateLimitStore.get(key);
    if (!entry || entry.resetAt <= now) {
        rateLimitStore.set(key, { count: 1, resetAt: now + windowMs });
        return next();
    }
    if (entry.count >= max) {
        const retryAfter = Math.ceil((entry.resetAt - now) / 1000);
        res.set('Retry-After', String(retryAfter));
        return res.status(429).json({ error: 'Too many requests. Please try again later.' });
    }
    entry.count += 1;
    return next();
};

const signToken = (payload, secret) => {
    if (!secret) {
        throw new Error('Token secret is not configured');
    }
    const body = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
    const signature = crypto
        .createHmac('sha256', secret)
        .update(body)
        .digest('base64url');
    return `${body}.${signature}`;
};

const verifyToken = (token, secret) => {
    if (!token || !secret) return null;
    const parts = token.split('.');
    if (parts.length !== 2) return null;
    const [body, signature] = parts;
    const expected = crypto
        .createHmac('sha256', secret)
        .update(body)
        .digest('base64url');
    try {
        if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) {
            return null;
        }
    } catch (error) {
        return null;
    }
    let payload;
    try {
        payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    } catch (error) {
        return null;
    }
    if (!payload?.exp || Date.now() > payload.exp) {
        return null;
    }
    return payload;
};

const signAdminSession = (payload) => signToken(payload, ADMIN_SESSION_SECRET);
const verifyAdminSession = (token) => verifyToken(token, ADMIN_SESSION_SECRET);

const signOrderConfirmToken = (sessionId) => {
    if (!ORDER_CONFIRM_SECRET || !sessionId) {
        return null;
    }
    const now = Date.now();
    return signToken({
        sub: 'order-confirm',
        sid: sessionId,
        iat: now,
        exp: now + ORDER_CONFIRM_TTL_MS
    }, ORDER_CONFIRM_SECRET);
};

const verifyOrderConfirmToken = (token) => {
    const payload = verifyToken(token, ORDER_CONFIRM_SECRET);
    if (!payload || payload.sub !== 'order-confirm' || !payload.sid) {
        return null;
    }
    return payload;
};

const getAdminSessionCookieOptions = () => ({
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: ADMIN_SESSION_TTL_MS,
    path: '/api'
});

const getMainSessionCookieOptions = () => ({
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: MAIN_SESSION_TTL_MS,
    path: '/api'
});

const getOrderConfirmCookieOptions = () => ({
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: ORDER_CONFIRM_TTL_MS,
    path: '/api'
});

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
        const alreadyPaid = ['paid', 'fulfilled', 'picked_up'].includes(currentStatus);

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

// Stripe Webhook - MUST BE BEFORE express.json()
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

// --- PRICING LOGIC (The "Flyer" Math) ---
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

    // Fallback (shouldn't happen)
    return 0;
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

const buildOrderConfirmationEmailText = ({ order, items }) => {
    const customerName = order.customer_name || 'there';
    const pickupDate = formatPickupDateLong(order.pickup_date);
    const locationKey = order.pickup_location;
    const locationDetails = locationKey ? LOCATION_DETAILS[locationKey] : null;
    const locationLabel = locationDetails?.label || locationKey || '';
    const locationAddress = locationDetails?.address || '';
    const total = formatCurrency(order.total_cents);

    const lines = [`Hi ${customerName},`, '', 'Thank you for your order!'];

    if (pickupDate || locationLabel || locationAddress) {
        lines.push('', 'PICKUP DETAILS:');
        if (pickupDate) {
            lines.push(`Date: ${pickupDate}`);
        }
        if (locationLabel) {
            lines.push(`Location: ${locationLabel}`);
        }
        if (locationAddress) {
            lines.push(`Address: ${locationAddress}`);
        }
    }

    lines.push('', 'YOUR ORDER:');
    if (items.length > 0) {
        for (const item of items) {
            const displayName = String(item.name || 'Item').split(' / ')[0];
            const lineTotal = formatCurrency(item.line_cents);
            const quantity = Number(item.quantity ?? 0);
            const line = lineTotal
                ? `- ${quantity} ${displayName} - ${lineTotal}`
                : `- ${quantity} ${displayName}`;
            lines.push(line);
        }
    } else {
        lines.push('- Item details unavailable');
    }

    lines.push('');

    if (total) {
        lines.push(`Total: ${total}`, '');
    }

    lines.push(
        `Order ID: ${order.id}`,
        '',
        `Questions? Reply to this email or call us at ${COMPANY_CONTACT.phone}.`,
        '',
        '---',
        COMPANY_CONTACT.name,
        COMPANY_CONTACT.address,
        `${COMPANY_CONTACT.phone}`,
        COMPANY_CONTACT.email
    );

    return lines.join('\n');
};

const buildOrderConfirmationEmailHtml = ({ order, items }) => {
    const customerName = escapeHtml(order.customer_name || 'there');
    const pickupDate = escapeHtml(formatPickupDateLong(order.pickup_date));
    const locationKey = order.pickup_location;
    const locationDetails = locationKey ? LOCATION_DETAILS[locationKey] : null;
    const locationLabel = escapeHtml(locationDetails?.label || locationKey || '');
    const locationAddress = escapeHtml(locationDetails?.address || '');
    const total = escapeHtml(formatCurrency(order.total_cents));
    const orderId = escapeHtml(order.id);
    const emailLink = `mailto:${encodeURIComponent(COMPANY_CONTACT.email)}`;

    const itemRows = items.length > 0
        ? items.map((item) => {
            const displayName = escapeHtml(String(item.name || 'Item').split(' / ')[0]);
            const quantity = escapeHtml(Number(item.quantity ?? 0));
            const lineTotal = escapeHtml(formatCurrency(item.line_cents));
            return `<li style="margin-bottom: 6px;">${quantity} ${displayName}${lineTotal ? ` - ${lineTotal}` : ''}</li>`;
        }).join('')
        : '<li>Item details unavailable</li>';

    const pickupDetails = (pickupDate || locationLabel || locationAddress)
        ? `
      <div style="background: #f5f5f5; padding: 15px; margin: 20px 0; border-left: 4px solid #2D5A3D;">
        <h3 style="margin-top: 0; color: #333;">Pickup Details</h3>
        <p style="margin: 0; color: #333;">
          ${pickupDate ? `<strong>Date:</strong> ${pickupDate}<br>` : ''}
          ${locationLabel ? `<strong>Location:</strong> ${locationLabel}<br>` : ''}
          ${locationAddress ? `<strong>Address:</strong> ${locationAddress}` : ''}
        </p>
      </div>`
        : '';

    return `
  <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
  <div style="background: #2D5A3D; color: white; padding: 20px; text-align: center;">
    <h1 style="margin: 0;">${escapeHtml(COMPANY_CONTACT.name)}</h1>
  </div>

  <div style="padding: 20px; background: white; color: #333;">
    <p>Hi ${customerName},</p>
    <p>Thank you for your order!</p>
    ${pickupDetails}
    <h3 style="margin-bottom: 8px;">Your Order</h3>
    <ul style="padding-left: 18px; margin-top: 0;">${itemRows}</ul>
    ${total ? `<p style="font-weight: bold;">Total: ${total}</p>` : ''}
    <p style="font-size: 12px; color: #666;">Order ID: ${orderId}</p>
    <p>Questions? Reply to this email or call us at ${escapeHtml(COMPANY_CONTACT.phone)}.</p>
  </div>

  <div style="background: #f5f5f5; padding: 15px; text-align: center; font-size: 12px; color: #666;">
    <p style="margin: 0;">
      ${escapeHtml(COMPANY_CONTACT.name)}<br>
      ${escapeHtml(COMPANY_CONTACT.address)}<br>
      ${escapeHtml(COMPANY_CONTACT.phone)} • <a href="${emailLink}" style="color: #2D5A3D; text-decoration: none;">${escapeHtml(COMPANY_CONTACT.email)}</a>
    </p>
  </div>
</div>`.trim();
};

const buildOrderConfirmationEmailPayload = ({ order, items }) => {
    const pickupDate = formatPickupDateLong(order.pickup_date);
    const subjectDate = pickupDate ? ` - Pickup ${pickupDate}` : '';
    const subject = `Order Confirmed${subjectDate}`;
    const text = buildOrderConfirmationEmailText({ order, items });
    const html = buildOrderConfirmationEmailHtml({ order, items });
    return { subject, text, html };
};

const sendEmailMessage = async ({ to, subject, text, html }) => {
    const content = [
        {
            type: 'text/plain',
            value: text || ''
        }
    ];

    if (html) {
        content.push({
            type: 'text/html',
            value: html
        });
    }

    const response = await fetch('https://api.sendgrid.com/v3/mail/send', {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${EMAIL_API_KEY}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            personalizations: [
                {
                    to: [{
                        email: to.email,
                        name: to.name || undefined
                    }]
                }
            ],
            from: { email: EMAIL_FROM, name: EMAIL_FROM_NAME },
            subject,
            content
        })
    });

    if (!response.ok) {
        const errorBody = await response.text();
        throw new Error(`Email send failed: ${errorBody}`);
    }
};

const sendOrderConfirmationEmail = async (orderId) => {
    if (!EMAIL_API_KEY || !EMAIL_FROM) {
        return { skipped: 'not_configured' };
    }

    const summary = await getOrderSummary(orderId);
    if (!summary) {
        return { skipped: 'missing_order' };
    }

    const { order, items } = summary;
    if (!order.customer_email) {
        return { skipped: 'missing_email' };
    }

    const status = String(order.status || '').toLowerCase();
    if (!PAID_STATUSES.has(status)) {
        return { skipped: 'not_paid' };
    }

    const claim = await pool.query(
        'UPDATE orders SET confirmation_email_sent_at = NOW() WHERE id = $1 AND confirmation_email_sent_at IS NULL RETURNING confirmation_email_sent_at',
        [orderId]
    );
    if (claim.rows.length === 0) {
        return { skipped: 'already_sent' };
    }

    const emailPayload = buildOrderConfirmationEmailPayload({ order, items });

    try {
        await sendEmailMessage({
            to: {
                email: order.customer_email,
                name: order.customer_name
            },
            subject: emailPayload.subject,
            text: emailPayload.text,
            html: emailPayload.html
        });
        return { sent: true };
    } catch (err) {
        await pool.query(
            'UPDATE orders SET confirmation_email_sent_at = NULL WHERE id = $1',
            [orderId]
        );
        throw err;
    }
};

// --- ROUTES ---

app.get('/', (req, res) => res.send('Hen Store API Running 🐔'));

app.get('/api/hens', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM hens WHERE is_active = true ORDER BY id ASC');
        res.json(result.rows);
    } catch (err) {
        res.status(500).send(err.message);
    }
});

// --- CUSTOMER & CHECKOUT ROUTES ---

// 1. Checkout (Upsert Customer -> Create Order -> Stripe Session)
app.post('/api/checkout', async (req, res) => {
    const { customer, items, pickup } = req.body;
    // customer: { name, phone, email, address }
    // pickup: { date, location }
    // items: [{ id, quantity }]

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
            // Optional: Update details if they changed
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

        // B. Calculate Total & Create Stripe Items
        let lineItems = [];
        let totalCents = 0;

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

            // Build product_data for Stripe
            const productData = {
                name: hen.name,
                description: `Bulk Price: $${(unitPrice / 100).toFixed(2)}/unit`,
            };
            if (hen.image_url && hen.image_url.startsWith('http')) {
                productData.images = [hen.image_url];
            } else if (hen.image_url && hen.image_url.startsWith('/')) {
                productData.images = [`${process.env.CLIENT_URL}${hen.image_url}`];
            }

            lineItems.push({
                price_data: {
                    currency: 'cad',
                    product_data: productData,
                    unit_amount: unitPrice,
                },
                quantity,
            });
        }

        // C. Insert Pending Order
        const newOrder = await pool.query(
            `INSERT INTO orders (customer_id, customer_email, total_cents, items, status, pickup_date, pickup_location) 
             VALUES ($1, $2, $3, $4, 'pending', $5, $6) RETURNING id`,
            [customerId, customer.email, totalCents, JSON.stringify(items), pickup.date, pickup.location]
        );
        const orderId = newOrder.rows[0].id;

        // D. Create Stripe Session
        const baseUrl = getRequestBaseUrl(req);
        if (!baseUrl) {
            return res.status(500).json({ error: 'Checkout redirect URL not configured.' });
        }

        const session = await stripe.checkout.sessions.create({
            payment_method_types: ['card'],
            line_items: lineItems,
            mode: 'payment',
            metadata: { order_id: orderId }, // Link Stripe to our DB Order
            success_url: `${baseUrl}/success?session_id={CHECKOUT_SESSION_ID}`,
            cancel_url: `${baseUrl}?canceled=true`,
        });

        // Update Order with Stripe ID
        await pool.query('UPDATE orders SET stripe_payment_id = $1 WHERE id = $2', [session.id, orderId]);

        const confirmToken = signOrderConfirmToken(session.id);
        if (confirmToken) {
            res.cookie(ORDER_CONFIRM_COOKIE, confirmToken, getOrderConfirmCookieOptions());
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
            items
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

// --- ADMIN ROUTES ---

// --- MAIN SITE GATE ---
app.post('/api/main/login', mainLoginLimiter, (req, res) => {
    const { password } = req.body;
    if (!MAIN_PASSWORD || !MAIN_SESSION_SECRET) {
        return res.status(500).json({ error: 'Main site auth not configured.' });
    }
    if (password !== MAIN_PASSWORD) {
        return res.status(401).send('Wrong password');
    }
    const now = Date.now();
    const token = signToken({
        sub: 'main',
        iat: now,
        exp: now + MAIN_SESSION_TTL_MS
    }, MAIN_SESSION_SECRET);
    res.cookie(MAIN_SESSION_COOKIE, token, getMainSessionCookieOptions());
    return res.json({ success: true });
});

app.get('/api/main/session', (req, res) => {
    if (!MAIN_PASSWORD || !MAIN_SESSION_SECRET) {
        return res.status(500).json({ error: 'Main site auth not configured.' });
    }
    const cookies = parseCookies(req.headers.cookie);
    const token = cookies[MAIN_SESSION_COOKIE];
    const session = verifyToken(token, MAIN_SESSION_SECRET);
    if (!session || session.sub !== 'main') {
        return res.status(401).send('Unauthorized');
    }
    return res.json({ success: true });
});

// Middleware for Admin Auth
const checkAuth = (req, res, next) => {
    if (!ADMIN_SESSION_SECRET) {
        return res.status(500).send('Admin auth not configured');
    }
    const cookies = parseCookies(req.headers.cookie);
    const token = cookies[ADMIN_SESSION_COOKIE];
    const session = verifyAdminSession(token);
    if (!session) {
        return res.status(401).send('Unauthorized');
    }
    req.adminSession = session;
    return next();
};

// 1. Login
app.post('/api/admin/login', adminLoginLimiter, (req, res) => {
    const { password } = req.body;
    if (!ADMIN_PASSWORD || !ADMIN_SESSION_SECRET) {
        return res.status(500).json({ error: 'Admin auth not configured.' });
    }
    if (password !== ADMIN_PASSWORD) {
        return res.status(401).send('Wrong password');
    }
    const now = Date.now();
    const token = signAdminSession({
        sub: 'admin',
        iat: now,
        exp: now + ADMIN_SESSION_TTL_MS
    });
    res.cookie(ADMIN_SESSION_COOKIE, token, getAdminSessionCookieOptions());
    return res.json({ success: true });
});

app.get('/api/admin/session', checkAuth, (req, res) => {
    res.json({ success: true });
});

// 2. Get Orders (Admin)
// Now joins with customers table
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


// 3. Update Hen Stock
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

// 4. Pickup Dates (Admin)
// GET Dates (Public)
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

// POST Add Date
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

// DELETE Date
app.delete('/api/admin/pickup-dates/:id', checkAuth, async (req, res) => {
    const { id } = req.params;
    try {
        await pool.query('DELETE FROM pickup_dates WHERE id = $1', [id]);
        res.json({ success: true });
    } catch (err) {
        res.status(500).send(err.message);
    }
});

// 5. Update Order Status
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

// 6. Send Email (Admin)
app.post('/api/admin/email', checkAuth, async (req, res) => {
    if (!EMAIL_API_KEY || !EMAIL_FROM) {
        return res.status(500).json({ error: 'Email is not configured.' });
    }

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
                    content: attachment.content,
                    filename: attachment.filename,
                    type: attachment.type || 'text/plain',
                    disposition: attachment.disposition || 'attachment'
                }))
                : (item.csv
                    ? [{
                        content: Buffer.from(item.csv, 'utf8').toString('base64'),
                        filename: item.filename || 'pickup-orders.csv',
                        type: 'text/csv',
                        disposition: 'attachment'
                    }]
                    : undefined);

            const response = await fetch('https://api.sendgrid.com/v3/mail/send', {
                method: 'POST',
                headers: {
                    Authorization: `Bearer ${EMAIL_API_KEY}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    personalizations: [
                        {
                            to: [{
                                email: item.to.email,
                                name: item.to.name || undefined
                            }]
                        }
                    ],
                    from: { email: EMAIL_FROM, name: EMAIL_FROM_NAME },
                    subject: item.subject,
                    content: [
                        {
                            type: 'text/plain',
                            value: item.text || ''
                        }
                    ],
                    attachments
                })
            });

            if (!response.ok) {
                const errorBody = await response.text();
                return res.status(500).json({ error: `Email send failed: ${errorBody}` });
            }
        }

        res.json({ success: true, sent: validMessages.length });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Email send failed.' });
    }
});

app.listen(port, () => console.log(`Server on port ${port}`));
