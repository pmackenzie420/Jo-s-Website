import {
  formatDateLong,
  formatCurrency,
  formatPhoneLink,
  normalizeStatus,
  getOrderNumberText
} from '../admin-utils';
import { t, tf } from '../admin-i18n';

const formatDateTime = (value, language) => {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return '';
  return new Intl.DateTimeFormat(language === 'fr' ? 'fr-CA' : 'en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit'
  }).format(parsed);
};

const getEmailStatusLabel = (status, language) => {
  const normalized = String(status || '').trim().toLowerCase();
  const map = {
    not_sent: t('emailStatus.notSent', language),
    sent: t('emailStatus.sent', language),
    delivered: t('emailStatus.delivered', language),
    failed: t('emailStatus.failed', language),
    bounced: t('emailStatus.bounced', language),
    complained: t('emailStatus.complained', language),
    suppressed: t('emailStatus.suppressedShort', language),
    blocked: t('emailStatus.blocked', language),
    warning: t('emailStatus.warning', language)
  };
  return map[normalized] || normalized || t('emailStatus.notSent', language);
};

const getEmailTypeLabel = (emailType, language) => {
  const normalized = String(emailType || '').trim().toLowerCase();
  const map = {
    confirmation: t('emailType.confirmation', language),
    pickup_reminder: t('emailType.pickupReminder', language),
    pickup_date_change: t('emailType.pickupDateChange', language),
    admin_message: t('emailType.adminMessage', language)
  };
  return map[normalized] || normalized || t('emailStatus.section', language);
};

