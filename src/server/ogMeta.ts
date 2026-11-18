import type { Request } from 'express';

export interface OgDescriptor {
  title: string;
  description: string;
  imagePath: string;
  imageType: string;
  imageAlt: string;
  canonicalPath: string;
  appName: string;
}

const GAME_OG_MAP: Record<string, Omit<OgDescriptor, 'canonicalPath' | 'appName'>> = {
  '3-patti-royale': {
    title: '3 Patti Royale on SW88 — Live Multiplayer Card Table',
    description:
      'Play 3 Patti Royale on SW88 with Blind, Seen, Chaal, Double, and Show rounds. Open in the SW88 Mobile App for instant full-screen play.',
    imagePath: '/og-3patti.jpg',
    imageType: 'image/jpeg',
    imageAlt: '3 Patti Royale live multiplayer card game on SW88',
  },
  'bubble-rocket-x': {
    title: 'Bubble Rocket X on SW88 — Precision Multiplier Arcade',
    description:
      'Blast precision shots and win up to 8x multipliers in Bubble Rocket X on SW88. Launch inside the standalone SW88 Mobile App.',
    imagePath: '/og-bubble.jpg',
    imageType: 'image/jpeg',
    imageAlt: 'Bubble Rocket X multiplier arcade game on SW88',
  },
  'skyline-crash': {
    title: 'Skyline Crash on SW88 — Real-Time Flight Multiplier',
    description:
      'Place your bet, watch the jet climb, and cash out before flyaway in Skyline Crash on SW88. Open in the SW88 Mobile App.',
    imagePath: '/og-skyline.jpg',
    imageType: 'image/jpeg',
    imageAlt: 'Skyline Crash real-time flight multiplier game on SW88',
  },
};

