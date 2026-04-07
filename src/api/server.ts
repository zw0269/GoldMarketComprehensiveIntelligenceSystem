/**
 * Express REST API 服务 (T-401 ~ T-404)
 * WebSocket 实时推送 (T-402)
 */
import express from 'express';
import { createServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import fs from 'fs';
import path from 'path';
import config from '../config';
import logger from '../utils/logger';
import {
  getLatestPrice,
  getPriceHistory,
  getDailyOHLCV,
  getInventoryHistory,
  getETFHoldingsHistory,
  getMacroDashboard,
  getLatestNews,
  getAlertHistory,
  getLatestPentagonPizza,
  getPentagonPizzaHistory,
  getLatestPolymarkets,
  buildIntelContext,
  insertQALog,
  getQALogs,
  countQALogs,
  deleteQALog,
} from '../storage/dao';
import dayjs from 'dayjs';

// CORS 中间件（需安装）
async function loadCors() {
  try {
    return (await import('cors')).default;
  } catch {
    return (_req: express.Request, _res: express.Response, next: express.NextFunction) => next();
  }
}

const app = express();
app.use(express.json());

// CORS
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

// ── 健康检查 (T-703) ──────────────────────────────────────────
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', ts: Date.now(), version: '0.1.0' });
});

// ── 价格 API ─────────────────────────────────────────────────
app.get('/api/price/latest', (_req, res) => {
  const price = getLatestPrice();
  if (!price) return res.status(404).json({ error: 'No price data' });
  res.json(price);
});

app.get('/api/price/history', (req, res) => {
  const tf = req.query['tf'] as string ?? '1h';
  const days = parseInt(req.query['days'] as string ?? '7', 10);
  const from = dayjs().subtract(days, 'day').valueOf();
  const to = Date.now();
  const data = getPriceHistory(from, to, 2880);
  res.json({ timeframe: tf, count: data.length, data });
});

// ── 库存 API ─────────────────────────────────────────────────
app.get('/api/inventory/comex', (_req, res) => {
  res.json(getInventoryHistory('COMEX', 90));
});

app.get('/api/inventory/shfe', (_req, res) => {
  res.json(getInventoryHistory('SHFE', 90));
});

app.get('/api/inventory/compare', (_req, res) => {
  res.json({
    COMEX: getInventoryHistory('COMEX', 30),
    SHFE: getInventoryHistory('SHFE', 30),
    LBMA: getInventoryHistory('LBMA', 30),
  });
});

// ── ETF API ──────────────────────────────────────────────────
app.get('/api/etf/holdings', (_req, res) => {
  res.json({
    GLD: getETFHoldingsHistory('GLD', 90),
    IAU: getETFHoldingsHistory('IAU', 90),
    HUAAN: getETFHoldingsHistory('HUAAN', 90),
  });
});

// ── 宏观仪表盘 ───────────────────────────────────────────────
app.get('/api/macro/dashboard', (_req, res) => {
  res.json(getMacroDashboard());
});

// ── 新闻 API ─────────────────────────────────────────────────
app.get('/api/news/latest', (req, res) => {
  const limit = parseInt(req.query['limit'] as string ?? '50', 10);
  res.json(getLatestNews(limit));
});

app.get('/api/news/trump', (_req, res) => {
  res.json(getLatestNews(30, 'trump'));
});

// Truth Social 实时拉取（绕过数据库缓存，直接请求最新帖）
app.get('/api/news/truthsocial', async (_req, res) => {
  try {
    const { fetchTruthSocialPosts } = await import('../collectors/news/truthsocial.collector');
    const posts = await fetchTruthSocialPosts(20);
    res.json(posts);
  } catch (err) {
    logger.error('[api] truthsocial fetch failed', { err });
    res.status(503).json({ error: String(err instanceof Error ? err.message : err) });
  }
});

// ── 技术指标 ─────────────────────────────────────────────────
app.get('/api/technical/:timeframe', (req, res) => {
  const tf = req.params['timeframe'] ?? '1d';
  const ohlcv = getDailyOHLCV(365);
  res.json({ timeframe: tf, bars: ohlcv });
});

