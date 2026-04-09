/**
 * 定时任务调度器 (T-701)
 * 使用 node-cron 管理所有采集和处理任务
 */
import cron from 'node-cron';
import logger from '../utils/logger';
import config from '../config';
import { broadcast } from '../api/server';
import { insertPrice, upsertInventory, upsertETFHolding, upsertMacroData, insertNews, cleanupOldMinuteData, upsertDailyOHLCV, insertPentagonPizza, upsertPolymarkets } from '../storage/dao';
import { fetchPentagonPizzaIndex } from '../collectors/intel/pentagon-pizza.collector';
import { fetchPolymarketMarkets } from '../collectors/intel/polymarket.collector';
import { aggregatePrices } from '../collectors/price/price-aggregator';
import { fetchCOMEXFutures } from '../collectors/price/comex-futures.collector';
import { fetchCOMEXInventory } from '../collectors/inventory/comex-inventory.collector';
import { fetchSHFEInventory } from '../collectors/inventory/shfe-inventory.collector';
import { fetchETFHoldings } from '../collectors/fund-flow/etf-holdings.collector';
import { fetchCFTCCOT } from '../collectors/fund-flow/cftc-cot.collector';
import { fetchMacroIndicators } from '../collectors/macro/fred.collector';
import { fetchYahooMacro } from '../collectors/macro/yahoo-macro.collector';
import { fetchRSSNews } from '../collectors/news/rss.collector';
import { fetchNewsAPI, fetchTrumpNews } from '../collectors/news/newsapi.collector';
import { fetchTruthSocialPosts } from '../collectors/news/truthsocial.collector';
import { assessPendingNews } from '../processors/ai/news-assessor';
import { generateDailyBrief } from '../processors/ai/daily-brief';
import { pushDailyBrief, pushAlert } from '../push/push-manager';
import { sendSignalEmail, sendLossWarningEmail, sendPriceSpikeEmail } from '../push/email';
import { sendDingTalkBrief } from '../push/dingtalk';

let lastPrice: number | null = null;
let lastCnyPrice: number | null = null;

// ── 休市判断（周六、周日国际黄金市场休市）──────────────────────
function isMarketOpen(): boolean {
  const day = new Date().getDay(); // 0=周日, 6=周六
  return day !== 0 && day !== 6;
}

// 防止重复推送的节流状态
const alertState = {
  lastSignal: '' as string,          // 上次推送的信号等级
  lastSignalTs: 0,                   // 上次信号推送时间
  lossPushedIds: new Set<number>(),  // 已推送过亏损警告的持仓ID（本次运行期间）
};

// 价格异动预警节流（同方向30分钟内不重复）
const spikeState: Record<string, number> = {
  // key = "up_5" / "down_5" / "up_15" 等，value = 上次推送时间戳
};

/**
 * 价格异动检测规则：
 *   5  分钟内变动 ≥ 0.5%  → MEDIUM  预警
 *  15  分钟内变动 ≥ 1.0%  → HIGH    预警
 *  30  分钟内变动 ≥ 1.5%  → CRITICAL 预警
 *
 * 同方向预警 30 分钟内不重复推送。
 */
const SPIKE_RULES = [
  { windowMin: 5,  threshold: 0.5,  level: 'MEDIUM'   as const },
  { windowMin: 15, threshold: 1.0,  level: 'HIGH'     as const },
  { windowMin: 30, threshold: 1.5,  level: 'CRITICAL' as const },
];

// ── 每1分钟：价格采集 + 关键位检测 ──────────────────────────────
export function scheduleEveryMinute() {
  return cron.schedule('* * * * *', async () => {
    // 周末休市，跳过实时价格采集
    if (!isMarketOpen()) return;
    try {
      const agg = await aggregatePrices();
      insertPrice({
        source: `aggregated:${agg.sources.join(',')}`,
        timestamp: agg.timestamp,
        xauUsd: agg.xauUsd,
        xauCny: agg.xauCny,
        usdCny: agg.usdCny,
        sgePremium: agg.sgePremiumUsd,
      });

      // 广播 WebSocket
      broadcast('PRICE', agg);

      // ── 关键位监控（整数关口 / 52W突破 / SGE溢价 / 日涨跌幅）──
      const prevCny = lastCnyPrice;
      lastPrice    = agg.xauUsd;
      lastCnyPrice = agg.xauCny;

      if (config.push.dingtalkWebhook) {
        const {
          checkIntegerLevelCross,
          check52WeekBreakout,
          checkSGEPremiumAnomaly,
          checkDailyMoveAlert,
        } = await import('../processors/alert/price-level-monitor');

        const { getYesterdayCloseCny } = await import('../storage/dao');
        const yesterdayClose = getYesterdayCloseCny();

        // check52WeekBreakout 只记录日志，不推送钉钉
        await Promise.allSettled([
          checkIntegerLevelCross(agg.xauCny, prevCny),
          check52WeekBreakout(agg.xauCny),
          checkSGEPremiumAnomaly(agg.sgePremiumUsd),
          checkDailyMoveAlert(agg.xauCny, yesterdayClose),
        ]);
      }
    } catch (err) {
      logger.error('[scheduler] 1min price fetch failed', { err });
    }
  });
}

