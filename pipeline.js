"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.Pipeline = void 0;
const protocol_1 = require("../../shared/protocol");
const target_lang_detector_1 = require("../utils/target-lang-detector");
const constants_1 = require("../../shared/constants");
const fast_levenshtein_1 = __importDefault(require("fast-levenshtein"));
const translation_postprocess_1 = require("../utils/translation-postprocess");
/**
 * Pipeline orchestrates the capture→OCR→translate→emit flow
 *
 * Responsibilities:
 * - Periodically capture screen at configured interval
 * - Detect frame changes to avoid redundant processing
 * - Perform OCR on changed frames
 * - Filter new text regions
 * - Translate new texts
 * - Emit translation results to renderer
 * - Manage pipeline lifecycle (start/stop/terminate)
 */
class Pipeline {
    constructor(capturer, ocr, translator, detector, configService, cache) {
        this.mainWindow = null;
        this.timer = null;
        this.status = 'stopped';
        this.prevFrameData = null;
        this.prevWidth = 0;
        this.isProcessing = false;
        // Track recently emitted translations to filter out overlay feedback:
        // The screen capture includes our own overlay, so OCR re-detects translated
        // text and creates a feedback loop. We skip any OCR text matching a recent output.
        this.recentOutputs = new Set();
        // Adaptive interval state
        this.consecutiveNoChange = 0;
        this.currentAdaptiveInterval = null;
        this.lastBuiltInterval = null;
        this.fastDetectionMode = false;
        this.lastChangeTimestamp = 0;
        this.fastDetectionTimer = null;
        // Lock mode state
        this.isLocked = false;
        this.lockedResults = [];
        this.lockedFrameData = null;
        this.noNewTextCounter = 0;
        this.lastEmittedResults = [];
        this.lockMode = constants_1.DEFAULTS.DEFAULT_LOCK_MODE;
        this.capturer = capturer;
        this.ocr = ocr;
        this.translator = translator;
        this.detector = detector;
        this.configService = configService;
        this.cache = cache;
        console.log('[pipeline] Initialized');
    }
    /**
     * Set the main window for IPC communication
     */
    setMainWindow(win) {
        this.mainWindow = win;
        console.log('[pipeline] Main window set');
    }
    /**
     * Get current pipeline status
     */
    getStatus() {
        return this.status;
    }
    /**
     * Update pipeline config at runtime (hot-reload).
     * Rebuilds the capture timer if interval changed.
     */
    updateConfig(config) {
        const oldInterval = this.configService.getConfig().capture.intervalIdle;
        const newInterval = config.capture.intervalIdle;
        // Persist config change (updates in-memory + writes to disk)
        this.configService.updateConfig(config);
        // Rebuild timer if interval changed and pipeline is running
        if (this.timer && newInterval !== oldInterval) {
            clearInterval(this.timer);
            this.timer = setInterval(() => {
                this.tick().catch((err) => {
                    console.error('[pipeline] Tick error:', err);
                });
            }, newInterval);
            console.log('[pipeline] Interval updated:', newInterval, 'ms');
        }
    }
    /**
     * Start the pipeline capture→OCR→translate loop
     */
    async start() {
        if (this.status === 'running') {
            console.log('[pipeline] Already running');
            return;
        }
        console.log('[pipeline] Starting...');
        // Initialize OCR engine
        try {
            await this.ocr.initialize();
        }
        catch (ocrErr) {
            console.error(`[pipeline] OCR initialization failed: ${ocrErr}`);
            // Continue without OCR — translations won't work but app stays alive
        }
        this.status = 'running';
        this.emitStatus();
        const config = this.configService.getConfig();
        const intervalMs = config.capture.intervalIdle;
        // Preload Bergamot translation model to eliminate cold-start latency
        try {
            await this.translator.preloadBergamot(config.translation);
        }
        catch (err) {
            console.warn('[pipeline] Bergamot preload failed, will lazy-load on first use:', err);
        }
        // Start periodic capture loop
        this.timer = setInterval(() => {
            this.tick().catch((err) => {
                console.error('[pipeline] Tick error:', err);
            });
        }, intervalMs);
        console.log('[pipeline] Started with interval:', intervalMs, 'ms');
    }
    /**
     * Stop the pipeline
     */
    stop() {
        if (this.timer) {
            clearInterval(this.timer);
            this.timer = null;
        }
        this.status = 'stopped';
        this.emitStatus();
        this.prevFrameData = null;
        this.isLocked = false;
        this.lockedResults = [];
        this.lockedFrameData = null;
        console.log('[pipeline] Stopped');
    }
    /**
     * Single pipeline tick: capture → detect change → OCR → filter → translate → emit
     * With lock mode: when content is stable, skip re-processing and emit locked results.
     */
    async tick() {
        // Prevent concurrent ticks (silently skip to avoid log spam)
        if (this.isProcessing) {
            return;
        }
        this.isProcessing = true;
        const t0 = Date.now();
        const config = this.configService.getConfig();
        // Read lock mode from config
        this.lockMode = config.pipeline?.lockMode ?? constants_1.DEFAULTS.DEFAULT_LOCK_MODE;
        try {
            // Step 1: Capture screen
            const imageBuffer = this.capturer.captureScreen();
            const monitorSize = this.capturer.getPrimaryMonitorSize();
            const tCapture = Date.now();
            // Step 2: Check for significant frame changes
            const frameData = new Uint8Array(imageBuffer);
            // If locked, use stricter threshold for unlocking
            const unlockThreshold = this.isLocked ? constants_1.DEFAULTS.UNLOCK_CHANGE_THRESHOLD : undefined;
            const hasChange = !this.prevFrameData || this.detector.hasSignificantChange(frameData, this.prevFrameData, monitorSize.width, this.prevWidth, unlockThreshold);
            if (!hasChange) {
                // No significant change
                this.prevFrameData = frameData;
                this.prevWidth = monitorSize.width;
                this.adaptInterval(false);
                this.rebuildTimerIfNeeded();
                // If locked, skip emission — overlay already has the results.
                // Re-emitting causes overlay to re-render, which changes pixels
                // and triggers false unlock on the next frame (feedback loop).
                // Just return; the overlay persists its DOM state between frames.
                return;
            }
            // If we were locked and now detected a big change → unlock
            if (this.isLocked) {
                console.log('[pipeline] Significant change detected, unlocking');
                this.isLocked = false;
                this.lockedResults = [];
                this.noNewTextCounter = 0;
                this.lastEmittedResults = [];
                this.detector.resetStability();
            }
            // Significant change detected, proceed with OCR
            this.prevFrameData = frameData;
            this.prevWidth = monitorSize.width;
            this.adaptInterval(true);
            this.rebuildTimerIfNeeded();
            // Step 3: Perform OCR with text grouping
            const textBlocks = await this.ocr.recognizeGrouped(imageBuffer);
            const tOcr = Date.now();
            if (textBlocks.length === 0) {
                console.log('[pipeline] No text blocks detected in frame');
                return;
            }
            // Step 3.5: Check content stability (for lock mode)
            // Track stability based on whether any meaningful new text was found
            const blockTextsAll = textBlocks.map((b) => ({ text: b.text, bbox: b.bbox }));
            // Step 4: Filter new text blocks (check text for dedup)
            // Layer 1: Filter overlay feedback — skip OCR text matching recent outputs
            const nonFeedbackBlocks = blockTextsAll.filter((t) => !this.recentOutputs.has(t.text.trim()));
            // Layer 1.5: Filter target-language text (likely from overlay feedback).
            // When translating en→zh/ja/ko, OCR may read target-language overlay text
            // as garbled text that doesn't exactly match recentOutputs. Filter by script.
            const targetLang = config.translation.targetLang;
            const sourceLang = config.translation.sourceLang;
            const sourceFilteredBlocks = nonFeedbackBlocks.filter((t) => {
                const text = t.text.trim();
                if (text.length === 0)
                    return false;
                const detection = (0, target_lang_detector_1.isTargetLanguageText)(text, targetLang, sourceLang);
                if (detection.isTargetLang) {
                    console.log(`[pipeline] Filtered target-lang feedback: "${text.substring(0, 40)}" (${detection.reason})`);
                    return false;
                }
                return true;
            });
            const newTextBlocks = this.detector.filterNewTexts(sourceFilteredBlocks);
            // Map back to TextBlock objects
            const newBlockSet = new Set(newTextBlocks.map((t) => t.text));
            const filteredBlocks = textBlocks.filter((b) => newBlockSet.has(b.text));
            if (filteredBlocks.length === 0) {
                console.log('[pipeline] No new text blocks to translate');
                if (this.lockMode === 'document') {
                    // Document mode: no new text → increment counter for lock mode
                    this.noNewTextCounter++;
                    if (this.noNewTextCounter >= constants_1.DEFAULTS.LOCK_CONSECUTIVE_FRAMES && this.lastEmittedResults.length > 0) {
                        this.isLocked = true;
                        this.lockedResults = this.lastEmittedResults;
                        this.lockedFrameData = this.prevFrameData;
                        console.log(`[pipeline] Document mode: locked after ${this.noNewTextCounter} consecutive no-new-text frames with ${this.lockedResults.length} items`);
                        this.emitResults(this.lockedResults, 0, true);
                    }
                }
                // Dynamic mode: no new text, just skip (will try again next frame)
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
                if (cleaned.length < 3)
                    return false;
                if (block.bbox[2] < 30)
                    return false;
                if (noisePatterns.some((p) => p.test(block.text.trim())))
                    return false;
                return true;
            });
            if (meaningfulBlocks.length === 0) {
                console.log('[pipeline] All text blocks filtered out (too short/narrow/noisy)');
                return;
            }
            console.log(`[pipeline] Processing ${meaningfulBlocks.length}/${textBlocks.length} text blocks`);
            // Step 5: Translate text blocks (merged text for context)
            const textsForTranslation = meaningfulBlocks.map((b) => ({
                text: b.text,
                bbox: b.bbox,
            }));
            const translations = await this.translator.translate(textsForTranslation, {
                sourceLang: config.translation.sourceLang,
                targetLang: config.translation.targetLang,
            });
            const tTranslate = Date.now();
            // Step 6: Post-process translations and split back to overlay items
            const overlayItems = [];
            for (let i = 0; i < translations.length; i++) {
                const trans = translations[i];
                const block = meaningfulBlocks[i];
                // Skip identical source/target
                const origClean = trans.original.replace(/\s+/g, '').trim().toLowerCase();
                const transClean = trans.translated.replace(/\s+/g, '').trim().toLowerCase();
                if (origClean === transClean)
                    continue;
                if (transClean.length < 2)
                    continue;
                // Post-process: Chinese punctuation normalization
                const processedTranslation = (0, translation_postprocess_1.postProcessTranslation)(trans.translated);
                console.log(`[pipeline] "${trans.original.substring(0, 30)}" → "${processedTranslation.substring(0, 30)}"`);
                if (block.lines.length === 1) {
                    // Single line block — map directly
                    overlayItems.push({
                        bbox: block.lines[0].bbox,
                        original: block.lines[0].text,
                        translated: processedTranslation,
                        confidence: block.lines[0].confidence,
                    });
                }
                else {
                    // Multi-line block — split translation back to line positions
                    const originalLengths = block.lines.map((l) => l.text.length);
                    const splitResults = (0, translation_postprocess_1.splitTranslationToLines)(processedTranslation, originalLengths);
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
            // Step 7: Emit results to renderer
            const validResults = overlayItems.filter((r) => r.bbox[2] > 0);
            if (validResults.length > 0) {
                const items = validResults.map((r) => ({
                    bbox: r.bbox,
                    original: r.original,
                    translated: r.translated,
                    confidence: r.confidence,
                }));
                // Dynamic mode: suppress re-emission if results are unchanged
                if (this.lockMode === 'dynamic' && this.lastEmittedResults.length > 0) {
                    const hasChanges = this.hasTranslationChanges(items, this.lastEmittedResults);
                    if (!hasChanges) {
                        console.log('[pipeline] Dynamic mode: results unchanged, skip emit');
                        this.noNewTextCounter = 0;
                        return;
                    }
                    console.log('[pipeline] Dynamic mode: results changed, emitting');
                }
                this.emitResults(items, tTranslate - t0, false);
                for (const r of validResults) {
                    this.recentOutputs.add(r.translated.trim());
                    this.recentOutputs.add(r.original.trim());
                }
                if (this.recentOutputs.size > 200) {
                    const entries = Array.from(this.recentOutputs);
                    this.recentOutputs = new Set(entries.slice(-150));
                }
                // Save for potential lock mode / dynamic mode comparison
                this.lastEmittedResults = items;
                this.noNewTextCounter = 0;
            }
            const totalMs = tTranslate - t0;
            console.log(`[pipeline] Frame complete: ${totalMs}ms (capture=${tCapture - t0}ms, ocr=${tOcr - tCapture}ms, translate=${tTranslate - tOcr}ms)`);
        }
        catch (err) {
            console.error('[pipeline] Tick error:', err);
        }
        finally {
            this.isProcessing = false;
        }
    }
    /**
     * Emit translation results to the renderer via IPC.
     */
    emitResults(items, processingTime, locked) {
        if (!this.mainWindow || this.mainWindow.isDestroyed())
            return;
        const frame = {
            results: items,
            timestamp: Date.now(),
            processingTime,
            locked,
        };
        this.mainWindow.webContents.send(protocol_1.IPC_CHANNELS.PIPELINE_RESULTS, frame);
        console.log(`[pipeline] Emitted ${items.length} items to renderer (locked=${locked})`);
    }
    /**
     * Emit pipeline status to renderer
     */
    emitStatus() {
        if (this.mainWindow && !this.mainWindow.isDestroyed()) {
            this.mainWindow.webContents.send(protocol_1.IPC_CHANNELS.PIPELINE_STATUS, this.status);
            console.log('[pipeline] Status emitted:', this.status);
        }
    }
    /**
     * Adapt capture interval based on screen activity.
     * - Change detected → ACTIVE (intervalActive from config)
     * - Sudden change after >15s idle → FAST_DETECTION (1000ms) for 3s
     * - 3+ consecutive no-change → IDLE (intervalIdle from config)
     * - 10+ consecutive no-change → DEEP_IDLE (6000ms)
     */
    adaptInterval(hasChange) {
        const config = this.configService.getConfig();
        const now = Date.now();
        if (hasChange) {
            // Check for sudden change after long idle
            const idleDuration = now - this.lastChangeTimestamp;
            if (idleDuration > 15000 && !this.fastDetectionMode) {
                this.fastDetectionMode = true;
                console.log('[pipeline] Fast detection mode activated');
                // Auto-exit after 3 seconds
                if (this.fastDetectionTimer)
                    clearTimeout(this.fastDetectionTimer);
                this.fastDetectionTimer = setTimeout(() => {
                    this.fastDetectionMode = false;
                    console.log('[pipeline] Fast detection mode deactivated');
                }, 3000);
            }
            this.lastChangeTimestamp = now;
            this.consecutiveNoChange = 0;
            this.currentAdaptiveInterval = this.fastDetectionMode ? 1000 : config.capture.intervalActive;
        }
        else {
            this.consecutiveNoChange++;
            if (this.consecutiveNoChange >= 10) {
                this.currentAdaptiveInterval = 6000;
            }
            else if (this.consecutiveNoChange >= 3) {
                this.currentAdaptiveInterval = config.capture.intervalIdle;
            }
            else {
                this.currentAdaptiveInterval = config.capture.intervalActive;
            }
        }
    }
    /**
     * Rebuild the capture timer if the adaptive interval has changed.
     */
    rebuildTimerIfNeeded() {
        if (this.currentAdaptiveInterval === null || !this.timer)
            return;
        // Only rebuild if interval changed by more than 100ms (avoid jitter)
        if (this.lastBuiltInterval !== null && Math.abs(this.currentAdaptiveInterval - this.lastBuiltInterval) < 100) {
            return;
        }
        this.lastBuiltInterval = this.currentAdaptiveInterval;
        // Rebuild timer with new interval
        clearInterval(this.timer);
        this.timer = setInterval(() => {
            this.tick().catch((err) => {
                console.error('[pipeline] Tick error:', err);
            });
        }, this.currentAdaptiveInterval);
        console.log(`[pipeline] Interval adapted to ${this.currentAdaptiveInterval}ms (noChange=${this.consecutiveNoChange})`);
    }
    /**
     * Terminate pipeline and cleanup resources
     */
    async terminate() {
        console.log('[pipeline] Terminating...');
        this.stop();
        await this.ocr.terminate();
        await this.translator.terminate();
        this.cache.close();
        console.log('[pipeline] Terminated');
    }
    getTranslator() {
        return this.translator;
    }
    /**
     * Compare translation results with previously emitted results using fuzzy matching.
     * Returns true if any significant change is detected (new items or changed text).
     * Used by dynamic mode to suppress re-emission of unchanged results.
     */
    hasTranslationChanges(current, previous) {
        if (previous.length === 0)
            return true;
        if (current.length !== previous.length)
            return true;
        const threshold = constants_1.DEFAULTS.DYNAMIC_SIMILARITY_THRESHOLD;
        for (let i = 0; i < current.length; i++) {
            const curr = current[i];
            const prev = previous[i];
            // Check position change (bbox must be in same grid neighborhood)
            const gridCurrX = Math.round(curr.bbox[0] / constants_1.DEFAULTS.CHANGE_DETECTOR_POSITION_GRID);
            const gridCurrY = Math.round(curr.bbox[1] / constants_1.DEFAULTS.CHANGE_DETECTOR_POSITION_GRID);
            const gridPrevX = Math.round(prev.bbox[0] / constants_1.DEFAULTS.CHANGE_DETECTOR_POSITION_GRID);
            const gridPrevY = Math.round(prev.bbox[1] / constants_1.DEFAULTS.CHANGE_DETECTOR_POSITION_GRID);
            if (Math.abs(gridCurrX - gridPrevX) > 2 || Math.abs(gridCurrY - gridPrevY) > 2) {
                return true; // Position changed significantly
            }
            // Check original text similarity
            const origSimilarity = this.textSimilarity(curr.original, prev.original);
            if (origSimilarity < threshold)
                return true;
            // Check translated text similarity
            const transSimilarity = this.textSimilarity(curr.translated, prev.translated);
            if (transSimilarity < threshold)
                return true;
        }
        return false;
    }
    /**
     * Compute Levenshtein similarity ratio between two strings.
     */
    textSimilarity(a, b) {
        const maxLen = Math.max(a.length, b.length);
        if (maxLen === 0)
            return 1.0;
        return 1 - fast_levenshtein_1.default.get(a, b) / maxLen;
    }
}
exports.Pipeline = Pipeline;
//# sourceMappingURL=pipeline.js.map