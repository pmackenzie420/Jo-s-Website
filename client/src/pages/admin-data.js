import {
  LOCATION_LABELS,
  buildPickupKey,
  normalizeDate,
  formatCurrency,
  normalizePhoneKey,
  getDisplayName,
  shortenItemLabel,
  normalizePaymentType,
  parseItems,
  normalizeStatus,
  mergeStatuses,
  buildShortSummary
} from './admin-utils';

const parseCalendarDateKey = (value) => {
  if (typeof value !== 'string') return null;
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  return {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3])
  };
};

const buildOrdersWithDetails = (orders, hens, language = 'en') => {
  const henNameById = new Map(hens.map((henItem) => [Number(henItem.id), henItem.name]));

  return orders.map((order) => {
    const items = parseItems(order.items);
    const orderItems = items.map((item) => {
      const quantity = Number(item.quantity ?? item.qty ?? 0);
      const id = Number(item.id);
      const name = henNameById.get(id) || item.name || 'Item';
      return {
        id,
        name,
        quantity,
        displayName: getDisplayName(name, language)
      };
    });
    const itemCount = orderItems.reduce((total, item) => total + item.quantity, 0);
    const itemSummary = orderItems
      .map((item) => `${item.quantity} x ${item.displayName}`)
      .join(', ');
    const itemSummaryCompact = orderItems
      .map((item) => `${item.quantity} x ${shortenItemLabel(item.displayName)}`)
      .join(', ');
    const itemSummaryShort = buildShortSummary(orderItems, itemCount, language);
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
    const status = String(order.status || '').trim().toLowerCase();
    const PAYMENT_METHOD_LABELS = {
      etransfer: 'E-transfer',
      cash: 'Cash',
      cheque: 'Cheque',
      credit_card: 'Credit card'
    };
    const methodLabel = order.payment_method
      ? PAYMENT_METHOD_LABELS[order.payment_method] || order.payment_method
      : '';
    let paymentSummary = '';
    if (status === 'cancelled') {
      paymentSummary = 'Cancelled';
    } else if (status === 'reserved') {
      paymentSummary = 'Awaiting payment';
    } else if (status === 'picked_up' || status === 'fulfilled') {
      paymentSummary = 'Picked up';
    } else {
      const detail = paymentType === 'deposit'
        ? (amountDue > 0
          ? `Deposit paid · Due ${formatCurrency(amountDue)}`
          : 'Deposit paid')
        : 'Paid in full';
      paymentSummary = methodLabel ? `${methodLabel} · ${detail}` : detail;
    }

    return {
      ...order,
      orderItems,
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
      paymentSummary,
      itemCount,
      itemSummary,
      itemSummaryCompact,
      itemSummaryShort
    };
  });
};

