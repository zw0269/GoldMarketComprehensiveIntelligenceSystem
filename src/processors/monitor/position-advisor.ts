/**
 * 持仓动态建议引擎
 *
 * 职责：
 *   1. 止盈里程碑：浮盈达到目标的50%时，建议将止损移至成本价（保本止损）
 *   2. 满盈提醒：浮盈达到或超过目标时，建议止盈或移动止损锁利
 *   3. 信号反转：持仓期间信号方向反转时，主动推送警告
 *   4. 持仓超时：持仓超过48小时，推送复盘建议
 *
 * 每条建议冷却 4 小时（避免同一仓位刷屏）
 */

import logger from '../../utils/logger';
import { getLatestSignal } from '../../storage/dao';
import { sendDingTalkBrief } from '../../push/dingtalk';
import dayjs from 'dayjs';

// ── 每笔持仓的建议冷却状态 ────────────────────────────────────
// key: `${posId}_${adviceType}` → 上次推送时间
const positionCooldowns = new Map<string, number>();
const ADVICE_COOLDOWN_MS = 4 * 3600_000; // 4小时

function isPositionCoolingDown(posId: number, adviceType: string): boolean {
  const key  = `${posId}_${adviceType}`;
  const last = positionCooldowns.get(key);
  return !!last && Date.now() - last < ADVICE_COOLDOWN_MS;
}

function markPositionCooldown(posId: number, adviceType: string) {
  positionCooldowns.set(`${posId}_${adviceType}`, Date.now());
}

// ── 单笔持仓分析 ──────────────────────────────────────────────
interface Position {
  id: number;
  buy_price_cny_g: number;
  grams: number;
  stop_loss: number | null;
  target_profit: number | null;
  buy_ts: number;
  entry_signal: string | null;
  buy_fee: number | null;
}

