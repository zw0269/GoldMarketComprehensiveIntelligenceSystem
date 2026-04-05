/**
 * FRED API 封装 (T-131)
 * 免费、无限制，支持: 10Y美债、TIPS实际利率、CPI、PCE、非农
 * API文档: https://fred.stlouisfed.org/docs/api/fred/
 */
import axios from 'axios';
import config from '../../config';
import logger from '../../utils/logger';
import { withRetry } from '../../utils/retry';
import type { IMacroData } from '../../types';
import dayjs from 'dayjs';

const FRED_BASE = 'https://api.stlouisfed.org/fred/series/observations';

// FRED 系列 ID 映射
export const FRED_SERIES = {
  US10Y: 'DGS10',         // 10年期美债收益率
  TIPS10Y: 'DFII10',      // 10年TIPS实际利率
  CPI: 'CPIAUCSL',        // CPI（季调）
  PCE: 'PCEPI',           // PCE 通胀
  NONFARM: 'PAYEMS',      // 非农就业（千人）
  FEDRATE: 'FEDFUNDS',    // 联邦基金利率
  GOLD: 'GOLDAMGBD228NLBM', // LBMA 黄金上午定盘价
} as const;

async function fetchFredSeries(
  seriesId: string,
  indicator: string,
  limit = 1
): Promise<IMacroData | null> {
  if (!config.api.fredKey) {
    logger.warn('[fred] API key not configured');
    return null;
  }

  return withRetry(
    async () => {
      const res = await axios.get(FRED_BASE, {
        params: {
          series_id: seriesId,
          api_key: config.api.fredKey,
          file_type: 'json',
          sort_order: 'desc',
          limit,
          observation_end: dayjs().format('YYYY-MM-DD'),
        },
        timeout: 10000,
      });

      const data = res.data as { observations?: Array<{ date: string; value: string }> };
      const obs = data.observations?.find(o => o.value !== '.');
      if (!obs) throw new Error(`FRED ${seriesId}: no valid observation`);

      return {
        date: obs.date,
        indicator,
        value: parseFloat(obs.value),
        source: 'fred',
      } satisfies IMacroData;
    },
    `FRED-${seriesId}`,
    { maxAttempts: 3, baseDelayMs: 2000 }
  );
}

export async function fetchMacroIndicators(): Promise<IMacroData[]> {
  const tasks = [
    fetchFredSeries(FRED_SERIES.US10Y, 'US10Y'),
    fetchFredSeries(FRED_SERIES.TIPS10Y, 'TIPS10Y'),
    fetchFredSeries(FRED_SERIES.CPI, 'CPI'),
    fetchFredSeries(FRED_SERIES.PCE, 'PCE'),
    fetchFredSeries(FRED_SERIES.NONFARM, 'NONFARM'),
    fetchFredSeries(FRED_SERIES.FEDRATE, 'FEDRATE'),
  ];

  const results = await Promise.allSettled(tasks);
  const data: IMacroData[] = [];

  for (const r of results) {
    if (r.status === 'fulfilled' && r.value) {
      data.push(r.value);
    } else if (r.status === 'rejected') {
      logger.warn('[fred] series fetch failed', { err: r.reason });
    }
  }

  logger.info('[fred] macro indicators', { count: data.length });
  return data;
}
