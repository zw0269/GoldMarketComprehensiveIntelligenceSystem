<template>
  <div class="idea-workshop">

    <!-- 输入区 -->
    <div class="input-area">
      <textarea
        v-model="draft"
        class="idea-input"
        placeholder="描述你的交易想法...&#10;例如：美元持续走弱+地缘紧张，当前价位接近布林下轨，计划轻仓积存，止损上周低点。"
        rows="4"
        :disabled="analyzing"
        @keydown.ctrl.enter="submit"
      ></textarea>
      <div class="input-footer">
        <div class="data-tags">
          <span class="dtag">实时价格</span>
          <span class="dtag">技术指标</span>
          <span class="dtag">系统信号</span>
          <span class="dtag">宏观</span>
          <span class="dtag">新闻</span>
          <span class="dtag">ETF</span>
          <span class="dtag">库存</span>
          <span class="dtag">COT</span>
        </div>
        <button class="submit-btn" @click="submit" :disabled="!draft.trim() || analyzing">
          <span v-if="analyzing" class="spinner">⏳</span>
          <span v-else>🧠 综合分析</span>
        </button>
      </div>
      <div class="analyzing-progress" v-if="analyzing">
        <div class="progress-bar"></div>
        <span class="progress-text">正在调用8个数据源进行综合分析...</span>
      </div>
    </div>

    <!-- 最新分析结果 -->
    <Transition name="slide">
      <div class="analysis-result" v-if="latestResult">

        <!-- 顶部：方向 + 操作建议 + 置信度 -->
        <div class="result-header">
          <span class="direction-badge" :class="latestResult.direction">
            {{ dirEmoji(latestResult.direction) }} {{ dirLabel(latestResult.direction) }}
          </span>
          <span class="action-badge" :class="actionClass(latestResult.action)">
            {{ latestResult.action }}
          </span>
          <div class="score-bar">
            <span class="score-label">置信度</span>
            <div class="bar-track">
              <div class="bar-fill" :style="{ width: latestResult.score * 10 + '%', background: scoreColor(latestResult.score) }"></div>
            </div>
            <span class="score-num">{{ latestResult.score }}/10</span>
          </div>
          <span class="timeframe-tag">{{ latestResult.timeframe }}</span>
        </div>

        <!-- 核心结论 -->
        <p class="result-summary">{{ latestResult.summary }}</p>

        <!-- 交易价位建议 -->
        <div class="trade-levels" v-if="latestResult.entry || latestResult.stopLoss || latestResult.target">
          <div class="level-item entry" v-if="latestResult.entry">
            <span class="li-label">建议入场</span>
            <span class="li-price">¥{{ latestResult.entry?.toFixed(2) }}/g</span>
          </div>
          <div class="level-item stop" v-if="latestResult.stopLoss">
            <span class="li-label">止损价位</span>
            <span class="li-price">¥{{ latestResult.stopLoss?.toFixed(2) }}/g</span>
          </div>
          <div class="level-item target" v-if="latestResult.target">
            <span class="li-label">目标价位</span>
            <span class="li-price">¥{{ latestResult.target?.toFixed(2) }}/g</span>
          </div>
          <div class="level-item rr" v-if="latestResult.riskReward">
            <span class="li-label">风险收益</span>
            <span class="li-price">{{ latestResult.riskReward }}</span>
          </div>
        </div>

        <!-- 支撑 & 风险 -->
        <div class="result-cols">
          <div class="result-col">
            <h4>📗 支撑逻辑</h4>
            <ul>
              <li v-for="s in latestResult.supporting" :key="s">{{ s }}</li>
            </ul>
          </div>
          <div class="result-col">
            <h4>⚠️ 主要风险</h4>
            <ul class="risks">
              <li v-for="r in latestResult.risks" :key="r">{{ r }}</li>
            </ul>
          </div>
        </div>

        <!-- 关键价位 -->
        <div class="key-levels" v-if="latestResult.keyLevels?.length">
          <span class="levels-label">关键价位</span>
          <span v-for="lv in latestResult.keyLevels" :key="lv.label" class="level-chip">
            {{ lv.label }}: <b>¥{{ lv.price }}</b>
          </span>
        </div>

        <!-- 数据来源标签 -->
        <div class="data-used" v-if="latestResult.dataUsed?.length">
          <span class="du-label">数据来源</span>
          <span v-for="d in latestResult.dataUsed" :key="d" class="du-chip">{{ d }}</span>
        </div>

        <!-- 历史演进 -->
        <div class="evolution" v-if="latestResult.evolution && latestResult.evolution !== '首次分析'">
          <span class="evo-icon">🔄</span>{{ latestResult.evolution }}
        </div>

        <!-- 标签 -->
        <div class="tags">
          <span v-for="t in latestResult.tags" :key="t" class="tag">#{{ t }}</span>
        </div>
      </div>
    </Transition>

    <!-- 历史想法列表 -->
    <div class="history-section" v-if="ideas.length > 0">
      <h4 class="history-title">历史想法 <span class="count">{{ ideas.length }}</span></h4>
      <div class="history-list">
        <div
          v-for="idea in ideas"
          :key="idea.id"
          class="history-item"
          @click="expandedId = expandedId === idea.id ? null : idea.id"
        >
          <div class="h-meta">
            <span class="h-direction" v-if="idea.ai_analysis" :class="idea.ai_direction ?? ''">
              {{ dirEmoji(idea.ai_direction ?? '') }}
            </span>
            <span class="h-action" v-if="idea.ai_analysis?.action" :class="actionClass(idea.ai_analysis.action)">
              {{ idea.ai_analysis.action }}
            </span>
            <span class="h-score" v-if="idea.ai_score">{{ idea.ai_score }}/10</span>
            <span class="h-date">{{ formatDate(idea.ts) }}</span>
            <span class="h-status" :class="idea.status">{{ statusLabel(idea.status) }}</span>
          </div>
          <p class="h-content">{{ String(idea.content).slice(0, 80) }}{{ String(idea.content).length > 80 ? '...' : '' }}</p>

          <div class="h-detail" v-if="expandedId === idea.id && idea.ai_analysis">
            <p class="h-summary">{{ idea.ai_analysis?.summary }}</p>

            <!-- 价位建议 -->
            <div class="h-levels" v-if="idea.ai_analysis.entry || idea.ai_analysis.stopLoss || idea.ai_analysis.target">
              <span v-if="idea.ai_analysis.entry">入场 ¥{{ idea.ai_analysis.entry }}</span>
              <span v-if="idea.ai_analysis.stopLoss" class="h-stop">止损 ¥{{ idea.ai_analysis.stopLoss }}</span>
              <span v-if="idea.ai_analysis.target" class="h-target">目标 ¥{{ idea.ai_analysis.target }}</span>
              <span v-if="idea.ai_analysis.riskReward">{{ idea.ai_analysis.riskReward }}</span>
            </div>

            <div class="h-cols">
              <div>
                <b>支撑</b>
                <ul><li v-for="s in idea.ai_analysis?.supporting" :key="s">{{ s }}</li></ul>
              </div>
              <div>
                <b>风险</b>
                <ul class="risks"><li v-for="r in idea.ai_analysis?.risks" :key="r">{{ r }}</li></ul>
              </div>
            </div>
            <div class="h-evolution" v-if="idea.ai_analysis?.evolution && idea.ai_analysis.evolution !== '首次分析'">
              🔄 {{ idea.ai_analysis?.evolution }}
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { api } from '../api';

