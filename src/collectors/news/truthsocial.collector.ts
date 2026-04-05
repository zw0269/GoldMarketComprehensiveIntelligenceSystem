/**
 * Truth Social 帖子采集器
 *
 * Truth Social 基于 Mastodon（ActivityPub 协议），提供兼容 Mastodon 的公开 REST API。
 * 无需登录即可读取公开账号的帖子。
 *
 * 可选：在 .env 中配置 TRUTH_SOCIAL_BEARER_TOKEN 以提升稳定性（部分接口限流时使用）。
 *
 * 与黄金相关的 Trump 发言关键词：
 *   tariff, trade, China, dollar, Federal Reserve, interest rate, sanction,
 *   gold, oil, energy, inflation, economy, GDP, war, BRICS, SWIFT 等
 */
import axios from 'axios';
import * as cheerio from 'cheerio';
import config from '../../config';
import logger from '../../utils/logger';
import { withRetry } from '../../utils/retry';
import type { INewsItem } from '../../types';
import dayjs from 'dayjs';

const BASE_URL = 'https://truthsocial.com';

// Trump 在 Truth Social 的用户名
const TRUMP_HANDLE = 'realDonaldTrump';

// 缓存 Trump 的账号 ID（避免每次都调 lookup）
let cachedTrumpId: string | null = null;

// 与黄金/宏观市场相关的关键词（匹配则标记为 HIGH 优先级，无关则仍保留但 impact 降低）
const GOLD_RELATED_KEYWORDS = [
  'tariff', 'tariffs', 'trade', 'china', 'dollar', 'fed', 'federal reserve',
  'interest rate', 'rate cut', 'rate hike', 'inflation', 'economy', 'gdp',
  'sanction', 'sanctions', 'war', 'conflict', 'oil', 'energy', 'gold',
  'brics', 'currency', 'debt', 'deficit', 'treasury', 'bond', 'market',
  'stock', 'crypto', 'bitcoin', 'tax', 'budget', 'iran', 'russia', 'ukraine',
  'middle east', 'opec', 'powell', 'fomc', 'swift', 'payment', 'trade war',
  'import', 'export', 'deal', 'agreement', 'mexico', 'europe', 'nato',
];

/** 将 Mastodon HTML 帖子内容转为纯文本 */
function htmlToText(html: string): string {
  if (!html) return '';
  const $ = cheerio.load(html);
  // 段落换行转空格
  $('br').replaceWith(' ');
  $('p').after(' ');
  return $.text().replace(/\s+/g, ' ').trim().slice(0, 1000);
}

/** 判断帖子是否与黄金/宏观市场相关 */
function isGoldRelevant(text: string): boolean {
  const lower = text.toLowerCase();
  return GOLD_RELATED_KEYWORDS.some(kw => lower.includes(kw));
}

/** 构建请求头 */
function buildHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) GoldSentinel/1.0',
    'Accept': 'application/json',
  };
  if (config.api.truthSocialToken) {
    headers['Authorization'] = `Bearer ${config.api.truthSocialToken}`;
  }
  return headers;
}

/** 通过用户名查找账号 ID */
async function lookupAccountId(handle: string): Promise<string> {
  const res = await axios.get(`${BASE_URL}/api/v1/accounts/lookup`, {
    params: { acct: handle },
    headers: buildHeaders(),
    timeout: 15000,
  });
  const data = res.data as { id?: string };
  if (!data.id) throw new Error(`Truth Social: account lookup failed for @${handle}`);
  return data.id;
}

/** 获取指定账号的最新帖子 */
async function fetchAccountStatuses(accountId: string, limit = 30): Promise<TruthPost[]> {
  const res = await axios.get(`${BASE_URL}/api/v1/accounts/${accountId}/statuses`, {
    params: {
      limit,
      exclude_replies: true,  // 排除回复，只看原创帖
      exclude_reblogs: true,  // 排除转发
    },
    headers: buildHeaders(),
    timeout: 15000,
  });
  return (res.data as TruthPost[]) ?? [];
}

interface TruthPost {
  id: string;
  created_at: string;
  content: string;         // HTML
  url?: string;
  reblog?: unknown;        // 转发内容（已过滤）
  in_reply_to_id?: string; // 回复（已过滤）
  card?: { title?: string; description?: string };
}

/** 将 Truth Social 帖子转为 INewsItem */
function postToNewsItem(post: TruthPost): INewsItem {
  const text = htmlToText(post.content);
  const relevant = isGoldRelevant(text);

  return {
    source: 'truthsocial:realDonaldTrump',
    timestamp: dayjs(post.created_at).valueOf(),
    title: text.slice(0, 200) || '(无文字内容)',
    summary: text.length > 200 ? text.slice(200, 600) : undefined,
    url: post.url ?? undefined,
    category: 'trump',
    // 相关帖子预标记影响力（AI评估时会覆盖）
    aiImpact: relevant ? 3 : 1,
    aiDirection: 'neutral',
  };
}

/**
 * 采集 Trump Truth Social 最新帖子
 * @param limit 最多获取的帖子数，默认 30
 * @param goldOnly 若为 true，仅返回与黄金/宏观相关的帖子
 */
export async function fetchTruthSocialPosts(
  limit = 30,
  goldOnly = false
): Promise<INewsItem[]> {
  return withRetry(
    async () => {
      // 获取并缓存账号 ID
      if (!cachedTrumpId) {
        cachedTrumpId = await lookupAccountId(TRUMP_HANDLE);
        logger.info('[truthsocial] resolved account ID', { id: cachedTrumpId });
      }

      const posts = await fetchAccountStatuses(cachedTrumpId, limit);

      const items = posts
        .filter(p => !!p.content && !p.reblog)  // 过滤空内容和纯转发
        .map(postToNewsItem);

      const filtered = goldOnly ? items.filter(i => (i.aiImpact ?? 0) >= 3) : items;

      logger.info('[truthsocial] fetched posts', {
        total: posts.length,
        converted: items.length,
        goldRelated: filtered.length,
      });

      return filtered;
    },
    'TruthSocial',
    {
      maxAttempts: 3,
      baseDelayMs: 5000,
      retryOn: (err) => {
        if (err instanceof Error) {
          // 账号 ID 缓存可能失效，下次重新 lookup
          if (err.message.includes('404') || err.message.includes('410')) {
            cachedTrumpId = null;
          }
          // 不对封禁/认证错误重试
          return !err.message.includes('401') && !err.message.includes('403');
        }
        return true;
      },
    }
  );
}
