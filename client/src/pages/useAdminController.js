import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  LOCATION_LABELS,
  LOCATION_OPTIONS,
  parsePickupKey,
  normalizeDate,
  formatDateLong,
  normalizeStatus
} from './admin-utils';
import { t, tf } from './admin-i18n';
import {
  login,
  checkSession,
  fetchAdminMeta,
  fetchOrdersPage,
  fetchAdminStats,
  updatePickupStock,
  addPickupDate,
  updatePickupDate,
  deletePickupDate,
  updateOrdersStatus,
  createAdminOrder,
  updateAdminOrder,
  deleteAdminOrder,
  finalizeAdminOrder
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
const ADMIN_LANGUAGE_STORAGE_KEY = 'admin_product_language';
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
  const [adminLanguage, setAdminLanguageState] = useState(() => {
    try {
      const stored = String(window.localStorage.getItem(ADMIN_LANGUAGE_STORAGE_KEY) || '').trim().toLowerCase();
      return stored === 'en' ? 'en' : 'fr';
    } catch {
      return 'fr';
    }
  });
  const [selectedCustomer, setSelectedCustomer] = useState(null);
  const [selectedPickup, setSelectedPickup] = useState(null);
  const [editingOrder, setEditingOrder] = useState(null);
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
  const [stats, setStats] = useState(null);

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

  const setAdminLanguage = useCallback((value) => {
    const next = String(value || '').toLowerCase() === 'en' ? 'en' : 'fr';
    setAdminLanguageState(next);
    try {
      window.localStorage.setItem(ADMIN_LANGUAGE_STORAGE_KEY, next);
    } catch {
      // ignore storage issues
    }
  }, []);

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
      showToast({ type: 'error', text: t('toast.refreshMetaFailed', adminLanguage) });
      return false;
    }
  }, [applyMetaPayload, showToast, adminLanguage]);

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
        showToast({ type: 'error', text: t('toast.refreshOrdersFailed', adminLanguage) });
        return false;
      } finally {
        if (!quiet) {
          setDataLoading(false);
        }
      }
    },
    [applyOrdersPayload, orders.length, showToast, adminLanguage]
  );

  const fetchInitialData = useCallback(async () => {
    setDataLoading(true);
    try {
      const [metaResponse, ordersResponse, statsResponse] = await Promise.all([
        fetchAdminMeta(),
        fetchOrdersPage({ limit: ORDERS_PAGE_LIMIT, offset: 0 }),
        fetchAdminStats().catch(() => null)
      ]);
      applyMetaPayload(metaResponse.data || {});
      applyOrdersPayload(ordersResponse.data || {}, { append: false });
      if (statsResponse) setStats(statsResponse.data || null);
      return true;
    } catch {
      showToast({ type: 'error', text: t('toast.loadFailed', adminLanguage) });
      return false;
    } finally {
      setDataLoading(false);
    }
  }, [applyMetaPayload, applyOrdersPayload, showToast, adminLanguage]);

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
      showToast({ type: 'error', text: t('toast.loadMoreFailed', adminLanguage) });
    } finally {
      setOrdersLoadingMore(false);
    }
  }, [ordersLoadingMore, dataLoading, ordersHasMore, orders.length, applyOrdersPayload, showToast, adminLanguage]);

  useEffect(() => {
    const run = async () => {
      try {
        await checkSession();
        setIsLoggedIn(true);
        await fetchInitialData();

        const params = new URLSearchParams(window.location.search);
        const stripeOrderId = params.get('stripe_order');
        if (stripeOrderId) {
          window.history.replaceState({}, '', window.location.pathname);
          try {
            await finalizeAdminOrder(stripeOrderId);
            await refreshOrders({ quiet: true });
            showToast({ type: 'success', text: tf('toast.stripeConfirmed', adminLanguage, { id: stripeOrderId }) });
          } catch {
            showToast({ type: 'error', text: t('toast.stripeConfirmFailed', adminLanguage) });
          }
        }
      } catch {
        setIsLoggedIn(false);
      }
    };
    run();
  }, [fetchInitialData]);

  const ordersWithDetails = useMemo(
    () => buildOrdersWithDetails(orders, hens, adminLanguage),
    [orders, hens, adminLanguage]
  );

  const failedOrdersWithDetails = useMemo(
    () => ordersWithDetails.filter((order) => normalizeStatus(order.status) === 'cancelled'),
    [ordersWithDetails]
  );

  const nonFailedOrdersWithDetails = useMemo(
    () => ordersWithDetails.filter((order) => {
      const s = normalizeStatus(order.status);
      return s !== 'cancelled' && s !== 'archived';
    }),
    [ordersWithDetails]
  );

  const pickupOrdersWithDetails = useMemo(
    () => nonFailedOrdersWithDetails.filter((order) =>
      String(order?.status || '').trim().toLowerCase() !== 'reserved'
    ),
    [nonFailedOrdersWithDetails]
  );

  const groupedPickups = useMemo(
    () => buildGroupedPickups(pickupOrdersWithDetails, adminLanguage),
    [pickupOrdersWithDetails, adminLanguage]
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

  useEffect(() => {
    if (!selectedPickup) return;
    const groupedOrders = groupedPickups
      .flatMap((group) => group.locations || [])
      .flatMap((locationGroup) => locationGroup.orders || []);
    const nextPickup = [...groupedOrders, ...failedPickups]
      .find((pickup) => pickup.key === selectedPickup.key);
    if (!nextPickup) {
      setSelectedPickup(null);
      return;
    }
    if (nextPickup !== selectedPickup) {
      setSelectedPickup(nextPickup);
    }
  }, [groupedPickups, failedPickups, selectedPickup]);

  useEffect(() => {
    if (!selectedCustomer) return;
    const nextCustomer = customers.find((customer) => customer.key === selectedCustomer.key);
    if (!nextCustomer) {
      setSelectedCustomer(null);
      return;
    }
    if (nextCustomer !== selectedCustomer) {
      setSelectedCustomer(nextCustomer);
    }
  }, [customers, selectedCustomer]);

  useEffect(() => {
    if (!editingOrder) return;
    const nextOrder = ordersWithDetails.find((order) => String(order.id) === String(editingOrder.id));
    if (!nextOrder) {
      setEditingOrder(null);
      return;
    }
    if (nextOrder !== editingOrder) {
      setEditingOrder(nextOrder);
    }
  }, [ordersWithDetails, editingOrder]);

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
        await login(password);
        setIsLoggedIn(true);
        setNotice(null);
        setPassword('');
        await fetchInitialData();
      } catch (error) {
        if (error.response) {
          if (error.response.status === 401) {
            showToast({ type: 'error', text: t('toast.wrongPassword', adminLanguage) });
          } else if (error.response.status === 429) {
            showToast({ type: 'error', text: t('toast.tooManyAttempts', adminLanguage) });
          } else {
            showToast({ type: 'error', text: t('toast.serverError', adminLanguage) });
          }
        } else {
          showToast({ type: 'error', text: t('toast.loginFailed', adminLanguage) });
        }
      }
    },
    [password, fetchInitialData, setNotice, showToast, adminLanguage]
  );

  const handleExportDownload = useCallback(
    async (groupDate, locationGroup) => {
      if (dataLoading) {
        showToast({ type: 'error', text: t('toast.ordersStillLoading', adminLanguage) });
        return;
      }
      try {
        await exportOrdersPdf({ groupedPickups, groupDate, locationGroup });
      } catch {
        showToast({ type: 'error', text: t('toast.exportFailed', adminLanguage) });
      }
    },
    [dataLoading, groupedPickups, showToast, adminLanguage]
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
        showToast({ type: 'success', text: t('toast.stockUpdated', adminLanguage) });
        await refreshMeta();
      } catch {
        showToast({ type: 'error', text: t('toast.stockFailed', adminLanguage) });
      } finally {
        setPickupStockSaving(null);
      }
    },
    [allPickupStocks, hens, refreshMeta, showToast, adminLanguage]
  );

  const addDate = useCallback(
    async (dateValue, locationValue) => {
      if (!dateValue || !locationValue) return false;
      setScheduleLoading('add');
      try {
        await addPickupDate({ dateValue, location: locationValue });
        showToast({ type: 'success', text: t('toast.dateAdded', adminLanguage) });
        await refreshMeta();
        return true;
      } catch {
        showToast({ type: 'error', text: t('toast.dateAddFailed', adminLanguage) });
        return false;
      } finally {
        setScheduleLoading(null);
      }
    },
    [refreshMeta, showToast, adminLanguage]
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
        showToast({ type: 'error', text: t('toast.selectNewDate', adminLanguage) });
        return;
      }

      const fromDate = normalizeDate(dateItem.date_value);
      const fromDateLabel = formatDateLong(fromDate, adminLanguage);
      const toDateLabel = formatDateLong(changePickupDate, adminLanguage);

      const confirmKey = changeEmailUsers
        ? 'confirm.changeDateEmail'
        : 'confirm.changeDateNoEmail';
      const warningText = tf(confirmKey, adminLanguage, { from: fromDateLabel, to: toDateLabel });
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
        const mergedText = payload.merged ? ` ${t('result.merged', adminLanguage)}` : '';
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
          text: `${t('toast.dateUpdated', adminLanguage)}${mergedText} ${tf('result.ordersMoved', adminLanguage, { count: movedOrders })}${emailSummary}`.trim()
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
            text: error?.response?.data?.error || t('toast.dateUpdateFailed', adminLanguage)
          });
        } else {
          showToast({ type: 'error', text: t('toast.dateUpdateFailed', adminLanguage) });
        }
      } finally {
        setScheduleLoading(null);
      }
    },
    [
      adminLanguage,
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
        const confirmed = window.confirm(t('confirm.deleteDate', adminLanguage));
        if (!confirmed) return;
      }
      setScheduleLoading(dateItem.id);
      try {
        await deletePickupDate(dateItem.id);
        showToast({ type: 'success', text: t('toast.dateRemoved', adminLanguage) });
        await refreshMeta();
        if (changingDateId === dateItem.id) {
          cancelDateChange();
        }
      } catch {
        showToast({ type: 'error', text: t('toast.dateRemoveFailed', adminLanguage) });
      } finally {
        setScheduleLoading(null);
      }
    },
    [adminLanguage, cancelDateChange, changingDateId, refreshMeta, showToast]
  );

  const updateOrderStatus = useCallback(
    async (orderIds, newStatus, _loadingKey, options = {}) => {
      if (!Array.isArray(orderIds) || orderIds.length === 0) return false;
      const {
        successMessage = t('toast.statusUpdated', adminLanguage),
        errorMessage = t('toast.statusFailed', adminLanguage),
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
    [adminLanguage, refreshOrders, showToast]
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
        showToast({ type: 'error', text: t('toast.markFailed', adminLanguage) });
        return;
      }

      showToast({
        type: 'success',
        text: t('toast.markedPickedUp', adminLanguage),
        actionLabel: t('toast.undo', adminLanguage),
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
            showToast({ type: 'error', text: t('toast.undoFailed', adminLanguage) });
          }
        }
      });
    },
    [adminLanguage, showToast, updateOrderStatus, refreshOrders]
  );

  const handleRowClick = useCallback((order) => {
    setSelectedPickup(order);
  }, []);

  const handleBulkPickup = useCallback(
    async (orderIds, label, loadingKey) => {
      if (!Array.isArray(orderIds) || orderIds.length === 0) {
        showToast({ type: 'error', text: t('toast.noActivePickups', adminLanguage) });
        return;
      }
      const confirmText = tf('confirm.bulkPickup', adminLanguage, {
        count: orderIds.length,
        label: label ? ` (${label})` : ''
      });
      const confirmed = window.confirm(confirmText);
      if (!confirmed) return;
      await updateOrderStatus(orderIds, 'picked_up', loadingKey || label || 'bulk');
    },
    [adminLanguage, showToast, updateOrderStatus]
  );

  const handleAddDateClick = useCallback(async () => {
    if (!isAddingDate) {
      setIsAddingDate(true);
      return;
    }
    if (!newPickupDate) {
      showToast({ type: 'error', text: t('toast.selectDate', adminLanguage) });
      return;
    }
    if (!newPickupLocation) {
      showToast({ type: 'error', text: t('toast.selectLocation', adminLanguage) });
      return;
    }
    const confirmLabel = formatDateLong(newPickupDate, adminLanguage);
    const locationLabel = LOCATION_LABELS[newPickupLocation] || newPickupLocation;
    const confirmed = window.confirm(tf('confirm.addDate', adminLanguage, { date: confirmLabel, location: locationLabel }));
    if (!confirmed) {
      return;
    }
    const didAdd = await addDate(newPickupDate, newPickupLocation);
    if (didAdd) {
      setNewPickupDate('');
      setIsAddingDate(false);
    }
  }, [
    adminLanguage,
    isAddingDate,
    newPickupDate,
    newPickupLocation,
    addDate,
    showToast
  ]);

  const addDateButtonLabel = scheduleLoading === 'add'
    ? t('dates.addBtn.adding', adminLanguage)
    : isAddingDate
      ? t('dates.addBtn.confirm', adminLanguage)
      : t('dates.addBtn.add', adminLanguage);

  const handleCreateAdminOrder = useCallback(
    async (payload) => {
      try {
        const response = await createAdminOrder(payload);
        const data = response.data || {};
        if (data.stripeUrl) {
          return data;
        }
        const orderId = data.orderId;
        showToast({
          type: 'success',
          text: orderId ? tf('toast.orderCreatedId', adminLanguage, { id: orderId }) : t('toast.orderCreated', adminLanguage)
        });
        await Promise.all([refreshMeta(), refreshOrders({ quiet: true })]);
        return data.success ? data : { success: true, orderId };
      } catch (error) {
        const status = error?.response?.status;
        const errData = error?.response?.data;
        const message = (() => {
          if (status === 401) return t('toast.unauthorized', adminLanguage);
          if (status === 404) return t('toast.endpointNotFound', adminLanguage);
          if (errData && typeof errData === 'object' && typeof errData.error === 'string') return errData.error;
          return t('toast.createFailed', adminLanguage);
        })();
        showToast({ type: 'error', text: message });
        throw error;
      }
    },
    [adminLanguage, showToast, refreshMeta, refreshOrders]
  );

  const handleArchiveOrder = useCallback(
    async (order) => {
      if (!order?.orderIds?.length) return;
      const confirmed = window.confirm(t('confirm.archiveDraft', adminLanguage));
      if (!confirmed) return;
      const success = await updateOrderStatus(order.orderIds, 'archived', order.key, {
        successMessage: t('toast.orderArchived', adminLanguage),
        errorMessage: t('toast.archiveFailed', adminLanguage)
      });
      if (success) {
        setSelectedPickup(null);
      }
    },
    [adminLanguage, updateOrderStatus]
  );

  const handleEditOrder = useCallback((order) => {
    if (!order) return;
    setSelectedPickup(null);
    setEditingOrder(order);
  }, []);

  const handleDeleteOrder = useCallback(
    async (order) => {
      const orderId = String(order?.id || '').trim();
      const orderStatus = String(order?.status || '').trim().toLowerCase();
      if (!orderId || !['pending', 'paid'].includes(orderStatus)) {
        return;
      }

      const confirmed = window.confirm(t('confirm.deleteOrder', adminLanguage));
      if (!confirmed) return;

      try {
        await deleteAdminOrder(orderId);
        showToast({
          type: 'success',
          text: tf('toast.orderDeleted', adminLanguage, { id: orderId })
        });
        setSelectedPickup(null);
        await Promise.all([refreshMeta(), refreshOrders({ quiet: true })]);
      } catch (error) {
        const status = error?.response?.status;
        const data = error?.response?.data;
        const message = (() => {
          if (status === 401) return t('toast.unauthorized', adminLanguage);
          if (status === 404) return t('toast.orderNotFound', adminLanguage);
          if (data && typeof data === 'object' && typeof data.error === 'string') return data.error;
          return t('toast.deleteFailed', adminLanguage);
        })();
        showToast({ type: 'error', text: message });
      }
    },
    [adminLanguage, showToast, refreshMeta, refreshOrders]
  );

  const handleUpdateAdminOrder = useCallback(
    async (orderId, payload) => {
      try {
        const response = await updateAdminOrder({ orderId, payload });
        showToast({
          type: 'success',
          text: tf('toast.orderUpdated', adminLanguage, { id: orderId })
        });
        setEditingOrder(null);
        setSelectedPickup(null);
        await Promise.all([refreshMeta(), refreshOrders({ quiet: true })]);
        return response.data || {};
      } catch (error) {
        const status = error?.response?.status;
        const data = error?.response?.data;
        const message = (() => {
          if (status === 401) return t('toast.unauthorized', adminLanguage);
          if (status === 404) return t('toast.orderNotFound', adminLanguage);
          if (data && typeof data === 'object' && typeof data.error === 'string') return data.error;
          return t('toast.updateFailed', adminLanguage);
        })();
        showToast({ type: 'error', text: message });
        throw error;
      }
    },
    [adminLanguage, showToast, refreshMeta, refreshOrders]
  );

  const handleTabChange = useCallback((key) => {
    setActiveTab(key);
    setSelectedCustomer(null);
    setSelectedPickup(null);
    setEditingOrder(null);
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
    isLoggedIn,
    dates,
    hens,
    dataLoading,
    ordersHasMore,
    ordersLoadingMore,
    scheduleLoading,
    notice,
    activeTab,
    adminLanguage,
    searchQuery,
    selectedCustomer,
    selectedPickup,
    editingOrder,
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
    stats,
    dateInputRef,
    groupedPickups,
    failedPickups,
    filteredCustomers,
    orderCountByPickupKey,
    addDateButtonLabel,
    setPassword,
    setAdminLanguage,
    setSearchQuery,
    setSelectedCustomer,
    setSelectedPickup,
    setEditingOrder,
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
    handleMarkPickedUp,
    handleCreateAdminOrder,
    handleArchiveOrder,
    handleEditOrder,
    handleDeleteOrder,
    handleUpdateAdminOrder
  };
}
