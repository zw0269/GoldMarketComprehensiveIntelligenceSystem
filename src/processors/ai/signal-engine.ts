/**
 * 积存金短线交易信号引擎 (A-001 ~ A-009)
 *
 * 规则驱动，无需 AI 调用，毫秒级响应。
 * 综合 RSI / MACD / 布林带 / SGE溢价 / 新闻情绪 生成 5 级交易信号。
 */
import {
  getPriceHistory,
  getLatestNews,
  getLatestPrice,
  insertSignal,
} from '../../storage/dao';
import {
  aggregateOHLCV,
  calculateRSI,
  calculateMACD,
  calculateBollingerBands,
  findSupportResistanceLevels,
} from '../technical/indicators';
import dayjs from 'dayjs';
import logger from '../../utils/logger';

export type SignalLevel = 'STRONG_BUY' | 'BUY' | 'HOLD' | 'SELL' | 'STRONG_SELL';

export interface TradingSignalResult {
  signal: SignalLevel;
  confidence: number;      // 0-100
  score: number;           // -100 to +100
  reasons: string[];
  entry_cny_g: number | null;
  stop_loss: number | null;
  target_profit: number | null;
  risk_reward: number | null;
  technicals: {
    rsi: number | null;
    macdHistogram: number | null;
    macdCross: string | null;
    bbPosition: string | null;
    sgePremium: number | null;
    newsScore: number;
    priceVsMA20: string | null;
  };
  price_at_signal: number | null;
  generatedAt: number;
}

function scoreToSignal(score: number): SignalLevel {
  if (score >= 50)  return 'STRONG_BUY';
  if (score >= 20)  return 'BUY';
  if (score <= -50) return 'STRONG_SELL';
  if (score <= -20) return 'SELL';
  return 'HOLD';
}

function scoreToConfidence(score: number): number {
  return Math.min(100, Math.round(Math.abs(score)));
}

function usdOzToCnyG(usdOz: number, usdCny: number): number {
  return (usdOz * usdCny) / 31.1035;
}

