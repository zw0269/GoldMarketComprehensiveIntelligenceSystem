/**
 * 实时金价采集器（无需任何 API Key）
 *
 * 数据源：Stooq GC.F（COMEX 黄金期货，USD/oz）
 * 经云服务器实测：gc.f ✅ 可访问
 *
 * 已放弃：Yahoo Finance（中国大陆封锁）、新浪财经（403）、
 *         metals.live（SSL握手失败）、Coinbase（无响应）、goldprice.org（403）
 */
import axios from 'axios';
import logger from '../../utils/logger';
import { withRetry } from '../../utils/retry';
import type { IPriceData } from '../../types';

interface StooqSymbol {
  symbol: string;
  date?: string;
  close?: number | string | null;
}
interface StooqResponse {
  symbols?: StooqSymbol[];
}

async function fetchStooqGold(): Promise<number> {
  const res = await axios.get<StooqResponse>(
    'https://stooq.com/q/l/?s=gc.f&f=sd2t2ohlcv&e=json',
    { timeout: 12000 }
  );

  const sym = res.data?.symbols?.[0];
  if (!sym) throw new Error('Stooq GC.F: no symbol in response');

  const close = typeof sym.close === 'string' ? parseFloat(sym.close) : (sym.close ?? NaN);
  if (!close || isNaN(close) || close <= 0) {
    throw new Error(`Stooq GC.F: invalid close="${sym.close}" (market may be closed)`);
  }

  logger.debug(`[freeRT] Stooq GC.F = $${close}/oz`);
  return close; // USD/oz
}

/**
 * 获取实时黄金价格（USD/oz）
 */
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
