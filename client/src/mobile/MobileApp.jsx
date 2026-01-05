import { useState } from 'react';
import { Routes, Route } from 'react-router-dom';
import MobileLayout from './layouts/MobileLayout';
import Home from './pages/Home';
import Prices from './pages/Prices';
import Order from './pages/Order';
import Checkout from './pages/Checkout';
import Success from './pages/Success';
import Admin from './pages/Admin';
import './styles/mobile.css';

export default function MobileApp() {
  const [lang, setLang] = useState('fr');

  return (
    <Routes>
      <Route element={<MobileLayout lang={lang} setLang={setLang} />}>
        <Route path="/" element={<Home lang={lang} />} />
        <Route path="/prices" element={<Prices lang={lang} />} />
        <Route path="/order" element={<Order lang={lang} />} />
        <Route path="/checkout" element={<Checkout lang={lang} />} />
        <Route path="/success" element={<Success lang={lang} />} />
      </Route>
      <Route path="/admin" element={<Admin lang={lang} />} />
    </Routes>
  );
}
