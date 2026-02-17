import {
  LOCATION_LABELS,
  buildPickupKey,
  normalizeDate,
  formatDateHeader,
  getLocalizedProductName
} from '../admin-utils';
import { t } from '../admin-i18n';

export default function AdminStockPage({
  dataLoading,
  dates,
  hens,
  allPickupStocks,
  allPickupReserved,
  adminLanguage,
  pickupStockSaving,
  dirtyStockKeys,
  onPickupStockChange,
  onPickupStockSave
}) {
  if (dataLoading) {
    return <div className="admin-panel">{t('stock.loading', adminLanguage)}</div>;
  }

  const toNonNegativeInt = (value) => {
    const numeric = Number(value ?? 0);
    if (!Number.isFinite(numeric) || numeric <= 0) return 0;
    return Math.floor(numeric);
  };

  return (
    <div className="admin-stack">
      {dates.map((dateItem) => {
        const dateValue = normalizeDate(dateItem.date_value);
        const pickupKey = buildPickupKey(dateValue, dateItem.location);
        const locationLabel =
          LOCATION_LABELS[dateItem.location] || dateItem.location || 'Unknown';
        const stocks = allPickupStocks[pickupKey] || {};
        const reservedByHen = allPickupReserved[pickupKey] || {};
        const isSaving = pickupStockSaving === pickupKey;
        const summary = hens.reduce(
          (acc, hen) => {
            const available = toNonNegativeInt(stocks[hen.id]);
            const reserved = toNonNegativeInt(reservedByHen[hen.id]);
            return {
              available: acc.available + available,
              reserved: acc.reserved + reserved,
              total: acc.total + available + reserved
            };
          },
          { available: 0, reserved: 0, total: 0 }
        );

        return (
          <section
            key={pickupKey}
            className="pickup-day stagger-item"
          >
            <div className="pickup-location">
              <div className="pickup-location-header">
                <div className="pickup-location-title">
                  {formatDateHeader(dateValue, adminLanguage)} {locationLabel}
                </div>
                <div className="pickup-location-meta">
                  {t('stock.reserved', adminLanguage)} {summary.reserved} · {t('stock.available', adminLanguage)} {summary.available} · {t('stock.total', adminLanguage)} {summary.total}
                </div>
              </div>
              <div className="pickup-day-body">
                <div className="pickup-stock-grid">
                  {hens.map((hen) => {
                    const available = toNonNegativeInt(stocks[hen.id]);
                    const reserved = toNonNegativeInt(reservedByHen[hen.id]);
                    const total = available + reserved;

                    return (
                      <div key={hen.id} className="pickup-stock-row">
                        <div className="pickup-stock-name-block">
                          <div className="pickup-stock-name">
                            {getLocalizedProductName(hen.name, adminLanguage)}
                          </div>
                          <div className="pickup-stock-meta">
                            {t('stock.reserved', adminLanguage)} {reserved} · {t('stock.available', adminLanguage)} {available} · {t('stock.total', adminLanguage)} {total}
                          </div>
                        </div>
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
                    );
                  })}
                </div>
                <div className="pickup-stock-save">
                  <button
                    type="button"
                    className="admin-button"
                    onClick={() => onPickupStockSave(pickupKey)}
                    disabled={isSaving || !dirtyStockKeys.has(pickupKey)}
                  >
                    {isSaving ? t('stock.updating', adminLanguage) : t('stock.updateStock', adminLanguage)}
                  </button>
                </div>
              </div>
            </div>
          </section>
        );
      })}
    </div>
  );
}
