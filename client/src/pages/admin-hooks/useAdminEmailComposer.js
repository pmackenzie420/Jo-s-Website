import { useCallback, useState } from 'react';
import { sendGroupEmail as sendGroupEmailRequest } from '../admin-api';

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

export default function useAdminEmailComposer(showToast) {
  const [emailGroupKey, setEmailGroupKey] = useState(null);
  const [emailSubject, setEmailSubject] = useState('');
  const [emailMessage, setEmailMessage] = useState('');
  const [emailSending, setEmailSending] = useState(null);
  const [emailFailedRecipients, setEmailFailedRecipients] = useState([]);

  const handleToggleEmailGroup = useCallback(({ groupKey, groupDate, locationLabel, isActive }) => {
    const nextActive = isActive ? null : groupKey;
    setEmailGroupKey(nextActive);
    if (!isActive) {
      const previewDraft = buildReminderTemplate({ groupDate, locationLabel });
      setEmailSubject(previewDraft.subject);
      setEmailMessage(previewDraft.text);
      setEmailFailedRecipients([]);
    }
  }, []);

  const handleSendGroupEmail = useCallback(
    async (groupKey, recipients, groupMeta = {}) => {
      if (!Array.isArray(recipients) || recipients.length === 0) {
        showToast({ type: 'error', text: 'No email addresses for this group.' });
        return;
      }
      const groupDate = groupMeta?.groupDate;
      const locationLabel = groupMeta?.locationLabel || 'Unknown';
      const normalizedSubject = String(emailSubject || '').trim();
      const normalizedMessage = String(emailMessage || '').trim();
      const fallbackDraft = buildReminderTemplate({ groupDate, locationLabel });

      setEmailSending(groupKey);
      setEmailFailedRecipients([]);
      try {
        const messages = recipients.map((recipient) => ({
          to: { email: recipient.email, name: recipient.name },
          subject: normalizedSubject || fallbackDraft.subject,
          text: normalizedMessage || fallbackDraft.text
        }));

        const response = await sendGroupEmailRequest({
          messages
        });
        const data = response.data || {};
        const failed = data.failedRecipients || [];
        const sentCount = Number(data.sent || 0);
        const failedCount = failed.length;
        const totalCount = sentCount + failedCount;
        const summary = formatEmailOutcomeSummary({
          total: totalCount || recipients.length,
          sent: sentCount,
          failed: failedCount
        });
        if (failed.length > 0) {
          setEmailFailedRecipients(failed);
          showToast({ type: 'error', text: summary });
        } else {
          showToast({ type: 'success', text: summary });
        }
      } catch {
        showToast({ type: 'error', text: 'Failed to send group email.' });
      } finally {
        setEmailSending(null);
      }
    },
    [emailSubject, emailMessage, showToast]
  );

  return {
    emailGroupKey,
    emailSubject,
    emailMessage,
    emailSending,
    emailFailedRecipients,
    setEmailGroupKey,
    setEmailSubject,
    setEmailMessage,
    handleToggleEmailGroup,
    handleSendGroupEmail
  };
}