// ── 每5分钟：SGE / 汇率 ──────────────────────────────────────
export function scheduleEvery5Min() {
  return cron.schedule('*/5 * * * *', async () => {
    if (!isMarketOpen()) return;
    try {
      const macro = await fetchYahooMacro();
      for (const m of macro) upsertMacroData(m);
    } catch (err) {
      logger.error('[scheduler] 5min macro fetch failed', { err });
    }
  });
}

// ── 每15分钟：宏观指标 ────────────────────────────────────────
export function scheduleEvery15Min() {
  return cron.schedule('*/15 * * * *', async () => {
    if (!isMarketOpen()) return;
    try {
      const [fredData, futures] = await Promise.allSettled([
        fetchMacroIndicators(),
        fetchCOMEXFutures(),
      ]);
      if (fredData.status === 'fulfilled') {
        for (const m of fredData.value) upsertMacroData(m);
      }
      if (futures.status === 'fulfilled' && futures.value) {
        upsertMacroData({
          date: new Date().toISOString().slice(0, 10),
          indicator: 'COMEX_GC',
          value: futures.value.price,
          source: 'yahoo',
        });
      }
    } catch (err) {
      logger.error('[scheduler] 15min fetch failed', { err });
    }
  });
}

// ── 每1小时：新闻聚合 + AI评估（休市时仅采集国际消息面，跳过AI评估）──
export function scheduleEveryHour() {
  return cron.schedule('0 * * * *', async () => {
    try {
      // 采集新闻（不论是否休市，始终采集国际消息面）
      const [rssNews, apiNews, trumpNews, truthPosts] = await Promise.allSettled([
        fetchRSSNews(30),
        fetchNewsAPI(),
        fetchTrumpNews(),
        fetchTruthSocialPosts(30),   // Truth Social 帖子
      ]);

      const allNews = [
        ...(rssNews.status    === 'fulfilled' ? rssNews.value    : []),
        ...(apiNews.status    === 'fulfilled' ? apiNews.value    : []),
        ...(trumpNews.status  === 'fulfilled' ? trumpNews.value  : []),
        ...(truthPosts.status === 'fulfilled' ? truthPosts.value : []),
      ];

      // Truth Social 采集失败时记录原因但不中断
      if (truthPosts.status === 'rejected') {
        logger.warn('[scheduler] Truth Social fetch failed', { err: truthPosts.reason });
      }

      for (const news of allNews) {
        try { insertNews(news); } catch { /* ignore duplicates */ }
      }

      // AI 评估（仅交易日执行，休市时跳过）
      if (isMarketOpen() && (config.api.anthropicKey || config.api.aiCustomBaseUrl) && lastPrice) {
        // 构建富含上下文的市场背景，供 AI 评估参考
        const { getPriceHistory: getPH, getMacroDashboard: getMacro, getLatestSignal: getSig, getDailyOHLCV: getDayOHLC } = await import('../storage/dao');
        const recentMinutes = getPH(Date.now() - 24 * 3600_000, Date.now(), 24) as Array<Record<string, number>>;
        const macro = getMacro() as Record<string, unknown>;
        const latestSig = getSig() as Record<string, unknown> | null;
        const dayBars = getDayOHLC(7) as Array<Record<string, unknown>>;

        const price24hAgo = recentMinutes.length > 0 ? recentMinutes[0]['xau_usd'] as number : null;
        const change24h = price24hAgo ? ((lastPrice - price24hAgo) / price24hAgo * 100) : null;

        // 7日价格趋势摘要
        const priceTrend7d = dayBars.slice(0, 7).reverse()
          .map(d => `${d['date']} ¥${d['xau_cny_g'] ?? d['close_cny_g'] ?? 'N/A'}/g`)
          .join(', ');

        const marketContext = [
          `XAU/USD: $${lastPrice.toFixed(2)}${change24h !== null ? ` (24h: ${change24h >= 0 ? '+' : ''}${change24h.toFixed(2)}%)` : ''}`,
          macro['dxy']   ? `DXY: ${macro['dxy']}` : '',
          macro['us10y'] ? `US10Y: ${macro['us10y']}%` : '',
          macro['vix']   ? `VIX: ${macro['vix']}` : '',
          macro['usd_cny'] ? `USD/CNY: ${macro['usd_cny']}` : '',
          latestSig ? `System Signal: ${latestSig['signal']} (score: ${latestSig['score']}, conf: ${latestSig['confidence']}%)` : '',
          priceTrend7d ? `7-day CNY trend: ${priceTrend7d}` : '',
        ].filter(Boolean).join(' | ');

        await assessPendingNews(lastPrice, marketContext);
      }

      logger.info('[scheduler] hourly news cycle done', { newsCount: allNews.length });
    } catch (err) {
      logger.error('[scheduler] hourly news failed', { err });
    }
  });
}

