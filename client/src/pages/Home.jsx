import { Link } from 'react-router-dom';
import './../styles/pages/Home.css';
import LOCATION_DETAILS from '../../../shared/locations.json';

const OFFERING_IMAGES = [
  { src: '/photos/hens_cropped.jpg', alt: 'Laying hens' },
  { src: '/photos/chicks_cropped.jpg', alt: 'Broiler chicks' },
  { src: '/photos/lamb_cropped.jpg', alt: 'Lambs' },
];

const HISTORY_PHOTOS = [
  { src: '/photos/IMG_9895.jpeg', alt: 'Farm poultry', width: 800, height: 600 },
  { src: '/photos/96f64fdc5db3d6a3d3142fae033ddfe9-800.jpeg', alt: 'Farm operations', width: 800, height: 600 },
  { src: '/photos/image000000-800.jpeg', alt: 'Farm fields', width: 800, height: 600 },
  { src: '/photos/IMG_7625-800.jpeg', alt: 'Laying hens', width: 800, height: 600 },
  { src: '/photos/IMG_9834-800.jpeg', alt: 'Family farm life', width: 800, height: 1067 },
];

export default function Home({ lang }) {
  const aboutContent = lang === 'en'
    ? {
      heading: 'ABOUT US',
      intro: 'Welcome to Les Fermes Soulard SENC! Here is some relevant information about our business.',
      offeringsTitle: 'What We Offer:',
      offerings: [
        {
          title: 'Fresh Laying Hens',
          description: 'With the best genetics available in Quebec. Whether you are a gentleman farmer or a serious egg producer, our brown pullets combine production capacity, strong health, and a calm temperament. April to October.'
        },
        {
          title: 'Day-Old Broiler Chicks',
          description: 'Do you prefer light carcasses from free-range, grass-fed chickens? No problem! But your mother-in-law would love a few 10 lb capons to replace the holiday turkeys? Excellent! The Ross broiler performs very well in conventional production and is robust enough for pasture rearing. May and June.'
        },
        {
          title: 'Alfalfa-Fed Lambs',
          description: 'Whether you are looking for a few ewe lambs to start a flock or a lamb for the freezer, we produce top-quality animals, fed alfalfa silage in a low-stress environment. Availability varies year-round.'
        }
      ],
      historyTitle: 'Our Story',
      historyParagraphs: [
        'In 2010, brothers Alexandre and Jonathan had the idea to commercialize their passion for backyard birds. After buying a small incubator with their savings, they hatched and sold ducklings and chicks. The following year, they bought two larger incubators and gradually added geese, quail, partridge, and Virginia quail to their flocks.',
        'Despite modest financial gains, motivation remained and production grew the next season. At the same time, an interest in field crops also developed.',
        'In 2012, things evolved. Only duckling and Virginia quail production continued, and distribution of ready-to-lay pullets began. The two brothers also invested that year in purchasing their first farm. Early years in field crops were difficult, but with their sister taking over customer service and by combining outside work with a lot of effort on the farm, they managed to make ends meet. Poultry distribution continued in Hemmingford and also in Bristol, Outaouais.',
        'Years followed with ups and downs; but progress was significant, and the same goal remained: to build a strong agricultural business in a time when costs have exploded. Frederique replaced Josee-Anne in customer service; Les Fermes Soulard SENC now offers only laying hens and broiler chicks.',
        'The high quality of the poultry offered has allowed them to build an important customer network in Quebec and Ontario, distributing tens of thousands of birds annually; and the two brothers, now each with their own families, have moved to Outaouais and work full time on the farm. A flock of sheep was also added and, as of 2026, lambs will be among the live animals available for purchase. The project of offering fresh meats is also under study!',
        'Les Fermes Soulard SENC is a family business where quality comes before quantity. A 100% Quebec local company, we are proud of what we have built, and we thank our valued customers with whom we plan to grow for generations to come.'
      ]
    }
    : {
      heading: 'À PROPOS DE NOUS',
      intro: 'Bienvenue chez Les Fermes Soulard SENC! Voici quelques informations pertinentes sur notre entreprise.',
      offeringsTitle: 'Ce que nous offrons:',
      offerings: [
        {
          title: 'Des Poules Pondeuses Fraîches',
          description: 'Avec les meilleures génétiques disponibles au Québec. Que vous soyez un gentleman farmer ou un producteur d\'oeufs sérieux, nos poulettes brunes combinent capacité de production, santé forte et caractère calme. D\'avril à octobre.'
        },
        {
          title: 'Des Poussins à Chair d\'un Jour',
          description: 'Vous préférez les carcasses légères de poulets élevés en liberté et nourris à l\'herbe? Pas de problème! Mais votre belle-mère aimerait bien quelques chapons de 10 lbs pour remplacer les dindes du temps des Fêtes? Excellent! Le poulet à chair Ross performe très bien en élevage conventionnel, et est assez robuste pour être élevé en prairies. Mai et juin.'
        },
        {
          title: 'Des Agneaux Élevés à la Luzerne',
          description: 'Que vous cherchiez quelques agnelles pour démarrer un troupeau, ou un agneau pour le congélateur, nous produisons des bêtes de la plus grande qualité, nourries à l\'ensilage de luzerne dans un environnement sans stress. Disponibilités variables, à l\'année.'
        }
      ],
      historyTitle: 'Notre Histoire',
      historyParagraphs: [
        "C'est en 2010 que les frères Alexandre et Jonathan ont eu l'idée de commercialiser leur passion pour les oiseaux de basse-cour. Après l'achat d'un petit incubateur avec leurs économies, ils ont incubé et vendu des canetons et des poussins. L'année suivante, ils se sont procuré deux plus gros incubateurs et ont graduellement ajouté des oies, des cailles, des perdrix et des colins de Virginie à leurs troupeaux.",
        "Malgré le peu de gains financiers, la motivation reste, et la production augmente la saison d'après. En parallèle, un intérêt pour la grande culture se développe aussi.",
        "En 2012, les choses ont évolué. Seules les productions de canetons et de colins de Virginie continuent, et la distribution de poulettes prêtes à pondre a commencé. Les deux frères investissent aussi cette année-là dans l'achat d'une première terre agricole. Les débuts en grande culture sont difficiles, mais avec leur sœur qui prend en main le service à la clientèle, et en combinant travail à l'extérieur et beaucoup d'efforts sur la ferme, on parvient à joindre les deux bouts. La distribution de volailles se fait encore à Hemmingford mais aussi à Bristol, en Outaouais.",
        "Les années s'enchaînent avec des hauts et des bas; mais la progression est grande, et le même but reste d'établir une entreprise agricole performante à une époque où les coûts ont explosé. Frédérique a remplacé Josée-Anne au service à la clientèle; Les Fermes Soulard SENC n'offrent plus que des poules pondeuses et des poussins à chair.",
        "La grande qualité des volailles offertes a permis de développer un réseau important de clientèle, au Québec et en Ontario, distribuant des dizaines de milliers d'oiseaux annuellement; et les deux frères, maintenant avec chacun leur famille, ont déménagé en Outaouais et travaillent à temps plein sur la ferme. Un troupeau de moutons est aussi ajouté et, dès 2026, les agneaux feront partie des animaux vivants disponibles à l'achat. Le projet d'offrir des viandes fraîches est aussi sous étude!",
        "Les Fermes Soulard SENC est une entreprise familiale pour qui la qualité passe avant la quantité. Entreprise locale 100% québécoise, nous sommes fiers de ce que nous avons bâti, et remercions notre précieuse clientèle avec laquelle nous prévoyons évoluer pour les générations à venir."
      ]
    };

  const locationCards = [
    {
      title: 'Outaouais',
      address: LOCATION_DETAILS.bristol?.address || '84 Rte 148, Bristol, QC'
    },
    {
      title: 'Montérégie',
      address: LOCATION_DETAILS.hemmingford?.address || '315 Back Bush, Hemmingford, QC'
    }
  ];

  return (
    <>
      {/* Hero Image with Green Overlay Banner */}
      <div className="home-hero">
        <img
          src="/Banner.jpg"
          srcSet="/Banner-640.jpg 640w, /Banner-960.jpg 960w, /Banner.jpg 1200w"
          sizes="100vw"
          alt="Farm Banner"
          className="home-hero-image"
          fetchPriority="high"
          loading="eager"
          decoding="async"
          width="1200"
          height="431"
        />
        {/* Solid Green Banner at Bottom */}
        <div className="home-hero-banner">
          <h1 className="home-hero-title">
            Les Fermes Soulard S.E.N.C.
          </h1>
        </div>
      </div>

      {/* Top section: CTAs + Intro */}
      <div className="home-top-section">
        <div className="home-cta-row">
          <Link to="/order" className="cta-primary">
            {lang === 'en' ? "Order Online" : "Commander en Ligne"}
          </Link>
          <Link to="/prices" className="cta-secondary">
            {lang === 'en' ? "View Prices" : "Voir les Prix"}
          </Link>
        </div>
        <p className="home-intro-text">{aboutContent.intro}</p>
      </div>

      {/* Offerings Band */}
      <div className="home-offerings-band">
        <div className="home-offerings-inner">
          <h2 className="home-section-title">{aboutContent.offeringsTitle}</h2>
          <div className="home-offerings-list">
            {aboutContent.offerings.map((offering, index) => (
              <div key={index} className="home-offering-card">
                <img
                  src={OFFERING_IMAGES[index].src}
                  alt={OFFERING_IMAGES[index].alt}
                  className="home-offering-image"
                  loading="eager"
                  decoding="async"
                />
                <div className="home-offering-body">
                  <h3 className="home-offering-title">{offering.title}</h3>
                  <p className="home-offering-description">{offering.description}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Content Section */}
      <div className="home-content-flow">
        <hr className="home-section-divider" />

        {/* 5. Full History Section */}
        <div className="home-history">
          <h2 className="home-history-title">{aboutContent.historyTitle}</h2>

          <p className="home-history-paragraph">{aboutContent.historyParagraphs[0]}</p>

          <div className="home-history-image-container">
            <img
              src="/photos/barn.jpeg"
              alt="Farm barn"
              className="home-history-image"
              loading="eager"
              decoding="async"
            />
          </div>

          <p className="home-history-paragraph">{aboutContent.historyParagraphs[1]}</p>

          <div className="home-history-image-container">
            <img
              src="/photos/96f64fdc5db3d6a3d3142fae033ddfe9-800.jpeg"
              alt="Farm operations"
              className="home-history-image"
              loading="eager"
              decoding="async"
            />
          </div>

          <p className="home-history-paragraph">{aboutContent.historyParagraphs[2]}</p>

          <div className="home-history-image-container">
            <img
              src={HISTORY_PHOTOS[0].src}
              alt={HISTORY_PHOTOS[0].alt}
              className="home-history-image"
              loading="eager"
              decoding="async"
              width={HISTORY_PHOTOS[0].width}
              height={HISTORY_PHOTOS[0].height}
            />
          </div>

          <p className="home-history-paragraph">{aboutContent.historyParagraphs[3]}</p>

          <div className="home-history-image-container">
            <img
              src={HISTORY_PHOTOS[2].src}
              alt={HISTORY_PHOTOS[2].alt}
              className="home-history-image"
              loading="eager"
              decoding="async"
              width={HISTORY_PHOTOS[2].width}
              height={HISTORY_PHOTOS[2].height}
            />
          </div>

          <p className="home-history-paragraph">{aboutContent.historyParagraphs[4]}</p>

          <div className="home-history-image-container home-history-image-square">
            <img
              src="/photos/IMG_9834-800.jpeg"
              alt="Family farm life"
              className="home-history-image home-history-image--square"
              loading="eager"
              decoding="async"
            />
          </div>

          <p className="home-history-paragraph">{aboutContent.historyParagraphs[5]}</p>
        </div>

        {/* 6. Locations Section */}
        <div className="home-locations">
          <h3 className="home-locations-title">
            {lang === 'en' ? "Two locations to serve you" : "Deux adresses pour vous servir"}
          </h3>

          <div className="home-locations-grid">
            {locationCards.map((location) => (
              <div key={location.title} className="home-location">
                <strong className="home-location-title">{location.title}</strong>
                <span className="home-location-address">{location.address}</span>
              </div>
            ))}
          </div>
        </div>

      </div>
    </>
  );
}
