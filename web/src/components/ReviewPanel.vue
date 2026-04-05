<template>
  <div class="review-panel">

    <!-- 无记录状态 -->
    <div class="empty" v-if="!loading && closed.length === 0">
      暂无已平仓记录。平仓后 AI 会自动生成复盘分析。
    </div>

    <!-- 已平仓列表 -->
    <div class="closed-list" v-else>
      <div
        class="closed-card"
        v-for="pos in closed"
        :key="pos.id as number"
        :class="(pos.realized_pnl as number) >= 0 ? 'profit' : 'loss'"
      >
        <!-- 头部：结果 -->
        <div class="cc-header">
          <div class="cc-verdict" :class="(pos.realized_pnl as number) >= 0 ? 'green' : 'red'">
            {{ (pos.realized_pnl as number) >= 0 ? '✅ 盈利' : '❌ 亏损' }}
            <b>{{ (pos.realized_pnl as number) >= 0 ? '+' : '' }}¥{{ (pos.realized_pnl as number).toFixed(2) }}</b>
          </div>
          <div class="cc-detail">
            ¥{{ (pos.buy_price_cny_g as number).toFixed(2) }}
            → ¥{{ (pos.close_price_cny_g as number).toFixed(2) }}
            · {{ (pos.grams as number).toFixed(3) }}g
            · {{ (pos.holding_hours as number).toFixed(1) }}h
          </div>
          <div class="cc-dates">
            {{ fmtDate(pos.buy_ts as number) }} → {{ fmtDate(pos.close_ts as number) }}
          </div>
        </div>

        <!-- 开仓信号 -->
        <div class="cc-signal" v-if="pos.entry_signal">
          <span class="sig-badge" :class="sigCls((pos.entry_signal as Record<string,unknown>)['signal'] as string)">
            {{ LABELS[(pos.entry_signal as Record<string,unknown>)['signal'] as string] ?? (pos.entry_signal as Record<string,unknown>)['signal'] }}
          </span>
          <span class="sig-conf">置信度 {{ (pos.entry_signal as Record<string,unknown>)['confidence'] }}%</span>
          <span class="sig-stop" v-if="pos.stop_loss">止损 ¥{{ (pos.stop_loss as number).toFixed(2) }}</span>
          <span class="sig-tp"   v-if="pos.target_profit">目标 ¥{{ (pos.target_profit as number).toFixed(2) }}</span>
        </div>

        <!-- AI 复盘内容 -->
        <div class="review-body" v-if="pos.review_content">
          <div class="rb-row rating">
            <span class="rb-label">执行评分</span>
            <span class="stars">
              {{ '★'.repeat((pos.review_content as TradeReview).rating) }}{{ '☆'.repeat(5 - (pos.review_content as TradeReview).rating) }}
            </span>
            <span class="accuracy-badge" :class="accuracyCls((pos.review_content as TradeReview).signal_accuracy)">
              信号{{ accuracyLabel((pos.review_content as TradeReview).signal_accuracy) }}
            </span>
          </div>

          <div class="rb-cols">
            <div class="rb-col worked">
              <div class="rbc-title">做对了</div>
              <ul>
                <li v-for="w in (pos.review_content as TradeReview).what_worked" :key="w">{{ w }}</li>
              </ul>
            </div>
            <div class="rb-col failed">
              <div class="rbc-title">做错了</div>
              <ul>
                <li v-for="f in (pos.review_content as TradeReview).what_failed" :key="f">{{ f }}</li>
              </ul>
            </div>
          </div>

          <div class="rb-lesson">
            💡 <b>关键教训：</b>{{ (pos.review_content as TradeReview).key_lesson }}
          </div>
          <div class="rb-rule">
            📌 <b>下次规则：</b>{{ (pos.review_content as TradeReview).next_time_rule }}
          </div>
          <div class="rb-opt" v-if="(pos.review_content as TradeReview).optimization">
            🔧 <b>优化建议：</b>{{ (pos.review_content as TradeReview).optimization }}
          </div>
        </div>

        <!-- 等待复盘 -->
        <div class="review-pending" v-else>
          <span class="spin">◌</span> AI 复盘分析生成中...
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { api } from '../api';

interface TradeReview {
  verdict: string;
  signal_accuracy: string;
  what_worked: string[];
  what_failed: string[];
  key_lesson: string;
  next_time_rule: string;
  optimization: string;
  rating: number;
}

