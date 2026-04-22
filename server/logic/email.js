const pool = require('../db');
const { 
    ORDER_CONFIRMATION_COPY, 
    PAID_STATUSES, 
    LOCATION_DETAILS, 
    COMPANY_CONTACT 
} = require('../config/constants');
const {
    normalizeLanguage,
    formatPickupDateLong,
    formatCurrency,
    escapeHtml,
    extractEmailAddress
} = require('../utils/helpers');
const { buildBrandedEmailHtml, BRAND_COLOR } = require('../utils/email-template');
const { getPaymentDetails, getOrderSummary, isLambName } = require('./pricing');
const { verifyCheckoutEmail } = require('./email-verification');
const { EMAIL_TYPES, sendTrackedEmailMessage } = require('./email-ops');
const { recordOrderEvent } = require('./audit-ops');

const RESEND_API_KEY = process.env.RESEND_API_KEY;
const EMAIL_FROM = process.env.EMAIL_FROM;
const EMAIL_FROM_NAME = process.env.EMAIL_FROM_NAME || 'Les Fermes Soulard';
const getDefaultNoReplyAddress = () => {
    const fromAddress = extractEmailAddress(EMAIL_FROM);
    const atIndex = fromAddress.lastIndexOf('@');
    if (atIndex <= 0 || atIndex === fromAddress.length - 1) return '';
    const domain = fromAddress.slice(atIndex + 1).trim().toLowerCase();
    if (!domain) return '';
    return `no-reply@${domain}`;
};
const EMAIL_REPLY_TO = process.env.EMAIL_REPLY_TO || '';
const CONFIRMATION_EMAIL_REPLY_TO = String(
    process.env.CONFIRMATION_EMAIL_REPLY_TO
    || EMAIL_REPLY_TO
    || getDefaultNoReplyAddress()
).trim();
const CONFIRMATION_EMAIL_FROM = String(
    process.env.CONFIRMATION_EMAIL_FROM
    || getDefaultNoReplyAddress()
    || EMAIL_FROM
).trim();
const SIMPLE_EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const CONFIRMATION_NO_REPLY_HEADERS = {
    'Auto-Submitted': 'auto-generated',
    'X-Auto-Response-Suppress': 'All',
    Precedence: 'bulk'
};

const getPublicOrderReference = (order) => {
    const orderNumberRaw = Number(order?.order_number);
    if (Number.isFinite(orderNumberRaw) && orderNumberRaw > 0) {
        return String(Math.floor(orderNumberRaw));
    }
    return String(order?.id || '').trim();
};

const buildOrderConfirmationEmailText = ({ order, items }) => {
    const language = normalizeLanguage(order.language);
    const copy = ORDER_CONFIRMATION_COPY[language];
    const customerName = order.customer_name || 'there';
    const pickupDate = formatPickupDateLong(order.pickup_date, language);
    const locationKey = order.pickup_location;
    const locationDetails = locationKey ? LOCATION_DETAILS[locationKey] : null;
    const locationLabel = locationDetails?.label || locationKey || '';
    const locationAddress = locationDetails?.address || '';
    const footerAddress = LOCATION_DETAILS.bristol?.address || COMPANY_CONTACT.address;
    const total = formatCurrency(order.total_cents);
    const paymentDetails = getPaymentDetails(order);
    const hasLambs = items.some(item => isLambName(item.name));
    
    const paidLabel = (paymentDetails.paymentType === 'deposit' || hasLambs) ? copy.depositPaid : copy.paidInFull;
    const paidAmount = formatCurrency(paymentDetails.paidCents);
    
    let dueAmount = paymentDetails.dueCents > 0 ? formatCurrency(paymentDetails.dueCents) : '';
    if (hasLambs) {
        dueAmount = language === 'fr' ? 'À déterminer (selon le poids)' : 'To be determined (based on weight)';
    }

    const lines = [copy.greeting(customerName), '', copy.thankYou];

    if (pickupDate || locationLabel || locationAddress) {
        lines.push('', copy.pickupTitleText);
        if (pickupDate) {
            lines.push(`${copy.dateLabel}: ${pickupDate}`);
        }
        if (locationLabel) {
            lines.push(`${copy.locationLabel}: ${locationLabel}`);
        }
        if (locationAddress) {
            lines.push(`${copy.addressLabel}: ${locationAddress}`);
        }
    }

    lines.push('', copy.reminderTitle, copy.reminderLineOne, copy.reminderLineTwo);

    lines.push('', copy.orderTitleText);
    if (items.length > 0) {
        for (const item of items) {
            const displayName = String(item.name || 'Item').split(' / ')[0];
            const lineTotal = formatCurrency(item.line_cents);
            const quantity = Number(item.quantity ?? 0);
            const line = lineTotal
                ? `- ${quantity} ${displayName} - ${lineTotal}`
                : `- ${quantity} ${displayName}`;
            lines.push(line);
        }
    } else {
        lines.push(`- ${copy.itemsUnavailable}`);
    }

    lines.push('');

    if (total) {
        lines.push(`Total: ${total}`);
    }

    lines.push('', copy.paymentTitleText);
    lines.push(`${copy.statusLabel}: ${paidLabel}`);
    if (paidAmount) {
        lines.push(`${copy.paidTodayLabel}: ${paidAmount}`);
    }
    if (dueAmount) {
        lines.push(`${copy.dueLabel}: ${dueAmount}`);
    }
    lines.push('');

    const orderRef = getPublicOrderReference(order);
    lines.push(
        `${copy.orderIdLabel}: ${orderRef}`,
        '',
        copy.questions(COMPANY_CONTACT.phone),
        '',
        '---',
        COMPANY_CONTACT.name,
        footerAddress,
        `${COMPANY_CONTACT.phone}`
    );

    return lines.join('\n');
};

