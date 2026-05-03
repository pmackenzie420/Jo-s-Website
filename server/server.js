const path = require('path');
const { randomUUID } = require('crypto');
require('dotenv').config({ path: path.join(__dirname, '.env') });

const { Sentry, sentryEnabled, captureException } = require('./sentry');
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
    getDepositRequiredAboveQty,
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
    ensureEmailOpsSchema,
    applyEmailWebhookEvent,
    verifyManagedEmailAddress
} = require('./logic/email-ops');
const {
    ensureAuditOpsSchema,
    recordOrderEvent,
    recordAdminAction,
    recordPaymentEvent,
    startBatchRun,
    finalizeBatchRun,
    recordInventoryEvent,
    recordInventoryEvents
} = require('./logic/audit-ops');
const {
    ensureOrderCustomerSnapshotsSchema
} = require('./logic/order-customer-snapshots');
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
const { verifyCheckoutEmail } = require('./logic/email-verification');
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
const JSON_BODY_LIMIT = process.env.JSON_BODY_LIMIT || '2mb';
const parsePositiveInteger = (value, fallback) => {
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed <= 0) {
        return fallback;
    }
    return parsed;
};
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

const DEFAULT_PORTS = {
    'http:': '80',
    'https:': '443'
};

const normalizeOrigin = (value) => {
    if (typeof value !== 'string') return '';
    const trimmed = value.trim().replace(/\/+$/, '');
    if (!trimmed) return '';

    try {
        const parsed = new URL(trimmed);
        const protocol = parsed.protocol.toLowerCase();
        const hostname = parsed.hostname.toLowerCase();
        const port = parsed.port || '';
        const defaultPort = DEFAULT_PORTS[protocol] || '';
        const normalizedPort = port && port !== defaultPort ? `:${port}` : '';
        return `${protocol}//${hostname}${normalizedPort}`;
    } catch {
        return trimmed.toLowerCase();
    }
};

const stripWwwPrefix = (value) => String(value || '').replace(/^www\./i, '');

const areOriginsEquivalent = (left, right) => {
    try {
        const leftUrl = new URL(left);
        const rightUrl = new URL(right);
        const leftProtocol = leftUrl.protocol.toLowerCase();
        const rightProtocol = rightUrl.protocol.toLowerCase();
        if (leftProtocol !== rightProtocol) return false;

        const leftPort = leftUrl.port || DEFAULT_PORTS[leftProtocol] || '';
        const rightPort = rightUrl.port || DEFAULT_PORTS[rightProtocol] || '';
        if (leftPort !== rightPort) return false;

        const leftHost = leftUrl.hostname.toLowerCase();
        const rightHost = rightUrl.hostname.toLowerCase();
        return leftHost === rightHost
            || stripWwwPrefix(leftHost) === stripWwwPrefix(rightHost);
    } catch {
        return left === right;
    }
};

app.set('trust proxy', parseTrustProxySetting(process.env.TRUST_PROXY));

const configuredCorsOrigins = parseOriginList(process.env.CORS_ORIGINS || process.env.CLIENT_URL);
if (!isProduction) {
    configuredCorsOrigins.push(
        'http://localhost:5173',
        'http://127.0.0.1:5173',
        'http://localhost:3000',
        'http://127.0.0.1:3000'
    );
}

const corsOrigins = Array.from(
    new Set(configuredCorsOrigins.map((origin) => normalizeOrigin(origin)).filter(Boolean))
);

const isAllowedCorsOrigin = (origin) => {
    const normalizedOrigin = normalizeOrigin(origin);
    if (!normalizedOrigin) return false;
    return corsOrigins.some((allowedOrigin) => areOriginsEquivalent(normalizedOrigin, allowedOrigin));
};

const corsOptions = {
    origin: (origin, callback) => {
        if (!origin) {
            callback(null, true);
            return;
        }
        if (corsOrigins.length > 0 && isAllowedCorsOrigin(origin)) {
            callback(null, true);
            return;
        }
        // Fail closed without surfacing routine cross-origin probes as server errors.
        callback(null, false);
    },
    credentials: true,
    optionsSuccessStatus: 200
};

app.use(cors(corsOptions));
app.use((req, res, next) => {
    const incomingRequestId = String(req.get('x-request-id') || '').trim();
    req.requestId = incomingRequestId || randomUUID();
    res.setHeader('X-Request-Id', req.requestId);
    next();
});

