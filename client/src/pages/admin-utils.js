import LOCATION_DETAILS from '../../../shared/locations.json';
import { t } from './admin-i18n';

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

const TAB_KEYS = [
  { key: 'pickups', i18nKey: 'tab.pickups' },
  { key: 'stock',   i18nKey: 'tab.stock' },
  { key: 'dates',   i18nKey: 'tab.dates' },
  { key: 'create',  i18nKey: 'tab.create' },
  { key: 'search',  i18nKey: 'tab.search' },
  { key: 'email',   i18nKey: 'tab.email' }
];

const getTabConfig = (lang) =>
  TAB_KEYS.map((tab) => ({ key: tab.key, label: t(tab.i18nKey, lang) }));

const pad2 = (value) => String(value).padStart(2, '0');

const normalizeDate = (value) => {
  if (!value) return 'Unknown';
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
      return trimmed;
    }
    const parsed = new Date(trimmed);
    if (!Number.isNaN(parsed.getTime())) {
      return `${parsed.getFullYear()}-${pad2(parsed.getMonth() + 1)}-${pad2(parsed.getDate())}`;
    }
    return trimmed.includes('T') ? trimmed.split('T')[0] : trimmed;
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
    return new Date(value);
  }
  return null;
};

const dateLocale = (lang) => (lang === 'fr' ? 'fr-CA' : 'en-US');

const formatDateHeader = (value, lang) => {
  const date = parseLocalDate(value);
  if (!date || Number.isNaN(date.getTime())) return 'Unknown';
  return new Intl.DateTimeFormat(dateLocale(lang), {
    month: 'long',
    day: 'numeric'
  }).format(date);
};

const formatDateLong = (value, lang) => {
  const date = parseLocalDate(value);
  if (!date || Number.isNaN(date.getTime())) return 'Unknown';
  return new Intl.DateTimeFormat(dateLocale(lang), {
    month: 'long',
    day: 'numeric',
    year: 'numeric'
  }).format(date);
};

const formatDateShort = (value, lang) => {
  const date = parseLocalDate(value);
  if (!date || Number.isNaN(date.getTime())) return 'Unknown';
  return new Intl.DateTimeFormat(dateLocale(lang), {
    month: 'short',
    day: 'numeric'
  }).format(date);
};

const formatCurrency = (amount) => {
  const parts = amount.toFixed(2).split('.');
  parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `$${parts.join('.')}`;
};

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

const getLocalizedProductName = (name, language = 'en') => {
  if (!name) return 'Item';
  const parts = String(name)
    .split(' / ')
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length === 0) return 'Item';
  if (parts.length === 1) return parts[0];
  if (String(language || '').toLowerCase() === 'fr') {
    return parts[1] || parts[0];
  }
  return parts[0];
};

const getDisplayName = (name, language = 'en') => getLocalizedProductName(name, language);

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
  if (status === 'archived') return 'archived';
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
    matcher: (name) => (
      /lohmann/i.test(name)
      || /ready[-\s]?to[-\s]?lay/i.test(name)
      || /pr[eê]tes?\s+à\s+pondre/i.test(name)
      || /poules?\s+pr[eê]tes?/i.test(name)
    )
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

const buildShortSummary = (items, itemCount, language = 'en') => {
  const isFrench = String(language || '').toLowerCase() === 'fr';
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
      isFrench
        ? `${counts.hens} ${counts.hens === 1 ? 'poule prête à pondre' : 'poules prêtes à pondre'}`
        : `${counts.hens} ready-to-lay ${counts.hens === 1 ? 'hen' : 'hens'}`
    );
  }
  if (counts.chickens) {
    parts.push(
      isFrench
        ? `${counts.chickens} ${counts.chickens === 1 ? 'poulet de chair' : 'poulets de chair'}`
        : `${counts.chickens} meat ${counts.chickens === 1 ? 'chicken' : 'chickens'}`
    );
  }
  if (counts.lamb) {
    parts.push(
      isFrench
        ? `${counts.lamb} ${counts.lamb === 1 ? 'agneau' : 'agneaux'}`
        : `${counts.lamb} ${counts.lamb === 1 ? 'lamb' : 'lambs'}`
    );
  }
  if (parts.length) {
    return parts.join(' · ');
  }
  if (itemCount > 0) {
    return isFrench
      ? `${itemCount} ${itemCount === 1 ? 'article' : 'articles'}`
      : `${itemCount} ${itemCount === 1 ? 'item' : 'items'}`;
  }
  return isFrench ? 'Articles' : 'Items';
};

export {
  LOCATION_LABELS,
  LOCATION_OPTIONS,
  getTabConfig,
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
  getLocalizedProductName,
  getDisplayName,
  formatLocationShort,
  shortenItemLabel,
  normalizePaymentType,
  parseItems,
  normalizeStatus,
  mergeStatuses,
  buildShortSummary
};
