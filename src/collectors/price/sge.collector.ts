/**
 * 上海黄金交易所 (SGE) Au99.99 价格采集器
 *
 * 主源：Stooq GC.F（USD/oz）× ExchangeRate-API（USD/CNY）÷ 31.1035 → CNY/g
 * 注意：Stooq 返回残缺 JSON（"volume":}），需 responseType:'text' 手动修复。
 *       新浪财经和东方财富均已对云服务器封锁，已移除。
 */
import axios from 'axios';
import logger from '../../utils/logger';
import { withRetry } from '../../utils/retry';
import { fetchUsdCny } from './exchange-rate.collector';
import type { IPriceData } from '../../types';

const OZ_TO_GRAM = 31.1035;

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

async function fetchFromStooq(): Promise<{ price: number; source: string }> {
  const [goldRes, usdCny] = await Promise.all([
    axios.get<string>('https://stooq.com/q/l/?s=gc.f&f=sd2t2ohlcv&e=json', {
      headers: STOOQ_HEADERS,
      responseType: 'text',
      timeout: 12000,
    }),
    fetchUsdCny(),
  ]);

  const data = parseStooqJson(goldRes.data);
  const sym = data?.symbols?.[0];
  if (!sym) throw new Error('Stooq GC.F: no symbol');

  const close = typeof sym.close === 'string' ? parseFloat(sym.close) : (sym.close ?? NaN);
  if (!close || isNaN(close) || close <= 0) {
    throw new Error(`Stooq GC.F: invalid close="${sym.close}"`);
  }

  const price = (close * usdCny) / OZ_TO_GRAM;
  logger.debug(`[sge] Stooq $${close}/oz × ${usdCny} = ${price.toFixed(2)} CNY/g`);
  return { price, source: 'stooq-sge' };
}

export async function fetchSGEPrice(): Promise<IPriceData | null> {
  return withRetry(
    async () => {
      const result = await fetchFromStooq();
      return {
        source: result.source,
        timestamp: Date.now(),
        xauCny: result.price,
      } satisfies IPriceData;
    },
    'SGE-Price',
    { maxAttempts: 3, baseDelayMs: 2000 }
  );
}
