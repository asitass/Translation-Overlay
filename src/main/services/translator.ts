import { translate } from '@vitalets/google-translate-api';
import * as https from 'https';
import { TranslationCache } from './cache';
import { BergamotService } from './bergamot';
import { TranslationConfig, TranslationResult, TranslateOptions, BergamotStatus } from '../../shared/types';

// Proxy configuration: set global HTTPS agent for node-fetch if proxy is configured
const PROXY_URL = process.env.HTTPS_PROXY || process.env.https_proxy || process.env.HTTP_PROXY || process.env.http_proxy || null;
if (PROXY_URL) {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { HttpsProxyAgent } = require('https-proxy-agent');
    const agent = new HttpsProxyAgent(PROXY_URL);
    // Override default agent for all HTTPS requests (affects node-fetch)
    (https.globalAgent as any) = agent;
    console.log(`[translator] Global HTTPS proxy set: ${PROXY_URL}`);
  } catch (err) {
    console.warn(`[translator] Failed to set proxy: ${err}`);
  }
}

interface TextItem {
  text: string;
  bbox: [number, number, number, number];
}

export class TranslatorService {
  private config: TranslationConfig;
  private cache: TranslationCache;
  private lastRequestTime = 0;
  private minRequestInterval = 500; // Min 500ms between requests to avoid 429
  private backoffUntil = 0; // Timestamp until which we back off
  private consecutiveErrors = 0;
  private bergamotService: BergamotService | null = null;
  // Store quality scores from last bergamot batch
  private lastBergamotScores = new Map<string, number>();

  constructor(config: TranslationConfig, cache: TranslationCache) {
    this.config = config;
    this.cache = cache;
    console.log(`[translator] Initialized (primary=${config.primary}, fallback=${config.fallback})`);
  }

  updateConfig(config: TranslationConfig): void {
    this.config = config;
    console.log(`[translator] Config updated (primary=${config.primary})`);
  }

  /**
   * Preload Bergamot model to eliminate cold-start latency on first translation.
   * Safe to call — failure is caught and falls back to lazy loading.
   */
  async preloadBergamot(config: TranslationConfig): Promise<void> {
    if (config.primary === 'bergamot' || config.fallback === 'bergamot') {
      try {
        if (!this.bergamotService) {
          this.bergamotService = new BergamotService(config.bergamot?.modelDir);
        }
        // Trigger model loading with a dummy translation
        const src = config.sourceLang === 'auto' ? 'en' : config.sourceLang;
        const tgt = config.targetLang;
        await this.bergamotService.translate('test', src, tgt);
        console.log('[translator] Bergamot preloaded successfully');
      } catch (err) {
        console.warn('[translator] Bergamot preload failed, will lazy-load on first use:', err);
      }
    }
  }

  detectLanguage(text: string): string {
    let cjkCount = 0;
    let latinCount = 0;
    for (const ch of text) {
      const cp = ch.codePointAt(0)!;
      if (
        (0x4e00 <= cp && cp <= 0x9fff) ||
        (0x3400 <= cp && cp <= 0x4dbf) ||
        (0x3000 <= cp && cp <= 0x303f)
      ) {
        cjkCount++;
      } else if (0x0041 <= cp && cp <= 0x024f) {
        latinCount++;
      }
    }
    return cjkCount > latinCount ? 'zh' : 'en';
  }

