<template>
  <div class="trade-log">

    <!-- ── 汇总统计栏 ── -->
    <div class="summary-bar" v-if="stats">
      <div class="sb-item">
        <span class="sb-label">历史胜率</span>
        <span class="sb-val" :class="stats.winRate >= 50 ? 'green' : 'red'">
          {{ stats.winRate }}%
        </span>
      </div>
      <div class="sb-item">
        <span class="sb-label">已结交易</span>
        <span class="sb-val">{{ stats.total }}笔</span>
      </div>
      <div class="sb-item">
        <span class="sb-label">平均盈亏</span>
        <span class="sb-val" :class="stats.avgPnl >= 0 ? 'green' : 'red'">
          {{ stats.avgPnl >= 0 ? '+' : '' }}¥{{ stats.avgPnl }}
        </span>
      </div>
      <div class="sb-item">
        <span class="sb-label">盈亏比</span>
        <span class="sb-val gold">
          {{ stats.profitFactor ? '1:' + stats.profitFactor : 'N/A' }}
        </span>
      </div>
      <div class="sb-item">
        <span class="sb-label">均盈</span>
        <span class="sb-val green">+¥{{ stats.avgWin }}</span>
      </div>
      <div class="sb-item">
        <span class="sb-label">均亏</span>
        <span class="sb-val red">¥{{ stats.avgLoss }}</span>
      </div>
    </div>

    <!-- ── 当前持仓（逐笔实时） ── -->
    <div class="section-title">
      当前持仓
      <span class="badge" v-if="positions.length">{{ positions.length }}</span>
    </div>

    <div class="positions-list" v-if="positions.length">
      <div class="position-card" v-for="pos in positions" :key="pos.id as number"
        :class="livePnl(pos) >= 0 ? 'pos-profit' : 'pos-loss'">

        <!-- 头部：价格 + 实时盈亏 -->
        <div class="pos-header">
          <div class="pos-cost">
            <span class="ph-label">成本</span>
            <span class="ph-price">¥{{ (pos.buy_price_cny_g as number).toFixed(2) }}/g</span>
            <span class="ph-grams">{{ (pos.grams as number).toFixed(3) }}g</span>
          </div>
          <div class="pos-pnl" :class="livePnl(pos) >= 0 ? 'green' : 'red'">
            <span class="pnl-val">{{ livePnl(pos) >= 0 ? '+' : '' }}¥{{ livePnl(pos).toFixed(2) }}</span>
            <span class="pnl-pct">({{ livePnlPct(pos) >= 0 ? '+' : '' }}{{ livePnlPct(pos).toFixed(2) }}%)</span>
          </div>
        </div>

        <!-- 止损/目标价位线 -->
        <div class="pos-levels" v-if="pos.stop_loss || pos.target_profit">
          <div class="pl-item stop" v-if="pos.stop_loss">
            🛑 止损 <b>¥{{ (pos.stop_loss as number).toFixed(2) }}</b>
            <span class="pl-gap">
              (差 ¥{{ ((pos.buy_price_cny_g as number) - (pos.stop_loss as number)).toFixed(2) }}/g)
            </span>
          </div>
          <div class="pl-item target" v-if="pos.target_profit">
            🎯 目标 <b>¥{{ (pos.target_profit as number).toFixed(2) }}</b>
            <span class="pl-gap">
              (差 ¥{{ ((pos.target_profit as number) - (pos.buy_price_cny_g as number)).toFixed(2) }}/g)
            </span>
          </div>
        </div>

        <!-- 止损/目标价格进度条 -->
        <div class="progress-bar" v-if="pos.stop_loss && pos.target_profit && currentPrice">
          <div class="pb-track">
            <div class="pb-fill" :style="{ width: progressPct(pos) + '%' }"></div>
            <div class="pb-marker stop-marker" :style="{ left: '0%' }"></div>
            <div class="pb-marker target-marker" :style="{ left: '100%' }"></div>
          </div>
          <div class="pb-labels">
            <span class="red">¥{{ (pos.stop_loss as number).toFixed(0) }}</span>
            <span class="gold">当前 ¥{{ currentPrice.toFixed(2) }}</span>
            <span class="green">¥{{ (pos.target_profit as number).toFixed(0) }}</span>
          </div>
        </div>

        <!-- 元数据行 -->
        <div class="pos-meta">
          <span class="pm-item">{{ formatDuration(pos.buy_ts as number) }} 前买入</span>
          <span class="pm-item" v-if="pos.bank">{{ pos.bank }}</span>
          <span class="pm-item" v-if="pos.note">{{ pos.note }}</span>
          <span class="pm-item">手续费 ¥{{ (pos.buy_fee as number || 0).toFixed(2) }}</span>
        </div>

        <!-- 开仓时信号 -->
        <div class="pos-signal" v-if="pos.entry_signal">
          开仓信号：
          <span :class="sigCls(pos.entry_signal.signal)">{{ LABELS[pos.entry_signal.signal] ?? pos.entry_signal.signal }}</span>
          置信度 {{ pos.entry_signal.confidence }}%
        </div>

        <!-- 平仓操作 -->
        <div class="pos-close-row">
          <input
            v-model.number="closeForm[pos.id as number]"
            type="number" step="0.01"
            :placeholder="'平仓价 ¥/g (当前≈' + (currentPrice?.toFixed(2) ?? '?') + ')'"
            class="close-input"
          />
          <input
            v-model.number="closeFee[pos.id as number]"
            type="number" step="0.01"
            placeholder="手续费 ¥"
            class="close-fee-input"
          />
          <button
            class="close-btn"
            @click="doClose(pos.id as number)"
            :disabled="!closeForm[pos.id as number] || closing === (pos.id as number)"
          >
            {{ closing === (pos.id as number) ? '平仓中...' : '平仓' }}
          </button>
          <button
            class="close-btn-quick"
            @click="quickClose(pos.id as number)"
            :title="'按当前价格 ¥' + currentPrice?.toFixed(2) + '/g 平仓'"
            :disabled="!currentPrice || closing === (pos.id as number)"
          >
            按当前价平仓
          </button>
        </div>
      </div>
    </div>
    <div class="empty-pos" v-else>暂无持仓 · 在信号面板按信号开仓，或手动添加</div>

    <!-- ── 快速买入：只需价格 + 克数 ── -->
    <div class="quick-manual">
      <div class="qm-title">+ 记录买入</div>
      <div class="qm-row">
        <div class="qm-field">
          <label>买入价 <span class="unit">¥/g</span></label>
          <input v-model.number="moForm.buy_price_cny_g" type="number" step="0.01"
            :placeholder="props.currentPrice ? props.currentPrice.toFixed(2) : '价格'" class="qm-input price-input" />
        </div>
        <div class="qm-field">
          <label>克数 <span class="unit">g</span></label>
          <input v-model.number="moForm.grams" type="number" step="0.1" min="0.1"
            placeholder="1.0" class="qm-input" />
        </div>
        <button class="qm-btn" @click="doManualOpen"
          :disabled="!moForm.buy_price_cny_g || !moForm.grams">
          确认买入
        </button>
      </div>
      <p class="qm-hint">止损/目标价自动从最新信号填入 · 如需精确设置请在信号面板开仓</p>
    </div>

  </div>
