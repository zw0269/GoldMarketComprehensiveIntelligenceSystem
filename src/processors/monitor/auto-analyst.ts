/**
 * 自动化盯盘分析引擎
 *
 * 职责：
 *   1. 每5分钟检测技术指标状态变化（RSI/MACD/BB）
 *   2. 检测信号等级跃迁（HOLD→BUY 等）
 *   3. 检测高影响力新闻（ai_impact ≥ 4）
 *   4. 触发条件成立时：自动调用AI做完整市场分析，推送操作建议
 *
 * 设计原则：
 *   - 同类触发器冷却 60 分钟，避免刷屏
 *   - 推送内容包含具体入场/止损/目标价，而非仅信号等级
 *   - 不调用 idea-analyzer（用户交互），而是直接调用 callClaude 生成炒手建议
 */

import logger from '../../utils/logger';
import { callClaude } from '../ai/claude-client';
import {
  getPriceHistory as _getPriceHistory,
  getLatestPrice,
  getMacroDashboard,
  getLatestNews,
  getLatestSignal,
  getLatestCOT,
  getLatestETFHolding,
} from '../../storage/dao';

// dao.getPriceHistory 返回 Record<string,unknown>[]，这里做类型适配
function getPriceHistory(from: number, to: number, limit: number): Array<{ ts: number; xau_usd: number }> {
  return _getPriceHistory(from, to, limit) as Array<{ ts: number; xau_usd: number }>;
}
import {
  aggregateOHLCV,
  calculateRSI,
  calculateMACD,
  calculateBollingerBands,
} from '../technical/indicators';
import { sendDingTalkBrief } from '../../push/dingtalk';
import { sendSignalEmail } from '../../push/email';
import dayjs from 'dayjs';

// ── 指标状态快照（进程内保存，用于对比变化）────────────────────
interface IndicatorSnapshot {
  rsi: number | null;
  macdHistogram: number | null;
  bbPosition: 'near_lower' | 'near_upper' | 'middle' | null;
  signalLevel: string | null;
  ts: number;
}

let prevSnapshot: IndicatorSnapshot | null = null;

// ── 冷却状态（triggerKey → 上次推送时间）────────────────────────
const cooldowns = new Map<string, number>();
const COOLDOWN_MS = 60 * 60_000; // 60 分钟冷却

function isCoolingDown(key: string): boolean {
  const last = cooldowns.get(key);
  return !!last && Date.now() - last < COOLDOWN_MS;
}

function markCooldown(key: string) {
  cooldowns.set(key, Date.now());
}

// ── 技术指标采样 ──────────────────────────────────────────────
function sampleIndicators(): IndicatorSnapshot | null {
  try {
    const from = dayjs().subtract(72, 'hour').valueOf();
    const minuteBars = getPriceHistory(from, Date.now(), 4320) as Array<{ ts: number; xau_usd: number }>;
    if (minuteBars.length < 30) return null;

    const ohlcv  = aggregateOHLCV(minuteBars, 60);
    const closes = ohlcv.map(b => b.close);
    if (closes.length < 15) return null;

    const rsi   = closes.length >= 15 ? calculateRSI(closes, 14) : null;
    const macd  = closes.length >= 26 ? calculateMACD(closes)     : null;
    const bb    = closes.length >= 20 ? calculateBollingerBands(closes, 20, 2) : null;

    let bbPosition: IndicatorSnapshot['bbPosition'] = null;
    if (bb && closes.length > 0) {
      const last = closes[closes.length - 1];
      const range = bb.upper - bb.lower;
      if (last < bb.lower + range * 0.15)      bbPosition = 'near_lower';
      else if (last > bb.upper - range * 0.15) bbPosition = 'near_upper';
      else                                      bbPosition = 'middle';
    }

    const signalRaw = getLatestSignal() as Record<string, unknown> | null;
    const signalLevel = (signalRaw?.['signal'] as string) ?? null;

    return {
      rsi,
      macdHistogram: macd?.histogram ?? null,
      bbPosition,
      signalLevel,
      ts: Date.now(),
    };
  } catch {
    return null;
  }
}

// ── 触发条件检测 ──────────────────────────────────────────────
interface Trigger {
  key: string;
  label: string;
  strength: 'strong' | 'moderate';
  direction: 'bullish' | 'bearish' | 'neutral';
}