  async translate(
    items: TextItem[],
    options: TranslateOptions,
  ): Promise<TranslationResult[]> {
    if (items.length === 0) return [];

    const targetLang = options.targetLang;
    const results: TranslationResult[] = [];

    // Phase 1: Classify texts (language detection + skip same-language)
    type ItemWithMeta = { item: TextItem; detected: string; skip: boolean };
    const classified: ItemWithMeta[] = items.map((item) => {
      const text = item.text;
      if (!text.trim()) return { item, detected: '', skip: true };
      const detected = options.sourceLang === 'auto'
        ? this.detectLanguage(text)
        : options.sourceLang;
      // Skip if source and target are the same language
      if (detected.startsWith('zh') && targetLang.startsWith('zh')) return { item, detected, skip: true };
      if (detected === 'en' && targetLang === 'en') return { item, detected, skip: true };
      return { item, detected, skip: false };
    });

    // Phase 2: Bulk cache lookup for all non-skipped texts
    const nonSkipped = classified.filter((c) => !c.skip);
    const textsToLookup = nonSkipped.map((c) => c.item.text);

    let cachedResults: Record<string, string> = {};
    let uncachedItems: ItemWithMeta[] = [];

    if (textsToLookup.length > 0) {
      cachedResults = this.cache.bulkGet(
        textsToLookup,
        nonSkipped[0].detected,
        targetLang,
      );

      // Separate cached from uncached
      for (const c of nonSkipped) {
        const cached = cachedResults[c.item.text];
        if (cached && cached !== c.item.text) {
          results.push({
            original: c.item.text,
            translated: cached,
            sourceLang: c.detected,
            targetLang,
            engine: 'cache',
            cached: true,
          });
        } else {
          // TODO: Fuzzy cache lookup disabled — OCR text quality is too low
          // for reliable trigram matching. Re-enable after implementing
          // source text quality pre-filter or semantic similarity check.
          uncachedItems.push(c);
        }
      }
    }

    if (uncachedItems.length === 0) {
      return results;
    }

    // Phase 3: Batch translate uncached texts
    const engine = options.engine ?? this.config.primary;
    const uncachedTexts = uncachedItems.map((c) => c.item.text);
    const srcLang = uncachedItems[0].detected;

    // Check backoff before attempting batch
    if (Date.now() < this.backoffUntil) {
      console.log(`[translator] Skipping batch due to backoff (${Math.round((this.backoffUntil - Date.now()) / 1000)}s remaining)`);
      for (const c of uncachedItems) {
        results.push({
          original: c.item.text,
          translated: c.item.text,
          sourceLang: c.detected,
          targetLang,
          engine: 'none',
          cached: false,
        });
      }
      return results;
    }

    // Wait for rate limit (applies per-batch now, not per-text)
    await this.waitForRateLimit();

    // Try batch translation with primary engine
    const batchResult = await this.tryEngineBatch(engine, uncachedTexts, srcLang, targetLang);

    if (batchResult && batchResult.length === uncachedTexts.length) {
      // Success — cache all results
      this.consecutiveErrors = 0;
      const cacheEntries: Array<{ text: string; sourceLang: string; targetLang: string; translation: string }> = [];

      // Check quality scores for bergamot results — retry low-confidence items with fallback
      const lowConfidenceIndices: number[] = [];
      if (engine === 'bergamot') {
        for (let i = 0; i < batchResult.length; i++) {
          const score = this.lastBergamotScores.get(uncachedTexts[i]);
          if (score !== undefined && score < 0.3 && batchResult[i] !== uncachedTexts[i]) {
            console.warn(`[translator] Low confidence (${score.toFixed(3)}) for "${uncachedTexts[i].substring(0, 30)}", will retry with fallback`);
            lowConfidenceIndices.push(i);
          }
        }
      }

      // Retry low-confidence items with fallback engine
      if (lowConfidenceIndices.length > 0 && this.config.fallback && this.config.fallback !== engine) {
        const retryTexts = lowConfidenceIndices.map(i => uncachedTexts[i]);
        const retryResult = await this.tryEngineBatch(this.config.fallback, retryTexts, srcLang, targetLang);
        if (retryResult && retryResult.length === retryTexts.length) {
          for (let j = 0; j < lowConfidenceIndices.length; j++) {
            const origIdx = lowConfidenceIndices[j];
            batchResult[origIdx] = retryResult[j];
            console.log(`[translator] Fallback improved: "${uncachedTexts[origIdx].substring(0, 30)}" → "${retryResult[j].substring(0, 30)}"`);
          }
        }
      }

      for (let i = 0; i < batchResult.length; i++) {
        if (batchResult[i] !== uncachedTexts[i]) {
          cacheEntries.push({
            text: uncachedTexts[i],
            sourceLang: srcLang,
            targetLang,
            translation: batchResult[i],
          });
        }
        const score = engine === 'bergamot' ? this.lastBergamotScores.get(uncachedTexts[i]) : undefined;
        results.push({
          original: uncachedTexts[i],
          translated: batchResult[i],
          sourceLang: srcLang,
          targetLang,
          engine,
          cached: false,
          qualityScore: score,
        });
      }
      if (cacheEntries.length > 0) {
        this.cache.putBatch(cacheEntries);
      }
    } else {
      // Primary engine failed, try fallback engine batch
      const fallbackResult = await this.tryEngineBatch(
        this.config.fallback,
        uncachedTexts,
        srcLang,
        targetLang,
      );

      if (fallbackResult && fallbackResult.length === uncachedTexts.length) {
        this.consecutiveErrors = 0;
        const cacheEntries: Array<{ text: string; sourceLang: string; targetLang: string; translation: string }> = [];
        for (let i = 0; i < fallbackResult.length; i++) {
          if (fallbackResult[i] !== uncachedTexts[i]) {
            cacheEntries.push({
              text: uncachedTexts[i],
              sourceLang: srcLang,
              targetLang,
              translation: fallbackResult[i],
            });
          }
          results.push({
            original: uncachedTexts[i],
            translated: fallbackResult[i],
            sourceLang: srcLang,
            targetLang,
            engine: this.config.fallback,
            cached: false,
          });
        }
        if (cacheEntries.length > 0) {
          this.cache.putBatch(cacheEntries);
        }
      } else {
        // All engines failed — return original text
        for (const c of uncachedItems) {
          results.push({
            original: c.item.text,
            translated: c.item.text,
            sourceLang: c.detected,
            targetLang,
            engine: 'none',
            cached: false,
          });
        }
      }
    }

    return results;
  }

