<template>
  <div class="qa-history">

    <!-- 顶部控制栏 -->
    <div class="qa-toolbar">
      <div class="type-tabs">
        <button
          v-for="t in TYPE_TABS"
          :key="t.value"
          class="type-tab"
          :class="{ active: activeType === t.value }"
          @click="switchType(t.value)"
        >{{ t.label }}<span class="tab-count" v-if="typeCount(t.value) > 0">{{ typeCount(t.value) }}</span></button>
      </div>
      <button class="refresh-btn" :disabled="loading" @click="load(true)">⟳ 刷新</button>
    </div>

    <!-- 加载中 -->
    <div class="qa-loading" v-if="loading && !records.length">
      <span class="spin">◐</span> 加载中...
    </div>

    <!-- 空状态 -->
    <div class="qa-empty" v-else-if="!loading && !records.length">
      暂无 {{ currentLabel }} 记录，开始对话或提交想法后将自动保存
    </div>

    <!-- 列表 -->
    <div class="qa-list" v-else>
      <div
        class="qa-item"
        v-for="r in records"
        :key="r.id"
        :class="{ expanded: expandedIds.has(r.id) }"
      >
        <!-- 头部：类型标签 + 时间 + 问题摘要 -->
        <div class="qa-item-header" @click="toggle(r.id)">
          <span class="qa-type-badge" :class="r.type">{{ TYPE_LABELS[r.type] ?? r.type }}</span>

          <!-- idea 类型展示方向/评分/操作 -->
          <template v-if="r.type === 'idea' && r.meta">
            <span class="idea-dir" :class="r.meta.direction">
              {{ DIR_ICONS[r.meta.direction] ?? '' }} {{ r.meta.direction }}
            </span>
            <span class="idea-score">{{ r.meta.score }}/10</span>
            <span class="idea-action">{{ r.meta.action }}</span>
          </template>

          <span class="qa-question-preview">{{ preview(r.question) }}</span>
          <span class="qa-time">{{ formatTime(r.ts) }}</span>
          <span class="qa-arrow">{{ expandedIds.has(r.id) ? '▲' : '▼' }}</span>
          <button class="qa-del" @click.stop="del(r.id)" title="删除">✕</button>
        </div>

        <!-- 展开内容 -->
        <div class="qa-item-body" v-if="expandedIds.has(r.id)">
          <!-- 问题 -->
          <div class="qa-section">
            <div class="qa-section-label">
              {{ r.type === 'idea' ? '📝 我的想法' : '❓ 问题' }}
            </div>
            <div class="qa-text question-text">{{ r.question }}</div>
          </div>

          <!-- 想法分析附加信息 -->
          <div class="idea-meta-row" v-if="r.type === 'idea' && r.meta">
            <span v-if="r.meta.entry"    class="meta-chip entry">入场 ¥{{ r.meta.entry }}/g</span>
            <span v-if="r.meta.stopLoss" class="meta-chip stop">止损 ¥{{ r.meta.stopLoss }}/g</span>
            <span v-if="r.meta.target"   class="meta-chip target">目标 ¥{{ r.meta.target }}/g</span>
            <span v-if="r.meta.riskReward" class="meta-chip rr">盈亏比 {{ r.meta.riskReward }}</span>
          </div>

          <!-- AI 回答 -->
          <div class="qa-section">
            <div class="qa-section-label">🤖 AI 回答</div>
            <div class="qa-text answer-text" v-html="formatAnswer(r.answer)"></div>
          </div>
        </div>
      </div>
    </div>

    <!-- 分页 -->
    <div class="qa-pagination" v-if="total > PAGE_SIZE">
      <button :disabled="page === 0" @click="goPage(page - 1)">← 上一页</button>
      <span>第 {{ page + 1 }} / {{ totalPages }} 页（共 {{ total }} 条）</span>
      <button :disabled="page >= totalPages - 1" @click="goPage(page + 1)">下一页 →</button>
    </div>

  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { api } from '../api';

const PAGE_SIZE = 20;

const TYPE_TABS = [
  { value: '',     label: '全部' },
  { value: 'chat', label: '💬 AI 聊天' },
  { value: 'idea', label: '💡 想法分析' },
];
const TYPE_LABELS: Record<string, string> = {
  chat:   '聊天',
  idea:   '想法',
  review: '复盘',
};
const DIR_ICONS: Record<string, string> = {
  bullish: '🟢',
  bearish: '🔴',
  neutral: '🟡',
};

