import { useState } from 'react';
import { Routes, Route } from 'react-router-dom';
import Layout from '../layouts/BoxedLayout';
import MainGate from '../components/MainGate';
import Home from '../pages/Home';
import Prices from '../pages/Prices';
import Contact from '../pages/Contact';
import Privacy from '../pages/Privacy';
import Checkout from '../pages/Checkout';
import Order from '../pages/Order';
import Admin from '../pages/Admin';
import Success from '../pages/Success';

export default function DesktopApp() {
  const [lang, setLang] = useState('fr');

  return (
    <Routes>
      <Route element={(
        <MainGate>
          <Layout lang={lang} setLang={setLang} />
        </MainGate>
      )}>
        <Route path="/" element={<Home lang={lang} />} />
        <Route path="/prices" element={<Prices lang={lang} />} />
        <Route path="/contact" element={<Contact />} />
        <Route path="/privacy" element={<Privacy />} />
        <Route path="/order" element={<Order lang={lang} />} />
        <Route path="/checkout" element={<Checkout lang={lang} />} />
        <Route path="/success" element={<Success />} />
      </Route>

      <Route path="/admin" element={<Admin />} />
    </Routes>
  );
}
