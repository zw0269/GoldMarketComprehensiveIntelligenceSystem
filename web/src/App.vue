<template>
  <div class="app">
    <!-- ── Header ── -->
    <header class="header">
      <div class="brand">
        <span class="logo">🥇</span>
        <span class="name">Gold Sentinel</span>
      </div>

      <!-- 实时价格 -->
      <div class="price-hero" v-if="latestPrice">
        <span class="price-cny">¥{{ latestPrice.xau_cny_g?.toFixed(2) }}/g</span>
        <span class="price-usd">(${{ latestPrice.xau_usd?.toFixed(2) }}/oz)</span>
        <span class="price-change" :class="priceChangeClass">{{ priceChangeStr }}</span>
        <span class="sge-tag" v-if="latestPrice.sge_premium">
          SGE溢价{{ latestPrice.sge_premium > 0 ? '+' : '' }}${{ latestPrice.sge_premium?.toFixed(1) }}
        </span>
      </div>

      <!-- AI 后端 -->
      <div class="ai-tag" v-if="aiBackend">
        🤖 {{ aiBackend.type === 'custom' ? aiBackend.model : 'Claude' }}
      </div>

      <!-- WS 状态 -->
      <div class="ws-dot" :class="wsConnected ? 'on' : 'off'"
        :title="wsConnected ? '实时连接中' : '离线'">
        {{ wsConnected ? '● 实时' : '○ 离线' }}
      </div>
    </header>

    <!-- ── Tab 导航 ── -->
    <nav class="tab-nav">
      <button
        v-for="tab in tabs" :key="tab.id"
        class="tab-btn"
        :class="{ active: activeTab === tab.id }"
        @click="activeTab = tab.id"
      >
        {{ tab.icon }} {{ tab.label }}
      </button>
    </nav>

    <!-- ── Tab 内容 ── -->
    <main class="tab-body">

      <!-- Tab 1：交易信号 -->
      <div v-show="activeTab === 'signal'" class="tab-pane">
        <div class="pane-grid signal-grid">
          <section class="panel">
            <h2>🎯 积存金交易信号</h2>
            <SignalPanel @position-opened="onPositionOpened" />
          </section>
          <section class="panel">
            <h2>📊 实时持仓概览</h2>
            <TradeLog ref="tradeLogRef" :current-price="cnyPrice" compact />
          </section>
        </div>
      </div>

      <!-- Tab 2：我的持仓 -->
      <div v-show="activeTab === 'position'" class="tab-pane">
        <div class="pane-single">
          <section class="panel">
            <h2>💰 我的持仓 · 实时盈亏追踪</h2>
            <TradeLog ref="tradeLogFullRef" :current-price="cnyPrice" />
          </section>
        </div>
      </div>

      <!-- Tab 3：复盘分析 -->
      <div v-show="activeTab === 'review'" class="tab-pane">
        <div class="pane-single">
          <section class="panel">
            <h2>🔍 交易复盘 · AI策略优化</h2>
            <ReviewPanel ref="reviewRef" />
          </section>
        </div>
      </div>

      <!-- Tab 4：市场行情 -->
      <div v-show="activeTab === 'market'" class="tab-pane">
        <div class="pane-grid market-grid">
          <section class="panel span2">
            <h2>📈 价格走势</h2>
            <PriceChart :data="priceHistory" />
          </section>
          <section class="panel">
            <h2>🌐 宏观面板</h2>
            <MacroDashboard :data="macroDashboard" />
          </section>
          <section class="panel">
            <h2>💸 资金流向</h2>
            <ETFPanel :data="etfData" />
          </section>
          <section class="panel span2">
            <h2>📊 黄金历史行情</h2>
            <HistoricalChart />
          </section>
        </div>
      </div>

      <!-- Tab 5：情报中心 -->
      <div v-show="activeTab === 'intel'" class="tab-pane">
        <div class="pane-grid intel-grid">
          <section class="panel span2">
            <h2>📰 新闻情报流</h2>
            <NewsStream :news="latestNews" />
          </section>
          <section class="panel">
            <h2>🏦 库存追踪</h2>
            <InventoryPanel :data="inventoryData" />
          </section>
          <section class="panel">
            <h2>💡 策略与想法</h2>
            <StrategyPanel />
          </section>
          <section class="panel span2">
            <h2>🧠 想法工坊 · AI 分析</h2>
            <IdeaWorkshop />
          </section>
        </div>
      </div>

      <!-- Tab 6：AI 助手 -->
      <div v-show="activeTab === 'aichat'" class="tab-pane">
        <div class="pane-single ai-chat-pane">
          <section class="panel">
            <h2>🤖 AI 助手 · 基于实时市场数据问答</h2>
            <AIChat />
          </section>
        </div>
      </div>

    </main>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue';
