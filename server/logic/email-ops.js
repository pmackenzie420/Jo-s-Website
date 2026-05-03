const { isValidEmail } = require('./checkout-utils');

const EMAIL_TYPES = Object.freeze({
    CONFIRMATION: 'confirmation',
    PICKUP_REMINDER: 'pickup_reminder',
    PICKUP_DATE_CHANGE: 'pickup_date_change',
    ADMIN_MESSAGE: 'admin_message'
});

const EMAIL_ACTIVITY_STALE_PENDING_MS = 10 * 60 * 1000;

const DEFAULT_SUPPRESSION_MESSAGE = {
    en: 'This email address is suppressed because previous deliveries bounced or were marked as spam. Please update it before continuing.',
    fr: "Cette adresse courriel est supprimée parce que des envois précédents ont rebondi ou ont été signalés comme indésirables. Veuillez la corriger avant de continuer."
};

const normalizeLanguage = (value) => {
    const normalized = String(value || '').trim().toLowerCase();
    return normalized.startsWith('fr') ? 'fr' : 'en';
};

const normalizeEmail = (value) => String(value || '').trim().toLowerCase();

const truncate = (value, maxLength = 500) => {
    const normalized = String(value || '').trim();
    if (!normalized) return '';
    return normalized.slice(0, maxLength);
};

const EMAIL_MESSAGE_JSON_COLUMNS = new Set(['tags', 'metadata', 'last_event_payload']);

const normalizeDateValue = (value) => {
    const normalized = String(value || '').trim();
    return /^\d{4}-\d{2}-\d{2}$/.test(normalized) ? normalized : null;
};

const sanitizeTagToken = (value, fallback) => {
    const normalized = String(value || '')
        .trim()
        .replace(/[^A-Za-z0-9_-]+/g, '_')
        .replace(/^_+|_+$/g, '')
        .slice(0, 256);
    return normalized || fallback;
};

const normalizeTags = (tags) => {
    if (!Array.isArray(tags)) return [];
    const seen = new Set();
    const normalized = [];
    for (const tag of tags) {
        const name = sanitizeTagToken(tag?.name, '');
        const value = sanitizeTagToken(tag?.value, '');
        if (!name || !value) continue;
        const key = `${name}:${value}`;
        if (seen.has(key)) continue;
        seen.add(key);
        normalized.push({ name, value });
    }
    return normalized;
};

const extractTagsFromWebhookPayload = (value) => {
    if (Array.isArray(value)) {
        return normalizeTags(value);
    }
    if (value && typeof value === 'object') {
        return normalizeTags(
            Object.entries(value).map(([name, tagValue]) => ({
                name,
                value: tagValue
            }))
        );
    }
    return [];
};

const toJsonObject = (value, fallback = {}) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return fallback;
    }
    return value;
};

const toJsonArray = (value) => (Array.isArray(value) ? value : []);

const toDistinctOrderIds = (orderIds) => (
    Array.from(
        new Set(
            (Array.isArray(orderIds) ? orderIds : [])
                .map((id) => String(id || '').trim())
                .filter(Boolean)
        )
    )
);

const nowIso = () => new Date().toISOString();

