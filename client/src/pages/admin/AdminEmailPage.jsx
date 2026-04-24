import { buildEmailRecipientTargeting, buildGroupEmailRecipients } from '../admin-email-targeting';
import { formatDateLong } from '../admin-utils';
import { t, tf } from '../admin-i18n';

const formatReportTimestamp = (value, language) => {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return '';
  return new Intl.DateTimeFormat(language === 'fr' ? 'fr-CA' : 'en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit'
  }).format(parsed);
};

const getEmailStatusLabel = (status, language) => {
  const normalized = String(status || '').trim().toLowerCase();
  const map = {
    ready: t('emailStatus.ready', language),
    not_sent: t('emailStatus.notSent', language),
    pending: t('emailStatus.pending', language),
    sent: t('emailStatus.sent', language),
    delivered: t('emailStatus.delivered', language),
    failed: t('emailStatus.failed', language),
    stale_pending: t('emailStatus.stalePending', language),
    blocked: t('emailStatus.blocked', language),
    suppressed: t('emailStatus.suppressedShort', language),
    duplicate: t('emailStatus.duplicate', language),
    bounced: t('emailStatus.bounced', language),
    complained: t('emailStatus.complained', language),
    warning: t('emailStatus.warning', language),
    skipped: t('emailStatus.skipped', language)
  };
  return map[normalized] || normalized || t('emailStatus.sent', language);
};

const getPreviewBucket = (status) => {
  const normalized = String(status || '').trim().toLowerCase();
  if (normalized === 'ready') return 'ready';
  if (normalized === 'warning') return 'warning';
  return 'skipped';
};

const getEmailTypeLabel = (emailType, language) => {
  const normalized = String(emailType || '').trim().toLowerCase();
  const map = {
    confirmation: t('emailType.confirmation', language),
    pickup_reminder: t('emailType.pickupReminder', language),
    pickup_date_change: t('emailType.pickupDateChange', language),
    admin_message: t('emailType.adminMessage', language)
  };
  return map[normalized] || normalized || t('emailType.adminMessage', language);
};

const buildPreviewCounts = (counts) => ({
  ready: Number(counts?.ready || 0),
  warning: Number(counts?.warning || 0),
  skipped:
    Number(counts?.blocked || 0) +
    Number(counts?.suppressed || 0) +
    Number(counts?.duplicate || 0)
});

