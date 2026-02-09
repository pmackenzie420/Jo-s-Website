const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

const express = require('express');
const cors = require('cors');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

const pool = require('./db');
const {
    parseOriginList,
    parseCookies,
    normalizeLanguage,
    formatPickupDate,
    parseOrderItems
} = require('./utils/helpers');
const { logInfo, logError } = require('./utils/logger');
const {
    calculateItemPrice,
    isLohmannHenName,
    getMinimumOrderQuantity,
    getDepositEligibleMinQty,
    isPickupLocationRestricted,
    getPaymentDetails,
    getOrderSummary
} = require('./logic/pricing');
const {
    sanitizeText,
    isValidEmail,
    normalizeCheckoutItems,
    collectOrderItemTotals
} = require('./logic/checkout-utils');
const {
    getOrderItemTotals,
    findPickupDateIdByValue,
    reserveStockForItems,
    releaseStockForItems
} = require('./logic/order-stock');
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
    getClearCookieOptions,
    ADMIN_SESSION_COOKIE,
    ADMIN_SESSION_TTL_MS,
    MAIN_SESSION_COOKIE,
    MAIN_SESSION_TTL_MS,
    ORDER_CONFIRM_COOKIE,
    ORDER_CONFIRM_TTL_MS
} = require('./middleware/auth');
const { PAID_STATUSES } = require('./config/constants');
const {
    CHECKOUT_MAX_ITEM_ROWS,
    RESERVED_ORDER_STATUS,
    CHECKOUT_RESERVATION_TTL_MINUTES,
    EXPIRED_RESERVATION_BATCH_SIZE
} = require('./config/checkout');
const { createOrderLifecycle } = require('./logic/order-lifecycle');
const { registerMainAuthRoutes } = require('./routes/main-auth');
const { registerCatalogRoutes } = require('./routes/catalog');
const { registerAdminRoutes } = require('./routes/admin');
const { registerCheckoutRoutes } = require('./routes/checkout');
const { registerWebhookRoutes } = require('./routes/webhook');

const app = express();
const port = process.env.PORT || 3000;
const isProduction = process.env.NODE_ENV === 'production';
const parseTrustProxySetting = (value) => {
    if (typeof value !== 'string' || value.trim().length === 0) {
        return isProduction ? 1 : false;
    }
    const normalized = value.trim().toLowerCase();
    if (normalized === 'true') return true;
    if (normalized === 'false') return false;
    const numeric = Number(normalized);
    if (Number.isInteger(numeric) && numeric >= 0) {
        return numeric;
    }
    return value;
};
app.set('trust proxy', parseTrustProxySetting(process.env.TRUST_PROXY));

const corsOrigins = parseOriginList(process.env.CORS_ORIGINS || process.env.CLIENT_URL);
if (!isProduction) {
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

const sendServerError = (res, err, message = 'Server error') => {
    logError(message, err);
    if (!isProduction) {
        return res.status(500).json({
            error: message,
            detail: err?.message || null
        });
    }
    return res.status(500).json({ error: message });
};

const adminLoginLimiter = createRateLimiter({
    windowMs: 15 * 60 * 1000,
    max: 30,
    keyPrefix: 'admin-login',
    pool
});

const mainLoginLimiter = createRateLimiter({
    windowMs: 15 * 60 * 1000,
    max: 60,
    keyPrefix: 'main-login',
    pool
});

const orderConfirmLimiter = createRateLimiter({
    windowMs: 60 * 1000,
    max: 30,
    keyPrefix: 'order-confirm',
    pool
});

const {
    withTransaction,
    releaseReservedOrder,
    finalizeOrderFromSession,
    sweepExpiredReservedOrders
} = createOrderLifecycle({
    pool,
    stripe,
    parseOrderItems,
    collectOrderItemTotals,
    getOrderItemTotals,
    findPickupDateIdByValue,
    reserveStockForItems,
    releaseStockForItems,
    sendOrderConfirmationEmail,
    PAID_STATUSES,
    RESERVED_ORDER_STATUS,
    CHECKOUT_RESERVATION_TTL_MINUTES,
    EXPIRED_RESERVATION_BATCH_SIZE
});

const RESERVATION_SWEEP_INTERVAL_SECONDS = Math.max(
    Number(process.env.RESERVATION_SWEEP_INTERVAL_SECONDS || 300),
    60
);
let reservationSweepRunning = false;
const runReservationSweep = async () => {
    if (reservationSweepRunning) return;
    reservationSweepRunning = true;
    try {
        await sweepExpiredReservedOrders();
    } catch (err) {
        logError('Scheduled reservation sweep failed', err);
    } finally {
        reservationSweepRunning = false;
    }
};
const reservationSweepTimer = setInterval(
    runReservationSweep,
    RESERVATION_SWEEP_INTERVAL_SECONDS * 1000
);
if (typeof reservationSweepTimer.unref === 'function') {
    reservationSweepTimer.unref();
}
runReservationSweep();

registerWebhookRoutes(app, {
    stripe,
    webhookSecret: process.env.STRIPE_WEBHOOK_SECRET,
    finalizeOrderFromSession,
    releaseReservedOrder
});

app.use(express.json());
app.get('/', (req, res) => res.send('Hen Store API Running 🐔'));

const { handlePickupStockRequest } = registerCatalogRoutes(app, {
    pool,
    sendServerError
});

registerCheckoutRoutes(app, {
    pool,
    stripe,
    sendServerError,
    orderConfirmLimiter,
    getRequestBaseUrl,
    normalizeCheckoutItems,
    normalizeLanguage,
    sanitizeText,
    isValidEmail,
    calculateItemPrice,
    isLohmannHenName,
    getMinimumOrderQuantity,
    getDepositEligibleMinQty,
    isPickupLocationRestricted,
    getPaymentDetails,
    getOrderSummary,
    parseCookies,
    signOrderConfirmToken,
    verifyOrderConfirmToken,
    getCookieOptions,
    ORDER_CONFIRM_COOKIE,
    ORDER_CONFIRM_TTL_MS,
    CHECKOUT_MAX_ITEM_ROWS,
    RESERVED_ORDER_STATUS,
    CHECKOUT_RESERVATION_TTL_MINUTES,
    PAID_STATUSES,
    reserveStockForItems,
    withTransaction,
    finalizeOrderFromSession,
    releaseReservedOrder,
    sweepExpiredReservedOrders
});

registerMainAuthRoutes(app, {
    mainLoginLimiter,
    signMainSession,
    verifyMainSession,
    parseCookies,
    MAIN_SESSION_COOKIE,
    MAIN_SESSION_TTL_MS,
    getCookieOptions,
    getClearCookieOptions
});

registerAdminRoutes(app, {
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
});

app.listen(port, () => logInfo(`Server on port ${port}`));
