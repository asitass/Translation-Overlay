/**
 * Post-process translation output for Chinese target language.
 * Protects English abbreviations, numbers, and quoted content from over-replacement.
 */

// Pre-compiled regex patterns for postProcessTranslation (avoid re-compilation on each call)
const RE_DECIMAL = /(\d)\.(\d)/g;
const RE_ABBREVIATION = /\b(Mr|Mrs|Ms|Dr|Prof|Sr|Jr|vs|etc|Inc|Ltd|Co)\.(?=\s|$)/gi;
const RE_INITIALISM = /\b([A-Z])\.\s*([A-Z])\./g;
const RE_RESTORE_DOT = /__PDOT__/g;
const RE_MULTIPLE_PERIODS = /。{2,}/g;
const RE_MULTIPLE_COMMAS = /，{2,}/g;
const RE_MULTIPLE_SPACES = /\s{2,}/g;
const RE_SPACE_BEFORE_CN_PUNCT = /\s+([，。？！：；（）])/g;
const RE_SPACE_AFTER_CN_PUNCT = /([，。？！：；（）])\s+/g;

export function postProcessTranslation(text: string): string {
  let result = text;

  // Step 1: Protect decimal numbers (3.5 → 3__PDOT__5)
  RE_DECIMAL.lastIndex = 0;
  result = result.replace(RE_DECIMAL, '$1__PDOT__$2');

  // Step 2: Protect known abbreviations (Mr. → Mr__PDOT__)
  RE_ABBREVIATION.lastIndex = 0;
  result = result.replace(RE_ABBREVIATION, '$1__PDOT__');

  // Step 3: Protect single-letter abbreviations (U.S. → U__PDOT__S__PDOT__)
  RE_INITIALISM.lastIndex = 0;
  result = result.replace(RE_INITIALISM, '$1__PDOT__$2__PDOT__');

  // Step 4: Chinese punctuation normalization (single pass with chained replaces)
  result = result
    .replace(/,/g, '，')
    .replace(/\./g, '。')
    .replace(/\?/g, '？')
    .replace(/!/g, '！')
    .replace(/:/g, '：')
    .replace(/;/g, '；')
    .replace(/\(/g, '（')
    .replace(/\)/g, '）');

  // Step 5: Restore protected periods
  RE_RESTORE_DOT.lastIndex = 0;
  result = result.replace(RE_RESTORE_DOT, '.');

  // Step 6: Remove artifacts
  result = result
    .replace(RE_MULTIPLE_PERIODS, '。')
    .replace(RE_MULTIPLE_COMMAS, '，')
    .replace(RE_MULTIPLE_SPACES, ' ');

  // Step 7: Remove spaces around Chinese punctuation
  result = result
    .replace(RE_SPACE_BEFORE_CN_PUNCT, '$1')
    .replace(RE_SPACE_AFTER_CN_PUNCT, '$1');

  return result.trim();
}

/**
 * Split a translated text block back into individual lines for overlay positioning.
 * Uses sentence-boundary-aware splitting to maintain sentence integrity.
 */
export function splitTranslationToLines(
  translatedText: string,
  originalLineLengths: number[],
): string[] {
  const lineCount = originalLineLengths.length;
  if (lineCount === 0) return [];
  if (lineCount === 1) return [translatedText];

  // Strategy 1: Check for newline splitting
  const byNewlines = translatedText.split('\n').filter((l) => l.trim());
  if (byNewlines.length === lineCount) {
    return byNewlines.map((l) => l.trim());
  }

  // Strategy 2: Split at sentence boundaries first
  const sentences = splitIntoSentences(translatedText);
  if (sentences.length >= lineCount) {
    return distributeSentencesToLines(sentences, originalLineLengths, translatedText);
  }

  // Strategy 3: Proportional split at safe break points (sentence-aware)
  return proportionalSplitAtSentenceBreaks(translatedText, originalLineLengths);
}

/**
 * Split text into sentences at Chinese sentence-ending punctuation.
 */
