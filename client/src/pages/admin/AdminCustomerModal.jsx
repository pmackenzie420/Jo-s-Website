import { formatDateLong, formatCurrency, formatPhoneLink, normalizeStatus } from '../admin-utils';
import { t, tf } from '../admin-i18n';

export default function AdminCustomerModal({
  customer,
  adminLanguage,
  onExportCustomerInvoices,
  onExportOrderInvoice,
  onClose
}) {
  if (!customer) return null;
  const customerOrders = Array.isArray(customer.orders) ? customer.orders : [];
  const exportableOrders = customerOrders.filter((order) => {
    const status = normalizeStatus(order?.status);
    return status !== 'cancelled' && status !== 'archived' && status !== 'reserved';
  });
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
              className="admin-button ghost"
              onClick={() => onExportCustomerInvoices?.(customer)}
              disabled={!exportableOrders.length}
            >
              {t('customer.exportAllInvoices', adminLanguage)}
            </button>
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
        <div className="detail-history">
          {[...customerOrders]
            .sort((a, b) => {
              const dateA = a.pickupDate || a.orderDate;
              const dateB = b.pickupDate || b.orderDate;
              return dateB.localeCompare(dateA);
            })
            .map((order) => {
              const status = normalizeStatus(order?.status);
              const canExportInvoice = status !== 'cancelled' && status !== 'archived' && status !== 'reserved';
              return (
                <div key={order.id} className="history-row">
                  <div>
                    <div className="history-title">
                      {formatDateLong(order.pickupDate || order.orderDate, adminLanguage)}
                    </div>
                    <div className="history-meta">
                      {order.itemSummary || `${order.itemCount} items`}
                    </div>
                    <div className="history-payment">{order.paymentSummary}</div>
                  </div>
                  <div className="history-row-actions">
                    <div className="history-total">{formatCurrency(order.totalAmount)}</div>
                    <div className="history-row-buttons">
                      <button
                        type="button"
                        className="admin-button ghost small"
                        onClick={() => onExportOrderInvoice?.(order)}
                        disabled={!canExportInvoice}
                      >
                        {t('customer.exportInvoice', adminLanguage)}
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
