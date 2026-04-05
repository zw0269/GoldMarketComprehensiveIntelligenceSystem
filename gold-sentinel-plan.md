# 🥇 Gold Sentinel — 黄金市场全景情报 Agent

## CEO Review 需求分析报告

> **核心问题：这个产品真正要解决什么？**
>
> 不是"看金价"，而是——**在信息过载的贵金属市场中，让一个人拥有机构级的情报视野。**
>
> 机构交易员有 Bloomberg Terminal、Reuters Eikon、专属分析师团队。
> 你需要的是一个个人版的黄金情报中枢——开源、自托管、为中国投资者定制。

---

## 一、产品定位与用户画像

### 目标用户
- 有一定金融素养的个人黄金投资者/爱好者
- 需要同时关注国际金价（USD/oz）和国内金价（CNY/g）的中国用户
- 希望从"凭感觉看盘"进化到"数据驱动决策"的学习型投资者

### 产品愿景
打开 Gold Sentinel，5秒内回答三个问题：
1. **现在**：金价多少？涨还是跌？幅度？
2. **为什么**：哪些因素在驱动？（ETF流入？特朗普发推？非农数据？）
3. **接下来**：关键支撑/阻力位在哪？仓库库存信号？持仓结构？

---

## 二、系统架构总览

```
┌─────────────────────────────────────────────────────────────────┐
│                    Gold Sentinel 系统架构                         │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌──────────────┐   ┌──────────────┐   ┌──────────────────┐    │
│  │  数据采集层   │   │  数据处理层   │   │    展示/推送层     │    │
│  │  Collectors   │──▶│  Processors  │──▶│  Dashboard/Alert │    │
│  └──────────────┘   └──────────────┘   └──────────────────┘    │
│         │                   │                    │               │
│    ┌────┴────┐        ┌────┴────┐          ┌────┴────┐         │
│    │ 价格流  │        │ 时序DB  │          │ Web UI  │         │
│    │ 库存数据│        │ SQLite  │          │ WebSocket│        │
│    │ 宏观事件│        │ 计算引擎│          │ 钉钉/微信│        │
│    │ 新闻舆情│        │ AI分析  │          │ Telegram │        │
│    │ 持仓数据│        │ 技术指标│          │ 邮件推送 │         │
│    └─────────┘        └─────────┘          └─────────┘         │
│                                                                  │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │                    存储层 Storage                          │   │
│  │  SQLite (时序数据) + JSON Files (配置/缓存) + LevelDB     │   │
│  └──────────────────────────────────────────────────────────┘   │
│                                                                  │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │                    AI 分析层                               │   │
│  │  Claude API / 本地LLM → 事件影响评估 + 市场摘要生成       │   │
│  └──────────────────────────────────────────────────────────┘   │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### 技术栈选型

| 层级 | 技术选型 | 理由 |
|------|---------|------|
| 运行时 | Node.js 20+ (TypeScript) | 你熟悉 TS，异步IO天然适合多数据源并发采集 |
| 数据库 | SQLite (better-sqlite3) + InfluxDB (可选) | 轻量、零运维、时序查询够用；规模大了再上 InfluxDB |
| 定时任务 | node-cron | 分钟级调度，简单可靠 |
| HTTP 客户端 | axios + cheerio (爬虫) | API调用 + 网页解析 |
| WebSocket | ws 库 | 接收实时价格推送 |
| Web 前端 | Vue 3 + ECharts/TradingView Widget | 你的主力前端框架 + 专业K线图 |
| AI 分析 | Anthropic Claude API | 事件影响评估、市场日报生成 |
| 推送 | DingTalk Stream SDK / Telegram Bot API | 你已有钉钉 SDK 经验 |
| 部署 | PM2 + 本地/VPS | 持久运行，自动重启 |

---

## 三、数据源清单与采集策略

### 3.1 实时/分钟级价格数据

| 数据 | 来源 | 频率 | 方式 | 备注 |
|------|------|------|------|------|
| 国际金价 XAU/USD | MetalpriceAPI / GoldAPI.io / Metals-API | 1min | REST API | 免费层约 100-300 次/月，付费层可达 1min |
| 国际金价 备用 | goldpricez.com Free API | 1min | REST API | 免费 30-60次/小时 |
| 人民币/克 价格 | 上海黄金交易所(SGE) 爬虫 / 新浪财经API | 5min | 爬虫+API | Au99.99 基准价 |
| 美元/人民币汇率 | exchangerate-api / 央行中间价 | 15min | REST API | 用于实时换算 |
| COMEX 期货价格 | CME Group DataMine / Yahoo Finance | 15min延迟 | API/爬虫 | GC=F 主力合约 |
| 上期所黄金期货 | 新浪期货/东方财富 | 实时 | 爬虫 | AU2406 等主力合约 |

### 3.2 库存与交割数据

| 数据 | 来源 | 频率 | 方式 |
|------|------|------|------|
| COMEX 黄金仓库库存 | CME Group Gold_Stocks.xls | 日更 | 下载XLS解析 |
| COMEX Registered/Eligible 分类 | metalcharts.org / heavymetalstats.com | 日更 | 爬虫/API |
| SHFE 上期所黄金库存 | 上期所官网 / MacroMicro | 周更 | 爬虫 |
| LBMA 伦敦金银库存 | LBMA 官网 | 月更 | 爬虫 |
| COMEX 交割通知量 | CME Group Delivery Reports | 日更 | 爬虫 |

### 3.3 资金流向与持仓数据

| 数据 | 来源 | 频率 | 方式 |
|------|------|------|------|
| SPDR Gold (GLD) 持仓量 | spdrgoldshares.com | 日更 | 爬虫 |
| iShares Gold (IAU) 持仓量 | ishares.com | 日更 | 爬虫 |
| 中国黄金ETF持仓 | 华安黄金/易方达黄金 基金公告 | 日更 | 爬虫 |
| CFTC COT 报告 | CFTC 官网 | 周更(周五) | 下载CSV |
| 全球央行购金数据 | 世界黄金协会(WGC) | 月/季更 | 爬虫 |

### 3.4 宏观经济指标

| 数据 | 来源 | 频率 | 方式 |
|------|------|------|------|
| 美元指数 DXY | Yahoo Finance / TradingView | 实时 | API/爬虫 |
| 美国10年期国债收益率 | FRED API | 日更 | REST API (免费) |
| CPI / PCE / 非农 等经济数据 | FRED API / BLS | 月更 | REST API |
| Fed 利率决议 & 点阵图 | CME FedWatch Tool | 事件驱动 | 爬虫 |
| VIX 恐慌指数 | Yahoo Finance | 实时 | API |
| 实际利率 (TIPS) | FRED | 日更 | API |

### 3.5 新闻与舆情事件

| 数据 | 来源 | 频率 | 方式 |
|------|------|------|------|
| Trump 社交媒体发言 | Truth Social RSS / 新闻聚合 | 实时 | 爬虫+RSS |
| Fed 官员讲话 | Fed 官网 Calendar / Reuters | 事件驱动 | 爬虫 |
| 地缘政治新闻 | NewsAPI / Google News RSS | 实时 | API+RSS |
| 黄金相关新闻 | Kitco / 金十数据 / FX168 | 实时 | RSS+爬虫 |
| 财经日历 | investing.com / 金十数据 | 日更 | 爬虫 |

---

## 四、核心功能模块

### Module 1：价格引擎 (Price Engine)
- 多源价格聚合与去噪（取中位数/加权平均）
- XAU/USD ↔ CNY/g 实时双向换算
- SGE 溢价/折价计算（上金所价格 vs 国际价格换算值）
- 分钟级K线数据本地存储
- 价格异常波动检测（1分钟波动 > 0.5% 触发告警）

### Module 2：技术分析 (Technical Analysis)
- K线图生成（1min / 5min / 15min / 1H / 4H / 日线 / 周线）
- 移动均线 MA(5/10/20/60/120/250)
- MACD / RSI / 布林带 / KDJ
- 关键支撑位/阻力位自动识别
- 成交量分析 (COMEX 期货成交量)
- 斐波那契回撤位自动绘制

### Module 3：库存追踪 (Inventory Tracker)
- COMEX 三维视图：Total / Registered / Eligible + 日变化量
- 库存覆盖率计算：库存量 / 日均交割量
- SHFE + LBMA 库存联动对比
- 库存异常变动告警（单日变化 > 2σ）
- 历史趋势图 + 价格叠加对比

### Module 4：资金流向 (Fund Flow)
- ETF 持仓变化日线图（GLD + IAU + 中国黄金ETF）
- ETF 持仓量 vs 金价走势叠加图
- CFTC 持仓结构可视化：
  - 商业/非商业 多空持仓
  - 净多头变化趋势
  - 大额交易者集中度
- 央行购金月度/季度追踪

### Module 5：宏观仪表盘 (Macro Dashboard)
- 美元指数 DXY 实时 + 日线
- 10Y 美债收益率 + 实际利率(TIPS)
- Fed 利率概率（CME FedWatch 数据）
- VIX 恐慌指数
- 黄金/白银比价 (Gold/Silver Ratio)
- 黄金/原油比价
- 经济数据日历（下一个 CPI/非农 倒计时）

### Module 6：新闻情报 (News Intelligence)
- 实时新闻聚合 + 自动分类标签
- **AI 影响评估**：每条重大新闻由 Claude API 评估对金价的影响方向和强度
  - 输入：新闻标题 + 摘要 + 当前市场环境
  - 输出：{ direction: "bullish" | "bearish" | "neutral", impact: 1-5, reasoning: string }
- Trump 发言专项追踪（关税、Fed、美元相关关键词过滤）
- Fed 官员鹰鸽倾向追踪

### Module 7：告警系统 (Alert System)
- 价格告警：突破关键价位 / 波动率异常
- 库存告警：COMEX 库存单日大幅变动
- ETF 告警：GLD 持仓量单日变化 > X 吨
- 新闻告警：AI 评估 impact >= 4 的重大事件
- 推送渠道：钉钉机器人 / Telegram Bot / 邮件 / 浏览器通知

### Module 8：AI 市场日报 (AI Daily Brief)
- 每日收盘后自动生成市场日报
- 内容：价格回顾 + 关键事件 + 技术面分析 + 资金面分析 + 明日关注
- 由 Claude API 基于当日所有数据合成
- 支持推送到钉钉群/邮箱

---

## 五、详细 TODO List

### Phase 0：项目初始化 [预计 1 天]

```
[ ] T-000  项目脚手架搭建
    ├── [ ] T-001  npm init + TypeScript 配置 (tsconfig.json, eslint, prettier)
    ├── [ ] T-002  项目目录结构设计：
    │         src/
    │         ├── collectors/        # 数据采集器
    │         │   ├── price/         # 价格采集
    │         │   ├── inventory/     # 库存采集
    │         │   ├── fund-flow/     # 资金流向
    │         │   ├── macro/         # 宏观数据
    │         │   └── news/          # 新闻舆情
    │         ├── processors/        # 数据处理
    │         │   ├── technical/     # 技术分析计算
    │         │   ├── alert/         # 告警引擎
    │         │   └── ai/           # AI 分析模块
    │         ├── storage/           # 存储层
    │         ├── api/               # REST API 服务
    │         ├── push/              # 推送渠道
    │         ├── scheduler/         # 定时任务调度
    │         ├── web/               # 前端 Dashboard
    │         ├── config/            # 配置管理
    │         ├── utils/             # 工具函数
    │         └── types/             # TypeScript 类型定义
    ├── [ ] T-003  核心依赖安装：
    │         typescript, tsx, better-sqlite3, axios, cheerio, 
    │         node-cron, ws, express, dotenv, winston, dayjs,
    │         technicalindicators, @anthropic-ai/sdk
    ├── [ ] T-004  环境配置：.env 模板 (API Keys, 推送配置, DB路径)
    ├── [ ] T-005  Logger 配置 (winston, 按日期分割日志)
    └── [ ] T-006  统一错误处理 + 重试机制 (带指数退避)
