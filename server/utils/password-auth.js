const crypto = require('crypto');
const { getClientIp } = require('./helpers');

const safeCompare = (left, right) => {
    const leftBuf = Buffer.from(String(left ?? ''), 'utf8');
    const rightBuf = Buffer.from(String(right ?? ''), 'utf8');
    if (leftBuf.length !== rightBuf.length) return false;
    return crypto.timingSafeEqual(leftBuf, rightBuf);
};

const verifyScryptHash = (input, encoded) => {
    const [, saltB64, digestB64] = String(encoded).split('$');
    if (!saltB64 || !digestB64) return false;
    const salt = Buffer.from(saltB64, 'base64');
    const digest = Buffer.from(digestB64, 'base64');
    const derived = crypto.scryptSync(String(input ?? ''), salt, digest.length);
    return crypto.timingSafeEqual(derived, digest);
};

const verifySha256Hash = (input, encoded) => {
    const [, expectedHex] = String(encoded).split('$');
    if (!expectedHex) return false;
    const digestHex = crypto
        .createHash('sha256')
        .update(String(input ?? ''), 'utf8')
        .digest('hex');
    return safeCompare(digestHex, expectedHex);
};

const verifyPassword = ({ candidate, plainSecret, hashedSecret }) => {
    if (hashedSecret) {
        if (hashedSecret.startsWith('scrypt$')) {
            return verifyScryptHash(candidate, hashedSecret);
        }
        if (hashedSecret.startsWith('sha256$')) {
            return verifySha256Hash(candidate, hashedSecret);
        }
        return safeCompare(candidate, hashedSecret);
    }
    if (!plainSecret) return false;
    return safeCompare(candidate, plainSecret);
};

const parseAllowlist = (value) => String(value || '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);

const isIpAllowed = (req, allowlist) => {
    if (!Array.isArray(allowlist) || allowlist.length === 0) return true;
    const ip = getClientIp(req);
    return allowlist.includes(ip);
};

const hashPasswordScrypt = (plainText) => {
    const salt = crypto.randomBytes(16);
    const digest = crypto.scryptSync(String(plainText ?? ''), salt, 32);
    return `scrypt$${salt.toString('base64')}$${digest.toString('base64')}`;
};

module.exports = {
    verifyPassword,
    parseAllowlist,
    isIpAllowed,
    hashPasswordScrypt
};
