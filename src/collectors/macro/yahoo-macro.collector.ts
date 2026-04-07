/**
 * Yahoo Finance 宏观数据采集器
 * T-132: 美元指数 DXY
 * T-133: VIX 恐慌指数
 * T-135: 白银价格 (Gold/Silver Ratio)
 * T-136: 原油价格 (Gold/Oil Ratio)
 */
import axios from 'axios';
import logger from '../../utils/logger';
import { withRetry } from '../../utils/retry';
import type { IMacroData } from '../../types';
import dayjs from 'dayjs';

const YAHOO_CHART = 'https://query1.finance.yahoo.com/v8/finance/chart';

const SYMBOLS: Record<string, string> = {
  DXY:    'DX-Y.NYB', // 美元指数
  VIX:    '^VIX',     // CBOE 恐慌指数
  SILVER: 'SI=F',     // 白银期货
  OIL:    'CL=F',     // 原油期货 (WTI)
  TNX:    '^TNX',     // 美国10年期国债收益率（%）← 全球资产定价之锚
};

async function fetchSymbol(symbol: string, indicator: string): Promise<IMacroData | null> {
  return withRetry(
    async () => {
      const res = await axios.get(`${YAHOO_CHART}/${encodeURIComponent(symbol)}`, {
        params: { interval: '1d', range: '1d' },
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
        timeout: 10000,
      });

      const chart = (res.data as Record<string, unknown>)?.chart as Record<string, unknown>;
      const result = ((chart?.result as unknown[]) ?? [])[0] as Record<string, unknown> | undefined;
      if (!result) throw new Error(`Yahoo ${symbol}: no result`);

      const meta = result.meta as Record<string, unknown>;
      const price = meta.regularMarketPrice as number;
      if (!price) throw new Error(`Yahoo ${symbol}: no price`);

      return {
        date: dayjs().format('YYYY-MM-DD'),
        indicator,
        value: price,
        source: 'yahoo',
      };
    },
    `Yahoo-${symbol}`,
    { maxAttempts: 3, baseDelayMs: 2000 }
  );
}

export async function fetchYahooMacro(): Promise<IMacroData[]> {
  const tasks = Object.entries(SYMBOLS).map(([indicator, symbol]) =>
    fetchSymbol(symbol, indicator)
  );

  const results = await Promise.allSettled(tasks);
  const data: IMacroData[] = [];

  for (const r of results) {
    if (r.status === 'fulfilled' && r.value) {
      data.push(r.value);
    } else if (r.status === 'rejected') {
      logger.warn('[yahoo-macro] fetch failed', { err: r.reason });
    }
  }

  logger.info('[yahoo-macro] collected', { indicators: data.map(d => d.indicator) });
  return data;
}