interface Meta {
  direction?: string;
  score?: number;
  action?: string;
  entry?: number | null;
  stopLoss?: number | null;
  target?: number | null;
  riskReward?: string | null;
}
interface QARecord {
  id: number;
  ts: number;
  type: string;
  question: string;
  answer: string;
  meta: Meta | null;
}

const records     = ref<QARecord[]>([]);
const loading     = ref(false);
const activeType  = ref('');
const total       = ref(0);
const page        = ref(0);
const expandedIds = ref(new Set<number>());
const counts      = ref<Record<string, number>>({ '': 0, chat: 0, idea: 0 });

const totalPages  = computed(() => Math.max(1, Math.ceil(total.value / PAGE_SIZE)));
const currentLabel = computed(() => TYPE_TABS.find(t => t.value === activeType.value)?.label ?? '全部');

function typeCount(t: string): number { return counts.value[t] ?? 0; }

function preview(q: string): string {
  const s = q.replace(/\n/g, ' ').trim();
  return s.length > 40 ? s.slice(0, 40) + '...' : s;
}

function formatTime(ts: number): string {
  return new Date(ts).toLocaleString('zh-CN', {
    month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit',
  });
}

function formatAnswer(text: string): string {
  return text
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\n/g, '<br>');
}

function toggle(id: number) {
  if (expandedIds.value.has(id)) {
    expandedIds.value.delete(id);
  } else {
    expandedIds.value.add(id);
  }
}

async function load(reset = false) {
  if (reset) { page.value = 0; expandedIds.value.clear(); }
  loading.value = true;
  try {
    const res = await api.getQALog({
      type:   activeType.value || undefined,
      limit:  PAGE_SIZE,
      offset: page.value * PAGE_SIZE,
    }) as { total: number; data: QARecord[] };
    records.value = res.data;
    total.value   = res.total;

    // 更新各类型计数（只在切换类型/首次加载时）
    if (reset || !counts.value['']) {
      const [all, chat, idea] = await Promise.all([
        api.getQALog({ limit: 0 }) as Promise<{ total: number }>,
        api.getQALog({ type: 'chat', limit: 0 }) as Promise<{ total: number }>,
        api.getQALog({ type: 'idea', limit: 0 }) as Promise<{ total: number }>,
      ]);
      counts.value = { '': all.total, chat: chat.total, idea: idea.total };
    }
  } catch (e) {
    console.error('[AIQAHistory] load failed', e);
  } finally {
    loading.value = false;
  }
}

async function switchType(t: string) {
  activeType.value = t;
  await load(true);
}

async function goPage(p: number) {
  page.value = p;
  expandedIds.value.clear();
  await load();
}

async function del(id: number) {
  try {
    await api.deleteQALog(id);
    records.value = records.value.filter(r => r.id !== id);
    total.value   = Math.max(0, total.value - 1);
    counts.value[''] = Math.max(0, counts.value[''] - 1);
  } catch (e) {
    console.error('[AIQAHistory] delete failed', e);
  }
}

onMounted(() => load(true));
</script>

<style scoped>
.qa-history {
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-height: 200px;
}

