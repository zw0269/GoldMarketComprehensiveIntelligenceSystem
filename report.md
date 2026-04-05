# Gold Sentinel — 系统全景报告

> 生成日期：2026-04-05  
> 项目名：黄金市场全景情报系统（积存金短线交易辅助）  
> 版本：v0.1.0  
> 技术栈：Node.js · TypeScript · SQLite (better-sqlite3) · Express · WebSocket · Vue 3 · ECharts · Claude API

---

## 一、系统定位

Gold Sentinel 是一套面向**积存金（中国上金所 Au99.99）短线交易者**的自动化情报与决策辅助系统。  
核心价值主张：**7×24 小时全自动数据采集 → 规则型信号生成 → AI 深度解读 → 多渠道实时推送 → 持仓闭环复盘**。

---

## 二、整体架构

```
src/
├── index.ts                 ← 启动入口：初始化 DB → 启动 API → 启动调度器
├── config/index.ts          ← 全局配置（.env 注入）
├── types/index.ts           ← 核心 TypeScript 接口定义
│
├── collectors/              ← 数据采集层（各类外部数据源）
│   ├── price/               ← 国际金价、汇率、历史行情
│   ├── inventory/           ← COMEX / SHFE / LBMA 库存
│   ├── fund-flow/           ← ETF 持仓、CFTC COT 报告
│   ├── macro/               ← FRED 宏观 + Yahoo Finance
│   └── news/                ← RSS、NewsAPI、特朗普相关新闻、美联储日历
│
├── processors/              ← 数据处理层
│   ├── technical/           ← 技术指标计算引擎
│   ├── ai/                  ← AI 调用模块（Claude / 自定义端点）
│   └── alert/               ← 告警规则引擎
│
├── storage/                 ← 持久化层（SQLite）
│   ├── database.ts          ← Schema 初始化
│   └── dao.ts               ← 统一 CRUD 入口
│
├── scheduler/scheduler.ts   ← 定时任务管理（node-cron）
├── api/server.ts            ← REST API + WebSocket 实时推送
└── push/                    ← 消息推送（钉钉 / Telegram / 邮件）
```

---

## 三、数据采集层（Collectors）

### 3.1 价格数据

| 采集器 | 数据源 | 说明 |
|--------|--------|------|
| `metalprice.collector` | MetalpriceAPI | 国际 XAU/USD 现货价，权重 1.0 |
| `goldapi.collector` | GoldAPI | 国际 XAU/USD 现货价，权重 0.9 |
| `goldpricez.collector` | 抓取 goldpricez.com | 备用价格源，权重 0.7 |
| `sge.collector` | 上海黄金交易所 | Au99.99 人民币价格（SGE 溢价来源）|
| `exchange-rate.collector` | ExchangeRate-API | USD/CNY 实时汇率 |
| `comex-futures.collector` | Yahoo Finance | COMEX GC 期货价格 |
| `historical.collector` | Yahoo Finance | 历史日线 OHLCV（最长 max 全量）|

**聚合策略（`price-aggregator.ts`）：**

1. 并发采集所有价格源（`Promise.allSettled`）
2. 对有效价格按 source 权重做**加权中位数**去噪
3. 兜底汇率 7.25（无汇率 API 时）
4. 计算 SGE 溢价：`sgePremiumUsd = (sgeCnyG - intlCnyG) / usdCny × 31.1035`

### 3.2 库存数据

| 采集器 | 交易所 | 单位 |
|--------|--------|------|
| `comex-inventory.collector` | COMEX | oz（Registered + Eligible）|
| `shfe-inventory.collector` | SHFE（上期所）| kg |
| `lbma-inventory.collector` | LBMA | t |

### 3.3 资金流向

- **`etf-holdings.collector`**：GLD / IAU / 华安黄金 (HUAAN) / 易方达黄金 (EFUND) ETF 持仓吨位及变动
- **`cftc-cot.collector`**：CFTC COT 报告 — 非商业净多头（大型机构持仓方向）