// ── 每日 06:00：库存 + ETF 更新 ──────────────────────────────
export function scheduleDailyInventory() {
  return cron.schedule('0 6 * * *', async () => {
    logger.info('[scheduler] daily inventory + ETF update');
    const [comex, shfe, etf] = await Promise.allSettled([
      fetchCOMEXInventory(),
      fetchSHFEInventory(),
      fetchETFHoldings(),
    ]);
    if (comex.status === 'fulfilled' && comex.value) upsertInventory(comex.value);
    if (shfe.status === 'fulfilled' && shfe.value) upsertInventory(shfe.value);
    if (etf.status === 'fulfilled') {
      for (const h of etf.value) upsertETFHolding(h);
    }
  });
}

// ── 每日 22:00：AI 市场日报 ──────────────────────────────────
export function scheduleDailyBrief() {
  return cron.schedule('0 22 * * *', async () => {
    if (!config.api.anthropicKey && !config.api.aiCustomBaseUrl) return;
    try {
      const brief = await generateDailyBrief();
      await pushDailyBrief(brief);
    } catch (err) {
      logger.error('[scheduler] daily brief failed', { err });
    }
  });
}

// ── 每日 22:30：Agent 成长日报（自我反思 + 准确率 + 约束进化） ──
export function scheduleAgentDailyReport() {
  return cron.schedule('30 22 * * *', async () => {
    if (!config.api.anthropicKey && !config.api.aiCustomBaseUrl) return;
    try {
      const { marketMonitorAgent } = await import('../agents/market-monitor-agent');
      await marketMonitorAgent.generateDailyGrowthReport();
    } catch (err) {
      logger.error('[scheduler] agent daily report failed', { err });
    }
  });
}

// ── 每周六 10:00：CFTC COT ────────────────────────────────────
export function scheduleWeeklyCOT() {
  return cron.schedule('0 10 * * 6', async () => {
    try {
      const { upsertCOTReport } = await import('../storage/dao');
      const cot = await fetchCFTCCOT();
      if (cot) {
        upsertCOTReport(cot);
        logger.info('[scheduler] CFTC COT updated', { netLong: cot.netLong });
      }
    } catch (err) {
      logger.error('[scheduler] CFTC COT failed', { err });
    }
  });
}

// ── 每30分钟：交易信号检测 + 推送 ────────────────────────────
export function scheduleSignalMonitor() {
  return cron.schedule('*/30 * * * *', async () => {
    if (!isMarketOpen()) return;
    try {
      const { generateSignal } = await import('../processors/ai/signal-engine');
      const { getLatestPrice } = await import('../storage/dao');

      const signal = await generateSignal();
      const price  = getLatestPrice() as Record<string, number> | null;
      const cnyG   = price?.['xau_cny_g'] ?? 0;

      const prevSignal = alertState.lastSignal;
      const signalChanged = signal.signal !== prevSignal;

      // 信号发生变化时立即推送；相同信号4小时后可再次推送（提醒）
      const shouldPush = signalChanged ||
        (signal.signal !== 'HOLD' && Date.now() - alertState.lastSignalTs > 4 * 3600_000);

      if (!shouldPush) return;

      alertState.lastSignal   = signal.signal;
      alertState.lastSignalTs = Date.now();

      const LABELS: Record<string, string> = {
        STRONG_BUY: '🟢 强烈买入', BUY: '🟢 建议买入',
        HOLD: '🟡 持续观望',
        SELL: '🔴 建议减仓',       STRONG_SELL: '🔴 强烈减仓',
      };
      const label = LABELS[signal.signal] ?? signal.signal;

      // 信号变化描述（若是首次则不显示"从...变为"）
      const changeDesc = signalChanged && prevSignal
        ? `**信号变化**: ${LABELS[prevSignal] ?? prevSignal} → **${label}**`
        : `**信号确认**: ${label}`;

      // 钉钉推送（任何信号变化均推送，含 HOLD，并附完整理由）
      const ddContent = [
        `## ${label}`,
        changeDesc,
        `**当前价格**: ¥${cnyG.toFixed(2)}/g`,
        signal.entry_cny_g    ? `**建议入场**: ¥${signal.entry_cny_g}/g` : '',
        signal.stop_loss      ? `**止损价位**: ¥${signal.stop_loss}/g` : '',
        signal.target_profit  ? `**目标价位**: ¥${signal.target_profit}/g` : '',
        signal.risk_reward    ? `**风险收益比**: 1:${signal.risk_reward}` : '',
        '',
        '**信号依据**:',
        ...signal.reasons.map(r => `- ${r}`),
        '',
        `> 置信度 ${signal.confidence}% · 综合评分 ${signal.score > 0 ? '+' : ''}${signal.score}`,
        `> ${new Date().toLocaleString('zh-CN')} · Gold Sentinel`,
      ].filter(Boolean).join('\n');

      await sendDingTalkBrief(`Gold Sentinel ${label}${signalChanged && prevSignal ? ` (从${prevSignal}变化)` : ''}`, ddContent);

      // 邮件推送
      await sendSignalEmail({
        signal: signal.signal,
        label,
        price: cnyG,
        entry: signal.entry_cny_g,
        stopLoss: signal.stop_loss,
        target: signal.target_profit,
        riskReward: signal.risk_reward,
        reasons: signal.reasons,
        confidence: signal.confidence,
      });

      logger.info('[scheduler] signal alert pushed', { signal: signal.signal });
    } catch (err) {
      logger.error('[scheduler] signal monitor failed', { err });
    }
  });
}

