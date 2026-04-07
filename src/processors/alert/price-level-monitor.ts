/**
 * 价格关键位监控
 * ─────────────────────────────────────────────────────────────────
 * 负责检测以下类型的价格事件，并通过钉钉推送通知：
 *
 *  1. 整10位关口穿越  — ¥680 / ¥690 / ¥700 ...（百元大关/五十关口/十元关口）
 *  2. 52周高低点突破  — 年内新高/新低
 *  3. SGE溢价异常     — 溢价绝对值 > $5/oz
 *  4. 日线涨跌幅播报  — 单日累计涨跌超过 1% / 2%
 *
 * 所有规则均内置冷却机制，防止同一事件重复推送。
 */
import { sendDingTalkBrief } from '../../push/dingtalk';
import logger from '../../utils/logger';

// ── 冷却时间表（同一关键位触发后多少毫秒内不再推送）───────────
const COOLDOWNS = {
  integerLevel: 4 * 3600_000,  // 整数关口：4小时
  high52w:      6 * 3600_000,  // 年内新高：6小时
  low52w:       6 * 3600_000,  // 年内新低：6小时
  sgePremium:   2 * 3600_000,  // SGE溢价：2小时
  dailyMove:    3 * 3600_000,  // 日内涨跌：3小时
};

const cooldownMap = new Map<string, number>();

function isCooled(key: string, ms: number): boolean {
  const last = cooldownMap.get(key);
  return last ? Date.now() - last < ms : false;
}

function setCooled(key: string): void {
  cooldownMap.set(key, Date.now());
}

// 52周高低点缓存（每小时刷新，避免每分钟查库）
let _52wCache: { high: number; low: number; fetchedAt: number } | null = null;

export async function get52WHL(): Promise<{ high: number; low: number } | null> {
  if (_52wCache && Date.now() - _52wCache.fetchedAt < 3600_000) {
    return _52wCache;
  }
  try {
    const { get52WeekHighLow } = await import('../../storage/dao');
    const hl = get52WeekHighLow();
    if (hl) _52wCache = { ...hl, fetchedAt: Date.now() };
    return hl;
  } catch {
    return null;
  }
}

// ── 1. 整数关口穿越检测（每分钟触发）──────────────────────────────
export async function checkIntegerLevelCross(
  cnyNow: number,
  cnyPrev: number | null
): Promise<void> {
  if (!cnyPrev || Math.abs(cnyNow - cnyPrev) < 0.01) return;

  const STEP = 10;
  const lo = Math.min(cnyNow, cnyPrev);
  const hi = Math.max(cnyNow, cnyPrev);

  // 找出区间内所有整10位整数
  const firstLevel = Math.ceil(lo / STEP) * STEP;
  for (let level = firstLevel; level <= hi; level += STEP) {
    // 确认这个 level 确实被穿越（不是仅仅端点相等的情况）
    const goingUp   = cnyNow > cnyPrev && level > lo && level <= hi;
    const goingDown = cnyNow < cnyPrev && level >= lo && level < hi;
    if (!goingUp && !goingDown) continue;

    const direction = goingUp ? 'up' : 'down';
    const key = `LEVEL_${level}_${direction}`;
    if (isCooled(key, COOLDOWNS.integerLevel)) continue;
    setCooled(key);

    const arrow = goingUp ? '▲' : '▼';
    const action = goingUp ? '突破上方' : '跌破下方';

    // 按整数位级别区分重要性
    const is100 = level % 100 === 0;
    const is50  = !is100 && level % 50 === 0;
    const importance = is100 ? '⭐⭐⭐ 百元大关' : is50 ? '⭐⭐ 重要关口' : '⭐ 整数关口';
    const titleEmoji = is100 ? '🔔🔔' : is50 ? '🔔' : '📍';

    const tipUp = is100
      ? `¥${level}/g 是重要心理关口，市场可能在此出现明显阻力，追高需谨慎，关注量能是否放大。`
      : goingUp
        ? `价格突破整数关口，短线看多信号，但注意逢整数位容易出现止盈卖压。`
        : `价格跌破整数关口，注意下方支撑，若继续下行则观察下一整数位。`;
    const tipDown = is100
      ? `¥${level}/g 百元支撑位失守，下行压力加大，持仓者检查止损。`
      : `价格跌破整数关口，关注是否企稳，小心支撑转为压力。`;
    const tip = goingUp ? tipUp : tipDown;

    const content = [
      `## ${titleEmoji} 黄金价格${action} ¥${level}/g ${arrow}`,
      `**${importance}**`,
      '',
      `| | 价格 |`,
      `|--|--|`,
      `| 前一价格 | ¥${cnyPrev.toFixed(2)}/g |`,
      `| 当前价格 | **¥${cnyNow.toFixed(2)}/g** |`,
      '',
      `> 💡 ${tip}`,
      '',
      `> ${new Date().toLocaleString('zh-CN')} · Gold Sentinel`,
    ].join('\n');

    await sendDingTalkBrief(
      `${titleEmoji} 黄金${action} ¥${level}/g ${arrow}`,
      content
    );
    logger.info('[level-monitor] integer level crossed', {
      level, direction, cnyNow: cnyNow.toFixed(2), cnyPrev: cnyPrev.toFixed(2),
    });
  }
}

