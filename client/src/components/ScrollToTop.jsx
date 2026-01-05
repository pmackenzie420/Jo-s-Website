import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';

export default function ScrollToTop() {
    const { pathname } = useLocation();

    useEffect(() => {
        // Reset all potential scroll containers
        window.scrollTo(0, 0);
        document.body.scrollTop = 0; // For Safari/Chrome quirks with height: 100%
        document.documentElement.scrollTop = 0; // Standard
    }, [pathname]);

    return null;
}
