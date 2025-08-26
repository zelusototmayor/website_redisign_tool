/**
 * Token Bucket Rate Limiter for OpenAI API calls
 * Manages rate limits for different models with sliding window algorithm
 */

interface TokenBucketConfig {
  maxTokens: number;
  refillRate: number; // tokens per second
  windowSize: number; // milliseconds
}

interface UsageRecord {
  timestamp: number;
  tokensUsed: number;
}

interface RateLimitMetrics {
  tokensUsed: number;
  tokensAvailable: number;
  requestsQueued: number;
  errorsCount: number;
  averageWaitTime: number;
}

/**
 * Token bucket implementation with sliding window for accurate rate limiting
 */
export class TokenBucket {
  private config: TokenBucketConfig;
  private usageHistory: UsageRecord[] = [];
  private queuedRequests: number = 0;
  private errors429Count: number = 0;
  private waitTimes: number[] = [];

  constructor(config: TokenBucketConfig) {
    this.config = config;
  }

  /**
   * Check if a request with specified token count can be processed
   */
  canProcess(tokenCount: number): boolean {
    this.cleanOldUsage();
    const currentUsage = this.getCurrentUsage();
    return currentUsage + tokenCount <= this.config.maxTokens;
  }

  /**
   * Consume tokens for a request (call this after successful API call)
   */
  consumeTokens(tokenCount: number): void {
    this.cleanOldUsage();
    this.usageHistory.push({
      timestamp: Date.now(),
      tokensUsed: tokenCount
    });
  }

  /**
   * Get available tokens in current window
   */
  getAvailableTokens(): number {
    this.cleanOldUsage();
    const currentUsage = this.getCurrentUsage();
    return Math.max(0, this.config.maxTokens - currentUsage);
  }

  /**
   * Calculate wait time needed for specified token count
   */
  waitTimeForTokens(tokenCount: number): number {
    if (this.canProcess(tokenCount)) {
      return 0;
    }

    this.cleanOldUsage();
    
    // Find oldest usage that would need to expire for request to proceed
    const currentUsage = this.getCurrentUsage();
    const excessTokens = (currentUsage + tokenCount) - this.config.maxTokens;
    
    let cumulativeTokens = 0;
    for (const usage of this.usageHistory) {
      cumulativeTokens += usage.tokensUsed;
      if (cumulativeTokens >= excessTokens) {
        const waitTime = Math.max(0, 
          (usage.timestamp + this.config.windowSize) - Date.now()
        );
        this.waitTimes.push(waitTime);
        return waitTime;
      }
    }

    // Fallback: wait for window to reset
    const fallbackWait = this.config.windowSize;
    this.waitTimes.push(fallbackWait);
    return fallbackWait;
  }

  /**
   * Record a 429 rate limit error
   */
  recordRateLimitError(): void {
    this.errors429Count++;
  }

  /**
   * Increment queued requests counter
   */
  incrementQueuedRequests(): void {
    this.queuedRequests++;
  }

  /**
   * Decrement queued requests counter
   */
  decrementQueuedRequests(): void {
    this.queuedRequests = Math.max(0, this.queuedRequests - 1);
  }

  /**
   * Get comprehensive metrics
   */
  getMetrics(): RateLimitMetrics {
    this.cleanOldUsage();
    const avgWaitTime = this.waitTimes.length > 0 
      ? this.waitTimes.reduce((sum, time) => sum + time, 0) / this.waitTimes.length 
      : 0;

    return {
      tokensUsed: this.getCurrentUsage(),
      tokensAvailable: this.getAvailableTokens(),
      requestsQueued: this.queuedRequests,
      errorsCount: this.errors429Count,
      averageWaitTime: avgWaitTime
    };
  }

  /**
   * Reset all metrics and history
   */
  reset(): void {
    this.usageHistory = [];
    this.queuedRequests = 0;
    this.errors429Count = 0;
    this.waitTimes = [];
  }

  /**
   * Remove usage records outside the sliding window
   */
  private cleanOldUsage(): void {
    const cutoff = Date.now() - this.config.windowSize;
    this.usageHistory = this.usageHistory.filter(
      record => record.timestamp > cutoff
    );
  }

