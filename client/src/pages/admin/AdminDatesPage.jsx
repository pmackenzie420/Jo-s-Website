import {
  LOCATION_LABELS,
  LOCATION_OPTIONS,
  buildPickupKey,
  normalizeDate,
  formatDateLong
} from '../admin-utils';

export default function AdminDatesPage({
  dataLoading,
  dates,
  scheduleLoading,
  isAddingDate,
  newPickupDate,
  newPickupLocation,
  changingDateId,
  changePickupDate,
  changeEmailUsers,
  dateInputRef,
  orderCountByPickupKey,
  onDeleteDate,
  onStartDateChange,
  onCancelDateChange,
  onApplyDateChange,
  onSetIsAddingDate,
  onSetNewPickupLocation,
  onSetNewPickupDate,
  onSetChangePickupDate,
  onSetChangeEmailUsers,
  onAddDateClick,
  addDateButtonLabel
}) {
  if (dataLoading) {
    return <div className="admin-panel">Loading dates...</div>;
  }

  return (
    <div className="admin-stack">
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
                const isChanging = changingDateId === dateItem.id;
                const changeLoadingKey = `change:${dateItem.id}`;
                const changeSaving = scheduleLoading === changeLoadingKey;
                const targetDateLabel = changePickupDate ? formatDateLong(changePickupDate) : 'Select date';
                return (
                  <div key={dateItem.id} className="date-row">
                    <div>
                      <div className="date-title">{dateLabel}</div>
                      <div className="date-meta">
                        {locationLabel} · {orderCount} pickups
                      </div>
                    </div>
                    <div className="date-row-actions">
                      <button
                        className="admin-button ghost"
                        onClick={() => onStartDateChange(dateItem)}
                        disabled={Boolean(scheduleLoading) && !isChanging}
                      >
                        Change
                      </button>
                      <button
                        className="admin-button ghost"
                        onClick={() => onDeleteDate(dateItem, orderCount)}
                        disabled={scheduleLoading === dateItem.id || changeSaving}
                      >
                        Remove
                      </button>
                    </div>
                    {isChanging && (
                      <div className="date-change-panel">
                        <label className="admin-label" htmlFor={`change-date-${dateItem.id}`}>
                          New pickup date
                        </label>
                        <input
                          id={`change-date-${dateItem.id}`}
                          type="date"
                          className="admin-input date-input"
                          value={changePickupDate}
                          onChange={(event) => onSetChangePickupDate(event.target.value)}
                        />

                        <label className="date-change-switch">
                          <input
                            type="checkbox"
                            checked={changeEmailUsers}
                            onChange={(event) => onSetChangeEmailUsers(event.target.checked)}
                          />
                          <span>Email users about this pickup date change</span>
                        </label>

                        {changeEmailUsers && (
                          <div className="date-change-warning">
                            Email users with pickup date change from {dateLabel} to {targetDateLabel}.
                          </div>
                        )}

                        <div className="date-actions-row">
                          <button
                            className="admin-button ghost"
                            onClick={onCancelDateChange}
                            disabled={changeSaving}
                          >
                            Cancel
                          </button>
                          <button
                            className="admin-button"
                            onClick={() => onApplyDateChange(dateItem)}
                            disabled={changeSaving}
                          >
                            {changeSaving ? 'Applying...' : 'Apply Date Change'}
                          </button>
                        </div>
                      </div>
                    )}
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
