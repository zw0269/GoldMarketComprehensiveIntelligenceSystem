<template>
  <div class="signal-panel">

    <div class="loading-overlay" v-if="loading">
      <span class="spin">◌</span> 信号分析中...
    </div>

    <template v-else-if="signal">
      <div class="panel-body">

        <!-- ── 左：信号判决区 ── -->
        <div class="verdict-zone" :class="signalCls">
          <div class="verdict-label">{{ signalLabel }}</div>
          <div class="verdict-price" v-if="signal.price_at_signal">
            ¥{{ signal.price_at_signal.toFixed(2) }}<small>/g</small>
          </div>
          <div class="conf-row">
            <div class="conf-track">
              <div class="conf-fill" :style="{ width: signal.confidence + '%', background: confColor }"></div>
            </div>
            <span class="conf-num">{{ signal.confidence }}%</span>
          </div>
          <div class="score-tag" :class="signalCls">
            评分 {{ signal.score > 0 ? '+' : '' }}{{ signal.score }}
          </div>
        </div>

        <!-- ── 中：价格三线区 ── -->
        <div class="levels-zone">
          <div class="level-card target-card" v-if="signal.target_profit">
            <span class="lc-icon">🎯</span>
            <span class="lc-label">止盈目标</span>
            <span class="lc-price green">¥{{ signal.target_profit }}</span>
            <span class="lc-delta" v-if="signal.price_at_signal">
              +{{ ((signal.target_profit - signal.price_at_signal) / signal.price_at_signal * 100).toFixed(2) }}%
            </span>
          </div>
          <div class="level-card entry-card" v-if="signal.entry_cny_g">
            <span class="lc-icon">⬤</span>
            <span class="lc-label">建议入场</span>
            <span class="lc-price gold">¥{{ signal.entry_cny_g }}</span>
            <span class="lc-rr" v-if="signal.risk_reward">风险比 1:{{ signal.risk_reward }}</span>
          </div>
          <div class="level-card stop-card" v-if="signal.stop_loss">
            <span class="lc-icon">🛑</span>
            <span class="lc-label">止损价位</span>
            <span class="lc-price red">¥{{ signal.stop_loss }}</span>
            <span class="lc-delta" v-if="signal.price_at_signal">
              {{ ((signal.stop_loss - signal.price_at_signal) / signal.price_at_signal * 100).toFixed(2) }}%
            </span>
          </div>
        </div>

        <!-- ── 右：技术指标 + 理由 ── -->
        <div class="analysis-zone">
          <div class="tech-grid">
            <div class="tech-chip" v-if="signal.technicals.rsi !== null">
              <span class="tc-name">RSI</span>
              <span class="tc-val" :class="rsiCls">{{ signal.technicals.rsi?.toFixed(1) }}</span>
              <span class="tc-hint">{{ rsiHint }}</span>
            </div>
            <div class="tech-chip" v-if="signal.technicals.macdHistogram !== null">
              <span class="tc-name">MACD</span>
              <span class="tc-val" :class="signal.technicals.macdHistogram >= 0 ? 'green' : 'red'">
                {{ signal.technicals.macdHistogram >= 0 ? '↑多' : '↓空' }}
              </span>
              <span class="tc-hint">{{ signal.technicals.macdHistogram?.toFixed(2) }}</span>
            </div>
            <div class="tech-chip" v-if="signal.technicals.bbPosition">
              <span class="tc-name">布林</span>
              <span class="tc-val" :class="bbCls">{{ bbLabel }}</span>
            </div>
            <div class="tech-chip" v-if="signal.technicals.sgePremium !== null">
              <span class="tc-name">SGE溢价</span>
              <span class="tc-val" :class="(signal.technicals.sgePremium ?? 0) >= 0 ? 'green' : 'red'">
                ${{ signal.technicals.sgePremium?.toFixed(1) }}
              </span>
            </div>
          </div>
          <ul class="reasons-list">
            <li v-for="r in signal.reasons" :key="r">{{ r }}</li>
          </ul>
        </div>
      </div>

      <!-- ── 快速开仓区（仅买入信号显示） ── -->
      <div class="quick-open" v-if="isBuySignal">
        <div class="qo-title">⚡ 按信号快速开仓</div>
        <div class="qo-form">
          <div class="qo-field">
            <label>入场价 ¥/g</label>
            <input v-model.number="openForm.buy_price_cny_g" type="number" step="0.01" class="qo-input" />
          </div>
          <div class="qo-field">
            <label>止损价 ¥/g</label>
            <input v-model.number="openForm.stop_loss" type="number" step="0.01" class="qo-input stop-input" />
          </div>
          <div class="qo-field">
            <label>目标价 ¥/g</label>
            <input v-model.number="openForm.target_profit" type="number" step="0.01" class="qo-input target-input" />
          </div>
          <div class="qo-field">
            <label>克数</label>
            <input v-model.number="openForm.grams" type="number" step="0.1" min="0.1" class="qo-input" placeholder="0.0" />
          </div>
          <div class="qo-field">
            <label>手续费 ¥</label>
            <input v-model.number="openForm.buy_fee" type="number" step="0.01" class="qo-input" placeholder="0" />
          </div>
          <select v-model="openForm.bank" class="qo-input">
            <option value="">银行/平台</option>
            <option v-for="b in banks" :key="b" :value="b">{{ b }}</option>
          </select>
        </div>

        <!-- 风险计算器 -->
        <div class="risk-calc" v-if="openForm.grams > 0 && openForm.buy_price_cny_g > 0">
          <span class="rc-item">
            投入 <b>¥{{ (openForm.buy_price_cny_g * openForm.grams + openForm.buy_fee).toFixed(2) }}</b>
          </span>
          <span class="rc-sep">|</span>
          <span class="rc-item loss" v-if="openForm.stop_loss">
            最大亏损
            <b>¥{{ Math.abs((openForm.stop_loss - openForm.buy_price_cny_g) * openForm.grams).toFixed(2) }}</b>
          </span>
          <span class="rc-sep" v-if="openForm.stop_loss && openForm.target_profit">|</span>
          <span class="rc-item gain" v-if="openForm.target_profit">
            预期盈利
            <b>¥{{ ((openForm.target_profit - openForm.buy_price_cny_g) * openForm.grams).toFixed(2) }}</b>
          </span>
          <span class="rc-sep" v-if="openForm.stop_loss">|</span>
          <span class="rc-item breakeven">
            盈亏平衡 <b>¥{{ breakEven }}/g</b>
          </span>
        </div>

        <div class="qo-actions">
          <button class="open-btn" @click="doOpen" :disabled="!canOpen || opening">
            {{ opening ? '开仓中...' : '✓ 确认开仓' }}
          </button>
          <span class="qo-ts">信号生成 {{ formatTime(signal.generatedAt) }}</span>
          <button class="refresh-btn" @click="load" :disabled="loading">⟳ 刷新</button>
        </div>
      </div>

      <!-- 非买入信号的时间戳和刷新 -->
      <div class="bottom-bar" v-else>
        <span class="ts">{{ formatTime(signal.generatedAt) }}</span>
        <button class="refresh-btn" @click="load" :disabled="loading">⟳ 刷新信号</button>
      </div>
    </template>

    <div class="error-msg" v-else-if="error">⚠️ {{ error }}</div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, reactive, onMounted, onUnmounted } from 'vue';
