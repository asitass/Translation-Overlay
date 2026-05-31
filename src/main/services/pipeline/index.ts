import { ScreenCapturer } from '../capturer';
import { OcrService } from '../ocr';
import { TranslatorService } from '../translator';
import { ChangeDetector } from '../change-detector';
import { ConfigService } from '../config';
import { TranslationCache } from '../cache';
import { AppConfig, LockMode, PipelineStatus, TranslationItem } from '../../../shared/types';
import type { TextBlock } from '../../../shared/types';
import { DEFAULTS } from '../../../shared/constants';
import { isTargetLanguageText } from '../../utils/target-lang-detector';
import { postProcessTranslation, splitTranslationToLines } from '../../utils/translation-postprocess';

import { AdaptiveTimer } from './adaptive-timer';
import { OutputTracker } from './output-tracker';
import { ResultEmitter } from './result-emitter';
import { type PipelineMode, DynamicMode, DocumentMode } from './modes';

/**
 * Pipeline orchestrates the capture→OCR→translate→emit flow.
 *
 * Delegates to:
 * - AdaptiveTimer: manages capture interval transitions
 * - OutputTracker: filters overlay feedback text
 * - ResultEmitter: IPC communication with renderer
 * - PipelineMode: mode-specific logic (dynamic/document)
 */
export class Pipeline {
  private capturer: ScreenCapturer;
  private ocr: OcrService;
  private translator: TranslatorService;
  private detector: ChangeDetector;
  private configService: ConfigService;
  private cache: TranslationCache;

  private adaptiveTimer: AdaptiveTimer;
  private outputTracker: OutputTracker;
  private resultEmitter: ResultEmitter;
  private mode: PipelineMode;

  private status: PipelineStatus = 'stopped';
  private isProcessing = false;
  private prevFrameData: Uint8Array | null = null;
  private prevWidth = 0;

  // Lock state
  private isLocked = false;
  private lockedResults: TranslationItem[] = [];
  private lockedFrameData: Uint8Array | null = null;
  private lockTimestamp: number | null = null;

  // Tracking state
  private noNewTextCounter = 0;
  private lastEmittedResults: TranslationItem[] = [];
  private lockMode: LockMode = DEFAULTS.DEFAULT_LOCK_MODE;

  constructor(
    capturer: ScreenCapturer,
    ocr: OcrService,
    translator: TranslatorService,
    detector: ChangeDetector,
    configService: ConfigService,
    cache: TranslationCache,
  ) {
    this.capturer = capturer;
    this.ocr = ocr;
    this.translator = translator;
    this.detector = detector;
    this.configService = configService;
    this.cache = cache;

    this.adaptiveTimer = new AdaptiveTimer(() => this.tick());
    this.outputTracker = new OutputTracker(150);
    this.resultEmitter = new ResultEmitter();
    this.mode = this.createMode(this.lockMode);

    console.log('[pipeline] Initialized');
  }

  /**
   * Create the appropriate pipeline mode strategy.
   */
  private createMode(lockMode: LockMode): PipelineMode {
    switch (lockMode) {
      case 'dynamic':
        return new DynamicMode();
      case 'document':
        return new DocumentMode();
      default:
        return new DocumentMode();
    }
  }

  setMainWindow(win: import('electron').BrowserWindow): void {
    this.resultEmitter.setMainWindow(win);
  }

  getStatus(): PipelineStatus {
    return this.status;
  }

  /**
   * Update pipeline config at runtime (hot-reload).
   * Rebuilds the capture timer if interval changed.
   */
  updateConfig(config: AppConfig): void {
    const oldInterval = this.configService.getConfig().capture.intervalIdle;
    const newInterval = config.capture.intervalIdle;

    // Persist config change (updates in-memory + writes to disk)
    this.configService.updateConfig(config);

    // Update mode if lock mode changed
    const newLockMode = config.pipeline?.lockMode ?? DEFAULTS.DEFAULT_LOCK_MODE;
    if (newLockMode !== this.lockMode) {
      this.lockMode = newLockMode;
      this.mode = this.createMode(newLockMode);
      console.log(`[pipeline] Mode switched to: ${this.mode.name}`);
    }

    // Rebuild timer if interval changed and pipeline is running
    if (this.adaptiveTimer.isRunning() && newInterval !== oldInterval) {
      this.adaptiveTimer.stop();
      this.adaptiveTimer.start(newInterval);
      console.log('[pipeline] Interval updated:', newInterval, 'ms');
    }
  }

