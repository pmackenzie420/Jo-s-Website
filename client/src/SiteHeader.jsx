import { Link, useLocation } from 'react-router-dom';
import './SiteHeader.css';

// Facebook page URL
const FB_URL = "https://www.facebook.com/profile.php?id=100057648781893";

// Content translations
const contentMap = {
    en: {
        alert: "Reservation required for any purchase.",
        nav_home: "HOME",
        nav_prices: "PRICE LIST",
        nav_order: "ORDER ONLINE",
    },
    fr: {
        alert: "Réservation nécessaire pour tout achat.",
        nav_home: "ACCUEIL",
        nav_prices: "LISTE DE PRIX",
        nav_order: "COMMANDER",
    }
};

export default function SiteHeader({ lang, setLang }) {
    const t = contentMap[lang];
    const location = useLocation();

    // Check if link is active
    const isActive = (path) => location.pathname === path ? 'active' : '';

    return (
        <header className="site-header">
            {/* ROW 1: GREEN BAR with Language Selector (Left) */}
            <div className="green-top-bar">
                <div className="green-bar-content">
                    <div className="lang-toggle">
                        <span
                            onClick={() => setLang('en')}
                            className={lang === 'en' ? 'active' : ''}
                        >
                            EN
                        </span>
                        {' | '}
                        <span
                            onClick={() => setLang('fr')}
                            className={lang === 'fr' ? 'active' : ''}
                        >
                            FR
                        </span>
                    </div>
                </div>
            </div>

            {/* ROW 2: WHITE HEADER with Logo (Left) and Contact Info (Right) */}
            <div className="white-header">
                <div className="white-header-content">
                    {/* Logo Left */}
                    <Link to="/" className="logo-link">
                        <img src="/logo.png" alt="Les Fermes Soulard S.E.N.C." className="header-logo" />
                    </Link>

                    {/* Contact Info Right */}
                    <div className="contact-section">
                        <div className="contact-details">
                            <a href="tel:8197700070" className="contact-phone">(819) 770-0070</a>
                            <a href="mailto:lesfermessoulard@gmail.com" className="contact-email">lesfermessoulard@gmail.com</a>
                            <span className="contact-address">315 ch. Back Bush, Hemmingford, Qc</span>
                        </div>
                        <a
                            href={FB_URL}
                            target="_blank"
                            rel="noopener noreferrer"
                            aria-label="Facebook"
                            className="fb-icon-header"
                        >
                            <svg xmlns="http://www.w3.org/2000/svg" width="50" height="50" viewBox="0 0 48 48">
                                <circle cx="24" cy="24" r="24" fill="#1877f2" />
                                <path d="M27.5 23.5v14h-6V23.5h-4.3V18h4.3v-3c0-4.2 2.5-6.5 6.3-6.5 1.8 0 3.3.1 3.8.2v4.4h-2.6c-2 0-2.4 1-2.4 2.4v3.1h4.9l-.6 5h-4.3z" fill="#fff" />
                            </svg>
                        </a>
                    </div>
                </div>
            </div>

            {/* ROW 3: BROWN NAVIGATION BAR */}
            <nav className="brown-nav-bar">
                <div className="brown-nav-content">
                    <Link to="/" className={`nav-link ${isActive('/')}`}>{t.nav_home}</Link>
                    <Link to="/prices" className={`nav-link ${isActive('/prices')}`}>{t.nav_prices}</Link>
                    <Link to="/order" className={`nav-link ${isActive('/order')}`}>{t.nav_order}</Link>
                </div>
            </nav>
        </header>
    );
}