import { api, createWSConnection } from './api';

import PriceChart     from './components/PriceChart.vue';
import MacroDashboard from './components/MacroDashboard.vue';
import InventoryPanel from './components/InventoryPanel.vue';
import ETFPanel       from './components/ETFPanel.vue';
import NewsStream     from './components/NewsStream.vue';
import StrategyPanel  from './components/StrategyPanel.vue';
import HistoricalChart from './components/HistoricalChart.vue';
import IdeaWorkshop   from './components/IdeaWorkshop.vue';
import SignalPanel    from './components/SignalPanel.vue';
import TradeLog       from './components/TradeLog.vue';
import ReviewPanel    from './components/ReviewPanel.vue';
import AIChat         from './components/AIChat.vue';

// ── Tab 定义 ──
const tabs = [
  { id: 'signal',   icon: '🎯', label: '交易信号' },
  { id: 'position', icon: '💰', label: '我的持仓' },
  { id: 'review',   icon: '🔍', label: '复盘分析' },
  { id: 'market',   icon: '📈', label: '市场行情' },
  { id: 'intel',    icon: '📰', label: '情报中心' },
  { id: 'aichat',   icon: '🤖', label: 'AI 助手' },
];
const activeTab = ref('signal');

// ── 数据 ──
const latestPrice    = ref<Record<string, number> | null>(null);
const prevPrice      = ref<number | null>(null);
const priceHistory   = ref<unknown[]>([]);
const macroDashboard = ref<Record<string, number>>({});
const inventoryData  = ref<Record<string, unknown>>({});
const etfData        = ref<Record<string, unknown>>({});
const latestNews     = ref<unknown[]>([]);
const wsConnected    = ref(false);
const aiBackend      = ref<{ type: string; model: string } | null>(null);
const cnyPrice       = ref(0);

const tradeLogRef     = ref<InstanceType<typeof TradeLog> | null>(null);
const tradeLogFullRef = ref<InstanceType<typeof TradeLog> | null>(null);
const reviewRef       = ref<InstanceType<typeof ReviewPanel> | null>(null);

// ── 价格变化计算 ──
const priceChangeStr = computed(() => {
  if (!latestPrice.value || !prevPrice.value) return '';
  const c = latestPrice.value['xau_cny_g'] - prevPrice.value;
  const p = ((c / prevPrice.value) * 100).toFixed(2);
  return `${c >= 0 ? '▲' : '▼'} ¥${Math.abs(c).toFixed(2)} (${Math.abs(Number(p))}%)`;
});
const priceChangeClass = computed(() => {
  if (!latestPrice.value || !prevPrice.value) return '';
  return latestPrice.value['xau_cny_g'] >= prevPrice.value ? 'up' : 'down';
});

function onPositionOpened() {
  tradeLogRef.value?.reload();
  tradeLogFullRef.value?.reload();
  activeTab.value = 'position';
}

let ws: { close: () => void } | null = null;

onMounted(async () => {
  api.getAIBackend().then(d => { aiBackend.value = d as typeof aiBackend.value; }).catch(() => {});

  const [price, history, macro, inventory, etf, news] = await Promise.allSettled([
    api.getLatestPrice(),
    api.getPriceHistory('1h', 7),
    api.getMacroDashboard(),
    api.getInventoryCompare(),
    api.getETFHoldings(),
    api.getLatestNews(50),
  ]);

  if (price.status     === 'fulfilled') {
    latestPrice.value = price.value as Record<string, number>;
    cnyPrice.value    = (price.value as Record<string, number>)['xau_cny_g'] ?? 0;
    prevPrice.value   = cnyPrice.value;
  }
  if (history.status   === 'fulfilled') priceHistory.value   = ((history.value as { data?: unknown[] }).data) ?? [];
  if (macro.status     === 'fulfilled') macroDashboard.value = macro.value as Record<string, number>;
  if (inventory.status === 'fulfilled') inventoryData.value  = inventory.value as Record<string, unknown>;
  if (etf.status       === 'fulfilled') etfData.value        = etf.value as Record<string, unknown>;
  if (news.status      === 'fulfilled') latestNews.value     = news.value as unknown[];

  ws = createWSConnection((msg) => {
    wsConnected.value = true;

    if (msg['type'] === 'PRICE') {
      const p = msg['data'] as Record<string, number>;
      prevPrice.value   = latestPrice.value?.['xau_cny_g'] ?? null;
      latestPrice.value = p;
      if (p['xau_cny_g']) {
        cnyPrice.value = p['xau_cny_g'];
        tradeLogRef.value?.updatePrice(p['xau_cny_g']);
        tradeLogFullRef.value?.updatePrice(p['xau_cny_g']);
      }
    }
    if (msg['type'] === 'NEWS') {
      latestNews.value = [msg['data'], ...latestNews.value.slice(0, 49)];
    }
    if (msg['type'] === 'POSITION_OPENED' || msg['type'] === 'POSITION_CLOSED') {
      tradeLogRef.value?.reload();
      tradeLogFullRef.value?.reload();
    }
    if (msg['type'] === 'REVIEW_READY') {
      const d = msg['data'] as { id: number; review: Record<string, unknown> };
      reviewRef.value?.onReviewReady(
        d.id,
        d.review as unknown as Parameters<NonNullable<typeof reviewRef.value>['onReviewReady']>[1]
      );
      reviewRef.value?.reload();
    }
  });
});

