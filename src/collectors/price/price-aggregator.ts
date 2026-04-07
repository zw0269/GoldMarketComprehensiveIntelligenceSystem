/**
 * 多源价格聚合器
 * T-107: 中位数去噪 + 来源权重
 * T-108: SGE 溢价计算
 */
import { fetchMetalpriceData } from './metalprice.collector';
import { fetchGoldAPIData } from './goldapi.collector';
import { fetchSGEPrice } from './sge.collector';
import { fetchUsdCny } from './exchange-rate.collector';
import { fetchEastmoneyRealtimePrice } from './eastmoney-realtime.collector';
import logger from '../../utils/logger';
import type { IPriceData } from '../../types';

// 各数据源权重（API可靠度）
const SOURCE_WEIGHTS: Record<string, number> = {
  metalprice:    1.0,   // 付费 API，最高可信度
  goldapi:       0.9,   // 付费 API
  goldpricez:    0.7,
  yahoo_gc:      0.85,  // Yahoo Finance GC=F，免费，稳定可信
  sina_shfe:     0.75,  // 新浪 SHFE 现货，免费，国内直连
  eastmoney_rt:  0.75,
};

// 每克troy盎司转换系数
const OZ_TO_GRAM = 31.1035;

function weightedMedian(values: { value: number; weight: number }[]): number {
  if (values.length === 0) throw new Error('No price data to aggregate');
  if (values.length === 1) return values[0].value;

  const sorted = [...values].sort((a, b) => a.value - b.value);
  const totalWeight = sorted.reduce((s, v) => s + v.weight, 0);
  let cumulative = 0;
  for (const item of sorted) {
    cumulative += item.weight;
    if (cumulative >= totalWeight / 2) return item.value;
  }
  return sorted[sorted.length - 1].value;
}

export interface AggregatedPrice {
  timestamp: number;
  xauUsd: number;         // 国际金价 USD/oz (聚合后)
  xauCny: number;         // 国际金价 CNY/g (换算)
  xauCnySge?: number;     // SGE Au99.99 价格 CNY/g
  usdCny: number;         // 美元/人民币汇率
  sgePremiumUsd?: number; // SGE 溢价 USD/oz
  sgePremiumPct?: number; // SGE 溢价百分比
  sources: string[];      // 参与聚合的数据源
}

export async function aggregatePrices(): Promise<AggregatedPrice> {
  // 并发采集所有价格源（eastmoney_rt 为无需 Key 的免费兜底源）
  const [metalpriceData, goldAPIData, emRealtimeData, sgeData, usdCny] = await Promise.allSettled([
    fetchMetalpriceData(),
    fetchGoldAPIData(),
    fetchEastmoneyRealtimePrice(),
    fetchSGEPrice(),
    fetchUsdCny(),
  ]);

  // 提取 USD/CNY 汇率
  const rate = usdCny.status === 'fulfilled' && usdCny.value
    ? usdCny.value
    : 7.25; // 兜底汇率

  // 收集有效的 XAU/USD 价格
  const xauSources: { value: number; weight: number; source: string }[] = [];

  const addIfValid = (result: PromiseSettledResult<IPriceData | null>, defaultWeight = 1.0) => {
    if (result.status === 'fulfilled' && result.value?.xauUsd) {
      const src = result.value.source;
      xauSources.push({
        value: result.value.xauUsd,
        weight: SOURCE_WEIGHTS[src] ?? defaultWeight,
        source: src,
      });
    } else if (result.status === 'rejected') {
      logger.warn('[aggregator] source failed', { err: result.reason });
    }
  };

  addIfValid(metalpriceData);
  addIfValid(goldAPIData);
  addIfValid(emRealtimeData, 0.8);  // 免费源，无 Key 也能运行

  if (xauSources.length === 0) {
    throw new Error('All price sources failed — cannot aggregate');
  }

  const xauUsd = weightedMedian(xauSources);
  const xauCny = (xauUsd * rate) / OZ_TO_GRAM; // CNY/g

  // SGE 溢价计算
  let xauCnySge: number | undefined;
  let sgePremiumUsd: number | undefined;
  let sgePremiumPct: number | undefined;

  if (sgeData.status === 'fulfilled' && sgeData.value?.xauCny) {
    xauCnySge = sgeData.value.xauCny;
    // SGE 溢价 = SGE价格(CNY/g) - 国际换算价(CNY/g)，再转 USD/oz
    const premiumCnyG = xauCnySge - xauCny;
    sgePremiumUsd = (premiumCnyG / rate) * OZ_TO_GRAM;
    sgePremiumPct = (premiumCnyG / xauCny) * 100;
  }

  const result: AggregatedPrice = {
    timestamp: Date.now(),
    xauUsd,
    xauCny,
    xauCnySge,
    usdCny: rate,
    sgePremiumUsd,
    sgePremiumPct,
    sources: xauSources.map(s => s.source),
  };

  logger.info('[aggregator] price aggregated', {
    xauUsd: xauUsd.toFixed(2),
    xauCny: xauCny.toFixed(2),
    sgePremium: sgePremiumUsd?.toFixed(2),
    sources: result.sources,
  });

  return result;
}
