/**
 * 上期所 (SHFE) 黄金库存采集器 (T-114)
 * 来源: 上期所官网 / MacroMicro
 */
import axios from 'axios';
import * as cheerio from 'cheerio';
import logger from '../../utils/logger';
import { withRetry } from '../../utils/retry';
import type { IInventoryData } from '../../types';
import dayjs from 'dayjs';

// 上期所库存数据（周更）
const SHFE_URL = 'https://www.shfe.com.cn/data/dailydata/kx/kx20240101.dat';

async function fetchFromSHFE(): Promise<IInventoryData> {
  // 上期所周仓单数据API（日期动态构建）
  const dateStr = dayjs().day(5).format('YYYYMMDD'); // 取最近周五
  const url = `https://www.shfe.com.cn/data/dailydata/kx/kx${dateStr}.dat`;

  const res = await axios.get(url, {
    headers: {
      Referer: 'https://www.shfe.com.cn/',
      'User-Agent': 'Mozilla/5.0',
    },
    timeout: 15000,
  });

  const data = res.data as { o_cursor?: Array<Record<string, unknown>> };
  const items = data?.o_cursor ?? [];
  const goldItem = items.find(
    (item) =>
      String(item['VARNAME'] ?? '').includes('黄金') ||
      String(item['PRODUCTID'] ?? '').toUpperCase().includes('AU')
  );

  if (!goldItem) throw new Error('SHFE: no gold inventory item found');

  const total = parseFloat(String(goldItem['WRTWGHTS'] ?? goldItem['WSTOCK'] ?? '0'));

  return {
    date: dayjs().format('YYYY-MM-DD'),
    exchange: 'SHFE',
    total,
    unit: 'kg',
  };
}

export async function fetchSHFEInventory(): Promise<IInventoryData | null> {
  return withRetry(fetchFromSHFE, 'SHFE-Inventory', {
    maxAttempts: 3,
    baseDelayMs: 3000,
  });
}
