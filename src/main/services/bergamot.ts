import { Worker } from 'node:worker_threads';
import * as path from 'path';
import * as fs from 'fs';
import { app } from 'electron';
import { BergamotStatus } from '../../shared/types';

/**
 * Bergamot offline translation service.
 *
 * Directly manages the bergamot WASM worker thread via Node.js worker_threads.
 * Loads intgemm-quantized Marian NMT models from local filesystem (no network needed).
 *
 * Model files sourced from:
 * https://storage.googleapis.com/moz-fx-translations-data--303e-prod-translations-data/db/models.json
 *
 * Supported language pairs: en↔zh (Simplified Chinese)
 */
export class BergamotService {
  private status: BergamotStatus = 'uninitialized';
  private currentFromLang: string | null = null;
  private currentToLang: string | null = null;
  private modelDir: string;
  private worker: Worker | null = null;
  private serial = 0;
  private pending = new Map<number, { resolve: (value: unknown) => void; reject: (reason: unknown) => void }>();
  private pendingInit: Promise<void> | null = null;
  private workerReady = false;
  // Store quality scores from last batch translation, keyed by input text
  private lastQualityScores = new Map<string, number>();

  constructor(modelDirOverride?: string) {
    if (app.isPackaged) {
      // In packaged mode: resolve relative paths against process.resourcesPath
      if (modelDirOverride && !path.isAbsolute(modelDirOverride)) {
        this.modelDir = path.join(process.resourcesPath, modelDirOverride);
      } else {
        this.modelDir = modelDirOverride ?? path.join(process.resourcesPath, 'bergamot-models');
      }
    } else {
      // In dev: resolve relative paths against project root
      if (modelDirOverride && !path.isAbsolute(modelDirOverride)) {
        this.modelDir = path.join(__dirname, '..', '..', '..', modelDirOverride);
      } else {
        this.modelDir = modelDirOverride ?? path.join(__dirname, '..', '..', '..', 'bergamot-models');
      }
    }
    console.log(`[bergamot] Model dir: ${this.modelDir}, exists: ${fs.existsSync(this.modelDir)}`);
  }

  getStatus(): BergamotStatus {
    return this.status;
  }

  /**
   * Translate text using bergamot WASM engine.
   * Lazy-initializes the worker and model on first call.
   */
  async translate(text: string, from: string, to: string): Promise<string> {
    // Map language codes: zh-CN/zh-TW → zh
    const normalizedFrom = from.startsWith('zh') ? 'zh' : from;
    const normalizedTo = to.startsWith('zh') ? 'zh' : to;

    if (normalizedFrom === normalizedTo) return text;

    // Reinitialize if language pair changed
    if (this.currentFromLang && (this.currentFromLang !== normalizedFrom || this.currentToLang !== normalizedTo)) {
      console.log(`[bergamot] Language pair changed: ${this.currentFromLang}-${this.currentToLang} → ${normalizedFrom}-${normalizedTo}`);
      await this.terminate();
    }

    await this.ensureInitialized(normalizedFrom, normalizedTo);

    console.log(`[bergamot] Translating: "${text.substring(0, 50)}" (${normalizedFrom}→${normalizedTo})`);
    const t0 = Date.now();

    const responses = await this.callWorker('translate', {
      models: [{ from: normalizedFrom, to: normalizedTo }],
      texts: [{ text, html: false, qualityScores: true }],
    }) as Array<{ target: { text: string; qualityScores?: number[] } }> | null;

    const translated = responses?.[0]?.target?.text ?? text;
    const qualityScores = responses?.[0]?.target?.qualityScores;
    if (qualityScores) {
      console.log(`[bergamot] Quality scores: ${JSON.stringify(qualityScores)}`);
    }
    console.log(`[bergamot] Translated (${Date.now() - t0}ms): "${translated.substring(0, 50)}"`);
    return translated.trim();
  }

  /**
   * Translate multiple texts in a single WASM call.
   * Bergamot worker natively supports arrays in the texts parameter.
   * Returns translations in the same order as input.
   */
  async translateBatch(texts: string[], from: string, to: string): Promise<string[]> {
    const normalizedFrom = from.startsWith('zh') ? 'zh' : from;
    const normalizedTo = to.startsWith('zh') ? 'zh' : to;

    if (normalizedFrom === normalizedTo) return texts;
    if (texts.length === 0) return [];

    // Reinitialize if language pair changed
    if (this.currentFromLang && (this.currentFromLang !== normalizedFrom || this.currentToLang !== normalizedTo)) {
      console.log(`[bergamot] Language pair changed: ${this.currentFromLang}-${this.currentToLang} → ${normalizedFrom}-${normalizedTo}`);
      await this.terminate();
    }

    await this.ensureInitialized(normalizedFrom, normalizedTo);

    console.log(`[bergamot] Batch translating ${texts.length} texts (${normalizedFrom}→${normalizedTo})`);
    const t0 = Date.now();

    const responses = await this.callWorker('translate', {
      models: [{ from: normalizedFrom, to: normalizedTo }],
      texts: texts.map(t => ({ text: t, html: false, qualityScores: true })),
    }) as Array<{ target: { text: string; qualityScores?: number[] } }> | null;

    const results = responses?.map(r => r.target.text.trim()) ?? texts;

    // Store quality scores from this batch
    this.lastQualityScores.clear();
    if (responses) {
      for (let i = 0; i < responses.length; i++) {
        const qs = responses[i]?.target?.qualityScores;
        if (qs && qs.length > 0) {
          // Average quality score for this translation
          const avgScore = qs.reduce((a, b) => a + b, 0) / qs.length;
          this.lastQualityScores.set(texts[i], avgScore);
          console.log(`[bergamot] Quality score [${i}]: ${avgScore.toFixed(3)} (${qs.length} segments)`);
        }
      }
    }

    console.log(`[bergamot] Batch translated ${texts.length} texts in ${Date.now() - t0}ms`);
    return results;
  }

