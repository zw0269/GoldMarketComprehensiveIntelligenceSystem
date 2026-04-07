/**
 * Polymarket 预测市场数据采集器
 *
 * Polymarket（polymarket.com）是全球最大的预测市场平台，
 * 用户使用真实资金对事件结果进行押注，价格即概率。
 *
 * 说明（来自原概念）：
 *   "别听专家瞎分析，去看全世界聪明钱在拿真金白银押注什么"
 *   平台的事件概率比新闻更及时、更能反映真实的市场预期。
 *
 * 数据源：Polymarket Gamma API — 免费，无需 API Key
 * API: https://gamma-api.polymarket.com/markets
 */
import axios from 'axios';
import logger from '../../utils/logger';

const POLYMARKET_API = 'https://gamma-api.polymarket.com/markets';

// 与黄金、宏观经济、地缘政治相关的关键词（用于筛选有意义的市场）
const RELEVANT_KEYWORDS = [
  'war', 'recession', 'fed', 'federal reserve', 'rate cut', 'rate hike',
  'trump', 'china', 'russia', 'iran', 'ukraine', 'israel', 'middle east',
  'gdp', 'inflation', 'dollar', 'economy', 'debt', 'default',
  'election', 'crisis', 'sanction', 'military', 'conflict', 'nato',
  'tariff', 'trade', 'brics', 'oil', 'energy', 'opec',
  'bitcoin', 'gold', 'safe haven', 'powell', 'fomc',
];

export interface PolymarketMarket {
  id: string;
  question: string;
  yesPrice: number;   // YES 概率 (0.0 ~ 1.0)
  volume24h: number;  // 24小时交易量（USD）
  endDate?: string;   // 结束日期
}

export interface PolymarketData {
  markets: PolymarketMarket[];
  fetchedAt: number;
  totalFetched: number;
  relevantCount: number;
}

interface RawMarket {
  id?: string;
  conditionId?: string;
  question?: string;
  outcomePrices?: string;     // JSON array string, e.g. '["0.65", "0.35"]'
  volume?: number;
  volume24hr?: number;
  endDateIso?: string;
  active?: boolean;
  closed?: boolean;
  category?: string;
  tags?: unknown[];
}

export async function fetchPolymarketMarkets(): Promise<PolymarketData> {
  const res = await axios.get(POLYMARKET_API, {
    params: {
      limit:     100,
      active:    true,
      closed:    false,
      order:     'volume24hr',
      ascending: false,
    },
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
      'Accept':     'application/json',
    },
    timeout: 12000,
  });

  const raw = (Array.isArray(res.data) ? res.data : []) as RawMarket[];
  const totalFetched = raw.length;

  const markets: PolymarketMarket[] = raw
    .filter(m => {
      if (!m.question) return false;
      const q = m.question.toLowerCase();
      return RELEVANT_KEYWORDS.some(kw => q.includes(kw));
    })
    .slice(0, 25)
    .map(m => {
      // outcomePrices is a JSON string like '["0.65", "0.35"]'
      let yesPrice = 0.5;
      try {
        const prices = JSON.parse(m.outcomePrices ?? '[]') as string[];
        yesPrice = parseFloat(prices[0] ?? '0.5');
        if (isNaN(yesPrice)) yesPrice = 0.5;
      } catch { /* keep default */ }

      return {
        id:       m.id ?? m.conditionId ?? '',
        question: m.question!,
        yesPrice,
        volume24h: m.volume24hr ?? m.volume ?? 0,
        endDate:  m.endDateIso?.slice(0, 10),
      };
    })
    .filter(m => m.id && m.question);

  logger.info('[polymarket] markets fetched', {
    totalFetched,
    relevant: markets.length,
  });

  return {
    markets,
    fetchedAt: Date.now(),
    totalFetched,
    relevantCount: markets.length,
  };
}

/**
 * 将 Polymarket 数据格式化为 AI 可读的文本块
 */
export function formatPolymarketForAI(data: PolymarketData): string {
  if (!data.markets.length) return '（暂无 Polymarket 数据）';

  const lines = [
    `## Polymarket 全球聪明钱押注（真实概率，${new Date(data.fetchedAt).toLocaleString('zh-CN')}）`,
    '> 以下为真金白银押注的事件概率，比新闻更早反映市场预期',
  ];

  for (const m of data.markets) {
    const pct  = Math.round(m.yesPrice * 100);
    const vol  = m.volume24h >= 1e6
      ? `$${(m.volume24h / 1e6).toFixed(1)}M`
      : m.volume24h >= 1000
        ? `$${(m.volume24h / 1000).toFixed(0)}K`
        : `$${m.volume24h.toFixed(0)}`;
    const end  = m.endDate ? ` [到期:${m.endDate}]` : '';
    const icon = pct >= 70 ? '🔴' : pct >= 50 ? '🟡' : '🟢';
    lines.push(`${icon} ${pct}% — ${m.question}（24h交易量:${vol}）${end}`);
  }

  return lines.join('\n');
}
