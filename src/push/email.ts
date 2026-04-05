/**
 * 邮件推送 (SMTP)
 * 支持 QQ邮箱 / 163 / Gmail 等标准 SMTP
 */
import nodemailer from 'nodemailer';
import config from '../config';
import logger from '../utils/logger';

function getTransporter() {
  if (!config.push.smtpUser || !config.push.smtpPass) return null;
  return nodemailer.createTransport({
    host: config.push.smtpHost,
    port: config.push.smtpPort,
    secure: config.push.smtpPort === 465,
    auth: { user: config.push.smtpUser, pass: config.push.smtpPass },
  });
}

export async function sendEmail(subject: string, htmlBody: string): Promise<boolean> {
  if (!config.push.emailTo || !config.push.smtpUser) return false;
  const transporter = getTransporter();
  if (!transporter) return false;
  try {
    await transporter.sendMail({
      from: `"Gold Sentinel 🥇" <${config.push.smtpUser}>`,
      to: config.push.emailTo,
      subject,
      html: htmlBody,
    });
    logger.info('[email] sent', { subject });
    return true;
  } catch (err) {
    logger.error('[email] send failed', { err });
    return false;
  }
}

/** 交易信号邮件 */
export async function sendSignalEmail(params: {
  signal: string;
  label: string;
  price: number;
  entry: number | null;
  stopLoss: number | null;
  target: number | null;
  riskReward: number | null;
  reasons: string[];
  confidence: number;
}): Promise<boolean> {
  const color = params.signal.includes('BUY') ? '#00C853' : params.signal.includes('SELL') ? '#FF1744' : '#FFD600';
  const html = `
<!DOCTYPE html><html><body style="background:#0d0d1a;color:#e0e0e0;font-family:monospace;padding:24px;">
<div style="max-width:560px;margin:0 auto;background:#1a1a2e;border-radius:12px;overflow:hidden;">
  <div style="background:${color}22;border-top:4px solid ${color};padding:20px 24px;">
    <h1 style="margin:0;font-size:24px;color:${color};">${params.label}</h1>
    <p style="margin:6px 0 0;font-size:14px;color:#aaa;">Gold Sentinel 积存金交易信号 · 置信度 ${params.confidence}%</p>
  </div>
  <div style="padding:20px 24px;">
    <table style="width:100%;border-collapse:collapse;">
      <tr>
        <td style="padding:8px 0;color:#888;font-size:12px;">当前价格</td>
        <td style="color:#D4AF37;font-weight:700;font-size:16px;">¥${params.price.toFixed(2)}/g</td>
      </tr>
      ${params.entry    ? `<tr><td style="padding:8px 0;color:#888;font-size:12px;">建议入场</td><td style="color:#D4AF37;font-weight:700;">¥${params.entry}/g</td></tr>` : ''}
      ${params.stopLoss ? `<tr><td style="padding:8px 0;color:#888;font-size:12px;">止损价位</td><td style="color:#FF1744;font-weight:700;">¥${params.stopLoss}/g</td></tr>` : ''}
      ${params.target   ? `<tr><td style="padding:8px 0;color:#888;font-size:12px;">目标价位</td><td style="color:#00C853;font-weight:700;">¥${params.target}/g</td></tr>` : ''}
      ${params.riskReward ? `<tr><td style="padding:8px 0;color:#888;font-size:12px;">风险收益比</td><td style="color:#D4AF37;font-weight:700;">1:${params.riskReward}</td></tr>` : ''}
    </table>
    <hr style="border:none;border-top:1px solid #2a2a4a;margin:16px 0;">
    <p style="color:#888;font-size:12px;margin:0 0 8px;">信号依据：</p>
    <ul style="margin:0;padding-left:16px;">
      ${params.reasons.map(r => `<li style="color:#ccc;font-size:12px;line-height:1.8;">${r}</li>`).join('')}
    </ul>
  </div>
  <div style="padding:12px 24px;background:#0d0d1a;font-size:10px;color:#555;">
    Gold Sentinel · ${new Date().toLocaleString('zh-CN')}
  </div>
</div>
</body></html>`;

  return sendEmail(`🥇 ${params.label} · ¥${params.price.toFixed(2)}/g`, html);
}