export default function AdminPickupModal({
  pickup,
  adminLanguage,
  optimisticStatuses,
  onClose,
  onMarkPickedUp,
  onExportOrderInvoice,
  onEditOrder,
  onArchiveOrder,
  onResendConfirmationEmail
}) {
  if (!pickup) return null;

  const effectiveStatus = normalizeStatus(
    optimisticStatuses[pickup.key] || pickup.status
  );
  const emailSuppression = (Array.isArray(pickup.orders) ? pickup.orders : [])
    .map((order) => order?.emailSuppression)
    .find((suppression) => suppression?.active) || null;
  const recentEmailActivity = (Array.isArray(pickup.orders) ? pickup.orders : [])
    .flatMap((order) => (
      Array.isArray(order?.emailHistory)
        ? order.emailHistory.map((entry) => ({
          ...entry,
          orderId: order.id,
          orderNumberText: getOrderNumberText(order)
        }))
        : []
    ))
    .sort((left, right) => (
      String(right?.lastEventAt || right?.createdAt || '').localeCompare(
        String(left?.lastEventAt || left?.createdAt || '')
      )
    ))
    .slice(0, 5);
  const orderNumbers = Array.from(
    new Set(
      (Array.isArray(pickup.orders) ? pickup.orders : [])
        .map((order) => getOrderNumberText(order))
        .filter(Boolean)
    )
  );
  const orderNumbersDisplay = orderNumbers.map((orderNumber) => `#${orderNumber}`).join(', ');
  const orderNumbersLabel = adminLanguage === 'fr' ? 'No commande' : 'Order';

  return (
    <div className="customer-modal-backdrop" role="dialog" aria-modal="true">
      <div className="customer-modal">
        <div className="customer-modal-header">
          <div>
            <div className="detail-name">{pickup.customerName}</div>
            {orderNumbersDisplay && (
              <div className="detail-meta">{orderNumbersLabel} {orderNumbersDisplay}</div>
            )}
            <div className="detail-meta">
              {t('pickup.pickupLabel', adminLanguage)} {formatDateLong(pickup.pickupDate, adminLanguage)} ·{' '}
              {pickup.pickupLocationLabel || pickup.pickupLocation}
              {pickup.paymentSummary ? ` · ${pickup.paymentSummary}` : ''}
            </div>
            {pickup.customerAddress && (
              <div className="detail-meta">{pickup.customerAddress}</div>
            )}
            <div className="detail-links">
              {pickup.customerPhone && (
                <a
                  className="detail-link"
                  href={`tel:${formatPhoneLink(pickup.customerPhone)}`}
                >
                  {t('pickup.call', adminLanguage)}
                </a>
              )}
              {pickup.customerEmail && (
                <a
                  className="detail-link"
                  href={`mailto:${pickup.customerEmail}`}
                >
                  {t('pickup.email', adminLanguage)}
                </a>
              )}
            </div>
            {emailSuppression?.active && (
              <div className="detail-email-alert">
                <div className="detail-email-alert-title">{t('emailStatus.suppressed', adminLanguage)}</div>
                {emailSuppression.reason && (
                  <div className="detail-email-alert-reason">
                    {tf('emailStatus.suppressedReason', adminLanguage, {
                      reason: emailSuppression.reason
                    })}
                  </div>
                )}
              </div>
            )}
          </div>
          <button
            type="button"
            className="admin-button ghost modal-close"
            onClick={onClose}
          >
            {t('btn.close', adminLanguage)}
          </button>
        </div>
        {pickup.orders?.length > 1 && (
          <div className="detail-flag">
            {tf('pickup.mergedFrom', adminLanguage, { count: pickup.orders.length })}
          </div>
        )}
        <button
          type="button"
          className="admin-button"
          onClick={() => onMarkPickedUp(pickup)}
          disabled={effectiveStatus !== 'pending'}
        >
          {effectiveStatus === 'picked_up'
            ? t('pickup.pickedUp', adminLanguage)
            : t('pickup.markPickedUp', adminLanguage)}
        </button>
        {['cancelled', 'archived'].includes(effectiveStatus) && onArchiveOrder && (
          <button
            type="button"
            className="admin-button ghost"
            onClick={() => onArchiveOrder(pickup)}
          >
            {effectiveStatus === 'archived'
              ? t('pickup.unarchive', adminLanguage)
              : t('pickup.archive', adminLanguage)}
          </button>
        )}
        {pickup.mergedItems?.length > 0 && (
          <div className="detail-section">
            <div className="detail-section-title">{t('pickup.itemsTitle', adminLanguage)}</div>
            <div className="detail-history">
              {pickup.mergedItems.map((item) => (
                <div
                  key={`${pickup.key}-${item.displayName}`}
                  className="history-row"
                >
                  <div className="history-title">{item.displayName}</div>
                  <div className="history-total">{item.quantity}</div>
                </div>
              ))}
            </div>
          </div>
        )}
        {pickup.orders?.length > 0 && (
          <div className="detail-section">
            <div className="detail-section-title">
              {pickup.orders.length > 1
                ? t('pickup.orderBreakdown', adminLanguage)
                : t('pickup.orderDetails', adminLanguage)}
            </div>
            <div className="detail-history">
              {[...pickup.orders]
                .sort((a, b) => b.orderDate.localeCompare(a.orderDate))
                .map((order) => {
                  const orderStatus = normalizeStatus(order?.status);
                  const rawOrderStatus = String(order?.status || '').trim().toLowerCase();
                  const canExportInvoice = orderStatus !== 'cancelled' && orderStatus !== 'archived' && orderStatus !== 'reserved';
                  const orderNumberText = getOrderNumberText(order);
                  const canToggleArchive = ['pending', 'paid', 'cancelled', 'archived'].includes(orderStatus);
                  const archiveLabel = orderStatus === 'archived'
                    ? t('pickup.unarchive', adminLanguage)
                    : t('pickup.archive', adminLanguage);
                  const confirmation = order?.confirmationEmail || { status: 'not_sent' };
                  const confirmationTimestamp = formatDateTime(
                    confirmation?.createdAt,
                    adminLanguage
                  );
                  const canResendConfirmation = Boolean(
                    onResendConfirmationEmail
                    && order?.customerEmail
                    && ['paid', 'fulfilled', 'picked_up'].includes(rawOrderStatus)
                  );
                  return (
                    <div key={order.id} className="history-row">
                      <div>
                        <div className="history-meta">
                          {orderNumberText ? `#${orderNumberText} · ` : ''}
                          {t('pickup.placed', adminLanguage)} {formatDateLong(order.orderDate, adminLanguage)}
                          {pickup.orders.length > 1 && (
                            <> · {order.itemSummary || `${order.itemCount} items`}</>
                          )}
                          {' '}· {order.paymentSummary}
                        </div>
                        <div className="history-email">
                          {t('emailStatus.confirmation', adminLanguage)}: {getEmailStatusLabel(confirmation?.status, adminLanguage)}
                          {confirmationTimestamp ? ` · ${confirmationTimestamp}` : ''}
                        </div>
                        {confirmation?.error && (
                          <div className="history-email-error">{confirmation.error}</div>
                        )}
                      </div>
                      <div className="history-row-actions">
                        <div className="history-total">{formatCurrency(order.totalAmount)}</div>
                        <div className="history-row-buttons">
                          <button
                            type="button"
                            className="admin-button ghost small"
                            onClick={() => onResendConfirmationEmail?.(order)}
                            disabled={!canResendConfirmation}
                          >
                            {t('emailStatus.resendConfirmation', adminLanguage)}
                          </button>
                          <button
                            type="button"
                            className="admin-button ghost small"
                            onClick={() => onExportOrderInvoice?.(order)}
                            disabled={typeof onExportOrderInvoice !== 'function' || !canExportInvoice}
                          >
                            {t('pickup.exportInvoice', adminLanguage)}
                          </button>
                          <button
                            type="button"
                            className="admin-button ghost small"
                            onClick={() => onEditOrder?.(order)}
                            disabled={
                              typeof onEditOrder !== 'function'
                              || !['pending', 'paid'].includes(String(order.status || '').toLowerCase())
                            }
                          >
                            {t('btn.edit', adminLanguage)}
                          </button>
                          <button
                            type="button"
                            className="admin-button ghost small danger"
                            onClick={() => onArchiveOrder?.(order)}
                            disabled={
                              typeof onArchiveOrder !== 'function'
                              || !canToggleArchive
                            }
                          >
                            {archiveLabel}
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}
            </div>
          </div>
        )}
        {recentEmailActivity.length > 0 && (
          <div className="detail-section">
            <div className="detail-section-title">{t('emailStatus.recentActivity', adminLanguage)}</div>
            <div className="detail-history">
              {recentEmailActivity.map((entry) => {
                const activityTimestamp = formatDateTime(
                  entry?.lastEventAt || entry?.createdAt,
                  adminLanguage
                );
                return (
                  <div key={entry.id} className="history-row">
                    <div>
                      <div className="history-title">
                        {entry.orderNumberText ? `#${entry.orderNumberText} · ` : ''}
                        {getEmailTypeLabel(entry.emailType, adminLanguage)}
                      </div>
                      <div className="history-meta">
                        {getEmailStatusLabel(entry.sendStatus, adminLanguage)}
                        {activityTimestamp ? ` · ${activityTimestamp}` : ''}
                      </div>
                      {entry.lastError && (
                        <div className="history-email-error">{entry.lastError}</div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