const buildOrderConfirmationEmailHtml = ({ order, items }) => {
    const language = normalizeLanguage(order.language);
    const copy = ORDER_CONFIRMATION_COPY[language];
    const customerName = escapeHtml(order.customer_name || 'there');
    const pickupDate = escapeHtml(formatPickupDateLong(order.pickup_date, language));
    const locationKey = order.pickup_location;
    const locationDetails = locationKey ? LOCATION_DETAILS[locationKey] : null;
    const locationLabel = escapeHtml(locationDetails?.label || locationKey || '');
    const locationAddress = escapeHtml(locationDetails?.address || '');
    const total = escapeHtml(formatCurrency(order.total_cents));
    const paymentDetails = getPaymentDetails(order);
    const hasLambs = items.some(item => isLambName(item.name));

    const paidLabel = (paymentDetails.paymentType === 'deposit' || hasLambs) ? copy.depositPaid : copy.paidInFull;
    const paidAmount = escapeHtml(formatCurrency(paymentDetails.paidCents));

    let dueAmount = paymentDetails.dueCents > 0
        ? escapeHtml(formatCurrency(paymentDetails.dueCents))
        : '';

    if (hasLambs) {
        dueAmount = language === 'fr' ? 'À déterminer (selon le poids)' : 'To be determined (based on weight)';
    }

    const orderId = escapeHtml(getPublicOrderReference(order));

    const itemRows = items.length > 0
        ? items.map((item) => {
            const displayName = escapeHtml(String(item.name || 'Item').split(' / ')[0]);
            const quantity = escapeHtml(Number(item.quantity ?? 0));
            const lineTotal = escapeHtml(formatCurrency(item.line_cents));
            return `<li style="margin-bottom:6px;">${quantity} ${displayName}${lineTotal ? ` - ${lineTotal}` : ''}</li>`;
        }).join('')
        : `<li>${copy.itemsUnavailable}</li>`;

    const pickupDetails = (pickupDate || locationLabel || locationAddress)
        ? `
      <div style="background:#f5f5f5; padding:15px; margin:20px 0; border-left:4px solid ${BRAND_COLOR};">
        <h3 style="margin-top:0; color:#333;">${copy.pickupTitleHtml}</h3>
        <p style="margin:0; color:#333;">
          ${pickupDate ? `<strong>${copy.dateLabel}:</strong> ${pickupDate}<br>` : ''}
          ${locationLabel ? `<strong>${copy.locationLabel}:</strong> ${locationLabel}<br>` : ''}
          ${locationAddress ? `<strong>${copy.addressLabel}:</strong> ${locationAddress}` : ''}
        </p>
      </div>`
        : '';

    const paymentBlock = `
    <div style="background:#f5f5f5; padding:15px; margin:20px 0; border-left:4px solid ${BRAND_COLOR};">
      <h3 style="margin-top:0; color:#333;">${copy.paymentTitleHtml}</h3>
      <p style="margin:0; color:#333;">
        <strong>${copy.statusLabel}:</strong> ${escapeHtml(paidLabel)}<br>
        ${paidAmount ? `<strong>${copy.paidTodayLabel}:</strong> ${paidAmount}<br>` : ''}
        ${dueAmount ? `<strong>${copy.dueLabel}:</strong> ${dueAmount}` : ''}
      </p>
    </div>`;

    const reminderBlock = `
    <div style="background:#fff8e8; padding:15px; margin:20px 0; border-left:4px solid #9f6a00;">
      <h3 style="margin-top:0; margin-bottom:8px; color:#5a3a00;">${copy.reminderTitle}</h3>
      <p style="margin:0 0 8px; color:#333;">${copy.reminderLineOne}</p>
      <p style="margin:0; color:#333;">${copy.reminderLineTwo}</p>
    </div>`;

    const contentHtml = `
    <p>${copy.greeting(customerName)}</p>
    <p>${copy.thankYou}</p>
    ${pickupDetails}
    ${reminderBlock}
    <h3 style="margin-bottom:8px;">${copy.orderTitleHtml}</h3>
    <ul style="padding-left:18px; margin-top:0;">${itemRows}</ul>
    ${total ? `<p style="font-weight:bold;">Total: ${total}</p>` : ''}
    ${paymentBlock}
    <p style="font-size:12px; color:#666;">${copy.orderIdLabel}: ${orderId}</p>
    <p>${copy.questions(escapeHtml(COMPANY_CONTACT.phone))}</p>`;

    return buildBrandedEmailHtml({ contentHtml });
};