/** 价格异动预警邮件 */
export async function sendPriceSpikeEmail(params: {
  direction: 'up' | 'down';
  windowMin: number;
  changePct: number;
  changeAmt: number;
  priceBefore: number;
  priceNow: number;
  level: 'MEDIUM' | 'HIGH' | 'CRITICAL';
}): Promise<boolean> {
  const isUp    = params.direction === 'up';
  const color   = isUp ? '#00C853' : '#FF1744';
  const arrow   = isUp ? '▲' : '▼';
  const emoji   = isUp ? '🚀' : '💥';
  const levelColor = { MEDIUM: '#FFD600', HIGH: '#FF8800', CRITICAL: '#FF1744' }[params.level];
  const levelLabel = { MEDIUM: '中级预警', HIGH: '高级预警', CRITICAL: '紧急预警' }[params.level];

  const html = `
<!DOCTYPE html><html><body style="background:#0d0d1a;color:#e0e0e0;font-family:monospace;padding:24px;">
<div style="max-width:560px;margin:0 auto;background:#1a1a2e;border-radius:12px;overflow:hidden;">
  <div style="background:${color}22;border-top:4px solid ${levelColor};padding:20px 24px;">
    <h1 style="margin:0;font-size:22px;color:${color};">${emoji} 黄金价格${isUp ? '急涨' : '急跌'}预警</h1>
    <p style="margin:6px 0 0;color:#aaa;font-size:13px;">
      <span style="background:${levelColor}22;color:${levelColor};border:1px solid ${levelColor};border-radius:4px;padding:2px 8px;font-size:11px;">${levelLabel}</span>
      &nbsp;${params.windowMin} 分钟内涨跌幅触发阈值
    </p>
  </div>
  <div style="padding:20px 24px;">
    <div style="text-align:center;padding:16px 0;">
      <span style="font-size:36px;font-weight:900;color:${color};">
        ${arrow} ${Math.abs(params.changePct).toFixed(2)}%
      </span>
      <div style="color:#888;font-size:12px;margin-top:4px;">
        ${params.windowMin} 分钟内变动 ${arrow}¥${Math.abs(params.changeAmt).toFixed(2)}/g
      </div>
    </div>
    <table style="width:100%;border-collapse:collapse;">
      <tr>
        <td style="padding:8px 0;color:#888;font-size:12px;">${params.windowMin}分钟前价格</td>
        <td style="color:#e0e0e0;font-weight:700;">¥${params.priceBefore.toFixed(2)}/g</td>
      </tr>
      <tr>
        <td style="padding:8px 0;color:#888;font-size:12px;">当前价格</td>
        <td style="color:${color};font-weight:700;font-size:18px;">¥${params.priceNow.toFixed(2)}/g</td>
      </tr>
    </table>
    <hr style="border:none;border-top:1px solid #2a2a4a;margin:16px 0;">
    <div style="background:${color}11;border:1px solid ${color}44;border-radius:6px;padding:12px;">
      <p style="margin:0;color:#ccc;font-size:12px;line-height:1.7;">
        ${isUp
          ? '⚠️ 价格快速拉升，注意追高风险。若无重大利好消息支撑，短线可能出现技术性回调，谨慎追涨。'
          : '⚠️ 价格快速下跌，注意恐慌性抛售风险。若持有多头仓位，请及时检查止损线；若空仓，可关注是否存在超跌反弹机会。'}
      </p>
    </div>
  </div>
  <div style="padding:12px 24px;background:#0d0d1a;font-size:10px;color:#555;">
    Gold Sentinel · ${new Date().toLocaleString('zh-CN')}
  </div>
</div>
</body></html>`;

  const subject = `${emoji} 黄金${isUp ? '急涨' : '急跌'} ${arrow}${Math.abs(params.changePct).toFixed(2)}% · ${params.windowMin}min · ¥${params.priceNow.toFixed(2)}/g`;
  return sendEmail(subject, html);
}

/** 持仓亏损预警邮件 */
export async function sendLossWarningEmail(params: {
  posId: number;
  buyPrice: number;
  currentPrice: number;
  grams: number;
  pnl: number;
  pnlPct: number;
  stopLoss: number | null;
  hintStrategy: string;
}): Promise<boolean> {
  const html = `
<!DOCTYPE html><html><body style="background:#0d0d1a;color:#e0e0e0;font-family:monospace;padding:24px;">
<div style="max-width:560px;margin:0 auto;background:#1a1a2e;border-radius:12px;overflow:hidden;">
  <div style="background:#FF174422;border-top:4px solid #FF1744;padding:20px 24px;">
    <h1 style="margin:0;font-size:22px;color:#FF1744;">⚠️ 持仓亏损预警</h1>
    <p style="margin:6px 0 0;color:#aaa;font-size:13px;">你有一笔积存金持仓正在亏损</p>
  </div>
  <div style="padding:20px 24px;">
    <table style="width:100%;border-collapse:collapse;">
      <tr><td style="padding:8px 0;color:#888;font-size:12px;">买入成本</td><td style="color:#e0e0e0;font-weight:700;">¥${params.buyPrice.toFixed(2)}/g</td></tr>
      <tr><td style="padding:8px 0;color:#888;font-size:12px;">当前价格</td><td style="color:#e0e0e0;font-weight:700;">¥${params.currentPrice.toFixed(2)}/g</td></tr>
      <tr><td style="padding:8px 0;color:#888;font-size:12px;">持有数量</td><td style="color:#e0e0e0;">${params.grams.toFixed(3)}g</td></tr>
      <tr><td style="padding:8px 0;color:#888;font-size:12px;">浮动亏损</td><td style="color:#FF1744;font-weight:700;font-size:18px;">${params.pnl.toFixed(2)}元 (${params.pnlPct.toFixed(2)}%)</td></tr>
      ${params.stopLoss ? `<tr><td style="padding:8px 0;color:#888;font-size:12px;">设定止损</td><td style="color:#FF1744;">¥${params.stopLoss.toFixed(2)}/g ${params.currentPrice <= params.stopLoss ? '【已触及！】' : ''}</td></tr>` : ''}
    </table>
    <hr style="border:none;border-top:1px solid #2a2a4a;margin:16px 0;">
    <div style="background:#FF174411;border:1px solid #FF174444;border-radius:6px;padding:12px;">
      <p style="margin:0 0 6px;color:#FF9999;font-size:12px;font-weight:700;">💡 AI 策略建议</p>
      <p style="margin:0;color:#ccc;font-size:12px;line-height:1.6;">${params.hintStrategy}</p>
    </div>
  </div>
  <div style="padding:12px 24px;background:#0d0d1a;font-size:10px;color:#555;">
    Gold Sentinel · ${new Date().toLocaleString('zh-CN')}
  </div>
</div>
</body></html>`;

  return sendEmail(`⚠️ 持仓亏损 ${params.pnlPct.toFixed(2)}% · ¥${params.currentPrice.toFixed(2)}/g`, html);
}
