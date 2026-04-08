<template>
  <div class="journal">

    <!-- ── 统计汇总栏 ── -->
    <div class="stats-bar" v-if="stats">
      <div class="stat-item">
        <span class="stat-label">累计盈亏</span>
        <span class="stat-val" :class="stats.totalPnl >= 0 ? 'green' : 'red'">
          {{ stats.totalPnl >= 0 ? '+' : '' }}¥{{ stats.totalPnl }}
        </span>
      </div>
      <div class="stat-item">
        <span class="stat-label">已结交易</span>
        <span class="stat-val">{{ stats.total }}笔</span>
      </div>
      <div class="stat-item">
        <span class="stat-label">胜率</span>
        <span class="stat-val" :class="stats.winRate >= 50 ? 'green' : 'red'">
          {{ stats.winRate }}%
        </span>
      </div>
      <div class="stat-item">
        <span class="stat-label">均盈</span>
        <span class="stat-val green">+¥{{ stats.avgWin }}</span>
      </div>
      <div class="stat-item">
        <span class="stat-label">均亏</span>
        <span class="stat-val red">¥{{ stats.avgLoss }}</span>
      </div>
      <div class="stat-item">
        <span class="stat-label">平均每笔</span>
        <span class="stat-val" :class="stats.avgPnl >= 0 ? 'green' : 'red'">
          {{ stats.avgPnl >= 0 ? '+' : '' }}¥{{ stats.avgPnl }}
        </span>
      </div>
    </div>

    <!-- ── 新增记录表单 ── -->
    <div class="add-form">
      <div class="form-title">+ 记录交易</div>
      <div class="form-row">
        <!-- 类型 -->
        <div class="type-toggle">
          <button :class="['type-btn', form.type === 'buy' ? 'active-buy' : '']" @click="form.type = 'buy'">买入</button>
          <button :class="['type-btn', form.type === 'sell' ? 'active-sell' : '']" @click="form.type = 'sell'">卖出</button>
        </div>
        <!-- 价格 -->
        <div class="field">
          <label>成交价 <span class="unit">¥/g</span></label>
          <input v-model.number="form.price" type="number" step="0.01"
            :placeholder="currentPrice > 0 ? currentPrice.toFixed(2) : '价格'" class="fi" />
        </div>
        <!-- 克数 -->
        <div class="field">
          <label>克数 <span class="unit">g</span></label>
          <input v-model.number="form.grams" type="number" step="0.1" min="0.001"
            placeholder="1.0" class="fi" />
        </div>
        <!-- 手续费 -->
        <div class="field field-sm">
          <label>手续费 <span class="unit">¥</span></label>
          <input v-model.number="form.fee" type="number" step="0.01" min="0"
            placeholder="0" class="fi" />
        </div>
        <!-- 配对买入（卖出时） -->
        <div class="field field-sm" v-if="form.type === 'sell'">
          <label>配对买入ID</label>
          <input v-model.number="form.pair_id" type="number" min="1"
            placeholder="买入记录ID" class="fi" />
        </div>
        <!-- 备注 -->
        <div class="field field-note">
          <label>备注</label>
          <input v-model="form.note" type="text" placeholder="可选" class="fi" />
        </div>
      </div>

      <!-- 预计盈亏预览（卖出且配对时） -->
      <div class="pnl-preview" v-if="form.type === 'sell' && previewPnl !== null">
        预计盈亏：
        <span :class="previewPnl >= 0 ? 'green' : 'red'">
          {{ previewPnl >= 0 ? '+' : '' }}¥{{ previewPnl.toFixed(2) }}
        </span>
      </div>

      <div class="form-footer">
        <button class="submit-btn" :class="form.type === 'buy' ? 'buy-btn' : 'sell-btn'"
          :disabled="!form.price || !form.grams || submitting"
          @click="submit">
          {{ submitting ? '提交中...' : (form.type === 'buy' ? '记录买入' : '记录卖出') }}
        </button>
        <span class="cost-hint" v-if="form.price && form.grams">
          金额：¥{{ (form.price * form.grams).toFixed(2) }}
          （含手续费 ¥{{ ((form.price * form.grams) + form.fee).toFixed(2) }}）
        </span>
      </div>
    </div>

    <!-- ── AI 分析按钮 ── -->
    <div class="ai-bar">
      <button class="ai-btn" :disabled="aiLoading || entries.length === 0" @click="analyzeWithAI">
        {{ aiLoading ? '🤖 AI分析中...' : '🤖 让AI分析我的交易历史' }}
      </button>
      <span class="ai-hint" v-if="entries.length === 0">暂无交易记录</span>
    </div>

    <!-- AI 分析结果 -->
    <div class="ai-result" v-if="aiResult">
      <div class="ai-result-header">
        🤖 AI 交易分析
        <button class="close-ai" @click="aiResult = ''">✕</button>
      </div>
      <div class="ai-result-body" v-html="formatAI(aiResult)"></div>
    </div>

    <!-- ── 流水列表 ── -->
    <div class="list-header">
      <span class="list-title">交易流水</span>
      <span class="list-count">共 {{ total }} 条</span>
      <button class="refresh-btn" @click="load(true)">⟳ 刷新</button>
    </div>

    <div class="loading" v-if="loading && !entries.length">加载中...</div>
    <div class="empty" v-else-if="!loading && !entries.length">暂无记录，记录第一笔交易吧</div>

    <div class="entry-list" v-else>
      <div class="entry"
        v-for="e in entries" :key="e.id"
        :class="e.type === 'buy' ? 'entry-buy' : (e.pnl !== null ? (e.pnl >= 0 ? 'entry-win' : 'entry-loss') : 'entry-sell')">

        <!-- 左侧：类型标签 + 日期 -->
        <div class="entry-left">
          <span class="type-badge" :class="e.type === 'buy' ? 'badge-buy' : 'badge-sell'">
            {{ e.type === 'buy' ? '买' : '卖' }}
          </span>
          <span class="entry-date">{{ fmtDate(e.ts) }}</span>
          <span class="entry-id">#{{ e.id }}</span>
        </div>

        <!-- 中间：价格 + 克数 + 手续费 -->
        <div class="entry-mid">
          <span class="entry-price">¥{{ e.price_cny_g.toFixed(2) }}/g</span>
          <span class="entry-grams">× {{ e.grams }}g</span>
          <span class="entry-amount">= ¥{{ (e.price_cny_g * e.grams).toFixed(2) }}</span>
          <span class="entry-fee" v-if="e.fee > 0">手续费 ¥{{ e.fee }}</span>
          <span class="entry-pair" v-if="e.pair_id">→ 对应买入#{{ e.pair_id }}</span>
          <span class="entry-note" v-if="e.note">{{ e.note }}</span>
        </div>

        <!-- 右侧：盈亏 + 删除 -->
        <div class="entry-right">
          <span class="entry-pnl" v-if="e.pnl !== null" :class="e.pnl >= 0 ? 'green' : 'red'">
            {{ e.pnl >= 0 ? '+' : '' }}¥{{ e.pnl.toFixed(2) }}
          </span>
          <span class="entry-pnl dim" v-else-if="e.type === 'buy'">持仓中</span>
          <button class="del-btn" @click="del(e.id)">✕</button>
        </div>
      </div>
    </div>

    <!-- ── 底部汇总 ── -->
    <div class="bottom-summary" v-if="stats && (stats.buyCnt > 0 || stats.sellCnt > 0)">
      <div class="bs-title">📊 交易汇总</div>
      <div class="bs-grid">
        <div class="bs-col buy-col">
          <div class="bs-head">买入</div>
          <div class="bs-row"><span class="bs-lbl">笔数</span><span class="bs-val">{{ stats.buyCnt }} 笔</span></div>
          <div class="bs-row"><span class="bs-lbl">总克数</span><span class="bs-val">{{ stats.buyTotalGrams }} g</span></div>
          <div class="bs-row"><span class="bs-lbl">总金额</span><span class="bs-val">¥{{ stats.buyTotalAmount.toFixed(2) }}</span></div>
          <div class="bs-row" v-if="stats.buyCnt > 0">
            <span class="bs-lbl">均价</span>
            <span class="bs-val">¥{{ (stats.buyTotalAmount / stats.buyTotalGrams).toFixed(2) }}/g</span>
          </div>
        </div>
        <div class="bs-col sell-col">
          <div class="bs-head">卖出</div>
          <div class="bs-row"><span class="bs-lbl">笔数</span><span class="bs-val">{{ stats.sellCnt }} 笔</span></div>
          <div class="bs-row"><span class="bs-lbl">总克数</span><span class="bs-val">{{ stats.sellTotalGrams }} g</span></div>
          <div class="bs-row"><span class="bs-lbl">总金额</span><span class="bs-val">¥{{ stats.sellTotalAmount.toFixed(2) }}</span></div>
          <div class="bs-row" v-if="stats.sellCnt > 0">
            <span class="bs-lbl">均价</span>
            <span class="bs-val">¥{{ (stats.sellTotalAmount / stats.sellTotalGrams).toFixed(2) }}/g</span>
          </div>
        </div>
        <div class="bs-col pnl-col">
          <div class="bs-head">盈亏</div>
          <div class="bs-row">
            <span class="bs-lbl">已实现</span>
            <span class="bs-val" :class="stats.totalPnl >= 0 ? 'green' : 'red'">
              {{ stats.totalPnl >= 0 ? '+' : '' }}¥{{ stats.totalPnl.toFixed(2) }}
            </span>
          </div>
          <!-- 浮动盈亏：实时计算，有未结持仓时显示 -->
          <div class="bs-row" v-if="floatingPnl !== null">
            <span class="bs-lbl float-lbl">浮动盈亏 <span class="live-dot">●</span></span>
            <span class="bs-val" :class="floatingPnl >= 0 ? 'green' : 'red'">
              {{ floatingPnl >= 0 ? '+' : '' }}¥{{ floatingPnl.toFixed(2) }}
            </span>
          </div>
          <div class="bs-row" v-if="openAvgCost !== null && stats.openGrams > 0">
            <span class="bs-lbl">持仓均价</span>
            <span class="bs-val gold">¥{{ openAvgCost!.toFixed(2) }}/g × {{ stats.openGrams }}g</span>
          </div>
          <!-- 总盈亏 = 已实现 + 浮动 -->
          <div class="bs-row total-pnl-row" v-if="totalPnlWithFloat !== null">
            <span class="bs-lbl"><b>总盈亏</b></span>
            <span class="bs-val total-pnl" :class="totalPnlWithFloat >= 0 ? 'green' : 'red'">
              {{ totalPnlWithFloat >= 0 ? '+' : '' }}¥{{ totalPnlWithFloat.toFixed(2) }}
            </span>
          </div>
          <div class="bs-row">
            <span class="bs-lbl">总手续费</span>
            <span class="bs-val red">-¥{{ stats.totalFee.toFixed(2) }}</span>
          </div>
          <div class="bs-row">
            <span class="bs-lbl">胜率</span>
            <span class="bs-val" :class="stats.winRate >= 50 ? 'green' : 'red'">
              {{ stats.winRate }}%（{{ stats.wins }}/{{ stats.total }}）
            </span>
          </div>
          <div class="bs-row">
            <span class="bs-lbl">净持仓克数</span>
            <span class="bs-val">{{ (stats.buyTotalGrams - stats.sellTotalGrams).toFixed(3) }} g</span>
          </div>
        </div>
      </div>
    </div>

    <!-- 分页 -->
    <div class="pagination" v-if="total > PAGE_SIZE">
      <button :disabled="page === 0" @click="goPage(page - 1)">← 上一页</button>
      <span>第 {{ page + 1 }} / {{ totalPages }} 页</span>
      <button :disabled="page >= totalPages - 1" @click="goPage(page + 1)">下一页 →</button>
    </div>

  </div>