// ── 每5分钟：持仓止损监控 + 亏损预警 ─────────────────────────
export function schedulePositionMonitor() {
  return cron.schedule('*/5 * * * *', async () => {
    try {
      const { getOpenPositions, getLatestPrice } = await import('../storage/dao');
      const positions = getOpenPositions() as Array<Record<string, unknown>>;
      if (positions.length === 0) return;

      const price = getLatestPrice() as Record<string, number> | null;
      const cnyG  = price?.['xau_cny_g'];
      if (!cnyG) return;

      for (const pos of positions) {
        const id        = pos['id'] as number;
        const buyPrice  = pos['buy_price_cny_g'] as number;
        const grams     = pos['grams'] as number;
        const stopLoss  = pos['stop_loss'] as number | null;
        const pnl       = (cnyG - buyPrice) * grams - ((pos['buy_fee'] as number) ?? 0);
        const pnlPct    = ((cnyG - buyPrice) / buyPrice) * 100;

        // 触发推送条件：①触及止损价 ②亏损超过3%
        const hitStop  = stopLoss !== null && cnyG <= stopLoss;
        const bigLoss  = pnlPct <= -3;

        if ((hitStop || bigLoss) && !alertState.lossPushedIds.has(id)) {
          alertState.lossPushedIds.add(id);  // 每次启动期间每笔只预警一次

          // AI策略建议（简单规则，不调用AI节省资源）
          const hint = hitStop
            ? `价格已触及您设定的止损价 ¥${stopLoss!.toFixed(2)}/g，建议立即执行止损，控制风险。不止损，小亏变大亏。`
            : `当前浮亏 ${pnlPct.toFixed(2)}%，超过3%预警线。请检查原始买入逻辑是否仍然成立，若信号已反转建议止损离场。`;

          await pushAlert('PRICE', 'HIGH',
            `持仓亏损预警 · 仓位#${id}`,
            `买入价 ¥${buyPrice.toFixed(2)}/g · 当前 ¥${cnyG.toFixed(2)}/g · 亏损 ${pnlPct.toFixed(2)}%\n${hint}`
          );

          await sendLossWarningEmail({
            posId: id,
            buyPrice,
            currentPrice: cnyG,
            grams,
            pnl,
            pnlPct,
            stopLoss,
            hintStrategy: hint,
          });

          // 钉钉推送
          const ddText = [
            `## ⚠️ 持仓亏损预警 · 仓位#${id}`,
            `**买入价**: ¥${buyPrice.toFixed(2)}/g`,
            `**当前价**: ¥${cnyG.toFixed(2)}/g`,
            `**浮动亏损**: ¥${pnl.toFixed(2)} (${pnlPct.toFixed(2)}%)`,
            stopLoss ? `**止损线**: ¥${stopLoss.toFixed(2)}/g ${hitStop ? '✅ **已触及**' : ''}` : '',
            '',
            `> 💡 ${hint}`,
          ].filter(Boolean).join('\n');
          await sendDingTalkBrief('Gold Sentinel 亏损预警', ddText);

          logger.warn('[scheduler] loss alert sent', { id, pnlPct: pnlPct.toFixed(2) });
        }
      }
    } catch (err) {
      logger.error('[scheduler] position monitor failed', { err });
    }
  });
}

// ── 每5分钟：自动化盯盘分析（指标事件触发 AI 推送）──────────
export function scheduleAutoAnalyst() {
  return cron.schedule('*/5 * * * *', async () => {
    if (!isMarketOpen()) return;
    try {
      const { runAutoAnalyst } = await import('../processors/monitor/auto-analyst');
      await runAutoAnalyst();
    } catch (err) {
      logger.error('[scheduler] auto-analyst failed', { err });
    }
  });
}

// ── 每5分钟：持仓动态建议（止盈里程碑/信号反转/超时）────────��
export function schedulePositionAdvisor() {
  return cron.schedule('*/5 * * * *', async () => {
    try {
      const { getOpenPositions, getLatestPrice } = await import('../storage/dao');
      const positions = getOpenPositions() as Array<Record<string, unknown>>;
      if (positions.length === 0) return;
      const price = getLatestPrice() as Record<string, number> | null;
      const cnyG  = price?.['xau_cny_g'];
      if (!cnyG) return;
      const { runPositionAdvisor } = await import('../processors/monitor/position-advisor');
      await runPositionAdvisor(positions, cnyG);
    } catch (err) {
      logger.error('[scheduler] position-advisor failed', { err });
    }
  });
}

