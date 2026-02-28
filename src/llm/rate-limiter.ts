/**
 * Token-bucket rate limiter for shared LLM access across concurrent agents.
 * FIFO queue ensures fairness — requests are served in arrival order.
 */
export class RateLimiter {
  private tokens: number;
  private maxTokens: number;
  private refillIntervalMs: number;
  private refillTimer: ReturnType<typeof setInterval> | null = null;
  private queue: Array<() => void> = [];

  constructor(requestsPerMinute: number) {
    this.maxTokens = requestsPerMinute;
    this.tokens = requestsPerMinute;
    this.refillIntervalMs = 60000 / requestsPerMinute;

    this.refillTimer = setInterval(() => {
      if (this.tokens < this.maxTokens) {
        this.tokens++;
        this.drain();
      }
    }, this.refillIntervalMs);

    // Don't hold the process open
    if (this.refillTimer.unref) {
      this.refillTimer.unref();
    }
  }

  /**
   * Wait until a token is available. Resolves immediately if tokens are free,
   * otherwise queues the request (FIFO).
   */
  acquire(): Promise<void> {
    if (this.tokens > 0) {
      this.tokens--;
      return Promise.resolve();
    }

    return new Promise<void>((resolve) => {
      this.queue.push(resolve);
    });
  }

  /** Current available tokens. */
  available(): number {
    return this.tokens;
  }

  /** Number of requests waiting for a token. */
  queueDepth(): number {
    return this.queue.length;
  }

  /** Stop the refill timer. Call when shutting down. */
  dispose(): void {
    if (this.refillTimer) {
      clearInterval(this.refillTimer);
      this.refillTimer = null;
    }
    // Release any waiting requests
    for (const resolve of this.queue) {
      resolve();
    }
    this.queue = [];
  }

  /** Try to serve queued requests from available tokens. */
  private drain(): void {
    while (this.tokens > 0 && this.queue.length > 0) {
      this.tokens--;
      const resolve = this.queue.shift()!;
      resolve();
    }
  }
}
