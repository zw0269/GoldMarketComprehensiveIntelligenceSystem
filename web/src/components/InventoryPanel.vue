<template>
  <div class="inventory">
    <div class="inv-row" v-for="ex in exchanges" :key="ex.name">
      <div class="inv-header">
        <span class="inv-name">{{ ex.name }}</span>
        <span class="inv-total">{{ formatNum(ex.total) }} {{ ex.unit }}</span>
        <span class="inv-change" :class="ex.change > 0 ? 'up' : ex.change < 0 ? 'down' : ''">
          {{ ex.change > 0 ? '+' : '' }}{{ formatNum(ex.change) }}
        </span>
      </div>
      <div class="inv-bar" v-if="ex.registered !== undefined">
        <div class="bar-reg" :style="{ width: regPct(ex) + '%' }" title="Registered"></div>
        <div class="bar-eli" :style="{ width: eliPct(ex) + '%' }" title="Eligible"></div>
      </div>
      <div class="inv-detail" v-if="ex.registered !== undefined">
        <span>Reg: {{ formatNum(ex.registered) }}</span>
        <span>Eli: {{ formatNum(ex.eligible) }}</span>
      </div>
    </div>
    <p v-if="exchanges.length === 0" class="no-data">暂无库存数据</p>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';

interface InvRow { name: string; total: number; change: number; unit: string; registered?: number; eligible?: number; }

const props = defineProps<{ data: Record<string, unknown> }>();

const exchanges = computed<InvRow[]>(() => {
  const result: InvRow[] = [];
  for (const [ex, rows] of Object.entries(props.data)) {
    const arr = rows as unknown[];
    const latest = arr[0] as Record<string, unknown> | undefined;
    if (!latest) continue;
    result.push({
      name: ex,
      total: (latest['total'] as number) ?? 0,
      change: (latest['change_val'] as number) ?? 0,
      unit: (latest['unit'] as string | undefined) ?? 'oz',
      registered: latest['registered'] as number | undefined,
      eligible: latest['eligible'] as number | undefined,
    });
  }
  return result;
});

const formatNum = (n: number | undefined) => n ? n.toLocaleString('en-US', { maximumFractionDigits: 0 }) : '—';
const regPct = (ex: InvRow) => ex.total ? ((ex.registered ?? 0) / ex.total * 100).toFixed(1) : 0;
const eliPct = (ex: InvRow) => ex.total ? ((ex.eligible ?? 0) / ex.total * 100).toFixed(1) : 0;
</script>

<style scoped>
.inventory { display: flex; flex-direction: column; gap: 14px; }
.inv-header { display: flex; justify-content: space-between; margin-bottom: 4px; }
.inv-name { font-weight: 600; color: #D4AF37; font-size: 13px; }
.inv-total { font-size: 12px; color: #e0e0e0; }
.inv-change { font-size: 12px; }
.inv-change.up { color: #00C853; }
.inv-change.down { color: #FF1744; }
.inv-bar { height: 8px; background: #2a2a4a; border-radius: 4px; display: flex; overflow: hidden; }
.bar-reg { background: #D4AF37; transition: width 0.3s; }
.bar-eli { background: #8B6914; transition: width 0.3s; }
.inv-detail { display: flex; gap: 16px; font-size: 11px; color: #888; margin-top: 4px; }
.no-data { color: #888; font-size: 12px; text-align: center; padding: 20px 0; }
</style>
