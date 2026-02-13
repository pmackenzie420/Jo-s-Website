import './../styles/pages/About.css';

export default function About({ lang }) {
  const content = lang === 'en'
    ? {
      historyTitle: 'ABOUT US',
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
      historyTitle: 'À PROPOS DE NOUS',
      historyParagraphs: [
        "C'est en 2010 que les frères Alexandre et Jonathan ont eu l'idée de commercialiser leur passion pour les oiseaux de basse-cour. Après l'achat d'un petit incubateur avec leurs économies, ils ont incubé et vendu des canetons et des poussins. L'année suivante, ils se sont procuré deux plus gros incubateurs et ont graduellement ajouté des oies, des cailles, des perdrix et des colins de Virginie à leurs troupeaux.",
        "Malgré le peu de gains financiers, la motivation reste, et la production augmente la saison d'après. En parallèle, un intérêt pour la grande culture se développe aussi.",
        "En 2012, les choses ont évolué. Seules les productions de canetons et de colins de Virginie continuent, et la distribution de poulettes prêtes à pondre a commencé. Les deux frères investissent aussi cette année-là dans l'achat d'une première terre agricole. Les débuts en grande culture sont difficiles, mais avec leur sœur qui prend en main le service à la clientèle, et en combinant travail à l'extérieur et beaucoup d'efforts sur la ferme, on parvient à joindre les deux bouts. La distribution de volailles se fait encore à Hemmingford mais aussi à Bristol, en Outaouais.",
        "Les années s'enchaînent avec des hauts et des bas; mais la progression est grande, et le même but reste d'établir une entreprise agricole performante à une époque où les coûts ont explosé. Frédérique a remplacé Josée-Anne au service à la clientèle; Les Fermes Soulard SENC n'offrent plus que des poules pondeuses et des poussins à chair.",
        "La grande qualité des volailles offertes a permis de développer un réseau important de clientèle, au Québec et en Ontario, distribuant des dizaines de milliers d'oiseaux annuellement; et les deux frères, maintenant avec chacun leur famille, ont déménagé en Outaouais et travaillent à temps plein sur la ferme. Un troupeau de moutons est aussi ajouté et, dès 2026, les agneaux feront partie des animaux vivants disponibles à l'achat. Le projet d'offrir des viandes fraîches est aussi sous étude!",
        "Les Fermes Soulard SENC est une entreprise familiale pour qui la qualité passe avant la quantité. Entreprise locale 100% québécoise, nous sommes fiers de ce que nous avons bâti, et remercions notre précieuse clientèle avec laquelle nous prévoyons évoluer pour les générations à venir."
      ]
    };

  return (
    <div className="about-page">
      <div className="about-content">
        <section className="about-history">
          <h2 className="about-subtitle">{content.historyTitle}</h2>
          <p className="about-paragraph">{content.historyParagraphs[0]}</p>

          <div className="about-image-container">
            <img
              src="/photos/IMG_0568.jpeg"
              alt="Farm poultry"
              className="about-inline-image"
              loading="eager"
              fetchPriority="low"
              decoding="async"
              width="480"
              height="360"
            />
          </div>

          <p className="about-paragraph">{content.historyParagraphs[1]}</p>
          
          <div className="about-image-container">
            <img
              src="/photos/96f64fdc5db3d6a3d3142fae033ddfe9-800.jpeg"
              alt="Farm operations"
              className="about-inline-image"
              loading="eager"
              fetchPriority="low"
              decoding="async"
              width="800"
              height="600"
            />
          </div>

          <p className="about-paragraph">{content.historyParagraphs[2]}</p>

          <div className="about-image-container">
            <img
              src="/photos/image000000-800.jpeg"
              alt="Farm fields"
              className="about-inline-image"
              loading="eager"
              fetchPriority="low"
              decoding="async"
              width="800"
              height="600"
            />
          </div>

          <p className="about-paragraph">{content.historyParagraphs[3]}</p>

          <div className="about-image-container">
            <img
              src="/photos/IMG_7625-800.jpeg"
              alt="Laying hens"
              className="about-inline-image"
              loading="eager"
              fetchPriority="low"
              decoding="async"
              width="800"
              height="600"
            />
          </div>

          <p className="about-paragraph">{content.historyParagraphs[4]}</p>

          <div className="about-image-container">
            <img
              src="/photos/IMG_9834-800.jpeg"
              alt="Family farm life"
              className="about-inline-image"
              loading="eager"
              fetchPriority="low"
              decoding="async"
              width="800"
              height="1067"
            />
          </div>

          <p className="about-paragraph">{content.historyParagraphs[5]}</p>
        </section>
      </div>
    </div>
  );
}