  /**
   * Get the quality score for a specific text from the last batch translation.
   * Returns undefined if no quality score is available.
   */
  getQualityScore(text: string): number | undefined {
    return this.lastQualityScores.get(text);
  }

  /**
   * Ensure worker is initialized and the correct model is loaded.
   * Coalesces concurrent init calls into a single init.
   */
  private async ensureInitialized(from: string, to: string): Promise<void> {
    if (this.workerReady && this.currentFromLang === from && this.currentToLang === to) return;

    if (this.pendingInit) {
      await this.pendingInit;
      return;
    }

    this.pendingInit = this.doInitialize(from, to);
    try {
      await this.pendingInit;
    } finally {
      this.pendingInit = null;
    }
  }

  /**
   * Create worker, initialize WASM, load model from local filesystem.
   */
  private async doInitialize(from: string, to: string): Promise<void> {
    this.setStatus('loading');
    this.currentFromLang = from;
    this.currentToLang = to;

    try {
      // Step 1: Create worker thread
      const workerPath = this.resolveWorkerPath();
      const workerDir = path.dirname(workerPath);
      const wasmFile = path.join(workerDir, 'bergamot-translator-worker.wasm');
      console.log(`[bergamot] Creating worker: ${workerPath}, exists: ${fs.existsSync(workerPath)}`);
      console.log(`[bergamot] WASM file: ${wasmFile}, exists: ${fs.existsSync(wasmFile)}`);
      console.log(`[bergamot] Worker dir contents: ${fs.readdirSync(workerDir).join(', ')}`);

      this.worker = new Worker(workerPath, { stdout: true, stderr: true });
      // Capture worker stdout/stderr for debugging WASM loading issues
      this.worker.stdout?.on('data', (data: Buffer) => {
        console.log(`[bergamot:worker:stdout] ${data.toString().trim()}`);
      });
      this.worker.stderr?.on('data', (data: Buffer) => {
        console.error(`[bergamot:worker:stderr] ${data.toString().trim()}`);
      });
      this.setupWorkerListeners();

      // Step 2: Initialize WASM runtime
      await this.callWorker('initialize', { cacheSize: 0 });
      console.log('[bergamot] WASM runtime initialized');

      // Step 3: Load model from local filesystem
      const dir = from === 'en' ? 'enzh' : 'zhen';
      const buffers = this.loadLocalModelBuffers(dir);
      await this.callWorker('loadTranslationModel', { from, to }, buffers);
      console.log(`[bergamot] Model ${dir} loaded into worker`);

      this.workerReady = true;
      this.setStatus('ready');
      console.log(`[bergamot] Ready for ${from}→${to}`);
    } catch (err: any) {
      this.setStatus('error');
      const errDetail = err?.message ?? err?.stack ?? String(err);
      console.error(`[bergamot] Initialization failed: ${errDetail}`);
      console.error(`[bergamot] Error object keys: ${Object.keys(err ?? {}).join(',')}`);
      console.error(`[bergamot] Error type: ${typeof err}, constructor: ${err?.constructor?.name}`);
      // Cleanup on failure
      this.destroyWorker();
      throw err;
    }
  }

  /**
   * Resolve translator-worker path.
   * Uses .cjs copy to avoid ESM/CJS conflict (package.json has "type": "module").
   * In packaged app: resources directory.
   * In dev: node_modules.
   */
  private resolveWorkerPath(): string {
    // Try node_modules first (works in both dev and packaged if unpacked)
    try {
      const pkgJsonPath = require.resolve('@mkljczk/bergamot-translator/package.json');
      let workerDir = path.join(path.dirname(pkgJsonPath), 'worker');

      // CRITICAL: Node.js Worker threads cannot load from asar archives.
      // Electron's require.resolve() transparently handles asar paths, but
      // Worker threads don't. Must redirect to the unpacked directory.
      if (app.isPackaged && workerDir.includes('app.asar')) {
        workerDir = workerDir.replace('app.asar', 'app.asar.unpacked');
      }

      // Prefer .cjs version to avoid ESM require error
      const cjsPath = path.join(workerDir, 'translator-worker.cjs');
      if (fs.existsSync(cjsPath)) return cjsPath;
      // Fallback to original .js
      return path.join(workerDir, 'translator-worker.js');
    } catch {
      // Fallback: relative to dist
      let fallbackPath = path.join(__dirname, '..', '..', '..', 'node_modules', '@mkljczk', 'bergamot-translator', 'worker', 'translator-worker.cjs');
      if (app.isPackaged && fallbackPath.includes('app.asar')) {
        fallbackPath = fallbackPath.replace('app.asar', 'app.asar.unpacked');
      }
      return fallbackPath;
    }
  }