```

### Phase 1：数据采集层 [预计 3-4 天]

```
[ ] T-100  价格采集模块
    ├── [ ] T-101  定义统一价格接口 IPriceData:
    │         { source, timestamp, xauUsd, xauCny, usdCny, sgePremium }
    ├── [ ] T-102  MetalpriceAPI 采集器 (XAU/USD, XAU/CNY)
    ├── [ ] T-103  GoldAPI.io 备用采集器
    ├── [ ] T-104  goldpricez.com 免费API采集器
    ├── [ ] T-105  新浪财经/上金所 Au99.99 爬虫 (CNY/g)
    ├── [ ] T-106  汇率采集器 (USD/CNY 实时中间价)
    ├── [ ] T-107  多源价格聚合器：中位数去噪 + 来源权重
    ├── [ ] T-108  SGE 溢价计算：(SGE价格 - 国际价格×汇率÷31.1035) / 国际换算价
    └── [ ] T-109  COMEX 期货价格采集 (GC=F 主力合约, Yahoo Finance)

[ ] T-110  库存数据采集模块
    ├── [ ] T-111  CME Gold_Stocks.xls 下载+解析器 (xlsx库)
    ├── [ ] T-112  COMEX Registered/Eligible 分类存储
    ├── [ ] T-113  metalcharts.org COMEX 库存爬虫 (备用源)
    ├── [ ] T-114  SHFE 上期所黄金库存爬虫
    ├── [ ] T-115  LBMA 库存月报爬虫
    └── [ ] T-116  COMEX 交割通知量爬虫

