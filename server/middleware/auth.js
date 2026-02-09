const jwt = require('jsonwebtoken');
const { getClientIp, parseCookies } = require('../utils/helpers');
const { logError } = require('../utils/logger');

// --- CONSTANTS ---
const ADMIN_SESSION_SECRET = process.env.ADMIN_SESSION_SECRET;
const ADMIN_SESSION_COOKIE = 'admin_session';
const ADMIN_SESSION_DAYS = Number(process.env.ADMIN_SESSION_DAYS || 30);
const ADMIN_SESSION_TTL_MS = Number.isFinite(ADMIN_SESSION_DAYS)
    ? ADMIN_SESSION_DAYS * 24 * 60 * 60 * 1000
    : 30 * 24 * 60 * 60 * 1000;

const MAIN_SESSION_SECRET = process.env.MAIN_SESSION_SECRET || ADMIN_SESSION_SECRET;
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

const isProduction = process.env.NODE_ENV === 'production';

// --- RATE LIMITER ---
const rateLimitStore = new Map();
let lastRateLimitPruneAt = 0;
const RATE_LIMIT_PRUNE_INTERVAL_MS = 60 * 1000;
const RATE_LIMIT_TABLE_NAME = 'rate_limit_entries';
let rateLimitTableReadyPromise = null;

const ensureRateLimitTable = async (pool) => {
    if (!pool) return;
    if (rateLimitTableReadyPromise) {
        await rateLimitTableReadyPromise;
        return;
    }
    rateLimitTableReadyPromise = (async () => {
        await pool.query(
            `
            CREATE TABLE IF NOT EXISTS ${RATE_LIMIT_TABLE_NAME} (
                key TEXT PRIMARY KEY,
                count INTEGER NOT NULL,
                reset_at TIMESTAMP WITH TIME ZONE NOT NULL
            )
            `
        );
        await pool.query(
            `CREATE INDEX IF NOT EXISTS rate_limit_entries_reset_at_idx
             ON ${RATE_LIMIT_TABLE_NAME} (reset_at)`
        );
    })();
    await rateLimitTableReadyPromise;
};

const applyMemoryRateLimit = ({ key, now, windowMs, max, res, next }) => {
    if (now - lastRateLimitPruneAt >= RATE_LIMIT_PRUNE_INTERVAL_MS) {
        for (const [storedKey, storedValue] of rateLimitStore.entries()) {
            if (!storedValue || storedValue.resetAt <= now) {
                rateLimitStore.delete(storedKey);
            }
        }
        lastRateLimitPruneAt = now;
    }
    const entry = rateLimitStore.get(key);
    if (!entry || entry.resetAt <= now) {
        rateLimitStore.set(key, { count: 1, resetAt: now + windowMs });
        return next();
    }
    entry.count += 1;
    if (entry.count > max) {
        const retryAfter = Math.ceil((entry.resetAt - now) / 1000);
        res.set('Retry-After', String(Math.max(retryAfter, 1)));
        return res.status(429).json({ error: 'Too many requests. Please try again later.' });
    }
    return next();
};

const applyDatabaseRateLimit = async ({ key, now, windowMs, max, pool, res, next }) => {
    await ensureRateLimitTable(pool);
    const nowDate = new Date(now);
    const nextResetAt = new Date(now + windowMs);
    const result = await pool.query(
        `
        INSERT INTO ${RATE_LIMIT_TABLE_NAME} (key, count, reset_at)
        VALUES ($1, 1, $2)
        ON CONFLICT (key) DO UPDATE
        SET
            count = CASE
                WHEN ${RATE_LIMIT_TABLE_NAME}.reset_at <= $3 THEN 1
                ELSE ${RATE_LIMIT_TABLE_NAME}.count + 1
            END,
            reset_at = CASE
                WHEN ${RATE_LIMIT_TABLE_NAME}.reset_at <= $3 THEN $2
                ELSE ${RATE_LIMIT_TABLE_NAME}.reset_at
            END
        RETURNING count, reset_at
        `,
        [key, nextResetAt, nowDate]
    );

    if (now - lastRateLimitPruneAt >= RATE_LIMIT_PRUNE_INTERVAL_MS) {
        await pool.query(
            `DELETE FROM ${RATE_LIMIT_TABLE_NAME} WHERE reset_at <= $1`,
            [nowDate]
        );
        lastRateLimitPruneAt = now;
    }

    const row = result.rows[0];
    const count = Number(row?.count || 0);
    const resetAtMs = row?.reset_at ? new Date(row.reset_at).getTime() : now + windowMs;
    if (count > max) {
        const retryAfter = Math.ceil((resetAtMs - now) / 1000);
        res.set('Retry-After', String(Math.max(retryAfter, 1)));
        return res.status(429).json({ error: 'Too many requests. Please try again later.' });
    }
    return next();
};

