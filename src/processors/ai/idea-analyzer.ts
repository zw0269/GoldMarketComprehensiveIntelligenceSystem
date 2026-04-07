/**
 * 用户想法 AI 分析器 (S-004 升级版)
 *
 * 接入数据：实时价格 · 技术指标 · 当前交易信号 · 宏观 · 新闻 · ETF · 库存 · COT
 * 输出：方向/置信度/支撑逻辑/风险/关键价位/具体操作建议（入场/止损/目标）
 */
import { callClaude } from './claude-client';
import {
  getLatestPrice,
  getMacroDashboard,
  getLatestNews,
  getRecentIdeasForContext,
  insertIdea,
  updateIdeaAnalysis,
  getLatestSignal,
  getLatestCOT,
  getLatestInventory,
  getLatestETFHolding,
  getPriceHistory,
  buildIntelContext,
  insertQALog,
} from '../../storage/dao';
import {
  aggregateOHLCV,
  calculateRSI,
  calculateMACD,
  calculateBollingerBands,
} from '../technical/indicators';
import logger from '../../utils/logger';
import dayjs from 'dayjs';

export interface IdeaAnalysisResult {
  direction: 'bullish' | 'bearish' | 'neutral';
  score: number;           // 1-10 置信度
  action: string;          // 具体操作建议：立即买入 / 观望等待 / 分批建仓 / 减仓 / 止损离场
  summary: string;         // 一句话总结
  supporting: string[];    // 支撑理由（3-5条）
  risks: string[];         // 主要风险（3-5条）
  keyLevels: { label: string; price: number }[];
  entry: number | null;    // 建议入场价 (¥/g)
  stopLoss: number | null; // 止损价 (¥/g)
  target: number | null;   // 目标价 (¥/g)
  riskReward: string | null; // 风险收益比，如 "1:2.5"
  timeframe: string;
  tags: string[];
  evolution: string;
  dataUsed: string[];      // 列出本次分析调用的数据源
}

// ── Prompt ────────────────────────────────────────────────────

const SYSTEM_PROMPT = `你是 Gold Sentinel 的首席黄金交易员，同时具备量化分析和基本面研究双重能力，专注于积存金（中国上金所）短线交易。

你的任务：结合系统提供的多维实时市场数据，对用户的交易想法进行深度综合分析，给出具体可执行的操作建议。

**必须以以下 JSON 格式响应（不含任何额外文字）：**
{
  "direction": "bullish" | "bearish" | "neutral",
  "score": 1-10,
  "action": "立即买入" | "分批建仓" | "观望等待" | "轻仓试探" | "持仓不动" | "逢高减仓" | "止损离场" | "空仓观望",
  "summary": "核心判断（中文，40字以内）",
  "supporting": ["支撑理由1（引用具体数据）", "支撑理由2", "支撑理由3"],
  "risks": ["风险1（引用具体数据）", "风险2", "风险3"],
  "keyLevels": [
    {"label": "关键支撑", "price": 数字},
    {"label": "关键阻力", "price": 数字},
    {"label": "目标价", "price": 数字}
  ],
  "entry": 建议入场价（¥/g，数字或null），
  "stopLoss": 止损价（¥/g，数字或null），
  "target": 目标价（¥/g，数字或null），
  "riskReward": "1:X.X"（风险收益比，字符串或null），
  "timeframe": "日内 | 短期(1-2周) | 中期(1-3月) | 长期(3月+)",
  "tags": ["标签1", "标签2", "标签3"],
  "evolution": "与历史想法的对比演进（如无历史则写'首次分析'）",
  "dataUsed": ["实时价格", "RSI", "MACD", "布林带", "宏观指标", "新闻情报", "ETF持仓", "COMEX库存", "SHFE库存", "CFTC持仓", "当前信号"]
}

**评分标准：**
9-10: 技术+基本面+情绪三重共振，时机极佳
7-8:  主要指标支撑，逻辑清晰
5-6:  有一定依据但存在明显分歧信号
3-4:  逻辑不足或与当前行情明显背离
1-2:  强烈反对，存在重大误判风险

**⚠️ 价格单位强制要求（极其重要）：**
- entry、stopLoss、target、keyLevels 中的 price 字段，全部必须使用【人民币元/克（CNY/g）】单位
- 绝对禁止使用 USD/oz（美元/盎司）或其他单位
- 积存金当前价格约在 ¥600～¥900/g 区间，请据此判断价格合理性
- 上下文中的"XAU/CNY: ¥XXX/g"字段即为当前参考价，所有价格输出必须贴近该值
- 若出现疑似 USD/oz 数值（如3000以上的大数），视为错误，请换算后重新输出

**分析要求：**
- 支撑理由和风险必须引用具体数据（如"RSI=28，接近超卖区间"）
- 止损距离建议不超过1%，目标价看最近阻力位`;

