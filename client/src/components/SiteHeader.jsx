import { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { LINKS } from '../constants/links';
import '../styles/components/SiteHeader.css';

// Content translations
const contentMap = {
    en: {
        alert: "Reservation required for any purchase.",
        nav_home: "HOME",
        nav_prices: "PRICE LIST",
        nav_order: "ORDER ONLINE",
        contact: "Contact us",
    },
    fr: {
        alert: "Réservation nécessaire pour tout achat.",
        nav_home: "ACCUEIL",
        nav_prices: "LISTE DE PRIX",
        nav_order: "COMMANDER",
        contact: "Contactez-nous",
    }
};

const MOBILE_STICKY_HIDE_SCROLL_Y = 260;
const MOBILE_STICKY_SLIDE_DISTANCE = 120;
const MOBILE_STICKY_PROGRESS_EPSILON = 0.01;

export default function SiteHeader({ lang, setLang }) {
    const t = contentMap[lang];
    const location = useLocation();
    const [isMenuOpen, setIsMenuOpen] = useState(false);
    const [mobileStickyState, setMobileStickyState] = useState({
        enabled: true,
        progress: 0
    });

    useEffect(() => {
        if (typeof window === 'undefined') {
            return;
        }

        const mediaQuery = window.matchMedia('(max-width: 800px)');
        const getDocumentScrollTop = () => {
            const scrollingElement = document.scrollingElement;
            return window.pageYOffset
                || window.scrollY
                || scrollingElement?.scrollTop
                || document.documentElement.scrollTop
                || document.body.scrollTop
                || 0;
        };

        const updateMobileStickyState = (scrollTop = getDocumentScrollTop()) => {
            if (!mediaQuery.matches) {
                setMobileStickyState((previousState) => (
                    previousState.enabled || previousState.progress !== 0
                        ? { enabled: false, progress: 0 }
                        : previousState
                ));
                return;
            }
            const slideProgress = Math.max(
                0,
                Math.min(
                    1,
                    (scrollTop - MOBILE_STICKY_HIDE_SCROLL_Y) / MOBILE_STICKY_SLIDE_DISTANCE
                )
            );
            const shouldDisableSticky = scrollTop >= (MOBILE_STICKY_HIDE_SCROLL_Y + MOBILE_STICKY_SLIDE_DISTANCE);
            const nextState = {
                enabled: !shouldDisableSticky,
                progress: slideProgress
            };

            setMobileStickyState((previousState) => {
                if (
                    previousState.enabled === nextState.enabled
                    && Math.abs(previousState.progress - nextState.progress) < MOBILE_STICKY_PROGRESS_EPSILON
                ) {
                    return previousState;
                }
                return nextState;
            });
        };

        const updateFromWindowScroll = () => {
            updateMobileStickyState(getDocumentScrollTop());
        };

        const updateFromCapturedScroll = (event) => {
            const target = event.target;
            const targetScrollTop = (
                target
                && target !== document
                && target !== document.documentElement
                && target !== document.body
                && typeof target.scrollTop === 'number'
            ) ? target.scrollTop : 0;

            updateMobileStickyState(Math.max(targetScrollTop, getDocumentScrollTop()));
        };

        updateFromWindowScroll();
        window.addEventListener('scroll', updateFromWindowScroll, { passive: true });
        document.addEventListener('scroll', updateFromCapturedScroll, true);
        window.addEventListener('resize', updateFromWindowScroll);
        window.addEventListener('orientationchange', updateFromWindowScroll);
        const intervalId = window.setInterval(updateFromWindowScroll, 150);

        const onMediaChange = () => updateFromWindowScroll();
        if (typeof mediaQuery.addEventListener === 'function') {
            mediaQuery.addEventListener('change', onMediaChange);
        } else {
            mediaQuery.addListener(onMediaChange);
        }

        return () => {
            window.removeEventListener('scroll', updateFromWindowScroll);
            document.removeEventListener('scroll', updateFromCapturedScroll, true);
            window.removeEventListener('resize', updateFromWindowScroll);
            window.removeEventListener('orientationchange', updateFromWindowScroll);
            window.clearInterval(intervalId);
            if (typeof mediaQuery.removeEventListener === 'function') {
                mediaQuery.removeEventListener('change', onMediaChange);
            } else {
                mediaQuery.removeListener(onMediaChange);
            }
        };
    }, []);

    useEffect(() => {
        if (!mobileStickyState.enabled) {
            setIsMenuOpen(false);
        }
    }, [mobileStickyState.enabled]);

    // Check if link is active
    const isActive = (path) => location.pathname === path ? 'active' : '';

    const handleNavClick = () => {
        setIsMenuOpen(false);
    };

    return (
        <header
            className={`site-header ${mobileStickyState.enabled ? 'mobile-sticky-enabled' : ''}`}
            style={{ '--mobile-sticky-progress': mobileStickyState.progress }}
        >
            {/* ROW 1: GREEN BAR with Language Selector (Left) */}
            <div className="green-top-bar">
                <div className="green-bar-content">
                    <div className="lang-toggle">
                        <button
                            type="button"
                            onClick={() => setLang('en')}
                            className={`lang-toggle-button ${lang === 'en' ? 'active' : ''}`}
                            aria-pressed={lang === 'en'}
                        >
                            EN
                        </button>
                        {' | '}
                        <button
                            type="button"
                            onClick={() => setLang('fr')}
                            className={`lang-toggle-button ${lang === 'fr' ? 'active' : ''}`}
                            aria-pressed={lang === 'fr'}
                        >
                            FR
                        </button>
                    </div>
                    <div className="mobile-contact">
                        <Link to="/contact" className="mobile-contact-link">
                            {t.contact}
                        </Link>
                    </div>
                </div>
            </div>

            {/* ROW 2: WHITE HEADER with Logo (Left) and Contact Info (Right) */}
            <div className="white-header">
                <div className="white-header-content">
                    {/* Logo Left */}
                    <Link to="/" className="logo-link">
                        <img src="/LOGO.png" alt="Les Fermes Soulard S.E.N.C." className="header-logo" />
                    </Link>

                    <button
                        className="menu-toggle"
                        type="button"
                        aria-label="Toggle navigation menu"
                        aria-expanded={isMenuOpen}
                        aria-controls="mobile-menu"
                        onClick={() => setIsMenuOpen((open) => !open)}
                    >
                        <span className="menu-bar" />
                        <span className="menu-bar" />
                        <span className="menu-bar" />
                    </button>

                    {/* Contact Info Right */}
                    <div className="contact-section">
                        <div className="contact-details">
                            <a href="tel:8197700070" className="contact-phone">(819) 770-0070</a>
                            <a href="mailto:lesfermessoulard@gmail.com" className="contact-email">lesfermessoulard@gmail.com</a>
                            <a
                                href={LINKS.maps.bristol}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="contact-address"
                            >
                                84 Rte 148, Bristol, QC
                            </a>
                        </div>
                        <a
                            href={LINKS.facebook}
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

            <div id="mobile-menu" className={`mobile-menu ${isMenuOpen ? 'open' : ''}`}>
                <nav className="mobile-nav-links">
                    <Link to="/" className={`nav-link mobile-nav-link ${isActive('/')}`} onClick={handleNavClick}>{t.nav_home}</Link>
                    <Link to="/prices" className={`nav-link mobile-nav-link ${isActive('/prices')}`} onClick={handleNavClick}>{t.nav_prices}</Link>
                    <Link to="/order" className={`nav-link mobile-nav-link ${isActive('/order')}`} onClick={handleNavClick}>{t.nav_order}</Link>
                </nav>
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
