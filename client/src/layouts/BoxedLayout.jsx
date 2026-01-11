import { Link, Outlet, useLocation } from 'react-router-dom';
import { useEffect } from 'react';
import SiteHeader from '../components/SiteHeader';
import { CHECKOUT_STORAGE_KEYS } from '../constants/checkout';
import { LINKS } from '../constants/links';
import useHeartbeat from '../hooks/useHeartbeat';
import '../styles/layouts/boxed.css';

export default function BoxedLayout({ lang, setLang }) {
  const location = useLocation();
  useHeartbeat();
  const privacyLabel = lang === 'fr' ? 'Confidentialité' : 'Privacy';
  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }
    if (!location.pathname.startsWith('/checkout')) {
      try {
        window.sessionStorage.removeItem(CHECKOUT_STORAGE_KEYS.form);
        window.sessionStorage.removeItem(CHECKOUT_STORAGE_KEYS.step);
      } catch {
        // Ignore storage clear issues (private mode, quota, etc).
      }
    }
  }, [location.pathname]);

  return (
    <>
      <SiteHeader lang={lang} setLang={setLang} />

      {/* 1. MAIN WRAPPER */}
      <div className="page-wrapper">

        {/* 2. WHITE PAPER CONTAINER (Header + Content) */}
        <div className="white-paper">

          {/* --- Main Content (Outlet) --- */}
          <div>
            <Outlet />
          </div>

          <div className="page-questions-banner">
            <span className="page-questions-question">
              {lang === 'fr' ? 'Des questions?' : 'Questions?'}
            </span>
            <a className="page-questions-number-link" href="tel:+18197700070">
              (819) 770-0070
            </a>
          </div>
        </div>
        {/* END OF WHITE PAPER */}

      </div>

      {/* 3. TRANSPARENT FOOTER (Outside page-wrapper, directly on wallpaper) */}
      <footer className="boxed-footer" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
        <img src="/logo_white.png" alt="Les Fermes Soulard Logo" style={{ height: '160px', marginBottom: '35px' }} />

        <a
          href={LINKS.facebook}
          target="_blank"
          rel="noopener noreferrer"
          aria-label="Facebook"
          className="footer-fb-link"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="42" height="42" viewBox="0 0 48 48">
            <circle cx="24" cy="24" r="24" fill="#1877f2" />
            <path d="M27.5 23.5v14h-6V23.5h-4.3V18h4.3v-3c0-4.2 2.5-6.5 6.3-6.5 1.8 0 3.3.1 3.8.2v4.4h-2.6c-2 0-2.4 1-2.4 2.4v3.1h4.9l-.6 5h-4.3z" fill="#fff" />
          </svg>
        </a>

        <div style={{ marginTop: '35px', marginBottom: '20px', textAlign: 'center' }}>
          <a
            href={LINKS.maps.bristol}
            target="_blank"
            rel="noopener noreferrer"
            style={{ margin: '5px 0', fontSize: '0.9rem', color: '#fff', textDecoration: 'none', display: 'block' }}
          >
            84 Rte 148, Bristol, QC
          </a>
          <Link to="/privacy" className="footer-privacy-link">
            {privacyLabel}
          </Link>
        </div>
      </footer>
    </>
  );
}
