import { useEffect, useMemo, useRef, useState } from 'react';
import axios from 'axios';
import '../styles/pages/Admin.css';

const API_URL = '/api';
const ADMIN_AUTH_KEY = 'adminAuth';

const LOCATION_LABELS = {
  hemmingford: 'Hemmingford',
  bristol: 'Bristol'
};

const TAB_CONFIG = [
  { key: 'pickups', label: 'Pickups' },
  { key: 'stock', label: 'Stock + Dates' },
  { key: 'search', label: 'Customer Search' },
  { key: 'email', label: 'Emailing' }
];

const normalizeDate = (value) => {
  if (!value) return 'Unknown';
  if (typeof value === 'string') {
    return value.includes('T') ? value.split('T')[0] : value;
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toISOString().split('T')[0];
};

const formatDateLong = (value) => {
  if (!value) return 'Unknown';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric'
  }).format(date);
};

const formatCurrency = (amount) => `$${amount.toFixed(2)}`;

const formatPhoneLink = (phone) => {
  if (!phone) return '';
  return phone.replace(/[^\d+]/g, '');
};

const getDisplayName = (name) => {
  if (!name) return 'Item';
  return name.split(' / ')[0];
};

const parseItems = (items) => {
  if (!items) return [];
  if (Array.isArray(items)) return items;
  try {
    return JSON.parse(items);
  } catch (error) {
    return [];
  }
};

const normalizeStatus = (status) => {
  if (!status) return 'pending';
  if (status === 'cancelled') return 'cancelled';
  if (status === 'picked_up' || status === 'fulfilled') return 'picked_up';
  return 'pending';
};

const getStatusLabel = (status) => {
  const normalized = normalizeStatus(status);
  if (normalized === 'cancelled') return 'Cancelled';
  if (normalized === 'picked_up') return 'Picked Up';
  return 'Pending';
};

const STOCK_CATEGORIES = [
  {
    key: 'layers',
    label: 'Ready-to-Lay Hens',
    matcher: (name) => name.includes('Lohmann') || name.includes('Ready-to-Lay')
  },
  {
    key: 'meat',
    label: 'Meat Chickens',
    matcher: (name) => name.includes('Meat') || name.includes('Chair')
  }
];

