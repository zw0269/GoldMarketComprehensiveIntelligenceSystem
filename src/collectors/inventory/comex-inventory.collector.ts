/**
 * COMEX 黄金仓库库存采集器
 * T-111: CME Gold_Stocks.xls 下载+解析
 * T-112: Registered / Eligible 分类
 * T-113: metalcharts.org 备用源
 */
import axios from 'axios';
import * as XLSX from 'xlsx';
import * as cheerio from 'cheerio';
import logger from '../../utils/logger';
import { withRetry } from '../../utils/retry';
import type { IInventoryData } from '../../types';
import dayjs from 'dayjs';

const CME_GOLD_STOCKS_URL =
  'https://www.cmegroup.com/CmeWS/mvc/Settlements/futures/settlements/GC/INVENTORY?reportType=HTML';

async function fetchFromCME(): Promise<IInventoryData> {
  const res = await axios.get(CME_GOLD_STOCKS_URL, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
      Accept: 'text/html',
    },
    timeout: 15000,
  });

  const $ = cheerio.load(res.data as string);
  // CME HTML 表格解析
  const rows: string[][] = [];
  $('table tr').each((_, tr) => {
    const cols: string[] = [];
    $(tr).find('td, th').each((_, td) => cols.push($(td).text().trim()));
    if (cols.length > 0) rows.push(cols);
  });

  // 找到 Total / Registered / Eligible 行
  let registered = 0;
  let eligible = 0;
  let total = 0;
  for (const row of rows) {
    const label = row[0]?.toLowerCase() ?? '';
    const val = parseFloat((row[row.length - 1] ?? '0').replace(/,/g, ''));
    if (label.includes('registered')) registered = val;
    else if (label.includes('eligible')) eligible = val;
    else if (label.includes('total')) total = val;
  }
  if (!total && registered && eligible) total = registered + eligible;

  return {
    date: dayjs().format('YYYY-MM-DD'),
    exchange: 'COMEX',
    registered,
    eligible,
    total,
    unit: 'oz',
  };
}

async function fetchFromMetalcharts(): Promise<IInventoryData> {
  const res = await axios.get('https://www.metalcharts.com/gold-inventory', {
    headers: { 'User-Agent': 'Mozilla/5.0' },
    timeout: 15000,
  });
  const $ = cheerio.load(res.data as string);
  const parseNum = (sel: string) =>
    parseFloat($(sel).first().text().trim().replace(/[^0-9.]/g, '')) || 0;

  const registered = parseNum('[data-label="Registered"]');
  const eligible = parseNum('[data-label="Eligible"]');

  return {
    date: dayjs().format('YYYY-MM-DD'),
    exchange: 'COMEX',
    registered,
    eligible,
    total: registered + eligible,
    unit: 'oz',
  };
}

export async function fetchCOMEXInventory(): Promise<IInventoryData | null> {
  return withRetry(
    async () => {
      try {
        return await fetchFromCME();
      } catch (err) {
        logger.warn('[comex-inventory] CME source failed, trying metalcharts', { err });
        return fetchFromMetalcharts();
      }
    },
    'COMEX-Inventory',
    { maxAttempts: 3, baseDelayMs: 5000 }
  );
}
