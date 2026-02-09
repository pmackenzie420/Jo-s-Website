import { Suspense, lazy, useEffect, useState } from 'react';
import { Routes, Route } from 'react-router-dom';
import Layout from '../layouts/BoxedLayout';
import MainGate from '../components/MainGate';

const Home = lazy(() => import('../pages/Home'));
const Prices = lazy(() => import('../pages/Prices'));
const Contact = lazy(() => import('../pages/Contact'));
const Privacy = lazy(() => import('../pages/Privacy'));
const Checkout = lazy(() => import('../pages/Checkout'));
const Order = lazy(() => import('../pages/Order'));
const Admin = lazy(() => import('../pages/Admin'));
const Success = lazy(() => import('../pages/Success'));

export default function DesktopApp() {
  const [lang, setLang] = useState(() => {
    if (typeof window === 'undefined') {
      return 'fr';
    }
    const stored = window.localStorage.getItem('site-lang');
    return stored === 'en' || stored === 'fr' ? stored : 'fr';
  });

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }
    window.localStorage.setItem('site-lang', lang);
  }, [lang]);

  return (
    <Suspense fallback={null}>
      <Routes>
        <Route element={(
          <MainGate lang={lang}>
            <Layout lang={lang} setLang={setLang} />
          </MainGate>
        )}>
          <Route path="/" element={<Home lang={lang} />} />
          <Route path="/prices" element={<Prices lang={lang} />} />
          <Route path="/contact" element={<Contact lang={lang} />} />
          <Route path="/privacy" element={<Privacy lang={lang} />} />
          <Route path="/order" element={<Order lang={lang} />} />
          <Route path="/checkout" element={<Checkout lang={lang} />} />
          <Route path="/success" element={<Success lang={lang} />} />
        </Route>

        <Route path="/admin" element={<Admin />} />
      </Routes>
    </Suspense>
  );
}
