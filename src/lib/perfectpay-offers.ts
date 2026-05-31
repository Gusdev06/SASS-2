import brl from './perfectpay-offers-brl.json';
import usd from './perfectpay-offers-usd.json';

export type PerfectPayOffer = {
  planCode: string;
  checkoutCode: string;
  url: string;
  price: number;
};

const OFFERS: Record<string, PerfectPayOffer> = {
  ...(brl as Record<string, PerfectPayOffer>),
  ...(usd as Record<string, PerfectPayOffer>),
};

export function getOffer(pkgId: string): PerfectPayOffer | undefined {
  return OFFERS[pkgId];
}

export function planCodeToPkgId(planCode: string): string | null {
  for (const [pkgId, info] of Object.entries(OFFERS)) {
    if (info.planCode === planCode) return pkgId;
  }
  return null;
}

export function checkoutUrlFor(
  pkgId: string,
  userId: string,
  email?: string | null,
): string | null {
  const offer = OFFERS[pkgId];
  if (!offer) return null;
  const tag = `web_${userId}_${pkgId}`;
  const params = new URLSearchParams({
    utm_source: 'web',
    utm_campaign: 'hot',
    utm_content: tag,
    src: tag,
  });
  if (email) {
    params.set('email', email);
    params.set('customer_email', email);
  }
  return `${offer.url}?${params.toString()}`;
}