  /**
   * Setup message listener on worker thread.
   */
  private setupWorkerListeners(): void {
    if (!this.worker) return;

    this.worker.on('message', (data: { id: number; result?: unknown; error?: { name?: string; message?: string; stack?: string } }) => {
      const { id, result, error } = data;
      if (!this.pending.has(id)) {
        console.warn(`[bergamot] Received response for unknown id: ${id}`);
        return;
      }
      const { resolve, reject } = this.pending.get(id)!;
      this.pending.delete(id);

      if (error) {
        const err = new Error(error.message ?? 'Unknown worker error');
        err.stack = error.stack;
        reject(err);
      } else {
        resolve(result);
      }
    });

    this.worker.on('error', (err: unknown) => {
      const e = err as Error;
      console.error(`[bergamot] Worker error: ${e?.message}, code: ${(e as any)?.code}`);
      console.error(`[bergamot] Worker error stack: ${e?.stack}`);
      // Reject all pending requests
      for (const [id, { reject }] of this.pending) {
        reject(err);
      }
      this.pending.clear();
      this.setStatus('error');
    });

    this.worker.on('exit', (code) => {
      console.log(`[bergamot] Worker exited with code: ${code}`);
      // Reject all pending requests
      for (const [id, { reject }] of this.pending) {
        reject(new Error(`Worker exited with code ${code}`));
      }
      this.pending.clear();
      this.worker = null;
      this.workerReady = false;
    });
  }

  /**
   * Send a command to the worker and await the response.
   * Uses the same message protocol as bergamot's Web Worker interface.
   */
  private callWorker(method: string, ...args: unknown[]): Promise<unknown> {
    return new Promise((resolve, reject) => {
      if (!this.worker) {
        reject(new Error('[bergamot] Worker not created'));
        return;
      }
      const id = ++this.serial;
      this.pending.set(id, { resolve, reject });
      this.worker.postMessage({ id, name: method, args });
    });
  }

  /**
   * Read model files from local filesystem into ArrayBuffers.
   */
  private loadLocalModelBuffers(dir: 'enzh' | 'zhen'): {
    model: ArrayBuffer;
    shortlist: ArrayBuffer;
    vocabs: ArrayBuffer[];
  } {
    const modelPath = path.join(this.modelDir, dir);
    console.log(`[bergamot] Loading local model from: ${modelPath}`);

    if (!fs.existsSync(modelPath)) {
      throw new Error(`[bergamot] Model directory not found: ${modelPath}`);
    }

    const model = this.readFileAsArrayBuffer(path.join(modelPath, `model.${dir}.intgemm.alphas.bin`));
    const shortlist = this.readFileAsArrayBuffer(path.join(modelPath, `lex.50.50.${dir}.s2t.bin`));

    let vocabs: ArrayBuffer[];
    if (dir === 'enzh') {
      vocabs = [
        this.readFileAsArrayBuffer(path.join(modelPath, 'srcvocab.enzh.spm')),
        this.readFileAsArrayBuffer(path.join(modelPath, 'trgvocab.enzh.spm')),
      ];
    } else {
      // zhen uses shared vocab
      vocabs = [
        this.readFileAsArrayBuffer(path.join(modelPath, 'vocab.zhen.spm')),
      ];
    }

    console.log(`[bergamot] Model loaded: ${model.byteLength}b model, ${shortlist.byteLength}b lex, ${vocabs.length} vocab(s)`);
    return { model, shortlist, vocabs };
  }

  /**
   * Read a file and return its contents as an ArrayBuffer.
   * Handles Node.js Buffer → ArrayBuffer conversion correctly.
   */
  private readFileAsArrayBuffer(filePath: string): ArrayBuffer {
    const buf = fs.readFileSync(filePath);
    // Node.js Buffer may share an underlying ArrayBuffer that is larger.
    // Slice to get the exact portion.
    return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  }

  /**
   * Terminate worker and reset state.
   */
  async terminate(): Promise<void> {
    this.destroyWorker();
    this.currentFromLang = null;
    this.currentToLang = null;
    this.workerReady = false;
    this.setStatus('uninitialized');
    console.log('[bergamot] Terminated');
  }

  private destroyWorker(): void {
    if (this.worker) {
      try {
        this.worker.terminate();
      } catch (_) { /* ignore */ }
      this.worker = null;
    }
    // Reject all pending requests
    for (const [id, { reject }] of this.pending) {
      reject(new Error('[bergamot] Worker terminated'));
    }
    this.pending.clear();
    this.workerReady = false;
  }

  private setStatus(status: BergamotStatus): void {
    this.status = status;
    console.log(`[bergamot] Status: ${status}`);
  }
}
