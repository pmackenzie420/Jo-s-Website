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

const formatPickupDateLong = (value, language = 'en') => {
    if (!value) return '';
    const dateValue = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(dateValue.getTime())) {
        return formatPickupDate(value);
    }
    const locale = language === 'fr' ? 'fr-CA' : 'en-CA';
    try {
        return new Intl.DateTimeFormat(locale, {
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

const normalizeLanguage = (value) => {
    if (typeof value !== 'string') return 'en';
    const normalized = value.trim().toLowerCase();
    if (normalized === 'fr' || normalized.startsWith('fr-') || normalized.startsWith('fr_')) {
        return 'fr';
    }
    if (normalized === 'en' || normalized.startsWith('en-') || normalized.startsWith('en_')) {
        return 'en';
    }
    return 'en';
};

const escapeHtml = (value) => String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const parseOriginList = (value) => (value || '')
    .split(',')
    .map((entry) => entry.trim().replace(/\/+$/, ''))
    .filter(Boolean);

const getClientIp = (req) => {
    if (req?.ip) {
        return req.ip;
    }
    if (req?.socket?.remoteAddress) {
        return req.socket.remoteAddress;
    }
    return 'unknown';
};

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

module.exports = {
    formatPickupDate,
    formatPickupDateLong,
    formatCurrency,
    normalizeLanguage,
    escapeHtml,
    parseOriginList,
    getClientIp,
    parseCookies,
    parseOrderItems
};