function escapeHtmlAttr(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

export function resolveRequestOrigin(req: Request): { origin: string; domain: string } {
  const configured = (process.env.APP_URL || '').trim().replace(/\/+$/, '');
  const forwardedProto = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim();
  const proto = forwardedProto || req.protocol || 'https';
  const host = String(req.headers['x-forwarded-host'] || req.get('host') || '').split(',')[0].trim();

  if (host) {
    return { origin: `${proto}://${host}`, domain: host };
  }
  if (configured) {
    try {
      const parsed = new URL(configured);
      return { origin: parsed.origin, domain: parsed.host };
    } catch {
      return { origin: configured, domain: configured.replace(/^https?:\/\//i, '') };
    }
  }
  return { origin: 'https://sw88.app', domain: 'sw88.app' };
}

export function resolveOgDescriptor(req: Request): OgDescriptor {
  const pathOnly = (req.path || '/').toLowerCase();
  const gameQuery = typeof req.query.game === 'string' ? req.query.game.trim().toLowerCase() : '';
  const refCode = typeof req.query.ref === 'string' ? req.query.ref.trim() : '';

  let matchedGameId = gameQuery;
  if (!matchedGameId) {
    const playMatch = pathOnly.match(/^\/(?:play|game|games)\/([a-z0-9-]+)\/?$/);
    if (playMatch?.[1]) {
      matchedGameId = playMatch[1];
    }
  }

  if (matchedGameId && GAME_OG_MAP[matchedGameId]) {
    const meta = GAME_OG_MAP[matchedGameId];
    return {
      ...meta,
      appName: 'SW88',
      canonicalPath: req.originalUrl || `/?game=${encodeURIComponent(matchedGameId)}`,
    };
  }

  if (refCode || pathOnly.startsWith('/invite')) {
    return {
      appName: 'SW88',
      title: 'Join SW88 — Official Mobile Gaming & Instant Wallet',
      description: `Accept your SW88 invite${refCode ? ` (${refCode})` : ''} to play 3 Patti Royale, Bubble Rocket X, and Skyline Crash in the SW88 Mobile App.`,
      imagePath: '/og-preview.png',
      imageType: 'image/png',
      imageAlt: 'SW88 Gaming Platform Official Invite Preview',
      canonicalPath: req.originalUrl || '/',
    };
  }

  if (pathOnly.startsWith('/wallet')) {
    return {
      appName: 'SW88',
      title: 'SW88 Wallet — Instant Deposits, Withdrawals & Transfers',
      description:
        'Manage your unified SW88 wallet balance, QR deposits, fast withdrawals, and direct friend or agent transfers.',
      imagePath: '/og-preview.png',
      imageType: 'image/png',
      imageAlt: 'SW88 Gaming Platform Centralized Wallet Preview',
      canonicalPath: req.originalUrl || '/wallet',
    };
  }

  return {
    appName: 'SW88',
    title: 'SW88 — Live Royale Cards, Crash & Arcade Gaming',
    description:
      'Play 3 Patti Royale, Bubble Rocket X, and Skyline Crash on SW88 with instant centralized wallet & standalone mobile app.',
    imagePath: '/og-preview.png',
    imageType: 'image/png',
    imageAlt: 'SW88 Gaming Platform Preview Card',
    canonicalPath: req.originalUrl || '/',
  };
}

export function injectOpenGraphHtml(html: string, req: Request): string {
  const { origin, domain } = resolveRequestOrigin(req);
  const desc = resolveOgDescriptor(req);

  const canonicalUrl = `${origin}${desc.canonicalPath.startsWith('/') ? desc.canonicalPath : `/${desc.canonicalPath}`}`;
  const imageUrl = `${origin}${desc.imagePath}`;

  const jsonLd = JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'WebApplication',
    name: desc.appName,
    alternateName: 'SW88 Gaming Platform',
    applicationCategory: 'GameApplication',
    operatingSystem: 'Android, iOS, Web',
    url: canonicalUrl,
    image: imageUrl,
    description: desc.description,
    publisher: {
      '@type': 'Organization',
      name: 'SW88',
      url: origin,
      logo: `${origin}/pwa-512x512.png`,
    },
    offers: {
      '@type': 'Offer',
      price: '0',
      priceCurrency: 'NPR',
    },
  }).replace(/</g, '\\u003c');

  const metaBlock = `
    <title>${escapeHtmlAttr(desc.title)}</title>
    <meta name="description" content="${escapeHtmlAttr(desc.description)}" />
    <meta name="application-name" content="${escapeHtmlAttr(desc.appName)}" />
    <link rel="canonical" href="${escapeHtmlAttr(canonicalUrl)}" />
    <meta property="og:type" content="website" />
    <meta property="og:site_name" content="${escapeHtmlAttr(desc.appName)}" />
    <meta property="og:locale" content="en_US" />
    <meta property="og:url" content="${escapeHtmlAttr(canonicalUrl)}" />
    <meta property="og:title" content="${escapeHtmlAttr(desc.title)}" />
    <meta property="og:description" content="${escapeHtmlAttr(desc.description)}" />
    <meta property="og:image" content="${escapeHtmlAttr(imageUrl)}" />
    <meta property="og:image:secure_url" content="${escapeHtmlAttr(imageUrl)}" />
    <meta property="og:image:type" content="${escapeHtmlAttr(desc.imageType)}" />
    <meta property="og:image:width" content="1200" />
    <meta property="og:image:height" content="630" />
    <meta property="og:image:alt" content="${escapeHtmlAttr(desc.imageAlt)}" />
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:domain" content="${escapeHtmlAttr(domain)}" />
    <meta name="twitter:url" content="${escapeHtmlAttr(canonicalUrl)}" />
    <meta name="twitter:title" content="${escapeHtmlAttr(desc.title)}" />
    <meta name="twitter:description" content="${escapeHtmlAttr(desc.description)}" />
    <meta name="twitter:image" content="${escapeHtmlAttr(imageUrl)}" />
    <meta name="twitter:image:alt" content="${escapeHtmlAttr(desc.imageAlt)}" />
    <script type="application/ld+json">${jsonLd}</script>
  `.trim();

  if (html.includes('<!-- SW88_OG_START -->') && html.includes('<!-- SW88_OG_END -->')) {
    return html.replace(/<!-- SW88_OG_START -->[\s\S]*?<!-- SW88_OG_END -->/, `<!-- SW88_OG_START -->\n    ${metaBlock}\n    <!-- SW88_OG_END -->`);
  }

  return html.replace('</head>', `    ${metaBlock}\n  </head>`);
}
