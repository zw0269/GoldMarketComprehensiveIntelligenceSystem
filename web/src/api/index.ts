import axios from 'axios';

const API_BASE = import.meta.env.VITE_API_URL ?? 'http://localhost';
const WS_URL = import.meta.env.VITE_WS_URL ?? 'ws://localhost/ws';

const http = axios.create({ baseURL: API_BASE, timeout: 10000 });

// ── API 调用封装 ──────────────────────────────────────────────
export const api = {
  getLatestPrice: () => http.get('/api/price/latest').then(r => r.data),
  getPriceHistory: (tf = '1h', days = 7) =>
    http.get('/api/price/history', { params: { tf, days } }).then(r => r.data),
  getInventoryCompare: () => http.get('/api/inventory/compare').then(r => r.data),
  getETFHoldings: () => http.get('/api/etf/holdings').then(r => r.data),
  getMacroDashboard: () => http.get('/api/macro/dashboard').then(r => r.data),
  getLatestNews: (limit = 50) => http.get('/api/news/latest', { params: { limit } }).then(r => r.data),
  getTrumpNews: () => http.get('/api/news/trump').then(r => r.data),
  getTruthSocialPosts: () => http.get('/api/news/truthsocial').then(r => r.data),
  getAlerts: () => http.get('/api/alerts/history').then(r => r.data),
  getSGEPremium: () => http.get('/api/premium/sge').then(r => r.data),
  getGoldSilverRatio: () => http.get('/api/ratio/gold-silver').then(r => r.data),
  getStrategy: () => http.get('/api/strategy').then(r => r.data),
  getAIBackend: () => http.get('/api/ai/backend').then(r => r.data),
  getIntraday: (interval = '5m', range = '5d') =>
    http.get('/api/price/intraday', { params: { interval, range }, timeout: 15000 }).then(r => r.data),
  getForwardIntel: () =>
    http.get('/api/intel/forward', { timeout: 8000 }).then(r => r.data),
  getPentagonHistory: () =>
    http.get('/api/intel/pentagon/history', { timeout: 8000 }).then(r => r.data),
  getHistorical: (range = '1y') =>
    http.get('/api/price/historical', { params: { range }, timeout: 35000 }).then(r => r.data),
  getHistoricalRefresh: (range = '1y') =>
    http.get('/api/price/historical', { params: { range, refresh: '1' }, timeout: 35000 }).then(r => r.data),
  getIdeas: () => http.get('/api/ideas').then(r => r.data),
  submitIdea: (content: string) => http.post('/api/ideas', { content }, { timeout: 600000 }).then(r => r.data),
  // 交易信号
  getLatestSignal: () => http.get('/api/signals/latest').then(r => r.data),
  getSignalHistory: () => http.get('/api/signals/history').then(r => r.data),
  // 积存金交易日志（旧）
  getTrades: () => http.get('/api/trades').then(r => r.data),
  getPnL: () => http.get('/api/trades/pnl').then(r => r.data),
  addTrade: (trade: { type: string; price_cny_g: number; grams: number; bank?: string; fee?: number; note?: string }) =>
    http.post('/api/trades', trade).then(r => r.data),
  // 持仓管理（新）
  openPosition: (pos: { buy_price_cny_g: number; grams: number; bank?: string; buy_fee?: number; note?: string; stop_loss?: number; target_profit?: number; entry_signal?: string }) =>
    http.post('/api/positions', pos).then(r => r.data),
  getPositions: () => http.get('/api/positions').then(r => r.data),
  closePosition: (id: number, close_price_cny_g: number, close_fee?: number) =>
    http.post(`/api/positions/${id}/close`, { close_price_cny_g, close_fee }).then(r => r.data),
  getClosedPositions: () => http.get('/api/positions/closed').then(r => r.data),
  updatePosition: (id: number, fields: Record<string, unknown>) =>
    http.put(`/api/positions/${id}`, fields).then(r => r.data),
  deletePosition: (id: number) =>
    http.delete(`/api/positions/${id}`).then(r => r.data),
  getTradeStats: () => http.get('/api/positions/stats').then(r => r.data),
  // AI 问答
  chatWithAI: (question: string, history?: Array<{ role: string; content: string }>) =>
    http.post('/api/ai/chat', { question, history }, { timeout: 600000 }).then(r => r.data),
  // AI 每日总结
  getAIDailySummaries: () => http.get('/api/ai/summaries').then(r => r.data),
  // AI 问答历史
  getQALog: (opts: { type?: string; limit?: number; offset?: number } = {}) =>
    http.get('/api/ai/qa-log', { params: opts }).then(r => r.data),
  deleteQALog: (id: number) =>
    http.delete(`/api/ai/qa-log/${id}`).then(r => r.data),
};

// ── WebSocket 连接 ────────────────────────────────────────────
export function createWSConnection(onMessage: (data: Record<string, unknown>) => void) {
  let ws: WebSocket | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  function connect() {
    ws = new WebSocket(WS_URL);

    ws.onopen = () => console.log('[ws] connected');
    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data as string);
        onMessage(data);
      } catch { /* ignore */ }
    };
    ws.onclose = () => {
      console.log('[ws] disconnected, reconnecting in 3s...');
      reconnectTimer = setTimeout(connect, 3000);
    };
    ws.onerror = (err) => console.error('[ws] error', err);
  }

  connect();

  return {
    close: () => {
      if (reconnectTimer) clearTimeout(reconnectTimer);
      ws?.close();
    },
  };
}
