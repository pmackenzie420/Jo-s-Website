import { Link } from 'react-router-dom';

export default function Home({ lang }) {
  return (
    <>
      {/* Solid White Bar between header and hero - extends into side padding */}


      {/* Hero Image with Green Overlay Banner */}
      <div className="home-hero">
        <img
          src="/Banner.jpg"
          alt="Farm Banner"
          className="home-hero-image"
        />
        {/* Solid Green Banner at Bottom */}
        <div className="home-hero-banner">
          <h1 className="home-hero-title">
            Les Fermes Soulard S.E.N.C.
          </h1>
        </div>
      </div>

      {/* Content Section */}
      <div className="home-content">
        <div className="container home-content-inner">

          <div className="home-cta">
            <Link to="/order">
              <button className="btn-checkout home-cta-button home-cta-primary">
                {lang === 'en' ? "Order Online" : "Commander en Ligne"}
              </button>
            </Link>
            <Link to="/prices">
              <button className="btn-checkout home-cta-button home-cta-secondary">
                {lang === 'en' ? "View Prices" : "Voir les Prix"}
              </button>
            </Link>
          </div>

          {/* Locations Section */}
          <div style={{ marginTop: '60px', paddingBottom: '40px' }}>
            <h3 style={{ textTransform: 'uppercase', marginBottom: '40px', fontSize: '1.8rem', color: 'black' }}>
              {lang === 'en' ? "Two locations to serve you" : "Deux adresses pour vous servir"}
            </h3>

            <div style={{ display: 'flex', justifyContent: 'center', gap: '100px', flexWrap: 'wrap' }}>
              <div style={{ textAlign: 'center' }}>
                <strong style={{ display: 'block', fontSize: '1.6rem', marginBottom: '15px', color: 'black' }}>Montérégie</strong>
                <span style={{ fontSize: '1.3rem', color: 'black' }}>315 Back Bush, Hemmingford, QC</span>
              </div>
              <div style={{ textAlign: 'center' }}>
                <strong style={{ display: 'block', fontSize: '1.6rem', marginBottom: '15px', color: 'black' }}>Outaouais</strong>
                <span style={{ fontSize: '1.3rem', color: 'black' }}>84 Rte 148, Bristol, QC</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
