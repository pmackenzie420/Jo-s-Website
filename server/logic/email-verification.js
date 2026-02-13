const dns = require('node:dns').promises;
const { isValidEmail } = require('./checkout-utils');

const DOMAIN_TYPO_MAP = Object.freeze({
    'gmial.com': 'gmail.com',
    'gamil.com': 'gmail.com',
    'gmai.com': 'gmail.com',
    'gnail.com': 'gmail.com',
    'gmail.co': 'gmail.com',
    'gmail.con': 'gmail.com',
    'hotnail.com': 'hotmail.com',
    'hotmai.com': 'hotmail.com',
    'hotmial.com': 'hotmail.com',
    'outlok.com': 'outlook.com',
    'outllok.com': 'outlook.com',
    'yaho.com': 'yahoo.com',
    'yhoo.com': 'yahoo.com',
    'icloud.co': 'icloud.com',
    'icloud.con': 'icloud.com',
    'protonmai.com': 'protonmail.com',
    'protonmail.co': 'protonmail.com'
});

const DISPOSABLE_DOMAINS = new Set([
    'mailinator.com',
    'guerrillamail.com',
    '10minutemail.com',
    'temp-mail.org',
    'yopmail.com',
    'sharklasers.com'
]);

const parsePositiveNumber = (value, fallback) => {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed <= 0) {
        return fallback;
    }
    return parsed;
};

const normalizeLanguage = (value) => {
    const normalized = String(value || '').trim().toLowerCase();
    if (normalized.startsWith('fr')) return 'fr';
    return 'en';
};

const readCode = (error) => String(error?.code || '').toUpperCase();

const isDomainNotFoundCode = (code) => (
    code === 'ENOTFOUND'
    || code === 'NXDOMAIN'
    || code === 'EAI_NONAME'
);

const isTemporaryDnsCode = (code) => (
    code === 'ETIMEOUT'
    || code === 'EAI_AGAIN'
    || code === 'SERVFAIL'
    || code === 'REFUSED'
    || code === 'ECONNREFUSED'
);

const messageCatalog = {
    en: {
        valid: 'Email looks good.',
        invalidFormat: 'Please enter a valid email address.',
        domainNotFound: 'That email domain does not exist.',
        noMailRecords: 'That email domain cannot receive mail.',
        dnsUnavailable: 'Could not fully verify the email domain right now. You can continue.',
        disposable: 'Temporary email detected. You may miss order updates.',
        typo: (suggestedEmail) => `Did you mean ${suggestedEmail}?`
    },
    fr: {
        valid: 'Le courriel semble valide.',
        invalidFormat: 'Veuillez entrer une adresse courriel valide.',
        domainNotFound: "Ce domaine de courriel n'existe pas.",
        noMailRecords: 'Ce domaine de courriel ne peut pas recevoir de messages.',
        dnsUnavailable: "Impossible de vérifier complètement le domaine pour le moment. Vous pouvez continuer.",
        disposable: 'Courriel temporaire détecté. Vous pourriez manquer les mises à jour de commande.',
        typo: (suggestedEmail) => `Vouliez-vous dire ${suggestedEmail} ?`
    }
};

const buildResponse = ({
    accepted,
    shouldBlock,
    status,
    reason,
    message,
    normalizedEmail,
    suggestion
}) => ({
    accepted,
    shouldBlock,
    status,
    reason,
    message,
    normalizedEmail,
    suggestion: suggestion || null
});

