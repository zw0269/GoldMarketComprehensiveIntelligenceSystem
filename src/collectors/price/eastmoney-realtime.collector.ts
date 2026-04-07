/**
 * 实时金价采集器（无需任何 API Key）
 *
 * 主源：腾讯财经 qt.gtimg.cn hf_XAU（国际金价 USD/oz，云服务器实测可用）
 * 备源：Stooq GC.F（需修复残缺 JSON）
 *
 * 腾讯返回格式：v_hf_XAU="价格,涨跌,当前,买价,最高,最低,时间,bid,ask,..."
 * fields[0] = 当前价（USD/oz）
 */
import axios from 'axios';
import logger from '../../utils/logger';
import { withRetry } from '../../utils/retry';
import type { IPriceData } from '../../types';

const STOOQ_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept': 'text/plain, */*',
};

// ── 主源：腾讯财经 hf_XAU ─────────────────────────────────────
async function fetchTencentGold(): Promise<number> {
  const res = await axios.get<string>('https://qt.gtimg.cn/q=hf_XAU', {
    headers: STOOQ_HEADERS,
    responseType: 'text',
    timeout: 10000,
  });

  // 格式: v_hf_XAU="4658.42,0.17,4658.42,..."
  const match = (res.data as string).match(/v_\w+="([^"]+)"/);
  if (!match) throw new Error('Tencent hf_XAU: parse failed');

  const parts = match[1].split(',');
  const price = parseFloat(parts[0]);
  if (!price || isNaN(price) || price <= 0) {
    throw new Error(`Tencent hf_XAU: invalid price="${parts[0]}"`);
  }

  logger.debug(`[freeRT] Tencent hf_XAU = $${price}/oz`);
  return price; // USD/oz
}

// ── 备源：Stooq GC.F ──────────────────────────────────────────
async function fetchStooqGold(): Promise<number> {
  const res = await axios.get<string>(
    'https://stooq.com/q/l/?s=gc.f&f=sd2t2ohlcv&e=json',
    { headers: STOOQ_HEADERS, responseType: 'text', timeout: 12000 }
  );

  const fixed = (res.data as string)
    .replace(/"volume":\s*}/g, '"volume":null}')
    .replace(/"volume":\s*,/g, '"volume":null,');
  const data = JSON.parse(fixed) as { symbols?: Array<{ close?: number | string }> };
  const sym = data?.symbols?.[0];
  if (!sym) throw new Error('Stooq GC.F: no symbol');

  const close = typeof sym.close === 'string' ? parseFloat(sym.close) : (sym.close ?? NaN);
  if (!close || isNaN(close) || close <= 0) {
    throw new Error(`Stooq GC.F: invalid close="${sym.close}"`);
  }

  logger.debug(`[freeRT] Stooq GC.F = $${close}/oz`);
  return close;
}

export async function fetchEastmoneyRealtimePrice(): Promise<IPriceData | null> {
  return withRetry(
    async () => {
      let xauUsd: number;
      let source = 'tencent';
      try {
        xauUsd = await fetchTencentGold();
      } catch (err) {
        logger.warn('[freeRT] Tencent failed, trying Stooq', { err });
        xauUsd = await fetchStooqGold();
        source = 'stooq';
      }
      return { source, timestamp: Date.now(), xauUsd };
    },
    'RealtimeGold',
    { maxAttempts: 3, baseDelayMs: 2000 }
  );
}