  private async waitForRateLimit(): Promise<void> {
    const now = Date.now();
    const elapsed = now - this.lastRequestTime;
    if (elapsed < this.minRequestInterval) {
      const delay = this.minRequestInterval - elapsed;
      await new Promise(resolve => setTimeout(resolve, delay));
    }
    this.lastRequestTime = Date.now();
  }

  /**
   * Try batch translation with a specific engine.
   * Returns array of translations in same order as input, or null on failure.
   */
  private async tryEngineBatch(
    engine: string,
    texts: string[],
    src: string,
    tgt: string,
  ): Promise<string[] | null> {
    try {
      switch (engine) {
        case 'bergamot':
          return await this.callBergamotBatch(texts, src, tgt);
        case 'google':
          return await this.callGoogleBatch(texts, src, tgt);
        case 'ollama':
          // Ollama doesn't support batch — translate individually
          return await this.callSequential(texts, src, tgt, 'ollama');
        case 'deepl':
          return await this.callDeepLBatch(texts, src, tgt);
        default:
          console.warn(`[translator] Unknown engine for batch: ${engine}`);
          return null;
      }
    } catch (err: unknown) {
      this.consecutiveErrors++;
      const errMsg = (err as Error)?.message || String(err);

      if (errMsg.includes('429') || errMsg.includes('rate') || errMsg.includes('Too Many')) {
        const backoffSeconds = Math.min(30, 5 * Math.pow(2, this.consecutiveErrors - 1));
        this.backoffUntil = Date.now() + backoffSeconds * 1000;
        console.warn(`[translator] Rate limited (429). Backing off for ${backoffSeconds}s.`);
      } else if (errMsg.includes('ETIMEDOUT') || errMsg.includes('ECONNREFUSED')) {
        const backoffSeconds = Math.min(15, 3 * this.consecutiveErrors);
        this.backoffUntil = Date.now() + backoffSeconds * 1000;
        console.warn(`[translator] Network error. Backing off for ${backoffSeconds}s.`);
      }

      console.error(`[translator] Batch engine ${engine} failed:`, err);
      return null;
    }
  }

