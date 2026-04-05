/**
 * MetalpriceAPI 价格采集器
 * 文档: https://metalpriceapi.com/documentation
 * 免费层: 100 次/月, 支持 XAU/USD + XAU/CNY
 */
import axios from 'axios';
import config from '../../config';
import logger from '../../utils/logger';
import { withRetry } from '../../utils/retry';
import type { IPriceData } from '../../types';

const BASE_URL = 'https://api.metalpriceapi.com/v1';

interface MetalpriceResponse {
  success: boolean;
  base: string;
  timestamp: number;
  rates: Record<string, number>;
}

export async function fetchMetalpriceData(): Promise<IPriceData | null> {
  if (!config.api.metalpriceKey) {
    logger.warn('[metalprice] API key not configured, skipping');
    return null;
  }

  return withRetry(
    async () => {
      const res = await axios.get<MetalpriceResponse>(`${BASE_URL}/latest`, {
        params: {
          api_key: config.api.metalpriceKey,
          base: 'XAU',
          currencies: 'USD,CNY',
        },
        timeout: 10000,
      });

      const { rates, timestamp } = res.data;
      const xauUsd = 1 / rates['USD'];   // XAU/USD
      const xauCny = 1 / rates['CNY'];   // XAU/CNY (per troy oz)
      const usdCny = rates['CNY'] / rates['USD'];

      return {
        source: 'metalprice',
        timestamp: timestamp * 1000,
        xauUsd,
        xauCny: xauCny / 32.1507,  // 转换为 CNY/g
        usdCny,
      } satisfies IPriceData;
    },
    'MetalpriceAPI',
    { maxAttempts: 3, baseDelayMs: 2000 }
  );
}
