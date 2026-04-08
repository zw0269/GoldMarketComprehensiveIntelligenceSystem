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
  // 合法性校验：黄金价格应在 100–100000 USD/oz，防止倒数/空值写入脏数据
  if (!price.xauUsd || price.xauUsd < 100 || price.xauUsd > 100000) {
    console.warn(`[dao] insertPrice rejected: xauUsd=${price.xauUsd} out of range [100, 100000]`);
    return;
  }
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

/**
 * 重置被关键词过滤器错误跳过的新闻，使其重新进入评估队列。
 * 只重置过去 windowHours 小时内、reasoning 为"非相关"标记的记录。
 */
export function resetSkippedNews(windowHours = 24): number {
  const since = Date.now() - windowHours * 3600 * 1000;
  const result = getDB().prepare(`
    UPDATE news
    SET ai_direction = NULL, ai_impact = NULL, ai_reasoning = NULL, ai_timeframe = NULL
    WHERE ts >= ?
      AND ai_reasoning IN (
        'Not directly relevant to gold market',
        'Duplicate article from another RSS source'
      )
  `).run(since);
  return result.changes;
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

/** 删除持仓记录（开仓或已平仓均可删除） */
export function deletePosition(id: number): void {
  getDB().prepare('DELETE FROM open_positions WHERE id = ?').run(id);
}

/** 修改持仓字段（支持开仓和历史记录的任意可编辑字段） */
export function updatePosition(
  id: number,
  fields: {
    buy_price_cny_g?: number;
    grams?: number;
    buy_fee?: number;
    note?: string;
    stop_loss?: number | null;
    target_profit?: number | null;
    close_price_cny_g?: number;
    close_fee?: number;
    buy_ts?: number;
    realized_pnl?: number;
  }
): void {
  const sets: string[] = [];
  const vals: unknown[] = [];

  if (fields.buy_price_cny_g  != null) { sets.push('buy_price_cny_g = ?');  vals.push(fields.buy_price_cny_g); }
  if (fields.grams             != null) { sets.push('grams = ?');             vals.push(fields.grams); }
  if (fields.buy_fee           != null) { sets.push('buy_fee = ?');           vals.push(fields.buy_fee); }
  if (fields.note              != null) { sets.push('note = ?');              vals.push(fields.note); }
  if ('stop_loss'     in fields)        { sets.push('stop_loss = ?');         vals.push(fields.stop_loss ?? null); }
  if ('target_profit' in fields)        { sets.push('target_profit = ?');     vals.push(fields.target_profit ?? null); }
  if (fields.close_price_cny_g != null) { sets.push('close_price_cny_g = ?'); vals.push(fields.close_price_cny_g); }
  if (fields.close_fee         != null) { sets.push('close_fee = ?');         vals.push(fields.close_fee); }
  if (fields.buy_ts            != null) { sets.push('buy_ts = ?');            vals.push(fields.buy_ts); }
  if (fields.realized_pnl      != null) { sets.push('realized_pnl = ?');      vals.push(fields.realized_pnl); }

  if (sets.length === 0) return;
  vals.push(id);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (getDB().prepare(`UPDATE open_positions SET ${sets.join(', ')} WHERE id = ?`) as any).run(...vals);
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

// ── AI 问答记录（干净 Q&A，供用户查阅）───────────────────────────

export interface QARecord {
  type: 'chat' | 'idea' | 'review';
  question: string;
  answer: string;
  meta?: Record<string, unknown>;
}

export function insertQALog(record: QARecord): number {
  const result = getDB().prepare(`
    INSERT INTO ai_qa_log (type, question, answer, meta)
    VALUES (?, ?, ?, ?)
  `).run(
    record.type,
    record.question,
    record.answer,
    record.meta ? JSON.stringify(record.meta) : null
  );
  return result.lastInsertRowid as number;
}

export function getQALogs(opts: {
  type?: string;
  limit?: number;
  offset?: number;
} = {}): Record<string, unknown>[] {
  const { type, limit = 50, offset = 0 } = opts;
  if (type) {
    return getDB().prepare(
      'SELECT * FROM ai_qa_log WHERE type = ? ORDER BY ts DESC LIMIT ? OFFSET ?'
    ).all(type, limit, offset) as Record<string, unknown>[];
  }
  return getDB().prepare(
    'SELECT * FROM ai_qa_log ORDER BY ts DESC LIMIT ? OFFSET ?'
  ).all(limit, offset) as Record<string, unknown>[];
}

export function countQALogs(type?: string): number {
  if (type) {
    const row = getDB().prepare(
      'SELECT COUNT(*) as cnt FROM ai_qa_log WHERE type = ?'
    ).get(type) as { cnt: number };
    return row.cnt;
  }
  const row = getDB().prepare(
    'SELECT COUNT(*) as cnt FROM ai_qa_log'
  ).get() as { cnt: number };
  return row.cnt;
}

export function deleteQALog(id: number): void {
  getDB().prepare('DELETE FROM ai_qa_log WHERE id = ?').run(id);
}

// ── 前瞻情报：五角大楼披萨指数 ──────────────────────────────────

export function insertPentagonPizza(data: {
  score: number;
  articleCount: number;
  alertLevel: string;
  interpretation: string;
}): void {
  getDB().prepare(`
    INSERT INTO intel_pentagon (score, article_count, alert_level, interpretation)
    VALUES (?, ?, ?, ?)
  `).run(data.score, data.articleCount, data.alertLevel, data.interpretation);
}

export function getLatestPentagonPizza(): Record<string, unknown> | null {
  return getDB().prepare(
    'SELECT * FROM intel_pentagon ORDER BY ts DESC LIMIT 1'
  ).get() as Record<string, unknown> | null;
}

export function getPentagonPizzaHistory(hours = 72): Record<string, unknown>[] {
  const from = Date.now() - hours * 3600000;
  return getDB().prepare(
    'SELECT * FROM intel_pentagon WHERE ts >= ? ORDER BY ts DESC'
  ).all(from) as Record<string, unknown>[];
}

// ── 前瞻情报：Polymarket ─────────────────────────────────────

export function upsertPolymarkets(markets: Array<{
  id: string; question: string; yesPrice: number; volume24h: number; endDate?: string;
}>): void {
  const db  = getDB();
  const now = Date.now();
  const stmt = db.prepare(`
    INSERT INTO polymarket_markets (fetched_at, market_id, question, yes_price, volume24h, end_date)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(market_id) DO UPDATE SET
      fetched_at = excluded.fetched_at,
      question   = excluded.question,
      yes_price  = excluded.yes_price,
      volume24h  = excluded.volume24h,
      end_date   = excluded.end_date
  `);
  const insert = db.transaction(() => {
    for (const m of markets) {
      stmt.run(now, m.id, m.question, m.yesPrice, m.volume24h, m.endDate ?? null);
    }
  });
  insert();
}

export function getLatestPolymarkets(limit = 20): Record<string, unknown>[] {
  return getDB().prepare(
    'SELECT * FROM polymarket_markets ORDER BY volume24h DESC LIMIT ?'
  ).all(limit) as Record<string, unknown>[];
}

/**
 * 构建前瞻情报上下文文字块（供注入到 AI Prompt）
 */
export function buildIntelContext(macro: Record<string, number>): string {
  const lines: string[] = ['', '## 三大前瞻指标（外围风向标）'];

  // 1. 美10年期国债收益率
  const tnx = macro['TNX'];
  if (tnx != null) {
    let tnxSignal = '中性区间';
    if (tnx > 4.4) tnxSignal = '⚠️ 超过4.4%！看好科技股大跌，防守资金流入黄金的逻辑减弱';
    else if (tnx < 4.3) tnxSignal = '✅ 跌破4.3%！防守资金回流，黄金等避险品种受益';
    lines.push(`**美国10年期国债收益率: ${tnx.toFixed(3)}%**`);
    lines.push(`  → ${tnxSignal}`);
    lines.push('  （傻瓜公式：>4.4%看科技暴跌，<4.3%买防守品种）');
  } else {
    lines.push('**美国10年期国债收益率**: 暂无数据');
  }

  // 2. 五角大楼披萨指数
  const pizza = getLatestPentagonPizza();
  if (pizza) {
    const score      = pizza['score'] as number;
    const alertLevel = pizza['alert_level'] as string;
    const interp     = pizza['interpretation'] as string;
    const age        = Math.round((Date.now() - (pizza['ts'] as number)) / 60000);
    let icon = '🟢';
    if (alertLevel === 'critical') icon = '🔴';
    else if (alertLevel === 'warning') icon = '🟠';
    else if (alertLevel === 'caution') icon = '🟡';
    lines.push(`**五角大楼披萨指数（军事活动）: ${score.toFixed(0)}/100** ${icon}（${age}分钟前更新）`);
    lines.push(`  → ${interp}`);
    lines.push('  （阈值：>40需警惕，>60大事酝酿立即防守）');
  } else {
    lines.push('**五角大楼披萨指数**: 暂无数据');
  }

  // 3. Polymarket 前5大相关市场
  const polymarkets = getLatestPolymarkets(8);
  if (polymarkets.length > 0) {
    lines.push('**Polymarket 全球聪明钱押注（前8大相关市场）:**');
    for (const m of polymarkets) {
      const pct  = Math.round((m['yes_price'] as number) * 100);
      const vol  = (m['volume24h'] as number) >= 1e6
        ? `$${((m['volume24h'] as number) / 1e6).toFixed(1)}M`
        : `$${Math.round((m['volume24h'] as number) / 1000)}K`;
      const icon = pct >= 70 ? '🔴' : pct >= 50 ? '🟡' : '🟢';
      lines.push(`  ${icon} ${pct}% YES — ${m['question']} （成交量${vol}）`);
    }
  } else {
    lines.push('**Polymarket**: 暂无数据');
  }

  return lines.join('\n');
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

// ── 交易流水日志 ──────────────────────────────────────────────────

export interface JournalEntry {
  type: 'buy' | 'sell';
  price_cny_g: number;
  grams: number;
  fee: number;
  note?: string;
  pair_id?: number | null; // 卖出时对应的买入ID
}

export function insertJournalEntry(entry: JournalEntry): number {
  // 如果是卖出且指定了配对买入，自动计算盈亏
  let pnl: number | null = null;
  if (entry.type === 'sell' && entry.pair_id) {
    const buyRow = getDB().prepare(
      'SELECT price_cny_g, grams, fee FROM trade_journal WHERE id = ? AND type = ?'
    ).get(entry.pair_id, 'buy') as { price_cny_g: number; grams: number; fee: number } | undefined;
    if (buyRow) {
      const sellGrams = Math.min(entry.grams, buyRow.grams);
      pnl = (entry.price_cny_g - buyRow.price_cny_g) * sellGrams - entry.fee - buyRow.fee;
    }
  }

  const result = getDB().prepare(`
    INSERT INTO trade_journal (type, price_cny_g, grams, fee, note, pair_id, pnl)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    entry.type,
    entry.price_cny_g,
    entry.grams,
    entry.fee,
    entry.note ?? '',
    entry.pair_id ?? null,
    pnl,
  );
  return result.lastInsertRowid as number;
}

export function getJournalEntries(limit = 100, offset = 0): Record<string, unknown>[] {
  return getDB().prepare(
    'SELECT * FROM trade_journal ORDER BY ts DESC LIMIT ? OFFSET ?'
  ).all(limit, offset) as Record<string, unknown>[];
}

export function countJournalEntries(): number {
  const row = getDB().prepare('SELECT COUNT(*) as cnt FROM trade_journal').get() as { cnt: number };
  return row.cnt;
}

export function deleteJournalEntry(id: number): void {
  getDB().prepare('DELETE FROM trade_journal WHERE id = ?').run(id);
}

/** 汇总统计：总盈亏、胜率、笔数，以及买卖总额 */
export function getJournalStats(): Record<string, unknown> {
  const db = getDB();

  // 卖出记录（已结盈亏）
  const sells = db.prepare(
    `SELECT pnl FROM trade_journal WHERE type='sell' AND pnl IS NOT NULL`
  ).all() as Array<{ pnl: number }>;

  // 买入汇总
  const buyRow = db.prepare(
    `SELECT COUNT(*) as cnt, COALESCE(SUM(price_cny_g * grams), 0) AS total_amount,
            COALESCE(SUM(grams), 0) AS total_grams, COALESCE(SUM(fee), 0) AS total_fee
     FROM trade_journal WHERE type='buy'`
  ).get() as { cnt: number; total_amount: number; total_grams: number; total_fee: number };

  // 卖出汇总
  const sellRow = db.prepare(
    `SELECT COUNT(*) as cnt, COALESCE(SUM(price_cny_g * grams), 0) AS total_amount,
            COALESCE(SUM(grams), 0) AS total_grams, COALESCE(SUM(fee), 0) AS total_fee
     FROM trade_journal WHERE type='sell'`
  ).get() as { cnt: number; total_amount: number; total_grams: number; total_fee: number };

  // 未结持仓：买入但尚未配对卖出的记录
  const openRow = db.prepare(
    `SELECT COALESCE(SUM(grams), 0) AS open_grams,
            COALESCE(SUM(price_cny_g * grams), 0) AS open_cost,
            COALESCE(SUM(fee), 0) AS open_fee
     FROM trade_journal
     WHERE type = 'buy'
       AND id NOT IN (SELECT pair_id FROM trade_journal WHERE pair_id IS NOT NULL)`
  ).get() as { open_grams: number; open_cost: number; open_fee: number };

  const wins     = sells.filter(r => r.pnl > 0);
  const losses   = sells.filter(r => r.pnl <= 0);
  const totalPnl = sells.reduce((s, r) => s + r.pnl, 0);
  const avgWin   = wins.length   ? wins.reduce((s, r) => s + r.pnl, 0) / wins.length : 0;
  const avgLoss  = losses.length ? losses.reduce((s, r) => s + r.pnl, 0) / losses.length : 0;
  const totalFee = (buyRow.total_fee ?? 0) + (sellRow.total_fee ?? 0);

  return {
    total:           sells.length,
    wins:            wins.length,
    losses:          losses.length,
    winRate:         sells.length ? Math.round((wins.length / sells.length) * 100) : 0,
    totalPnl:        Math.round(totalPnl * 100) / 100,
    avgPnl:          sells.length ? Math.round((totalPnl / sells.length) * 100) / 100 : 0,
    avgWin:          Math.round(avgWin  * 100) / 100,
    avgLoss:         Math.round(avgLoss * 100) / 100,
    // 买入汇总
    buyCnt:          buyRow.cnt,
    buyTotalAmount:  Math.round((buyRow.total_amount ?? 0) * 100) / 100,
    buyTotalGrams:   Math.round((buyRow.total_grams ?? 0) * 1000) / 1000,
    // 卖出汇总
    sellCnt:         sellRow.cnt,
    sellTotalAmount: Math.round((sellRow.total_amount ?? 0) * 100) / 100,
    sellTotalGrams:  Math.round((sellRow.total_grams ?? 0) * 1000) / 1000,
    // 总手续费
    totalFee:        Math.round(totalFee * 100) / 100,
    // 未结持仓成本（用于前端实时计算浮动盈亏）
    openGrams:       Math.round((openRow.open_grams ?? 0) * 1000) / 1000,
    openCostBasis:   Math.round((openRow.open_cost  ?? 0) * 100)  / 100,
    openFee:         Math.round((openRow.open_fee   ?? 0) * 100)  / 100,
  };
}

// ── 52周高低点 & 昨日收盘（供关键位监控使用）──────────────────

/** 获取过去52周内的 CNY/g 最高价与最低价（基于 prices_daily.xau_cny_g）*/
export function get52WeekHighLow(): { high: number; low: number } | null {
  const db = getDB();
  const cutoff = new Date(Date.now() - 365 * 86400_000).toISOString().slice(0, 10);
  const row = db.prepare(`
    SELECT MAX(xau_cny_g) AS h, MIN(xau_cny_g) AS l
    FROM prices_daily
    WHERE date >= ? AND xau_cny_g IS NOT NULL
  `).get(cutoff) as { h: number | null; l: number | null } | undefined;
  if (!row || row.h === null || row.l === null) return null;
  return { high: row.h, low: row.l };
}

/** 获取昨日日线收盘 CNY/g 价格 */
export function getYesterdayCloseCny(): number | null {
  const db = getDB();
  const today = new Date().toISOString().slice(0, 10);
  const row = db.prepare(`
    SELECT xau_cny_g FROM prices_daily
    WHERE date < ? AND xau_cny_g IS NOT NULL
    ORDER BY date DESC LIMIT 1
  `).get(today) as { xau_cny_g: number } | undefined;
  return row?.xau_cny_g ?? null;
}

/** 生成 AI 可读的交易历史文本 */
export function buildJournalContextForAI(): string {
  const entries = getDB().prepare(
    `SELECT * FROM trade_journal ORDER BY ts ASC LIMIT 200`
  ).all() as Array<{ id: number; ts: number; type: string; price_cny_g: number; grams: number; fee: number; note: string; pair_id: number | null; pnl: number | null }>;

  if (entries.length === 0) return '（暂无交易记录）';

  const lines = entries.map(e => {
    const date = new Date(e.ts).toLocaleDateString('zh-CN');
    const base = `[${date}] ${e.type === 'buy' ? '买入' : '卖出'} ${e.grams}g @ ¥${e.price_cny_g}/g 手续费¥${e.fee}`;
    const pnlStr = e.pnl !== null ? ` 盈亏¥${e.pnl > 0 ? '+' : ''}${e.pnl.toFixed(2)}` : '';
    const noteStr = e.note ? ` 备注:${e.note}` : '';
    return base + pnlStr + noteStr;
  });

  const stats = getJournalStats() as { total: number; wins: number; winRate: number; totalPnl: number; avgPnl: number };

  return [
    `=== 交易流水（共${entries.length}条）===`,
    ...lines,
    '',
    `=== 统计汇总 ===`,
    `已结交易: ${stats.total}笔 | 盈利: ${stats.wins}笔 | 胜率: ${stats.winRate}%`,
    `累计盈亏: ¥${stats.totalPnl} | 平均每笔: ¥${stats.avgPnl}`,
  ].join('\n');
}
