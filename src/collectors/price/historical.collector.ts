/**
 * 黄金历史 OHLCV 数据采集器
 *
 * 主源：Yahoo Finance GC=F（COMEX黄金期货，USD/oz）— 已验证国内可访问
 * 备源1：东方财富 K线接口 — 上期所沪金主力(AU0)，单位 CNY/g
 * 备源2：腾讯财经 K线接口 — SHFE 沪金主力，同单位 CNY/g
 * 备源3：新浪财经 SGE Au9999，同单位 CNY/g
 *
 * 注意：国内直连接口请求时显式绕过系统代理(proxy:false)
 * 缓存：每个 range 15分钟内不重复请求，保证前端快速响应
 */
import axios from 'axios';
import dayjs from 'dayjs';
import logger from '../../utils/logger';
import type { IOHLCV } from '../../types';

export type Range = '1mo' | '3mo' | '1y' | '5y' | 'max';

// ── Yahoo Finance 基础 URL ──────────────────────────────────────
const YAHOO_CHART = 'https://query1.finance.yahoo.com/v8/finance/chart';

// ── 内存缓存（15分钟TTL）────────────────────────────────────────
interface CacheEntry { data: IOHLCV[]; expiry: number; source: string }
const _cache = new Map<string, CacheEntry>();
const CACHE_TTL = 15 * 60 * 1000;

function fromCache(range: Range): IOHLCV[] | null {
  const e = _cache.get(range);
  if (e && Date.now() < e.expiry) {
    logger.info(`[historical] cache hit: ${e.data.length} bars (range=${range}, src=${e.source})`);
    return e.data;
  }
  return null;
}

function toCache(range: Range, data: IOHLCV[], source: string): void {
  _cache.set(range, { data, expiry: Date.now() + CACHE_TTL, source });
}

// ── Range → K线参数映射 ─────────────────────────────────────────
const RANGE_KLT: Record<Range, number> = {
  '1mo': 101, '3mo': 101, '1y': 101, '5y': 102, 'max': 102,
};
const RANGE_TF: Record<Range, IOHLCV['timeframe']> = {
  '1mo': '1d', '3mo': '1d', '1y': '1d', '5y': '1w', 'max': '1w',
};

function getBeg(range: Range): string {
  const now = dayjs();
  switch (range) {
    case '1mo':  return now.subtract(1,  'month').format('YYYYMMDD');
    case '3mo':  return now.subtract(3,  'month').format('YYYYMMDD');
    case '1y':   return now.subtract(1,  'year').format('YYYYMMDD');
    case '5y':   return now.subtract(5,  'year').format('YYYYMMDD');
    case 'max':  return '19900101';
  }
}

// ── Yahoo Finance 历史K线（主源，USD/oz，国内可访问）─────────────
const YAHOO_HIST_INTERVAL: Record<Range, string> = {
  '1mo': '1d', '3mo': '1d', '1y': '1d', '5y': '1wk', 'max': '1mo',
};
const YAHOO_HIST_RANGE: Record<Range, string> = {
  '1mo': '1mo', '3mo': '3mo', '1y': '1y', '5y': '5y', 'max': 'max',
};

async function fetchFromYahoo(range: Range): Promise<IOHLCV[]> {
  const res = await axios.get(`${YAHOO_CHART}/GC%3DF`, {
    params: {
      interval: YAHOO_HIST_INTERVAL[range],
      range:    YAHOO_HIST_RANGE[range],
    },
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
    timeout: 12000,
  });

  const chart  = (res.data as Record<string, unknown>)?.['chart'] as Record<string, unknown>;
  const result = ((chart?.['result'] as unknown[]) ?? [])[0] as Record<string, unknown> | undefined;
  if (!result) throw new Error('Yahoo historical: no result');

  const timestamps = result['timestamp'] as number[] | undefined;
  const indicators = result['indicators'] as Record<string, unknown> | undefined;
  const quote = ((indicators?.['quote'] as unknown[]) ?? [])[0] as Record<string, number[]> | undefined;

  if (!timestamps || !quote) throw new Error('Yahoo historical: missing timestamp/quote');

  const opens   = quote['open']   ?? [];
  const highs   = quote['high']   ?? [];
  const lows    = quote['low']    ?? [];
  const closes  = quote['close']  ?? [];
  const volumes = quote['volume'] ?? [];

  const tf = RANGE_TF[range];
  const bars: IOHLCV[] = [];

  for (let i = 0; i < timestamps.length; i++) {
    const open  = opens[i];
    const high  = highs[i];
    const low   = lows[i];
    const close = closes[i];
    if (open == null || close == null || isNaN(open) || isNaN(close)) continue;
    bars.push({
      timestamp: timestamps[i]! * 1000,
      open,
      high: high ?? open,
      low:  low  ?? open,
      close,
      volume: volumes[i] ?? 0,
      timeframe: tf,
    });
  }

  if (bars.length === 0) throw new Error('Yahoo historical: parsed 0 valid bars');
  logger.info(`[historical] yahoo OK: ${bars.length} bars (range=${range}, USD/oz)`);
  return bars;
}

