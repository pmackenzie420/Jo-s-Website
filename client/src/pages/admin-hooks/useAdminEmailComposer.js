import { useCallback, useState } from 'react';
import {
  previewGroupEmail as previewGroupEmailRequest,
  sendGroupEmail as sendGroupEmailRequest
} from '../admin-api';

const EMAIL_LAST_REPORT_STORAGE_KEY = 'admin_email_last_report_v1';
const UNRESOLVED_REMINDER_PLACEHOLDER_PATTERN = /\{time\}/i;
const UNRESOLVED_REMINDER_PLACEHOLDER_ERROR = 'Replace {time} with the pickup times before sending.';

const parseLocalDate = (value) => {
  if (!value) return null;
  if (value instanceof Date) return value;
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value.trim())) {
    const [year, month, day] = value.split('-').map(Number);
    return new Date(year, month - 1, day);
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed;
};

const formatReminderDate = (value, language) => {
  const date = parseLocalDate(value);
  if (!date) return 'Unknown';
  return new Intl.DateTimeFormat(language === 'fr' ? 'fr-CA' : 'en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric'
  }).format(date);
};

const REMINDER_TIME_PLACEHOLDER = '{time}';
const pluralize = (count, singular, plural = `${singular}s`) => (
  count === 1 ? singular : plural
);
const formatEmailOutcomeSummary = ({ total, sent, failed }) => (
  `Sent ${total} ${pluralize(total, 'email')}: ${sent} ${pluralize(sent, 'success', 'successes')}, ${failed} ${pluralize(failed, 'failure')}.`
);

const normalizeFailedRecipients = (recipients) => (
  Array.isArray(recipients)
    ? recipients.reduce((acc, recipient) => {
      const email = String(recipient?.email || '').trim();
      if (!email) return acc;
      const name = String(recipient?.name || '').trim();
      const reason = String(recipient?.reason || '').trim();
      acc.push({
        email,
        ...(name ? { name } : {}),
        ...(reason ? { reason } : {})
      });
      return acc;
    }, [])
    : []
);

const normalizeEmailResults = (recipients) => (
  Array.isArray(recipients)
    ? recipients.reduce((acc, recipient) => {
      const email = String(recipient?.email || '').trim();
      if (!email) return acc;
      const name = String(recipient?.name || '').trim();
      const status = String(recipient?.status || '').trim().toLowerCase() || 'unknown';
      const reason = String(recipient?.reason || '').trim();
      acc.push({
        email,
        ...(name ? { name } : {}),
        status,
        ...(reason ? { reason } : {})
      });
      return acc;
    }, [])
    : []
);

const getRequestErrorMessage = (error, fallback) => (
  String(
    error?.response?.data?.error
    || error?.response?.data?.message
    || ''
  ).trim() || fallback
);

const hasUnresolvedReminderPlaceholder = (message) => (
  String(message?.emailType || '').trim().toLowerCase() === 'pickup_reminder'
  && (
    UNRESOLVED_REMINDER_PLACEHOLDER_PATTERN.test(String(message?.subject || ''))
    || UNRESOLVED_REMINDER_PLACEHOLDER_PATTERN.test(String(message?.text || ''))
    || UNRESOLVED_REMINDER_PLACEHOLDER_PATTERN.test(String(message?.html || ''))
  )
);

const normalizeCounts = (value, keys) => (
  keys.reduce((acc, key) => {
    const numeric = Number(value?.[key] || 0);
    acc[key] = Number.isFinite(numeric) && numeric >= 0 ? numeric : 0;
    return acc;
  }, {})
);

const readStoredEmailReport = () => {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(EMAIL_LAST_REPORT_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    const total = Number(parsed?.total || 0);
    const sent = Number(parsed?.sent || 0);
    return {
      groupKey: String(parsed?.groupKey || '').trim(),
      groupDate: String(parsed?.groupDate || '').trim(),
      locationLabel: String(parsed?.locationLabel || '').trim(),
      subject: String(parsed?.subject || '').trim(),
      completedAt: String(parsed?.completedAt || '').trim(),
      total: Number.isFinite(total) && total >= 0 ? total : 0,
      sent: Number.isFinite(sent) && sent >= 0 ? sent : 0,
      counts: normalizeCounts(parsed?.counts, ['sent', 'warning', 'blocked', 'suppressed', 'failed', 'duplicate']),
      failedRecipients: normalizeFailedRecipients(parsed?.failedRecipients)
    };
  } catch {
    return null;
  }
};