const getRequestBaseUrl = (req) => {
    const envUrl = normalizeOrigin(process.env.CLIENT_URL || '');
    const originHeader = req.get('origin');
    const sanitizedOrigin = normalizeOrigin(originHeader || '');

    if (envUrl) {
        return envUrl;
    }

    if (sanitizedOrigin && isAllowedCorsOrigin(sanitizedOrigin)) {
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
    const candidate = normalizeOrigin(`${proto}://${host}`);

    if (!isProduction && corsOrigins.length === 0) {
        return candidate;
    }
    if (candidate && isAllowedCorsOrigin(candidate)) {
        return candidate;
    }
    return null;
};

const sendServerError = (res, err, message = 'Server error') => {
    logError(message, err);
    const sentryEventId = captureException(err, {
        tags: { handler: 'sendServerError' },
        extra: { message }
    });
    if (!isProduction) {
        return res.status(500).json({
            error: message,
            detail: err?.message || null,
            sentryEventId: sentryEventId || null
        });
    }
    const payload = { error: message };
    if (sentryEventId) {
        payload.errorId = sentryEventId;
    }
    return res.status(500).json(payload);
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

const emailVerifyLimiter = createRateLimiter({
    windowMs: 60 * 1000,
    max: parsePositiveInteger(process.env.EMAIL_VERIFY_RATE_LIMIT_MAX, 120),
    keyPrefix: 'email-verify',
    pool
});

const checkoutLimiter = createRateLimiter({
    windowMs: 60 * 1000,
    max: parsePositiveInteger(process.env.CHECKOUT_RATE_LIMIT_MAX, 60),
    keyPrefix: 'checkout',
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
    recordOrderEvent,
    recordPaymentEvent,
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
    releaseReservedOrder,
    resendWebhookSecret: process.env.RESEND_WEBHOOK_SECRET,
    recordPaymentEvent: (payload) => recordPaymentEvent(pool, payload),
    applyEmailWebhookEvent: (payload) => applyEmailWebhookEvent({
        pool,
        ...payload
    })
});

app.use(express.json({ limit: JSON_BODY_LIMIT }));
app.get('/', (req, res) => res.send('Hen Store API Running 🐔'));

const { handlePickupStockRequest } = registerCatalogRoutes(app, {
    pool,
    sendServerError
});

registerCheckoutRoutes(app, {
    pool,
    stripe,
    sendServerError,
    checkoutLimiter,
    emailVerifyLimiter,
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
    getDepositRequiredAboveQty,
    isPickupLocationRestricted,
    getPaymentDetails,
    getOrderSummary,
    parseCookies,
    signOrderConfirmToken,
    verifyOrderConfirmToken,
    verifyCheckoutEmail,
    verifyManagedEmailAddress,
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
    sweepExpiredReservedOrders,
    recordPaymentEvent
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
    sendOrderConfirmationEmail,
    formatPickupDate,
    handlePickupStockRequest,
    releaseReservedOrder,
    verifyCheckoutEmail,
    stripe,
    CHECKOUT_RESERVATION_TTL_MINUTES,
    getRequestBaseUrl,
    finalizeOrderFromSession,
    recordOrderEvent,
    recordAdminAction,
    recordPaymentEvent,
    startBatchRun,
    finalizeBatchRun,
    recordInventoryEvent,
    recordInventoryEvents
});

if (sentryEnabled) {
    Sentry.setupExpressErrorHandler(app, {
        shouldHandleError: (error) => {
            const status =
                Number(error?.statusCode)
                || Number(error?.status)
                || Number(error?.status_code)
                || Number(error?.output?.statusCode);
            return !Number.isFinite(status) || status >= 500;
        }
    });
}

app.use((err, req, res, next) => {
    if (res.headersSent) {
        return next(err);
    }
    logError('Unhandled request error', err);
    const statusCandidate = Number(err?.statusCode || err?.status || err?.status_code);
    const statusCode =
        Number.isInteger(statusCandidate) && statusCandidate >= 400 && statusCandidate < 600
            ? statusCandidate
            : 500;
    const sentryEventId = res.sentry || captureException(err, {
        tags: { handler: 'unhandledMiddleware' },
        extra: {
            path: req?.path,
            method: req?.method
        }
    });
    if (!isProduction) {
        return res.status(statusCode).json({
            error: statusCode >= 500 ? 'Server error' : 'Request error',
            detail: err?.message || null,
            sentryEventId: sentryEventId || null
        });
    }
    const payload = {
        error: statusCode >= 500 ? 'Server error' : 'Request error'
    };
    if (sentryEventId) {
        payload.errorId = sentryEventId;
    }
    return res.status(statusCode).json(payload);
});

const startServer = async () => {
    try {
        await ensureOrderCustomerSnapshotsSchema(pool);
    } catch (err) {
        logError('Failed to ensure order customer snapshot schema', err);
        process.exitCode = 1;
        return;
    }

    try {
        await ensureAuditOpsSchema(pool);
    } catch (err) {
        logError('Failed to ensure audit operations schema', err);
        process.exitCode = 1;
        return;
    }

    try {
        await ensureEmailOpsSchema(pool);
    } catch (err) {
        logError('Failed to ensure email operations schema', err);
        process.exitCode = 1;
        return;
    }

    app.listen(port, () => logInfo(`Server on port ${port}`));
};

startServer();