// ── 东方财富 K线接口 ────────────────────────────────────────────
// secid=113.AU0  上期所沪金主力（CNY/g）
// klt: 101=日K  102=周K
const EMF_BASE = 'https://push2his.eastmoney.com/api/qt/stock/kline/get';

/**
 * klines 格式（逗号分隔）：
 * [0]日期  [1]开  [2]收  [3]高  [4]低  [5]量  [6]额  ...
 */
async function fetchFromEastmoney(range: Range): Promise<IOHLCV[]> {
  const res = await axios.get(EMF_BASE, {
    params: {
      secid:   '113.AU0',
      fields1: 'f1,f2,f3,f4,f5,f6',
      fields2: 'f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61',
      klt:     RANGE_KLT[range],
      fqt:     0,
      beg:     getBeg(range),
      end:     '20991231',
      lmt:     1000000,
    },
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
      'Referer':    'https://finance.eastmoney.com/',
    },
    timeout: 10000,
    proxy: false,
  });

  const body   = res.data as Record<string, unknown>;
  const rc     = (body?.['rc'] as number | undefined);
  const klines = (body?.['data'] as Record<string, unknown>)?.['klines'] as string[] | undefined;

  if (!klines || klines.length === 0) {
    throw new Error(`Eastmoney: no klines (rc=${rc}, range=${range})`);
  }

  const tf   = RANGE_TF[range];
  const bars: IOHLCV[] = [];

  for (const line of klines) {
    const cols  = line.split(',');
    const date  = cols[0];
    const open  = parseFloat(cols[1]!);
    const close = parseFloat(cols[2]!);
    const high  = parseFloat(cols[3]!);
    const low   = parseFloat(cols[4]!);
    const vol   = parseFloat(cols[5]!) || 0;
    if (!date || isNaN(open) || isNaN(close) || isNaN(high) || isNaN(low)) continue;
    bars.push({ timestamp: dayjs(date).valueOf(), open, high, low, close, volume: vol, timeframe: tf });
  }

  if (bars.length === 0) throw new Error(`Eastmoney: parsed 0 valid bars (range=${range})`);

  logger.info(`[historical] eastmoney OK: ${bars.length} bars (range=${range})`);
  return bars;
}

// ── 腾讯财经备用 ────────────────────────────────────────────────
// param 格式：nf_AU0,day,startDate,endDate,count,nqfq
const TENCENT_BASE = 'https://web.ifzq.gtimg.cn/appstock/app/fqkline/get';
const TENCENT_TYPE:  Record<Range, string> = { '1mo': 'day', '3mo': 'day', '1y': 'day', '5y': 'week', 'max': 'week' };
const TENCENT_COUNT: Record<Range, number> = { '1mo': 35, '3mo': 100, '1y': 370, '5y': 300, 'max': 1000 };

async function fetchFromTencent(range: Range): Promise<IOHLCV[]> {
  const type  = TENCENT_TYPE[range];
  const count = TENCENT_COUNT[range];
  const param = `nf_AU0,${type},,,,${count},nqfq`;

  const res = await axios.get(TENCENT_BASE, {
    params: { _var: `kline_${type}fqnone`, param },
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
      'Referer':    'https://gu.qq.com/',
    },
    timeout: 10000,
    proxy: false,
    // 腾讯接口返回 JSONP，需提取 JSON 主体
    transformResponse: [(data: string) => {
      const m = String(data).match(/=\s*(\{.*\})\s*;?\s*$/s);
      return m ? JSON.parse(m[1]) : null;
    }],
  });

  const body  = res.data as Record<string, unknown> | null;
  const quote = (body?.['data'] as Record<string, unknown> | undefined)?.['nf_AU0'] as Record<string, unknown> | undefined;
  const klines = (quote?.[type] ?? quote?.['qfqday'] ?? quote?.['qfqweek']) as string[][] | undefined;

  if (!klines || klines.length === 0) {
    throw new Error(`Tencent: no klines (range=${range})`);
  }

  const tf   = RANGE_TF[range];
  const bars: IOHLCV[] = klines
    .filter(cols => cols.length >= 5 && cols[0])
    .map(cols => ({
      timestamp: dayjs(cols[0]).valueOf(),
      open:   parseFloat(cols[1]!),
      close:  parseFloat(cols[2]!),
      high:   parseFloat(cols[3]!),
      low:    parseFloat(cols[4]!),
      volume: parseFloat(cols[5] ?? '0') || 0,
      timeframe: tf,
    }))
    .filter(b => !isNaN(b.open) && !isNaN(b.close) && !isNaN(b.high) && !isNaN(b.low));

  if (bars.length === 0) throw new Error(`Tencent: parsed 0 valid bars (range=${range})`);

  logger.info(`[historical] tencent OK: ${bars.length} bars (range=${range})`);
  return bars;
}

