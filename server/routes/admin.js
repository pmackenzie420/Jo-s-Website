const {
    findPickupDateId,
} = require('../logic/pickup');
const {
    verifyPassword,
    parseAllowlist,
    isIpAllowed
} = require('../utils/password-auth');
const {
    normalizeLanguage,
    formatPickupDateLong,
    escapeHtml,
    extractEmailAddress,
    parseOrderItems,
    getClientIp
} = require('../utils/helpers');
const { normalizePhoneForStorage } = require('../logic/checkout-validation');
const { reserveStockForItems, releaseStockForItems } = require('../logic/order-stock');
const {
    calculateItemPrice,
    isLohmannHenName,
    getMinimumOrderQuantity,
    getDepositEligibleMinQty,
    getDepositRequiredAboveQty,
    getDepositRate,
    isPickupLocationRestricted,
    isLambName
} = require('../logic/pricing');
const { createCheckoutSession } = require('../logic/checkout-persistence');
const {
    LOCATION_DETAILS,
    COMPANY_CONTACT
} = require('../config/constants');
const { buildBrandedEmailHtml } = require('../utils/email-template');
const { logError, logInfo, logWarn } = require('../utils/logger');
const {
    EMAIL_TYPES,
    listEmailActivity,
    previewTrackedEmailMessage,
    sendTrackedEmailMessage,
    verifyManagedEmailAddress
} = require('../logic/email-ops');

const ADMIN_ALLOWED_ORDER_STATUSES = new Set([
    'reserved',
    'pending',
    'paid',
    'fulfilled',
    'picked_up',
    'cancelled',
    'archived'
]);
const ADMIN_EDITABLE_ORDER_STATUSES = new Set(['pending', 'paid']);
const ADMIN_ARCHIVABLE_ORDER_STATUSES = new Set(['pending', 'paid', 'cancelled']);
const ADMIN_RESTORE_FROM_ARCHIVE_STATUSES = new Set(['pending', 'paid']);
const VALID_ADMIN_PAYMENT_METHODS = new Set(['etransfer', 'cash', 'cheque', 'credit_card']);
const ADMIN_EMAIL_ACTIVITY_LIMIT = 250;

const parsePositiveInt = (value, fallback) => {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return fallback;
    if (parsed <= 0) return fallback;
    return Math.floor(parsed);
};

const parseNonNegativeInt = (value, fallback) => {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return fallback;
    if (parsed < 0) return fallback;
    return Math.floor(parsed);
};

const parseBoolean = (value, fallback = false) => {
    if (typeof value === 'boolean') return value;
    if (typeof value === 'string') {
        const normalized = value.trim().toLowerCase();
        if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
        if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
    }
    if (typeof value === 'number') {
        if (value === 1) return true;
        if (value === 0) return false;
    }
    return fallback;
};

const isIsoDateValue = (value) => {
    const str = String(value || '').trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(str)) return false;
    const [y, m, d] = str.split('-').map(Number);
    const date = new Date(y, m - 1, d);
    return date.getFullYear() === y && date.getMonth() === m - 1 && date.getDate() === d;
};

const getLocationLabel = (value) => {
    const key = String(value || '').trim();
    if (!key) return 'Unknown';
    return LOCATION_DETAILS[key]?.label || key;
};

const formatCents = (cents) => {
    const numeric = Number(cents);
    const safe = Number.isFinite(numeric) ? numeric : 0;
    return `$${(safe / 100).toFixed(2)}`;
};

const normalizeOrderItems = (rawItems) => {
    if (!Array.isArray(rawItems)) return [];
    const totals = new Map();
    for (const item of rawItems) {
        const id = Number(item?.id);
        const quantityRaw = Number(item?.quantity ?? item?.qty);
        const quantity = Number.isFinite(quantityRaw) ? Math.floor(quantityRaw) : 0;
        if (!Number.isInteger(id) || id <= 0 || quantity <= 0) {
            continue;
        }
        totals.set(id, (totals.get(id) || 0) + quantity);
    }
    return Array.from(totals.entries())
        .map(([id, quantity]) => ({ id, quantity }))
        .sort((a, b) => a.id - b.id);
};

const normalizeStoredOrderItems = (rawItems) => {
    const parsed = parseOrderItems(rawItems);
    if (!Array.isArray(parsed)) return [];
    const totalsById = new Map();
    for (const item of parsed) {
        const id = Number(item?.id);
        const quantityRaw = Number(item?.quantity ?? item?.qty);
        const quantity = Number.isFinite(quantityRaw) ? Math.floor(quantityRaw) : 0;
        if (!Number.isInteger(id) || id <= 0 || quantity <= 0) {
            continue;
        }
        const current = totalsById.get(id) || { id, quantity: 0, name: '' };
        totalsById.set(id, {
            id,
            quantity: current.quantity + quantity,
            name: current.name || String(item?.name || '').trim().slice(0, 200)
        });
    }
    return Array.from(totalsById.values())
        .sort((first, second) => first.id - second.id);
};

const buildStatusEditBlockedMessage = (status) => {
    const normalized = String(status || '').trim().toLowerCase();
    if (normalized === 'reserved') {
        return 'This order is awaiting Stripe payment and cannot be edited.';
    }
    if (normalized === 'picked_up' || normalized === 'fulfilled') {
        return 'Picked-up orders cannot be edited.';
    }
    if (normalized === 'cancelled') {
        return 'Cancelled orders cannot be edited.';
    }
    return `Orders with status "${normalized || 'unknown'}" cannot be edited.`;
};

const buildStatusDeleteBlockedMessage = (status) => {
    const normalized = String(status || '').trim().toLowerCase();
    if (normalized === 'reserved') {
        return 'This order is awaiting Stripe payment and cannot be archived.';
    }
    if (normalized === 'picked_up' || normalized === 'fulfilled') {
        return 'Picked-up orders cannot be archived.';
    }
    if (normalized === 'archived') {
        return 'Order is already archived.';
    }
    return `Orders with status "${normalized || 'unknown'}" cannot be archived.`;
};

const createInsufficientStockError = ({
    henName,
    required,
    available,
    pickupDate,
    pickupLocation
}) => {
    const err = new Error('Insufficient pickup stock while updating order.');
    err.code = 'ADMIN_ORDER_INSUFFICIENT_STOCK';
    err.meta = {
        henName: String(henName || 'Item'),
        required: Math.max(Number(required) || 0, 0),
        available: Math.max(Number(available) || 0, 0),
        pickupDate: String(pickupDate || ''),
        pickupLocation: String(pickupLocation || '')
    };
    return err;
};

const PICKUP_DATE_CHANGE_COPY = {
    en: {
        subject: (fromDate, toDate) => `Pickup Date Change: ${fromDate} to ${toDate}`,
        greeting: (name) => `Hi ${name || 'there'},`,
        intro: 'This is an important update regarding your pickup order.',
        reasonLine: (fromDate, fromLocation, toDate, toLocation) =>
            `Due to circumstances beyond our control, your pickup date has changed from ${fromDate} (${fromLocation}) to ${toDate} (${toLocation}).`,
        apologyLine: 'We are sorry for any inconvenience that may arise following this modification.',
        actionLine: 'Your order is still active and linked to the new pickup date.',
        helpLine: (phone) =>
            `If you have any questions, please call ${phone}.`,
        signoff: 'Thank you,',
        team: `${COMPANY_CONTACT.name} team`
    },
    fr: {
        subject: (fromDate, toDate) => `Changement de date de ramassage : ${fromDate} au ${toDate}`,
        greeting: (name) => `Bonjour ${name || ''},`.trim(),
        intro: 'Voici une mise à jour importante concernant votre commande de ramassage.',
        reasonLine: (fromDate, fromLocation, toDate, toLocation) =>
            `En raison de circonstances hors de notre contrôle, votre date de ramassage a été modifiée du ${fromDate} (${fromLocation}) au ${toDate} (${toLocation}).`,
        apologyLine: 'Nous sommes désolés des inconvénients que cette modification pourrait entraîner.',
        actionLine: 'Votre commande est toujours active et liée à la nouvelle date de ramassage.',
        helpLine: (phone) =>
            `Si vous avez des questions, veuillez appeler au ${phone}.`,
        signoff: 'Merci,',
        team: `L'équipe des ${COMPANY_CONTACT.name}`
    }
};

const getDefaultNoReplyAddress = () => {
    const fromAddress = extractEmailAddress(process.env.EMAIL_FROM);
    const atIndex = fromAddress.lastIndexOf('@');
    if (atIndex <= 0 || atIndex === fromAddress.length - 1) return '';
    const domain = fromAddress.slice(atIndex + 1).trim().toLowerCase();
    if (!domain) return '';
    return `no-reply@${domain}`;
};

const DATE_CHANGE_EMAIL_FROM = String(
    process.env.DATE_CHANGE_EMAIL_FROM
    || process.env.CONFIRMATION_EMAIL_FROM
    || getDefaultNoReplyAddress()
    || process.env.EMAIL_FROM
    || ''
).trim();

const DATE_CHANGE_EMAIL_REPLY_TO = String(
    process.env.DATE_CHANGE_EMAIL_REPLY_TO
    || getDefaultNoReplyAddress()
).trim();

const DATE_CHANGE_EMAIL_HEADERS = {
    'Auto-Submitted': 'auto-generated',
    'X-Auto-Response-Suppress': 'All',
    Precedence: 'bulk'
};
const normalizeEmailText = (value) => String(value || '').replace(/\r\n/g, '\n').trim();

const buildPlainTextEmailHtml = ({ text }) => {
    const normalized = normalizeEmailText(text);
    const blocks = normalized
        .split(/\n{2,}/)
        .map((block) => block.trim())
        .filter(Boolean);

    const contentHtml = (blocks.length > 0 ? blocks : [''])
        .map((block, index, all) => {
            const lines = block.split('\n').map((line) => escapeHtml(line.trim()));
            const marginBottom = index === all.length - 1 ? '0' : '16px';
            return `<p style="margin: 0 0 ${marginBottom};">${lines.join('<br>')}</p>`;
        })
        .join('');

    return buildBrandedEmailHtml({ contentHtml });
};

const buildPickupDateChangeEmail = ({
    language,
    customerName,
    fromDateValue,
    fromLocation,
    toDateValue,
    toLocation
}) => {
    const normalizedLanguage = normalizeLanguage(language);
    const copy = PICKUP_DATE_CHANGE_COPY[normalizedLanguage] || PICKUP_DATE_CHANGE_COPY.en;
    const fromDateLabel = formatPickupDateLong(fromDateValue, normalizedLanguage);
    const toDateLabel = formatPickupDateLong(toDateValue, normalizedLanguage);
    const fromLocationLabel = getLocationLabel(fromLocation);
    const toLocationLabel = getLocationLabel(toLocation);

    const lines = [
        copy.greeting(customerName),
        '',
        copy.intro,
        copy.reasonLine(fromDateLabel, fromLocationLabel, toDateLabel, toLocationLabel),
        '',
        copy.apologyLine,
        '',
        copy.actionLine,
        copy.helpLine(COMPANY_CONTACT.phone),
        '',
        copy.signoff,
        copy.team
    ].filter(Boolean);

    const text = lines.join('\n');
    const contentHtml = [
        `<p style="margin: 0 0 12px;">${escapeHtml(copy.greeting(customerName))}</p>`,
        `<p style="margin: 0 0 12px;">${escapeHtml(copy.intro)}</p>`,
        `<p style="margin: 0 0 12px;">${escapeHtml(copy.reasonLine(fromDateLabel, fromLocationLabel, toDateLabel, toLocationLabel))}</p>`,
        `<p style="margin: 0 0 12px;">${escapeHtml(copy.apologyLine)}</p>`,
        `<p style="margin: 0 0 12px;">${escapeHtml(copy.actionLine)}</p>`,
        `<p style="margin: 0 0 14px;">${escapeHtml(copy.helpLine(COMPANY_CONTACT.phone))}</p>`,
        `<p style="margin: 0;">${escapeHtml(copy.signoff)}<br>${escapeHtml(copy.team)}</p>`
    ].join('');
    const subject = copy.subject(fromDateLabel, toDateLabel);
    const html = buildBrandedEmailHtml({ contentHtml });

    return {
        subject,
        text,
        html
    };
};

const sendWithConcurrency = async (items, limit, worker) => {
    let index = 0;
    const runWorker = async () => {
        while (index < items.length) {
            const currentIndex = index;
            index += 1;
            await worker(items[currentIndex], currentIndex);
        }
    };
    const workers = Array.from(
        { length: Math.min(limit, items.length) },
        () => runWorker()
    );
    await Promise.all(workers);
};

