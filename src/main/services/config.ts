import { readFileSync, existsSync, writeFileSync, mkdirSync } from 'fs';
import * as path from 'path';
import yaml from 'js-yaml';
import { AppConfig, LockMode, OverlayDisplayMode, OcrEngineType } from '../../shared/types';
import { DEFAULTS } from '../../shared/constants';
import { ConfigError } from '../utils/errors';

/**
 * Validate config fields before applying.
 * Returns an array of validation error messages (empty if valid).
 */
function validateConfig(config: Partial<AppConfig>): string[] {
  const errors: string[] = [];

  if (config.capture) {
    if (config.capture.intervalIdle !== undefined && config.capture.intervalIdle < 500) {
      errors.push('capture.intervalIdle must be >= 500ms');
    }
    if (config.capture.intervalActive !== undefined && config.capture.intervalActive < 200) {
      errors.push('capture.intervalActive must be >= 200ms');
    }
  }

  if (config.translation) {
    const validEngines = ['bergamot', 'google', 'ollama', 'deepl'];
    if (config.translation.primary !== undefined && !validEngines.includes(config.translation.primary)) {
      errors.push(`translation.primary must be one of: ${validEngines.join(', ')}`);
    }
    if (config.translation.fallback !== undefined && !validEngines.includes(config.translation.fallback)) {
      errors.push(`translation.fallback must be one of: ${validEngines.join(', ')}`);
    }
  }

  if (config.overlay) {
    if (config.overlay.fontSize !== undefined && (config.overlay.fontSize < 8 || config.overlay.fontSize > 32)) {
      errors.push('overlay.fontSize must be between 8 and 32');
    }
    if (config.overlay.backgroundOpacity !== undefined && (config.overlay.backgroundOpacity < 0 || config.overlay.backgroundOpacity > 1)) {
      errors.push('overlay.backgroundOpacity must be between 0 and 1');
    }
    if (config.overlay.displayMode !== undefined) {
      const validModes: OverlayDisplayMode[] = ['sideBySide', 'hover'];
      if (!validModes.includes(config.overlay.displayMode)) {
        errors.push(`overlay.displayMode must be one of: ${validModes.join(', ')}`);
      }
    }
  }

  if (config.pipeline) {
    const validLockModes: LockMode[] = ['document', 'dynamic'];
    if (config.pipeline.lockMode !== undefined && !validLockModes.includes(config.pipeline.lockMode)) {
      errors.push(`pipeline.lockMode must be one of: ${validLockModes.join(', ')}`);
    }
    if (config.pipeline.fuzzyThreshold !== undefined && (config.pipeline.fuzzyThreshold < 0 || config.pipeline.fuzzyThreshold > 1)) {
      errors.push('pipeline.fuzzyThreshold must be between 0 and 1');
    }
  }

  return errors;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function deepMerge(target: any, source: any): any {
  const result = { ...target };
  for (const key of Object.keys(source)) {
    const srcVal = source[key];
    const tgtVal = result[key];
    if (
      srcVal && typeof srcVal === 'object' && !Array.isArray(srcVal) &&
      tgtVal && typeof srcVal === 'object' && !Array.isArray(tgtVal)
    ) {
      result[key] = deepMerge(tgtVal, srcVal);
    } else {
      result[key] = srcVal;
    }
  }
  return result;
}

function getDefaultConfig(): AppConfig {
  return {
    capture: {
      intervalIdle: DEFAULTS.CAPTURE_INTERVAL_IDLE,
      intervalActive: DEFAULTS.CAPTURE_INTERVAL_ACTIVE,
    },
    ocr: {
      engine: 'auto' as const,
      languages: [...DEFAULTS.OCR_LANGUAGES],
      confidenceThreshold: DEFAULTS.OCR_CONFIDENCE_THRESHOLD,
      downscale: DEFAULTS.OCR_DOWNSCALE,
      preprocessing: {
        enabled: DEFAULTS.OCR_PREPROCESSING_ENABLED,
        upscale: DEFAULTS.OCR_PREPROCESSING_UPSCALE,
        grayscale: DEFAULTS.OCR_PREPROCESSING_GRAYSCALE,
        normalize: DEFAULTS.OCR_PREPROCESSING_NORMALIZE,
      },
      grouping: {
        enabled: DEFAULTS.OCR_GROUPING_ENABLED,
        verticalThresholdRatio: DEFAULTS.OCR_GROUPING_VERTICAL_THRESHOLD_RATIO,
        horizontalThreshold: DEFAULTS.OCR_GROUPING_HORIZONTAL_THRESHOLD,
        requireOverlap: DEFAULTS.OCR_GROUPING_REQUIRE_OVERLAP,
        paragraphGapRatio: DEFAULTS.OCR_GROUPING_PARAGRAPH_GAP_RATIO,
        detectColumns: DEFAULTS.OCR_GROUPING_DETECT_COLUMNS,
      },
    },
    translation: {
      primary: DEFAULTS.TRANSLATION_PRIMARY,
      fallback: DEFAULTS.TRANSLATION_FALLBACK,
      sourceLang: DEFAULTS.TRANSLATION_SOURCE_LANG,
      targetLang: DEFAULTS.TRANSLATION_TARGET_LANG,
      ollama: {
        baseUrl: DEFAULTS.OLLAMA_BASE_URL,
        model: DEFAULTS.OLLAMA_MODEL,
      },
      bergamot: {
        modelDir: DEFAULTS.BERGAMOT_MODEL_DIR,
      },
    },
    overlay: {
      fontSize: DEFAULTS.OVERLAY_FONT_SIZE,
      backgroundOpacity: DEFAULTS.OVERLAY_BACKGROUND_OPACITY,
      displayMode: DEFAULTS.OVERLAY_DISPLAY_MODE,
    },
    cache: {
      dbPath: DEFAULTS.CACHE_DB_PATH,
      maxAgeHours: DEFAULTS.CACHE_MAX_AGE_HOURS,
    },
    pipeline: {
      lockMode: DEFAULTS.DEFAULT_LOCK_MODE,
      fuzzyThreshold: DEFAULTS.FUZZY_MATCH_THRESHOLD,
    },
  };
}

function normalizeKeys(obj: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    const camelKey = key.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      result[camelKey] = normalizeKeys(value as Record<string, unknown>);
    } else {
      result[camelKey] = value;
    }
  }
  return result;
}

