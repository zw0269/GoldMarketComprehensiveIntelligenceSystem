/**
 * 多因子复合告警引擎 (Feature 4)
 *
 * 与 auto-analyst.ts 并存，独立运行，不相互干扰。
 * 评分维度：
 *   1. 价格行情（急涨/急跌）
 *   2. 技术信号（RSI极值、MACD金叉/死叉、布林带突破）
 *   3. 重大新闻（过去30分钟内 ai_impact >= 4）
 *   4. 宏观变动（DXY/US10Y 1天内变化超阈值）
 *   5. 信号等级（STRONG_BUY/STRONG_SELL）
 *
 * 状态机：
 *   calm  — 0-1个因子触发
 *   alert — 2个因子触发，钉钉推送
 *   alarm — 3+同向因子触发，全渠道推送 + AI 生成操作建议
 *
 * 冷却：alarm 60分钟，alert 30分钟（独立于 auto-analyst）
 */
import logger from '../../utils/logger';
import dayjs from 'dayjs';
import { callClaude } from '../ai/claude-client';
import {
  getLatestPrice,
  getPriceHistory as _getPriceHistory,
  getMacroDashboard,
  getLatestNews,
  getLatestSignal,
  getDailyOHLCV,
  insertAgentSuggestion,
  markAgentSuggestionPushed,
} from '../../storage/dao';
import {
  aggregateOHLCV,
  calculateRSI,
  calculateMACD,
  calculateBollingerBands,
} from '../technical/indicators';
import { pushAlert } from '../../push/push-manager';
import { sendDingTalkBrief } from '../../push/dingtalk';

export type WatchState = 'calm' | 'alert' | 'alarm';

// 冷却状态
const cooldowns = new Map<string, number>();
const COOLDOWN_ALARM_MS = 60 * 60_000;
const COOLDOWN_ALERT_MS = 30 * 60_000;

function isOnCooldown(key: string, ms: number): boolean {
  const last = cooldowns.get(key);
  return !!last && Date.now() - last < ms;
}

function setPriceHistory(from: number, to: number, limit: number): Array<{ ts: number; xau_cny_g: number; xau_usd: number }> {
  return _getPriceHistory(from, to, limit) as Array<{ ts: number; xau_cny_g: number; xau_usd: number }>;
}

interface Factor {
  name: string;
  direction: 'bullish' | 'bearish' | 'neutral';
  strength: number; // 1-3
  detail: string;
}

// ── 因子1：价格行情 ───────────────────────────────────────────
function scorePriceAction(): Factor | null {
  try {
    const prices = setPriceHistory(Date.now() - 30 * 60_000, Date.now(), 60);
    if (prices.length < 2) return null;

    const latest = prices[prices.length - 1].xau_cny_g;
    const oldest = prices[0].xau_cny_g;
    if (!latest || !oldest) return null;

    const changePct = (latest - oldest) / oldest * 100;
    const absChange = Math.abs(changePct);

    if (absChange < 0.3) return null;

    return {
      name: '30min价格行情',
      direction: changePct > 0 ? 'bullish' : 'bearish',
      strength: absChange >= 1.0 ? 3 : absChange >= 0.6 ? 2 : 1,
      detail: `30min内${changePct > 0 ? '上涨' : '下跌'} ${Math.abs(changePct).toFixed(2)}%`,
    };
  } catch { return null; }
}

// ── 因子2：技术指标 ───────────────────────────────────────────
function scoreTechnical(): Factor | null {
  try {
    const from = dayjs().subtract(72, 'hour').valueOf();
    const bars = _getPriceHistory(from, Date.now(), 4320) as Array<{ ts: number; xau_usd: number }>;
    if (bars.length < 30) return null;

    const ohlcv  = aggregateOHLCV(bars, 60);
    const closes = ohlcv.map(b => b.close);
    if (closes.length < 20) return null;

    const signals: string[] = [];
    let bullCount = 0, bearCount = 0;

    const rsi = closes.length >= 15 ? calculateRSI(closes, 14) : null;
    if (rsi !== null) {
      if (rsi < 30)      { signals.push(`RSI超卖(${rsi.toFixed(1)})`); bullCount++; }
      else if (rsi > 70) { signals.push(`RSI超买(${rsi.toFixed(1)})`); bearCount++; }
    }

    const macd = closes.length >= 26 ? calculateMACD(closes) : null;
    if (macd) {
      if (macd.histogram > 0 && macd.histogram > macd.signal * 0.1) {
        signals.push('MACD多头'); bullCount++;
      } else if (macd.histogram < 0 && Math.abs(macd.histogram) > Math.abs(macd.signal) * 0.1) {
        signals.push('MACD空头'); bearCount++;
      }
    }

    const bb = closes.length >= 20 ? calculateBollingerBands(closes, 20, 2) : null;
    if (bb) {
      const last = closes[closes.length - 1];
      if (last < bb.lower)      { signals.push('价格跌破布林下轨'); bearCount++; }
      else if (last > bb.upper) { signals.push('价格突破布林上轨'); bullCount++; }
    }

    if (signals.length === 0) return null;
    const netDir = bullCount > bearCount ? 'bullish' : bearCount > bullCount ? 'bearish' : 'neutral';
    const strength = Math.min(3, signals.length) as 1 | 2 | 3;

    return {
      name: '技术指标',
      direction: netDir,
      strength,
      detail: signals.join(' + '),
    };
  } catch { return null; }
}