[ ] T-120  资金流向采集模块
    ├── [ ] T-121  SPDR Gold (GLD) 持仓量爬虫 (spdrgoldshares.com)
    ├── [ ] T-122  iShares Gold (IAU) 持仓量爬虫
    ├── [ ] T-123  中国黄金ETF持仓爬虫 (华安/易方达)
    ├── [ ] T-124  CFTC COT 报告下载器 + CSV解析器
    └── [ ] T-125  世界黄金协会(WGC) 央行购金数据爬虫

[ ] T-130  宏观数据采集模块
    ├── [ ] T-131  FRED API 封装 (10Y Treasury, TIPS, CPI, PCE, 非农)
    ├── [ ] T-132  美元指数 DXY 采集 (Yahoo Finance)
    ├── [ ] T-133  VIX 恐慌指数采集
    ├── [ ] T-134  CME FedWatch 利率概率爬虫
    ├── [ ] T-135  白银价格采集 (计算 Gold/Silver Ratio)
    └── [ ] T-136  原油价格采集 (计算 Gold/Oil Ratio)

[ ] T-140  新闻舆情采集模块
    ├── [ ] T-141  RSS 聚合引擎 (Kitco, Reuters, 金十数据, FX168)
    ├── [ ] T-142  Trump Truth Social / X 发言追踪 (关键词: tariff, gold, Fed, dollar, China)
    ├── [ ] T-143  Fed 官员讲话日程爬虫 (federalreserve.gov)
    ├── [ ] T-144  财经日历爬虫 (investing.com / 金十数据)
    ├── [ ] T-145  NewsAPI 通用新闻采集 (gold + geopolitics 关键词)
    └── [ ] T-146  Google News RSS "gold price" 订阅