### 3.4 宏观指标

| 采集器 | 指标 |
|--------|------|
| `fred.collector` | DXY（美元指数）、US10Y、TIPS10Y、联邦基金利率（FEDRATE）|
| `yahoo-macro.collector` | VIX、白银 XAG、WTI 原油、上海 AU9999 |

### 3.5 新闻情报

| 采集器 | 说明 |
|--------|------|
| `rss.collector` | 多 RSS 源（路透社/彭博/金融时报等）|
| `newsapi.collector` | NewsAPI 黄金相关新闻 + 特朗普专项 |
| `fed-calendar.collector` | 美联储议息会议日历、经济数据发布日期 |

---

## 四、存储层（SQLite）

数据库路径：`./data/db/gold-sentinel.db`（WAL 模式，32MB 缓存）

| 表名 | 用途 |
|------|------|
| `prices` | 分钟级价格时序（UNIQUE: ts+source）|
| `prices_daily` | 日线 OHLCV（含 CNY/g 和 USD/CNY）|
| `inventory` | 三大交易所库存快照（UNIQUE: date+exchange）|
| `etf_holdings` | ETF 持仓日数据（UNIQUE: date+fund）|
| `cot_report` | CFTC COT 持仓周报（UNIQUE: date）|
| `macro_data` | 宏观指标时序（UNIQUE: date+indicator）|
| `news` | 新闻条目（含 AI 评估结果）|
| `alerts_log` | 告警记录（含是否已推送标志）|
| `central_bank` | 央行购金记录 |
| `user_ideas` | 用户想法工坊（含 AI 分析 JSON）|
| `open_positions` | 积存金持仓（开/平仓全生命周期）|
| `trade_log` | 积存金交易日志 |
| `signals` | 信号引擎历史记录 |
| `schema_version` | Schema 版本管理 |

**数据清理策略**：每日 03:00 清理超过 `MINUTE_DATA_RETENTION_DAYS`（默认 90 天）的分钟级价格数据。

---

## 五、定时任务调度器

| 频率 | 任务内容 |
|------|----------|
| **每 1 分钟** | 聚合价格 → 写 DB → WebSocket 广播 |
| **每 5 分钟** | Yahoo 宏观更新（VIX/银/油）+ **持仓止损监控**（亏损>3% 或触及止损价则推送预警）|
| **每 15 分钟** | FRED 宏观 + COMEX 期货更新 |
| **每 30 分钟** | 信号引擎生成信号 → 若 BUY/SELL 且距上次推送>2h → 钉钉+邮件推送 |
| **每 1 小时** | RSS + NewsAPI + 特朗普新闻采集 → AI 评估 |
| **每日 06:00** | COMEX / SHFE 库存 + ETF 持仓 |
| **每日 22:00** | AI 市场日报生成 → 推送 |
| **每日 03:00** | 历史分钟数据清理 |
| **每周六 10:00** | CFTC COT 持仓报告 |

---

## 六、技术指标计算引擎

文件：`src/processors/technical/indicators.ts`

| 函数 | 指标 | 参数 |
|------|------|------|
| `aggregateOHLCV` | K 线聚合（1m/5m/15m/1h/4h/1d/1w）| 分钟 bars → 任意周期 |
| `calculateMovingAverages` | SMA / EMA | 周期：5/10/20/60/120/250 |
| `calculateMACD` | MACD | 快 12 / 慢 26 / 信号 9 |
| `calculateRSI` | RSI | 默认周期 14 |
| `calculateBollingerBands` | 布林带 | 周期 20，2σ |
| `calculateKDJ` | KDJ 随机指标 | 周期 9，信号 3 |
| `findSupportResistanceLevels` | 支撑/阻力自动识别 | 局部极值法，tolerance 0.5%，保留最近 5 个 |
| `calculateFibonacciLevels` | 斐波那契回撤 | 0%/23.6%/38.2%/50%/61.8%/78.6%/100%/127.2%/161.8% |

