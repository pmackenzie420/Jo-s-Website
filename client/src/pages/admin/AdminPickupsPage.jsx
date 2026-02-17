import { formatDateHeader, normalizeStatus } from '../admin-utils';
import { t } from '../admin-i18n';

export default function AdminPickupsPage({
  dataLoading,
  groupedPickups,
  failedPickups,
  isMobile,
  optimisticStatuses,
  ordersHasMore,
  ordersLoadingMore,
  adminLanguage,
  onRowClick,
  onLoadMoreOrders,
  onExportAll,
  onExportGroup,
  onBulkPickup
}) {
  if (dataLoading) {
    return <div className="admin-panel">{t('pickups.loading', adminLanguage)}</div>;
  }
  if (groupedPickups.length === 0 && (!failedPickups || failedPickups.length === 0)) {
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

  const loadMoreLabel = ordersLoadingMore
    ? t('pickups.loading_short', adminLanguage)
    : ordersHasMore
      ? t('pickups.loadMore', adminLanguage)
      : t('pickups.allLoaded', adminLanguage);

  const renderPickupRow = (order) => {
    const optimisticStatus = optimisticStatuses[order.key];
    const status = optimisticStatus || normalizeStatus(order.status);
    const pickupSummary = order.itemSummaryShort || order.itemSummary || `${order.itemCount} items`;
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
              <div className="pickup-name">{order.customerName}</div>
              <div className="pickup-payment">{order.paymentSummary}</div>
            </div>
            <div className="pickup-summary">{pickupSummary}</div>
          </div>
        </div>
      </div>
    );
  };

  const renderFailedOrdersSection = () => {
    if (!Array.isArray(failedPickups) || failedPickups.length === 0) return null;
    return (
      <section className="pickup-day stagger-item">
        <div className="pickup-location">
          <div className="pickup-location-header">
            <div className="pickup-location-title">{t('pickups.failedOrders', adminLanguage)}</div>
          </div>
          <div className="pickup-list">
            {failedPickups.map((order) => renderPickupRow(order))}
          </div>
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
              onClick={onLoadMoreOrders}
              disabled={!ordersHasMore || ordersLoadingMore}
            >
              {loadMoreLabel}
            </button>
          </div>
        </div>
        {groupedPickups.flatMap((group) =>
          group.locations.map((locationGroup) => (
            <section
              key={`${group.date}-${locationGroup.location}`}
              className="pickup-day stagger-item"
            >
              <div className="pickup-location">
                <div className="pickup-location-header">
                  <div>
                    <div className="pickup-location-title">
                      {formatDateHeader(group.date, adminLanguage)} {locationGroup.locationLabel}
                    </div>
                  </div>
                  <div className="pickup-location-actions">
                    <button
                      type="button"
                      className="admin-button ghost small"
                      title={t('pickups.markAllTitle', adminLanguage)}
                      onClick={() =>
                        onBulkPickup(
                          locationGroup.activeOrderIds,
                          locationGroup.locationLabel,
                          locationGroup.location
                        )
                      }
                      disabled={!locationGroup.activeOrderIds?.length}
                    >
                      ✓
                    </button>
                    <button
                      type="button"
                      className="admin-button ghost small"
                      title={t('pickups.exportTitle', adminLanguage)}
                      onClick={() => onExportGroup(group.date, locationGroup)}
                    >
                      ↓
                    </button>
                  </div>
                </div>
                <div className="pickup-list">
                  {locationGroup.orders.map((order) => renderPickupRow(order))}
                </div>
              </div>
            </section>
          ))
        )}
        {renderFailedOrdersSection()}
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
            onClick={onLoadMoreOrders}
            disabled={!ordersHasMore || ordersLoadingMore}
          >
            {loadMoreLabel}
          </button>
        </div>
      </div>
      <div className="pickup-card-grid">
        {pickupCards.map((card) => (
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
        ))}
      </div>
      {renderFailedOrdersSection()}
    </div>
  );
}
