import { describe, it, expect } from 'vitest';
import { postProcessTranslation, splitTranslationToLines } from '../main/utils/translation-postprocess';

describe('postProcessTranslation', () => {
  it('normalizes English punctuation to Chinese', () => {
    expect(postProcessTranslation('Hello, world.')).toBe('Hello，world。');
    expect(postProcessTranslation('Really? Yes!')).toBe('Really？Yes！');
  });

  it('normalizes colons and semicolons', () => {
    expect(postProcessTranslation('Note: item; done')).toBe('Note：item；done');
  });

  it('normalizes parentheses', () => {
    expect(postProcessTranslation('(test)')).toBe('（test）');
  });

  it('removes repeated punctuation', () => {
    expect(postProcessTranslation('Hello。。。')).toBe('Hello。');
    expect(postProcessTranslation('Wait，，，')).toBe('Wait，');
  });

  it('removes extra spaces', () => {
    expect(postProcessTranslation('Hello  world')).toBe('Hello world');
  });

  it('removes space around Chinese punctuation', () => {
    expect(postProcessTranslation('Hello ， world')).toBe('Hello，world');
    expect(postProcessTranslation('Test 。 end')).toBe('Test。end');
  });

  it('trims whitespace', () => {
    expect(postProcessTranslation('  Hello  ')).toBe('Hello');
  });
});

describe('splitTranslationToLines', () => {
  it('returns single line unchanged', () => {
    expect(splitTranslationToLines('你好', [10])).toEqual(['你好']);
  });

  it('returns empty array for no lengths', () => {
    expect(splitTranslationToLines('test', [])).toEqual([]);
  });

  it('splits by newlines when line count matches', () => {
    expect(splitTranslationToLines('你好\n世界', [10, 10])).toEqual(['你好', '世界']);
  });

  it('splits proportionally when no newlines', () => {
    const result = splitTranslationToLines('你好世界', [10, 10]);
    expect(result).toHaveLength(2);
    expect(result[0].length + result[1].length).toBeGreaterThan(0);
  });
});
