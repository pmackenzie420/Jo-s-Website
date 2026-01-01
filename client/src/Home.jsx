import { Link } from 'react-router-dom';

export default function Home({ lang }) {
  return (
    <>
      {/* Solid White Bar between header and hero - extends into side padding */}
      <div style={{
        background: '#fff',
        height: '12px',
        width: 'calc(100% + 24px)',
        marginLeft: '-12px',
        marginRight: '-12px'
      }}></div>

      {/* Hero Image with Green Overlay Banner */}
      <div style={{ position: 'relative', width: '100%', height: '600px', overflow: 'hidden' }}>
        <img
          src="/Banner.jpg"
          alt="Farm Banner"
          style={{
            width: '100%',
            height: '100%',
            objectFit: 'cover',
            display: 'block'
          }}
        />
        {/* Solid Green Banner at Bottom */}
        <div style={{
          position: 'absolute',
          bottom: 0,
          left: 0,
          right: 0,
          background: '#4c6e52',
          padding: '15px 0',
          textAlign: 'center',
          height: '60px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center'
        }}>
          <h1 style={{
            fontSize: '36px',
            margin: 0,
            color: 'white',
            fontWeight: 'bold',
            letterSpacing: '2px',
            textTransform: 'uppercase'
          }}>
            Les Fermes Soulard S.E.N.C.
          </h1>
        </div>
      </div>

      {/* Content Section */}
      <div style={{ padding: '40px 20px', minHeight: '400px' }}>
        <div className="container" style={{ textAlign: 'center', maxWidth: '800px', margin: '0 auto' }}>
          <p style={{ fontSize: '1.2rem', lineHeight: '1.6', marginBottom: '40px', marginTop: '0' }}>
            {lang === 'en'
              ? "Family owned and operated since 2000. We specialize in high-quality ready-to-lay hens and meat birds for your farm or backyard."
              : "Entreprise familiale depuis 2000. Nous nous spécialisons dans les poules prêtes à pondre et les poulets de chair de haute qualité."
            }
          </p>

          <div style={{ display: 'flex', gap: '20px', justifyContent: 'center', marginBottom: '60px' }}>
            <Link to="/order">
              <button className="btn-checkout" style={{ width: 'auto', padding: '20px 40px', background: 'var(--color-brand)' }}>
                {lang === 'en' ? "Order Online" : "Commander en Ligne"}
              </button>
            </Link>
            <Link to="/prices">
              <button className="btn-checkout" style={{ width: 'auto', padding: '20px 40px', background: 'white', color: 'black', border: '1px solid black' }}>
                {lang === 'en' ? "View Prices" : "Voir les Prix"}
              </button>
            </Link>
          </div>
        </div>
      </div>
    </>
  );
}
