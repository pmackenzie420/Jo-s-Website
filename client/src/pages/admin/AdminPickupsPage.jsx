import { formatDateHeader, normalizeStatus } from '../admin-utils';

export default function AdminPickupsPage({
  dataLoading,
  groupedPickups,
  failedPickups,
  isMobile,
  optimisticStatuses,
  ordersHasMore,
  ordersLoadingMore,
  onRowClick,
  onLoadMoreOrders,
  onExportAll,
  onExportGroup,
  onBulkPickup
}) {
  if (dataLoading) {
    return <div className="admin-panel">Loading pickups...</div>;
  }
  if (groupedPickups.length === 0 && (!failedPickups || failedPickups.length === 0)) {
    return <div className="admin-panel">No pickups scheduled yet.</div>;
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
            <div className="pickup-location-title">Failed Orders</div>
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
              Export All
            </button>
            <button
              className="admin-button ghost"
              type="button"
              onClick={onLoadMoreOrders}
              disabled={!ordersHasMore || ordersLoadingMore}
            >
              {ordersLoadingMore ? 'Loading...' : ordersHasMore ? 'Load More Orders' : 'All Orders Loaded'}
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
                      {formatDateHeader(group.date)} {locationGroup.locationLabel}
                    </div>
                  </div>
                  <div className="pickup-location-actions">
                    <button
                      type="button"
                      className="admin-button ghost small"
                      title="Mark All Picked Up"
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
                      title="Export List"
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
            Export All
          </button>
          <button
            className="admin-button ghost"
            type="button"
            onClick={onLoadMoreOrders}
            disabled={!ordersHasMore || ordersLoadingMore}
          >
            {ordersLoadingMore ? 'Loading...' : ordersHasMore ? 'Load More Orders' : 'All Orders Loaded'}
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
                {formatDateHeader(card.date)} {card.locationLabel}
              </div>
              <div className="pickup-card-actions">
                <button
                  type="button"
                  className="admin-button ghost small"
                  title="Mark All Picked Up"
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
                  title="Export List"
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