export async function generateSignal(): Promise<TradingSignalResult> {
  const now = Date.now();

  // ── 1. 获取近 72 小时分钟数据 ───────────────────────────────
  const from72h = dayjs().subtract(72, 'hour').valueOf();
  const minuteBars = getPriceHistory(from72h, now, 4320) as Array<{ ts: number; xau_usd: number }>;

  // ── 2. 聚合为小时 OHLCV ─────────────────────────────────────
  const hourlyBars = aggregateOHLCV(minuteBars, 60);
  const closes = hourlyBars.map(b => b.close);

  // ── 3. 技术指标（返回单值） ──────────────────────────────────
  const rsi = closes.length >= 15 ? calculateRSI(closes) : null;
  const macdResult = closes.length >= 26 ? calculateMACD(closes) : null;
  const macdHistogram = macdResult?.histogram ?? null;
  const bbResult = closes.length >= 20 ? calculateBollingerBands(closes) : null;

  let macdCross: string | null = null;
  let bbPosition: string | null = null;
  let priceVsMA20: string | null = null;

  // MACD 趋势判断（通过柱线符号，单值无法判断金叉，用柱线方向替代）
  if (macdHistogram !== null) {
    if (macdHistogram > 0)  macdCross = 'above_zero';
    else                    macdCross = 'below_zero';
  }

  const currentPrice = closes.length > 0 ? closes[closes.length - 1] : null;

  if (bbResult && currentPrice !== null) {
    const bandWidth = bbResult.upper - bbResult.lower;
    if (bandWidth > 0) {
      const pos = (currentPrice - bbResult.lower) / bandWidth;
      if (pos < 0.2)      bbPosition = 'near_lower';
      else if (pos > 0.8) bbPosition = 'near_upper';
      else                bbPosition = 'middle';
    }
    priceVsMA20 = currentPrice > bbResult.middle ? 'above_ma20' : 'below_ma20';
  }

  // ── 4. 支撑/阻力位（传入 closes 数组） ───────────────────────
  const srResult = closes.length >= 15
    ? findSupportResistanceLevels(closes)
    : { supports: [], resistances: [] };
  const supportLevels  = srResult.supports;
  const resistanceLevels = srResult.resistances;

  // ── 5. SGE溢价 & 实时价格 ──────────────────────────────────
  const latest = getLatestPrice() as Record<string, number> | null;
  const sgePremium = latest?.['sge_premium'] ?? null;
  const usdCny = (latest?.['usd_cny'] as number) ?? 7.2;
  const xauCnyG: number | null = (latest?.['xau_cny_g'] as number) ??
    (currentPrice ? usdOzToCnyG(currentPrice, usdCny) : null);

  // ── 6. 新闻情绪得分 ─────────────────────────────────────────
  const recentNews = getLatestNews(20) as Array<{ ai_impact: number; ai_direction: string }>;
  let newsScoreSum = 0;
  let newsCount = 0;
  for (const n of recentNews) {
    if (n.ai_impact != null && n.ai_impact >= 3) {
      newsScoreSum += n.ai_direction === 'bullish' ? n.ai_impact : -n.ai_impact;
      newsCount++;
    }
  }
  const avgNewsScore = newsCount > 0 ? newsScoreSum / newsCount : 0;

  // ── 7. 综合评分 -100 ~ +100 ────────────────────────────────
  let score = 0;
  const reasons: string[] = [];

  // RSI (-30 ~ +30)
  if (rsi !== null) {
    if (rsi < 25)      { score += 30; reasons.push(`RSI极度超卖 (${rsi.toFixed(1)})，强反弹信号`); }
    else if (rsi < 35) { score += 20; reasons.push(`RSI超卖区间 (${rsi.toFixed(1)})，看多依据`); }
    else if (rsi < 45) { score +=  8; reasons.push(`RSI偏低 (${rsi.toFixed(1)})，中性偏多`); }
    else if (rsi > 75) { score -= 30; reasons.push(`RSI极度超买 (${rsi.toFixed(1)})，高位风险大`); }
    else if (rsi > 65) { score -= 20; reasons.push(`RSI超买 (${rsi.toFixed(1)})，注意回调`); }
    else if (rsi > 55) { score -=  8; reasons.push(`RSI偏高 (${rsi.toFixed(1)})，中性偏空`); }
  }

  // MACD (-25 ~ +25)
  if (macdHistogram !== null) {
    if (macdHistogram > 0) { score += 15; reasons.push(`MACD柱线为正 (${macdHistogram.toFixed(2)})，多头动能`); }
    else                   { score -= 15; reasons.push(`MACD柱线为负 (${macdHistogram.toFixed(2)})，空头动能`); }
  }

  // 布林带位置 (-15 ~ +15)
  if (bbPosition === 'near_lower')  { score += 15; reasons.push('价格触及布林下轨，均值回归机会'); }
  else if (bbPosition === 'near_upper') { score -= 15; reasons.push('价格触及布林上轨，短期超买'); }

  // SGE溢价 (-10 ~ +15)
  if (sgePremium !== null) {
    if (sgePremium > 10)       { score += 15; reasons.push(`SGE溢价$${sgePremium.toFixed(1)}，国内实货需求强劲`); }
    else if (sgePremium > 3)   { score +=  8; reasons.push(`SGE溢价$${sgePremium.toFixed(1)}，国内需求偏强`); }
    else if (sgePremium < -5)  { score -= 10; reasons.push(`SGE折价$${Math.abs(sgePremium).toFixed(1)}，国内需求疲弱`); }
  }

  // 新闻情绪 (-15 ~ +15)
  if (avgNewsScore > 2)  { score += Math.min(15, Math.round(avgNewsScore * 3));  reasons.push(`近期新闻偏多头（情绪分${avgNewsScore.toFixed(1)}）`); }
  if (avgNewsScore < -2) { score += Math.max(-15, Math.round(avgNewsScore * 3)); reasons.push(`近期新闻偏空头（情绪分${avgNewsScore.toFixed(1)}）`); }

  // 支撑/阻力 (-10 ~ +10)
  if (currentPrice !== null && supportLevels.length > 0) {
    const near = supportLevels.find(s => Math.abs(s - currentPrice) / currentPrice < 0.005);
    if (near) { score += 10; reasons.push(`价格临近支撑位 $${near.toFixed(1)}，支撑有效可做多`); }
  }
  if (currentPrice !== null && resistanceLevels.length > 0) {
    const near = resistanceLevels.find(r => Math.abs(r - currentPrice) / currentPrice < 0.005);
    if (near) { score -= 10; reasons.push(`价格临近阻力位 $${near.toFixed(1)}，突破前谨慎`); }
  }

  if (reasons.length === 0) reasons.push('当前无明显技术信号，建议观望');

  // ── 8. 建议进场/止损/目标（CNY/g 单位）──────────────────────
  let entry_cny_g: number | null = null;
  let stop_loss: number | null = null;
  let target_profit: number | null = null;
  let risk_reward: number | null = null;

  if (xauCnyG !== null && currentPrice !== null) {
    const signal = scoreToSignal(score);
    const nearSupport    = supportLevels.filter(s => s < currentPrice).slice(-1)[0] ?? null;
    const nearResistance = resistanceLevels.filter(r => r > currentPrice)[0] ?? null;

    if (signal === 'BUY' || signal === 'STRONG_BUY') {
      entry_cny_g   = parseFloat(xauCnyG.toFixed(2));
      const slUsd   = nearSupport ? nearSupport * 0.997 : currentPrice * 0.985;
      const tpUsd   = nearResistance ? nearResistance * 0.999 : currentPrice * 1.025;
      stop_loss     = parseFloat(usdOzToCnyG(slUsd,   usdCny).toFixed(2));
      target_profit = parseFloat(usdOzToCnyG(tpUsd, usdCny).toFixed(2));
      const risk    = entry_cny_g - stop_loss;
      const reward  = target_profit - entry_cny_g;
      risk_reward   = risk > 0 ? parseFloat((reward / risk).toFixed(2)) : null;
    } else if (signal === 'SELL' || signal === 'STRONG_SELL') {
      entry_cny_g   = parseFloat(xauCnyG.toFixed(2));
      target_profit = nearSupport
        ? parseFloat(usdOzToCnyG(nearSupport, usdCny).toFixed(2))
        : parseFloat((xauCnyG * 0.975).toFixed(2));
    }
  }

  const result: TradingSignalResult = {
    signal: scoreToSignal(score),
    confidence: scoreToConfidence(score),
    score,
    reasons,
    entry_cny_g,
    stop_loss,
    target_profit,
    risk_reward,
    technicals: {
      rsi,
      macdHistogram,
      macdCross,
      bbPosition,
      sgePremium: sgePremium as number | null,
      newsScore: parseFloat(avgNewsScore.toFixed(2)),
      priceVsMA20,
    },
    price_at_signal: xauCnyG,
    generatedAt: now,
  };

  try {
    insertSignal({
      signal: result.signal,
      confidence: result.confidence,
      score: result.score,
      reasons: result.reasons,
      entry_cny_g: result.entry_cny_g ?? undefined,
      stop_loss: result.stop_loss ?? undefined,
      target_profit: result.target_profit ?? undefined,
      risk_reward: result.risk_reward ?? undefined,
      technicals: result.technicals as unknown as Record<string, unknown>,
      price_at_signal: result.price_at_signal ?? undefined,
    });
  } catch (err) {
    logger.warn('[signal-engine] persist failed', { err });
  }

  logger.info('[signal-engine] signal generated', {
    signal: result.signal, confidence: result.confidence, score: result.score,
  });
  return result;
}
