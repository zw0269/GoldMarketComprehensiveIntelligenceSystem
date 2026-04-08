/**
 * AI 市场日报生成器 (T-303)
 * 每日收盘后调用一次，合成当日黄金市场分析报告
 */
import { callClaude } from './claude-client';
import { getDailyOHLCV, getLatestNews, getMacroDashboard, getInventoryHistory, getETFHoldingsHistory, getLatestSignal } from '../../storage/dao';
import { calculateRSI, calculateMACD, calculateBollingerBands } from '../technical/indicators';
import logger from '../../utils/logger';
import dayjs from 'dayjs';

const DAILY_BRIEF_SYSTEM = `You are Gold Sentinel, an elite gold market intelligence analyst.
Generate a comprehensive daily gold market brief in Chinese (Simplified).
Structure your response with these exact sections using markdown:

## 📊 价格回顾
## 🔥 关键驱动因素
## 📈 技术面分析
## 💰 资金面分析
## 📅 明日关注
## ⚠️ 风险提示

IMPORTANT: Use ONLY the technical indicator values provided in the context. Do NOT invent or estimate indicator values. If a value shows "N/A", state that data is insufficient.
Be concise, data-driven, and actionable. Focus on what matters for gold investors.`;

export async function generateDailyBrief(): Promise<string> {
  logger.info('[daily-brief] generating...');

  // 收集当日数据
  const ohlcv = getDailyOHLCV(30);
  const todayOHLC = ohlcv[0] as Record<string, number | string> | undefined;

  const macroData = getMacroDashboard();
  const topNews = getLatestNews(20)
    .filter((n) => (n['ai_impact'] as number) >= 3)
    .slice(0, 10)
    .map((n) => `- [${n['ai_impact']}/5 ${n['ai_direction']}] ${n['title']}`)
    .join('\n');

  const comexInv = getInventoryHistory('COMEX', 2);
  const gldHoldings = getETFHoldingsHistory('GLD', 2);

  // 技术指标：基于日线收盘价序列（时间正序）
  const dailyCloses = (ohlcv as Array<Record<string, unknown>>)
    .map(d => d['close'] as number)
    .filter(v => v && !isNaN(v))
    .reverse(); // getDailyOHLCV 返回最新在前，需反转为时间正序

  const rsi   = dailyCloses.length >= 15 ? calculateRSI(dailyCloses, 14) : null;
  const macd  = dailyCloses.length >= 26 ? calculateMACD(dailyCloses)    : null;
  const bb    = dailyCloses.length >= 20 ? calculateBollingerBands(dailyCloses, 20, 2) : null;

  const latestClose  = dailyCloses[dailyCloses.length - 1] ?? null;
  const prevClose    = dailyCloses[dailyCloses.length - 2] ?? null;
  const dailyChange  = latestClose && prevClose ? ((latestClose - prevClose) / prevClose * 100).toFixed(2) : null;

  // MACD 状态描述
  let macdStatus = 'N/A';
  if (macd) {
    if (macd.prevHistogram !== null && macd.prevHistogram < 0 && macd.histogram > 0) macdStatus = '金叉（看多）';
    else if (macd.prevHistogram !== null && macd.prevHistogram > 0 && macd.histogram < 0) macdStatus = '死叉（看空）';
    else macdStatus = macd.histogram > 0 ? `多头趋势 柱线${macd.histogram.toFixed(3)}` : `空头趋势 柱线${macd.histogram.toFixed(3)}`;
  }

  // 布林带位置
  let bbStatus = 'N/A';
  if (bb && latestClose) {
    const pos = (latestClose - bb.lower) / (bb.upper - bb.lower);
    if (pos < 0.2)      bbStatus = `触及下轨 (下${bb.lower.toFixed(2)} 中${bb.middle.toFixed(2)} 上${bb.upper.toFixed(2)})`;
    else if (pos > 0.8) bbStatus = `触及上轨 (下${bb.lower.toFixed(2)} 中${bb.middle.toFixed(2)} 上${bb.upper.toFixed(2)})`;
    else                bbStatus = `布林中段 (下${bb.lower.toFixed(2)} 中${bb.middle.toFixed(2)} 上${bb.upper.toFixed(2)})`;
  }

  // 系统交易信号
  const latestSignal = getLatestSignal() as Record<string, unknown> | null;
  const signalSummary = latestSignal
    ? `${latestSignal['signal']} (评分${latestSignal['score']}, 置信度${latestSignal['confidence']}%)`
    : 'N/A';

  const userMessage = `
Today: ${dayjs().format('YYYY-MM-DD')}

## Price Data
Open: $${todayOHLC?.['open'] ?? 'N/A'} | High: $${todayOHLC?.['high'] ?? 'N/A'} | Low: $${todayOHLC?.['low'] ?? 'N/A'} | Close: $${todayOHLC?.['close'] ?? 'N/A'}
XAU/CNY: ¥${todayOHLC?.['xau_cny_g'] ?? 'N/A'}/g | USD/CNY: ${todayOHLC?.['usd_cny'] ?? 'N/A'}
Daily Change: ${dailyChange !== null ? `${Number(dailyChange) >= 0 ? '+' : ''}${dailyChange}%` : 'N/A'}

## Macro Dashboard
DXY: ${macroData['DXY'] ?? 'N/A'} | US10Y: ${macroData['US10Y'] ?? 'N/A'}% | TIPS: ${macroData['TIPS10Y'] ?? 'N/A'}%
VIX: ${macroData['VIX'] ?? 'N/A'} | Fed Rate: ${macroData['FEDRATE'] ?? 'N/A'}%
Silver: $${macroData['SILVER'] ?? 'N/A'} | Oil: $${macroData['OIL'] ?? 'N/A'}

## Technical Indicators (Daily)
RSI(14): ${rsi !== null ? rsi.toFixed(1) : 'N/A'} ${rsi !== null ? (rsi < 30 ? '【超卖】' : rsi > 70 ? '【超买】' : '【中性】') : ''}
MACD(12,26,9): ${macdStatus}
Bollinger Bands(20,2σ): ${bbStatus}
System Signal: ${signalSummary}

## COMEX Inventory
${comexInv.length > 0 ? `Total: ${Number(comexInv[0]?.['total']).toLocaleString()} oz | Change: ${comexInv[0]?.['change_val'] ?? 0}` : 'No data'}

## ETF Holdings (GLD)
${gldHoldings.length > 0 ? `${gldHoldings[0]?.['tonnes']}t | Change: ${gldHoldings[0]?.['change_val'] ?? 0}t` : 'No data'}

## Key News (Impact >= 3)
${topNews || 'No significant news today'}

Generate the daily gold market brief.`.trim();

  const brief = await callClaude(DAILY_BRIEF_SYSTEM, userMessage, 2048, 'daily_brief');
  logger.info('[daily-brief] generated successfully');
  return brief;
}
