/**
 * AI 客户端统一封装 (T-301 + S-003)
 *
 * 优先级：
 *   1. 自定义端点 (AI_CUSTOM_BASE_URL) — 兼容 OpenAI Chat Completions 格式
 *      适用: Ollama / LM Studio / vLLM / 第三方代理
 *   2. Anthropic Claude API (ANTHROPIC_API_KEY)
 *
 * 若两者均未配置，抛出明确错误。
 */
import Anthropic from '@anthropic-ai/sdk';
import axios from 'axios';
import config from '../../config';
import logger from '../../utils/logger';
import { withRetry, globalRateLimiter } from '../../utils/retry';

let anthropicClient: Anthropic | null = null;

function getAnthropicClient(): Anthropic {
  if (!anthropicClient) {
    anthropicClient = new Anthropic({ apiKey: config.api.anthropicKey });
  }
  return anthropicClient;
}

/** 当前使用的 AI 后端信息（用于日志和 Dashboard 展示） */
export function getAIBackendInfo(): { type: string; model: string; endpoint: string } {
  if (config.api.aiCustomBaseUrl) {
    return {
      type: 'custom',
      model: config.api.aiCustomModel || '(未指定)',
      endpoint: config.api.aiCustomBaseUrl,
    };
  }
  return {
    type: 'anthropic',
    model: config.api.aiModel,
    endpoint: 'https://api.anthropic.com',
  };
}

// ── 自定义端点调用（OpenAI Chat Completions 格式）───────────────
async function callCustomEndpoint(
  systemPrompt: string,
  userMessage: string,
  maxTokens: number
): Promise<string> {
  const baseUrl = config.api.aiCustomBaseUrl.replace(/\/$/, '');
  const url = `${baseUrl}/chat/completions`;
  const model = config.api.aiCustomModel;
  const apiKey = config.api.aiCustomApiKey || 'dummy'; // Ollama 不校验 key

  const res = await axios.post(
    url,
    {
      model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMessage },
      ],
      max_tokens: maxTokens,
      temperature: 0.3,
      stream: false,
    },
    {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      timeout: 60000, // 本地模型可能较慢
    }
  );

  const data = res.data as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const text = data.choices?.[0]?.message?.content;
  if (!text) throw new Error('Custom AI: empty response');

  logger.debug('[ai] custom endpoint response', {
    model,
    endpoint: baseUrl,
    length: text.length,
  });

  return text;
}

// ── Anthropic Claude API 调用 ─────────────────────────────────
async function callAnthropicAPI(
  systemPrompt: string,
  userMessage: string,
  maxTokens: number
): Promise<string> {
  const response = await getAnthropicClient().messages.create({
    model: config.api.aiModel,
    max_tokens: maxTokens,
    system: systemPrompt,
    messages: [{ role: 'user', content: userMessage }],
  });

  const content = response.content[0];
  if (content.type !== 'text') throw new Error('Anthropic: unexpected response type');

  logger.debug('[ai] anthropic response', {
    model: config.api.aiModel,
    inputTokens: response.usage.input_tokens,
    outputTokens: response.usage.output_tokens,
  });

  return content.text;
}

// ── 统一调用入口 ──────────────────────────────────────────────
const MIN_INTERVAL_MS = 2000;

// contextType 标识调用来源，用于 AI 日志归类
export async function callClaude(
  systemPrompt: string,
  userMessage: string,
  maxTokens = 1024,
  contextType = 'unknown'
): Promise<string> {
  const hasCustom = !!config.api.aiCustomBaseUrl && !!config.api.aiCustomModel;
  const hasAnthropic = !!config.api.anthropicKey;

  if (!hasCustom && !hasAnthropic) {
    throw new Error(
      'No AI backend configured. Set either AI_CUSTOM_BASE_URL + AI_CUSTOM_MODEL, or ANTHROPIC_API_KEY in .env'
    );
  }

  await globalRateLimiter.throttle('ai-call', MIN_INTERVAL_MS);

  const startMs = Date.now();
  let response = '';

  try {
    response = await withRetry(
      async () => {
        if (hasCustom) {
          return callCustomEndpoint(systemPrompt, userMessage, maxTokens);
        }
        return callAnthropicAPI(systemPrompt, userMessage, maxTokens);
      },
      hasCustom ? `CustomAI(${config.api.aiCustomModel})` : `Anthropic(${config.api.aiModel})`,
      {
        maxAttempts: 3,
        baseDelayMs: 5000,
        retryOn: (err) => {
          if (err instanceof Error) {
            return !err.message.includes('401') && !err.message.includes('403');
          }
          return true;
        },
      }
    );
  } finally {
    // 异步写日志，不阻塞主流程
    setImmediate(() => {
      try {
        const { insertAILog } = require('../../storage/dao');
        insertAILog({
          contextType,
          systemPrompt: systemPrompt.slice(0, 2000), // 截断超长 prompt
          userMessage: userMessage.slice(0, 2000),
          response: response.slice(0, 4000),
          durationMs: Date.now() - startMs,
        });
      } catch { /* 日志写入失败不影响主逻辑 */ }
    });
  }

  return response;
}
