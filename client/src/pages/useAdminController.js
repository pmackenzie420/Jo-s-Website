import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  LOCATION_LABELS,
  LOCATION_OPTIONS,
  parsePickupKey,
  normalizeDate,
  formatDateLong,
  normalizeStatus
} from './admin-utils';
import {
  login,
  checkSession,
  fetchAdminMeta,
  fetchOrdersPage,
  updatePickupStock,
  addPickupDate,
  updatePickupDate,
  deletePickupDate,
  updateOrdersStatus
} from './admin-api';
import {
  buildOrdersWithDetails,
  buildGroupedPickups,
  buildCustomers,
  filterCustomers,
  buildOrderCountByPickupKey
} from './admin-data';
import { exportOrdersPdf } from './admin-export';
import useAdminNotice from './admin-hooks/useAdminNotice';
import useAdminEmailComposer from './admin-hooks/useAdminEmailComposer';

const ORDERS_PAGE_LIMIT = 500;
const ADMIN_ALLOWED_ORDER_STATUSES = new Set([
  'reserved',
  'pending',
  'paid',
  'fulfilled',
  'picked_up',
  'cancelled'
]);
const pluralize = (count, singular, plural = `${singular}s`) => (
  count === 1 ? singular : plural
);
const formatEmailOutcomeSummary = ({ total, sent, failed }) => (
  `Sent ${total} ${pluralize(total, 'email')}: ${sent} ${pluralize(sent, 'success', 'successes')}, ${failed} ${pluralize(failed, 'failure')}.`
);

