const pad2 = (value) => String(value).padStart(2, '0');

const getCalendarParts = (value) => {
    if (!value) return null;

    if (value instanceof Date) {
        if (Number.isNaN(value.getTime())) return null;
        const isUtcMidnight =
            value.getUTCHours() === 0
            && value.getUTCMinutes() === 0
            && value.getUTCSeconds() === 0
            && value.getUTCMilliseconds() === 0;
        if (isUtcMidnight) {
            return {
                year: value.getUTCFullYear(),
                month: value.getUTCMonth() + 1,
                day: value.getUTCDate()
            };
        }
        return {
            year: value.getFullYear(),
            month: value.getMonth() + 1,
            day: value.getDate()
        };
    }

    if (typeof value === 'string') {
        const trimmed = value.trim();
        const dateOnlyMatch = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})$/);
        if (dateOnlyMatch) {
            return {
                year: Number(dateOnlyMatch[1]),
                month: Number(dateOnlyMatch[2]),
                day: Number(dateOnlyMatch[3])
            };
        }
        const isoPrefixMatch = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})T/);
        if (isoPrefixMatch) {
            return {
                year: Number(isoPrefixMatch[1]),
                month: Number(isoPrefixMatch[2]),
                day: Number(isoPrefixMatch[3])
            };
        }
        const parsed = new Date(trimmed);
        if (Number.isNaN(parsed.getTime())) return null;
        return {
            year: parsed.getUTCFullYear(),
            month: parsed.getUTCMonth() + 1,
            day: parsed.getUTCDate()
        };
    }

    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return null;
    return {
        year: parsed.getUTCFullYear(),
        month: parsed.getUTCMonth() + 1,
        day: parsed.getUTCDate()
    };
};

const formatPickupDate = (value) => {
    const parts = getCalendarParts(value);
    if (!parts) {
        return value ? String(value).split('T')[0] : '';
    }
    return `${parts.year}-${pad2(parts.month)}-${pad2(parts.day)}`;
};

const formatPickupDateLong = (value, language = 'en') => {
    const parts = getCalendarParts(value);
    if (!parts) {
        return formatPickupDate(value);
    }
    const dateValue = new Date(Date.UTC(parts.year, parts.month - 1, parts.day));
    const locale = language === 'fr' ? 'fr-CA' : 'en-CA';
    try {
        return new Intl.DateTimeFormat(locale, {
            month: 'long',
            day: 'numeric',
            year: 'numeric',
            timeZone: 'UTC'
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
