/**
 * 新闻影响评估 (T-302 / T-305 / T-306)
 * 批量评估新闻对金价的影响方向和强度
 */
import { callClaude } from './claude-client';
import { getPendingAINews, updateNewsAI } from '../../storage/dao';
import logger from '../../utils/logger';
import type { IAINewsAssessment } from '../../types';

// T-306: 关键词预过滤 — 低相关性新闻跳过AI评估
const GOLD_RELEVANT_KEYWORDS = [
  'gold', 'xau', 'bullion', 'precious metal', 'silver', 'comex',
  'federal reserve', 'fed', 'powell', 'rate', 'inflation', 'cpi',
  'dollar', 'usd', 'tariff', 'trump', 'china', 'war', 'conflict',
  'etf', 'gld', 'iau', 'central bank', 'treasury', 'yield',
  '黄金', '美联储', '利率', '通胀', '美元', '贸易战',
];

function isGoldRelevant(title: string, summary?: string): boolean {
  const text = (title + ' ' + (summary ?? '')).toLowerCase();
  return GOLD_RELEVANT_KEYWORDS.some(kw => text.includes(kw));
}

const SYSTEM_PROMPT = `You are a professional gold market analyst with 20 years of experience trading precious metals.
Your task is to assess how a news item impacts gold prices (XAU/USD).

IMPORTANT MARKET CONTEXT (2026): Gold prices have risen significantly since 2024. The current XAU/USD price of $4500-$5200/oz is the actual real-world market price as of early 2026, driven by Fed rate uncertainty, geopolitical tensions, and central bank buying. This is NOT an error — do not flag the price as unusually high.

Respond ONLY with valid JSON in this exact format:
{
  "direction": "bullish" | "bearish" | "neutral",
  "impact": 1-5,
  "reasoning": "brief explanation in 1-2 sentences",
  "timeframe": "intraday" | "short-term" | "medium-term" | "long-term"
}
Impact scale: 1=minimal, 2=minor, 3=moderate, 4=significant, 5=major market-moving.`;

async function assessSingleNews(
  title: string,
  summary: string,
  currentPrice: number,
  marketContext: string
): Promise<IAINewsAssessment> {
  const userMessage = `
News: ${title}
${summary ? `Summary: ${summary}` : ''}

Current XAU/USD: $${currentPrice.toFixed(2)}
Market Context: ${marketContext}

Assess the impact of this news on gold prices.`.trim();

  const response = await callClaude(SYSTEM_PROMPT, userMessage, 256, 'news_assessment');

  const jsonMatch = response.match(/\{[\s\S]+\}/);
  if (!jsonMatch) throw new Error('No JSON in response');

  const parsed = JSON.parse(jsonMatch[0]) as IAINewsAssessment;

  if (!['bullish', 'bearish', 'neutral'].includes(parsed.direction)) {
    throw new Error(`Invalid direction: ${parsed.direction}`);
  }
  if (parsed.impact < 1 || parsed.impact > 5) {
    throw new Error(`Invalid impact: ${parsed.impact}`);
  }

  return parsed;
}

// 标准化标题用于去重（去除标点、空白、大小写）
function normalizeTitle(title: string): string {
  return title.toLowerCase().replace(/[^\w\u4e00-\u9fa5]/g, '').slice(0, 60);
}

/**
 * 批量评估待处理新闻 (T-306: 合并调用策略)
 */
export async function assessPendingNews(
  currentPrice: number,
  marketContext = ''
): Promise<number> {
  const pending = getPendingAINews(20);
  logger.info(`[news-assessor] ${pending.length} pending news items`);

  let assessed = 0;
  // 本批次标题去重：同一内容从不同 RSS 源进来时只评估一次
  const seenTitles = new Set<string>();

  for (const row of pending) {
    const title = row['title'] as string;
    const summary = (row['summary'] as string) ?? '';

    // 标题去重：同批次内相似标题跳过（标记 neutral/1，不浪费 token）
    const normalized = normalizeTitle(title);
    if (seenTitles.has(normalized)) {
      logger.debug(`[news-assessor] dedup skip: ${title.slice(0, 50)}`);
      updateNewsAI(row['id'] as number, 'neutral', 1, 'Duplicate article from another RSS source', 'intraday');
      continue;
    }
    seenTitles.add(normalized);

    // 关键词预过滤
    if (!isGoldRelevant(title, summary)) {
      logger.debug(`[news-assessor] skipping non-relevant: ${title.slice(0, 50)}`);
      // 标记为 neutral/1 跳过
      updateNewsAI(row['id'] as number, 'neutral', 1, 'Not directly relevant to gold market', 'intraday');
      continue;
    }

    try {
      const assessment = await assessSingleNews(title, summary, currentPrice, marketContext);
      updateNewsAI(
        row['id'] as number,
        assessment.direction,
        assessment.impact,
        assessment.reasoning,
        assessment.timeframe
      );
      assessed++;
      logger.info(`[news-assessor] assessed: [${assessment.impact}/5 ${assessment.direction}] ${title.slice(0, 60)}`);
    } catch (err) {
      logger.error(`[news-assessor] failed to assess news ${row['id']}`, { err });
    }
  }

  return assessed;
}