```

### Phase 2：存储与数据处理层 [预计 2-3 天]

```
[ ] T-200  数据库设计与初始化
    ├── [ ] T-201  SQLite 表结构设计：
    │         prices        — 分钟级价格时序 (ts, xau_usd, xau_cny_g, usd_cny, source)
    │         prices_daily  — 日线OHLCV聚合
    │         inventory     — 库存快照 (date, exchange, registered, eligible, total)
    │         etf_holdings  — ETF持仓 (date, fund, tonnes, change)
    │         cot_report    — CFTC持仓 (date, commercial_long/short, noncomm_long/short...)
    │         macro_data    — 宏观指标 (date, indicator, value)
    │         news          — 新闻条目 (ts, source, title, summary, ai_direction, ai_impact)
    │         alerts_log    — 告警记录
    │         central_bank  — 央行购金 (date, country, tonnes)
    ├── [ ] T-202  数据库迁移脚本 (schema versioning)
    ├── [ ] T-203  数据访问层 DAO 封装
    └── [ ] T-204  数据清理定时任务（分钟数据保留 90 天，日线永久保留）

[ ] T-210  技术分析计算引擎
    ├── [ ] T-211  OHLCV K线聚合 (1min → 5min → 15min → 1H → 4H → 日线 → 周线)
    ├── [ ] T-212  移动均线 MA / EMA 计算 (5/10/20/60/120/250)
    ├── [ ] T-213  MACD 计算 (12, 26, 9)
    ├── [ ] T-214  RSI 计算 (14周期)
    ├── [ ] T-215  布林带计算 (20, 2σ)
    ├── [ ] T-216  KDJ 随机指标
    ├── [ ] T-217  支撑位/阻力位自动识别算法 (局部极值 + 成交密集区)
    └── [ ] T-218  斐波那契回撤位计算 (自动取最近一波趋势)

