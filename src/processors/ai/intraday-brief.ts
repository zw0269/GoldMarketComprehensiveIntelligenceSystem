/**
 * 盘中4小时快报
 *
 * 在北京时间 09:30 / 13:30 / 21:30（覆盖亚盘、午盘、美盘开盘）
 * 自动生成一份简洁的市场快评 + 操作建议，推送到钉钉/邮件
 *
 * 与每日22:00日报的区别：
 *   - 日报是复盘总结
 *   - 盘中快报是"现在该怎么办"的实时指导
 */

import { callClaude } from './claude-client';
import {
  getLatestPrice,
  getMacroDashboard,
  getLatestNews,
  getLatestSignal,
  getLatestCOT,
  getLatestETFHolding,
  getOpenPositions,
} from '../../storage/dao';
import { getPriceHistory } from '../../storage/dao';
import {
  aggregateOHLCV,
  calculateRSI,
  calculateMACD,
  calculateBollingerBands,
} from '../technical/indicators';
import { sendDingTalkBrief } from '../../push/dingtalk';
import { sendSignalEmail } from '../../push/email';
import logger from '../../utils/logger';
import dayjs from 'dayjs';

const INTRADAY_SYSTEM = `你是 Gold Sentinel 的盘中分析师，负责每4小时给用户推送一份简洁的黄金市场快评。

输出必须是以下 JSON 格式（不含任何额外文字）：
{
  "sessionName": "亚盘" | "午盘" | "美盘" | "盘后",
  "marketPulse": "市场脉搏（一句话描述当前行情状态，30字以内）",
  "keyObservation": "最重要的观察（引用具体数据，60字以内）",
  "action": "当前最优操作建议",
  "entry": 建议入场价（CNY/g，仅在建议买入/卖出时填写，否则null）,
  "stopLoss": 止损价（CNY/g，null可）,
  "target": 目标价（CNY/g，null可）,
  "watchFor": "接下来重点关注什么（40字以内）",
  "positionAdvice": "持仓者建议（40字以内，若无持仓可填'暂无持仓建议'）"
}

⚠️ 价格单位：entry/stopLoss/target 必须是人民币/克（CNY/g），2026年市场价格正常在¥900-¥1200之间。`;

function getCurrentSession(): string {
  const hour = dayjs().hour();
  if (hour >= 9  && hour < 12) return '亚盘';
  if (hour >= 13 && hour < 16) return '午盘';
  if (hour >= 21 || hour < 1)  return '美盘';
  return '盘后';
}