// ── 因子3：重大新闻 ───────────────────────────────────────────
function scoreNewsImpact(): Factor | null {
  try {
    const recentNews = getLatestNews(20) as Array<Record<string, unknown>>;
    const threshold  = Date.now() - 30 * 60_000;
    const highNews   = recentNews.filter(n =>
      (n['ai_impact'] as number) >= 4 &&
      (n['published_at'] as number || n['ts'] as number || 0) >= threshold
    );

    if (highNews.length === 0) return null;

    const bullish = highNews.filter(n => n['ai_direction'] === 'bullish').length;
    const bearish = highNews.filter(n => n['ai_direction'] === 'bearish').length;

    if (bullish === 0 && bearish === 0) return null;
    const direction = bullish > bearish ? 'bullish' : 'bearish';
    const maxImpact = Math.max(...highNews.map(n => n['ai_impact'] as number));
    const strength  = maxImpact >= 5 ? 3 : highNews.length >= 2 ? 2 : 1;

    return {
      name: '重大新闻',
      direction,
      strength,
      detail: highNews.slice(0, 2).map(n => `[${n['ai_impact']}/5] ${(n['title'] as string).slice(0, 40)}`).join('；'),
    };
  } catch { return null; }
}

// ── 因子4：宏观变动 ───────────────────────────────────────────
function scoreMacroShift(): Factor | null {
  try {
    const macro = getMacroDashboard() as Record<string, unknown>;
    // 简单判断：若DXY存在且已知方向性，对黄金有反向影响
    // 由于缺乏历史宏观时序数据，这里用当前值作阈值判断
    const dxy   = macro['dxy']   as number | undefined;
    const us10y = macro['us10y'] as number | undefined;
    const vix   = macro['vix']   as number | undefined;

    const signals: string[] = [];
    let bullCount = 0, bearCount = 0;

    if (dxy !== undefined) {
      if (dxy < 100)       { signals.push(`DXY弱势(${dxy.toFixed(1)})`); bullCount++; }
      else if (dxy > 106)  { signals.push(`DXY强势(${dxy.toFixed(1)})`); bearCount++; }
    }
    if (us10y !== undefined) {
      if (us10y < 3.8)     { signals.push(`10Y低收益(${us10y.toFixed(2)}%)`); bullCount++; }
      else if (us10y > 4.8){ signals.push(`10Y高收益(${us10y.toFixed(2)}%)`); bearCount++; }
    }
    if (vix !== undefined && vix > 25) {
      signals.push(`VIX恐慌(${vix.toFixed(1)})`); bullCount++;
    }

    if (signals.length === 0) return null;
    const direction = bullCount > bearCount ? 'bullish' : bearCount > bullCount ? 'bearish' : 'neutral';
    return {
      name: '宏观指标',
      direction,
      strength: Math.min(3, signals.length) as 1 | 2 | 3,
      detail: signals.join(' · '),
    };
  } catch { return null; }
}

// ── 关键价格区间常量（USD/oz，基于2026年Q1实证）──────────────
const KEY_LEVELS = {
  IRON_FLOOR_LOW:  4550,  // 铁底下沿
  IRON_FLOOR_HIGH: 4600,  // 铁底上沿（央行Q1均价）
  BOX_HIGH:        4800,  // 震荡箱上轨（Q1市场均价）
};

// 原油危机关键词（美元需求上升→黄金短期利空）
const OIL_CRISIS_KEYWORDS = [
  'hormuz', 'strait', 'oil supply', 'crude shortage', 'embargo', 'blockade', 'oil spike',
  '霍尔木兹', '海峡封锁', '原油供应', '石油危机', '原油短缺',
];

