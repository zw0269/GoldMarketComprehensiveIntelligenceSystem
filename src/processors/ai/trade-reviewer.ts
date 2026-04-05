/**
 * AI 交易复盘分析器
 *
 * 每次平仓后触发，分析：
 * - 信号是否准确、入场是否合理
 * - 为什么盈利/亏损
 * - 下次该如何优化
 * - 积累策略改进建议到 strategy-memo.md
 */
import { callClaude } from './claude-client';
import { getPriceHistory, getLatestNews } from '../../storage/dao';
import logger from '../../utils/logger';
import fs from 'fs';
import path from 'path';
import dayjs from 'dayjs';

export interface TradeReview {
  verdict: 'profit' | 'loss' | 'breakeven';
  pnl: number;
  pnl_pct: number;
  holding_hours: number;
  signal_accuracy: 'correct' | 'wrong' | 'partial';
  what_worked: string[];
  what_failed: string[];
  key_lesson: string;
  next_time_rule: string;
  optimization: string;
  rating: number;  // 1-5 执行质量评分
}

const REVIEW_SYSTEM = `你是积存金短线交易的专业复盘教练，有15年中国黄金市场经验。

**任务**：对一笔已平仓的积存金交易进行深度复盘。

**必须以此 JSON 格式响应（不含额外文字）：**
{
  "verdict": "profit" | "loss" | "breakeven",
  "signal_accuracy": "correct" | "wrong" | "partial",
  "what_worked": ["做对的点1", "做对的点2"],
  "what_failed": ["做错的点1", "做错的点2"],
  "key_lesson": "本次最重要的教训（一句话）",
  "next_time_rule": "下次遇到类似情况应该怎么做（一句话规则）",
  "optimization": "针对信号引擎的具体优化建议（技术层面）",
  "rating": 1-5
}

**评分标准（rating）：**
5分 = 严格按信号执行，结果符合预期
4分 = 基本遵守纪律，小有偏差
3分 = 入场或出场时机欠佳
2分 = 明显违反止损纪律或追涨杀跌
1分 = 严重错误，无视风险`;

export async function reviewTrade(params: {
  buy_price: number;
  close_price: number;
  grams: number;
  buy_fee: number;
  close_fee: number;
  realized_pnl: number;
  pnl_pct: number;
  holding_hours: number;
  buy_ts: number;
  close_ts: number;
  entry_signal: string | null;
  stop_loss: number | null;
  target_profit: number | null;
  note: string;
}): Promise<TradeReview> {
  // 获取持仓期间价格走势（用于分析判断是否止损合理）
  const priceHistory = getPriceHistory(params.buy_ts, params.close_ts, 200) as Array<{
    ts: number; xau_cny_g: number;
  }>;

  const prices = priceHistory.map(p => p.xau_cny_g).filter(Boolean);
  const maxPrice = prices.length ? Math.max(...prices).toFixed(2) : 'N/A';
  const minPrice = prices.length ? Math.min(...prices).toFixed(2) : 'N/A';

  // 持仓期间新闻
  const news = getLatestNews(10) as Array<{ title: string; ai_impact: number; ai_direction: string }>;
  const newsStr = news.slice(0, 5).map(n => `[影响${n.ai_impact}/5 ${n.ai_direction}] ${n.title}`).join('\n');

  const entrySignal = params.entry_signal ? (() => {
    try { return JSON.parse(params.entry_signal); } catch { return null; }
  })() : null;

  const userMsg = `
**交易概况**
- 买入价：¥${params.buy_price}/g
- 卖出价：¥${params.close_price}/g
- 持有：${params.grams}g，${params.holding_hours.toFixed(1)}小时
- 手续费：买入¥${params.buy_fee} + 卖出¥${params.close_fee}
- 实现盈亏：${params.realized_pnl >= 0 ? '+' : ''}¥${params.realized_pnl.toFixed(2)} (${params.pnl_pct >= 0 ? '+' : ''}${params.pnl_pct.toFixed(2)}%)
- 备注：${params.note || '无'}

**开仓时的信号**
${entrySignal ? `
- 信号等级：${entrySignal.signal}（置信度 ${entrySignal.confidence}%，综合评分 ${entrySignal.score}）
- 设定止损：¥${params.stop_loss ?? '未设置'}/g
- 设定目标：¥${params.target_profit ?? '未设置'}/g
- 信号理由：${Array.isArray(entrySignal.reasons) ? entrySignal.reasons.join('；') : '无'}
` : '未记录开仓信号'}

**持仓期间市场**
- 期间最高价：¥${maxPrice}/g
- 期间最低价：¥${minPrice}/g
- 是否触及止损：${params.stop_loss && Number(minPrice) <= params.stop_loss ? '是（触及止损但未执行）' : '否'}
- 是否触及目标：${params.target_profit && Number(maxPrice) >= params.target_profit ? '是（触及目标）' : '否'}

**近期市场事件**
${newsStr || '无重要新闻'}

请给出深度复盘分析。`.trim();

  const response = await callClaude(REVIEW_SYSTEM, userMsg, 800, 'trade_review');
  const jsonMatch = response.match(/\{[\s\S]+\}/);
  if (!jsonMatch) throw new Error('Trade reviewer: no JSON in response');

  const review = JSON.parse(jsonMatch[0]) as TradeReview;
  review.pnl = params.realized_pnl;
  review.pnl_pct = params.pnl_pct;
  review.holding_hours = params.holding_hours;
  review.verdict = params.realized_pnl > 0.01 ? 'profit' : params.realized_pnl < -0.01 ? 'loss' : 'breakeven';

  // 将关键教训追加写入策略备忘录
  appendToStrategyMemo(review, params);

  logger.info('[trade-reviewer] review complete', {
    verdict: review.verdict,
    signal_accuracy: review.signal_accuracy,
    rating: review.rating,
    key_lesson: review.key_lesson,
  });

  return review;
}

/** 将教训追加到策略备忘录，供信号引擎参考 */
function appendToStrategyMemo(review: TradeReview, params: {
  buy_price: number; close_price: number; realized_pnl: number; holding_hours: number;
}): void {
  const memoPath = path.join(process.cwd(), 'STRATEGY_MEMO.md');
  const date = dayjs().format('YYYY-MM-DD HH:mm');
  const entry = `
### ${date} — ${review.verdict === 'profit' ? '✅ 盈利' : review.verdict === 'loss' ? '❌ 亏损' : '➖ 保本'} ¥${params.buy_price}→¥${params.close_price}（${params.realized_pnl >= 0 ? '+' : ''}¥${params.realized_pnl.toFixed(2)}，${params.holding_hours.toFixed(1)}h）

- **信号准确性**：${review.signal_accuracy}
- **关键教训**：${review.key_lesson}
- **下次规则**：${review.next_time_rule}
- **优化建议**：${review.optimization}
- **执行评分**：${'★'.repeat(review.rating)}${'☆'.repeat(5 - review.rating)} (${review.rating}/5)
`;

  if (!fs.existsSync(memoPath)) {
    fs.writeFileSync(memoPath, `# 积存金策略备忘录\n\n> AI自动生成，每次平仓后更新，用于持续优化交易策略\n`);
  }
  fs.appendFileSync(memoPath, entry);
}
