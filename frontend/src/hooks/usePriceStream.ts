import { useEffect, useRef, useState } from 'react';
import { getToken } from '@/auth/tokenStore';

export type PriceMap = Record<string, number>;

export function usePriceStream(): PriceMap {
  const [prices, setPrices] = useState<PriceMap>({});
  const esRef = useRef<EventSource | null>(null);

  useEffect(() => {
    const token = getToken() ?? '';
    const url = `${window.location.origin}/api/market-data/prices/stream?token=${encodeURIComponent(token)}`;
    const es = new EventSource(url);
    esRef.current = es;

    es.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data as string) as PriceMap;
        setPrices(data);
      } catch {
        // malformed frame — ignore
      }
    };

    return () => {
      es.close();
      esRef.current = null;
    };
  }, []);

  return prices;
}
