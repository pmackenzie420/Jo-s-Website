import { useState } from 'react';
import { Routes, Route } from 'react-router-dom';
import Layout from './BoxedLayout';
//import Layout from './Layout';
import Home from './Home';
import Prices from './Prices';
import Order from './Order';
import Admin from './Admin';

function App() {
  // Master Language State (Lifted Up)
  const [lang, setLang] = useState('fr');

  return (
    <Routes>
      {/* WRAPPER ROUTE: Applies Header/Nav to everything inside */}
      <Route element={<Layout lang={lang} setLang={setLang} />}>
        <Route path="/" element={<Home lang={lang} />} />
        <Route path="/prices" element={<Prices lang={lang} />} />
        <Route path="/order" element={<Order lang={lang} />} />
      </Route>
      
      {/* ADMIN IS SEPARATE (No Header) */}
      <Route path="/admin" element={<Admin />} />
    </Routes>
  );
}

export default App;