import { api } from '../api';

interface Signal {
  signal: string;
  confidence: number;
  score: number;
  reasons: string[];
  entry_cny_g: number | null;
  stop_loss: number | null;
  target_profit: number | null;
  risk_reward: number | null;
  technicals: {
    rsi: number | null;
    macdHistogram: number | null;
    bbPosition: string | null;
    sgePremium: number | null;
  };
  price_at_signal: number | null;
  generatedAt: number;
}

const emit = defineEmits<{ (e: 'position-opened'): void }>();

const signal  = ref<Signal | null>(null);
const loading = ref(false);
const opening = ref(false);
const error   = ref('');
let timer: ReturnType<typeof setInterval> | null = null;

const banks = ['工商银行', '招商银行', '建设银行', '农业银行', '中国银行', '平安银行', '其他'];

const openForm = reactive({
  buy_price_cny_g: 0,
  stop_loss: 0,
  target_profit: 0,
  grams: 0,
  buy_fee: 0,
  bank: '',
});

const LABELS: Record<string, string> = {
  STRONG_BUY: '强烈买入',
  BUY:        '建议买入',
  HOLD:       '观望等待',
  SELL:       '建议减仓',
  STRONG_SELL:'强烈减仓',
};
const CLASSES: Record<string, string> = {
  STRONG_BUY: 'strong-buy',
  BUY:        'buy',
  HOLD:       'hold',
  SELL:       'sell',
  STRONG_SELL:'strong-sell',
};

const signalCls   = computed(() => signal.value ? (CLASSES[signal.value.signal] ?? '') : '');
const signalLabel = computed(() => signal.value ? (LABELS[signal.value.signal] ?? signal.value.signal) : '');
const isBuySignal = computed(() => signal.value?.signal.includes('BUY') ?? false);
const confColor   = computed(() => {
  if (!signal.value) return '#888';
  if (signal.value.signal.includes('BUY'))  return '#00C853';
  if (signal.value.signal.includes('SELL')) return '#FF1744';
  return '#FFD600';
});

