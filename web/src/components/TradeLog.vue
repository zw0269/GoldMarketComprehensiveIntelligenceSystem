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
        :class="activePrice > 0 ? (livePnl(pos) >= 0 ? 'pos-profit' : 'pos-loss') : 'pos-neutral'">

        <!-- 头部：价格 + 实时盈亏 + 操作按钮 -->
        <div class="pos-header">
          <div class="pos-cost">
            <span class="ph-label">成本</span>
            <span class="ph-price">¥{{ (pos.buy_price_cny_g as number).toFixed(2) }}/g</span>
            <span class="ph-grams">{{ (pos.grams as number).toFixed(3) }}g</span>
          </div>
          <div class="pos-pnl" :class="activePrice > 0 ? (livePnl(pos) >= 0 ? 'green' : 'red') : 'dim'">
            <template v-if="activePrice > 0">
              <span class="pnl-val">{{ livePnl(pos) >= 0 ? '+' : '' }}¥{{ livePnl(pos).toFixed(2) }}</span>
              <span class="pnl-pct">({{ livePnlPct(pos) >= 0 ? '+' : '' }}{{ livePnlPct(pos).toFixed(2) }}%)</span>
            </template>
            <template v-else>
              <span class="pnl-val dim">等待价格...</span>
            </template>
          </div>
          <div class="pos-actions">
            <button class="act-btn edit-btn" @click="startEdit(pos.id as number, pos)" title="编辑">✏️</button>
            <button class="act-btn del-btn"  @click="doDelete(pos.id as number, false)" title="删除">🗑️</button>
          </div>
        </div>

        <!-- ── 编辑表单（内联展开） ── -->
        <div class="edit-form" v-if="editId === (pos.id as number)">
          <div class="ef-row">
            <div class="ef-field">
              <label>买入价 ¥/g</label>
              <input v-model.number="editForm.buy_price_cny_g" type="number" step="0.01" class="ef-input" />
            </div>
            <div class="ef-field">
              <label>克数 g</label>
              <input v-model.number="editForm.grams" type="number" step="0.001" class="ef-input" />
            </div>
            <div class="ef-field">
              <label>手续费 ¥</label>
              <input v-model.number="editForm.buy_fee" type="number" step="0.01" class="ef-input" />
            </div>
          </div>
          <div class="ef-row">
            <div class="ef-field">
              <label>止损价 ¥/g</label>
              <input v-model.number="editForm.stop_loss" type="number" step="0.01" class="ef-input" placeholder="空=不设" />
            </div>
            <div class="ef-field">
              <label>目标价 ¥/g</label>
              <input v-model.number="editForm.target_profit" type="number" step="0.01" class="ef-input" placeholder="空=不设" />
            </div>
            <div class="ef-field ef-note">
              <label>备注</label>
              <input v-model="editForm.note" type="text" class="ef-input" placeholder="可选" />
            </div>
          </div>
          <div class="ef-btns">
            <button class="ef-save" @click="saveEdit(pos.id as number)">保存</button>
            <button class="ef-cancel" @click="cancelEdit">取消</button>
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

        <!-- 进度条 -->
        <div class="progress-bar" v-if="pos.stop_loss && pos.target_profit && activePrice > 0">
          <div class="pb-track">
            <div class="pb-fill" :style="{ width: progressPct(pos) + '%' }"></div>
          </div>
          <div class="pb-labels">
            <span class="red">¥{{ (pos.stop_loss as number).toFixed(0) }}</span>
            <span class="gold">当前 ¥{{ activePrice.toFixed(2) }}</span>
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
            :placeholder="'平仓价 ¥/g (当前≈' + (activePrice > 0 ? activePrice.toFixed(2) : '?') + ')'"
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
            :title="'按当前价格 ¥' + activePrice.toFixed(2) + '/g 平仓'"
            :disabled="activePrice <= 0 || closing === (pos.id as number)"
          >
            按当前价平仓
          </button>
        </div>
      </div>
    </div>
    <div class="empty-pos" v-else>暂无持仓 · 在信号面板按信号开仓，或手动添加</div>

    <!-- ── 快速买入 ── -->
    <div class="quick-manual">
      <div class="qm-title">+ 记录买入</div>
      <div class="qm-row">
        <div class="qm-field">
          <label>买入价 <span class="unit">¥/g</span></label>
          <input v-model.number="moForm.buy_price_cny_g" type="number" step="0.01"
            :placeholder="activePrice > 0 ? activePrice.toFixed(2) : '价格'" class="qm-input price-input" />
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

    <!-- ── 历史持仓（已平仓，可删改） ── -->
    <div class="section-title section-sep">
      历史持仓
      <span class="badge-gray" v-if="closedPositions.length">{{ closedPositions.length }}</span>
      <button class="load-history-btn" v-if="!historyLoaded" @click="loadHistory">加载历史记录</button>
    </div>

    <div v-if="historyLoaded">
      <div v-if="closedPositions.length === 0" class="empty-pos">暂无历史持仓记录</div>
      <div class="closed-list" v-else>
        <div class="closed-card"
          v-for="cp in closedPositions" :key="cp.id as number"
          :class="(cp.realized_pnl as number) >= 0 ? 'cp-win' : 'cp-loss'">

          <!-- 头部：盈亏 + 操作 -->
          <div class="cp-header">
            <div class="cp-info">
              <span class="cp-date">{{ formatDate(cp.buy_ts as number) }}</span>
              <span class="cp-route">
                ¥{{ (cp.buy_price_cny_g as number).toFixed(2) }}
                <span class="arrow">→</span>
                ¥{{ cp.close_price_cny_g != null ? (cp.close_price_cny_g as number).toFixed(2) : '—' }}
                / {{ (cp.grams as number).toFixed(3) }}g
              </span>
            </div>
            <div class="cp-pnl" :class="(cp.realized_pnl as number) >= 0 ? 'green' : 'red'">
              {{ (cp.realized_pnl as number) >= 0 ? '+' : '' }}¥{{ (cp.realized_pnl as number)?.toFixed(2) ?? '—' }}
              <span class="cp-hours">{{ (cp.holding_hours as number)?.toFixed(1) }}h</span>
            </div>
            <div class="pos-actions">
              <button class="act-btn edit-btn" @click="startEditClosed(cp.id as number, cp)" title="编辑">✏️</button>
              <button class="act-btn del-btn"  @click="doDelete(cp.id as number, true)"      title="删除">🗑️</button>
            </div>
          </div>

          <!-- 编辑表单（历史持仓） -->
          <div class="edit-form" v-if="editClosedId === (cp.id as number)">
            <div class="ef-row">
              <div class="ef-field">
                <label>买入价 ¥/g</label>
                <input v-model.number="editClosedForm.buy_price_cny_g" type="number" step="0.01" class="ef-input" />
              </div>
              <div class="ef-field">
                <label>平仓价 ¥/g</label>
                <input v-model.number="editClosedForm.close_price_cny_g" type="number" step="0.01" class="ef-input" />
              </div>
              <div class="ef-field">
                <label>克数 g</label>
                <input v-model.number="editClosedForm.grams" type="number" step="0.001" class="ef-input" />
              </div>
            </div>
            <div class="ef-row">
              <div class="ef-field">
                <label>买入手续费 ¥</label>
                <input v-model.number="editClosedForm.buy_fee" type="number" step="0.01" class="ef-input" />
              </div>
              <div class="ef-field">
                <label>平仓手续费 ¥</label>
                <input v-model.number="editClosedForm.close_fee" type="number" step="0.01" class="ef-input" />
              </div>
              <div class="ef-field ef-note">
                <label>备注</label>
                <input v-model="editClosedForm.note" type="text" class="ef-input" placeholder="可选" />
              </div>
            </div>
            <div class="ef-btns">
              <button class="ef-save" @click="saveEditClosed(cp.id as number)">保存</button>
              <button class="ef-cancel" @click="cancelEditClosed">取消</button>
            </div>
          </div>

          <div class="cp-meta" v-if="cp.note">
            <span class="pm-item">{{ cp.note }}</span>
          </div>
        </div>
      </div>
    </div>

  </div>
