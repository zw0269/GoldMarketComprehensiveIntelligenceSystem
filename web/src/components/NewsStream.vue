<template>
  <div class="news-stream">
    <!-- 过滤器 -->
    <div class="filters">
      <button
        v-for="f in filters"
        :key="f.value"
        class="filter-btn"
        :class="{ active: activeFilter === f.value }"
        @click="activeFilter = f.value"
      >{{ f.label }}</button>
    </div>

    <!-- 新闻列表 -->
    <div class="news-list">
      <div
        v-for="item in filteredNews"
        :key="item.id ?? item.ts"
        class="news-item"
        @click="toggleExpand(item)"
      >
        <div class="news-meta">
          <span class="impact-badge" :class="`impact-${item.ai_impact ?? 0}`">
            {{ directionEmoji(item.ai_direction) }} {{ item.ai_impact ? `[${item.ai_impact}/5]` : '' }}
          </span>
          <span v-if="isTruthSocial(item.source)" class="ts-badge" title="来源：Truth Social">🦅 Truth</span>
          <span class="news-source">{{ item.source }}</span>
          <span class="news-time">{{ formatTime(item.ts) }}</span>
        </div>
        <div class="news-title">{{ item.title }}</div>
        <div class="news-detail" v-if="expandedId === (item.id ?? item.ts)">
          <p class="news-summary" v-if="item.summary">{{ item.summary }}</p>
          <p class="ai-reasoning" v-if="item.ai_reasoning">
            🤖 {{ item.ai_reasoning }}
          </p>
          <a v-if="item.url" :href="item.url" target="_blank" class="news-link">阅读原文 →</a>
        </div>
      </div>
      <p v-if="filteredNews.length === 0" class="no-data">暂无新闻数据</p>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue';

interface NewsItem {
  id?: number;
  ts: number;
  source: string;
  title: string;
  summary?: string;
  url?: string;
  category?: string;
  ai_direction?: string;
  ai_impact?: number;
  ai_reasoning?: string;
}

const props = defineProps<{ news: unknown[] }>();
const activeFilter = ref('all');
const expandedId = ref<number | string | null>(null);

const filters = [
  { value: 'all',         label: '全部' },
  { value: 'high',        label: '🔴 重大' },
  { value: 'trump',       label: '🇺🇸 Trump' },
  { value: 'truthsocial', label: '🦅 Truth Social' },
  { value: 'fed',         label: '🏦 Fed' },
  { value: 'geopolitical',label: '🌍 地缘' },
  { value: 'gold',        label: '🥇 黄金' },
];

const filteredNews = computed(() => {
  const items = props.news as NewsItem[];
  if (activeFilter.value === 'all')         return items.slice(0, 50);
  if (activeFilter.value === 'high')        return items.filter(n => (n.ai_impact ?? 0) >= 4).slice(0, 50);
  if (activeFilter.value === 'truthsocial') return items.filter(n => isTruthSocial(n.source)).slice(0, 50);
  return items.filter(n => n.category === activeFilter.value).slice(0, 50);
});

function isTruthSocial(source: string): boolean {
  return source?.startsWith('truthsocial:');
}

function directionEmoji(dir?: string) {
  if (dir === 'bullish') return '🟢';
  if (dir === 'bearish') return '🔴';
  if (dir === 'neutral') return '🟡';
  return '⚪';
}

function formatTime(ts: number) {
  return new Date(ts).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
}

function toggleExpand(item: NewsItem) {
  const key = item.id ?? item.ts;
  expandedId.value = expandedId.value === key ? null : key;
}
</script>

<style scoped>
.news-stream { display: flex; flex-direction: column; gap: 10px; }
.filters { display: flex; gap: 8px; flex-wrap: wrap; }
.filter-btn {
  padding: 4px 10px; border-radius: 20px; border: 1px solid #2a2a4a;
  background: transparent; color: #888; font-size: 11px; cursor: pointer;
}
.filter-btn.active { border-color: #D4AF37; color: #D4AF37; }
.news-list { display: flex; flex-direction: column; gap: 6px; max-height: 400px; overflow-y: auto; }
.news-item {
  padding: 8px 10px; border: 1px solid #2a2a4a; border-radius: 6px;
  cursor: pointer; transition: border-color 0.2s;
}
.news-item:hover { border-color: #D4AF37; }
.news-meta { display: flex; align-items: center; gap: 8px; margin-bottom: 4px; }
.impact-badge { font-size: 11px; font-weight: 600; }
.impact-badge.impact-5 { color: #FF1744; }
.impact-badge.impact-4 { color: #FF6D00; }
.impact-badge.impact-3 { color: #FFD600; }
.ts-badge { font-size: 10px; background: #1a3a2a; color: #4caf50; border: 1px solid #2a5a3a; border-radius: 4px; padding: 1px 5px; }
.news-source { font-size: 10px; color: #888; }
.news-time { font-size: 10px; color: #666; margin-left: auto; }
.news-title { font-size: 12px; color: #e0e0e0; line-height: 1.4; }
.news-detail { margin-top: 8px; padding-top: 8px; border-top: 1px solid #2a2a4a; }
.news-summary { font-size: 11px; color: #888; margin-bottom: 6px; }
.ai-reasoning { font-size: 11px; color: #D4AF37; font-style: italic; margin-bottom: 6px; }
.news-link { font-size: 11px; color: #6bb; text-decoration: none; }
.no-data { color: #888; font-size: 12px; text-align: center; padding: 20px 0; }
</style>
