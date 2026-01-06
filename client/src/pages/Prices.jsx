import './../styles/pages/Prices.css';

export default function Prices({ lang }) {
  // --- CONTENT DICTIONARY ---
  const content = {
    en: {
      title: "2026 PRICE LIST",
      pickup_header: "Two locations to serve you",
      pickup_warn: "IMPORTANT: You must specify the desired pick-up location!",

      // Hens Table
      hen_title: "READY-TO-LAY HENS",
      hen_sub: "Brown Lohmann: 19 weeks-old",
      col_qty: "Quantity",
      col_price: "Price",

      // Meat Table
      meat_title: "MEAT CHICKEN",
      meat_sub: "Ross, White",
      meat_col_qty: "Qty", // Abbreviated as requested
      meat_col_price: "Price",
      meat_footer: "Availability: May and June",

      unit: "ea."
    },
    fr: {
      title: "LISTE DE PRIX 2026",
      pickup_header: "Deux emplacements pour vous servir",
      pickup_warn: "ATTENTION: vous devez préciser le lieu de ramassage souhaité!",

      // Hens Table
      hen_title: "POULES PRÊTES À PONDRE",
      hen_sub: "Lohmann brunes : 19 semaines",
      col_qty: "Quantité",
      col_price: "Prix",

      // Meat Table
      meat_title: "POULETS À CHAIR",
      meat_sub: "Ross, blanc",
      meat_col_qty: "Qt", // Abbreviated as requested
      meat_col_price: "Prix",
      meat_footer: "Disponibilité: mai et juin",

      unit: "ch."
    }
  };

  const t = content[lang];

  return (
    <div className="container prices-container">

      <h2 className="prices-title">
        {t.title}
      </h2>

      {/* --- PART A: PICKUP LOCATIONS BOX --- */}
      <div className="pickup-box">
        <h3 className="pickup-header">
          {t.pickup_header}
        </h3>

        <div className="locations-container">
          <div className="location-item">
            <strong>Montérégie</strong>
            <span>315 Back Bush, Hemmingford, Qc J0L 1H0</span>
          </div>
          <div className="location-item">
            <strong>Outaouais</strong>
            <span>84 Rte 148, Bristol, Qc J0X 1G0</span>
          </div>
        </div>
      </div>

      {/* --- PART B & C: TABLES CONTAINER --- */}
      <div className="tables-container">

        {/* TABLE 1: HENS (LEFT) */}
        <div className="price-table-container">
          <table className="price-table">
            <thead>
              <tr>
                <th colSpan="2">{t.hen_title}</th>
              </tr>
              <tr>
                <th colSpan="2">{t.hen_sub}</th>
              </tr>
              <tr>
                <th>{t.col_qty}</th>
                <th>{t.col_price}</th>
              </tr>
            </thead>
            <tbody>
              <tr><td>50+</td><td>$14.00 {t.unit}</td></tr>
              <tr><td>13 - 49</td><td>$15.25 {t.unit}</td></tr>
              <tr><td>6 - 12</td><td>$17.00 {t.unit}</td></tr>
              <tr><td>1 - 5</td><td>$17.50 {t.unit}</td></tr>
            </tbody>
          </table>
        </div>

        {/* TABLE 2: MEAT (RIGHT) */}
        <div className="price-table-container">
          <table className="price-table">
            <thead>
              <tr>
                <th colSpan="2">{t.meat_title}</th>
              </tr>
              <tr>
                <th colSpan="2">{t.meat_sub}</th>
              </tr>
              <tr>
                <th>{t.meat_col_qty}</th>
                <th>{t.meat_col_price}</th>
              </tr>
            </thead>
            <tbody>
              <tr><td>300+</td><td>$2.15 {t.unit}</td></tr>
              <tr><td>100 - 299</td><td>$2.30 {t.unit}</td></tr>
              <tr><td>49 - 99</td><td>$2.50 {t.unit}</td></tr>
              <tr><td>25 - 49</td><td>$2.60 {t.unit}</td></tr>
            </tbody>
          </table>

          <p className="meat-footer">
            {t.meat_footer}
          </p>
        </div>

      </div>
    </div>
  );
}
