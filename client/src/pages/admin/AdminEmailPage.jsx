import { formatDateLong } from '../admin-utils';
import { t, tf } from '../admin-i18n';

export default function AdminEmailPage({
  dataLoading,
  groupedPickups,
  emailGroupKey,
  emailSubject,
  emailMessage,
  emailSending,
  emailFailedRecipients,
  adminLanguage,
  onToggleGroup,
  onSubjectChange,
  onMessageChange,
  onSendGroupEmail
}) {
  if (dataLoading) {
    return <div className="admin-panel">{t('email.loading', adminLanguage)}</div>;
  }

  return (
    <div className="admin-stack">
      <section className="admin-panel stagger-item">
        <div className="panel-header">
          <div>
            <div className="panel-title">{t('email.title', adminLanguage)}</div>
            <div className="panel-subtitle">{t('email.subtitle', adminLanguage)}</div>
          </div>
        </div>
        {groupedPickups.length === 0 ? (
          <div className="empty-state">{t('email.empty', adminLanguage)}</div>
        ) : (
          <div className="email-group-list">
            {groupedPickups.flatMap((group) =>
              group.locations.map((locationGroup) => {
                const groupKey = `${group.date}-${locationGroup.location}`;
                const recipients = new Map();
                locationGroup.orders.forEach((order) => {
                  const email = (order.customerEmail || '').trim().toLowerCase();
                  if (!email) return;
                  if (!recipients.has(email)) {
                    recipients.set(email, {
                      email,
                      name: order.customerName,
                      language: order.language
                    });
                    return;
                  }
                  const existing = recipients.get(email);
                  if (!existing.language && order.language) {
                    recipients.set(email, {
                      ...existing,
                      language: order.language
                    });
                  }
                });
                const isActive = emailGroupKey === groupKey;
                return (
                  <div key={groupKey} className="email-group">
                    <button
                      type="button"
                      className={`email-group-card ${isActive ? 'active' : ''}`}
                      onClick={() =>
                        onToggleGroup({
                          groupKey,
                          groupDate: group.date,
                          locationLabel: locationGroup.locationLabel,
                          isActive
                        })
                      }
                    >
                      <div>
                        <div className="email-group-title">
                          {formatDateLong(group.date, adminLanguage)} - {locationGroup.locationLabel}
                        </div>
                        <div className="email-group-meta">
                          {tf('email.orders', adminLanguage, {
                            orders: locationGroup.orders.length,
                            emails: recipients.size
                          })}
                        </div>
                      </div>
                      <span className="email-group-action">
                        {isActive ? t('email.close', adminLanguage) : t('email.emailBtn', adminLanguage)}
                      </span>
                    </button>
                    {isActive && (
                      <div className="email-group-form">
                        <input
                          className="admin-input"
                          type="text"
                          placeholder={t('email.subject', adminLanguage)}
                          value={emailSubject}
                          onChange={(event) => onSubjectChange(event.target.value)}
                        />
                        <textarea
                          className="admin-textarea"
                          rows={5}
                          placeholder={t('email.message', adminLanguage)}
                          value={emailMessage}
                          onChange={(event) => onMessageChange(event.target.value)}
                        />
                        <button
                          className="admin-button"
                          type="button"
                          disabled={recipients.size === 0 || emailSending === groupKey}
                          onClick={() =>
                            onSendGroupEmail(
                              groupKey,
                              Array.from(recipients.values()),
                              {
                                groupDate: group.date,
                                locationLabel: locationGroup.locationLabel
                              }
                            )
                          }
                        >
                          {emailSending === groupKey ? t('email.sending', adminLanguage) : t('email.sendEmail', adminLanguage)}
                        </button>
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        )}
      </section>
      {emailFailedRecipients?.length > 0 && (
        <section className="admin-panel stagger-item email-failed-panel">
          <div className="panel-header">
            <div>
              <div className="panel-title email-failed-title">{t('email.failedTitle', adminLanguage)}</div>
              <div className="panel-subtitle">
                {tf('email.failedSubtitle', adminLanguage, {
                  count: emailFailedRecipients.length,
                  s: emailFailedRecipients.length !== 1 ? 's' : ''
                })}
              </div>
            </div>
          </div>
          <div className="email-failed-list">
            {emailFailedRecipients.map((recipient) => (
              <div key={recipient.email} className="email-failed-row">
                <span className="email-failed-name">{recipient.name || recipient.email}</span>
                {recipient.name && <span className="email-failed-email">{recipient.email}</span>}
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
