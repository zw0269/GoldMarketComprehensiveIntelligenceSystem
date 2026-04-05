<template>
  <div ref="chartEl" class="chart-container"></div>
</template>

<script setup lang="ts">
import { ref, onMounted, watch } from 'vue';
import * as echarts from 'echarts';

const props = defineProps<{ data: unknown[] }>();
const chartEl = ref<HTMLElement | null>(null);
let chart: echarts.ECharts | null = null;

function buildOption(data: Array<Record<string, number>>) {
  const times = data.map(d => new Date(d['ts']).toLocaleTimeString('zh-CN'));
  const prices = data.map(d => d['xau_usd']);

  return {
    backgroundColor: 'transparent',
    grid: { top: 20, right: 20, bottom: 40, left: 70 },
    xAxis: {
      type: 'category', data: times,
      axisLabel: { color: '#888', fontSize: 10 },
      axisLine: { lineStyle: { color: '#2a2a4a' } },
    },
    yAxis: {
      type: 'value', scale: true,
      axisLabel: { color: '#888', fontSize: 10, formatter: (v: number) => `$${v.toFixed(0)}` },
      splitLine: { lineStyle: { color: '#1a1a2e' } },
    },
    series: [{
      type: 'line',
      data: prices,
      smooth: true,
      symbol: 'none',
      lineStyle: { color: '#D4AF37', width: 2 },
      areaStyle: {
        color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
          { offset: 0, color: 'rgba(212,175,55,0.3)' },
          { offset: 1, color: 'rgba(212,175,55,0)' },
        ]),
      },
    }],
    tooltip: {
      trigger: 'axis',
      backgroundColor: '#1a1a2e',
      borderColor: '#2a2a4a',
      textStyle: { color: '#e0e0e0' },
      formatter: (params: Array<{ name: string; value: number }>) =>
        `${params[0]?.name}<br/>XAU/USD: <b>$${params[0]?.value?.toFixed(2)}</b>`,
    },
  };
}

onMounted(() => {
  if (!chartEl.value) return;
  chart = echarts.init(chartEl.value, 'dark');
  if (props.data.length > 0) {
    chart.setOption(buildOption(props.data as Array<Record<string, number>>));
  }
  window.addEventListener('resize', () => chart?.resize());
});

watch(() => props.data, (data) => {
  if (chart && data.length > 0) {
    chart.setOption(buildOption(data as Array<Record<string, number>>));
  }
});
</script>

<style scoped>
.chart-container { width: 100%; height: 320px; }
</style>
