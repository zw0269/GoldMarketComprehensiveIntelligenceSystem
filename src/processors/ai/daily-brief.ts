/**
 * AI 市场日报生成器 (T-303)
 * 每日收盘后调用一次，合成当日黄金市场分析报告
 */
import { callClaude } from './claude-client';
import { getDailyOHLCV, getLatestNews, getMacroDashboard, getInventoryHistory, getETFHoldingsHistory } from '../../storage/dao';
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

  const userMessage = `
Today: ${dayjs().format('YYYY-MM-DD')}

## Price Data
Open: $${todayOHLC?.['open'] ?? 'N/A'} | High: $${todayOHLC?.['high'] ?? 'N/A'} | Low: $${todayOHLC?.['low'] ?? 'N/A'} | Close: $${todayOHLC?.['close'] ?? 'N/A'}
XAU/CNY: ¥${todayOHLC?.['xau_cny_g'] ?? 'N/A'}/g | USD/CNY: ${todayOHLC?.['usd_cny'] ?? 'N/A'}

## Macro Dashboard
DXY: ${macroData['DXY'] ?? 'N/A'} | US10Y: ${macroData['US10Y'] ?? 'N/A'}% | TIPS: ${macroData['TIPS10Y'] ?? 'N/A'}%
VIX: ${macroData['VIX'] ?? 'N/A'} | Fed Rate: ${macroData['FEDRATE'] ?? 'N/A'}%
Silver: $${macroData['SILVER'] ?? 'N/A'} | Oil: $${macroData['OIL'] ?? 'N/A'}

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
