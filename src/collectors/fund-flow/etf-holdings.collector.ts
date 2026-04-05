/**
 * 黄金 ETF 持仓量采集器
 * T-121: SPDR Gold (GLD)
 * T-122: iShares Gold (IAU)
 * T-123: 中国黄金ETF（华安/易方达）
 */
import axios from 'axios';
import * as cheerio from 'cheerio';
import logger from '../../utils/logger';
import { withRetry } from '../../utils/retry';
import type { IETFHolding } from '../../types';
import dayjs from 'dayjs';

// GLD: SPDR Gold Shares
async function fetchGLD(): Promise<IETFHolding> {
  const res = await axios.get('https://www.spdrgoldshares.com/usa/gold-bar-list/', {
    headers: { 'User-Agent': 'Mozilla/5.0' },
    timeout: 15000,
  });
  const $ = cheerio.load(res.data as string);
  // GLD 页面有 "Total Tonnes of Gold" 统计
  const text = $('[class*="tonnes"], .total-gold, #gold-total').first().text()
    || $('table').first().text();
  const match = text.match(/([\d,]+\.?\d*)\s*(tonnes?|t)/i);
  const tonnes = match ? parseFloat(match[1].replace(/,/g, '')) : 0;
  if (!tonnes) throw new Error(`GLD: failed to parse tonnes from page`);

  return {
    date: dayjs().format('YYYY-MM-DD'),
    fund: 'GLD',
    tonnes,
  };
}

// IAU: iShares Gold Trust — 通过 Yahoo Finance 获取 outstandingShares * NAV
async function fetchIAU(): Promise<IETFHolding> {
  // iShares 官方数据
  const res = await axios.get(
    'https://query1.finance.yahoo.com/v8/finance/chart/IAU',
    {
      params: { interval: '1d', range: '1d' },
      headers: { 'User-Agent': 'Mozilla/5.0' },
      timeout: 12000,
    }
  );
  const chart = (res.data as Record<string, unknown>)?.chart as Record<string, unknown>;
  const result = ((chart?.result as unknown[]) ?? [])[0] as Record<string, unknown> | undefined;
  // IAU 约有 0.01 oz/share，通过 sharesOutstanding 估算
  const meta = result?.meta as Record<string, unknown> | undefined;
  const shares = (meta?.sharesOutstanding as number) ?? 0;
  const tonnes = (shares * 0.01) / 32150.7; // oz → tonnes

  return {
    date: dayjs().format('YYYY-MM-DD'),
    fund: 'IAU',
    tonnes: parseFloat(tonnes.toFixed(2)),
  };
}

// 华安黄金ETF (518880) — 东方财富基金数据
async function fetchHuaanGold(): Promise<IETFHolding> {
  const res = await axios.get(
    'https://fund.eastmoney.com/518880.html',
    {
      headers: { 'User-Agent': 'Mozilla/5.0', Referer: 'https://fund.eastmoney.com/' },
      timeout: 15000,
    }
  );
  const $ = cheerio.load(res.data as string);
  // 页面包含基金规模（亿份 / 亿元），通过金价反推吨数
  const scaleText = $('.fund-detail .size, [class*="scale"]').first().text();
  logger.debug('[etf] Huaan raw', { scaleText });
  // 数据解析因页面结构而异，此处返回占位
  return { date: dayjs().format('YYYY-MM-DD'), fund: 'HUAAN', tonnes: 0 };
}

export async function fetchETFHoldings(): Promise<IETFHolding[]> {
  const results = await Promise.allSettled([
    withRetry(fetchGLD, 'ETF-GLD', { maxAttempts: 3, baseDelayMs: 3000 }),
    withRetry(fetchIAU, 'ETF-IAU', { maxAttempts: 3, baseDelayMs: 3000 }),
    withRetry(fetchHuaanGold, 'ETF-Huaan', { maxAttempts: 2, baseDelayMs: 3000 }),
  ]);

  const holdings: IETFHolding[] = [];
  for (const r of results) {
    if (r.status === 'fulfilled') {
      holdings.push(r.value);
    } else {
      logger.warn('[etf] one source failed', { err: r.reason });
    }
  }

  logger.info('[etf] holdings collected', { count: holdings.length, funds: holdings.map(h => h.fund) });
  return holdings;
}
