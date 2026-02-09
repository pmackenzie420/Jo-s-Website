import { useCallback, useState } from 'react';
import { formatDateLong } from '../admin-utils';
import { sendGroupEmail as sendGroupEmailRequest } from '../admin-api';

export default function useAdminEmailComposer(showToast) {
  const [emailGroupKey, setEmailGroupKey] = useState(null);
  const [emailSubject, setEmailSubject] = useState('');
  const [emailMessage, setEmailMessage] = useState('');
  const [emailSending, setEmailSending] = useState(null);

  const handleToggleEmailGroup = useCallback(({ groupKey, groupDate, locationLabel, isActive }) => {
    const nextActive = isActive ? null : groupKey;
    setEmailGroupKey(nextActive);
    if (!isActive) {
      const dateLabel = formatDateLong(groupDate);
      setEmailSubject(`Pickup reminder - ${dateLabel} (${locationLabel})`);
      setEmailMessage(
        `Hello,\n\nThis is a reminder for your pickup on ${dateLabel} at ${locationLabel}.\n\nThank you.`
      );
    }
  }, []);

  const handleSendGroupEmail = useCallback(
    async (groupKey, recipients) => {
      if (!Array.isArray(recipients) || recipients.length === 0) {
        showToast({ type: 'error', text: 'No email addresses for this group.' });
        return;
      }
      setEmailSending(groupKey);
      try {
        await sendGroupEmailRequest({
          messages: recipients.map((recipient) => ({
            to: { email: recipient.email, name: recipient.name },
            subject: emailSubject || 'Pickup reminder',
            text: emailMessage || 'Pickup reminder.'
          }))
        });
        showToast({ type: 'success', text: 'Group email sent.' });
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
    setEmailGroupKey,
    setEmailSubject,
    setEmailMessage,
    handleToggleEmailGroup,
    handleSendGroupEmail
  };
}
