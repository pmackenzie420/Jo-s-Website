import '../styles/pages/Privacy.css';

const COPY = {
  en: {
    title: 'Privacy Policy',
    intro: 'We respect your privacy and are committed to protecting your personal information.',
    infoTitle: 'Information We Collect',
    infoIntro: 'When you place an order or contact us, we may collect the following information:',
    infoList: [
      'Name',
      'Email address',
      'Phone number',
      'Address',
      'Order details (such as quantity and pickup date)'
    ],
    infoFooter:
      'We only collect information that is necessary to process and fulfill your order and to communicate with you about it.',
    useTitle: 'How We Use Your Information',
    useIntro: 'Your information is used to:',
    useList: [
      'Process and manage orders',
      'Communicate order confirmations, pickup details, or changes',
      'Provide customer support'
    ],
    useFooter: 'We do not sell, rent, or trade your personal information.',
    emailTitle: 'Emails',
    emailBody:
      'We send transactional emails such as order confirmations and pickup notifications as part of fulfilling your order. Marketing or promotional emails are only sent if you explicitly opt in. You may unsubscribe from marketing emails at any time, and unsubscribing does not affect transactional emails related to your orders.',
    securityTitle: 'Data Storage and Security',
    securityBody:
      'Your information is stored securely using reputable third-party services and is accessible only to the business owner and authorized personnel. Reasonable safeguards are used to protect personal information from unauthorized access or disclosure.',
    retentionTitle: 'Data Retention',
    retentionBody:
      'We retain personal information only as long as necessary for order fulfillment, record keeping, and legal or accounting purposes. Information may be deleted or anonymized upon request, subject to legal requirements.',
    rightsTitle: 'Your Rights',
    rightsBody:
      'You may request access to, correction of, or deletion of your personal information at any time by contacting us.',
    contactTitle: 'Contact',
    contactBody:
      'If you have questions about this privacy policy or how your personal information is handled, please contact:'
  },
  fr: {
    title: 'Politique de confidentialit\u00e9',
    intro: 'Nous respectons votre vie priv\u00e9e et nous nous engageons \u00e0 prot\u00e9ger vos renseignements personnels.',
    infoTitle: 'Renseignements que nous recueillons',
    infoIntro: "Lorsque vous passez une commande ou nous contactez, nous pouvons recueillir les informations suivantes :",
    infoList: [
      'Nom',
      'Adresse courriel',
      'Num\u00e9ro de t\u00e9l\u00e9phone',
      'Adresse',
      'D\u00e9tails de la commande (comme la quantit\u00e9 et la date de ramassage)'
    ],
    infoFooter:
      'Nous ne recueillons que les informations n\u00e9cessaires pour traiter et ex\u00e9cuter votre commande et communiquer avec vous \u00e0 son sujet.',
    useTitle: 'Comment nous utilisons vos renseignements',
    useIntro: 'Vos renseignements servent \u00e0 :',
    useList: [
      'Traiter et g\u00e9rer les commandes',
      'Communiquer les confirmations de commande, les d\u00e9tails de ramassage ou les changements',
      'Offrir du soutien \u00e0 la client\u00e8le'
    ],
    useFooter: "Nous ne vendons, ne louons ni n'\u00e9changeons vos renseignements personnels.",
    emailTitle: 'Courriels',
    emailBody:
      'Nous envoyons des courriels transactionnels, comme les confirmations de commande et les avis de ramassage, dans le cadre de l\u2019ex\u00e9cution de votre commande. Les courriels marketing ou promotionnels sont envoy\u00e9s uniquement si vous vous y inscrivez explicitement. Vous pouvez vous d\u00e9sabonner des courriels marketing en tout temps, et cela n\u2019affecte pas les courriels transactionnels li\u00e9s \u00e0 vos commandes.',
    securityTitle: 'Stockage et s\u00e9curit\u00e9 des donn\u00e9es',
    securityBody:
      'Vos renseignements sont conserv\u00e9s de fa\u00e7on s\u00e9curitaire \u00e0 l\u2019aide de services tiers r\u00e9put\u00e9s et ne sont accessibles qu\u2019au propri\u00e9taire de l\u2019entreprise et au personnel autoris\u00e9. Des mesures raisonnables sont mises en place pour prot\u00e9ger les renseignements personnels contre l\u2019acc\u00e8s ou la divulgation non autoris\u00e9s.',
    retentionTitle: 'Conservation des donn\u00e9es',
    retentionBody:
      'Nous conservons les renseignements personnels uniquement le temps n\u00e9cessaire pour l\u2019ex\u00e9cution des commandes, la tenue de dossiers et les exigences l\u00e9gales ou comptables. Les renseignements peuvent \u00eatre supprim\u00e9s ou anonymis\u00e9s sur demande, sous r\u00e9serve des exigences l\u00e9gales.',
    rightsTitle: 'Vos droits',
    rightsBody:
      'Vous pouvez demander l\u2019acc\u00e8s, la correction ou la suppression de vos renseignements personnels en tout temps en nous contactant.',
    contactTitle: 'Contact',
    contactBody:
      "Si vous avez des questions au sujet de cette politique de confidentialit\u00e9 ou sur la fa\u00e7on dont vos renseignements personnels sont trait\u00e9s, veuillez contacter :"
  }
};

export default function Privacy({ lang }) {
  const copy = lang === 'fr' ? COPY.fr : COPY.en;
  return (
    <div className="privacy-container">
      <h1 className="privacy-title">{copy.title}</h1>
      <p className="privacy-text">{copy.intro}</p>

      <h2 className="privacy-subtitle">{copy.infoTitle}</h2>
      <p className="privacy-text">{copy.infoIntro}</p>
      <ul className="privacy-list">
        {copy.infoList.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
      <p className="privacy-text">{copy.infoFooter}</p>

      <h2 className="privacy-subtitle">{copy.useTitle}</h2>
      <p className="privacy-text">{copy.useIntro}</p>
      <ul className="privacy-list">
        {copy.useList.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
      <p className="privacy-text">{copy.useFooter}</p>

      <h2 className="privacy-subtitle">{copy.emailTitle}</h2>
      <p className="privacy-text">{copy.emailBody}</p>

      <h2 className="privacy-subtitle">{copy.securityTitle}</h2>
      <p className="privacy-text">{copy.securityBody}</p>

      <h2 className="privacy-subtitle">{copy.retentionTitle}</h2>
      <p className="privacy-text">{copy.retentionBody}</p>

      <h2 className="privacy-subtitle">{copy.rightsTitle}</h2>
      <p className="privacy-text">{copy.rightsBody}</p>

      <h2 className="privacy-subtitle">{copy.contactTitle}</h2>
      <p className="privacy-text">{copy.contactBody}</p>
      <p className="privacy-text">Les Fermes Soulard S.E.N.C.</p>
      <p className="privacy-text">lesfermessoulard@gmail.com</p>
      <p className="privacy-text">84 Rte 148, Bristol, QC</p>
    </div>
  );
}