// ── 比值 API ─────────────────────────────────────────────────
app.get('/api/ratio/gold-silver', (_req, res) => {
  const macro = getMacroDashboard();
  const latest = getLatestPrice() as Record<string, number> | null;
  if (!latest || !macro['SILVER']) return res.status(503).json({ error: 'Insufficient data' });
  const ratio = latest['xau_usd'] / macro['SILVER'];
  res.json({ ratio: parseFloat(ratio.toFixed(2)), gold: latest['xau_usd'], silver: macro['SILVER'] });
});

app.get('/api/premium/sge', (_req, res) => {
  const latest = getLatestPrice() as Record<string, number> | null;
  if (!latest) return res.status(404).json({ error: 'No data' });
  res.json({
    sgePremiumUsd: latest['sge_premium'],
    xauUsd: latest['xau_usd'],
    xauCnyG: latest['xau_cny_g'],
    usdCny: latest['usd_cny'],
  });
});

// ── 告警 API ─────────────────────────────────────────────────
app.get('/api/alerts/history', (_req, res) => {
  res.json(getAlertHistory(100));
});

// ── 三大前瞻指标 API ──────────────────────────────────────────
app.get('/api/intel/forward', (_req, res) => {
  const macro     = getMacroDashboard() as Record<string, number>;
  const pizza     = getLatestPentagonPizza();
  const polymarks = getLatestPolymarkets(20);
  const tnx       = macro['TNX'] ?? null;

  res.json({
    tnx: {
      value: tnx,
      signal: tnx == null ? 'unknown'
        : tnx > 4.4 ? 'risk_on_fear'    // 科技股压力，黄金逻辑分化
        : tnx < 4.3 ? 'defensive_flow'  // 防守资金回流，黄金受益
        : 'neutral',
      interpretation: tnx == null ? '暂无数据'
        : tnx > 4.4 ? `${tnx.toFixed(3)}% — 超过4.4%警戒线！科技股压力加大，防守资金流入逻辑减弱`
        : tnx < 4.3 ? `${tnx.toFixed(3)}% — 跌破4.3%！防守资金回流，黄金等避险品种受益`
        : `${tnx.toFixed(3)}% — 中性区间，持续观察`,
    },
    pentagonPizza: pizza ? {
      score:          pizza['score'],
      articleCount:   pizza['article_count'],
      alertLevel:     pizza['alert_level'],
      interpretation: pizza['interpretation'],
      updatedAt:      pizza['ts'],
    } : null,
    polymarket: {
      markets: polymarks.map(m => ({
        question: m['question'],
        yesPrice: m['yes_price'],
        yesPct:   Math.round((m['yes_price'] as number) * 100),
        volume24h: m['volume24h'],
        endDate:  m['end_date'],
      })),
      updatedAt: polymarks[0]?.['fetched_at'] ?? null,
    },
  });
});

app.get('/api/intel/pentagon/history', (_req, res) => {
  res.json(getPentagonPizzaHistory(72));
});