  /**
   * Start the pipeline capture→OCR→translate loop.
   */
  async start(): Promise<void> {
    if (this.status === 'running') {
      console.log('[pipeline] Already running');
      return;
    }

    console.log('[pipeline] Starting...');

    // Initialize OCR engine
    try {
      await this.ocr.initialize();
    } catch (ocrErr) {
      console.error(`[pipeline] OCR initialization failed: ${ocrErr}`);
    }

    this.status = 'running';
    this.resultEmitter.emitStatus(this.status);

    const config = this.configService.getConfig();
    const intervalMs = config.capture.intervalIdle;

    // Preload Bergamot translation model
    try {
      await this.translator.preloadBergamot(config.translation);
    } catch (err) {
      console.warn('[pipeline] Bergamot preload failed, will lazy-load on first use:', err);
    }

    // Start periodic capture loop
    this.adaptiveTimer.start(intervalMs);

    console.log('[pipeline] Started with interval:', intervalMs, 'ms');
  }

  /**
   * Stop the pipeline.
   */
  stop(): void {
    this.adaptiveTimer.stop();
    this.status = 'stopped';
    this.resultEmitter.emitStatus(this.status);
    this.prevFrameData = null;
    this.isLocked = false;
    this.lockedResults = [];
    this.lockedFrameData = null;
    this.noNewTextCounter = 0;
    this.lastEmittedResults = [];
    console.log('[pipeline] Stopped');
  }