</template>

<script setup lang="ts">
import { ref, reactive, computed, onMounted } from 'vue';
import { api } from '../api';

interface Position {
  id: number; buy_ts: number; buy_price_cny_g: number; grams: number;
  bank: string; buy_fee: number; note: string;
  stop_loss: number | null; target_profit: number | null;
  entry_signal: { signal: string; confidence: number } | null;
}
interface ClosedPosition {
  id: number; buy_ts: number; close_ts: number;
  buy_price_cny_g: number; close_price_cny_g: number | null;
  grams: number; buy_fee: number; close_fee: number;
  realized_pnl: number; holding_hours: number; note: string;
}
interface Stats {
  total: number; wins: number; losses: number; winRate: number;
  avgPnl: number; avgWin: number; avgLoss: number; profitFactor: number | null;
}

const props = defineProps<{ currentPrice?: number }>();

// 有效当前价（避免 0 导致错误盈亏）
const activePrice = computed(() => props.currentPrice ?? 0);

const positions       = ref<Position[]>([]);
const closedPositions = ref<ClosedPosition[]>([]);
const stats           = ref<Stats | null>(null);
const historyLoaded   = ref(false);

const closeForm = reactive<Record<number, number>>({});
const closeFee  = reactive<Record<number, number>>({});
const closing   = ref<number | null>(null);

