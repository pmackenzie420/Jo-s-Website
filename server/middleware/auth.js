const jwt = require('jsonwebtoken');
const { getClientIp, parseCookies } = require('../utils/helpers');

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
const getCookieOptions = (maxAge) => ({
    httpOnly: true,
    sameSite: isProduction ? 'none' : 'lax',
    secure: isProduction, // simplified for now, assuming standard prod env
    maxAge,
    path: '/api'
});

// --- MIDDLEWARE ---
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
    ADMIN_SESSION_COOKIE,
    ADMIN_SESSION_TTL_MS,
    MAIN_SESSION_COOKIE,
    MAIN_SESSION_TTL_MS,
    ORDER_CONFIRM_COOKIE,
    ORDER_CONFIRM_TTL_MS
};
