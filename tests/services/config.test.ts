import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ConfigService } from '../../src/main/services/config';
import { writeFileSync, mkdirSync, rmSync } from 'fs';
import { join } from 'path';

const TEST_DIR = join(__dirname, '__test_config__');
const TEST_YAML = join(TEST_DIR, 'default.yaml');

const sampleYaml = `
capture:
  interval_idle: 300
  interval_active: 100
ocr:
  engine: tesseract
  languages: ["eng"]
  confidence_threshold: 50
  downscale: 0.8
translation:
  primary: ollama
  fallback: google
  source_lang: en
  target_lang: ja
  ollama:
    model: test-model
    base_url: http://localhost:9999
overlay:
  font_size: 16
  background_color: "rgba(0,0,0,0.5)"
  text_color: "#FFF"
  padding: 2
cache:
  db_path: "test_cache.db"
  max_age_hours: 24
`;

describe('ConfigService', () => {
  beforeEach(() => {
    mkdirSync(TEST_DIR, { recursive: true });
    writeFileSync(TEST_YAML, sampleYaml);
  });

  afterEach(() => {
    rmSync(TEST_DIR, { recursive: true, force: true });
  });

  it('should load config from YAML file', () => {
    const service = new ConfigService(TEST_YAML);
    const config = service.getConfig();
    expect(config.capture.intervalIdle).toBe(300);
    expect(config.capture.intervalActive).toBe(100);
    expect(config.ocr.languages).toEqual(['eng']);
    expect(config.translation.primary).toBe('ollama');
    expect(config.translation.targetLang).toBe('ja');
  });

  it('should return defaults when file does not exist', () => {
    const service = new ConfigService('/nonexistent/path.yaml');
    const config = service.getConfig();
    expect(config.capture.intervalIdle).toBe(500);
    expect(config.ocr.languages).toEqual(['eng', 'chi_sim']);
    expect(config.translation.primary).toBe('google');
  });

  it('should merge partial config with defaults', () => {
    const partialYaml = `
translation:
  primary: deepl
  target_lang: ko
`;
    writeFileSync(TEST_YAML, partialYaml);
    const service = new ConfigService(TEST_YAML);
    const config = service.getConfig();
    expect(config.translation.primary).toBe('deepl');
    expect(config.translation.targetLang).toBe('ko');
    expect(config.capture.intervalIdle).toBe(500);
    expect(config.ocr.confidenceThreshold).toBe(60);
  });

  it('should update config at runtime', () => {
    const service = new ConfigService(TEST_YAML);
    service.updateConfig({ translation: { ...service.getConfig().translation, targetLang: 'en' } });
    expect(service.getConfig().translation.targetLang).toBe('en');
  });

  it('should extract ollama config correctly', () => {
    const service = new ConfigService(TEST_YAML);
    const config = service.getConfig();
    expect(config.translation.ollama?.baseUrl).toBe('http://localhost:9999');
    expect(config.translation.ollama?.model).toBe('test-model');
  });
});
