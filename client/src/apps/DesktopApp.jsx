import { Suspense, lazy, useEffect, useState } from 'react';
import { Routes, Route } from 'react-router-dom';
import Layout from '../layouts/BoxedLayout';
import MainGate from '../components/MainGate';
import SeoManager from '../components/SeoManager';
import Home from '../pages/Home';
import Prices from '../pages/Prices';
import Contact from '../pages/Contact';
import Privacy from '../pages/Privacy';
import Order from '../pages/Order';
import NotFound from '../pages/NotFound';

const MISSING_DEFAULT_CHUNK_CODE = 'JO_LAZY_MODULE_DEFAULT_MISSING';

const isChunkLoadError = (err) => {
  if (err?.code === MISSING_DEFAULT_CHUNK_CODE) return true;
  const message = String(err?.message || '').toLowerCase();
  return (
    message.includes('failed to fetch dynamically imported module') ||
    message.includes('importing a module script failed') ||
    message.includes('loading chunk') ||
    message.includes('chunkloaderror') ||
    message.includes('load failed')
  );
};

const createMissingDefaultChunkError = () => {
  const error = new Error('Lazy-loaded module is missing a default export.');
  error.name = 'ChunkLoadError';
  error.code = MISSING_DEFAULT_CHUNK_CODE;
  return error;
};

// If a deploy happens while a user has the SPA open, old chunk URLs can 404.
// Reloading once grabs the latest build and resolves the mismatch.
const lazyWithRetry = (importer) =>
  lazy(async () => {
    try {
      const loadedModule = await importer();
      if (!loadedModule || typeof loadedModule.default === 'undefined') {
        throw createMissingDefaultChunkError();
      }
      return loadedModule;
    } catch (err) {
      if (typeof window !== 'undefined' && isChunkLoadError(err)) {
        const key = 'jowebsite:chunk-reload-attempted';
        try {
          if (!window.sessionStorage.getItem(key)) {
            window.sessionStorage.setItem(key, '1');
            window.location.reload();
          }
        } catch { /* storage blocked */ }
      }
      throw err;
    }
  });

const Checkout = lazyWithRetry(() => import('../pages/Checkout'));
const Admin = lazyWithRetry(() => import('../pages/Admin'));
const Success = lazyWithRetry(() => import('../pages/Success'));

export default function DesktopApp() {
  const [lang, setLang] = useState(() => {
    if (typeof window === 'undefined') {
      return 'fr';
    }
    try {
      const stored = window.localStorage.getItem('site-lang');
      return stored === 'en' || stored === 'fr' ? stored : 'fr';
    } catch { return 'fr'; }
  });

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }
    try { window.localStorage.setItem('site-lang', lang); } catch { /* storage blocked */ }
  }, [lang]);

  return (
    <Suspense fallback={null}>
      <SeoManager lang={lang} />
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
          <Route path="*" element={<NotFound lang={lang} />} />
        </Route>

        <Route path="/admin" element={<Admin />} />
      </Routes>
    </Suspense>
  );
}