const closed  = ref<Record<string, unknown>[]>([]);
const loading = ref(false);

const LABELS: Record<string, string> = {
  STRONG_BUY: '强烈买入', BUY: '建议买入', HOLD: '观望',
  SELL: '减仓', STRONG_SELL: '强烈减仓',
};
const sigCls = (s: string) => s?.includes('BUY') ? 'green' : s?.includes('SELL') ? 'red' : 'dim';

const accuracyLabel = (s: string) => ({ correct: '准确', wrong: '有误', partial: '部分准确' }[s] ?? s);
const accuracyCls   = (s: string) => ({ correct: 'green', wrong: 'red', partial: 'yellow' }[s] ?? '');

const fmtDate = (ts: number) => new Date(ts).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });

async function load() {
  loading.value = true;
  try {
    closed.value = await api.getClosedPositions() as Record<string, unknown>[];
  } finally {
    loading.value = false;
  }
}

// 接收 WS 事件：复盘完成时更新
const onReviewReady = (id: number, review: TradeReview) => {
  const pos = closed.value.find(p => (p['id'] as number) === id);
  if (pos) pos['review_content'] = review;
};

defineExpose({ reload: load, onReviewReady });
onMounted(load);
</script>

<style scoped>
.review-panel { display: flex; flex-direction: column; gap: 10px; }
.empty { font-size: 12px; color: #555; text-align: center; padding: 20px 0; }
.spin { display: inline-block; animation: spin 1.2s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }

.closed-list { display: flex; flex-direction: column; gap: 10px; max-height: 600px; overflow-y: auto; }

.closed-card {
  border: 1px solid #2a2a4a; border-radius: 8px; padding: 12px;
  display: flex; flex-direction: column; gap: 8px;
}
.closed-card.profit { border-left: 3px solid #00C853; }
.closed-card.loss   { border-left: 3px solid #FF1744; }

/* 头部 */
.cc-header { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
.cc-verdict { font-size: 14px; font-weight: 800; }
.cc-verdict.green { color: #00C853; }
.cc-verdict.red   { color: #FF1744; }
.cc-detail { font-size: 11px; color: #aaa; }
.cc-dates  { font-size: 10px; color: #555; margin-left: auto; }

/* 开仓信号标签 */
.cc-signal { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.sig-badge { font-size: 11px; font-weight: 700; padding: 2px 8px; border-radius: 10px; }
.sig-badge.green  { background: rgba(0,200,83,0.15); color: #00C853; }
.sig-badge.red    { background: rgba(255,23,68,0.15); color: #FF1744; }
.sig-badge.dim    { background: rgba(255,214,0,0.15); color: #FFD600; }
.sig-conf { font-size: 10px; color: #666; }
.sig-stop { font-size: 10px; color: #FF1744; }
.sig-tp   { font-size: 10px; color: #00C853; }

/* 复盘内容 */
.review-body { background: rgba(212,175,55,0.04); border: 1px solid rgba(212,175,55,0.15); border-radius: 6px; padding: 10px; display: flex; flex-direction: column; gap: 8px; }

.rb-row.rating { display: flex; align-items: center; gap: 8px; }
.rb-label { font-size: 10px; color: #666; }
.stars { color: #D4AF37; font-size: 13px; letter-spacing: 2px; }
.accuracy-badge { font-size: 10px; padding: 1px 8px; border-radius: 10px; font-weight: 700; }
.accuracy-badge.green  { background: rgba(0,200,83,0.15); color: #00C853; }
.accuracy-badge.red    { background: rgba(255,23,68,0.15); color: #FF1744; }
.accuracy-badge.yellow { background: rgba(255,214,0,0.15); color: #FFD600; }

.rb-cols { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
.rb-col { background: #0d0d1a; border-radius: 4px; padding: 8px; }
.rbc-title { font-size: 10px; font-weight: 700; margin-bottom: 4px; }
.worked .rbc-title { color: #00C853; }
.failed .rbc-title { color: #FF1744; }
.rb-col ul { padding-left: 14px; margin: 0; }
.rb-col li { font-size: 11px; color: #aaa; line-height: 1.8; }

.rb-lesson, .rb-rule, .rb-opt { font-size: 12px; color: #ccc; line-height: 1.6; }
.rb-lesson b { color: #FFD600; }
.rb-rule b   { color: #D4AF37; }
.rb-opt b    { color: #42A5F5; }

.review-pending { font-size: 11px; color: #666; font-style: italic; }
</style>
