<template>
  <div class="macro-grid">
    <div class="macro-item" v-for="item in items" :key="item.key">
      <span class="macro-label">{{ item.label }}</span>
      <span class="macro-value" :class="item.colorClass">{{ item.display }}</span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';

const props = defineProps<{ data: Record<string, number> }>();

const items = computed(() => [
  { key: 'DXY', label: 'DXY 美元指数', display: props.data['DXY']?.toFixed(2) ?? '—', colorClass: '' },
  { key: 'US10Y', label: '美10Y收益率', display: props.data['US10Y'] ? `${props.data['US10Y'].toFixed(3)}%` : '—', colorClass: '' },
  { key: 'TIPS10Y', label: '实际利率TIPS', display: props.data['TIPS10Y'] ? `${props.data['TIPS10Y'].toFixed(3)}%` : '—', colorClass: '' },
  { key: 'VIX', label: 'VIX 恐慌指数', display: props.data['VIX']?.toFixed(2) ?? '—',
    colorClass: (props.data['VIX'] ?? 0) > 25 ? 'warn' : '' },
  { key: 'FEDRATE', label: 'Fed利率', display: props.data['FEDRATE'] ? `${props.data['FEDRATE'].toFixed(2)}%` : '—', colorClass: '' },
  { key: 'SILVER', label: '白银 SI=F', display: props.data['SILVER'] ? `$${props.data['SILVER'].toFixed(2)}` : '—', colorClass: '' },
  { key: 'OIL', label: '原油 CL=F', display: props.data['OIL'] ? `$${props.data['OIL'].toFixed(2)}` : '—', colorClass: '' },
]);
</script>

<style scoped>
.macro-grid { display: flex; flex-direction: column; gap: 8px; }
.macro-item { display: flex; justify-content: space-between; align-items: center; padding: 6px 0; border-bottom: 1px solid #2a2a4a; }
.macro-label { font-size: 11px; color: #888; }
.macro-value { font-size: 13px; font-weight: 600; color: #e0e0e0; }
.macro-value.warn { color: #FF1744; }
</style>