// 开仓编辑状态
const editId   = ref<number | null>(null);
const editForm = reactive({
  buy_price_cny_g: 0, grams: 0, buy_fee: 0,
  stop_loss: null as number | null, target_profit: null as number | null, note: '',
});

// 历史持仓编辑状态
const editClosedId   = ref<number | null>(null);
const editClosedForm = reactive({
  buy_price_cny_g: 0, close_price_cny_g: 0,
  grams: 0, buy_fee: 0, close_fee: 0, note: '',
});

const moForm = reactive({
  buy_price_cny_g: 0, grams: 0,
});

const LABELS: Record<string, string> = {
  STRONG_BUY: '强烈买入', BUY: '建议买入', HOLD: '观望',
  SELL: '减仓', STRONG_SELL: '强烈减仓',
};
const sigCls = (s: string) => s.includes('BUY') ? 'green' : s.includes('SELL') ? 'red' : 'dim';

// ── 实时盈亏（activePrice > 0 才有意义）────────────────────────
const livePnl = (pos: Position) => {
  const price = activePrice.value || pos.buy_price_cny_g;
  return (price - pos.buy_price_cny_g) * pos.grams - (pos.buy_fee ?? 0);
};
const livePnlPct = (pos: Position) => {
  const price = activePrice.value || pos.buy_price_cny_g;
  return ((price - pos.buy_price_cny_g) / pos.buy_price_cny_g) * 100;
};

const progressPct = (pos: Position) => {
  const price = activePrice.value || pos.buy_price_cny_g;
  if (!pos.stop_loss || !pos.target_profit) return 50;
  const range = pos.target_profit - pos.stop_loss;
  if (range <= 0) return 50;
  return Math.min(100, Math.max(0, ((price - pos.stop_loss) / range) * 100));
};

const formatDuration = (ts: number) => {
  const h = Math.floor((Date.now() - ts) / 3600000);
  if (h < 1) return '< 1小时';
  if (h < 24) return `${h}小时`;
  return `${Math.floor(h / 24)}天`;
};

const formatDate = (ts: number) => {
  if (!ts) return '—';
  return new Date(ts).toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
};

// ── 数据加载 ─────────────────────────────────────────────────
async function loadAll() {
  const [p, s] = await Promise.allSettled([api.getPositions(), api.getTradeStats()]);
  if (p.status === 'fulfilled') positions.value = p.value as Position[];
  if (s.status === 'fulfilled') stats.value = s.value as Stats;
}

async function loadHistory() {
  try {
    const rows = await api.getClosedPositions() as ClosedPosition[];
    closedPositions.value = rows;
    historyLoaded.value = true;
  } catch {
    alert('加载历史记录失败');
  }
}

// ── 平仓 ─────────────────────────────────────────────────────
async function doClose(id: number) {
  const price = closeForm[id];
  if (!price || closing.value !== null) return;
  closing.value = id;
  try {
    await api.closePosition(id, price, closeFee[id] ?? 0);
    delete closeForm[id];
    delete closeFee[id];
    await loadAll();
    if (historyLoaded.value) await loadHistory();
  } catch (e) {
    alert('平仓失败：' + String(e instanceof Error ? e.message : e));
  } finally {
    closing.value = null;
  }
}

async function quickClose(id: number) {
  if (activePrice.value <= 0 || closing.value !== null) return;
  closeForm[id] = activePrice.value;
  await doClose(id);
}