---

## 七、交易信号引擎

文件：`src/processors/ai/signal-engine.ts`

**信号级别**（5 级）：`STRONG_BUY / BUY / HOLD / SELL / STRONG_SELL`

**评分体系（-100 ~ +100）：**

| 指标 | 最大权重 | 规则 |
|------|----------|------|
| RSI(14) | ±30 | <25 超卖 +30；>75 超买 -30 |
| MACD 柱线 | ±15 | 柱>0 多头 +15；柱<0 空头 -15 |
| 布林带位置 | ±15 | 近下轨 +15；近上轨 -15 |
| SGE 溢价 | ±15 | 溢价>$10 +15；折价<-$5 -10 |
| 新闻情绪（impact≥3）| ±15 | 平均情绪分>2 加分；<-2 减分 |
| 支撑/阻力位 | ±10 | 临近支撑 +10；临近阻力 -10 |

**信号阈值**：score≥50 → STRONG_BUY；20~49 → BUY；-19~19 → HOLD；-49~-20 → SELL；≤-50 → STRONG_SELL

**附加输出**：建议入场价 / 止损价 / 目标价 / 风险收益比（均以 CNY/g 为单位）  
**推送节流**：同一信号等级 2 小时内不重复推送

---

## 八、AI 处理层

### 8.1 AI 客户端（`claude-client.ts`）

双端点优先级：
1. **自定义端点**（`AI_CUSTOM_BASE_URL` + `AI_CUSTOM_MODEL`）— 兼容 OpenAI Chat Completions 格式，支持 Ollama/LM Studio/vLLM
2. **Anthropic Claude API**（`ANTHROPIC_API_KEY`，默认 `claude-haiku-4-5-20251001`）

内置：全局限速（2s 最小间隔）+ 自动重试（最多 3 次，5s 基础延迟，401/403 不重试）

### 8.2 新闻评估（`news-assessor.ts`）

- **关键词预过滤**：检查标题+摘要是否含黄金/美联储/利率等 20+ 关键词，无关新闻直接标记 neutral/1 跳过
- **AI 评估输出**：`direction(bullish/bearish/neutral)` + `impact(1-5)` + `reasoning` + `timeframe`
- **批量处理**：每小时对待评估新闻逐条评估，结果写回 `news` 表

### 8.3 每日市场日报（`daily-brief.ts`）

每日 22:00 触发，聚合：当日 OHLCV + 宏观仪表盘 + 高影响新闻（impact≥3）+ COMEX 库存 + GLD 持仓  
输出 6 大板块 Markdown：价格回顾 / 关键驱动因素 / 技术面分析 / 资金面分析 / 明日关注 / 风险提示

### 8.4 用户想法工坊（`idea-analyzer.ts`）

用户提交文字想法 → AI 结合 9 维实时数据（价格/技术/宏观/新闻/信号/COT/库存/ETF/历史想法）→ 输出结构化 JSON：
`direction` / `score(1-10)` / `action`（8 种操作建议）/ `summary` / `supporting(3-5条)` / `risks` / `keyLevels` / `entry` / `stopLoss` / `target` / `riskReward` / `timeframe` / `tags` / `evolution`

### 8.5 交易复盘（`trade-reviewer.ts`）

平仓时异步触发，分析：信号准确性 / 做对的点 / 做错的点 / 关键教训 / 下次规则 / 优化建议 / 执行评分（1-5）  
教训自动追加写入 `STRATEGY_MEMO.md`（策略备忘录，持续积累）

---

## 九、REST API 端点总览

