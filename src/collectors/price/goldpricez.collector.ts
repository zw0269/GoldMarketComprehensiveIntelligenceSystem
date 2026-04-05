/**
 * goldpricez.com 免费价格采集器（爬虫方式）
 * 无需 API Key，每小时约 30-60 次
 */
import axios from 'axios';
import * as cheerio from 'cheerio';
import logger from '../../utils/logger';
import { withRetry } from '../../utils/retry';
import type { IPriceData } from '../../types';

export async function fetchGoldpricezData(): Promise<IPriceData | null> {
  return withRetry(
    async () => {
      const res = await axios.get('https://goldpricez.com/us/gram', {
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        },
        timeout: 15000,
      });

      const $ = cheerio.load(res.data as string);

      // 解析页面中的金价数据（USD/oz）
      const priceText = $('.price-value').first().text().trim()
        || $('[class*="price"]').first().text().trim();

      const price = parseFloat(priceText.replace(/[^0-9.]/g, ''));
      if (!price || isNaN(price)) {
        throw new Error(`goldpricez: failed to parse price from "${priceText}"`);
      }

      logger.debug('[goldpricez] parsed price', { price });

      return {
        source: 'goldpricez',
        timestamp: Date.now(),
        xauUsd: price * 31.1035, // 转换：USD/g → USD/oz
      } satisfies IPriceData;
    },
    'goldpricez',
    { maxAttempts: 2, baseDelayMs: 3000 }
  );
}
