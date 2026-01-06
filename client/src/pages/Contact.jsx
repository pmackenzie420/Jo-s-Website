import { LINKS } from '../constants/links';
import '../styles/pages/Contact.css';

export default function Contact() {
  return (
    <div className="contact-container">
      <h1 className="contact-title">Contact Us</h1>
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
          href={LINKS.maps.hemmingford}
          target="_blank"
          rel="noopener noreferrer"
          className="contact-link"
        >
          315 ch. Back Bush, Hemmingford, Qc
        </a>
      </p>
    </div>
  );
}
