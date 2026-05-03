import { useState } from 'react';
import {
  formatDateHeader,
  normalizeStatus,
  formatCurrency,
  getOrderNumberText
} from '../admin-utils';
import { t } from '../admin-i18n';
import { getOrderSourceTranslationKey, getOrderSourceType } from '../admin-order-source';

const getTodayDateKey = () => {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const isPastPickupDate = (value) => {
  const normalized = String(value || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) return false;
  return normalized < getTodayDateKey();
};

export default function AdminPickupsPage({
  dataLoading,
  groupedPickups,
  failedPickups,
  archivedPickups,
  isMobile,
  optimisticStatuses,
  ordersHasMore,
  ordersLoadingMore,
  adminLanguage,
  stats,
  onRowClick,
  onLoadMoreOrders,
  onExportAll,
  onExportInvoices,
  onExportInvoicesGroup,
  onExportGroup,
  onBulkPickup
}) {
  const [showDraftOrders, setShowDraftOrders] = useState(false);
  const [showArchivedOrders, setShowArchivedOrders] = useState(false);
  const [showPastPickups, setShowPastPickups] = useState(false);

  if (dataLoading) {
    return <div className="admin-panel">{t('pickups.loading', adminLanguage)}</div>;
  }
  if (
    groupedPickups.length === 0
    && (!failedPickups || failedPickups.length === 0)
    && (!archivedPickups || archivedPickups.length === 0)
  ) {
    return <div className="admin-panel">{t('pickups.empty', adminLanguage)}</div>;
  }

  const pickupCards = groupedPickups.flatMap((group) =>
    group.locations.map((locationGroup) => ({
      key: `${group.date}-${locationGroup.location}`,
      date: group.date,
      location: locationGroup.location,
      locationLabel: locationGroup.locationLabel,
      orders: locationGroup.orders,
      activeOrderIds: locationGroup.activeOrderIds
    }))
  );
  const pastPickupCards = pickupCards.filter((card) => isPastPickupDate(card.date));
  const currentPickupCards = pickupCards.filter((card) => !isPastPickupDate(card.date));
  const pastPickupOrderCount = pastPickupCards.reduce(
    (sum, card) => sum + (Array.isArray(card.orders) ? card.orders.length : 0),
    0
  );

  const loadMoreLabel = ordersLoadingMore
    ? t('pickups.loading_short', adminLanguage)
    : ordersHasMore
      ? t('pickups.loadMore', adminLanguage)
      : t('pickups.allLoaded', adminLanguage);

  const renderPickupRow = (order) => {
    const optimisticStatus = optimisticStatuses[order.key];
    const status = optimisticStatus || normalizeStatus(order.status);
    const pickupSummary = order.itemSummaryShort || order.itemSummary || `${order.itemCount} items`;
    const orderNumberText = getOrderNumberText(order);
    const sourceType = getOrderSourceType(order);
    const orderSourceLabel = sourceType === 'unknown'
      ? ''
      : t(getOrderSourceTranslationKey(order), adminLanguage);
    return (
      <div key={order.key} className={`pickup-row-shell ${status}`}>
        <div
          className="pickup-row-surface"
          onClick={() => onRowClick(order)}
          role="button"
          tabIndex={0}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              onRowClick(order);
            }
          }}
        >
          <div className="pickup-info">
            <div className="pickup-row-line">
              <div className="pickup-name">
                {order.customerName}
                {orderNumberText ? ` #${orderNumberText}` : ''}
              </div>
              <div className="pickup-payment">{order.paymentSummary}</div>
            </div>
            <div className="pickup-summary">
              {pickupSummary}
              {orderSourceLabel ? ` · ${orderSourceLabel}` : ''}
            </div>
          </div>
        </div>
      </div>
    );
  };

  const renderStonksCard = () => {
    if (!stats) return null;
    const feeCents = stats.stripeFeeCents || 0;
    const netCents = stats.totalExpectedCents - feeCents;
    return (
      <section className="stonks-card stagger-item">
        <div className="stonks-hero">
          <span className="stonks-hero-value">{formatCurrency(netCents / 100)}</span>
          <span className="stonks-hero-label">{t('stonks.net', adminLanguage)}</span>
        </div>
        <div className="stonks-details">
          <span>{t('stonks.paid', adminLanguage)} {formatCurrency(stats.totalPaidCents / 100)}</span>
          <span className="stonks-sep" aria-hidden="true" />
          <span>{t('stonks.due', adminLanguage)} {formatCurrency(stats.totalDueCents / 100)}</span>
          <span className="stonks-sep" aria-hidden="true" />
          <span>{t('stonks.fees', adminLanguage)} {formatCurrency(feeCents / 100)}</span>
          <span className="stonks-sep" aria-hidden="true" />
          <span>{stats.orderCount} {t('stonks.orders', adminLanguage).toLowerCase()}</span>
        </div>
      </section>
    );
  };

  const renderStatusSection = ({
    title,
    orders,
    expanded,
    onToggle
  }) => {
    if (!Array.isArray(orders) || orders.length === 0) return null;
    return (
      <section className={`pickup-day pickup-collapsible-section ${expanded ? 'open' : 'closed'} stagger-item`}>
        <div className="pickup-location">
          <div className="pickup-location-header">
            <button
              type="button"
              className="pickup-section-toggle"
              onClick={onToggle}
              aria-expanded={expanded}
            >
              <span className="pickup-location-title">{title}</span>
              <span className={`pickup-section-toggle-pill ${expanded ? 'open' : ''}`}>
                {expanded ? t('pickups.collapse', adminLanguage) : t('pickups.expand', adminLanguage)}
                <span className={`pickup-section-chevron ${expanded ? 'open' : ''}`} aria-hidden="true">▾</span>
              </span>
            </button>
          </div>
          {expanded && (
            <div className="pickup-list">
              {orders.map((order) => renderPickupRow(order))}
            </div>
          )}
        </div>
      </section>
    );
  };

  const renderFailedOrdersSection = () => renderStatusSection({
    title: t('pickups.failedOrders', adminLanguage),
    orders: failedPickups,
    expanded: showDraftOrders,
    onToggle: () => setShowDraftOrders((prev) => !prev)
  });

  const renderArchivedOrdersSection = () => renderStatusSection({
    title: t('pickups.archivedOrders', adminLanguage),
    orders: archivedPickups,
    expanded: showArchivedOrders,
    onToggle: () => setShowArchivedOrders((prev) => !prev)
  });

  const renderMobilePickupCard = (card) => (
    <section
      key={card.key}
      className="pickup-day stagger-item"
    >
      <div className="pickup-location">
        <div className="pickup-location-header">
          <div>
            <div className="pickup-location-title">
              {formatDateHeader(card.date, adminLanguage)} {card.locationLabel}
            </div>
          </div>
          <div className="pickup-location-actions">
            <button
              type="button"
              className="admin-button ghost small"
              title={t('pickups.markAllTitle', adminLanguage)}
              onClick={() => onBulkPickup(card.activeOrderIds, card.locationLabel, card.location)}
              disabled={!card.activeOrderIds?.length}
            >
              ✓
            </button>
            <button
              type="button"
              className="admin-button ghost small pickup-invoice-button"
              title={t('pickups.exportInvoicesTitle', adminLanguage)}
              onClick={() =>
                onExportInvoicesGroup(card.date, {
                  location: card.location,
                  locationLabel: card.locationLabel,
                  orders: card.orders
                })
              }
            >
              {t('pickups.exportInvoicesShort', adminLanguage)}
            </button>
            <button
              type="button"
              className="admin-button ghost small"
              title={t('pickups.exportTitle', adminLanguage)}
              onClick={() =>
                onExportGroup(card.date, {
                  location: card.location,
                  locationLabel: card.locationLabel,
                  orders: card.orders
                })
              }
            >
              ↓
            </button>
          </div>
        </div>
        <div className="pickup-list">
          {card.orders.map((order) => renderPickupRow(order))}
        </div>
      </div>
    </section>
  );

  const renderDesktopPickupCard = (card) => (
    <section
      key={card.key}
      className="pickup-card stagger-item"
    >
      <div className="pickup-card-header">
        <div className="pickup-card-title">
          {formatDateHeader(card.date, adminLanguage)} {card.locationLabel}
        </div>
        <div className="pickup-card-actions">
          <button
            type="button"
            className="admin-button ghost small"
            title={t('pickups.markAllTitle', adminLanguage)}
            onClick={() =>
              onBulkPickup(card.activeOrderIds, card.locationLabel, card.location)
            }
            disabled={!card.activeOrderIds?.length}
          >
            ✓
          </button>
          <button
            type="button"
            className="admin-button ghost small pickup-invoice-button"
            title={t('pickups.exportInvoicesTitle', adminLanguage)}
            onClick={() =>
              onExportInvoicesGroup(card.date, {
                location: card.location,
                locationLabel: card.locationLabel,
                orders: card.orders
              })
            }
          >
            {t('pickups.exportInvoicesShort', adminLanguage)}
          </button>
          <button
            type="button"
            className="admin-button ghost small"
            title={t('pickups.exportTitle', adminLanguage)}
            onClick={() =>
              onExportGroup(card.date, {
                location: card.location,
                locationLabel: card.locationLabel,
                orders: card.orders
              })
            }
          >
            ↓
          </button>
        </div>
      </div>
      <div className="pickup-list">
        {card.orders.map((order) => renderPickupRow(order))}
      </div>
    </section>
  );

  const renderPastPickupsSection = ({ mobile = false } = {}) => {
    if (pastPickupCards.length === 0) return null;
    const renderCard = mobile ? renderMobilePickupCard : renderDesktopPickupCard;
    return (
      <section className={`pickup-day pickup-past-section pickup-collapsible-section ${showPastPickups ? 'open' : 'closed'} stagger-item`}>
        <div className="pickup-location">
          <div className="pickup-location-header">
            <button
              type="button"
              className="pickup-section-toggle"
              onClick={() => setShowPastPickups((prev) => !prev)}
              aria-expanded={showPastPickups}
            >
              <span className="pickup-section-label">
                <span className="pickup-location-title">{t('pickups.pastDates', adminLanguage)}</span>
                <span className="pickup-location-meta">
                  {t('pickups.pastDatesMeta', adminLanguage)
                    .replace('{groups}', pastPickupCards.length)
                    .replace('{orders}', pastPickupOrderCount)}
                </span>
              </span>
              <span className={`pickup-section-toggle-pill ${showPastPickups ? 'open' : ''}`}>
                {showPastPickups ? t('pickups.collapse', adminLanguage) : t('pickups.expand', adminLanguage)}
                <span className={`pickup-section-chevron ${showPastPickups ? 'open' : ''}`} aria-hidden="true">▾</span>
              </span>
            </button>
          </div>
          {showPastPickups && (
            <div className={mobile ? 'pickup-past-list' : 'pickup-card-grid pickup-past-grid'}>
              {pastPickupCards.map((card) => renderCard(card))}
            </div>
          )}
        </div>
      </section>
    );
  };

  if (isMobile) {
    return (
      <div className="admin-stack pickups-stack">
        <div className="admin-action-card">
          <div className="admin-action-grid">
            <button
              className="admin-button"
              type="button"
              onClick={onExportAll}
              disabled={dataLoading}
            >
              {t('pickups.exportAll', adminLanguage)}
            </button>
            <button
              className="admin-button ghost"
              type="button"
              onClick={onExportInvoices}
              disabled={dataLoading}
            >
              {t('pickups.exportInvoices', adminLanguage)}
            </button>
            <button
              className="admin-button ghost"
              type="button"
              onClick={onLoadMoreOrders}
              disabled={!ordersHasMore || ordersLoadingMore}
            >
              {loadMoreLabel}
            </button>
          </div>
        </div>
        {renderPastPickupsSection({ mobile: true })}
        {currentPickupCards.map((card) => renderMobilePickupCard(card))}
        {renderFailedOrdersSection()}
        {renderArchivedOrdersSection()}
        {renderStonksCard()}
      </div>
    );
  }

  return (
    <div className="admin-stack pickups-stack">
      <div className="admin-action-card">
        <div className="admin-action-grid">
          <button
            className="admin-button"
            type="button"
            onClick={onExportAll}
            disabled={dataLoading}
          >
            {t('pickups.exportAll', adminLanguage)}
          </button>
          <button
            className="admin-button ghost"
            type="button"
            onClick={onExportInvoices}
            disabled={dataLoading}
          >
            {t('pickups.exportInvoices', adminLanguage)}
          </button>
          <button
            className="admin-button ghost"
            type="button"
            onClick={onLoadMoreOrders}
            disabled={!ordersHasMore || ordersLoadingMore}
          >
            {loadMoreLabel}
          </button>
        </div>
      </div>
      {renderPastPickupsSection()}
      <div className="pickup-card-grid">
        {currentPickupCards.map((card) => renderDesktopPickupCard(card))}
      </div>
      {renderFailedOrdersSection()}
      {renderArchivedOrdersSection()}
      {renderStonksCard()}
    </div>
  );
}
