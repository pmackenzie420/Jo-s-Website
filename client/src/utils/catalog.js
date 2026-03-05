import PRICING_RULES from '../../../shared/pricing-rules.json';

const CATEGORY_LIST = Array.isArray(PRICING_RULES?.categories)
  ? PRICING_RULES.categories
  : [];

const normalizeName = (value) => {
  if (typeof value !== 'string') return '';
  return value.toLowerCase();
};

const findCategoryByName = (name) => {
  const normalized = normalizeName(name);
  if (!normalized) return null;
  return (
    CATEGORY_LIST.find((category) =>
      (category?.keywords || []).some((keyword) =>
        normalized.includes(String(keyword).toLowerCase())
      )
    ) || null
  );
};

const findCategoryByKey = (key) =>
  CATEGORY_LIST.find((category) => category?.key === key) || null;

const getUnitCentsFromCategory = (category, quantity) => {
  const qty = Number(quantity);
  if (!category || !Number.isFinite(qty) || qty <= 0) return 0;
  const tiers = Array.isArray(category.tiers) ? category.tiers : [];
  const sorted = [...tiers].sort(
    (first, second) => Number(second.minQty || 0) - Number(first.minQty || 0)
  );
  const match = sorted.find((tier) => qty >= Number(tier.minQty || 0));
  return Number(match?.unitCents || 0);
};

const getTierPrice = (name, quantity) => {
  const category = findCategoryByName(name);
  return getUnitCentsFromCategory(category, quantity) / 100;
};

const isCategory = (name, key) => findCategoryByName(name)?.key === key;

const isLohmannHenName = (name) => isCategory(name, 'layer');
const isMeatHenName = (name) => isCategory(name, 'meat');
const isLambName = (name) => isCategory(name, 'lamb');

const getMinOrderQuantity = (name) =>
  Number(findCategoryByName(name)?.minOrderQty || 0);

const isPickupRestricted = (name, pickupLocation) => {
  const normalizedLocation = normalizeName(pickupLocation);
  if (!normalizedLocation) return false;
  const restricted = findCategoryByName(name)?.restrictedPickupLocations || [];
  return restricted.some(
    (location) => String(location).toLowerCase() === normalizedLocation
  );
};

const getDepositEligibleMinQty = () =>
  Number(findCategoryByKey('layer')?.depositEligibleMinQty || 0);

const getDepositRequiredAboveQty = () =>
  Number(findCategoryByKey('layer')?.depositRequiredAboveQty || 0);

const getDepositRate = () => {
  const rate = Number(findCategoryByKey('layer')?.depositRate);
  if (!Number.isFinite(rate)) return 0.25;
  return Math.min(Math.max(rate, 0), 1);
};

export {
  getTierPrice,
  isLohmannHenName,
  isMeatHenName,
  isLambName,
  getMinOrderQuantity,
  isPickupRestricted,
  getDepositEligibleMinQty,
  getDepositRequiredAboveQty,
  getDepositRate,
};