const persistEmailReport = (report) => {
  if (typeof window === 'undefined') return;
  try {
    if (!report) {
      window.localStorage.removeItem(EMAIL_LAST_REPORT_STORAGE_KEY);
      return;
    }
    window.localStorage.setItem(EMAIL_LAST_REPORT_STORAGE_KEY, JSON.stringify(report));
  } catch {
    // ignore storage issues
  }
};

const buildReminderTemplate = ({ groupDate, locationLabel }) => {
  const frDate = formatReminderDate(groupDate, 'fr');
  const enDate = formatReminderDate(groupDate, 'en');
  const location = String(locationLabel || 'Unknown').trim() || 'Unknown';

  return {
    subject: `Rappel de ramassage / Pickup reminder - ${frDate} (${location})`,
    text:
      `Bonjour,\n` +
      `Ceci est un rappel pour votre ramassage le ${frDate} a ${location}, de ${REMINDER_TIME_PLACEHOLDER} a ${REMINDER_TIME_PLACEHOLDER}.\n\n` +
      `Veuillez apporter des cages ou des boites pour votre volaille. Nous n'en fournirons PAS.\n\n` +
      `Merci.\n\n` +
      `---\n\n` +
      `Hello,\n` +
      `This is a reminder for your pickup on ${enDate} at ${location}, from ${REMINDER_TIME_PLACEHOLDER} to ${REMINDER_TIME_PLACEHOLDER}.\n\n` +
      `Please make sure to bring crates or boxes for your poultry. We will NOT provide any.\n\n` +
      'Thank you.'
  };
};

const buildReminderMessages = ({ recipients, subject, message, groupDate, locationLabel }) => {
  const fallbackDraft = buildReminderTemplate({ groupDate, locationLabel });
  const normalizedSubject = String(subject || '').trim() || fallbackDraft.subject;
  const normalizedMessage = String(message || '').trim() || fallbackDraft.text;
  return (Array.isArray(recipients) ? recipients : []).map((recipient) => ({
    to: { email: recipient.email, name: recipient.name },
    subject: normalizedSubject,
    text: normalizedMessage,
    emailType: 'pickup_reminder',
    pickupDate: String(groupDate || '').trim(),
    pickupLocation: String(locationLabel || '').trim(),
    batchKey: `${String(groupDate || '').trim()}::${String(locationLabel || '').trim()}`,
    orderIds: Array.isArray(recipient?.orderIds) ? recipient.orderIds : []
  }));
};

