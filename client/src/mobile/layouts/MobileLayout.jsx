import { Outlet } from 'react-router-dom';
import MobileFooter from '../components/MobileFooter';
import MobileHeader from '../components/MobileHeader';

export default function MobileLayout({ lang, setLang }) {
  return (
    <div className="mobile-shell">
      <MobileHeader lang={lang} setLang={setLang} />
      <main className="mobile-main">
        <Outlet />
      </main>
      <MobileFooter />
    </div>
  );
}
