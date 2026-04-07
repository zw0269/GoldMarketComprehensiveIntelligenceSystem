# Gold Sentinel — 开发日志

> 项目：黄金市场全景情报系统（积存金短线交易辅助）
> 技术栈：Node.js + TypeScript + SQLite + Vue 3 + ECharts + Claude API
> 最后更新：2026-04-07（会话15）

---

## 快速导航

- [系统架构](#系统架构)
- [AI 操作记录](#ai-操作记录)
- [Bug 修复记录](#bug-修复记录)
- [各阶段完成情况](#各阶段完成情况)
- [部署指南](#部署指南)
- [API Keys 注册](#api-keys-注册)

---

## 系统架构

```
定时任务（node-cron）[休市=周六/周日，标注*的任务休市跳过]
  ├── 1min    价格采集 → SQLite → WebSocket广播 * + 急涨/急跌异动检测 ← 新增
  ├── 5min    宏观指标 + 持仓止损监控 *
  ├── 15min   FRED宏观 + COMEX期货 *
  ├── 30min   交易信号生成 + 推送 *
  ├── 1hour   新闻采集（全天）+ AI评估（交易日）
  ├── daily 02:00  AI提示词归纳总结 ← 新增
  ├── daily 06:00  库存 + ETF更新
  ├── daily 22:00  AI市场日报
  ├── daily 03:00  数据清理
  └── weekly 周六10:00  CFTC COT

推送通道：邮件(SMTP) · 钉钉(Webhook) · Telegram(Bot)

前端（Vue 3 + Vite + ECharts）
  ├── 🎯 交易信号 Tab
  ├── 💰 我的持仓 Tab
  ├── 🔍 复盘分析 Tab
  ├── 📈 市场行情 Tab
  ├── 📰 情报中心 Tab（含想法工坊）
  └── 🤖 AI 助手 Tab（含每日AI总结）← 新增
```

---

## AI 操作记录

### 会话 1 — 2026-04-05：历史行情 + 想法工坊

| 操作 | 涉及文件 | 说明 |
|------|---------|------|
| 读取 CEO 评审 Skill | GitHub | 了解 CEO 模式评审框架 |
| 读取项目文档 | log.md / gold-sentinel-plan.md | 了解 Phase 0-8 完成状态 |
| 修改 `web/src/App.vue` | 前端 | 接入 HistoricalChart + IdeaWorkshop 两个新组件 |

---

### 会话 2 — 2026-04-05：CEO 评审 → 积存金交易决策系统

**诊断：** 系统是情报展示台，缺乏交易信号、持仓盈亏追踪，与"积存金短线赚钱"目标错位。

| 操作 | 涉及文件 | 说明 |
|------|---------|------|
| 新建 `src/processors/ai/signal-engine.ts` | 后端 | 规则型信号引擎：RSI+MACD+布林带+SGE溢价+新闻情绪 → 5级信号+价位 |
| 修改 `src/storage/database.ts` | 存储层 | 新增 `trade_log` + `signals` 表 |
| 修改 `src/storage/dao.ts` | 存储层 | 新增交易/信号相关 CRUD 方法 |
| 修改 `src/api/server.ts` | API层 | 新增信号、交易、持仓相关 6 个端点 |
| 新建 `web/src/components/SignalPanel.vue` | 前端 | 交易信号面板：5级信号 + 置信度 + 价位卡片 + 技术指标 |
| 新建 `web/src/components/TradeLog.vue` | 前端 | 持仓日志：实时盈亏 + FIFO成本 + 快速开仓表单 |

**信号引擎评分权重：**

| 指标 | 权重 |
|------|------|
| RSI(14) 超卖/超买 | ±20~30分 |
| MACD 柱线方向 | ±15分 |
| 布林带位置 | ±15分 |
| SGE溢价 | ±8~15分 |
| 新闻情绪（impact≥3） | ±15分 |
| 支撑/阻力位 | ±10分 |
| 合成评分阈值 | ≥50→STRONG_BUY / ≥20→BUY / ≤-20→SELL / ≤-50→STRONG_SELL |

---

### 会话 3 — 2026-04-05：Bug 修复（SignalPanel 500）

| 操作 | 结果 |
|------|------|
| 定位 500 根因 | Vue SFC Babel 不支持 `{map}[obj?.key ?? '']` 写法 |
| 修复 `bbLabel` / `bbClass` computed | 改为 `const map={...}; return pos ? map[pos] : ''` |
| 验证构建 | ✅ 679 modules，1.71s |

---

### 会话 4 — 2026-04-05：持久运行 + 告警推送 + 5-Tab 重构

**用户需求：** ①买卖/亏损时发邮件+钉钉 ②开仓只填买入价+克数 ③多Tab布局

| 操作 | 涉及文件 | 说明 |
|------|---------|------|
| 新建 `src/push/email.ts` | 推送层 | nodemailer SMTP；信号邮件 + 亏损预警邮件（HTML模板） |
| 修改 `src/push/push-manager.ts` | 推送层 | `pushAlert()` 改为 DingTalk + Telegram + Email 三路并发 |
| 修改 `src/scheduler/scheduler.ts` | 调度层 | 新增 `scheduleSignalMonitor()`（每30min） + `schedulePositionMonitor()`（每5min） |
| 新建 `src/processors/ai/trade-reviewer.ts` | AI层 | 平仓后异步触发AI复盘，教训写入 STRATEGY_MEMO.md |
| 修改 `src/storage/database.ts` | 存储层 | 新增 `open_positions` 表（完整持仓生命周期） |
| 修改 `src/storage/dao.ts` | 存储层 | 新增 `openPosition` / `closePosition` / `getTradeStats` 等方法 |
| 修改 `src/api/server.ts` | API层 | 新增持仓 5 个端点 |
| 完整重写 `web/src/App.vue` | 前端 | 5-Tab 布局；Header 固定实时价格；WS 事件全覆盖 |
| 新建 `web/src/components/ReviewPanel.vue` | 前端 | 已平仓持仓 + AI复盘展示 |
| 验证构建 | — | ✅ 682 modules，595ms |

**防刷告警机制：**
- 同一信号等级 2 小时内不重复推送
- 每笔持仓每次运行期间只预警一次亏损（`lossPushedIds: Set<number>`）

---

### 会话 5 — 2026-04-05：想法工坊全量数据升级

**用户需求：** 分析想法时调用各种实时数据（价格/技术指标/新闻/ETF/库存/COT），得出实时综合结论。

| 操作 | 涉及文件 | 说明 |
|------|---------|------|
| 修改 `src/storage/dao.ts` | 存储层 | 新增 `getLatestCOT()` / `getLatestInventory()` / `getLatestETFHolding()` 查询函数 |
| 完整重写 `src/processors/ai/idea-analyzer.ts` | AI层 | 并发拉取8个数据源，扩展输出字段，升级 Prompt |
| 完整重写 `web/src/components/IdeaWorkshop.vue` | 前端 | 展示交易价位建议、数据来源标签、分析进度提示 |
| 验证构建 | — | ✅ 682 modules，594ms |

**想法分析数据源（8个，并发拉取）：**

| 数据源 | 内容 |
|--------|------|
| 实时价格 | XAU/USD · XAU/CNY · SGE溢价 · USD/CNY |
| 技术指标 | RSI(14) · MACD(柱线/金叉死叉) · 布林带(位置/上下轨) |
| 系统信号 | 当前5级信号 + 评分 + 置信度 + 信号理由 |
| 宏观环境 | DXY · 美债10Y · TIPS · VIX · Fed利率 · 白银 · 原油 |
| 近期新闻 | AI影响力≥3/5 的新闻（含情感方向和摘要） |
| GLD ETF | 最新持仓吨数 + 变化量 |
| 实物库存 | COMEX + SHFE 最新库存吨数 |
| CFTC COT | 机构净多头合约数（判断主力方向） |

**新增输出字段：**
- `action` — 具体操作建议（立即买入/分批建仓/观望等待/减仓/止损离场）
- `entry` — 建议入场价（¥/g）
- `stopLoss` — 止损价（¥/g）
- `target` — 目标价（¥/g）
- `riskReward` — 风险收益比（如 "1:2.5"）
- `dataUsed` — 本次实际调用的数据源列表

---

### 会话 6 — 2026-04-05：休市检测 + AI 问答窗口 + 每日 AI 总结

**用户需求：**
1. 周六/周日休市时跳过实时黄金价格采集，仅保留国际消息面采集
2. 增加 AI 问答窗口，基于已有数据回答用户提问
3. 每天凌晨 2 点对全天 AI 提示词进行归纳总结分析

---

#### 功能一：休市时间检测

**涉及文件：** `src/scheduler/scheduler.ts`

| 操作 | 说明 |
|------|------|
| 新增 `isMarketOpen()` | `Date.getDay()` 判断，0=周日/6=周六 时返回 false |
| `scheduleEveryMinute()` | 周末跳过 `aggregatePrices()` |
| `scheduleEvery5Min()` | 周末跳过汇率/SGE采集 |
| `scheduleEvery15Min()` | 周末跳过 FRED/COMEX 宏观采集 |
| `scheduleEveryHour()` | **始终运行**（采集国际消息面）；AI 评估仅交易日执行 |
| `scheduleSignalMonitor()` | 周末跳过信号生成 |

---

#### 功能二：AI 问答窗口

**涉及文件：**

| 文件 | 操作 |
|------|------|
| `src/api/server.ts` | 新增 `POST /api/ai/chat`，自动注入实时价格+宏观+新闻上下文，支持多轮对话历史 |
| `src/api/server.ts` | 新增 `GET /api/ai/summaries`，返回最近30条 AI 每日总结 |
| `web/src/api/index.ts` | 新增 `chatWithAI(question, history)` / `getAIDailySummaries()` |
| `web/src/components/AIChat.vue` | **新建**：聊天气泡UI、快捷问题按钮、Enter发送、三点思考动画、底部折叠展示AI日报 |
| `web/src/App.vue` | 新增第六个 Tab `🤖 AI 助手`，引入 `AIChat` 组件 |

**`POST /api/ai/chat` 上下文内容：**
- 实时价格：¥/g · $/oz · USD/CNY · SGE溢价
- 宏观指标（最多8项）
- 最新10条新闻（含 AI 评估方向 + 影响分值）
- 多轮对话历史（最近6轮）
- `contextType = 'chat'`，自动写入 AI 交互日志

---

#### 功能三：每日凌晨 2 点 AI 提示词归纳总结

**涉及文件：**

| 文件 | 操作 |
|------|------|
| `src/storage/database.ts` | 新增 `ai_interaction_log` 表（记录每次 AI 调用）和 `ai_daily_summary` 表 |
| `src/storage/dao.ts` | 新增 `insertAILog()` / `getAILogsByDateRange()` / `insertAIDailySummary()` / `getAIDailySummaries()` |
| `src/processors/ai/claude-client.ts` | `callClaude()` 新增第4参数 `contextType`；每次调用后 `setImmediate` 异步写日志（截断：prompt前2000字符，response前4000字符） |
| `src/processors/ai/daily-brief.ts` | 标记 `contextType = 'daily_brief'` |
| `src/processors/ai/news-assessor.ts` | 标记 `contextType = 'news_assessment'` |
| `src/processors/ai/trade-reviewer.ts` | 标记 `contextType = 'trade_review'` |
| `src/processors/ai/idea-analyzer.ts` | 标记 `contextType = 'idea'` |
| `src/processors/ai/ai-summary.ts` | **新建**：分层采样当日 AI 日志（最多30条），生成6节结构化报告 |
| `src/scheduler/scheduler.ts` | 新增 `scheduleAIDailySummary()`（`0 2 * * *`），加入 `startAllSchedulers()` |

**`ai_interaction_log` 表结构：**

```sql
CREATE TABLE ai_interaction_log (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  ts            INTEGER DEFAULT (unixepoch() * 1000),
  context_type  TEXT NOT NULL,  -- news_assessment|daily_brief|idea|trade_review|chat|signal|summary
  system_prompt TEXT NOT NULL,
  user_message  TEXT NOT NULL,
  response      TEXT,
  duration_ms   INTEGER
);
```

**每日总结报告结构（6节）：**
1. 📊 当日 AI 活动概览（各类型调用次数、质量）
2. 📰 新闻评估规律（市场焦点、情绪分布）
3. 💡 用户提问特征（高频话题）
4. 🔍 值得注意的 AI 判断（亮点摘录）
5. ⚠️ 异常或低质量输出
6. 📈 对明日市场的启示

总结完成后推送至钉钉/邮件，并可在 `🤖 AI 助手` Tab 底部折叠面板查阅历史。

---

### 会话 7 — 2026-04-05：金价异动急涨/急跌实时预警

**用户需求：** 金价短时间内大幅上涨或下跌时，自动推送邮件 + 钉钉通知。

**涉及文件：**

| 文件 | 操作 |
|------|------|
| `src/push/email.ts` | 新增 `sendPriceSpikeEmail()` — 急涨/急跌专用邮件模板 |
| `src/scheduler/scheduler.ts` | 新增 `spikeState` 节流状态、`SPIKE_RULES` 规则表、`schedulePriceSpikeMonitor()` 任务 |

**预警规则（三档阈值）：**

| 时间窗口 | 涨跌幅阈值 | 预警等级 | 约等于（按 ¥700/g） |
|---------|-----------|---------|-------------------|
| 5 分钟  | ≥ 0.5%   | 🟡 中级预警 | ≥ ¥3.5/g |
| 15 分钟 | ≥ 1.0%   | 🟠 高级预警 | ≥ ¥7.0/g |
| 30 分钟 | ≥ 1.5%   | 🔴 紧急预警 | ≥ ¥10.5/g |

**检测逻辑（`schedulePriceSpikeMonitor`，每1分钟运行）：**
1. 休市（周六/周日）跳过
2. 查询最近 31 分钟的价格历史（最多200条）
3. 对三档规则各自取"N分钟前的参考价"（找第一条 `ts >= now - windowMin×60s` 的记录）
4. 计算涨跌幅，超过阈值且未被节流 → 触发推送

**防刷机制：**
- `spikeState` 以 `"up_5"` / `"down_15"` 等为键存储上次推送时间
- 同方向同窗口 **30 分钟内不重复推送**
- 上涨/下跌互相独立计时（急涨预警后，急跌仍可立即推送）

**推送内容：**
- **钉钉**：Markdown卡片，显示方向、变动幅度、前后价格对比、操作提示
- **邮件**：HTML模板，含彩色变动百分比大字体、价格前后对比表、风险提示文字

**运营说明：** 此监控与每1分钟的价格采集共用数据库记录，无额外 API 调用，资源消耗极低。

---

### 会话 15 — 2026-04-07：AI 问答历史记录系统

**用户需求：** 把每次给 AI 的问题和 AI 的回复记录到数据库，在页面中可查看。

**根因分析：** 已有 `ai_interaction_log` 表但存的是带全量上下文的脏数据（截断到2000字），不适合展示；且无任何查看 UI。

| 操作 | 涉及文件 | 说明 |
|------|---------|------|
| 新增 `ai_qa_log` 表 | `src/storage/database.ts` | 存储干净 Q&A：`type(chat/idea/review)` + `question`（用户原始输入）+ `answer`（AI完整回复）+ `meta`（JSON，存方向/评分/价位等） |
| 新增 DAO 方法 | `src/storage/dao.ts` | `insertQALog()` / `getQALogs({type,limit,offset})` / `countQALogs()` / `deleteQALog(id)` |
| AI 聊天端点保存记录 | `src/api/server.ts` | `POST /api/ai/chat` 成功后 `setImmediate` 异步存 `type='chat'`，原始问题+AI回答 |
| 想法工坊保存记录 | `src/processors/ai/idea-analyzer.ts` | 分析完成后异步存 `type='idea'`，idea内容+摘要/理由，meta带入场/止损/目标价 |
| 新增查询/删除端点 | `src/api/server.ts` | `GET /api/ai/qa-log?type=&limit=&offset=`（带分页+过滤）/ `DELETE /api/ai/qa-log/:id` |
| 新增前端 API | `web/src/api/index.ts` | `getQALog(opts)` / `deleteQALog(id)` |
| 新建 `AIQAHistory.vue` | 前端组件 | 三类型 Tab（全部/AI聊天/想法分析）+ 分页列表 + 展开详情 + 单条删除；idea 类型头部显示方向/评分/操作建议；展开后显示入场/止损/目标价 Chip |
| 改造 AI 助手 Tab 布局 | `web/src/App.vue` | 由单列改为双列（聊天窗 + 历史面板），响应式折叠为单列 |

**Q&A 记录覆盖范围：**
- ✅ AI 聊天（用户手动提问）
- ✅ 想法工坊（用户提交想法分析）
- ❌ 后台自动任务（新闻评估/信号生成/日报）→ 这些只在 `ai_interaction_log` 存，不在 Q&A 视图显示

**数据流：**
```
用户问题 → API → callClaude() → 得到回答
                              ↓ setImmediate（异步，不阻塞响应）
                          insertQALog(type, question, answer, meta)
                              ↓
                      ai_qa_log 表（SQLite）
                              ↓
                  GET /api/ai/qa-log → AIQAHistory.vue
```

---

### 会话 14 — 2026-04-07：三大前瞻指标监控系统

**用户需求：** 增加外围局势判断的三个前瞻指标到消息监控，并在每次 AI 分析时自动注入。

**三大指标说明：**
| 指标 | 阈值 | 操作逻辑 |
|------|------|---------|
| ① 五角大楼披萨指数 | >40 警惕 / >60 大事酝酿 | 指数超60立即布局最防守品种 |
| ② 美10年期国债收益率 | >4.4% / <4.3% | >4.4%看科技暴跌，<4.3%买防守品种 |
| ③ Polymarket 预测市场 | 事件概率 | 全球聪明钱真金白银押注，提前反映预期 |

| 操作 | 涉及文件 | 说明 |
|------|---------|------|
| 新建 `src/collectors/intel/pentagon-pizza.collector.ts` | 采集层 | GDELT全球新闻API统计五角大楼/美军相关"紧急/夜间/部署"新闻量，映射0-100军事活动指数（>40警戒/>60高危）|
| 新建 `src/collectors/intel/polymarket.collector.ts` | 采集层 | Polymarket公开API获取全球前100大市场，筛选战争/经济/政治相关事件，返回YES概率+成交量 |
| 修改 `src/collectors/macro/yahoo-macro.collector.ts` | 采集层 | 新增 `TNX: '^TNX'` 符号，美10年期国债收益率自动纳入宏观数据采集（每5分钟） |
| 修改 `src/storage/database.ts` | 存储层 | 新增 `intel_pentagon` 表（历史指数快照）和 `polymarket_markets` 表（UNIQUE market_id，只保留最新状态） |
| 修改 `src/storage/dao.ts` | 存储层 | 新增 `insertPentagonPizza()` / `getLatestPentagonPizza()` / `upsertPolymarkets()` / `getLatestPolymarkets()` / `buildIntelContext()`（生成AI可读文本块） |
| 修改 `src/scheduler/scheduler.ts` | 调度层 | 新增 `scheduleIntelCollectors()`（每30分钟采集五角大楼指数+Polymarket，启动时立即执行一次，指数≥60时WS广播告警） |
| 修改 `src/api/server.ts` | API层 | 新增 `GET /api/intel/forward`（三指标聚合）和 `GET /api/intel/pentagon/history`；AI聊天注入 `buildIntelContext()` |
| 修改 `src/processors/ai/idea-analyzer.ts` | AI层 | `buildFullContext()` 中注入 `buildIntelContext()`，每次想法分析自动携带三大前瞻指标 |
| 修改 `web/src/api/index.ts` | 前端API | 新增 `getForwardIntel()` / `getPentagonHistory()` |
| 新建 `web/src/components/ForwardIndicators.vue` | 前端组件 | 三卡片布局：①TNX收益率+信号标签 ②披萨指数进度条+级别色块 ③Polymarket前12市场列表（概率颜色：≥70%红/≥50%黄/<50%绿） |
| 修改 `web/src/App.vue` | 前端 | 情报中心Tab顶部新增「🔭 三大前瞻指标」全宽 panel |

**AI 注入方式（`buildIntelContext` 输出示例）：**
```
## 三大前瞻指标（外围风向标）
**美国10年期国债收益率: 4.385%**
  → 中性区间，持续观察
  （傻瓜公式：>4.4%看科技暴跌，<4.3%买防守品种）
**五角大楼披萨指数（军事活动）: 28/100** 🟢（23分钟前更新）
  → 军事活动正常，外围局势平稳
  （阈值：>40需警惕，>60大事酝酿立即防守）
**Polymarket 全球聪明钱押注（前8大相关市场）:**
  🟡 62% YES — Will US enter recession by end of 2025? （成交量$2.3M）
  🔴 78% YES — Will there be a US-China trade deal? （成交量$1.1M）
  ...
```

**定时采集计划：**
- TNX：每5分钟（随 Yahoo 宏观采集器）
- 五角大楼披萨指数：每30分钟（GDELT API，免费无需Key）
- Polymarket：每30分钟（公开API，免费无需Key）

---

### 会话 13 — 2026-04-07：价格走势分钟级数据 + 历史行情图表修复

**用户需求：**
1. 价格走势要有大量数据点（不能只有2条）
2. 黄金历史行情数据加载失败修复
3. 价格走势按分钟级查询

**根因分析：**
- 价格走势（PriceChart）数据来自本地 SQLite `prices` 表，系统刚启动时只有极少记录
- 历史行情（HistoricalChart）使用东方财富/腾讯/新浪，均已失败（上一个修复改回国内源）；Yahoo Finance 实测可访问未被使用
- 历史图表在 `v-show` Tab 切换时 ECharts 容器宽度=0，渲染空白

**解决方案：**

| 操作 | 涉及文件 | 说明 |
|------|---------|------|
| 新增 `/api/price/intraday` 接口 | `src/api/server.ts` | 从 Yahoo Finance GC=F 获取 5 分钟 K 线（5天，约1300+数据点），降级回本地 DB |
| 新增 `getIntraday()` | `web/src/api/index.ts` | 前端封装，timeout 15s |
| 价格走势改用 intraday 数据 | `web/src/App.vue` | `getPriceHistory('1h',7)` → `getIntraday('5m','5d')` |
| PriceChart 优化 | `web/src/components/PriceChart.vue` | 新增底部 dataZoom 滑块；X轴间隔适配1000+点；容器高度 320→360px；时间格式区分日内/多日 |
| Yahoo Finance 加入历史数据源 | `src/collectors/price/historical.collector.ts` | 新增 `fetchFromYahoo()`，作为**首选源**（GC=F USD/oz，国内可访问），东方财富/腾讯/新浪降为备用 |
| 历史图表完整重写 | `web/src/components/HistoricalChart.vue` | 修复 v-show Tab 切换渲染空白；加 `nextTick` 确保 DOM 就绪后渲染；`defineExpose({ resize })`；自动检测 USD/CNY 切换符号和标签；数据来源标签（Yahoo/东方财富/新浪/本地）；loading 旋转动画；错误详情展示；过渡动画 |
| App.vue 补全 resize 调用 | `web/src/App.vue` | Tab 切换到市场行情时同时 resize PriceChart + HistoricalChart，解决容器宽度=0 问题 |

**货币自动检测逻辑：**
```javascript
// Yahoo GC=F 返回 USD/oz（收盘价 2000~6000），国内源返回 CNY/g（<1500）
const isUSD = computed(() => Math.max(...closes) > 1800);
```

**HistoricalChart 核心 Bug 修复：**
1. `v-show` 隐藏时 ECharts 宽度=0 → `resize()` 前置 + `defineExpose` 供父组件调用
2. `renderChart()` 在 DOM 更新前执行 → 加 `await nextTick()` 后再渲染
3. overlay 遮罩定位错误 → 改用独立 `.chart-wrap` 容器，`position:relative` 与 `inset:0` 精确覆盖
4. `watch(activeRange)` 只 resize 不重渲染 → 删除冗余 watch，改由 `switchRange→loadData→renderChart` 链路统一处理

---

### 会话 9 — 2026-04-05：多项 Bug 修复 + 多角色代码审查

**背景：** 用户反馈4个问题：历史行情显示异常、AI分析超时、价格单位错误（¥3088/克）、AI助手无回复。进行全量代码审查，生成 `todolist.md`，共定位并修复 6 个 Bug。

| 操作 | 涉及文件 | 说明 |
|------|---------|------|
| 修复 `submitIdea` 超时 | `web/src/api/index.ts` | 默认实例 10s → 600000ms（10分钟） |
| 修复 AI 自定义端点超时 | `src/processors/ai/claude-client.ts` | callCustomEndpoint timeout 60s → 600000ms |
| 历史行情降级 | `src/api/server.ts` | Yahoo Finance 被墙时降级读本地 `prices_daily` |
| 强化 AI 价格单位约束 | `src/processors/ai/idea-analyzer.ts` | Prompt 明确禁止 USD/oz 输出；后处理自动纠正超阈值价格（entry/stopLoss/target > ¥2000 时按 USD/oz 换算） |
| 修复 AI 助手超时 | `web/src/api/index.ts` | chatWithAI timeout 60s → 600000ms |
| 新增日线 OHLCV 聚合 | `src/storage/dao.ts` | 新增 `upsertDailyOHLCV(date)` 函数 |
| 新增调度任务 | `src/scheduler/scheduler.ts` | 每日 00:05 运行 `scheduleDailyOHLCV()`，聚合昨日分钟数据写入 `prices_daily` |
| 修正 troy oz 换算系数 | `src/collectors/price/metalprice.collector.ts` | `32.1507` → `31.1035`（g/troy oz） |
| 历史行情增加重试按钮 | `web/src/components/HistoricalChart.vue` | 错误状态增加"重试"按钮，点击重新拉取 |
| AI 重试策略差异化 | `src/processors/ai/claude-client.ts` | idea/chat 类型 `maxAttempts=1`，后台批量任务保留3次重试 |
| 新增 `todolist.md` | 项目根目录 | 6项 Bug 清单，含根因分析、修复方案、完成状态 |

---

### 会话 10 — 2026-04-05：历史行情数据源替换（国内可访问）

**背景：** Yahoo Finance 在中国大陆被墙，`/api/price/historical` 始终 503，本地 `prices_daily` 也因未及时写入而为空，历史 K 线图完全无法使用。

**解决方案：** 替换 `historical.collector.ts`，改用两个国内稳定可访问的免费数据源：

| 数据源 | 接口 | 品种 | 价格单位 |
|--------|------|------|---------|
| **东方财富（主）** | `push2his.eastmoney.com/api/qt/stock/kline/get` | 上期所沪金主力 AU0 | CNY/g |
| **新浪财经（备）** | `money.finance.sina.com.cn/.../CN_MarketData.getKLineData` | SGE Au9999 现货 | CNY/g |

**涉及文件：**

| 文件 | 操作 |
|------|------|
| `src/collectors/price/historical.collector.ts` | **重写**：移除 Yahoo Finance，接入东方财富K线接口（主）+ 新浪财经（备），主源失败自动切换备源 |
| `web/src/components/HistoricalChart.vue` | Y轴标签从 `$` 改为 `¥`（价格单位由 USD/oz 改为 CNY/g） |

**东方财富 K 线接口参数：**
```
secid=113.AU0  (上期所沪金主力)
klt=101  (日K) / 102 (周K)
beg=YYYYMMDD  end=20991231
```
klines 字段顺序：`日期,开,收,高,低,量,额,振幅,涨幅,涨额,换手`

---

### 会话 11 — 2026-04-05：持仓删改操作 + 实时盈亏 Bug 修复

**背景：** 用户需要对历史持仓进行编辑和删除操作；同时发现实时盈亏显示异常（初始值为大幅负数）。

**Bug 根因（实时盈亏）：**
```javascript
// 旧代码：currentPrice=0 时，0 ?? x = 0（?? 只排除 null/undefined），
// 导致 pnl = (0 - cost) × grams = 巨额负数
const price = props.currentPrice ?? pos.buy_price_cny_g;

// 修复：用 computed activePrice + || 运算符
const activePrice = computed(() => props.currentPrice ?? 0);
const price = activePrice.value || pos.buy_price_cny_g;  // 0 也触发回退
```

**涉及文件：**

| 文件 | 操作 |
|------|------|
| `src/storage/dao.ts` | 新增 `deletePosition(id)` — 删除任意持仓记录；新增 `updatePosition(id, fields)` — 动态更新指定字段（开仓/平仓均支持）|
| `src/api/server.ts` | 新增 `PUT /api/positions/:id`（修改）和 `DELETE /api/positions/:id`（删除）两个端点 |
| `web/src/api/index.ts` | 新增 `updatePosition(id, fields)` 和 `deletePosition(id)` 前端接口 |
| `web/src/components/TradeLog.vue` | **重构**：修复 P&L Bug；每笔开仓卡片增加 ✏️编辑（内联展开表单）和 🗑️删除按钮；新增"历史持仓"区块，按需加载已平仓记录并支持逐条编辑/删除（平仓价修改后自动重算 `realized_pnl`）|
| `web/src/App.vue` | 移除冗余的 `tradeLogRef.updatePrice()` 调用（`cnyPrice` 已通过 prop 响应式传递，`computed activePrice` 替代手动更新）|

**新增持仓编辑字段：**
- 开仓持仓：买入价、克数、手续费、止损价、目标价、备注
- 历史持仓：买入价、平仓价、克数、买入/平仓手续费、备注（保存时重算 `realized_pnl`）

---

### 会话 12 — 2026-04-05：Bug 修复（DELETE CORS + 历史行情代理 503）

**问题 1：删除持仓 Network Error**
- 现象：`DELETE /api/positions/:id` 返回 Network Error
- 根因：CORS 中间件 `Access-Control-Allow-Methods` 只列了 `GET,POST,OPTIONS`，缺少 `DELETE` 和 `PUT`，导致预检请求被浏览器拒绝
- 修复：`src/api/server.ts` — 将 Allow-Methods 改为 `GET,POST,PUT,DELETE,OPTIONS`

**问题 2：历史行情 503 — Failed to fetch historical data**
- 现象：`GET /api/price/historical?range=1y` 返回 503，错误信息含 `127.0.0.1:7897`
- 根因：本地代理软件（端口 7897，Clash/V2Ray 等）截获了 axios 请求并返回 503，导致东方财富和新浪财经两个数据源均失败，本地 DB 回退也无数据
- 修复：`src/collectors/price/historical.collector.ts` — 两个 axios.get 调用均加 `proxy: false`，绕过系统代理直连

| 文件 | 操作 |
|------|------|
| `src/api/server.ts` | CORS `Allow-Methods` 补全 `PUT,DELETE` |
| `src/collectors/price/historical.collector.ts` | `fetchFromEastmoney` + `fetchFromSina` 两处 axios 加 `proxy: false` |

---

### 会话 8 — 2026-04-05：接入 Truth Social（Trump 原发帖）信息源

**用户需求：** 监听 Trump 在 Truth Social 的发帖，纳入黄金市场情报采集范围。

**技术方案：** Truth Social 基于 Mastodon（ActivityPub 协议），提供兼容 Mastodon 的公开 REST API，**无需登录**即可读取 `@realDonaldTrump` 的公开帖子。

**涉及文件：**

| 文件 | 操作 |
|------|------|
| `src/collectors/news/truthsocial.collector.ts` | **新建**：Truth Social 采集器 |
| `src/config/index.ts` | 新增 `truthSocialToken` 配置项 |
| `src/scheduler/scheduler.ts` | 每小时新闻采集中加入 `fetchTruthSocialPosts()` |
| `src/api/server.ts` | 新增 `GET /api/news/truthsocial` 实时拉取端点 |
| `web/src/api/index.ts` | 新增 `getTruthSocialPosts()` |
| `web/src/components/NewsStream.vue` | 新增 `🦅 Truth Social` 筛选器 + 来源徽章 |
| `.env.example` | 新增 `TRUTH_SOCIAL_BEARER_TOKEN` 说明 |

**采集器核心逻辑（`truthsocial.collector.ts`）：**

1. **账号 ID 解析**：首次调用时通过 `/api/v1/accounts/lookup?acct=realDonaldTrump` 获取账号 ID，缓存至进程内存，后续复用
2. **帖子拉取**：`/api/v1/accounts/{id}/statuses?limit=30&exclude_replies=true&exclude_reblogs=true`（只取原创帖，过滤回复和转发）
3. **HTML 正文清洗**：用 cheerio 将 Mastodon 返回的 HTML 内容提取为纯文本
4. **与黄金/宏观相关性预判**：匹配40+个关键词（tariff/china/dollar/fed/oil/war/sanctions/brics等），相关帖子预标记 `ai_impact=3`，不相关标记 `ai_impact=1`（AI评估时会覆盖）
5. **token 可选**：配置 `TRUTH_SOCIAL_BEARER_TOKEN` 可提升稳定性，不配置也能正常工作

**与黄金相关的关键词覆盖：**
> tariff, trade, China, dollar, Federal Reserve, interest rate, inflation, economy, sanction, war, oil, energy, gold, BRICS, currency, debt, treasury, bond, Iran, Russia, Ukraine, OPEC, SWIFT, Powell, FOMC, tax, budget, Mexico, Europe, NATO...

**容错设计：**
- 采集失败只记录 warning，不中断其他新闻源的采集（`Promise.allSettled`）
- 404/410 响应自动清除缓存的账号 ID，下次重新 lookup
- 指数退避重试（最多3次，基础延迟5秒）

**前端展示：**
- `🦅 Truth Social` 专属筛选按钮
- 来源为 `truthsocial:*` 的帖子显示绿色 `🦅 Truth` 徽章
- 帖子正文截取前200字作为标题，200-600字作为摘要

---

## Bug 修复记录

| 时间 | 错误 | 原因 | 修复 |
|------|------|------|------|
| 2026-04-05 | `SQLITE_ERROR` 启动失败 | `cot_report` 表同时声明两个 `PRIMARY KEY` | 改为 `date TEXT NOT NULL UNIQUE`，删除旧 DB 重建 |
| 2026-04-05 | `SignalPanel.vue` 500 Internal Server Error | Vue SFC Babel 不支持 `{map}[obj?.key ?? '']` | 改为 `const map={...}; return pos ? map[pos] : ''` |
| 2026-04-05 | `分析失败：timeout of 10000ms exceeded` | `submitIdea` 使用默认 axios 实例（10s） | `web/src/api/index.ts` submitIdea 超时改为 600000ms |
| 2026-04-05 | AI 自定义端点 timeout 60s 不足 | `claude-client.ts` callCustomEndpoint 写死 60000ms | 改为 600000ms（10 分钟） |
| 2026-04-05 | 历史行情 `/api/price/historical` 503 | Yahoo Finance 在国内被墙 | 失败时降级读取本地 `prices_daily` 表 |
| 2026-04-05 | AI 分析价格单位错误（¥3088/克 应为 ¥720/克） | GLM-4.7 将 USD/oz 数值误作 CNY/g 输出 | 加强 Prompt 单位约束 + 后处理自动检测并转换超阈值价格 |
| 2026-04-05 | AI 助手无回复 | `chatWithAI` 前端超时仅 60s | `web/src/api/index.ts` chatWithAI 超时改为 600000ms |
| 2026-04-05 | 历史行情降级后仍无数据 | `prices_daily` 表设计了但从未写入 | `dao.ts` 新增 `upsertDailyOHLCV()`，调度器每日 00:05 聚合日线 |
| 2026-04-05 | MetalpriceAPI troy oz 换算误差 3.4% | `metalprice.collector.ts` 用 32.1507（troy oz/kg）而非 31.1035（g/oz） | 修正为 31.1035 |
| 2026-04-05 | AI 重试3次总等待可达 30 分钟 | `withRetry maxAttempts=3` 对所有调用类型生效 | idea/chat 类型改为 `maxAttempts=1` |
| 2026-04-05 | 历史行情 K 线图无数据（降级后仍空白） | Yahoo Finance 被墙，本地 `prices_daily` 也未写入 | 替换为东方财富（主）+ 新浪财经（备）两个国内数据源 |
| 2026-04-05 | 持仓实时盈亏初始显示巨额负数 | `currentPrice=0` 时 `0 ?? cost = 0`，`??` 不触发回退，P&L = `(0-cost)×grams` | 改用 `computed activePrice` + `\|\|` 运算符，价格未到位显示"等待价格…" |

---

## AI 模型配置

| 配置项 | 值 |
|--------|-----|
| 主模型 | Claude Sonnet 4.6（Anthropic API） |
| 备用端点 | SiliconFlow `https://api.siliconflow.cn/v1` |
| 备用模型 | `Pro/zai-org/GLM-4.7`（OpenAI Chat Completions 兼容） |
| 切换逻辑 | 有 `ANTHROPIC_API_KEY` 时用 Claude，否则用自定义端点 |

---

## 各阶段完成情况

### Phase 0：项目初始化 ✅

| 任务 | 产出 |
|------|------|
| npm init + TypeScript | package.json / tsconfig.json / .eslintrc.json |
| 目录结构 | src/{collectors,processors,storage,api,push,scheduler,types,utils,config} |
| 核心依赖 | 31个生产依赖 + 开发依赖 |
| Logger | src/utils/logger.ts (winston + DailyRotateFile) |
| 错误处理/重试 | src/utils/retry.ts (withRetry + RateLimiter) |

### Phase 1：数据采集层 ✅

| 采集器 | 文件 |
|--------|------|
| MetalpriceAPI（主力） | src/collectors/price/metalprice.collector.ts |
| GoldAPI.io（备用） | src/collectors/price/goldapi.collector.ts |
| SGE爬虫（新浪+东财） | src/collectors/price/sge.collector.ts |
| 汇率采集 | src/collectors/price/exchange-rate.collector.ts |
| 多源聚合（加权中位数） | src/collectors/price/price-aggregator.ts |
| COMEX 库存 | src/collectors/inventory/comex-inventory.collector.ts |
| SHFE 库存 | src/collectors/inventory/shfe-inventory.collector.ts |
| ETF 持仓 | src/collectors/fund-flow/etf-holdings.collector.ts |
| CFTC COT | src/collectors/fund-flow/cftc-cot.collector.ts |
| FRED API（宏观） | src/collectors/macro/fred.collector.ts |
| Yahoo 宏观 | src/collectors/macro/yahoo-macro.collector.ts |
| RSS 新闻聚合 | src/collectors/news/rss.collector.ts |
| NewsAPI / Trump | src/collectors/news/newsapi.collector.ts |

### Phase 2：存储与数据处理层 ✅

- SQLite 9张表：prices / inventory / etf_holdings / cot_report / macro_data / news / alerts / open_positions / signals
- 技术指标：MA/EMA / MACD(12,26,9) / RSI(14) / 布林带(20,2σ) / KDJ / 支撑阻力 / 斐波那契

### Phase 3：AI 分析层 ✅

| 模块 | 文件 |
|------|------|
| Claude/自定义端点封装 | src/processors/ai/claude-client.ts |
| 新闻影响评估 | src/processors/ai/news-assessor.ts |
| 市场日报生成 | src/processors/ai/daily-brief.ts |
| 交易信号引擎（规则） | src/processors/ai/signal-engine.ts |
| 交易复盘 | src/processors/ai/trade-reviewer.ts |
| 想法工坊分析器 | src/processors/ai/idea-analyzer.ts |
| **AI 提示词每日总结** | **src/processors/ai/ai-summary.ts** ← 新增 |

### Phase 4：API 服务层 ✅

Express + WebSocket，共计 **20+ 个路由**：

- 价格：`/api/prices/latest` · `/api/prices/history`
- 信号：`/api/signals/latest` · `/api/signals/history`
- 持仓：`/api/positions` (CRUD) · `/api/positions/stats`
- 交易：`/api/trades` · `/api/trades/pnl`
- 市场：`/api/macro` · `/api/inventory` · `/api/etf` · `/api/news`
- 想法：`/api/ideas` (GET/POST)
- 运维：`/health`

### Phase 5：前端 Dashboard ✅

5-Tab 暗色主题（金色#D4AF37 + 深蓝黑#1a1a2e）：

| Tab | 组件 |
|-----|------|
| 🎯 交易信号 | SignalPanel + TradeLog(紧凑) |
| 💰 我的持仓 | TradeLog(全宽) |
| 🔍 复盘分析 | ReviewPanel |
| 📈 市场行情 | PriceChart + MacroDashboard + ETFPanel + HistoricalChart |
| 📰 情报中心 | NewsStream + InventoryPanel + StrategyPanel + IdeaWorkshop |

### Phase 6：推送与告警 ✅

| 通道 | 文件 | 触发条件 |
|------|------|---------|
| 邮件(SMTP) | src/push/email.ts | 信号/亏损/日报 |
| 钉钉(Webhook) | src/push/dingtalk.ts | 信号/亏损/日报 |
| Telegram(Bot) | src/push/telegram.ts | 信号/亏损/日报 |

### Phase 7：调度与运维 ✅

| 频率 | 任务 |
|------|------|
| 每1分钟 | 价格采集 + WebSocket广播 |
| 每5分钟 | 宏观指标 + **持仓止损监控** |
| 每15分钟 | FRED + COMEX期货 |
| 每30分钟 | **交易信号推送** |
| 每1小时 | 新闻采集 + AI评估 |
| 每日 02:00 | **AI提示词归纳总结** ← 新增 |
| 每日 06:00 | 库存 + ETF更新 |
| 每日 22:00 | AI市场日报 |
| 每日 03:00 | 数据清理 |
| 每周六 10:00 | CFTC COT |

### Phase 8：测试与文档 ✅

- 技术指标单元测试：11/11 ✅
- README.md、.env.example 完整

---

## 项目统计

| 指标 | 数值 |
|------|------|
| TypeScript 文件 | ~52个 |
| Vue 组件 | 12个（新增 AIChat） |
| API 路由 | 22+（新增 /ai/chat · /ai/summaries） |
| 调度任务 | 13个（新增 日线OHLCV聚合） |
| 数据库表 | 13张（新增 ai_interaction_log · ai_daily_summary） |
| 数据源 | 15+ |
| 推送通道 | 3个（邮件/钉钉/Telegram） |
| AI 数据源（想法分析） | 8个并发 |
| AI contextType 分类 | 6种（daily_brief/news_assessment/idea/trade_review/chat/summary） |
| 测试通过 | 11/11 ✅ |
| 前端构建 | 682 modules，~600ms ✅ |

---

## 部署指南

### 配置 `.env`

```env
# 价格 API（至少配一个）
GOLDAPI_KEY=xxx
METALS_API_KEY=xxx
FRED_API_KEY=xxx

# AI 后端（二选一）
ANTHROPIC_API_KEY=xxx
# 或自定义端点
CUSTOM_AI_BASE_URL=https://api.siliconflow.cn/v1
CUSTOM_AI_MODEL=Pro/zai-org/GLM-4.7
CUSTOM_AI_KEY=xxx

# 邮件推送
SMTP_HOST=smtp.qq.com
SMTP_PORT=465
SMTP_USER=your@qq.com
SMTP_PASS=your_app_password   # QQ邮箱用授权码
EMAIL_TO=recipient@email.com

# 钉钉推送
DINGTALK_WEBHOOK=https://oapi.dingtalk.com/robot/send?access_token=xxx

# Telegram（可选）
TELEGRAM_BOT_TOKEN=xxx
TELEGRAM_CHAT_ID=xxx
```

### PM2 持久运行

```bash
npm run build            # 编译后端
cd web && npm run build  # 编译前端
pm2 start ecosystem.config.js
pm2 save                 # 开机自启
pm2 logs gold-sentinel   # 查看日志
```

### 访问

- 前端：http://localhost:5173
- 后端 API：http://localhost:3000
- 健康检查：http://localhost:3000/health

---

## API Keys 注册

| API | 免费额度 | 说明 |
|-----|---------|------|
| GoldAPI.io | 无限制（Google登录） | 实时 XAU/XAG，推荐备用源 |
| MetalpriceAPI | 100次/月 | XAU/USD + XAU/CNY，推荐主力源 |
| FRED API | 无限制（仅需邮箱） | 美联储官方数据，强烈推荐 |
| NewsAPI | 500次/天 | 开发者免费层 |
| ExchangeRate-API | 1500次/月 | 汇率数据 |

> 最快启动：先注册 GoldAPI.io（30秒）+ FRED（填邮箱），即可运行价格采集和宏观数据。
