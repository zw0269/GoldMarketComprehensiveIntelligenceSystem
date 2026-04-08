/**
 * RSS 新闻聚合引擎 (T-141)
 * 来源: CNBC / Yahoo Finance / Google News
 * Kitco (404) 和 Reuters (ECONNRESET) 已替换
 */
import axios from 'axios';
import * as cheerio from 'cheerio';
import logger from '../../utils/logger';
import { withRetry } from '../../utils/retry';
import type { INewsItem } from '../../types';
import dayjs from 'dayjs';

const RSS_SOURCES = [
  {
    name: 'cnbc-gold',
    url: 'https://www.cnbc.com/id/10000664/device/rss/rss.html',
    category: 'gold' as const,
  },
  {
    name: 'yahoo-finance',
    url: 'https://finance.yahoo.com/news/rssindex',
    category: 'economic' as const,
  },
  {
    name: 'google-news-gold',
    url: 'https://news.google.com/rss/search?q=gold+price+XAU&hl=en-US&gl=US&ceid=US:en',
    category: 'gold' as const,
  },
  {
    name: 'google-news-geopolitics',
    url: 'https://news.google.com/rss/search?q=geopolitical+conflict+gold&hl=en-US&gl=US&ceid=US:en',
    category: 'geopolitical' as const,
  },
];

function parseRSSItem($item: ReturnType<ReturnType<typeof cheerio.load>>, source: string, category: INewsItem['category']): INewsItem | null {
  const title = $item.find('title').first().text().trim();
  const link = $item.find('link').first().text().trim()
    || $item.find('link').attr('href') || '';
  const pubDate = $item.find('pubDate, published, updated').first().text().trim();
  const description = $item.find('description, summary').first().text().trim()
    .replace(/<[^>]+>/g, '').slice(0, 500);

  if (!title) return null;

  const ts = pubDate ? dayjs(pubDate).valueOf() : Date.now();

  return {
    source,
    timestamp: ts,
    title,
    summary: description || undefined,
    url: link || undefined,
    category,
  };
}

async function fetchRSSFeed(
  source: { name: string; url: string; category: INewsItem['category'] },
  limit = 20
): Promise<INewsItem[]> {
  return withRetry(
    async () => {
      const res = await axios.get(source.url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 GoldSentinel/0.1 RSS Reader',
          Accept: 'application/rss+xml, application/xml, text/xml',
        },
        timeout: 12000,
        responseType: 'text',
      });

      const $ = cheerio.load(res.data as string, { xmlMode: true });
      const items: INewsItem[] = [];

      $('item, entry').each((i, el) => {
        if (i >= limit) return false;
        const item = parseRSSItem($(el) as ReturnType<ReturnType<typeof cheerio.load>>, source.name, source.category);
        if (item) items.push(item);
      });

      logger.debug(`[rss] ${source.name}: fetched ${items.length} items`);
      return items;
    },
    `RSS-${source.name}`,
    { maxAttempts: 2, baseDelayMs: 3000 }
  );
}

export async function fetchRSSNews(limit = 20): Promise<INewsItem[]> {
  const results = await Promise.allSettled(
    RSS_SOURCES.map(src => fetchRSSFeed(src, limit))
  );

  const allNews: INewsItem[] = [];
  for (const r of results) {
    if (r.status === 'fulfilled') {
      allNews.push(...r.value);
    } else {
      logger.warn('[rss] feed failed', { err: r.reason });
    }
  }

  // 按时间倒序排列
  allNews.sort((a, b) => b.timestamp - a.timestamp);
  logger.info('[rss] total news fetched', { count: allNews.length });
  return allNews;
}
