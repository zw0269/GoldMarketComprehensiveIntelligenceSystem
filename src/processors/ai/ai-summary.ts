/**
 * AI 提示词每日归纳总结 (每日凌晨 2:00)
 * 汇总当日所有 AI 交互，生成结构化分析报告
 */
import dayjs from 'dayjs';
import { callClaude } from './claude-client';
import { getAILogsByDateRange, insertAIDailySummary } from '../../storage/dao';
import logger from '../../utils/logger';

const SUMMARY_SYSTEM = `你是一位 AI 系统运营分析师，专门分析黄金市场智能系统的 AI 调用日志。
你的任务是对一天内所有 AI 交互（新闻评估、市场日报、用户想法分析、交易复盘、用户问答等）
进行归纳总结，发现规律、亮点和改进方向。

请用中文输出，结构化格式，包含以下几个部分：
1. 📊 当日 AI 活动概览（各类型调用次数、总体质量）
2. 📰 新闻评估规律（今日市场关注焦点、情绪倾向分布）
3. 💡 用户提问特征（关注什么问题、高频话题）
4. 🔍 值得注意的 AI 判断（有价值的分析观点摘录）
5. ⚠️ 异常或低质量输出（如有）
6. 📈 对明日市场的启示（从今日 AI 分析中提炼）`.trim();

export async function generateAIDailySummary(): Promise<string | null> {
  const today = dayjs().format('YYYY-MM-DD');
  const startOfDay = dayjs().startOf('day').valueOf();
  const now = Date.now();

  // 取当日所有 AI 交互日志
  const logs = getAILogsByDateRange(startOfDay, now) as Array<Record<string, unknown>>;

  if (logs.length === 0) {
    logger.info('[ai-summary] no AI interactions today, skipping summary');
    return null;
  }

  // 统计各类型数量
  const stats: Record<string, number> = {};
  for (const log of logs) {
    const type = (log['context_type'] as string) || 'unknown';
    stats[type] = (stats[type] || 0) + 1;
  }

  // 构建摘要内容（选取有代表性的条目，避免过长）
  const sampledLogs = sampleLogs(logs, 30);

  const logsText = sampledLogs.map((log, i) => {
    const type = log['context_type'] as string;
    const userMsg = ((log['user_message'] as string) || '').slice(0, 300);
    const response = ((log['response'] as string) || '').slice(0, 400);
    const ts = dayjs(log['ts'] as number).format('HH:mm');
    return `[${i + 1}] ${ts} · 类型:${type}\n用户: ${userMsg}\nAI: ${response}`;
  }).join('\n\n---\n\n');

  const statsText = Object.entries(stats)
    .map(([k, v]) => `${k}: ${v}次`)
    .join('、');

  const userMessage = `今日日期：${today}
AI 交互统计：${statsText}（共 ${logs.length} 次）

以下是今日部分 AI 交互记录（已采样 ${sampledLogs.length} 条）：

${logsText}

请对以上内容进行归纳总结分析。`;

  logger.info('[ai-summary] generating daily summary', { date: today, totalLogs: logs.length });

  const summary = await callClaude(SUMMARY_SYSTEM, userMessage, 2000, 'summary');

  // 保存到数据库
  insertAIDailySummary(today, summary, JSON.stringify(stats));

  return summary;
}

/** 分层采样：每种类型最多取 N 条，优先取有 response 的 */
function sampleLogs(
  logs: Array<Record<string, unknown>>,
  maxTotal: number
): Array<Record<string, unknown>> {
  const byType: Record<string, Array<Record<string, unknown>>> = {};
  for (const log of logs) {
    const type = (log['context_type'] as string) || 'unknown';
    if (!byType[type]) byType[type] = [];
    byType[type].push(log);
  }

  const typeCount = Object.keys(byType).length;
  const perType = Math.max(2, Math.floor(maxTotal / typeCount));
  const result: Array<Record<string, unknown>> = [];

  for (const [, typeLogs] of Object.entries(byType)) {
    // 优先有 response 的
    const withResp = typeLogs.filter(l => l['response']);
    const picked = withResp.slice(0, perType);
    if (picked.length < perType) {
      picked.push(...typeLogs.filter(l => !l['response']).slice(0, perType - picked.length));
    }
    result.push(...picked);
  }

  return result.slice(0, maxTotal);
}
