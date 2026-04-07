/**
 * 宏观数据采集器（使用 Stooq 替代 Yahoo Finance）
 *
 * Yahoo Finance 在中国大陆已封锁，改用 Stooq（波兰，云服务器可访问）。
 * Stooq 在非美股交易时间对 DXY/VIX/TNX 返回空 close，属正常现象，静默跳过不重试。
 * SILVER(si.f) / OIL(cl.f) 期货全天均有数据。
 */
import axios from 'axios';
import logger from '../../utils/logger';
import type { IMacroData } from '../../types';
import dayjs from 'dayjs';

const STOOQ_BASE = 'https://stooq.com/q/l/';

const SYMBOLS: Record<string, string> = {
  SILVER: 'si.f',      // 白银期货 USD/oz ✅
  OIL:    'cl.f',      // WTI 原油期货   ✅
  DXY:    'usdidx',    // 美元指数
  VIX:    '^vix',      // CBOE 恐慌指数（仅美股交易时间有数据）
  TNX:    'ust10y.b',  // 美国10年期国债收益率
};

const STOOQ_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept': 'application/json, text/plain, */*',
};

function parseStooqJson(raw: string): { symbols?: Array<{ close?: number | string | null }> } {
  const fixed = raw
    .replace(/"volume":\s*}/g, '"volume":null}')
    .replace(/"volume":\s*,/g, '"volume":null,');
  return JSON.parse(fixed);
}

function parseClose(val: number | string | null | undefined): number | null {
  if (val === undefined || val === null) return null;
  const n = typeof val === 'string' ? parseFloat(val) : val;
  return isFinite(n) && n > 0 ? n : null;
}

async function fetchSymbolOnce(indicator: string, stooqSymbol: string): Promise<IMacroData | null> {
  try {
    const res = await axios.get<string>(STOOQ_BASE, {
      params: { s: stooqSymbol, f: 'sd2t2ohlcv', e: 'json' },
      headers: STOOQ_HEADERS,
      responseType: 'text',
      timeout: 10000,
    });

    const data = parseStooqJson(res.data as string);
    const sym = data?.symbols?.[0];
    if (!sym) {
      logger.debug(`[macro] ${indicator}(${stooqSymbol}): no symbol returned`);
      return null;
    }

    const price = parseClose(sym.close);
    if (price === null) {
      // 非交易时间 close 为空，静默跳过
      logger.debug(`[macro] ${indicator}(${stooqSymbol}): no close (off-hours)`);
      return null;
    }

    return { date: dayjs().format('YYYY-MM-DD'), indicator, value: price, source: 'stooq' };
  } catch (err) {
    logger.warn(`[macro] ${indicator}(${stooqSymbol}) fetch error`, { err });
    return null;
  }
}

export async function fetchYahooMacro(): Promise<IMacroData[]> {
  const results = await Promise.all(
    Object.entries(SYMBOLS).map(([indicator, symbol]) => fetchSymbolOnce(indicator, symbol))
  );

  const data = results.filter((r): r is IMacroData => r !== null);
  if (data.length > 0) {
    logger.info('[macro] collected', { indicators: data.map(d => d.indicator) });
  }
  return data;
}
