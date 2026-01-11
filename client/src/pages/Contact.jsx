import { LINKS } from '../constants/links';
import '../styles/pages/Contact.css';

const COPY = {
  en: {
    title: 'Contact Us'
  },
  fr: {
    title: 'Contactez-nous'
  }
};

export default function Contact({ lang }) {
  const copy = lang === 'fr' ? COPY.fr : COPY.en;
  return (
    <div className="contact-container">
      <h1 className="contact-title">{copy.title}</h1>
      <p className="contact-text">Les Fermes Soulard S.E.N.C.</p>
      <p className="contact-text">
        <a href="tel:8197700070" className="contact-link">
          (819) 770-0070
        </a>
      </p>
      <p className="contact-text">
        <a href="mailto:lesfermessoulard@gmail.com" className="contact-link">
          lesfermessoulard@gmail.com
        </a>
      </p>
      <p className="contact-text">
        <a
          href={LINKS.maps.bristol}
          target="_blank"
          rel="noopener noreferrer"
          className="contact-link"
        >
          84 Rte 148, Bristol, QC
        </a>
      </p>
    </div>
  );
}
