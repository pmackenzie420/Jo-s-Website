import { useEffect, useMemo, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import './../styles/pages/Success.css';
import { API_URL } from '../constants/api';

const LOCATION_DETAILS = {
    hemmingford: {
        label: 'Hemmingford',
        address: '315 ch. Back Bush, Hemmingford, QC'
    },
    bristol: {
        label: 'Bristol',
        address: '84 Rte 148, Bristol, QC'
    }
};

const COPY = {
    en: {
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
        pickupEmailFallback: 'Pickup details are included in your confirmation email.',
        returnHome: 'Return to Home'
    },
    fr: {
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
        pickupEmailFallback: 'Les détails du ramassage sont dans votre courriel de confirmation.',
        returnHome: "Retour à l'accueil"
    }
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

    const normalizedOrderLanguage = order?.language === 'fr'
        ? 'fr'
        : order?.language === 'en'
            ? 'en'
            : null;
    const language = normalizedOrderLanguage || (lang === 'fr' ? 'fr' : 'en');
    const copy = COPY[language];
    const pickupDate = order?.pickup_date
        ? new Intl.DateTimeFormat(language === 'fr' ? 'fr-CA' : 'en-CA', {
              month: 'long',
              day: 'numeric',
              year: 'numeric'
          }).format(new Date(order.pickup_date))
        : '';

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

    return (
        <div className="success-container">
            <h1 className="success-title">{copy.title}</h1>
            <p className="success-message">{copy.thanks}</p>
            <p className="success-message">
                {order?.customer_email
                    ? copy.emailSent(order.customer_email)
                    : copy.emailSentFallback}
            </p>

            {!loading && order && (
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

            {loadError && !order && (
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
