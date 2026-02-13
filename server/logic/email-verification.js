const dns = require('node:dns').promises;
const { isValidEmail } = require('./checkout-utils');

const QUICK_EMAIL_VERIFY_URL = 'https://api.quickemailverification.com/v1/verify';

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

const normalizeProvider = (value) => {
    const normalized = String(value || '').trim().toLowerCase();
    if (normalized === 'dns') return 'dns';
    if (normalized === 'quickemailverification' || normalized === 'qev') return 'quickemailverification';
    return 'auto';
};

const toBoolean = (value) => {
    if (typeof value === 'boolean') return value;
    const normalized = String(value || '').trim().toLowerCase();
    return normalized === 'true' || normalized === '1' || normalized === 'yes';
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
        mailboxRejected: 'That mailbox appears invalid or does not exist.',
        mailboxUnknown: 'Mailbox status could not be fully confirmed. You can continue.',
        acceptAll: 'This domain accepts all inboxes, so delivery certainty is lower.',
        roleBased: 'This looks like a role-based address (for example info@).',
        typo: (suggestedEmail) => `Did you mean ${suggestedEmail}?`
    },
    fr: {
        valid: 'Le courriel semble valide.',
        invalidFormat: 'Veuillez entrer une adresse courriel valide.',
        domainNotFound: "Ce domaine de courriel n'existe pas.",
        noMailRecords: 'Ce domaine de courriel ne peut pas recevoir de messages.',
        dnsUnavailable: "Impossible de vérifier complètement le domaine pour le moment. Vous pouvez continuer.",
        disposable: 'Courriel temporaire détecté. Vous pourriez manquer les mises à jour de commande.',
        mailboxRejected: "Cette boîte courriel semble invalide ou inexistante.",
        mailboxUnknown: 'Le statut de cette boîte courriel ne peut pas être confirmé pour le moment. Vous pouvez continuer.',
        acceptAll: 'Ce domaine accepte toutes les adresses, donc la certitude de livraison est plus faible.',
        roleBased: 'Cela ressemble à une adresse générique (par exemple info@).',
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

const getDomainSuggestion = (normalizedEmail) => {
    const parts = String(normalizedEmail || '').split('@');
    if (parts.length !== 2) return null;
    const localPart = parts[0] || '';
    const domain = parts[1] || '';
    if (!localPart || !domain) return null;
    const suggestedDomain = DOMAIN_TYPO_MAP[domain];
    if (!suggestedDomain) return null;
    return `${localPart}@${suggestedDomain}`;
};

const isValidParsedEmail = (normalizedEmail) => {
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
        return false;
    }
    return true;
};