// ── 分钟级实时走势 API（Yahoo Finance GC=F）─────────────────────
app.get('/api/price/intraday', async (req, res) => {
  const interval = (req.query['interval'] as string) || '5m';
  const range    = (req.query['range']    as string) || '5d';
  const validIntervals = ['1m', '2m', '5m', '15m', '30m', '60m'];
  const validRanges    = ['1d', '5d', '1mo'];
  if (!validIntervals.includes(interval)) return res.status(400).json({ error: 'Invalid interval' });
  if (!validRanges.includes(range))       return res.status(400).json({ error: 'Invalid range' });

  try {
    const { default: axios } = await import('axios');
    const r = await axios.get('https://query1.finance.yahoo.com/v8/finance/chart/GC%3DF', {
      params: { interval, range },
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
      timeout: 12000,
    });

    const chart  = (r.data as Record<string, unknown>)?.['chart'] as Record<string, unknown>;
    const result = ((chart?.['result'] as unknown[]) ?? [])[0] as Record<string, unknown> | undefined;
    if (!result) return res.status(503).json({ error: 'Yahoo Finance 无数据' });

    const timestamps = result['timestamp'] as number[] | undefined;
    const indicators = result['indicators'] as Record<string, unknown> | undefined;
    const quote      = ((indicators?.['quote'] as unknown[]) ?? [])[0] as Record<string, number[]> | undefined;
    const closes     = quote?.['close'];

    if (!timestamps || !closes) return res.status(503).json({ error: 'Yahoo Finance 响应格式异常' });

    const usdCny = 7.25;
    const data = timestamps
      .map((t, i) => ({
        ts:       t * 1000,
        xau_usd:  closes[i] ?? null,
        xau_cny_g: closes[i] ? parseFloat(((closes[i] * usdCny) / 31.1035).toFixed(2)) : null,
      }))
      .filter(d => d.xau_usd != null && !isNaN(d.xau_usd) && d.xau_usd > 100);

    res.json({ interval, range, count: data.length, data, source: 'yahoo' });
  } catch (err) {
    logger.warn('[api] intraday yahoo failed, falling back to local DB', { err });
    const dbData = getPriceHistory(Date.now() - 7 * 86400000, Date.now(), 2880);
    if (dbData.length > 0) return res.json({ interval, range, count: dbData.length, data: dbData, source: 'local' });
    const errMsg = err instanceof Error ? err.message : String(err);
    res.status(503).json({ error: '分钟数据获取失败', detail: errMsg });
  }
});

// ── 历史行情 API ──────────────────────────────────────────────
app.get('/api/price/historical', async (req, res) => {
  const range      = (req.query['range'] as string) || '1y';
  const forceRefresh = req.query['refresh'] === '1';
  const validRanges = ['1mo', '3mo', '1y', '5y', 'max'];
  if (!validRanges.includes(range)) return res.status(400).json({ error: 'Invalid range' });

  try {
    const { fetchHistoricalGold, clearHistoricalCache } = await import('../collectors/price/historical.collector');
    if (forceRefresh) clearHistoricalCache(range as '1mo' | '3mo' | '1y' | '5y' | 'max');
    const data = await fetchHistoricalGold(range as '1mo' | '3mo' | '1y' | '5y' | 'max');
    res.json({ range, count: data.length, data, source: 'remote' });
  } catch (err) {
    logger.warn('[api] historical fetch failed, falling back to local DB', { err });
    // 降级：外部 API 不可用时使用本地数据库历史数据
    try {
      const { getDailyOHLCV } = require('../storage/dao');
      const daysMap: Record<string, number> = { '1mo': 30, '3mo': 90, '1y': 365, '5y': 1825, 'max': 9999 };
      const days = daysMap[range] ?? 365;
      const rows = getDailyOHLCV(days) as Array<{
        date: string; open: number; high: number; low: number; close: number; volume: number;
      }>;
      if (rows.length > 0) {
        const fallbackData = rows.reverse().map(r => ({
          timestamp: new Date(r.date).getTime(),
          open:  r.open,
          high:  r.high,
          low:   r.low,
          close: r.close,
          volume: r.volume ?? 0,
          timeframe: ['1mo', '3mo', '1y'].includes(range) ? '1d' : '1w',
        }));
        return res.json({ range, count: fallbackData.length, data: fallbackData, source: 'local' });
      }
    } catch (fallbackErr) {
      logger.error('[api] local DB fallback also failed', { fallbackErr });
    }
    const errMsg = err instanceof Error ? err.message : String(err);
    res.status(503).json({ error: '历史数据获取失败，请稍后重试', detail: errMsg });
  }
});

// ── 用户想法工坊 API ─────────────────────────────────────────
app.get('/api/ideas', (_req, res) => {
  const { getIdeas } = require('../storage/dao');
  const ideas = getIdeas(50) as Record<string, unknown>[];
  // 解析 ai_analysis JSON
  const parsed = ideas.map(idea => ({
    ...idea,
    ai_analysis: idea['ai_analysis']
      ? (() => { try { return JSON.parse(idea['ai_analysis'] as string); } catch { return null; } })()
      : null,
    market_snapshot: undefined, // 不暴露快照给前端（太大）
  }));
  res.json(parsed);
});