  /**
   * Calculate total tokens used in current window
   */
  private getCurrentUsage(): number {
    return this.usageHistory.reduce(
      (total, record) => total + record.tokensUsed, 
      0
    );
  }
}

/**
 * Rate limiter manager for different OpenAI models
 */
export class RateLimiterManager {
  private buckets: Map<string, TokenBucket> = new Map();

  constructor() {
    // Initialize buckets for different models
    this.buckets.set('gpt-5', new TokenBucket({
      maxTokens: 30000, // 30K tokens per minute
      refillRate: 500,  // ~30K tokens / 60 seconds
      windowSize: 60000 // 1 minute sliding window
    }));

    this.buckets.set('gpt-4o', new TokenBucket({
      maxTokens: 800000, // 800K tokens per minute (typical GPT-4o limit)
      refillRate: 13333,  // ~800K tokens / 60 seconds
      windowSize: 60000   // 1 minute sliding window
    }));

    this.buckets.set('gpt-4-turbo', new TokenBucket({
      maxTokens: 450000, // 450K tokens per minute
      refillRate: 7500,   // ~450K tokens / 60 seconds
      windowSize: 60000   // 1 minute sliding window
    }));
  }

  /**
   * Check if request can be processed for specific model
   */
  canProcess(tokenCount: number, model: string): boolean {
    const bucket = this.buckets.get(model);
    if (!bucket) {
      console.warn(`Unknown model: ${model}, allowing request`);
      return true;
    }
    return bucket.canProcess(tokenCount);
  }

  /**
   * Consume tokens for successful API call
   */
  consumeTokens(tokenCount: number, model: string): void {
    const bucket = this.buckets.get(model);
    if (bucket) {
      bucket.consumeTokens(tokenCount);
    }
  }

  /**
   * Get available tokens for model
   */
  getAvailableTokens(model: string): number {
    const bucket = this.buckets.get(model);
    return bucket ? bucket.getAvailableTokens() : Infinity;
  }

  /**
   * Get wait time for specific model and token count
   */
  waitTimeForTokens(tokenCount: number, model: string): number {
    const bucket = this.buckets.get(model);
    return bucket ? bucket.waitTimeForTokens(tokenCount) : 0;
  }

  /**
   * Record rate limit error for model
   */
  recordRateLimitError(model: string): void {
    const bucket = this.buckets.get(model);
    if (bucket) {
      bucket.recordRateLimitError();
    }
  }

  /**
   * Manage request queue for model
   */
  incrementQueuedRequests(model: string): void {
    const bucket = this.buckets.get(model);
    if (bucket) {
      bucket.incrementQueuedRequests();
    }
  }

  decrementQueuedRequests(model: string): void {
    const bucket = this.buckets.get(model);
    if (bucket) {
      bucket.decrementQueuedRequests();
    }
  }

  /**
   * Get metrics for specific model
   */
  getMetrics(model: string): RateLimitMetrics | null {
    const bucket = this.buckets.get(model);
    return bucket ? bucket.getMetrics() : null;
  }

  /**
   * Get metrics for all models
   */
  getAllMetrics(): Record<string, RateLimitMetrics> {
    const metrics: Record<string, RateLimitMetrics> = {};
    for (const [model, bucket] of this.buckets.entries()) {
      metrics[model] = bucket.getMetrics();
    }
    return metrics;
  }

  /**
   * Reset all metrics for all models
   */
  resetAllMetrics(): void {
    for (const bucket of this.buckets.values()) {
      bucket.reset();
    }
  }

  /**
   * Add or update bucket configuration for a model
   */
  configureBucket(model: string, config: TokenBucketConfig): void {
    this.buckets.set(model, new TokenBucket(config));
  }
}

// Singleton instance for application use
export const rateLimiter = new RateLimiterManager();

// Helper function to estimate tokens from text (rough approximation)
export function estimateTokenCount(text: string): number {
  // Rough estimation: ~4 characters per token
  // More accurate for GPT models than simple word counting
  return Math.ceil(text.length / 4);
}

// Helper function to wait for specified duration
export function waitFor(milliseconds: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, milliseconds));
}