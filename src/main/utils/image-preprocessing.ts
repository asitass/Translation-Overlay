import sharp from 'sharp';
import { OcrPreprocessingConfig } from '../../shared/types';

/**
 * Preprocess a PNG image buffer for OCR.
 * Pipeline: upscale → grayscale → normalize
 * When preprocessing is enabled, it replaces the existing downscale logic.
 */
export async function preprocessForOCR(
  pngBuffer: Buffer,
  config: OcrPreprocessingConfig,
): Promise<Buffer> {
  if (!config.enabled) {
    return pngBuffer;
  }

  let pipeline = sharp(pngBuffer);

  // Get original dimensions for upscaling
  const metadata = await pipeline.metadata();
  const origWidth = metadata.width ?? 1920;
  const origHeight = metadata.height ?? 1080;

  if (config.upscale > 1.0) {
    const newWidth = Math.round(origWidth * config.upscale);
    const newHeight = Math.round(origHeight * config.upscale);
    pipeline = pipeline.resize(newWidth, newHeight, {
      kernel: 'lanczos3',
    });
    console.log(`[preprocess] Upscaled ${origWidth}x${origHeight} → ${newWidth}x${newHeight}`);
  }

  if (config.grayscale) {
    pipeline = pipeline.grayscale();
  }

  if (config.normalize) {
    pipeline = pipeline.normalize();
  }

  const result = await pipeline.png().toBuffer();
  console.log(`[preprocess] Output: ${result.length} bytes`);
  return result;
}

/**
 * Calculate the scale factor introduced by preprocessing.
 * Used to map OCR coordinates back to original screen coordinates.
 */
export function getPreprocessScale(config: OcrPreprocessingConfig): number {
  if (!config.enabled) return 1.0;
  return config.upscale > 1.0 ? config.upscale : 1.0;
}