</template>

<script setup lang="ts">
import { ref, reactive, computed, onMounted, watch } from 'vue';
import { api } from '../api';

const PAGE_SIZE = 50;

const props = defineProps<{ currentPrice?: number }>();
const currentPrice = computed(() => props.currentPrice ?? 0);

interface Entry {
  id: number; ts: number; type: 'buy' | 'sell';
  price_cny_g: number; grams: number; fee: number;
  note: string; pair_id: number | null; pnl: number | null;
}
interface Stats {
  total: number; wins: number; losses: number; winRate: number;
  totalPnl: number; avgPnl: number; avgWin: number; avgLoss: number;
  buyCnt: number; buyTotalAmount: number; buyTotalGrams: number;
  sellCnt: number; sellTotalAmount: number; sellTotalGrams: number;
  totalFee: number;
  // 未结持仓成本（后端返回，用于前端实时计算浮动盈亏）
  openGrams: number; openCostBasis: number; openFee: number;
}

const entries  = ref<Entry[]>([]);
const stats    = ref<Stats | null>(null);
const total    = ref(0);
const page     = ref(0);
const loading  = ref(false);
const submitting = ref(false);
const aiLoading  = ref(false);
const aiResult   = ref('');

const totalPages = computed(() => Math.max(1, Math.ceil(total.value / PAGE_SIZE)));

