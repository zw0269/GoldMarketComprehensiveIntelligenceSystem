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

// ── 每1分钟：价格采集 ─────────────────────────────────────────
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
      lastPrice = agg.xauUsd;
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
        await assessPendingNews(lastPrice);
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
    if (!config.api.anthropicKey) return;
    try {
      const brief = await generateDailyBrief();
      await pushDailyBrief(brief);
    } catch (err) {
      logger.error('[scheduler] daily brief failed', { err });
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

      // 只有 STRONG_BUY / STRONG_SELL / BUY / SELL 才推送，且同一信号2小时内不重复
      const shouldPush = (signal.signal === 'STRONG_BUY' || signal.signal === 'STRONG_SELL' ||
                          signal.signal === 'BUY'         || signal.signal === 'SELL') &&
        (signal.signal !== alertState.lastSignal || Date.now() - alertState.lastSignalTs > 2 * 3600_000);

      if (!shouldPush) return;

      alertState.lastSignal   = signal.signal;
      alertState.lastSignalTs = Date.now();

      const LABELS: Record<string, string> = {
        STRONG_BUY: '🟢 强烈买入', BUY: '🟢 建议买入',
        SELL: '🔴 建议减仓',       STRONG_SELL: '🔴 强烈减仓',
      };
      const label = LABELS[signal.signal] ?? signal.signal;

      // 钉钉推送
      const ddContent = [
        `## ${label}`,
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
      ].filter(Boolean).join('\n');

      await sendDingTalkBrief(`Gold Sentinel ${label}`, ddContent);

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

// ── 每日 02:00：AI 提示词归纳总结分析 ────────────────────────
export function scheduleAIDailySummary() {
  return cron.schedule('0 2 * * *', async () => {
    try {
      const { generateAIDailySummary } = await import('../processors/ai/ai-summary');
      const summary = await generateAIDailySummary();
      if (summary) {
        logger.info('[scheduler] AI daily summary generated', { length: summary.length });
        // 推送总结
        await pushDailyBrief(`【AI 提示词日报 ${new Date().toLocaleDateString('zh-CN')}】\n\n${summary}`);
      }
    } catch (err) {
      logger.error('[scheduler] AI daily summary failed', { err });
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
    ...scheduleIntradayBrief(), // 09:30/13:30/21:30 盘中快报
    scheduleIntelCollectors(),  // 每30分钟前瞻指标（披萨指数+Polymarket）
  ];
  logger.info('[scheduler] all tasks started', { count: tasks.length });
  return tasks;
}
