import { useEffect } from 'react';
import { Link, useLocation } from 'react-router-dom';

export default function Success({ lang }) {
  const location = useLocation();

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const sessionId = params.get('session_id');
    if (!sessionId) {
      return;
    }

    const controller = new AbortController();
    fetch(`/api/orders/confirm?session_id=${encodeURIComponent(sessionId)}`, {
      signal: controller.signal,
    }).catch(() => {});

    return () => controller.abort();
  }, [location.search]);

  return (
    <div className="mobile-section mobile-page">
      <h2 className="mobile-section-title">
        {lang === 'en' ? 'Order Confirmed!' : 'Commande confirmée!'}
      </h2>
      <p className="mobile-subtle">
        {lang === 'en'
          ? 'Thank you for your purchase. A confirmation email is on the way.'
          : 'Merci pour votre achat. Un courriel de confirmation arrive bientôt.'}
      </p>
      <div className="mobile-message-card">
        {lang === 'en'
          ? 'We will see you on your selected pickup date!'
          : 'On se voit à la date de ramassage choisie!'}
      </div>
      <Link to="/" className="mobile-button primary">
        {lang === 'en' ? 'Return Home' : "Retour a l'accueil"}
      </Link>
    </div>
  );
}
