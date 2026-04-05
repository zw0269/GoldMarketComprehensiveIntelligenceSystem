/**
 * COMEX 黄金期货价格采集器
 * 来源: Yahoo Finance (GC=F 主力合约, 15分钟延迟)
 */
import axios from 'axios';
import logger from '../../utils/logger';
import { withRetry } from '../../utils/retry';

export interface COMEXFuturesData {
  symbol: string;
  price: number;
  change: number;
  changePercent: number;
  volume: number;
  timestamp: number;
}

export async function fetchCOMEXFutures(
  symbol = 'GC=F'
): Promise<COMEXFuturesData | null> {
  return withRetry(
    async () => {
      const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}`;
      const res = await axios.get(url, {
        params: { interval: '1m', range: '1d' },
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
        },
        timeout: 12000,
      });

      const chart = (res.data as Record<string, unknown>)?.chart as Record<string, unknown>;
      const result = (chart?.result as unknown[])?.[0] as Record<string, unknown> | undefined;
      if (!result) throw new Error('Yahoo Finance: no chart result');

      const meta = result.meta as Record<string, unknown>;
      return {
        symbol,
        price: meta.regularMarketPrice as number,
        change: (meta.regularMarketPrice as number) - (meta.chartPreviousClose as number),
        changePercent:
          (((meta.regularMarketPrice as number) - (meta.chartPreviousClose as number)) /
            (meta.chartPreviousClose as number)) *
          100,
        volume: (meta.regularMarketVolume as number) ?? 0,
        timestamp: (meta.regularMarketTime as number) * 1000,
      };
    },
    `COMEX-${symbol}`,
    { maxAttempts: 3, baseDelayMs: 3000 }
  );
}
