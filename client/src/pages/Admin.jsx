import { useEffect, useState } from 'react';
import useMediaQuery from '../hooks/useMediaQuery';
import '../styles/pages/Admin.css';
import AdminToast from './admin/AdminToast';
import AdminLoginView from './admin/AdminLoginView';
import AdminPickupsPage from './admin/AdminPickupsPage';
import AdminStockPage from './admin/AdminStockPage';
import AdminDatesPage from './admin/AdminDatesPage';
import AdminSearchPage from './admin/AdminSearchPage';
import AdminEmailPage from './admin/AdminEmailPage';
import AdminCreateOrderPage from './admin/AdminCreateOrderPage';
import AdminCustomerModal from './admin/AdminCustomerModal';
import AdminPickupModal from './admin/AdminPickupModal';
import AdminEditOrderModal from './admin/AdminEditOrderModal';
import { getTabConfig } from './admin-utils';
import { t } from './admin-i18n';
import useAdminController from './useAdminController';

export default function Admin() {
  const {
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
    handleInvoiceExportDownload,
    handleInvoiceExportForCustomer,
    handleInvoiceExportForOrder,
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
  } = useAdminController();

  const isMobile = useMediaQuery('(max-width: 767px)');
  const [isMenuOpen, setIsMenuOpen] = useState(false);

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
    const hasModal = Boolean(selectedCustomer || selectedPickup || editingOrder);
    if (hasModal) {
      document.body.classList.add('admin-modal-open');
    } else {
      document.body.classList.remove('admin-modal-open');
    }
    return () => document.body.classList.remove('admin-modal-open');
  }, [selectedCustomer, selectedPickup, editingOrder]);

  if (!isLoggedIn) {
    return (
      <AdminLoginView
        password={password}
        notice={notice}
        onPasswordChange={(event) => setPassword(event.target.value)}
        onLogin={handleLogin}
      />
    );
  }

  return (
    <div className="admin-container">
      <div className="admin-shell">
        <AdminToast notice={notice} onAction={handleNoticeAction} />
        <header className="admin-topbar">
          <div className="admin-topbar-row">
            <div className="admin-language-toggle" role="group" aria-label={t('toggle.ariaLabel', adminLanguage)}>
              <button
                type="button"
                className={`admin-language-toggle-button ${adminLanguage === 'en' ? 'active' : ''}`}
                onClick={() => setAdminLanguage('en')}
                aria-pressed={adminLanguage === 'en'}
              >
                EN
              </button>
              {' | '}
              <button
                type="button"
                className={`admin-language-toggle-button ${adminLanguage === 'fr' ? 'active' : ''}`}
                onClick={() => setAdminLanguage('fr')}
                aria-pressed={adminLanguage === 'fr'}
              >
                FR
              </button>
            </div>
            <button
              className="admin-menu-toggle"
              type="button"
              aria-label="Toggle navigation menu"
              aria-expanded={isMenuOpen}
              aria-controls="admin-mobile-menu"
              onClick={() => setIsMenuOpen((open) => !open)}
            >
              <span className="admin-menu-bar" />
              <span className="admin-menu-bar" />
              <span className="admin-menu-bar" />
            </button>
          </div>
          <nav className="admin-tabs" aria-label="Admin sections">
            {getTabConfig(adminLanguage).map((tab) => (
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
          <div
            id="admin-mobile-menu"
            className={`admin-mobile-menu${isMenuOpen ? ' open' : ''}`}
          >
            <nav className="admin-mobile-menu-nav">
              {getTabConfig(adminLanguage).map((tab) => (
                <button
                  key={tab.key}
                  className={`admin-mobile-nav-button${activeTab === tab.key ? ' active' : ''}`}
                  onClick={() => { setIsMenuOpen(false); handleTabChange(tab.key); }}
                  type="button"
                  aria-current={activeTab === tab.key ? 'page' : undefined}
                >
                  {tab.label}
                </button>
              ))}
            </nav>
          </div>
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
              failedPickups={failedPickups}
              isMobile={isMobile}
              optimisticStatuses={optimisticStatuses}
              ordersHasMore={ordersHasMore}
              ordersLoadingMore={ordersLoadingMore}
              adminLanguage={adminLanguage}
              stats={stats}
              onRowClick={handleRowClick}
              onLoadMoreOrders={handleLoadMoreOrders}
              onExportAll={() => handleExportDownload()}
              onExportInvoices={() => handleInvoiceExportDownload()}
              onExportInvoicesGroup={(groupDate, locationGroup) =>
                handleInvoiceExportDownload(groupDate, locationGroup)
              }
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
              adminLanguage={adminLanguage}
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
              adminLanguage={adminLanguage}
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
          {activeTab === 'create' && (
            <AdminCreateOrderPage
              dataLoading={dataLoading}
              hens={hens}
              dates={dates}
              allPickupStocks={allPickupStocks}
              allPickupReserved={allPickupReserved}
              adminLanguage={adminLanguage}
              onCreateOrder={handleCreateAdminOrder}
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
              adminLanguage={adminLanguage}
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
              adminLanguage={adminLanguage}
              onToggleGroup={handleToggleEmailGroup}
              onSubjectChange={setEmailSubject}
              onMessageChange={setEmailMessage}
              onSendGroupEmail={handleSendGroupEmail}
            />
          )}
        </main>

        <nav className="admin-nav admin-nav-mobile">
          {getTabConfig(adminLanguage).map((tab) => (
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
        adminLanguage={adminLanguage}
        onExportCustomerInvoices={handleInvoiceExportForCustomer}
        onExportOrderInvoice={handleInvoiceExportForOrder}
        onClose={() => setSelectedCustomer(null)}
      />
      <AdminPickupModal
        pickup={selectedPickup}
        adminLanguage={adminLanguage}
        optimisticStatuses={optimisticStatuses}
        onClose={() => setSelectedPickup(null)}
        onMarkPickedUp={handleMarkPickedUp}
        onExportOrderInvoice={handleInvoiceExportForOrder}
        onEditOrder={handleEditOrder}
        onDeleteOrder={handleDeleteOrder}
        onArchiveOrder={handleArchiveOrder}
      />
      <AdminEditOrderModal
        order={editingOrder}
        dates={dates}
        hens={hens}
        allPickupStocks={allPickupStocks}
        adminLanguage={adminLanguage}
        onClose={() => setEditingOrder(null)}
        onSave={handleUpdateAdminOrder}
      />
    </div>
  );
}
