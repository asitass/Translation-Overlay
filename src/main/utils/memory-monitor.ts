/**
 * Lightweight memory monitor for the Electron main process.
 * Samples memory usage at regular intervals and logs warnings when thresholds are exceeded.
 * No external dependencies — uses Node.js built-in process.memoryUsage().
 */
export class MemoryMonitor {
  private interval: ReturnType<typeof setInterval> | null = null;
  private readonly sampleIntervalMs: number;
  private readonly warnHeapThresholdMb: number;
  private lastSample: NodeJS.MemoryUsage | null = null;

  /**
   * @param sampleIntervalMs How often to sample memory (default: 60s)
   * @param warnHeapThresholdMb Log a warning when heapUsed exceeds this (default: 300MB)
   */
  constructor(sampleIntervalMs: number = 60000, warnHeapThresholdMb: number = 300) {
    this.sampleIntervalMs = sampleIntervalMs;
    this.warnHeapThresholdMb = warnHeapThresholdMb;
  }

  /**
   * Start periodic memory sampling.
   */
  start(): void {
    if (this.interval) return;
    this.interval = setInterval(() => this.sample(), this.sampleIntervalMs);
    console.log(`[memory-monitor] Started (interval=${this.sampleIntervalMs}ms, warnThreshold=${this.warnHeapThresholdMb}MB)`);
  }

  /**
   * Stop memory sampling.
   */
  stop(): void {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
  }

  /**
   * Take a single sample and check thresholds.
   */
  private sample(): void {
    this.lastSample = process.memoryUsage();
    const { heapUsed, rss, external } = this.lastSample;
    const heapUsedMb = heapUsed / (1024 * 1024);
    const rssMb = rss / (1024 * 1024);
    const externalMb = external / (1024 * 1024);

    if (heapUsedMb > this.warnHeapThresholdMb) {
      console.warn(`[memory-monitor] High heap usage: ${heapUsedMb.toFixed(1)}MB (threshold: ${this.warnHeapThresholdMb}MB), RSS: ${rssMb.toFixed(1)}MB, External: ${externalMb.toFixed(1)}MB`);
    } else {
      console.log(`[memory-monitor] Heap: ${heapUsedMb.toFixed(1)}MB, RSS: ${rssMb.toFixed(1)}MB, External: ${externalMb.toFixed(1)}MB`);
    }
  }

  /**
   * Get the last memory sample (or take one if none exists).
   */
  getCurrent(): NodeJS.MemoryUsage {
    if (!this.lastSample) {
      this.lastSample = process.memoryUsage();
    }
    return this.lastSample;
  }
}