function splitIntoSentences(text: string): string[] {
  const sentences: string[] = [];
  let current = '';

  for (let i = 0; i < text.length; i++) {
    current += text[i];
    if ('。！？'.includes(text[i])) {
      sentences.push(current);
      current = '';
    }
  }
  if (current.trim()) {
    sentences.push(current);
  }

  return sentences;
}

/**
 * Distribute sentences to lines based on original line length proportions.
 */
function distributeSentencesToLines(
  sentences: string[],
  originalLineLengths: number[],
  fullText: string,
): string[] {
  const lineCount = originalLineLengths.length;
  const totalLength = originalLineLengths.reduce((a, b) => a + b, 0);
  const results: string[] = [];

  let sentIdx = 0;
  for (let lineIdx = 0; lineIdx < lineCount; lineIdx++) {
    const proportion = totalLength > 0 ? originalLineLengths[lineIdx] / totalLength : 1 / lineCount;
    const targetCharCount = Math.round(fullText.length * proportion);

    let lineText = '';
    let charCount = 0;

    while (sentIdx < sentences.length && charCount < targetCharCount) {
      lineText += sentences[sentIdx];
      charCount += sentences[sentIdx].length;
      sentIdx++;
    }

    // If last line, take everything remaining
    if (lineIdx === lineCount - 1) {
      while (sentIdx < sentences.length) {
        lineText += sentences[sentIdx];
        sentIdx++;
      }
    }

    results.push(lineText.trim() || '');
  }

  return results;
}

/**
 * Proportional split at sentence-safe break points.
 * Prefers breaking at sentence endings (。！？；) and then at clause endings (，、).
 */
function proportionalSplitAtSentenceBreaks(
  translatedText: string,
  originalLineLengths: number[],
): string[] {
  const lineCount = originalLineLengths.length;
  const totalOriginalLength = originalLineLengths.reduce((a, b) => a + b, 0);
  if (totalOriginalLength === 0) {
    return [translatedText, ...Array(lineCount - 1).fill('')];
  }

  const results: string[] = [];
  let charIdx = 0;

  const sentenceBreaks = new Set(['。', '！', '？', '；']);
  const clauseBreaks = new Set(['，', '、', ' ']);

  for (let i = 0; i < lineCount; i++) {
    const proportion = originalLineLengths[i] / totalOriginalLength;
    const idealEnd = charIdx + Math.round(translatedText.length * proportion);

    if (i === lineCount - 1) {
      results.push(translatedText.slice(charIdx).trim());
    } else {
      const breakPoint = findBestBreakPoint(translatedText, idealEnd, charIdx, sentenceBreaks, clauseBreaks);
      results.push(translatedText.slice(charIdx, breakPoint).trim());
      charIdx = breakPoint;
    }
  }

  return results;
}

/**
 * Find the best break point near the ideal position.
 */
function findBestBreakPoint(
  text: string,
  idealPos: number,
  minPos: number,
  sentenceBreaks: Set<string>,
  clauseBreaks: Set<string>,
): number {
  const searchRadius = 25;
  const searchStart = Math.max(minPos + 1, idealPos - searchRadius);
  const searchEnd = Math.min(text.length, idealPos + searchRadius);

  // First try: sentence boundaries
  for (let offset = 0; offset <= searchRadius; offset++) {
    for (const dir of [1, -1] as const) {
      const pos = idealPos + offset * dir;
      if (pos < searchStart || pos >= searchEnd) continue;
      if (sentenceBreaks.has(text[pos])) {
        return pos + 1;
      }
    }
  }

  // Second try: clause boundaries
  for (let offset = 0; offset <= searchRadius; offset++) {
    for (const dir of [1, -1] as const) {
      const pos = idealPos + offset * dir;
      if (pos < searchStart || pos >= searchEnd) continue;
      if (clauseBreaks.has(text[pos])) {
        return pos + 1;
      }
    }
  }

  return Math.max(minPos + 1, Math.min(idealPos, text.length));
}