export default function AdminEmailPage({
  dataLoading,
  groupedPickups,
  emailGroupKey,
  emailSubject,
  emailMessage,
  emailTargetInput,
  emailSending,
  emailPreviewLoading,
  emailPreviewReport,
  emailLastReport,
  emailFailedRecipients,
  emailActivity,
  emailActivityLoading,
  emailActivityQuery,
  emailActivityStatus,
  adminLanguage,
  onToggleGroup,
  onSubjectChange,
  onMessageChange,
  onTargetInputChange,
  onPreviewGroupEmail,
  onSendGroupEmail,
  onEmailActivityQueryChange,
  onEmailActivityStatusChange,
  onRefreshEmailActivity
}) {
  if (dataLoading) {
    return <div className="admin-panel">{t('email.loading', adminLanguage)}</div>;
  }

  const failedRecipients = emailLastReport?.failedRecipients || emailFailedRecipients || [];
  const failedTimestamp = formatReportTimestamp(emailLastReport?.completedAt, adminLanguage);
  const failedLocation = String(emailLastReport?.locationLabel || 'Unknown').trim() || 'Unknown';
  const failedTotal = Number(emailLastReport?.total || 0);
  const failedSent = Number(emailLastReport?.sent || 0);
  const activityRows = Array.isArray(emailActivity) ? emailActivity : [];

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
                const recipientList = buildGroupEmailRecipients(locationGroup.orders);
                const isActive = emailGroupKey === groupKey;
                const recipientTargeting = isActive
                  ? buildEmailRecipientTargeting(recipientList, emailTargetInput)
                  : null;
                const selectedRecipients = recipientTargeting?.selectedRecipients || recipientList;
                const previewForGroup = isActive && emailPreviewReport?.groupKey === groupKey
                  ? emailPreviewReport
                  : null;
                const previewCounts = buildPreviewCounts(previewForGroup?.counts);
                const previewIssues = Array.isArray(previewForGroup?.recipients)
                  ? previewForGroup.recipients.filter((recipient) => recipient.status !== 'ready')
                  : [];
                const unmatchedTokens = recipientTargeting?.unmatchedTokens || [];

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
                            emails: recipientList.length
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
                        <div className="email-target-panel">
                          <label className="admin-label" htmlFor={`email-targets-${groupKey}`}>
                            {t('email.targetLabel', adminLanguage)}
                          </label>
                          <textarea
                            id={`email-targets-${groupKey}`}
                            className="admin-textarea"
                            rows={3}
                            placeholder={t('email.targetPlaceholder', adminLanguage)}
                            value={emailTargetInput}
                            onChange={(event) => onTargetInputChange(event.target.value)}
                          />
                          <div className="email-target-hint">
                            {t('email.targetHint', adminLanguage)}
                          </div>
                          <div className="email-target-summary">
                            {recipientTargeting?.hasTargets
                              ? (selectedRecipients.length > 0
                                ? tf('email.targetFilteredSummary', adminLanguage, {
                                  recipients: recipientTargeting.selectedRecipientCount,
                                  orders: recipientTargeting.selectedOrderCount,
                                  unmatched: unmatchedTokens.length
                                })
                                : t('email.targetNoMatches', adminLanguage))
                              : tf('email.targetAllSummary', adminLanguage, {
                                emails: recipientList.length
                              })}
                          </div>
                          {unmatchedTokens.length > 0 && (
                            <div className="email-target-unmatched">
                              {tf('email.targetUnmatched', adminLanguage, {
                                tokens: unmatchedTokens.slice(0, 10).join(', ')
                              })}
                            </div>
                          )}
                        </div>
                        <div className="email-group-actions">
                          <button
                            className="admin-button ghost"
                            type="button"
                            disabled={selectedRecipients.length === 0 || emailPreviewLoading === groupKey}
                            onClick={() =>
                              onPreviewGroupEmail(
                                groupKey,
                                selectedRecipients,
                                {
                                  groupDate: group.date,
                                  locationLabel: locationGroup.locationLabel
                                }
                              )
                            }
                          >
                            {emailPreviewLoading === groupKey
                              ? t('email.previewing', adminLanguage)
                              : t('email.preview', adminLanguage)}
                          </button>
                          <button
                            className="admin-button"
                            type="button"
                            disabled={selectedRecipients.length === 0 || emailSending === groupKey}
                            onClick={() =>
                              onSendGroupEmail(
                                groupKey,
                                selectedRecipients,
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
                        {previewForGroup && (
                          <div className="email-preview-panel">
                            <div className="email-preview-header">
                              <div className="email-preview-title">{t('email.previewTitle', adminLanguage)}</div>
                              <div className="email-preview-meta">
                                {formatReportTimestamp(previewForGroup.completedAt, adminLanguage)}
                              </div>
                            </div>
                            <div className="email-preview-counts">
                              {tf('email.previewSummary', adminLanguage, {
                                ready: previewCounts.ready,
                                warning: previewCounts.warning,
                                skipped: previewCounts.skipped
                              })}
                            </div>
                            <div className="email-preview-note">{t('email.previewNote', adminLanguage)}</div>
                            {previewIssues.length === 0 ? (
                              <div className="email-preview-clear">{t('email.previewAllClear', adminLanguage)}</div>
                            ) : (
                              <div className="email-preview-issues">
                                {previewIssues.map((recipient) => {
                                  const bucket = getPreviewBucket(recipient.status);
                                  return (
                                  <div key={`${recipient.email}-${recipient.status}-${recipient.reason || ''}`} className="email-preview-row">
                                    <div className="email-preview-row-main">
                                      <span className="email-preview-status">
                                        {getEmailStatusLabel(bucket, adminLanguage)}
                                      </span>
                                      <span className="email-preview-recipient">
                                        {recipient.name || recipient.email}
                                      </span>
                                      {recipient.name && (
                                        <span className="email-preview-email">{recipient.email}</span>
                                      )}
                                    </div>
                                    {recipient.reason && (
                                      <div className="email-preview-reason">{recipient.reason}</div>
                                    )}
                                  </div>
                                  );
                                })}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        )}
      </section>

      {failedRecipients.length > 0 && (
        <section className="admin-panel stagger-item email-failed-panel">
          <div className="panel-header">
            <div>
              <div className="panel-title email-failed-title">{t('email.failedTitle', adminLanguage)}</div>
              <div className="panel-subtitle">
                {tf('email.failedSubtitle', adminLanguage, {
                  count: failedRecipients.length,
                  s: failedRecipients.length !== 1 ? 's' : ''
                })}
              </div>
              {emailLastReport && (
                <>
                  {failedTimestamp && (
                    <div className="panel-subtitle email-failed-meta">
                      {tf('email.failedMeta', adminLanguage, {
                        when: failedTimestamp,
                        location: failedLocation
                      })}
                    </div>
                  )}
                  {failedTotal > 0 && (
                    <div className="panel-subtitle email-failed-meta">
                      {tf('email.failedStats', adminLanguage, {
                        sent: failedSent,
                        total: failedTotal
                      })}
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
          <div className="email-failed-list">
            {failedRecipients.map((recipient) => (
              <div key={`${recipient.email}-${recipient.reason || ''}`} className="email-failed-row">
                <div className="email-failed-header">
                  <span className="email-failed-name">{recipient.name || recipient.email}</span>
                  {recipient.name && <span className="email-failed-email">{recipient.email}</span>}
                </div>
                {recipient.reason && <div className="email-failed-reason">{recipient.reason}</div>}
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="admin-panel stagger-item">
        <div className="panel-header">
          <div>
            <div className="panel-title">{t('email.activityTitle', adminLanguage)}</div>
            <div className="panel-subtitle">{t('email.activitySubtitle', adminLanguage)}</div>
          </div>
        </div>
        <div className="email-activity-controls">
          <input
            className="admin-input"
            type="search"
            placeholder={t('email.activitySearch', adminLanguage)}
            value={emailActivityQuery}
            onChange={(event) => onEmailActivityQueryChange(event.target.value)}
          />
          <select
            className="admin-select"
            value={emailActivityStatus}
            onChange={(event) => onEmailActivityStatusChange(event.target.value)}
          >
            <option value="">{t('email.activityAllStatuses', adminLanguage)}</option>
            <option value="pending">{t('emailStatus.pending', adminLanguage)}</option>
            <option value="stale_pending">{t('emailStatus.stalePending', adminLanguage)}</option>
            <option value="sent">{t('emailStatus.sent', adminLanguage)}</option>
            <option value="delivered">{t('emailStatus.delivered', adminLanguage)}</option>
            <option value="warning">{t('emailStatus.warning', adminLanguage)}</option>
            <option value="failed">{t('emailStatus.failed', adminLanguage)}</option>
            <option value="blocked">{t('emailStatus.blocked', adminLanguage)}</option>
            <option value="suppressed">{t('emailStatus.suppressedShort', adminLanguage)}</option>
            <option value="bounced">{t('emailStatus.bounced', adminLanguage)}</option>
          </select>
          <button
            type="button"
            className="admin-button ghost"
            onClick={onRefreshEmailActivity}
            disabled={emailActivityLoading}
          >
            {emailActivityLoading ? t('email.activityRefreshing', adminLanguage) : t('email.activityRefresh', adminLanguage)}
          </button>
        </div>
        {emailActivityLoading && activityRows.length === 0 ? (
          <div className="empty-state">{t('email.activityLoading', adminLanguage)}</div>
        ) : activityRows.length === 0 ? (
          <div className="empty-state">{t('email.activityEmpty', adminLanguage)}</div>
        ) : (
          <div className="email-activity-list">
            {activityRows.map((entry) => {
              const activityStatus = entry.displayStatus || entry.sendStatus || 'sent';
              const activityTimestamp = formatReportTimestamp(
                entry.lastEventAt || entry.createdAt,
                adminLanguage
              );
              const orderNumberDisplay = Array.isArray(entry.orderNumbers) && entry.orderNumbers.length > 0
                ? entry.orderNumbers.map((value) => `#${value}`).join(', ')
                : '';
              const activityTrace = [
                entry.batchRunId ? tf('email.activityBatch', adminLanguage, { batch: entry.batchRunId }) : '',
                entry.requestId ? tf('email.activityRequest', adminLanguage, { request: entry.requestId }) : ''
              ].filter(Boolean).join(' · ');
              const stalePendingNote = entry.isStalePending
                ? tf('email.activityStalePending', adminLanguage, {
                  minutes: Number(entry.stalePendingMinutes || 0) || 0
                })
                : '';
              return (
                <div key={entry.id} className="email-activity-row">
                  <div className="email-activity-main">
                    <div className="email-activity-title">
                      <span className="email-activity-type">{getEmailTypeLabel(entry.emailType, adminLanguage)}</span>
                      <span className={`email-status-badge status-${activityStatus}`}>
                        {getEmailStatusLabel(activityStatus, adminLanguage)}
                      </span>
                    </div>
                    <div className="email-activity-recipient">
                      {entry.toName ? `${entry.toName} · ` : ''}
                      {entry.toEmail}
                    </div>
                    <div className="email-activity-meta">
                      {activityTimestamp}
                      {orderNumberDisplay ? ` · ${orderNumberDisplay}` : ''}
                    </div>
                    {activityTrace && (
                      <div className="email-activity-meta">{activityTrace}</div>
                    )}
                    {entry.lastError && (
                      <div className="email-activity-error">{entry.lastError}</div>
                    )}
                    {stalePendingNote && (
                      <div className="email-activity-error">{stalePendingNote}</div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