function detectTriggers(curr: IndicatorSnapshot, prev: IndicatorSnapshot): Trigger[] {
  const triggers: Trigger[] = [];

  // RSI 进入超卖区（跌破30）
  if (curr.rsi !== null && prev.rsi !== null) {
    if (curr.rsi < 30 && prev.rsi >= 30) {
      triggers.push({ key: 'rsi_oversold', label: `RSI跌破30进入超卖区（当前=${curr.rsi.toFixed(1)}）`, strength: 'strong', direction: 'bullish' });
    }
    // RSI 进入超买区（突破70）
    if (curr.rsi > 70 && prev.rsi <= 70) {
      triggers.push({ key: 'rsi_overbought', label: `RSI突破70进入超买区（当前=${curr.rsi.toFixed(1)}）`, strength: 'strong', direction: 'bearish' });
    }
    // RSI 从超卖区回升（金叉式反转）
    if (curr.rsi > 32 && prev.rsi <= 32 && prev.rsi < 30) {
      triggers.push({ key: 'rsi_oversold_exit', label: `RSI从超卖区反弹（${prev.rsi.toFixed(1)}→${curr.rsi.toFixed(1)}）`, strength: 'strong', direction: 'bullish' });
    }
  }

  // MACD 金叉（柱状从负转正）
  if (curr.macdHistogram !== null && prev.macdHistogram !== null) {
    if (curr.macdHistogram > 0 && prev.macdHistogram <= 0) {
      triggers.push({ key: 'macd_golden', label: `MACD金叉（柱状由空转多：${prev.macdHistogram.toFixed(3)}→${curr.macdHistogram.toFixed(3)}）`, strength: 'strong', direction: 'bullish' });
    }
    // MACD 死叉（柱状从正转负）
    if (curr.macdHistogram < 0 && prev.macdHistogram >= 0) {
      triggers.push({ key: 'macd_death', label: `MACD死叉（柱状由多转空：${prev.macdHistogram.toFixed(3)}→${curr.macdHistogram.toFixed(3)}）`, strength: 'strong', direction: 'bearish' });
    }
  }

  // 布林带突破
  if (curr.bbPosition !== prev.bbPosition) {
    if (curr.bbPosition === 'near_lower') {
      triggers.push({ key: 'bb_lower', label: '价格跌至布林下轨附近（超跌区）', strength: 'moderate', direction: 'bullish' });
    }
    if (curr.bbPosition === 'near_upper') {
      triggers.push({ key: 'bb_upper', label: '价格涨至布林上轨附近（超涨区）', strength: 'moderate', direction: 'bearish' });
    }
  }

  // 信号等级跃迁
  if (curr.signalLevel && prev.signalLevel && curr.signalLevel !== prev.signalLevel) {
    const levelWeight: Record<string, number> = {
      STRONG_SELL: -2, SELL: -1, HOLD: 0, BUY: 1, STRONG_BUY: 2,
    };
    const prevW = levelWeight[prev.signalLevel] ?? 0;
    const currW = levelWeight[curr.signalLevel] ?? 0;
    if (Math.abs(currW - prevW) >= 1) {
      const dir = currW > prevW ? 'bullish' : 'bearish';
      triggers.push({
        key: `signal_change_${curr.signalLevel}`,
        label: `交易信号等级跃迁：${prev.signalLevel} → ${curr.signalLevel}`,
        strength: Math.abs(currW - prevW) >= 2 ? 'strong' : 'moderate',
        direction: dir,
      });
    }
  }

  return triggers;
}

// ── 多指标共振检测（多个同向触发 = 更强信号）────────────────────
function detectHighImpactNews(): boolean {
  const news = getLatestNews(20) as Array<Record<string, unknown>>;
  const recentHighImpact = news.filter(n => {
    const impact = n['ai_impact'] as number;
    const ts     = n['ts'] as number;
    const ageMin = (Date.now() - ts) / 60000;
    return impact >= 4 && ageMin < 90; // 90分钟内有高影响新闻
  });
  return recentHighImpact.length > 0;
}

// ── AI 自动分析生成 ────────────────────────────────────────────

const AUTO_ANALYST_SYSTEM = `你是 Gold Sentinel 的自动化盯盘系统，一位有20年经验的黄金交易员。
系统检测到了触发条件，你需要对当前市场状况进行快速深度分析，并给出明确的操作建议。

**必须以以下 JSON 格式响应（不含任何额外文字）：**
{
  "assessment": "市场综合判断（中文，50字以内）",
  "action": "立即买入" | "分批建仓" | "观望等待" | "轻仓试探" | "持仓不动" | "逢高减仓" | "止损离场" | "空仓观望",
  "confidence": 60-95,
  "entry": 建议入场价（CNY/g，数字或null），
  "stopLoss": 止损价（CNY/g，数字或null），
  "target": 目标价（CNY/g，数字或null），
  "riskReward": "1:X.X" 或 null,
  "keyReason": "核心理由（引用具体指标数据，中文，80字以内）",
  "riskWarning": "主要风险（中文，40字以内）",
  "waitForConfirm": true | false
}

⚠️ 价格单位强制要求：entry/stopLoss/target 必须是人民币元/克（CNY/g），积存金正常价格约¥600-¥900/g。`;