// ── 实时浮动盈亏（随 currentPrice prop 自动更新）──────────────
const floatingPnl = computed(() => {
  if (!stats.value || !currentPrice.value) return null;
  const { openGrams, openCostBasis, openFee } = stats.value;
  if (!openGrams || openGrams <= 0) return null;
  const avgCost = openCostBasis / openGrams;
  return (currentPrice.value - avgCost) * openGrams - openFee;
});
const openAvgCost = computed(() => {
  if (!stats.value?.openGrams) return null;
  return stats.value.openCostBasis / stats.value.openGrams;
});
const totalPnlWithFloat = computed(() => {
  if (!stats.value) return null;
  const realized = stats.value.totalPnl;
  const floating = floatingPnl.value ?? 0;
  return realized + floating;
});

const form = reactive({
  type: 'buy' as 'buy' | 'sell',
  price: 0,
  grams: 0,
  fee: 0,
  note: '',
  pair_id: null as number | null,
});

// 卖出预计盈亏预览
const previewPnl = computed(() => {
  if (form.type !== 'sell' || !form.pair_id || !form.price || !form.grams) return null;
  const buyEntry = entries.value.find(e => e.id === form.pair_id && e.type === 'buy');
  if (!buyEntry) return null;
  const grams = Math.min(form.grams, buyEntry.grams);
  return (form.price - buyEntry.price_cny_g) * grams - form.fee - buyEntry.fee;
});