// ── 2. 52周高低点突破检测 ───────────────────────────────────────
export async function check52WeekBreakout(cnyNow: number): Promise<void> {
  const hl = await get52WHL();
  if (!hl) return;

  // 年内新高
  if (cnyNow > hl.high) {
    const key = `52W_HIGH_${Math.floor(cnyNow / 5) * 5}`; // 每突破5元才算新高
    if (!isCooled(key, COOLDOWNS.high52w)) {
      setCooled(key);
      const upPct = ((cnyNow - hl.high) / hl.high * 100).toFixed(2);
      const content = [
        `## 🏆 黄金创52周新高！`,
        '',
        `| | 价格 |`,
        `|--|--|`,
        `| 当前价格 | **¥${cnyNow.toFixed(2)}/g** |`,
        `| 52周前高 | ¥${hl.high.toFixed(2)}/g |`,
        `| 超越幅度 | +¥${(cnyNow - hl.high).toFixed(2)}/g (+${upPct}%) |`,
        '',
        '> 🚀 **价格创年内新高，强势趋势确认。** 追高有风险，建议等待短线回调后再布局；已持仓者可适当上移止损保护利润。',
        '',
        `> ${new Date().toLocaleString('zh-CN')} · Gold Sentinel`,
      ].join('\n');
      await sendDingTalkBrief('🏆 黄金创52周新高', content);
      logger.info('[level-monitor] 52W high breakout', { cnyNow, prev52wHigh: hl.high });
      // 刷新缓存（新高已经改变了52周范围）
      _52wCache = null;
    }
  }

  // 年内新低
  if (cnyNow < hl.low) {
    const key = `52W_LOW_${Math.ceil(cnyNow / 5) * 5}`;
    if (!isCooled(key, COOLDOWNS.low52w)) {
      setCooled(key);
      const downPct = ((hl.low - cnyNow) / hl.low * 100).toFixed(2);
      const content = [
        `## 📉 黄金创52周新低！`,
        '',
        `| | 价格 |`,
        `|--|--|`,
        `| 当前价格 | **¥${cnyNow.toFixed(2)}/g** |`,
        `| 52周前低 | ¥${hl.low.toFixed(2)}/g |`,
        `| 跌幅     | -¥${(hl.low - cnyNow).toFixed(2)}/g (-${downPct}%) |`,
        '',
        '> ⚠️ **价格创年内新低，下行趋势确立。** 持仓者立即检查止损位，空仓者等待企稳信号，切勿盲目抄底。',
        '',
        `> ${new Date().toLocaleString('zh-CN')} · Gold Sentinel`,
      ].join('\n');
      await sendDingTalkBrief('📉 黄金创52周新低', content);
      logger.info('[level-monitor] 52W low breakout', { cnyNow, prev52wLow: hl.low });
      _52wCache = null;
    }
  }
}

