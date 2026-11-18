export interface ClientSeoConfig {
  title: string;
  description: string;
  path?: string;
  imagePath?: string;
}

function upsertMeta(attr: 'name' | 'property', key: string, content: string) {
  let el = document.querySelector<HTMLMetaElement>(`meta[${attr}="${key}"]`);
  if (!el) {
    el = document.createElement('meta');
    el.setAttribute(attr, key);
    document.head.appendChild(el);
  }
  el.setAttribute('content', content);
}

export function syncClientSeo({ title, description, path = '/', imagePath = '/og-preview.png' }: ClientSeoConfig) {
  if (typeof document === 'undefined' || typeof window === 'undefined') return;
  const origin = window.location.origin;
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  const canonicalUrl = `${origin}${normalizedPath}`;
  const imageUrl = imagePath.startsWith('http') ? imagePath : `${origin}${imagePath}`;

  document.title = title;
  upsertMeta('name', 'description', description);
  upsertMeta('property', 'og:site_name', 'SW88');
  upsertMeta('property', 'og:type', 'website');
  upsertMeta('property', 'og:title', title);
  upsertMeta('property', 'og:description', description);
  upsertMeta('property', 'og:url', canonicalUrl);
  upsertMeta('property', 'og:image', imageUrl);
  upsertMeta('property', 'og:image:secure_url', imageUrl);
  upsertMeta('name', 'twitter:card', 'summary_large_image');
  upsertMeta('name', 'twitter:domain', window.location.host);
  upsertMeta('name', 'twitter:url', canonicalUrl);
  upsertMeta('name', 'twitter:title', title);
  upsertMeta('name', 'twitter:description', description);
  upsertMeta('name', 'twitter:image', imageUrl);

  let canonical = document.querySelector<HTMLLinkElement>('link[rel="canonical"]');
  if (!canonical) {
    canonical = document.createElement('link');
    canonical.setAttribute('rel', 'canonical');
    document.head.appendChild(canonical);
  }
  canonical.setAttribute('href', canonicalUrl);
}

export function buildShareUrl(options?: { gameId?: string; refCode?: string }): string {
  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  if (options?.gameId) {
    return `${origin}/play/${encodeURIComponent(options.gameId)}`;
  }
  if (options?.refCode) {
    return `${origin}/?ref=${encodeURIComponent(options.refCode)}`;
  }
  return `${origin}/`;
}

export async function sharePlatformLink(params: {
  title: string;
  text: string;
  url: string;
}): Promise<'shared' | 'copied' | 'failed'> {
  if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
    try {
      await navigator.share({
        title: params.title,
        text: params.text,
        url: params.url,
      });
      return 'shared';
    } catch {
      // Fallback to clipboard copy if user cancelled or share unsupported
    }
  }
  if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(params.url);
      return 'copied';
    } catch {
      return 'failed';
    }
  }
  return 'failed';
}
