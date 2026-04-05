<template>
  <div class="ai-chat">
    <!-- 对话历史 -->
    <div class="chat-messages" ref="msgBox">
      <div v-if="messages.length === 0" class="empty-hint">
        <p>基于实时黄金价格、宏观数据、新闻情报，向 AI 分析师提问</p>
        <div class="quick-btns">
          <button
            v-for="q in quickQuestions"
            :key="q"
            class="quick-btn"
            @click="sendQuestion(q)"
          >{{ q }}</button>
        </div>
      </div>

      <div
        v-for="(msg, idx) in messages"
        :key="idx"
        class="msg-row"
        :class="msg.role"
      >
        <div class="msg-bubble">
          <div class="msg-role">{{ msg.role === 'user' ? '你' : '🤖 AI 分析师' }}</div>
          <div class="msg-content" v-html="formatMsg(msg.content)"></div>
          <div class="msg-time">{{ msg.time }}</div>
        </div>
      </div>

      <div v-if="loading" class="msg-row assistant">
        <div class="msg-bubble">
          <div class="msg-role">🤖 AI 分析师</div>
          <div class="msg-content thinking">
            <span class="dot"></span><span class="dot"></span><span class="dot"></span>
          </div>
        </div>
      </div>
    </div>

    <!-- 输入区 -->
    <div class="chat-input-area">
      <textarea
        ref="inputRef"
        v-model="inputText"
        class="chat-input"
        placeholder="输入你的问题，按 Enter 发送（Shift+Enter 换行）..."
        rows="2"
        @keydown.enter.exact.prevent="submit"
        :disabled="loading"
      ></textarea>
      <div class="input-actions">
        <button class="clear-btn" @click="clearChat" title="清空对话">清空</button>
        <button class="send-btn" @click="submit" :disabled="loading || !inputText.trim()">
          {{ loading ? '分析中…' : '发送' }}
        </button>
      </div>
    </div>

    <!-- AI 每日总结 -->
    <div class="summary-section" v-if="summaries.length > 0">
      <div class="summary-header" @click="showSummary = !showSummary">
        <span>📊 AI 提示词日报</span>
        <span class="toggle-icon">{{ showSummary ? '▲' : '▼' }}</span>
      </div>
      <div v-if="showSummary" class="summary-list">
        <div v-for="s in summaries" :key="s.date" class="summary-item">
          <div class="summary-date">{{ s.date }}</div>
          <div class="summary-content" v-html="formatMsg(s.summary)"></div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, nextTick } from 'vue';
import { api } from '../api';

interface Message {
  role: 'user' | 'assistant';
  content: string;
  time: string;
}

const messages = ref<Message[]>([]);
const inputText = ref('');
const loading   = ref(false);
const msgBox    = ref<HTMLElement | null>(null);
const inputRef  = ref<HTMLTextAreaElement | null>(null);
const summaries = ref<Array<{ date: string; summary: string; stats: string }>>([]);
const showSummary = ref(false);

const quickQuestions = [
  '当前黄金价格趋势如何？适合买入吗？',
  '今日有哪些重要新闻影响黄金？',
  '黄金 SGE 溢价说明什么？',
  '近期美联储政策对黄金有什么影响？',
];

function now() {
  return new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
}

function formatMsg(text: string): string {
  if (!text) return '';
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\n/g, '<br>');
}

async function scrollToBottom() {
  await nextTick();
  if (msgBox.value) {
    msgBox.value.scrollTop = msgBox.value.scrollHeight;
  }
}

async function sendQuestion(q: string) {
  inputText.value = q;
  await submit();
}

async function submit() {
  const text = inputText.value.trim();
  if (!text || loading.value) return;

  messages.value.push({ role: 'user', content: text, time: now() });
  inputText.value = '';
  loading.value = true;
  await scrollToBottom();

  const history = messages.value.slice(-12).map(m => ({
    role: m.role === 'user' ? 'user' : 'assistant',
    content: m.content,
  }));

  try {
    const { answer } = await api.chatWithAI(text, history) as { answer: string };
    messages.value.push({ role: 'assistant', content: answer, time: now() });
  } catch (err) {
    messages.value.push({
      role: 'assistant',
      content: `请求失败：${err instanceof Error ? err.message : String(err)}`,
      time: now(),
    });
  } finally {
    loading.value = false;
    await scrollToBottom();
    inputRef.value?.focus();
  }
}