[ ] T-220  告警引擎
    ├── [ ] T-221  价格告警规则引擎 (突破/跌破/波动率)
    ├── [ ] T-222  库存告警规则 (日变化 > 2σ)
    ├── [ ] T-223  ETF 告警规则 (单日变化阈值)
    ├── [ ] T-224  新闻告警规则 (AI impact >= 4)
    ├── [ ] T-225  告警去重 & 冷却机制 (同一规则15分钟内不重复)
    └── [ ] T-226  告警优先级分级 (CRITICAL / HIGH / MEDIUM / LOW)
```

### Phase 3：AI 分析层 [预计 2 天]

```
[ ] T-300  AI 分析模块
    ├── [ ] T-301  Claude API 封装 (anthropic SDK, 重试, 限流)
    ├── [ ] T-302  新闻影响评估 Prompt 设计：
    │         输入：新闻标题+摘要 + 当前金价 + 近期趋势 + 宏观背景
    │         输出 JSON：{ direction, impact(1-5), reasoning, timeframe }
    ├── [ ] T-303  市场日报生成 Prompt 设计：
    │         输入：当日价格数据 + 库存变化 + ETF流向 + 重大新闻 + 技术指标
    │         输出：结构化日报 (价格回顾/驱动因素/技术面/资金面/明日关注)
    ├── [ ] T-304  异常事件综合评估：
    │         当多个信号同时触发时，AI 综合判断是否构成重大信号
    ├── [ ] T-305  Trump 发言专项分析：
    │         自动判断发言与黄金/美元/贸易的关联度
    └── [ ] T-306  AI 调用成本控制：
            - 批量新闻合并为一次 API 调用
            - 低影响新闻跳过 AI 评估（关键词预过滤）
            - 日报生成控制在 1 次/天
```

### Phase 4：API 服务层 [预计 1-2 天]

```
[ ] T-400  REST API 服务
    ├── [ ] T-401  Express/Fastify 服务搭建 + CORS 配置
    ├── [ ] T-402  WebSocket 实时价格推送 (ws 库)
    ├── [ ] T-403  API 路由设计：
    │         GET  /api/price/latest          — 最新价格
    │         GET  /api/price/history?tf=1m    — 历史K线 (支持多时间框架)
    │         GET  /api/inventory/comex        — COMEX 库存
    │         GET  /api/inventory/shfe         — SHFE 库存
    │         GET  /api/inventory/compare      — 三地库存对比
    │         GET  /api/etf/holdings           — ETF 持仓
    │         GET  /api/cot/latest             — CFTC 最新持仓
    │         GET  /api/macro/dashboard        — 宏观仪表盘数据
    │         GET  /api/news/latest            — 最新新闻 + AI评估
    │         GET  /api/news/trump             — Trump 发言记录
    │         GET  /api/analysis/daily         — AI 市场日报
    │         GET  /api/alerts/history         — 告警历史
    │         POST /api/alerts/config          — 告警配置
    │         GET  /api/technical/:timeframe   — 技术指标数据
    │         GET  /api/ratio/gold-silver      — 金银比价
    │         GET  /api/premium/sge            — SGE 溢价
    └── [ ] T-404  API 文档 (简易 Swagger / README)
