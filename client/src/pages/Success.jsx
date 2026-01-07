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

function Success() {
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

    const pickupDate = order?.pickup_date
        ? new Intl.DateTimeFormat('en-CA', {
              month: 'long',
              day: 'numeric',
              year: 'numeric'
          }).format(new Date(order.pickup_date))
        : '';

    const locationDetails = order?.pickup_location
        ? LOCATION_DETAILS[order.pickup_location] || { label: order.pickup_location }
        : null;

    const totalAmount = Number.isFinite(Number(order?.total_cents))
        ? (Number(order.total_cents) / 100).toFixed(2)
        : null;

    return (
        <div className="success-container">
            <h1 className="success-title">✓ Order Confirmed</h1>
            <p className="success-message">Thank you for your order.</p>
            <p className="success-message">
                {order?.customer_email
                    ? `We've sent a confirmation email to ${order.customer_email}.`
                    : 'We have sent a confirmation email with your details.'}
            </p>

            {!loading && order && (
                <>
                    <div className="success-section">
                        <div className="success-section-title">Pickup Details</div>
                        {pickupDate && (
                            <div className="success-detail-row">
                                <span className="success-label">Date:</span>
                                <span>{pickupDate}</span>
                            </div>
                        )}
                        {locationDetails?.label && (
                            <div className="success-detail-row">
                                <span className="success-label">Location:</span>
                                <span>{locationDetails.label}</span>
                            </div>
                        )}
                        {locationDetails?.address && (
                            <div className="success-detail-row">
                                <span className="success-label">Address:</span>
                                <span>{locationDetails.address}</span>
                            </div>
                        )}
                    </div>

                    {(order?.customer_name || order?.customer_phone || order?.customer_address) && (
                        <div className="success-section">
                            <div className="success-section-title">Customer Info</div>
                            {order?.customer_name && (
                                <div className="success-detail-row">
                                    <span className="success-label">Name:</span>
                                    <span>{order.customer_name}</span>
                                </div>
                            )}
                            {order?.customer_phone && (
                                <div className="success-detail-row">
                                    <span className="success-label">Phone:</span>
                                    <span>{order.customer_phone}</span>
                                </div>
                            )}
                            {order?.customer_address && (
                                <div className="success-detail-row">
                                    <span className="success-label">Address:</span>
                                    <span>{order.customer_address}</span>
                                </div>
                            )}
                        </div>
                    )}

                    <div className="success-section">
                        <div className="success-section-title">Your Order</div>
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
                                <span>Total:</span>
                                <span>${totalAmount}</span>
                            </div>
                        )}
                    </div>
                </>
            )}

            {loadError && !order && (
                <p className="success-message">
                    Pickup details are included in your confirmation email.
                </p>
            )}

            <Link to="/" className="home-link">
                Return to Home
            </Link>
        </div>
    );
}

export default Success;
