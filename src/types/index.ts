// ============================================================
// Gold Sentinel — 核心 TypeScript 类型定义
// ============================================================

// ── 价格数据 ─────────────────────────────────────────────────
export interface IPriceData {
  source: string;
  timestamp: number;      // Unix timestamp (ms)
  xauUsd: number;         // 国际金价 USD/oz
  xauCny?: number;        // 人民币金价 CNY/g (可选，从汇率换算或直接获取)
  usdCny?: number;        // 美元/人民币汇率
  sgePremium?: number;    // SGE 溢价 (USD/oz)
  sgePremiumPct?: number; // SGE 溢价百分比
}

// ── OHLCV K线 ────────────────────────────────────────────────
export interface IOHLCV {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
  timeframe: '1m' | '5m' | '15m' | '1h' | '4h' | '1d' | '1w';
}

// ── 库存数据 ─────────────────────────────────────────────────
export interface IInventoryData {
  date: string;           // YYYY-MM-DD
  exchange: 'COMEX' | 'SHFE' | 'LBMA';
  registered?: number;    // oz (COMEX Registered)
  eligible?: number;      // oz (COMEX Eligible)
  total: number;          // oz or kg (SHFE用kg)
  unit: 'oz' | 'kg';
  change?: number;        // 日变化量
}

// ── ETF 持仓 ─────────────────────────────────────────────────
export interface IETFHolding {
  date: string;
  fund: 'GLD' | 'IAU' | 'HUAAN' | 'EFUND' | string;
  tonnes: number;
  change?: number;
  changePercent?: number;
}

// ── CFTC COT 报告 ─────────────────────────────────────────────
export interface ICOTReport {
  date: string;
  commercialLong: number;
  commercialShort: number;
  noncommLong: number;
  noncommShort: number;
  netLong: number;        // noncommLong - noncommShort
}

// ── 宏观数据 ─────────────────────────────────────────────────
export interface IMacroData {
  date: string;
  indicator: string;      // DXY / US10Y / TIPS / CPI / VIX 等
  value: number;
  source: string;
}

// ── 新闻条目 ─────────────────────────────────────────────────
export interface INewsItem {
  id?: number;
  source: string;
  timestamp: number;
  title: string;
  summary?: string;
  url?: string;
  category?: 'trump' | 'fed' | 'geopolitical' | 'economic' | 'gold' | 'general';
  aiDirection?: 'bullish' | 'bearish' | 'neutral';
  aiImpact?: 1 | 2 | 3 | 4 | 5;
  aiReasoning?: string;
  aiTimeframe?: 'intraday' | 'short-term' | 'medium-term' | 'long-term';
}

// ── 告警 ─────────────────────────────────────────────────────
export type AlertPriority = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
export type AlertType = 'PRICE' | 'INVENTORY' | 'ETF' | 'NEWS' | 'SYSTEM';

export interface IAlert {
  id?: number;
  timestamp: number;
  type: AlertType;
  priority: AlertPriority;
  title: string;
  message: string;
  data?: Record<string, unknown>;
  sent: boolean;
}

// ── AI 新闻评估响应 ───────────────────────────────────────────
export interface IAINewsAssessment {
  direction: 'bullish' | 'bearish' | 'neutral';
  impact: 1 | 2 | 3 | 4 | 5;
  reasoning: string;
  timeframe: 'intraday' | 'short-term' | 'medium-term' | 'long-term';
}

// ── 央行购金 ─────────────────────────────────────────────────
export interface ICentralBankPurchase {
  date: string;
  country: string;
  tonnes: number;
  isNet: boolean; // true = 净购入, false = 净卖出
}