// 当前价格变化时自动填入价格输入框（仅未手动填写时）
watch(() => currentPrice.value, (p) => {
  if (p > 0 && !form.price) form.price = parseFloat(p.toFixed(2));
}, { immediate: true });

async function load(reset = false) {
  if (reset) page.value = 0;
  loading.value = true;
  try {
    const [j, s] = await Promise.all([
      api.getJournal({ limit: PAGE_SIZE, offset: page.value * PAGE_SIZE }) as Promise<{ total: number; data: Entry[] }>,
      api.getJournalStats() as Promise<Stats>,
    ]);
    entries.value = j.data;
    total.value   = j.total;
    stats.value   = s;
  } catch (e) {
    console.error('[Journal] load failed', e);
  } finally {
    loading.value = false;
  }
}

async function submit() {
  if (!form.price || !form.grams || submitting.value) return;
  submitting.value = true;
  try {
    await api.addJournalEntry({
      type:        form.type,
      price_cny_g: form.price,
      grams:       form.grams,
      fee:         form.fee,
      note:        form.note,
      pair_id:     form.type === 'sell' ? form.pair_id : null,
    });
    // 重置表单（保留类型和价格）
    form.grams   = 0;
    form.fee     = 0;
    form.note    = '';
    form.pair_id = null;
    await load(true);
  } catch (e) {
    alert('添加失败：' + String(e instanceof Error ? e.message : e));
  } finally {
    submitting.value = false;
  }
}

async function del(id: number) {
  if (!confirm(`确认删除记录 #${id}？`)) return;
  try {
    await api.deleteJournalEntry(id);
    await load(true);
  } catch (e) {
    alert('删除失败');
  }
}

async function goPage(p: number) {
  page.value = p;
  await load();
}

