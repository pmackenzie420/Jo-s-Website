import {
  formatDateLong,
  formatCurrency,
  formatPhoneLink,
  normalizeStatus,
  getOrderNumberText
} from '../admin-utils';
import { t, tf } from '../admin-i18n';

export default function AdminPickupModal({
  pickup,
  adminLanguage,
  optimisticStatuses,
  onClose,
  onMarkPickedUp,
  onExportOrderInvoice,
  onEditOrder,
  onArchiveOrder
}) {
  if (!pickup) return null;

  const effectiveStatus = normalizeStatus(
    optimisticStatuses[pickup.key] || pickup.status
  );
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
                  const canExportInvoice = orderStatus !== 'cancelled' && orderStatus !== 'archived' && orderStatus !== 'reserved';
                  const orderNumberText = getOrderNumberText(order);
                  const canToggleArchive = ['pending', 'paid', 'cancelled', 'archived'].includes(orderStatus);
                  const archiveLabel = orderStatus === 'archived'
                    ? t('pickup.unarchive', adminLanguage)
                    : t('pickup.archive', adminLanguage);
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
                      </div>
                      <div className="history-row-actions">
                        <div className="history-total">{formatCurrency(order.totalAmount)}</div>
                        <div className="history-row-buttons">
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
      </div>
    </div>
  );
}
