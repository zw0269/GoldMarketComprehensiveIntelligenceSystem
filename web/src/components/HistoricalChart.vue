<template>
  <div class="historical-chart">
    <!-- 时间范围切换 -->
    <div class="range-tabs">
      <button
        v-for="r in ranges"
        :key="r.value"
        class="range-btn"
        :class="{ active: activeRange === r.value }"
        :disabled="loading"
        @click="switchRange(r.value)"
      >{{ r.label }}</button>

      <span class="data-meta" v-if="bars.length && !loading">
        {{ bars.length }} 根K线
        <span class="src-tag" :class="srcClass">{{ srcLabel }}</span>
        <span class="unit-tag">{{ unitLabel }}</span>
      </span>

      <button class="refresh-btn" :disabled="loading" @click="forceRefresh" title="强制刷新">⟳</button>
    </div>

    <!-- 状态层（加载/错误/空） -->
    <div class="chart-wrap">
      <div ref="chartEl" class="chart-body"></div>

      <transition name="fade">
        <div class="overlay" v-if="loading">
          <span class="spin">◐</span>
          正在获取历史数据（最长约30秒）...
        </div>
      </transition>

      <transition name="fade">
        <div class="overlay error" v-if="!loading && error">
          <div>⚠️ {{ error }}</div>
          <div class="err-detail" v-if="errorDetail">{{ errorDetail }}</div>
          <button class="retry-btn" @click="loadData">重试</button>
        </div>
      </transition>

      <div class="overlay empty" v-if="!loading && !error && bars.length === 0">
        暂无历史数据
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, nextTick } from 'vue';
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

const chartEl     = ref<HTMLElement | null>(null);
const activeRange = ref('1y');
const bars        = ref<Bar[]>([]);
const loading     = ref(false);
const error       = ref('');
const errorDetail = ref('');
const dataSource  = ref('');   // 原始 source 字段（yahoo / local / eastmoney …）
let chart: echarts.ECharts | null = null;

// ── 数据源展示 ────────────────────────────────────────────────
const srcLabel = computed(() => {
  if (dataSource.value === 'local')     return '本地';
  if (dataSource.value === 'yahoo')     return 'Yahoo';
  if (dataSource.value === 'eastmoney') return '东方财富';
  if (dataSource.value === 'tencent')   return '腾讯财经';
  if (dataSource.value === 'sina')      return '新浪财经';
  return '实时';
});
const srcClass = computed(() => {
  if (dataSource.value === 'local') return 'local';
  if (dataSource.value === 'yahoo') return 'yahoo';
  return 'remote';
});

// ── 货币自动检测：Yahoo GC=F 为 USD/oz（>1800），国内源为 CNY/g ──
const isUSD = computed(() => {
  if (bars.value.length === 0) return false;
  const maxClose = Math.max(...bars.value.map(b => b.close).filter(c => c > 0));
  return maxClose > 1800;
});
const currSymbol = computed(() => isUSD.value ? '$' : '¥');
const unitLabel  = computed(() => isUSD.value ? 'USD/oz' : 'CNY/g');

// ── 数据加载 ──────────────────────────────────────────────────
async function switchRange(range: string) {
  activeRange.value = range;
  await loadData();
}

async function loadData() {
  loading.value     = true;
  error.value       = '';
  errorDetail.value = '';
  try {
    const res = await api.getHistorical(activeRange.value) as { data: Bar[]; source?: string };
    bars.value      = res.data ?? [];
    dataSource.value = res.source ?? 'remote';
    await nextTick();
    renderChart();
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes('timeout') || msg.includes('ECONNABORTED')) {
      error.value = '请求超时，数据源响应慢，请稍后重试';
    } else if (msg.includes('503') || msg.includes('Network Error')) {
      error.value = '数据源暂不可用，请稍后重试';
    } else {
      error.value = '获取历史数据失败，请稍后重试';
    }
    errorDetail.value = msg.slice(0, 120);
  } finally {
    loading.value = false;
  }
}

