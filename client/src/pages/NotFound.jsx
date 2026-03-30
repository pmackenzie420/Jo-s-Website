import { Link } from 'react-router-dom';
import '../styles/pages/NotFound.css';

const COPY = {
  en: {
    title: 'Page not found',
    body: 'The page you requested is unavailable.',
    primaryCta: 'Return home',
    secondaryCta: 'View prices'
  },
  fr: {
    title: 'Page introuvable',
    body: 'La page demandee est indisponible.',
    primaryCta: "Retour a l'accueil",
    secondaryCta: 'Voir les prix'
  }
};

export default function NotFound({ lang }) {
  const copy = lang === 'en' ? COPY.en : COPY.fr;

  return (
    <div className="not-found-container">
      <h1 className="not-found-title">{copy.title}</h1>
      <p className="not-found-body">{copy.body}</p>
      <div className="not-found-actions">
        <Link to="/" className="not-found-primary">
          {copy.primaryCta}
        </Link>
        <Link to="/prices" className="not-found-secondary">
          {copy.secondaryCta}
        </Link>
      </div>
    </div>
  );
}
