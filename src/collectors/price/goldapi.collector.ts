/**
 * GoldAPI.io 备用价格采集器
 * 文档: https://www.goldapi.io/dashboard
 */
import axios from 'axios';
import config from '../../config';
import logger from '../../utils/logger';
import { withRetry } from '../../utils/retry';
import type { IPriceData } from '../../types';

const BASE_URL = 'https://www.goldapi.io/api';

interface GoldAPIResponse {
  timestamp: number;
  metal: string;
  currency: string;
  price: number;
  ch: number;
  chp: number;
}

export async function fetchGoldAPIData(): Promise<IPriceData | null> {
  if (!config.api.goldApiKey) {
    logger.warn('[goldapi] API key not configured, skipping');
    return null;
  }

  return withRetry(
    async () => {
      const res = await axios.get<GoldAPIResponse>(`${BASE_URL}/XAU/USD`, {
        headers: {
          'x-access-token': config.api.goldApiKey,
          'Content-Type': 'application/json',
        },
        timeout: 10000,
      });

      return {
        source: 'goldapi',
        timestamp: res.data.timestamp * 1000,
        xauUsd: res.data.price,
      } satisfies IPriceData;
    },
    'GoldAPI.io',
    { maxAttempts: 3, baseDelayMs: 2000 }
  );
}
