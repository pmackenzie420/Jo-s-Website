import {
  formatDateLong,
  formatCurrency,
  formatPhoneLink,
  normalizeStatus
} from '../admin-utils';

export default function AdminPickupModal({
  pickup,
  optimisticStatuses,
  onClose,
  onMarkPickedUp
}) {
  if (!pickup) return null;

  const effectiveStatus = normalizeStatus(
    optimisticStatuses[pickup.key] || pickup.status
  );

  return (
    <div className="customer-modal-backdrop" role="dialog" aria-modal="true">
      <div className="customer-modal">
        <div className="customer-modal-header">
          <div>
            <div className="detail-name">{pickup.customerName}</div>
            <div className="detail-meta">
              Pickup {formatDateLong(pickup.pickupDate)} ·{' '}
              {pickup.pickupLocationLabel || pickup.pickupLocation}
            </div>
            <div className="detail-meta">{pickup.paymentSummary}</div>
          </div>
          <button
            type="button"
            className="admin-button ghost modal-close"
            onClick={onClose}
          >
            Close
          </button>
        </div>
        {pickup.customerAddress && (
          <div className="detail-meta">{pickup.customerAddress}</div>
        )}
        {pickup.orders?.length > 1 && (
          <div className="detail-flag">
            Merged from {pickup.orders.length} orders
          </div>
        )}
        <div className="detail-links">
          {pickup.customerPhone && (
            <a
              className="detail-link"
              href={`tel:${formatPhoneLink(pickup.customerPhone)}`}
            >
              Call
            </a>
          )}
          {pickup.customerEmail && (
            <a
              className="detail-link"
              href={`mailto:${pickup.customerEmail}`}
            >
              Email
            </a>
          )}
        </div>
        <button
          type="button"
          className="admin-button"
          onClick={() => onMarkPickedUp(pickup)}
          disabled={effectiveStatus !== 'pending'}
        >
          {effectiveStatus === 'picked_up'
            ? 'Picked Up'
            : 'Mark Picked Up'}
        </button>
        {pickup.mergedItems?.length > 0 && (
          <div className="detail-section">
            <div className="detail-section-title">Items</div>
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
              {pickup.orders.length > 1 ? 'Order Breakdown' : 'Order Details'}
            </div>
            <div className="detail-history">
              {[...pickup.orders]
                .sort((a, b) => b.orderDate.localeCompare(a.orderDate))
                .map((order) => (
                  <div key={order.id} className="history-row">
                    <div>
                      <div className="history-title">Order #{order.id}</div>
                      <div className="history-meta">
                        Placed {formatDateLong(order.orderDate)}
                      </div>
                      <div className="history-meta">
                        Pickup {formatDateLong(order.pickupDate)}
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
        )}
      </div>
    </div>
  );
}