app.post('/api/ideas', async (req, res) => {
  const { content } = req.body as { content?: string };
  if (!content?.trim()) return res.status(400).json({ error: 'content is required' });

  try {
    const { analyzeIdea } = await import('../processors/ai/idea-analyzer');
    const { id, result } = await analyzeIdea(content.trim());
    // 通过 WebSocket 广播分析完成
    broadcast('IDEA_ANALYZED', { id, result });
    res.json({ id, result });
  } catch (err) {
    logger.error('[api] idea analysis failed', { err });
    res.status(503).json({ error: String(err instanceof Error ? err.message : err) });
  }
});

// ── 持仓管理 API ─────────────────────────────────────────────

/** 开仓（买入） */
app.post('/api/positions', (req, res) => {
  const { buy_price_cny_g, grams, bank, buy_fee, note, stop_loss, target_profit, entry_signal } =
    req.body as {
      buy_price_cny_g?: number; grams?: number; bank?: string; buy_fee?: number;
      note?: string; stop_loss?: number; target_profit?: number; entry_signal?: string;
    };
  if (!buy_price_cny_g || !grams) {
    return res.status(400).json({ error: 'buy_price_cny_g and grams are required' });
  }
  const { openPosition } = require('../storage/dao');
  const id = openPosition({ buy_price_cny_g, grams, bank, buy_fee, note, stop_loss, target_profit, entry_signal });
  broadcast('POSITION_OPENED', { id, buy_price_cny_g, grams });
  res.json({ id });
});

/** 获取所有持仓（含实时盈亏，由前端用WS价格计算） */
app.get('/api/positions', (_req, res) => {
  const { getOpenPositions } = require('../storage/dao');
  const positions = getOpenPositions() as Record<string, unknown>[];
  const parsed = positions.map(p => ({
    ...p,
    entry_signal: p['entry_signal']
      ? (() => { try { return JSON.parse(p['entry_signal'] as string); } catch { return null; } })()
      : null,
  }));
  res.json(parsed);
});

/** 平仓 + 触发AI复盘 */
app.post('/api/positions/:id/close', async (req, res) => {
  const id = parseInt(req.params['id'] ?? '0', 10);
  const { close_price_cny_g, close_fee } = req.body as { close_price_cny_g?: number; close_fee?: number };
  if (!close_price_cny_g) return res.status(400).json({ error: 'close_price_cny_g is required' });

  try {
    const { closePosition, savePositionReview, getOpenPositions } = require('../storage/dao');

    // 先取得仓位信息（平仓前）
    const positions = getOpenPositions() as Record<string, unknown>[];
    const pos = positions.find(p => (p['id'] as number) === id);
    if (!pos) return res.status(404).json({ error: 'Position not found' });

    const closeResult = closePosition(id, close_price_cny_g, close_fee ?? 0);
    broadcast('POSITION_CLOSED', { id, ...closeResult });

    // 异步触发AI复盘（不阻塞响应）
    res.json({ id, ...closeResult });

    setImmediate(async () => {
      try {
        const { reviewTrade } = await import('../processors/ai/trade-reviewer');
        const review = await reviewTrade({
          buy_price:      pos['buy_price_cny_g'] as number,
          close_price:    close_price_cny_g,
          grams:          pos['grams'] as number,
          buy_fee:        (pos['buy_fee'] as number) ?? 0,
          close_fee:      close_fee ?? 0,
          realized_pnl:   closeResult.realized_pnl,
          pnl_pct:        closeResult.pnl_pct,
          holding_hours:  closeResult.holding_hours,
          buy_ts:         pos['buy_ts'] as number,
          close_ts:       Date.now(),
          entry_signal:   (pos['entry_signal'] as string) ?? null,
          stop_loss:      (pos['stop_loss'] as number) ?? null,
          target_profit:  (pos['target_profit'] as number) ?? null,
          note:           (pos['note'] as string) ?? '',
        });
        savePositionReview(id, JSON.stringify(review));
        broadcast('REVIEW_READY', { id, review });
      } catch (err) {
        logger.error('[api] trade review failed', { err });
      }
    });

  } catch (err) {
    logger.error('[api] close position failed', { err });
    res.status(503).json({ error: String(err instanceof Error ? err.message : err) });
  }
});

