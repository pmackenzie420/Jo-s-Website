import { formatDateLong, formatCurrency, formatPhoneLink } from '../admin-utils';

export default function AdminCustomerModal({
  customer,
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
              {customer.orderCount} orders - {formatCurrency(customer.totalSpend)} total
            </div>
          </div>
          <button
            type="button"
            className="admin-button ghost modal-close"
            onClick={onClose}
          >
            Close
          </button>
        </div>
        <div className="detail-links">
          {customer.phone && (
            <a
              className="detail-link"
              href={`tel:${formatPhoneLink(customer.phone)}`}
            >
              Call
            </a>
          )}
          {customer.email && (
            <a
              className="detail-link"
              href={`mailto:${customer.email}`}
            >
              Email
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
                    {formatDateLong(order.pickupDate || order.orderDate)}
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
