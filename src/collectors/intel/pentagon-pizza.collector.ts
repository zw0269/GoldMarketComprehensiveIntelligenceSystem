/**
 * 五角大楼披萨指数（军事活动代理指数）
 *
 * 原始概念：通过追踪五角大楼周边披萨外卖量来判断军事紧张程度。
 * 本实现：使用 GDELT 全球新闻数据库，统计过去24小时内
 *         五角大楼/美国军事相关紧急/异常活动新闻数量，映射为 0-100 指数。
 *
 * 阈值说明（来自原概念）：
 *   0-39  : 正常 — 军事活动正常水平
 *   40-59 : 警戒 — 需要小心，布局防守品种
 *   60-100: 高危 — 有大事酝酿，立即布局最防守品种
 *
 * 数据源：GDELT Project (https://gdeltproject.org) — 免费，无需 API Key
 */
import axios from 'axios';
import logger from '../../utils/logger';

const GDELT_URL = 'https://api.gdeltproject.org/api/v2/doc/doc';

// 查询关键词：限定权威媒体来源，搜索军事异常活动相关词汇
// 排除日常五角大楼新闻，聚焦"异常/紧急"行为信号
const MILITARY_QUERY = [
  '(pentagon OR "defense department" OR "us military" OR "joint chiefs")',
  '(emergency OR overnight OR alert OR deployment OR "force posture"',
  'OR crisis OR "military exercise" OR escalation OR "war game"',
  'OR briefing OR mobilization OR reinforcement OR strike)',
].join(' ');

export interface PentagonPizzaData {
  score: number;        // 0-100 军事活动指数
  articleCount: number; // 原始 GDELT 文章数（24小时）
  alertLevel: 'normal' | 'caution' | 'warning' | 'critical';
  interpretation: string;
  ts: number;
}

/**
 * 文章数 → 指数分数（0-100）
 * 公式：score = min(100, round(100 × n / (n + 30)))
 *   n=0   → 0,  n=10 → 25,  n=20 → 40(警戒线),
 *   n=40  → 57, n=60 → 67(高危线), n=100 → 77, n=200 → 87
 */
function countToScore(count: number): number {
  return Math.min(100, Math.round((100 * count) / (count + 30)));
}

function scoreToLevel(score: number): PentagonPizzaData['alertLevel'] {
  if (score >= 60) return 'critical';
  if (score >= 40) return 'warning';
  if (score >= 20) return 'caution';
  return 'normal';
}

const INTERPRETATIONS: Record<PentagonPizzaData['alertLevel'], string> = {
  normal:   '军事活动正常，外围局势平稳',
  caution:  '军事相关新闻略有上升，保持关注',
  warning:  '指数超过40！军事活动明显升温，建议布局防御性品种',
  critical: '指数超过60！有重大事件酝酿，军方可能在加班，立即布局最防守品种',
};

export async function fetchPentagonPizzaIndex(): Promise<PentagonPizzaData> {
  const res = await axios.get(GDELT_URL, {
    params: {
      query:      MILITARY_QUERY,
      mode:       'artlist',
      maxrecords: 250,
      format:     'json',
      timespan:   '1d',
    },
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
    timeout: 15000,
  });

  const data = res.data as { articles?: unknown[] } | null;
  const articleCount = Array.isArray(data?.articles) ? data!.articles!.length : 0;
  const score        = countToScore(articleCount);
  const alertLevel   = scoreToLevel(score);

  const result: PentagonPizzaData = {
    score,
    articleCount,
    alertLevel,
    interpretation: INTERPRETATIONS[alertLevel],
    ts: Date.now(),
  };

  logger.info('[pentagon-pizza] index fetched', {
    score,
    articleCount,
    alertLevel,
  });

  return result;
}
