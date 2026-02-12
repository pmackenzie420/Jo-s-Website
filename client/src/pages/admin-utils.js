import LOCATION_DETAILS from '../../../shared/locations.json';

const LOCATION_LABELS = Object.fromEntries(
  Object.entries(LOCATION_DETAILS).map(([key, value]) => [key, value.label || key])
);

const LOCATION_OPTIONS = Object.entries(LOCATION_LABELS).map(([value, label]) => ({
  value,
  label
}));

const buildPickupKey = (date, location) => `${date}::${location}`;

const parsePickupKey = (value) => {
  if (!value) return { date: '', location: '' };
  const [date, location] = value.split('::');
  return { date, location };
};

const TAB_CONFIG = [
  { key: 'pickups', label: 'Pickups' },
  { key: 'stock', label: 'Stock + Dates' },
  { key: 'search', label: 'Customer Search' },
  { key: 'email', label: 'Emailing' }
];

const pad2 = (value) => String(value).padStart(2, '0');

const normalizeDate = (value) => {
  if (!value) return 'Unknown';
  if (typeof value === 'string') {
    return value.includes('T') ? value.split('T')[0] : value;
  }
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
};

const parseLocalDate = (value) => {
  if (!value) return null;
  if (value instanceof Date) return value;
  if (typeof value === 'string') {
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      const [y, m, d] = value.split('-').map(Number);
      return new Date(y, m - 1, d);
    }
    const datePrefix = value.match(/^(\d{4})-(\d{2})-(\d{2})T/);
    if (datePrefix) {
      const y = Number(datePrefix[1]);
      const m = Number(datePrefix[2]);
      const d = Number(datePrefix[3]);
      return new Date(y, m - 1, d);
    }
    return new Date(value);
  }
  return null;
};

const formatDateHeader = (value) => {
  const date = parseLocalDate(value);
  if (!date || Number.isNaN(date.getTime())) return 'Unknown';
  return new Intl.DateTimeFormat('en-US', {
    month: 'long',
    day: 'numeric'
  }).format(date);
};

const formatDateLong = (value) => {
  const date = parseLocalDate(value);
  if (!date || Number.isNaN(date.getTime())) return 'Unknown';
  return new Intl.DateTimeFormat('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric'
  }).format(date);
};

const formatDateShort = (value) => {
  const date = parseLocalDate(value);
  if (!date || Number.isNaN(date.getTime())) return 'Unknown';
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

const normalizePhoneKey = (phone) => {
  if (!phone) return '';
  return phone.replace(/\D/g, '');
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

const parseItems = (items) => {
  if (!items) return [];
  if (Array.isArray(items)) return items;
  try {
    return JSON.parse(items);
  } catch {
    return [];
  }
};

const normalizeStatus = (status) => {
  if (!status) return 'pending';
  if (status === 'reserved') return 'pending';
  if (status === 'cancelled') return 'cancelled';
  if (status === 'picked_up' || status === 'fulfilled') return 'picked_up';
  return 'pending';
};

const mergeStatuses = (orders) => {
  const statuses = orders.map((order) => normalizeStatus(order.status));
  if (statuses.length === 0) return 'pending';
  if (statuses.every((status) => status === 'picked_up')) return 'picked_up';
  if (statuses.every((status) => status === 'cancelled')) return 'cancelled';
  if (statuses.includes('pending')) return 'pending';
  if (statuses.includes('picked_up')) return 'picked_up';
  return 'pending';
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
  },
  {
    key: 'lamb',
    label: 'Lamb',
    matcher: (name) => name.includes('Lamb') || name.includes('Agneau')
  }
];

const buildShortSummary = (items, itemCount) => {
  const counts = {
    hens: 0,
    chickens: 0,
    lamb: 0
  };
  items.forEach((item) => {
    if (STOCK_CATEGORIES[0].matcher(item.displayName)) {
      counts.hens += item.quantity;
      return;
    }
    if (STOCK_CATEGORIES[1].matcher(item.displayName)) {
      counts.chickens += item.quantity;
      return;
    }
    if (STOCK_CATEGORIES[2].matcher(item.displayName)) {
      counts.lamb += item.quantity;
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
  if (counts.lamb) {
    parts.push(
      `${counts.lamb} ${counts.lamb === 1 ? 'lamb' : 'lambs'}`
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

export {
  LOCATION_LABELS,
  LOCATION_OPTIONS,
  TAB_CONFIG,
  buildPickupKey,
  parsePickupKey,
  normalizeDate,
  formatDateHeader,
  formatDateLong,
  formatDateShort,
  formatCurrency,
  formatPhoneLink,
  formatPhoneDisplay,
  normalizePhoneKey,
  getDisplayName,
  formatLocationShort,
  shortenItemLabel,
  normalizePaymentType,
  parseItems,
  normalizeStatus,
  mergeStatuses,
  buildShortSummary
};
