import { describe, it, expect } from 'vitest';
import { getPreprocessScale } from '../main/utils/image-preprocessing';
import type { OcrPreprocessingConfig } from '../shared/types';

describe('getPreprocessScale', () => {
  it('returns 1.0 when preprocessing is disabled', () => {
    const config: OcrPreprocessingConfig = {
      enabled: false, upscale: 2.0, grayscale: true, normalize: true,
    };
    expect(getPreprocessScale(config)).toBe(1.0);
  });

  it('returns upscale value when preprocessing is enabled', () => {
    const config: OcrPreprocessingConfig = {
      enabled: true, upscale: 2.0, grayscale: true, normalize: true,
    };
    expect(getPreprocessScale(config)).toBe(2.0);
  });

  it('returns 1.0 when upscale is 1.0', () => {
    const config: OcrPreprocessingConfig = {
      enabled: true, upscale: 1.0, grayscale: true, normalize: true,
    };
    expect(getPreprocessScale(config)).toBe(1.0);
  });
});