// ── 因子5b：关键价格区间支撑/压力 ──────────────────────────────
function scoreKeyLevelProximity(): Factor | null {
  try {
    const price = getLatestPrice() as Record<string, number> | null;
    if (!price) return null;
    const usd = price['xau_usd'];
    if (!usd) return null;

    // 铁底区间：$4550-4600 → 强支撑，历史央行买入成本区
    if (usd >= KEY_LEVELS.IRON_FLOOR_LOW && usd <= KEY_LEVELS.IRON_FLOOR_HIGH) {
      return {
        name: '央行铁底',
        direction: 'bullish',
        strength: 2,
        detail: `$${usd.toFixed(0)} 处于央行成本铁底区$${KEY_LEVELS.IRON_FLOOR_LOW}-$${KEY_LEVELS.IRON_FLOOR_HIGH}，逆周期支撑强`,
      };
    }
    // 跌破铁底：极端超跌
    if (usd < KEY_LEVELS.IRON_FLOOR_LOW) {
      return {
        name: '跌破铁底',
        direction: 'bullish',
        strength: 3,
        detail: `$${usd.toFixed(0)} 跌破央行成本铁底$${KEY_LEVELS.IRON_FLOOR_LOW}，历史极端超跌区，反弹概率极高`,
      };
    }
    // 箱体上轨压力：$4750-4850
    if (usd >= KEY_LEVELS.BOX_HIGH - 50 && usd <= KEY_LEVELS.BOX_HIGH + 100) {
      return {
        name: '箱体上轨',
        direction: 'bearish',
        strength: 1,
        detail: `$${usd.toFixed(0)} 接近Q1均价/箱体上轨$${KEY_LEVELS.BOX_HIGH}，注意阻力`,
      };
    }
    return null;
  } catch { return null; }
}

// ── 因子5c：原油危机新闻（美元需求支撑→黄金短期利空）──────────
function scoreOilCrisisRisk(): Factor | null {
  try {
    const recentNews = getLatestNews(20) as Array<Record<string, unknown>>;
    const threshold  = Date.now() - 60 * 60_000; // 1小时内
    const oilNews    = recentNews.filter(n => {
      const ts = (n['published_at'] as number || n['ts'] as number || 0);
      if (ts < threshold) return false;
      const text = ((n['title'] as string) + ' ' + (n['summary'] as string ?? '')).toLowerCase();
      return OIL_CRISIS_KEYWORDS.some(kw => text.includes(kw.toLowerCase()));
    });
    if (oilNews.length === 0) return null;
    return {
      name: '原油危机',
      direction: 'bearish',
      strength: 1,
      detail: `⛽ 原油危机新闻${oilNews.length}条，美元需求上升短期压制黄金（危机解除后看多）`,
    };
  } catch { return null; }
}

// ── 因子5：信号等级 ───────────────────────────────────────────
function scoreSignalLevel(): Factor | null {
  try {
    const sig = getLatestSignal() as Record<string, unknown> | null;
    if (!sig) return null;

    const signal = sig['signal'] as string;
    const conf   = sig['confidence'] as number;
    const sigTs  = sig['ts'] as number;

    // 只看30分钟内的信号
    if (Date.now() - sigTs > 30 * 60_000) return null;
    if (conf < 60) return null;

    if (signal === 'STRONG_BUY')  return { name: '系统信号', direction: 'bullish', strength: 3, detail: `STRONG_BUY 置信${conf}%` };
    if (signal === 'BUY')         return { name: '系统信号', direction: 'bullish', strength: 2, detail: `BUY 置信${conf}%` };
    if (signal === 'STRONG_SELL') return { name: '系统信号', direction: 'bearish', strength: 3, detail: `STRONG_SELL 置信${conf}%` };
    if (signal === 'SELL')        return { name: '系统信号', direction: 'bearish', strength: 2, detail: `SELL 置信${conf}%` };

    return null;
  } catch { return null; }
}

