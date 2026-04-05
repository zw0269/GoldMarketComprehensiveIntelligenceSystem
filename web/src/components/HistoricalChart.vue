<template>
  <div class="historical-chart">
    <!-- 时间范围切换 -->
    <div class="range-tabs">
      <button
        v-for="r in ranges"
        :key="r.value"
        class="range-btn"
        :class="{ active: activeRange === r.value }"
        @click="switchRange(r.value)"
      >{{ r.label }}</button>
      <span class="data-count" v-if="bars.length">{{ bars.length }} 根K线</span>
    </div>

    <!-- K线图 -->
    <div ref="chartEl" class="chart-body"></div>

    <!-- 加载/错误状态 -->
    <div class="overlay" v-if="loading">
      <span class="loading-dot">●</span> 加载历史数据...
    </div>
    <div class="overlay error" v-if="error">
      ⚠️ {{ error }}
      <button class="retry-btn" @click="loadData">重试</button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, watch } from 'vue';
import * as echarts from 'echarts';
import { api } from '../api';

const ranges = [
  { value: '1mo', label: '1月' },
  { value: '3mo', label: '3月' },
  { value: '1y',  label: '1年' },
  { value: '5y',  label: '5年' },
  { value: 'max', label: '全部' },
];

interface Bar { timestamp: number; open: number; high: number; low: number; close: number; volume: number }

const chartEl = ref<HTMLElement | null>(null);
const activeRange = ref('1y');
const bars = ref<Bar[]>([]);
const loading = ref(false);
const error = ref('');
let chart: echarts.ECharts | null = null;

async function switchRange(range: string) {
  activeRange.value = range;
  await loadData();
}

async function loadData() {
  loading.value = true;
  error.value = '';
  try {
    const res = await api.getHistorical(activeRange.value) as { data: Bar[] };
    bars.value = res.data ?? [];
    renderChart();
  } catch (e) {
    error.value = '获取历史数据失败，请稍后重试';
  } finally {
    loading.value = false;
  }
}

function renderChart() {
  if (!chart || bars.value.length === 0) return;

  const dates  = bars.value.map(b => new Date(b.timestamp).toLocaleDateString('zh-CN'));
  const ohlcv  = bars.value.map(b => [b.open, b.close, b.low, b.high]);
  const closes = bars.value.map(b => b.close);
  const vols   = bars.value.map(b => b.volume);

  // MA 计算
  function ma(period: number): (number | null)[] {
    return closes.map((_, i) =>
      i < period - 1 ? null :
      parseFloat((closes.slice(i - period + 1, i + 1).reduce((a, b) => a + b, 0) / period).toFixed(2))
    );
  }

  chart.setOption({
    backgroundColor: 'transparent',
    animation: false,
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'cross' },
      backgroundColor: '#1a1a2e',
      borderColor: '#2a2a4a',
      textStyle: { color: '#e0e0e0', fontSize: 11 },
    },
    legend: {
      top: 4, right: 8, textStyle: { color: '#888', fontSize: 10 },
      data: ['K线', 'MA20', 'MA60'],
    },
    grid: [
      { left: 60, right: 20, top: 36, bottom: 80 },
      { left: 60, right: 20, top: '75%', bottom: 24 },
    ],
    xAxis: [
      {
        type: 'category', data: dates, gridIndex: 0,
        axisLabel: { color: '#888', fontSize: 10, showMaxLabel: true },
        axisLine: { lineStyle: { color: '#2a2a4a' } },
        splitLine: { show: false },
      },
      {
        type: 'category', data: dates, gridIndex: 1,
        axisLabel: { show: false },
        axisLine: { lineStyle: { color: '#2a2a4a' } },
        splitLine: { show: false },
      },
    ],
    yAxis: [
      {
        scale: true, gridIndex: 0,
        axisLabel: { color: '#888', fontSize: 10, formatter: (v: number) => `¥${v.toFixed(0)}` },
        splitLine: { lineStyle: { color: '#1a1a2e' } },
      },
      {
        scale: true, gridIndex: 1,
        axisLabel: { color: '#888', fontSize: 9 },
        splitLine: { show: false },
      },
    ],
    dataZoom: [
      { type: 'inside', xAxisIndex: [0, 1], start: 0, end: 100 },
      {
        type: 'slider', xAxisIndex: [0, 1], bottom: 0, height: 20,
        textStyle: { color: '#888', fontSize: 9 },
        borderColor: '#2a2a4a', fillerColor: 'rgba(212,175,55,0.1)',
        handleStyle: { color: '#D4AF37' },
      },
    ],
    series: [
      {
        name: 'K线', type: 'candlestick',
        xAxisIndex: 0, yAxisIndex: 0,
        data: ohlcv,
        itemStyle: {
          color: '#00C853', color0: '#FF1744',
          borderColor: '#00C853', borderColor0: '#FF1744',
        },
      },
      {
        name: 'MA20', type: 'line', xAxisIndex: 0, yAxisIndex: 0,
        data: ma(20), smooth: true, symbol: 'none',
        lineStyle: { color: '#D4AF37', width: 1 },
        tooltip: { show: false },
      },
      {
        name: 'MA60', type: 'line', xAxisIndex: 0, yAxisIndex: 0,
        data: ma(60), smooth: true, symbol: 'none',
        lineStyle: { color: '#42A5F5', width: 1 },
        tooltip: { show: false },
      },
      {
        name: '成交量', type: 'bar', xAxisIndex: 1, yAxisIndex: 1,
        data: vols.map((v, i) => ({
          value: v,
          itemStyle: { color: closes[i] >= (closes[i - 1] ?? closes[i]) ? '#00C853' : '#FF1744', opacity: 0.6 },
        })),
      },
    ],
  }, true);
}

onMounted(async () => {
  if (!chartEl.value) return;
  chart = echarts.init(chartEl.value, 'dark');
  window.addEventListener('resize', () => chart?.resize());
  await loadData();
});

watch(activeRange, () => chart?.resize());
</script>

<style scoped>
.historical-chart { position: relative; display: flex; flex-direction: column; gap: 8px; }
.range-tabs { display: flex; align-items: center; gap: 6px; }
.range-btn {
  padding: 3px 12px; border-radius: 4px; border: 1px solid #2a2a4a;
  background: transparent; color: #888; font-size: 11px; cursor: pointer;
  transition: all 0.15s;
}
.range-btn.active { background: rgba(212,175,55,0.15); border-color: #D4AF37; color: #D4AF37; }
.range-btn:hover:not(.active) { border-color: #555; color: #ccc; }
.data-count { font-size: 10px; color: #666; margin-left: auto; }
.chart-body { width: 100%; height: 420px; }
.overlay {
  position: absolute; inset: 36px 0 0; display: flex;
  align-items: center; justify-content: center;
  background: rgba(13,13,26,0.7); font-size: 13px; color: #888;
  border-radius: 6px;
}
.overlay.error { color: #FF6D00; flex-direction: column; gap: 10px; }
.retry-btn {
  padding: 5px 16px; border-radius: 4px; border: 1px solid #FF6D00;
  background: transparent; color: #FF6D00; font-size: 12px; cursor: pointer;
}
.retry-btn:hover { background: rgba(255,109,0,0.1); }
.loading-dot { animation: blink 1s infinite; }
@keyframes blink { 0%,100%{opacity:1} 50%{opacity:0.2} }
</style>