async function generateAutoAnalysis(triggers: Trigger[], context: string): Promise<string | null> {
  const triggerDesc = triggers.map(t => `- ${t.label}`).join('\n');
  const userMsg = `
【触发事件】
${triggerDesc}

【当前市场快照】
${context}

请基于上述触发信号和市场数据，给出自动化操作建议。`.trim();

  try {
    return await callClaude(AUTO_ANALYST_SYSTEM, userMsg, 600, 'auto_analysis');
  } catch (err) {
    logger.error('[auto-analyst] AI call failed', { err });
    return null;
  }
}

// ── 推送格式化 ────────────────────────────────────────────────
interface AutoAnalysisResult {
  assessment: string;
  action: string;
  confidence: number;
  entry: number | null;
  stopLoss: number | null;
  target: number | null;
  riskReward: string | null;
  keyReason: string;
  riskWarning: string;
  waitForConfirm: boolean;
}

function fixPriceUnit(val: number | null, currentCnyG: number, usdCny: number): number | null {
  if (val == null) return null;
  if (val > Math.max(currentCnyG * 2, 2000)) {
    return parseFloat(((val * usdCny) / 31.1035).toFixed(2));
  }
  return val;
}

async function pushAutoAnalysis(
  triggers: Trigger[],
  result: AutoAnalysisResult,
  currentPrice: number
) {
  const dominantDir = triggers[0]?.direction ?? 'neutral';
  const emoji = dominantDir === 'bullish' ? '🟢' : dominantDir === 'bearish' ? '🔴' : '🟡';
  const triggerSummary = triggers.map(t => `· ${t.label}`).join('\n');

  const ddContent = [
    `## ${emoji} 自动盯盘分析 — ${result.action}`,
    `**置信度**: ${result.confidence}%`,
    `**当前价格**: ¥${currentPrice.toFixed(2)}/g`,
    '',
    result.entry    ? `**建议入场**: ¥${result.entry}/g` : '',
    result.stopLoss ? `**止损价位**: ¥${result.stopLoss}/g` : '',
    result.target   ? `**目标价位**: ¥${result.target}/g` : '',
    result.riskReward ? `**风险收益比**: ${result.riskReward}` : '',
    '',
    `**核心判断**: ${result.assessment}`,
    `**信号理由**: ${result.keyReason}`,
    `**风险提示**: ${result.riskWarning}`,
    result.waitForConfirm ? '\n> ⏳ 建议等待信号进一步确认后再行动' : '',
    '',
    '**触发条件**:',
    triggerSummary,
    '',
    `> ${dayjs().format('MM-DD HH:mm')} · Gold Sentinel 自动分析`,
  ].filter(s => s !== '').join('\n');

  await sendDingTalkBrief(`${emoji} 自动盯盘 · ${result.action} (${result.confidence}%)`, ddContent);

  // 邮件推送（复用 signal email 结构）
  await sendSignalEmail({
    signal: dominantDir === 'bullish' ? 'BUY' : dominantDir === 'bearish' ? 'SELL' : 'HOLD',
    label: `🤖 自动分析 · ${result.action}`,
    price: currentPrice,
    entry: result.entry,
    stopLoss: result.stopLoss,
    target: result.target,
    riskReward: result.riskReward ? parseFloat(result.riskReward.replace('1:', '')) : null,
    reasons: [result.keyReason, result.riskWarning, ...triggers.map(t => t.label)],
    confidence: result.confidence,
  });

  logger.info('[auto-analyst] analysis pushed', {
    action: result.action,
    confidence: result.confidence,
    triggers: triggers.map(t => t.key),
  });
}