async function adviseSinglePosition(pos: Position, currentPrice: number): Promise<void> {
  const { id, buy_price_cny_g, grams, stop_loss, target_profit, buy_ts, entry_signal } = pos;
  const fee     = pos.buy_fee ?? 0;
  const pnl     = (currentPrice - buy_price_cny_g) * grams - fee;
  const pnlPct  = ((currentPrice - buy_price_cny_g) / buy_price_cny_g) * 100;
  const ageHours = (Date.now() - buy_ts) / 3600_000;

  const signal = getLatestSignal() as Record<string, unknown> | null;
  const currentSignalLevel = (signal?.['signal'] as string) ?? 'HOLD';

  const pushAdvice = async (type: string, title: string, content: string) => {
    if (isPositionCoolingDown(id, type)) return;
    markPositionCooldown(id, type);
    logger.info('[position-advisor] advice sent', { posId: id, type });
    await sendDingTalkBrief(title, content);
  };

  // ── 建议1：止盈里程碑 50% ─────────────────────────────────
  if (target_profit && stop_loss && !isPositionCoolingDown(id, 'milestone_50')) {
    const targetRange  = target_profit - buy_price_cny_g;
    const currentRange = currentPrice  - buy_price_cny_g;
    const progress     = targetRange > 0 ? currentRange / targetRange : 0;

    if (progress >= 0.5 && progress < 1.0 && currentPrice > buy_price_cny_g) {
      await pushAdvice(
        'milestone_50',
        `💛 仓位#${id} 已达目标50% — 建议保本止损`,
        [
          `## 💛 持仓里程碑 · 仓位#${id}`,
          `**当前价**: ¥${currentPrice.toFixed(2)}/g  |  **成本价**: ¥${buy_price_cny_g.toFixed(2)}/g`,
          `**浮盈**: ¥${pnl.toFixed(2)} (${pnlPct.toFixed(2)}%)`,
          `**目标进度**: ${(progress * 100).toFixed(0)}%  (¥${buy_price_cny_g.toFixed(2)} → ¥${target_profit.toFixed(2)})`,
          '',
          `## 💡 建议操作`,
          `将止损价从 **¥${stop_loss.toFixed(2)}/g** 上移至成本价 **¥${buy_price_cny_g.toFixed(2)}/g**`,
          `这样即使价格回落也不会亏损，同时保留继续上涨的空间。`,
          '',
          `> ${dayjs().format('MM-DD HH:mm')} · Gold Sentinel 持仓顾问`,
        ].join('\n')
      );
    }
  }

  // ── 建议2：接近或达到目标价 ──────────────────────────────
  if (target_profit && !isPositionCoolingDown(id, 'milestone_100')) {
    const progress = target_profit > buy_price_cny_g
      ? (currentPrice - buy_price_cny_g) / (target_profit - buy_price_cny_g)
      : 0;

    if (progress >= 0.9) {
      await pushAdvice(
        'milestone_100',
        `🎯 仓位#${id} 逼近目标价 — 考虑止盈`,
        [
          `## 🎯 接近目标价 · 仓位#${id}`,
          `**当前价**: ¥${currentPrice.toFixed(2)}/g  |  **目标价**: ¥${target_profit.toFixed(2)}/g`,
          `**浮盈**: ¥${pnl.toFixed(2)} (${pnlPct.toFixed(2)}%)`,
          '',
          `## 💡 建议操作（三选一）`,
          `1. **全部止盈**：当前价 ¥${currentPrice.toFixed(2)}/g 平仓，锁定利润`,
          `2. **部分止盈**：平仓50%，剩余继续持有并上移止损`,
          `3. **移动止损**：将止损上移至当前价下方1%（¥${(currentPrice * 0.99).toFixed(2)}/g）`,
          '',
          `> ${dayjs().format('MM-DD HH:mm')} · Gold Sentinel 持仓顾问`,
        ].join('\n')
      );
    }
  }

  // ── 建议3：信号反转（持多单但信号变空）──────────────────
  if (entry_signal && !isPositionCoolingDown(id, 'signal_reverse')) {
    const wasBullish = entry_signal === 'BUY' || entry_signal === 'STRONG_BUY';
    const nowBearish = currentSignalLevel === 'SELL' || currentSignalLevel === 'STRONG_SELL';

    if (wasBullish && nowBearish && pnlPct > -5) {
      // 持多单但信号反转为卖出，且还没有大幅亏损（此时建议止损更有意义）
      await pushAdvice(
        'signal_reverse',
        `⚠️ 仓位#${id} 持仓信号反转 — 建议评估止损`,
        [
          `## ⚠️ 信号反转预警 · 仓位#${id}`,
          `**入场信号**: ${entry_signal}  →  **当前信号**: ${currentSignalLevel}`,
          `**当前价**: ¥${currentPrice.toFixed(2)}/g  |  **成本价**: ¥${buy_price_cny_g.toFixed(2)}/g`,
          `**浮动盈亏**: ${pnlPct >= 0 ? '+' : ''}${pnlPct.toFixed(2)}% (¥${pnl.toFixed(2)})`,
          stop_loss ? `**止损线**: ¥${stop_loss.toFixed(2)}/g` : '',
          '',
          `## ⚡ 建议`,
          `入场时信号为看多（${entry_signal}），当前信号已反转为 **${currentSignalLevel}**。`,
          `请重新评估持仓逻辑，若原始买入依据已不成立，建议及时止损。`,
          pnlPct > 0 ? `当前仍有浮盈，是离场的好时机。` : `当前轻微浮亏，止损可控。`,
          '',
          `> ${dayjs().format('MM-DD HH:mm')} · Gold Sentinel 持仓顾问`,
        ].filter(Boolean).join('\n')
      );
    }
  }

  // ── 建议4：持仓超时复盘（超48小时）──────────────────────
  if (ageHours >= 48 && !isPositionCoolingDown(id, 'age_review')) {
    await pushAdvice(
      'age_review',
      `⏰ 仓位#${id} 持仓已${Math.floor(ageHours)}小时 — 建议复盘`,
      [
        `## ⏰ 持仓超时提醒 · 仓位#${id}`,
        `**持仓时长**: ${Math.floor(ageHours)}小时（买入于 ${dayjs(buy_ts).format('MM-DD HH:mm')}）`,
        `**成本价**: ¥${buy_price_cny_g.toFixed(2)}/g  |  **当前价**: ¥${currentPrice.toFixed(2)}/g`,
        `**浮动盈亏**: ${pnlPct >= 0 ? '+' : ''}${pnlPct.toFixed(2)}% (¥${pnl.toFixed(2)})`,
        target_profit ? `**目标价**: ¥${target_profit.toFixed(2)}/g` : '',
        stop_loss     ? `**止损价**: ¥${stop_loss.toFixed(2)}/g` : '',
        '',
        `**当前信号**: ${currentSignalLevel}`,
        '',
        `## 💡 提醒`,
        `积存金短线交易建议持仓不超过3天。请回顾当初买入理由是否仍然成立，`,
        `若市场环境已变化，建议果断止盈或止损，避免短线变长线。`,
        '',
        `> ${dayjs().format('MM-DD HH:mm')} · Gold Sentinel 持仓顾问`,
      ].filter(Boolean).join('\n')
    );
  }
}

// ── 主入口 ────────────────────────────────────────────────────
export async function runPositionAdvisor(
  positions: Array<Record<string, unknown>>,
  currentPrice: number
): Promise<void> {
  if (positions.length === 0) return;

  for (const pos of positions) {
    try {
      await adviseSinglePosition(pos as unknown as Position, currentPrice);
    } catch (err) {
      logger.error('[position-advisor] error for position', { id: pos['id'], err });
    }
  }
}
