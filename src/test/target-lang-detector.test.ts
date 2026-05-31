import { describe, it, expect } from 'vitest';
import {
  resolveLangGroup,
  isNonCJKSource,
  analyzeScript,
  isTargetLanguageText,
} from '../main/utils/target-lang-detector';

describe('resolveLangGroup', () => {
  it('resolves Chinese variants', () => {
    expect(resolveLangGroup('zh-CN')).toBe('zh');
    expect(resolveLangGroup('zh-TW')).toBe('zh');
    expect(resolveLangGroup('zh')).toBe('zh');
    expect(resolveLangGroup('zho')).toBe('zh');
    expect(resolveLangGroup('chi')).toBe('zh');
  });

  it('resolves Japanese', () => {
    expect(resolveLangGroup('ja')).toBe('ja');
    expect(resolveLangGroup('jpn')).toBe('ja');
  });

  it('resolves Korean', () => {
    expect(resolveLangGroup('ko')).toBe('ko');
    expect(resolveLangGroup('kor')).toBe('ko');
  });

  it('returns null for Latin-script languages', () => {
    expect(resolveLangGroup('en')).toBeNull();
    expect(resolveLangGroup('fr')).toBeNull();
    expect(resolveLangGroup('de')).toBeNull();
    expect(resolveLangGroup('es')).toBeNull();
  });
});

describe('isNonCJKSource', () => {
  it('identifies English and auto as non-CJK', () => {
    expect(isNonCJKSource('eng')).toBe(true);
    expect(isNonCJKSource('en')).toBe(true);
    expect(isNonCJKSource('auto')).toBe(true);
  });

  it('identifies European languages as non-CJK', () => {
    expect(isNonCJKSource('fr')).toBe(true);
    expect(isNonCJKSource('de')).toBe(true);
    expect(isNonCJKSource('es')).toBe(true);
    expect(isNonCJKSource('ru')).toBe(true);
  });

  it('rejects CJK source languages', () => {
    expect(isNonCJKSource('zh')).toBe(false);
    expect(isNonCJKSource('ja')).toBe(false);
    expect(isNonCJKSource('ko')).toBe(false);
  });
});

describe('analyzeScript', () => {
  it('counts CJK characters', () => {
    const result = analyzeScript('设置');
    expect(result.cjkCount).toBe(2);
    expect(result.totalNonSpace).toBe(2);
  });

  it('counts mixed text correctly', () => {
    const result = analyzeScript('Hello 你好 World');
    expect(result.cjkCount).toBe(2);
    // 'Hello' and 'World' are ASCII, not counted in totalNonSpace
    expect(result.totalNonSpace).toBe(2);
  });

  it('counts CJK punctuation', () => {
    const result = analyzeScript('你好。');
    expect(result.cjkCount).toBe(2);
    expect(result.cjkPunctCount).toBe(1);
  });

  it('counts Japanese hiragana and katakana', () => {
    const result = analyzeScript('こんにちはカタカナ');
    expect(result.hiraganaCount).toBe(5); // こ ん に ち は
    expect(result.katakanaCount).toBe(4); // カ タ カ ナ
  });

  it('counts Korean hangul', () => {
    const result = analyzeScript('안녕하세요');
    expect(result.hangulCount).toBe(5);
  });

  it('handles empty string', () => {
    const result = analyzeScript('');
    expect(result.cjkCount).toBe(0);
    expect(result.totalNonSpace).toBe(0);
  });

  it('handles pure ASCII text', () => {
    const result = analyzeScript('Hello World 123');
    expect(result.cjkCount).toBe(0);
    expect(result.totalNonSpace).toBe(0);
  });
});

describe('isTargetLanguageText', () => {
  describe('zh target (en→zh)', () => {
    const targetLang = 'zh-CN';
    const sourceLang = 'eng';

    it('detects pure Chinese text as target language', () => {
      const result = isTargetLanguageText('设置', targetLang, sourceLang);
      expect(result.isTargetLang).toBe(true);
    });

    it('detects Chinese with punctuation', () => {
      const result = isTargetLanguageText('你好，世界！', targetLang, sourceLang);
      expect(result.isTargetLang).toBe(true);
    });

    it('detects mixed text with high CJK ratio', () => {
      const result = isTargetLanguageText('欢迎使用翻译功能', targetLang, sourceLang);
      expect(result.isTargetLang).toBe(true);
    });

    it('detects short Chinese text (2 chars)', () => {
      const result = isTargetLanguageText('翻译', targetLang, sourceLang);
      expect(result.isTargetLang).toBe(true);
    });

    it('does not flag pure English text', () => {
      const result = isTargetLanguageText('Settings', targetLang, sourceLang);
      expect(result.isTargetLang).toBe(false);
    });

    it('does not flag text with single CJK character', () => {
      // Only 1 CJK char among mostly ASCII — below threshold
      const result = isTargetLanguageText('Press 中 to continue', targetLang, sourceLang);
      expect(result.isTargetLang).toBe(false);
    });

    it('handles OCR-garbled Chinese text', () => {
      // Simulate OCR reading: some correct, some garbled
      const result = isTargetLanguageText('设 置', targetLang, sourceLang);
      expect(result.isTargetLang).toBe(true);
    });

    it('handles empty text', () => {
      const result = isTargetLanguageText('', targetLang, sourceLang);
      expect(result.isTargetLang).toBe(false);
    });

    it('does not flag English text with smart quotes', () => {
      // U+201C left double quotation mark — should not trigger CJK detection
      const result = isTargetLanguageText('Electron-based applications include a \u201Cm', targetLang, sourceLang);
      expect(result.isTargetLang).toBe(false);
    });

    it('does not flag English text with em-dash', () => {
      const result = isTargetLanguageText('Some text \u2014 with dashes', targetLang, sourceLang);
      expect(result.isTargetLang).toBe(false);
    });
  });

  describe('ja target (en→ja)', () => {
    const targetLang = 'ja';
    const sourceLang = 'eng';

    it('detects Japanese text with hiragana', () => {
      const result = isTargetLanguageText('こんにちは', targetLang, sourceLang);
      expect(result.isTargetLang).toBe(true);
    });

    it('detects Japanese text with katakana', () => {
      const result = isTargetLanguageText('設定', targetLang, sourceLang);
      expect(result.isTargetLang).toBe(true);
    });

    it('does not flag pure English', () => {
      const result = isTargetLanguageText('Hello', targetLang, sourceLang);
      expect(result.isTargetLang).toBe(false);
    });
  });

  describe('ko target (en→ko)', () => {
    const targetLang = 'ko';
    const sourceLang = 'eng';

    it('detects Korean text', () => {
      const result = isTargetLanguageText('안녕하세요', targetLang, sourceLang);
      expect(result.isTargetLang).toBe(true);
    });

    it('does not flag pure English', () => {
      const result = isTargetLanguageText('Hello', targetLang, sourceLang);
      expect(result.isTargetLang).toBe(false);
    });
  });

  describe('non-applicable language pairs', () => {
    it('does not filter for en→fr (same script)', () => {
      const result = isTargetLanguageText('Bonjour', 'fr', 'eng');
      expect(result.isTargetLang).toBe(false);
    });

    it('does not filter for zh→en (reversed)', () => {
      const result = isTargetLanguageText('English text', 'en', 'zh');
      expect(result.isTargetLang).toBe(false);
    });
  });
});
