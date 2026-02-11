import PRICING_RULES from '../../../shared/pricing-rules.json';

const CATEGORY_LIST = Array.isArray(PRICING_RULES?.categories)
  ? PRICING_RULES.categories
  : [];
const TEMP_BROWN_LAYER_TEST_PRICE_CENTS = 1;
const TEMP_BROWN_LAYER_TEST_HEN_ID = 1;

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

const isBrownLayerName = (name, category) => {
  const normalized = normalizeName(name);
  if (!normalized) return false;
  if (!category || category.key !== 'layer') return false;
  return normalized.includes('brown') || normalized.includes('brune');
};

const getTierPrice = (name, quantity, henId) => {
  const category = findCategoryByName(name);
  if (isBrownLayerName(name, category) || Number(henId) === TEMP_BROWN_LAYER_TEST_HEN_ID) {
    return TEMP_BROWN_LAYER_TEST_PRICE_CENTS / 100;
  }
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

export {
  getTierPrice,
  isLohmannHenName,
  isMeatHenName,
  isLambName,
  getMinOrderQuantity,
  isPickupRestricted,
  getDepositEligibleMinQty,
};
