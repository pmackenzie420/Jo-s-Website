import { Outlet, Link, useLocation } from 'react-router-dom';
import { useState } from 'react';

export const content = {
  en: {
    alert: "Reservation required for any purchase.",
    nav_home: "HOME", nav_prices: "PRICE LIST", nav_order: "ORDER ONLINE",
  },
  fr: {
    alert: "Réservation nécessaire pour tout achat.",
    nav_home: "ACCUEIL", nav_prices: "LISTE DE PRIX", nav_order: "COMMANDER",
  }
};

export default function Layout({ lang, setLang }) {
  const t = content[lang];
  const location = useLocation();

  // Helper to check active link
  const isActive = (path) => location.pathname === path ? { textDecoration: 'underline' } : {};

  return (
    <div>
      {/* HEADER TOP */}
      <div className="header-top" style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 20px' }}>
        <span>{t.alert}</span>
        <div style={{ cursor: 'pointer', fontWeight: 'bold' }}>
          <span onClick={() => setLang('en')} style={{ opacity: lang === 'en' ? 1 : 0.5 }}>EN</span> |
          <span onClick={() => setLang('fr')} style={{ opacity: lang === 'fr' ? 1 : 0.5 }}>FR</span>
        </div>
      </div>

      {/* HEADER MIDDLE */}
      <header className="header-middle">
        <div className="header-middle-content">
          <div className="logo-text">LES FERMES<br />SOULARD S.E.N.C.</div>
          <div style={{ textAlign: 'center' }}>
            <div className="phone-display">(819) 770-0070</div>
            <div>lesfermessoulard@gmail.com</div>
          </div>
          <div className="address-text">315 ch. Back Bush,<br />Hemmingford, Qc</div>
        </div>
      </header>

      {/* NAVIGATION */}
      <nav className="header-nav">
        <div className="nav-content">
          <Link to="/" className="nav-item" style={isActive('/')}>{t.nav_home}</Link>
          <Link to="/prices" className="nav-item" style={isActive('/prices')}>{t.nav_prices}</Link>
          <Link to="/order" className="nav-item" style={isActive('/order')}>{t.nav_order}</Link>
        </div>
      </nav>

      {/* PAGE CONTENT INJECTED HERE */}
      <div style={{ minHeight: '60vh' }}>
        <Outlet />
      </div>

      {/* FOOTER */}
      <footer style={{ textAlign: 'center', padding: '40px', background: '#333', color: 'white', marginTop: '50px' }}>
        <img
          src="/logo.png"
          alt="Les Fermes Soulard Logo"
          style={{
            width: '150px',
            height: 'auto',
            marginBottom: '20px',
            filter: 'brightness(0) invert(1)'
          }}
        />
        <p>© 2025 Les Fermes Soulard S.E.N.C.</p>
      </footer>
    </div>
  );
}