async function forceRefresh() {
  loading.value     = true;
  error.value       = '';
  errorDetail.value = '';
  try {
    const res = await api.getHistoricalRefresh(activeRange.value) as { data: Bar[]; source?: string };
    bars.value       = res.data ?? [];
    dataSource.value = res.source ?? 'remote';
    await nextTick();
    renderChart();
  } catch (e) {
    error.value = '刷新失败，请稍后重试';
    errorDetail.value = (e instanceof Error ? e.message : String(e)).slice(0, 120);
  } finally {
    loading.value = false;
  }
}

// ── K线渲染 ───────────────────────────────────────────────────
function renderChart() {
  if (!chart) return;
  if (bars.value.length === 0) {
    chart.clear();
    return;
  }

  // ECharts 在 v-show 切换后尺寸可能仍为 0，先 resize 一次
  chart.resize();

  const sym  = currSymbol.value;
  const dates  = bars.value.map(b => new Date(b.timestamp).toLocaleDateString('zh-CN'));
  const ohlcv  = bars.value.map(b => [b.open, b.close, b.low, b.high]);
  const closes = bars.value.map(b => b.close);
  const vols   = bars.value.map(b => b.volume);

  function ma(period: number): (number | null)[] {
    return closes.map((_, i) =>
      i < period - 1 ? null :
      parseFloat((closes.slice(i - period + 1, i + 1).reduce((a, c) => a + c, 0) / period).toFixed(2))
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
      formatter(params: Array<{ name: string; seriesName: string; value: number | number[] }>) {
        const p = params[0];
        if (!p) return '';
        if (Array.isArray(p.value)) {
          const [o, c, l, h] = p.value as number[];
          return `${p.name}<br/>
            开 ${sym}${o?.toFixed(2)}&nbsp;&nbsp;高 ${sym}${h?.toFixed(2)}<br/>
            低 ${sym}${l?.toFixed(2)}&nbsp;&nbsp;收 <b>${sym}${c?.toFixed(2)}</b>`;
        }
        return `${p.name}<br/>${p.seriesName}: ${sym}${Number(p.value).toFixed(2)}`;
      },
    },
    legend: {
      top: 4, right: 8,
      textStyle: { color: '#888', fontSize: 10 },
      data: ['K线', 'MA20', 'MA60'],
    },
    grid: [
      { left: 72, right: 16, top: 32, bottom: 88 },
      { left: 72, right: 16, top: '75%', bottom: 32 },
    ],
    xAxis: [
      {
        type: 'category', data: dates, gridIndex: 0,
        axisLabel: { color: '#888', fontSize: 10, showMaxLabel: true },
        axisLine: { lineStyle: { color: '#2a2a4a' } },
        splitLine: { show: false },
        boundaryGap: true,
      },
      {
        type: 'category', data: dates, gridIndex: 1,
        axisLabel: { show: false },
        axisLine: { lineStyle: { color: '#2a2a4a' } },
        splitLine: { show: false },
        boundaryGap: true,
      },
    ],
    yAxis: [
      {
        scale: true, gridIndex: 0,
        axisLabel: { color: '#888', fontSize: 10, formatter: (v: number) => `${sym}${v.toFixed(0)}` },
        splitLine: { lineStyle: { color: '#1a1a2e' } },
      },
      {
        scale: true, gridIndex: 1,
        axisLabel: { color: '#888', fontSize: 9, formatter: (v: number) => v >= 1000 ? `${(v/1000).toFixed(1)}k` : String(v) },
        splitLine: { show: false },
      },
    ],
    dataZoom: [
      { type: 'inside', xAxisIndex: [0, 1], start: 0, end: 100 },
      {
        type: 'slider', xAxisIndex: [0, 1], bottom: 4, height: 22,
        textStyle: { color: '#888', fontSize: 9 },
        borderColor: '#2a2a4a',
        fillerColor: 'rgba(212,175,55,0.12)',
        handleStyle: { color: '#D4AF37' },
        moveHandleStyle: { color: '#D4AF37' },
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
        barMaxWidth: 12,
      },
      {
        name: 'MA20', type: 'line', xAxisIndex: 0, yAxisIndex: 0,
        data: ma(20), smooth: true, symbol: 'none',
        lineStyle: { color: '#D4AF37', width: 1.5 },
        tooltip: { show: false },
      },
      {
        name: 'MA60', type: 'line', xAxisIndex: 0, yAxisIndex: 0,
        data: ma(60), smooth: true, symbol: 'none',
        lineStyle: { color: '#42A5F5', width: 1.5 },
        tooltip: { show: false },
      },
      {
        name: '成交量', type: 'bar', xAxisIndex: 1, yAxisIndex: 1,
        data: vols.map((v, i) => ({
          value: v,
          itemStyle: {
            color: closes[i] >= (closes[i - 1] ?? closes[i]) ? 'rgba(0,200,83,0.55)' : 'rgba(255,23,68,0.55)',
          },
        })),
        barMaxWidth: 12,
      },
    ],
  }, true);
}

