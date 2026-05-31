import { DEFAULTS } from '../../../../shared/constants';
import type { PipelineMode, PipelineContext, ModeResult } from './pipeline-mode';

/**
 * Document mode: locks results when content is stable to prevent flicker.
 * Uses two locking mechanisms:
 * 1. Content stability (Jaccard similarity) — locks when page content is consistent
 * 2. Consecutive no-new-text frames — locks after N frames with no new text
 *
 * Document mode uses a lower stability threshold (1 frame) for faster locking.
 */
export class DocumentMode implements PipelineMode {
  readonly name = 'document';

  handleNewResults(ctx: PipelineContext): ModeResult {
    // New results found — reset counter, emit them
    return {
      shouldLock: false,
      shouldEmit: true,
      items: ctx.overlayItems,
      locked: false,
      noNewTextCounter: 0,
      lastEmittedResults: ctx.overlayItems,
      reason: 'new results, emitting',
    };
  }

  handleNoNewText(ctx: PipelineContext): ModeResult {
    const newCounter = ctx.noNewTextCounter + 1;
    const lockThreshold = DEFAULTS.LOCK_CONSECUTIVE_FRAMES;

    // Check if we should lock based on consecutive no-new-text frames
    if (newCounter >= lockThreshold && ctx.lastEmittedResults.length > 0) {
      return {
        shouldLock: true,
        shouldEmit: true,
        items: ctx.lastEmittedResults,
        locked: true,
        noNewTextCounter: newCounter,
        lastEmittedResults: ctx.lastEmittedResults,
        reason: `locked after ${newCounter} consecutive no-new-text frames with ${ctx.lastEmittedResults.length} items`,
      };
    }

    // Not enough consecutive frames yet
    return {
      shouldLock: false,
      shouldEmit: false,
      items: [],
      locked: false,
      noNewTextCounter: newCounter,
      lastEmittedResults: ctx.lastEmittedResults,
      reason: `no new text, counter=${newCounter}/${lockThreshold}`,
    };
  }

  handleStableContent(ctx: PipelineContext): ModeResult | null {
    // Only lock if we have previous results to lock with
    if (ctx.lastEmittedResults.length === 0) {
      return null;
    }

    // Content is stable and we have results — lock immediately
    return {
      shouldLock: true,
      shouldEmit: true,
      items: ctx.lastEmittedResults,
      locked: true,
      noNewTextCounter: 0,
      lastEmittedResults: ctx.lastEmittedResults,
      reason: `locked by content stability with ${ctx.lastEmittedResults.length} items`,
    };
  }
}
