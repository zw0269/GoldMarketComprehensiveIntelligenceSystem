/**
 * 技术分析计算引擎 (T-211 ~ T-218)
 * 使用 technicalindicators 库
 */
import {
  SMA, EMA, MACD, RSI, BollingerBands, Stochastic,
} from 'technicalindicators';
import type { IOHLCV } from '../../types';

export interface TechnicalResult {
  ma: Record<string, number | null>;
  macd: { macd: number; signal: number; histogram: number } | null;
  rsi: number | null;
  bollingerBands: { upper: number; middle: number; lower: number } | null;
  kdj: { k: number; d: number; j: number } | null;
  supportLevels: number[];
  resistanceLevels: number[];
  fibLevels: Record<string, number>;
}

// T-211: OHLCV K线聚合
export function aggregateOHLCV(
  minuteBars: { ts: number; xau_usd: number }[],
  intervalMinutes: number
): IOHLCV[] {
  const timeframeMap: Record<number, IOHLCV['timeframe']> = {
    1: '1m', 5: '5m', 15: '15m', 60: '1h', 240: '4h', 1440: '1d', 10080: '1w',
  };

  const buckets = new Map<number, { ts: number; prices: number[] }>();
  const intervalMs = intervalMinutes * 60 * 1000;

  for (const bar of minuteBars) {
    const bucket = Math.floor(bar.ts / intervalMs) * intervalMs;
    if (!buckets.has(bucket)) buckets.set(bucket, { ts: bucket, prices: [] });
    buckets.get(bucket)!.prices.push(bar.xau_usd);
  }

  return Array.from(buckets.values())
    .sort((a, b) => a.ts - b.ts)
    .map(b => ({
      timestamp: b.ts,
      open: b.prices[0],
      high: Math.max(...b.prices),
      low: Math.min(...b.prices),
      close: b.prices[b.prices.length - 1],
      timeframe: timeframeMap[intervalMinutes] ?? '1m',
    }));
}

// T-212: MA / EMA 计算
export function calculateMovingAverages(closes: number[]): Record<string, number | null> {
  const periods = [5, 10, 20, 60, 120, 250];
  const result: Record<string, number | null> = {};

  for (const period of periods) {
    if (closes.length < period) {
      result[`MA${period}`] = null;
      result[`EMA${period}`] = null;
      continue;
    }
    const smaValues = SMA.calculate({ period, values: closes });
    const emaValues = EMA.calculate({ period, values: closes });
    result[`MA${period}`] = smaValues[smaValues.length - 1] ?? null;
    result[`EMA${period}`] = emaValues[emaValues.length - 1] ?? null;
  }

  return result;
}

// T-213: MACD (12, 26, 9)
export function calculateMACD(closes: number[]): { macd: number; signal: number; histogram: number } | null {
  if (closes.length < 26) return null;
  const results = MACD.calculate({
    values: closes,
    fastPeriod: 12,
    slowPeriod: 26,
    signalPeriod: 9,
    SimpleMAOscillator: false,
    SimpleMASignal: false,
  });
  const last = results[results.length - 1];
  if (!last) return null;
  return {
    macd: last.MACD ?? 0,
    signal: last.signal ?? 0,
    histogram: last.histogram ?? 0,
  };
}

// T-214: RSI (14)
export function calculateRSI(closes: number[], period = 14): number | null {
  if (closes.length < period + 1) return null;
  const values = RSI.calculate({ values: closes, period });
  return values[values.length - 1] ?? null;
}

// T-215: 布林带 (20, 2σ)
export function calculateBollingerBands(
  closes: number[],
  period = 20,
  stdDev = 2
): { upper: number; middle: number; lower: number } | null {
  if (closes.length < period) return null;
  const results = BollingerBands.calculate({ period, values: closes, stdDev });
  const last = results[results.length - 1];
  if (!last) return null;
  return { upper: last.upper, middle: last.middle, lower: last.lower };
}

// T-216: KDJ 随机指标
export function calculateKDJ(
  highs: number[],
  lows: number[],
  closes: number[],
  period = 9
): { k: number; d: number; j: number } | null {
  if (closes.length < period) return null;
  const results = Stochastic.calculate({
    high: highs,
    low: lows,
    close: closes,
    period,
    signalPeriod: 3,
  });
  const last = results[results.length - 1];
  if (!last) return null;
  const k = last.k;
  const d = last.d;
  const j = 3 * k - 2 * d;
  return { k, d, j };
}

// T-217: 支撑/阻力位自动识别（局部极值法）
export function findSupportResistanceLevels(
  prices: number[],
  lookback = 5,
  tolerance = 0.005
): { supports: number[]; resistances: number[] } {
  const supports: number[] = [];
  const resistances: number[] = [];

  for (let i = lookback; i < prices.length - lookback; i++) {
    const window = prices.slice(i - lookback, i + lookback + 1);
    const current = prices[i];
    const isMin = window.every(p => p >= current);
    const isMax = window.every(p => p <= current);

    if (isMin) supports.push(current);
    if (isMax) resistances.push(current);
  }

  // 合并相近价位（在 tolerance 范围内）
  const merge = (levels: number[]) => {
    const sorted = [...new Set(levels)].sort((a, b) => a - b);
    const merged: number[] = [];
    for (const lvl of sorted) {
      if (merged.length === 0 || Math.abs(lvl - merged[merged.length - 1]) / lvl > tolerance) {
        merged.push(lvl);
      } else {
        merged[merged.length - 1] = (merged[merged.length - 1] + lvl) / 2;
      }
    }
    return merged.slice(-5); // 取最近5个支撑/阻力
  };

  return {
    supports: merge(supports),
    resistances: merge(resistances),
  };
}

// T-218: 斐波那契回撤位（自动取最近一波趋势）
export function calculateFibonacciLevels(
  high: number,
  low: number
): Record<string, number> {
  const diff = high - low;
  return {
    '0.0': high,
    '23.6': high - diff * 0.236,
    '38.2': high - diff * 0.382,
    '50.0': high - diff * 0.500,
    '61.8': high - diff * 0.618,
    '78.6': high - diff * 0.786,
    '100.0': low,
    // 延伸位
    '127.2': low - diff * 0.272,
    '161.8': low - diff * 0.618,
  };
}

/** 综合计算所有技术指标 */
export function calculateAllIndicators(ohlcv: IOHLCV[]): TechnicalResult {
  const closes = ohlcv.map(b => b.close);
  const highs = ohlcv.map(b => b.high);
  const lows = ohlcv.map(b => b.low);

  const { supports, resistances } = findSupportResistanceLevels(closes);
  const recentHigh = Math.max(...highs.slice(-60));
  const recentLow = Math.min(...lows.slice(-60));

  return {
    ma: calculateMovingAverages(closes),
    macd: calculateMACD(closes),
    rsi: calculateRSI(closes),
    bollingerBands: calculateBollingerBands(closes),
    kdj: calculateKDJ(highs, lows, closes),
    supportLevels: supports,
    resistanceLevels: resistances,
    fibLevels: calculateFibonacciLevels(recentHigh, recentLow),
  };
}
