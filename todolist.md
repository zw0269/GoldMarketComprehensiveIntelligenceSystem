# Gold Sentinel — 问题清单 & 修复计划

> 生成时间：2026-04-05
> 评审角色：项目经理 · 架构师 · 前端工程师 · 数据库工程师 · 测试工程师
> 参考文档：log.md · 全量源码审查

---

## 状态说明

| 标记 | 含义 |
|------|------|
| 🔴 P0 | 阻塞性 Bug，用户可见功能完全失效 |
| 🟠 P1 | 重要 Bug，功能部分失效或数据错误 |
| 🟡 P2 | 体验缺陷，不影响核心功能 |
| 🟢 优化 | 架构/代码质量改进 |
| ✅ | 已完成 |
| 🚧 | 进行中 |
| ⬜ | 待处理 |

---

## 问题清单

### BUG-01 🔴 P0 — AI分析价格单位错误（显示 ¥3088/克 而非 ¥720/克）

**现象**：想法工坊 AI 分析输出中，`entry`/`stopLoss`/`target` 价格显示约 ¥3088/克，比实际价格（约 ¥720/克）高 4 倍以上。

**根因**：AI 模型（GLM-4.7）在 Prompt 中同时看到 `$3100/oz` 和 `¥720/g` 两种单位，输出 entry 时误用了 USD/oz 数值（$3088≈当前国际金价）而非 CNY/g，导致价格单位混淆。

**涉及文件**：`src/processors/ai/idea-analyzer.ts`

**修复方案**：
1. 在 SYSTEM_PROMPT 中强化单位约束，明确禁止 USD/oz 输出
2. 在 Prompt 的市场数据部分突出当前 CNY/g 参考价
3. 在输出后处理中增加单位自动纠正：若 entry > currentPrice×2，按 `entry * usdCny / 31.1035` 转换

**状态**：✅ 已完成

---

### BUG-02 🔴 P0 — AI 助手（chatWithAI）前端超时仅 60s，无法收到回复

**现象**：AI 助手 Tab 发送问题后长时间无响应，报 timeout 错误。

**根因**：`web/src/api/index.ts` 第 45 行 `chatWithAI` 的 axios timeout 为 60000ms（60秒），而 siliconflow GLM-4.7 响应时间常超过 60 秒。

**涉及文件**：`web/src/api/index.ts`

**修复方案**：将 chatWithAI timeout 从 60000 改为 600000（10 分钟）

**状态**：✅ 已完成

---

### BUG-03 🔴 P0 — `prices_daily` 表从未写入，历史行情降级方案实际无效

**现象**：历史行情接口（`/api/price/historical`）Yahoo Finance 被墙后降级使用本地 `prices_daily` 表，但该表始终为空，图表依然无数据。

**根因**：`src/storage/database.ts` 中定义了 `prices_daily` 表，但整个代码库中没有任何写入该表的代码。

**涉及文件**：`src/storage/dao.ts`、`src/scheduler/scheduler.ts`

**修复方案**：在调度器中添加每日 00:05 运行的日线聚合任务，从 `prices` 分钟表聚合 OHLCV 日线数据并写入 `prices_daily`。

**状态**：✅ 已完成

---

### BUG-04 🟠 P1 — `metalprice.collector.ts` 中 troy oz 换算系数错误

**现象**：MetalpriceAPI 采集器返回的 `xauCny` 字段换算系数用了 `32.1507`（troy oz/kg，不是 g/oz），正确值为 `31.1035`（g/troy oz）。误差约 3.4%。

**根因**：代码第 47 行：`xauCny: xauCny / 32.1507` 应为 `xauCny / 31.1035`。

**说明**：`price-aggregator.ts` 中不使用此 `xauCny` 字段做聚合，仅用 `xauUsd`，所以不影响最终 DB 中的 `xau_cny_g` 值，但该字段本身是错的，存在潜在隐患。

**涉及文件**：`src/collectors/price/metalprice.collector.ts`

**状态**：✅ 已完成

---

### BUG-05 🟡 P2 — 历史行情图出错时无重试按钮，用户体验差

**现象**：`HistoricalChart.vue` 在数据加载失败时只显示文字 "⚠️ 获取历史数据失败，请稍后重试"，没有可点击的重试按钮。

**涉及文件**：`web/src/components/HistoricalChart.vue`

**修复方案**：在错误提示旁添加"重试"按钮，点击后重新调用 `loadData()`。

**状态**：✅ 已完成

---

### BUG-06 🟡 P2 — withRetry 最大3次重试导致AI请求理论上累计等待30分钟

**现象**：`callClaude` 中 `withRetry` 设置 `maxAttempts: 3`，单次 AI 超时 10 分钟，若3次都超时总等待可达 30 分钟以上，体验极差。

**根因**：`claude-client.ts` 中 withRetry 的 maxAttempts 未针对不同调用场景差异化配置。

**涉及文件**：`src/processors/ai/claude-client.ts`，`src/processors/ai/idea-analyzer.ts`

**修复方案**：为 idea 和 chat 类型的 AI 调用设置 `maxAttempts: 1`（不重试），仅对 news_assessment / daily_brief 等后台批量任务保留重试。

**状态**：✅ 已完成

---

## 修复进度汇总

| ID | 问题 | 优先级 | 状态 |
|----|------|--------|------|
| BUG-01 | AI分析价格单位错误 ¥3088→¥720 | 🔴 P0 | ✅ |
| BUG-02 | AI助手超时60s无回复 | 🔴 P0 | ✅ |
| BUG-03 | prices_daily空表，历史行情降级无效 | 🔴 P0 | ✅ |
| BUG-04 | troy oz换算系数32.1507错误 | 🟠 P1 | ✅ |
| BUG-05 | 历史行情无重试按钮 | 🟡 P2 | ✅ |
| BUG-06 | AI重试3次累计超30分钟 | 🟡 P2 | ✅ |

---

*本文档由多角色代码审查自动生成，每次修复完成后同步更新状态。*
