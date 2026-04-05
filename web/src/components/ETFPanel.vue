<template>
  <div class="etf">
    <div class="etf-row" v-for="fund in funds" :key="fund.name">
      <span class="fund-name">{{ fund.name }}</span>
      <span class="fund-tonnes">{{ fund.tonnes?.toFixed(1) }}t</span>
      <span class="fund-change" :class="(fund.change ?? 0) > 0 ? 'up' : (fund.change ?? 0) < 0 ? 'down' : ''">
        {{ (fund.change ?? 0) > 0 ? '+' : '' }}{{ fund.change?.toFixed(1) ?? '—' }}t
      </span>
    </div>
    <p v-if="funds.length === 0" class="no-data">暂无ETF数据</p>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';

interface FundRow { name: string; tonnes: number; change: number | null; }

const props = defineProps<{ data: Record<string, unknown> }>();

const funds = computed<FundRow[]>(() => {
  return Object.entries(props.data).map(([name, rows]) => {
    const arr = (rows as unknown[]);
    const latest = (arr[0] ?? {}) as Record<string, number>;
    return { name, tonnes: latest['tonnes'] ?? 0, change: latest['change_val'] ?? null };
  }).filter(f => f.tonnes > 0);
});
</script>

<style scoped>
.etf { display: flex; flex-direction: column; gap: 10px; }
.etf-row { display: flex; justify-content: space-between; align-items: center; padding: 6px 0; border-bottom: 1px solid #2a2a4a; }
.fund-name { font-weight: 600; font-size: 13px; color: #D4AF37; }
.fund-tonnes { font-size: 12px; color: #e0e0e0; }
.fund-change { font-size: 12px; }
.fund-change.up { color: #00C853; }
.fund-change.down { color: #FF1744; }
.no-data { color: #888; font-size: 12px; text-align: center; padding: 20px 0; }
</style>