/** 已平仓历史 + 复盘 */
app.get('/api/positions/closed', (_req, res) => {
  const { getClosedPositions } = require('../storage/dao');
  const rows = (getClosedPositions(50) as Record<string, unknown>[]).map(p => ({
    ...p,
    entry_signal:   p['entry_signal']   ? (() => { try { return JSON.parse(p['entry_signal'] as string);   } catch { return null; } })() : null,
    review_content: p['review_content'] ? (() => { try { return JSON.parse(p['review_content'] as string); } catch { return null; } })() : null,
  }));
  res.json(rows);
});

/** 交易统计（胜率/盈亏比） */
app.get('/api/positions/stats', (_req, res) => {
  const { getTradeStats } = require('../storage/dao');
  res.json(getTradeStats());
});

/** 修改持仓（开仓或历史记录均可，字段按需传） */
app.put('/api/positions/:id', (req, res) => {
  const id = parseInt(req.params['id'] ?? '0', 10);
  if (!id) return res.status(400).json({ error: 'Invalid id' });
  try {
    const { updatePosition } = require('../storage/dao');
    updatePosition(id, req.body);
    res.json({ ok: true });
  } catch (err) {
    logger.error('[api] update position failed', { err });
    res.status(500).json({ error: String(err instanceof Error ? err.message : err) });
  }
});

/** 删除持仓（开仓或历史记录均可删除） */
app.delete('/api/positions/:id', (req, res) => {
  const id = parseInt(req.params['id'] ?? '0', 10);
  if (!id) return res.status(400).json({ error: 'Invalid id' });
  try {
    const { deletePosition } = require('../storage/dao');
    deletePosition(id);
    res.json({ ok: true });
  } catch (err) {
    logger.error('[api] delete position failed', { err });
    res.status(500).json({ error: String(err instanceof Error ? err.message : err) });
  }
});

// ── 交易信号 API (A-011) ─────────────────────────────────────
app.get('/api/signals/latest', async (_req, res) => {
  try {
    const { generateSignal } = await import('../processors/ai/signal-engine');
    const signal = await generateSignal();
    res.json(signal);
  } catch (err) {
    logger.error('[api] signal generation failed', { err });
    res.status(503).json({ error: String(err instanceof Error ? err.message : err) });
  }
});

app.get('/api/signals/history', (_req, res) => {
  const { getSignalHistory } = require('../storage/dao');
  const rows = (getSignalHistory(30) as Record<string, unknown>[]).map(r => ({
    ...r,
    reasons:    r['reasons']    ? (() => { try { return JSON.parse(r['reasons'] as string); } catch { return []; } })() : [],
    technicals: r['technicals'] ? (() => { try { return JSON.parse(r['technicals'] as string); } catch { return {}; } })() : {},
  }));
  res.json(rows);
});

// ── 积存金交易日志 API (B-011~B-013) ─────────────────────────
app.post('/api/trades', (req, res) => {
  const { type, price_cny_g, grams, bank, fee, note, signal_id } =
    req.body as {
      type?: string; price_cny_g?: number; grams?: number;
      bank?: string; fee?: number; note?: string; signal_id?: number;
    };
  if (!type || !price_cny_g || !grams) {
    return res.status(400).json({ error: 'type, price_cny_g, grams are required' });
  }
  if (!['buy', 'sell'].includes(type)) {
    return res.status(400).json({ error: 'type must be buy or sell' });
  }
  const { insertTrade } = require('../storage/dao');
  const id = insertTrade({ type, price_cny_g, grams, bank, fee, note, signal_id });
  broadcast('TRADE_ADDED', { id, type, price_cny_g, grams });
  res.json({ id });
});

app.get('/api/trades', (_req, res) => {
  const { getTrades } = require('../storage/dao');
  res.json(getTrades(200));
});