// ── 综合评估 ──────────────────────────────────────────────────
export function evaluateComposite(factors: (Factor | null)[]): {
  state: WatchState;
  alignedCount: number;
  direction: 'bullish' | 'bearish' | 'mixed';
  factorList: string[];
  score: number;
} {
  const active = factors.filter(Boolean) as Factor[];
  if (active.length === 0) return { state: 'calm', alignedCount: 0, direction: 'mixed', factorList: [], score: 0 };

  const bullScore = active.filter(f => f.direction === 'bullish').reduce((s, f) => s + f.strength, 0);
  const bearScore = active.filter(f => f.direction === 'bearish').reduce((s, f) => s + f.strength, 0);

  const direction: 'bullish' | 'bearish' | 'mixed' = bullScore > bearScore * 1.2 ? 'bullish'
    : bearScore > bullScore * 1.2 ? 'bearish' : 'mixed';

  const alignedCount = direction === 'bullish'
    ? active.filter(f => f.direction === 'bullish').length
    : direction === 'bearish'
    ? active.filter(f => f.direction === 'bearish').length
    : active.length;

  const score = Math.max(bullScore, bearScore);
  const state: WatchState = score >= 6 ? 'alarm' : score >= 3 ? 'alert' : 'calm';
  const factorList = active.map(f => `${f.name}(${f.detail})`);

  return { state, alignedCount, direction, factorList, score };
}

