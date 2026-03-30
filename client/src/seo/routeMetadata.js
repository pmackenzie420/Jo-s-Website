const SITE_NAME = 'Les Fermes Soulard S.E.N.C.';
const SITE_ORIGIN = 'https://www.lesfermessoulard.farm';
const DEFAULT_SOCIAL_IMAGE = `${SITE_ORIGIN}/327414873_2998517387108925_9077255035738106976_n-2-2.jpg?v=20260309`;
const DEFAULT_SOCIAL_IMAGE_ALT = 'Les Fermes Soulard S.E.N.C logo and farm illustration';

const ROUTE_METADATA = {
  '/': {
    robots: 'index, follow',
    en: {
      title: SITE_NAME,
      description:
        'Family farm in Quebec offering ready-to-lay hens, day-old broiler chicks, and lambs with online ordering and two pickup locations.'
    },
    fr: {
      title: SITE_NAME,
      description:
        'Entreprise agricole familiale au Quebec offrant poules pondeuses, poussins a chair et agneaux avec commande en ligne et deux points de ramassage.'
    }
  },
  '/prices': {
    robots: 'index, follow',
    en: {
      title: `Price List | ${SITE_NAME}`,
      description:
        'View the 2026 price list for ready-to-lay hens, Ross broiler chicks, and live lamb deposits from Les Fermes Soulard.'
    },
    fr: {
      title: `Liste De Prix | ${SITE_NAME}`,
      description:
        'Consultez la liste de prix 2026 pour les poules pretes a pondre, les poussins a chair Ross et les depots pour agneaux vivants.'
    }
  },
  '/contact': {
    robots: 'index, follow',
    en: {
      title: `Contact | ${SITE_NAME}`,
      description:
        'Contact Les Fermes Soulard for orders, pickup questions, and farm information in Bristol, Quebec.'
    },
    fr: {
      title: `Contact | ${SITE_NAME}`,
      description:
        'Communiquez avec Les Fermes Soulard pour les commandes, les questions de ramassage et les renseignements sur la ferme a Bristol, Quebec.'
    }
  },
  '/privacy': {
    robots: 'index, follow',
    en: {
      title: `Privacy Policy | ${SITE_NAME}`,
      description:
        'Read the privacy policy for Les Fermes Soulard and how customer order information is collected, used, and stored.'
    },
    fr: {
      title: `Politique De Confidentialite | ${SITE_NAME}`,
      description:
        'Consultez la politique de confidentialite de Les Fermes Soulard et la gestion des renseignements personnels lies aux commandes.'
    }
  },
  '/order': {
    robots: 'index, follow',
    en: {
      title: `Order Online | ${SITE_NAME}`,
      description:
        'Reserve hens, broiler chicks, and lambs online with pickup scheduling from Les Fermes Soulard.'
    },
    fr: {
      title: `Commander En Ligne | ${SITE_NAME}`,
      description:
        'Reservez en ligne des poules, des poussins a chair et des agneaux avec selection du lieu et de la date de ramassage.'
    }
  },
  '/checkout': {
    robots: 'noindex, nofollow',
    en: {
      title: `Checkout | ${SITE_NAME}`,
      description: 'Secure checkout for Les Fermes Soulard online orders.'
    },
    fr: {
      title: `Paiement | ${SITE_NAME}`,
      description: 'Paiement securise pour les commandes en ligne de Les Fermes Soulard.'
    }
  },
  '/success': {
    robots: 'noindex, nofollow',
    en: {
      title: `Order Confirmation | ${SITE_NAME}`,
      description: 'Order confirmation page for Les Fermes Soulard customers.'
    },
    fr: {
      title: `Confirmation De Commande | ${SITE_NAME}`,
      description: 'Page de confirmation de commande pour les clients de Les Fermes Soulard.'
    }
  },
  '/admin': {
    robots: 'noindex, nofollow',
    en: {
      title: `Admin | ${SITE_NAME}`,
      description: 'Administrative portal for Les Fermes Soulard.'
    },
    fr: {
      title: `Administration | ${SITE_NAME}`,
      description: 'Portail administratif de Les Fermes Soulard.'
    }
  }
};

const NOT_FOUND_METADATA = {
  robots: 'noindex, nofollow',
  en: {
    title: `Page Not Found | ${SITE_NAME}`,
    description: 'The requested page could not be found on Les Fermes Soulard.'
  },
  fr: {
    title: `Page Introuvable | ${SITE_NAME}`,
    description: 'La page demandee est introuvable sur le site de Les Fermes Soulard.'
  }
};

const normalizePathname = (pathname = '/') => {
  const normalized = String(pathname || '/').trim() || '/';
  if (normalized === '/') return '/';
  const withoutTrailingSlash = normalized.replace(/\/+$/, '');
  return withoutTrailingSlash || '/';
};

export const getSeoMetadata = (pathname, language = 'fr') => {
  const normalizedPath = normalizePathname(pathname);
  const lang = language === 'en' ? 'en' : 'fr';
  const routeMetadata = ROUTE_METADATA[normalizedPath] || NOT_FOUND_METADATA;
  const localizedMetadata = routeMetadata[lang];
  const canonicalPath = normalizedPath === '/' ? '/' : normalizedPath;

  return {
    title: localizedMetadata.title,
    description: localizedMetadata.description,
    robots: routeMetadata.robots,
    canonical: `${SITE_ORIGIN}${canonicalPath}`,
    locale: lang === 'fr' ? 'fr_CA' : 'en_CA',
    image: DEFAULT_SOCIAL_IMAGE,
    imageAlt: DEFAULT_SOCIAL_IMAGE_ALT
  };
};

export { SITE_NAME, SITE_ORIGIN };
