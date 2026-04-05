/**
 * 告警引擎 (T-221 ~ T-226)
 * 价格/库存/ETF/新闻 多维告警，含去重冷却机制
 */
import logger from '../../utils/logger';
import { insertAlert } from '../../storage/dao';
import type { IAlert, AlertPriority, AlertType } from '../../types';
import config from '../../config';

// 告警冷却记录（同一规则15分钟内不重复）
const cooldownMap = new Map<string, number>();
const COOLDOWN_MS = 15 * 60 * 1000;

function isCooledDown(ruleKey: string): boolean {
  const last = cooldownMap.get(ruleKey);
  if (!last) return false;
  return Date.now() - last < COOLDOWN_MS;
}

function triggerAlert(
  type: AlertType,
  priority: AlertPriority,
  title: string,
  message: string,
  data?: Record<string, unknown>,
  ruleKey?: string
): IAlert | null {
  const key = ruleKey ?? `${type}:${title}`;
  if (isCooledDown(key)) {
    logger.debug(`[alert] cooled down, skipping: ${key}`);
    return null;
  }

  const alert: IAlert = {
    timestamp: Date.now(),
    type,
    priority,
    title,
    message,
    data,
    sent: false,
  };

  insertAlert(alert);
  cooldownMap.set(key, Date.now());
  logger.warn(`[alert] ${priority} ${type}: ${title}`, { message });
  return alert;
}

// T-221: 价格告警
export function checkPriceAlert(
  currentPrice: number,
  prevPrice: number | null,
  breakoutLevels: number[] = []
): IAlert | null {
  if (!prevPrice) return null;

  const changePct = Math.abs((currentPrice - prevPrice) / prevPrice) * 100;

  // 1分钟内波动超过阈值
  if (changePct >= config.alerts.priceThreshold) {
    const direction = currentPrice > prevPrice ? '↑' : '↓';
    return triggerAlert(
      'PRICE',
      changePct >= 1.0 ? 'CRITICAL' : changePct >= 0.5 ? 'HIGH' : 'MEDIUM',
      `Gold Price Alert ${direction} ${changePct.toFixed(2)}%`,
      `XAU/USD: ${prevPrice.toFixed(2)} → ${currentPrice.toFixed(2)} (${direction}${changePct.toFixed(2)}%)`,
      { currentPrice, prevPrice, changePct },
      'PRICE:SPIKE'
    );
  }

  // 突破关键价位
  for (const level of breakoutLevels) {
    const crossed = (prevPrice < level && currentPrice >= level) ||
                    (prevPrice > level && currentPrice <= level);
    if (crossed) {
      return triggerAlert(
        'PRICE',
        'HIGH',
        `Price Breakout: $${level}`,
        `XAU/USD broke through key level $${level}. Current: $${currentPrice.toFixed(2)}`,
        { currentPrice, level },
        `PRICE:BREAKOUT:${level}`
      );
    }
  }

  return null;
}

// T-222: 库存告警 (日变化 > N σ)
export function checkInventoryAlert(
  exchange: string,
  currentTotal: number,
  changeVal: number,
  historicalChanges: number[]
): IAlert | null {
  if (historicalChanges.length < 10) return null;

  const mean = historicalChanges.reduce((a, b) => a + b, 0) / historicalChanges.length;
  const std = Math.sqrt(
    historicalChanges.reduce((a, b) => a + (b - mean) ** 2, 0) / historicalChanges.length
  );

  if (std === 0) return null;
  const sigma = Math.abs(changeVal - mean) / std;

  if (sigma >= config.alerts.inventorySigma) {
    const direction = changeVal >= 0 ? 'increased' : 'decreased';
    return triggerAlert(
      'INVENTORY',
      sigma >= 3 ? 'CRITICAL' : 'HIGH',
      `${exchange} Inventory Alert: ${direction} by ${Math.abs(changeVal).toLocaleString()} oz`,
      `${exchange} gold inventory ${direction} by ${Math.abs(changeVal).toLocaleString()} oz (${sigma.toFixed(1)}σ). Total: ${currentTotal.toLocaleString()} oz`,
      { exchange, currentTotal, changeVal, sigma },
      `INVENTORY:${exchange}`
    );
  }

  return null;
}

// T-223: ETF 告警
export function checkETFAlert(
  fund: string,
  currentTonnes: number,
  changeVal: number
): IAlert | null {
  if (Math.abs(changeVal) < config.alerts.etfTonnes) return null;

  const direction = changeVal >= 0 ? 'inflow' : 'outflow';
  return triggerAlert(
    'ETF',
    Math.abs(changeVal) >= config.alerts.etfTonnes * 2 ? 'HIGH' : 'MEDIUM',
    `${fund} ETF ${direction}: ${Math.abs(changeVal).toFixed(1)}t`,
    `${fund} gold holdings changed by ${changeVal > 0 ? '+' : ''}${changeVal.toFixed(1)}t. Total: ${currentTonnes.toFixed(1)}t`,
    { fund, currentTonnes, changeVal },
    `ETF:${fund}`
  );
}

// T-224: 新闻告警 (AI impact >= 4)
export function checkNewsAlert(
  newsId: number,
  title: string,
  direction: string,
  impact: number,
  reasoning: string
): IAlert | null {
  if (impact < 4) return null;

  const emoji = direction === 'bullish' ? '🟢' : direction === 'bearish' ? '🔴' : '🟡';
  return triggerAlert(
    'NEWS',
    impact === 5 ? 'CRITICAL' : 'HIGH',
    `${emoji} [${impact}/5] ${direction.toUpperCase()}: ${title.slice(0, 80)}`,
    `AI Assessment: ${reasoning.slice(0, 200)}`,
    { newsId, direction, impact },
    `NEWS:${newsId}`
  );
}

export function getActiveCooldowns(): string[] {
  const now = Date.now();
  return Array.from(cooldownMap.entries())
    .filter(([, ts]) => now - ts < COOLDOWN_MS)
    .map(([key]) => key);
}