// ── 删除 ─────────────────────────────────────────────────────
async function doDelete(id: number, isClosed: boolean) {
  if (!confirm(`确认删除此${isClosed ? '历史' : ''}持仓记录？操作不可恢复。`)) return;
  try {
    await api.deletePosition(id);
    if (isClosed) {
      closedPositions.value = closedPositions.value.filter(p => p.id !== id);
      await loadAll(); // 刷新统计
    } else {
      await loadAll();
    }
  } catch (e) {
    alert('删除失败：' + String(e instanceof Error ? e.message : e));
  }
}

// ── 编辑开仓持仓 ─────────────────────────────────────────────
function startEdit(id: number, pos: Position) {
  editId.value = (editId.value === id) ? null : id;
  editClosedId.value = null;
  editForm.buy_price_cny_g = pos.buy_price_cny_g;
  editForm.grams           = pos.grams;
  editForm.buy_fee         = pos.buy_fee ?? 0;
  editForm.stop_loss       = pos.stop_loss;
  editForm.target_profit   = pos.target_profit;
  editForm.note            = pos.note ?? '';
}

function cancelEdit() { editId.value = null; }

async function saveEdit(id: number) {
  try {
    await api.updatePosition(id, {
      buy_price_cny_g: editForm.buy_price_cny_g || undefined,
      grams:           editForm.grams           || undefined,
      buy_fee:         editForm.buy_fee,
      stop_loss:       editForm.stop_loss  || null,
      target_profit:   editForm.target_profit || null,
      note:            editForm.note,
    });
    editId.value = null;
    await loadAll();
  } catch (e) {
    alert('保存失败：' + String(e instanceof Error ? e.message : e));
  }
}

// ── 编辑历史持仓 ─────────────────────────────────────────────
function startEditClosed(id: number, cp: ClosedPosition) {
  editClosedId.value = (editClosedId.value === id) ? null : id;
  editId.value = null;
  editClosedForm.buy_price_cny_g   = cp.buy_price_cny_g;
  editClosedForm.close_price_cny_g = cp.close_price_cny_g ?? 0;
  editClosedForm.grams             = cp.grams;
  editClosedForm.buy_fee           = cp.buy_fee ?? 0;
  editClosedForm.close_fee         = cp.close_fee ?? 0;
  editClosedForm.note              = cp.note ?? '';
}

function cancelEditClosed() { editClosedId.value = null; }

async function saveEditClosed(id: number) {
  try {
    const buy  = editClosedForm.buy_price_cny_g;
    const sell = editClosedForm.close_price_cny_g;
    const g    = editClosedForm.grams;
    const bf   = editClosedForm.buy_fee  ?? 0;
    const cf   = editClosedForm.close_fee ?? 0;
    // 重新计算 realized_pnl
    const realized_pnl = buy && sell && g ? parseFloat(((sell - buy) * g - bf - cf).toFixed(2)) : undefined;

    await api.updatePosition(id, {
      buy_price_cny_g:   buy   || undefined,
      close_price_cny_g: sell  || undefined,
      grams:             g     || undefined,
      buy_fee:           bf,
      close_fee:         cf,
      note:              editClosedForm.note,
      ...(realized_pnl != null ? { realized_pnl } : {}),
    });
    editClosedId.value = null;
    await loadHistory();
    await loadAll();
  } catch (e) {
    alert('保存失败：' + String(e instanceof Error ? e.message : e));
  }
}