export default function useAdminEmailComposer(showToast) {
  const [emailGroupKey, setEmailGroupKey] = useState(null);
  const [emailSubject, setEmailSubject] = useState('');
  const [emailMessage, setEmailMessage] = useState('');
  const [emailTargetInput, setEmailTargetInputState] = useState('');
  const [emailSending, setEmailSending] = useState(null);
  const [emailPreviewLoading, setEmailPreviewLoading] = useState(null);
  const [emailPreviewReport, setEmailPreviewReport] = useState(null);
  const [emailLastReportState, setEmailLastReportState] = useState(() => readStoredEmailReport());

  const setEmailLastReport = useCallback((report) => {
    setEmailLastReportState(report);
    persistEmailReport(report);
  }, []);
  const emailFailedRecipients = emailLastReportState?.failedRecipients || [];

  const handleToggleEmailGroup = useCallback(({ groupKey, groupDate, locationLabel, isActive }) => {
    const nextActive = isActive ? null : groupKey;
    setEmailGroupKey(nextActive);
    setEmailTargetInputState('');
    setEmailPreviewReport((prev) => (
      prev && prev.groupKey === nextActive ? prev : null
    ));
    if (!isActive) {
      const previewDraft = buildReminderTemplate({ groupDate, locationLabel });
      setEmailSubject(previewDraft.subject);
      setEmailMessage(previewDraft.text);
    }
  }, []);

  const setEmailTargetInput = useCallback((value) => {
    setEmailTargetInputState(String(value || ''));
    setEmailPreviewReport(null);
  }, []);

  const handlePreviewGroupEmail = useCallback(
    async (groupKey, recipients, groupMeta = {}) => {
      if (!Array.isArray(recipients) || recipients.length === 0) {
        showToast({ type: 'error', text: 'No email addresses for this group.' });
        return null;
      }
      const groupDate = groupMeta?.groupDate;
      const locationLabel = groupMeta?.locationLabel || 'Unknown';
      const messages = buildReminderMessages({
        recipients,
        subject: emailSubject,
        message: emailMessage,
        groupDate,
        locationLabel
      });
      if (messages.some(hasUnresolvedReminderPlaceholder)) {
        showToast({ type: 'error', text: UNRESOLVED_REMINDER_PLACEHOLDER_ERROR });
        return null;
      }

      setEmailPreviewLoading(groupKey);
      try {
        const response = await previewGroupEmailRequest({ messages });
        const data = response.data || {};
        const previewRecipients = normalizeEmailResults(data.recipients);
        setEmailPreviewReport({
          groupKey,
          groupDate: String(groupDate || '').trim(),
          locationLabel,
          subject: String(messages[0]?.subject || '').trim(),
          completedAt: String(data.completedAt || new Date().toISOString()).trim(),
          total: Number(data.total || previewRecipients.length || recipients.length) || recipients.length,
          counts: normalizeCounts(data.counts, ['ready', 'warning', 'blocked', 'suppressed', 'duplicate']),
          recipients: previewRecipients
        });
        return data;
      } catch (error) {
        showToast({ type: 'error', text: getRequestErrorMessage(error, 'Failed to check recipients.') });
        return null;
      } finally {
        setEmailPreviewLoading(null);
      }
    },
    [emailSubject, emailMessage, showToast]
  );

  const handleSendGroupEmail = useCallback(
    async (groupKey, recipients, groupMeta = {}) => {
      if (!Array.isArray(recipients) || recipients.length === 0) {
        showToast({ type: 'error', text: 'No email addresses for this group.' });
        return null;
      }
      const groupDate = groupMeta?.groupDate;
      const locationLabel = groupMeta?.locationLabel || 'Unknown';
      const messages = buildReminderMessages({
        recipients,
        subject: emailSubject,
        message: emailMessage,
        groupDate,
        locationLabel
      });
      if (messages.some(hasUnresolvedReminderPlaceholder)) {
        showToast({ type: 'error', text: UNRESOLVED_REMINDER_PLACEHOLDER_ERROR });
        return null;
      }

      setEmailSending(groupKey);
      try {
        const response = await sendGroupEmailRequest({
          messages
        });
        const data = response.data || {};
        const failed = normalizeFailedRecipients(data.failedRecipients);
        const sentCount = Number(data.sent || 0);
        const failedCount = failed.length;
        const attemptedCount = Number(data.attempted || 0);
        const totalCount = attemptedCount || sentCount + failedCount || recipients.length;
        setEmailLastReport({
          groupKey,
          groupDate: String(groupDate || '').trim(),
          locationLabel,
          subject: String(messages[0]?.subject || '').trim(),
          completedAt: String(data.completedAt || new Date().toISOString()).trim(),
          total: totalCount,
          sent: sentCount,
          counts: normalizeCounts(data.counts, ['sent', 'warning', 'blocked', 'suppressed', 'failed', 'duplicate']),
          failedRecipients: failed
        });
        const summary = formatEmailOutcomeSummary({
          total: totalCount,
          sent: sentCount,
          failed: failedCount
        });
        if (failed.length > 0) {
          showToast({ type: 'error', text: summary });
        } else {
          showToast({ type: 'success', text: summary });
        }
        return data;
      } catch (error) {
        showToast({ type: 'error', text: getRequestErrorMessage(error, 'Failed to send group email.') });
        return null;
      } finally {
        setEmailSending(null);
      }
    },
    [emailSubject, emailMessage, setEmailLastReport, showToast]
  );

  return {
    emailGroupKey,
    emailSubject,
    emailMessage,
    emailTargetInput,
    emailSending,
    emailPreviewLoading,
    emailPreviewReport,
    emailLastReport: emailLastReportState,
    emailFailedRecipients,
    setEmailGroupKey,
    setEmailSubject,
    setEmailMessage,
    setEmailTargetInput,
    handleToggleEmailGroup,
    handlePreviewGroupEmail,
    handleSendGroupEmail
  };
}
