<template>
  <div class="forward-indicators">
    <div class="fi-header">
      <span class="fi-title">前瞻三指标</span>
      <span class="fi-sub">外围风向标 · 30分钟更新</span>
      <button class="fi-refresh" :disabled="loading" @click="load">⟳</button>
    </div>

    <div v-if="loading" class="fi-loading">数据加载中...</div>
    <div v-else-if="error" class="fi-error">{{ error }}</div>

    <div v-else class="fi-grid">

      <!-- ①美国10年期国债 -->
      <div class="fi-card" :class="tnxClass">
        <div class="fi-card-label">① 美10年期国债收益率</div>
        <div class="fi-card-value">
          {{ data?.tnx?.value != null ? data.tnx.value.toFixed(3) + '%' : '—' }}
        </div>
        <div class="fi-card-rule">
          <span class="rule-tag">
            <span v-if="data?.tnx?.signal === 'risk_on_fear'" class="tag-warn">⚠ &gt;4.4% 危险</span>
            <span v-else-if="data?.tnx?.signal === 'defensive_flow'" class="tag-ok">✅ &lt;4.3% 防守</span>
            <span v-else class="tag-neutral">— 中性</span>
          </span>
        </div>
        <div class="fi-card-interp">{{ data?.tnx?.interpretation }}</div>
        <div class="fi-card-formula">傻瓜公式：&gt;4.4% 看科技暴跌 / &lt;4.3% 买防守</div>
      </div>

      <!-- ②五角大楼披萨指数 -->
      <div class="fi-card" :class="pizzaClass">
        <div class="fi-card-label">② 五角大楼披萨指数（军事活动）</div>
        <div class="fi-card-value-row">
          <span class="fi-card-value">{{ pizza?.score ?? '—' }}</span>
          <span class="fi-unit">/100</span>
          <span class="pizza-gauge">
            <span
              class="gauge-bar"
              :style="{ width: (pizza?.score ?? 0) + '%', background: pizzaGaugeColor }"
            ></span>
          </span>
        </div>
        <div class="fi-card-rule">
          <span class="rule-tag">
            <span v-if="pizza?.alertLevel === 'critical'" class="tag-critical">🔴 指数&gt;60 大事酝酿</span>
            <span v-else-if="pizza?.alertLevel === 'warning'" class="tag-warn">🟠 指数&gt;40 需警惕</span>
            <span v-else-if="pizza?.alertLevel === 'caution'" class="tag-caution">🟡 略有上升</span>
            <span v-else class="tag-ok">🟢 正常水平</span>
          </span>
        </div>
        <div class="fi-card-interp">{{ pizza?.interpretation }}</div>
        <div class="fi-card-formula">阈值：&gt;40 警惕 / &gt;60 立即布局最防守品种</div>
        <div class="fi-update" v-if="pizza?.updatedAt">
          更新: {{ formatAge(pizza.updatedAt) }}
        </div>
      </div>

      <!-- ③Polymarket -->
      <div class="fi-card poly-card">
        <div class="fi-card-label">③ Polymarket 全球聪明钱押注</div>
        <div class="fi-card-formula">真金白银押注概率，比新闻更提前反映预期</div>
        <div class="poly-list" v-if="polymarkets.length">
          <div
            class="poly-item"
            v-for="m in polymarkets"
            :key="m.question"
          >
            <span class="poly-pct" :class="probClass(m.yesPct)">{{ m.yesPct }}%</span>
            <span class="poly-q">{{ m.question }}</span>
            <span class="poly-vol">{{ formatVol(m.volume24h) }}</span>
          </div>
        </div>
        <div class="fi-empty" v-else>暂无数据，等待采集...</div>
        <div class="fi-update" v-if="data?.polymarket?.updatedAt">
          更新: {{ formatAge(data.polymarket.updatedAt) }}
        </div>
      </div>

    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { api } from '../api';

interface TNXData {
  value: number | null;
  signal: 'risk_on_fear' | 'defensive_flow' | 'neutral' | 'unknown';
  interpretation: string;
}
interface PizzaData {
  score: number;
  alertLevel: 'normal' | 'caution' | 'warning' | 'critical';
  interpretation: string;
  updatedAt: number;
}
interface PolyItem {
  question: string;
  yesPct: number;
  volume24h: number;
}
interface ForwardData {
  tnx: TNXData;
  pentagonPizza: PizzaData | null;
  polymarket: { markets: PolyItem[]; updatedAt: number | null };
}

const data    = ref<ForwardData | null>(null);
const loading = ref(false);
const error   = ref('');

const pizza = computed(() => data.value?.pentagonPizza ?? null);
const polymarkets = computed(() =>
  (data.value?.polymarket?.markets ?? [])
    .sort((a, b) => b.volume24h - a.volume24h)
    .slice(0, 12)
);

const tnxClass = computed(() => {
  const s = data.value?.tnx?.signal;
  if (s === 'risk_on_fear')    return 'card-warn';
  if (s === 'defensive_flow')  return 'card-ok';
  return '';
});

const pizzaClass = computed(() => {
  const lv = pizza.value?.alertLevel;
  if (lv === 'critical') return 'card-critical';
  if (lv === 'warning')  return 'card-warn';
  if (lv === 'caution')  return 'card-caution';
  return '';
});