  /**
   * Single pipeline tick: capture → detect change → OCR → filter → translate → emit.
   * With lock mode: when content is stable, skip re-processing and emit locked results.
   */
  private async tick(): Promise<void> {
    if (this.isProcessing) return;
    this.isProcessing = true;

    const t0 = Date.now();
    const config = this.configService.getConfig();
    this.lockMode = config.pipeline?.lockMode ?? DEFAULTS.DEFAULT_LOCK_MODE;

    try {
      // Step 1: Capture screen
      const imageBuffer = this.capturer.captureScreen();
      const monitorSize = this.capturer.getPrimaryMonitorSize();
      const tCapture = Date.now();

      // Step 2: Check for significant frame changes
      const frameData = new Uint8Array(imageBuffer);

      // If locked, use stricter threshold for unlocking
      const unlockThreshold = this.isLocked ? DEFAULTS.UNLOCK_CHANGE_THRESHOLD : undefined;
      const hasChange = !this.prevFrameData || this.detector.hasSignificantChange(
        frameData,
        this.prevFrameData,
        monitorSize.width,
        this.prevWidth,
        unlockThreshold,
      );

      if (!hasChange) {
        this.prevFrameData = frameData;
        this.prevWidth = monitorSize.width;
        this.adaptiveTimer.adapt(false, config.capture.intervalActive, config.capture.intervalIdle);
        this.adaptiveTimer.rebuildIfNeeded();
        return;
      }

      // If locked and big change detected → unlock (with minimum display time protection)
      if (this.isLocked) {
        const lockDuration = Date.now() - (this.lockTimestamp ?? 0);
        if (lockDuration < DEFAULTS.MIN_LOCK_DISPLAY_TIME_MS) {
          console.log(`[pipeline] Locked for ${lockDuration}ms < ${DEFAULTS.MIN_LOCK_DISPLAY_TIME_MS}ms minimum, ignoring change`);
          this.prevFrameData = frameData;
          this.prevWidth = monitorSize.width;
          return;
        }
        console.log('[pipeline] Significant change detected, unlocking');
        this.isLocked = false;
        this.lockedResults = [];
        this.lockTimestamp = null;
        this.noNewTextCounter = 0;
        this.lastEmittedResults = [];
        this.detector.resetStability();
      }

      this.prevFrameData = frameData;
      this.prevWidth = monitorSize.width;
      this.adaptiveTimer.adapt(true, config.capture.intervalActive, config.capture.intervalIdle);
      this.adaptiveTimer.rebuildIfNeeded();

      // Step 3: OCR
      const textBlocks = await this.ocr.recognizeGrouped(imageBuffer);
      const tOcr = Date.now();

      if (textBlocks.length === 0) {
        console.log('[pipeline] No text blocks detected in frame');
        return;
      }

      // Step 3.5: Content stability check
      const blockTextsAll = textBlocks.map((b) => ({ text: b.text, bbox: b.bbox }));
      const stabilityThreshold = this.lockMode === 'document'
        ? DEFAULTS.DOCUMENT_STABILITY_LOCK_THRESHOLD
        : DEFAULTS.STABILITY_LOCK_THRESHOLD;
      const isContentStable = this.detector.updateContentStability(blockTextsAll, stabilityThreshold);

      if (this.lockMode === 'document' && !this.isLocked) {
        console.log(`[pipeline] Document mode: stabilityCounter=${this.detector.getStabilityCounter()}, isStable=${isContentStable}, hasResults=${this.lastEmittedResults.length > 0}`);
      }

      // Check if mode wants to lock based on content stability
      const stableResult = this.mode.handleStableContent({
        config,
        textBlocks,
        overlayItems: [],
        isContentStable,
        noNewTextCounter: this.noNewTextCounter,
        lastEmittedResults: this.lastEmittedResults,
      });

      if (this.lockMode === 'document' && isContentStable && !this.isLocked && stableResult) {
        this.isLocked = true;
        this.lockedResults = stableResult.items;
        this.lockedFrameData = this.prevFrameData;
        this.lockTimestamp = Date.now();
        this.noNewTextCounter = stableResult.noNewTextCounter;
        console.log(`[pipeline] Document mode: ${stableResult.reason}`);
        this.resultEmitter.emitResults(this.lockedResults, 0, true);
        return;
      }

      // Step 4: Filter new text blocks
      const nonFeedbackBlocks = blockTextsAll.filter(
        (t) => !this.outputTracker.has(t.text.trim()),
      );

      // Filter target-language text
      const targetLang = config.translation.targetLang;
      const sourceLang = config.translation.sourceLang;

      const sourceFilteredBlocks = nonFeedbackBlocks.filter((t) => {
        const text = t.text.trim();
        if (text.length === 0) return false;
        const detection = isTargetLanguageText(text, targetLang, sourceLang);
        if (detection.isTargetLang) {
          console.log(`[pipeline] Filtered target-lang feedback: "${text.substring(0, 40)}" (${detection.reason})`);
          return false;
        }
        return true;
      });
      const newTextBlocks = this.detector.filterNewTexts(sourceFilteredBlocks);

      const newBlockSet = new Set(newTextBlocks.map((t) => t.text));
      const filteredBlocks = textBlocks.filter((b) => newBlockSet.has(b.text));

      if (filteredBlocks.length === 0) {
        console.log('[pipeline] No new text blocks to translate');

        // Delegate to mode for no-new-text handling
        const noTextResult = this.mode.handleNoNewText({
          config,
          textBlocks,
          overlayItems: [],
          isContentStable,
          noNewTextCounter: this.noNewTextCounter,
          lastEmittedResults: this.lastEmittedResults,
        });

        this.noNewTextCounter = noTextResult.noNewTextCounter;
        this.lastEmittedResults = noTextResult.lastEmittedResults;

        if (noTextResult.shouldLock) {
          this.isLocked = true;
          this.lockedResults = noTextResult.items;
          this.lockedFrameData = this.prevFrameData;
          this.lockTimestamp = Date.now();
          console.log(`[pipeline] ${this.mode.name} mode: ${noTextResult.reason}`);
          this.resultEmitter.emitResults(this.lockedResults, 0, true);
        }
        return;
      }

      // Filter noise blocks
      const noisePatterns = [
        /^\d{1,2}:\d{2}(:\d{2})?$/,
        /^\d+(\.\d+)?%?$/,
        /^[^\w\u4e00-\u9fff]+$/,
      ];

      const meaningfulBlocks = filteredBlocks.filter((block) => {
        const cleaned = block.text.replace(/\s+/g, '').trim();
        if (cleaned.length < 3) return false;
        if (block.bbox[2] < 30) return false;
        if (noisePatterns.some((p) => p.test(block.text.trim()))) return false;
        return true;
      });

      if (meaningfulBlocks.length === 0) {
        console.log('[pipeline] All text blocks filtered out (too short/narrow/noisy)');
        return;
      }

      console.log(`[pipeline] Processing ${meaningfulBlocks.length}/${textBlocks.length} text blocks`);

      // Step 5: Translate
      const textsForTranslation = meaningfulBlocks.map((b) => ({
        text: b.text,
        bbox: b.bbox,
      }));

      const translations = await this.translator.translate(
        textsForTranslation,
        {
          sourceLang: config.translation.sourceLang,
          targetLang: config.translation.targetLang,
        },
      );
      const tTranslate = Date.now();

      // Step 6: Post-process translations and build overlay items
      const overlayItems = this.buildOverlayItems(translations, meaningfulBlocks);

      // Step 7: Emit results via mode strategy
      const validResults = overlayItems.filter((r) => r.bbox[2] > 0);
      if (validResults.length > 0) {
        const items: TranslationItem[] = validResults.map((r) => ({
          bbox: r.bbox,
          original: r.original,
          translated: r.translated,
          confidence: r.confidence,
        }));

        const modeResult = this.mode.handleNewResults({
          config,
          textBlocks,
          overlayItems: items,
          isContentStable,
          noNewTextCounter: this.noNewTextCounter,
          lastEmittedResults: this.lastEmittedResults,
        });

        if (modeResult.shouldEmit) {
          this.resultEmitter.emitResults(items, tTranslate - t0, modeResult.locked);

          for (const r of validResults) {
            this.outputTracker.add(r.translated, r.original);
          }
        }

        this.lastEmittedResults = modeResult.lastEmittedResults;
        this.noNewTextCounter = modeResult.noNewTextCounter;

        if (modeResult.shouldLock) {
          this.isLocked = true;
          this.lockedResults = modeResult.items;
          this.lockedFrameData = this.prevFrameData;
          this.lockTimestamp = Date.now();
          console.log(`[pipeline] ${this.mode.name} mode: ${modeResult.reason}`);
        }
      }

      const totalMs = tTranslate - t0;
      console.log(
        `[pipeline] Frame complete: ${totalMs}ms (capture=${tCapture - t0}ms, ocr=${tOcr - tCapture}ms, translate=${tTranslate - tOcr}ms)`,
      );
    } catch (err) {
      console.error('[pipeline] Tick error:', err);
    } finally {
      this.isProcessing = false;
    }
  }

