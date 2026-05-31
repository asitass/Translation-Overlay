import type { TranslationItem, AppConfig } from '../../../../shared/types';
import type { TextBlock } from '../../../../shared/types';

/**
 * Context passed to pipeline mode strategies on each tick.
 * Contains all the data needed for mode-specific decisions.
 */
export interface PipelineContext {
  config: AppConfig;
  textBlocks: TextBlock[];
  overlayItems: TranslationItem[];
  isContentStable: boolean;
  noNewTextCounter: number;
  lastEmittedResults: TranslationItem[];
}

/**
 * Result returned by a pipeline mode strategy after processing a tick.
 */
export interface ModeResult {
  /** Whether to lock results (stop re-processing) */
  shouldLock: boolean;
  /** Whether to emit results to renderer */
  shouldEmit: boolean;
  /** Results to emit (if shouldEmit is true) */
  items: TranslationItem[];
  /** Whether this is a locked emission */
  locked: boolean;
  /** Updated noNewTextCounter */
  noNewTextCounter: number;
  /** Updated lastEmittedResults */
  lastEmittedResults: TranslationItem[];
  /** Reason for the decision (for logging) */
  reason: string;
}

/**
 * Strategy interface for pipeline modes.
 * Each mode implements its own logic for when to lock, emit, and suppress results.
 */
export interface PipelineMode {
  /** Process a tick where new text was found and translated */
  handleNewResults(ctx: PipelineContext): ModeResult;

  /** Process a tick where no new text was found */
  handleNoNewText(ctx: PipelineContext): ModeResult;

  /** Process a tick where content is detected as stable */
  handleStableContent(ctx: PipelineContext): ModeResult | null;

  /** Get the mode name for logging */
  readonly name: string;
}
