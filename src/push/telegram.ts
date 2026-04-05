/**
 * Telegram Bot 推送 (T-602)
 */
import axios from 'axios';
import config from '../config';
import logger from '../utils/logger';
import type { IAlert } from '../types';

const TELEGRAM_API = `https://api.telegram.org/bot${config.push.telegramToken}`;

async function sendMessage(text: string, chatId?: string): Promise<boolean> {
  const targetChatId = chatId ?? config.push.telegramChatId;
  if (!config.push.telegramToken || !targetChatId) return false;

  try {
    await axios.post(`${TELEGRAM_API}/sendMessage`, {
      chat_id: targetChatId,
      text,
      parse_mode: 'Markdown',
    }, { timeout: 10000 });
    return true;
  } catch (err) {
    logger.error('[telegram] send failed', { err });
    return false;
  }
}

export async function sendTelegramAlert(alert: IAlert): Promise<boolean> {
  const priorityEmoji = { CRITICAL: '🔴', HIGH: '🟠', MEDIUM: '🟡', LOW: '🟢' }[alert.priority] ?? '⚪';
  const text = `${priorityEmoji} *[${alert.priority}] ${alert.type}*\n\n*${alert.title}*\n\n${alert.message}\n\n_${new Date(alert.timestamp).toLocaleString('zh-CN')}_`;
  return sendMessage(text);
}

export async function sendTelegramBrief(content: string): Promise<boolean> {
  // Telegram 单消息最大 4096 字符
  const chunks = content.match(/[\s\S]{1,4000}/g) ?? [];
  for (const chunk of chunks) {
    await sendMessage(chunk);
  }
  return true;
}

/** /price 命令处理 */
export async function handleTelegramCommand(chatId: string, command: string): Promise<void> {
  if (command === '/price') {
    const { getLatestPrice } = await import('../storage/dao');
    const price = getLatestPrice() as Record<string, number> | null;
    if (price) {
      await sendMessage(
        `🥇 *Gold Price*\nXAU/USD: *$${price['xau_usd']?.toFixed(2)}*\nXAU/CNY: *¥${price['xau_cny_g']?.toFixed(2)}/g*\nUSD/CNY: *${price['usd_cny']?.toFixed(4)}*`,
        chatId
      );
    }
  }
}
