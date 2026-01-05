import { useEffect } from 'react';
import { Link, useLocation } from 'react-router-dom';

function Success() {
    const location = useLocation();

    useEffect(() => {
        const params = new URLSearchParams(location.search);
        const sessionId = params.get('session_id');
        if (!sessionId) {
            return;
        }

        const controller = new AbortController();
        fetch(`/api/orders/confirm?session_id=${encodeURIComponent(sessionId)}`, {
            signal: controller.signal
        }).catch(() => {});

        return () => controller.abort();
    }, [location.search]);

    return (
        <div style={{
            textAlign: 'center',
            padding: '50px 20px',
            maxWidth: '600px',
            margin: '0 auto'
        }}>
            <h1 style={{ color: '#4c6e52', marginBottom: '20px' }}>Order Confirmed! 🐔</h1>
            <p style={{ fontSize: '18px', color: '#555', marginBottom: '30px' }}>
                Thank you for your purchase. We have received your order and sent a confirmation email.
            </p>
            <div style={{
                background: '#f9f9f9',
                padding: '20px',
                borderRadius: '8px',
                marginBottom: '30px',
                border: '1px solid #eee'
            }}>
                <p>We will see you on your selected pickup date!</p>
            </div>
            <Link to="/" style={{
                background: '#4c6e52',
                color: 'white',
                padding: '12px 24px',
                borderRadius: '6px',
                textDecoration: 'none',
                fontWeight: 'bold'
            }}>
                Return to Home
            </Link>
        </div>
    );
}

export default Success;
