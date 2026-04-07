/**
 * 美元/人民币汇率采集器
 *
 * 主源：exchangerate-api.com 免费端点（无需Key，云服务器实测 200）
 * 备源：exchangerate-api.com v6 带Key版本
 * 注意：新浪财经 hq.sinajs.cn 对云服务器返回 403，已移除。
 */
import axios from 'axios';
import config from '../../config';
import logger from '../../utils/logger';
import { withRetry } from '../../utils/retry';

let cachedRate: { rate: number; ts: number } | null = null;
const CACHE_TTL_MS = 5 * 60 * 1000;

async function fetchFromExchangeRateAPIFree(): Promise<number> {
  const res = await axios.get('https://api.exchangerate-api.com/v4/latest/USD', {
    timeout: 8000,
  });
  const data = res.data as { rates?: Record<string, number> };
  const rate = data?.rates?.CNY;
  if (!rate) throw new Error('ExchangeRate-API free: no CNY rate');
  return rate;
}

async function fetchFromExchangeRateAPIV6(): Promise<number> {
  if (!config.api.exchangeRateKey) throw new Error('ExchangeRate API key not set');
  const res = await axios.get(
    `https://v6.exchangerate-api.com/v6/${config.api.exchangeRateKey}/pair/USD/CNY`,
    { timeout: 8000 }
  );
  const data = res.data as { conversion_rate?: number };
  if (!data.conversion_rate) throw new Error('ExchangeRate API v6: no rate');
  return data.conversion_rate;
}

export async function fetchUsdCny(): Promise<number> {
  if (cachedRate && Date.now() - cachedRate.ts < CACHE_TTL_MS) {
    return cachedRate.rate;
  }

  const rate = await withRetry(
    async () => {
      try {
        return await fetchFromExchangeRateAPIFree();
      } catch (err) {
        logger.warn('[exchange-rate] free API failed, trying v6', { err });
        return fetchFromExchangeRateAPIV6();
      }
    },
    'USD/CNY',
    { maxAttempts: 3, baseDelayMs: 2000 }
  );

  cachedRate = { rate, ts: Date.now() };
  logger.debug('[exchange-rate] USD/CNY', { rate });
  return rate;
}