const rsiCls = computed(() => {
  const r = signal.value?.technicals.rsi;
  if (r == null) return '';
  if (r < 35) return 'green';
  if (r > 65) return 'red';
  return 'dim';
});
const rsiHint = computed(() => {
  const r = signal.value?.technicals.rsi;
  if (r == null) return '';
  if (r < 30)   return '极度超卖';
  if (r < 40)   return '超卖';
  if (r > 70)   return '极度超买';
  if (r > 60)   return '超买';
  return '中性';
});
const bbLabel = computed(() => {
  const p = signal.value?.technicals.bbPosition;
  const m: Record<string, string> = { near_lower: '下轨附近', near_upper: '上轨附近', middle: '中轨' };
  return p ? (m[p] ?? '') : '';
});
const bbCls = computed(() => {
  const p = signal.value?.technicals.bbPosition;
  const m: Record<string, string> = { near_lower: 'green', near_upper: 'red', middle: 'dim' };
  return p ? (m[p] ?? '') : '';
});

const breakEven = computed(() => {
  const p = openForm.buy_price_cny_g;
  const g = openForm.grams;
  if (!p || !g) return '-';
  return ((p * g + openForm.buy_fee) / g).toFixed(2);
});
const canOpen = computed(() =>
  openForm.buy_price_cny_g > 0 && openForm.grams > 0
);

const formatTime = (ts: number) =>
  new Date(ts).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });

function prefillForm(s: Signal) {
  openForm.buy_price_cny_g = s.entry_cny_g ?? s.price_at_signal ?? 0;
  openForm.stop_loss       = s.stop_loss    ?? 0;
  openForm.target_profit   = s.target_profit ?? 0;
}

async function load() {
  loading.value = true;
  error.value = '';
  try {
    signal.value = await api.getLatestSignal() as Signal;
    if (signal.value) prefillForm(signal.value);
  } catch (e) {
    error.value = '信号获取失败：' + String(e instanceof Error ? e.message : e);
  } finally {
    loading.value = false;
  }
}

async function doOpen() {
  if (!canOpen.value || opening.value) return;
  opening.value = true;
  try {
    await api.openPosition({
      buy_price_cny_g: openForm.buy_price_cny_g,
      grams:           openForm.grams,
      bank:            openForm.bank,
      buy_fee:         openForm.buy_fee,
      stop_loss:       openForm.stop_loss || undefined,
      target_profit:   openForm.target_profit || undefined,
      entry_signal:    signal.value ? JSON.stringify(signal.value) : undefined,
    });
    openForm.grams   = 0;
    openForm.buy_fee = 0;
    emit('position-opened');
  } catch (e) {
    alert('开仓失败：' + String(e instanceof Error ? e.message : e));
  } finally {
    opening.value = false;
  }
}

onMounted(async () => {
  await load();
  timer = setInterval(load, 5 * 60 * 1000);
});
onUnmounted(() => { if (timer) clearInterval(timer); });
</script>