// ── 生命周期 ──────────────────────────────────────────────────
onMounted(async () => {
  if (!chartEl.value) return;
  chart = echarts.init(chartEl.value, 'dark');
  window.addEventListener('resize', () => chart?.resize());
  await loadData();
});

/** 供 App.vue 在 Tab 切换后调用，修复 v-show 隐藏时宽度=0 的问题 */
function resize() {
  chart?.resize();
  // 如果已有数据但切换 tab 后渲染空白，重新渲染一次
  if (bars.value.length > 0) renderChart();
}

defineExpose({ resize });
</script>

<style scoped>
.historical-chart {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

/* ── 顶部控件栏 ── */
.range-tabs {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}
.range-btn {
  padding: 3px 12px;
  border-radius: 4px;
  border: 1px solid #2a2a4a;
  background: transparent;
  color: #888;
  font-size: 11px;
  cursor: pointer;
  transition: all 0.15s;
}
.range-btn.active      { background: rgba(212,175,55,0.15); border-color: #D4AF37; color: #D4AF37; }
.range-btn:hover:not(.active):not(:disabled) { border-color: #555; color: #ccc; }
.range-btn:disabled    { opacity: 0.45; cursor: not-allowed; }

.data-meta {
  font-size: 10px;
  color: #666;
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: 5px;
}
.src-tag {
  font-size: 9px;
  padding: 1px 6px;
  border-radius: 3px;
  font-weight: 600;
}
.src-tag.remote { background: rgba(0,200,83,0.15); color: #00C853; }
.src-tag.local  { background: rgba(212,175,55,0.15); color: #D4AF37; }
.src-tag.yahoo  { background: rgba(66,165,245,0.15); color: #42A5F5; }
.unit-tag {
  font-size: 9px;
  color: #555;
  border: 1px solid #2a2a4a;
  padding: 1px 5px;
  border-radius: 3px;
}

.refresh-btn {
  padding: 2px 8px;
  border-radius: 4px;
  border: 1px solid #2a2a4a;
  background: transparent;
  color: #888;
  font-size: 13px;
  cursor: pointer;
  transition: all 0.15s;
  margin-left: 4px;
}
.refresh-btn:hover:not(:disabled) { border-color: #555; color: #ccc; }
.refresh-btn:disabled { opacity: 0.4; cursor: not-allowed; }

/* ── 图表区域（相对定位容器） ── */
.chart-wrap {
  position: relative;
  flex: 1;
}
.chart-body {
  width: 100%;
  height: 440px;
}

/* ── 覆盖层 ── */
.overlay {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  background: rgba(13, 13, 26, 0.82);
  border-radius: 6px;
  font-size: 13px;
  color: #888;
  z-index: 10;
}
.overlay.error { color: #FF6D00; }
.overlay.empty { color: #555; font-size: 12px; }

.err-detail {
  font-size: 10px;
  color: #666;
  max-width: 380px;
  text-align: center;
  word-break: break-all;
}

.spin {
  display: inline-block;
  animation: spin 1s linear infinite;
  font-size: 16px;
}
@keyframes spin { to { transform: rotate(360deg); } }

.retry-btn {
  padding: 5px 18px;
  border-radius: 4px;
  border: 1px solid #FF6D00;
  background: transparent;
  color: #FF6D00;
  font-size: 12px;
  cursor: pointer;
}
.retry-btn:hover { background: rgba(255,109,0,0.1); }

/* ── 淡入淡出动画 ── */
.fade-enter-active, .fade-leave-active { transition: opacity 0.2s; }
.fade-enter-from, .fade-leave-to       { opacity: 0; }
</style>
