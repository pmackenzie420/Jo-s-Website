import { Link } from 'react-router-dom';
import aboutImage from '../assets/about_us.jpg';
import './../styles/pages/Home.css';

export default function Home({ lang }) {
  const aboutContent = lang === 'en'
    ? {
      heading: 'ABOUT US',
      alt: 'Farm with hens',
      paragraphs: [
        `Welcome to Les Fermes Soulard, where we're in the business of raising poultry and lambs who are living their best life right up until they're not.`,
        'Our Mission',
        `We believe every animal deserves fresh air, good food, and absolutely zero knowledge of what "farm to table" actually means.`,
        'What We Offer',
        'Laying Hens - Judgmental ladies who produce eggs and opinions in equal measure.',
        "Meat Chicks - Cute now, delicious later. It's called the circle of life, Simba.",
        "Lambs - So fluffy you'll feel bad about how good they taste. That's our problem now.",
        'Come visit! Nothing builds an appetite quite like making eye contact with your future dinner.'
      ]
    }
    : {
      heading: 'À PROPOS DE NOUS',
      alt: 'Ferme familiale avec des poules',
      paragraphs: [
        `Bienvenue aux Fermes Soulard, où nous élevons des volailles et des agneaux qui vivent leur meilleure vie... jusqu'à ce que ce ne soit plus le cas.`,
        'Notre mission',
        `Nous croyons que chaque animal mérite l'air frais, de la bonne nourriture et absolument aucune idée de ce que signifie vraiment "de la ferme à la table".`,
        'Ce que nous offrons',
        "Poules pondeuses - Des dames jugeantes qui produisent des oeufs et des opinions en parts égales.",
        "Poulets de chair - Mignons maintenant, délicieux plus tard. C'est le cercle de la vie, Simba.",
        "Agneaux - Si duveteux que vous vous sentirez mal d'apprécier à quel point ils sont bons. C'est notre problème maintenant.",
        "Venez nous voir ! Rien n'ouvre l'appétit comme croiser le regard de votre futur repas."
      ]
    };
  const aboutSubheadings = lang === 'en'
    ? new Set(['Our Mission', 'What We Offer'])
    : new Set(['Notre mission', 'Ce que nous offrons']);

  return (
    <>
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

          <div className="cta-container">
            <Link to="/order">
              <button className="cta-primary">
                {lang === 'en' ? "Order Online" : "Commander en Ligne"}
              </button>
            </Link>
            <Link to="/prices">
              <button className="cta-secondary">
                {lang === 'en' ? "View Prices" : "Voir les Prix"}
              </button>
            </Link>
          </div>
        </div>

        <section className="home-about">
          <h2 className="home-about-title">{aboutContent.heading}</h2>
          <div className="home-about-inner">
            <div className="home-about-media">
              <img
                src={aboutImage}
                alt={aboutContent.alt}
                className="home-about-image"
              />
            </div>
            <div className="home-about-text">
              {aboutContent.paragraphs.map((paragraph, index) => {
                const isSubheading = aboutSubheadings.has(paragraph);
                return (
                  <p
                    key={index}
                    className={`home-about-paragraph${isSubheading ? ' home-about-subtitle' : ''}`}
                  >
                    {paragraph}
                  </p>
                );
              })}
            </div>
          </div>
        </section>

        <div className="container home-content-inner">

          {/* Locations Section */}
          <div className="home-locations">
            <h3 className="home-locations-title">
              {lang === 'en' ? "Two locations to serve you" : "Deux adresses pour vous servir"}
            </h3>

            <div className="home-locations-grid">
              <div className="home-location">
                <strong className="home-location-title">Outaouais</strong>
                <span className="home-location-address">84 Rte 148, Bristol, QC</span>
              </div>
              <div className="home-location">
                <strong className="home-location-title">Montérégie</strong>
                <span className="home-location-address">315 Back Bush, Hemmingford, QC</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