const createEmailVerifier = ({
    resolver = dns,
    now = () => Date.now(),
    cacheTtlMs = parsePositiveNumber(process.env.EMAIL_VERIFY_CACHE_TTL_SECONDS, 600) * 1000
} = {}) => {
    const domainCache = new Map();

    const getDomainSignals = async (domain) => {
        const nowMs = now();
        const cached = domainCache.get(domain);
        if (cached && cached.expiresAt > nowMs) {
            return cached.value;
        }

        let mxRecords = [];
        let mxErrorCode = '';

        try {
            mxRecords = await resolver.resolveMx(domain);
        } catch (error) {
            mxErrorCode = readCode(error);
        }

        if (mxRecords.length > 0) {
            const value = { status: 'valid_mx' };
            domainCache.set(domain, { expiresAt: nowMs + cacheTtlMs, value });
            return value;
        }

        if (isDomainNotFoundCode(mxErrorCode)) {
            const value = { status: 'domain_not_found', code: mxErrorCode };
            domainCache.set(domain, { expiresAt: nowMs + cacheTtlMs, value });
            return value;
        }

        const [a4Result, a6Result] = await Promise.allSettled([
            resolver.resolve4(domain),
            resolver.resolve6(domain)
        ]);

        const hasAddressRecord = (
            (a4Result.status === 'fulfilled' && Array.isArray(a4Result.value) && a4Result.value.length > 0)
            || (a6Result.status === 'fulfilled' && Array.isArray(a6Result.value) && a6Result.value.length > 0)
        );

        if (hasAddressRecord) {
            const value = { status: 'valid_address_fallback' };
            domainCache.set(domain, { expiresAt: nowMs + cacheTtlMs, value });
            return value;
        }

        const a4Code = a4Result.status === 'rejected' ? readCode(a4Result.reason) : '';
        const a6Code = a6Result.status === 'rejected' ? readCode(a6Result.reason) : '';
        const allCodes = [mxErrorCode, a4Code, a6Code].filter(Boolean);

        if (allCodes.some(isDomainNotFoundCode)) {
            const value = { status: 'domain_not_found', code: allCodes.find(isDomainNotFoundCode) };
            domainCache.set(domain, { expiresAt: nowMs + cacheTtlMs, value });
            return value;
        }

        if (allCodes.some(isTemporaryDnsCode)) {
            const value = { status: 'dns_unavailable', code: allCodes.find(isTemporaryDnsCode) };
            domainCache.set(domain, { expiresAt: nowMs + cacheTtlMs, value });
            return value;
        }

        const value = { status: 'no_mail_records', code: mxErrorCode || a4Code || a6Code || null };
        domainCache.set(domain, { expiresAt: nowMs + cacheTtlMs, value });
        return value;
    };

    const verify = async (rawEmail, { language = 'en' } = {}) => {
        const locale = normalizeLanguage(language);
        const messages = messageCatalog[locale];
        const normalizedEmail = String(rawEmail || '').trim().toLowerCase();

        if (!isValidEmail(normalizedEmail)) {
            return buildResponse({
                accepted: false,
                shouldBlock: true,
                status: 'invalid',
                reason: 'invalid_format',
                message: messages.invalidFormat,
                normalizedEmail,
                suggestion: null
            });
        }

        const parts = normalizedEmail.split('@');
        const localPart = parts[0] || '';
        const domain = parts[1] || '';
        if (
            parts.length !== 2
            || !localPart
            || !domain
            || domain.startsWith('.')
            || domain.endsWith('.')
            || domain.includes('..')
            || domain.length > 253
        ) {
            return buildResponse({
                accepted: false,
                shouldBlock: true,
                status: 'invalid',
                reason: 'invalid_format',
                message: messages.invalidFormat,
                normalizedEmail,
                suggestion: null
            });
        }

        const suggestedDomain = DOMAIN_TYPO_MAP[domain] || null;
        const suggestedEmail = suggestedDomain ? `${localPart}@${suggestedDomain}` : null;

        if (DISPOSABLE_DOMAINS.has(domain)) {
            return buildResponse({
                accepted: true,
                shouldBlock: false,
                status: 'warning',
                reason: 'disposable_domain',
                message: messages.disposable,
                normalizedEmail,
                suggestion: suggestedEmail
            });
        }

        const domainSignals = await getDomainSignals(domain);
        if (domainSignals.status === 'domain_not_found') {
            const typoSuffix = suggestedEmail ? ` ${messages.typo(suggestedEmail)}` : '';
            return buildResponse({
                accepted: false,
                shouldBlock: true,
                status: 'invalid',
                reason: 'domain_not_found',
                message: `${messages.domainNotFound}${typoSuffix}`.trim(),
                normalizedEmail,
                suggestion: suggestedEmail
            });
        }

        if (domainSignals.status === 'no_mail_records') {
            const typoSuffix = suggestedEmail ? ` ${messages.typo(suggestedEmail)}` : '';
            return buildResponse({
                accepted: false,
                shouldBlock: true,
                status: 'invalid',
                reason: 'no_mail_records',
                message: `${messages.noMailRecords}${typoSuffix}`.trim(),
                normalizedEmail,
                suggestion: suggestedEmail
            });
        }

        if (domainSignals.status === 'dns_unavailable') {
            return buildResponse({
                accepted: true,
                shouldBlock: false,
                status: 'warning',
                reason: 'dns_unavailable',
                message: messages.dnsUnavailable,
                normalizedEmail,
                suggestion: suggestedEmail
            });
        }

        if (suggestedEmail) {
            return buildResponse({
                accepted: true,
                shouldBlock: false,
                status: 'warning',
                reason: 'possible_typo',
                message: messages.typo(suggestedEmail),
                normalizedEmail,
                suggestion: suggestedEmail
            });
        }

        return buildResponse({
            accepted: true,
            shouldBlock: false,
            status: 'valid',
            reason: 'valid',
            message: messages.valid,
            normalizedEmail,
            suggestion: null
        });
    };

    return {
        verify
    };
};

const defaultVerifier = createEmailVerifier();

const verifyCheckoutEmail = (email, options) => defaultVerifier.verify(email, options);

module.exports = {
    createEmailVerifier,
    verifyCheckoutEmail
};