```

### Phase 5：前端 Dashboard [预计 4-5 天]

```
[ ] T-500  Dashboard 前端
    ├── [ ] T-501  Vue 3 + Vite 项目初始化
    ├── [ ] T-502  设计系统定义：
    │         - 暗色主题为主（金融终端风格）
    │         - 主色：#D4AF37 (金色) + #1a1a2e (深蓝黑)
    │         - 强调色：#00C853 (涨) / #FF1744 (跌)
    │         - 字体：JetBrains Mono (数据) + Noto Sans SC (中文)
    ├── [ ] T-503  核心看板页面：
    │         ┌─────────────────────────────────────────────┐
    │         │  💰 $4,676.43/oz  ▲+1.2%   ¥1,093.5/g     │  ← 价格 Hero
    │         │  SGE Premium: +$12.3 (+0.26%)               │
    │         ├──────────────────────┬──────────────────────┤
    │         │                      │  📊 宏观面板          │
    │         │   K线图 (TradingView │  DXY: 99.8 ▼        │
    │         │   Lightweight Chart  │  10Y: 4.25% ▲       │
    │         │   / ECharts)         │  VIX: 18.5 ▼        │
    │         │                      │  Fed: 72% hold      │
    │         │   MA / MACD / RSI    │  Au/Ag: 82.3        │
    │         │   + 支撑/阻力标注    │  Au/Oil: 55.1       │
    │         ├──────────────────────┼──────────────────────┤
    │         │  🏦 库存追踪          │  💸 资金流向          │
    │         │  COMEX: 34.4M oz    │  GLD: -3.2t          │
    │         │  ├ Reg: 12.1M       │  IAU: +1.1t          │
    │         │  └ Eli: 22.3M       │  CN ETF: +0.8t       │
    │         │  SHFE: 2,890 kg     │  CFTC Net Long:      │
    │         │  [库存趋势图]        │  [持仓结构图]         │
    │         ├──────────────────────┴──────────────────────┤
    │         │  📰 新闻情报流 (按时间倒序, 带AI影响标签)      │
    │         │  🔴 HIGH Trump: "关税将在下周..." +4 bullish │
    │         │  🟡 MED  Fed Williams: "通胀..." +2 bearish │
    │         │  🟢 LOW  印度进口关税... +1 bullish          │
    │         └─────────────────────────────────────────────┘
    ├── [ ] T-504  K线图组件 (TradingView Lightweight Charts / ECharts)
    │         - 多时间框架切换
    │         - 技术指标叠加
    │         - 支撑/阻力位自动标注
    │         - 鼠标悬浮显示 OHLCV + 指标值
    ├── [ ] T-505  库存追踪组件
    │         - COMEX 堆叠面积图 (Registered + Eligible)
    │         - 三地库存趋势对比折线图
    │         - 日变化量柱状图
    ├── [ ] T-506  资金流向组件
    │         - ETF 持仓变化柱状图 + 金价叠加
    │         - CFTC 多空持仓堆叠图
    │         - 净多头趋势线
    ├── [ ] T-507  新闻情报流组件
    │         - 实时更新 (WebSocket)
    │         - AI 影响标签 (方向 + 强度 色彩编码)
    │         - 点击展开详情 + AI 推理
    │         - 按来源/影响/方向 过滤
    ├── [ ] T-508  宏观仪表盘组件 (卡片式布局)
    ├── [ ] T-509  SGE 溢价专项图表
    ├── [ ] T-510  经济日历组件 (倒计时 + 前值/预期/实际)
    ├── [ ] T-511  AI 市场日报页面 (Markdown 渲染)
    ├── [ ] T-512  告警配置页面 (规则增删改 + 推送渠道设置)
    └── [ ] T-513  移动端响应式适配 (你有 UniApp 经验可考虑后续迁移)
```

### Phase 6：推送与告警 [预计 1-2 天]

```
[ ] T-600  推送渠道实现
    ├── [ ] T-601  钉钉群机器人推送 (DingTalk Stream SDK)
    │         - 告警消息: Markdown 格式卡片
    │         - 日报推送: 完整日报摘要
    ├── [ ] T-602  Telegram Bot 推送
    │         - 价格告警
    │         - 每日摘要
    │         - /price 命令查询当前价格
    ├── [ ] T-603  邮件推送 (nodemailer)
    │         - AI 市场日报 HTML 邮件
    ├── [ ] T-604  浏览器 Web Push Notification
    └── [ ] T-605  推送消息模板系统 (统一格式化)