服务端口：`PORT`（默认 3000）

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/health` | 健康检查 |
| GET | `/api/price/latest` | 最新价格 |
| GET | `/api/price/history` | 历史价格（支持 tf/days 参数）|
| GET | `/api/price/historical` | 长期历史行情（1mo/3mo/1y/5y/max）|
| GET | `/api/inventory/comex` | COMEX 库存 90 天 |
| GET | `/api/inventory/shfe` | SHFE 库存 90 天 |
| GET | `/api/inventory/compare` | 三大交易所对比（30 天）|
| GET | `/api/etf/holdings` | GLD/IAU/HUAAN ETF 持仓 90 天 |
| GET | `/api/macro/dashboard` | 宏观仪表盘快照 |
| GET | `/api/news/latest` | 最新新闻（limit 参数）|
| GET | `/api/news/trump` | 特朗普相关新闻 |
| GET | `/api/technical/:timeframe` | 技术分析 K 线数据 |
| GET | `/api/ratio/gold-silver` | 金银比 |
| GET | `/api/premium/sge` | SGE 溢价 |
| GET | `/api/alerts/history` | 告警历史 |
| GET | `/api/signals/latest` | 实时生成最新信号 |
| GET | `/api/signals/history` | 信号历史记录 |
| POST | `/api/positions` | 开仓（买入）|
| GET | `/api/positions` | 查询所有开仓持仓 |
| POST | `/api/positions/:id/close` | 平仓 + 触发 AI 复盘 |
| GET | `/api/positions/closed` | 历史平仓记录（含复盘）|
| GET | `/api/positions/stats` | 交易统计（胜率/盈亏比）|
| POST | `/api/trades` | 记录交易日志（买/卖）|
| GET | `/api/trades` | 查询交易日志 |
| GET | `/api/trades/pnl` | 持仓盈亏汇总 |
| GET | `/api/ideas` | 想法列表（含 AI 分析）|
| POST | `/api/ideas` | 提交想法 → 触发 AI 分析 |
| GET | `/api/ai/backend` | 当前 AI 后端信息 |
| GET | `/api/strategy` | 策略面板（STRATEGY.md 解析）|

**WebSocket**：`ws://localhost:PORT/ws`  
推送事件类型：`PRICE` / `POSITIONS` / `POSITION_OPENED` / `POSITION_CLOSED` / `TRADE_ADDED` / `IDEA_ANALYZED` / `REVIEW_READY`

---

## 十、消息推送层

| 渠道 | 实现文件 | 说明 |
|------|----------|------|
| 钉钉 Webhook | `push/dingtalk.ts` | 支持 Secret 签名，Markdown 格式 |
| Telegram Bot | `push/telegram.ts` | Bot Token + Chat ID |
| 邮件 SMTP | `push/email.ts` | 默认 smtp.qq.com:465，HTML 模板 |
| 统一入口 | `push/push-manager.ts` | `pushAlert` / `pushDailyBrief` 并发推送三渠道 |

**触发场景：**

| 事件 | 渠道 |
|------|------|
| 交易信号 BUY/SELL（每 30 分钟检测，2h 防抖）| 钉钉 + 邮件 |
| 持仓亏损>3% 或触及止损价（每 5 分钟监控，每笔仅预警一次）| 钉钉 + 邮件 + 全渠道 pushAlert |
| 每日 22:00 AI 市场日报 | 钉钉 + Telegram |
| 系统告警（价格/库存/ETF/新闻异常）| 钉钉 + Telegram + 邮件 |

---

## 十一、前端模块（Vue 3 + ECharts）

| Tab | 组件 | 功能 |
|-----|------|------|
| 交易信号 | `SignalPanel.vue` | 5 级信号卡片、置信度、建议入场/止损/目标价、技术指标状态 |
| 我的持仓 | `TradeLog.vue` | 实时浮盈浮亏（WS 价格驱动）、快速开仓表单、FIFO 成本计算 |
| 复盘分析 | 持仓历史 | 已平仓记录、AI 复盘结果、执行评分、策略备忘录 |
| 市场行情 | 价格/库存/ETF/宏观图表 | ECharts K 线、库存趋势、ETF 持仓、宏观对比 |
| 情报中心 | 新闻列表 + 想法工坊 | AI 新闻评估标签、想法提交、AI 深度分析结果展示 |

