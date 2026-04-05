/**
 * 黄金历史 OHLCV 数据采集器
 *
 * 主源：东方财富 K线接口 — 上期所沪金主力(AU0)，价格单位 CNY/g
 * 备源：新浪财经 SGE Au9999，同样为 CNY/g
 *
 * 替换原因：Yahoo Finance 在中国大陆被墙，无法稳定访问
 */
import axios from 'axios';
import dayjs from 'dayjs';
import logger from '../../utils/logger';
import { withRetry } from '../../utils/retry';
import type { IOHLCV } from '../../types';

export type Range = '1mo' | '3mo' | '1y' | '5y' | 'max';

// ── 东方财富 K线接口 ──────────────────────────────────────────
// secid=113.AU0  上期所沪金主力（CNY/g）
// klt: 101=日K  102=周K  103=月K
const EMF_BASE = 'https://push2his.eastmoney.com/api/qt/stock/kline/get';
const SECID_SHFE = '113.AU0';

const RANGE_KLT: Record<Range, number> = {
  '1mo': 101,
  '3mo': 101,
  '1y':  101,
  '5y':  102,
  'max': 102,
};

const RANGE_TF: Record<Range, IOHLCV['timeframe']> = {
  '1mo': '1d',
  '3mo': '1d',
  '1y':  '1d',
  '5y':  '1w',
  'max': '1w',
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

/**
 * 东方财富接口解析
 * klines 格式（逗号分隔）：
 *   [0]日期  [1]开  [2]收  [3]高  [4]低  [5]量  [6]额  [7]振幅  [8]涨幅  [9]涨额  [10]换手
 */
async function fetchFromEastmoney(range: Range): Promise<IOHLCV[]> {
  const res = await axios.get(EMF_BASE, {
    params: {
      secid:   SECID_SHFE,
      fields1: 'f1,f2,f3,f4,f5,f6',
      fields2: 'f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61',
      klt:     RANGE_KLT[range],
      fqt:     0,               // 不复权
      beg:     getBeg(range),
      end:     '20991231',
      lmt:     1000000,
    },
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
      'Referer':    'https://finance.eastmoney.com/',
    },
    timeout: 15000,
    proxy: false,               // 跳过系统代理（避免本地代理 127.0.0.1:7897 干扰）
  });

  const klines: string[] | undefined =
    (res.data as Record<string, unknown>)?.data?.klines as string[] | undefined;

  if (!klines || klines.length === 0) {
    throw new Error(`Eastmoney: no klines for range=${range}`);
  }

  const tf = RANGE_TF[range];
  const bars: IOHLCV[] = [];

  for (const line of klines) {
    const cols = line.split(',');
    const date   = cols[0];          // "2024-01-02"
    const open   = parseFloat(cols[1]);
    const close  = parseFloat(cols[2]);
    const high   = parseFloat(cols[3]);
    const low    = parseFloat(cols[4]);
    const volume = parseFloat(cols[5]) || 0;

    if (!date || isNaN(open) || isNaN(close)) continue;

    bars.push({
      timestamp: dayjs(date).valueOf(),
      open,
      high,
      low,
      close,
      volume,
      timeframe: tf,
    });
  }

  logger.info(`[historical] eastmoney: ${bars.length} bars (range=${range}, unit=CNY/g)`);
  return bars;
}

// ── 新浪财经备用 ──────────────────────────────────────────────
// AU9999 SGE现货，单位 CNY/g
const SINA_BASE = 'https://money.finance.sina.com.cn/quotes_service/api/json_v2.php/CN_MarketData.getKLineData';

const SINA_SCALE: Record<Range, number> = {
  '1mo': 1440,   // 日线
  '3mo': 1440,
  '1y':  1440,
  '5y':  10080,  // 周线（分钟数=7*24*60）
  'max': 10080,
};

const SINA_DATALEN: Record<Range, number> = {
  '1mo':  35,
  '3mo':  100,
  '1y':   370,
  '5y':   300,
  'max':  1000,
};

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
    timeout: 15000,
    proxy: false,               // 跳过系统代理（避免本地代理 127.0.0.1:7897 干扰）
  });

  const raw = res.data as Array<Record<string, string>>;
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new Error(`Sina: no data for range=${range}`);
  }

  const tf = RANGE_TF[range];
  const bars: IOHLCV[] = raw
    .filter(r => r['day'] && r['close'])
    .map(r => ({
      timestamp: dayjs(r['day']).valueOf(),
      open:   parseFloat(r['open']),
      high:   parseFloat(r['high']),
      low:    parseFloat(r['low']),
      close:  parseFloat(r['close']),
      volume: parseFloat(r['volume'] ?? '0') || 0,
      timeframe: tf,
    }));

  logger.info(`[historical] sina: ${bars.length} bars (range=${range}, unit=CNY/g)`);
  return bars;
}

// ── 公开接口 ─────────────────────────────────────────────────
export async function fetchHistoricalGold(range: Range = '1y'): Promise<IOHLCV[]> {
  return withRetry(
    async () => {
      // 优先东方财富
      try {
        return await fetchFromEastmoney(range);
      } catch (e1) {
        logger.warn('[historical] eastmoney failed, trying sina', { err: (e1 as Error).message });
      }

      // 备用：新浪财经
      return await fetchFromSina(range);
    },
    `HistoricalGold-${range}`,
    { maxAttempts: 2, baseDelayMs: 2000 }
  );
}
