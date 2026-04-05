/**
 * 钉钉群机器人推送 (T-601)
 * 支持 Markdown 格式告警卡片
 */
import axios from 'axios';
import crypto from 'crypto';
import config from '../config';
import logger from '../utils/logger';
import type { IAlert } from '../types';

function sign(): { timestamp: string; sign: string } {
  const timestamp = String(Date.now());
  const secret = config.push.dingtalkSecret;
  if (!secret) return { timestamp, sign: '' };
  const stringToSign = `${timestamp}\n${secret}`;
  const sign = crypto
    .createHmac('sha256', secret)
    .update(stringToSign)
    .digest('base64');
  return { timestamp, sign: encodeURIComponent(sign) };
}

export async function sendDingTalkAlert(alert: IAlert): Promise<boolean> {
  if (!config.push.dingtalkWebhook) return false;

  const priorityEmoji = {
    CRITICAL: '🔴',
    HIGH: '🟠',
    MEDIUM: '🟡',
    LOW: '🟢',
  }[alert.priority] ?? '⚪';

  const { timestamp, sign: sig } = sign();
  const url = sig
    ? `${config.push.dingtalkWebhook}&timestamp=${timestamp}&sign=${sig}`
    : config.push.dingtalkWebhook;

  const body = {
    msgtype: 'markdown',
    markdown: {
      title: `${priorityEmoji} Gold Sentinel: ${alert.title}`,
      text: [
        `## ${priorityEmoji} ${alert.priority} | ${alert.type}`,
        `**${alert.title}**`,
        '',
        alert.message,
        '',
        `> 时间: ${new Date(alert.timestamp).toLocaleString('zh-CN')}`,
      ].join('\n'),
    },
  };

  try {
    await axios.post(url, body, { timeout: 10000 });
    logger.info('[dingtalk] alert sent', { title: alert.title });
    return true;
  } catch (err) {
    logger.error('[dingtalk] send failed', { err });
    return false;
  }
}

export async function sendDingTalkBrief(title: string, content: string): Promise<boolean> {
  if (!config.push.dingtalkWebhook) return false;
  const { timestamp, sign: sig } = sign();
  const url = sig
    ? `${config.push.dingtalkWebhook}&timestamp=${timestamp}&sign=${sig}`
    : config.push.dingtalkWebhook;

  try {
    await axios.post(url, {
      msgtype: 'markdown',
      markdown: { title, text: content.slice(0, 4096) },
    }, { timeout: 10000 });
    return true;
  } catch (err) {
    logger.error('[dingtalk] brief send failed', { err });
    return false;
  }
}