app.get('/api/trades/pnl', (req, res) => {
  const { getPositionSummary, getLatestPrice: lp } = require('../storage/dao');
  const latest = lp() as Record<string, number> | null;
  const currentCnyG = latest?.['xau_cny_g'] as number | undefined;
  if (!currentCnyG) return res.status(503).json({ error: 'No price data for P&L calculation' });
  res.json(getPositionSummary(currentCnyG));
});

// ── AI 问答历史 API ───────────────────────────────────────────
app.get('/api/ai/qa-log', (req, res) => {
  const type   = req.query['type'] as string | undefined;
  const limit  = Math.min(parseInt(req.query['limit']  as string ?? '30', 10), 100);
  const offset = parseInt(req.query['offset'] as string ?? '0', 10);
  const rows   = getQALogs({ type, limit, offset });
  const total  = countQALogs(type);
  const parsed = rows.map(r => ({
    ...r,
    meta: r['meta'] ? (() => { try { return JSON.parse(r['meta'] as string); } catch { return null; } })() : null,
  }));
  res.json({ total, limit, offset, data: parsed });
});

app.delete('/api/ai/qa-log/:id', (req, res) => {
  const id = parseInt(req.params['id'] ?? '0', 10);
  if (!id) return res.status(400).json({ error: 'Invalid id' });
  try {
    deleteQALog(id);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: String(err instanceof Error ? err.message : err) });
  }
});

// ── AI 后端信息 ───────────────────────────────────────────────
app.get('/api/ai/backend', (_req, res) => {
  const { getAIBackendInfo } = require('../processors/ai/claude-client');
  res.json(getAIBackendInfo());
});

// ── AI 问答（基于当前市场数据）──────────────────────────────
app.post('/api/ai/chat', async (req, res) => {
  const { question, history } = req.body as {
    question?: string;
    history?: Array<{ role: string; content: string }>;
  };
  if (!question?.trim()) return res.status(400).json({ error: 'question is required' });

  try {
    const { callClaude } = await import('../processors/ai/claude-client');

    // 收集当前市场上下文
    const latestPrice  = getLatestPrice() as Record<string, number> | null;
    const macro        = getMacroDashboard() as Record<string, number>;
    const news         = getLatestNews(10) as Array<Record<string, unknown>>;

    const priceCtx = latestPrice
      ? `当前黄金价格：¥${latestPrice['xau_cny_g']?.toFixed(2)}/克，$${latestPrice['xau_usd']?.toFixed(2)}/盎司，USD/CNY=${latestPrice['usd_cny']?.toFixed(4)}，SGE溢价$${latestPrice['sge_premium']?.toFixed(2)}`
      : '（暂无价格数据）';

    const macroCtx = Object.entries(macro)
      .slice(0, 8)
      .map(([k, v]) => `${k}=${typeof v === 'number' ? v.toFixed(4) : v}`)
      .join('，');

    const newsCtx = news
      .map(n => `• ${n['title']} [${n['ai_direction'] ?? ''}·影响${n['ai_impact'] ?? '?'}分]`)
      .join('\n');

    // 三大前瞻指标上下文
    const intelCtx = buildIntelContext(macro as Record<string, number>);

    // 对话历史（限制最近6轮）
    const historyText = (history ?? []).slice(-6)
      .map(m => `${m['role'] === 'user' ? '用户' : 'AI'}：${m['content']}`)
      .join('\n');

    const CHAT_SYSTEM = `你是 Gold Sentinel 的专属 AI 分析师，拥有20年黄金市场交易经验。
你能基于实时市场数据、宏观指标、新闻资讯回答用户关于黄金投资的任何问题。
回答要专业、简洁、有据可依，适当给出操作建议时请注明风险提示。
当前系统数据会作为上下文提供给你，请充分利用。`.trim();

    const userMsg = [
      `【实时市场数据】`,
      priceCtx,
      macroCtx ? `宏观指标：${macroCtx}` : '',
      intelCtx,
      newsCtx ? `最新要闻：\n${newsCtx}` : '',
      historyText ? `\n【对话历史】\n${historyText}` : '',
      `\n【用户提问】\n${question.trim()}`,
    ].filter(Boolean).join('\n');

    const answer = await callClaude(CHAT_SYSTEM, userMsg, 1500, 'chat');

    // 保存干净 Q&A（只存用户原始问题 + AI回答，不含注入上下文）
    setImmediate(() => {
      try {
        insertQALog({ type: 'chat', question: question.trim(), answer });
      } catch { /* ignore log failure */ }
    });

    res.json({ answer, ts: Date.now() });
  } catch (err) {
    logger.error('[api] ai chat failed', { err });
    res.status(503).json({ error: String(err instanceof Error ? err.message : err) });
  }
});

