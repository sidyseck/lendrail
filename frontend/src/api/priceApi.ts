import { getToken } from '@/auth/tokenStore';

const API_BASE =
  typeof window !== 'undefined' ? `${window.location.origin}/api` : '/api';

function authHeaders(): Record<string, string> {
  const token = getToken();
  const h: Record<string, string> = {};
  if (token) h.Authorization = `Bearer ${token}`;
  return h;
}

export interface MarketPrice {
  asset_type: string;
  price_usd: string;
  as_of: string;
}

export async function getMarketPrice(assetType: string): Promise<MarketPrice> {
  const res = await fetch(
    `${API_BASE}/market-data/prices/${encodeURIComponent(assetType)}`,
    { headers: authHeaders() },
  );
  if (!res.ok) throw new Error(`Failed to fetch price for ${assetType}`);
  return (await res.json()) as MarketPrice;
}
