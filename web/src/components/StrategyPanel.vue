<template>
  <div class="strategy-panel">
    <!-- 过滤器 -->
    <div class="filters">
      <button
        v-for="f in statusFilters"
        :key="f.value"
        class="filter-btn"
        :class="{ active: activeFilter === f.value }"
        @click="activeFilter = f.value"
      >{{ f.label }}</button>
    </div>

    <!-- 策略列表 -->
    <div class="strategy-list" v-if="filtered.length > 0">
      <div
        v-for="item in filtered"
        :key="item.id"
        class="strategy-item"
        @click="expandedId = expandedId === item.id ? null : item.id"
      >
        <div class="strategy-header">
          <span class="strategy-id">{{ item.id }}</span>
          <span class="status-badge" :class="statusClass(item.status)">{{ item.status }}</span>
          <span class="strategy-module">{{ item.module }}</span>
          <span class="strategy-date">{{ item.date }}</span>
        </div>
        <div class="strategy-title">{{ item.title }}</div>

        <div class="strategy-detail" v-if="expandedId === item.id">
          <div class="detail-row" v-if="item.description">
            <span class="detail-label">描述</span>
            <span class="detail-value">{{ item.description }}</span>
          </div>
          <div class="detail-row" v-if="item.comparison">
            <span class="detail-label">对比</span>
            <span class="detail-value">{{ item.comparison }}</span>
          </div>
          <div class="detail-row" v-if="item.conclusion">
            <span class="detail-label">结论</span>
            <span class="detail-value">{{ item.conclusion }}</span>
          </div>
        </div>
      </div>
    </div>

    <div class="empty" v-else>
      <span>暂无{{ activeFilter === 'all' ? '' : statusFilters.find(f=>f.value===activeFilter)?.label }}策略</span>
    </div>

    <!-- 刷新按钮 -->
    <button class="refresh-btn" @click="load" :disabled="loading">
      {{ loading ? '加载中...' : '🔄 刷新' }}
    </button>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { api } from '../api';

interface StrategyItem {
  id: string;
  title: string;
  date: string;
  module: string;
  status: string;
  description?: string;
  comparison?: string;
  conclusion?: string;
}

const strategies = ref<StrategyItem[]>([]);
const loading = ref(false);
const activeFilter = ref('all');
const expandedId = ref<string | null>(null);

const statusFilters = [
  { value: 'all',  label: '全部' },
  { value: '🟢',  label: '🟢 已采纳' },
  { value: '🟡',  label: '🟡 待评估' },
  { value: '🔵',  label: '🔵 备选' },
  { value: '🔴',  label: '🔴 已放弃' },
];

const filtered = computed(() => {
  if (activeFilter.value === 'all') return strategies.value;
  return strategies.value.filter(s => s.status.startsWith(activeFilter.value));
});

function statusClass(status: string) {
  if (status.includes('🟢')) return 'adopted';
  if (status.includes('🟡')) return 'pending';
  if (status.includes('🔵')) return 'reserved';
  if (status.includes('🔴')) return 'rejected';
  return '';
}

async function load() {
  loading.value = true;
  try {
    const data = await api.getStrategy() as StrategyItem[];
    strategies.value = data;
  } catch {
    strategies.value = [];
  } finally {
    loading.value = false;
  }
}

onMounted(load);
</script>

<style scoped>
.strategy-panel { display: flex; flex-direction: column; gap: 10px; }
.filters { display: flex; gap: 6px; flex-wrap: wrap; }
.filter-btn {
  padding: 3px 10px; border-radius: 20px; border: 1px solid #2a2a4a;
  background: transparent; color: #888; font-size: 11px; cursor: pointer;
}
.filter-btn.active { border-color: #D4AF37; color: #D4AF37; }

.strategy-list { display: flex; flex-direction: column; gap: 6px; max-height: 360px; overflow-y: auto; }
.strategy-item {
  padding: 8px 10px; border: 1px solid #2a2a4a; border-radius: 6px; cursor: pointer;
  transition: border-color 0.2s;
}
.strategy-item:hover { border-color: #D4AF37; }

.strategy-header { display: flex; align-items: center; gap: 8px; margin-bottom: 4px; }
.strategy-id { font-size: 11px; font-weight: 700; color: #D4AF37; }
.status-badge { font-size: 10px; padding: 1px 6px; border-radius: 10px; }
.status-badge.adopted  { background: rgba(0,200,83,0.15); color: #00C853; }
.status-badge.pending  { background: rgba(255,214,0,0.15); color: #FFD600; }
.status-badge.reserved { background: rgba(33,150,243,0.15); color: #42A5F5; }
.status-badge.rejected { background: rgba(255,23,68,0.15);  color: #FF1744; }
.strategy-module { font-size: 10px; color: #888; }
.strategy-date { font-size: 10px; color: #666; margin-left: auto; }

.strategy-title { font-size: 12px; color: #e0e0e0; line-height: 1.4; }

.strategy-detail { margin-top: 8px; padding-top: 8px; border-top: 1px solid #2a2a4a; display: flex; flex-direction: column; gap: 6px; }
.detail-row { display: flex; gap: 8px; }
.detail-label { font-size: 10px; color: #D4AF37; min-width: 32px; padding-top: 2px; }
.detail-value { font-size: 11px; color: #aaa; line-height: 1.5; }

.empty { text-align: center; color: #888; font-size: 12px; padding: 20px 0; }
.refresh-btn {
  align-self: flex-end; padding: 4px 12px; border-radius: 6px;
  border: 1px solid #2a2a4a; background: transparent; color: #888;
  font-size: 11px; cursor: pointer;
}
.refresh-btn:hover { border-color: #D4AF37; color: #D4AF37; }
.refresh-btn:disabled { opacity: 0.4; cursor: not-allowed; }
</style>