// ── AI 每日总结历史 ──────────────────────────────────────────
app.get('/api/ai/summaries', (_req, res) => {
  const { getAIDailySummaries } = require('../storage/dao');
  res.json(getAIDailySummaries(30));
});

// ── 策略面板 API ──────────────────────────────────────────────
app.get('/api/strategy', (_req, res) => {
  const filePath = path.join(process.cwd(), 'STRATEGY.md');
  if (!fs.existsSync(filePath)) return res.json([]);

  const content = fs.readFileSync(filePath, 'utf-8');
  const items: Record<string, string>[] = [];

  // 解析每个 ### 💡 S-xxx 条目
  const blocks = content.split(/\n(?=###\s+💡\s+S-)/);
  for (const block of blocks) {
    const idMatch = block.match(/###\s+💡\s+(S-\d+)\s+(.+)/);
    if (!idMatch) continue;

    const id = idMatch[1];
    const title = idMatch[2].trim();
    const dateMatch = block.match(/\*\*提出时间\*\*:\s*(.+)/);
    const moduleMatch = block.match(/\*\*影响模块\*\*:\s*(.+)/);
    const statusMatch = block.match(/\*\*状态\*\*:\s*(.+)/);
    const descMatch = block.match(/\*\*描述\*\*:\s*(.+)/);
    const compMatch = block.match(/\*\*对比当前方案\*\*:\s*(.+)/);
    const concMatch = block.match(/\*\*结论\/备注\*\*:\s*(.+)/);

    items.push({
      id,
      title,
      date: dateMatch?.[1]?.trim() ?? '',
      module: moduleMatch?.[1]?.trim() ?? '',
      status: statusMatch?.[1]?.trim() ?? '',
      description: descMatch?.[1]?.trim() ?? '',
      comparison: compMatch?.[1]?.trim() ?? '',
      conclusion: concMatch?.[1]?.trim() ?? '',
    });
  }

  res.json(items);
});

// ── WebSocket 实时推送 (T-402) ────────────────────────────────
const httpServer = createServer(app);
const wss = new WebSocketServer({ server: httpServer, path: '/ws' });

const wsClients = new Set<WebSocket>();

wss.on('connection', (ws) => {
  wsClients.add(ws);
  logger.info('[ws] client connected', { total: wsClients.size });

  ws.on('close', () => {
    wsClients.delete(ws);
    logger.debug('[ws] client disconnected', { total: wsClients.size });
  });

  // 发送最新价格 + 当前持仓（供前端计算实时P&L）
  const latest = getLatestPrice();
  if (latest) ws.send(JSON.stringify({ type: 'PRICE', data: latest }));
  const { getOpenPositions } = require('../storage/dao');
  const positions = getOpenPositions();
  if (positions.length > 0) ws.send(JSON.stringify({ type: 'POSITIONS', data: positions }));
});

/** 向所有 WS 客户端广播 */
export function broadcast(type: string, data: unknown): void {
  const message = JSON.stringify({ type, data, ts: Date.now() });
  for (const client of wsClients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(message);
    }
  }
}

export function startAPIServer(): void {
  httpServer.listen(config.app.port, () => {
    logger.info(`[api] server running on http://localhost:${config.app.port}`);
    logger.info(`[api] WebSocket ready on ws://localhost:${config.app.port}/ws`);
  });
}