// ── 新浪财经备用 ────────────────────────────────────────────────
// AU9999 SGE现货，单位 CNY/g
const SINA_BASE = 'https://money.finance.sina.com.cn/quotes_service/api/json_v2.php/CN_MarketData.getKLineData';
const SINA_SCALE:   Record<Range, number> = { '1mo': 1440, '3mo': 1440, '1y': 1440, '5y': 10080, 'max': 10080 };
const SINA_DATALEN: Record<Range, number> = { '1mo': 35, '3mo': 100, '1y': 370, '5y': 300, 'max': 1000 };

async function fetchFromSina(range: Range): Promise<IOHLCV[]> {
  const res = await axios.get(SINA_BASE, {
    params: {
      symbol:  'Au9999',
      scale:   SINA_SCALE[range],
      datalen: SINA_DATALEN[range],
      ma:      'no',
    },
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
      'Referer':    'https://finance.sina.com.cn/',
    },
    timeout: 10000,
    proxy: false,
  });

  const raw = res.data as Array<Record<string, string>>;
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new Error(`Sina: empty or non-array response (range=${range})`);
  }

  const tf   = RANGE_TF[range];
  const bars: IOHLCV[] = raw
    .filter(r => r['day'] && r['close'] && r['open'])
    .map(r => ({
      timestamp: dayjs(r['day']).valueOf(),
      open:   parseFloat(r['open']!),
      high:   parseFloat(r['high']!),
      low:    parseFloat(r['low']!),
      close:  parseFloat(r['close']!),
      volume: parseFloat(r['volume'] ?? '0') || 0,
      timeframe: tf,
    }))
    .filter(b => !isNaN(b.open) && !isNaN(b.close) && !isNaN(b.high) && !isNaN(b.low));

  if (bars.length === 0) throw new Error(`Sina: parsed 0 valid bars (range=${range})`);

  logger.info(`[historical] sina OK: ${bars.length} bars (range=${range})`);
  return bars;
}

// ── 公开接口 ────────────────────────────────────────────────────
/**
 * 按优先级尝试三个数据源（东方财富→腾讯财经→新浪财经）。
 * 命中缓存时立即返回（15分钟 TTL）。
 * 每个源超时 10s，失败即切换下一个，总最坏耗时 ≤ 30s。
 */
export async function fetchHistoricalGold(range: Range = '1y'): Promise<IOHLCV[]> {
  // 命中缓存直接返回
  const cached = fromCache(range);
  if (cached) return cached;

  const sources: Array<{ name: string; fn: () => Promise<IOHLCV[]> }> = [
    { name: 'yahoo',     fn: () => fetchFromYahoo(range) },    // 主源：USD/oz，国内可访问
    { name: 'eastmoney', fn: () => fetchFromEastmoney(range) },
    { name: 'tencent',   fn: () => fetchFromTencent(range) },
    { name: 'sina',      fn: () => fetchFromSina(range) },
  ];

  const errors: string[] = [];

  for (const { name, fn } of sources) {
    try {
      const data = await fn();
      toCache(range, data, name);
      return data;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.warn(`[historical] ${name} failed: ${msg}`);
      errors.push(`${name}: ${msg}`);
    }
  }

  throw new Error(`All historical sources failed — ${errors.join(' | ')}`);
}

/** 手动清除指定 range 的缓存（供 API 强制刷新用） */
export function clearHistoricalCache(range?: Range): void {
  if (range) {
    _cache.delete(range);
  } else {
    _cache.clear();
  }
}
