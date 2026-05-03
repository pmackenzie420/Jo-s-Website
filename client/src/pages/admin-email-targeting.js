const EMAIL_PATTERN = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;

const normalizeOrderNumber = (value) => {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return null;
  return Math.floor(number);
};

const toDistinctStrings = (values) => (
  Array.from(
    new Set(
      (Array.isArray(values) ? values : [])
        .map((value) => String(value || '').trim())
        .filter(Boolean)
    )
  )
);

const normalizeEmail = (value) => String(value || '').trim().toLowerCase();

const pickRecipientName = (customer) => {
  const directName = String(customer?.customerName || '').trim();
  if (directName) return directName;
  const orders = Array.isArray(customer?.orders) ? customer.orders : [];
  const orderWithName = orders.find((order) => String(order?.customerName || '').trim());
  return String(orderWithName?.customerName || '').trim();
};

const pickRecipientLanguage = (customer) => {
  const orders = Array.isArray(customer?.orders) ? customer.orders : [];
  const orderWithLanguage = orders.find((order) => String(order?.language || '').trim());
  return String(orderWithLanguage?.language || '').trim().toLowerCase();
};

const trimTargetToken = (value) => String(value || '')
  .trim()
  .replace(/^[<>()\]{}"'`[]+/, '')
  .replace(/[<>()\]{}"'`,.;:[]+$/, '')
  .trim();

const looksLikeLooseOrderId = (value) => {
  const normalized = trimTargetToken(value);
  return normalized.length >= 8 && /[a-z]/i.test(normalized) && /\d/.test(normalized);
};

const parseCsvLine = (line) => {
  const values = [];
  let current = '';
  let inQuotes = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === '"') {
      const nextChar = line[index + 1];
      if (inQuotes && nextChar === '"') {
        current += '"';
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if (char === ',' && !inQuotes) {
      values.push(current.trim());
      current = '';
      continue;
    }
    current += char;
  }

  values.push(current.trim());
  return values;
};

const extractAuditCsvFields = (value) => {
  const lines = String(value || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length < 2) return '';

  const header = parseCsvLine(lines[0]).map((cell) => cell.trim().toLowerCase());
  const findHeaderIndex = (...names) => header.findIndex((cell) => names.includes(cell));
  const emailIndex = findHeaderIndex('email', 'emails');
  const orderNumberIndex = findHeaderIndex('order_numbers', 'order_number');
  const orderIdIndex = findHeaderIndex('order_ids', 'order_id');
  const relevantIndexes = [emailIndex, orderNumberIndex, orderIdIndex].filter((index) => index >= 0);
  if (relevantIndexes.length === 0) return '';

  return lines
    .slice(1)
    .flatMap((line) => {
      const cells = parseCsvLine(line);
      return relevantIndexes.map((index) => cells[index] || '');
    })
    .filter(Boolean)
    .join('\n');
};

const collectTargetCandidates = (value, knownOrderIds) => {
  const raw = String(value || '');
  const sourceText = extractAuditCsvFields(raw) || raw;
  const candidates = new Map();
  const pushCandidate = (kind, normalized, display) => {
    const key = `${kind}:${normalized}`;
    if (!normalized || candidates.has(key)) return;
    candidates.set(key, {
      key,
      kind,
      normalized,
      display: String(display || normalized).trim() || normalized
    });
  };

  for (const match of sourceText.matchAll(EMAIL_PATTERN)) {
    const email = normalizeEmail(match[0]);
    pushCandidate('email', email, email);
  }

  const remainder = sourceText.replace(EMAIL_PATTERN, ' ');
  remainder
    .split(/[\s,;]+/)
    .map(trimTargetToken)
    .filter(Boolean)
    .forEach((token) => {
      const normalizedNumber = normalizeOrderNumber(token.replace(/^#/, ''));
      if (normalizedNumber) {
        pushCandidate('orderNumber', String(normalizedNumber), `#${normalizedNumber}`);
        return;
      }

      const normalizedToken = token.toLowerCase();
      if (knownOrderIds.has(normalizedToken)) {
        pushCandidate('orderId', normalizedToken, token);
        return;
      }

      if (looksLikeLooseOrderId(token)) {
        pushCandidate('unknown', normalizedToken, token);
      }
    });

  return Array.from(candidates.values());
};

const buildRecipientMatcher = (recipient, candidateSets, matchedKeys) => {
  const email = normalizeEmail(recipient?.email);
  const orderIds = toDistinctStrings(recipient?.orderIds).map((value) => value.toLowerCase());
  const orderNumbers = toDistinctStrings(recipient?.orderNumbers);
  let matched = false;

  if (email && candidateSets.email.has(email)) {
    matchedKeys.add(`email:${email}`);
    matched = true;
  }

  for (const orderId of orderIds) {
    if (!candidateSets.orderId.has(orderId)) continue;
    matchedKeys.add(`orderId:${orderId}`);
    matched = true;
  }

  for (const orderNumber of orderNumbers) {
    if (!candidateSets.orderNumber.has(orderNumber)) continue;
    matchedKeys.add(`orderNumber:${orderNumber}`);
    matched = true;
  }

  return matched;
};

const buildGroupEmailRecipients = (pickupCustomers) => {
  const recipientsByEmail = new Map();

  for (const customer of Array.isArray(pickupCustomers) ? pickupCustomers : []) {
    const email = normalizeEmail(customer?.customerEmail);
    if (!email) continue;

    const orders = Array.isArray(customer?.orders) ? customer.orders : [];
    const orderIds = toDistinctStrings(
      (Array.isArray(customer?.activeOrderIds) && customer.activeOrderIds.length > 0)
        ? customer.activeOrderIds
        : (Array.isArray(customer?.orderIds) ? customer.orderIds : orders.map((order) => order?.id))
    );
    const orderNumbers = toDistinctStrings(
      orders
        .map((order) => normalizeOrderNumber(order?.order_number ?? order?.orderNumber))
        .filter(Boolean)
        .map(String)
    );
    const nextRecipient = {
      email,
      name: pickRecipientName(customer),
      language: pickRecipientLanguage(customer),
      orderIds,
      orderNumbers
    };

    if (!recipientsByEmail.has(email)) {
      recipientsByEmail.set(email, nextRecipient);
      continue;
    }

    const existing = recipientsByEmail.get(email);
    recipientsByEmail.set(email, {
      email,
      name: existing.name || nextRecipient.name,
      language: existing.language || nextRecipient.language,
      orderIds: toDistinctStrings([...(existing.orderIds || []), ...orderIds]),
      orderNumbers: toDistinctStrings([...(existing.orderNumbers || []), ...orderNumbers])
    });
  }

  return Array.from(recipientsByEmail.values());
};

const buildEmailRecipientTargeting = (recipients, targetInput) => {
  const normalizedRecipients = Array.isArray(recipients) ? recipients : [];
  const knownOrderIds = new Set(
    normalizedRecipients
      .flatMap((recipient) => toDistinctStrings(recipient?.orderIds))
      .map((value) => value.toLowerCase())
  );
  const candidates = collectTargetCandidates(targetInput, knownOrderIds);
  const candidateSets = {
    email: new Set(candidates.filter((candidate) => candidate.kind === 'email').map((candidate) => candidate.normalized)),
    orderId: new Set(candidates.filter((candidate) => candidate.kind === 'orderId').map((candidate) => candidate.normalized)),
    orderNumber: new Set(candidates.filter((candidate) => candidate.kind === 'orderNumber').map((candidate) => candidate.normalized))
  };

  if (candidates.length === 0) {
    return {
      hasTargets: false,
      totalRecipients: normalizedRecipients.length,
      selectedRecipients: normalizedRecipients,
      selectedRecipientCount: normalizedRecipients.length,
      selectedOrderCount: toDistinctStrings(
        normalizedRecipients.flatMap((recipient) => recipient?.orderIds || [])
      ).length,
      matchedValueCount: 0,
      unmatchedTokens: []
    };
  }

  const matchedKeys = new Set();
  const selectedRecipients = normalizedRecipients.filter((recipient) =>
    buildRecipientMatcher(recipient, candidateSets, matchedKeys)
  );

  const unmatchedTokens = candidates
    .filter((candidate) => candidate.kind === 'unknown' || !matchedKeys.has(candidate.key))
    .map((candidate) => candidate.display);

  return {
    hasTargets: true,
    totalRecipients: normalizedRecipients.length,
    selectedRecipients,
    selectedRecipientCount: selectedRecipients.length,
    selectedOrderCount: toDistinctStrings(
      selectedRecipients.flatMap((recipient) => recipient?.orderIds || [])
    ).length,
    matchedValueCount: candidates.length - unmatchedTokens.length,
    unmatchedTokens
  };
};

export {
  buildGroupEmailRecipients,
  buildEmailRecipientTargeting
};
