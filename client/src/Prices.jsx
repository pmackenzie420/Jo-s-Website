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
    <div className="container" style={{ maxWidth: '1024px', margin: '40px auto', padding: '0 20px' }}>

      <h2 style={{ textAlign: 'center', marginBottom: '40px', fontSize: '2rem', letterSpacing: '2px' }}>
        {t.title}
      </h2>

      {/* --- PART A: PICKUP LOCATIONS BOX --- */}
      <div style={{
        border: '1px solid black',
        padding: '30px',
        marginBottom: '50px',
        textAlign: 'center',
        backgroundColor: 'white'
      }}>
        <h3 style={{ textTransform: 'uppercase', margin: '0 0 30px 0', fontSize: '1.4rem' }}>
          {t.pickup_header}
        </h3>

        <div style={{
          display: 'flex',
          justifyContent: 'center',
          gap: '60px',
          flexWrap: 'wrap',
          textAlign: 'left'
        }}>
          <div>
            <strong style={{ fontSize: '1.4rem', display: 'block', marginBottom: '8px' }}>Montérégie</strong>
            <span style={{ fontSize: '1.1rem' }}>315 Back Bush, Hemmingford, Qc J0L 1H0</span>
          </div>
          <div>
            <strong style={{ fontSize: '1.4rem', display: 'block', marginBottom: '8px' }}>Outaouais</strong>
            <span style={{ fontSize: '1.1rem' }}>84 Rte 148, Bristol, Qc J0X 1G0</span>
          </div>
        </div>
      </div>

      {/* --- PART B & C: TABLES CONTAINER --- */}
      <div style={{
        display: 'flex',
        justifyContent: 'center',
        gap: '40px',
        flexWrap: 'wrap',
        alignItems: 'flex-start'
      }}>

        {/* TABLE 1: HENS (LEFT) */}
        <div style={{ flex: 1, minWidth: '300px', maxWidth: '450px' }}>
          <table className="price-table" style={{ width: '100%', borderCollapse: 'collapse', border: '1px solid black' }}>
            <thead>
              <tr>
                <th colSpan="2" style={{
                  textAlign: 'center',
                  background: 'black',
                  color: 'white',
                  padding: '12px',
                  border: '1px solid black'
                }}>
                  {t.hen_title}
                </th>
              </tr>
              <tr>
                <th colSpan="2" style={{
                  textAlign: 'center',
                  fontSize: '0.9rem',
                  padding: '10px',
                  background: '#f4f4f4',
                  border: '1px solid black'
                }}>
                  {t.hen_sub}
                </th>
              </tr>
              <tr>
                <th style={{ textAlign: 'center', width: '50%', border: '1px solid black', padding: '10px' }}>{t.col_qty}</th>
                <th style={{ textAlign: 'center', width: '50%', border: '1px solid black', padding: '10px' }}>{t.col_price}</th>
              </tr>
            </thead>
            <tbody>
              <tr><td style={{ textAlign: 'center', border: '1px solid black', padding: '10px' }}>50+</td><td style={{ textAlign: 'center', border: '1px solid black', padding: '10px' }}>$14.00 {t.unit}</td></tr>
              <tr><td style={{ textAlign: 'center', border: '1px solid black', padding: '10px' }}>13 - 49</td><td style={{ textAlign: 'center', border: '1px solid black', padding: '10px' }}>$15.25 {t.unit}</td></tr>
              <tr><td style={{ textAlign: 'center', border: '1px solid black', padding: '10px' }}>6 - 12</td><td style={{ textAlign: 'center', border: '1px solid black', padding: '10px' }}>$17.00 {t.unit}</td></tr>
              <tr style={{ background: '#f9f9f9' }}><td style={{ textAlign: 'center', border: '1px solid black', padding: '10px' }}>1 - 5</td><td style={{ textAlign: 'center', border: '1px solid black', padding: '10px' }}>$17.50 {t.unit}</td></tr>
            </tbody>
          </table>
        </div>

        {/* TABLE 2: MEAT (RIGHT) */}
        <div style={{ flex: 1, minWidth: '300px', maxWidth: '450px' }}>
          <table className="price-table" style={{ width: '100%', borderCollapse: 'collapse', border: '1px solid black' }}>
            <thead>
              <tr>
                <th colSpan="2" style={{
                  textAlign: 'center',
                  background: 'black',
                  color: 'white',
                  padding: '12px',
                  border: '1px solid black'
                }}>
                  {t.meat_title}
                </th>
              </tr>
              <tr>
                <th colSpan="2" style={{
                  textAlign: 'center',
                  fontSize: '0.9rem',
                  padding: '10px',
                  background: '#f4f4f4',
                  border: '1px solid black'
                }}>
                  {t.meat_sub}
                </th>
              </tr>
              <tr>
                <th style={{ textAlign: 'center', width: '50%', border: '1px solid black', padding: '10px' }}>{t.meat_col_qty}</th>
                <th style={{ textAlign: 'center', width: '50%', border: '1px solid black', padding: '10px' }}>{t.meat_col_price}</th>
              </tr>
            </thead>
            <tbody>
              <tr><td style={{ textAlign: 'center', border: '1px solid black', padding: '10px' }}>300+</td><td style={{ textAlign: 'center', border: '1px solid black', padding: '10px' }}>$2.15 {t.unit}</td></tr>
              <tr><td style={{ textAlign: 'center', border: '1px solid black', padding: '10px' }}>100 - 299</td><td style={{ textAlign: 'center', border: '1px solid black', padding: '10px' }}>$2.30 {t.unit}</td></tr>
              <tr><td style={{ textAlign: 'center', border: '1px solid black', padding: '10px' }}>49 - 99</td><td style={{ textAlign: 'center', border: '1px solid black', padding: '10px' }}>$2.50 {t.unit}</td></tr>
              <tr style={{ background: '#f9f9f9' }}><td style={{ textAlign: 'center', border: '1px solid black', padding: '10px' }}>25 - 49</td><td style={{ textAlign: 'center', border: '1px solid black', padding: '10px' }}>$2.60 {t.unit}</td></tr>
            </tbody>
          </table>

          <p style={{
            textAlign: 'center',
            fontStyle: 'italic',
            marginTop: '15px',
            fontSize: '0.9rem',
            color: '#444'
          }}>
            {t.meat_footer}
          </p>
        </div>

      </div>
    </div>
  );
}
