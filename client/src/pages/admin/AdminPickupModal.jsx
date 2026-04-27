import {
  formatDateLong,
  formatCurrency,
  formatPhoneLink,
  normalizeStatus,
  getOrderNumberText
} from '../admin-utils';
import { t, tf } from '../admin-i18n';
import { getOrderSourceTranslationKey } from '../admin-order-source';

const stripDueSuffix = (value) => String(value || '')
  .replace(/\s*·\s*Due\s+\$[\d,.]+/i, '')
  .trim();

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
  const emailSuppression = (Array.isArray(pickup.orders) ? pickup.orders : [])
    .map((order) => order?.emailSuppression)
    .find((suppression) => suppression?.active) || null;
  const sortedOrders = [...(Array.isArray(pickup.orders) ? pickup.orders : [])]
    .sort((a, b) => b.orderDate.localeCompare(a.orderDate));
  const primaryOrder = sortedOrders[0] || null;
  const isSingleOrder = sortedOrders.length === 1;
  const orderNumbers = Array.from(
    new Set(
      sortedOrders
        .map((order) => getOrderNumberText(order))
        .filter(Boolean)
    )
  );
  const orderNumbersDisplay = orderNumbers.map((orderNumber) => `#${orderNumber}`).join(', ');
  const orderNumbersLabel = adminLanguage === 'fr' ? 'No commande' : 'Order';
  const primaryOrderNumberText = primaryOrder ? getOrderNumberText(primaryOrder) : '';
  const primaryOrderSourceLabel = primaryOrder
    ? t(getOrderSourceTranslationKey(primaryOrder), adminLanguage)
    : t('orderSource.unknown', adminLanguage);
  const paymentFactText = primaryOrder
    ? stripDueSuffix(primaryOrder.paymentSummary) || primaryOrder.paymentSummary
    : pickup.paymentSummary;
  const badgeText = pickup.amountDue > 0
    ? `${t('edit.due', adminLanguage)} ${formatCurrency(pickup.amountDue)}`
    : effectiveStatus === 'picked_up'
      ? t('pickup.pickedUp', adminLanguage)
      : effectiveStatus === 'cancelled'
        ? 'Cancelled'
        : effectiveStatus === 'archived'
          ? 'Archived'
          : t('edit.paid', adminLanguage);
  const badgeTone = pickup.amountDue > 0
    ? 'due'
    : effectiveStatus === 'picked_up'
      ? 'success'
      : effectiveStatus === 'cancelled' || effectiveStatus === 'archived'
        ? 'muted'
        : 'paid';
  const singleOrderStatus = normalizeStatus(primaryOrder?.status);
  const canExportPrimaryOrder = Boolean(
    primaryOrder
    && onExportOrderInvoice
    && !['cancelled', 'archived', 'reserved'].includes(singleOrderStatus)
  );
  const canEditPrimaryOrder = Boolean(
    primaryOrder
    && onEditOrder
    && ['pending', 'paid'].includes(String(primaryOrder?.status || '').toLowerCase())
  );
  const canArchivePrimaryOrder = Boolean(
    primaryOrder
    && onArchiveOrder
    && ['pending', 'paid', 'cancelled', 'archived'].includes(singleOrderStatus)
  );
  const singleOrderArchiveLabel = singleOrderStatus === 'archived'
    ? t('pickup.unarchive', adminLanguage)
    : t('pickup.archive', adminLanguage);
  const singleOrderPrefix = primaryOrderNumberText
    ? `${orderNumbersLabel} #${primaryOrderNumberText}`
    : orderNumbersLabel;
  const headerSubtitle = isSingleOrder && primaryOrder
    ? `${singleOrderPrefix} · ${t('pickup.placed', adminLanguage)} ${formatDateLong(primaryOrder.orderDate, adminLanguage)}`
    : `${t('pickup.pickupLabel', adminLanguage)} ${formatDateLong(pickup.pickupDate, adminLanguage)}${orderNumbersDisplay ? ` · ${orderNumbersDisplay}` : ''}`;

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
      <div className="customer-modal pickup-detail-modal">
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
              <div className="detail-name">{pickup.customerName}</div>
              <div className="pickup-detail-subtitle">{headerSubtitle}</div>
            </div>
            <div className={`pickup-detail-pill ${badgeTone}`}>{badgeText}</div>
          </div>
          {pickup.orders?.length > 1 && (
            <div className="detail-flag">
              {tf('pickup.mergedFrom', adminLanguage, { count: pickup.orders.length })}
            </div>
          )}
          <div className="pickup-detail-facts">
            <div className="pickup-detail-fact">
              <div className="pickup-detail-fact-label">{t('pickup.pickupLabel', adminLanguage)}</div>
              <div className="pickup-detail-fact-value">
                {formatDateLong(pickup.pickupDate, adminLanguage)}
              </div>
            </div>
            <div className="pickup-detail-fact">
              <div className="pickup-detail-fact-label">{t('pickup.locationLabel', adminLanguage)}</div>
              <div className="pickup-detail-fact-value">
                {pickup.pickupLocationLabel || pickup.pickupLocation}
              </div>
            </div>
            <div className="pickup-detail-fact">
              <div className="pickup-detail-fact-label">{t('pickup.paymentLabel', adminLanguage)}</div>
              <div className="pickup-detail-fact-value">{paymentFactText || pickup.paymentSummary}</div>
            </div>
          </div>
          {pickup.mergedItems?.length > 0 && (
            <div className="pickup-detail-section">
              <div className="detail-section-title">{t('pickup.itemsTitle', adminLanguage)}</div>
              <div className="pickup-detail-items">
                {pickup.mergedItems.map((item) => (
                  <div
                    key={`${pickup.key}-${item.displayName}`}
                    className="pickup-detail-item-row"
                  >
                    <div className="pickup-detail-item-name">{item.displayName}</div>
                    <div className="pickup-detail-item-qty">×{item.quantity}</div>
                  </div>
                ))}
              </div>
            </div>
          )}
          {isSingleOrder && primaryOrder && (
            <div className="pickup-detail-section pickup-detail-statuses">
              <div className="pickup-detail-meta-row">
                <div className="pickup-detail-meta-label">{t('orderSource.label', adminLanguage)}</div>
                <div className="pickup-detail-meta-value">{primaryOrderSourceLabel}</div>
              </div>
            </div>
          )}
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
          <button
            type="button"
            className="admin-button pickup-detail-primary"
            onClick={() => onMarkPickedUp(pickup)}
            disabled={effectiveStatus !== 'pending'}
          >
            {effectiveStatus === 'picked_up'
              ? t('pickup.pickedUp', adminLanguage)
              : t('pickup.markPickedUp', adminLanguage)}
          </button>
          {isSingleOrder && primaryOrder && (
            <div className="pickup-detail-actions">
              <button
                type="button"
                className="admin-button ghost"
                onClick={() => onExportOrderInvoice?.(primaryOrder)}
                disabled={!canExportPrimaryOrder}
              >
                {t('pickup.exportInvoice', adminLanguage)}
              </button>
              <button
                type="button"
                className="admin-button ghost"
                onClick={() => onEditOrder?.(primaryOrder)}
                disabled={!canEditPrimaryOrder}
              >
                {t('btn.edit', adminLanguage)}
              </button>
              <button
                type="button"
                className="admin-button ghost danger"
                onClick={() => onArchiveOrder?.(primaryOrder)}
                disabled={!canArchivePrimaryOrder}
              >
                {singleOrderArchiveLabel}
              </button>
            </div>
          )}
          {(pickup.customerPhone || pickup.customerEmail || pickup.customerAddress) && (
            <div className="pickup-detail-footer">
              <div className="pickup-detail-contact">
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
                {pickup.customerPhone && (
                  <span className="pickup-detail-contact-value">{pickup.customerPhone}</span>
                )}
              </div>
              {pickup.customerAddress && (
                <div className="pickup-detail-contact-subtle">{pickup.customerAddress}</div>
              )}
            </div>
          )}
          {!isSingleOrder && sortedOrders.length > 0 && (
            <div className="pickup-detail-section">
              <div className="detail-section-title">{t('pickup.orderBreakdown', adminLanguage)}</div>
              <div className="detail-history">
                {sortedOrders.map((order) => {
                  const orderStatus = normalizeStatus(order?.status);
                  const canExportInvoice = orderStatus !== 'cancelled' && orderStatus !== 'archived' && orderStatus !== 'reserved';
                  const orderNumberText = getOrderNumberText(order);
                  const canToggleArchive = ['pending', 'paid', 'cancelled', 'archived'].includes(orderStatus);
                  const archiveLabel = orderStatus === 'archived'
                    ? t('pickup.unarchive', adminLanguage)
                    : t('pickup.archive', adminLanguage);
                  const orderSourceLabel = t(getOrderSourceTranslationKey(order), adminLanguage);
                  return (
                    <div key={order.id} className="history-row pickup-detail-order-row">
                      <div>
                        <div className="history-title">
                          {orderNumberText ? `#${orderNumberText} · ` : ''}
                          {t('pickup.placed', adminLanguage)} {formatDateLong(order.orderDate, adminLanguage)}
                        </div>
                        <div className="history-meta">
                          {order.itemSummary || `${order.itemCount} items`}
                          {' · '}{order.paymentSummary}
                        </div>
                        <div className="history-meta">
                          {t('orderSource.label', adminLanguage)}: {orderSourceLabel}
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
    </div>
  );
}