onUnmounted(() => { ws?.close(); });
</script>

<style>
:root {
  --gold: #D4AF37;
  --dark: #0d0d1a;
  --panel: #1a1a2e;
  --border: #2a2a4a;
  --green: #00C853;
  --red: #FF1744;
  --text: #e0e0e0;
  --dim: #888;
}
* { box-sizing: border-box; margin: 0; padding: 0; }
body { background: var(--dark); color: var(--text); font-family: 'JetBrains Mono', monospace, sans-serif; }

/* ── Header ── */
.app   { min-height: 100vh; display: flex; flex-direction: column; }
.header {
  display: flex; align-items: center; gap: 16px;
  padding: 10px 20px; background: var(--panel); border-bottom: 1px solid var(--border);
  position: sticky; top: 0; z-index: 100;
}
.brand   { display: flex; align-items: center; gap: 8px; }
.logo    { font-size: 22px; }
.name    { font-size: 16px; font-weight: 800; color: var(--gold); }
.price-hero { display: flex; align-items: center; gap: 10px; margin-left: auto; }
.price-cny  { font-size: 20px; font-weight: 800; color: var(--gold); }
.price-usd  { font-size: 12px; color: var(--dim); }
.price-change { font-size: 13px; font-weight: 700; }
.price-change.up   { color: var(--green); }
.price-change.down { color: var(--red); }
.sge-tag { font-size: 11px; color: var(--gold); opacity: 0.8; }
.ai-tag  { font-size: 11px; color: var(--dim); border: 1px solid var(--border); padding: 2px 8px; border-radius: 10px; }
.ws-dot  { font-size: 12px; }
.ws-dot.on  { color: var(--green); }
.ws-dot.off { color: var(--dim); }

/* ── Tab 导航 ── */
.tab-nav {
  display: flex; gap: 0; background: var(--panel);
  border-bottom: 2px solid var(--border);
  padding: 0 20px;
}
.tab-btn {
  padding: 12px 20px; border: none; background: transparent;
  color: var(--dim); font-size: 13px; font-family: inherit;
  cursor: pointer; border-bottom: 2px solid transparent;
  margin-bottom: -2px; transition: all 0.15s;
  white-space: nowrap;
}
.tab-btn:hover { color: var(--text); }
.tab-btn.active { color: var(--gold); border-bottom-color: var(--gold); font-weight: 700; }

/* ── Tab 内容区 ── */
.tab-body { flex: 1; overflow-y: auto; }
.tab-pane { padding: 16px 20px; }

/* ── Panel 通用 ── */
.panel { background: var(--panel); border: 1px solid var(--border); border-radius: 8px; padding: 16px; }
.panel h2 { font-size: 13px; color: var(--gold); margin-bottom: 12px; font-weight: 600; }

/* ── Grid 布局 ── */
.pane-single { max-width: 1000px; }
.pane-grid   { display: grid; gap: 12px; }
.span2 { grid-column: 1 / -1; }

/* Tab1: 信号 + 持仓并排 */
.signal-grid { grid-template-columns: 1fr 420px; }

/* Tab4: 市场行情 2列 */
.market-grid { grid-template-columns: 1fr 1fr; }

/* Tab5: 情报中心 2列 */
.intel-grid { grid-template-columns: 1fr 1fr; }

/* Tab6: AI 助手 */
.ai-chat-pane { max-width: 860px; }

/* 响应式 */
@media (max-width: 900px) {
  .signal-grid, .market-grid, .intel-grid { grid-template-columns: 1fr; }
  .span2 { grid-column: 1; }
  .tab-btn { padding: 10px 12px; font-size: 12px; }
}
</style>
