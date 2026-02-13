import { useEffect } from 'react';
import useMediaQuery from '../hooks/useMediaQuery';
import '../styles/pages/Admin.css';
import AdminToast from './admin/AdminToast';
import AdminLoginView from './admin/AdminLoginView';
import AdminPickupsPage from './admin/AdminPickupsPage';
import AdminStockPage from './admin/AdminStockPage';
import AdminDatesPage from './admin/AdminDatesPage';
import AdminSearchPage from './admin/AdminSearchPage';
import AdminEmailPage from './admin/AdminEmailPage';
import AdminCustomerModal from './admin/AdminCustomerModal';
import AdminPickupModal from './admin/AdminPickupModal';
import { TAB_CONFIG } from './admin-utils';
import useAdminController from './useAdminController';

export default function Admin() {
  const {
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
  } = useAdminController();

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
    const hasModal = Boolean(selectedCustomer || selectedPickup);
    if (hasModal) {
      document.body.classList.add('admin-modal-open');
    } else {
      document.body.classList.remove('admin-modal-open');
    }
    return () => document.body.classList.remove('admin-modal-open');
  }, [selectedCustomer, selectedPickup]);

  if (!isLoggedIn) {
    return (
      <AdminLoginView
        password={password}
        otp={otp}
        notice={notice}
        onPasswordChange={(event) => setPassword(event.target.value)}
        onOtpChange={(event) => setOtp(event.target.value)}
        onLogin={handleLogin}
      />
    );
  }

  const activeTabConfig = TAB_CONFIG.find((tab) => tab.key === activeTab);

  return (
    <div className="admin-container">
      <div className="admin-shell">
        <AdminToast notice={notice} onAction={handleNoticeAction} />
        <header className="admin-topbar">
          <div className="admin-topbar-row">
            <div className="admin-brand">
              <div className="admin-page-title">{activeTabConfig?.label}</div>
            </div>
          </div>
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

        <main
          className={`admin-main ${
            activeTab === 'pickups' || activeTab === 'stock' ? 'admin-main-pickups' : ''
          }`}
        >
          {activeTab === 'pickups' && (
            <AdminPickupsPage
              dataLoading={dataLoading}
              groupedPickups={groupedPickups}
              isMobile={isMobile}
              optimisticStatuses={optimisticStatuses}
              ordersHasMore={ordersHasMore}
              ordersLoadingMore={ordersLoadingMore}
              onRowClick={handleRowClick}
              onLoadMoreOrders={handleLoadMoreOrders}
              onExportAll={() => handleExportDownload()}
              onExportGroup={(groupDate, locationGroup) =>
                handleExportDownload(groupDate, locationGroup)
              }
              onBulkPickup={handleBulkPickup}
            />
          )}
          {activeTab === 'stock' && (
            <AdminStockPage
              dataLoading={dataLoading}
              dates={dates}
              hens={hens}
              allPickupStocks={allPickupStocks}
              allPickupReserved={allPickupReserved}
              pickupStockSaving={pickupStockSaving}
              dirtyStockKeys={dirtyStockKeys}
              onPickupStockChange={handlePickupStockChange}
              onPickupStockSave={handlePickupStockSave}
            />
          )}
          {activeTab === 'dates' && (
            <AdminDatesPage
              dataLoading={dataLoading}
              dates={dates}
              scheduleLoading={scheduleLoading}
              isAddingDate={isAddingDate}
              newPickupDate={newPickupDate}
              newPickupLocation={newPickupLocation}
              changingDateId={changingDateId}
              changePickupDate={changePickupDate}
              changeEmailUsers={changeEmailUsers}
              dateInputRef={dateInputRef}
              orderCountByPickupKey={orderCountByPickupKey}
              onDeleteDate={deleteDate}
              onStartDateChange={startDateChange}
              onCancelDateChange={cancelDateChange}
              onApplyDateChange={applyDateChange}
              onSetIsAddingDate={setIsAddingDate}
              onSetNewPickupLocation={setNewPickupLocation}
              onSetNewPickupDate={setNewPickupDate}
              onSetChangePickupDate={setChangePickupDate}
              onSetChangeEmailUsers={setChangeEmailUsers}
              onAddDateClick={handleAddDateClick}
              addDateButtonLabel={addDateButtonLabel}
            />
          )}
          {activeTab === 'search' && (
            <AdminSearchPage
              dataLoading={dataLoading}
              searchQuery={searchQuery}
              onSearchChange={setSearchQuery}
              filteredCustomers={filteredCustomers}
              ordersHasMore={ordersHasMore}
              ordersLoadingMore={ordersLoadingMore}
              onLoadMoreOrders={handleLoadMoreOrders}
              onSelectCustomer={setSelectedCustomer}
            />
          )}
          {activeTab === 'email' && (
            <AdminEmailPage
              dataLoading={dataLoading}
              groupedPickups={groupedPickups}
              emailGroupKey={emailGroupKey}
              emailSubject={emailSubject}
              emailMessage={emailMessage}
              emailSending={emailSending}
              emailFailedRecipients={emailFailedRecipients}
              onToggleGroup={handleToggleEmailGroup}
              onSubjectChange={setEmailSubject}
              onMessageChange={setEmailMessage}
              onSendGroupEmail={handleSendGroupEmail}
            />
          )}
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

      <AdminCustomerModal
        customer={selectedCustomer}
        onClose={() => setSelectedCustomer(null)}
      />
      <AdminPickupModal
        pickup={selectedPickup}
        optimisticStatuses={optimisticStatuses}
        onClose={() => setSelectedPickup(null)}
        onMarkPickedUp={handleMarkPickedUp}
      />
    </div>
  );
}
