import { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';

const contentMap = {
  en: {
    nav_home: 'Home',
    nav_prices: 'Prices',
    nav_order: 'Order',
  },
  fr: {
    nav_home: 'Accueil',
    nav_prices: 'Prix',
    nav_order: 'Commander',
  },
};

export default function MobileHeader({ lang, setLang }) {
  const t = contentMap[lang];
  const location = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    setMenuOpen(false);
  }, [location.pathname]);

  const isActive = (path) => (location.pathname === path ? 'is-active' : '');

  return (
    <header className="mobile-header">
      <div className="mobile-topbar">
        <div className="mobile-lang-toggle">
          <button
            type="button"
            className={lang === 'en' ? 'active' : ''}
            onClick={() => setLang('en')}
          >
            EN
          </button>
          <span className="mobile-lang-divider">/</span>
          <button
            type="button"
            className={lang === 'fr' ? 'active' : ''}
            onClick={() => setLang('fr')}
          >
            FR
          </button>
        </div>
      </div>

      <div className="mobile-brand-row">
        <Link to="/" className="mobile-logo-link" aria-label="Les Fermes Soulard">
          <img src="/logo.png" alt="Les Fermes Soulard" className="mobile-logo" />
        </Link>
        <button
          type="button"
          className={`mobile-menu-toggle ${menuOpen ? 'open' : ''}`}
          onClick={() => setMenuOpen((open) => !open)}
          aria-label="Toggle navigation menu"
          aria-expanded={menuOpen}
          aria-controls="mobile-nav"
        >
          <span className="mobile-menu-bar" />
          <span className="mobile-menu-bar" />
          <span className="mobile-menu-bar" />
        </button>
      </div>

      <nav id="mobile-nav" className={`mobile-nav ${menuOpen ? 'open' : ''}`}>
        <Link to="/" className={`mobile-nav-link ${isActive('/')}`}>
          {t.nav_home}
        </Link>
        <Link to="/prices" className={`mobile-nav-link ${isActive('/prices')}`}>
          {t.nav_prices}
        </Link>
        <Link to="/order" className={`mobile-nav-link ${isActive('/order')}`}>
          {t.nav_order}
        </Link>
      </nav>
    </header>
  );
}
