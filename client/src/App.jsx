import DesktopApp from './apps/DesktopApp';
import useMediaQuery from './hooks/useMediaQuery';
import MobileApp from './mobile/MobileApp';

const MOBILE_QUERY = '(max-width: 800px)';

export default function App() {
  const isMobile = useMediaQuery(MOBILE_QUERY);
  return isMobile ? <MobileApp /> : <DesktopApp />;
}
