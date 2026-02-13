import { formatDateLong } from '../admin-utils';

export default function AdminEmailPage({
  dataLoading,
  groupedPickups,
  emailGroupKey,
  emailSubject,
  emailMessage,
  emailSending,
  emailFailedRecipients,
  onToggleGroup,
  onSubjectChange,
  onMessageChange,
  onSendGroupEmail
}) {
  if (dataLoading) {
    return <div className="admin-panel">Loading email groups...</div>;
  }

  return (
    <div className="admin-stack">
      <section className="admin-panel stagger-item">
        <div className="panel-header">
          <div>
            <div className="panel-title">Emailing</div>
            <div className="panel-subtitle">Send a note to each pickup group.</div>
          </div>
        </div>
        {groupedPickups.length === 0 ? (
          <div className="empty-state">No pickup groups yet.</div>
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
                          {formatDateLong(group.date)} - {locationGroup.locationLabel}
                        </div>
                        <div className="email-group-meta">
                          {locationGroup.orders.length} orders - {recipients.size} emails
                        </div>
                      </div>
                      <span className="email-group-action">{isActive ? 'Close' : 'Email'}</span>
                    </button>
                    {isActive && (
                      <div className="email-group-form">
                        <input
                          className="admin-input"
                          type="text"
                          placeholder="Subject"
                          value={emailSubject}
                          onChange={(event) => onSubjectChange(event.target.value)}
                        />
                        <textarea
                          className="admin-textarea"
                          rows={5}
                          placeholder="Message"
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
                          {emailSending === groupKey ? 'Sending...' : 'Send Email'}
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
              <div className="panel-title email-failed-title">Failed to send</div>
              <div className="panel-subtitle">{emailFailedRecipients.length} recipient{emailFailedRecipients.length !== 1 ? 's' : ''} did not receive the email.</div>
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
