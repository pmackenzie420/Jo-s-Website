import { useEffect, useMemo, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import './../styles/pages/Success.css';
import { API_URL } from '../constants/api';
import LOCATION_DETAILS from '../../../shared/locations.json';

const COPY = {
    en: {
        loadingTitle: 'Loading order...',
        loadingMessage: 'We are checking your payment confirmation.',
        unverifiedTitle: 'Order status unavailable',
        unverifiedMessage: 'We could not verify this order from this link.',
        title: '✓ Order Confirmed',
        thanks: 'Thank you for your order.',
        emailSent: (email) => `We've sent a confirmation email to ${email}.`,
        emailSentFallback: 'We have sent a confirmation email with your details.',
        pickupDetails: 'Pickup Details',
        customerInfo: 'Customer Info',
        orderTitle: 'Your Order',
        paymentTitle: 'Payment',
        dateLabel: 'Date',
        locationLabel: 'Location',
        addressLabel: 'Address',
        nameLabel: 'Name',
        phoneLabel: 'Phone',
        statusLabel: 'Status',
        paidTodayLabel: 'Paid today',
        dueAtPickupLabel: 'Due at pickup',
        totalLabel: 'Total',
        depositPaid: 'Deposit paid',
        paidInFull: 'Paid in full',
        reminderTitle: 'Attention!',
        reminderLineOne:
            'No phone reminder will be made. Please carefully note your pickup date.',
        reminderLineTwo:
            'If any change occurs, we will notify you by email.',
        pickupEmailFallback: 'Pickup details are included in your confirmation email.',
        returnHome: 'Return to Home'
    },
    fr: {
        loadingTitle: 'Chargement de la commande...',
        loadingMessage: 'Nous vérifions votre confirmation de paiement.',
        unverifiedTitle: 'Statut de commande indisponible',
        unverifiedMessage: 'Nous ne pouvons pas vérifier cette commande depuis ce lien.',
        title: '✓ Commande confirmée',
        thanks: 'Merci pour votre commande.',
        emailSent: (email) => `Un courriel de confirmation a été envoyé à ${email}.`,
        emailSentFallback: 'Un courriel de confirmation avec vos détails a été envoyé.',
        pickupDetails: 'Détails du ramassage',
        customerInfo: 'Infos client',
        orderTitle: 'Votre commande',
        paymentTitle: 'Paiement',
        dateLabel: 'Date',
        locationLabel: 'Succursale',
        addressLabel: 'Adresse',
        nameLabel: 'Nom',
        phoneLabel: 'Téléphone',
        statusLabel: 'Statut',
        paidTodayLabel: "Payé aujourd'hui",
        dueAtPickupLabel: 'Dû au ramassage',
        totalLabel: 'Total',
        depositPaid: 'Dépôt payé',
        paidInFull: 'Payé en totalité',
        reminderTitle: 'Attention!',
        reminderLineOne:
            'Aucun rappel téléphonique ne sera effectué. Merci de noter soigneusement la date de ramassage.',
        reminderLineTwo:
            'Si un changement survenait, nous vous avertirons par courriel.',
        pickupEmailFallback: 'Les détails du ramassage sont dans votre courriel de confirmation.',
        returnHome: "Retour à l'accueil"
    }
};

const normalizeLanguage = (value) => {
    if (typeof value !== 'string') return null;
    const normalized = value.trim().toLowerCase();
    if (normalized === 'fr' || normalized.startsWith('fr-') || normalized.startsWith('fr_')) {
        return 'fr';
    }
    if (normalized === 'en' || normalized.startsWith('en-') || normalized.startsWith('en_')) {
        return 'en';
    }
    return null;
};

const formatCalendarDate = (value, language) => {
    if (!value) return '';
    let year;
    let month;
    let day;

    if (value instanceof Date) {
        if (Number.isNaN(value.getTime())) return '';
        const isUtcMidnight =
            value.getUTCHours() === 0
            && value.getUTCMinutes() === 0
            && value.getUTCSeconds() === 0
            && value.getUTCMilliseconds() === 0;
        if (isUtcMidnight) {
            year = value.getUTCFullYear();
            month = value.getUTCMonth() + 1;
            day = value.getUTCDate();
        } else {
            year = value.getFullYear();
            month = value.getMonth() + 1;
            day = value.getDate();
        }
    } else {
        const stringValue = typeof value === 'string' ? value.trim() : String(value);
        const dateOnlyMatch = stringValue.match(/^(\d{4})-(\d{2})-(\d{2})$/);
        const isoPrefixMatch = stringValue.match(/^(\d{4})-(\d{2})-(\d{2})T/);
        if (dateOnlyMatch) {
            year = Number(dateOnlyMatch[1]);
            month = Number(dateOnlyMatch[2]);
            day = Number(dateOnlyMatch[3]);
        } else if (isoPrefixMatch) {
            year = Number(isoPrefixMatch[1]);
            month = Number(isoPrefixMatch[2]);
            day = Number(isoPrefixMatch[3]);
        } else {
            const parsed = new Date(stringValue);
            if (Number.isNaN(parsed.getTime())) return stringValue;
            year = parsed.getUTCFullYear();
            month = parsed.getUTCMonth() + 1;
            day = parsed.getUTCDate();
        }
    }

    const parsed = new Date(Date.UTC(year, month - 1, day));
    return new Intl.DateTimeFormat(language === 'fr' ? 'fr-CA' : 'en-CA', {
        month: 'long',
        day: 'numeric',
        year: 'numeric',
        timeZone: 'UTC'
    }).format(parsed);
};

function Success({ lang }) {
    const location = useLocation();
    const [order, setOrder] = useState(null);
    const [loading, setLoading] = useState(true);
    const [loadError, setLoadError] = useState(false);

    const sessionId = useMemo(() => {
        const params = new URLSearchParams(location.search);
        return params.get('session_id');
    }, [location.search]);

    useEffect(() => {
        if (!sessionId) {
            setOrder(null);
            setLoading(false);
            setLoadError(false);
            return;
        }

        const controller = new AbortController();
        setOrder(null);
        setLoading(true);
        setLoadError(false);
        fetch(`${API_URL}/orders/confirm?session_id=${encodeURIComponent(sessionId)}`, {
            signal: controller.signal,
            credentials: 'include'
        })
            .then((res) => {
                if (!res.ok) {
                    throw new Error('Failed to load order');
                }
                return res.json();
            })
            .then((data) => {
                setOrder(data.order || null);
            })
            .catch((err) => {
                if (err?.name === 'AbortError') {
                    return;
                }
                setLoadError(true);
            })
            .finally(() => {
                if (!controller.signal.aborted) {
                    setLoading(false);
                }
            });

        return () => controller.abort();
    }, [sessionId]);

    useEffect(() => {
        if (order) {
            try {
                sessionStorage.removeItem('hen_cart_data');
            } catch {
                // Ignore
            }
        }
    }, [order]);

    const normalizedOrderLanguage = normalizeLanguage(order?.language);
    const language = normalizedOrderLanguage || (lang === 'fr' ? 'fr' : 'en');
    const copy = COPY[language];
    const pickupDate = formatCalendarDate(order?.pickup_date, language);

    const locationDetails = order?.pickup_location
        ? LOCATION_DETAILS[order.pickup_location] || { label: order.pickup_location }
        : null;

    const totalCents = Number(order?.total_cents);
    const totalAmount = Number.isFinite(totalCents)
        ? (totalCents / 100).toFixed(2)
        : null;
    const paidCentsRaw = Number(order?.amount_paid_cents);
    const dueCentsRaw = Number(order?.amount_due_cents);
    const paidCents = Number.isFinite(paidCentsRaw) ? paidCentsRaw : totalCents;
    const dueCents = Number.isFinite(dueCentsRaw)
        ? dueCentsRaw
        : Number.isFinite(totalCents) && Number.isFinite(paidCents)
            ? Math.max(totalCents - paidCents, 0)
            : null;
    const paidAmount = Number.isFinite(paidCents)
        ? (paidCents / 100).toFixed(2)
        : null;
    const dueAmount = Number.isFinite(dueCents)
        ? (dueCents / 100).toFixed(2)
        : null;
    const paymentType = order?.payment_type || (Number(dueCents) > 0 ? 'deposit' : 'full');
    const paymentLabel = paymentType === 'deposit' ? copy.depositPaid : copy.paidInFull;
    const hasVerifiedOrder = Boolean(order);
    const titleText = loading
        ? copy.loadingTitle
        : hasVerifiedOrder
            ? copy.title
            : copy.unverifiedTitle;
    const introText = loading
        ? copy.loadingMessage
        : hasVerifiedOrder
            ? copy.thanks
            : copy.unverifiedMessage;

    return (
        <div className="success-container">
            <h1 className="success-title">{titleText}</h1>
            <p className="success-message">{introText}</p>
            {hasVerifiedOrder && (
                <p className="success-message">
                    {order?.customer_email
                        ? copy.emailSent(order.customer_email)
                        : copy.emailSentFallback}
                </p>
            )}

            {!loading && hasVerifiedOrder && (
                <>
                    <div className="success-section">
                        <div className="success-section-title">{copy.pickupDetails}</div>
                        {pickupDate && (
                            <div className="success-detail-row">
                                <span className="success-label">{copy.dateLabel}:</span>
                                <span>{pickupDate}</span>
                            </div>
                        )}
                        {locationDetails?.label && (
                            <div className="success-detail-row">
                                <span className="success-label">{copy.locationLabel}:</span>
                                <span>{locationDetails.label}</span>
                            </div>
                        )}
                        {locationDetails?.address && (
                            <div className="success-detail-row">
                                <span className="success-label">{copy.addressLabel}:</span>
                                <span>{locationDetails.address}</span>
                            </div>
                        )}
                    </div>

                    <div className="success-reminder" role="note">
                        <div className="success-reminder-title">{copy.reminderTitle}</div>
                        <p className="success-reminder-text">{copy.reminderLineOne}</p>
                        <p className="success-reminder-text">{copy.reminderLineTwo}</p>
                    </div>

                    {(order?.customer_name || order?.customer_phone || order?.customer_address) && (
                        <div className="success-section">
                            <div className="success-section-title">{copy.customerInfo}</div>
                            {order?.customer_name && (
                                <div className="success-detail-row">
                                    <span className="success-label">{copy.nameLabel}:</span>
                                    <span>{order.customer_name}</span>
                                </div>
                            )}
                            {order?.customer_phone && (
                                <div className="success-detail-row">
                                    <span className="success-label">{copy.phoneLabel}:</span>
                                    <span>{order.customer_phone}</span>
                                </div>
                            )}
                            {order?.customer_address && (
                                <div className="success-detail-row">
                                    <span className="success-label">{copy.addressLabel}:</span>
                                    <span>{order.customer_address}</span>
                                </div>
                            )}
                        </div>
                    )}

                    <div className="success-section">
                        <div className="success-section-title">{copy.orderTitle}</div>
                        <ul className="success-items">
                            {order.items?.map((item) => {
                                const name = item.name?.split(' / ')[0] || 'Item';
                                const lineTotal = Number.isFinite(Number(item.line_cents))
                                    ? (Number(item.line_cents) / 100).toFixed(2)
                                    : null;
                                return (
                                    <li key={`${item.id}-${name}`} className="success-item">
                                        <span>{item.quantity} {name}</span>
                                        {lineTotal && <span>${lineTotal}</span>}
                                    </li>
                                );
                            })}
                        </ul>
                        {totalAmount && (
                            <div className="success-total">
                                <span>{copy.totalLabel}:</span>
                                <span>${totalAmount}</span>
                            </div>
                        )}
                    </div>
                    <div className="success-section">
                        <div className="success-section-title">{copy.paymentTitle}</div>
                        <div className="success-detail-row">
                            <span className="success-label">{copy.statusLabel}:</span>
                            <span>{paymentLabel}</span>
                        </div>
                        {paidAmount && (
                            <div className="success-detail-row">
                                <span className="success-label">{copy.paidTodayLabel}:</span>
                                <span>${paidAmount}</span>
                            </div>
                        )}
                        {dueAmount && Number(dueCents) > 0 && (
                            <div className="success-detail-row">
                                <span className="success-label">{copy.dueAtPickupLabel}:</span>
                                <span>${dueAmount}</span>
                            </div>
                        )}
                    </div>
                </>
            )}

            {loadError && !hasVerifiedOrder && (
                <p className="success-message">
                    {copy.pickupEmailFallback}
                </p>
            )}

            <Link to="/" className="home-link">
                {copy.returnHome}
            </Link>
        </div>
    );
}

export default Success;
