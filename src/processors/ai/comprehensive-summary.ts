/**
 * 每日综合报告 & AI 自我进步 (Feature 3)
 *
 * 凌晨 02:00 生成，整合当日全量数据，AI 对比昨日进行自我评估和改进建议。
 * 包含：价格行情 · 重大新闻 · 央行动向 · 用户操作 · 回测结果 · Agent 建议
 */
import dayjs from 'dayjs';
import logger from '../../utils/logger';
import { callClaude } from './claude-client';
import {
  getDailyOHLCV,
  getLatestNews,
  getCentralBankMoves,
  getJournalEntries,
  getJournalStats,
  getLatestBacktestSummary,
  getAgentSuggestions,
  getLatestComprehensiveSummary,
  insertComprehensiveSummary,
  getMacroDashboard,
} from '../../storage/dao';

const SYSTEM = `你是 Gold Sentinel AI 首席分析师，负责每日综合复盘报告。
今日报告需要做到：
1. 客观评估今日市场表现
2. 诚实反思今日 AI 分析的准确性（与实际价格对比）
3. 提炼可复用的经验教训
4. 给出明日具体操作方向

报告使用中文，**加粗**关键结论，结构清晰，不超过1500字。`;

export async function generateComprehensiveSummary(): Promise<string | null> {
  const today     = dayjs().format('YYYY-MM-DD');
  const yesterday = dayjs().subtract(1, 'day').format('YYYY-MM-DD');

  // ── 1. 价格部分 ──────────────────────────────────────────────
  const ohlcvRows = getDailyOHLCV(30) as Array<Record<string, unknown>>;
  const todayOHLC  = ohlcvRows[0];
  const yestOHLC   = ohlcvRows[1];

  const priceSection: Record<string, unknown> = {};
  if (todayOHLC) {
    priceSection.date   = todayOHLC['date'];
    priceSection.open   = todayOHLC['open_cny_g'];
    priceSection.high   = todayOHLC['high_cny_g'];
    priceSection.low    = todayOHLC['low_cny_g'];
    priceSection.close  = todayOHLC['close_cny_g'];
    if (yestOHLC && yestOHLC['close_cny_g']) {
      const chg = ((todayOHLC['close_cny_g'] as number) - (yestOHLC['close_cny_g'] as number));
      const pct = chg / (yestOHLC['close_cny_g'] as number) * 100;
      priceSection.change = parseFloat(chg.toFixed(2));
      priceSection.changePct = parseFloat(pct.toFixed(2));
    }
  }

  const priceText = todayOHLC
    ? `开 ¥${todayOHLC['open_cny_g']}/g 高 ¥${todayOHLC['high_cny_g']}/g 低 ¥${todayOHLC['low_cny_g']}/g 收 ¥${todayOHLC['close_cny_g']}/g` +
      (priceSection.changePct !== undefined ? ` (${(priceSection.changePct as number) >= 0 ? '+' : ''}${priceSection.changePct}%)` : '')
    : '（今日价格数据暂未记录）';

  // 7日历史价格走势（时间正序）
  const hist7d = ohlcvRows.slice(0, 7).reverse()
    .map(d => {
      const closeG = d['close_cny_g'] ?? d['close'];
      return `${d['date']} ¥${closeG ?? 'N/A'}/g`;
    })
    .join(' → ');

  // 30日价格区间
  const closes30d = ohlcvRows
    .map(d => (d['close_cny_g'] ?? d['close']) as number)
    .filter(v => v && !isNaN(v));
  const high30d = closes30d.length > 0 ? Math.max(...closes30d) : null;
  const low30d  = closes30d.length > 0 ? Math.min(...closes30d) : null;
  const range30dText = high30d && low30d
    ? `30日区间：¥${low30d.toFixed(2)} ~ ¥${high30d.toFixed(2)}/g`
    : '';

  // ── 2. 新闻部分 ───────────────────────────────────────────────
  const allNews = getLatestNews(50) as Array<Record<string, unknown>>;
  const highNews = allNews.filter(n => (n['ai_impact'] as number) >= 3);
  const newsText = highNews.length > 0
    ? highNews.slice(0, 10).map(n =>
        `[影响${n['ai_impact']}/5·${n['ai_direction']}] ${n['title']} — ${n['ai_reasoning'] ?? ''}`
      ).join('\n')
    : '（今日无高影响力新闻）';

  // ── 3. 央行动向 ───────────────────────────────────────────────
  const cbMoves = getCentralBankMoves(7) as Array<Record<string, unknown>>;
  const cbText  = cbMoves.length > 0
    ? cbMoves.map(c => `${c['date']} ${c['country']} ${c['is_net'] ? '净' : ''}${(c['tonnes'] as number) > 0 ? '增持' : '减持'} ${Math.abs(c['tonnes'] as number).toFixed(1)}吨`).join('\n')
    : '（近7日无央行购金记录）';

  // ── 4. 用户操作记录 ───────────────────────────────────────────
  const journalEntries = getJournalEntries(100, 0) as Array<Record<string, unknown>>;
  // 过滤今日操作
  const todayStart = dayjs(today).startOf('day').valueOf();
  const todayEntries = journalEntries.filter(e => (e['ts'] as number) >= todayStart);
  const stats = getJournalStats() as Record<string, unknown>;

  const journalText = todayEntries.length > 0
    ? todayEntries.map(e =>
        `${e['type'] === 'buy' ? '买入' : '卖出'} ${e['grams']}g @ ¥${e['price_cny_g']}/g` +
        (e['pnl'] != null ? ` 盈亏¥${(e['pnl'] as number).toFixed(2)}` : '') +
        (e['note'] ? ` 备注:${e['note']}` : '')
      ).join('\n')
    : '（今日无交易操作）';

  // ── 5. 回测结果 ───────────────────────────────────────────────
  const btSummary = getLatestBacktestSummary() as Record<string, unknown> | null;
  const btText = btSummary
    ? `总信号${btSummary['total_signals']}次 胜率${btSummary['win_rate']}% 均回报${btSummary['avg_return_pct']}%\n` +
      `${((btSummary['full_analysis'] as string) ?? '').slice(0, 300)}...`
    : '（回测数据生成中）';

  // ── 6. Agent 建议 ─────────────────────────────────────────────
  const agentSugs = getAgentSuggestions(24, 5) as Array<Record<string, unknown>>;
  const agentText = agentSugs.length > 0
    ? agentSugs.map(s =>
        `[${s['watch_state']}·${s['factor_count']}因子] ${(s['suggestion'] as string).slice(0, 100)}...`
      ).join('\n')
    : '（今日无监控Agent触发）';

  // ── 7. 宏观指标 ───────────────────────────────────────────────
  const macro = getMacroDashboard() as Record<string, unknown>;
  const macroText = [
    macro['dxy']   ? `DXY=${macro['dxy']}`   : '',
    macro['us10y'] ? `US10Y=${macro['us10y']}%` : '',
    macro['vix']   ? `VIX=${macro['vix']}`   : '',
    macro['usd_cny'] ? `USD/CNY=${macro['usd_cny']}` : '',
  ].filter(Boolean).join(' · ');

  // ── 8. 昨日报告（用于自我对比）──────────────────────────────
  const yesterdaySummary = getLatestComprehensiveSummary() as Record<string, unknown> | null;
  const yesterdayText = yesterdaySummary?.['full_report']
    ? `【昨日报告摘要】\n${(yesterdaySummary['full_report'] as string).slice(0, 600)}`
    : '';

  // ── 读取交易策略备忘录 ─────────────────────────────────────────
  let strategyMemo = '';
  try {
    const fs = await import('fs');
    const path = await import('path');
    const memoPath = path.join(process.cwd(), 'STRATEGY_MEMO.md');
    if (fs.existsSync(memoPath)) {
      strategyMemo = fs.readFileSync(memoPath, 'utf-8').slice(0, 800);
    }
  } catch { /* 读取失败不中断 */ }

  // ── 构建 AI Prompt ────────────────────────────────────────────
  const userMsg = `
今日日期：${today}

【价格行情】${priceText}
【历史走势（近7日）】${hist7d || '（暂无）'}
${range30dText}
【宏观指标】${macroText || '（暂无）'}

【重大新闻（影响≥3）】
${newsText}

【央行购金动向（近7日）】
${cbText}

【今日操作记录】
${journalText}
累计统计：总盈亏¥${stats['totalPnl'] ?? 0}，胜率${stats['winRate'] ?? 0}%

【信号回测表现】
${btText}

【监控Agent建议】
${agentText}

${strategyMemo ? `【历史交易策略备忘录】\n${strategyMemo}` : ''}

${yesterdayText}

请生成今日综合复盘报告，按以下结构：

**一、今日市场回顾**（价格驱动因素，最重要的消息面）
**二、AI 系统表现自评**（今日信号准确性，哪里判断对了/错了，为什么）
**三、今日用户操作点评**（本次操作是否合理，有什么可以改进的）
**四、央行与机构动向解读**（对中长期黄金走势的影响）
**五、明日操作建议**（具体入场区间、止损、目标价，置信度）
**六、自我进步方向**（与昨日相比，AI分析哪里需要优化，下次如何做得更好）
`.trim();

  try {
    const report = await callClaude(SYSTEM, userMsg, 3000, 'comprehensive_summary');

    insertComprehensiveSummary({
      date: today,
      priceSection:   JSON.stringify(priceSection),
      newsSection:    JSON.stringify(highNews.slice(0, 10).map(n => ({ title: n['title'], impact: n['ai_impact'], direction: n['ai_direction'] }))),
      journalSection: JSON.stringify({ entries: todayEntries.length, totalPnl: stats['totalPnl'], winRate: stats['winRate'] }),
      backtestSection: btSummary ? JSON.stringify({ winRate: btSummary['win_rate'], totalSignals: btSummary['total_signals'] }) : undefined,
      aiSelfImprove:  report.split('**六、')[1]?.slice(0, 500),
      fullReport:     report,
    });

    logger.info('[comprehensive-summary] generated', { date: today, length: report.length });
    return report;
  } catch (err) {
    logger.error('[comprehensive-summary] AI call failed', { err });
    return null;
  }
}
