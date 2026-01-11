import { useEffect, useMemo, useRef, useState } from 'react';
import axios from 'axios';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import useMediaQuery from '../hooks/useMediaQuery';
import '../styles/pages/Admin.css';
import { API_URL } from '../constants/api';

const LOCATION_LABELS = {
  hemmingford: 'Hemmingford',
  bristol: 'Bristol'
};

const LOCATION_OPTIONS = Object.entries(LOCATION_LABELS).map(([value, label]) => ({
  value,
  label
}));

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

const formatDateShort = (value) => {
  if (!value) return 'Unknown';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric'
  }).format(date);
};

const formatCurrency = (amount) => `$${amount.toFixed(2)}`;

const formatPhoneLink = (phone) => {
  if (!phone) return '';
  return phone.replace(/[^\d+]/g, '');
};

const formatPhoneDisplay = (phone) => {
  if (!phone) return '';
  const digits = phone.replace(/\D/g, '');
  if (digits.length === 10) {
    return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
  }
  if (digits.length === 11 && digits.startsWith('1')) {
    return `+1 (${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7)}`;
  }
  return phone;
};

const getDisplayName = (name) => {
  if (!name) return 'Item';
  return name.split(' / ')[0];
};

const formatLocationShort = (label) => {
  if (!label) return 'Unknown';
  if (/hemmingford/i.test(label)) return 'Hemm.';
  return label;
};

const shortenItemLabel = (label) => {
  if (!label) return 'Item';
  let updated = label;
  updated = updated.replace(/ready[-\s]?to[-\s]?lay hens?/gi, 'hens');
  updated = updated.replace(/meat chickens?/gi, 'chicks');
  updated = updated.replace(/meat chicks?/gi, 'chicks');
  return updated;
};

const normalizePaymentType = (paymentType, amountDue) => {
  if (paymentType === 'deposit') return 'deposit';
  if (paymentType === 'full') return 'full';
  return amountDue > 0 ? 'deposit' : 'full';
};

const getPaymentLabel = (paymentType, amountDue) =>
  normalizePaymentType(paymentType, amountDue) === 'deposit' ? 'Deposit' : 'Paid';

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

