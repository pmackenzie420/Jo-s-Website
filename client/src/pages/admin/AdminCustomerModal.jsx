import {
  formatDateLong,
  formatCurrency,
  formatPhoneLink,
  getOrderNumberText,
  normalizeStatus
} from '../admin-utils';
import { t, tf } from '../admin-i18n';

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

const shouldShowConfirmationStatus = (status) => {
  const normalized = String(status || '').trim().toLowerCase();
  return [
    'not_sent',
    'failed',
    'bounced',
    'complained',
    'suppressed',
    'blocked'
  ].includes(normalized);
};

export default function AdminCustomerModal({
  customer,
  adminLanguage,
  onResendConfirmationEmail,
  onClose
}) {
  if (!customer) return null;
  const customerOrders = Array.isArray(customer.orders) ? customer.orders : [];
  const emailSuppression = customerOrders
    .map((order) => order?.emailSuppression)
    .find((suppression) => suppression?.active) || null;
  return (
    <div className="customer-modal-backdrop" role="dialog" aria-modal="true">
      <div className="customer-modal">
        <div className="customer-modal-header">
          <div>
            <div className="detail-name">{customer.name}</div>
            <div className="detail-meta">
              {tf('customer.orders', adminLanguage, {
                count: customer.orderCount,
                total: formatCurrency(customer.totalSpend)
              })}
            </div>
          </div>
          <div className="customer-modal-header-actions">
            <button
              type="button"
              className="admin-button ghost modal-close"
              onClick={onClose}
            >
              {t('btn.close', adminLanguage)}
            </button>
          </div>
        </div>
        <div className="detail-links">
          {customer.phone && (
            <a
              className="detail-link"
              href={`tel:${formatPhoneLink(customer.phone)}`}
            >
              {t('customer.call', adminLanguage)}
            </a>
          )}
          {customer.email && (
            <a
              className="detail-link"
              href={`mailto:${customer.email}`}
            >
              {t('customer.email', adminLanguage)}
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
        <div className="detail-history">
          {[...customerOrders]
            .sort((a, b) => {
              const dateA = a.pickupDate || a.orderDate;
              const dateB = b.pickupDate || b.orderDate;
              return dateB.localeCompare(dateA);
            })
            .map((order) => {
              const orderNumberText = getOrderNumberText(order);
              const confirmation = order?.confirmationEmail || { status: 'not_sent' };
              const rawOrderStatus = String(order?.status || '').trim().toLowerCase();
              const canResendConfirmation = Boolean(
                onResendConfirmationEmail
                && order?.customerEmail
                && ['paid', 'fulfilled', 'picked_up'].includes(rawOrderStatus)
                && normalizeStatus(order?.status) !== 'archived'
              );
              return (
                <div key={order.id} className="history-row">
                  <div>
                    <div className="history-title">
                      {orderNumberText ? `#${orderNumberText} · ` : ''}
                      {formatDateLong(order.pickupDate || order.orderDate, adminLanguage)}
                    </div>
                    <div className="history-meta">
                      {order.itemSummary || `${order.itemCount} items`}
                    </div>
                    <div className="history-payment">{order.paymentSummary}</div>
                    {shouldShowConfirmationStatus(confirmation?.status) && (
                      <div className="history-email">
                        {t('emailStatus.confirmation', adminLanguage)}: {getEmailStatusLabel(confirmation?.status, adminLanguage)}
                      </div>
                    )}
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
                    </div>
                  </div>
                </div>
              );
            })}
        </div>
      </div>
    </div>
  );
}
