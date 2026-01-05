import { useState } from 'react';
import { Routes, Route } from 'react-router-dom';
import Layout from '../layouts/BoxedLayout';
import Home from '../pages/Home';
import Prices from '../pages/Prices';
import Checkout from '../pages/Checkout';
import Order from '../pages/Order';
import Admin from '../pages/Admin';
import Success from '../pages/Success';

export default function DesktopApp() {
  const [lang, setLang] = useState('fr');

  return (
    <Routes>
      <Route element={<Layout lang={lang} setLang={setLang} />}>
        <Route path="/" element={<Home lang={lang} />} />
        <Route path="/prices" element={<Prices lang={lang} />} />
        <Route path="/order" element={<Order lang={lang} />} />
        <Route path="/checkout" element={<Checkout lang={lang} />} />
        <Route path="/success" element={<Success />} />
      </Route>

      <Route path="/admin" element={<Admin />} />
    </Routes>
  );
}
