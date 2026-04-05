import logger from './logger';

export interface RetryOptions {
  maxAttempts?: number;   // 最大重试次数，默认 3
  baseDelayMs?: number;   // 初始延迟毫秒，默认 1000
  maxDelayMs?: number;    // 最大延迟毫秒，默认 30000
  jitter?: boolean;       // 是否加随机抖动，默认 true
  retryOn?: (error: unknown) => boolean; // 自定义重试条件
}

/**
 * 带指数退避的重试包装器
 * 每次失败后等待: min(baseDelay * 2^attempt + jitter, maxDelay)
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  label: string,
  options: RetryOptions = {}
): Promise<T> {
  const {
    maxAttempts = 3,
    baseDelayMs = 1000,
    maxDelayMs = 30000,
    jitter = true,
    retryOn,
  } = options;

  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;

      // 自定义重试条件判断
      if (retryOn && !retryOn(err)) {
        logger.error(`[retry] ${label} — non-retryable error, aborting`, { err });
        throw err;
      }

      if (attempt === maxAttempts) break;

      const expDelay = baseDelayMs * Math.pow(2, attempt - 1);
      const randomJitter = jitter ? Math.random() * 1000 : 0;
      const delay = Math.min(expDelay + randomJitter, maxDelayMs);

      logger.warn(
        `[retry] ${label} — attempt ${attempt}/${maxAttempts} failed, retrying in ${Math.round(delay)}ms`,
        { err: err instanceof Error ? err.message : String(err) }
      );

      await sleep(delay);
    }
  }

  logger.error(`[retry] ${label} — all ${maxAttempts} attempts failed`);
  throw lastError;
}

export const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * 简单的限流器：确保同一 key 的调用不超过指定频率
 */
export class RateLimiter {
  private lastCallTime: Map<string, number> = new Map();

  async throttle(key: string, minIntervalMs: number): Promise<void> {
    const last = this.lastCallTime.get(key) ?? 0;
    const now = Date.now();
    const wait = minIntervalMs - (now - last);
    if (wait > 0) {
      await sleep(wait);
    }
    this.lastCallTime.set(key, Date.now());
  }
}

export const globalRateLimiter = new RateLimiter();
