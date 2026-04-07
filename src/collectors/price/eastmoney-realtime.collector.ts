/**
 * 免费实时金价采集器（无需任何 API Key）
 *
 * 主源：Yahoo Finance  GC=F（COMEX 黄金期货，USD/oz）
 * 备源：新浪财经 nf_AU0（SHFE 沪金主力，CNY/g → 换算 USD/oz）
 *
 * 经实测：
 *   - Yahoo Finance query1.finance.yahoo.com  ✅ 可访问，返回 ~$4655/oz
 *   - Sina hq.sinajs.cn/list=nf_AU0           ✅ 可访问，返回 ~1030 CNY/g
 *   - EastMoney push2.eastmoney.com           ❌ 国内环境被封
 *
 * 字段说明（Sina nf_AU0 逗号分隔）：
 *   [0] 合约名（GBK 编码，忽略）
 *   [1] 时间 HHMMSS
 *   [2] 昨结算
 *   [3] 今日最高
 *   [4] 今日最低
 *   [6] 买一价
 *   [7] 卖一价
 *   [8] 最新价 ← 使用此字段
 *   [10] 今结算
 */
import axios from 'axios';
import logger from '../../utils/logger';
import type { IPriceData } from '../../types';

const OZ_TO_GRAM = 31.1035;
const YAHOO_CHART = 'https://query1.finance.yahoo.com/v8/finance/chart';

// ── 主源：Yahoo Finance GC=F ───────────────────────────────────
async function fetchYahooGold(): Promise<number> {
  const res = await axios.get(`${YAHOO_CHART}/GC%3DF`, {
    params: { interval: '1d', range: '1d' },
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
    timeout: 10000,
  });

  const chart  = (res.data as Record<string, unknown>)?.['chart'] as Record<string, unknown>;
  const result = ((chart?.['result'] as unknown[]) ?? [])[0] as Record<string, unknown> | undefined;
  if (!result) throw new Error('Yahoo GC=F: no result');

  const meta  = result['meta'] as Record<string, unknown>;
  const price = meta?.['regularMarketPrice'] as number | undefined;
  if (!price || price <= 0) throw new Error(`Yahoo GC=F: invalid price ${price}`);

  logger.debug(`[freeRT] Yahoo GC=F = $${price}/oz`);
  return price; // USD/oz
}

// ── 备源：新浪财经 nf_AU0 ──────────────────────────────────────
// 汇率同时从新浪 fx_susdcny 取（两个请求并发）
async function fetchSinaGold(): Promise<number> {
  // 并发拿金价 + 汇率
  const [goldRes, fxRes] = await Promise.all([
    axios.get('https://hq.sinajs.cn/list=nf_AU0', {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
        'Referer':    'https://finance.sina.com.cn/',
      },
      timeout: 8000,
      responseType: 'arraybuffer',
      proxy: false,
    }),
    axios.get('https://hq.sinajs.cn/list=fx_susdcny', {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
        'Referer':    'https://finance.sina.com.cn/',
      },
      timeout: 8000,
      responseType: 'arraybuffer',
      proxy: false,
    }),
  ]);

  // 解析金价（latin1 解码即可，中文字段会乱码但数字字段正常）
  const goldText  = Buffer.from(goldRes.data as ArrayBuffer).toString('latin1');
  const goldMatch = goldText.match(/"([^"]+)"/);
  if (!goldMatch) throw new Error('Sina nf_AU0: parse failed');

  const goldParts = goldMatch[1].split(',');
  const priceCnyG = parseFloat(goldParts[8] ?? '');   // [8] = 最新价
  if (!priceCnyG || isNaN(priceCnyG) || priceCnyG <= 0) {
    throw new Error(`Sina nf_AU0: invalid price at [8]="${goldParts[8]}"`);
  }

  // 解析汇率
  const fxText  = Buffer.from(fxRes.data as ArrayBuffer).toString('latin1');
  const fxMatch = fxText.match(/"([^"]+)"/);
  const usdCny  = fxMatch ? parseFloat(fxMatch[1].split(',')[1] ?? '') : 7.25;
  const validRate = (usdCny && !isNaN(usdCny) && usdCny > 5 && usdCny < 10) ? usdCny : 7.25;

  const xauUsd = (priceCnyG * OZ_TO_GRAM) / validRate;
  logger.debug(`[freeRT] Sina SHFE AU0 = ${priceCnyG} CNY/g, rate=${validRate}, equiv $${xauUsd.toFixed(0)}/oz`);
  return xauUsd; // USD/oz
}

/**
 * 获取实时黄金价格（USD/oz）
 * 主源 Yahoo Finance，备源新浪 SHFE，均无需 API Key
 */
export async function fetchEastmoneyRealtimePrice(): Promise<IPriceData | null> {
  let xauUsd: number;
  let source = 'yahoo_gc';

  try {
    xauUsd = await fetchYahooGold();
  } catch (err) {
    logger.warn('[freeRT] Yahoo GC=F failed, trying Sina SHFE', { err });
    try {
      xauUsd = await fetchSinaGold();
      source = 'sina_shfe';
    } catch (err2) {
      logger.warn('[freeRT] Sina SHFE also failed', { err: err2 });
      return null;
    }
  }

  return {
    source,
    timestamp: Date.now(),
    xauUsd,
  };
}
