import { LINKS } from '../../constants/links';

export default function MobileFooter() {
  return (
    <footer className="mobile-footer">
      <img src="/logo_white.png" alt="Les Fermes Soulard" className="mobile-footer-logo" />
      <a
        href={LINKS.facebook}
        target="_blank"
        rel="noopener noreferrer"
        className="mobile-footer-facebook"
        aria-label="Facebook"
      >
        <svg xmlns="http://www.w3.org/2000/svg" width="42" height="42" viewBox="0 0 48 48">
          <circle cx="24" cy="24" r="24" fill="#1877f2" />
          <path d="M27.5 23.5v14h-6V23.5h-4.3V18h4.3v-3c0-4.2 2.5-6.5 6.3-6.5 1.8 0 3.3.1 3.8.2v4.4h-2.6c-2 0-2.4 1-2.4 2.4v3.1h4.9l-.6 5h-4.3z" fill="#fff" />
        </svg>
      </a>
      <a
        href={LINKS.maps.hemmingford}
        target="_blank"
        rel="noopener noreferrer"
        className="mobile-footer-link"
      >
        315 ch. Back Bush, Hemmingford
      </a>
    </footer>
  );
}