// ── 主入口（每5分钟调用）────────────────────────────────────────
export async function runCompositeAlert(): Promise<void> {
  const factors = [
    scorePriceAction(),
    scoreTechnical(),
    scoreNewsImpact(),
    scoreMacroShift(),
    scoreSignalLevel(),
    scoreKeyLevelProximity(),
    scoreOilCrisisRisk(),
  ];

  const { state, alignedCount, direction, factorList, score } = evaluateComposite(factors);

  if (state === 'calm') return;

  const cooldownKey = `${state}_${direction}`;
  const cooldownMs  = state === 'alarm' ? COOLDOWN_ALARM_MS : COOLDOWN_ALERT_MS;
  if (isOnCooldown(cooldownKey, cooldownMs)) return;
  cooldowns.set(cooldownKey, Date.now());

  const price = getLatestPrice() as Record<string, number> | null;
  const cnyG  = price?.['xau_cny_g']?.toFixed(2) ?? 'N/A';
  const usd   = price?.['xau_usd']?.toFixed(2) ?? 'N/A';

  logger.info('[composite-alert] triggered', { state, score, direction, alignedCount, factors: factorList });

  let suggestion = '';
  let action = '';
  let confidence = 0;
  let entry: number | undefined;
  let stopLoss: number | undefined;
  let target: number | undefined;

  // alarm 状态：AI 生成具体操作建议（结合实时价格、历史走势、新闻、交易策略）
  if (state === 'alarm') {
    try {
      // 获取7日历史价格走势
      const dayBars = getDailyOHLCV(7) as Array<Record<string, unknown>>;
      const histPriceSummary = dayBars.slice(0, 7).reverse()
        .map(d => `${d['date']} ¥${(d['xau_cny_g'] ?? d['close_cny_g'] ?? 'N/A')}/g`)
        .join(' → ');

      // 获取近30分钟价格走势
      const recentPrices = _getPriceHistory(Date.now() - 30 * 60_000, Date.now(), 30) as Array<{ ts: number; xau_cny_g: number }>;
      const recentTrend = recentPrices.length >= 2
        ? `30min走势：¥${recentPrices[0].xau_cny_g?.toFixed(2)} → ¥${recentPrices[recentPrices.length - 1].xau_cny_g?.toFixed(2)}`
        : '';

      // 获取近期高影响力新闻（3小时内 impact>=3）
      const recentNews = getLatestNews(30) as Array<Record<string, unknown>>;
      const threshold3h = Date.now() - 3 * 3600_000;
      const highNews = recentNews
        .filter(n => (n['ai_impact'] as number) >= 3 && ((n['published_at'] as number || n['ts'] as number || 0) >= threshold3h))
        .slice(0, 5)
        .map(n => `[影响${n['ai_impact']}/5·${n['ai_direction']}] ${(n['title'] as string).slice(0, 60)}`);

      // 获取宏观数据
      const macro = getMacroDashboard() as Record<string, unknown>;
      const macroStr = [
        macro['dxy']   ? `DXY=${macro['dxy']}` : '',
        macro['us10y'] ? `US10Y=${macro['us10y']}%` : '',
        macro['vix']   ? `VIX=${macro['vix']}` : '',
        macro['usd_cny'] ? `USD/CNY=${macro['usd_cny']}` : '',
      ].filter(Boolean).join(' · ');

      const SYSTEM = `你是Gold Sentinel黄金交易员，内置以下分析框架，用于判断信号真实性和操作策略：

【框架1·流动性需求】危机时黄金被抛售救急→短期利空；央行"卖出"需区分现货vs掉期，掉期质押≠真正减持。
【框架2·原油-美元-黄金三角】油价危机→美元强→金承压；危机解除→美元失支撑→金大幅反弹。持仓策略：危机期观望，解除后果断做多。
【框架3·央行逆周期支撑】金价跌近$4550-4600（各国央行Q1均价成本）→央行加大购金→铁底支撑极强，跌入此区是建仓窗口。
【框架4·美国信用侵蚀】欧洲黄金回流美国=去美元化，结构性长线看多，短期可能引发阶段性波动。
【框架5·关键区间】铁底$4550-4600；震荡箱$4600-4800；突破触发：原油危机解除。
【交易纪律】开仓前必须确认入场理由+止损价+目标价；单次暴利不能掩盖系统缺失；没有记录的信号就是赌博。

分析时必须结合：实时价格、历史走势、近期新闻、宏观指标、当前技术因子，综合判断趋势。
输出JSON格式，不超过300字：
{
  "action": "立即买入|分批建仓|立即卖出|减仓|观望",
  "confidence": 0-100,
  "entry": 入场价CNY,
  "stop_loss": 止损价CNY,
  "target": 目标价CNY,
  "reasoning": "结合历史走势+新闻+技术框架的2-3句话理由，需说明当前所处结构位置"
}`;

      const prompt = `当前黄金价格：¥${cnyG}/g（$${usd}/oz）

【历史价格走势（近7日）】
${histPriceSummary || '（暂无历史数据）'}
${recentTrend}

【宏观指标】
${macroStr || '（暂无）'}

【近3小时重要新闻（impact≥3）】
${highNews.length > 0 ? highNews.join('\n') : '（无高影响力新闻）'}

【多因子告警触发】（${alignedCount}个同向${direction === 'bullish' ? '看涨' : '看跌'}信号）：
${factorList.join('\n')}

请结合历史走势、实时新闻、宏观环境和内置分析框架，输出JSON格式操作建议：`;

      const resp = await callClaude(SYSTEM, prompt, 512, 'composite_alert');
      const jsonMatch = resp.match(/\{[\s\S]+\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]) as {
          action?: string; confidence?: number;
          entry?: number; stop_loss?: number; target?: number; reasoning?: string;
        };
        action     = parsed.action ?? '';
        confidence = parsed.confidence ?? 0;
        entry      = parsed.entry;
        stopLoss   = parsed.stop_loss;
        target     = parsed.target;
        suggestion = `${action}（置信${confidence}%）\n入场¥${entry ?? 'N/A'} 止损¥${stopLoss ?? 'N/A'} 目标¥${target ?? 'N/A'}\n${parsed.reasoning ?? ''}`;
      }
    } catch (err) {
      logger.warn('[composite-alert] AI suggestion failed', { err });
      suggestion = `${direction === 'bullish' ? '看涨' : '看跌'}信号聚集，请关注市场。`;
    }
  } else {
    suggestion = `${alignedCount}个因子同向：${factorList.slice(0, 2).join('；')}`;
  }

  // 存库
  const id = insertAgentSuggestion({
    watchState: state,
    triggerFactors: factorList,
    factorCount: alignedCount,
    suggestion,
    action: action || undefined,
    confidence: confidence || undefined,
    entry,
    stopLoss,
    target,
  });

  // 推送
  const stateEmoji = state === 'alarm' ? '🚨' : '⚠️';
  const dirEmoji   = direction === 'bullish' ? '📈' : direction === 'bearish' ? '📉' : '↔️';

  if (state === 'alarm') {
    await pushAlert(
      'signal',
      'critical',
      `${stateEmoji} 多因子报警：${dirEmoji}${direction === 'bullish' ? '看涨' : '看跌'}信号聚集`,
      [
        `**当前价格：¥${cnyG}/g（$${usd}）**`,
        `触发因子（${alignedCount}个）：`,
        ...factorList.map(f => `• ${f}`),
        '',
        suggestion,
      ].join('\n'),
      { state, score, direction, factorCount: alignedCount }
    );
    markAgentSuggestionPushed(id, ['dingtalk', 'telegram', 'email']);
  } else {
    await sendDingTalkBrief(
      `${stateEmoji} 市场预警：${dirEmoji}${alignedCount}个同向信号`,
      [
        `**价格：¥${cnyG}/g**`,
        factorList.map(f => `• ${f}`).join('\n'),
        '',
        suggestion,
        `🕐 ${new Date().toLocaleString('zh-CN')}`,
      ].join('\n')
    );
    markAgentSuggestionPushed(id, ['dingtalk']);
  }
}
