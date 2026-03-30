import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { getSeoMetadata, SITE_NAME } from '../seo/routeMetadata';

const upsertMetaTag = ({ name, property, content }) => {
  if (!content) return;
  const attributeName = name ? 'name' : 'property';
  const attributeValue = name || property;
  let tag = document.head.querySelector(`meta[${attributeName}="${attributeValue}"]`);

  if (!tag) {
    tag = document.createElement('meta');
    tag.setAttribute(attributeName, attributeValue);
    document.head.appendChild(tag);
  }

  tag.setAttribute('content', content);
};

const upsertCanonicalLink = (href) => {
  if (!href) return;
  let link = document.head.querySelector('link[rel="canonical"]');
  if (!link) {
    link = document.createElement('link');
    link.setAttribute('rel', 'canonical');
    document.head.appendChild(link);
  }
  link.setAttribute('href', href);
};

export default function SeoManager({ lang }) {
  const location = useLocation();

  useEffect(() => {
    const metadata = getSeoMetadata(location.pathname, lang);
    document.title = metadata.title || SITE_NAME;
    document.documentElement.lang = lang === 'en' ? 'en' : 'fr';

    upsertMetaTag({ name: 'title', content: metadata.title });
    upsertMetaTag({ name: 'description', content: metadata.description });
    upsertMetaTag({ name: 'robots', content: metadata.robots });
    upsertMetaTag({ name: 'googlebot', content: metadata.robots });
    upsertMetaTag({ property: 'og:type', content: 'website' });
    upsertMetaTag({ property: 'og:url', content: metadata.canonical });
    upsertMetaTag({ property: 'og:site_name', content: SITE_NAME });
    upsertMetaTag({ property: 'og:title', content: metadata.title });
    upsertMetaTag({ property: 'og:description', content: metadata.description });
    upsertMetaTag({ property: 'og:locale', content: metadata.locale });
    upsertMetaTag({ property: 'og:image', content: metadata.image });
    upsertMetaTag({ property: 'og:image:url', content: metadata.image });
    upsertMetaTag({ property: 'og:image:secure_url', content: metadata.image });
    upsertMetaTag({ property: 'og:image:type', content: 'image/jpeg' });
    upsertMetaTag({ property: 'og:image:width', content: '2048' });
    upsertMetaTag({ property: 'og:image:height', content: '1200' });
    upsertMetaTag({ property: 'og:image:alt', content: metadata.imageAlt });
    upsertMetaTag({ name: 'twitter:card', content: 'summary_large_image' });
    upsertMetaTag({ name: 'twitter:url', content: metadata.canonical });
    upsertMetaTag({ name: 'twitter:title', content: metadata.title });
    upsertMetaTag({ name: 'twitter:description', content: metadata.description });
    upsertMetaTag({ name: 'twitter:image', content: metadata.image });
    upsertMetaTag({ name: 'twitter:image:alt', content: metadata.imageAlt });
    upsertCanonicalLink(metadata.canonical);
  }, [lang, location.pathname]);

  return null;
}
