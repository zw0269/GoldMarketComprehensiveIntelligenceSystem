/**
 * 数据访问层 DAO 封装 (T-203)
 * 统一所有数据库读写操作
 */
import { getDB } from './database';
import type {
  IPriceData,
  IInventoryData,
  IETFHolding,
  ICOTReport,
  IMacroData,
  INewsItem,
  IAlert,
  ICentralBankPurchase,
} from '../types';
import dayjs from 'dayjs';

// ── 价格 ─────────────────────────────────────────────────────

export function insertPrice(price: IPriceData & { xauUsd: number }): void {
  const db = getDB();
  db.prepare(`
    INSERT OR REPLACE INTO prices (ts, xau_usd, xau_cny_g, usd_cny, sge_price, sge_premium, source)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    price.timestamp,
    price.xauUsd,
    price.xauCny ?? null,
    price.usdCny ?? null,
    price.xauCny ?? null,
    price.sgePremium ?? null,
    price.source
  );
}

export function getLatestPrice(): Record<string, unknown> | null {
  return getDB().prepare(
    'SELECT * FROM prices ORDER BY ts DESC LIMIT 1'
  ).get() as Record<string, unknown> | null;
}

export function getPriceHistory(
  from: number,
  to: number,
  limit = 1440
): Record<string, unknown>[] {
  return getDB().prepare(
    'SELECT * FROM prices WHERE ts BETWEEN ? AND ? ORDER BY ts ASC LIMIT ?'
  ).all(from, to, limit) as Record<string, unknown>[];
}

export function getDailyOHLCV(days = 365): Record<string, unknown>[] {
  return getDB().prepare(
    'SELECT * FROM prices_daily ORDER BY date DESC LIMIT ?'
  ).all(days) as Record<string, unknown>[];
}

/** 将某一天的分钟价格数据聚合为 OHLCV 日线写入 prices_daily */
export function upsertDailyOHLCV(date: string): void {
  const db = getDB();
  // 取该日所有分钟数据
  const startTs = new Date(date + 'T00:00:00+08:00').getTime();
  const endTs   = startTs + 86400000; // +24h
  const rows = db.prepare(
    'SELECT xau_usd, xau_cny_g, usd_cny FROM prices WHERE ts >= ? AND ts < ? ORDER BY ts ASC'
  ).all(startTs, endTs) as Array<{ xau_usd: number; xau_cny_g: number | null; usd_cny: number | null }>;

  if (rows.length === 0) return;

  const prices = rows.map(r => r.xau_usd).filter(Boolean);
  if (prices.length === 0) return;

  const open   = prices[0];
  const close  = prices[prices.length - 1];
  const high   = Math.max(...prices);
  const low    = Math.min(...prices);
  const xauCnyG = rows[rows.length - 1].xau_cny_g ?? null;
  const usdCny  = rows[rows.length - 1].usd_cny  ?? null;

  db.prepare(`
    INSERT OR REPLACE INTO prices_daily (date, open, high, low, close, volume, xau_cny_g, usd_cny)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(date, open, high, low, close, prices.length, xauCnyG, usdCny);
}

// ── 库存 ─────────────────────────────────────────────────────

export function upsertInventory(inv: IInventoryData): void {
  const db = getDB();
  // 计算日变化量
  const prev = db.prepare(
    `SELECT total FROM inventory WHERE exchange = ? AND date < ? ORDER BY date DESC LIMIT 1`
  ).get(inv.exchange, inv.date) as { total: number } | undefined;

  const changeVal = prev ? inv.total - prev.total : null;

  db.prepare(`
    INSERT OR REPLACE INTO inventory (date, exchange, registered, eligible, total, unit, change_val)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    inv.date, inv.exchange, inv.registered ?? null, inv.eligible ?? null,
    inv.total, inv.unit, changeVal
  );
}

export function getInventoryHistory(exchange: string, days = 90): Record<string, unknown>[] {
  return getDB().prepare(
    'SELECT * FROM inventory WHERE exchange = ? ORDER BY date DESC LIMIT ?'
  ).all(exchange, days) as Record<string, unknown>[];
}

// ── ETF 持仓 ─────────────────────────────────────────────────

export function upsertETFHolding(holding: IETFHolding): void {
  const db = getDB();
  const prev = db.prepare(
    `SELECT tonnes FROM etf_holdings WHERE fund = ? AND date < ? ORDER BY date DESC LIMIT 1`
  ).get(holding.fund, holding.date) as { tonnes: number } | undefined;

  const changeVal = prev ? holding.tonnes - prev.tonnes : null;
  const changePct = prev ? ((holding.tonnes - prev.tonnes) / prev.tonnes) * 100 : null;

  db.prepare(`
    INSERT OR REPLACE INTO etf_holdings (date, fund, tonnes, change_val, change_pct)
    VALUES (?, ?, ?, ?, ?)
  `).run(holding.date, holding.fund, holding.tonnes, changeVal, changePct);
}

export function getETFHoldingsHistory(fund: string, days = 90): Record<string, unknown>[] {
  return getDB().prepare(
    'SELECT * FROM etf_holdings WHERE fund = ? ORDER BY date DESC LIMIT ?'
  ).all(fund, days) as Record<string, unknown>[];
}

// ── CFTC COT ─────────────────────────────────────────────────

export function upsertCOTReport(report: ICOTReport): void {
  getDB().prepare(`
    INSERT OR REPLACE INTO cot_report
    (date, commercial_long, commercial_short, noncomm_long, noncomm_short, net_long)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    report.date, report.commercialLong, report.commercialShort,
    report.noncommLong, report.noncommShort, report.netLong
  );
}

export function getLatestCOT(): Record<string, unknown> | null {
  return getDB().prepare(
    'SELECT * FROM cot_report ORDER BY date DESC LIMIT 1'
  ).get() as Record<string, unknown> | null;
}

export function getLatestInventory(exchange: string): Record<string, unknown> | null {
  return getDB().prepare(
    'SELECT * FROM inventory WHERE exchange = ? ORDER BY date DESC LIMIT 1'
  ).get(exchange) as Record<string, unknown> | null;
}

export function getLatestETFHolding(fund: string): Record<string, unknown> | null {
  return getDB().prepare(
    'SELECT * FROM etf_holdings WHERE fund = ? ORDER BY date DESC LIMIT 1'
  ).get(fund) as Record<string, unknown> | null;
}

// ── 宏观数据 ─────────────────────────────────────────────────

export function upsertMacroData(data: IMacroData): void {
  getDB().prepare(`
    INSERT OR REPLACE INTO macro_data (date, indicator, value, source)
    VALUES (?, ?, ?, ?)
  `).run(data.date, data.indicator, data.value, data.source);
}

export function getMacroDashboard(): Record<string, number> {
  const rows = getDB().prepare(`
    SELECT indicator, value FROM macro_data
    WHERE date >= ?
    GROUP BY indicator
    HAVING date = MAX(date)
  `).all(dayjs().subtract(7, 'day').format('YYYY-MM-DD')) as Array<{ indicator: string; value: number }>;

  return Object.fromEntries(rows.map(r => [r.indicator, r.value]));
}

// ── 新闻 ─────────────────────────────────────────────────────

export function insertNews(item: INewsItem): number {
  const result = getDB().prepare(`
    INSERT OR IGNORE INTO news (ts, source, title, summary, url, category, ai_direction, ai_impact, ai_reasoning, ai_timeframe)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    item.timestamp, item.source, item.title,
    item.summary ?? null, item.url ?? null, item.category ?? null,
    item.aiDirection ?? null, item.aiImpact ?? null,
    item.aiReasoning ?? null, item.aiTimeframe ?? null
  );
  return result.lastInsertRowid as number;
}

export function getLatestNews(limit = 50, category?: string): Record<string, unknown>[] {
  if (category) {
    return getDB().prepare(
      'SELECT * FROM news WHERE category = ? ORDER BY ts DESC LIMIT ?'
    ).all(category, limit) as Record<string, unknown>[];
  }
  return getDB().prepare(
    'SELECT * FROM news ORDER BY ts DESC LIMIT ?'
  ).all(limit) as Record<string, unknown>[];
}

export function getPendingAINews(limit = 20): Record<string, unknown>[] {
  return getDB().prepare(
    'SELECT * FROM news WHERE ai_impact IS NULL ORDER BY ts DESC LIMIT ?'
  ).all(limit) as Record<string, unknown>[];
}

export function updateNewsAI(
  id: number,
  direction: string,
  impact: number,
  reasoning: string,
  timeframe: string
): void {
  getDB().prepare(`
    UPDATE news SET ai_direction=?, ai_impact=?, ai_reasoning=?, ai_timeframe=? WHERE id=?
  `).run(direction, impact, reasoning, timeframe, id);
}

// ── 告警 ─────────────────────────────────────────────────────

export function insertAlert(alert: IAlert): void {
  getDB().prepare(`
    INSERT INTO alerts_log (ts, type, priority, title, message, data, sent)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    alert.timestamp, alert.type, alert.priority,
    alert.title, alert.message,
    alert.data ? JSON.stringify(alert.data) : null,
    alert.sent ? 1 : 0
  );
}

export function getAlertHistory(limit = 100): Record<string, unknown>[] {
  return getDB().prepare(
    'SELECT * FROM alerts_log ORDER BY ts DESC LIMIT ?'
  ).all(limit) as Record<string, unknown>[];
}

// ── 数据清理 (T-204) ─────────────────────────────────────────

export function cleanupOldMinuteData(retentionDays: number): void {
  const cutoff = dayjs().subtract(retentionDays, 'day').valueOf();
  const result = getDB().prepare(
    'DELETE FROM prices WHERE ts < ?'
  ).run(cutoff);
  if (result.changes > 0) {
    console.log(`[dao] cleaned up ${result.changes} old price records`);
  }
}

// ── 央行购金 ─────────────────────────────────────────────────

// ── 用户想法工坊 ──────────────────────────────────────────────

export interface UserIdea {
  id?: number;
  ts?: number;
  content: string;
  marketSnapshot?: string;
  aiAnalysis?: string;
  aiScore?: number;
  aiDirection?: string;
  tags?: string;
  status?: string;
}

export function insertIdea(content: string, marketSnapshot: string): number {
  const result = getDB().prepare(`
    INSERT INTO user_ideas (content, market_snapshot, status)
    VALUES (?, ?, 'pending')
  `).run(content, marketSnapshot);
  return result.lastInsertRowid as number;
}

export function updateIdeaAnalysis(
  id: number,
  aiAnalysis: string,
  aiScore: number,
  aiDirection: string,
  tags: string
): void {
  getDB().prepare(`
    UPDATE user_ideas
    SET ai_analysis=?, ai_score=?, ai_direction=?, tags=?, status='analyzed'
    WHERE id=?
  `).run(aiAnalysis, aiScore, aiDirection, tags, id);
}

export function getIdeas(limit = 20): Record<string, unknown>[] {
  return getDB().prepare(
    'SELECT * FROM user_ideas ORDER BY ts DESC LIMIT ?'
  ).all(limit) as Record<string, unknown>[];
}

export function getRecentIdeasForContext(limit = 5): Record<string, unknown>[] {
  return getDB().prepare(`
    SELECT content, ai_analysis, ai_direction, ai_score, ts
    FROM user_ideas WHERE status='analyzed'
    ORDER BY ts DESC LIMIT ?
  `).all(limit) as Record<string, unknown>[];
}

// ── 积存金持仓管理 ────────────────────────────────────────────

export interface OpenPosition {
  id?: number;
  buy_ts?: number;
  buy_price_cny_g: number;
  grams: number;
  bank?: string;
  buy_fee?: number;
  note?: string;
  signal_id?: number;
  entry_signal?: string;
  stop_loss?: number;
  target_profit?: number;
}

export interface ClosedPositionResult {
  realized_pnl: number;
  pnl_pct: number;
  holding_hours: number;
}

export function openPosition(pos: OpenPosition): number {
  const result = getDB().prepare(`
    INSERT INTO open_positions
      (buy_price_cny_g, grams, bank, buy_fee, note, signal_id, entry_signal, stop_loss, target_profit)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    pos.buy_price_cny_g, pos.grams,
    pos.bank ?? '', pos.buy_fee ?? 0, pos.note ?? '',
    pos.signal_id ?? null, pos.entry_signal ?? null,
    pos.stop_loss ?? null, pos.target_profit ?? null
  );
  return result.lastInsertRowid as number;
}

export function getOpenPositions(): Record<string, unknown>[] {
  return getDB().prepare(
    `SELECT * FROM open_positions WHERE status = 'open' ORDER BY buy_ts DESC`
  ).all() as Record<string, unknown>[];
}

export function getClosedPositions(limit = 50): Record<string, unknown>[] {
  return getDB().prepare(
    `SELECT * FROM open_positions WHERE status = 'closed' ORDER BY close_ts DESC LIMIT ?`
  ).all(limit) as Record<string, unknown>[];
}

export function closePosition(
  id: number,
  close_price: number,
  close_fee = 0
): ClosedPositionResult {
  const pos = getDB().prepare(
    'SELECT * FROM open_positions WHERE id = ? AND status = ?'
  ).get(id, 'open') as Record<string, unknown> | undefined;

  if (!pos) throw new Error(`Position ${id} not found or already closed`);

  const buyPrice  = pos['buy_price_cny_g'] as number;
  const grams     = pos['grams'] as number;
  const buyFee    = (pos['buy_fee'] as number) ?? 0;
  const buyTs     = pos['buy_ts'] as number;

  const realized_pnl  = (close_price - buyPrice) * grams - buyFee - close_fee;
  const pnl_pct       = ((close_price - buyPrice) / buyPrice) * 100;
  const holding_hours = (Date.now() - buyTs) / 3600000;

  getDB().prepare(`
    UPDATE open_positions SET
      close_ts = ?, close_price_cny_g = ?, close_fee = ?,
      realized_pnl = ?, holding_hours = ?, status = 'closed'
    WHERE id = ?
  `).run(Date.now(), close_price, close_fee, realized_pnl, holding_hours, id);

  return {
    realized_pnl: parseFloat(realized_pnl.toFixed(2)),
    pnl_pct: parseFloat(pnl_pct.toFixed(2)),
    holding_hours: parseFloat(holding_hours.toFixed(1)),
  };
}

export function savePositionReview(id: number, review: string): void {
  getDB().prepare(
    'UPDATE open_positions SET review_content = ? WHERE id = ?'
  ).run(review, id);
}

/** 聚合统计：胜率、平均盈亏比 */
export function getTradeStats(): Record<string, unknown> {
  const rows = getDB().prepare(
    `SELECT realized_pnl, holding_hours FROM open_positions WHERE status = 'closed'`
  ).all() as Array<{ realized_pnl: number; holding_hours: number }>;

  if (rows.length === 0) return { total: 0, wins: 0, losses: 0, winRate: 0, avgPnl: 0, avgWin: 0, avgLoss: 0 };

  const wins   = rows.filter(r => r.realized_pnl > 0);
  const losses = rows.filter(r => r.realized_pnl <= 0);
  const avgPnl = rows.reduce((s, r) => s + r.realized_pnl, 0) / rows.length;
  const avgWin  = wins.length  ? wins.reduce((s, r) => s + r.realized_pnl, 0) / wins.length  : 0;
  const avgLoss = losses.length ? losses.reduce((s, r) => s + r.realized_pnl, 0) / losses.length : 0;

  return {
    total:    rows.length,
    wins:     wins.length,
    losses:   losses.length,
    winRate:  parseFloat(((wins.length / rows.length) * 100).toFixed(1)),
    avgPnl:   parseFloat(avgPnl.toFixed(2)),
    avgWin:   parseFloat(avgWin.toFixed(2)),
    avgLoss:  parseFloat(avgLoss.toFixed(2)),
    profitFactor: avgLoss !== 0 ? parseFloat(Math.abs(avgWin / avgLoss).toFixed(2)) : null,
  };
}

// ── 积存金交易日志 ────────────────────────────────────────────

export interface TradeRecord {
  id?: number;
  ts?: number;
  type: 'buy' | 'sell';
  price_cny_g: number;
  grams: number;
  bank?: string;
  fee?: number;
  note?: string;
  signal_id?: number;
  status?: string;
}

export function insertTrade(trade: TradeRecord): number {
  const result = getDB().prepare(`
    INSERT INTO trade_log (type, price_cny_g, grams, bank, fee, note, signal_id, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'open')
  `).run(
    trade.type, trade.price_cny_g, trade.grams,
    trade.bank ?? '', trade.fee ?? 0, trade.note ?? '',
    trade.signal_id ?? null
  );
  return result.lastInsertRowid as number;
}

export function getTrades(limit = 100): Record<string, unknown>[] {
  return getDB().prepare(
    'SELECT * FROM trade_log ORDER BY ts DESC LIMIT ?'
  ).all(limit) as Record<string, unknown>[];
}

/** 持仓 + 盈亏汇总（考虑手续费） */
export function getPositionSummary(currentPriceCnyG: number): {
  totalGrams: number;
  avgCostCnyG: number;
  totalCost: number;
  currentValue: number;
  unrealizedPnl: number;
  unrealizedPnlPct: number;
  realizedPnl: number;
  totalFees: number;
  trades: Record<string, unknown>[];
} {
  const trades = getDB().prepare(
    'SELECT * FROM trade_log ORDER BY ts ASC'
  ).all() as Record<string, unknown>[];

  let buyGrams = 0;
  let buyCost = 0; // total CNY spent on open buys
  let realizedPnl = 0;
  let totalFees = 0;

  // FIFO matching for realized P&L
  const buyQueue: { grams: number; price: number }[] = [];

  for (const t of trades) {
    const g = t['grams'] as number;
    const p = t['price_cny_g'] as number;
    const fee = (t['fee'] as number) ?? 0;
    totalFees += fee;

    if (t['type'] === 'buy') {
      buyQueue.push({ grams: g, price: p });
      buyGrams += g;
      buyCost += g * p + fee;
    } else {
      // sell — FIFO
      let remaining = g;
      while (remaining > 0 && buyQueue.length > 0) {
        const front = buyQueue[0];
        const matched = Math.min(remaining, front.grams);
        realizedPnl += matched * (p - front.price);
        front.grams -= matched;
        remaining -= matched;
        if (front.grams <= 0.0001) buyQueue.shift();
      }
      buyGrams -= g;
      buyCost -= g * (buyCost / Math.max(buyGrams + g, 0.001));
    }
  }

  const avgCost = buyGrams > 0.001 ? buyCost / buyGrams : 0;
  const currentValue = buyGrams * currentPriceCnyG;
  const unrealizedPnl = currentValue - buyCost;
  const unrealizedPnlPct = buyCost > 0 ? (unrealizedPnl / buyCost) * 100 : 0;

  return {
    totalGrams: Math.max(0, buyGrams),
    avgCostCnyG: parseFloat(avgCost.toFixed(4)),
    totalCost: parseFloat(buyCost.toFixed(2)),
    currentValue: parseFloat(currentValue.toFixed(2)),
    unrealizedPnl: parseFloat(unrealizedPnl.toFixed(2)),
    unrealizedPnlPct: parseFloat(unrealizedPnlPct.toFixed(2)),
    realizedPnl: parseFloat(realizedPnl.toFixed(2)),
    totalFees: parseFloat(totalFees.toFixed(2)),
    trades,
  };
}

// ── 交易信号 ─────────────────────────────────────────────────

export interface SignalRecord {
  signal: string;
  confidence: number;
  score: number;
  reasons: string[];
  entry_cny_g?: number;
  stop_loss?: number;
  target_profit?: number;
  risk_reward?: number;
  technicals?: Record<string, unknown>;
  price_at_signal?: number;
}

export function insertSignal(s: SignalRecord): number {
  const result = getDB().prepare(`
    INSERT INTO signals (signal, confidence, score, reasons, entry_cny_g, stop_loss, target_profit, risk_reward, technicals, price_at_signal)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    s.signal, s.confidence, s.score,
    JSON.stringify(s.reasons),
    s.entry_cny_g ?? null, s.stop_loss ?? null,
    s.target_profit ?? null, s.risk_reward ?? null,
    s.technicals ? JSON.stringify(s.technicals) : null,
    s.price_at_signal ?? null
  );
  return result.lastInsertRowid as number;
}

export function getLatestSignal(): Record<string, unknown> | null {
  return getDB().prepare(
    'SELECT * FROM signals ORDER BY ts DESC LIMIT 1'
  ).get() as Record<string, unknown> | null;
}

export function getSignalHistory(limit = 30): Record<string, unknown>[] {
  return getDB().prepare(
    'SELECT * FROM signals ORDER BY ts DESC LIMIT ?'
  ).all(limit) as Record<string, unknown>[];
}

// ── 央行购金 ─────────────────────────────────────────────────

export function upsertCentralBankPurchase(purchase: ICentralBankPurchase): void {
  getDB().prepare(`
    INSERT OR REPLACE INTO central_bank (date, country, tonnes, is_net)
    VALUES (?, ?, ?, ?)
  `).run(purchase.date, purchase.country, purchase.tonnes, purchase.isNet ? 1 : 0);
}

// ── AI 交互日志 ───────────────────────────────────────────────

export function insertAILog(data: {
  contextType: string;
  systemPrompt: string;
  userMessage: string;
  response?: string;
  durationMs?: number;
}): void {
  getDB().prepare(`
    INSERT INTO ai_interaction_log (context_type, system_prompt, user_message, response, duration_ms)
    VALUES (?, ?, ?, ?, ?)
  `).run(
    data.contextType,
    data.systemPrompt,
    data.userMessage,
    data.response ?? null,
    data.durationMs ?? null
  );
}

export function getAILogsByDateRange(fromTs: number, toTs: number): Record<string, unknown>[] {
  return getDB().prepare(
    'SELECT * FROM ai_interaction_log WHERE ts BETWEEN ? AND ? ORDER BY ts ASC'
  ).all(fromTs, toTs) as Record<string, unknown>[];
}

// ── AI 每日总结 ───────────────────────────────────────────────

export function insertAIDailySummary(date: string, summary: string, stats: string): void {
  getDB().prepare(`
    INSERT OR REPLACE INTO ai_daily_summary (date, summary, stats)
    VALUES (?, ?, ?)
  `).run(date, summary, stats);
}

export function getAIDailySummaries(limit = 30): Record<string, unknown>[] {
  return getDB().prepare(
    'SELECT * FROM ai_daily_summary ORDER BY date DESC LIMIT ?'
  ).all(limit) as Record<string, unknown>[];
}