  /**
   * Build overlay items from translations and text blocks.
   * Handles single-line and multi-line block splitting.
   */
  private buildOverlayItems(
    translations: Array<{ original: string; translated: string }>,
    meaningfulBlocks: TextBlock[],
  ): Array<{ bbox: [number, number, number, number]; original: string; translated: string; confidence: number }> {
    const overlayItems: Array<{
      bbox: [number, number, number, number];
      original: string;
      translated: string;
      confidence: number;
    }> = [];

    for (let i = 0; i < translations.length; i++) {
      const trans = translations[i];
      const block = meaningfulBlocks[i];

      // Skip identical source/target
      const origClean = trans.original.replace(/\s+/g, '').trim().toLowerCase();
      const transClean = trans.translated.replace(/\s+/g, '').trim().toLowerCase();
      if (origClean === transClean) continue;
      if (transClean.length < 2) continue;

      // Post-process: Chinese punctuation normalization
      const processedTranslation = postProcessTranslation(trans.translated);

      console.log(`[pipeline] "${trans.original.substring(0, 30)}" → "${processedTranslation.substring(0, 30)}"`);

      if (block.lines.length === 1) {
        overlayItems.push({
          bbox: block.lines[0].bbox,
          original: block.lines[0].text,
          translated: processedTranslation,
          confidence: block.lines[0].confidence,
        });
      } else {
        const originalLengths = block.lines.map((l) => l.text.length);
        const splitResults = splitTranslationToLines(processedTranslation, originalLengths);

        for (let j = 0; j < block.lines.length; j++) {
          if (splitResults[j] && splitResults[j].trim()) {
            overlayItems.push({
              bbox: block.lines[j].bbox,
              original: block.lines[j].text,
              translated: splitResults[j],
              confidence: block.lines[j].confidence,
            });
          }
        }
      }
    }

    return overlayItems;
  }

  /**
   * Terminate pipeline and cleanup resources.
   */
  async terminate(): Promise<void> {
    console.log('[pipeline] Terminating...');
    this.stop();
    await this.ocr.terminate();
    await this.translator.terminate();
    this.cache.close();
    console.log('[pipeline] Terminated');
  }

  getTranslator(): TranslatorService {
    return this.translator;
  }
}