async function analyzeWithAI() {
  aiLoading.value = true;
  aiResult.value  = '';
  try {
    const { context } = await api.getJournalAIContext() as { context: string };
    const s = stats.value;

    // 构造统计摘要供 AI 参考
    const statsSummary = s ? [
      `【交易统计摘要】`,
      `买入：${s.buyCnt}笔 共${s.buyTotalGrams}g 总额¥${s.buyTotalAmount.toFixed(2)} 均价¥${s.buyCnt > 0 ? (s.buyTotalAmount / s.buyTotalGrams).toFixed(2) : 'N/A'}/g`,
      `卖出：${s.sellCnt}笔 共${s.sellTotalGrams}g 总额¥${s.sellTotalAmount.toFixed(2)} 均价¥${s.sellCnt > 0 ? (s.sellTotalAmount / s.sellTotalGrams).toFixed(2) : 'N/A'}/g`,
      `已实现盈亏：${s.totalPnl >= 0 ? '+' : ''}¥${s.totalPnl.toFixed(2)}`,
      `胜率：${s.winRate}%（盈${s.wins}笔/亏${s.losses}笔）`,
      `均盈：+¥${s.avgWin.toFixed(2)} | 均亏：¥${s.avgLoss.toFixed(2)} | 盈亏比：${s.avgLoss !== 0 ? Math.abs(s.avgWin / s.avgLoss).toFixed(2) : 'N/A'}`,
      `总手续费支出：¥${s.totalFee.toFixed(2)}`,
      `净持仓克数：${(s.buyTotalGrams - s.sellTotalGrams).toFixed(3)}g（尚未卖出）`,
    ].join('\n') : '';

    const prompt = `你是一位专业的黄金投资顾问，擅长积存金交易分析。请基于以下我的真实交易记录和统计数据，给出深度、具体、可执行的分析报告。

${statsSummary}

【完整交易流水】
${context}

请按以下结构输出分析报告（使用简洁中文，用**加粗**标注关键数字/结论）：

**一、整体绩效评估**
- 已实现盈亏与绩效评级（优秀/良好/需改进）
- 盈亏比分析：均盈/均亏是否合理，与1:2目标差距
- 手续费侵蚀：手续费占总盈亏的比例

**二、交易行为诊断**
- 买卖均价差：我的买入均价 vs 卖出均价，利润空间是否足够
- 持仓时间分析（如能从时间戳判断）：是否存在过早止盈或死扛亏损
- 频率问题：交易是否过于频繁或稀疏

**三、典型案例点评**
- 最佳一笔：哪笔交易最成功？为什么？
- 最差一笔：哪笔亏损最大？犯了什么错误？

**四、具体改进建议**（3-5条可立即执行的操作建议）
- 针对我的具体数据，给出下一步操作方向

**五、风险提示**
- 当前净持仓风险评估`;

    const { answer } = await api.chatWithAI(prompt) as { answer: string };
    aiResult.value = answer;
  } catch (e) {
    alert('AI 分析失败：' + String(e instanceof Error ? e.message : e));
  } finally {
    aiLoading.value = false;
  }
}

function fmtDate(ts: number): string {
  return new Date(ts).toLocaleString('zh-CN', {
    month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  });
}

function formatAI(text: string): string {
  return text
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\n/g, '<br>');
}

onMounted(() => load(true));
</script>

<style scoped>
.journal { display: flex; flex-direction: column; gap: 12px; }