/** Convert camelCase config keys to snake_case for YAML serialization */
function toSnakeCase(obj: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    const snakeKey = key.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      result[snakeKey] = toSnakeCase(value as Record<string, unknown>);
    } else {
      result[snakeKey] = value;
    }
  }
  return result;
}

export class ConfigService {
  private config: AppConfig;
  private userConfigPath: string;

  constructor(defaultConfigPath: string, userDataPath: string) {
    this.userConfigPath = path.join(userDataPath, 'user-config.yaml');
    this.config = this.loadConfig(defaultConfigPath, this.userConfigPath);
    console.log('[config] Loaded config:', JSON.stringify(this.config, null, 2));
    console.log('[config] User config path:', this.userConfigPath);
  }

  private loadConfig(defaultConfigPath: string, userConfigPath: string): AppConfig {
    const defaults = getDefaultConfig();

    // Load base config from project defaults
    let baseConfig = defaults;
    if (existsSync(defaultConfigPath)) {
      try {
        const raw = readFileSync(defaultConfigPath, 'utf-8');
        const parsed = yaml.load(raw) as Record<string, unknown>;
        const normalized = normalizeKeys(parsed);
        baseConfig = deepMerge(defaults, normalized) as AppConfig;
      } catch (err) {
        console.error('[config] Failed to parse default config:', err);
      }
    }

    // Overlay user config on top (persists across restarts)
    if (existsSync(userConfigPath)) {
      try {
        const raw = readFileSync(userConfigPath, 'utf-8');
        const parsed = yaml.load(raw) as Record<string, unknown>;
        const normalized = normalizeKeys(parsed);
        baseConfig = deepMerge(baseConfig, normalized) as AppConfig;
        console.log('[config] User config applied');
      } catch (err) {
        console.error('[config] Failed to parse user config:', err);
      }
    }

    return baseConfig;
  }

  getConfig(): AppConfig {
    return { ...this.config };
  }

  updateConfig(partial: Partial<AppConfig>): void {
    // Validate before applying
    const errors = validateConfig(partial);
    if (errors.length > 0) {
      const message = `Invalid config: ${errors.join('; ')}`;
      console.error(`[config] ${message}`);
      throw new ConfigError(message, { errors, partial });
    }

    this.config = deepMerge(this.config, partial) as AppConfig;
    this.writeToDisk();
    console.log('[config] Config updated and persisted:', JSON.stringify(partial, null, 2));
  }

  private writeToDisk(): void {
    try {
      const dir = path.dirname(this.userConfigPath);
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
      }
      const yamlContent = yaml.dump(toSnakeCase(this.config as unknown as Record<string, unknown>));
      writeFileSync(this.userConfigPath, yamlContent, 'utf-8');
      console.log('[config] Written to:', this.userConfigPath);
    } catch (err) {
      console.error('[config] Failed to write user config:', err);
    }
  }
}
