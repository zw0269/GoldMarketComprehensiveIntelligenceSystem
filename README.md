# 🥇 Gold Sentinel — 黄金市场全景情报系统

> 个人版机构级黄金情报中枢 | 开源 · 自托管 · 为中国投资者定制

## 功能概览

打开 Gold Sentinel，5秒内回答三个问题：
1. **现在**：金价多少？涨还是跌？幅度？
2. **为什么**：哪些因素在驱动？（ETF流入？Trump发推？非农数据？）
3. **接下来**：关键支撑/阻力位在哪？库存信号？持仓结构？

## 系统架构

```
数据采集层 → 数据处理层 → 存储层(SQLite) → REST API + WebSocket → Vue 3 Dashboard
                ↓
           AI 分析层 (Claude API) → 新闻评估 + 市场日报
                ↓
           推送层 (钉钉/Telegram/邮件)
```

## 技术栈

| 层级 | 技术 |
|------|------|
| 后端运行时 | Node.js 20+ / TypeScript |
| 数据库 | SQLite (better-sqlite3) |
| 调度 | node-cron |
| HTTP | axios + cheerio |
| WebSocket | ws |
| AI 分析 | Anthropic Claude API |
| 前端 | Vue 3 + Vite + ECharts |
| 推送 | 钉钉 + Telegram Bot |

## 快速开始

### 1. 安装依赖

```bash
# 后端
npm install

# 前端
cd web && npm install
```

### 2. 配置环境变量

```bash
cp .env.example .env
# 编辑 .env，填写必要的 API Keys
```

**必填配置：**
- `METALPRICE_API_KEY` 或 `GOLDAPI_KEY` — 至少一个价格源
- `FRED_API_KEY` — 宏观数据（免费申请）

**可选配置：**
- `ANTHROPIC_API_KEY` — AI 新闻评估和日报生成
- `DINGTALK_WEBHOOK` / `TELEGRAM_BOT_TOKEN` — 推送告警

### 3. 启动服务

```bash
# 开发模式（热重载）
npm run dev

# 前端开发服务
cd web && npm run dev

# 生产模式（需先构建）
npm run build
npm start

# PM2 进程管理
pm2 start ecosystem.config.js
```

### 4. 访问 Dashboard

- 前端: http://localhost:5173
- API: http://localhost:3000
- 健康检查: http://localhost:3000/health

## API 文档

| Method | Path | 说明 |
|--------|------|------|
| GET | /api/price/latest | 最新金价 |
| GET | /api/price/history?tf=1m&days=7 | 历史K线 |
| GET | /api/inventory/comex | COMEX库存 |
| GET | /api/inventory/compare | 三地库存对比 |
| GET | /api/etf/holdings | ETF持仓 |
| GET | /api/macro/dashboard | 宏观指标 |
| GET | /api/news/latest | 最新新闻+AI评估 |
| GET | /api/news/trump | Trump发言 |
| GET | /api/premium/sge | SGE溢价 |
| GET | /api/ratio/gold-silver | 金银比 |
| GET | /api/alerts/history | 告警历史 |
| WS | /ws | 实时价格推送 |

## 数据源

| 数据 | 来源 | 频率 |
|------|------|------|
| 国际金价 XAU/USD | MetalpriceAPI / GoldAPI.io | 1分钟 |
| 上金所 Au99.99 | 新浪财经 / 东方财富 | 5分钟 |
| USD/CNY 汇率 | 新浪财经 / exchangerate-api | 15分钟 |
| COMEX期货 | Yahoo Finance | 15分钟 |
| 宏观指标 DXY/VIX | Yahoo Finance | 5分钟 |
| 美债/TIPS/CPI | FRED API | 日更 |
| COMEX库存 | CME Group | 日更 |
| SHFE库存 | 上期所官网 | 周更 |
| ETF持仓 GLD/IAU | SPDR/iShares | 日更 |
| CFTC COT报告 | CFTC官网 | 周更 |
| 新闻 | NewsAPI + RSS (Kitco/Reuters) | 1小时 |

## 调度计划

| 时间 | 任务 |
|------|------|
| 每1分钟 | 价格采集 + WebSocket推送 |
| 每5分钟 | SGE价格 / 汇率 |
| 每15分钟 | 宏观指标 (DXY/VIX/期货) |
| 每1小时 | 新闻聚合 + AI评估 |
| 每日06:00 | 库存数据 + ETF持仓 |
| 每日22:00 | AI市场日报生成+推送 |
| 每周六10:00 | CFTC COT报告 |
| 每月1日 | LBMA库存 + 央行购金 |

## 运行测试

```bash
npm test
```

## 部署

### 本地部署

```bash
npm run build
pm2 start ecosystem.config.js
```

### VPS 部署

1. 安装 Node.js 20+、PM2
2. 上传项目文件
3. 配置 `.env`
4. `pm2 start ecosystem.config.js`

## 许可证

MIT