</template>

<script setup lang="ts">
import { ref, reactive, onMounted } from 'vue';
import { api } from '../api';

interface Position {
  id: number; buy_ts: number; buy_price_cny_g: number; grams: number;
  bank: string; buy_fee: number; note: string;
  stop_loss: number | null; target_profit: number | null;
  entry_signal: { signal: string; confidence: number } | null;
}
interface Stats {
  total: number; wins: number; losses: number; winRate: number;
  avgPnl: number; avgWin: number; avgLoss: number; profitFactor: number | null;
}

const props = defineProps<{ currentPrice?: number }>();

const positions = ref<Position[]>([]);
const stats     = ref<Stats | null>(null);
const closeForm = reactive<Record<number, number>>({});
const closeFee  = reactive<Record<number, number>>({});
const closing   = ref<number | null>(null);


const moForm = reactive({
  buy_price_cny_g: 0, grams: 0, stop_loss: 0,
  target_profit: 0, buy_fee: 0, bank: '',
});

const LABELS: Record<string, string> = {
  STRONG_BUY: '强烈买入', BUY: '建议买入', HOLD: '观望',
  SELL: '减仓', STRONG_SELL: '强烈减仓',
};
const sigCls = (s: string) => s.includes('BUY') ? 'green' : s.includes('SELL') ? 'red' : 'dim';

// 实时盈亏（使用父组件传入的 currentPrice）
const livePnl = (pos: Position) => {
  const price = props.currentPrice ?? (pos.buy_price_cny_g);
  return (price - pos.buy_price_cny_g) * pos.grams - (pos.buy_fee ?? 0);
};
const livePnlPct = (pos: Position) => {
  const price = props.currentPrice ?? pos.buy_price_cny_g;
  return ((price - pos.buy_price_cny_g) / pos.buy_price_cny_g) * 100;
};

