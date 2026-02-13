import { Suspense, lazy, useEffect, useState } from 'react';
import { Routes, Route } from 'react-router-dom';
import Layout from '../layouts/BoxedLayout';
import MainGate from '../components/MainGate';

const isChunkLoadError = (err) => {
  const message = err?.message || '';
  return (
    message.includes('Failed to fetch dynamically imported module') ||
    message.includes('Importing a module script failed') ||
    message.includes('Loading chunk') ||
    message.includes('ChunkLoadError')
  );
};

// If a deploy happens while a user has the SPA open, old chunk URLs can 404.
// Reloading once grabs the latest build and resolves the mismatch.
const lazyWithRetry = (importer) =>
  lazy(async () => {
    try {
      return await importer();
    } catch (err) {
      if (typeof window !== 'undefined' && isChunkLoadError(err)) {
        const key = 'jowebsite:chunk-reload-attempted';
        if (!window.sessionStorage.getItem(key)) {
          window.sessionStorage.setItem(key, '1');
          window.location.reload();
        }
      }
      throw err;
    }
  });

const Home = lazyWithRetry(() => import('../pages/Home'));
const Prices = lazyWithRetry(() => import('../pages/Prices'));
const Contact = lazyWithRetry(() => import('../pages/Contact'));
const Privacy = lazyWithRetry(() => import('../pages/Privacy'));
const Checkout = lazyWithRetry(() => import('../pages/Checkout'));
const Order = lazyWithRetry(() => import('../pages/Order'));
const Admin = lazyWithRetry(() => import('../pages/Admin'));
const Success = lazyWithRetry(() => import('../pages/Success'));

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
