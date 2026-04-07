/**
 * 实时金价采集器（无需任何 API Key）
 *
 * 主源：Stooq XAUUSD（国际金价，USD/oz，云服务器可访问）
 * 备源：goldprice.org 公开接口
 *
 * 注意：Yahoo Finance 和新浪财经均已对中国大陆云服务器封锁，已移除。
 */
import axios from 'axios';
import logger from '../../utils/logger';
import type { IPriceData } from '../../types';

const OZ_TO_GRAM = 31.1035;

interface StooqSymbol {
  symbol: string;
  date: string;
  close: number | string;
}
interface StooqResponse {
  symbols?: StooqSymbol[];
}

// ── 主源：Stooq GC=F（COMEX 黄金期货连续合约）────────────────
async function fetchStooqGold(): Promise<number> {
  const res = await axios.get<StooqResponse>(
    'https://stooq.com/q/l/?s=gc.f&f=sd2t2ohlcv&e=json',
    { timeout: 10000 }
  );

  const sym = res.data?.symbols?.[0];
  if (!sym) throw new Error('Stooq XAUUSD: no symbol in response');

  const close = typeof sym.close === 'string' ? parseFloat(sym.close) : sym.close;
  if (!close || isNaN(close) || close <= 0) {
    throw new Error(`Stooq XAUUSD: invalid close="${sym.close}"`);
  }

  logger.debug(`[freeRT] Stooq XAUUSD = $${close}/oz`);
  return close; // USD/oz
}

// ── 备源：Coinbase 现货金价（无需Key，云服务器可访问）────────
async function fetchCoinbaseGold(): Promise<number> {
  const res = await axios.get(
    'https://api.coinbase.com/v2/prices/XAU-USD/spot',
    { timeout: 8000 }
  );
  const data = res.data as { data?: { amount?: string } };
  const amount = data?.data?.amount;
  if (!amount) throw new Error('Coinbase XAU-USD: no amount');
  const price = parseFloat(amount);
  if (!price || isNaN(price) || price <= 0) throw new Error(`Coinbase XAU-USD: invalid amount="${amount}"`);
  logger.debug(`[freeRT] Coinbase XAU-USD = $${price}/oz`);
  return price; // USD/oz
}

/**
 * 获取实时黄金价格（USD/oz）
 */
export async function fetchEastmoneyRealtimePrice(): Promise<IPriceData | null> {
  let xauUsd: number;
  let source = 'stooq';

  try {
    xauUsd = await fetchStooqGold();
  } catch (err) {
    logger.warn('[freeRT] Stooq failed, trying Coinbase', { err });
    try {
      xauUsd = await fetchCoinbaseGold();
      source = 'coinbase';
    } catch (err2) {
      logger.warn('[freeRT] Coinbase also failed', { err: err2 });
      return null;
    }
  }

  return {
    source,
    timestamp: Date.now(),
    xauUsd,
  };
}
