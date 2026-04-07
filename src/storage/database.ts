/**
 * SQLite 数据库初始化 + Schema 定义 (T-201/T-202)
 * 使用 better-sqlite3 (同步API，性能优秀)
 */
import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import config from '../config';
import logger from '../utils/logger';

let db: Database.Database | null = null;

export function getDB(): Database.Database {
  if (db) return db;

  const dbPath = path.resolve(process.cwd(), config.db.path);
  const dir = path.dirname(dbPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('cache_size = -32000'); // 32MB cache

  initSchema(db);
  logger.info('[db] SQLite initialized', { path: dbPath });
  return db;
}

function initSchema(db: Database.Database): void {
  db.exec(`
    -- ── 分钟级价格时序 ────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS prices (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      ts          INTEGER NOT NULL,
      xau_usd     REAL NOT NULL,
      xau_cny_g   REAL,
      usd_cny     REAL,
      sge_price   REAL,
      sge_premium REAL,
      source      TEXT NOT NULL,
      UNIQUE(ts, source)
    );
    CREATE INDEX IF NOT EXISTS idx_prices_ts ON prices(ts DESC);

    -- ── 日线 OHLCV ────────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS prices_daily (
      date        TEXT PRIMARY KEY,
      open        REAL NOT NULL,
      high        REAL NOT NULL,
      low         REAL NOT NULL,
      close       REAL NOT NULL,
      volume      REAL DEFAULT 0,
      xau_cny_g   REAL,
      usd_cny     REAL
    );

    -- ── 库存快照 ─────────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS inventory (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      date        TEXT NOT NULL,
      exchange    TEXT NOT NULL,      -- COMEX / SHFE / LBMA
      registered  REAL,
      eligible    REAL,
      total       REAL NOT NULL,
      unit        TEXT DEFAULT 'oz',
      change_val  REAL,              -- 日变化量
      UNIQUE(date, exchange)
    );
    CREATE INDEX IF NOT EXISTS idx_inventory_date ON inventory(date DESC, exchange);

    -- ── ETF 持仓 ─────────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS etf_holdings (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      date        TEXT NOT NULL,
      fund        TEXT NOT NULL,
      tonnes      REAL NOT NULL,
      change_val  REAL,
      change_pct  REAL,
      UNIQUE(date, fund)
    );
    CREATE INDEX IF NOT EXISTS idx_etf_date ON etf_holdings(date DESC);

    -- ── CFTC COT 持仓 ────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS cot_report (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      date            TEXT NOT NULL UNIQUE,
      commercial_long  INTEGER,
      commercial_short INTEGER,
      noncomm_long     INTEGER,
      noncomm_short    INTEGER,
      net_long         INTEGER
    );

    -- ── 宏观指标 ─────────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS macro_data (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      date        TEXT NOT NULL,
      indicator   TEXT NOT NULL,
      value       REAL NOT NULL,
      source      TEXT,
      UNIQUE(date, indicator)
    );
    CREATE INDEX IF NOT EXISTS idx_macro_indicator ON macro_data(indicator, date DESC);

    -- ── 新闻条目 ─────────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS news (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      ts            INTEGER NOT NULL,
      source        TEXT NOT NULL,
      title         TEXT NOT NULL,
      summary       TEXT,
      url           TEXT,
      category      TEXT,
      ai_direction  TEXT,
      ai_impact     INTEGER,
      ai_reasoning  TEXT,
      ai_timeframe  TEXT,
      created_at    INTEGER DEFAULT (unixepoch() * 1000)
    );
    CREATE INDEX IF NOT EXISTS idx_news_ts ON news(ts DESC);
    CREATE INDEX IF NOT EXISTS idx_news_category ON news(category, ts DESC);

    -- ── 告警记录 ─────────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS alerts_log (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      ts          INTEGER NOT NULL,
      type        TEXT NOT NULL,
      priority    TEXT NOT NULL,
      title       TEXT NOT NULL,
      message     TEXT NOT NULL,
      data        TEXT,               -- JSON
      sent        INTEGER DEFAULT 0,
      created_at  INTEGER DEFAULT (unixepoch() * 1000)
    );
    CREATE INDEX IF NOT EXISTS idx_alerts_ts ON alerts_log(ts DESC);

    -- ── 央行购金 ─────────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS central_bank (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      date        TEXT NOT NULL,
      country     TEXT NOT NULL,
      tonnes      REAL NOT NULL,
      is_net      INTEGER DEFAULT 1,
      UNIQUE(date, country)
    );

    -- ── 用户想法工坊 ─────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS user_ideas (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      ts              INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
      content         TEXT NOT NULL,        -- 用户原始想法
      market_snapshot TEXT,                 -- JSON: 提交时的市场快照
      ai_analysis     TEXT,                 -- AI 结构化分析（JSON）
      ai_score        INTEGER,              -- AI 置信度 1-10
      ai_direction    TEXT,                 -- bullish / bearish / neutral
      tags            TEXT,                 -- 逗号分隔标签
      status          TEXT DEFAULT 'pending' -- pending / analyzed / archived
    );
    CREATE INDEX IF NOT EXISTS idx_ideas_ts ON user_ideas(ts DESC);

    -- ── 积存金持仓管理（每笔独立追踪）────────────────────────
    CREATE TABLE IF NOT EXISTS open_positions (
      id                INTEGER PRIMARY KEY AUTOINCREMENT,
      buy_ts            INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
      buy_price_cny_g   REAL NOT NULL,
      grams             REAL NOT NULL,
      bank              TEXT DEFAULT '',
      buy_fee           REAL DEFAULT 0,
      note              TEXT DEFAULT '',
      signal_id         INTEGER,
      entry_signal      TEXT,          -- 开仓时的信号（JSON快照）
      stop_loss         REAL,          -- 止损价 CNY/g
      target_profit     REAL,          -- 目标价 CNY/g
      close_ts          INTEGER,
      close_price_cny_g REAL,
      close_fee         REAL DEFAULT 0,
      realized_pnl      REAL,
      holding_hours     REAL,
      status            TEXT DEFAULT 'open',  -- 'open' | 'closed'
      review_content    TEXT           -- AI复盘JSON
    );
    CREATE INDEX IF NOT EXISTS idx_positions_status ON open_positions(status, buy_ts DESC);

    -- ── 积存金交易日志 ────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS trade_log (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      ts            INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
      type          TEXT NOT NULL,        -- 'buy' | 'sell'
      price_cny_g   REAL NOT NULL,        -- 成交价 CNY/克
      grams         REAL NOT NULL,        -- 克数
      bank          TEXT DEFAULT '',      -- 银行/平台（工行/招行/建行等）
      fee           REAL DEFAULT 0,       -- 手续费（CNY）
      note          TEXT DEFAULT '',      -- 备注
      signal_id     INTEGER,              -- 关联的信号ID（可为空）
      status        TEXT DEFAULT 'open'   -- 'open' | 'closed'
    );
    CREATE INDEX IF NOT EXISTS idx_trade_ts ON trade_log(ts DESC);

    -- ── 交易信号记录 ──────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS signals (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      ts            INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
      signal        TEXT NOT NULL,        -- STRONG_BUY / BUY / HOLD / SELL / STRONG_SELL
      confidence    INTEGER NOT NULL,     -- 0-100
      score         INTEGER NOT NULL,     -- -100 to +100
      reasons       TEXT NOT NULL,        -- JSON array of strings
      entry_cny_g   REAL,                 -- 建议进场价（CNY/克）
      stop_loss     REAL,                 -- 止损价（CNY/克）
      target_profit REAL,                 -- 目标价（CNY/克）
      risk_reward   REAL,                 -- 风险收益比
      technicals    TEXT,                 -- JSON: RSI/MACD/BB等
      price_at_signal REAL               -- 信号生成时的价格
    );
    CREATE INDEX IF NOT EXISTS idx_signals_ts ON signals(ts DESC);

    -- ── AI 交互日志（每次 callClaude 均记录）─────────────────
    CREATE TABLE IF NOT EXISTS ai_interaction_log (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      ts            INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
      context_type  TEXT NOT NULL,   -- news_assessment | daily_brief | idea | trade_review | chat | signal | summary
      system_prompt TEXT NOT NULL,
      user_message  TEXT NOT NULL,
      response      TEXT,
      duration_ms   INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_ai_log_ts ON ai_interaction_log(ts DESC);

    -- ── AI 每日总结（凌晨2点生成）────────────────────────────
    CREATE TABLE IF NOT EXISTS ai_daily_summary (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      date        TEXT NOT NULL UNIQUE,  -- YYYY-MM-DD
      summary     TEXT NOT NULL,
      stats       TEXT,                  -- JSON: 各类型交互次数
      created_at  INTEGER DEFAULT (unixepoch() * 1000)
    );

    -- ── AI 问答记录（用户可查阅的干净 Q&A，不含注入上下文）──────
    CREATE TABLE IF NOT EXISTS ai_qa_log (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      ts           INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
      type         TEXT NOT NULL,  -- 'chat' | 'idea' | 'review'
      question     TEXT NOT NULL,  -- 用户原始输入（干净，不含注入数据）
      answer       TEXT NOT NULL,  -- AI 完整回复
      meta         TEXT            -- JSON 附加信息（如 idea 分析摘要、信号等）
    );
    CREATE INDEX IF NOT EXISTS idx_qa_log_ts   ON ai_qa_log(ts DESC);
    CREATE INDEX IF NOT EXISTS idx_qa_log_type ON ai_qa_log(type, ts DESC);

    -- ── 前瞻情报：五角大楼披萨指数历史 ────────────────────────
    CREATE TABLE IF NOT EXISTS intel_pentagon (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      ts           INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
      score        REAL NOT NULL,        -- 0-100 军事活动指数
      article_count INTEGER NOT NULL,   -- GDELT 原始文章数
      alert_level  TEXT NOT NULL,       -- normal/caution/warning/critical
      interpretation TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_intel_pentagon_ts ON intel_pentagon(ts DESC);

    -- ── 前瞻情报：Polymarket 市场快照 ──────────────────────────
    CREATE TABLE IF NOT EXISTS polymarket_markets (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      fetched_at   INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
      market_id    TEXT NOT NULL UNIQUE,  -- UNIQUE：只保留最新快照
      question     TEXT NOT NULL,
      yes_price    REAL NOT NULL,         -- YES 概率 0.0-1.0
      volume24h    REAL DEFAULT 0,
      end_date     TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_polymarket_vol ON polymarket_markets(volume24h DESC);

    -- ── Schema 版本 ───────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS schema_version (
      version     INTEGER PRIMARY KEY,
      applied_at  INTEGER DEFAULT (unixepoch() * 1000)
    );
    INSERT OR IGNORE INTO schema_version(version) VALUES (1);
  `);
}

export function closeDB(): void {
  if (db) {
    db.close();
    db = null;
    logger.info('[db] SQLite closed');
  }
}