export default function useAdminController() {
  const [password, setPassword] = useState('');
  const [otp, setOtp] = useState('');
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [orders, setOrders] = useState([]);
  const [ordersHasMore, setOrdersHasMore] = useState(false);
  const [ordersLoadingMore, setOrdersLoadingMore] = useState(false);
  const [hens, setHens] = useState([]);
  const [dates, setDates] = useState([]);
  const [dataLoading, setDataLoading] = useState(false);
  const [scheduleLoading, setScheduleLoading] = useState(null);
  const [activeTab, setActiveTab] = useState('pickups');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCustomer, setSelectedCustomer] = useState(null);
  const [selectedPickup, setSelectedPickup] = useState(null);
  const [newPickupDate, setNewPickupDate] = useState('');
  const [newPickupLocation, setNewPickupLocation] = useState(LOCATION_OPTIONS[0]?.value || '');
  const [changingDateId, setChangingDateId] = useState(null);
  const [changePickupDate, setChangePickupDate] = useState('');
  const [changeEmailUsers, setChangeEmailUsers] = useState(false);
  const [allPickupStocks, setAllPickupStocks] = useState({});
  const [allPickupReserved, setAllPickupReserved] = useState({});
  const [pickupStockSaving, setPickupStockSaving] = useState(null);
  const [dirtyStockKeys, setDirtyStockKeys] = useState(new Set());
  const [isAddingDate, setIsAddingDate] = useState(false);
  const [optimisticStatuses, setOptimisticStatuses] = useState({});

  const dateInputRef = useRef(null);
  const { notice, setNotice, showToast, handleNoticeAction } = useAdminNotice();
  const {
    emailGroupKey,
    emailSubject,
    emailMessage,
    emailSending,
    emailFailedRecipients,
    setEmailGroupKey,
    setEmailSubject,
    setEmailMessage,
    handleToggleEmailGroup,
    handleSendGroupEmail
  } = useAdminEmailComposer(showToast);

  const applyMetaPayload = useCallback((payload) => {
    setHens(Array.isArray(payload?.hens) ? payload.hens : []);
    setDates(Array.isArray(payload?.dates) ? payload.dates : []);
    setAllPickupStocks(
      payload?.pickupStocks && typeof payload.pickupStocks === 'object'
        ? payload.pickupStocks
        : {}
    );
    setAllPickupReserved(
      payload?.pickupReserved && typeof payload.pickupReserved === 'object'
        ? payload.pickupReserved
        : {}
    );
  }, []);

  const applyOrdersPayload = useCallback((payload, { append = false } = {}) => {
    const nextOrders = Array.isArray(payload?.orders) ? payload.orders : [];
    setOrders((prev) => (append ? [...prev, ...nextOrders] : nextOrders));
    setOrdersHasMore(Boolean(payload?.hasMore));
  }, []);

  const refreshMeta = useCallback(async () => {
    try {
      const response = await fetchAdminMeta();
      applyMetaPayload(response.data || {});
      return true;
    } catch {
      showToast({ type: 'error', text: 'Failed to refresh admin metadata.' });
      return false;
    }
  }, [applyMetaPayload, showToast]);

  const refreshOrders = useCallback(
    async ({ quiet = true } = {}) => {
      if (!quiet) {
        setDataLoading(true);
      }
      try {
        const limit = Math.max(ORDERS_PAGE_LIMIT, orders.length || 0);
        const response = await fetchOrdersPage({
          limit,
          offset: 0
        });
        applyOrdersPayload(response.data || {}, { append: false });
        return true;
      } catch {
        showToast({ type: 'error', text: 'Failed to refresh admin orders.' });
        return false;
      } finally {
        if (!quiet) {
          setDataLoading(false);
        }
      }
    },
    [applyOrdersPayload, orders.length, showToast]
  );

  const fetchInitialData = useCallback(async () => {
    setDataLoading(true);
    try {
      const [metaResponse, ordersResponse] = await Promise.all([
        fetchAdminMeta(),
        fetchOrdersPage({ limit: ORDERS_PAGE_LIMIT, offset: 0 })
      ]);
      applyMetaPayload(metaResponse.data || {});
      applyOrdersPayload(ordersResponse.data || {}, { append: false });
      return true;
    } catch {
      showToast({ type: 'error', text: 'Failed to load admin data.' });
      return false;
    } finally {
      setDataLoading(false);
    }
  }, [applyMetaPayload, applyOrdersPayload, showToast]);

  const handleLoadMoreOrders = useCallback(async () => {
    if (ordersLoadingMore || dataLoading || !ordersHasMore) {
      return;
    }
    setOrdersLoadingMore(true);
    try {
      const response = await fetchOrdersPage({
        limit: ORDERS_PAGE_LIMIT,
        offset: orders.length
      });
      applyOrdersPayload(response.data || {}, { append: true });
    } catch {
      showToast({ type: 'error', text: 'Failed to load more orders.' });
    } finally {
      setOrdersLoadingMore(false);
    }
  }, [ordersLoadingMore, dataLoading, ordersHasMore, orders.length, applyOrdersPayload, showToast]);

  useEffect(() => {
    const run = async () => {
      try {
        await checkSession();
        setIsLoggedIn(true);
        await fetchInitialData();
      } catch {
        setIsLoggedIn(false);
      }
    };
    run();
  }, [fetchInitialData]);

  const ordersWithDetails = useMemo(
    () => buildOrdersWithDetails(orders, hens),
    [orders, hens]
  );

  const failedOrdersWithDetails = useMemo(
    () => ordersWithDetails.filter((order) => normalizeStatus(order.status) === 'cancelled'),
    [ordersWithDetails]
  );

  const nonFailedOrdersWithDetails = useMemo(
    () => ordersWithDetails.filter((order) => normalizeStatus(order.status) !== 'cancelled'),
    [ordersWithDetails]
  );

  const pickupOrdersWithDetails = useMemo(
    () => nonFailedOrdersWithDetails.filter((order) =>
      String(order?.status || '').trim().toLowerCase() !== 'reserved'
    ),
    [nonFailedOrdersWithDetails]
  );

  const groupedPickups = useMemo(
    () => buildGroupedPickups(pickupOrdersWithDetails),
    [pickupOrdersWithDetails]
  );

  useEffect(() => {
    if (!groupedPickups.length) return;
    setOptimisticStatuses((prev) => {
      const next = {};
      groupedPickups.forEach((group) => {
        group.locations.forEach((locationGroup) => {
          locationGroup.orders.forEach((order) => {
            const current = normalizeStatus(order.status);
            const optimistic = prev[order.key];
            if (optimistic && optimistic !== current) {
              next[order.key] = optimistic;
            }
          });
        });
      });
      return next;
    });
  }, [groupedPickups]);

  const customers = useMemo(
    () => buildCustomers(nonFailedOrdersWithDetails),
    [nonFailedOrdersWithDetails]
  );

  const failedPickups = useMemo(
    () => failedOrdersWithDetails.map((order) => ({
      key: `failed-${order.id}`,
      customerName: order.customerName,
      customerPhone: order.customerPhone,
      customerEmail: order.customerEmail,
      customerAddress: order.customerAddress,
      pickupDate: order.pickupDate,
      pickupLocation: order.pickupLocation,
      pickupLocationLabel: order.pickupLocationLabel,
      status: 'cancelled',
      itemCount: order.itemCount,
      itemSummary: order.itemSummary,
      itemSummaryCompact: order.itemSummaryCompact,
      itemSummaryShort: order.itemSummaryShort,
      totalAmount: order.totalAmount,
      amountPaid: order.amountPaid,
      amountDue: order.amountDue,
      paymentSummary: order.paymentSummary || 'Cancelled',
      activeOrderIds: [],
      orderIds: [order.id],
      mergedItems: (order.orderItems || [])
        .map((item) => ({
          displayName: item.displayName,
          quantity: Number(item.quantity || 0)
        }))
        .filter((item) => item.quantity > 0),
      orders: [order]
    })),
    [failedOrdersWithDetails]
  );

  const filteredCustomers = useMemo(
    () => filterCustomers(customers, searchQuery),
    [customers, searchQuery]
  );

  const orderCountByPickupKey = useMemo(
    () => buildOrderCountByPickupKey(nonFailedOrdersWithDetails),
    [nonFailedOrdersWithDetails]
  );

  const handleLogin = useCallback(
    async (event) => {
      event.preventDefault();
      try {
        await login(password, otp);
        setIsLoggedIn(true);
        setNotice(null);
        setPassword('');
        setOtp('');
        await fetchInitialData();
      } catch (error) {
        if (error.response) {
          if (error.response.status === 401) {
            showToast({ type: 'error', text: 'Wrong password. Try again.' });
          } else if (error.response.status === 429) {
            showToast({ type: 'error', text: 'Too many attempts. Try later.' });
          } else {
            showToast({ type: 'error', text: 'Server error. Check connection.' });
          }
        } else {
          showToast({ type: 'error', text: 'Login failed. Check connection.' });
        }
      }
    },
    [password, otp, fetchInitialData, setNotice, showToast]
  );

  const handleExportDownload = useCallback(
    async (groupDate, locationGroup) => {
      if (dataLoading) {
        showToast({ type: 'error', text: 'Orders are still loading.' });
        return;
      }
      try {
        await exportOrdersPdf({ groupedPickups, groupDate, locationGroup });
      } catch {
        showToast({ type: 'error', text: 'Failed to export orders.' });
      }
    },
    [dataLoading, groupedPickups, showToast]
  );

  const handlePickupStockChange = useCallback((pickupKey, henId, value) => {
    setDirtyStockKeys((prev) => {
      const next = new Set(prev);
      next.add(pickupKey);
      return next;
    });
    setAllPickupStocks((prev) => ({
      ...prev,
      [pickupKey]: {
        ...(prev[pickupKey] || {}),
        [henId]: value
      }
    }));
  }, []);

  const handlePickupStockSave = useCallback(
    async (pickupKey) => {
      const { date, location } = parsePickupKey(pickupKey);
      if (!date || !location) return;

      const currentStock = allPickupStocks[pickupKey] || {};
      const items = hens.map((hen) => ({
        hen_id: hen.id,
        stock: (() => {
          const raw = Number(currentStock[hen.id] ?? 0);
          return Number.isFinite(raw) && raw >= 0 ? Math.floor(raw) : 0;
        })()
      }));

      setPickupStockSaving(pickupKey);
      try {
        await updatePickupStock({ date, location, items });
        setDirtyStockKeys((prev) => {
          const next = new Set(prev);
          next.delete(pickupKey);
          return next;
        });
        showToast({ type: 'success', text: 'Stock updated.' });
        await refreshMeta();
      } catch {
        showToast({ type: 'error', text: 'Failed to update pickup stock.' });
      } finally {
        setPickupStockSaving(null);
      }
    },
    [allPickupStocks, hens, refreshMeta, showToast]
  );

  const addDate = useCallback(
    async (dateValue, locationValue) => {
      if (!dateValue || !locationValue) return false;
      setScheduleLoading('add');
      try {
        await addPickupDate({ dateValue, location: locationValue });
        showToast({ type: 'success', text: 'Pickup date added.' });
        await refreshMeta();
        return true;
      } catch {
        showToast({ type: 'error', text: 'Failed to add pickup date.' });
        return false;
      } finally {
        setScheduleLoading(null);
      }
    },
    [refreshMeta, showToast]
  );

  const startDateChange = useCallback((dateItem) => {
    const currentDate = normalizeDate(dateItem?.date_value);
    setChangingDateId(dateItem?.id || null);
    setChangePickupDate(currentDate);
    setChangeEmailUsers(false);
  }, []);

  const cancelDateChange = useCallback(() => {
    setChangingDateId(null);
    setChangePickupDate('');
    setChangeEmailUsers(false);
  }, []);

  const applyDateChange = useCallback(
    async (dateItem) => {
      if (!dateItem?.id) return;
      if (!changePickupDate) {
        showToast({ type: 'error', text: 'Please select a new date.' });
        return;
      }

      const fromDate = normalizeDate(dateItem.date_value);
      const fromDateLabel = formatDateLong(fromDate);
      const toDateLabel = formatDateLong(changePickupDate);

      const warningText = changeEmailUsers
        ? `Email users with pickup date change from ${fromDateLabel} to ${toDateLabel}?`
        : `Apply pickup date change from ${fromDateLabel} to ${toDateLabel} without emailing users?`;
      const confirmed = window.confirm(warningText);
      if (!confirmed) return;

      const loadingKey = `change:${dateItem.id}`;
      setScheduleLoading(loadingKey);
      try {
        const response = await updatePickupDate({
          dateId: dateItem.id,
          dateValue: changePickupDate,
          emailUsers: changeEmailUsers
        });

        const payload = response?.data || {};
        const movedOrders = Number(payload.movedOrders || 0);
        const mergedText = payload.merged ? ' Merged with existing date.' : '';
        const emailSentCount = Number(payload.emailSent || 0);
        const emailFailedCount = Number(payload.emailFailed || 0);
        const emailTotalCount = (
          Number(payload.emailRecipients || 0)
          || (emailSentCount + emailFailedCount)
        );
        const emailSummary = changeEmailUsers
          ? ` Emails: ${formatEmailOutcomeSummary({
            total: emailTotalCount,
            sent: emailSentCount,
            failed: emailFailedCount
          })}`
          : '';
        showToast({
          type: 'success',
          text: `Pickup date updated.${mergedText} ${movedOrders} orders moved.${emailSummary}`.trim()
        });

        await Promise.all([
          refreshMeta(),
          refreshOrders({ quiet: true })
        ]);
        cancelDateChange();
      } catch (error) {
        const status = error?.response?.status;
        if (status === 400 || status === 404 || status === 409) {
          showToast({
            type: 'error',
            text: error?.response?.data?.error || 'Failed to update pickup date.'
          });
        } else {
          showToast({ type: 'error', text: 'Failed to update pickup date.' });
        }
      } finally {
        setScheduleLoading(null);
      }
    },
    [
      cancelDateChange,
      changeEmailUsers,
      changePickupDate,
      refreshMeta,
      refreshOrders,
      showToast
    ]
  );

  const deleteDate = useCallback(
    async (dateItem, orderCount) => {
      if (orderCount > 0) {
        const confirmed = window.confirm('This date has existing orders. Remove it anyway?');
        if (!confirmed) return;
      }
      setScheduleLoading(dateItem.id);
      try {
        await deletePickupDate(dateItem.id);
        showToast({ type: 'success', text: 'Pickup date removed.' });
        await refreshMeta();
        if (changingDateId === dateItem.id) {
          cancelDateChange();
        }
      } catch {
        showToast({ type: 'error', text: 'Failed to remove pickup date.' });
      } finally {
        setScheduleLoading(null);
      }
    },
    [cancelDateChange, changingDateId, refreshMeta, showToast]
  );

  const updateOrderStatus = useCallback(
    async (orderIds, newStatus, _loadingKey, options = {}) => {
      if (!Array.isArray(orderIds) || orderIds.length === 0) return false;
      const {
        successMessage = 'Pickup status updated.',
        errorMessage = 'Failed to update pickup status.',
        showToast: shouldToast = true
      } = options;
      try {
        await updateOrdersStatus({ ids: orderIds, status: newStatus });
        if (shouldToast) {
          showToast({ type: 'success', text: successMessage });
        }
        await refreshOrders({ quiet: true });
        return true;
      } catch {
        if (shouldToast) {
          showToast({ type: 'error', text: errorMessage });
        }
        return false;
      }
    },
    [refreshOrders, showToast]
  );

  const handleMarkPickedUp = useCallback(
    async (order) => {
      const status = normalizeStatus(order.status);
      if (!order.activeOrderIds?.length || status === 'picked_up' || status === 'cancelled') return;

      const previousStatusById = new Map();
      for (const sourceOrder of order.orders || []) {
        const sourceId = String(sourceOrder?.id || '').trim();
        const sourceStatus = String(sourceOrder?.status || '').toLowerCase();
        if (!sourceId) continue;
        if (!ADMIN_ALLOWED_ORDER_STATUSES.has(sourceStatus)) continue;
        previousStatusById.set(sourceId, sourceStatus);
      }
      const previousMergedStatus = status;

      setSelectedPickup(null);
      setOptimisticStatuses((prev) => ({ ...prev, [order.key]: 'picked_up' }));

      const didUpdate = await updateOrderStatus(order.activeOrderIds, 'picked_up', order.key, {
        showToast: false
      });
      if (!didUpdate) {
        setOptimisticStatuses((prev) => {
          const next = { ...prev };
          delete next[order.key];
          return next;
        });
        showToast({ type: 'error', text: 'Failed to mark picked up.' });
        return;
      }

      showToast({
        type: 'success',
        text: 'Marked picked up.',
        actionLabel: 'Undo',
        duration: 5000,
        action: async () => {
          setOptimisticStatuses((prev) => ({ ...prev, [order.key]: previousMergedStatus }));
          const idsByStatus = new Map();
          for (const orderId of order.activeOrderIds) {
            const orderIdText = String(orderId || '').trim();
            if (!orderIdText) continue;
            const restoreStatus = previousStatusById.get(orderIdText) || 'pending';
            if (!idsByStatus.has(restoreStatus)) {
              idsByStatus.set(restoreStatus, []);
            }
            idsByStatus.get(restoreStatus).push(orderIdText);
          }

          try {
            for (const [restoreStatus, restoreIds] of idsByStatus.entries()) {
              await updateOrdersStatus({ ids: restoreIds, status: restoreStatus });
            }
            await refreshOrders({ quiet: true });
            setOptimisticStatuses((prev) => {
              const next = { ...prev };
              delete next[order.key];
              return next;
            });
          } catch {
            setOptimisticStatuses((prev) => ({ ...prev, [order.key]: 'picked_up' }));
            showToast({ type: 'error', text: 'Failed to undo pickup.' });
          }
        }
      });
    },
    [showToast, updateOrderStatus, refreshOrders]
  );

  const handleRowClick = useCallback((order) => {
    setSelectedPickup(order);
  }, []);

  const handleBulkPickup = useCallback(
    async (orderIds, label, loadingKey) => {
      if (!Array.isArray(orderIds) || orderIds.length === 0) {
        showToast({ type: 'error', text: 'No active pickups in this group.' });
        return;
      }
      const confirmed = window.confirm(
        `Mark all ${orderIds.length} pickups as picked up${label ? ` (${label})` : ''}?`
      );
      if (!confirmed) return;
      await updateOrderStatus(orderIds, 'picked_up', loadingKey || label || 'bulk');
    },
    [showToast, updateOrderStatus]
  );

  const handleAddDateClick = useCallback(async () => {
    if (!isAddingDate) {
      setIsAddingDate(true);
      return;
    }
    if (!newPickupDate) {
      showToast({ type: 'error', text: 'Please select a date.' });
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
      setIsAddingDate(false);
    }
  }, [
    isAddingDate,
    newPickupDate,
    newPickupLocation,
    addDate,
    showToast
  ]);

  const addDateButtonLabel = scheduleLoading === 'add'
    ? 'Adding...'
    : isAddingDate
      ? 'Confirm Pickup Date'
      : 'Add Pickup Date';

  const handleTabChange = useCallback((key) => {
    setActiveTab(key);
    setSelectedCustomer(null);
    setSelectedPickup(null);
    if (key !== 'stock') {
      cancelDateChange();
    }
    if (key !== 'search') {
      setSearchQuery('');
    }
    if (key !== 'email') {
      setEmailGroupKey(null);
    }
  }, [cancelDateChange, setEmailGroupKey]);

  return {
    password,
    otp,
    isLoggedIn,
    dates,
    hens,
    dataLoading,
    ordersHasMore,
    ordersLoadingMore,
    scheduleLoading,
    notice,
    activeTab,
    searchQuery,
    selectedCustomer,
    selectedPickup,
    newPickupDate,
    newPickupLocation,
    changingDateId,
    changePickupDate,
    changeEmailUsers,
    emailGroupKey,
    emailSubject,
    emailMessage,
    emailSending,
    emailFailedRecipients,
    allPickupStocks,
    allPickupReserved,
    pickupStockSaving,
    dirtyStockKeys,
    isAddingDate,
    optimisticStatuses,
    dateInputRef,
    groupedPickups,
    failedPickups,
    filteredCustomers,
    orderCountByPickupKey,
    addDateButtonLabel,
    setPassword,
    setOtp,
    setSearchQuery,
    setSelectedCustomer,
    setSelectedPickup,
    setIsAddingDate,
    setNewPickupLocation,
    setNewPickupDate,
    setChangePickupDate,
    setChangeEmailUsers,
    setEmailSubject,
    setEmailMessage,
    handleLogin,
    handleLoadMoreOrders,
    handleExportDownload,
    handlePickupStockChange,
    handlePickupStockSave,
    deleteDate,
    handleAddDateClick,
    startDateChange,
    cancelDateChange,
    applyDateChange,
    handleTabChange,
    handleNoticeAction,
    handleToggleEmailGroup,
    handleSendGroupEmail,
    handleRowClick,
    handleBulkPickup,
    handleMarkPickedUp
  };
}
