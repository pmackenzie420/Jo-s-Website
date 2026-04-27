const normalizeOrderSourceType = (value) => {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'customer') return 'customer';
  if (normalized === 'team') return 'team';
  if (normalized === 'system') return 'system';
  return 'unknown';
};

const normalizeBoolean = (value) => {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (normalized === 'true') return true;
    if (normalized === 'false') return false;
  }
  return false;
};

const buildOrderSource = (order) => {
  const actorType = String(
    order?.order_created_actor_type
    || order?.orderCreatedActorType
    || ''
  ).trim().toLowerCase();
  const actorId = String(
    order?.order_created_actor_id
    || order?.orderCreatedActorId
    || ''
  ).trim();
  const requestId = String(
    order?.order_created_request_id
    || order?.orderCreatedRequestId
    || ''
  ).trim();
  const createdAt = String(
    order?.order_created_at
    || order?.orderCreatedAt
    || ''
  ).trim();
  const inferred = normalizeBoolean(
    order?.order_created_backfilled
    ?? order?.orderCreatedBackfilled
    ?? order?.orderSource?.inferred
  );
  const inferredFrom = String(
    order?.order_created_inferred_from
    || order?.orderCreatedInferredFrom
    || order?.orderSource?.inferredFrom
    || ''
  ).trim();

  let source = 'unknown';
  if (actorType === 'checkout') {
    source = 'customer';
  } else if (actorType === 'admin') {
    source = 'team';
  } else if (actorType === 'system') {
    source = 'system';
  }

  return {
    source,
    actorType,
    actorId,
    requestId,
    createdAt,
    inferred,
    inferredFrom,
    tracked: Boolean(actorType || createdAt)
  };
};

const getOrderSourceType = (order) => {
  const normalizedSource = normalizeOrderSourceType(order?.orderSource?.source);
  if (normalizedSource !== 'unknown') return normalizedSource;
  return buildOrderSource(order).source;
};

const isOrderSourceInferred = (order) => {
  if (typeof order?.orderSource?.inferred === 'boolean') {
    return order.orderSource.inferred;
  }
  return buildOrderSource(order).inferred;
};

const getOrderSourceTranslationKey = (order) => {
  const sourceType = getOrderSourceType(order);
  if (sourceType === 'unknown') return 'orderSource.unknown';
  return isOrderSourceInferred(order)
    ? `orderSource.${sourceType}Inferred`
    : `orderSource.${sourceType}`;
};

export {
  buildOrderSource,
  getOrderSourceType,
  isOrderSourceInferred,
  getOrderSourceTranslationKey
};