const pizzaGaugeColor = computed(() => {
  const s = pizza.value?.score ?? 0;
  if (s >= 60) return '#FF1744';
  if (s >= 40) return '#FF6D00';
  if (s >= 20) return '#FFD740';
  return '#00C853';
});

function probClass(pct: number) {
  if (pct >= 70) return 'prob-high';
  if (pct >= 50) return 'prob-mid';
  return 'prob-low';
}

function formatVol(v: number): string {
  if (v >= 1e6) return `$${(v / 1e6).toFixed(1)}M`;
  if (v >= 1000) return `$${Math.round(v / 1000)}K`;
  return `$${Math.round(v)}`;
}

function formatAge(ts: number): string {
  const min = Math.round((Date.now() - ts) / 60000);
  if (min < 60) return `${min}分钟前`;
  return `${Math.floor(min / 60)}小时前`;
}

async function load() {
  loading.value = true;
  error.value   = '';
  try {
    data.value = await api.getForwardIntel() as ForwardData;
  } catch (e) {
    error.value = '前瞻指标加载失败，请稍后重试';
    console.error('[ForwardIndicators]', e);
  } finally {
    loading.value = false;
  }
}

onMounted(load);
</script>

<style scoped>
.forward-indicators {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

/* ── 头部 ── */
.fi-header {
  display: flex;
  align-items: center;
  gap: 8px;
}
.fi-title  { font-size: 13px; font-weight: 700; color: #D4AF37; }
.fi-sub    { font-size: 10px; color: #555; }
.fi-refresh {
  margin-left: auto;
  padding: 2px 8px;
  border-radius: 4px;
  border: 1px solid #2a2a4a;
  background: transparent;
  color: #888;
  font-size: 13px;
  cursor: pointer;
}
.fi-refresh:hover:not(:disabled) { border-color: #555; color: #ccc; }
.fi-refresh:disabled { opacity: 0.4; cursor: not-allowed; }

.fi-loading, .fi-error, .fi-empty {
  font-size: 11px;
  color: #555;
  padding: 8px 0;
}
.fi-error { color: #FF6D00; }

/* ── 卡片网格 ── */
.fi-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
}
.poly-card { grid-column: 1 / -1; }

/* ── 单卡片 ── */
.fi-card {
  background: rgba(255,255,255,0.03);
  border: 1px solid #2a2a4a;
  border-radius: 6px;
  padding: 10px 12px;
  display: flex;
  flex-direction: column;
  gap: 5px;
  transition: border-color 0.2s;
}
.fi-card.card-warn     { border-color: #FF6D00; background: rgba(255,109,0,0.06); }
.fi-card.card-ok       { border-color: #00C853; background: rgba(0,200,83,0.06); }
.fi-card.card-critical { border-color: #FF1744; background: rgba(255,23,68,0.08); }
.fi-card.card-caution  { border-color: #FFD740; background: rgba(255,215,64,0.05); }

.fi-card-label   { font-size: 10px; color: #888; font-weight: 600; }
.fi-card-value   { font-size: 24px; font-weight: 800; color: #D4AF37; line-height: 1; }
.fi-card-value-row { display: flex; align-items: baseline; gap: 5px; }
.fi-unit         { font-size: 12px; color: #666; }
.fi-card-rule    { display: flex; align-items: center; gap: 5px; }
.fi-card-interp  { font-size: 11px; color: #ccc; line-height: 1.4; }
.fi-card-formula { font-size: 9px; color: #555; font-style: italic; border-top: 1px solid #1e1e3a; padding-top: 4px; margin-top: 2px; }
.fi-update       { font-size: 9px; color: #444; }

/* ── 标签 ── */
.rule-tag    { display: inline-block; }
.tag-warn    { color: #FF6D00; font-size: 11px; font-weight: 700; }
.tag-ok      { color: #00C853; font-size: 11px; font-weight: 700; }
.tag-neutral { color: #666;    font-size: 11px; }
.tag-critical { color: #FF1744; font-size: 11px; font-weight: 700; }
.tag-caution  { color: #FFD740; font-size: 11px; font-weight: 700; }

/* ── 披萨指数进度条 ── */
.pizza-gauge {
  flex: 1;
  height: 8px;
  background: #1a1a2e;
  border-radius: 4px;
  overflow: hidden;
  margin-left: 8px;
}
.gauge-bar {
  display: block;
  height: 100%;
  border-radius: 4px;
  transition: width 0.6s ease, background 0.3s;
}

/* ── Polymarket 列表 ── */
.poly-list  { display: flex; flex-direction: column; gap: 4px; max-height: 260px; overflow-y: auto; }
.poly-item  { display: flex; align-items: baseline; gap: 6px; font-size: 11px; }
.poly-pct   { font-weight: 700; min-width: 32px; text-align: right; flex-shrink: 0; }
.poly-pct.prob-high { color: #FF1744; }
.poly-pct.prob-mid  { color: #FFD740; }
.poly-pct.prob-low  { color: #00C853; }
.poly-q     { color: #ccc; flex: 1; line-height: 1.3; }
.poly-vol   { font-size: 9px; color: #555; flex-shrink: 0; }

@media (max-width: 900px) {
  .fi-grid { grid-template-columns: 1fr; }
}
</style>