const parseTimestampValue = (value) => {
    if (!value) return null;
    if (value instanceof Date) {
        return Number.isNaN(value.getTime()) ? null : value;
    }
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const buildSuppressionMessage = (reason, language) => (
    truncate(reason, 500)
    || DEFAULT_SUPPRESSION_MESSAGE[normalizeLanguage(language)]
);

const inferSuppressionFromErrorMessage = (value) => {
    const normalized = String(value || '').trim();
    if (!normalized) return null;
    if (/suppression list|suppressed|marked as spam|spam complaint/i.test(normalized)) {
        return {
            reasonType: 'suppressed',
            reason: truncate(normalized, 500)
        };
    }
    return null;
};

const updateEmailMessage = async (pool, emailMessageId, changes) => {
    const entries = Object.entries(changes).filter(([, value]) => value !== undefined);
    if (!emailMessageId || entries.length === 0) {
        return null;
    }

    const setSql = entries
        .map(([column], index) => `${column} = $${index + 2}`)
        .join(', ');
    const params = [
        emailMessageId,
        ...entries.map(([column, value]) => {
            if (value === null || !EMAIL_MESSAGE_JSON_COLUMNS.has(column)) {
                return value;
            }
            return JSON.stringify(value);
        })
    ];
    const result = await pool.query(
        `UPDATE email_messages SET ${setSql} WHERE id = $1 RETURNING *`,
        params
    );
    return result.rows[0] || null;
};

const createEmailMessage = async (pool, payload) => {
    const result = await pool.query(
        `
        INSERT INTO email_messages (
            email_type,
            provider,
            normalized_email,
            to_email,
            to_name,
            subject,
            verification_status,
            send_status,
            last_error,
            batch_key,
            batch_run_id,
            request_id,
            pickup_date,
            pickup_location,
            initiated_by,
            idempotency_key,
            tags,
            metadata,
            last_event_type,
            last_event_at
        )
        VALUES (
            $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17::jsonb, $18::jsonb, $19, $20
        )
        RETURNING *
        `,
        [
            payload.emailType,
            payload.provider || 'resend',
            payload.normalizedEmail,
            payload.toEmail,
            payload.toName || null,
            payload.subject,
            payload.verificationStatus || 'unchecked',
            payload.sendStatus || 'pending',
            payload.lastError || null,
            payload.batchKey || null,
            payload.batchRunId || null,
            payload.requestId || null,
            payload.pickupDate || null,
            payload.pickupLocation || null,
            payload.initiatedBy || 'system',
            payload.idempotencyKey || null,
            JSON.stringify(toJsonArray(payload.tags)),
            JSON.stringify(toJsonObject(payload.metadata)),
            payload.lastEventType || null,
            payload.lastEventAt || null
        ]
    );
    return result.rows[0] || null;
};

const attachEmailMessageOrders = async (pool, emailMessageId, orderIds) => {
    const normalizedOrderIds = toDistinctOrderIds(orderIds);
    if (!emailMessageId || normalizedOrderIds.length === 0) {
        return;
    }
    for (const orderId of normalizedOrderIds) {
        await pool.query(
            `
            INSERT INTO email_message_orders (email_message_id, order_id)
            VALUES ($1, $2)
            ON CONFLICT (email_message_id, order_id) DO NOTHING
            `,
            [emailMessageId, orderId]
        );
    }
};

const getActiveSuppression = async (pool, normalizedEmail) => {
    if (!pool || !normalizedEmail) return null;
    const result = await pool.query(
        `
        SELECT normalized_email, reason_type, reason, provider_email_id, first_seen_at, last_seen_at
        FROM email_suppressions
        WHERE normalized_email = $1
          AND active = true
        LIMIT 1
        `,
        [normalizedEmail]
    );
    return result.rows[0] || null;
};

const upsertEmailSuppression = async (pool, payload) => {
    const normalizedEmail = normalizeEmail(payload?.normalizedEmail);
    if (!normalizedEmail) return null;
    const now = payload?.seenAt || nowIso();
    const result = await pool.query(
        `
        INSERT INTO email_suppressions (
            normalized_email,
            reason_type,
            reason,
            provider_email_id,
            email_message_id,
            active,
            first_seen_at,
            last_seen_at
        )
        VALUES ($1, $2, $3, $4, $5, true, $6, $6)
        ON CONFLICT (normalized_email) DO UPDATE
        SET reason_type = COALESCE(EXCLUDED.reason_type, email_suppressions.reason_type),
            reason = COALESCE(EXCLUDED.reason, email_suppressions.reason),
            provider_email_id = COALESCE(EXCLUDED.provider_email_id, email_suppressions.provider_email_id),
            email_message_id = COALESCE(EXCLUDED.email_message_id, email_suppressions.email_message_id),
            active = true,
            lifted_at = NULL,
            last_seen_at = EXCLUDED.last_seen_at
        RETURNING *
        `,
        [
            normalizedEmail,
            payload?.reasonType || 'suppressed',
            truncate(payload?.reason, 500) || null,
            truncate(payload?.providerEmailId, 200) || null,
            payload?.emailMessageId || null,
            now
        ]
    );
    return result.rows[0] || null;
};

const verifyManagedEmailAddress = async ({
    pool,
    email,
    language = 'en',
    verifyEmail
}) => {
    const locale = normalizeLanguage(language);
    const normalizedEmail = normalizeEmail(email);

    if (!isValidEmail(normalizedEmail)) {
        return {
            normalizedEmail,
            status: 'invalid',
            shouldBlock: true,
            message: locale === 'fr' ? 'Adresse courriel invalide.' : 'Invalid email address.'
        };
    }

    const activeSuppression = await getActiveSuppression(pool, normalizedEmail);
    if (activeSuppression) {
        return {
            normalizedEmail,
            status: 'suppressed',
            shouldBlock: true,
            message: buildSuppressionMessage(activeSuppression.reason, locale),
            suppression: activeSuppression
        };
    }

    if (typeof verifyEmail !== 'function') {
        return {
            normalizedEmail,
            status: 'valid',
            shouldBlock: false,
            message: ''
        };
    }

    const verification = await verifyEmail(normalizedEmail, { language: locale });
    return {
        normalizedEmail: normalizeEmail(verification?.normalizedEmail || normalizedEmail),
        status: String(verification?.status || (verification?.shouldBlock ? 'invalid' : 'valid')).trim().toLowerCase() || 'valid',
        shouldBlock: Boolean(verification?.shouldBlock),
        message: truncate(verification?.message, 500),
        reason: truncate(verification?.reason, 200),
        suggestion: verification?.suggestion || null,
        verification
    };
};

const previewTrackedEmailMessage = async ({
    pool,
    verifyEmail,
    message
}) => {
    const normalizedEmail = normalizeEmail(message?.to?.email);
    const toName = truncate(message?.to?.name, 120);
    const subject = truncate(message?.subject, 300);
    const hasContent = Boolean(
        truncate(message?.text, 20000)
        || truncate(message?.html, 20000)
        || (Array.isArray(message?.attachments) && message.attachments.length > 0)
        || message?.csv
    );

    if (!normalizedEmail || !isValidEmail(normalizedEmail)) {
        return {
            email: normalizedEmail || 'invalid-email',
            name: toName || undefined,
            status: 'blocked',
            reason: 'Invalid email address.'
        };
    }

    if (!subject || !hasContent) {
        return {
            email: normalizedEmail,
            name: toName || undefined,
            status: 'blocked',
            reason: 'Email content was empty.'
        };
    }

    const assessment = await verifyManagedEmailAddress({
        pool,
        email: normalizedEmail,
        language: message?.language || 'en',
        verifyEmail
    });

    return {
        email: normalizedEmail,
        name: toName || undefined,
        status: assessment.shouldBlock
            ? (assessment.status === 'suppressed' ? 'suppressed' : 'blocked')
            : (assessment.status === 'warning' ? 'warning' : 'ready'),
        reason: truncate(assessment.message, 500) || undefined,
        verificationStatus: assessment.status
    };
};

const sendTrackedEmailMessage = async ({
    pool,
    verifyEmail,
    sendEmailMessage,
    message
}) => {
    const normalizedEmail = normalizeEmail(message?.to?.email);
    const toName = truncate(message?.to?.name, 120);
    const subject = truncate(message?.subject, 300);
    const normalizedText = truncate(message?.text, 20000);
    const normalizedHtml = truncate(message?.html, 500000);
    const orderIds = toDistinctOrderIds(message?.orderIds);
    const emailType = sanitizeTagToken(message?.emailType, EMAIL_TYPES.ADMIN_MESSAGE);
    const batchKey = truncate(message?.batchKey, 200);
    const batchRunId = truncate(message?.batchRunId, 200);
    const requestId = truncate(message?.requestId, 200);
    const pickupDate = normalizeDateValue(message?.pickupDate);
    const pickupLocation = truncate(message?.pickupLocation, 80);
    const initiatedBy = truncate(message?.initiatedBy, 80) || 'system';
    const hasContent = Boolean(
        normalizedText
        || normalizedHtml
        || (Array.isArray(message?.attachments) && message.attachments.length > 0)
        || message?.csv
    );
    const metadata = toJsonObject({
        ...toJsonObject(message?.metadata),
        order_ids: orderIds,
        batch_key: batchKey || null,
        pickup_date: pickupDate,
        pickup_location: pickupLocation || null
    });
    const markUnexpectedFailure = async (reason, eventType = 'email.failed') => {
        const failureAt = nowIso();
        await updateEmailMessage(pool, initialRecord.id, {
            send_status: 'failed',
            verification_status: 'error',
            last_error: truncate(reason, 500) || 'Email send failed before provider delivery.',
            failed_at: failureAt,
            last_event_type: eventType,
            last_event_at: failureAt
        });
        return {
            success: false,
            emailMessageId: initialRecord.id,
            email: normalizedEmail || 'invalid-email',
            name: toName || undefined,
            status: 'failed',
            reason: truncate(reason, 500) || 'Email send failed before provider delivery.',
            verificationStatus: 'error'
        };
    };
    const initialRecord = await createEmailMessage(pool, {
        emailType,
        normalizedEmail: normalizedEmail || 'invalid-email',
        toEmail: truncate(message?.to?.email, 320) || normalizedEmail || 'invalid-email',
        toName,
        subject: subject || '(missing subject)',
        verificationStatus: 'unchecked',
        sendStatus: 'pending',
        lastError: null,
        batchKey,
        batchRunId,
        requestId,
        pickupDate,
        pickupLocation,
        initiatedBy,
        idempotencyKey: truncate(message?.idempotencyKey, 200) || null,
        tags: normalizeTags(message?.tags),
        metadata,
        lastEventType: 'pending',
        lastEventAt: nowIso()
    });
    try {
        await attachEmailMessageOrders(pool, initialRecord?.id, orderIds);
    } catch (err) {
        return markUnexpectedFailure(
            err?.message || 'Failed to link email message to order records.',
            'email.tracking_failed'
        );
    }

    if (!normalizedEmail || !isValidEmail(normalizedEmail)) {
        await updateEmailMessage(pool, initialRecord.id, {
            send_status: 'blocked',
            verification_status: 'invalid',
            last_error: 'Invalid email address.',
            failed_at: nowIso(),
            last_event_type: 'blocked',
            last_event_at: nowIso()
        });
        return {
            success: false,
            emailMessageId: initialRecord.id,
            email: normalizedEmail || 'invalid-email',
            name: toName || undefined,
            status: 'blocked',
            reason: 'Invalid email address.'
        };
    }

    if (!subject || !hasContent) {
        await updateEmailMessage(pool, initialRecord.id, {
            send_status: 'blocked',
            verification_status: 'invalid',
            last_error: 'Email content was empty.',
            failed_at: nowIso(),
            last_event_type: 'blocked',
            last_event_at: nowIso()
        });
        return {
            success: false,
            emailMessageId: initialRecord.id,
            email: normalizedEmail,
            name: toName || undefined,
            status: 'blocked',
            reason: 'Email content was empty.'
        };
    }

    let assessment;
    try {
        assessment = await verifyManagedEmailAddress({
            pool,
            email: normalizedEmail,
            language: message?.language || 'en',
            verifyEmail
        });
    } catch (err) {
        return markUnexpectedFailure(
            err?.message
                ? `Email verification failed before sending: ${err.message}`
                : 'Email verification failed before sending.',
            'email.verification_failed'
        );
    }

    if (assessment.shouldBlock) {
        const blockedStatus = assessment.status === 'suppressed' ? 'suppressed' : 'blocked';
        await updateEmailMessage(pool, initialRecord.id, {
            send_status: blockedStatus,
            verification_status: assessment.status,
            last_error: assessment.message || null,
            failed_at: blockedStatus === 'blocked' ? nowIso() : null,
            suppressed_at: blockedStatus === 'suppressed' ? nowIso() : null,
            last_event_type: blockedStatus,
            last_event_at: nowIso(),
            metadata: {
                ...metadata,
                verification_reason: assessment.reason || null,
                verification_suggestion: assessment.suggestion || null
            }
        });
        if (blockedStatus === 'suppressed') {
            await upsertEmailSuppression(pool, {
                normalizedEmail,
                reasonType: 'suppressed',
                reason: assessment.message,
                emailMessageId: initialRecord.id,
                seenAt: nowIso()
            });
        }
        return {
            success: false,
            emailMessageId: initialRecord.id,
            email: normalizedEmail,
            name: toName || undefined,
            status: blockedStatus,
            reason: assessment.message || undefined,
            verificationStatus: assessment.status
        };
    }

    const normalizedTags = normalizeTags([
        ...(Array.isArray(message?.tags) ? message.tags : []),
        { name: 'category', value: emailType },
        { name: 'message_id', value: sanitizeTagToken(initialRecord.id, 'message') },
        ...(batchKey ? [{ name: 'batch_key', value: sanitizeTagToken(batchKey, 'batch') }] : [])
    ]);
    const idempotencyKey = truncate(
        message?.idempotencyKey,
        200
    ) || `email-${initialRecord.id}`;

    try {
        const providerResponse = await sendEmailMessage({
            to: {
                email: normalizedEmail,
                name: toName || undefined
            },
            subject,
            text: normalizedText,
            html: normalizedHtml,
            attachments: Array.isArray(message?.attachments) ? message.attachments : undefined,
            csv: message?.csv,
            filename: message?.filename,
            from: message?.from,
            replyTo: message?.replyTo,
            headers: message?.headers,
            tags: normalizedTags,
            idempotencyKey
        });
        const sentAt = nowIso();
        await updateEmailMessage(pool, initialRecord.id, {
            provider_email_id: truncate(providerResponse?.id, 200) || null,
            send_status: 'sent',
            verification_status: assessment.status,
            idempotency_key: idempotencyKey,
            tags: normalizedTags,
            metadata: {
                ...metadata,
                verification_reason: assessment.reason || null,
                verification_suggestion: assessment.suggestion || null
            },
            sent_at: sentAt,
            last_error: assessment.status === 'warning' ? assessment.message || null : null,
            last_event_type: 'email.sent',
            last_event_at: sentAt
        });
        return {
            success: true,
            emailMessageId: initialRecord.id,
            providerEmailId: truncate(providerResponse?.id, 200) || null,
            email: normalizedEmail,
            name: toName || undefined,
            status: assessment.status === 'warning' ? 'warning' : 'sent',
            reason: assessment.status === 'warning' ? assessment.message || undefined : undefined,
            verificationStatus: assessment.status
        };
    } catch (err) {
        const reason = truncate(err?.message || 'Email send failed.', 500);
        const inferredSuppression = inferSuppressionFromErrorMessage(reason);
        const failedStatus = inferredSuppression ? 'suppressed' : 'failed';
        const failureAt = nowIso();
        await updateEmailMessage(pool, initialRecord.id, {
            send_status: failedStatus,
            verification_status: assessment.status,
            idempotency_key: idempotencyKey,
            tags: normalizedTags,
            metadata: {
                ...metadata,
                verification_reason: assessment.reason || null,
                verification_suggestion: assessment.suggestion || null
            },
            last_error: reason,
            failed_at: failedStatus === 'failed' ? failureAt : null,
            suppressed_at: failedStatus === 'suppressed' ? failureAt : null,
            last_event_type: failedStatus === 'suppressed' ? 'email.suppressed' : 'email.failed',
            last_event_at: failureAt
        });
        if (inferredSuppression) {
            await upsertEmailSuppression(pool, {
                normalizedEmail,
                reasonType: inferredSuppression.reasonType,
                reason: inferredSuppression.reason,
                emailMessageId: initialRecord.id,
                seenAt: failureAt
            });
        }
        return {
            success: false,
            emailMessageId: initialRecord.id,
            email: normalizedEmail,
            name: toName || undefined,
            status: failedStatus,
            reason,
            verificationStatus: assessment.status
        };
    }
};

const extractWebhookReason = (eventType, data) => {
    if (eventType === 'email.bounced') {
        return truncate(data?.bounce?.message, 500) || 'Email bounced.';
    }
    if (eventType === 'email.suppressed') {
        return truncate(data?.suppressed?.message, 500) || 'Email was suppressed by the provider.';
    }
    if (eventType === 'email.failed') {
        return truncate(data?.failed?.reason, 500) || 'Email failed to send.';
    }
    if (eventType === 'email.complained') {
        return 'Recipient marked this email as spam.';
    }
    if (eventType === 'email.delivery_delayed') {
        return truncate(data?.delivery_delayed?.message, 500) || 'Email delivery was delayed.';
    }
    return '';
};

const extractMessageIdTag = (tags) => {
    const normalizedTags = extractTagsFromWebhookPayload(tags);
    const messageTag = normalizedTags.find((tag) => tag.name === 'message_id');
    return messageTag?.value || '';
};

const findTrackedEmailMessage = async (pool, providerEmailId, webhookPayload) => {
    const normalizedProviderId = truncate(providerEmailId, 200);
    if (normalizedProviderId) {
        const providerResult = await pool.query(
            'SELECT id FROM email_messages WHERE provider_email_id = $1 LIMIT 1',
            [normalizedProviderId]
        );
        if (providerResult.rows[0]?.id) {
            return providerResult.rows[0].id;
        }
    }

    const messageIdTag = extractMessageIdTag(webhookPayload?.data?.tags);
    if (!messageIdTag) return '';

    const tagResult = await pool.query(
        'SELECT id FROM email_messages WHERE id::text = $1 LIMIT 1',
        [messageIdTag]
    );
    return tagResult.rows[0]?.id || '';
};

const recordEmailWebhookEvent = async ({
    pool,
    webhookEventId,
    eventType,
    providerEmailId,
    normalizedEmail,
    payload
}) => {
    const result = await pool.query(
        `
        INSERT INTO email_webhook_events (
            webhook_event_id,
            provider,
            event_type,
            provider_email_id,
            normalized_email,
            payload
        )
        VALUES ($1, 'resend', $2, $3, $4, $5::jsonb)
        ON CONFLICT (webhook_event_id) DO NOTHING
        RETURNING id
        `,
        [
            truncate(webhookEventId, 200),
            truncate(eventType, 80),
            truncate(providerEmailId, 200) || null,
            normalizeEmail(normalizedEmail) || null,
            JSON.stringify(payload || {})
        ]
    );
    return result.rows[0]?.id || null;
};

const applyEmailWebhookEvent = async ({
    pool,
    webhookEventId,
    payload
}) => {
    const eventType = truncate(payload?.type, 80);
    const data = toJsonObject(payload?.data);
    const providerEmailId = truncate(data?.email_id, 200);
    const normalizedEmail = normalizeEmail(Array.isArray(data?.to) ? data.to[0] : '');
    const recordedEventId = await recordEmailWebhookEvent({
        pool,
        webhookEventId,
        eventType,
        providerEmailId,
        normalizedEmail,
        payload
    });
    if (!recordedEventId) {
        return { duplicate: true };
    }

    const emailMessageId = await findTrackedEmailMessage(pool, providerEmailId, payload);
    if (!emailMessageId) {
        return {
            duplicate: false,
            matched: false,
            eventType,
            providerEmailId,
            email: normalizedEmail || null
        };
    }

    const eventTimestamp = truncate(payload?.created_at, 80) || nowIso();
    const reason = extractWebhookReason(eventType, data);
    const nextStatus = (() => {
        if (eventType === 'email.delivered') return 'delivered';
        if (eventType === 'email.bounced') return 'bounced';
        if (eventType === 'email.complained') return 'complained';
        if (eventType === 'email.suppressed') return 'suppressed';
        if (eventType === 'email.failed') return 'failed';
        if (eventType === 'email.sent') return 'sent';
        return undefined;
    })();

    const changes = {
        provider_email_id: providerEmailId || null,
        last_event_type: eventType,
        last_event_at: eventTimestamp,
        last_event_payload: payload
    };
    if (reason) {
        changes.last_error = reason;
    }
    if (nextStatus) {
        changes.send_status = nextStatus;
    }
    if (eventType === 'email.sent') {
        changes.sent_at = eventTimestamp;
    }
    if (eventType === 'email.delivered') {
        changes.delivered_at = eventTimestamp;
        changes.last_error = null;
    }
    if (eventType === 'email.failed') {
        changes.failed_at = eventTimestamp;
    }
    if (eventType === 'email.bounced') {
        changes.bounced_at = eventTimestamp;
    }
    if (eventType === 'email.complained') {
        changes.complained_at = eventTimestamp;
    }
    if (eventType === 'email.suppressed') {
        changes.suppressed_at = eventTimestamp;
    }
    await updateEmailMessage(pool, emailMessageId, changes);

    if (['email.bounced', 'email.complained', 'email.suppressed'].includes(eventType) && normalizedEmail) {
        await upsertEmailSuppression(pool, {
            normalizedEmail,
            reasonType: eventType.replace(/^email\./, ''),
            reason,
            providerEmailId,
            emailMessageId,
            seenAt: eventTimestamp
        });
    }

    return {
        duplicate: false,
        matched: true,
        eventType,
        providerEmailId,
        email: normalizedEmail || null,
        emailMessageId
    };
};

const listEmailActivity = async ({
    pool,
    limit = 200,
    query = '',
    status = '',
    emailType = '',
    now = new Date(),
    stalePendingMs = EMAIL_ACTIVITY_STALE_PENDING_MS
}) => {
    const params = [];
    const where = [];
    const normalizedQuery = truncate(query, 120);
    const normalizedStatus = truncate(status, 80).toLowerCase();
    const normalizedEmailType = sanitizeTagToken(emailType, '').toLowerCase();
    const nowValue = parseTimestampValue(now) || new Date();
    const staleThresholdMs = Math.max(Number(stalePendingMs) || 0, 0);
    const stalePendingCutoff = new Date(nowValue.getTime() - staleThresholdMs);

    if (normalizedQuery) {
        params.push(`%${normalizedQuery.toLowerCase()}%`);
        const searchParam = `$${params.length}`;
        where.push(
            `
            (
                LOWER(em.normalized_email) LIKE ${searchParam}
                OR LOWER(COALESCE(em.to_name, '')) LIKE ${searchParam}
                OR LOWER(COALESCE(em.subject, '')) LIKE ${searchParam}
                OR LOWER(COALESCE(em.batch_run_id, '')) LIKE ${searchParam}
                OR LOWER(COALESCE(em.request_id, '')) LIKE ${searchParam}
                OR EXISTS (
                    SELECT 1
                    FROM email_message_orders emo_q
                    INNER JOIN orders orders_q
                        ON orders_q.id = emo_q.order_id
                    WHERE emo_q.email_message_id = em.id
                      AND LOWER(COALESCE(orders_q.order_number::text, '')) LIKE ${searchParam}
                )
            )
            `
        );
    }

    if (normalizedStatus) {
        if (normalizedStatus === 'stale_pending') {
            params.push(stalePendingCutoff);
            where.push(
                `
                LOWER(COALESCE(em.send_status, '')) = 'pending'
                AND COALESCE(em.last_event_at, em.created_at) <= $${params.length}
                `
            );
        } else {
            params.push(normalizedStatus);
            where.push(`LOWER(COALESCE(em.send_status, '')) = $${params.length}`);
        }
    }

    if (normalizedEmailType) {
        params.push(normalizedEmailType);
        where.push(`LOWER(COALESCE(em.email_type, '')) = $${params.length}`);
    }

    params.push(Math.min(Math.max(Number(limit) || 200, 1), 500));
    const limitParam = `$${params.length}`;

    const result = await pool.query(
        `
        SELECT
            em.*,
            COALESCE(
                jsonb_agg(DISTINCT emo.order_id) FILTER (WHERE emo.order_id IS NOT NULL),
                '[]'::jsonb
            ) AS order_ids,
            COALESCE(
                jsonb_agg(DISTINCT orders.order_number) FILTER (WHERE orders.order_number IS NOT NULL),
                '[]'::jsonb
            ) AS order_numbers
        FROM email_messages em
        LEFT JOIN email_message_orders emo
            ON emo.email_message_id = em.id
        LEFT JOIN orders
            ON orders.id = emo.order_id
        ${where.length > 0 ? `WHERE ${where.join(' AND ')}` : ''}
        GROUP BY em.id
        ORDER BY COALESCE(em.last_event_at, em.created_at) DESC, em.created_at DESC
        LIMIT ${limitParam}
        `,
        params
    );

    return result.rows.map((row) => {
        const activityAt = parseTimestampValue(row.last_event_at) || parseTimestampValue(row.created_at);
        const ageMs = activityAt ? Math.max(nowValue.getTime() - activityAt.getTime(), 0) : 0;
        const isPending = String(row.send_status || '').trim().toLowerCase() === 'pending';
        const isStalePending = isPending && ageMs >= staleThresholdMs;

        return {
            id: row.id,
            emailType: row.email_type,
            sendStatus: row.send_status,
            displayStatus: isStalePending ? 'stale_pending' : row.send_status,
            verificationStatus: row.verification_status,
            toEmail: row.to_email,
            toName: row.to_name,
            subject: row.subject,
            createdAt: row.created_at,
            sentAt: row.sent_at,
            deliveredAt: row.delivered_at,
            failedAt: row.failed_at,
            bouncedAt: row.bounced_at,
            complainedAt: row.complained_at,
            suppressedAt: row.suppressed_at,
            lastEventAt: row.last_event_at,
            lastEventType: row.last_event_type,
            lastError: row.last_error,
            pickupDate: row.pickup_date,
            pickupLocation: row.pickup_location,
            batchKey: row.batch_key,
            batchRunId: row.batch_run_id,
            requestId: row.request_id,
            initiatedBy: row.initiated_by,
            isStalePending,
            stalePendingMinutes: isStalePending ? Math.max(1, Math.round(ageMs / 60000)) : 0,
            orderIds: toJsonArray(row.order_ids),
            orderNumbers: toJsonArray(row.order_numbers)
                .map((value) => Number(value))
                .filter((value) => Number.isFinite(value) && value > 0)
        };
    });
};

const ensureEmailOpsSchema = async (pool) => {
    await pool.query(`
        CREATE TABLE IF NOT EXISTS email_messages (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            email_type TEXT NOT NULL,
            provider TEXT NOT NULL DEFAULT 'resend',
            provider_email_id TEXT UNIQUE,
            normalized_email TEXT NOT NULL,
            to_email TEXT NOT NULL,
            to_name TEXT,
            subject TEXT NOT NULL,
            verification_status TEXT NOT NULL DEFAULT 'unchecked',
            send_status TEXT NOT NULL DEFAULT 'pending',
            last_error TEXT,
            batch_key TEXT,
            batch_run_id TEXT,
            request_id TEXT,
            pickup_date DATE,
            pickup_location TEXT,
            initiated_by TEXT NOT NULL DEFAULT 'system',
            idempotency_key TEXT,
            tags JSONB NOT NULL DEFAULT '[]'::jsonb,
            metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
            sent_at TIMESTAMP WITH TIME ZONE,
            delivered_at TIMESTAMP WITH TIME ZONE,
            failed_at TIMESTAMP WITH TIME ZONE,
            bounced_at TIMESTAMP WITH TIME ZONE,
            complained_at TIMESTAMP WITH TIME ZONE,
            suppressed_at TIMESTAMP WITH TIME ZONE,
            last_event_type TEXT,
            last_event_at TIMESTAMP WITH TIME ZONE,
            last_event_payload JSONB,
            created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
    `);

    await pool.query(`
        ALTER TABLE email_messages
        ADD COLUMN IF NOT EXISTS batch_run_id TEXT;
    `);
    await pool.query(`
        ALTER TABLE email_messages
        ADD COLUMN IF NOT EXISTS request_id TEXT;
    `);

    await pool.query(`
        CREATE TABLE IF NOT EXISTS email_message_orders (
            email_message_id UUID NOT NULL REFERENCES email_messages(id) ON DELETE CASCADE,
            order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
            created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (email_message_id, order_id)
        );
    `);

    await pool.query(`
        CREATE TABLE IF NOT EXISTS email_suppressions (
            normalized_email TEXT PRIMARY KEY,
            reason_type TEXT,
            reason TEXT,
            provider_email_id TEXT,
            email_message_id UUID REFERENCES email_messages(id) ON DELETE SET NULL,
            active BOOLEAN NOT NULL DEFAULT true,
            first_seen_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
            last_seen_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
            lifted_at TIMESTAMP WITH TIME ZONE
        );
    `);

    await pool.query(`
        CREATE TABLE IF NOT EXISTS email_webhook_events (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            webhook_event_id TEXT NOT NULL UNIQUE,
            provider TEXT NOT NULL DEFAULT 'resend',
            event_type TEXT NOT NULL,
            provider_email_id TEXT,
            normalized_email TEXT,
            payload JSONB NOT NULL,
            received_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
    `);

    await pool.query(`
        CREATE INDEX IF NOT EXISTS email_messages_normalized_email_created_at_idx
        ON email_messages (normalized_email, created_at DESC);
    `);
    await pool.query(`
        CREATE INDEX IF NOT EXISTS email_messages_type_created_at_idx
        ON email_messages (email_type, created_at DESC);
    `);
    await pool.query(`
        CREATE INDEX IF NOT EXISTS email_messages_status_created_at_idx
        ON email_messages (send_status, created_at DESC);
    `);
    await pool.query(`
        CREATE INDEX IF NOT EXISTS email_messages_batch_run_id_created_at_idx
        ON email_messages (batch_run_id, created_at DESC);
    `);
    await pool.query(`
        CREATE INDEX IF NOT EXISTS email_messages_request_id_created_at_idx
        ON email_messages (request_id, created_at DESC);
    `);
    await pool.query(`
        CREATE INDEX IF NOT EXISTS email_message_orders_order_id_idx
        ON email_message_orders (order_id, email_message_id);
    `);
    await pool.query(`
        CREATE INDEX IF NOT EXISTS email_suppressions_active_idx
        ON email_suppressions (active, normalized_email);
    `);
    await pool.query(`
        CREATE INDEX IF NOT EXISTS email_webhook_events_provider_email_id_idx
        ON email_webhook_events (provider_email_id, received_at DESC);
    `);
};

module.exports = {
    EMAIL_TYPES,
    applyEmailWebhookEvent,
    ensureEmailOpsSchema,
    listEmailActivity,
    previewTrackedEmailMessage,
    sendTrackedEmailMessage,
    verifyManagedEmailAddress
};