```

### Phase 7：调度与运维 [预计 1 天]

```
[ ] T-700  调度系统
    ├── [ ] T-701  node-cron 调度器配置：
    │         - 每1分钟: 价格采集
    │         - 每5分钟: SGE价格/汇率
    │         - 每15分钟: 宏观指标 (DXY, VIX, 国债收益率)
    │         - 每1小时: 新闻聚合 + AI评估
    │         - 每日 06:00: 库存数据更新 (COMEX/SHFE)
    │         - 每日 06:00: ETF持仓更新
    │         - 每日 22:00: AI 市场日报生成
    │         - 每周六 10:00: CFTC COT 报告下载
    │         - 每月1日: LBMA 库存 + 央行购金
    ├── [ ] T-702  PM2 进程管理配置 (ecosystem.config.js)
    ├── [ ] T-703  健康检查接口 GET /health
    ├── [ ] T-704  错误监控 + 采集失败自动重试
    └── [ ] T-705  数据源可用性监控 (某个源挂了自动切换备用)
```

### Phase 8：测试与文档 [预计 1-2 天]

```
[ ] T-800  测试
    ├── [ ] T-801  单元测试：技术指标计算正确性
    ├── [ ] T-802  单元测试：价格聚合逻辑
    ├── [ ] T-803  单元测试：告警规则匹配
    ├── [ ] T-804  集成测试：各采集器数据格式验证
    ├── [ ] T-805  E2E 测试：价格采集 → 存储 → API → 前端 完整流程
    └── [ ] T-806  Mock 数据生成器 (用于开发/演示)

[ ] T-810  文档
    ├── [ ] T-811  README.md (项目说明 + 快速开始 + 架构图)
    ├── [ ] T-812  API 文档
    ├── [ ] T-813  数据源说明文档 (每个源的更新频率/限制/备用方案)
    ├── [ ] T-814  部署指南 (本地 / VPS / Docker)
    └── [ ] T-815  .env.example 完整注释
```

---

## 六、里程碑规划

| 阶段 | 里程碑 | 预计耗时 | 交付物 |
|------|--------|---------|--------|
| **M0** | 能跑起来 | 2天 | 脚手架 + 1个价格源采集 + SQLite存储 + 终端输出价格 |
| **M1** | 核心盯盘 | 5天 | 多源价格 + K线图 + 基础技术指标 + Web Dashboard 原型 |
| **M2** | 情报视野 | 5天 | 库存追踪 + ETF流向 + 宏观面板 + 新闻聚合 |
| **M3** | AI 赋能 | 3天 | 新闻AI评估 + 市场日报 + 告警系统 + 推送 |
| **M4** | 精打细磨 | 3天 | Dashboard 美化 + 移动端适配 + 测试 + 文档 |
| **Total** | — | **~18天** | 完整可用的黄金情报系统 |

---

## 七、风险与应对

| 风险 | 概率 | 影响 | 应对策略 |
|------|------|------|---------|
| 免费API调用量不够 | 高 | 数据缺失 | 多源轮询 + 缓存 + 降低非核心数据频率 |
| 爬虫反爬/网站改版 | 中 | 某数据源失效 | 每个核心数据至少2个备用源 |
| Claude API 成本失控 | 中 | 预算超标 | 关键词预过滤 + 批量合并调用 + 日报1次/天 |
| SGE 数据难以稳定获取 | 中 | 中国视角缺失 | 新浪/东方财富多源 + 公式换算兜底 |
| 前端性能（大量实时数据） | 低 | 卡顿 | 虚拟滚动 + 数据分页 + WebSocket 增量推送 |

---

## 八、扩展想象（Scope Expansion — 未来可选）

这些不在 MVP 范围内，但值得记录：

1. **回测引擎**：基于历史数据回测简单策略（如"COMEX库存连降3天 → 做多"）
2. **多品种扩展**：白银、铂金、钯金同构支持
3. **社区情绪分析**：Reddit r/Gold、微博 #黄金# 情绪指数
4. **语音播报**：接入 TTS，定时语音播报金价（适合忙碌时段）
5. **UniApp 移动端**：复用你的 UniApp 经验，做原生移动看盘
6. **量化信号**：基于多因子模型生成综合看多/看空信号评分
7. **数据开放**：提供标准化 API，供其他人接入你的数据

---

> **这份计划的哲学：不是写一个看金价的脚本，而是打造你的个人 Bloomberg Terminal。**
>
> 先 M0 跑起来，看到数据流动的那一刻，所有后续动力都会来。