  private async callBergamotBatch(texts: string[], src: string, tgt: string): Promise<string[]> {
    if (!this.bergamotService) {
      this.bergamotService = new BergamotService(this.config.bergamot?.modelDir);
    }
    const results = await this.bergamotService.translateBatch(texts, src, tgt);

    // Propagate quality scores to translation results
    for (let i = 0; i < texts.length; i++) {
      const score = this.bergamotService.getQualityScore(texts[i]);
      if (score !== undefined) {
        // Store for later retrieval by pipeline
        this.lastBergamotScores.set(texts[i], score);
      }
    }

    return results;
  }

  private async callGoogleBatch(texts: string[], src: string, tgt: string): Promise<string[]> {
    console.log(`[translator] Google batch translate: ${texts.length} texts (${src}→${tgt})`);

    try {
      return await this.callGoogleElectronNetBatch(texts, src, tgt);
    } catch (err: unknown) {
      if ((err as Error).message?.includes('429')) {
        throw err;
      }
      console.warn(`[translator] Google batch failed (${(err as Error).message}), falling back to sequential`);
      return await this.callSequential(texts, src, tgt, 'google');
    }
  }

  private async callGoogleElectronNetBatch(texts: string[], src: string, tgt: string): Promise<string[]> {
    const { net } = require('electron');
    const params = new URLSearchParams();
    params.set('client', 'at');
    params.append('dt', 't');
    params.set('dj', '1');
    params.set('sl', src === 'auto' ? 'auto' : src);
    params.set('tl', tgt);
    for (const text of texts) {
      params.append('q', text);
    }

    const url = `https://translate.google.com/translate_a/single?${params.toString()}`;
    const resp = await net.fetch(url, {
      method: 'GET',
      headers: { 'User-Agent': 'Mozilla/5.0' },
    });

    if (!resp.ok) {
      throw new Error(`Google Translate HTTP ${resp.status}`);
    }

    const data = await resp.json();
    let translations: string[] = [];
    if (data.sentences && Array.isArray(data.sentences)) {
      translations = data.sentences.map((s: { trans?: string }) => s.trans || '');
    } else if (Array.isArray(data[0])) {
      translations = (data[0] as unknown[][]).map((segment) => (segment[0] as string) || '');
    }

    if (translations.length !== texts.length) {
      console.warn(`[translator] Google batch returned ${translations.length}/${texts.length} translations, falling back`);
      throw new Error('Batch response length mismatch');
    }

    console.log(`[translator] Google batch translated ${texts.length} texts`);
    return translations.map((t: string) => t.trim());
  }