---

## 十二、配置项概览（.env）

| 变量 | 用途 | 默认值 |
|------|------|--------|
| `PORT` | API 服务端口 | 3000 |
| `SQLITE_DB_PATH` | 数据库路径 | `./data/db/gold-sentinel.db` |
| `ANTHROPIC_API_KEY` | Claude API Key | — |
| `AI_MODEL` | Claude 模型 | `claude-haiku-4-5-20251001` |
| `AI_CUSTOM_BASE_URL` | 自定义 AI 端点（OpenAI 格式）| — |
| `AI_CUSTOM_API_KEY` | 自定义 AI 密钥 | — |
| `AI_CUSTOM_MODEL` | 自定义模型名 | — |
| `METALPRICE_API_KEY` | MetalpriceAPI | — |
| `GOLDAPI_KEY` | GoldAPI | — |
| `FRED_API_KEY` | FRED 宏观 | — |
| `NEWS_API_KEY` | NewsAPI | — |
| `EXCHANGE_RATE_API_KEY` | 汇率 API | — |
| `DINGTALK_WEBHOOK` / `DINGTALK_SECRET` | 钉钉 | — |
| `TELEGRAM_BOT_TOKEN` / `TELEGRAM_CHAT_ID` | Telegram | — |
| `SMTP_*` / `EMAIL_TO` | 邮件 | smtp.qq.com:465 |
| `PRICE_ALERT_THRESHOLD` | 价格变动告警阈值 % | 0.5 |
| `INVENTORY_ALERT_SIGMA` | 库存异常 σ 倍数 | 2 |
| `ETF_ALERT_TONNES` | ETF 变动告警吨数 | 5 |
| `MINUTE_DATA_RETENTION_DAYS` | 分钟数据保留天数 | 90 |

---

## 十三、核心数据流（完整链路）

```
外部数据源
    │
    ▼ (每1min ~ 每周)
Collectors（并发采集，Promise.allSettled 容错）
    │
    ▼
price-aggregator（加权中位数去噪 + SGE溢价计算）
    │
    ▼
SQLite DAO（upsert / insert，WAL 模式保证写并发）
    │
    ├──► WebSocket broadcast → 前端实时更新
    │
    ├──► signal-engine（每30min）
    │       └── RSI+MACD+BB+SGE+新闻情绪 → 5级信号
    │           └── 推送到 钉钉/邮件（BUY/SELL，2h防抖）
    │
    ├──► news-assessor（每1h，AI评估批次）
    │       └── 关键词过滤 → callClaude → 写回 news 表
    │
    ├──► position-monitor（每5min）
    │       └── 亏损>3% 或触及止损 → pushAlert 三渠道
    │
    └──► daily-brief（每日22:00）
            └── 聚合当日全量数据 → callClaude → pushDailyBrief

用户操作（前端/API）
    │
    ├──► POST /api/ideas → idea-analyzer → AI全维度分析 → WS广播
    ├──► POST /api/positions → openPosition → WS广播
    └──► POST /api/positions/:id/close → closePosition → reviewTrade（AI复盘）→ WS广播 → appendToStrategyMemo
```

---

## 十四、系统特性总结

| 特性 | 说明 |
|------|------|
| **容错设计** | 所有外部 API 调用均 `Promise.allSettled`，单源失败不影响整体 |
| **防重复推送** | 信号推送 2h 防抖；持仓预警每次启动期间每笔只推一次 |
| **双 AI 后端** | 优先自定义端点（Ollama 等本地模型）；回落 Anthropic API |
| **实时推送** | WebSocket 全事件驱动，前端零轮询 |
| **策略自进化** | 每次平仓 AI 复盘 → 教训写入 `STRATEGY_MEMO.md` → 积累交易规则库 |
| **单位统一** | 所有交易建议均以 CNY/g（积存金实际单位）呈现，避免换算误差 |
| **数据生命周期** | 分钟数据 90 天滚动清理；日线数据永久保留 |
