import './../styles/pages/Prices.css';

export default function Prices({ lang }) {
  // --- CONTENT DICTIONARY ---
  const content = {
    en: {
      title: "2026 PRICE LIST",
      pickup_header: "Two locations to serve you",
      pickup_warn: "IMPORTANT: You must specify the desired pick-up location!",

      // Hens shared
      hens_group_title: "READY-TO-LAY HENS",
      white_hen_title: "WHITE LOHMANN: 19 weeks old",
      hen_title: "BROWN LOHMANN: 19 weeks old",
      col_qty: "Quantity",
      col_price: "Price",

      // Meat Table
      meat_title: "MEAT CHICKEN: Ross, White",
      meat_col_qty: "Qty",
      meat_col_price: "Price",
      meat_footer: "Availability: May and June",

      // Lamb Table
      lamb_title: "LIVE LAMBS: Alfalfa-fed",
      lamb_footer: "Deposit only — final price by weight at pickup",
      lamb_specs: "$5.00/lb, 75–90 lb each. Please contact us if you're ordering ewes for breeding.",

      unit: "ea."
    },
    fr: {
      title: "LISTE DE PRIX 2026",
      pickup_header: "Deux emplacements pour vous servir",
      pickup_warn: "ATTENTION: vous devez préciser le lieu de ramassage souhaité!",

      // Hens shared
      hens_group_title: "POULES PRÊTES À PONDRE",
      white_hen_title: "LOHMANN BLANCHES : 19 semaines",
      hen_title: "LOHMANN BRUNES : 19 semaines",
      col_qty: "Quantité",
      col_price: "Prix",

      // Meat Table
      meat_title: "POULETS À CHAIR : Ross, blanc",
      meat_col_qty: "Qt",
      meat_col_price: "Prix",
      meat_footer: "Disponibilité : mai et juin",

      // Lamb Table
      lamb_title: "AGNEAU VIVANT : Élevé à la luzerne",
      lamb_footer: "Dépôt seulement — prix final au poids au ramassage",
      lamb_specs: "$5,00/lb, 75 à 90 lb chacun. Veuillez nous contacter si vous commandez des brebis pour la reproduction.",

      unit: "ch."
    }
  };

  const t = content[lang];

  return (
    <div className="prices-container">

      <h2 className="prices-title">
        {t.title}
      </h2>

      {/* --- PART A: PICKUP LOCATIONS BOX --- */}
      <div className="pickup-box">
        <h3 className="pickup-header">
          {t.pickup_header}
        </h3>

        <div className="locations-container">
          <div className="location-item location-item--outaouais">
            <strong>Outaouais</strong>
            <span className="location-address">84 Rte 148, Bristol, Qc J0X 1G0</span>
          </div>
          <div className="location-item">
            <strong>Montérégie</strong>
            <span>315 Back Bush, Hemmingford, Qc J0L 1H0</span>
          </div>
        </div>
      </div>

      {/* --- HENS GROUP (shared title on desktop) --- */}
      <div className="tables-section">
        <h3 className="tables-group-title">{t.hens_group_title}</h3>
        <div className="tables-container">
          <div className="price-table-container">
            <table className="price-table">
              <thead>
                <tr><th colSpan="2">{t.white_hen_title}</th></tr>
                <tr><th>{t.col_qty}</th><th>{t.col_price}</th></tr>
              </thead>
              <tbody>
                <tr><td>50+</td><td>$14.60 {t.unit}</td></tr>
                <tr><td>13 - 49</td><td>$16.00 {t.unit}</td></tr>
                <tr><td>6 - 12</td><td>$17.75 {t.unit}</td></tr>
                <tr><td>1 - 5</td><td>$18.25 {t.unit}</td></tr>
              </tbody>
            </table>
          </div>

          <div className="price-table-container">
            <table className="price-table">
              <thead>
                <tr><th colSpan="2">{t.hen_title}</th></tr>
                <tr><th>{t.col_qty}</th><th>{t.col_price}</th></tr>
              </thead>
              <tbody>
                <tr><td>50+</td><td>$14.60 {t.unit}</td></tr>
                <tr><td>13 - 49</td><td>$16.00 {t.unit}</td></tr>
                <tr><td>6 - 12</td><td>$17.75 {t.unit}</td></tr>
                <tr><td>1 - 5</td><td>$18.25 {t.unit}</td></tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* --- MEAT CHICKEN --- */}
      <div className="tables-section">
        <div className="tables-container">
          <div className="price-table-container">
            <table className="price-table">
              <thead>
                <tr><th colSpan="2">{t.meat_title}</th></tr>
                <tr><th>{t.meat_col_qty}</th><th>{t.meat_col_price}</th></tr>
              </thead>
              <tbody>
                <tr><td>300+</td><td>$2.25 {t.unit}</td></tr>
                <tr><td>100 - 299</td><td>$2.40 {t.unit}</td></tr>
                <tr><td>50 - 99</td><td>$2.60 {t.unit}</td></tr>
                <tr><td>25 - 49</td><td>$2.75 {t.unit}</td></tr>
              </tbody>
            </table>
            <p className="meat-footer">{t.meat_footer}</p>
          </div>

          <div className="price-table-container">
            <table className="price-table">
              <thead>
                <tr><th colSpan="2">{t.lamb_title}</th></tr>
                <tr><th>{t.col_qty}</th><th>{t.col_price}</th></tr>
              </thead>
              <tbody>
                <tr><td>1+</td><td>$100.00 {t.unit} (dépôt / deposit)</td></tr>
              </tbody>
            </table>
            <p className="meat-footer">{t.lamb_footer}</p>
            <p className="meat-footer">{t.lamb_specs}</p>
          </div>
        </div>
      </div>
    </div>
  );
}