export default function Admin() {
  const [password, setPassword] = useState('');
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [orders, setOrders] = useState([]);
  const [hens, setHens] = useState([]);
  const [dates, setDates] = useState([]);
  const [dataLoading, setDataLoading] = useState(false);
  const [orderActionLoading, setOrderActionLoading] = useState(null);
  const [scheduleLoading, setScheduleLoading] = useState(null);
  const [notice, setNotice] = useState(null);
  const [activeTab, setActiveTab] = useState('pickups');
  const [searchQuery, setSearchQuery] = useState('');
  const [stockInputs, setStockInputs] = useState({});
  const [stockLoading, setStockLoading] = useState(null);
  const [selectedCustomer, setSelectedCustomer] = useState(null);
  const [newPickupDate, setNewPickupDate] = useState('');
  const [isDatePickerOpen, setIsDatePickerOpen] = useState(false);
  const dateInputRef = useRef(null);

  useEffect(() => {
    document.body.classList.add('admin-active');
    document.documentElement.classList.add('admin-active');
    return () => {
      document.body.classList.remove('admin-active');
      document.documentElement.classList.remove('admin-active');
    };
  }, []);

  const showToast = (payload) => {
    setNotice(payload);
    setTimeout(() => {
      setNotice((current) => (current === payload ? null : current));
    }, 3000);
  };

  const handleLogin = async (event) => {
    event.preventDefault();
    try {
      await axios.post(`${API_URL}/admin/login`, { password });
      setIsLoggedIn(true);
      setNotice(null);
      localStorage.setItem(
        ADMIN_AUTH_KEY,
        JSON.stringify({ password, expiresAt: Date.now() + 60 * 60 * 1000 })
      );
      fetchData(password);
    } catch (error) {
      showToast({ type: 'error', text: 'Wrong password. Try again.' });
    }
  };

  const fetchData = (pwd) => {
    setDataLoading(true);
    const config = { headers: { Authorization: pwd } };
    Promise.all([
      axios.get(`${API_URL}/admin/orders`, config),
      axios.get(`${API_URL}/hens`),
      axios.get(`${API_URL}/pickup-dates`)
    ])
      .then(([ordersRes, hensRes, datesRes]) => {
        setOrders(Array.isArray(ordersRes.data) ? ordersRes.data : []);
        setHens(Array.isArray(hensRes.data) ? hensRes.data : []);
        setDates(Array.isArray(datesRes.data) ? datesRes.data : []);
      })
      .catch(() => {
        showToast({ type: 'error', text: 'Failed to load admin data.' });
      })
      .finally(() => {
        setDataLoading(false);
      });
  };

  useEffect(() => {
    const savedAuth = localStorage.getItem(ADMIN_AUTH_KEY);
    if (!savedAuth) return;
    try {
      const parsed = JSON.parse(savedAuth);
      if (parsed?.password && parsed?.expiresAt > Date.now()) {
        setPassword(parsed.password);
        setIsLoggedIn(true);
        fetchData(parsed.password);
        return;
      }
    } catch (error) {
      // Ignore parse errors and clear invalid data.
    }
    localStorage.removeItem(ADMIN_AUTH_KEY);
  }, []);

  const ordersWithDetails = useMemo(() => {
    return orders.map((order) => {
      const items = parseItems(order.items);
      const orderItems = items.map((item) => {
        const quantity = Number(item.quantity ?? item.qty ?? 0);
        const hen = hens.find((henItem) => henItem.id === Number(item.id));
        const name = hen?.name || item.name || 'Item';
        return {
          quantity,
          displayName: getDisplayName(name)
        };
      });
      const itemCount = orderItems.reduce((total, item) => total + item.quantity, 0);
      const itemSummary = orderItems
        .map((item) => `${item.quantity} x ${item.displayName}`)
        .join(', ');
      return {
        ...order,
        pickupDate: normalizeDate(order.pickup_date || order.created_at),
        orderDate: normalizeDate(order.created_at),
        pickupLocation: order.pickup_location || 'Unspecified',
        pickupLocationLabel:
          LOCATION_LABELS[order.pickup_location] || order.pickup_location || 'Unspecified',
        customerName: order.customer_name || 'Guest',
        customerPhone: order.customer_phone || '',
        customerEmail: order.customer_email || '',
        customerAddress: order.customer_address || '',
        totalAmount: (order.total_cents || 0) / 100,
        itemCount,
        itemSummary
      };
    });
  }, [orders, hens]);

  const groupedPickups = useMemo(() => {
    const dateMap = new Map();
    ordersWithDetails.forEach((order) => {
      const dateKey = order.pickupDate || 'Unknown';
      if (!dateMap.has(dateKey)) {
        dateMap.set(dateKey, new Map());
      }
      const locationMap = dateMap.get(dateKey);
      const locationKey = order.pickupLocation || 'Unspecified';
      if (!locationMap.has(locationKey)) {
        locationMap.set(locationKey, []);
      }
      locationMap.get(locationKey).push(order);
    });
    const sortedDates = Array.from(dateMap.entries()).sort((a, b) => {
      const dateA = new Date(a[0]);
      const dateB = new Date(b[0]);
      if (Number.isNaN(dateA.getTime()) || Number.isNaN(dateB.getTime())) {
        return a[0].localeCompare(b[0]);
      }
      return dateA - dateB;
    });
    return sortedDates.map(([date, locations]) => {
      const locationGroups = Array.from(locations.entries()).map(([location, ordersList]) => {
        const sortedOrders = [...ordersList].sort((first, second) =>
          first.customerName.localeCompare(second.customerName)
        );
        const uniqueCustomers = new Set(
          sortedOrders.map((order) => order.customerPhone || order.customerEmail || order.id)
        );
        return {
          date,
          location,
          locationLabel: LOCATION_LABELS[location] || location,
          orders: sortedOrders,
          customerCount: uniqueCustomers.size
        };
      });
      const totalOrders = locationGroups.reduce((sum, group) => sum + group.orders.length, 0);
      const totalCustomers = locationGroups.reduce((sum, group) => sum + group.customerCount, 0);
      return { date, locations: locationGroups, totalOrders, totalCustomers };
    });
  }, [ordersWithDetails]);

  const customers = useMemo(() => {
    const customerMap = new Map();
    ordersWithDetails.forEach((order) => {
      const key = order.customerPhone || order.customerEmail || order.id;
      if (!customerMap.has(key)) {
        customerMap.set(key, {
          key,
          name: order.customerName,
          phone: order.customerPhone,
          email: order.customerEmail,
          address: order.customerAddress,
          firstOrderDate: order.orderDate,
          lastOrderDate: order.orderDate,
          orders: [],
          totalSpend: 0
        });
      }
      const customer = customerMap.get(key);
      customer.orders.push(order);
      customer.totalSpend += order.totalAmount;
      if (order.orderDate < customer.firstOrderDate) {
        customer.firstOrderDate = order.orderDate;
      }
      if (order.orderDate > customer.lastOrderDate) {
        customer.lastOrderDate = order.orderDate;
      }
    });
    const list = Array.from(customerMap.values()).map((customer) => {
      return {
        ...customer,
        orderCount: customer.orders.length
      };
    });
    return list.sort((a, b) => b.lastOrderDate.localeCompare(a.lastOrderDate));
  }, [ordersWithDetails]);

  const filteredCustomers = useMemo(() => {
    if (!searchQuery.trim()) return customers;
    const query = searchQuery.trim().toLowerCase();
    return customers.filter((customer) => {
      const values = [customer.name, customer.phone, customer.email]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return values.includes(query);
    });
  }, [customers, searchQuery]);

  const stockCategoryData = useMemo(() => {
    return STOCK_CATEGORIES.map((category) => {
      const categoryHens = hens.filter((hen) => category.matcher(hen.name || ''));
      const totalStock = categoryHens.reduce((total, hen) => total + Number(hen.stock || 0), 0);
      return {
        ...category,
        hens: categoryHens,
        totalStock
      };
    });
  }, [hens]);

  const handleStockUpdate = async (categoryKey) => {
    const category = stockCategoryData.find((item) => item.key === categoryKey);
    if (!category || category.hens.length === 0) {
      showToast({ type: 'error', text: 'No matching stock items found.' });
      return;
    }
    const nextValue = Number(stockInputs[categoryKey]);
    if (!Number.isFinite(nextValue) || nextValue < 0) {
      showToast({ type: 'error', text: 'Enter a valid stock number.' });
      return;
    }
    setStockLoading(categoryKey);
    try {
      await Promise.all(
        category.hens.map((hen) =>
          axios.put(
            `${API_URL}/admin/hens/${hen.id}`,
            { stock: nextValue },
            { headers: { Authorization: password } }
          )
        )
      );
      showToast({ type: 'success', text: 'Stock updated.' });
      fetchData(password);
    } catch (error) {
      showToast({ type: 'error', text: 'Failed to update stock.' });
    } finally {
      setStockLoading(null);
    }
  };

  const addDate = async (dateValue) => {
    if (!dateValue) return false;
    setScheduleLoading('add');
    try {
      await axios.post(
        `${API_URL}/admin/pickup-dates`,
        { date_value: dateValue },
        { headers: { Authorization: password } }
      );
      showToast({ type: 'success', text: 'Pickup date added.' });
      fetchData(password);
      return true;
    } catch (error) {
      showToast({ type: 'error', text: 'Failed to add pickup date.' });
      return false;
    } finally {
      setScheduleLoading(null);
    }
  };

  const deleteDate = async (dateItem, orderCount) => {
    if (orderCount > 0) {
      const confirmed = window.confirm('This date has existing orders. Remove it anyway?');
      if (!confirmed) return;
    }
    setScheduleLoading(dateItem.id);
    try {
      await axios.delete(`${API_URL}/admin/pickup-dates/${dateItem.id}`,
        { headers: { Authorization: password } }
      );
      showToast({ type: 'success', text: 'Pickup date removed.' });
      fetchData(password);
    } catch (error) {
      showToast({ type: 'error', text: 'Failed to remove pickup date.' });
    } finally {
      setScheduleLoading(null);
    }
  };

  const updateOrderStatus = async (id, newStatus) => {
    setOrderActionLoading(id);
    try {
      await axios.put(
        `${API_URL}/admin/orders/${id}/status`,
        { status: newStatus },
        { headers: { Authorization: password } }
      );
      showToast({ type: 'success', text: 'Pickup status updated.' });
      fetchData(password);
    } catch (error) {
      showToast({ type: 'error', text: 'Failed to update pickup status.' });
    } finally {
      setOrderActionLoading(null);
    }
  };

  const handlePickupToggle = (order) => {
    if (normalizeStatus(order.status) === 'cancelled') return;
    const nextStatus = normalizeStatus(order.status) === 'picked_up' ? 'pending' : 'picked_up';
    updateOrderStatus(order.id, nextStatus);
  };

  const handleDatePicker = () => {
    const input = dateInputRef.current;
    if (!input) return;
    if (input.showPicker) {
      input.showPicker();
    } else {
      input.focus();
    }
  };

  const handleAddDateClick = async () => {
    if (!newPickupDate) {
      setIsDatePickerOpen(true);
      setTimeout(() => handleDatePicker(), 0);
      return;
    }
    const confirmLabel = formatDateLong(newPickupDate);
    const confirmed = window.confirm(`Add pickup date: ${confirmLabel}?`);
    if (!confirmed) {
      return;
    }
    const didAdd = await addDate(newPickupDate);
    if (didAdd) {
      setNewPickupDate('');
      setIsDatePickerOpen(false);
    }
  };

  const addDateButtonLabel = scheduleLoading === 'add'
    ? 'Adding...'
    : newPickupDate
      ? 'Confirm Pickup Date'
      : 'Add Pickup Date';

  const handleTabChange = (key) => {
    setActiveTab(key);
    setSelectedCustomer(null);
    if (key !== 'search') {
      setSearchQuery('');
    }
  };

  const renderNotice = () => {
    if (!notice) return null;
    return (
      <div className={`admin-toast ${notice.type}`}>
        {notice.text}
      </div>
    );
  };

  if (!isLoggedIn) {
    return (
      <div className="admin-container login-container">
        <div className="login-card">
          <div className="login-title">Farm Admin</div>
          <form onSubmit={handleLogin}>
            <label className="admin-label" htmlFor="admin-password">
              Password
            </label>
            <input
              id="admin-password"
              type="password"
              className="admin-input"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
            <button type="submit" className="admin-button">
              Log In
            </button>
          </form>
          {notice && <div className="admin-helper-text error">{notice.text}</div>}
        </div>
      </div>
    );
  }

  const renderPickupsPage = () => {
    if (dataLoading) {
      return <div className="admin-panel">Loading pickups...</div>;
    }
    if (groupedPickups.length === 0) {
      return <div className="admin-panel">No pickups scheduled yet.</div>;
    }
    return (
      <div className="admin-stack">
        {groupedPickups.map((group, index) => (
          <section
            key={group.date}
            className="pickup-day stagger-item"
            style={{ '--stagger': index }}
          >
            <div className="pickup-day-header">
            <div>
              <div className="pickup-day-title">{formatDateLong(group.date)}</div>
              <div className="pickup-day-subtitle">
                  {group.totalOrders} pickups
              </div>
            </div>
          </div>
          {group.locations.map((locationGroup) => (
            <div key={`${group.date}-${locationGroup.location}`} className="pickup-location">
              <div className="pickup-location-title">{locationGroup.locationLabel}</div>
              <div className="pickup-list">
                {locationGroup.orders.map((order) => {
                  const status = normalizeStatus(order.status);
                  const isDisabled = orderActionLoading === order.id || status === 'cancelled';
                  const pickupSummary = order.itemSummary || `${order.itemCount} items`;
                  return (
                    <label key={order.id} className={`pickup-row ${status}`}>
                      <input
                        type="checkbox"
                        checked={status === 'picked_up'}
                        disabled={isDisabled}
                        onChange={() => handlePickupToggle(order)}
                      />
                      <span className="pickup-check" aria-hidden="true" />
                      <div className="pickup-info">
                        <div className="pickup-name">{order.customerName}</div>
                        <div className="pickup-meta">
                            {pickupSummary} - {order.pickupLocationLabel}
                        </div>
                      </div>
                      <span className={`pickup-pill ${status}`}>{getStatusLabel(order.status)}</span>
                    </label>
                  );
                })}
                </div>
              </div>
            ))}
          </section>
        ))}
      </div>
    );
  };

  const renderStockPage = () => {
    if (dataLoading) {
      return <div className="admin-panel">Loading stock and dates...</div>;
    }
    return (
      <div className="admin-stack">
        <section className="admin-panel stagger-item" style={{ '--stagger': 0 }}>
          <div className="panel-header">
            <div>
              <div className="panel-title">Stock Overview</div>
              <div className="panel-subtitle">Update counts for each category.</div>
            </div>
          </div>
          <div className="stock-grid">
            {stockCategoryData.map((category) => (
              <div key={category.key} className="stock-card">
                <div className="stock-card-top">
                  <div className="stock-title">{category.label}</div>
                  <div className="stock-value">{category.totalStock}</div>
                </div>
                <div className="stock-actions">
                  <input
                    type="number"
                    min="0"
                    className="admin-input"
                    placeholder="New stock total"
                    value={stockInputs[category.key] ?? ''}
                    onChange={(event) =>
                      setStockInputs((prev) => ({
                        ...prev,
                        [category.key]: event.target.value
                      }))
                    }
                  />
                  <button
                    className="admin-button"
                    onClick={() => handleStockUpdate(category.key)}
                    disabled={stockLoading === category.key}
                  >
                    {stockLoading === category.key ? 'Updating...' : 'Update'}
                  </button>
                </div>
              </div>
            ))}
          </div>
        </section>
        <section className="admin-panel stagger-item" style={{ '--stagger': 1 }}>
          <div className="panel-header">
            <div>
              <div className="panel-title">Pickup Dates</div>
            </div>
          </div>
          <div className="date-list">
            {dates.length === 0 && (
              <div className="empty-state">No pickup dates yet.</div>
            )}
            {dates.map((dateItem) => {
              const dateValue = normalizeDate(dateItem.date_value);
              const dateLabel = formatDateLong(dateValue);
              const orderCount = ordersWithDetails.filter(
                (order) => order.pickupDate === dateValue
              ).length;
              return (
                <div key={dateItem.id} className="date-row">
                  <div>
                    <div className="date-title">{dateLabel}</div>
                    <div className="date-meta">{orderCount} pickups</div>
                  </div>
                  <button
                    className="admin-button ghost"
                    onClick={() => deleteDate(dateItem, orderCount)}
                    disabled={scheduleLoading === dateItem.id}
                  >
                    Remove
                  </button>
                </div>
              );
            })}
          </div>
          <div className="date-actions">
            <div className={`date-picker ${isDatePickerOpen ? 'open' : ''}`}>
              <input
                ref={dateInputRef}
                type="date"
                className="admin-input date-input"
                value={newPickupDate}
                onChange={(event) => setNewPickupDate(event.target.value)}
              />
            </div>
            <button
              className="admin-button"
              onClick={handleAddDateClick}
              disabled={scheduleLoading === 'add'}
            >
              {addDateButtonLabel}
            </button>
            {newPickupDate && (
              <div className="date-selected">
                Selected: {formatDateLong(newPickupDate)}
              </div>
            )}
          </div>
        </section>
      </div>
    );
  };

  const renderSearchPage = () => {
    if (dataLoading) {
      return <div className="admin-panel">Loading customers...</div>;
    }
    return (
      <div className="admin-stack">
        <section className="admin-panel stagger-item" style={{ '--stagger': 0 }}>
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
                onClick={() => setSelectedCustomer(customer)}
              >
                <div className="customer-row-name">{customer.name}</div>
                <div className="customer-row-meta">
                  {customer.orderCount} orders - last {formatDateLong(customer.lastOrderDate)}
                </div>
              </button>
            ))}
          </div>
        </section>
      </div>
    );
  };

  const renderEmailPage = () => (
    <div className="admin-panel stagger-item" style={{ '--stagger': 0 }}>
      <div className="panel-header">
        <div>
          <div className="panel-title">Emailing</div>
          <div className="panel-subtitle">We will add templates and sending tools here.</div>
        </div>
      </div>
      <div className="empty-state">
        Emailing tools are coming soon.
      </div>
    </div>
  );

  const activeTabConfig = TAB_CONFIG.find((tab) => tab.key === activeTab);
  return (
    <div className="admin-container">
      <div className="admin-shell">
        <header className="admin-topbar">
          <div className="admin-brand">
            <div className="admin-page-title">{activeTabConfig?.label}</div>
          </div>
          {activeTab === 'search' && (
            <div className="admin-search">
              <input
                className="admin-input"
                placeholder="Search by name, phone, email"
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
              />
            </div>
          )}
        </header>
        <main className="admin-main">
          {renderNotice()}
          {activeTab === 'pickups' && renderPickupsPage()}
          {activeTab === 'stock' && renderStockPage()}
          {activeTab === 'search' && renderSearchPage()}
          {activeTab === 'email' && renderEmailPage()}
        </main>
        <nav className="admin-nav">
          {TAB_CONFIG.map((tab) => (
            <button
              key={tab.key}
              className={`admin-nav-button ${activeTab === tab.key ? 'active' : ''}`}
              onClick={() => handleTabChange(tab.key)}
              type="button"
              aria-current={activeTab === tab.key ? 'page' : undefined}
            >
              <span className="nav-label">{tab.label}</span>
            </button>
          ))}
        </nav>
      </div>
      {selectedCustomer && (
        <div className="customer-modal-backdrop" role="dialog" aria-modal="true">
          <div className="customer-modal">
            <div className="customer-modal-header">
              <div>
                <div className="detail-name">{selectedCustomer.name}</div>
                <div className="detail-meta">
                  {selectedCustomer.orderCount} orders - {formatCurrency(selectedCustomer.totalSpend)} total
                </div>
              </div>
              <button
                type="button"
                className="admin-button ghost modal-close"
                onClick={() => setSelectedCustomer(null)}
              >
                Close
              </button>
            </div>
            <div className="detail-links">
              {selectedCustomer.phone && (
                <a
                  className="detail-link"
                  href={`tel:${formatPhoneLink(selectedCustomer.phone)}`}
                >
                  Call
                </a>
              )}
              {selectedCustomer.email && (
                <a
                  className="detail-link"
                  href={`mailto:${selectedCustomer.email}`}
                >
                  Email
                </a>
              )}
            </div>
            <div className="detail-history">
              {[...selectedCustomer.orders]
                .sort((a, b) => b.orderDate.localeCompare(a.orderDate))
                .map((order) => (
                  <div key={order.id} className="history-row">
                    <div>
                      <div className="history-title">{formatDateLong(order.orderDate)}</div>
                      <div className="history-meta">
                        {order.itemSummary || `${order.itemCount} items`}
                      </div>
                    </div>
                    <div className="history-total">{formatCurrency(order.totalAmount)}</div>
                  </div>
                ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
