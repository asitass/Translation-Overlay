/**
 * AdaptiveTimer manages capture interval transitions.
 * Adapts between active/idle/deep-idle intervals based on screen activity.
 * Only rebuilds the underlying timer when interval changes by >200ms to avoid GC pressure.
 *
 * Interval strategy:
 * - Change detected → ACTIVE (intervalActive from config)
 * - Sudden change after >15s idle → FAST_DETECTION (1000ms) for 3s
 * - 3+ consecutive no-change → IDLE (intervalIdle from config)
 * - 10+ consecutive no-change → DEEP_IDLE (6000ms)
 */
export class AdaptiveTimer {
  private timer: ReturnType<typeof setInterval> | null = null;
  private currentAdaptiveInterval: number | null = null;
  private lastBuiltInterval: number | null = null;
  private consecutiveNoChange = 0;
  private lastChangeTimestamp = 0;
  private fastDetectionMode = false;
  private fastDetectionTimer: ReturnType<typeof setTimeout> | null = null;
  private onTick: () => Promise<void>;

  constructor(onTick: () => Promise<void>) {
    this.onTick = onTick;
  }

  /**
   * Start the periodic timer with the given interval.
   */
  start(intervalMs: number): void {
    this.stop();
    this.currentAdaptiveInterval = intervalMs;
    this.lastBuiltInterval = intervalMs;
    this.consecutiveNoChange = 0;
    this.fastDetectionMode = false;

    this.timer = setInterval(() => {
      this.onTick().catch((err) => {
        console.error('[adaptive-timer] Tick error:', err);
      });
    }, intervalMs);

    console.log(`[adaptive-timer] Started with interval: ${intervalMs}ms`);
  }

  /**
   * Stop the timer.
   */
  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    if (this.fastDetectionTimer) {
      clearTimeout(this.fastDetectionTimer);
      this.fastDetectionTimer = null;
    }
    this.currentAdaptiveInterval = null;
    this.lastBuiltInterval = null;
  }

  /**
   * Adapt interval based on whether a change was detected.
   */
  adapt(hasChange: boolean, intervalActive: number, intervalIdle: number): void {
    const now = Date.now();

    if (hasChange) {
      // Check for sudden change after long idle
      const idleDuration = now - this.lastChangeTimestamp;
      if (idleDuration > 15000 && !this.fastDetectionMode) {
        this.fastDetectionMode = true;
        console.log('[adaptive-timer] Fast detection mode activated');
        // Auto-exit after 3 seconds
        if (this.fastDetectionTimer) clearTimeout(this.fastDetectionTimer);
        this.fastDetectionTimer = setTimeout(() => {
          this.fastDetectionMode = false;
          console.log('[adaptive-timer] Fast detection mode deactivated');
        }, 3000);
      }
      this.lastChangeTimestamp = now;
      this.consecutiveNoChange = 0;
      this.currentAdaptiveInterval = this.fastDetectionMode ? 1000 : intervalActive;
    } else {
      this.consecutiveNoChange++;
      if (this.consecutiveNoChange >= 10) {
        this.currentAdaptiveInterval = 6000;
      } else if (this.consecutiveNoChange >= 3) {
        this.currentAdaptiveInterval = intervalIdle;
      } else {
        this.currentAdaptiveInterval = intervalActive;
      }
    }
  }

  /**
   * Rebuild the timer if the adaptive interval has changed significantly (>200ms).
   */
  rebuildIfNeeded(): void {
    if (this.currentAdaptiveInterval === null || !this.timer) return;

    // Only rebuild if interval changed by more than 200ms (avoid jitter and GC pressure)
    if (this.lastBuiltInterval !== null && Math.abs(this.currentAdaptiveInterval - this.lastBuiltInterval) < 200) {
      return;
    }

    this.lastBuiltInterval = this.currentAdaptiveInterval;

    // Rebuild timer with new interval
    clearInterval(this.timer);
    this.timer = setInterval(() => {
      this.onTick().catch((err) => {
        console.error('[adaptive-timer] Tick error:', err);
      });
    }, this.currentAdaptiveInterval);

    console.log(`[adaptive-timer] Interval adapted to ${this.currentAdaptiveInterval}ms (noChange=${this.consecutiveNoChange})`);
  }

  /**
   * Check if timer is currently running.
   */
  isRunning(): boolean {
    return this.timer !== null;
  }

  /**
   * Get current interval for diagnostics.
   */
  getCurrentInterval(): number | null {
    return this.currentAdaptiveInterval;
  }
}