const buildGroupedPickups = (ordersWithDetails, language = 'en') => {
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
    const dateA = parseCalendarDateKey(a[0]);
    const dateB = parseCalendarDateKey(b[0]);
    if (!dateA || !dateB) {
      if (dateA && !dateB) return -1;
      if (!dateA && dateB) return 1;
      return String(a[0]).localeCompare(String(b[0]));
    }
    if (dateA.year !== dateB.year) return dateA.year - dateB.year;
    if (dateA.month !== dateB.month) return dateA.month - dateB.month;
    return dateA.day - dateB.day;
  });

  return sortedDates.map(([date, locations]) => {
    const locationGroups = Array.from(locations.entries())
      .map(([location, ordersList]) => {
        const locationLabel = LOCATION_LABELS[location] || location;
        const sortedOrders = [...ordersList].sort((first, second) =>
          first.customerName.localeCompare(second.customerName)
        );
        const customerMap = new Map();
        sortedOrders.forEach((order) => {
          const key = normalizePhoneKey(order.customerPhone) || order.id;
          if (!customerMap.has(key)) {
            customerMap.set(key, {
              key,
              customerName: order.customerName,
              customerPhone: order.customerPhone,
              customerEmail: order.customerEmail,
              customerAddress: order.customerAddress,
              orders: []
            });
          }
          customerMap.get(key).orders.push(order);
        });

        const customerOrders = Array.from(customerMap.values()).map((customer) => {
          const itemMap = new Map();
          let itemCount = 0;
          customer.orders.forEach((order) => {
            order.orderItems.forEach((item) => {
              const qty = Number(item.quantity ?? 0);
              if (!Number.isFinite(qty) || qty <= 0) return;
              itemCount += qty;
              const label = item.displayName;
              itemMap.set(label, (itemMap.get(label) || 0) + qty);
            });
          });
          const mergedItems = Array.from(itemMap.entries()).map(([displayName, quantity]) => ({
            displayName,
            quantity
          }));
          const fallbackSummary = `${itemCount} ${itemCount === 1 ? 'item' : 'items'}`;
          const itemSummary = mergedItems.length
            ? mergedItems.map((item) => `${item.quantity} x ${item.displayName}`).join(', ')
            : fallbackSummary;
          const itemSummaryCompact = mergedItems.length
            ? mergedItems
                .map((item) => `${item.quantity} x ${shortenItemLabel(item.displayName)}`)
                .join(', ')
            : fallbackSummary;
          const itemSummaryShort = buildShortSummary(mergedItems, itemCount, language);
          const totalAmount = customer.orders.reduce((sum, order) => sum + order.totalAmount, 0);
          const amountPaid = customer.orders.reduce((sum, order) => sum + order.amountPaid, 0);
          const amountDue = customer.orders.reduce((sum, order) => sum + order.amountDue, 0);
          const hasDepositPayment = customer.orders.some(
            (order) => order.paymentType === 'deposit'
          );
          const paymentSummary = hasDepositPayment
            ? (amountDue > 0 ? `Due ${formatCurrency(amountDue)}` : 'Deposit')
            : 'Paid';
          const activeOrderIds = customer.orders
            .filter((order) => normalizeStatus(order.status) !== 'cancelled')
            .map((order) => order.id);
          return {
            ...customer,
            orderIds: customer.orders.map((order) => order.id),
            activeOrderIds,
            mergedItems,
            pickupDate: date,
            pickupLocation: location,
            pickupLocationLabel: locationLabel,
            status: mergeStatuses(customer.orders),
            itemCount,
            itemSummary,
            itemSummaryCompact,
            itemSummaryShort,
            totalAmount,
            amountPaid,
            amountDue,
            paymentSummary
          };
        });
        customerOrders.sort((first, second) =>
          first.customerName.localeCompare(second.customerName)
        );
        const activeOrderIds = sortedOrders
          .filter((order) => normalizeStatus(order.status) !== 'cancelled')
          .map((order) => order.id);
        return {
          date,
          location,
          locationLabel,
          orders: customerOrders,
          orderCount: sortedOrders.length,
          customerCount: customerOrders.length,
          orderIds: sortedOrders.map((order) => order.id),
          activeOrderIds
        };
      })
      .sort((a, b) => a.locationLabel.localeCompare(b.locationLabel));
    const totalOrders = locationGroups.reduce((sum, group) => sum + group.orderCount, 0);
    const totalCustomers = locationGroups.reduce((sum, group) => sum + group.customerCount, 0);
    const activeOrderIds = locationGroups.flatMap((group) => group.activeOrderIds || []);
    return { date, locations: locationGroups, totalOrders, totalCustomers, activeOrderIds };
  });
};

const buildCustomers = (ordersWithDetails) => {
  const customerMap = new Map();
  ordersWithDetails.forEach((order) => {
    const key = normalizePhoneKey(order.customerPhone) || order.id;
    const sortDate = order.pickupDate || order.orderDate;
    if (!customerMap.has(key)) {
      customerMap.set(key, {
        key,
        name: order.customerName,
        phone: order.customerPhone,
        email: order.customerEmail,
        address: order.customerAddress,
        firstOrderDate: sortDate,
        lastOrderDate: sortDate,
        orders: [],
        totalSpend: 0
      });
    }
    const customer = customerMap.get(key);
    customer.orders.push(order);
    customer.totalSpend += order.totalAmount;
    if (sortDate < customer.firstOrderDate) {
      customer.firstOrderDate = sortDate;
    }
    if (sortDate > customer.lastOrderDate) {
      customer.lastOrderDate = sortDate;
    }
  });
  const list = Array.from(customerMap.values()).map((customer) => ({
    ...customer,
    orderCount: customer.orders.length
  }));
  return list.sort((a, b) => b.lastOrderDate.localeCompare(a.lastOrderDate));
};

const filterCustomers = (customers, searchQuery) => {
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
};

const buildOrderCountByPickupKey = (ordersWithDetails) => {
  const counts = new Map();
  ordersWithDetails.forEach((order) => {
    const key = buildPickupKey(order.pickupDate, order.pickupLocation);
    counts.set(key, (counts.get(key) || 0) + 1);
  });
  return counts;
};

export {
  buildOrdersWithDetails,
  buildGroupedPickups,
  buildCustomers,
  filterCustomers,
  buildOrderCountByPickupKey
};