// ── 3. SGE溢价异常检测 ─────────────────────────────────────────
export async function checkSGEPremiumAnomaly(premiumUsd: number | null | undefined): Promise<void> {
  if (premiumUsd === null || premiumUsd === undefined || isNaN(premiumUsd)) return;

  const absVal = Math.abs(premiumUsd);
  if (absVal <= 5) return; // 正常范围内

  const direction = premiumUsd > 0 ? 'positive' : 'negative';
  const key = `SGE_PREMIUM_${direction}`;
  if (isCooled(key, COOLDOWNS.sgePremium)) return;
  setCooled(key);

  const emoji = premiumUsd > 0 ? '📈' : '📉';
  const label = premiumUsd > 0 ? '大幅溢价' : '罕见折价';
  const interpretation = premiumUsd > 0
    ? '国内黄金需求强劲，或进口通道受限，境内买盘旺盛。通常是价格上行的正向信号，关注是否持续扩大。'
    : '上金所出现折价极为罕见，可能源于境内流动性问题或政策管控，需高度关注市场异常。';

  const content = [
    `## ${emoji} SGE溢价异常 · ${label}`,
    '',
    `**SGE溢价**: ${premiumUsd > 0 ? '+' : ''}$${premiumUsd.toFixed(2)}/oz`,
    `**阈值**: ±$5/oz（当前已${absVal > 10 ? '严重' : ''}超出正常范围）`,
    '',
    `> 💡 ${interpretation}`,
    '',
    `> ${new Date().toLocaleString('zh-CN')} · Gold Sentinel`,
  ].join('\n');

  await sendDingTalkBrief(
    `${emoji} SGE溢价异常: ${premiumUsd > 0 ? '+' : ''}$${premiumUsd.toFixed(2)}/oz`,
    content
  );
  logger.info('[level-monitor] SGE premium anomaly', { premiumUsd: premiumUsd.toFixed(2) });
}

// ── 4. 日内累计涨跌幅预警 ──────────────────────────────────────
// 用日线收盘价计算当日累计涨跌，达到阈值时推送
export async function checkDailyMoveAlert(
  cnyNow: number,
  yesterdayCloseCny: number | null
): Promise<void> {
  if (!yesterdayCloseCny || yesterdayCloseCny <= 0) return;

  const movePct = ((cnyNow - yesterdayCloseCny) / yesterdayCloseCny) * 100;
  const absMove = Math.abs(movePct);

  // 涨跌超过1.5%提醒，超过2.5%高级提醒
  const threshold = absMove >= 2.5 ? 2.5 : absMove >= 1.5 ? 1.5 : 0;
  if (threshold === 0) return;

  const direction = movePct > 0 ? 'up' : 'down';
  const key = `DAILY_MOVE_${threshold}_${direction}`;
  if (isCooled(key, COOLDOWNS.dailyMove)) return;
  setCooled(key);

  const arrow = movePct > 0 ? '▲' : '▼';
  const emoji = movePct > 0 ? '🚀' : '💥';
  const levelTag = threshold >= 2.5 ? '⚡ 大幅波动' : '⚠️ 明显波动';
  const tip = movePct > 0
    ? threshold >= 2.5
      ? '今日大幅上涨，关注基本面消息驱动，追高需谨慎，建议分批止盈。'
      : '今日稳步上涨，趋势良好，持仓继续持有，关注能否收稳。'
    : threshold >= 2.5
      ? '今日大幅下跌，持仓者检查止损，空仓者不急于抄底，等待企稳信号。'
      : '今日明显下跌，关注下方支撑位，若触及止损线按计划执行。';

  const content = [
    `## ${emoji} 黄金今日${movePct > 0 ? '上涨' : '下跌'} ${arrow}${absMove.toFixed(2)}% ${levelTag}`,
    '',
    `| | 价格 |`,
    `|--|--|`,
    `| 昨日收盘 | ¥${yesterdayCloseCny.toFixed(2)}/g |`,
    `| 当前价格 | **¥${cnyNow.toFixed(2)}/g** |`,
    `| 今日变动 | ${movePct > 0 ? '+' : ''}¥${(cnyNow - yesterdayCloseCny).toFixed(2)}/g (${movePct > 0 ? '+' : ''}${movePct.toFixed(2)}%) |`,
    '',
    `> 💡 ${tip}`,
    '',
    `> ${new Date().toLocaleString('zh-CN')} · Gold Sentinel`,
  ].join('\n');

  await sendDingTalkBrief(
    `${emoji} 黄金今日${movePct > 0 ? '涨' : '跌'} ${arrow}${absMove.toFixed(2)}%`,
    content
  );
  logger.info('[level-monitor] daily move alert', {
    movePct: movePct.toFixed(2), threshold, cnyNow, yesterdayCloseCny,
  });
}
