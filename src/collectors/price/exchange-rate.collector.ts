/**
 * 美元/人民币汇率采集器
 * 主源: 新浪财经 USDCNY 实时汇率（免费）
 * 备用: exchangerate-api.com
 */
import axios from 'axios';
import config from '../../config';
import logger from '../../utils/logger';
import { withRetry } from '../../utils/retry';

let cachedRate: { rate: number; ts: number } | null = null;
const CACHE_TTL_MS = 5 * 60 * 1000; // 5分钟缓存

async function fetchFromSina(): Promise<number> {
  const res = await axios.get('https://hq.sinajs.cn/list=fx_susdcny', {
    headers: {
      Referer: 'https://finance.sina.com.cn/',
      'User-Agent': 'Mozilla/5.0',
    },
    timeout: 8000,
    responseType: 'arraybuffer',
  });
  const text = Buffer.from(res.data as ArrayBuffer).toString('latin1');
  const match = text.match(/"([^"]+)"/);
  if (!match) throw new Error('Sina USDCNY: parse failed');

  const parts = match[1].split(',');
  const rate = parseFloat(parts[1]);
  if (!rate || isNaN(rate)) throw new Error(`Sina USDCNY: invalid "${parts[1]}"`);
  return rate;
}

async function fetchFromExchangeRateAPI(): Promise<number> {
  if (!config.api.exchangeRateKey) throw new Error('ExchangeRate API key not set');
  const res = await axios.get(
    `https://v6.exchangerate-api.com/v6/${config.api.exchangeRateKey}/pair/USD/CNY`,
    { timeout: 8000 }
  );
  const data = res.data as { conversion_rate?: number };
  if (!data.conversion_rate) throw new Error('ExchangeRate API: no rate');
  return data.conversion_rate;
}

export async function fetchUsdCny(): Promise<number> {
  // 返回缓存
  if (cachedRate && Date.now() - cachedRate.ts < CACHE_TTL_MS) {
    return cachedRate.rate;
  }

  const rate = await withRetry(
    async () => {
      try {
        return await fetchFromSina();
      } catch (err) {
        logger.warn('[exchange-rate] Sina failed, trying ExchangeRate API', { err });
        return fetchFromExchangeRateAPI();
      }
    },
    'USD/CNY',
    { maxAttempts: 3, baseDelayMs: 2000 }
  );

  cachedRate = { rate, ts: Date.now() };
  logger.debug('[exchange-rate] USD/CNY', { rate });
  return rate;
}