const createEmailVerifier = ({
    resolver = dns,
    now = () => Date.now(),
    cacheTtlMs = parsePositiveNumber(process.env.EMAIL_VERIFY_CACHE_TTL_SECONDS, 600) * 1000,
    quickEmailApiKey = String(process.env.QUICKEMAILVERIFICATION_API_KEY || '').trim(),
    provider = normalizeProvider(process.env.EMAIL_VERIFY_PROVIDER),
    quickEmailApiUrl = String(process.env.QUICKEMAILVERIFICATION_API_URL || QUICK_EMAIL_VERIFY_URL).trim(),
    quickEmailTimeoutMs = parsePositiveNumber(process.env.EMAIL_VERIFY_HTTP_TIMEOUT_MS, 3500),
    quickEmailClient = (url, options) => fetch(url, options)
} = {}) => {
    const domainCache = new Map();
    const providerCache = new Map();

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

    const callQuickEmailVerification = async (normalizedEmail) => {
        const nowMs = now();
        const cached = providerCache.get(normalizedEmail);
        if (cached && cached.expiresAt > nowMs) {
            return cached.value;
        }

        if (!quickEmailApiKey || !quickEmailApiUrl) {
            return { status: 'skipped_no_key' };
        }

        const url = new URL(quickEmailApiUrl);
        url.searchParams.set('email', normalizedEmail);
        url.searchParams.set('apikey', quickEmailApiKey);

        const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
        const timeout = controller
            ? setTimeout(() => controller.abort(), quickEmailTimeoutMs)
            : null;

        try {
            const response = await quickEmailClient(url.toString(), {
                method: 'GET',
                headers: { Accept: 'application/json' },
                signal: controller?.signal
            });

            if (!response || !response.ok) {
                return { status: 'api_unavailable', httpStatus: Number(response?.status || 0) || null };
            }

            const payload = await response.json();
            const value = { status: 'ok', payload };
            providerCache.set(normalizedEmail, { expiresAt: nowMs + cacheTtlMs, value });
            return value;
        } catch {
            return { status: 'api_unavailable', httpStatus: null };
        } finally {
            if (timeout) clearTimeout(timeout);
        }
    };

    const mapQuickEmailResult = ({ normalizedEmail, locale, providerPayload, fallbackSuggestion }) => {
        const messages = messageCatalog[locale];
        const payload = providerPayload || {};
        const result = String(payload.result || '').trim().toLowerCase();
        const reason = String(payload.reason || '').trim().toLowerCase();
        const didYouMeanRaw = String(payload.did_you_mean || '').trim().toLowerCase();
        const suggestedEmail = isValidEmail(didYouMeanRaw) ? didYouMeanRaw : fallbackSuggestion;

        if (result === 'invalid') {
            if (reason === 'invalid_domain') {
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
            if (reason === 'rejected_email') {
                const typoSuffix = suggestedEmail ? ` ${messages.typo(suggestedEmail)}` : '';
                return buildResponse({
                    accepted: false,
                    shouldBlock: true,
                    status: 'invalid',
                    reason: 'rejected_email',
                    message: `${messages.mailboxRejected}${typoSuffix}`.trim(),
                    normalizedEmail,
                    suggestion: suggestedEmail
                });
            }

            const typoSuffix = suggestedEmail ? ` ${messages.typo(suggestedEmail)}` : '';
            return buildResponse({
                accepted: false,
                shouldBlock: true,
                status: 'invalid',
                reason: 'invalid_email',
                message: `${messages.invalidFormat}${typoSuffix}`.trim(),
                normalizedEmail,
                suggestion: suggestedEmail
            });
        }

        if (result === 'unknown') {
            const typoSuffix = suggestedEmail ? ` ${messages.typo(suggestedEmail)}` : '';
            return buildResponse({
                accepted: true,
                shouldBlock: false,
                status: 'warning',
                reason: 'provider_unknown',
                message: `${messages.mailboxUnknown}${typoSuffix}`.trim(),
                normalizedEmail,
                suggestion: suggestedEmail
            });
        }

        const warningParts = [];
        const disposable = toBoolean(payload.disposable);
        const roleBased = toBoolean(payload.role);
        const acceptAll = toBoolean(payload.accept_all);
        const safeToSend = String(payload.safe_to_send || '').trim().toLowerCase();

        if (suggestedEmail && suggestedEmail !== normalizedEmail) {
            warningParts.push(messages.typo(suggestedEmail));
        }
        if (disposable) {
            warningParts.push(messages.disposable);
        }
        if (roleBased) {
            warningParts.push(messages.roleBased);
        }
        if (acceptAll || safeToSend === 'false') {
            warningParts.push(messages.acceptAll);
        }

        if (warningParts.length > 0) {
            let warningReason = 'provider_warning';
            if (disposable) warningReason = 'disposable_domain';
            else if (suggestedEmail && suggestedEmail !== normalizedEmail) warningReason = 'possible_typo';
            else if (roleBased) warningReason = 'role_based_email';
            else if (acceptAll || safeToSend === 'false') warningReason = 'accept_all_domain';

            return buildResponse({
                accepted: true,
                shouldBlock: false,
                status: 'warning',
                reason: warningReason,
                message: warningParts.join(' '),
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

    const verifyWithDnsFallback = async ({ normalizedEmail, locale, fallbackSuggestion }) => {
        const messages = messageCatalog[locale];
        const domain = normalizedEmail.split('@')[1] || '';

        if (DISPOSABLE_DOMAINS.has(domain)) {
            return buildResponse({
                accepted: true,
                shouldBlock: false,
                status: 'warning',
                reason: 'disposable_domain',
                message: messages.disposable,
                normalizedEmail,
                suggestion: fallbackSuggestion
            });
        }

        const domainSignals = await getDomainSignals(domain);
        if (domainSignals.status === 'domain_not_found') {
            const typoSuffix = fallbackSuggestion ? ` ${messages.typo(fallbackSuggestion)}` : '';
            return buildResponse({
                accepted: false,
                shouldBlock: true,
                status: 'invalid',
                reason: 'domain_not_found',
                message: `${messages.domainNotFound}${typoSuffix}`.trim(),
                normalizedEmail,
                suggestion: fallbackSuggestion
            });
        }

        if (domainSignals.status === 'no_mail_records') {
            const typoSuffix = fallbackSuggestion ? ` ${messages.typo(fallbackSuggestion)}` : '';
            return buildResponse({
                accepted: false,
                shouldBlock: true,
                status: 'invalid',
                reason: 'no_mail_records',
                message: `${messages.noMailRecords}${typoSuffix}`.trim(),
                normalizedEmail,
                suggestion: fallbackSuggestion
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
                suggestion: fallbackSuggestion
            });
        }

        if (fallbackSuggestion) {
            return buildResponse({
                accepted: true,
                shouldBlock: false,
                status: 'warning',
                reason: 'possible_typo',
                message: messages.typo(fallbackSuggestion),
                normalizedEmail,
                suggestion: fallbackSuggestion
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

    const verify = async (rawEmail, { language = 'en' } = {}) => {
        const locale = normalizeLanguage(language);
        const messages = messageCatalog[locale];
        const normalizedEmail = String(rawEmail || '').trim().toLowerCase();

        if (!isValidEmail(normalizedEmail) || !isValidParsedEmail(normalizedEmail)) {
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

        const fallbackSuggestion = getDomainSuggestion(normalizedEmail);
        const shouldUseProvider = (
            provider === 'quickemailverification'
            || (provider === 'auto' && Boolean(quickEmailApiKey))
        );

        if (shouldUseProvider) {
            const providerResult = await callQuickEmailVerification(normalizedEmail);
            if (providerResult.status === 'ok') {
                return mapQuickEmailResult({
                    normalizedEmail,
                    locale,
                    providerPayload: providerResult.payload,
                    fallbackSuggestion
                });
            }
        }

        return verifyWithDnsFallback({
            normalizedEmail,
            locale,
            fallbackSuggestion
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
