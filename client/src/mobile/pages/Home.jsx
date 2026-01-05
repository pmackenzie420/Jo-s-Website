import { Link } from 'react-router-dom';

export default function Home({ lang }) {
  return (
    <div className="mobile-home mobile-page">
      <div className="mobile-hero">
        <img src="/Banner.jpg" alt="Farm Banner" className="mobile-hero-image" />
        <div className="mobile-hero-banner">
          <h1>Les Fermes Soulard S.E.N.C.</h1>
        </div>
      </div>

      <div className="mobile-section">
        <div className="mobile-cta">
          <Link to="/order" className="mobile-button primary">
            {lang === 'en' ? 'Order Online' : 'Commander en Ligne'}
          </Link>
          <Link to="/prices" className="mobile-button ghost">
            {lang === 'en' ? 'View Prices' : 'Voir les Prix'}
          </Link>
        </div>
      </div>

      <div className="mobile-section">
        <h2 className="mobile-section-title">
          {lang === 'en' ? 'Two locations to serve you' : 'Deux adresses pour vous servir'}
        </h2>
        <div className="mobile-location-card">
          <h3>Montérégie</h3>
          <p>315 Back Bush, Hemmingford, QC</p>
        </div>
        <div className="mobile-location-card">
          <h3>Outaouais</h3>
          <p>84 Rte 148, Bristol, QC</p>
        </div>
      </div>
    </div>
  );
}
