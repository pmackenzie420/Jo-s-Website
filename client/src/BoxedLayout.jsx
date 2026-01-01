import { Outlet } from 'react-router-dom';
import SiteHeader from './SiteHeader';
import './boxed.css';

export default function BoxedLayout({ lang, setLang }) {

  return (
    <>
      {/* 1. MAIN WRAPPER */}
      <div className="page-wrapper">

        {/* 2. WHITE PAPER CONTAINER (Header + Content) */}
        <div className="white-paper">

          {/* Site Header Component */}
          <SiteHeader lang={lang} setLang={setLang} />

          {/* --- Main Content (Outlet) --- */}
          <div style={{ minHeight: '60vh' }}>
            <Outlet />
          </div>

        </div>
        {/* END OF WHITE PAPER */}

      </div>

      {/* 3. TRANSPARENT FOOTER (Outside page-wrapper, directly on wallpaper) */}
      <footer className="boxed-footer" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
        <img src="/logo_white.png" alt="Les Fermes Soulard Logo" style={{ height: '160px', marginBottom: '35px' }} />

        <a
          href="https://www.facebook.com/profile.php?id=100057648781893"
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
          <p style={{ margin: '5px 0', fontSize: '1rem' }}>315 ch. Back Bush, Hemmingford, QC</p>
          <a
            href="https://www.google.com/maps/search/?api=1&query=315+ch.+Back+Bush,+Hemmingford,+QC"
            target="_blank"
            rel="noopener noreferrer"
            style={{ color: '#fff', textDecoration: 'underline', fontSize: '0.9rem' }}
          >
            Get Directions / Obtenir l'itinéraire
          </a>
        </div>
      </footer>
    </>
  );
}
