<template>
  <div class="push-config">

    <!-- 配置状态 -->
    <div class="status-row">
      <div class="status-item" :class="cfg.dingtalk ? 'ok' : 'off'">
        <span class="dot">{{ cfg.dingtalk ? '●' : '○' }}</span>
        <span class="label">钉钉 Webhook</span>
        <span class="tag">{{ cfg.dingtalk ? '已配置' : '未配置' }}</span>
      </div>
      <div class="status-item" :class="cfg.telegram ? 'ok' : 'off'">
        <span class="dot">{{ cfg.telegram ? '●' : '○' }}</span>
        <span class="label">Telegram Bot</span>
        <span class="tag">{{ cfg.telegram ? '已配置' : '未配置' }}</span>
      </div>
      <div class="status-item" :class="cfg.email ? 'ok' : 'off'">
        <span class="dot">{{ cfg.email ? '●' : '○' }}</span>
        <span class="label">邮件推送</span>
        <span class="tag">{{ cfg.email ? '已配置' : '未配置' }}</span>
      </div>
    </div>

    <!-- 钉钉测试 -->
    <div class="test-section">
      <button class="test-btn" :disabled="!cfg.dingtalk || testing" @click="testDingTalk">
        {{ testing ? '发送中...' : '📨 发送钉钉测试消息' }}
      </button>
      <div v-if="testResult" class="test-result" :class="testOk ? 'ok' : 'err'">
        {{ testOk ? '✅' : '❌' }} {{ testResult }}
      </div>
    </div>

    <!-- 提醒规则说明 -->
    <div class="rules-section">
      <div class="rules-title">已启用的钉钉提醒规则</div>
      <table class="rules-table">
        <thead>
          <tr><th>类型</th><th>触发条件</th><th>冷却时间</th></tr>
        </thead>
        <tbody>
          <tr v-for="rule in rules" :key="rule.name">
            <td><span class="rule-tag">{{ rule.icon }} {{ rule.name }}</span></td>
            <td class="rule-desc">{{ rule.condition }}</td>
            <td class="rule-cd">{{ rule.cooldown }}</td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- 配置说明 -->
    <div class="env-tip">
      <div class="env-title">📋 配置方法（在 .env 文件中设置）</div>
      <pre class="env-block">DINGTALK_WEBHOOK=https://oapi.dingtalk.com/robot/send?access_token=xxxx
DINGTALK_SECRET=SECxxxxxxxxxxxxxxxx  # 加签密钥（可选）</pre>
      <div class="env-note">修改 .env 后需重启后端服务生效</div>
    </div>

  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { api } from '../api';

const cfg     = ref({ dingtalk: false, telegram: false, email: false });
const testing = ref(false);
const testResult = ref('');
const testOk  = ref(false);

onMounted(async () => {
  try {
    cfg.value = await api.getPushConfig();
  } catch { /* ignore */ }
});

async function testDingTalk() {
  testing.value = true;
  testResult.value = '';
  try {
    const res = await api.testDingTalk();
    testOk.value   = res.ok;
    testResult.value = res.message;
  } catch (e: unknown) {
    testOk.value   = false;
    testResult.value = (e as { response?: { data?: { error?: string } } })?.response?.data?.error ?? '发送失败';
  } finally {
    testing.value = false;
  }
}