// ── 盘中快报：09:30 / 13:30 / 21:30 ─────────────────────────
export function scheduleIntradayBrief() {
  // 三个时间点：亚盘开盘、午盘恢复、美盘开盘
  return [
    cron.schedule('30 9  * * 1-5', async () => {
      const { generateIntradayBrief } = await import('../processors/ai/intraday-brief');
      await generateIntradayBrief();
    }),
    cron.schedule('30 13 * * 1-5', async () => {
      const { generateIntradayBrief } = await import('../processors/ai/intraday-brief');
      await generateIntradayBrief();
    }),
    cron.schedule('30 21 * * 1-5', async () => {
      const { generateIntradayBrief } = await import('../processors/ai/intraday-brief');
      await generateIntradayBrief();
    }),
  ];
}

// ── 每1分钟：价格异动监控（急涨/急跌预警）────────────────────
export function schedulePriceSpikeMonitor() {
  return cron.schedule('* * * * *', async () => {
    if (!isMarketOpen()) return;
    try {
      const { getPriceHistory } = await import('../storage/dao');
      const now = Date.now();

      // 只取最近30分钟的价格记录
      const prices = getPriceHistory(now - 31 * 60_000, now, 200) as Array<Record<string, number>>;
      if (prices.length < 2) return;

      const priceNow = prices[prices.length - 1]['xau_cny_g'];
      if (!priceNow) return;

      for (const rule of SPIKE_RULES) {
        const cutoff = now - rule.windowMin * 60_000;
        // 找最接近 windowMin 分钟前的价格
        const ref = prices.find(p => p['ts'] >= cutoff);
        if (!ref) continue;

        const priceBefore = ref['xau_cny_g'];
        if (!priceBefore) continue;

        const changeAmt = priceNow - priceBefore;
        const changePct = (changeAmt / priceBefore) * 100;
        const absPct    = Math.abs(changePct);

        if (absPct < rule.threshold) continue;

        const direction: 'up' | 'down' = changeAmt > 0 ? 'up' : 'down';
        const throttleKey = `${direction}_${rule.windowMin}`;
        const THROTTLE_MS = 30 * 60_000; // 同方向30分钟内不重复

        if (spikeState[throttleKey] && now - spikeState[throttleKey] < THROTTLE_MS) continue;
        spikeState[throttleKey] = now;

        const arrow     = direction === 'up' ? '▲' : '▼';
        const emoji     = direction === 'up' ? '🚀' : '💥';
        const levelIcon = { MEDIUM: '🟡', HIGH: '🟠', CRITICAL: '🔴' }[rule.level];

        logger.warn('[scheduler] price spike detected', {
          direction, windowMin: rule.windowMin, changePct: changePct.toFixed(2),
          priceBefore, priceNow, level: rule.level,
        });

        // 钉钉推送
        const ddContent = [
          `## ${emoji} 黄金价格${direction === 'up' ? '急涨' : '急跌'}预警 ${levelIcon}`,
          `**${rule.windowMin}分钟内变动**: ${arrow} **${Math.abs(changePct).toFixed(2)}%** (¥${Math.abs(changeAmt).toFixed(2)}/g)`,
          '',
          `| | 价格 |`,
          `|--|--|`,
          `| ${rule.windowMin}分钟前 | ¥${priceBefore.toFixed(2)}/g |`,
          `| 当前 | **¥${priceNow.toFixed(2)}/g** |`,
          '',
          direction === 'up'
            ? '> ⚠️ 价格快速拉升，警惕追高风险，关注是否有基本面消息驱动。'
            : '> ⚠️ 价格快速下跌，持仓者请检查止损线，空仓者关注超跌反弹机会。',
          '',
          `> ${new Date().toLocaleString('zh-CN')} · Gold Sentinel`,
        ].join('\n');

        await sendDingTalkBrief(
          `${emoji} 黄金${direction === 'up' ? '急涨' : '急跌'} ${arrow}${Math.abs(changePct).toFixed(2)}% · ${rule.windowMin}min`,
          ddContent
        );

        // 邮件推送
        await sendPriceSpikeEmail({
          direction,
          windowMin: rule.windowMin,
          changePct,
          changeAmt,
          priceBefore,
          priceNow,
          level: rule.level,
        });
      }
    } catch (err) {
      logger.error('[scheduler] price spike monitor failed', { err });
    }
  });
}