/* ── 工具栏 ── */
.qa-toolbar {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.type-tabs { display: flex; gap: 4px; }
.type-tab {
  padding: 4px 12px;
  border-radius: 4px;
  border: 1px solid #2a2a4a;
  background: transparent;
  color: #888;
  font-size: 11px;
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 4px;
  transition: all 0.15s;
}
.type-tab.active  { background: rgba(212,175,55,0.15); border-color: #D4AF37; color: #D4AF37; }
.type-tab:hover:not(.active) { border-color: #555; color: #ccc; }
.tab-count {
  background: #2a2a4a;
  color: #888;
  font-size: 9px;
  padding: 0 4px;
  border-radius: 8px;
  min-width: 16px;
  text-align: center;
}
.type-tab.active .tab-count { background: rgba(212,175,55,0.25); color: #D4AF37; }
.refresh-btn {
  margin-left: auto;
  padding: 4px 10px;
  border-radius: 4px;
  border: 1px solid #2a2a4a;
  background: transparent;
  color: #888;
  font-size: 11px;
  cursor: pointer;
}
.refresh-btn:hover:not(:disabled) { border-color: #555; color: #ccc; }
.refresh-btn:disabled { opacity: 0.4; cursor: not-allowed; }

/* ── 加载/空 ── */
.qa-loading, .qa-empty {
  text-align: center;
  color: #555;
  font-size: 12px;
  padding: 24px 0;
}
.spin { display: inline-block; animation: spin 1s linear infinite; margin-right: 6px; }
@keyframes spin { to { transform: rotate(360deg); } }

/* ── 列表 ── */
.qa-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
  max-height: 560px;
  overflow-y: auto;
  padding-right: 2px;
}

/* ── 单条记录 ── */
.qa-item {
  border: 1px solid #2a2a4a;
  border-radius: 6px;
  overflow: hidden;
  transition: border-color 0.15s;
}
.qa-item.expanded { border-color: #4a4a7a; }

.qa-item-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  cursor: pointer;
  background: rgba(255,255,255,0.02);
  user-select: none;
  flex-wrap: wrap;
}
.qa-item-header:hover { background: rgba(255,255,255,0.04); }

.qa-type-badge {
  font-size: 9px;
  padding: 2px 6px;
  border-radius: 3px;
  font-weight: 700;
  flex-shrink: 0;
}
.qa-type-badge.chat   { background: rgba(66,165,245,0.2); color: #42A5F5; }
.qa-type-badge.idea   { background: rgba(212,175,55,0.2); color: #D4AF37; }
.qa-type-badge.review { background: rgba(0,200,83,0.2);  color: #00C853; }

.idea-dir { font-size: 10px; font-weight: 700; flex-shrink: 0; }
.idea-dir.bullish { color: #00C853; }
.idea-dir.bearish { color: #FF1744; }
.idea-dir.neutral { color: #FFD740; }
.idea-score  { font-size: 10px; color: #888; flex-shrink: 0; }
.idea-action { font-size: 10px; color: #D4AF37; flex-shrink: 0; }

.qa-question-preview {
  flex: 1;
  font-size: 12px;
  color: #ccc;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.qa-time  { font-size: 10px; color: #555; flex-shrink: 0; }
.qa-arrow { font-size: 9px; color: #555; flex-shrink: 0; }

.qa-del {
  flex-shrink: 0;
  background: transparent;
  border: none;
  color: #444;
  cursor: pointer;
  font-size: 11px;
  padding: 0 2px;
  line-height: 1;
}
.qa-del:hover { color: #FF1744; }

/* ── 展开内容 ── */
.qa-item-body {
  padding: 12px 14px;
  border-top: 1px solid #2a2a4a;
  background: rgba(0,0,0,0.15);
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.qa-section { display: flex; flex-direction: column; gap: 5px; }
.qa-section-label { font-size: 10px; font-weight: 700; color: #888; letter-spacing: 0.5px; }

.qa-text {
  font-size: 12px;
  line-height: 1.6;
  word-break: break-word;
}
.question-text { color: #bbb; background: rgba(255,255,255,0.03); padding: 8px 10px; border-radius: 4px; }
.answer-text   { color: #e0e0e0; }

/* ── idea 元信息行 ── */
.idea-meta-row {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.meta-chip {
  font-size: 10px;
  padding: 2px 8px;
  border-radius: 10px;
  font-weight: 600;
}
.meta-chip.entry  { background: rgba(212,175,55,0.15); color: #D4AF37; }
.meta-chip.stop   { background: rgba(255,23,68,0.15);  color: #FF1744; }
.meta-chip.target { background: rgba(0,200,83,0.15);   color: #00C853; }
.meta-chip.rr     { background: rgba(66,165,245,0.15); color: #42A5F5; }

/* ── 分页 ── */
.qa-pagination {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 12px;
  padding-top: 4px;
  font-size: 11px;
  color: #666;
}
.qa-pagination button {
  padding: 3px 10px;
  border-radius: 4px;
  border: 1px solid #2a2a4a;
  background: transparent;
  color: #888;
  font-size: 11px;
  cursor: pointer;
}
.qa-pagination button:hover:not(:disabled) { border-color: #555; color: #ccc; }
.qa-pagination button:disabled { opacity: 0.35; cursor: not-allowed; }
</style>