// ── 数据收集 ─────────────────────────────────────────────────

function getTechnicals() {
  try {
    const rows = getPriceHistory('1m', 3) as { data?: unknown[] };
    const candles = (rows.data ?? []) as Array<{ ts: number; open: number; high: number; low: number; close: number; volume: number }>;
    if (candles.length < 20) return null;

    const ohlcv = aggregateOHLCV(candles, 60); // 聚合为1小时K线
    const closes = ohlcv.map(c => c.close);
    if (closes.length < 14) return null;

    const rsi = calculateRSI(closes, 14);
    const macd = calculateMACD(closes);
    const bb = calculateBollingerBands(closes, 20, 2);

    const lastClose = closes[closes.length - 1];
    const bbPos = bb
      ? lastClose < bb.lower + (bb.upper - bb.lower) * 0.2 ? 'near_lower'
        : lastClose > bb.upper - (bb.upper - bb.lower) * 0.2 ? 'near_upper'
        : 'middle'
      : null;

    return { rsi, macd, bb, bbPos, lastClose };
  } catch {
    return null;
  }
}

// ── Context Builder ───────────────────────────────────────────

function buildFullContext(
  price: Record<string, number> | null,
  macro: Record<string, number>,
  news: Record<string, unknown>[],
  signal: Record<string, unknown> | null,
  cot: Record<string, unknown> | null,
  comex: Record<string, unknown> | null,
  shfe: Record<string, unknown> | null,
  gld: Record<string, unknown> | null,
  technicals: ReturnType<typeof getTechnicals>,
): string {
  const lines: string[] = [
    `**当前时间**: ${dayjs().format('YYYY-MM-DD HH:mm')} (UTC+8)`,
    '',
    '## 实时行情',
    `XAU/USD: $${price?.['xau_usd']?.toFixed(2) ?? 'N/A'}/oz`,
    `XAU/CNY: ¥${price?.['xau_cny_g']?.toFixed(2) ?? 'N/A'}/g（积存金参考价）`,
    `SGE溢价: ${price?.['sge_premium'] != null ? `$${Number(price['sge_premium']).toFixed(2)}/oz` : 'N/A'}`,
    `USD/CNY: ${price?.['usd_cny']?.toFixed(4) ?? 'N/A'}`,
  ];

  // 技术指标
  if (technicals) {
    const { rsi, macd, bb, bbPos } = technicals;
    lines.push('', '## 技术指标（1小时K线）');
    lines.push(`RSI(14): ${rsi?.toFixed(1) ?? 'N/A'} ${rsi != null ? (rsi < 30 ? '← 超卖区间' : rsi > 70 ? '← 超买区间' : '← 中性') : ''}`);
    if (macd) {
      lines.push(`MACD柱: ${macd.histogram.toFixed(4)} ${macd.histogram > 0 ? '(多头)' : '(空头)'}`);
      lines.push(`MACD: DIF=${macd.macd.toFixed(4)} DEA=${macd.signal.toFixed(4)}`);
    }
    if (bb) {
      lines.push(`布林带: 上轨¥${bb.upper.toFixed(2)} 中轨¥${bb.middle.toFixed(2)} 下轨¥${bb.lower.toFixed(2)}`);
      lines.push(`价格位置: ${bbPos === 'near_lower' ? '近下轨（超跌区）' : bbPos === 'near_upper' ? '近上轨（超涨区）' : '中间区'}`);
    }
  }

  // 当前系统信号
  if (signal) {
    const sigTs = signal['generated_at'] as number;
    const age = Math.round((Date.now() - sigTs) / 60000);
    lines.push('', '## 系统交易信号');
    lines.push(`信号: ${signal['signal']} | 评分: ${signal['score']} | 置信度: ${signal['confidence']}%（${age}分钟前生成）`);
    const rawReasons = signal['reasons'];
    const reasons: string[] = Array.isArray(rawReasons)
      ? rawReasons as string[]
      : typeof rawReasons === 'string'
        ? (() => { try { return JSON.parse(rawReasons) as string[]; } catch { return []; } })()
        : [];
    if (reasons.length) {
      lines.push('信号理由:');
      reasons.slice(0, 3).forEach(r => lines.push(`  - ${r}`));
    }
    if (signal['entry_cny_g'])  lines.push(`建议入场: ¥${signal['entry_cny_g']}/g`);
    if (signal['stop_loss'])    lines.push(`系统止损: ¥${signal['stop_loss']}/g`);
    if (signal['target_profit']) lines.push(`系统目标: ¥${signal['target_profit']}/g`);
  }

  // 宏观环境
  lines.push('', '## 宏观环境');
  lines.push(`美元指数DXY: ${macro['DXY']?.toFixed(2) ?? 'N/A'}`);
  lines.push(`美债10Y: ${macro['US10Y']?.toFixed(3) ?? 'N/A'}%  |  TIPS实际利率: ${macro['TIPS10Y']?.toFixed(3) ?? 'N/A'}%`);
  lines.push(`VIX恐慌指数: ${macro['VIX']?.toFixed(2) ?? 'N/A'}  |  Fed基准利率: ${macro['FEDRATE']?.toFixed(2) ?? 'N/A'}%`);
  lines.push(`白银XAG: $${macro['SILVER']?.toFixed(2) ?? 'N/A'}/oz  |  WTI原油: $${macro['OIL']?.toFixed(2) ?? 'N/A'}/桶`);
  if (macro['AU9999']) lines.push(`上海AU9999: ¥${macro['AU9999']?.toFixed(2) ?? 'N/A'}/g`);

  // ETF持仓
  if (gld) {
    const changePct = gld['change_pct'] != null ? `(${Number(gld['change_pct']) > 0 ? '+' : ''}${Number(gld['change_pct']).toFixed(2)}%)` : '';
    lines.push('', '## 资金面');
    lines.push(`GLD ETF持仓: ${gld['tonnes']}吨 ${changePct} (${gld['date']})`);
  }

  // 库存
  if (comex || shfe) {
    lines.push('', '## 实物库存');
    if (comex) lines.push(`COMEX黄金库存: ${comex['tonnes']}吨 (${comex['date']})`);
    if (shfe)  lines.push(`SHFE黄金库存: ${shfe['tonnes']}吨 (${shfe['date']})`);
  }

  // COT持仓报告
  if (cot) {
    const netLong = cot['net_long'] as number;
    lines.push('', '## CFTC持仓报告（大型机构）');
    lines.push(`净多头: ${netLong > 0 ? '+' : ''}${netLong} 合约 ${netLong > 150000 ? '← 机构高度看多' : netLong > 50000 ? '← 机构温和看多' : netLong < 0 ? '← 机构看空' : '← 中性'}`);
    lines.push(`非商业多头: ${cot['noncomm_long']} | 非商业空头: ${cot['noncomm_short']} (${cot['date']})`);
  }

  // 三大前瞻指标（注入 AI 分析必读）
  const intelCtx = buildIntelContext(macro);
  lines.push(intelCtx);

  // 重要新闻
  const topNews = (news as Record<string, unknown>[])
    .filter(n => (n['ai_impact'] as number) >= 3)
    .slice(0, 8);

  lines.push('', '## 近期重要新闻（AI影响力≥3/5）');
  if (topNews.length === 0) {
    lines.push('暂无高影响新闻');
  } else {
    for (const n of topNews) {
      const dir = n['ai_direction'] as string;
      const icon = dir === 'bullish' ? '🟢' : dir === 'bearish' ? '🔴' : '🟡';
      lines.push(`${icon} [${n['ai_impact']}/5] ${n['title']}`);
      if (n['ai_reasoning']) lines.push(`   └ ${String(n['ai_reasoning']).slice(0, 80)}`);
    }
  }

  return lines.join('\n');
}