// ── 手动开仓 ─────────────────────────────────────────────────
async function doManualOpen() {
  if (!moForm.buy_price_cny_g || !moForm.grams) return;
  try {
    let stopLoss: number | undefined;
    let targetProfit: number | undefined;
    try {
      const sig = await api.getLatestSignal() as { stop_loss?: number; target_profit?: number };
      stopLoss     = sig.stop_loss     || undefined;
      targetProfit = sig.target_profit || undefined;
    } catch { /* 无信号也没关系 */ }

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

// 父组件调用接口
defineExpose({ reload: loadAll });

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
.section-sep { margin-top: 8px; padding-top: 12px; border-top: 1px solid #2a2a4a; }
.badge { background: #D4AF37; color: #0d0d1a; font-size: 10px; padding: 1px 6px; border-radius: 10px; font-weight: 700; }
.badge-gray { background: #2a2a4a; color: #888; font-size: 10px; padding: 1px 6px; border-radius: 10px; }
.load-history-btn {
  margin-left: auto; font-size: 11px; color: #D4AF37; background: transparent;
  border: 1px solid rgba(212,175,55,0.4); border-radius: 4px; padding: 2px 8px; cursor: pointer;
}
.load-history-btn:hover { background: rgba(212,175,55,0.08); }

/* 持仓卡片 */
.positions-list { display: flex; flex-direction: column; gap: 8px; }
.position-card {
  border: 1px solid #2a2a4a; border-radius: 8px; padding: 12px;
  display: flex; flex-direction: column; gap: 8px;
}
.position-card.pos-profit  { border-left: 3px solid #00C853; }
.position-card.pos-loss    { border-left: 3px solid #FF1744; }
.position-card.pos-neutral { border-left: 3px solid #555; }

.pos-header { display: flex; justify-content: space-between; align-items: flex-start; gap: 8px; }
.pos-cost { display: flex; flex-direction: column; gap: 2px; min-width: 90px; }
.ph-label { font-size: 10px; color: #666; }
.ph-price { font-size: 16px; font-weight: 700; color: #e0e0e0; }
.ph-grams { font-size: 11px; color: #888; }
.pos-pnl  { flex: 1; text-align: right; }
.pnl-val  { font-size: 20px; font-weight: 900; display: block; }
.pnl-pct  { font-size: 11px; display: block; }
.pnl-val.dim { color: #555; font-size: 13px; }
.pos-pnl.green .pnl-val { color: #00C853; }
.pos-pnl.green .pnl-pct { color: #00C853; }
.pos-pnl.red .pnl-val   { color: #FF1744; }
.pos-pnl.red .pnl-pct   { color: #FF1744; }
.pos-pnl.dim .pnl-val   { color: #555; }

/* 操作按钮 */
.pos-actions { display: flex; gap: 4px; }
.act-btn {
  background: transparent; border: 1px solid #2a2a4a; border-radius: 4px;
  padding: 2px 6px; font-size: 12px; cursor: pointer; line-height: 1.4;
}
.act-btn:hover { background: rgba(255,255,255,0.05); }
.del-btn:hover { border-color: #FF1744; }
.edit-btn:hover { border-color: #D4AF37; }

/* 内联编辑表单 */
.edit-form {
  background: rgba(212,175,55,0.04); border: 1px solid rgba(212,175,55,0.2);
  border-radius: 6px; padding: 10px; display: flex; flex-direction: column; gap: 8px;
}
.ef-row { display: flex; gap: 8px; flex-wrap: wrap; }
.ef-field { display: flex; flex-direction: column; gap: 3px; }
.ef-field label { font-size: 10px; color: #888; }
.ef-input {
  background: #0d0d1a; border: 1px solid #2a2a4a; border-radius: 4px;
  color: #e0e0e0; font-size: 12px; padding: 4px 8px; outline: none; width: 100px;
}
.ef-input:focus { border-color: #D4AF37; }
.ef-note .ef-input { width: 140px; }
.ef-btns { display: flex; gap: 8px; }
.ef-save {
  padding: 4px 16px; border-radius: 4px; border: none;
  background: linear-gradient(135deg, #D4AF37, #a88820);
  color: #0d0d1a; font-size: 12px; font-weight: 700; cursor: pointer;
}
.ef-cancel {
  padding: 4px 12px; border-radius: 4px; border: 1px solid #555;
  background: transparent; color: #888; font-size: 12px; cursor: pointer;
}
.ef-cancel:hover { border-color: #888; color: #ccc; }

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
.dim  { color: #555; }

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

/* 历史持仓 */
.closed-list { display: flex; flex-direction: column; gap: 6px; }
.closed-card {
  border: 1px solid #2a2a4a; border-radius: 6px; padding: 10px;
  display: flex; flex-direction: column; gap: 6px;
}
.closed-card.cp-win  { border-left: 3px solid #00C853; }
.closed-card.cp-loss { border-left: 3px solid #FF1744; }
.cp-header { display: flex; align-items: center; gap: 8px; }
.cp-info   { flex: 1; display: flex; flex-direction: column; gap: 2px; }
.cp-date   { font-size: 10px; color: #555; }
.cp-route  { font-size: 12px; color: #ccc; }
.arrow     { color: #555; margin: 0 4px; }
.cp-pnl    { font-size: 14px; font-weight: 700; text-align: right; min-width: 80px; }
.cp-hours  { font-size: 10px; color: #555; display: block; }
.cp-meta   { display: flex; gap: 8px; }
</style>