<style scoped>
.signal-panel { display: flex; flex-direction: column; gap: 12px; }
.loading-overlay { color: #888; font-size: 13px; }
.spin { display: inline-block; animation: spin 1.2s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }

/* ── 主体三栏 ── */
.panel-body { display: grid; grid-template-columns: 180px 160px 1fr; gap: 12px; }

/* 左：判决区 */
.verdict-zone {
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  padding: 16px 12px; border-radius: 10px; border: 2px solid; text-align: center; gap: 8px;
}
.strong-buy  { border-color: #00C853; background: rgba(0,200,83,0.10); }
.buy         { border-color: rgba(0,200,83,0.6); background: rgba(0,200,83,0.05); }
.hold        { border-color: #FFD600; background: rgba(255,214,0,0.06); }
.sell        { border-color: rgba(255,23,68,0.6); background: rgba(255,23,68,0.05); }
.strong-sell { border-color: #FF1744; background: rgba(255,23,68,0.10); }

.verdict-label { font-size: 20px; font-weight: 900; letter-spacing: 1px; }
.strong-buy .verdict-label, .buy .verdict-label  { color: #00C853; }
.hold .verdict-label  { color: #FFD600; }
.sell .verdict-label, .strong-sell .verdict-label { color: #FF1744; }

.verdict-price { font-size: 16px; font-weight: 700; color: #D4AF37; }
.verdict-price small { font-size: 11px; color: #888; }

.conf-row { display: flex; align-items: center; gap: 6px; width: 100%; }
.conf-track { flex: 1; height: 5px; background: #2a2a4a; border-radius: 3px; overflow: hidden; }
.conf-fill  { height: 100%; border-radius: 3px; transition: width 0.6s; }
.conf-num   { font-size: 11px; color: #888; white-space: nowrap; }

.score-tag { font-size: 11px; padding: 2px 10px; border-radius: 10px; font-weight: 700; }
.strong-buy .score-tag, .buy .score-tag  { background: rgba(0,200,83,0.15); color: #00C853; }
.hold .score-tag  { background: rgba(255,214,0,0.15); color: #FFD600; }
.sell .score-tag, .strong-sell .score-tag { background: rgba(255,23,68,0.15); color: #FF1744; }

/* 中：价格三线 */
.levels-zone { display: flex; flex-direction: column; gap: 6px; }
.level-card { display: flex; flex-direction: column; padding: 8px 10px; border-radius: 6px; border-left: 3px solid; background: #1a1a2e; }
.target-card { border-left-color: #00C853; }
.entry-card  { border-left-color: #D4AF37; }
.stop-card   { border-left-color: #FF1744; }
.lc-icon  { font-size: 10px; margin-bottom: 2px; }
.lc-label { font-size: 10px; color: #666; }
.lc-price { font-size: 15px; font-weight: 800; }
.lc-price.green { color: #00C853; }
.lc-price.gold  { color: #D4AF37; }
.lc-price.red   { color: #FF1744; }
.lc-delta { font-size: 10px; color: #888; }
.lc-rr    { font-size: 10px; color: #D4AF37; }

/* 右：分析区 */
.analysis-zone { display: flex; flex-direction: column; gap: 8px; }
.tech-grid { display: flex; flex-wrap: wrap; gap: 6px; }
.tech-chip { display: flex; align-items: center; gap: 5px; background: #0d0d1a; border: 1px solid #2a2a4a; border-radius: 4px; padding: 4px 8px; }
.tc-name  { font-size: 10px; color: #666; }
.tc-val   { font-size: 11px; font-weight: 700; }
.tc-hint  { font-size: 9px; color: #555; }
.tc-val.green { color: #00C853; }
.tc-val.red   { color: #FF1744; }
.tc-val.dim   { color: #888; }
.reasons-list { padding-left: 14px; margin: 0; }
.reasons-list li { font-size: 11px; color: #bbb; line-height: 1.9; }

/* ── 快速开仓区 ── */
.quick-open {
  border-top: 1px solid #2a2a4a; padding-top: 12px;
  display: flex; flex-direction: column; gap: 8px;
}
.qo-title { font-size: 12px; font-weight: 700; color: #D4AF37; }
.qo-form  { display: flex; flex-wrap: wrap; gap: 8px; align-items: flex-end; }
.qo-field { display: flex; flex-direction: column; gap: 3px; }
.qo-field label { font-size: 10px; color: #666; }
.qo-input {
  background: #0d0d1a; border: 1px solid #2a2a4a; border-radius: 4px;
  color: #e0e0e0; font-size: 12px; padding: 5px 8px; outline: none; width: 100px;
}
.qo-input:focus { border-color: #D4AF37; }
.stop-input:focus { border-color: #FF1744; }
.target-input:focus { border-color: #00C853; }

/* 风险计算器 */
.risk-calc { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; font-size: 11px; color: #888; }
.rc-item b { font-weight: 700; }
.rc-item.loss b  { color: #FF1744; }
.rc-item.gain b  { color: #00C853; }
.rc-item.breakeven b { color: #D4AF37; }
.rc-sep { color: #2a2a4a; }

.qo-actions { display: flex; align-items: center; gap: 10px; }
.open-btn {
  padding: 7px 24px; border-radius: 6px; border: none;
  background: linear-gradient(135deg, #00C853, #007B33);
  color: #fff; font-size: 13px; font-weight: 700; cursor: pointer; transition: opacity 0.15s;
}
.open-btn:disabled { opacity: 0.4; cursor: not-allowed; }
.qo-ts { font-size: 10px; color: #555; margin-left: auto; }

.bottom-bar { display: flex; justify-content: space-between; align-items: center; padding-top: 8px; border-top: 1px solid #2a2a4a; }
.ts { font-size: 10px; color: #555; }
.refresh-btn { font-size: 11px; padding: 3px 10px; border-radius: 4px; border: 1px solid #2a2a4a; background: transparent; color: #888; cursor: pointer; }
.refresh-btn:hover { border-color: #D4AF37; color: #D4AF37; }
.refresh-btn:disabled { opacity: 0.4; cursor: not-allowed; }

.error-msg { color: #FF6D00; font-size: 12px; }
</style>
