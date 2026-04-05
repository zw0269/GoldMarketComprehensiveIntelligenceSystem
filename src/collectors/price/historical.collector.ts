/**
 * 黄金历史 OHLCV 数据采集器
 * 来源: Yahoo Finance GC=F (COMEX 黄金主力合约)
 * 支持: 1月 / 3月 / 1年 / 5年 / 全部
 */
import axios from 'axios';
import logger from '../../utils/logger';
import { withRetry } from '../../utils/retry';
import type { IOHLCV } from '../../types';

const YAHOO_CHART = 'https://query1.finance.yahoo.com/v8/finance/chart';

type Range = '1mo' | '3mo' | '1y' | '5y' | 'max';

const RANGE_INTERVAL: Record<Range, string> = {
  '1mo': '1d',
  '3mo': '1d',
  '1y':  '1wk',
  '5y':  '1wk',
  'max': '1mo',
};

const RANGE_TF: Record<Range, IOHLCV['timeframe']> = {
  '1mo': '1d',
  '3mo': '1d',
  '1y':  '1w',
  '5y':  '1w',
  'max': '1w',
};

export async function fetchHistoricalGold(range: Range = '1y'): Promise<IOHLCV[]> {
  return withRetry(
    async () => {
      const interval = RANGE_INTERVAL[range];
      const res = await axios.get(`${YAHOO_CHART}/GC%3DF`, {
        params: { interval, range, includePrePost: false },
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
        timeout: 15000,
      });

      const chart = (res.data as Record<string, unknown>)?.chart as Record<string, unknown>;
      const result = ((chart?.result as unknown[]) ?? [])[0] as Record<string, unknown> | undefined;
      if (!result) throw new Error(`Yahoo Historical: no data for range=${range}`);

      const timestamps = result['timestamp'] as number[];
      const quote = ((result['indicators'] as Record<string, unknown>)?.['quote'] as unknown[])?.[0] as Record<string, number[]> | undefined;

      if (!timestamps || !quote) throw new Error('Yahoo Historical: missing timestamps or quotes');

      const bars: IOHLCV[] = [];
      for (let i = 0; i < timestamps.length; i++) {
        const open  = quote['open']?.[i];
        const high  = quote['high']?.[i];
        const low   = quote['low']?.[i];
        const close = quote['close']?.[i];
        const vol   = quote['volume']?.[i];

        if (!open || !high || !low || !close) continue;

        bars.push({
          timestamp: timestamps[i] * 1000,
          open,
          high,
          low,
          close,
          volume: vol ?? 0,
          timeframe: RANGE_TF[range],
        });
      }

      logger.info(`[historical] fetched ${bars.length} bars for range=${range}`);
      return bars;
    },
    `YahooHistorical-${range}`,
    { maxAttempts: 3, baseDelayMs: 3000 }
  );
}