const buildOrderConfirmationEmailPayload = ({ order, items }) => {
    const language = normalizeLanguage(order.language);
    const copy = ORDER_CONFIRMATION_COPY[language];
    const pickupDate = formatPickupDateLong(order.pickup_date, language);
    const subject = copy.subject(pickupDate);
    const text = buildOrderConfirmationEmailText({ order, items });
    const html = buildOrderConfirmationEmailHtml({ order, items });
    return { subject, text, html };
};

const normalizeResendAttachments = (attachments) => {
    if (!Array.isArray(attachments) || attachments.length === 0) {
        return undefined;
    }
    const normalized = attachments
        .map((attachment) => ({
            filename: attachment?.filename || attachment?.name || attachment?.Name || 'attachment',
            content: attachment?.content || attachment?.Content || '',
            type: attachment?.type || attachment?.ContentType || 'application/octet-stream'
        }))
        .filter((attachment) => typeof attachment.content === 'string' && attachment.content.length > 0);

    return normalized.length > 0 ? normalized : undefined;
};

const formatSender = (address) => {
    const normalizedAddress = extractEmailAddress(address);
    if (!SIMPLE_EMAIL_PATTERN.test(normalizedAddress)) {
        return null;
    }
    return EMAIL_FROM_NAME ? `${EMAIL_FROM_NAME} <${normalizedAddress}>` : normalizedAddress;
};

const extractProviderErrorMessage = async (response) => {
    const contentType = String(response?.headers?.get?.('content-type') || '').toLowerCase();
    if (contentType.includes('application/json')) {
        try {
            const payload = await response.json();
            const message = String(
                payload?.message
                || payload?.error
                || payload?.name
                || payload?.detail
                || ''
            ).trim();
            if (message) {
                return message;
            }
        } catch {
            // Fall through to plain-text parsing below.
        }
    }

    try {
        const body = String(await response.text()).trim();
        if (body) {
            return body;
        }
    } catch {
        // Ignore parse failures and fall back to the status code below.
    }

    const statusCode = Number(response?.status || 0);
    return statusCode > 0 ? `HTTP ${statusCode}` : 'Unknown provider error';
};

const normalizeResendTags = (tags) => {
    if (!Array.isArray(tags)) return undefined;
    const normalized = tags.reduce((acc, tag) => {
        const name = String(tag?.name || '').trim();
        const value = String(tag?.value || '').trim();
        if (!name || !value) return acc;
        acc.push({ name, value });
        return acc;
    }, []);
    return normalized.length > 0 ? normalized : undefined;
};