interface AnalysisResult {
  direction: string;
  score: number;
  action: string;
  summary: string;
  supporting: string[];
  risks: string[];
  keyLevels: { label: string; price: number }[];
  entry: number | null;
  stopLoss: number | null;
  target: number | null;
  riskReward: string | null;
  timeframe: string;
  tags: string[];
  evolution: string;
  dataUsed: string[];
}

interface IdeaItem {
  id: number;
  ts: number;
  content: string;
  ai_analysis?: AnalysisResult;
  ai_score?: number;
  ai_direction?: string;
  status: string;
}

const draft      = ref('');
const analyzing  = ref(false);
const latestResult = ref<AnalysisResult | null>(null);
const ideas      = ref<IdeaItem[]>([]);
const expandedId = ref<number | null>(null);

const dirEmoji = (d: string) => ({ bullish: '🟢', bearish: '🔴', neutral: '🟡' }[d] ?? '⚪');
const dirLabel = (d: string) => ({ bullish: '看涨', bearish: '看跌', neutral: '中性' }[d] ?? d);
const scoreColor = (s: number) => s >= 8 ? '#00C853' : s >= 5 ? '#FFD600' : '#FF1744';
const formatDate = (ts: number) => new Date(ts).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
const statusLabel = (s: string) => ({ pending: '分析中', analyzed: '已分析', archived: '已归档' }[s] ?? s);

function actionClass(action: string): string {
  if (!action) return '';
  if (action.includes('买入') || action.includes('建仓') || action.includes('试探')) return 'buy';
  if (action.includes('减仓') || action.includes('止损') || action.includes('离场')) return 'sell';
  return 'hold';
}

