/**
 * 宏观数据采集器（使用 Stooq 替代 Yahoo Finance）
 * Stooq 为波兰金融数据平台，提供免费行情，中国大陆云服务器可访问
 *
 * 指标：
 *   DXY  - 美元指数
 *   VIX  - CBOE 恐慌指数
 *   SILVER - 白银期货（美元/盎司）
 *   OIL  - WTI 原油期货
 *   TNX  - 美国10年期国债收益率（%）
 *
 * 注意：Yahoo Finance 在中国大陆已完全封锁（2021年），已移除。
 */
import axios from 'axios';
import logger from '../../utils/logger';
import { withRetry } from '../../utils/retry';
import type { IMacroData } from '../../types';
import dayjs from 'dayjs';

// Stooq 行情接口
const STOOQ_BASE = 'https://stooq.com/q/l/';

// Stooq symbol 映射
const SYMBOLS: Record<string, string> = {
  DXY:    'dxy.f',      // 美元指数
  VIX:    '^vix',       // CBOE 恐慌指数
  SILVER: 'si.f',       // 白银期货 USD/oz
  OIL:    'cl.f',       // WTI 原油期货
  TNX:    'us10yt=rr',  // 美国10年期国债收益率
};

interface StooqSymbol {
  symbol: string;
  date: string;
  open: number | string;
  high: number | string;
  low: number | string;
  close: number | string;
  volume: number | string;
}
interface StooqResponse {
  symbols?: StooqSymbol[];
}

function parseClose(val: number | string | undefined): number | null {
  if (val === undefined || val === null) return null;
  const n = typeof val === 'string' ? parseFloat(val) : val;
  return isFinite(n) && n > 0 ? n : null;
}

async function fetchSymbol(indicator: string, stooqSymbol: string): Promise<IMacroData | null> {
  return withRetry(
    async () => {
      const res = await axios.get<StooqResponse>(STOOQ_BASE, {
        params: { s: stooqSymbol, f: 'sd2t2ohlcv', e: 'json' },
        timeout: 10000,
      });

      const sym = res.data?.symbols?.[0];
      if (!sym) throw new Error(`Stooq ${stooqSymbol}: no symbol`);

      const price = parseClose(sym.close);
      if (price === null) {
        throw new Error(`Stooq ${stooqSymbol}: invalid close="${sym.close}" (market may be closed)`);
      }

      return {
        date: dayjs().format('YYYY-MM-DD'),
        indicator,
        value: price,
        source: 'stooq',
      };
    },
    `Stooq-${stooqSymbol}`,
    { maxAttempts: 3, baseDelayMs: 2000 }
  );
}

export async function fetchYahooMacro(): Promise<IMacroData[]> {
  const tasks = Object.entries(SYMBOLS).map(([indicator, symbol]) =>
    fetchSymbol(indicator, symbol)
  );

  const results = await Promise.allSettled(tasks);
  const data: IMacroData[] = [];

  for (const r of results) {
    if (r.status === 'fulfilled' && r.value) {
      data.push(r.value);
    } else if (r.status === 'rejected') {
      logger.warn('[macro] stooq fetch failed', { err: r.reason });
    }
  }

  logger.info('[macro] collected', { indicators: data.map(d => d.indicator) });
  return data;
}