const registerAdminRoutes = (app, deps) => {
    const {
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
        releaseReservedOrder = async () => ({ status: 'not_reserved' }),
        verifyCheckoutEmail,
        stripe,
        CHECKOUT_RESERVATION_TTL_MINUTES = 30,
        getRequestBaseUrl,
        finalizeOrderFromSession,
        listEmailActivity: listEmailActivityOverride,
        previewTrackedEmailMessage: previewTrackedEmailMessageOverride,
        sendTrackedEmailMessage: sendTrackedEmailMessageOverride,
        verifyManagedEmailAddress: verifyManagedEmailAddressOverride,
        recordOrderEvent: recordOrderEventOverride,
        recordAdminAction: recordAdminActionOverride,
        recordPaymentEvent: recordPaymentEventOverride,
        startBatchRun: startBatchRunOverride,
        finalizeBatchRun: finalizeBatchRunOverride,
        recordInventoryEvent: recordInventoryEventOverride,
        recordInventoryEvents: recordInventoryEventsOverride
    } = deps;
    const verifyEmail = typeof verifyCheckoutEmail === 'function'
        ? verifyCheckoutEmail
        : null;
    const listTrackedEmailActivity = typeof listEmailActivityOverride === 'function'
        ? listEmailActivityOverride
        : listEmailActivity;
    const previewEmailMessage = typeof previewTrackedEmailMessageOverride === 'function'
        ? previewTrackedEmailMessageOverride
        : previewTrackedEmailMessage;
    const sendManagedEmailMessage = typeof sendTrackedEmailMessageOverride === 'function'
        ? sendTrackedEmailMessageOverride
        : sendTrackedEmailMessage;
    const verifyManagedAddress = typeof verifyManagedEmailAddressOverride === 'function'
        ? verifyManagedEmailAddressOverride
        : verifyManagedEmailAddress;
    const recordOrderAuditEvent = typeof recordOrderEventOverride === 'function'
        ? recordOrderEventOverride
        : async () => null;
    const recordAdminAuditAction = typeof recordAdminActionOverride === 'function'
        ? recordAdminActionOverride
        : async () => null;
    const recordPaymentAuditEvent = typeof recordPaymentEventOverride === 'function'
        ? recordPaymentEventOverride
        : async () => null;
    const startAuditBatchRun = typeof startBatchRunOverride === 'function'
        ? startBatchRunOverride
        : async () => null;
    const finalizeAuditBatchRun = typeof finalizeBatchRunOverride === 'function'
        ? finalizeBatchRunOverride
        : async () => null;
    const recordInventoryAuditEvent = typeof recordInventoryEventOverride === 'function'
        ? recordInventoryEventOverride
        : async () => null;
    const recordInventoryAuditEvents = typeof recordInventoryEventsOverride === 'function'
        ? recordInventoryEventsOverride
        : async () => [];
    const orderEventAuditEnabled = typeof recordOrderEventOverride === 'function';
    const adminActionAuditEnabled = typeof recordAdminActionOverride === 'function';
    const inventoryEventAuditEnabled =
        typeof recordInventoryEventOverride === 'function'
        || typeof recordInventoryEventsOverride === 'function';
    const getAdminIdentifier = (req) => sanitizeText(req?.adminSession?.sub, 120) || 'admin';
    const getRequestMetadata = (req) => ({
        requestId: sanitizeText(req?.requestId, 200) || null,
        ip: sanitizeText(getClientIp(req), 200) || null,
        userAgent: sanitizeText(req?.get?.('user-agent') || req?.headers?.['user-agent'], 500) || null
    });
    const summarizeOrderForAudit = (value) => ({
        id: sanitizeText(value?.id, 120) || null,
        order_number: Number(value?.order_number || 0) || null,
        status: sanitizeText(value?.status, 80).toLowerCase() || null,
        pickup_date: sanitizeText(value?.pickup_date, 40) || null,
        pickup_location: sanitizeText(value?.pickup_location, 80) || null,
        total_cents: Number(value?.total_cents || 0) || 0,
        amount_paid_cents: Number(value?.amount_paid_cents || 0) || 0,
        amount_due_cents: Number(value?.amount_due_cents || 0) || 0,
        payment_type: sanitizeText(value?.payment_type, 40) || null,
        payment_method: sanitizeText(value?.payment_method, 40) || null,
        customer_email: sanitizeText(value?.customer_email, 320).toLowerCase() || null,
        items: Array.isArray(value?.items) ? value.items : normalizeStoredOrderItems(value?.items)
    });
    const normalizeEmailFailureReason = (value, fallback) => {
        const raw = String(value || '').replace(/^Email send failed:\s*/i, '').trim();
        if (!raw) return fallback;

        try {
            const parsed = JSON.parse(raw);
            const parsedMessage = sanitizeText(
                parsed?.message
                || parsed?.error
                || parsed?.name
                || parsed?.detail,
                300
            );
            if (parsedMessage) {
                return parsedMessage;
            }
        } catch {
            // Keep the raw string when it is not JSON.
        }

        return sanitizeText(raw, 300) || fallback;
    };
    const buildFailedRecipient = ({ email, name, reason, fallbackReason }) => {
        const normalizedEmail = sanitizeText(email, 320).toLowerCase() || 'invalid-email';
        const normalizedName = sanitizeText(name, 120);
        const normalizedReason = normalizeEmailFailureReason(reason, fallbackReason);

        return {
            email: normalizedEmail,
            ...(normalizedName ? { name: normalizedName } : {}),
            ...(normalizedReason ? { reason: normalizedReason } : {})
        };
    };
    const buildTrackedConfirmationOptions = ({
        force = false,
        initiatedBy,
        actorType,
        actorId,
        requestId
    }) => ({
        ...(force ? { force: true } : {}),
        initiatedBy,
        ...(requestId ? { requestId } : {}),
        ...(actorType && actorType !== initiatedBy ? { actorType } : {}),
        ...(actorId && actorId !== initiatedBy ? { actorId } : {})
    });
    const toDistinctSanitizedStrings = (values, maxLength = 200) => (
        Array.from(
            new Set(
                (Array.isArray(values) ? values : [])
                    .map((value) => sanitizeText(value, maxLength))
                    .filter(Boolean)
            )
        )
    );
    const buildEmailBatchType = (emailTypes) => {
        if (emailTypes.length === 1 && emailTypes[0] === EMAIL_TYPES.PICKUP_REMINDER) {
            return 'pickup_reminder_batch';
        }
        if (emailTypes.length === 1 && emailTypes[0] === EMAIL_TYPES.PICKUP_DATE_CHANGE) {
            return 'pickup_date_change_batch';
        }
        return 'admin_email_batch';
    };
    const buildAdminOrdersQuery = (limitPlaceholder, offsetPlaceholder) => `
        SELECT
            orders.*,
            customers.name AS customer_name,
            customers.phone AS customer_phone,
            customers.address AS customer_address,
            COALESCE(email_history_data.data, '[]'::jsonb) AS email_history,
            confirmation_email_data.latest_confirmation_email_status,
            confirmation_email_data.latest_confirmation_email_at,
            confirmation_email_data.latest_confirmation_email_error,
            confirmation_email_data.latest_confirmation_verification_status,
            suppression_data.email_suppression_reason_type,
            suppression_data.email_suppression_reason,
            suppression_data.email_suppressed_at,
            order_created_event_data.order_created_actor_type,
            order_created_event_data.order_created_actor_id,
            order_created_event_data.order_created_request_id,
            order_created_event_data.order_created_at,
            order_created_event_data.order_created_backfilled,
            order_created_event_data.order_created_inferred_from
        FROM orders
        LEFT JOIN customers
            ON orders.customer_id = customers.id
        LEFT JOIN LATERAL (
            SELECT COALESCE(
                jsonb_agg(
                    jsonb_build_object(
                        'id', email_history_entry.id,
                        'emailType', email_history_entry.email_type,
                        'sendStatus', email_history_entry.send_status,
                        'verificationStatus', email_history_entry.verification_status,
                        'toEmail', email_history_entry.to_email,
                        'toName', email_history_entry.to_name,
                        'subject', email_history_entry.subject,
                        'createdAt', email_history_entry.created_at,
                        'sentAt', email_history_entry.sent_at,
                        'deliveredAt', email_history_entry.delivered_at,
                        'failedAt', email_history_entry.failed_at,
                        'bouncedAt', email_history_entry.bounced_at,
                        'complainedAt', email_history_entry.complained_at,
                        'suppressedAt', email_history_entry.suppressed_at,
                        'lastEventAt', email_history_entry.last_event_at,
                        'lastEventType', email_history_entry.last_event_type,
                        'lastError', email_history_entry.last_error,
                        'providerEmailId', email_history_entry.provider_email_id,
                        'batchKey', email_history_entry.batch_key,
                        'initiatedBy', email_history_entry.initiated_by
                    )
                    ORDER BY email_history_entry.created_at DESC
                ),
                '[]'::jsonb
            ) AS data
            FROM (
                SELECT em.*
                FROM email_messages em
                INNER JOIN email_message_orders emo
                    ON emo.email_message_id = em.id
                WHERE emo.order_id = orders.id
                ORDER BY em.created_at DESC
                LIMIT 8
            ) AS email_history_entry
        ) AS email_history_data
            ON TRUE
        LEFT JOIN LATERAL (
            SELECT
                em.send_status AS latest_confirmation_email_status,
                em.created_at AS latest_confirmation_email_at,
                em.last_error AS latest_confirmation_email_error,
                em.verification_status AS latest_confirmation_verification_status
            FROM email_messages em
            INNER JOIN email_message_orders emo
                ON emo.email_message_id = em.id
            WHERE emo.order_id = orders.id
              AND em.email_type = '${EMAIL_TYPES.CONFIRMATION}'
            ORDER BY em.created_at DESC
            LIMIT 1
        ) AS confirmation_email_data
            ON TRUE
        LEFT JOIN LATERAL (
            SELECT
                es.reason_type AS email_suppression_reason_type,
                es.reason AS email_suppression_reason,
                es.first_seen_at AS email_suppressed_at
            FROM email_suppressions es
            WHERE es.normalized_email = LOWER(COALESCE(NULLIF(TRIM(orders.customer_email), ''), ''))
              AND es.active = true
            LIMIT 1
        ) AS suppression_data
            ON TRUE
        LEFT JOIN LATERAL (
            SELECT
                oe.actor_type AS order_created_actor_type,
                oe.actor_id AS order_created_actor_id,
                oe.request_id AS order_created_request_id,
                oe.created_at AS order_created_at,
                COALESCE((oe.payload_json ->> 'backfilled')::boolean, false) AS order_created_backfilled,
                NULLIF(TRIM(oe.payload_json ->> 'inferred_from'), '') AS order_created_inferred_from
            FROM order_events oe
            WHERE oe.order_id = orders.id
              AND oe.event_type = 'order_created'
            ORDER BY oe.created_at ASC
            LIMIT 1
        ) AS order_created_event_data
            ON TRUE
        ORDER BY orders.created_at DESC
        LIMIT ${limitPlaceholder}
        OFFSET ${offsetPlaceholder}
    `;
    const normalizeAdminSendMessages = ({ messages, recipients, subject, message, defaultEmailType = EMAIL_TYPES.ADMIN_MESSAGE }) => {
        let sendMessages = [];

        if (Array.isArray(messages) && messages.length > 0) {
            sendMessages = messages.map((item) => ({
                ...item,
                to: typeof item?.to === 'string' ? { email: item.to } : item?.to
            }));
        } else if (Array.isArray(recipients) && subject && message) {
            sendMessages = recipients.map((recipient) => ({
                to: typeof recipient === 'string' ? { email: recipient } : recipient,
                subject,
                text: message
            }));
        }

        return sendMessages.map((item) => ({
            ...item,
            to: {
                email: sanitizeText(item?.to?.email, 320).toLowerCase(),
                name: sanitizeText(item?.to?.name, 120)
            },
            subject: sanitizeText(item?.subject, 300),
            text: sanitizeText(item?.text, 20000),
            html: String(item?.html || '').trim(),
            emailType: sanitizeText(item?.emailType, 80).toLowerCase() || defaultEmailType,
            batchKey: sanitizeText(item?.batchKey, 200),
            pickupDate: sanitizeText(item?.pickupDate, 40),
            pickupLocation: sanitizeText(item?.pickupLocation, 80),
            language: normalizeLanguage(item?.language),
            initiatedBy: sanitizeText(item?.initiatedBy, 80) || 'admin',
            orderIds: Array.isArray(item?.orderIds)
                ? item.orderIds.map((id) => sanitizeText(id, 120)).filter(Boolean)
                : [],
            metadata: item?.metadata && typeof item.metadata === 'object'
                ? item.metadata
                : {},
            attachments: Array.isArray(item?.attachments)
                ? item.attachments.map((attachment) => ({
                    Name: attachment.filename || attachment.name || 'attachment',
                    Content: attachment.content,
                    ContentType: attachment.type || 'text/plain'
                }))
                : undefined,
            csv: typeof item?.csv === 'string' ? item.csv : '',
            filename: sanitizeText(item?.filename, 120)
        }));
    };
    const previewAdminSendMessages = async (messagesToPreview) => {
        const recipients = [];
        const seenEmails = new Set();
        const counts = {
            ready: 0,
            warning: 0,
            blocked: 0,
            suppressed: 0,
            duplicate: 0
        };

        for (const item of messagesToPreview) {
            const normalizedEmail = sanitizeText(item?.to?.email, 320).toLowerCase();
            if (normalizedEmail && seenEmails.has(normalizedEmail)) {
                recipients.push({
                    email: normalizedEmail,
                    name: sanitizeText(item?.to?.name, 120) || undefined,
                    status: 'duplicate',
                    reason: 'Duplicate recipient in this batch.'
                });
                counts.duplicate += 1;
                continue;
            }
            if (normalizedEmail) {
                seenEmails.add(normalizedEmail);
            }

            const preview = await previewEmailMessage({
                pool,
                verifyEmail,
                message: item
            });
            recipients.push(preview);
            if (Object.prototype.hasOwnProperty.call(counts, preview.status)) {
                counts[preview.status] += 1;
            }
        }

        return {
            total: recipients.length,
            counts,
            recipients
        };
    };

    const fetchAdminOrders = async ({ limit = 2000, offset = 0 } = {}) => {
        const result = await pool.query(buildAdminOrdersQuery('$1', '$2'), [limit, offset]);
        return result.rows;
    };

    const fetchAdminOrdersPage = async ({ limit = 500, offset = 0 } = {}) => {
        const pageSize = Math.min(parsePositiveInt(limit, 500), 2000);
        const pageOffset = parseNonNegativeInt(offset, 0);
        const result = await pool.query(buildAdminOrdersQuery('$1', '$2'), [pageSize + 1, pageOffset]);
        const hasMore = result.rows.length > pageSize;
        const orders = hasMore ? result.rows.slice(0, pageSize) : result.rows;
        return {
            orders,
            limit: pageSize,
            offset: pageOffset,
            nextOffset: pageOffset + orders.length,
            hasMore
        };
    };

    const fetchAdminMetaPayload = async () => {
        const result = await pool.query(
            `
            WITH active_hens AS (
                SELECT COALESCE(
                    jsonb_agg(to_jsonb(hens) ORDER BY hens.id ASC),
                    '[]'::jsonb
                ) AS data
                FROM hens
                WHERE hens.is_active = true
            ),
            canonical_dates AS (
                SELECT DISTINCT ON (date_value, location)
                    id,
                    date_value,
                    location,
                    is_active,
                    created_at
                FROM pickup_dates
                WHERE is_active = true
                ORDER BY date_value, location, created_at ASC, id ASC
            ),
            active_dates AS (
                SELECT COALESCE(
                    jsonb_agg(to_jsonb(canonical_dates) ORDER BY date_value ASC, location ASC, created_at ASC, id ASC),
                    '[]'::jsonb
                ) AS data
                FROM canonical_dates
            ),
            stock_rows AS (
                SELECT
                    canonical_dates.date_value::text || '::' || canonical_dates.location AS pickup_key,
                    pickup_stock.hen_id,
                    COALESCE(pickup_stock.stock, 0) AS stock
                FROM pickup_stock
                INNER JOIN canonical_dates
                    ON canonical_dates.id = pickup_stock.pickup_date_id
            ),
            stock_map AS (
                SELECT COALESCE(
                    jsonb_object_agg(pickup_key, stocks_by_hen),
                    '{}'::jsonb
                ) AS data
                FROM (
                    SELECT
                        pickup_key,
                        jsonb_object_agg(hen_id::text, stock ORDER BY hen_id) AS stocks_by_hen
                    FROM stock_rows
                    GROUP BY pickup_key
                ) AS grouped_stock
            ),
            reserved_rows AS (
                SELECT
                    orders.pickup_date::text || '::' || TRIM(orders.pickup_location) AS pickup_key,
                    parsed_items.item_id AS hen_id,
                    SUM(parsed_items.quantity)::int AS reserved
                FROM orders
                CROSS JOIN LATERAL (
                    SELECT
                        CASE
                            WHEN COALESCE(item->>'id', '') ~ '^[0-9]+$'
                                THEN (item->>'id')::int
                            ELSE NULL
                        END AS item_id,
                        CASE
                            WHEN COALESCE(item->>'quantity', item->>'qty', '') ~ '^[0-9]+$'
                                THEN COALESCE(item->>'quantity', item->>'qty')::int
                            ELSE 0
                        END AS quantity
                    FROM jsonb_array_elements(
                        CASE
                            WHEN jsonb_typeof(COALESCE(orders.items, '[]'::jsonb)) = 'array'
                                THEN COALESCE(orders.items, '[]'::jsonb)
                            ELSE '[]'::jsonb
                        END
                    ) AS item
                ) AS parsed_items
                WHERE orders.pickup_date IS NOT NULL
                  AND COALESCE(TRIM(orders.pickup_location), '') <> ''
                  AND LOWER(COALESCE(orders.status, 'pending')) <> 'cancelled'
                  AND parsed_items.item_id IS NOT NULL
                  AND parsed_items.quantity > 0
                GROUP BY pickup_key, parsed_items.item_id
            ),
            reserved_map AS (
                SELECT COALESCE(
                    jsonb_object_agg(pickup_key, reserved_by_hen),
                    '{}'::jsonb
                ) AS data
                FROM (
                    SELECT
                        pickup_key,
                        jsonb_object_agg(hen_id::text, reserved ORDER BY hen_id) AS reserved_by_hen
                    FROM reserved_rows
                    GROUP BY pickup_key
                ) AS grouped_reserved
            )
            SELECT
                active_hens.data AS hens,
                active_dates.data AS dates,
                stock_map.data AS "pickupStocks",
                reserved_map.data AS "pickupReserved"
            FROM active_hens
            CROSS JOIN active_dates
            CROSS JOIN stock_map
            CROSS JOIN reserved_map
            `
        );

        const row = result.rows[0] || {};
        return {
            hens: Array.isArray(row.hens) ? row.hens : [],
            dates: Array.isArray(row.dates) ? row.dates : [],
            pickupStocks:
                row.pickupStocks && typeof row.pickupStocks === 'object'
                    ? row.pickupStocks
                    : {},
            pickupReserved:
                row.pickupReserved && typeof row.pickupReserved === 'object'
                    ? row.pickupReserved
                    : {}
        };
    };

    const runInTransaction = async (work) => {
        if (typeof pool?.connect !== 'function') {
            return work({
                query: (...args) => pool.query(...args)
            });
        }

        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            const result = await work(client);
            await client.query('COMMIT');
            return result;
        } catch (err) {
            try {
                await client.query('ROLLBACK');
            } catch (_rollbackErr) {
                // Ignore rollback failures here; sendServerError will handle primary error.
            }
            throw err;
        } finally {
            client.release();
        }
    };

    const attemptSendOrderConfirmationEmail = async (orderId, context, req) => {
        if (!orderId || typeof sendOrderConfirmationEmail !== 'function') {
            return { skipped: 'unavailable' };
        }

        try {
            const requestMeta = req ? getRequestMetadata(req) : { requestId: null };
            const initiatedBy = context === 'admin order creation'
                || context === 'admin order update'
                || context === 'admin status update'
                || context === 'admin resend confirmation'
                ? 'admin'
                : 'system';
            return await sendOrderConfirmationEmail(orderId, buildTrackedConfirmationOptions({
                initiatedBy,
                actorType: initiatedBy,
                actorId: initiatedBy === 'admin' ? getAdminIdentifier(req) : initiatedBy,
                requestId: requestMeta.requestId
            }));
        } catch (err) {
            logError(`Failed to send confirmation email after ${context} for order ${orderId}`, err);
            return { skipped: 'send_failed' };
        }
    };

    const loadDateChangeRecipients = async (client, { sourceDateValue, sourceLocation }) => {
        const result = await client.query(
            `
            SELECT
                orders.customer_email,
                orders.language,
                customers.name AS customer_name,
                orders.id AS order_id
            FROM orders
            LEFT JOIN customers
                ON customers.id = orders.customer_id
            WHERE orders.pickup_date = $1
              AND orders.pickup_location = $2
              AND COALESCE(TRIM(orders.customer_email), '') <> ''
              AND LOWER(COALESCE(orders.status, 'pending')) NOT IN ('cancelled', 'picked_up', 'fulfilled')
            ORDER BY orders.created_at DESC, orders.id DESC
            `,
            [sourceDateValue, sourceLocation]
        );

        const recipientsByEmail = new Map();
        for (const row of result.rows) {
            const email = sanitizeText(row?.customer_email, 320).toLowerCase();
            if (!isValidEmail(email) || recipientsByEmail.has(email)) {
                if (!isValidEmail(email)) {
                    continue;
                }
            }
            const existing = recipientsByEmail.get(email);
            if (existing) {
                existing.orderIds.push(sanitizeText(row?.order_id, 120));
                continue;
            }
            recipientsByEmail.set(email, {
                email,
                name: sanitizeText(row?.customer_name, 120),
                language: normalizeLanguage(row?.language),
                orderIds: [sanitizeText(row?.order_id, 120)].filter(Boolean)
            });
        }

        return Array.from(recipientsByEmail.values());
    };

    app.post('/api/admin/login', adminLoginLimiter, (req, res) => {
        const { password } = req.body || {};
        const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
        const ADMIN_PASSWORD_HASH = process.env.ADMIN_PASSWORD_HASH;
        if (!ADMIN_PASSWORD && !ADMIN_PASSWORD_HASH) {
            return res.status(500).json({ error: 'Admin auth not configured.' });
        }
        const allowlist = parseAllowlist(process.env.ADMIN_LOGIN_IP_ALLOWLIST);
        if (!isIpAllowed(req, allowlist)) {
            return res.status(403).json({ error: 'Admin login blocked from this IP.' });
        }
        const valid = verifyPassword({
            candidate: password,
            plainSecret: ADMIN_PASSWORD,
            hashedSecret: ADMIN_PASSWORD_HASH
        });
        if (!valid) {
            return res.status(401).send('Wrong password');
        }
        const token = signAdminSession({ sub: 'admin' });
        res.cookie(ADMIN_SESSION_COOKIE, token, getCookieOptions(ADMIN_SESSION_TTL_MS));
        return res.json({ success: true });
    });

    app.get('/api/admin/session', checkAuth, (req, res) => {
        res.json({ success: true });
    });

    app.post('/api/admin/logout', (req, res) => {
        res.clearCookie(ADMIN_SESSION_COOKIE, getClearCookieOptions());
        return res.json({ success: true });
    });

    app.get('/api/admin/orders', checkAuth, async (req, res) => {
        try {
            const limit = Math.min(parsePositiveInt(req.query.limit, 2000), 5000);
            const offset = parseNonNegativeInt(req.query.offset, 0);
            const orders = await fetchAdminOrders({ limit, offset });
            return res.json(orders);
        } catch (err) {
            return sendServerError(res, err, 'Failed to load admin orders');
        }
    });

    app.post('/api/admin/orders', checkAuth, async (req, res) => {
        try {
            const adminIdentifier = getAdminIdentifier(req);
            const requestMeta = getRequestMetadata(req);
            const headerLanguage = req.get('accept-language') || '';
            const orderLanguage = normalizeLanguage(req.body?.language || headerLanguage);

            const customerName = sanitizeText(req.body?.customer?.name, 200);
            const customerPhoneRaw = sanitizeText(req.body?.customer?.phone, 50);
            const customerPhone = normalizePhoneForStorage(customerPhoneRaw);
            const customerEmailRaw = sanitizeText(req.body?.customer?.email, 320);
            const customerEmail = customerEmailRaw ? customerEmailRaw.toLowerCase() : '';
            const customerAddress = sanitizeText(req.body?.customer?.address, 300);

            const pickupDate = sanitizeText(req.body?.pickup?.date, 40);
            const pickupLocation = sanitizeText(req.body?.pickup?.location, 40);

            const paymentMethodRaw = sanitizeText(req.body?.payment?.method, 30).toLowerCase();
            const paymentMethod = VALID_ADMIN_PAYMENT_METHODS.has(paymentMethodRaw)
                ? paymentMethodRaw
                : 'etransfer';
            const isCreditCard = paymentMethod === 'credit_card';

            const requestedPaymentType = sanitizeText(req.body?.payment?.payment_type, 20).toLowerCase() || 'full';
            const hasAmountPaidField = Boolean(
                req.body?.payment
                && Object.prototype.hasOwnProperty.call(req.body.payment, 'amount_paid_cents')
            );
            const amountPaidCentsRaw = Number(req.body?.payment?.amount_paid_cents);

            const items = normalizeOrderItems(req.body?.items);

            if (!customerName) {
                return res.status(400).json({ error: 'Customer name is required.' });
            }
            if (!customerPhone || customerPhone.length < 7) {
                return res.status(400).json({ error: 'Valid customer phone is required.' });
            }
            if (customerEmail && !isValidEmail(customerEmail)) {
                return res.status(400).json({ error: 'Customer email is invalid.' });
            }
            if (customerEmail) {
                const emailAssessment = await verifyManagedAddress({
                    pool,
                    email: customerEmail,
                    language: orderLanguage,
                    verifyEmail
                });
                if (emailAssessment.shouldBlock) {
                    return res.status(400).json({
                        error: emailAssessment.message || 'Customer email cannot receive mail.'
                    });
                }
            }
            if (isCreditCard && !customerEmail) {
                return res.status(400).json({ error: 'Customer email is required for credit card orders.' });
            }
            if (!pickupDate || !pickupLocation) {
                return res.status(400).json({ error: 'Pickup date and location are required.' });
            }
            if (items.length === 0) {
                return res.status(400).json({ error: 'At least one order item is required.' });
            }
            if (hasAmountPaidField && (!Number.isFinite(amountPaidCentsRaw) || amountPaidCentsRaw < 0)) {
                return res.status(400).json({ error: 'Amount paid must be a valid non-negative amount.' });
            }

            const pickupDateId = await findPickupDateId(pool, pickupDate, pickupLocation);
            if (!pickupDateId) {
                return res.status(400).json({ error: 'Selected pickup date is not available.' });
            }

            const itemIds = items.map((item) => item.id);
            const hensResult = await pool.query(
                'SELECT id, name FROM hens WHERE is_active = true AND id = ANY($1::int[])',
                [itemIds]
            );
            const henMap = new Map(hensResult.rows.map((row) => [Number(row.id), row]));
            if (henMap.size !== itemIds.length) {
                return res.status(400).json({ error: 'Some requested items are unavailable.' });
            }

            const stockResult = await pool.query(
                'SELECT hen_id, stock FROM pickup_stock WHERE pickup_date_id = $1 AND hen_id = ANY($2::int[])',
                [pickupDateId, itemIds]
            );
            const stockMap = new Map(
                stockResult.rows.map((row) => [Number(row.hen_id), Number(row.stock || 0)])
            );

            const orderItemsForStorage = [];
            let totalCents = 0;
            let lohmannQty = 0;
            let lohmannSubtotalCents = 0;
            let nonLohmannSubtotalCents = 0;
            let hasLambItems = false;

            for (const item of items) {
                const hen = henMap.get(Number(item.id));
                if (!hen) continue;

                const quantity = item.quantity;
                if (!Number.isFinite(quantity) || quantity <= 0) continue;

                if (isPickupLocationRestricted(hen.name, pickupLocation)) {
                    return res.status(400).json({
                        error: `Item is not available for ${getLocationLabel(pickupLocation)} pickups.`
                    });
                }

                const minimumOrderQty = getMinimumOrderQuantity(hen.name);
                if (minimumOrderQty > 0 && quantity < minimumOrderQty) {
                    return res.status(400).json({
                        error: `Minimum order is ${minimumOrderQty} for ${hen.name}.`
                    });
                }

                const availableStock = stockMap.get(Number(hen.id)) ?? 0;
                if (availableStock < quantity) {
                    return res.status(409).json({
                        error: `Insufficient stock for ${hen.name}.`
                    });
                }

                const unitCents = calculateItemPrice(hen.name, quantity);
                const lineCents = unitCents * quantity;
                totalCents += lineCents;
                if (isLohmannHenName(hen.name)) {
                    lohmannQty += quantity;
                    lohmannSubtotalCents += lineCents;
                } else {
                    nonLohmannSubtotalCents += lineCents;
                    if (isLambName(hen.name)) {
                        hasLambItems = true;
                    }
                }
                orderItemsForStorage.push({
                    id: Number(hen.id),
                    quantity,
                    name: hen.name,
                    unit_cents: unitCents,
                    line_cents: lineCents
                });
            }

            if (orderItemsForStorage.length === 0 || totalCents <= 0) {
                return res.status(400).json({ error: 'At least one purchasable item is required.' });
            }

            // Deposit eligibility — same logic as regular checkout
            const depositEligibleMinQty = Math.max(Number(getDepositEligibleMinQty() || 13), 1);
            const depositRate = Math.min(Math.max(Number(getDepositRate() || 0.25), 0), 1);
            const lohmannDepositEligible = lohmannQty >= depositEligibleMinQty;
            const depositEligible = lohmannDepositEligible || hasLambItems;
            const isDepositRequested = requestedPaymentType === 'deposit';
            const isDeposit = isDepositRequested;

            const lohmannDepositCents = lohmannDepositEligible
                ? Math.floor(lohmannSubtotalCents * depositRate)
                : 0;
            const depositNowCents = nonLohmannSubtotalCents + lohmannDepositCents;
            const defaultDepositCents = depositEligible
                ? depositNowCents
                : (isCreditCard ? totalCents : depositNowCents);

            let amountPaidCents;
            let amountDueCents;
            let paymentType;
            let status;

            if (isDeposit) {
                if (hasAmountPaidField) {
                    amountPaidCents = Math.floor(amountPaidCentsRaw);
                    if (amountPaidCents > totalCents) {
                        return res.status(400).json({ error: 'Amount paid cannot exceed the order total.' });
                    }
                } else {
                    amountPaidCents = defaultDepositCents;
                }
                amountDueCents = Math.max(totalCents - amountPaidCents, 0);
                paymentType = amountDueCents > 0 ? 'deposit' : 'full';
            } else {
                amountPaidCents = totalCents;
                amountDueCents = 0;
                paymentType = 'full';
            }

            if (isCreditCard && amountPaidCents <= 0) {
                return res.status(400).json({ error: 'Amount charged must be greater than zero for credit card orders.' });
            }

            status = isCreditCard
                ? 'reserved'
                : (amountPaidCents > 0 ? 'paid' : 'pending');

            const createdOrder = await runInTransaction(async (client) => {
                let customerId;
                const existingCust = await client.query(
                    'SELECT id FROM customers WHERE phone = $1 FOR UPDATE',
                    [customerPhone]
                );

                if (existingCust.rows.length > 0) {
                    customerId = existingCust.rows[0].id;
                    await client.query(
                        'UPDATE customers SET name=$1, email=$2, address=$3 WHERE id=$4',
                        [customerName, customerEmail || null, customerAddress || null, customerId]
                    );
                } else {
                    const newCust = await client.query(
                        'INSERT INTO customers (name, phone, email, address) VALUES ($1, $2, $3, $4) RETURNING id',
                        [customerName, customerPhone, customerEmail || null, customerAddress || null]
                    );
                    customerId = newCust.rows[0].id;
                }

                await reserveStockForItems(client, {
                    pickupDateId,
                    items,
                    orderId: 'admin',
                    pickupDate,
                    pickupLocation,
                    inventoryReason: 'admin_order_create_reserve',
                    inventoryActor: adminIdentifier,
                    requestId: requestMeta.requestId
                });

                const newOrder = await client.query(
                    `INSERT INTO orders (
                        customer_id,
                        customer_email,
                        total_cents,
                        items,
                        status,
                        pickup_date,
                        pickup_location,
                        payment_type,
                        amount_paid_cents,
                        amount_due_cents,
                        language,
                        payment_method
                    )
                    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
                    RETURNING id, order_number`,
                    [
                        customerId,
                        customerEmail || null,
                        totalCents,
                        JSON.stringify(orderItemsForStorage),
                        status,
                        pickupDate,
                        pickupLocation,
                        paymentType,
                        amountPaidCents,
                        amountDueCents,
                        orderLanguage,
                        paymentMethod
                    ]
                );
                const createdRow = {
                    id: newOrder.rows[0].id,
                    order_number: Number(newOrder.rows[0].order_number) || null,
                    status,
                    pickup_date: pickupDate,
                    pickup_location: pickupLocation,
                    total_cents: totalCents,
                    amount_paid_cents: amountPaidCents,
                    amount_due_cents: amountDueCents,
                    payment_type: paymentType,
                    payment_method: paymentMethod,
                    customer_email: customerEmail || null,
                    items: orderItemsForStorage
                };
                await recordOrderAuditEvent(client, {
                    orderId: createdRow.id,
                    eventType: 'order_created',
                    fromStatus: null,
                    toStatus: status,
                    actorType: 'admin',
                    actorId: adminIdentifier,
                    requestId: requestMeta.requestId,
                    payload: summarizeOrderForAudit(createdRow)
                });
                await recordAdminAuditAction(client, {
                    actionType: 'order_create',
                    targetType: 'order',
                    targetId: createdRow.id,
                    adminIdentifier,
                    requestId: requestMeta.requestId,
                    before: {},
                    after: summarizeOrderForAudit(createdRow),
                    ip: requestMeta.ip,
                    userAgent: requestMeta.userAgent
                });
                return {
                    id: createdRow.id,
                    orderNumber: createdRow.order_number
                };
            });
            const orderId = createdOrder.id;
            const orderNumber = Number(createdOrder.orderNumber) || null;

            if (!isCreditCard && status === 'paid') {
                await attemptSendOrderConfirmationEmail(orderId, 'admin order creation', req);
            }

            if (isCreditCard && stripe) {
                let stripeLineItems;
                if (paymentType === 'deposit') {
                    stripeLineItems = [{
                        price_data: {
                            currency: 'cad',
                            product_data: {
                                name: 'Order deposit',
                                description: `Total ${formatCents(totalCents)} - Remaining ${formatCents(amountDueCents)}`
                            },
                            unit_amount: amountPaidCents
                        },
                        quantity: 1
                    }];
                } else {
                    stripeLineItems = orderItemsForStorage.map((item) => ({
                        price_data: {
                            currency: 'cad',
                            product_data: { name: item.name },
                            unit_amount: item.unit_cents
                        },
                        quantity: item.quantity
                    }));
                }

                const baseUrl = getRequestBaseUrl(req) || `${req.protocol}://${req.get('host')}`;
                const session = await createCheckoutSession({
                    stripe,
                    orderId,
                    paymentType,
                    lineItems: stripeLineItems,
                    baseUrl,
                    CHECKOUT_RESERVATION_TTL_MINUTES,
                    successUrl: `${baseUrl}/admin?stripe_order=${orderId}&stripe_order_number=${orderNumber || ''}`,
                    cancelUrl: `${baseUrl}/admin?stripe_cancelled=true`
                });

                await pool.query(
                    'UPDATE orders SET stripe_payment_id = $1 WHERE id = $2',
                    [session.id, orderId]
                );
                await recordPaymentAuditEvent(pool, {
                    orderId,
                    provider: 'stripe',
                    providerEventId: session.id,
                    eventType: 'admin.credit_card_session_created',
                    status: 'reserved',
                    payload: {
                        request_id: requestMeta.requestId,
                        admin_identifier: adminIdentifier,
                        payment_type: paymentType,
                        amount_paid_cents: amountPaidCents,
                        amount_due_cents: amountDueCents
                    }
                });

                return res.json({ success: true, orderId, orderNumber, stripeUrl: session.url });
            }

            return res.json({ success: true, orderId, orderNumber });
        } catch (err) {
            if (String(err?.message || '').includes('Insufficient pickup stock')) {
                return res.status(409).json({ error: 'Insufficient stock for one or more items.' });
            }
            return sendServerError(res, err, 'Failed to create admin order');
        }
    });

    app.put('/api/admin/orders/status', checkAuth, async (req, res) => {
        const { ids } = req.body || {};
        const status = sanitizeText(req.body?.status, 50).toLowerCase();
        if (!Array.isArray(ids) || ids.length === 0) {
            return res.status(400).json({ error: 'ids array is required' });
        }
        const uniqueIds = Array.from(
            new Set(
                ids.map((value) => String(value || '').trim())
                    .filter(Boolean)
            )
        );
        if (uniqueIds.length === 0) {
            return res.status(400).json({ error: 'ids array is required' });
        }
        if (!ADMIN_ALLOWED_ORDER_STATUSES.has(status)) {
            return res.status(400).json({ error: 'Invalid status value.' });
        }
        try {
            const adminIdentifier = getAdminIdentifier(req);
            const requestMeta = getRequestMetadata(req);
            const shouldCaptureStatusAudit = orderEventAuditEnabled || adminActionAuditEnabled;
            const existingOrdersById = new Map();
            if (shouldCaptureStatusAudit) {
                const existingOrdersResult = await pool.query(
                    `
                    SELECT id, order_number, status
                    FROM orders
                    WHERE id::text = ANY($1::text[])
                    `,
                    [uniqueIds]
                );
                for (const row of existingOrdersResult.rows) {
                    existingOrdersById.set(String(row.id), row);
                }
            }
            if (status === 'cancelled') {
                const directUpdateIds = [];
                for (const orderId of uniqueIds) {
                    const releaseResult = await releaseReservedOrder(orderId, {
                        expireStripeSession: true,
                        actorType: 'admin',
                        actorId: adminIdentifier,
                        requestId: requestMeta.requestId,
                        inventoryReason: 'admin_status_cancel_release',
                        orderEventType: 'status_changed'
                    });
                    if (releaseResult?.status === 'not_reserved') {
                        directUpdateIds.push(orderId);
                    }
                }
                if (directUpdateIds.length > 0) {
                    await pool.query(
                        'UPDATE orders SET status = $1 WHERE id::text = ANY($2::text[])',
                        [status, directUpdateIds]
                    );
                    for (const orderId of directUpdateIds) {
                        const previous = existingOrdersById.get(orderId) || null;
                        await recordOrderAuditEvent(pool, {
                            orderId,
                            eventType: 'status_changed',
                            fromStatus: previous?.status || null,
                            toStatus: status,
                            actorType: 'admin',
                            actorId: adminIdentifier,
                            requestId: requestMeta.requestId,
                            payload: {
                                order_number: Number(previous?.order_number || 0) || null
                            }
                        });
                        await recordAdminAuditAction(pool, {
                            actionType: 'order_status_update',
                            targetType: 'order',
                            targetId: orderId,
                            adminIdentifier,
                            requestId: requestMeta.requestId,
                            before: {
                                status: sanitizeText(previous?.status, 80).toLowerCase() || null,
                                order_number: Number(previous?.order_number || 0) || null
                            },
                            after: {
                                status,
                                order_number: Number(previous?.order_number || 0) || null
                            },
                            ip: requestMeta.ip,
                            userAgent: requestMeta.userAgent
                        });
                    }
                }
            } else if (ADMIN_RESTORE_FROM_ARCHIVE_STATUSES.has(status)) {
                const directUpdateIds = [];
                for (const orderId of uniqueIds) {
                    const restoreResult = await runInTransaction(async (client) => {
                        const existingOrderResult = await client.query(
                            `
                            SELECT id, status, pickup_date, pickup_location, items
                            FROM orders
                            WHERE id = $1
                            FOR UPDATE
                            `,
                            [orderId]
                        );
                        if (existingOrderResult.rows.length === 0) {
                            return { status: 'missing_order' };
                        }

                        const existingOrder = existingOrderResult.rows[0];
                        const existingStatus = String(existingOrder.status || 'pending').trim().toLowerCase();
                        if (existingStatus !== 'archived') {
                            return { status: 'not_archived' };
                        }

                        const pickupDate = formatPickupDate(existingOrder.pickup_date);
                        const pickupLocation = sanitizeText(existingOrder.pickup_location, 40);
                        const storedItems = normalizeStoredOrderItems(existingOrder.items);

                        if (storedItems.length > 0) {
                            const pickupDateId = await findPickupDateId(client, pickupDate, pickupLocation);
                            if (!pickupDateId) {
                                return { status: 'pickup_unavailable', orderId };
                            }

                            for (const item of storedItems) {
                                const required = Number(item.quantity || 0);
                                if (!Number.isInteger(required) || required <= 0) continue;

                                const reserveResult = await client.query(
                                    `
                                    UPDATE pickup_stock
                                    SET stock = stock - $1
                                    WHERE pickup_date_id = $2
                                      AND hen_id = $3
                                      AND stock >= $1
                                    RETURNING stock
                                    `,
                                    [required, pickupDateId, item.id]
                                );
                                if (reserveResult.rowCount > 0) {
                                    await recordInventoryAuditEvent(client, {
                                        pickupDate,
                                        location: pickupLocation,
                                        itemId: item.id,
                                        delta: -required,
                                        reason: 'admin_status_restore_reserve',
                                        actor: adminIdentifier,
                                        requestId: requestMeta.requestId
                                    });
                                    continue;
                                }
                                return {
                                    status: 'insufficient_stock',
                                    orderId,
                                    itemName: item.name || `Item #${item.id}`
                                };
                            }
                        }

                        await client.query(
                            'UPDATE orders SET status = $1 WHERE id = $2',
                            [status, orderId]
                        );
                        await recordOrderAuditEvent(client, {
                            orderId,
                            eventType: 'status_changed',
                            fromStatus: existingStatus,
                            toStatus: status,
                            actorType: 'admin',
                            actorId: adminIdentifier,
                            requestId: requestMeta.requestId,
                            payload: {
                                order_number: Number(existingOrder.order_number || 0) || null
                            }
                        });
                        await recordAdminAuditAction(client, {
                            actionType: 'order_status_update',
                            targetType: 'order',
                            targetId: orderId,
                            adminIdentifier,
                            requestId: requestMeta.requestId,
                            before: {
                                status: existingStatus,
                                order_number: Number(existingOrder.order_number || 0) || null
                            },
                            after: {
                                status,
                                order_number: Number(existingOrder.order_number || 0) || null
                            },
                            ip: requestMeta.ip,
                            userAgent: requestMeta.userAgent
                        });
                        return { status: 'restored' };
                    });

                    if (restoreResult?.status === 'pickup_unavailable') {
                        return res.status(409).json({
                            error: 'Cannot unarchive order because its pickup date is no longer available.'
                        });
                    }
                    if (restoreResult?.status === 'insufficient_stock') {
                        return res.status(409).json({
                            error: `Cannot unarchive order due to insufficient stock for ${restoreResult.itemName || 'one or more items'}.`
                        });
                    }
                    if (restoreResult?.status === 'not_archived') {
                        directUpdateIds.push(orderId);
                    }
                }
                if (directUpdateIds.length > 0) {
                    await pool.query(
                        'UPDATE orders SET status = $1 WHERE id::text = ANY($2::text[])',
                        [status, directUpdateIds]
                    );
                    for (const orderId of directUpdateIds) {
                        const previous = existingOrdersById.get(orderId) || null;
                        await recordOrderAuditEvent(pool, {
                            orderId,
                            eventType: 'status_changed',
                            fromStatus: previous?.status || null,
                            toStatus: status,
                            actorType: 'admin',
                            actorId: adminIdentifier,
                            requestId: requestMeta.requestId,
                            payload: {
                                order_number: Number(previous?.order_number || 0) || null
                            }
                        });
                        await recordAdminAuditAction(pool, {
                            actionType: 'order_status_update',
                            targetType: 'order',
                            targetId: orderId,
                            adminIdentifier,
                            requestId: requestMeta.requestId,
                            before: {
                                status: sanitizeText(previous?.status, 80).toLowerCase() || null,
                                order_number: Number(previous?.order_number || 0) || null
                            },
                            after: {
                                status,
                                order_number: Number(previous?.order_number || 0) || null
                            },
                            ip: requestMeta.ip,
                            userAgent: requestMeta.userAgent
                        });
                    }
                }
            } else {
                await pool.query(
                    'UPDATE orders SET status = $1 WHERE id::text = ANY($2::text[])',
                    [status, uniqueIds]
                );
                for (const orderId of uniqueIds) {
                    const previous = existingOrdersById.get(orderId) || null;
                    await recordOrderAuditEvent(pool, {
                        orderId,
                        eventType: 'status_changed',
                        fromStatus: previous?.status || null,
                        toStatus: status,
                        actorType: 'admin',
                        actorId: adminIdentifier,
                        requestId: requestMeta.requestId,
                        payload: {
                            order_number: Number(previous?.order_number || 0) || null
                        }
                    });
                    await recordAdminAuditAction(pool, {
                        actionType: 'order_status_update',
                        targetType: 'order',
                        targetId: orderId,
                        adminIdentifier,
                        requestId: requestMeta.requestId,
                        before: {
                            status: sanitizeText(previous?.status, 80).toLowerCase() || null,
                            order_number: Number(previous?.order_number || 0) || null
                        },
                        after: {
                            status,
                            order_number: Number(previous?.order_number || 0) || null
                        },
                        ip: requestMeta.ip,
                        userAgent: requestMeta.userAgent
                    });
                }
            }
            if (status === 'paid' && uniqueIds.length > 0) {
                await sendWithConcurrency(uniqueIds, 10, async (orderId) => {
                    await attemptSendOrderConfirmationEmail(orderId, 'admin status update', req);
                });
            }
            return res.json({ success: true, message: 'Status updated' });
        } catch (err) {
            return sendServerError(res, err, 'Failed to update order statuses');
        }
    });

    app.put('/api/admin/orders/:id', checkAuth, async (req, res) => {
        const body = req.body || {};
        const orderId = sanitizeText(req.params?.id, 120);
        const adminIdentifier = getAdminIdentifier(req);
        const requestMeta = getRequestMetadata(req);
        const pickupDate = sanitizeText(body?.pickup?.date, 40);
        const pickupLocation = sanitizeText(body?.pickup?.location, 40);
        const hasTotalField = Boolean(
            (body?.order && Object.prototype.hasOwnProperty.call(body.order, 'total_cents'))
            || Object.prototype.hasOwnProperty.call(body, 'total_cents')
        );
        const totalCentsRaw = Number(body?.order?.total_cents ?? body?.total_cents);
        const hasItemsField = Object.prototype.hasOwnProperty.call(body, 'items');
        const requestedItems = hasItemsField ? normalizeOrderItems(body?.items) : [];
        const hasAmountPaidField = Boolean(
            body?.payment
            && Object.prototype.hasOwnProperty.call(body.payment, 'amount_paid_cents')
        );
        const amountPaidCentsRaw = Number(body?.payment?.amount_paid_cents);
        const hasCustomerEmailField = Boolean(
            body?.customer
            && Object.prototype.hasOwnProperty.call(body.customer, 'email')
        );
        const customerEmailRaw = hasCustomerEmailField
            ? sanitizeText(body?.customer?.email, 320)
            : '';
        const customerEmail = customerEmailRaw ? customerEmailRaw.toLowerCase() : '';

        if (!orderId) {
            return res.status(400).json({ error: 'Order id is required.' });
        }
        if (!pickupDate || !pickupLocation) {
            return res.status(400).json({ error: 'Pickup date and location are required.' });
        }
        if (!isIsoDateValue(pickupDate)) {
            return res.status(400).json({ error: 'Pickup date must use YYYY-MM-DD format.' });
        }
        if (!hasTotalField && !hasItemsField) {
            return res.status(400).json({ error: 'Order amount is required.' });
        }
        if (hasTotalField) {
            if (!Number.isFinite(totalCentsRaw)) {
                return res.status(400).json({ error: 'Order amount is required.' });
            }
            if (totalCentsRaw <= 0) {
                return res.status(400).json({ error: 'Order amount must be greater than $0.00.' });
            }
        }
        if (hasItemsField && requestedItems.length === 0) {
            return res.status(400).json({ error: 'At least one order item is required.' });
        }
        if (hasAmountPaidField) {
            if (!Number.isFinite(amountPaidCentsRaw)) {
                return res.status(400).json({ error: 'Amount paid must be a valid number.' });
            }
            if (amountPaidCentsRaw < 0) {
                return res.status(400).json({ error: 'Amount paid cannot be negative.' });
            }
        }
        if (hasCustomerEmailField && customerEmail && !isValidEmail(customerEmail)) {
            return res.status(400).json({ error: 'Customer email is invalid.' });
        }
        if (hasCustomerEmailField && customerEmail) {
            const emailAssessment = await verifyManagedAddress({
                pool,
                email: customerEmail,
                language: 'en',
                verifyEmail
            });
            if (emailAssessment.shouldBlock) {
                return res.status(400).json({
                    error: emailAssessment.message || 'Customer email cannot receive mail.'
                });
            }
        }

        const reserveStockForItemsAtPickup = async ({
            client,
            pickupDateId,
            pickupDateValue,
            pickupLocationValue,
            items
        }) => {
            if (!pickupDateId || items.length === 0) return;

            const itemIds = items.map((item) => item.id);
            const targetStockResult = await client.query(
                'SELECT hen_id, stock FROM pickup_stock WHERE pickup_date_id = $1 AND hen_id = ANY($2::int[])',
                [pickupDateId, itemIds]
            );
            const targetStockByHenId = new Map(
                targetStockResult.rows.map((row) => [Number(row.hen_id), Number(row.stock || 0)])
            );

            for (const item of items) {
                const required = Number(item.quantity || 0);
                const available = targetStockByHenId.get(Number(item.id)) ?? 0;
                if (required <= 0) continue;
                if (available < required) {
                    throw createInsufficientStockError({
                        henName: item.name || `Item #${item.id}`,
                        required,
                        available,
                        pickupDate: pickupDateValue,
                        pickupLocation: pickupLocationValue
                    });
                }
            }

            for (const item of items) {
                const required = Number(item.quantity || 0);
                if (required <= 0) continue;
                const reserveResult = await client.query(
                    `
                    UPDATE pickup_stock
                    SET stock = stock - $1
                    WHERE pickup_date_id = $2
                      AND hen_id = $3
                      AND stock >= $1
                    RETURNING stock
                    `,
                    [required, pickupDateId, item.id]
                );
                if (reserveResult.rowCount > 0) {
                    await recordInventoryAuditEvent(client, {
                        pickupDate: pickupDateValue,
                        location: pickupLocationValue,
                        itemId: item.id,
                        delta: -required,
                        reason: 'admin_order_edit_reserve',
                        actor: adminIdentifier,
                        requestId: requestMeta.requestId
                    });
                    continue;
                }

                const currentStockResult = await client.query(
                    `
                    SELECT stock
                    FROM pickup_stock
                    WHERE pickup_date_id = $1
                      AND hen_id = $2
                    `,
                    [pickupDateId, item.id]
                );
                const available = Number(currentStockResult.rows[0]?.stock || 0);
                throw createInsufficientStockError({
                    henName: item.name || `Item #${item.id}`,
                    required,
                    available,
                    pickupDate: pickupDateValue,
                    pickupLocation: pickupLocationValue
                });
            }
        };

        const releaseStockForItemsAtPickup = async ({ client, pickupDateId, items }) => {
            if (!pickupDateId || items.length === 0) return;
            for (const item of items) {
                const quantity = Number(item.quantity || 0);
                if (!Number.isInteger(quantity) || quantity <= 0) continue;
                await client.query(
                    `
                    INSERT INTO pickup_stock (pickup_date_id, hen_id, stock)
                    VALUES ($1, $2, $3)
                    ON CONFLICT (pickup_date_id, hen_id)
                    DO UPDATE SET stock = pickup_stock.stock + EXCLUDED.stock
                    `,
                    [pickupDateId, item.id, quantity]
                );
                await recordInventoryAuditEvent(client, {
                    pickupDate: pickupDate,
                    location: pickupLocation,
                    itemId: item.id,
                    delta: quantity,
                    reason: 'admin_order_edit_release',
                    actor: adminIdentifier,
                    requestId: requestMeta.requestId
                });
            }
        };

        try {
            const updateResult = await runInTransaction(async (client) => {
                const existingOrderResult = await client.query(
                    `
                    SELECT
                        id,
                        order_number,
                        customer_id,
                        customer_email,
                        status,
                        pickup_date,
                        pickup_location,
                        items,
                        total_cents,
                        amount_paid_cents,
                        amount_due_cents,
                        payment_type
                    FROM orders
                    WHERE id = $1
                    FOR UPDATE
                    `,
                    [orderId]
                );
                if (existingOrderResult.rows.length === 0) {
                    return { status: 'missing_order' };
                }

                const existingOrder = existingOrderResult.rows[0];
                const existingStatus = String(existingOrder.status || 'pending').trim().toLowerCase();
                const beforeSnapshot = summarizeOrderForAudit(existingOrder);
                if (!ADMIN_EDITABLE_ORDER_STATUSES.has(existingStatus)) {
                    return {
                        status: 'blocked_status',
                        existingStatus
                    };
                }

                const targetPickupDateId = await findPickupDateId(client, pickupDate, pickupLocation);
                if (!targetPickupDateId) {
                    return { status: 'pickup_unavailable' };
                }

                const sourcePickupDate = formatPickupDate(existingOrder.pickup_date);
                const sourcePickupLocation = sanitizeText(existingOrder.pickup_location, 40);
                if (!sourcePickupDate || !sourcePickupLocation) {
                    return { status: 'source_pickup_missing' };
                }

                const pickupChanged = (
                    sourcePickupDate !== pickupDate
                    || sourcePickupLocation !== pickupLocation
                );

                const storedItems = normalizeStoredOrderItems(existingOrder.items);
                if (storedItems.length === 0 && pickupChanged && !hasItemsField) {
                    return {
                        status: 'missing_items'
                    };
                }

                const storedItemsById = new Map(
                    storedItems.map((item) => [Number(item.id), item])
                );
                let nextItemsForStock = storedItems;
                let nextItemsJson = null;
                let calculatedItemsTotalCents = null;
                let hasLambItems = storedItems.some((item) => isLambName(item.name));

                if (hasItemsField) {
                    if (requestedItems.length === 0) {
                        return {
                            status: 'validation_error',
                            error: 'At least one order item is required.'
                        };
                    }

                    const requestedItemIds = requestedItems.map((item) => item.id);
                    const hensResult = await client.query(
                        'SELECT id, name, is_active FROM hens WHERE id = ANY($1::int[])',
                        [requestedItemIds]
                    );
                    const hensById = new Map(
                        hensResult.rows.map((row) => [Number(row.id), row])
                    );

                    const updatedItemsForStorage = [];
                    let updatedTotalCents = 0;
                    let invalidItemMessage = '';
                    for (const requestedItem of requestedItems) {
                        const existingItem = storedItemsById.get(Number(requestedItem.id)) || null;
                        const matchingHen = hensById.get(Number(requestedItem.id)) || null;
                        if (!matchingHen && !existingItem) {
                            invalidItemMessage = 'Some requested items are unavailable.';
                            break;
                        }
                        const henIsActive = matchingHen
                            ? parseBoolean(matchingHen.is_active, true)
                            : false;
                        if (!henIsActive && !existingItem) {
                            invalidItemMessage = 'Some requested items are unavailable.';
                            break;
                        }

                        const henName = sanitizeText(
                            matchingHen?.name || existingItem?.name || `Item #${requestedItem.id}`,
                            200
                        );
                        if (!henName) {
                            invalidItemMessage = 'Some requested items are unavailable.';
                            break;
                        }

                        if (isPickupLocationRestricted(henName, pickupLocation)) {
                            return {
                                status: 'validation_error',
                                error: `${henName} is not available for ${getLocationLabel(pickupLocation)} pickups.`
                            };
                        }

                        const minimumOrderQty = getMinimumOrderQuantity(henName);
                        if (minimumOrderQty > 0 && requestedItem.quantity < minimumOrderQty) {
                            return {
                                status: 'validation_error',
                                error: `Minimum order is ${minimumOrderQty} for ${henName}.`
                            };
                        }

                        const unitCents = calculateItemPrice(henName, requestedItem.quantity);
                        const lineCents = unitCents * requestedItem.quantity;
                        if (!Number.isFinite(unitCents) || unitCents <= 0 || lineCents <= 0) {
                            return {
                                status: 'validation_error',
                                error: `Unable to price ${henName}.`
                            };
                        }

                        updatedTotalCents += lineCents;
                        updatedItemsForStorage.push({
                            id: Number(requestedItem.id),
                            quantity: Number(requestedItem.quantity),
                            name: henName,
                            unit_cents: unitCents,
                            line_cents: lineCents
                        });
                    }

                    if (invalidItemMessage) {
                        return {
                            status: 'validation_error',
                            error: invalidItemMessage
                        };
                    }
                    if (updatedItemsForStorage.length === 0 || updatedTotalCents <= 0) {
                        return {
                            status: 'validation_error',
                            error: 'At least one purchasable item is required.'
                        };
                    }

                    calculatedItemsTotalCents = updatedTotalCents;
                    hasLambItems = updatedItemsForStorage.some((item) => isLambName(item.name));
                    nextItemsForStock = updatedItemsForStorage.map((item) => ({
                        id: item.id,
                        quantity: item.quantity,
                        name: item.name
                    }));
                    nextItemsJson = JSON.stringify(updatedItemsForStorage);
                }

                const nextTotalCents = hasTotalField
                    ? Math.floor(totalCentsRaw)
                    : Math.floor(Number(calculatedItemsTotalCents || 0));
                if (!Number.isFinite(nextTotalCents) || nextTotalCents <= 0) {
                    return {
                        status: 'validation_error',
                        error: 'Order amount must be greater than $0.00.'
                    };
                }

                const nextItemsById = new Map(
                    nextItemsForStock.map((item) => [Number(item.id), item])
                );
                const allItemIds = new Set([
                    ...storedItemsById.keys(),
                    ...nextItemsById.keys()
                ]);
                const itemsChanged = Array.from(allItemIds).some((itemId) => {
                    const storedQty = Number(storedItemsById.get(itemId)?.quantity || 0);
                    const nextQty = Number(nextItemsById.get(itemId)?.quantity || 0);
                    return storedQty !== nextQty;
                });

                if (pickupChanged || itemsChanged) {
                    const sourcePickupDateId = await findPickupDateId(
                        client,
                        sourcePickupDate,
                        sourcePickupLocation
                    );
                    if (!sourcePickupDateId) {
                        return { status: 'source_pickup_missing' };
                    }

                    if (pickupChanged) {
                        await reserveStockForItemsAtPickup({
                            client,
                            pickupDateId: targetPickupDateId,
                            pickupDateValue: pickupDate,
                            pickupLocationValue: pickupLocation,
                            items: nextItemsForStock
                        });

                        await releaseStockForItemsAtPickup({
                            client,
                            pickupDateId: sourcePickupDateId,
                            items: storedItems
                        });
                    } else {
                        const itemsToReserve = [];
                        const itemsToRelease = [];
                        for (const itemId of allItemIds) {
                            const storedItem = storedItemsById.get(itemId) || null;
                            const nextItem = nextItemsById.get(itemId) || null;
                            const storedQty = Number(storedItem?.quantity || 0);
                            const nextQty = Number(nextItem?.quantity || 0);
                            const delta = nextQty - storedQty;
                            if (delta > 0) {
                                itemsToReserve.push({
                                    id: itemId,
                                    quantity: delta,
                                    name: nextItem?.name || storedItem?.name || `Item #${itemId}`
                                });
                            } else if (delta < 0) {
                                itemsToRelease.push({
                                    id: itemId,
                                    quantity: Math.abs(delta),
                                    name: storedItem?.name || nextItem?.name || `Item #${itemId}`
                                });
                            }
                        }

                        await reserveStockForItemsAtPickup({
                            client,
                            pickupDateId: targetPickupDateId,
                            pickupDateValue: pickupDate,
                            pickupLocationValue: pickupLocation,
                            items: itemsToReserve
                        });

                        await releaseStockForItemsAtPickup({
                            client,
                            pickupDateId: sourcePickupDateId,
                            items: itemsToRelease
                        });
                    }
                }

                const storedTotalRaw = Number(existingOrder.total_cents);
                const storedTotalCents = (
                    Number.isFinite(storedTotalRaw) && storedTotalRaw >= 0
                ) ? Math.floor(storedTotalRaw) : 0;
                const storedPaidRaw = Number(existingOrder.amount_paid_cents);
                const storedDueRaw = Number(existingOrder.amount_due_cents);
                let amountPaidCents;
                if (Number.isFinite(storedPaidRaw) && storedPaidRaw >= 0) {
                    amountPaidCents = Math.floor(storedPaidRaw);
                } else if (Number.isFinite(storedDueRaw) && storedDueRaw >= 0) {
                    amountPaidCents = Math.max(storedTotalCents - Math.floor(storedDueRaw), 0);
                } else {
                    amountPaidCents = storedTotalCents;
                }

                if (hasAmountPaidField) {
                    const requestedPaidCents = Math.max(Math.floor(amountPaidCentsRaw), 0);
                    if (requestedPaidCents < amountPaidCents) {
                        return {
                            status: 'paid_reduction_not_allowed',
                            existingPaidCents: amountPaidCents,
                            requestedPaidCents,
                            reductionCents: amountPaidCents - requestedPaidCents
                        };
                    }
                    amountPaidCents = requestedPaidCents;
                }

                if (nextTotalCents < amountPaidCents) {
                    return {
                        status: 'total_below_paid',
                        totalCents: nextTotalCents,
                        amountPaidCents,
                        shortfallCents: amountPaidCents - nextTotalCents
                    };
                }

                const amountDueCents = Math.max(nextTotalCents - amountPaidCents, 0);
                const paymentType = (amountDueCents > 0 || hasLambItems) ? 'deposit' : 'full';
                const nextStatus = amountPaidCents > 0 ? 'paid' : 'pending';
                const customerEmailToStore = hasCustomerEmailField ? (customerEmail || null) : null;

                await client.query(
                    `
                    UPDATE orders
                    SET
                        total_cents = $1,
                        status = $2,
                        pickup_date = $3,
                        pickup_location = $4,
                        payment_type = $5,
                        amount_paid_cents = $6,
                        amount_due_cents = $7,
                        items = CASE WHEN $8::boolean THEN $9 ELSE items END,
                        customer_email = CASE WHEN $10::boolean THEN $11::text ELSE customer_email END
                    WHERE id = $12
                    `,
                    [
                        nextTotalCents,
                        nextStatus,
                        pickupDate,
                        pickupLocation,
                        paymentType,
                        amountPaidCents,
                        amountDueCents,
                        hasItemsField,
                        nextItemsJson,
                        hasCustomerEmailField,
                        customerEmailToStore,
                        orderId
                    ]
                );
                if (hasCustomerEmailField && existingOrder.customer_id) {
                    await client.query(
                        'UPDATE customers SET email = $1 WHERE id = $2',
                        [customerEmailToStore, existingOrder.customer_id]
                    );
                }

                const afterSnapshot = summarizeOrderForAudit({
                    ...existingOrder,
                    total_cents: nextTotalCents,
                    status: nextStatus,
                    pickup_date: pickupDate,
                    pickup_location: pickupLocation,
                    payment_type: paymentType,
                    amount_paid_cents: amountPaidCents,
                    amount_due_cents: amountDueCents,
                    customer_email: hasCustomerEmailField
                        ? customerEmailToStore
                        : existingOrder.customer_email,
                    items: hasItemsField ? nextItemsForStock : storedItems
                });
                await recordOrderAuditEvent(client, {
                    orderId,
                    eventType: 'order_edited',
                    fromStatus: existingStatus,
                    toStatus: nextStatus,
                    actorType: 'admin',
                    actorId: adminIdentifier,
                    requestId: requestMeta.requestId,
                    payload: {
                        before: beforeSnapshot,
                        after: afterSnapshot
                    }
                });
                await recordAdminAuditAction(client, {
                    actionType: 'order_edit',
                    targetType: 'order',
                    targetId: orderId,
                    adminIdentifier,
                    requestId: requestMeta.requestId,
                    before: beforeSnapshot,
                    after: afterSnapshot,
                    ip: requestMeta.ip,
                    userAgent: requestMeta.userAgent
                });

                return {
                    status: 'updated',
                    orderId,
                    orderNumber: Number(existingOrder.order_number) || null,
                    pickupDate,
                    pickupLocation,
                    totalCents: nextTotalCents,
                    amountPaidCents,
                    amountDueCents,
                    paymentType,
                    nextStatus,
                    customerEmail: hasCustomerEmailField
                        ? customerEmailToStore
                        : (existingOrder.customer_email || null)
                };
            });

            if (updateResult.status === 'missing_order') {
                return res.status(404).json({ error: 'Order not found.' });
            }
            if (updateResult.status === 'blocked_status') {
                return res.status(400).json({
                    error: buildStatusEditBlockedMessage(updateResult.existingStatus)
                });
            }
            if (updateResult.status === 'pickup_unavailable') {
                return res.status(400).json({
                    error: 'Selected pickup date is not available.'
                });
            }
            if (updateResult.status === 'source_pickup_missing') {
                return res.status(409).json({
                    error: 'Current pickup inventory record is missing. Please refresh pickup dates before editing this order.'
                });
            }
            if (updateResult.status === 'missing_items') {
                return res.status(400).json({
                    error: 'This order has no valid items and cannot be moved to a different pickup date.'
                });
            }
            if (updateResult.status === 'validation_error') {
                return res.status(400).json({
                    error: updateResult.error || 'Invalid order update request.'
                });
            }
            if (updateResult.status === 'total_below_paid') {
                return res.status(400).json({
                    error: `Order total (${formatCents(updateResult.totalCents)}) cannot be less than amount already paid (${formatCents(updateResult.amountPaidCents)}). Short by ${formatCents(updateResult.shortfallCents)}.`
                });
            }
            if (updateResult.status === 'paid_reduction_not_allowed') {
                return res.status(400).json({
                    error: `Amount paid cannot be reduced below the already recorded amount (${formatCents(updateResult.existingPaidCents)}). Reduction requested: ${formatCents(updateResult.reductionCents)}.`
                });
            }

            if (updateResult.nextStatus === 'paid') {
                await attemptSendOrderConfirmationEmail(updateResult.orderId, 'admin order update', req);
            }

            return res.json({
                success: true,
                orderId: updateResult.orderId,
                orderNumber: Number(updateResult.orderNumber) || null,
                pickup_date: updateResult.pickupDate,
                pickup_location: updateResult.pickupLocation,
                total_cents: updateResult.totalCents,
                amount_paid_cents: updateResult.amountPaidCents,
                amount_due_cents: updateResult.amountDueCents,
                payment_type: updateResult.paymentType,
                status: updateResult.nextStatus,
                customer_email: updateResult.customerEmail
            });
        } catch (err) {
            if (err?.code === 'ADMIN_ORDER_INSUFFICIENT_STOCK') {
                const meta = err.meta || {};
                return res.status(409).json({
                    error: `Insufficient stock for ${meta.henName || 'this item'} on ${meta.pickupDate || 'the selected date'} (${getLocationLabel(meta.pickupLocation)}). Need ${meta.required || 0}, available ${meta.available || 0}.`
                });
            }
            return sendServerError(res, err, 'Failed to update admin order');
        }
    });

    app.delete('/api/admin/orders/:id', checkAuth, async (req, res) => {
        const orderId = sanitizeText(req.params?.id, 120);
        const adminIdentifier = getAdminIdentifier(req);
        const requestMeta = getRequestMetadata(req);
        if (!orderId) {
            return res.status(400).json({ error: 'Order id is required.' });
        }

        try {
            const deleteResult = await runInTransaction(async (client) => {
                const existingOrderResult = await client.query(
                    `
                    SELECT
                        id,
                        order_number,
                        status,
                        pickup_date,
                        pickup_location,
                        items
                    FROM orders
                    WHERE id = $1
                    FOR UPDATE
                    `,
                    [orderId]
                );
                if (existingOrderResult.rows.length === 0) {
                    return { status: 'missing_order' };
                }

                const existingOrder = existingOrderResult.rows[0];
                const existingStatus = String(existingOrder.status || 'pending').trim().toLowerCase();
                const beforeSnapshot = summarizeOrderForAudit(existingOrder);
                if (!ADMIN_ARCHIVABLE_ORDER_STATUSES.has(existingStatus)) {
                    return {
                        status: 'blocked_status',
                        existingStatus
                    };
                }

                const pickupDate = formatPickupDate(existingOrder.pickup_date);
                const pickupLocation = sanitizeText(existingOrder.pickup_location, 40);
                const storedItems = normalizeStoredOrderItems(existingOrder.items);
                const shouldReleaseStock = existingStatus === 'pending' || existingStatus === 'paid';
                if (shouldReleaseStock && pickupDate && pickupLocation && storedItems.length > 0) {
                        const pickupDateId = await findPickupDateId(client, pickupDate, pickupLocation);
                        if (pickupDateId) {
                            await releaseStockForItems(client, {
                                pickupDateId,
                                items: storedItems,
                                pickupDate,
                                pickupLocation,
                                inventoryReason: 'admin_order_archive_release',
                                inventoryActor: adminIdentifier,
                                requestId: requestMeta.requestId
                            });
                        }
                    }

                await client.query(
                    'UPDATE orders SET status = $1 WHERE id = $2',
                    ['archived', orderId]
                );
                const afterSnapshot = summarizeOrderForAudit({
                    ...existingOrder,
                    status: 'archived'
                });
                await recordOrderAuditEvent(client, {
                    orderId,
                    eventType: 'order_deleted',
                    fromStatus: existingStatus,
                    toStatus: 'archived',
                    actorType: 'admin',
                    actorId: adminIdentifier,
                    requestId: requestMeta.requestId,
                    payload: {
                        before: beforeSnapshot,
                        after: afterSnapshot,
                        archive_mode: true
                    }
                });
                await recordAdminAuditAction(client, {
                    actionType: 'order_archive',
                    targetType: 'order',
                    targetId: orderId,
                    adminIdentifier,
                    requestId: requestMeta.requestId,
                    before: beforeSnapshot,
                    after: afterSnapshot,
                    ip: requestMeta.ip,
                    userAgent: requestMeta.userAgent
                });
                return {
                    status: 'archived',
                    orderId,
                    orderNumber: Number(existingOrder.order_number) || null
                };
            });

            if (deleteResult.status === 'missing_order') {
                return res.status(404).json({ error: 'Order not found.' });
            }
            if (deleteResult.status === 'blocked_status') {
                return res.status(400).json({
                    error: buildStatusDeleteBlockedMessage(deleteResult.existingStatus)
                });
            }

            return res.json({
                success: true,
                orderId: deleteResult.orderId,
                orderNumber: Number(deleteResult.orderNumber) || null,
                status: 'archived'
            });
        } catch (err) {
            return sendServerError(res, err, 'Failed to archive admin order');
        }
    });

    app.post('/api/admin/orders/:id/resend-confirmation', checkAuth, async (req, res) => {
        const orderId = sanitizeText(req.params?.id, 120);
        const adminIdentifier = getAdminIdentifier(req);
        const requestMeta = getRequestMetadata(req);
        if (!orderId) {
            return res.status(400).json({ error: 'Order id is required.' });
        }
        if (typeof sendOrderConfirmationEmail !== 'function') {
            return res.status(503).json({ error: 'Confirmation email is not available.' });
        }

        try {
            const result = await sendOrderConfirmationEmail(orderId, buildTrackedConfirmationOptions({
                force: true,
                initiatedBy: 'admin',
                actorType: 'admin',
                actorId: adminIdentifier,
                requestId: requestMeta.requestId
            }));
            if (result?.skipped === 'missing_order') {
                return res.status(404).json({ error: 'Order not found.' });
            }
            if (result?.skipped === 'missing_email') {
                return res.status(400).json({ error: 'Order does not have a customer email.' });
            }
            if (result?.skipped === 'not_paid') {
                return res.status(409).json({ error: 'Confirmation emails can only be resent for paid orders.' });
            }
            if (result?.skipped === 'not_configured') {
                return res.status(503).json({ error: 'Confirmation email is not configured.' });
            }
            await recordAdminAuditAction(pool, {
                actionType: 'resend_confirmation',
                targetType: 'order',
                targetId: orderId,
                adminIdentifier,
                requestId: requestMeta.requestId,
                before: {},
                after: {
                    email_message_id: result?.emailMessageId || null,
                    provider_email_id: result?.providerEmailId || null
                },
                ip: requestMeta.ip,
                userAgent: requestMeta.userAgent
            });

            return res.json({
                success: true,
                orderId,
                emailMessageId: result?.emailMessageId || null,
                providerEmailId: result?.providerEmailId || null
            });
        } catch (err) {
            return sendServerError(res, err, 'Failed to resend confirmation email');
        }
    });

    app.post('/api/admin/orders/:id/finalize-payment', checkAuth, async (req, res) => {
        try {
            const adminIdentifier = getAdminIdentifier(req);
            const requestMeta = getRequestMetadata(req);
            const orderId = req.params.id;
            const orderResult = await pool.query(
                'SELECT stripe_payment_id, status, order_number FROM orders WHERE id = $1',
                [orderId]
            );
            if (orderResult.rows.length === 0) {
                return res.status(404).json({ error: 'Order not found' });
            }
            const order = orderResult.rows[0];
            const stripeSessionId = order.stripe_payment_id;
            if (!stripeSessionId) {
                return res.status(400).json({ error: 'No Stripe session for this order' });
            }
            const session = await stripe.checkout.sessions.retrieve(stripeSessionId);
            if (session.payment_status === 'paid') {
                const result = await finalizeOrderFromSession(session, {
                    source: 'admin_finalize_payment',
                    actorType: 'admin',
                    actorId: adminIdentifier,
                    requestId: requestMeta.requestId,
                    providerEventId: stripeSessionId,
                    paymentEventType: 'admin.finalize_payment'
                });
                await recordAdminAuditAction(pool, {
                    actionType: 'finalize_payment',
                    targetType: 'order',
                    targetId: orderId,
                    adminIdentifier,
                    requestId: requestMeta.requestId,
                    before: {
                        status: sanitizeText(order.status, 80).toLowerCase() || null
                    },
                    after: {
                        finalize_result: result.status,
                        payment_status: session.payment_status
                    },
                    ip: requestMeta.ip,
                    userAgent: requestMeta.userAgent
                });
                const refreshedOrder = await pool.query(
                    'SELECT status, order_number FROM orders WHERE id = $1',
                    [orderId]
                );
                const refreshedRow = refreshedOrder.rows[0] || {};
                return res.json({
                    success: true,
                    status: refreshedRow.status || result.status,
                    orderNumber: Number(refreshedRow.order_number) || null
                });
            }
            await recordPaymentAuditEvent(pool, {
                orderId,
                provider: 'stripe',
                providerEventId: stripeSessionId,
                eventType: 'admin.finalize_payment',
                status: session.payment_status || 'unpaid',
                payload: {
                    request_id: requestMeta.requestId,
                    admin_identifier: adminIdentifier,
                    session_status: session.status || null
                }
            });
            await recordAdminAuditAction(pool, {
                actionType: 'finalize_payment',
                targetType: 'order',
                targetId: orderId,
                adminIdentifier,
                requestId: requestMeta.requestId,
                before: {
                    status: sanitizeText(order.status, 80).toLowerCase() || null
                },
                after: {
                    payment_status: session.payment_status || null,
                    session_status: session.status || null
                },
                ip: requestMeta.ip,
                userAgent: requestMeta.userAgent
            });
            return res.json({
                success: true,
                status: order.status,
                payment_status: session.payment_status,
                orderNumber: Number(order.order_number) || null
            });
        } catch (err) {
            return sendServerError(res, err, 'Failed to finalize payment');
        }
    });

    app.get('/api/admin/orders-page', checkAuth, async (req, res) => {
        try {
            const page = await fetchAdminOrdersPage({
                limit: req.query.limit,
                offset: req.query.offset
            });
            return res.json(page);
        } catch (err) {
            return sendServerError(res, err, 'Failed to load admin orders page');
        }
    });

    app.get('/api/admin/meta', checkAuth, async (req, res) => {
        try {
            const payload = await fetchAdminMetaPayload();
            return res.json(payload);
        } catch (err) {
            return sendServerError(res, err, 'Failed to load admin metadata');
        }
    });

    app.put('/api/admin/hens/:id', checkAuth, async (req, res) => {
        const { id } = req.params;
        const { stock } = req.body;
        const normalizedStock = Number(stock);
        if (!Number.isFinite(normalizedStock) || normalizedStock < 0) {
            return res.status(400).json({ error: 'Valid stock is required.' });
        }
        try {
            const adminIdentifier = getAdminIdentifier(req);
            const requestMeta = getRequestMetadata(req);
            let beforeStock = null;
            if (adminActionAuditEnabled) {
                const beforeResult = await pool.query(
                    'SELECT stock FROM hens WHERE id = $1',
                    [id]
                );
                beforeStock = Number(beforeResult.rows[0]?.stock ?? null);
            }
            await pool.query('UPDATE hens SET stock = $1 WHERE id = $2', [Math.floor(normalizedStock), id]);
            await recordAdminAuditAction(pool, {
                actionType: 'hen_stock_edit',
                targetType: 'hen',
                targetId: sanitizeText(id, 120),
                adminIdentifier,
                requestId: requestMeta.requestId,
                before: {
                    stock: Number.isFinite(beforeStock) ? Math.floor(beforeStock) : null
                },
                after: {
                    stock: Math.floor(normalizedStock)
                },
                ip: requestMeta.ip,
                userAgent: requestMeta.userAgent
            });
            return res.json({ success: true, message: "Stock updated" });
        } catch (err) {
            return sendServerError(res, err, 'Failed to update stock');
        }
    });

    app.post('/api/admin/pickup-dates', checkAuth, async (req, res) => {
        const dateValue = sanitizeText(req.body?.date_value, 40);
        const location = sanitizeText(req.body?.location, 40);
        if (!dateValue || !location) {
            return res.status(400).send('Date and location are required.');
        }
        try {
            const adminIdentifier = getAdminIdentifier(req);
            const requestMeta = getRequestMetadata(req);
            const existing = await pool.query(
                `
                SELECT id
                FROM pickup_dates
                WHERE date_value = $1 AND location = $2
                ORDER BY created_at ASC, id ASC
                LIMIT 1
                `,
                [dateValue, location]
            );
            if (existing.rows.length > 0) {
                return res.status(409).json({
                    error: 'Pickup date already exists for this location.'
                });
            }

            const result = await pool.query(
                'INSERT INTO pickup_dates (date_value, location) VALUES ($1, $2) RETURNING *',
                [dateValue, location]
            );
            const pickupDate = result.rows[0];
            const hensRes = await pool.query(
                'SELECT id, COALESCE(stock, 0) as stock FROM hens WHERE is_active = true ORDER BY id ASC'
            );
            if (hensRes.rows.length > 0) {
                const henIds = hensRes.rows.map((row) => Number(row.id));
                const stocks = hensRes.rows.map((row) => Number(row.stock || 0));
                await pool.query(
                    `
                    INSERT INTO pickup_stock (pickup_date_id, hen_id, stock)
                    SELECT $1, UNNEST($2::int[]), UNNEST($3::int[])
                    ON CONFLICT (pickup_date_id, hen_id) DO NOTHING
                    `,
                    [pickupDate.id, henIds, stocks]
                );
            }
            await recordAdminAuditAction(pool, {
                actionType: 'pickup_date_create',
                targetType: 'pickup_date',
                targetId: sanitizeText(pickupDate?.id, 120),
                adminIdentifier,
                requestId: requestMeta.requestId,
                before: {},
                after: {
                    id: sanitizeText(pickupDate?.id, 120) || null,
                    date_value: sanitizeText(pickupDate?.date_value, 40) || dateValue,
                    location: sanitizeText(pickupDate?.location, 40) || location,
                    seeded_hen_count: Number(hensRes.rows.length || 0)
                },
                ip: requestMeta.ip,
                userAgent: requestMeta.userAgent
            });
            return res.json(pickupDate);
        } catch (err) {
            if (err?.code === '23505') {
                return res.status(409).json({
                    error: 'Pickup date already exists for this location.'
                });
            }
            return sendServerError(res, err, 'Failed to add pickup date');
        }
    });

    app.put('/api/admin/pickup-dates/:id', checkAuth, async (req, res) => {
        const sourceId = sanitizeText(req.params?.id, 120);
        const targetDateValue = sanitizeText(req.body?.date_value ?? req.body?.dateValue, 40);
        const requestedTargetLocation = sanitizeText(req.body?.location, 40);
        const emailUsers = parseBoolean(req.body?.email_users ?? req.body?.emailUsers, false);

        if (!sourceId) {
            return res.status(400).json({ error: 'Pickup date id is required.' });
        }
        if (!targetDateValue) {
            return res.status(400).json({ error: 'Date is required.' });
        }
        if (!isIsoDateValue(targetDateValue)) {
            return res.status(400).json({ error: 'Date must use YYYY-MM-DD format.' });
        }

        try {
            const adminIdentifier = getAdminIdentifier(req);
            const requestMeta = getRequestMetadata(req);
            const updateResult = await runInTransaction(async (client) => {
                const sourceResult = await client.query(
                    `
                    SELECT id, date_value, location
                    FROM pickup_dates
                    WHERE id = $1
                    FOR UPDATE
                    `,
                    [sourceId]
                );
                if (sourceResult.rows.length === 0) {
                    return { status: 'missing_source' };
                }

                const source = sourceResult.rows[0];
                const sourceDateValue = formatPickupDate(source.date_value);
                const sourceLocation = sanitizeText(source.location, 40);
                const targetLocation = sourceLocation;

                if (requestedTargetLocation && requestedTargetLocation !== sourceLocation) {
                    return {
                        status: 'location_change_not_allowed',
                        sourceLocation
                    };
                }

                if (
                    sourceDateValue === targetDateValue
                ) {
                    return {
                        status: 'no_change',
                        sourceDateValue,
                        sourceLocation
                    };
                }

                const recipients = emailUsers
                    ? await loadDateChangeRecipients(client, { sourceDateValue, sourceLocation })
                    : [];

                const targetResult = await client.query(
                    `
                    SELECT id
                    FROM pickup_dates
                    WHERE date_value = $1
                      AND location = $2
                      AND id <> $3
                    ORDER BY created_at ASC, id ASC
                    LIMIT 1
                    FOR UPDATE
                    `,
                    [targetDateValue, targetLocation, sourceId]
                );

                let merged = false;
                if (targetResult.rows.length > 0) {
                    merged = true;
                    const targetId = targetResult.rows[0].id;

                    const movedOrders = await client.query(
                        `
                        UPDATE orders
                        SET pickup_date = $1, pickup_location = $2
                        WHERE pickup_date = $3
                          AND pickup_location = $4
                        `,
                        [targetDateValue, targetLocation, sourceDateValue, sourceLocation]
                    );

                    await client.query(
                        `
                        INSERT INTO pickup_stock (pickup_date_id, hen_id, stock)
                        SELECT $1, hen_id, stock
                        FROM pickup_stock
                        WHERE pickup_date_id = $2
                        ON CONFLICT (pickup_date_id, hen_id)
                        DO UPDATE SET stock = pickup_stock.stock + EXCLUDED.stock
                        `,
                        [targetId, sourceId]
                    );

                    await client.query('DELETE FROM pickup_dates WHERE id = $1', [sourceId]);

                    return {
                        status: 'updated',
                        merged,
                        movedOrders: movedOrders.rowCount || 0,
                        recipients,
                        fromDateValue: sourceDateValue,
                        fromLocation: sourceLocation,
                        toDateValue: targetDateValue,
                        toLocation: targetLocation
                    };
                }

                await client.query(
                    `
                    UPDATE pickup_dates
                    SET date_value = $1, location = $2
                    WHERE id = $3
                    `,
                    [targetDateValue, targetLocation, sourceId]
                );

                const movedOrders = await client.query(
                    `
                    UPDATE orders
                    SET pickup_date = $1, pickup_location = $2
                    WHERE pickup_date = $3
                      AND pickup_location = $4
                    `,
                    [targetDateValue, targetLocation, sourceDateValue, sourceLocation]
                );

                return {
                    status: 'updated',
                    merged,
                    movedOrders: movedOrders.rowCount || 0,
                    recipients,
                    fromDateValue: sourceDateValue,
                    fromLocation: sourceLocation,
                    toDateValue: targetDateValue,
                    toLocation: targetLocation
                };
            });

            if (updateResult.status === 'missing_source') {
                return res.status(404).json({ error: 'Pickup date not found.' });
            }

            if (updateResult.status === 'location_change_not_allowed') {
                return res.status(400).json({
                    error: 'Changing pickup location is not supported from this action.'
                });
            }

            if (updateResult.status === 'no_change') {
                return res.status(400).json({
                    error: 'Pickup date is unchanged.'
                });
            }

            let batchRunId = null;
            let emailSent = 0;
            let emailFailed = 0;
            const failedRecipients = [];
            if (emailUsers && updateResult.recipients.length > 0) {
                batchRunId = await startAuditBatchRun(pool, {
                    batchType: 'pickup_date_change_batch',
                    scope: {
                        from_date: updateResult.fromDateValue,
                        from_location: updateResult.fromLocation,
                        to_date: updateResult.toDateValue,
                        to_location: updateResult.toLocation,
                        recipient_count: updateResult.recipients.length
                    },
                    expectedCount: updateResult.recipients.length,
                    initiatedBy: adminIdentifier,
                    requestId: requestMeta.requestId
                });
                await sendWithConcurrency(updateResult.recipients, 10, async (recipient) => {
                    const payload = buildPickupDateChangeEmail({
                        language: recipient.language,
                        customerName: recipient.name,
                        fromDateValue: updateResult.fromDateValue,
                        fromLocation: updateResult.fromLocation,
                        toDateValue: updateResult.toDateValue,
                        toLocation: updateResult.toLocation
                    });
                    let sendResult;
                    try {
                        sendResult = await sendManagedEmailMessage({
                            pool,
                            verifyEmail,
                            sendEmailMessage,
                            message: {
                                to: {
                                    email: recipient.email,
                                    name: recipient.name || undefined
                                },
                                subject: payload.subject,
                                text: payload.text,
                                html: payload.html,
                                from: DATE_CHANGE_EMAIL_FROM || undefined,
                                replyTo: DATE_CHANGE_EMAIL_REPLY_TO || undefined,
                                headers: DATE_CHANGE_EMAIL_HEADERS,
                                emailType: EMAIL_TYPES.PICKUP_DATE_CHANGE,
                                initiatedBy: 'admin',
                                batchRunId,
                                requestId: requestMeta.requestId,
                                language: recipient.language,
                                batchKey: `${updateResult.fromDateValue}::${updateResult.fromLocation}=>${updateResult.toDateValue}::${updateResult.toLocation}`,
                                pickupDate: updateResult.toDateValue,
                                pickupLocation: updateResult.toLocation,
                                orderIds: recipient.orderIds,
                                metadata: {
                                    from_date: updateResult.fromDateValue,
                                    from_location: updateResult.fromLocation,
                                    to_date: updateResult.toDateValue,
                                    to_location: updateResult.toLocation
                                }
                            }
                        });
                    } catch (err) {
                        const unexpectedReason = normalizeEmailFailureReason(
                            err?.message,
                            'Unexpected email send failure.'
                        );
                        logWarn('Pickup date change email worker failed unexpectedly', {
                            email: sanitizeText(recipient.email, 320).toLowerCase() || 'invalid-email',
                            requestId: requestMeta.requestId,
                            batchRunId,
                            reason: unexpectedReason
                        });
                        sendResult = {
                            success: false,
                            status: 'failed',
                            reason: unexpectedReason
                        };
                    }
                    if (sendResult.success) {
                        emailSent += 1;
                    } else {
                        emailFailed += 1;
                        failedRecipients.push(buildFailedRecipient({
                            email: recipient.email,
                            name: recipient.name,
                            reason: sendResult.reason,
                            fallbackReason: 'Email provider rejected this recipient.'
                        }));
                    }
                });
                await finalizeAuditBatchRun(pool, batchRunId, {
                    attemptedCount: updateResult.recipients.length,
                    succeededCount: emailSent,
                    failedCount: emailFailed,
                    initiatedBy: adminIdentifier,
                    requestId: requestMeta.requestId
                });
            }

            await recordAdminAuditAction(pool, {
                actionType: 'pickup_date_change',
                targetType: 'pickup_date',
                targetId: sourceId,
                adminIdentifier,
                requestId: requestMeta.requestId,
                before: {
                    date_value: updateResult.fromDateValue,
                    location: updateResult.fromLocation
                },
                after: {
                    date_value: updateResult.toDateValue,
                    location: updateResult.toLocation,
                    merged: updateResult.merged,
                    moved_orders: updateResult.movedOrders,
                    email_requested: emailUsers,
                    email_recipients: updateResult.recipients.length,
                    email_sent: emailSent,
                    email_failed: emailFailed,
                    batch_run_id: batchRunId
                },
                ip: requestMeta.ip,
                userAgent: requestMeta.userAgent
            });

            return res.json({
                success: true,
                merged: updateResult.merged,
                movedOrders: updateResult.movedOrders,
                emailRequested: emailUsers,
                emailRecipients: updateResult.recipients.length,
                emailSent,
                emailFailed,
                failedRecipients,
                fromDateValue: updateResult.fromDateValue,
                fromLocation: updateResult.fromLocation,
                toDateValue: updateResult.toDateValue,
                toLocation: updateResult.toLocation
            });
        } catch (err) {
            if (err?.code === '23505') {
                return res.status(409).json({
                    error: 'Pickup date already exists for this location.'
                });
            }
            return sendServerError(res, err, 'Failed to update pickup date');
        }
    });

    app.delete('/api/admin/pickup-dates/:id', checkAuth, async (req, res) => {
        const { id } = req.params;
        try {
            const adminIdentifier = getAdminIdentifier(req);
            const requestMeta = getRequestMetadata(req);
            const targetDate = await pool.query(
                'SELECT date_value, location FROM pickup_dates WHERE id = $1',
                [id]
            );
            if (targetDate.rows.length === 0) {
                return res.json({ success: true });
            }

            const dateValue = targetDate.rows[0].date_value;
            const location = targetDate.rows[0].location;
            const activeOrders = await pool.query(
                `
                SELECT COUNT(*)::int AS count
                FROM orders
                WHERE pickup_date = $1
                  AND pickup_location = $2
                  AND LOWER(COALESCE(status, 'pending')) <> 'cancelled'
                `,
                [dateValue, location]
            );
            if (Number(activeOrders.rows[0]?.count || 0) > 0) {
                return res.status(409).json({
                    error: 'Cannot delete pickup date with active orders.'
                });
            }

            await pool.query('DELETE FROM pickup_dates WHERE id = $1', [id]);
            await recordAdminAuditAction(pool, {
                actionType: 'pickup_date_delete',
                targetType: 'pickup_date',
                targetId: sanitizeText(id, 120),
                adminIdentifier,
                requestId: requestMeta.requestId,
                before: {
                    date_value: sanitizeText(dateValue, 40) || null,
                    location: sanitizeText(location, 40) || null
                },
                after: {
                    deleted: true
                },
                ip: requestMeta.ip,
                userAgent: requestMeta.userAgent
            });
            return res.json({ success: true });
        } catch (err) {
            return sendServerError(res, err, 'Failed to delete pickup date');
        }
    });

    app.get('/api/admin/stats', checkAuth, async (req, res) => {
        try {
            const result = await pool.query(`
                SELECT
                    COUNT(*)::int AS order_count,
                    COALESCE(SUM(total_cents), 0)::bigint AS total_expected_cents,
                    COALESCE(SUM(amount_paid_cents), 0)::bigint AS total_paid_cents,
                    COALESCE(SUM(amount_due_cents), 0)::bigint AS total_due_cents,
                    COALESCE(SUM(
                        CASE WHEN stripe_payment_id IS NOT NULL
                             THEN ROUND(amount_paid_cents * 0.029) + 30
                             ELSE 0
                        END
                    ), 0)::bigint AS stripe_fee_cents
                FROM orders
                WHERE LOWER(COALESCE(status, 'pending')) NOT IN ('cancelled', 'archived', 'reserved')
            `);
            const row = result.rows[0] || {};
            return res.json({
                orderCount: Number(row.order_count || 0),
                totalExpectedCents: Number(row.total_expected_cents || 0),
                totalPaidCents: Number(row.total_paid_cents || 0),
                totalDueCents: Number(row.total_due_cents || 0),
                stripeFeeCents: Number(row.stripe_fee_cents || 0)
            });
        } catch (err) {
            return sendServerError(res, err, 'Failed to load admin stats');
        }
    });

    app.get('/api/admin/pickup-stock', checkAuth, handlePickupStockRequest);

    app.put('/api/admin/pickup-stock', checkAuth, async (req, res) => {
        const { date, location, items } = req.body || {};
        if (!date || !location) {
            return res.status(400).json({ error: 'date and location are required' });
        }
        if (!Array.isArray(items) || items.length === 0) {
            return res.status(400).json({ error: 'items array is required' });
        }
        try {
            const adminIdentifier = getAdminIdentifier(req);
            const requestMeta = getRequestMetadata(req);
            const normalizedItems = items
                .map((item) => ({
                    henId: Number(item?.hen_id ?? item?.henId),
                    stock: Number(item?.stock)
                }))
                .filter((item) => Number.isFinite(item.henId));
            const henIds = normalizedItems.map((item) => item.henId);
            const stocks = normalizedItems.map((item) =>
                Number.isFinite(item.stock) && item.stock >= 0 ? Math.floor(item.stock) : 0
            );
            if (henIds.length === 0) {
                return res.status(400).json({ error: 'Invalid item payload.' });
            }

            const updateResult = await runInTransaction(async (client) => {
                const pickupDateId = await findPickupDateId(client, date, location);
                if (!pickupDateId) {
                    return { status: 'missing_pickup' };
                }

                const beforeRows = await client.query(
                    `
                    SELECT hen_id, stock
                    FROM pickup_stock
                    WHERE pickup_date_id = $1
                      AND hen_id = ANY($2::int[])
                    `,
                    [pickupDateId, henIds]
                );
                const beforeStockByHenId = new Map(
                    beforeRows.rows.map((row) => [Number(row.hen_id), Number(row.stock || 0)])
                );

                await client.query(
                    `
                    INSERT INTO pickup_stock (pickup_date_id, hen_id, stock)
                    SELECT $1, UNNEST($2::int[]), UNNEST($3::int[])
                    ON CONFLICT (pickup_date_id, hen_id)
                    DO UPDATE SET stock = EXCLUDED.stock
                    `,
                    [pickupDateId, henIds, stocks]
                );

                const changedItems = [];
                const inventoryEvents = [];
                for (const item of normalizedItems) {
                    const henId = Number(item.henId);
                    const nextStock = Number.isFinite(item.stock) && item.stock >= 0
                        ? Math.floor(item.stock)
                        : 0;
                    const previousStock = beforeStockByHenId.get(henId) ?? 0;
                    if (previousStock === nextStock) {
                        continue;
                    }
                    changedItems.push({
                        item_id: henId,
                        from_stock: previousStock,
                        to_stock: nextStock,
                        delta: nextStock - previousStock
                    });
                    inventoryEvents.push({
                        pickupDate: sanitizeText(date, 40),
                        location: sanitizeText(location, 80),
                        itemId: henId,
                        delta: nextStock - previousStock,
                        reason: 'admin_pickup_stock_edit',
                        actor: adminIdentifier,
                        requestId: requestMeta.requestId
                    });
                }

                if (inventoryEventAuditEnabled && inventoryEvents.length > 0) {
                    await recordInventoryAuditEvents(client, inventoryEvents);
                }
                await recordAdminAuditAction(client, {
                    actionType: 'pickup_stock_edit',
                    targetType: 'pickup_stock',
                    targetId: `${sanitizeText(date, 40)}::${sanitizeText(location, 80)}`,
                    adminIdentifier,
                    requestId: requestMeta.requestId,
                    before: {
                        pickup_date: sanitizeText(date, 40),
                        location: sanitizeText(location, 80),
                        items: changedItems.map((item) => ({
                            item_id: item.item_id,
                            stock: item.from_stock
                        }))
                    },
                    after: {
                        pickup_date: sanitizeText(date, 40),
                        location: sanitizeText(location, 80),
                        items: changedItems.map((item) => ({
                            item_id: item.item_id,
                            stock: item.to_stock
                        }))
                    },
                    ip: requestMeta.ip,
                    userAgent: requestMeta.userAgent
                });
                return { status: 'updated' };
            });

            if (updateResult.status === 'missing_pickup') {
                return res.status(404).json({ error: 'Pickup date not found.' });
            }
            return res.json({ success: true });
        } catch (err) {
            return sendServerError(res, err, 'Failed to update pickup stock');
        }
    });

    app.get('/api/admin/email-activity', checkAuth, async (req, res) => {
        try {
            const activity = await listTrackedEmailActivity({
                pool,
                limit: Math.min(parsePositiveInt(req.query.limit, ADMIN_EMAIL_ACTIVITY_LIMIT), 500),
                query: sanitizeText(req.query.query, 120),
                status: sanitizeText(req.query.status, 80).toLowerCase(),
                emailType: sanitizeText(req.query.email_type ?? req.query.emailType, 80).toLowerCase()
            });
            return res.json({ activity });
        } catch (err) {
            return sendServerError(res, err, 'Failed to load email activity');
        }
    });

    app.post('/api/admin/email/preview', checkAuth, async (req, res) => {
        try {
            const previewMessages = normalizeAdminSendMessages({
                messages: req.body?.messages,
                recipients: req.body?.recipients,
                subject: req.body?.subject,
                message: req.body?.message,
                defaultEmailType: EMAIL_TYPES.ADMIN_MESSAGE
            });
            if (previewMessages.length === 0) {
                return res.status(400).json({ error: 'No email recipients provided.' });
            }
            if (previewMessages.length > 500) {
                return res.status(400).json({ error: 'Too many email recipients in one request.' });
            }
            const preview = await previewAdminSendMessages(previewMessages);
            return res.json({
                success: true,
                total: preview.total,
                counts: preview.counts,
                recipients: preview.recipients,
                completedAt: new Date().toISOString()
            });
        } catch (err) {
            return sendServerError(res, err, 'Email preview failed');
        }
    });

    app.post('/api/admin/email', checkAuth, async (req, res) => {
        const sendMessages = normalizeAdminSendMessages({
            messages: req.body?.messages,
            recipients: req.body?.recipients,
            subject: req.body?.subject,
            message: req.body?.message,
            defaultEmailType: EMAIL_TYPES.ADMIN_MESSAGE
        });
        if (sendMessages.length === 0) {
            return res.status(400).json({ error: 'No email recipients provided.' });
        }
        if (sendMessages.length > 500) {
            return res.status(400).json({ error: 'Too many email recipients in one request.' });
        }

        try {
            const adminIdentifier = getAdminIdentifier(req);
            const requestMeta = getRequestMetadata(req);
            const emailTypes = toDistinctSanitizedStrings(
                sendMessages.map((item) => item.emailType || EMAIL_TYPES.ADMIN_MESSAGE),
                80
            );
            const subjects = toDistinctSanitizedStrings(
                sendMessages.map((item) => item.subject),
                300
            );
            const batchRunId = await startAuditBatchRun(pool, {
                batchType: buildEmailBatchType(emailTypes),
                scope: {
                    email_types: emailTypes,
                    subjects: subjects.slice(0, 10),
                    total_messages: sendMessages.length
                },
                expectedCount: sendMessages.length,
                initiatedBy: adminIdentifier,
                requestId: requestMeta.requestId
            });
            let sentCount = 0;
            const failedRecipients = [];
            const results = [];
            const counts = {
                sent: 0,
                warning: 0,
                blocked: 0,
                suppressed: 0,
                failed: 0,
                duplicate: 0
            };
            const seenEmails = new Set();

            await sendWithConcurrency(sendMessages, 10, async (item) => {
                const normalizedEmail = sanitizeText(item?.to?.email, 320).toLowerCase();
                if (normalizedEmail && seenEmails.has(normalizedEmail)) {
                    counts.duplicate += 1;
                    failedRecipients.push(buildFailedRecipient({
                        email: normalizedEmail,
                        name: item?.to?.name,
                        reason: 'Duplicate recipient in this batch.',
                        fallbackReason: 'Duplicate recipient in this batch.'
                    }));
                    results.push({
                        email: normalizedEmail,
                        name: item?.to?.name || undefined,
                        status: 'duplicate',
                        reason: 'Duplicate recipient in this batch.'
                    });
                    return;
                }
                if (normalizedEmail) {
                    seenEmails.add(normalizedEmail);
                }

                let trackedResult;
                try {
                    trackedResult = await sendManagedEmailMessage({
                        pool,
                        verifyEmail,
                        sendEmailMessage,
                        message: {
                            ...item,
                            batchRunId,
                            requestId: requestMeta.requestId,
                            html: item.html || buildPlainTextEmailHtml({ text: item.text })
                        }
                    });
                } catch (err) {
                    const unexpectedReason = normalizeEmailFailureReason(
                        err?.message,
                        'Unexpected email send failure.'
                    );
                    logWarn('Admin bulk email worker failed unexpectedly', {
                        email: normalizedEmail || 'invalid-email',
                        requestId: requestMeta.requestId,
                        batchRunId,
                        reason: unexpectedReason
                    });
                    trackedResult = {
                        success: false,
                        email: normalizedEmail || 'invalid-email',
                        name: item?.to?.name || undefined,
                        status: 'failed',
                        reason: unexpectedReason
                    };
                }
                results.push({
                    email: trackedResult.email,
                    name: trackedResult.name,
                    status: trackedResult.status,
                    reason: trackedResult.reason || undefined,
                    emailMessageId: trackedResult.emailMessageId || undefined,
                    providerEmailId: trackedResult.providerEmailId || undefined
                });

                if (trackedResult.success) {
                    sentCount += 1;
                    if (trackedResult.status === 'warning') {
                        counts.warning += 1;
                    } else {
                        counts.sent += 1;
                    }
                    return;
                }

                if (trackedResult.status === 'suppressed') {
                    counts.suppressed += 1;
                } else if (trackedResult.status === 'blocked') {
                    counts.blocked += 1;
                } else {
                    counts.failed += 1;
                }
                failedRecipients.push(buildFailedRecipient({
                    email: trackedResult.email,
                    name: trackedResult.name,
                    reason: trackedResult.reason,
                    fallbackReason: 'Email provider rejected this recipient.'
                }));
            });

            const completedAt = new Date().toISOString();
            const responsePayload = {
                success: failedRecipients.length === 0,
                attempted: sendMessages.length,
                sent: sentCount,
                failed: failedRecipients.length,
                counts,
                results,
                failedRecipients,
                completedAt
            };

            await finalizeAuditBatchRun(pool, batchRunId, {
                attemptedCount: sendMessages.length,
                succeededCount: sentCount,
                failedCount: failedRecipients.length,
                initiatedBy: adminIdentifier,
                requestId: requestMeta.requestId,
                scope: {
                    email_types: emailTypes,
                    subjects: subjects.slice(0, 10),
                    counts
                }
            });
            await recordAdminAuditAction(pool, {
                actionType: 'bulk_email_send',
                targetType: 'email_batch',
                targetId: batchRunId || buildEmailBatchType(emailTypes),
                adminIdentifier,
                requestId: requestMeta.requestId,
                before: {},
                after: {
                    batch_run_id: batchRunId,
                    email_types: emailTypes,
                    attempted: sendMessages.length,
                    sent: sentCount,
                    failed: failedRecipients.length,
                    counts
                },
                ip: requestMeta.ip,
                userAgent: requestMeta.userAgent
            });

            if (failedRecipients.length > 0) {
                logWarn('Admin bulk email completed with failures', {
                    attempted: sendMessages.length,
                    sent: sentCount,
                    failed: failedRecipients.length,
                    failedRecipients
                });
            } else {
                logInfo('Admin bulk email sent successfully', {
                    attempted: sendMessages.length,
                    sent: sentCount
                });
            }

            return res.json(responsePayload);
        } catch (err) {
            return sendServerError(res, err, 'Email send failed');
        }
    });
};

module.exports = {
    registerAdminRoutes
};