async function submit() {
  if (!draft.value.trim() || analyzing.value) return;
  analyzing.value = true;
  try {
    const res = await api.submitIdea(draft.value.trim()) as { result: AnalysisResult };
    latestResult.value = res.result;
    draft.value = '';
    await loadIdeas();
  } catch (e) {
    alert('分析失败：' + String(e instanceof Error ? e.message : e));
  } finally {
    analyzing.value = false;
  }
}

async function loadIdeas() {
  ideas.value = await api.getIdeas() as IdeaItem[];
  if (ideas.value.length > 0 && !latestResult.value) {
    latestResult.value = ideas.value[0].ai_analysis ?? null;
  }
}

onMounted(loadIdeas);
</script>

<style scoped>
.idea-workshop { display: flex; flex-direction: column; gap: 12px; }

/* 输入区 */
.input-area { display: flex; flex-direction: column; gap: 6px; }
.idea-input {
  width: 100%; background: #0d0d1a; border: 1px solid #2a2a4a; border-radius: 6px;
  color: #e0e0e0; font-size: 13px; padding: 10px 12px; resize: vertical;
  font-family: inherit; line-height: 1.6; transition: border-color 0.2s;
}
.idea-input:focus { outline: none; border-color: #D4AF37; }
.idea-input:disabled { opacity: 0.6; }
.input-footer { display: flex; justify-content: space-between; align-items: center; gap: 8px; }
.data-tags { display: flex; gap: 4px; flex-wrap: wrap; }
.dtag { font-size: 9px; color: #555; background: #1a1a2e; border: 1px solid #2a2a4a; padding: 1px 6px; border-radius: 8px; }
.submit-btn {
  flex-shrink: 0; padding: 7px 18px; border-radius: 6px; border: none;
  background: linear-gradient(135deg, #D4AF37, #8B6914);
  color: #0d0d1a; font-size: 12px; font-weight: 700; cursor: pointer;
  transition: opacity 0.15s; white-space: nowrap;
}
.submit-btn:disabled { opacity: 0.4; cursor: not-allowed; }
.spinner { display: inline-block; animation: spin 1s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }

.analyzing-progress {
  display: flex; align-items: center; gap: 8px;
  padding: 8px 12px; background: rgba(212,175,55,0.05); border-radius: 6px;
  border: 1px solid rgba(212,175,55,0.2);
}
.progress-bar {
  width: 60px; height: 3px; background: #2a2a4a; border-radius: 2px; overflow: hidden; flex-shrink: 0;
  background: linear-gradient(90deg, #D4AF37 0%, #2a2a4a 100%);
  animation: scan 1.5s ease-in-out infinite alternate;
}
@keyframes scan { from { opacity: 0.3; } to { opacity: 1; } }
.progress-text { font-size: 11px; color: #888; }

/* 分析结果 */
.analysis-result {
  background: rgba(212,175,55,0.04); border: 1px solid rgba(212,175,55,0.25);
  border-radius: 8px; padding: 14px; display: flex; flex-direction: column; gap: 10px;
}
.result-header { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }

.direction-badge { font-size: 13px; font-weight: 700; padding: 3px 10px; border-radius: 20px; }
.direction-badge.bullish { background: rgba(0,200,83,0.15); color: #00C853; }
.direction-badge.bearish { background: rgba(255,23,68,0.15); color: #FF1744; }
.direction-badge.neutral  { background: rgba(255,214,0,0.15); color: #FFD600; }

.action-badge { font-size: 11px; font-weight: 700; padding: 3px 10px; border-radius: 20px; }
.action-badge.buy  { background: rgba(0,200,83,0.1); color: #00C853; border: 1px solid rgba(0,200,83,0.3); }
.action-badge.sell { background: rgba(255,23,68,0.1); color: #FF1744; border: 1px solid rgba(255,23,68,0.3); }
.action-badge.hold { background: rgba(255,214,0,0.1); color: #FFD600; border: 1px solid rgba(255,214,0,0.3); }

.score-bar { display: flex; align-items: center; gap: 6px; }
.score-label { font-size: 10px; color: #888; }
.bar-track { width: 80px; height: 6px; background: #2a2a4a; border-radius: 3px; overflow: hidden; }
.bar-fill { height: 100%; border-radius: 3px; transition: width 0.5s; }
.score-num { font-size: 11px; font-weight: 700; color: #e0e0e0; }
.timeframe-tag { margin-left: auto; font-size: 10px; color: #888; border: 1px solid #2a2a4a; padding: 2px 8px; border-radius: 10px; }

.result-summary { font-size: 14px; font-weight: 600; color: #D4AF37; line-height: 1.5; }

/* 交易价位 */
.trade-levels { display: flex; gap: 8px; flex-wrap: wrap; }
.level-item {
  display: flex; flex-direction: column; align-items: center;
  padding: 8px 14px; border-radius: 6px; border: 1px solid #2a2a4a; min-width: 90px;
}
.level-item.entry  { background: rgba(0,200,83,0.05); border-color: rgba(0,200,83,0.3); }
.level-item.stop   { background: rgba(255,23,68,0.05); border-color: rgba(255,23,68,0.3); }
.level-item.target { background: rgba(212,175,55,0.05); border-color: rgba(212,175,55,0.3); }
.level-item.rr     { background: rgba(255,255,255,0.03); }
.li-label { font-size: 9px; color: #888; margin-bottom: 3px; }
.li-price { font-size: 14px; font-weight: 700; }
.level-item.entry  .li-price { color: #00C853; }
.level-item.stop   .li-price { color: #FF1744; }
.level-item.target .li-price { color: #D4AF37; }
.level-item.rr     .li-price { color: #e0e0e0; }

.result-cols { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
.result-col h4 { font-size: 11px; margin-bottom: 6px; color: #aaa; }
.result-col ul { padding-left: 14px; }
.result-col li { font-size: 11px; color: #ccc; line-height: 1.7; margin-bottom: 2px; }
.result-col ul.risks li { color: #FF9999; }

.key-levels { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.levels-label { font-size: 10px; color: #888; }
.level-chip { font-size: 11px; background: #1a1a2e; border: 1px solid #2a2a4a; padding: 2px 8px; border-radius: 10px; color: #ccc; }
.level-chip b { color: #D4AF37; }

/* 数据来源 */
.data-used { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.du-label { font-size: 9px; color: #555; }
.du-chip { font-size: 9px; color: #666; background: #1a1a2e; border: 1px solid #252540; padding: 1px 6px; border-radius: 8px; }

.evolution { font-size: 11px; color: #888; font-style: italic; }
.evo-icon { margin-right: 4px; }
.tags { display: flex; gap: 6px; flex-wrap: wrap; }
.tag { font-size: 10px; color: #D4AF37; background: rgba(212,175,55,0.1); padding: 2px 8px; border-radius: 10px; }

/* 历史列表 */
.history-section { border-top: 1px solid #2a2a4a; padding-top: 10px; }
.history-title { font-size: 12px; color: #888; margin-bottom: 8px; }
.history-title .count { background: #2a2a4a; padding: 1px 7px; border-radius: 10px; font-size: 10px; margin-left: 6px; }
.history-list { display: flex; flex-direction: column; gap: 6px; max-height: 340px; overflow-y: auto; }
.history-item { padding: 8px 10px; border: 1px solid #2a2a4a; border-radius: 6px; cursor: pointer; transition: border-color 0.2s; }
.history-item:hover { border-color: rgba(212,175,55,0.4); }
.h-meta { display: flex; align-items: center; gap: 6px; margin-bottom: 4px; }
.h-direction { font-size: 12px; }
.h-action { font-size: 10px; padding: 1px 6px; border-radius: 8px; }
.h-action.buy  { background: rgba(0,200,83,0.1); color: #00C853; }
.h-action.sell { background: rgba(255,23,68,0.1); color: #FF1744; }
.h-action.hold { background: rgba(255,214,0,0.1); color: #FFD600; }
.h-score { font-size: 11px; font-weight: 700; color: #D4AF37; }
.h-date { font-size: 10px; color: #666; margin-left: auto; }
.h-status { font-size: 10px; padding: 1px 6px; border-radius: 10px; }
.h-status.analyzed { background: rgba(0,200,83,0.1); color: #00C853; }
.h-status.pending  { background: rgba(255,214,0,0.1); color: #FFD600; }
.h-content { font-size: 12px; color: #aaa; line-height: 1.4; }
.h-detail { margin-top: 8px; padding-top: 8px; border-top: 1px solid #2a2a4a; }
.h-summary { font-size: 12px; color: #D4AF37; margin-bottom: 6px; font-weight: 600; }
.h-levels { display: flex; gap: 12px; font-size: 11px; margin-bottom: 8px; color: #aaa; }
.h-levels .h-stop   { color: #FF9999; }
.h-levels .h-target { color: #00C853; }
.h-cols { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; font-size: 11px; }
.h-cols b { font-size: 10px; color: #888; display: block; margin-bottom: 4px; }
.h-cols ul { padding-left: 14px; color: #aaa; margin: 0; }
.h-cols ul.risks li { color: #FF9999; }
.h-evolution { font-size: 10px; color: #888; font-style: italic; margin-top: 8px; }

/* 动画 */
.slide-enter-active, .slide-leave-active { transition: all 0.3s ease; }
.slide-enter-from { opacity: 0; transform: translateY(-10px); }
.slide-leave-to   { opacity: 0; transform: translateY(-10px); }
</style>
