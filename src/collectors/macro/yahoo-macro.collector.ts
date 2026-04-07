/**
 * 宏观数据采集器（使用 Stooq 替代 Yahoo Finance）
 * Stooq 为波兰金融数据平台，提供免费行情，中国大陆云服务器可访问
 *
 * 指标：
 *   DXY    - 美元指数（usdidx）
 *   VIX    - CBOE 恐慌指数（^vix，美股交易时间才有数据）
 *   SILVER - 白银期货（si.f）
 *   OIL    - WTI 原油期货（cl.f）
 *   TNX    - 美国10年期国债收益率（ust10y.b，交易日才有数据）
 *
 * 注意：Yahoo Finance 在中国大陆已完全封锁（2021年），已移除。
 *       VIX / TNX / DXY 在非美股交易时间返回空 close，属正常现象，静默跳过。
 */
import axios from 'axios';
import logger from '../../utils/logger';
import type { IMacroData } from '../../types';
import dayjs from 'dayjs';

const STOOQ_BASE = 'https://stooq.com/q/l/';

// Stooq symbol 映射（经云服务器实测）
// si.f / cl.f 期货在交易时间稳定返回数据
// dxy.f / ^vix / us10yt=rr 非交易时间无 close，改用更稳定 symbol 或静默跳过
const SYMBOLS: Record<string, string> = {
  SILVER: 'si.f',      // 白银期货 USD/oz ✅
  OIL:    'cl.f',      // WTI 原油期货   ✅
  DXY:    'usdidx',    // 美元指数（Stooq 稳定 symbol）
  VIX:    '^vix',      // CBOE 恐慌指数（仅美股交易时间有数据）
  TNX:    'ust10y.b',  // 美国10年期国债收益率（Stooq bond symbol）
};

const STOOQ_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept': 'application/json, text/plain, */*',
};

interface StooqSymbol {
  symbol?: string;
  close?: number | string | null;
}
interface StooqResponse {
  symbols?: StooqSymbol[];
}

function parseStooqJson(raw: string): StooqResponse {
  const fixed = raw
    .replace(/"volume":\s*}/g, '"volume":null}')
    .replace(/"volume":\s*,/g, '"volume":null,');
  return JSON.parse(fixed) as StooqResponse;
}

function parseClose(val: number | string | null | undefined): number | null {
  if (val === undefined || val === null) return null;
  const n = typeof val === 'string' ? parseFloat(val) : val;
  return isFinite(n) && n > 0 ? n : null;
}

// 单次请求，不重试——close 为空表示休市，无需重试
async function fetchSymbolOnce(indicator: string, stooqSymbol: string): Promise<IMacroData | null> {
  try {
    const res = await axios.get<string>(STOOQ_BASE, {
      params: { s: stooqSymbol, f: 'sd2t2ohlcv', e: 'json' },
      headers: STOOQ_HEADERS,
      responseType: 'text',
      timeout: 10000,
    });

    const data = parseStooqJson(res.data);
    const sym = data?.symbols?.[0];
    if (!sym) {
      logger.debug(`[macro] ${indicator}(${stooqSymbol}): no symbol returned`);
      return null;
    }

    const price = parseClose(sym.close);
    if (price === null) {
      // 非交易时间 close 为空，静默跳过，不记录 warn/error
      logger.debug(`[macro] ${indicator}(${stooqSymbol}): no close data (market closed or off-hours)`);
      return null;
    }

    logger.debug(`[macro] ${indicator} = ${price}`);
    return {
      date: dayjs().format('YYYY-MM-DD'),
      indicator,
      value: price,
      source: 'stooq',
    };
  } catch (err) {
    // 网络错误才记录 warn
    logger.warn(`[macro] ${indicator}(${stooqSymbol}) fetch error`, { err });
    return null;
  }
}

export async function fetchYahooMacro(): Promise<IMacroData[]> {
  const results = await Promise.all(
    Object.entries(SYMBOLS).map(([indicator, symbol]) =>
      fetchSymbolOnce(indicator, symbol)
    )
  );

  const data = results.filter((r): r is IMacroData => r !== null);

  if (data.length > 0) {
    logger.info('[macro] collected', { indicators: data.map(d => d.indicator) });
  } else {
    logger.debug('[macro] no macro data collected (off-hours)');
  }

  return data;
}