const sendEmailMessage = async ({ to, subject, text, html, attachments, csv, filename, replyTo, from, headers, tags, idempotencyKey }) => {
    const formattedSender = formatSender(from || EMAIL_FROM);
    if (!formattedSender) {
        throw new Error('Email sender address is not configured.');
    }
    const payload = {
        from: formattedSender,
        to: [to.name ? `${to.name} <${to.email}>` : to.email],
        subject,
        text: text || '',
        html: html || ''
    };
    const normalizedReplyTo = extractEmailAddress(replyTo);
    if (SIMPLE_EMAIL_PATTERN.test(normalizedReplyTo)) {
        payload.reply_to = normalizedReplyTo;
    }
    if (headers && typeof headers === 'object') {
        payload.headers = Object.entries(headers).reduce((acc, [key, value]) => {
            if (!key || value === undefined || value === null) return acc;
            acc[String(key)] = String(value);
            return acc;
        }, {});
    }

    const attachmentPayload = Array.isArray(attachments)
        ? attachments
        : (csv
            ? [{
                Name: filename || 'pickup-orders.csv',
                Content: Buffer.from(String(csv), 'utf8').toString('base64'),
                ContentType: 'text/csv'
            }]
            : undefined);
    const resendAttachments = normalizeResendAttachments(attachmentPayload);
    if (resendAttachments) {
        payload.attachments = resendAttachments;
    }
    const resendTags = normalizeResendTags(tags);
    if (resendTags) {
        payload.tags = resendTags;
    }

    const response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${RESEND_API_KEY}`,
            ...(idempotencyKey ? { 'Idempotency-Key': String(idempotencyKey).trim() } : {})
        },
        body: JSON.stringify(payload)
    });

    if (!response.ok) {
        const errorMessage = await extractProviderErrorMessage(response);
        throw new Error(`Email send failed: ${errorMessage}`);
    }

    try {
        const payload = await response.json();
        return {
            id: String(payload?.id || '').trim() || null
        };
    } catch {
        return { id: null };
    }
};

const sendOrderConfirmationEmail = async (orderId, options = {}) => {
    if (!RESEND_API_KEY || !EMAIL_FROM) {
        return { skipped: 'not_configured' };
    }

    const summary = await getOrderSummary(orderId);
    if (!summary) {
        return { skipped: 'missing_order' };
    }

    const { order, items } = summary;
    if (!order.customer_email) {
        return { skipped: 'missing_email' };
    }

    const status = String(order.status || '').toLowerCase();
    if (!PAID_STATUSES.has(status)) {
        return { skipped: 'not_paid' };
    }

    const force = options?.force === true;
    const previousConfirmationSentAt = order.confirmation_email_sent_at || null;
    if (!force) {
        const claim = await pool.query(
            'UPDATE orders SET confirmation_email_sent_at = NOW() WHERE id = $1 AND confirmation_email_sent_at IS NULL RETURNING confirmation_email_sent_at',
            [orderId]
        );
        if (claim.rows.length === 0) {
            return { skipped: 'already_sent' };
        }
    }

    const emailPayload = buildOrderConfirmationEmailPayload({ order, items });

    try {
        const result = await sendTrackedEmailMessage({
            pool,
            verifyEmail: verifyCheckoutEmail,
            sendEmailMessage,
            message: {
                to: {
                    email: order.customer_email,
                    name: order.customer_name
                },
                subject: emailPayload.subject,
                text: emailPayload.text,
                html: emailPayload.html,
                from: CONFIRMATION_EMAIL_FROM,
                replyTo: CONFIRMATION_EMAIL_REPLY_TO,
                headers: CONFIRMATION_NO_REPLY_HEADERS,
                emailType: EMAIL_TYPES.CONFIRMATION,
                orderIds: [orderId],
                initiatedBy: options?.initiatedBy || 'system',
                language: order.language,
                metadata: {
                    order_number: getPublicOrderReference(order)
                }
            }
        });
        if (!result.success) {
            throw new Error(result.reason || 'Email send failed.');
        }

        await pool.query(
            'UPDATE orders SET confirmation_email_sent_at = NOW() WHERE id = $1',
            [orderId]
        );
        await recordOrderEvent(pool, {
            orderId,
            eventType: 'confirmation_queued',
            fromStatus: status,
            toStatus: status,
            actorType: String(options?.actorType || options?.initiatedBy || 'system').trim().toLowerCase() || 'system',
            actorId: String(options?.actorId || options?.initiatedBy || 'system').trim() || 'system',
            requestId: String(options?.requestId || '').trim() || null,
            payload: {
                email_message_id: result.emailMessageId,
                provider_email_id: result.providerEmailId || null,
                force,
                initiated_by: options?.initiatedBy || 'system'
            }
        });
        return {
            sent: true,
            emailMessageId: result.emailMessageId,
            providerEmailId: result.providerEmailId || null
        };
    } catch (err) {
        if (!force || !previousConfirmationSentAt) {
            await pool.query(
                'UPDATE orders SET confirmation_email_sent_at = NULL WHERE id = $1',
                [orderId]
            );
        }
        throw err;
    }
};

module.exports = {
    sendEmailMessage,
    sendOrderConfirmationEmail,
    buildOrderConfirmationEmailPayload
};