export async function generateIntradayBrief(): Promise<void> {
  try {
    const price   = getLatestPrice() as Record<string, number> | null;
    const macro   = getMacroDashboard() as Record<string, number>;
    const news    = getLatestNews(15) as Array<Record<string, unknown>>;
    const signal  = getLatestSignal() as Record<string, unknown> | null;
    const cot     = getLatestCOT() as Record<string, unknown> | null;
    const gld     = getLatestETFHolding('GLD') as Record<string, unknown> | null;
    const positions = getOpenPositions() as Array<Record<string, unknown>>;

    const cnyG   = price?.['xau_cny_g'] ?? 0;
    const usdCny = price?.['usd_cny']   ?? 7.25;
    if (!cnyG) { logger.warn('[intraday-brief] no price data, skipping'); return; }

    // 技术指标
    const from = dayjs().subtract(48, 'hour').valueOf();
    const minuteBars = getPriceHistory(from, Date.now(), 2880) as Array<{ ts: number; xau_usd: number }>;
    const ohlcv  = aggregateOHLCV(minuteBars, 60);
    const closes = ohlcv.map(b => b.close);

    const rsi  = closes.length >= 15 ? calculateRSI(closes, 14) : null;
    const macd = closes.length >= 26 ? calculateMACD(closes)    : null;
    const bb   = closes.length >= 20 ? calculateBollingerBands(closes, 20, 2) : null;

    // 持仓概况
    const positionSummary = positions.length > 0
      ? positions.map(p => {
          const pnlPct = ((cnyG - (p['buy_price_cny_g'] as number)) / (p['buy_price_cny_g'] as number) * 100).toFixed(2);
          return `仓位#${p['id']} 成本¥${(p['buy_price_cny_g'] as number).toFixed(2)}/g 浮${Number(pnlPct) >= 0 ? '+' : ''}${pnlPct}%`;
        }).join('; ')
      : '当前空仓';

    const contextLines = [
      `时间: ${dayjs().format('YYYY-MM-DD HH:mm')} (${getCurrentSession()})`,
      '',
      `## 行情`,
      `XAU/USD: $${price?.['xau_usd']?.toFixed(2) ?? 'N/A'}/oz`,
      `XAU/CNY: ¥${cnyG.toFixed(2)}/g`,
      `SGE溢价: ${price?.['sge_premium'] != null ? `$${(price['sge_premium'] as number).toFixed(2)}/oz` : 'N/A'}`,
      '',
      `## 技术指标（1h）`,
      `RSI(14)=${rsi?.toFixed(1) ?? 'N/A'} ${rsi != null ? (rsi < 30 ? '超卖' : rsi > 70 ? '超买' : '中性') : ''}`,
      macd ? `MACD柱=${macd.histogram.toFixed(3)} ${macd.histogram > 0 ? '多头' : '空头'}` : '',
      bb   ? `布林带: 上¥${bb.upper.toFixed(2)} 中¥${bb.middle.toFixed(2)} 下¥${bb.lower.toFixed(2)}` : '',
      '',
      `## 宏观`,
      `DXY=${macro['DXY']?.toFixed(2) ?? 'N/A'} US10Y=${macro['US10Y']?.toFixed(3) ?? 'N/A'}% VIX=${macro['VIX']?.toFixed(2) ?? 'N/A'}`,
      '',
      signal ? `## 系统信号: ${signal['signal']} (评分${signal['score']})` : '',
      cot    ? `COT净多头: ${cot['net_long']}合约` : '',
      gld    ? `GLD ETF: ${gld['tonnes']}吨` : '',
      '',
      `## 当前持仓`,
      positionSummary,
      '',
      `## 近期重要新闻`,
      ...(news as Array<Record<string, unknown>>)
        .filter(n => (n['ai_impact'] as number) >= 3)
        .slice(0, 4)
        .map(n => `· [${n['ai_impact']}/5] ${n['title']}`),
    ].filter(Boolean).join('\n');

    const response = await callClaude(INTRADAY_SYSTEM, contextLines, 500, 'intraday_brief');

    const jsonMatch = response.match(/\{[\s\S]+\}/);
    if (!jsonMatch) { logger.warn('[intraday-brief] no JSON in response'); return; }

    const result = JSON.parse(jsonMatch[0]) as {
      sessionName: string;
      marketPulse: string;
      keyObservation: string;
      action: string;
      entry: number | null;
      stopLoss: number | null;
      target: number | null;
      watchFor: string;
      positionAdvice: string;
    };

    // 修正价格单位
    const fixPrice = (v: number | null) =>
      v != null && v > Math.max(cnyG * 2, 2000) ? parseFloat(((v * usdCny) / 31.1035).toFixed(2)) : v;
    result.entry    = fixPrice(result.entry);
    result.stopLoss = fixPrice(result.stopLoss);
    result.target   = fixPrice(result.target);

    // 推送钉钉
    const ddContent = [
      `## 📊 ${result.sessionName}快报 · ${dayjs().format('HH:mm')}`,
      '',
      `**市场脉搏**: ${result.marketPulse}`,
      `**关键观察**: ${result.keyObservation}`,
      '',
      `**操作建议**: **${result.action}**`,
      result.entry    ? `└ 入场价: ¥${result.entry}/g` : '',
      result.stopLoss ? `└ 止损价: ¥${result.stopLoss}/g` : '',
      result.target   ? `└ 目标价: ¥${result.target}/g` : '',
      '',
      `**关注重点**: ${result.watchFor}`,
      `**持仓建议**: ${result.positionAdvice}`,
      '',
      `当前价: ¥${cnyG.toFixed(2)}/g  |  信号: ${signal?.['signal'] ?? 'N/A'}`,
      '',
      `> ${dayjs().format('MM-DD HH:mm')} · Gold Sentinel 盘中快报`,
    ].filter(s => s !== '').join('\n');

    await sendDingTalkBrief(
      `📊 ${result.sessionName}快报 · ${result.action}`,
      ddContent
    );

    // 邮件
    await sendSignalEmail({
      signal: 'HOLD',
      label: `📊 ${result.sessionName}快报`,
      price: cnyG,
      entry: result.entry,
      stopLoss: result.stopLoss,
      target: result.target,
      riskReward: null,
      reasons: [result.keyObservation, result.watchFor, result.positionAdvice],
      confidence: 0,
    });

    logger.info('[intraday-brief] pushed', { session: result.sessionName, action: result.action });
  } catch (err) {
    logger.error('[intraday-brief] failed', { err });
  }
}