/* ── 统计栏 ── */
.stats-bar {
  display: flex; flex-wrap: wrap; gap: 8px;
  background: rgba(0,0,0,0.2); border-radius: 8px; padding: 10px 14px;
}
.stat-item { display: flex; flex-direction: column; align-items: center; min-width: 70px; }
.stat-label { font-size: 10px; color: #666; }
.stat-val   { font-size: 14px; font-weight: 700; }
.green { color: #00C853; }
.red   { color: #FF1744; }
.dim   { color: #555; }

/* ── 添加表单 ── */
.add-form {
  background: rgba(255,255,255,0.03);
  border: 1px solid #2a2a4a; border-radius: 8px; padding: 12px 14px;
}
.form-title { font-size: 11px; font-weight: 700; color: #888; margin-bottom: 10px; }
.form-row   { display: flex; flex-wrap: wrap; gap: 8px; align-items: flex-end; }
.field      { display: flex; flex-direction: column; gap: 3px; }
.field-sm   { min-width: 80px; }
.field-note { flex: 1; min-width: 100px; }
label       { font-size: 10px; color: #666; }
.unit       { color: #444; }
.fi {
  background: rgba(255,255,255,0.05); border: 1px solid #2a2a4a;
  color: #ccc; border-radius: 4px; padding: 5px 8px; font-size: 12px;
  width: 90px; outline: none;
}
.fi:focus { border-color: #D4AF37; }
.field-note .fi { width: 100%; }

.type-toggle { display: flex; gap: 0; border-radius: 4px; overflow: hidden; border: 1px solid #2a2a4a; }
.type-btn {
  padding: 5px 14px; font-size: 12px; background: transparent;
  color: #666; border: none; cursor: pointer; transition: all 0.15s;
}
.active-buy  { background: rgba(0,200,83,0.2);  color: #00C853; }
.active-sell { background: rgba(255,23,68,0.2);  color: #FF1744; }

.pnl-preview {
  font-size: 12px; color: #888; margin-top: 6px; padding: 4px 8px;
  background: rgba(255,255,255,0.03); border-radius: 4px;
}

.form-footer { display: flex; align-items: center; gap: 12px; margin-top: 10px; }
.submit-btn {
  padding: 6px 20px; border-radius: 4px; border: none;
  font-size: 12px; font-weight: 700; cursor: pointer;
}
.buy-btn  { background: rgba(0,200,83,0.2);  color: #00C853; }
.buy-btn:hover:not(:disabled)  { background: rgba(0,200,83,0.35); }
.sell-btn { background: rgba(255,23,68,0.2); color: #FF1744; }
.sell-btn:hover:not(:disabled) { background: rgba(255,23,68,0.35); }
.submit-btn:disabled { opacity: 0.4; cursor: not-allowed; }
.cost-hint { font-size: 11px; color: #555; }

/* ── AI 分析 ── */
.ai-bar { display: flex; align-items: center; gap: 10px; }
.ai-btn {
  padding: 6px 16px; border-radius: 4px;
  background: rgba(212,175,55,0.15); border: 1px solid rgba(212,175,55,0.3);
  color: #D4AF37; font-size: 12px; cursor: pointer;
}
.ai-btn:hover:not(:disabled) { background: rgba(212,175,55,0.25); }
.ai-btn:disabled { opacity: 0.4; cursor: not-allowed; }
.ai-hint { font-size: 11px; color: #444; }

.ai-result {
  border: 1px solid rgba(212,175,55,0.3); border-radius: 8px;
  background: rgba(212,175,55,0.04); overflow: hidden;
}
.ai-result-header {
  display: flex; justify-content: space-between; align-items: center;
  padding: 8px 12px; background: rgba(212,175,55,0.1);
  font-size: 12px; font-weight: 700; color: #D4AF37;
}
.close-ai {
  background: transparent; border: none; color: #888;
  cursor: pointer; font-size: 12px;
}
.close-ai:hover { color: #FF1744; }
.ai-result-body {
  padding: 12px 14px; font-size: 12px; line-height: 1.7;
  color: #ddd; max-height: 300px; overflow-y: auto;
}

/* ── 列表 ── */
.list-header {
  display: flex; align-items: center; gap: 8px;
}
.list-title { font-size: 12px; font-weight: 700; color: #888; }
.list-count { font-size: 11px; color: #444; }
.refresh-btn {
  margin-left: auto; padding: 3px 10px; border-radius: 4px;
  border: 1px solid #2a2a4a; background: transparent;
  color: #666; font-size: 11px; cursor: pointer;
}
.refresh-btn:hover { border-color: #555; color: #ccc; }

.loading, .empty { text-align: center; color: #555; font-size: 12px; padding: 20px 0; }

.entry-list { display: flex; flex-direction: column; gap: 4px; max-height: 480px; overflow-y: auto; }

.entry {
  display: flex; align-items: center; gap: 8px;
  padding: 7px 10px; border-radius: 5px; border: 1px solid #1e1e38;
  font-size: 12px;
}
.entry-buy  { border-left: 3px solid rgba(0,200,83,0.4); background: rgba(0,200,83,0.03); }
.entry-win  { border-left: 3px solid rgba(0,200,83,0.6); background: rgba(0,200,83,0.05); }
.entry-loss { border-left: 3px solid rgba(255,23,68,0.6); background: rgba(255,23,68,0.05); }
.entry-sell { border-left: 3px solid rgba(255,255,255,0.1); }

.entry-left  { display: flex; align-items: center; gap: 5px; flex-shrink: 0; }
.entry-mid   { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; flex: 1; color: #aaa; }
.entry-right { display: flex; align-items: center; gap: 6px; flex-shrink: 0; }

.type-badge {
  font-size: 9px; font-weight: 700; padding: 1px 5px; border-radius: 3px;
}
.badge-buy  { background: rgba(0,200,83,0.2);  color: #00C853; }
.badge-sell { background: rgba(255,23,68,0.2);  color: #FF1744; }

.entry-date  { font-size: 10px; color: #555; }
.entry-id    { font-size: 9px; color: #333; }
.entry-price { color: #D4AF37; font-weight: 600; }
.entry-grams { color: #888; }
.entry-amount { color: #ccc; }
.entry-fee   { font-size: 10px; color: #555; }
.entry-pair  { font-size: 10px; color: #42A5F5; }
.entry-note  { font-size: 10px; color: #666; font-style: italic; }

.entry-pnl  { font-weight: 700; font-size: 13px; min-width: 70px; text-align: right; }
.del-btn {
  background: transparent; border: none; color: #333;
  cursor: pointer; font-size: 11px; padding: 0 2px;
}
.del-btn:hover { color: #FF1744; }

/* ── 底部汇总 ── */
.bottom-summary {
  border: 1px solid #2a2a4a; border-radius: 8px;
  background: rgba(0,0,0,0.25); padding: 12px 14px;
}
.bs-title {
  font-size: 11px; font-weight: 700; color: #888;
  margin-bottom: 10px; letter-spacing: 0.05em;
}
.bs-grid {
  display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 12px;
}
@media (max-width: 700px) {
  .bs-grid { grid-template-columns: 1fr; }
}
.bs-col { display: flex; flex-direction: column; gap: 5px; }
.bs-head {
  font-size: 11px; font-weight: 700; padding-bottom: 4px;
  border-bottom: 1px solid #2a2a4a; margin-bottom: 2px;
}
.buy-col  .bs-head { color: #00C853; }
.sell-col .bs-head { color: #FF1744; }
.pnl-col  .bs-head { color: #D4AF37; }
.bs-row { display: flex; justify-content: space-between; align-items: center; gap: 6px; }
.bs-lbl { font-size: 10px; color: #555; flex-shrink: 0; }
.bs-val { font-size: 12px; color: #bbb; font-weight: 500; text-align: right; }
.bs-val.gold { color: #D4AF37; }

/* 浮动盈亏实时标识 */
.float-lbl { display: flex; align-items: center; gap: 3px; }
.live-dot { color: #00C853; font-size: 7px; animation: blink 1.4s ease-in-out infinite; }
@keyframes blink { 0%,100% { opacity: 1; } 50% { opacity: 0.2; } }

/* 总盈亏行加粗突出 */
.total-pnl-row { border-top: 1px solid #2a2a4a; padding-top: 4px; margin-top: 2px; }
.total-pnl { font-size: 14px !important; font-weight: 800 !important; }

/* ── 分页 ── */
.pagination {
  display: flex; align-items: center; justify-content: center;
  gap: 12px; font-size: 11px; color: #555;
}
.pagination button {
  padding: 3px 10px; border-radius: 4px; border: 1px solid #2a2a4a;
  background: transparent; color: #888; font-size: 11px; cursor: pointer;
}
.pagination button:hover:not(:disabled) { border-color: #555; color: #ccc; }
.pagination button:disabled { opacity: 0.35; cursor: not-allowed; }
</style>