// ── 每日 02:00：综合日报 + 回测分析 + AI 自我进步 ─────────────
export function scheduleAIDailySummary() {
  return cron.schedule('0 2 * * *', async () => {
    const dateStr = new Date().toLocaleDateString('zh-CN');
    try {
      // Step 1: 先补录昨日信号回测结果（确保02:00时数据最新）
      const { recordSignalOutcomes, generateBacktestSummary } = await import('../processors/ai/backtester');
      await recordSignalOutcomes();
      const btSummary = await generateBacktestSummary();
      if (btSummary) logger.info('[scheduler] backtest summary generated');

      // Step 2: 生成综合日报（含自我进步）
      const { generateComprehensiveSummary } = await import('../processors/ai/comprehensive-summary');
      const report = await generateComprehensiveSummary();
      if (report) {
        logger.info('[scheduler] comprehensive summary generated', { length: report.length });
        await pushDailyBrief(`【Gold Sentinel 综合日报 ${dateStr}】\n\n${report}`);
      }

      // Step 3: 保留原有 AI 提示词归纳（作为补充）
      const { generateAIDailySummary } = await import('../processors/ai/ai-summary');
      await generateAIDailySummary();
    } catch (err) {
      logger.error('[scheduler] comprehensive daily summary failed', { err });
    }
  });
}

// ── 每30分钟：信号回测结果记录 ───────────────────────────────
export function scheduleBacktestOutcomes() {
  return cron.schedule('*/30 * * * *', async () => {
    try {
      const { recordSignalOutcomes } = await import('../processors/ai/backtester');
      const count = await recordSignalOutcomes();
      if (count > 0) logger.info('[scheduler] backtest outcomes recorded', { count });
    } catch (err) {
      logger.error('[scheduler] backtest outcomes failed', { err });
    }
  });
}

// ── 每5分钟：多因子复合告警 ──────────────────────────────────
export function scheduleCompositeAlert() {
  return cron.schedule('*/5 * * * *', async () => {
    if (!isMarketOpen()) return;
    try {
      const { runCompositeAlert } = await import('../processors/monitor/composite-alert');
      await runCompositeAlert();
    } catch (err) {
      logger.error('[scheduler] composite alert failed', { err });
    }
  });
}

// ── 每日 08:30（周一至周五）：早安黄金价格播报 ─────────────────
export function scheduleMorningReport() {
  return cron.schedule('30 8 * * 1-5', async () => {
    if (!config.push.dingtalkWebhook) return;
    try {
      const { getLatestPrice, getYesterdayCloseCny, getOpenPositions, getLatestNews, getLatestSignal } = await import('../storage/dao');

      const price = getLatestPrice() as Record<string, number> | null;
      const cnyG  = price?.['xau_cny_g'];
      const usdOz = price?.['xau_usd'];
      if (!cnyG) return;

      const yClose = getYesterdayCloseCny();
      const moveCny = yClose ? cnyG - yClose : null;
      const movePct = yClose ? ((cnyG - yClose) / yClose * 100) : null;
      const arrow   = moveCny !== null ? (moveCny >= 0 ? '▲' : '▼') : '';
      const moveStr = moveCny !== null && movePct !== null
        ? `${arrow} ¥${Math.abs(moveCny).toFixed(2)}/g (${movePct >= 0 ? '+' : ''}${movePct.toFixed(2)}%)`
        : '暂无对比数据';

      // 持仓汇总
      const positions = getOpenPositions() as Array<Record<string, unknown>>;
      let posSection = '> 当前无持仓';
      if (positions.length > 0) {
        const totalGrams  = positions.reduce((s, p) => s + (p['grams'] as number), 0);
        const totalCost   = positions.reduce((s, p) => s + (p['buy_price_cny_g'] as number) * (p['grams'] as number), 0);
        const avgCost     = totalCost / totalGrams;
        const totalPnl    = positions.reduce((s, p) => {
          const g = p['grams'] as number;
          const bp = p['buy_price_cny_g'] as number;
          const fee = (p['buy_fee'] as number) ?? 0;
          return s + (cnyG - bp) * g - fee;
        }, 0);
        const pnlSign = totalPnl >= 0 ? '+' : '';
        posSection = [
          `> 持仓 ${positions.length} 笔 · 共 ${totalGrams.toFixed(2)}g`,
          `> 均价 ¥${avgCost.toFixed(2)}/g · 浮动盈亏 **${pnlSign}¥${totalPnl.toFixed(2)}**`,
        ].join('\n');
      }

      // 交易信号
      const latestSignal = getLatestSignal() as Record<string, unknown> | null;
      const signalEmoji: Record<string, string> = {
        STRONG_BUY: '🟢🟢', BUY: '🟢', HOLD: '🟡', SELL: '🔴', STRONG_SELL: '🔴🔴',
      };
      const sigStr = latestSignal
        ? `${signalEmoji[latestSignal['signal'] as string] ?? ''} **${latestSignal['signal']}** (评分${latestSignal['score']}, 置信度${latestSignal['confidence']}%)`
        : '暂无信号';

      // 近期重要新闻（最多3条）
      const newsRows = (getLatestNews(20) as Array<Record<string, unknown>>)
        .filter(n => (n['ai_impact'] as number) >= 3)
        .slice(0, 3)
        .map(n => `> · [${n['ai_impact']}/5 ${n['ai_direction']}] ${(n['title'] as string).slice(0, 60)}`);
      const newsSection = newsRows.length > 0 ? newsRows.join('\n') : '> 暂无重要新闻';

      // 今日是周一，加上"新的一周"提示
      const isMonday = new Date().getDay() === 1;
      const greeting = isMonday ? '新的一周，祝您交易顺利！' : '今日黄金市场已开盘，请关注价格动态。';

      const content = [
        `## ☀️ 早安黄金播报 · ${new Date().toLocaleDateString('zh-CN', { weekday: 'long', month: 'long', day: 'numeric' })}`,
        '',
        `### 💰 黄金当前价格`,
        `| | 价格 |`,
        `|--|--|`,
        `| CNY/g | **¥${cnyG.toFixed(2)}/g** |`,
        usdOz ? `| USD/oz | $${usdOz.toFixed(2)}/oz |` : '',
        yClose ? `| 昨收 | ¥${yClose.toFixed(2)}/g |` : '',
        `| 较昨收 | ${moveStr} |`,
        '',
        `### 📡 系统信号`,
        `> ${sigStr}`,
        '',
        `### 📊 我的持仓`,
        posSection,
        '',
        `### 📰 今晨重要新闻`,
        newsSection,
        '',
        `> 💡 ${greeting}`,
        `> ${new Date().toLocaleString('zh-CN')} · Gold Sentinel`,
      ].filter(Boolean).join('\n');

      const { sendDingTalkBrief } = await import('../push/dingtalk');
      await sendDingTalkBrief('☀️ 早安黄金播报', content);
      logger.info('[scheduler] morning report sent', { cnyG: cnyG.toFixed(2) });
    } catch (err) {
      logger.error('[scheduler] morning report failed', { err });
    }
  });
}

