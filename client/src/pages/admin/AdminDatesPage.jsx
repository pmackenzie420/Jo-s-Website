import {
  LOCATION_LABELS,
  LOCATION_OPTIONS,
  buildPickupKey,
  normalizeDate,
  formatDateLong
} from '../admin-utils';
import { t, tf } from '../admin-i18n';

export default function AdminDatesPage({
  dataLoading,
  dates,
  scheduleLoading,
  isAddingDate,
  newPickupDate,
  newPickupLocation,
  newPickupSpecialNote,
  changingDateId,
  changePickupDate,
  changePickupSpecialNote,
  changeEmailUsers,
  dateInputRef,
  orderCountByPickupKey,
  adminLanguage,
  onDeleteDate,
  onStartDateChange,
  onCancelDateChange,
  onApplyDateChange,
  onSetIsAddingDate,
  onSetNewPickupLocation,
  onSetNewPickupDate,
  onSetNewPickupSpecialNote,
  onSetChangePickupDate,
  onSetChangePickupSpecialNote,
  onSetChangeEmailUsers,
  onAddDateClick,
  addDateButtonLabel
}) {
  if (dataLoading) {
    return <div className="admin-panel">{t('dates.loading', adminLanguage)}</div>;
  }

  return (
    <div className="admin-stack">
      <section className="pickup-day stagger-item">
        <div className="pickup-location">
          <div className="pickup-location-header">
            <div className="pickup-location-title">{t('dates.title', adminLanguage)}</div>
          </div>
          <div className="pickup-day-body">
            <div className="date-list">
              {dates.length === 0 && (
                <div className="empty-state">{t('dates.empty', adminLanguage)}</div>
              )}
              {dates.map((dateItem) => {
                const dateValue = normalizeDate(dateItem.date_value);
                const dateLabel = formatDateLong(dateValue, adminLanguage);
                const locationLabel =
                  LOCATION_LABELS[dateItem.location] ||
                  dateItem.location ||
                  'Unknown';
                const specialNote = String(dateItem.special_note || '').trim();
                const orderCount = orderCountByPickupKey.get(
                  buildPickupKey(dateValue, dateItem.location)
                ) || 0;
                const isChanging = changingDateId === dateItem.id;
                const changeLoadingKey = `change:${dateItem.id}`;
                const changeSaving = scheduleLoading === changeLoadingKey;
                const targetDateLabel = changePickupDate ? formatDateLong(changePickupDate, adminLanguage) : '';
                return (
                  <div key={dateItem.id} className="date-row">
                    <div>
                      <div className="date-title">{dateLabel}</div>
                      <div className="date-meta">
                        {locationLabel} · {tf('dates.pickups', adminLanguage, { count: orderCount })}
                      </div>
                      {specialNote && (
                        <div className="date-special-note">
                          <span>{t('dates.specialNoteLabel', adminLanguage)}:</span> {specialNote}
                        </div>
                      )}
                    </div>
                    <div className="date-row-actions">
                      <button
                        className="admin-button ghost"
                        onClick={() => onStartDateChange(dateItem)}
                        disabled={Boolean(scheduleLoading) && !isChanging}
                      >
                        {t('dates.change', adminLanguage)}
                      </button>
                      <button
                        className="admin-button ghost"
                        onClick={() => onDeleteDate(dateItem, orderCount)}
                        disabled={scheduleLoading === dateItem.id || changeSaving}
                      >
                        {t('dates.remove', adminLanguage)}
                      </button>
                    </div>
                    {isChanging && (
                      <div className="date-change-panel">
                        <label className="admin-label" htmlFor={`change-date-${dateItem.id}`}>
                          {t('dates.newPickupDate', adminLanguage)}
                        </label>
                        <input
                          id={`change-date-${dateItem.id}`}
                          type="date"
                          className="admin-input date-input"
                          value={changePickupDate}
                          onChange={(event) => onSetChangePickupDate(event.target.value)}
                        />

                        <label className="admin-label" htmlFor={`change-special-note-${dateItem.id}`}>
                          {t('dates.specialNoteOptional', adminLanguage)}
                        </label>
                        <textarea
                          id={`change-special-note-${dateItem.id}`}
                          className="admin-input date-note-input"
                          value={changePickupSpecialNote}
                          maxLength={500}
                          rows={3}
                          placeholder={t('dates.specialNotePlaceholder', adminLanguage)}
                          onChange={(event) => onSetChangePickupSpecialNote(event.target.value)}
                        />

                        <label className="date-change-switch">
                          <input
                            type="checkbox"
                            checked={changeEmailUsers}
                            onChange={(event) => onSetChangeEmailUsers(event.target.checked)}
                          />
                          <span>{t('dates.emailSwitch', adminLanguage)}</span>
                        </label>

                        {changeEmailUsers && (
                          <div className="date-change-warning">
                            {tf('dates.emailWarning', adminLanguage, { from: dateLabel, to: targetDateLabel })}
                          </div>
                        )}

                        <div className="date-actions-row">
                          <button
                            className="admin-button ghost"
                            onClick={onCancelDateChange}
                            disabled={changeSaving}
                          >
                            {t('btn.cancel', adminLanguage)}
                          </button>
                          <button
                            className="admin-button"
                            onClick={() => onApplyDateChange(dateItem)}
                            disabled={changeSaving}
                          >
                            {changeSaving ? t('dates.applying', adminLanguage) : t('dates.applyChange', adminLanguage)}
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
                    {t('dates.pickupLocation', adminLanguage)}
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
                  <label className="admin-label" htmlFor="pickup-special-note">
                    {t('dates.specialNoteOptional', adminLanguage)}
                  </label>
                  <textarea
                    id="pickup-special-note"
                    className="admin-input date-note-input"
                    value={newPickupSpecialNote}
                    maxLength={500}
                    rows={3}
                    placeholder={t('dates.specialNotePlaceholder', adminLanguage)}
                    onChange={(event) => onSetNewPickupSpecialNote(event.target.value)}
                  />
                </>
              )}
              <div className={`date-actions-row${isAddingDate ? ' date-actions-row--offset' : ''}`}>
                {isAddingDate && (
                  <button
                    className="admin-button ghost"
                    onClick={() => {
                      onSetNewPickupDate('');
                      onSetIsAddingDate(false);
                    }}
                  >
                    {t('btn.cancel', adminLanguage)}
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
                  {tf('dates.selected', adminLanguage, { date: formatDateLong(newPickupDate, adminLanguage) })}
                </div>
              )}
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