function clearChat() {
  messages.value = [];
}

onMounted(() => {
  api.getAIDailySummaries()
    .then(data => { summaries.value = data as typeof summaries.value; })
    .catch(() => {});
});
</script>

<style scoped>
.ai-chat {
  display: flex;
  flex-direction: column;
  height: 600px;
  gap: 10px;
}

/* 消息区 */
.chat-messages {
  flex: 1;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 4px 0;
}

.empty-hint {
  text-align: center;
  color: var(--dim);
  padding: 20px 0;
  font-size: 13px;
}

.quick-btns {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  justify-content: center;
  margin-top: 14px;
}

.quick-btn {
  background: transparent;
  border: 1px solid var(--border);
  color: var(--text);
  padding: 6px 12px;
  border-radius: 16px;
  font-size: 12px;
  cursor: pointer;
  transition: all 0.15s;
  font-family: inherit;
}

.quick-btn:hover {
  border-color: var(--gold);
  color: var(--gold);
}

/* 消息气泡 */
.msg-row {
  display: flex;
}

.msg-row.user {
  justify-content: flex-end;
}

.msg-row.assistant {
  justify-content: flex-start;
}

.msg-bubble {
  max-width: 80%;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.msg-role {
  font-size: 11px;
  color: var(--dim);
}

.msg-row.user .msg-role {
  text-align: right;
}

.msg-content {
  background: var(--border);
  border-radius: 8px;
  padding: 10px 14px;
  font-size: 13px;
  line-height: 1.6;
  word-break: break-word;
}

.msg-row.user .msg-content {
  background: #2a1a4a;
  border: 1px solid #4a2a7a;
}

.msg-row.assistant .msg-content {
  background: #1a2a2a;
  border: 1px solid #2a4a4a;
}

.msg-time {
  font-size: 10px;
  color: var(--dim);
}

.msg-row.user .msg-time {
  text-align: right;
}

/* 思考动画 */
.thinking {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 12px 14px;
}

.dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--gold);
  opacity: 0.4;
  animation: blink 1.2s infinite;
}

.dot:nth-child(2) { animation-delay: 0.2s; }
.dot:nth-child(3) { animation-delay: 0.4s; }

@keyframes blink {
  0%, 80%, 100% { opacity: 0.2; }
  40%           { opacity: 1; }
}

/* 输入区 */
.chat-input-area {
  display: flex;
  gap: 8px;
  align-items: flex-end;
}

.chat-input {
  flex: 1;
  background: var(--border);
  border: 1px solid #3a3a5a;
  border-radius: 8px;
  color: var(--text);
  font-family: inherit;
  font-size: 13px;
  padding: 8px 12px;
  resize: none;
  outline: none;
  line-height: 1.5;
  transition: border-color 0.15s;
}

.chat-input:focus {
  border-color: var(--gold);
}

.chat-input:disabled {
  opacity: 0.5;
}

.input-actions {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.send-btn, .clear-btn {
  padding: 7px 16px;
  border-radius: 6px;
  font-size: 13px;
  cursor: pointer;
  font-family: inherit;
  border: none;
  transition: all 0.15s;
}

.send-btn {
  background: var(--gold);
  color: #000;
  font-weight: 700;
}

.send-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.send-btn:not(:disabled):hover {
  filter: brightness(1.1);
}

.clear-btn {
  background: transparent;
  border: 1px solid var(--border);
  color: var(--dim);
}

.clear-btn:hover {
  color: var(--text);
}

/* 每日总结 */
.summary-section {
  border-top: 1px solid var(--border);
  padding-top: 8px;
}

.summary-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  cursor: pointer;
  font-size: 12px;
  color: var(--gold);
  padding: 4px 0;
  user-select: none;
}

.toggle-icon {
  font-size: 10px;
  color: var(--dim);
}

.summary-list {
  margin-top: 8px;
  max-height: 300px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.summary-item {
  background: #111120;
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 10px 12px;
}

.summary-date {
  font-size: 11px;
  color: var(--gold);
  margin-bottom: 6px;
  font-weight: 600;
}

.summary-content {
  font-size: 12px;
  color: var(--text);
  line-height: 1.6;
}
</style>