// ── 每周一 09:00：周度展望播报 ────────────────────────────────
export function scheduleWeeklyOutlook() {
  return cron.schedule('0 9 * * 1', async () => {
    if (!config.push.dingtalkWebhook) return;
    try {
      const { getDailyOHLCV, getLatestPrice } = await import('../storage/dao');

      const price   = getLatestPrice() as Record<string, number> | null;
      const cnyG    = price?.['xau_cny_g'];
      if (!cnyG) return;

      // 取上周7天的日线数据
      const ohlcv = getDailyOHLCV(10) as Array<Record<string, unknown>>;
      // 过滤出上周的数据（最近1-7天，排除今天）
      const lastWeek = ohlcv.slice(1, 8); // 昨天往前7天

      let weekSection = '> 暂无上周行情数据';
      if (lastWeek.length > 0) {
        const closes  = lastWeek.map(d => d['xau_cny_g'] as number).filter(Boolean);
        const highs   = lastWeek.map(d => d['high'] as number).filter(Boolean);
        const lows    = lastWeek.map(d => d['low'] as number).filter(Boolean);
        const weekOpen  = closes[closes.length - 1];
        const weekClose = closes[0];
        const weekHigh  = highs.length ? Math.max(...highs) : null;
        const weekLow   = lows.length  ? Math.min(...lows)  : null;
        const weekMove  = weekClose && weekOpen ? ((weekClose - weekOpen) / weekOpen * 100) : null;

        weekSection = [
          `| 指标 | 数值 |`,
          `|--|--|`,
          weekOpen  ? `| 周初开盘 | ¥${weekOpen.toFixed(2)}/g |`  : '',
          weekClose ? `| 周末收盘 | ¥${weekClose.toFixed(2)}/g |` : '',
          weekHigh  ? `| 周内最高 | ¥${weekHigh.toFixed(2)}/g |`  : '',
          weekLow   ? `| 周内最低 | ¥${weekLow.toFixed(2)}/g |`   : '',
          weekMove  !== null ? `| 上周涨跌 | ${weekMove >= 0 ? '▲+' : '▼'}${weekMove.toFixed(2)}% |` : '',
        ].filter(Boolean).join('\n');
      }

      const content = [
        `## 📅 黄金周度展望 · ${new Date().toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' })}`,
        '',
        `### 📈 上周行情回顾`,
        weekSection,
        '',
        `### 💰 本周开盘价格`,
        `**¥${cnyG.toFixed(2)}/g**`,
        '',
        '### 📌 本周关注要点',
        '- 关注美联储官员讲话及经济数据（非农、CPI）对美元走势的影响',
        '- 地缘政治及避险情绪是否延续',
        '- SGE溢价变化是否反映国内需求趋势',
        '- 技术面关键支撑/阻力位变化',
        '',
        '> 💡 本系统将持续监控价格关键位、异动及重要信号，发现变化第一时间推送通知。',
        `> ${new Date().toLocaleString('zh-CN')} · Gold Sentinel`,
      ].join('\n');

      const { sendDingTalkBrief } = await import('../push/dingtalk');
      await sendDingTalkBrief('📅 黄金周度展望', content);
      logger.info('[scheduler] weekly outlook sent');
    } catch (err) {
      logger.error('[scheduler] weekly outlook failed', { err });
    }
  });
}