const rules = [
  {
    icon: '📍', name: '整数关口穿越',
    condition: '价格突破/跌破整10位（¥680/¥690/¥700…）',
    cooldown: '同向4小时',
  },
  {
    icon: '🏆', name: '52周新高',
    condition: '价格突破过去52周最高价',
    cooldown: '6小时',
  },
  {
    icon: '📉', name: '52周新低',
    condition: '价格跌破过去52周最低价',
    cooldown: '6小时',
  },
  {
    icon: '🚀', name: '价格急涨',
    condition: '5分钟内涨幅≥0.5% / 15分钟≥1% / 30分钟≥1.5%',
    cooldown: '同向30分钟',
  },
  {
    icon: '💥', name: '价格急跌',
    condition: '5分钟内跌幅≥0.5% / 15分钟≥1% / 30分钟≥1.5%',
    cooldown: '同向30分钟',
  },
  {
    icon: '📈', name: '日内大幅波动',
    condition: '较昨收涨跌≥1.5%（普通）/ ≥2.5%（大幅）',
    cooldown: '3小时',
  },
  {
    icon: '📊', name: 'SGE溢价异常',
    condition: 'SGE溢价绝对值 > $5/oz',
    cooldown: '2小时',
  },
  {
    icon: '🎯', name: '交易信号',
    condition: 'AI综合信号为 BUY / STRONG_BUY / SELL / STRONG_SELL',
    cooldown: '同信号2小时',
  },
  {
    icon: '⚠️', name: '持仓亏损预警',
    condition: '浮亏≥3% 或触及设定止损价',
    cooldown: '每次运行期间每笔仓位1次',
  },
  {
    icon: '☀️', name: '早安播报',
    condition: '每个交易日 08:30，价格+持仓汇总',
    cooldown: '每日1次',
  },
  {
    icon: '📅', name: '周度展望',
    condition: '每周一 09:00，上周行情回顾+本周关注',
    cooldown: '每周1次',
  },
  {
    icon: '🌅', name: '盘中快报',
    condition: '每交易日 09:30 / 13:30 / 21:30 AI分析播报',
    cooldown: '每次3小时',
  },
  {
    icon: '📰', name: '重磅新闻',
    condition: 'AI评估影响力 ≥ 4/5 的黄金相关新闻',
    cooldown: '每条新闻1次',
  },
];
</script>

<style scoped>
.push-config { display: flex; flex-direction: column; gap: 16px; }

/* 状态行 */
.status-row { display: flex; gap: 12px; flex-wrap: wrap; }
.status-item {
  display: flex; align-items: center; gap: 6px;
  padding: 8px 14px; border-radius: 8px; border: 1px solid var(--border);
  font-size: 13px;
}
.status-item.ok  { border-color: var(--green); }
.status-item.off { opacity: 0.5; }
.dot { font-size: 14px; }
.status-item.ok  .dot { color: var(--green); }
.status-item.off .dot { color: var(--dim); }
.label { color: var(--text); }
.tag { font-size: 11px; color: var(--dim); margin-left: 2px; }
.status-item.ok .tag { color: var(--green); }

/* 测试区 */
.test-section { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
.test-btn {
  padding: 8px 18px; border-radius: 6px; border: 1px solid var(--gold);
  background: transparent; color: var(--gold); font-size: 13px;
  cursor: pointer; font-family: inherit; transition: all 0.15s;
}
.test-btn:hover:not(:disabled) { background: rgba(212,175,55,0.1); }
.test-btn:disabled { opacity: 0.4; cursor: not-allowed; }
.test-result { font-size: 13px; padding: 6px 10px; border-radius: 4px; }
.test-result.ok  { color: var(--green); background: rgba(0,200,83,0.08); }
.test-result.err { color: var(--red);   background: rgba(255,23,68,0.08); }

/* 规则表 */
.rules-section { display: flex; flex-direction: column; gap: 8px; }
.rules-title { font-size: 12px; color: var(--dim); font-weight: 600; letter-spacing: 0.05em; }
.rules-table { width: 100%; border-collapse: collapse; font-size: 12px; }
.rules-table th {
  text-align: left; padding: 6px 10px;
  border-bottom: 1px solid var(--border); color: var(--dim);
  font-weight: 500;
}
.rules-table td { padding: 7px 10px; border-bottom: 1px solid rgba(42,42,74,0.6); vertical-align: top; }
.rules-table tr:last-child td { border-bottom: none; }
.rule-tag { color: var(--text); font-weight: 500; white-space: nowrap; }
.rule-desc { color: var(--dim); }
.rule-cd   { color: var(--dim); white-space: nowrap; }

/* 配置说明 */
.env-tip { background: rgba(0,0,0,0.3); border-radius: 6px; padding: 12px 14px; }
.env-title { font-size: 12px; color: var(--gold); margin-bottom: 8px; font-weight: 600; }
.env-block {
  font-family: 'JetBrains Mono', monospace;
  font-size: 11px; color: #b0c4de;
  background: rgba(0,0,0,0.4); padding: 8px; border-radius: 4px;
  overflow-x: auto; white-space: pre;
}
.env-note { font-size: 11px; color: var(--dim); margin-top: 6px; }
</style>
