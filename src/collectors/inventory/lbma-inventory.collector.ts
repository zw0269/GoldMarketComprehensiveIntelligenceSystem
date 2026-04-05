/**
 * LBMA 伦敦黄金库存月报采集器 (T-115)
 * 来源: LBMA 官网（月更）
 */
import axios from 'axios';
import * as cheerio from 'cheerio';
import { withRetry } from '../../utils/retry';
import type { IInventoryData } from '../../types';
import dayjs from 'dayjs';

export async function fetchLBMAInventory(): Promise<IInventoryData | null> {
  return withRetry(
    async () => {
      const res = await axios.get('https://www.lbma.org.uk/prices-and-data/vaulting-statistics', {
        headers: { 'User-Agent': 'Mozilla/5.0' },
        timeout: 20000,
      });

      const $ = cheerio.load(res.data as string);
      // LBMA 页面通常有表格或数字展示总持仓量（million troy ounces）
      let total = 0;
      $('table td, .stat-value, [class*="vault"]').each((_, el) => {
        const text = $(el).text().trim();
        const num = parseFloat(text.replace(/[^0-9.]/g, ''));
        if (num > 100 && num < 100000) {
          // LBMA 库存通常在 300-1000 MOZ 区间
          total = num * 1e6; // million oz → oz
        }
      });

      if (!total) throw new Error('LBMA: failed to parse vault statistics');

      return {
        date: dayjs().format('YYYY-MM-DD'),
        exchange: 'LBMA',
        total,
        unit: 'oz',
      };
    },
    'LBMA-Inventory',
    { maxAttempts: 2, baseDelayMs: 5000 }
  );
}
