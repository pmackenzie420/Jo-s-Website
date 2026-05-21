import {
  formatDateLong,
  formatCurrency,
  formatPhoneLink,
  getOrderNumberText
} from '../admin-utils';
import { t, tf } from '../admin-i18n';
import { getOrderSourceTranslationKey } from '../admin-order-source';

export default function AdminCustomerModal({
  customer,
  adminLanguage,
  onExportCustomerInvoices,
  onExportOrderInvoice,
  onClose
}) {
  if (!customer) return null;
  const customerOrders = Array.isArray(customer.orders) ? customer.orders : [];
  const emailSuppression = customerOrders
    .map((order) => order?.emailSuppression)
    .find((suppression) => suppression?.active) || null;
  const sortedOrders = [...customerOrders].sort((a, b) => {
    const dateA = a.pickupDate || a.orderDate || '';
    const dateB = b.pickupDate || b.orderDate || '';
    return dateB.localeCompare(dateA);
  });

  return (
    <div
      className="customer-modal-backdrop"
      role="dialog"
      aria-modal="true"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <div className="customer-modal pickup-detail-modal customer-detail-modal">
        <button
          type="button"
          className="pickup-detail-close"
          onClick={onClose}
          aria-label={t('btn.close', adminLanguage)}
          title={t('btn.close', adminLanguage)}
        >
          ×
        </button>
        <div className="pickup-detail-card">
          <div className="pickup-detail-top">
            <div className="pickup-detail-heading">
              <div className="detail-name">{customer.name}</div>
              <div className="pickup-detail-subtitle">
                {tf('customer.orders', adminLanguage, {
                  count: customer.orderCount,
                  total: formatCurrency(customer.totalSpend)
                })}
              </div>
            </div>
            {customerOrders.length > 0 && (
              <button
                type="button"
                className="admin-button ghost small"
                onClick={() => onExportCustomerInvoices?.(customer)}
                disabled={typeof onExportCustomerInvoices !== 'function'}
              >
                {t('customer.exportAllInvoices', adminLanguage)}
              </button>
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
          <div className="customer-detail-orders">
            {sortedOrders.map((order) => {
              const orderStatus = String(order?.status || '').trim().toLowerCase();
              const canExportInvoice = !['cancelled', 'archived', 'reserved'].includes(orderStatus);
              const orderNumberText = getOrderNumberText(order);
              const orderSourceLabel = t(getOrderSourceTranslationKey(order), adminLanguage);
              const orderDate = formatDateLong(
                order.pickupDate || order.orderDate,
                adminLanguage
              );
              const itemSummary = order.itemSummary || `${order.itemCount} items`;
              const paymentDetails = [
                order.pickupLocationLabel || order.pickupLocation,
                order.paymentSummary
              ].filter(Boolean).join(' · ');

              return (
                <div key={order.id} className="customer-detail-order">
                  <div className="customer-detail-order-top">
                    <div className="history-title">
                      {orderNumberText ? `#${orderNumberText} · ` : ''}
                      {orderDate}
                    </div>
                    <div className="history-total">{formatCurrency(order.totalAmount)}</div>
                  </div>
                  <div className="history-meta">{itemSummary}</div>
                  <div className="history-payment">{paymentDetails}</div>
                  <div className="history-meta">
                    {t('orderSource.label', adminLanguage)}: {orderSourceLabel}
                  </div>
                  <div className="customer-detail-order-actions">
                    <button
                      type="button"
                      className="admin-button ghost small"
                      onClick={() => onExportOrderInvoice?.(order)}
                      disabled={typeof onExportOrderInvoice !== 'function' || !canExportInvoice}
                    >
                      {t('customer.exportInvoice', adminLanguage)}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
          {(customer.phone || customer.email || customer.address) && (
            <div className="pickup-detail-footer">
              <div className="pickup-detail-contact">
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
                {customer.phone && (
                  <span className="pickup-detail-contact-value">{customer.phone}</span>
                )}
              </div>
              {customer.address && (
                <div className="pickup-detail-contact-subtle">{customer.address}</div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