const buildShortSummary = (items, itemCount) => {
  const counts = {
    hens: 0,
    chickens: 0
  };
  items.forEach((item) => {
    if (STOCK_CATEGORIES[0].matcher(item.displayName)) {
      counts.hens += item.quantity;
      return;
    }
    if (STOCK_CATEGORIES[1].matcher(item.displayName)) {
      counts.chickens += item.quantity;
    }
  });
  const parts = [];
  if (counts.hens) {
    parts.push(
      `${counts.hens} ready-to-lay ${counts.hens === 1 ? 'hen' : 'hens'}`
    );
  }
  if (counts.chickens) {
    parts.push(
      `${counts.chickens} meat ${counts.chickens === 1 ? 'chicken' : 'chickens'}`
    );
  }
  if (parts.length) {
    return parts.join(' · ');
  }
  if (itemCount > 0) {
    return `${itemCount} ${itemCount === 1 ? 'item' : 'items'}`;
  }
  return 'Items';
};

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
  const [pickupConfirm, setPickupConfirm] = useState(null);
  const [newPickupDate, setNewPickupDate] = useState('');
  const [newPickupLocation, setNewPickupLocation] = useState(LOCATION_OPTIONS[0]?.value || '');
  const [isDatePickerOpen, setIsDatePickerOpen] = useState(false);
  const [emailGroupKey, setEmailGroupKey] = useState(null);
  const [emailSubject, setEmailSubject] = useState('');
  const [emailMessage, setEmailMessage] = useState('');
  const [emailSending, setEmailSending] = useState(null);
  const dateInputRef = useRef(null);
  const isMobile = useMediaQuery('(max-width: 767px)');

  useEffect(() => {
    const root = document.documentElement;
    const viewport = window.visualViewport;
    const setViewportHeight = () => {
      const height = viewport?.height || window.innerHeight;
      root.style.setProperty('--admin-viewport-height', `${height}px`);
    };

    document.body.classList.add('admin-active');
    root.classList.add('admin-active');
    setViewportHeight();
    window.addEventListener('resize', setViewportHeight);
    viewport?.addEventListener('resize', setViewportHeight);

    return () => {
      window.removeEventListener('resize', setViewportHeight);
      viewport?.removeEventListener('resize', setViewportHeight);
      root.style.removeProperty('--admin-viewport-height');
      document.body.classList.remove('admin-active');
      root.classList.remove('admin-active');
    };
  }, []);

  useEffect(() => {
    const hasModal = Boolean(selectedCustomer || pickupConfirm);
    if (hasModal) {
      document.body.classList.add('admin-modal-open');
    } else {
      document.body.classList.remove('admin-modal-open');
    }
    return () => document.body.classList.remove('admin-modal-open');
  }, [selectedCustomer, pickupConfirm]);

  const showToast = (payload) => {
    setNotice(payload);
    setTimeout(() => {
      setNotice((current) => (current === payload ? null : current));
    }, 3000);
  };

  const handleLogin = async (event) => {
    event.preventDefault();
    try {
      await axios.post(`${API_URL}/admin/login`, { password }, { withCredentials: true });
      setIsLoggedIn(true);
      setNotice(null);
      setPassword('');
      fetchData();
    } catch (error) {
      showToast({ type: 'error', text: 'Wrong password. Try again.' });
    }
  };

  const buildOrdersTableRows = () => {
    const rows = [];

    groupedPickups.forEach((group) => {
      group.locations.forEach((locationGroup) => {
        locationGroup.orders.forEach((order) => {
          rows.push([
            formatDateShort(group.date),
            formatLocationShort(locationGroup.locationLabel),
            order.customerName,
            formatPhoneDisplay(order.customerPhone || ''),
            order.customerEmail || '',
            order.itemSummaryCompact || `${order.itemCount} items`,
            formatCurrency(order.totalAmount),
            order.paymentLabel,
            order.amountDue > 0 ? formatCurrency(order.amountDue) : '$0.00'
          ]);
        });
      });
    });

    if (rows.length === 0) {
      rows.push(['No orders', '', '', '', '', '', '', '', '']);
    }

    return rows;
  };

  const getExportTitle = () => `Orders — ${formatDateLong(new Date())}`;

  const handleExportDownload = () => {
    if (dataLoading) {
      showToast({ type: 'error', text: 'Orders are still loading.' });
      return;
    }
    const rows = buildOrdersTableRows();
    const filename = `orders-${new Date().toISOString().split('T')[0]}.pdf`;
    const doc = new jsPDF({
      orientation: 'landscape',
      unit: 'pt',
      format: 'letter'
    });

    const title = getExportTitle();
    doc.setFontSize(14);
    doc.text(title, 40, 32);

    autoTable(doc, {
      startY: 50,
      head: [[
        'Date',
        'Loc',
        'Customer',
        'Phone',
        'Email',
        'Items',
        'Total',
        'Pay',
        'Due'
      ]],
      body: rows,
      styles: { fontSize: 8.5, cellPadding: 3, overflow: 'linebreak' },
      headStyles: { fillColor: [47, 107, 63], textColor: 255 },
      columnStyles: {
        0: { cellWidth: 55 },
        1: { cellWidth: 45 },
        2: { cellWidth: 110 },
        3: { cellWidth: 80 },
        4: { cellWidth: 140 },
        5: { cellWidth: 160 },
        6: { cellWidth: 60 },
        7: { cellWidth: 50 },
        8: { cellWidth: 70 }
      }
    });

    const isIOS =
      /iPad|iPhone|iPod/.test(navigator.userAgent)
      || (navigator.userAgent.includes('Mac') && 'ontouchend' in document);

    if (isIOS) {
      const pdfBlob = doc.output('blob');
      const pdfUrl = window.URL.createObjectURL(pdfBlob);
      const link = document.createElement('a');
      link.href = pdfUrl;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(pdfUrl);
    } else {
      doc.save(filename);
    }

  };

  const fetchData = () => {
    setDataLoading(true);
    Promise.all([
      axios.get(`${API_URL}/admin/orders`, { withCredentials: true }),
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
    const checkSession = async () => {
      try {
        await axios.get(`${API_URL}/admin/session`, { withCredentials: true });
        setIsLoggedIn(true);
        fetchData();
      } catch (error) {
        setIsLoggedIn(false);
      }
    };
    checkSession();
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
      const itemSummaryCompact = orderItems
        .map((item) => `${item.quantity} x ${shortenItemLabel(item.displayName)}`)
        .join(', ');
      const itemSummaryShort = buildShortSummary(orderItems, itemCount);
      const totalCents = Number(order.total_cents || 0);
      const paidCentsRaw = Number(order.amount_paid_cents);
      const dueCentsRaw = Number(order.amount_due_cents);
      const paidCents = Number.isFinite(paidCentsRaw) ? paidCentsRaw : totalCents;
      const dueCents = Number.isFinite(dueCentsRaw)
        ? dueCentsRaw
        : Math.max(totalCents - paidCents, 0);
      const amountPaid = paidCents / 100;
      const amountDue = dueCents / 100;
      const paymentType = normalizePaymentType(order.payment_type, dueCents);
      const paymentLabel = getPaymentLabel(paymentType, dueCents);
      const paymentSummary = amountDue > 0
        ? `Deposit: Due ${formatCurrency(amountDue)}`
        : 'Paid';
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
        amountPaid,
        amountDue,
        paymentType,
        paymentLabel,
        paymentSummary,
        itemCount,
        itemSummary,
        itemSummaryCompact,
        itemSummaryShort
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
      const locationGroups = Array.from(locations.entries())
        .map(([location, ordersList]) => {
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
        })
        .sort((a, b) => a.locationLabel.localeCompare(b.locationLabel));
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
    const queryDigits = query.replace(/\D/g, '');
    return customers.filter((customer) => {
      const values = [customer.name, customer.phone, customer.email]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      const phoneDigits = (customer.phone || '').replace(/\D/g, '');
      const matchesText = values.includes(query);
      const matchesPhoneDigits = queryDigits.length > 0 && phoneDigits.includes(queryDigits);
      return matchesText || matchesPhoneDigits;
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
            { withCredentials: true }
          )
        )
      );
      showToast({ type: 'success', text: 'Stock updated.' });
      fetchData();
    } catch (error) {
      showToast({ type: 'error', text: 'Failed to update stock.' });
    } finally {
      setStockLoading(null);
    }
  };

  const addDate = async (dateValue, locationValue) => {
    if (!dateValue || !locationValue) return false;
    setScheduleLoading('add');
    try {
      await axios.post(
        `${API_URL}/admin/pickup-dates`,
        { date_value: dateValue, location: locationValue },
        { withCredentials: true }
      );
      showToast({ type: 'success', text: 'Pickup date added.' });
      fetchData();
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
      await axios.delete(`${API_URL}/admin/pickup-dates/${dateItem.id}`, { withCredentials: true });
      showToast({ type: 'success', text: 'Pickup date removed.' });
      fetchData();
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
        { withCredentials: true }
      );
      showToast({ type: 'success', text: 'Pickup status updated.' });
      fetchData();
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

  const handlePickupConfirm = (order) => {
    if (normalizeStatus(order.status) !== 'pending') return;
    if (orderActionLoading === order.id) return;
    setPickupConfirm(order);
  };

  const handlePickupConfirmSubmit = async () => {
    if (!pickupConfirm) return;
    const order = pickupConfirm;
    setPickupConfirm(null);
    await updateOrderStatus(order.id, 'picked_up');
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
    if (!newPickupLocation) {
      showToast({ type: 'error', text: 'Select a pickup location.' });
      return;
    }
    const confirmLabel = formatDateLong(newPickupDate);
    const locationLabel = LOCATION_LABELS[newPickupLocation] || newPickupLocation;
    const confirmed = window.confirm(`Add pickup date: ${confirmLabel} (${locationLabel})?`);
    if (!confirmed) {
      return;
    }
    const didAdd = await addDate(newPickupDate, newPickupLocation);
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
    setPickupConfirm(null);
    if (key !== 'search') {
      setSearchQuery('');
    }
    if (key !== 'email') {
      setEmailGroupKey(null);
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
          <div className="login-title">L.F.S Admin</div>
          <form onSubmit={handleLogin}>
            <input
              id="admin-password"
              type="password"
              className="admin-input"
              placeholder="Password"
              aria-label="Password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete="current-password"
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
      <div className="admin-stack pickups-stack">
        {groupedPickups.map((group, index) => (
          <section
            key={group.date}
            className="pickup-day stagger-item"
            style={{ '--stagger': index + 1 }}
          >
            {!isMobile && (
              <div className="pickup-day-header">
                <div>
                  <div className="pickup-day-title">{formatDateLong(group.date)}</div>
                  <div className="pickup-day-subtitle">{group.totalOrders} pickups</div>
                </div>
              </div>
            )}
            {group.locations.map((locationGroup) => (
              <div key={`${group.date}-${locationGroup.location}`} className="pickup-location">
                <div className="pickup-location-title">
                  {isMobile
                    ? `${formatDateLong(group.date)} · ${locationGroup.locationLabel}`
                    : locationGroup.locationLabel}
                </div>
                <div className="pickup-list">
                {locationGroup.orders.map((order) => {
                  const status = normalizeStatus(order.status);
                  const isDisabled = orderActionLoading === order.id || status === 'cancelled';
                  const pickupSummary = order.itemSummary || `${order.itemCount} items`;
                  const phoneDisplay = formatPhoneDisplay(order.customerPhone || '');
                  return (
                    isMobile ? (
                      <button
                        key={order.id}
                        type="button"
                        className={`order-row ${status}`}
                        onClick={() => handlePickupConfirm(order)}
                        aria-disabled={status !== 'pending'}
                        disabled={orderActionLoading === order.id}
                      >
                        <div className="order-info">
                          <div className="customer-name">{order.customerName}</div>
                          <div className="product-summary">{order.itemSummaryShort}</div>
                          <div className="payment-summary">{order.paymentSummary}</div>
                        </div>
                        <span className={`status-badge ${status}`}>{getStatusLabel(order.status)}</span>
                      </button>
                    ) : (
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
                            <div className="pickup-summary">
                              {pickupSummary} - {order.pickupLocationLabel}
                            </div>
                            <div className="pickup-payment">{order.paymentSummary}</div>
                            {phoneDisplay && <div className="pickup-phone">{phoneDisplay}</div>}
                          </div>
                        </div>
                        <span className={`pickup-pill ${status}`}>{getStatusLabel(order.status)}</span>
                      </label>
                    )
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
              const locationLabel =
                LOCATION_LABELS[dateItem.location] || dateItem.location || 'Unknown';
              const orderCount = ordersWithDetails.filter(
                (order) =>
                  order.pickupDate === dateValue && order.pickupLocation === dateItem.location
              ).length;
              return (
                <div key={dateItem.id} className="date-row">
                  <div>
                    <div className="date-title">{dateLabel}</div>
                    <div className="date-meta">
                      {locationLabel} · {orderCount} pickups
                    </div>
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
            <label className="admin-label" htmlFor="pickup-location-select">
              Pickup location
            </label>
            <select
              id="pickup-location-select"
              className="admin-input"
              value={newPickupLocation}
              onChange={(event) => setNewPickupLocation(event.target.value)}
            >
              {LOCATION_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
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

  const renderEmailPage = () => {
    if (dataLoading) {
      return <div className="admin-panel">Loading email groups...</div>;
    }

    return (
      <div className="admin-stack">
        <section className="admin-panel stagger-item" style={{ '--stagger': 0 }}>
          <div className="panel-header">
            <div>
              <div className="panel-title">Emailing</div>
              <div className="panel-subtitle">Send a note to each pickup group.</div>
            </div>
          </div>
          {groupedPickups.length === 0 ? (
            <div className="empty-state">No pickup groups yet.</div>
          ) : (
            <div className="email-group-list">
              {groupedPickups.flatMap((group) =>
                group.locations.map((locationGroup) => {
                  const groupKey = `${group.date}-${locationGroup.location}`;
                  const recipients = new Map();
                  locationGroup.orders.forEach((order) => {
                    const email = (order.customerEmail || '').trim().toLowerCase();
                    if (!email) return;
                    if (!recipients.has(email)) {
                      recipients.set(email, {
                        email,
                        name: order.customerName
                      });
                    }
                  });
                  const isActive = emailGroupKey === groupKey;
                  return (
                    <div key={groupKey} className="email-group">
                      <button
                        type="button"
                        className={`email-group-card ${isActive ? 'active' : ''}`}
                        onClick={() => {
                          const nextActive = isActive ? null : groupKey;
                          setEmailGroupKey(nextActive);
                          if (!isActive) {
                            const dateLabel = formatDateLong(group.date);
                            setEmailSubject(`Pickup reminder - ${dateLabel} (${locationGroup.locationLabel})`);
                            setEmailMessage(
                              `Hello,\n\nThis is a reminder for your pickup on ${dateLabel} at ${locationGroup.locationLabel}.\n\nThank you.`
                            );
                          }
                        }}
                      >
                        <div>
                          <div className="email-group-title">
                            {formatDateLong(group.date)} - {locationGroup.locationLabel}
                          </div>
                          <div className="email-group-meta">
                            {locationGroup.orders.length} orders - {recipients.size} emails
                          </div>
                        </div>
                        <span className="email-group-action">{isActive ? 'Close' : 'Email'}</span>
                      </button>
                      {isActive && (
                        <div className="email-group-form">
                          <input
                            className="admin-input"
                            type="text"
                            placeholder="Subject"
                            value={emailSubject}
                            onChange={(event) => setEmailSubject(event.target.value)}
                          />
                          <textarea
                            className="admin-textarea"
                            rows={5}
                            placeholder="Message"
                            value={emailMessage}
                            onChange={(event) => setEmailMessage(event.target.value)}
                          />
                          <button
                            className="admin-button"
                            type="button"
                            disabled={recipients.size === 0 || emailSending === groupKey}
                            onClick={async () => {
                              if (recipients.size === 0) {
                                showToast({ type: 'error', text: 'No email addresses for this group.' });
                                return;
                              }
                              setEmailSending(groupKey);
                              try {
                                await axios.post(
                                  `${API_URL}/admin/email`,
                                  {
                                    messages: Array.from(recipients.values()).map((recipient) => ({
                                      to: { email: recipient.email, name: recipient.name },
                                      subject: emailSubject || 'Pickup reminder',
                                      text: emailMessage || 'Pickup reminder.'
                                    }))
                                  },
                                  { withCredentials: true }
                                );
                                showToast({ type: 'success', text: 'Group email sent.' });
                              } catch (error) {
                                showToast({ type: 'error', text: 'Failed to send group email.' });
                              } finally {
                                setEmailSending(null);
                              }
                            }}
                          >
                            {emailSending === groupKey ? 'Sending...' : 'Send Email'}
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          )}
        </section>
      </div>
    );
  };

  const activeTabConfig = TAB_CONFIG.find((tab) => tab.key === activeTab);
  return (
    <div className="admin-container">
      <div className="admin-shell">
        <header className="admin-topbar">
          <div className="admin-topbar-row">
            <div className="admin-brand">
              <div className="admin-page-title">{activeTabConfig?.label}</div>
            </div>
            {activeTab === 'pickups' && (
              <button
                className="export-button"
                type="button"
                onClick={handleExportDownload}
                disabled={dataLoading}
              >
                Export PDF
              </button>
            )}
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
          <nav className="admin-tabs" aria-label="Admin sections">
            {TAB_CONFIG.map((tab) => (
              <button
                key={tab.key}
                className={`admin-tab-button ${activeTab === tab.key ? 'active' : ''}`}
                onClick={() => handleTabChange(tab.key)}
                type="button"
                aria-current={activeTab === tab.key ? 'page' : undefined}
              >
                {tab.label}
              </button>
            ))}
          </nav>
        </header>
        <main className={`admin-main ${activeTab === 'pickups' ? 'admin-main-pickups' : ''}`}>
          {renderNotice()}
          {activeTab === 'pickups' && renderPickupsPage()}
          {activeTab === 'stock' && renderStockPage()}
          {activeTab === 'search' && renderSearchPage()}
          {activeTab === 'email' && renderEmailPage()}
        </main>
        <nav className="admin-nav admin-nav-mobile">
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
                      <div className="history-payment">{order.paymentSummary}</div>
                    </div>
                    <div className="history-total">{formatCurrency(order.totalAmount)}</div>
                  </div>
                ))}
            </div>
          </div>
        </div>
      )}
      {pickupConfirm && (
        <div className="admin-confirm-backdrop" role="dialog" aria-modal="true">
          <div className="admin-confirm">
            <div className="admin-confirm-title">
              Mark {pickupConfirm.customerName} as picked up?
            </div>
            <div className="admin-confirm-actions">
              <button
                type="button"
                className="admin-button ghost"
                onClick={() => setPickupConfirm(null)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="admin-button"
                onClick={handlePickupConfirmSubmit}
              >
                Picked Up
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
