/**
 * 推送管理器 (T-605) — 统一推送入口
 */
import { sendDingTalkAlert, sendDingTalkBrief } from './dingtalk';
import { sendTelegramAlert, sendTelegramBrief } from './telegram';
import { sendEmail } from './email';
import { insertAlert } from '../storage/dao';
import logger from '../utils/logger';
import type { IAlert, AlertPriority, AlertType } from '../types';

export async function pushAlert(
  type: AlertType,
  priority: AlertPriority,
  title: string,
  message: string,
  data?: Record<string, unknown>
): Promise<void> {
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

  const emailHtml = `<div style="font-family:monospace;padding:16px;background:#1a1a2e;color:#e0e0e0;">
    <h2 style="color:#D4AF37;">${alert.title}</h2>
    <p>${alert.message}</p>
    <p style="color:#666;font-size:11px;">${new Date(alert.timestamp).toLocaleString('zh-CN')}</p>
  </div>`;

  const results = await Promise.allSettled([
    sendDingTalkAlert(alert),
    sendTelegramAlert(alert),
    sendEmail(`🥇 ${alert.title}`, emailHtml),
  ]);

  const sent = results.some(r => r.status === 'fulfilled' && r.value === true);
  logger.info('[push] alert dispatched', { title, sent, priority });
}

export async function pushDailyBrief(brief: string): Promise<void> {
  const title = `🥇 Gold Sentinel 日报 — ${new Date().toLocaleDateString('zh-CN')}`;
  await Promise.allSettled([
    sendDingTalkBrief(title, brief),
    sendTelegramBrief(`*${title}*\n\n${brief}`),
  ]);
  logger.info('[push] daily brief dispatched');
}