// 价格进度条（止损到目标之间的位置）
const progressPct = (pos: Position) => {
  const price = props.currentPrice ?? pos.buy_price_cny_g;
  if (!pos.stop_loss || !pos.target_profit) return 50;
  const range = pos.target_profit - pos.stop_loss;
  if (range <= 0) return 50;
  return Math.min(100, Math.max(0, ((price - pos.stop_loss) / range) * 100));
};

const currentPrice = ref(props.currentPrice ?? 0);

const formatDuration = (ts: number) => {
  const h = Math.floor((Date.now() - ts) / 3600000);
  if (h < 1) return '< 1小时';
  if (h < 24) return `${h}小时`;
  return `${Math.floor(h / 24)}天`;
};

async function loadAll() {
  const [p, s] = await Promise.allSettled([api.getPositions(), api.getTradeStats()]);
  if (p.status === 'fulfilled') positions.value = p.value as Position[];
  if (s.status === 'fulfilled') stats.value = s.value as Stats;
}

async function doClose(id: number) {
  const price = closeForm[id];
  if (!price || closing.value !== null) return;
  closing.value = id;
  try {
    await api.closePosition(id, price, closeFee[id] ?? 0);
    delete closeForm[id];
    delete closeFee[id];
    await loadAll();
  } catch (e) {
    alert('平仓失败：' + String(e instanceof Error ? e.message : e));
  } finally {
    closing.value = null;
  }
}

async function quickClose(id: number) {
  if (!props.currentPrice || closing.value !== null) return;
  closeForm[id] = props.currentPrice;
  await doClose(id);
}

async function doManualOpen() {
  if (!moForm.buy_price_cny_g || !moForm.grams) return;
  try {
    // 自动从最新信号拉取止损/目标价
    let stopLoss: number | undefined;
    let targetProfit: number | undefined;
    try {
      const sig = await api.getLatestSignal() as { stop_loss?: number; target_profit?: number };
      stopLoss     = sig.stop_loss     || undefined;
      targetProfit = sig.target_profit || undefined;
    } catch { /* 信号拉取失败也没关系，仅用于补充 */ }

    await api.openPosition({
      buy_price_cny_g: moForm.buy_price_cny_g,
      grams:           moForm.grams,
      stop_loss:       stopLoss,
      target_profit:   targetProfit,
    });
    moForm.buy_price_cny_g = 0;
    moForm.grams = 0;
    await loadAll();
  } catch (e) {
    alert('记录失败：' + String(e instanceof Error ? e.message : e));
  }
}

// 接收父组件传入的实时价格
const updatePrice = (p: number) => { currentPrice.value = p; };
defineExpose({ updatePrice, reload: loadAll });

onMounted(loadAll);
</script>

<style scoped>
.trade-log { display: flex; flex-direction: column; gap: 12px; }