function buildHistoryContext(pastIdeas: Record<string, unknown>[]): string {
  if (pastIdeas.length === 0) return '';
  const lines = ['', '## 你的历史想法回顾（持续优化参考）'];
  for (const idea of pastIdeas) {
    const date = dayjs(idea['ts'] as number).format('MM-DD HH:mm');
    let analysis: IdeaAnalysisResult | null = null;
    try { analysis = idea['ai_analysis'] ? JSON.parse(idea['ai_analysis'] as string) as IdeaAnalysisResult : null; } catch { /* ignore */ }
    const outcome = analysis
      ? `${analysis.direction.toUpperCase()} ${analysis.score}/10: ${analysis.summary}${analysis.action ? ` → 操作:${analysis.action}` : ''}`
      : '(分析中)';
    lines.push(`- [${date}] ${String(idea['content']).slice(0, 60)} → ${outcome}`);
  }
  return lines.join('\n');
}

// ── 主函数 ────────────────────────────────────────────────────

export async function analyzeIdea(content: string): Promise<{ id: number; result: IdeaAnalysisResult }> {
  // 并发拉取所有数据源
  const [
    price,
    macro,
    news,
    pastIdeas,
    signal,
    cot,
    comex,
    shfe,
    gld,
  ] = await Promise.all([
    Promise.resolve(getLatestPrice() as Record<string, number> | null),
    Promise.resolve(getMacroDashboard()),
    Promise.resolve(getLatestNews(50)),
    Promise.resolve(getRecentIdeasForContext(5)),
    Promise.resolve(getLatestSignal() as Record<string, unknown> | null),
    Promise.resolve(getLatestCOT()),
    Promise.resolve(getLatestInventory('COMEX')),
    Promise.resolve(getLatestInventory('SHFE')),
    Promise.resolve(getLatestETFHolding('GLD')),
  ]);

  const technicals = getTechnicals();

  const marketContext = buildFullContext(price, macro, news as Record<string, unknown>[], signal, cot, comex, shfe, gld, technicals);
  const historyContext = buildHistoryContext(pastIdeas as Record<string, unknown>[]);
  const marketSnapshot = JSON.stringify({ price, macro, ts: Date.now() });

  // 保存想法（pending状态）
  const id = insertIdea(content, marketSnapshot);

  const userMessage = `
${marketContext}
${historyContext}

---

**用户交易想法：**
${content}

请综合以上所有数据，对这个交易想法进行深度分析，给出具体可操作的建议（包括建议入场价、止损价、目标价）。`.trim();

  logger.info('[idea-analyzer] analyzing idea with full market data', {
    id,
    hasSignal: !!signal,
    hasCOT: !!cot,
    hasTechnicals: !!technicals,
    newsCount: (news as unknown[]).length,
  });

  const response = await callClaude(SYSTEM_PROMPT, userMessage, 2000, 'idea');

  const jsonMatch = response.match(/\{[\s\S]+\}/);
  if (!jsonMatch) throw new Error('Idea analyzer: no JSON in response');

  const result = JSON.parse(jsonMatch[0]) as IdeaAnalysisResult;

  // 后处理：自动纠正价格单位混淆（AI 可能将 USD/oz 误作 CNY/g 输出）
  // 积存金正常价格区间 ¥600-¥900/g；若输出超过 ¥2000，判定为 USD/oz，执行换算
  const currentCnyG = price?.['xau_cny_g'] ?? 750;
  const usdCnyRate  = price?.['usd_cny']  ?? 7.25;
  const suspectThreshold = Math.max(currentCnyG * 2, 2000);

  function fixPriceUnit(val: number | null | undefined): number | null {
    if (val == null) return null;
    if (val > suspectThreshold) {
      // 判定为 USD/oz，转 CNY/g
      const fixed = parseFloat(((val * usdCnyRate) / 31.1035).toFixed(2));
      logger.warn('[idea-analyzer] price unit auto-corrected (USD/oz→CNY/g)', { original: val, fixed });
      return fixed;
    }
    return val;
  }

  result.entry    = fixPriceUnit(result.entry);
  result.stopLoss = fixPriceUnit(result.stopLoss);
  result.target   = fixPriceUnit(result.target);
  if (Array.isArray(result.keyLevels)) {
    result.keyLevels = result.keyLevels.map(kl => ({
      ...kl,
      price: fixPriceUnit(kl.price) ?? kl.price,
    }));
  }

  // 写回分析结果
  updateIdeaAnalysis(
    id,
    JSON.stringify(result),
    result.score,
    result.direction,
    result.tags?.join(',') ?? ''
  );

  // 保存干净 Q&A 记录（供用户历史查阅）
  setImmediate(() => {
    try {
      insertQALog({
        type: 'idea',
        question: content,
        answer: result.summary + '\n\n' + (result.supporting?.join('\n') ?? ''),
        meta: {
          direction: result.direction,
          score: result.score,
          action: result.action,
          entry: result.entry,
          stopLoss: result.stopLoss,
          target: result.target,
          riskReward: result.riskReward,
        },
      });
    } catch { /* ignore log failure */ }
  });

  logger.info('[idea-analyzer] analysis complete', {
    id,
    direction: result.direction,
    score: result.score,
    action: result.action,
    summary: result.summary,
  });

  return { id, result };
}
