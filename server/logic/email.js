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
    escapeHtml 
} = require('../utils/helpers');
const { getPaymentDetails, getOrderSummary, isLambName } = require('./pricing');

const RESEND_API_KEY = process.env.RESEND_API_KEY;
const EMAIL_FROM = process.env.EMAIL_FROM;
const EMAIL_FROM_NAME = process.env.EMAIL_FROM_NAME || 'Les Fermes Soulard';
const extractEmailAddress = (value) => {
    const raw = String(value || '').trim();
    if (!raw) return '';
    const angleMatch = raw.match(/<([^>]+)>/);
    return angleMatch?.[1] ? String(angleMatch[1]).trim() : raw;
};
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
const SIMPLE_EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

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

    lines.push(
        `${copy.orderIdLabel}: ${order.id}`,
        '',
        copy.questions(COMPANY_CONTACT.phone),
        '',
        '---',
        COMPANY_CONTACT.name,
        footerAddress,
        `${COMPANY_CONTACT.phone}`,
        COMPANY_CONTACT.email
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
    const footerAddress = escapeHtml(LOCATION_DETAILS.bristol?.address || COMPANY_CONTACT.address);
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

    const orderId = escapeHtml(order.id);
    const emailLink = `mailto:${encodeURIComponent(COMPANY_CONTACT.email)}`;

    const itemRows = items.length > 0
        ? items.map((item) => {
            const displayName = escapeHtml(String(item.name || 'Item').split(' / ')[0]);
            const quantity = escapeHtml(Number(item.quantity ?? 0));
            const lineTotal = escapeHtml(formatCurrency(item.line_cents));
            return `<li style="margin-bottom: 6px;">${quantity} ${displayName}${lineTotal ? ` - ${lineTotal}` : ''}</li>`;
        }).join('')
        : `<li>${copy.itemsUnavailable}</li>`;

    const pickupDetails = (pickupDate || locationLabel || locationAddress)
        ? `
      <div style="background: #f5f5f5; padding: 15px; margin: 20px 0; border-left: 4px solid #2D5A3D;">
        <h3 style="margin-top: 0; color: #333;">${copy.pickupTitleHtml}</h3>
        <p style="margin: 0; color: #333;">
          ${pickupDate ? `<strong>${copy.dateLabel}:</strong> ${pickupDate}<br>` : ''}
          ${locationLabel ? `<strong>${copy.locationLabel}:</strong> ${locationLabel}<br>` : ''}
          ${locationAddress ? `<strong>${copy.addressLabel}:</strong> ${locationAddress}` : ''}
        </p>
      </div>`
        : '';

    const paymentBlock = `
    <div style="background: #f5f5f5; padding: 15px; margin: 20px 0; border-left: 4px solid #2D5A3D;">
      <h3 style="margin-top: 0; color: #333;">${copy.paymentTitleHtml}</h3>
      <p style="margin: 0; color: #333;">
        <strong>${copy.statusLabel}:</strong> ${escapeHtml(paidLabel)}<br>
        ${paidAmount ? `<strong>${copy.paidTodayLabel}:</strong> ${paidAmount}<br>` : ''}
        ${dueAmount ? `<strong>${copy.dueLabel}:</strong> ${dueAmount}` : ''}
      </p>
    </div>`;

    const reminderBlock = `
    <div style="background: #fff8e8; padding: 15px; margin: 20px 0; border-left: 4px solid #9f6a00;">
      <h3 style="margin-top: 0; margin-bottom: 8px; color: #5a3a00;">${copy.reminderTitle}</h3>
      <p style="margin: 0 0 8px; color: #333;">${copy.reminderLineOne}</p>
      <p style="margin: 0; color: #333;">${copy.reminderLineTwo}</p>
    </div>`;

    return `
  <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
  <div style="background: #2D5A3D; color: white; padding: 20px; text-align: center;">
    <h1 style="margin: 0;">${escapeHtml(COMPANY_CONTACT.name)}</h1>
  </div>

  <div style="padding: 20px; background: white; color: #333;">
    <p>${copy.greeting(customerName)}</p>
    <p>${copy.thankYou}</p>
    ${pickupDetails}
    ${reminderBlock}
    <h3 style="margin-bottom: 8px;">${copy.orderTitleHtml}</h3>
    <ul style="padding-left: 18px; margin-top: 0;">${itemRows}</ul>
    ${total ? `<p style="font-weight: bold;">Total: ${total}</p>` : ''}
    ${paymentBlock}
    <p style="font-size: 12px; color: #666;">${copy.orderIdLabel}: ${orderId}</p>
    <p>${copy.questions(escapeHtml(COMPANY_CONTACT.phone))}</p>
  </div>

  <div style="background: #f5f5f5; padding: 15px; text-align: center; font-size: 12px; color: #666;">
    <p style="margin: 0;">
      ${escapeHtml(COMPANY_CONTACT.name)}<br>
      ${footerAddress}<br>
      ${escapeHtml(COMPANY_CONTACT.phone)} • <a href="${emailLink}" style="color: #2D5A3D; text-decoration: none;">${escapeHtml(COMPANY_CONTACT.email)}</a>
    </p>
  </div>
</div>`.trim();
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

const sendEmailMessage = async ({ to, subject, text, html, attachments, replyTo }) => {
    const payload = {
        from: EMAIL_FROM_NAME ? `${EMAIL_FROM_NAME} <${EMAIL_FROM}>` : EMAIL_FROM,
        to: [to.name ? `${to.name} <${to.email}>` : to.email],
        subject,
        text: text || '',
        html: html || ''
    };
    const normalizedReplyTo = extractEmailAddress(replyTo);
    if (SIMPLE_EMAIL_PATTERN.test(normalizedReplyTo)) {
        payload.reply_to = normalizedReplyTo;
    }

    const resendAttachments = normalizeResendAttachments(attachments);
    if (resendAttachments) {
        payload.attachments = resendAttachments;
    }

    const response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${RESEND_API_KEY}`
        },
        body: JSON.stringify(payload)
    });

    if (!response.ok) {
        const errorBody = await response.text();
        throw new Error(`Email send failed: ${errorBody}`);
    }
};

const sendOrderConfirmationEmail = async (orderId) => {
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

    const claim = await pool.query(
        'UPDATE orders SET confirmation_email_sent_at = NOW() WHERE id = $1 AND confirmation_email_sent_at IS NULL RETURNING confirmation_email_sent_at',
        [orderId]
    );
    if (claim.rows.length === 0) {
        return { skipped: 'already_sent' };
    }

    const emailPayload = buildOrderConfirmationEmailPayload({ order, items });

    try {
        await sendEmailMessage({
            to: {
                email: order.customer_email,
                name: order.customer_name
            },
            subject: emailPayload.subject,
            text: emailPayload.text,
            html: emailPayload.html,
            replyTo: CONFIRMATION_EMAIL_REPLY_TO
        });
        return { sent: true };
    } catch (err) {
        await pool.query(
            'UPDATE orders SET confirmation_email_sent_at = NULL WHERE id = $1',
            [orderId]
        );
        throw err;
    }
};

module.exports = {
    sendEmailMessage,
    sendOrderConfirmationEmail,
    buildOrderConfirmationEmailPayload
};
