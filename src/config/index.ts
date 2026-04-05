import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.join(process.cwd(), '.env') });

const config = {
  app: {
    env: process.env.NODE_ENV || 'development',
    port: parseInt(process.env.PORT || '3000', 10),
    logLevel: process.env.LOG_LEVEL || 'info',
  },
  db: {
    path: process.env.SQLITE_DB_PATH || './data/db/gold-sentinel.db',
  },
  api: {
    metalpriceKey: process.env.METALPRICE_API_KEY || '',
    goldApiKey: process.env.GOLDAPI_KEY || '',
    metalsApiKey: process.env.METALS_API_KEY || '',
    fredKey: process.env.FRED_API_KEY || '',
    newsApiKey: process.env.NEWS_API_KEY || '',
    truthSocialToken: process.env.TRUTH_SOCIAL_BEARER_TOKEN || '',
    exchangeRateKey: process.env.EXCHANGE_RATE_API_KEY || '',
    anthropicKey: process.env.ANTHROPIC_API_KEY || '',
    aiModel: process.env.AI_MODEL || 'claude-haiku-4-5-20251001',
    // 自定义模型端点（优先级高于 Anthropic，兼容 OpenAI Chat Completions 格式）
    aiCustomBaseUrl: process.env.AI_CUSTOM_BASE_URL || '',
    aiCustomApiKey: process.env.AI_CUSTOM_API_KEY || '',
    aiCustomModel: process.env.AI_CUSTOM_MODEL || '',
  },
  push: {
    dingtalkWebhook: process.env.DINGTALK_WEBHOOK || '',
    dingtalkSecret: process.env.DINGTALK_SECRET || '',
    telegramToken: process.env.TELEGRAM_BOT_TOKEN || '',
    telegramChatId: process.env.TELEGRAM_CHAT_ID || '',
    smtpHost: process.env.SMTP_HOST || 'smtp.qq.com',
    smtpPort: parseInt(process.env.SMTP_PORT || '465', 10),
    smtpSecure: process.env.SMTP_SECURE === 'true',
    smtpUser: process.env.SMTP_USER || '',
    smtpPass: process.env.SMTP_PASS || '',
    emailTo: process.env.EMAIL_TO || '',
  },
  alerts: {
    priceThreshold: parseFloat(process.env.PRICE_ALERT_THRESHOLD || '0.5'),
    inventorySigma: parseFloat(process.env.INVENTORY_ALERT_SIGMA || '2'),
    etfTonnes: parseFloat(process.env.ETF_ALERT_TONNES || '5'),
  },
  retention: {
    minuteDataDays: parseInt(process.env.MINUTE_DATA_RETENTION_DAYS || '90', 10),
  },
} as const;

export default config;