// ── 每日 00:05：日线 OHLCV 聚合（写入 prices_daily）────────────
export function scheduleDailyOHLCV() {
  return cron.schedule('5 0 * * *', () => {
    // 聚合昨天的分钟数据为日线 OHLCV
    const yesterday = new Date(Date.now() - 86400000);
    const dateStr = yesterday.toISOString().slice(0, 10); // YYYY-MM-DD
    try {
      upsertDailyOHLCV(dateStr);
      logger.info('[scheduler] daily OHLCV aggregated', { date: dateStr });
    } catch (err) {
      logger.error('[scheduler] daily OHLCV aggregation failed', { err, date: dateStr });
    }
  });
}

// ── 每日 03:00：数据清理 (T-204) ─────────────────────────────
export function scheduleCleanup() {
  return cron.schedule('0 3 * * *', () => {
    cleanupOldMinuteData(config.retention.minuteDataDays);
  });
}

// ── 每30分钟：三大前瞻指标采集 ──────────────────────────────────
// 1. 五角大楼披萨指数（军事活动代理，GDELT）
// 2. Polymarket 预测市场（全球聪明钱）
// TNX 由 Yahoo 宏观采集器（scheduleEvery5Min）自动采集，无需单独任务
export function scheduleIntelCollectors() {
  // 启动时立即执行一次
  void (async () => {
    try {
      const [pizzaRes, polyRes] = await Promise.allSettled([
        fetchPentagonPizzaIndex(),
        fetchPolymarketMarkets(),
      ]);
      if (pizzaRes.status === 'fulfilled') {
        insertPentagonPizza(pizzaRes.value);
        logger.info('[intel] pentagon pizza init', { score: pizzaRes.value.score });
      }
      if (polyRes.status === 'fulfilled') {
        upsertPolymarkets(polyRes.value.markets);
        logger.info('[intel] polymarket init', { count: polyRes.value.relevantCount });
      }
    } catch (err) {
      logger.warn('[intel] init fetch failed', { err });
    }
  })();

  // 每30分钟定时更新
  return cron.schedule('*/30 * * * *', async () => {
    try {
      const [pizzaRes, polyRes] = await Promise.allSettled([
        fetchPentagonPizzaIndex(),
        fetchPolymarketMarkets(),
      ]);
      if (pizzaRes.status === 'fulfilled') {
        insertPentagonPizza(pizzaRes.value);
        // 五角大楼指数高危时通过 WS 广播告警
        if (pizzaRes.value.score >= 60) {
          const { broadcast } = await import('../api/server');
          broadcast('INTEL_ALERT', {
            type: 'pentagon_pizza',
            score: pizzaRes.value.score,
            alertLevel: pizzaRes.value.alertLevel,
            interpretation: pizzaRes.value.interpretation,
          });
        }
      }
      if (polyRes.status === 'fulfilled') {
        upsertPolymarkets(polyRes.value.markets);
      }
    } catch (err) {
      logger.warn('[intel] 30min fetch failed', { err });
    }
  });
}

export function startAllSchedulers(): cron.ScheduledTask[] {
  const tasks = [
    scheduleEveryMinute(),
    scheduleEvery5Min(),
    scheduleEvery15Min(),
    scheduleEveryHour(),
    scheduleDailyInventory(),
    scheduleDailyBrief(),
    scheduleWeeklyCOT(),
    scheduleAIDailySummary(),   // 每日2点 AI 提示词总结
    scheduleDailyOHLCV(),       // 每日00:05 日线OHLCV聚合
    scheduleCleanup(),
    scheduleSignalMonitor(),    // 每30分钟信号推送
    schedulePositionMonitor(),  // 每5分钟持仓止损监控
    schedulePriceSpikeMonitor(), // 每分钟价格异动检测
    scheduleAutoAnalyst(),      // 每5分钟技术指标触发AI自动分析
    schedulePositionAdvisor(),  // 每5分钟持仓动态建议
    scheduleMorningReport(),    // 每日08:30 早安黄金播报
    scheduleWeeklyOutlook(),    // 每周一09:00 周度展望
    ...scheduleIntradayBrief(), // 09:30/13:30/21:30 盘中快报
    scheduleIntelCollectors(),   // 每30分钟前瞻指标（披萨指数+Polymarket）
    scheduleBacktestOutcomes(),  // 每30分钟信号回测结果记录
    scheduleCompositeAlert(),    // 每5分钟多因子复合告警
    scheduleAgentDailyReport(),  // 每日22:30 Agent成长日报（自我反思+准确率+约束进化）
  ];
  logger.info('[scheduler] all tasks started', { count: tasks.length });
  return tasks;
}
