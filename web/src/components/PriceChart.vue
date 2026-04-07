<template>
  <div class="chart-container">
    <!-- 空状态提示层（不影响 ECharts DOM）-->
    <div v-if="isEmpty" class="empty-state">暂无价格数据，等待采集中...</div>
    <!-- ECharts 容器始终存在，保证 onMounted 时能正常初始化 -->
    <div ref="chartEl" class="chart-inner"></div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, watch, nextTick, defineExpose } from 'vue';
import * as echarts from 'echarts';

const props = defineProps<{ data: unknown[] }>();
const chartEl = ref<HTMLElement | null>(null);
let chart: echarts.ECharts | null = null;

const isEmpty = computed(() => props.data.length === 0);

/** 根据数据时间跨度智能格式化时间标签 */
function formatLabel(ts: number, spanMs: number): string {
  const dt = new Date(ts);
  const hh = String(dt.getHours()).padStart(2, '0');
  const mm = String(dt.getMinutes()).padStart(2, '0');
  const mo = String(dt.getMonth() + 1).padStart(2, '0');
  const dd = String(dt.getDate()).padStart(2, '0');
  if (spanMs > 3 * 86400000) return `${mo}-${dd} ${hh}:${mm}`;
  return `${hh}:${mm}`;
}

function buildOption(raw: Array<Record<string, number>>) {
  const data = raw.filter(d => d['ts'] && d['xau_usd']);
  if (data.length === 0) return null;

  const first  = data[0]!['ts'];
  const last   = data[data.length - 1]!['ts'];
  const spanMs = last - first;

  const times  = data.map(d => formatLabel(d['ts'], spanMs));
  const prices = data.map(d => d['xau_usd']);

  return {
    backgroundColor: 'transparent',
    grid: { top: 20, right: 20, bottom: 50, left: 70 },
    xAxis: {
      type: 'category',
      data: times,
      axisLabel: {
        color: '#888',
        fontSize: 10,
        rotate: 0,
        interval: Math.max(0, Math.floor(data.length / 20) - 1),
      },
      axisLine: { lineStyle: { color: '#2a2a4a' } },
    },
    yAxis: {
      type: 'value',
      scale: true,
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
    dataZoom: [
      { type: 'inside', start: Math.max(0, 100 - Math.ceil(200 / data.length * 100)) },
      {
        type: 'slider', bottom: 4, height: 18,
        textStyle: { color: '#888', fontSize: 9 },
        borderColor: '#2a2a4a', fillerColor: 'rgba(212,175,55,0.08)',
        handleStyle: { color: '#D4AF37' },
        start: Math.max(0, 100 - Math.ceil(200 / data.length * 100)),
      },
    ],
  };
}

function render() {
  if (!chart) return;
  if (isEmpty.value) {
    chart.clear();
    return;
  }
  const opt = buildOption(props.data as Array<Record<string, number>>);
  if (opt) chart.setOption(opt, true);
}

/** 供父组件调用（切换 tab 后恢复正确尺寸）*/
function resize() {
  chart?.resize();
}

onMounted(() => {
  if (!chartEl.value) return;
  chart = echarts.init(chartEl.value, 'dark');
  render();
  window.addEventListener('resize', () => chart?.resize());
});

// 数据变化时重新渲染
watch(() => props.data, async () => {
  // 等待 DOM 更新后再渲染（避免 isEmpty→false 切换时容器尺寸未就绪）
  await nextTick();
  render();
}, { deep: false });

defineExpose({ resize });
</script>

<style scoped>
.chart-container { width: 100%; height: 360px; position: relative; }
.chart-inner     { width: 100%; height: 100%; }
.empty-state {
  position: absolute; inset: 0;
  display: flex; align-items: center; justify-content: center;
  color: #555; font-size: 13px; pointer-events: none;
  z-index: 1;
}
</style>