/* 统计栏 */
.summary-bar { display: flex; gap: 0; border: 1px solid #2a2a4a; border-radius: 8px; overflow: hidden; }
.sb-item { flex: 1; padding: 8px 12px; border-right: 1px solid #2a2a4a; }
.sb-item:last-child { border-right: none; }
.sb-label { font-size: 10px; color: #666; display: block; }
.sb-val { font-size: 14px; font-weight: 700; }
.sb-val.green { color: #00C853; }
.sb-val.red   { color: #FF1744; }
.sb-val.gold  { color: #D4AF37; }

/* 章节标题 */
.section-title { font-size: 12px; color: #888; font-weight: 600; display: flex; align-items: center; gap: 6px; }
.badge { background: #D4AF37; color: #0d0d1a; font-size: 10px; padding: 1px 6px; border-radius: 10px; font-weight: 700; }

/* 持仓卡片 */
.positions-list { display: flex; flex-direction: column; gap: 8px; }
.position-card {
  border: 1px solid #2a2a4a; border-radius: 8px; padding: 12px;
  display: flex; flex-direction: column; gap: 8px; transition: border-color 0.2s;
}
.position-card.pos-profit { border-left: 3px solid #00C853; }
.position-card.pos-loss   { border-left: 3px solid #FF1744; }

.pos-header { display: flex; justify-content: space-between; align-items: flex-start; }
.pos-cost { display: flex; flex-direction: column; gap: 2px; }
.ph-label { font-size: 10px; color: #666; }
.ph-price { font-size: 16px; font-weight: 700; color: #e0e0e0; }
.ph-grams { font-size: 11px; color: #888; }
.pos-pnl  { text-align: right; }
.pnl-val  { font-size: 20px; font-weight: 900; display: block; }
.pnl-pct  { font-size: 11px; display: block; }
.pos-pnl.green .pnl-val { color: #00C853; }
.pos-pnl.green .pnl-pct { color: #00C853; }
.pos-pnl.red .pnl-val   { color: #FF1744; }
.pos-pnl.red .pnl-pct   { color: #FF1744; }

.pos-levels { display: flex; gap: 12px; flex-wrap: wrap; }
.pl-item { font-size: 11px; color: #888; }
.pl-item.stop b   { color: #FF1744; }
.pl-item.target b { color: #00C853; }
.pl-gap { color: #555; }

/* 进度条 */
.progress-bar { display: flex; flex-direction: column; gap: 4px; }
.pb-track { position: relative; height: 6px; background: #2a2a4a; border-radius: 3px; overflow: hidden; }
.pb-fill  { height: 100%; background: linear-gradient(90deg, #FF1744, #D4AF37, #00C853); border-radius: 3px; transition: width 0.5s; }
.pb-labels { display: flex; justify-content: space-between; font-size: 10px; }
.red  { color: #FF1744; }
.gold { color: #D4AF37; }
.green{ color: #00C853; }

.pos-meta { display: flex; gap: 10px; flex-wrap: wrap; }
.pm-item  { font-size: 10px; color: #555; background: #1a1a2e; padding: 2px 7px; border-radius: 10px; }

.pos-signal { font-size: 11px; color: #666; }
.pos-signal .green { color: #00C853; font-weight: 700; }
.pos-signal .red   { color: #FF1744; font-weight: 700; }
.pos-signal .dim   { color: #FFD600; font-weight: 700; }

.pos-close-row { display: flex; gap: 6px; align-items: center; padding-top: 4px; border-top: 1px solid #1a1a2e; }
.close-input, .close-fee-input {
  background: #0d0d1a; border: 1px solid #2a2a4a; border-radius: 4px;
  color: #e0e0e0; font-size: 11px; padding: 4px 7px; outline: none;
}
.close-input { width: 160px; }
.close-fee-input { width: 80px; }
.close-input:focus, .close-fee-input:focus { border-color: #FF1744; }
.close-btn {
  padding: 4px 14px; border-radius: 4px; border: 1px solid #FF1744;
  background: rgba(255,23,68,0.12); color: #FF1744; font-size: 11px; font-weight: 700; cursor: pointer;
}
.close-btn:disabled { opacity: 0.4; cursor: not-allowed; }
.close-btn-quick {
  padding: 4px 12px; border-radius: 4px; border: 1px solid #888;
  background: transparent; color: #888; font-size: 11px; cursor: pointer;
}
.close-btn-quick:hover { border-color: #FF1744; color: #FF1744; }
.close-btn-quick:disabled { opacity: 0.4; cursor: not-allowed; }

.empty-pos { font-size: 12px; color: #555; text-align: center; padding: 16px 0; border: 1px dashed #2a2a4a; border-radius: 6px; }

/* 快速买入 */
.quick-manual { background: rgba(212,175,55,0.04); border: 1px solid rgba(212,175,55,0.25); border-radius: 8px; padding: 12px; }
.qm-title { font-size: 12px; font-weight: 700; color: #D4AF37; margin-bottom: 8px; }
.qm-row   { display: flex; align-items: flex-end; gap: 10px; }
.qm-field { display: flex; flex-direction: column; gap: 4px; }
.qm-field label { font-size: 10px; color: #888; }
.unit { color: #D4AF37; }
.qm-input {
  background: #0d0d1a; border: 1px solid #2a2a4a; border-radius: 6px;
  color: #e0e0e0; font-size: 14px; font-weight: 700; padding: 8px 10px;
  width: 130px; outline: none; text-align: center;
}
.qm-input:focus { border-color: #D4AF37; }
.price-input { color: #D4AF37; }
.qm-btn {
  padding: 8px 24px; border-radius: 6px; border: none;
  background: linear-gradient(135deg, #00C853, #007B33);
  color: #fff; font-size: 13px; font-weight: 800; cursor: pointer; transition: opacity 0.15s;
}
.qm-btn:disabled { opacity: 0.4; cursor: not-allowed; }
.qm-hint { font-size: 10px; color: #555; margin: 6px 0 0; }
</style>
