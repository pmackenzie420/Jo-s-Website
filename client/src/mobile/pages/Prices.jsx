import DesktopPrices from '../../pages/Prices';

export default function Prices({ lang }) {
  return (
    <div className="mobile-page">
      <DesktopPrices lang={lang} />
    </div>
  );
}
