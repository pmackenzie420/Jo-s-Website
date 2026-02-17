import { formatDateLong, formatCurrency, formatPhoneLink } from '../admin-utils';
import { t, tf } from '../admin-i18n';

export default function AdminCustomerModal({
  customer,
  adminLanguage,
  onClose
}) {
  if (!customer) return null;
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
          <button
            type="button"
            className="admin-button ghost modal-close"
            onClick={onClose}
          >
            {t('btn.close', adminLanguage)}
          </button>
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
          {[...customer.orders]
            .sort((a, b) => {
              const dateA = a.pickupDate || a.orderDate;
              const dateB = b.pickupDate || b.orderDate;
              return dateB.localeCompare(dateA);
            })
            .map((order) => (
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
                <div className="history-total">{formatCurrency(order.totalAmount)}</div>
              </div>
            ))}
        </div>
      </div>
    </div>
  );
}
