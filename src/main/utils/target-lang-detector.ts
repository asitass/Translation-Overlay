/**
 * Target language detection for overlay feedback filtering.
 *
 * When translating en→zh (or en→ja, en→ko), the overlay displays translated text.
 * OCR may re-read this text from the overlay, creating a feedback loop.
 * This module detects whether OCR text is likely from the target language,
 * so it can be filtered out before translation.
 */

/** Supported target language groups for feedback detection */
export type TargetLangGroup = 'zh' | 'ja' | 'ko' | null;

/**
 * Resolve a BCP 47 language tag to a target language group.
 * Returns null for languages where script-based detection is not applicable
 * (e.g. en→fr, where both use Latin script).
 */
export function resolveLangGroup(langTag: string): TargetLangGroup {
  if (langTag.startsWith('zh') || langTag === 'zho' || langTag === 'chi') return 'zh';
  if (langTag.startsWith('ja') || langTag === 'jpn') return 'ja';
  if (langTag.startsWith('ko') || langTag === 'kor') return 'ko';
  return null;
}

/** Check if a source language uses a non-CJK script (eng, fra, deu, etc.) */
export function isNonCJKSource(sourceLang: string): boolean {
  const normalized = sourceLang.toLowerCase();
  return (
    normalized === 'eng' ||
    normalized === 'en' ||
    normalized === 'auto' ||
    normalized.startsWith('fr') ||
    normalized.startsWith('de') ||
    normalized.startsWith('es') ||
    normalized.startsWith('pt') ||
    normalized.startsWith('it') ||
    normalized.startsWith('ru') ||
    normalized.startsWith('ar')
  );
}

/** Unicode range match result */
export interface ScriptAnalysis {
  /** CJK unified ideographs (Chinese characters) */
  cjkCount: number;
  /** CJK punctuation and symbols */
  cjkPunctCount: number;
  /** Japanese hiragana */
  hiraganaCount: number;
  /** Japanese katakana */
  katakanaCount: number;
  /** Korean hangul */
  hangulCount: number;
  /** Total characters (excluding ASCII whitespace) */
  totalNonSpace: number;
}

/**
 * Analyze the script composition of a text string.
 * Counts characters in each CJK-related Unicode range.
 */
export function analyzeScript(text: string): ScriptAnalysis {
  let cjkCount = 0;
  let cjkPunctCount = 0;
  let hiraganaCount = 0;
  let katakanaCount = 0;
  let hangulCount = 0;
  let totalNonSpace = 0;

  for (const ch of text) {
    const cp = ch.codePointAt(0)!;

    // Skip ASCII whitespace
    if (cp >= 0x20 && cp <= 0x7e) {
      continue;
    }
    // Skip all whitespace/control characters
    if (cp <= 0x20 || (cp >= 0x7f && cp <= 0xa0)) {
      continue;
    }

    totalNonSpace++;

    // CJK unified ideographs
    if (
      (cp >= 0x4e00 && cp <= 0x9fff) ||
      (cp >= 0x3400 && cp <= 0x4dbf) ||
      (cp >= 0x20000 && cp <= 0x2a6df) ||
      (cp >= 0x2a700 && cp <= 0x2b73f) ||
      (cp >= 0x2b740 && cp <= 0x2b81f) ||
      (cp >= 0xf900 && cp <= 0xfaff)
    ) {
      cjkCount++;
    }
    // CJK punctuation and symbols
    else if (cp >= 0x3000 && cp <= 0x303f) {
      cjkPunctCount++;
    }
    // Fullwidth forms (common in CJK text)
    else if (cp >= 0xff00 && cp <= 0xffef) {
      cjkPunctCount++;
    }
    // Hiragana
    else if (cp >= 0x3040 && cp <= 0x309f) {
      hiraganaCount++;
    }
    // Katakana
    else if (cp >= 0x30a0 && cp <= 0x30ff) {
      katakanaCount++;
    }
    // Korean hangul
    else if (
      (cp >= 0xac00 && cp <= 0xd7af) ||
      (cp >= 0x1100 && cp <= 0x11ff) ||
      (cp >= 0x3130 && cp <= 0x318f)
    ) {
      hangulCount++;
    }
  }

  return { cjkCount, cjkPunctCount, hiraganaCount, katakanaCount, hangulCount, totalNonSpace };
}

