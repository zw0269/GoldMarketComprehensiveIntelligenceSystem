/**
 * NewsAPI 通用新闻采集器 (T-145)
 * 文档: https://newsapi.org/docs
 * 免费开发层: 100请求/天
 */
import axios from 'axios';
import config from '../../config';
import logger from '../../utils/logger';
import { withRetry } from '../../utils/retry';
import type { INewsItem } from '../../types';
import dayjs from 'dayjs';

const NEWSAPI_BASE = 'https://newsapi.org/v2/everything';

// Trump 关键词过滤 (T-142)
const TRUMP_KEYWORDS = ['trump', 'tariff', 'trade war', 'dollar', 'federal reserve', 'fed rate'];

function classifyCategory(title: string, desc: string): INewsItem['category'] {
  const text = (title + ' ' + desc).toLowerCase();
  if (TRUMP_KEYWORDS.some(k => text.includes(k))) return 'trump';
  if (text.includes('fed') || text.includes('powell') || text.includes('fomc')) return 'fed';
  if (text.includes('war') || text.includes('conflict') || text.includes('sanction')) return 'geopolitical';
  if (text.includes('cpi') || text.includes('inflation') || text.includes('gdp')) return 'economic';
  if (text.includes('gold') || text.includes('xau') || text.includes('bullion')) return 'gold';
  return 'general';
}

export async function fetchNewsAPI(query = 'gold OR XAU OR bullion', pageSize = 30): Promise<INewsItem[]> {
  if (!config.api.newsApiKey) {
    logger.warn('[newsapi] API key not configured, skipping');
    return [];
  }

  return withRetry(
    async () => {
      const res = await axios.get(NEWSAPI_BASE, {
        params: {
          q: query,
          apiKey: config.api.newsApiKey,
          language: 'en',
          sortBy: 'publishedAt',
          pageSize,
          from: dayjs().subtract(1, 'day').toISOString(),
        },
        timeout: 12000,
      });

      const data = res.data as { articles?: Array<{
        source?: { name?: string };
        title?: string;
        description?: string;
        url?: string;
        publishedAt?: string;
      }> };

      return (data.articles ?? []).map(article => ({
        source: `newsapi:${article.source?.name ?? 'unknown'}`,
        timestamp: article.publishedAt ? dayjs(article.publishedAt).valueOf() : Date.now(),
        title: article.title ?? '',
        summary: article.description ?? undefined,
        url: article.url ?? undefined,
        category: classifyCategory(article.title ?? '', article.description ?? ''),
      } satisfies INewsItem));
    },
    'NewsAPI',
    { maxAttempts: 3, baseDelayMs: 3000 }
  );
}

/** Trump 发言专项追踪 (T-142) */
export async function fetchTrumpNews(): Promise<INewsItem[]> {
  const query = 'Trump AND (tariff OR gold OR dollar OR "Federal Reserve" OR China)';
  const news = await fetchNewsAPI(query, 20);
  return news.map(n => ({ ...n, category: 'trump' as const }));
}