const createRateLimiter = ({ windowMs, max, keyPrefix, pool }) => {
    if (!pool) {
        return (req, res, next) => {
            const key = `${keyPrefix}:${getClientIp(req)}`;
            const now = Date.now();
            return applyMemoryRateLimit({ key, now, windowMs, max, res, next });
        };
    }

    return async (req, res, next) => {
        const key = `${keyPrefix}:${getClientIp(req)}`;
        const now = Date.now();
        try {
            return await applyDatabaseRateLimit({
                key,
                now,
                windowMs,
                max,
                pool,
                res,
                next
            });
        } catch (err) {
            // Fail open for auth availability if limiter store is unavailable.
            logError('Rate limiter storage failed, falling back to memory', err);
            return applyMemoryRateLimit({ key, now, windowMs, max, res, next });
        }
    };
};

// --- JWT HELPERS ---
const signToken = (payload, secret, expiresInMs) => {
    if (!secret) throw new Error('Secret not configured');
    return jwt.sign(payload, secret, { expiresIn: `${expiresInMs}ms` });
};

const verifyToken = (token, secret) => {
    if (!token || !secret) return null;
    try {
        return jwt.verify(token, secret);
    } catch (err) {
        return null;
    }
};

// --- SPECIFIC SIGNERS ---
const signAdminSession = (payload) => signToken(payload, ADMIN_SESSION_SECRET, ADMIN_SESSION_TTL_MS);
const verifyAdminSession = (token) => verifyToken(token, ADMIN_SESSION_SECRET);

const signMainSession = (payload) => signToken(payload, MAIN_SESSION_SECRET, MAIN_SESSION_TTL_MS);
const verifyMainSession = (token) => verifyToken(token, MAIN_SESSION_SECRET);

const signOrderConfirmToken = (sessionId) => {
    if (!ORDER_CONFIRM_SECRET || !sessionId) return null;
    return signToken({ sub: 'order-confirm', sid: sessionId }, ORDER_CONFIRM_SECRET, ORDER_CONFIRM_TTL_MS);
};
const verifyOrderConfirmToken = (token) => verifyToken(token, ORDER_CONFIRM_SECRET);

// --- COOKIE OPTIONS ---
const baseCookieOptions = {
    httpOnly: true,
    sameSite: isProduction ? 'none' : 'lax',
    secure: isProduction, // simplified for now, assuming standard prod env
    path: '/api'
};
const getCookieOptions = (maxAge) => ({
    ...baseCookieOptions,
    maxAge
});
const getClearCookieOptions = () => ({ ...baseCookieOptions });

// --- MIDDLEWARE ---
const checkAuth = (req, res, next) => {
    if (!ADMIN_SESSION_SECRET) {
        return res.status(500).send('Admin auth not configured');
    }
    const cookies = parseCookies(req.headers.cookie);
    const token = cookies[ADMIN_SESSION_COOKIE];
    const session = verifyAdminSession(token);
    if (!session || session.sub !== 'admin') {
        return res.status(401).send('Unauthorized');
    }
    req.adminSession = session;
    return next();
};

module.exports = {
    createRateLimiter,
    signAdminSession,
    verifyAdminSession,
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
};
