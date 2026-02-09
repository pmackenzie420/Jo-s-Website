import {
  LOCATION_LABELS,
  LOCATION_OPTIONS,
  buildPickupKey,
  normalizeDate,
  formatDateHeader,
  formatDateLong
} from '../admin-utils';

export default function AdminStockPage({
  dataLoading,
  dates,
  hens,
  allPickupStocks,
  pickupStockSaving,
  dirtyStockKeys,
  scheduleLoading,
  isAddingDate,
  newPickupDate,
  newPickupLocation,
  dateInputRef,
  orderCountByPickupKey,
  onPickupStockChange,
  onPickupStockSave,
  onDeleteDate,
  onSetIsAddingDate,
  onSetNewPickupLocation,
  onSetNewPickupDate,
  onAddDateClick,
  addDateButtonLabel
}) {
  if (dataLoading) {
    return <div className="admin-panel">Loading stock and dates...</div>;
  }

  return (
    <div className="admin-stack">
      {dates.map((dateItem) => {
        const dateValue = normalizeDate(dateItem.date_value);
        const pickupKey = buildPickupKey(dateValue, dateItem.location);
        const locationLabel =
          LOCATION_LABELS[dateItem.location] || dateItem.location || 'Unknown';
        const stocks = allPickupStocks[pickupKey] || {};
        const isSaving = pickupStockSaving === pickupKey;

        return (
          <section
            key={pickupKey}
            className="pickup-day stagger-item"
          >
            <div className="pickup-location">
              <div className="pickup-location-header">
                <div className="pickup-location-title">
                  {formatDateHeader(dateValue)} {locationLabel}
                </div>
              </div>
              <div className="pickup-day-body">
                <div className="pickup-stock-grid">
                  {hens.map((hen) => (
                    <div key={hen.id} className="pickup-stock-row">
                      <div className="pickup-stock-name">{hen.name}</div>
                      <input
                        type="number"
                        inputMode="numeric"
                        min="0"
                        className="admin-input"
                        value={stocks[hen.id] ?? ''}
                        onFocus={(event) => {
                          setTimeout(() => {
                            event.target.scrollIntoView({ behavior: 'smooth', block: 'center' });
                          }, 300);
                        }}
                        onChange={(event) =>
                          onPickupStockChange(pickupKey, hen.id, event.target.value)
                        }
                      />
                    </div>
                  ))}
                </div>
                <div className="pickup-stock-save">
                  <button
                    type="button"
                    className="admin-button"
                    onClick={() => onPickupStockSave(pickupKey)}
                    disabled={isSaving || !dirtyStockKeys.has(pickupKey)}
                  >
                    {isSaving ? 'Updating...' : 'Update Stock'}
                  </button>
                </div>
              </div>
            </div>
          </section>
        );
      })}

      <section className="pickup-day stagger-item">
        <div className="pickup-location">
          <div className="pickup-location-header">
            <div className="pickup-location-title">Manage Dates</div>
          </div>
          <div className="pickup-day-body">
            <div className="date-list">
              {dates.length === 0 && (
                <div className="empty-state">No pickup dates yet.</div>
              )}
              {dates.map((dateItem) => {
                const dateValue = normalizeDate(dateItem.date_value);
                const dateLabel = formatDateLong(dateValue);
                const locationLabel =
                  LOCATION_LABELS[dateItem.location] ||
                  dateItem.location ||
                  'Unknown';
                const orderCount = orderCountByPickupKey.get(
                  buildPickupKey(dateValue, dateItem.location)
                ) || 0;
                return (
                  <div key={dateItem.id} className="date-row">
                    <div>
                      <div className="date-title">{dateLabel}</div>
                      <div className="date-meta">
                        {locationLabel} · {orderCount} pickups
                      </div>
                    </div>
                    <button
                      className="admin-button ghost"
                      onClick={() => onDeleteDate(dateItem, orderCount)}
                      disabled={scheduleLoading === dateItem.id}
                    >
                      Remove
                    </button>
                  </div>
                );
              })}
            </div>
            <div className="date-actions">
              {isAddingDate && (
                <>
                  <label className="admin-label" htmlFor="pickup-location-select">
                    Pickup location
                  </label>
                  <select
                    id="pickup-location-select"
                    className="admin-input"
                    value={newPickupLocation}
                    onChange={(event) => onSetNewPickupLocation(event.target.value)}
                  >
                    {LOCATION_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                  <div className="date-input-wrapper">
                    <input
                      ref={dateInputRef}
                      type="date"
                      className="admin-input date-input"
                      value={newPickupDate}
                      onChange={(event) => onSetNewPickupDate(event.target.value)}
                    />
                  </div>
                </>
              )}
              <div className={`date-actions-row${isAddingDate ? ' date-actions-row--offset' : ''}`}>
                {isAddingDate && (
                  <button
                    className="admin-button ghost"
                    onClick={() => onSetIsAddingDate(false)}
                  >
                    Cancel
                  </button>
                )}
                <button
                  className="admin-button"
                  onClick={onAddDateClick}
                  disabled={scheduleLoading === 'add'}
                >
                  {addDateButtonLabel}
                </button>
              </div>
              {newPickupDate && isAddingDate && (
                <div className="date-selected">
                  Selected: {formatDateLong(newPickupDate)}
                </div>
              )}
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