  private async callDeepLBatch(texts: string[], src: string, tgt: string): Promise<string[]> {
    const cfg = this.config.deepl;
    if (!cfg?.apiKey) throw new Error('DeepL API key not configured');
    const baseUrl = cfg.freeApi
      ? 'https://api-free.deepl.com/v2/translate'
      : 'https://api.deepl.com/v2/translate';
    const params = new URLSearchParams();
    params.set('auth_key', cfg.apiKey);
    for (const text of texts) {
      params.append('text', text);
    }
    params.set('target_lang', tgt.toUpperCase());
    if (src !== 'auto') params.set('source_lang', src.toUpperCase());
    const resp = await fetch(baseUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString(),
    });
    if (!resp.ok) throw new Error(`DeepL HTTP ${resp.status}`);
    const data = (await resp.json()) as { translations: Array<{ text: string }> };
    return data.translations.map((t) => t.text);
  }

  /**
   * Fallback: translate texts sequentially when batch isn't supported.
   */
  private async callSequential(texts: string[], src: string, tgt: string, engine: string): Promise<string[]> {
    const results: string[] = [];
    for (const text of texts) {
      const translated = await this.tryEngine(engine, text, src, tgt);
      results.push(translated ?? text);
    }
    return results;
  }

  private async tryEngine(
    engine: string,
    text: string,
    src: string,
    tgt: string,
  ): Promise<string | null> {
    try {
      switch (engine) {
        case 'google':
          return await this.callGoogle(text, src, tgt);
        case 'ollama':
          return await this.callOllama(text, tgt);
        case 'deepl':
          return await this.callDeepL(text, src, tgt);
        case 'bergamot':
          return await this.callBergamot(text, src, tgt);
        default:
          console.warn(`[translator] Unknown engine: ${engine}`);
          return null;
      }
    } catch (err: any) {
      this.consecutiveErrors++;
      const errMsg = err?.message || String(err);

      // Exponential backoff on 429 or rate limit errors
      if (errMsg.includes('429') || errMsg.includes('rate') || errMsg.includes('Too Many')) {
        const backoffSeconds = Math.min(30, 5 * Math.pow(2, this.consecutiveErrors - 1));
        this.backoffUntil = Date.now() + backoffSeconds * 1000;
        console.warn(`[translator] Rate limited (429). Backing off for ${backoffSeconds}s. Consecutive errors: ${this.consecutiveErrors}`);
      } else if (errMsg.includes('ETIMEDOUT') || errMsg.includes('ECONNREFUSED')) {
        // Network error - shorter backoff
        const backoffSeconds = Math.min(15, 3 * this.consecutiveErrors);
        this.backoffUntil = Date.now() + backoffSeconds * 1000;
        console.warn(`[translator] Network error. Backing off for ${backoffSeconds}s. Consecutive errors: ${this.consecutiveErrors}`);
      }

      console.error(`[translator] Engine ${engine} failed:`, err);
      return null;
    }
  }

  private async callGoogle(text: string, src: string, tgt: string): Promise<string> {
    console.log(`[translator] Google translate: "${text.substring(0, 50)}" (${src}→${tgt})`);

    // Use Electron's net.fetch which respects session proxy settings
    try {
      return await this.callGoogleElectronNet(text, src, tgt);
    } catch (err: any) {
      // Don't retry on 429 (rate limit) — throw immediately for backoff handling
      if (err.message?.includes('429')) {
        console.warn(`[translator] Google Translate rate limited (429), skipping node-fetch fallback`);
        throw err;
      }
      console.warn(`[translator] Electron net.fetch failed (${err.message}), trying node-fetch...`);
    }

    // Fallback to node-fetch based translate library
    try {
      const result = await translate(text, {
        from: src === 'auto' ? 'auto' : src,
        to: tgt,
      });
      return result.text.trim();
    } catch (err: any) {
      console.warn(`[translator] node-fetch also failed: ${err.message}`);
      throw err;
    }
  }

  /**
   * Google Translate via Electron's net.fetch - uses Chromium network stack
   * which properly handles system proxy settings
   */
  private async callGoogleElectronNet(text: string, src: string, tgt: string): Promise<string> {
    const { net } = require('electron');
    const params = new URLSearchParams();
    params.set('client', 'at');
    params.append('dt', 't');
    params.append('dt', 'rm');
    params.set('dj', '1');
    params.set('sl', src === 'auto' ? 'auto' : src);
    params.set('tl', tgt);
    params.set('q', text);

    const url = `https://translate.google.com/translate_a/single?${params.toString()}`;
    const resp = await net.fetch(url, {
      method: 'GET',
      headers: { 'User-Agent': 'Mozilla/5.0' },
    });

    if (!resp.ok) {
      throw new Error(`Google Translate HTTP ${resp.status}`);
    }

    const data = await resp.json();
    let translated = '';
    if (data.sentences && Array.isArray(data.sentences)) {
      translated = data.sentences.map((s: any) => s.trans || '').join('');
    } else if (Array.isArray(data[0])) {
      translated = data[0].map((segment: any[]) => segment[0] || '').join('');
    }

    if (!translated) {
      console.warn(`[translator] No translation extracted from Electron net response`);
      translated = text;
    }

    console.log(`[translator] Translated via Electron net: "${text.substring(0, 30)}" → "${translated.substring(0, 30)}"`);
    return translated.trim();
  }

  /**
   * Manual Google Translate via HTTPS proxy using CONNECT tunnel
   * Fallback when node-fetch agent doesn't work with the proxy
   */
  private async callGoogleManualProxy(text: string, src: string, tgt: string): Promise<string> {
    const { HttpsProxyAgent } = require('https-proxy-agent');
    const https = require('https');
    const agent = new HttpsProxyAgent(PROXY_URL);

    const params = new URLSearchParams();
    params.set('client', 'at');
    params.append('dt', 't');
    params.append('dt', 'rm');
    params.set('dj', '1');
    params.set('sl', src === 'auto' ? 'auto' : src);
    params.set('tl', tgt);
    params.set('q', text);

    const url = `https://translate.google.com/translate_a/single?${params.toString()}`;

    return new Promise((resolve, reject) => {
      const req = https.get(url, { agent }, (res: any) => {
        let data = '';
        res.on('data', (chunk: string) => { data += chunk; });
        res.on('end', () => {
          try {
            console.log(`[translator] Google proxy response status: ${res.statusCode}, body length: ${data.length}`);
            console.log(`[translator] Google proxy response preview: ${data.substring(0, 300)}`);
            const json = JSON.parse(data);
            // Google Translate API response format:
            // json[0] is an array of [translated_line, original_line, ...]
            // or json.sentences[].trans for dj=1 format
            let translated = '';
            if (json.sentences && Array.isArray(json.sentences)) {
              translated = json.sentences.map((s: any) => s.trans || '').join('');
            } else if (Array.isArray(json[0])) {
              // Alternative format: [[translated, original, ...], ...]
              translated = json[0].map((segment: any[]) => segment[0] || '').join('');
            }
            if (!translated) {
              console.warn(`[translator] No translation extracted, returning original`);
              translated = text;
            }
            console.log(`[translator] Translated: "${text.substring(0, 30)}" → "${translated.substring(0, 30)}"`);
            resolve(translated.trim());
          } catch (e: any) {
            console.error(`[translator] Parse error: ${e.message}, response: ${data.substring(0, 200)}`);
            reject(new Error(`Failed to parse Google response: ${data.substring(0, 200)}`));
          }
        });
      });
      req.on('error', reject);
      req.setTimeout(15000, () => { req.destroy(); reject(new Error('Request timeout')); });
    });
  }

  private async callOllama(text: string, tgt: string): Promise<string> {
    const cfg =
      this.config.ollama ?? { baseUrl: 'http://localhost:11434', model: 'qwen2.5:3b' };
    const prompt = `Translate the following text to ${tgt}. Only output the translation, nothing else.\n\n${text}`;
    const resp = await fetch(`${cfg.baseUrl}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: cfg.model,
        prompt,
        stream: false,
        options: { temperature: 0.1 },
      }),
    });
    if (!resp.ok) throw new Error(`Ollama HTTP ${resp.status}`);
    const data = (await resp.json()) as { response: string };
    return data.response.trim();
  }

  private async callDeepL(text: string, src: string, tgt: string): Promise<string> {
    const cfg = this.config.deepl;
    if (!cfg?.apiKey) throw new Error('DeepL API key not configured');
    const baseUrl = cfg.freeApi
      ? 'https://api-free.deepl.com/v2/translate'
      : 'https://api.deepl.com/v2/translate';
    const params = new URLSearchParams();
    params.set('auth_key', cfg.apiKey);
    params.set('text', text);
    params.set('target_lang', tgt.toUpperCase());
    if (src !== 'auto') params.set('source_lang', src.toUpperCase());
    const resp = await fetch(baseUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString(),
    });
    if (!resp.ok) throw new Error(`DeepL HTTP ${resp.status}`);
    const data = (await resp.json()) as { translations: Array<{ text: string }> };
    return data.translations[0].text;
  }

  private async callBergamot(text: string, src: string, tgt: string): Promise<string> {
    console.log(`[translator] Bergamot translate: "${text.substring(0, 50)}" (${src}→${tgt})`);

    if (!this.bergamotService) {
      this.bergamotService = new BergamotService(this.config.bergamot?.modelDir);
    }

    const result = await this.bergamotService.translate(text, src, tgt);
    return result;
  }

  getBergamotStatus(): BergamotStatus {
    return this.bergamotService?.getStatus() ?? 'uninitialized';
  }

  async terminate(): Promise<void> {
    if (this.bergamotService) {
      await this.bergamotService.terminate();
      this.bergamotService = null;
    }
  }
}
