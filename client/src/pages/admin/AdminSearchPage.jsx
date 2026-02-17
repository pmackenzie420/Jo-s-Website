import { formatDateLong } from '../admin-utils';
import { t, tf } from '../admin-i18n';

export default function AdminSearchPage({
  dataLoading,
  searchQuery,
  onSearchChange,
  filteredCustomers,
  ordersHasMore,
  ordersLoadingMore,
  adminLanguage,
  onLoadMoreOrders,
  onSelectCustomer
}) {
  if (dataLoading) {
    return <div className="admin-panel">{t('search.loading', adminLanguage)}</div>;
  }

  const loadMoreLabel = ordersLoadingMore
    ? t('pickups.loading_short', adminLanguage)
    : ordersHasMore
      ? t('search.loadMore', adminLanguage)
      : t('search.allLoaded', adminLanguage);

  return (
    <div className="admin-stack">
      <div className="admin-search-bar">
        <input
          className="admin-input"
          placeholder={t('search.placeholder', adminLanguage)}
          value={searchQuery}
          onChange={(event) => onSearchChange(event.target.value)}
        />
      </div>
      <section className="admin-panel stagger-item">
        <div className="panel-header">
          <div>
            <div className="panel-title">{t('search.title', adminLanguage)}</div>
          </div>
        </div>
        <div className="customer-list">
          {filteredCustomers.length === 0 && (
            <div className="empty-state">{t('search.empty', adminLanguage)}</div>
          )}
          {filteredCustomers.map((customer) => (
            <button
              key={customer.key}
              type="button"
              className="customer-row"
              onClick={() => onSelectCustomer(customer)}
            >
              <div className="customer-row-name">{customer.name}</div>
              <div className="customer-row-meta">
                {tf('search.orders', adminLanguage, {
                  count: customer.orderCount,
                  date: formatDateLong(customer.lastOrderDate, adminLanguage)
                })}
              </div>
            </button>
          ))}
          <div className="customer-list-footer">
            <button
              type="button"
              className="admin-button ghost"
              onClick={onLoadMoreOrders}
              disabled={!ordersHasMore || ordersLoadingMore}
            >
              {loadMoreLabel}
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}
