/**
 * SGE Au99.99 价格采集器
 *
 * 主源：腾讯财经 hf_XAU（USD/oz）× ExchangeRate-API（USD/CNY）÷ 31.1035 → CNY/g
 * 新浪财经和东方财富 push2 均对云服务器返回 403/连接失败，已移除。
 */
import axios from 'axios';
import logger from '../../utils/logger';
import { withRetry } from '../../utils/retry';
import { fetchUsdCny } from './exchange-rate.collector';
import type { IPriceData } from '../../types';

const OZ_TO_GRAM = 31.1035;

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
};

async function fetchFromTencent(): Promise<{ price: number; source: string }> {
  const [goldRes, usdCny] = await Promise.all([
    axios.get<string>('https://qt.gtimg.cn/q=hf_XAU', {
      headers: HEADERS,
      responseType: 'text',
      timeout: 10000,
    }),
    fetchUsdCny(),
  ]);

  const match = (goldRes.data as string).match(/v_\w+="([^"]+)"/);
  if (!match) throw new Error('Tencent hf_XAU: parse failed');

  const parts = match[1].split(',');
  const xauUsd = parseFloat(parts[0]);
  if (!xauUsd || isNaN(xauUsd) || xauUsd <= 0) {
    throw new Error(`Tencent hf_XAU: invalid price="${parts[0]}"`);
  }

  const price = (xauUsd * usdCny) / OZ_TO_GRAM;
  logger.debug(`[sge] Tencent $${xauUsd}/oz × ${usdCny} = ${price.toFixed(2)} CNY/g`);
  return { price, source: 'tencent-sge' };
}

export async function fetchSGEPrice(): Promise<IPriceData | null> {
  return withRetry(
    async () => {
      const result = await fetchFromTencent();
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
