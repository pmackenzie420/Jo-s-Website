import { formatDateLong } from '../admin-utils';

export default function AdminSearchPage({
  dataLoading,
  filteredCustomers,
  ordersHasMore,
  ordersLoadingMore,
  onLoadMoreOrders,
  onSelectCustomer
}) {
  if (dataLoading) {
    return <div className="admin-panel">Loading customers...</div>;
  }
  return (
    <div className="admin-stack">
      <section className="admin-panel stagger-item">
        <div className="panel-header">
          <div>
            <div className="panel-title">Customers</div>
          </div>
        </div>
        <div className="customer-list">
          {filteredCustomers.length === 0 && (
            <div className="empty-state">No customers match that search.</div>
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
                {customer.orderCount} orders - last {formatDateLong(customer.lastOrderDate)}
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
              {ordersLoadingMore ? 'Loading...' : ordersHasMore ? 'Load More Customer Data' : 'All Customer Data Loaded'}
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}
