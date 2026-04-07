/**
 * 上海黄金交易所 (SGE) Au99.99 价格采集器
 *
 * 主源：Stooq XAUUSD（USD/oz）× ExchangeRate-API（USD/CNY）÷ 31.1035 → CNY/g
 * 备源：直接使用 ExchangeRate-API 汇率 × 国际金价估算
 *
 * 注意：新浪财经和东方财富均已对云服务器封锁（403/000），已移除。
 */
import axios from 'axios';
import logger from '../../utils/logger';
import { withRetry } from '../../utils/retry';
import { fetchUsdCny } from './exchange-rate.collector';
import type { IPriceData } from '../../types';

const OZ_TO_GRAM = 31.1035;

interface StooqSymbol {
  symbol: string;
  date: string;
  close: number | string;
}
interface StooqResponse {
  symbols?: StooqSymbol[];
}

async function fetchFromStooq(): Promise<{ price: number; source: string }> {
  const [goldRes, usdCny] = await Promise.all([
    axios.get<StooqResponse>(
      'https://stooq.com/q/l/?s=gc.f&f=sd2t2ohlcv&e=json',
      { timeout: 10000 }
    ),
    fetchUsdCny(),
  ]);

  const sym = goldRes.data?.symbols?.[0];
  if (!sym) throw new Error('Stooq XAUUSD: no symbol');

  const close = typeof sym.close === 'string' ? parseFloat(sym.close) : sym.close;
  if (!close || isNaN(close) || close <= 0) {
    throw new Error(`Stooq XAUUSD: invalid close="${sym.close}"`);
  }

  // USD/oz → CNY/g
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
        xauCny: result.price, // CNY/g
      } satisfies IPriceData;
    },
    'SGE-Price',
    { maxAttempts: 3, baseDelayMs: 2000 }
  );
}