// ── 构建市场快照文本 ──────────────────────────────────────────
function buildMarketContext(): { text: string; cnyG: number; usdCny: number } {
  const price  = getLatestPrice() as Record<string, number> | null;
  const macro  = getMacroDashboard() as Record<string, number>;
  const news   = getLatestNews(10) as Array<Record<string, unknown>>;
  const signal = getLatestSignal() as Record<string, unknown> | null;
  const cot    = getLatestCOT() as Record<string, unknown> | null;
  const gld    = getLatestETFHolding('GLD') as Record<string, unknown> | null;

  const cnyG   = price?.['xau_cny_g']  ?? 750;
  const usdCny = price?.['usd_cny']    ?? 7.25;

  const lines: string[] = [
    `当前时间: ${dayjs().format('YYYY-MM-DD HH:mm')}`,
    '',
    `## 行情`,
    `XAU/USD: $${price?.['xau_usd']?.toFixed(2) ?? 'N/A'}/oz`,
    `XAU/CNY: ¥${cnyG.toFixed(2)}/g`,
    `USD/CNY: ${usdCny.toFixed(4)}`,
    price?.['sge_premium'] != null ? `SGE溢价: $${price['sge_premium'].toFixed(2)}/oz` : '',
    '',
    `## 宏观`,
    `DXY=${macro['DXY']?.toFixed(2) ?? 'N/A'}  US10Y=${macro['US10Y']?.toFixed(3) ?? 'N/A'}%  VIX=${macro['VIX']?.toFixed(2) ?? 'N/A'}`,
    `TIPS实际利率=${macro['TIPS10Y']?.toFixed(3) ?? 'N/A'}%  Fed利率=${macro['FEDRATE']?.toFixed(2) ?? 'N/A'}%`,
    '',
    signal ? `## 当前信号: ${signal['signal']} (评分${signal['score']}, 置信度${signal['confidence']}%)` : '',
    cot    ? `## COT净多头: ${cot['net_long']} 合约` : '',
    gld    ? `## GLD ETF: ${gld['tonnes']}吨` : '',
    '',
    `## 近期要闻（高影响力）`,
    ...(news as Array<Record<string, unknown>>)
      .filter(n => (n['ai_impact'] as number) >= 3)
      .slice(0, 5)
      .map(n => `· [${n['ai_impact']}/5] ${n['title']}`),
  ];

  return { text: lines.filter(l => l !== '').join('\n'), cnyG, usdCny };
}

// ── 主入口：每5分钟调用 ───────────────────────────────────────
export async function runAutoAnalyst(): Promise<void> {
  const curr = sampleIndicators();
  if (!curr) {
    logger.debug('[auto-analyst] insufficient data, skipping');
    return;
  }

  const prev = prevSnapshot;
  prevSnapshot = curr;

  if (!prev) return; // 第一次运行，只采样不比较

  // 检测技术指标触发器
  const triggers = detectTriggers(curr, prev);

  // 检测高影响力新闻
  const hasHighImpactNews = detectHighImpactNews();
  if (hasHighImpactNews && !isCoolingDown('high_impact_news')) {
    triggers.push({ key: 'high_impact_news', label: '近90分钟出现高影响力新闻（影响力≥4/5）', strength: 'strong', direction: 'neutral' });
  }

  // 无有效触发器，静默返回
  if (triggers.length === 0) return;

  // 过滤掉冷却中的触发器
  const activeTriggers = triggers.filter(t => !isCoolingDown(t.key));
  if (activeTriggers.length === 0) return;

  // 多触发器共振时优先选最强的
  const strongTriggers = activeTriggers.filter(t => t.strength === 'strong');
  const finalTriggers  = strongTriggers.length > 0 ? strongTriggers : activeTriggers;

  logger.info('[auto-analyst] triggers detected', { triggers: finalTriggers.map(t => t.key) });

  // 构建市场上下文
  const { text: context, cnyG, usdCny } = buildMarketContext();

  // 调用 AI 生成分析
  const raw = await generateAutoAnalysis(finalTriggers, context);
  if (!raw) return;

  const jsonMatch = raw.match(/\{[\s\S]+\}/);
  if (!jsonMatch) {
    logger.warn('[auto-analyst] AI response has no JSON', { raw: raw.slice(0, 200) });
    return;
  }

  let result: AutoAnalysisResult;
  try {
    result = JSON.parse(jsonMatch[0]) as AutoAnalysisResult;
  } catch {
    logger.warn('[auto-analyst] JSON parse failed');
    return;
  }

  // 修正价格单位
  result.entry    = fixPriceUnit(result.entry,    cnyG, usdCny);
  result.stopLoss = fixPriceUnit(result.stopLoss, cnyG, usdCny);
  result.target   = fixPriceUnit(result.target,   cnyG, usdCny);

  // 标记冷却
  for (const t of finalTriggers) markCooldown(t.key);

  // 推送
  await pushAutoAnalysis(finalTriggers, result, cnyG);
}
