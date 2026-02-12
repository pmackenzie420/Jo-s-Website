const Sentry = require('@sentry/node');

const parseSampleRate = (value, fallback) => {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return fallback;
    if (parsed < 0 || parsed > 1) return fallback;
    return parsed;
};

const sentryDsn = String(process.env.SENTRY_DSN || '').trim();
const sentryEnabled = Boolean(sentryDsn) && process.env.NODE_ENV !== 'test';

if (sentryEnabled) {
    Sentry.init({
        dsn: sentryDsn,
        environment: process.env.SENTRY_ENVIRONMENT || process.env.NODE_ENV || 'development',
        release: process.env.SENTRY_RELEASE || undefined,
        sendDefaultPii: String(process.env.SENTRY_SEND_DEFAULT_PII || '').toLowerCase() === 'true',
        tracesSampleRate: parseSampleRate(
            process.env.SENTRY_TRACES_SAMPLE_RATE,
            process.env.NODE_ENV === 'production' ? 0.05 : 1
        ),
        integrations: [Sentry.expressIntegration()]
    });
}

const captureException = (error, context = {}) => {
    if (!sentryEnabled || !error) return null;
    return Sentry.withScope((scope) => {
        if (context.tags && typeof context.tags === 'object') {
            Object.entries(context.tags).forEach(([key, value]) => {
                if (value !== undefined && value !== null) {
                    scope.setTag(String(key), String(value));
                }
            });
        }
        if (context.extra && typeof context.extra === 'object') {
            Object.entries(context.extra).forEach(([key, value]) => {
                scope.setExtra(String(key), value);
            });
        }
        return Sentry.captureException(error);
    });
};

module.exports = {
    Sentry,
    sentryEnabled,
    captureException
};
