import type { TranslationItem } from '../../../../shared/types';
import { DEFAULTS } from '../../../../shared/constants';
import type { PipelineMode, PipelineContext, ModeResult } from './pipeline-mode';
import levenshtein from 'fast-levenshtein';

/**
 * Dynamic mode: suppresses re-emission of unchanged results using fuzzy matching.
 * Results are compared by position (grid neighborhood) and text similarity.
 * If results haven't changed significantly, skip emission to reduce flicker.
 */
export class DynamicMode implements PipelineMode {
  readonly name = 'dynamic';

  handleNewResults(ctx: PipelineContext): ModeResult {
    // Check if results have changed compared to last emission
    const hasChanges = this.hasTranslationChanges(ctx.overlayItems, ctx.lastEmittedResults);

    if (!hasChanges && ctx.lastEmittedResults.length > 0) {
      return {
        shouldLock: false,
        shouldEmit: false,
        items: [],
        locked: false,
        noNewTextCounter: 0,
        lastEmittedResults: ctx.lastEmittedResults,
        reason: 'results unchanged, skip emit',
      };
    }

    return {
      shouldLock: false,
      shouldEmit: true,
      items: ctx.overlayItems,
      locked: false,
      noNewTextCounter: 0,
      lastEmittedResults: ctx.overlayItems,
      reason: 'results changed, emitting',
    };
  }

  handleNoNewText(ctx: PipelineContext): ModeResult {
    // Dynamic mode: no new text, just skip (will try again next frame)
    return {
      shouldLock: false,
      shouldEmit: false,
      items: [],
      locked: false,
      noNewTextCounter: ctx.noNewTextCounter,
      lastEmittedResults: ctx.lastEmittedResults,
      reason: 'no new text, skip',
    };
  }

  handleStableContent(_ctx: PipelineContext): ModeResult | null {
    // Dynamic mode does not use content stability for locking
    return null;
  }

  /**
   * Compare translation results with previously emitted results using fuzzy matching.
   * Returns true if any significant change is detected (new items or changed text).
   */
  private hasTranslationChanges(
    current: TranslationItem[],
    previous: TranslationItem[],
  ): boolean {
    if (previous.length === 0) return true;
    if (current.length !== previous.length) return true;

    const threshold = DEFAULTS.DYNAMIC_SIMILARITY_THRESHOLD;

    for (let i = 0; i < current.length; i++) {
      const curr = current[i];
      const prev = previous[i];

      // Check position change (bbox must be in same grid neighborhood)
      const gridCurrX = Math.round(curr.bbox[0] / DEFAULTS.CHANGE_DETECTOR_POSITION_GRID);
      const gridCurrY = Math.round(curr.bbox[1] / DEFAULTS.CHANGE_DETECTOR_POSITION_GRID);
      const gridPrevX = Math.round(prev.bbox[0] / DEFAULTS.CHANGE_DETECTOR_POSITION_GRID);
      const gridPrevY = Math.round(prev.bbox[1] / DEFAULTS.CHANGE_DETECTOR_POSITION_GRID);

      if (Math.abs(gridCurrX - gridPrevX) > 2 || Math.abs(gridCurrY - gridPrevY) > 2) {
        return true; // Position changed significantly
      }

      // Check original text similarity
      const origSimilarity = this.textSimilarity(curr.original, prev.original);
      if (origSimilarity < threshold) return true;

      // Check translated text similarity
      const transSimilarity = this.textSimilarity(curr.translated, prev.translated);
      if (transSimilarity < threshold) return true;
    }

    return false;
  }

  /**
   * Compute Levenshtein similarity ratio between two strings.
   */
  private textSimilarity(a: string, b: string): number {
    const maxLen = Math.max(a.length, b.length);
    if (maxLen === 0) return 1.0;
    return 1 - levenshtein.get(a, b) / maxLen;
  }
}
