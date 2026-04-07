/**
 * 实时金价采集器（无需任何 API Key）
 *
 * 数据源：Stooq GC.F（COMEX 黄金期货，USD/oz）
 * 注意：Stooq 返回的 JSON 中 volume 字段值为空（"volume":}），
 *       需要用 responseType:'text' 手动修复后再解析。
 */
import axios from 'axios';
import logger from '../../utils/logger';
import { withRetry } from '../../utils/retry';
import type { IPriceData } from '../../types';

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

// Stooq 返回残缺 JSON（"volume":} 无值），需手动修复
function parseStooqJson(raw: string): StooqResponse {
  const fixed = raw
    .replace(/"volume":\s*}/g, '"volume":null}')
    .replace(/"volume":\s*,/g, '"volume":null,');
  return JSON.parse(fixed) as StooqResponse;
}

async function fetchStooqGold(): Promise<number> {
  const res = await axios.get<string>(
    'https://stooq.com/q/l/?s=gc.f&f=sd2t2ohlcv&e=json',
    {
      headers: STOOQ_HEADERS,
      responseType: 'text',
      timeout: 12000,
    }
  );

  const data = parseStooqJson(res.data);
  const sym = data?.symbols?.[0];
  if (!sym) throw new Error('Stooq GC.F: no symbol in response');

  const close = typeof sym.close === 'string' ? parseFloat(sym.close) : (sym.close ?? NaN);
  if (!close || isNaN(close) || close <= 0) {
    throw new Error(`Stooq GC.F: invalid close="${sym.close}" (market may be closed)`);
  }

  logger.debug(`[freeRT] Stooq GC.F = $${close}/oz`);
  return close; // USD/oz
}

export async function fetchEastmoneyRealtimePrice(): Promise<IPriceData | null> {
  try {
    const xauUsd = await withRetry(fetchStooqGold, 'Stooq-GC.F', {
      maxAttempts: 3,
      baseDelayMs: 3000,
    });

    return {
      source: 'stooq',
      timestamp: Date.now(),
      xauUsd,
    };
  } catch (err) {
    logger.warn('[freeRT] Stooq GC.F all attempts failed', { err });
    return null;
  }
}