/** Result of target language text detection */
export interface TargetLangDetectionResult {
  /** Whether this text is likely from the target language */
  isTargetLang: boolean;
  /** Reason for the detection result */
  reason: string;
  /** Script analysis details */
  analysis: ScriptAnalysis;
}

/**
 * Detect whether OCR text is likely from the target language (overlay feedback).
 *
 * Detection strategy:
 * - For zh target: Check CJK character ratio >= 25% OR absolute CJK count >= 2
 * - For ja target: Check hiragana+katakana+CJK ratio >= 20% OR absolute count >= 2
 * - For ko target: Check hangul ratio >= 25% OR absolute count >= 2
 * - Requires minimum 2 non-space characters to avoid false positives on very short text
 *
 * @param text - OCR text to check
 * @param targetLang - Target language BCP 47 tag (e.g. 'zh-CN', 'ja', 'ko')
 * @param sourceLang - Source language tag (e.g. 'eng', 'auto')
 * @returns Detection result with reason
 */
export function isTargetLanguageText(
  text: string,
  targetLang: string,
  sourceLang: string,
): TargetLangDetectionResult {
  const trimmed = text.trim();

  // Skip empty text
  if (trimmed.length === 0) {
    return {
      isTargetLang: false,
      reason: 'empty text',
      analysis: analyzeScript(trimmed),
    };
  }

  // Only apply filtering when source is non-CJK and target is CJK
  const langGroup = resolveLangGroup(targetLang);
  if (!langGroup || !isNonCJKSource(sourceLang)) {
    return {
      isTargetLang: false,
      reason: `not applicable: source=${sourceLang}, target=${targetLang}`,
      analysis: analyzeScript(trimmed),
    };
  }

  const analysis = analyzeScript(trimmed);

  // Need enough non-ASCII characters to make a reliable judgment.
  // With very few non-ASCII chars (1-2), ratios are unreliable —
  // a single smart quote or dash can cause false positives.
  // Only count actual CJK/script characters, not generic punctuation.
  const cjkScriptCount = analysis.cjkCount + analysis.hiraganaCount
    + analysis.katakanaCount + analysis.hangulCount;

  if (cjkScriptCount < 2) {
    return {
      isTargetLang: false,
      reason: `too few CJK script chars (${cjkScriptCount})`,
      analysis,
    };
  }

  switch (langGroup) {
    case 'zh': {
      // Use actual CJK ideograph count, not including generic punctuation
      if (analysis.cjkCount >= 2) {
        return {
          isTargetLang: true,
          reason: `CJK: ${analysis.cjkCount} ideograph chars detected`,
          analysis,
        };
      }
      break;
    }
    case 'ja': {
      const jaTotal =
        analysis.hiraganaCount + analysis.katakanaCount + analysis.cjkCount;
      if (jaTotal >= 2) {
        return {
          isTargetLang: true,
          reason: `Japanese: ${jaTotal} chars (${analysis.hiraganaCount} hira, ${analysis.katakanaCount} kata, ${analysis.cjkCount} cjk)`,
          analysis,
        };
      }
      break;
    }
    case 'ko': {
      if (analysis.hangulCount >= 2) {
        return {
          isTargetLang: true,
          reason: `Korean: ${analysis.hangulCount} hangul chars`,
          analysis,
        };
      }
      break;
    }
  }

  return {
    isTargetLang: false,
    reason: `below threshold for ${langGroup}`,
    analysis,
  };
}
