import { OcrResult, TextBlock, OcrGroupingConfig } from '../../shared/types';

/**
 * Detect if a text line ends with a sentence-ending marker.
 * Includes period, question mark, exclamation mark, and their Chinese equivalents.
 */
function endsWithSentenceEnd(text: string): boolean {
  const trimmed = text.trimEnd();
  if (trimmed.length === 0) return false;
  const lastChar = trimmed[trimmed.length - 1];
  return '.!?。！？'.includes(lastChar);
}

/**
 * Detect if two line ranges overlap vertically (used for column detection).
 * Returns true if the Y ranges overlap significantly.
 */
function yRangesOverlap(
  y1: number, h1: number,
  y2: number, h2: number,
): boolean {
  const bottom1 = y1 + h1;
  const bottom2 = y2 + h2;
  const overlapStart = Math.max(y1, y2);
  const overlapEnd = Math.min(bottom1, bottom2);
  // At least 50% of the shorter line's height overlaps
  const minHeight = Math.min(h1, h2);
  return (overlapEnd - overlapStart) > minHeight * 0.5;
}

/**
 * Check if two lines are in separate columns.
 * Lines in separate columns have overlapping Y ranges but non-overlapping X ranges
 * with a significant horizontal gap.
 */
function areInDifferentColumns(
  prev: OcrResult,
  curr: OcrResult,
): boolean {
  const [px, py, pw, ph] = prev.bbox;
  const [cx, cy, cw, ch] = curr.bbox;

  // Must overlap vertically
  if (!yRangesOverlap(py, ph, cy, ch)) return false;

  // Check if X ranges are separated (no horizontal overlap)
  const prevRight = px + pw;
  const currRight = cx + cw;
  const overlapStart = Math.max(px, cx);
  const overlapEnd = Math.min(prevRight, currRight);

  // If there's significant horizontal overlap, they're in the same column
  if (overlapEnd > overlapStart) return false;

  // If there's a significant horizontal gap (> 50px), they're in different columns
  const gap = Math.max(0, cx - prevRight);
  return gap > 50;
}

/**
 * Group OCR lines into TextBlocks with intelligent paragraph, sentence, and column detection.
 *
 * Improvements over basic spatial grouping:
 * 1. Paragraph detection: large vertical gaps start new paragraphs
 * 2. Sentence boundary: incomplete sentences (no ending punctuation) are merged with next line
 * 3. Column detection: lines at same Y position but different X columns are NOT merged
 */
export function groupOcrLines(
  lines: OcrResult[],
  config: OcrGroupingConfig,
): TextBlock[] {
  if (!config.enabled || lines.length === 0) {
    return lines.map((line) => ({
      lines: [line],
      text: line.text,
      bbox: [...line.bbox] as [number, number, number, number],
    }));
  }

  const sorted = [...lines].sort((a, b) => {
    const dy = a.bbox[1] - b.bbox[1];
    if (Math.abs(dy) > 10) return dy;
    return a.bbox[0] - b.bbox[0];
  });

  const blocks: TextBlock[] = [];
  let currentLines: OcrResult[] = [sorted[0]];

  for (let i = 1; i < sorted.length; i++) {
    const prevLine = currentLines[currentLines.length - 1];
    const currLine = sorted[i];

    if (shouldMerge(prevLine, currLine, currentLines, config)) {
      currentLines.push(currLine);
    } else {
      blocks.push(buildTextBlock(currentLines));
      currentLines = [currLine];
    }
  }
  blocks.push(buildTextBlock(currentLines));

  console.log(`[grouping] Grouped ${lines.length} lines into ${blocks.length} text blocks`);
  return blocks;
}

function shouldMerge(
  prev: OcrResult,
  curr: OcrResult,
  currentGroup: OcrResult[],
  config: OcrGroupingConfig,
): boolean {
  const [px, py, pw, ph] = prev.bbox;
  const [cx, cy, cw, ch] = curr.bbox;

  const prevBottom = py + ph;
  const verticalGap = cy - prevBottom;
  const lineHeight = Math.max(ph, ch);

  // Column detection: if lines are in different columns, don't merge
  if (config.detectColumns && areInDifferentColumns(prev, curr)) {
    console.log(`[grouping] Column split: "${prev.text.substring(0, 20)}" vs "${curr.text.substring(0, 20)}"`);
    return false;
  }

  // Paragraph detection: gap > paragraphGapRatio * lineHeight means new paragraph
  const paragraphGap = lineHeight * (config.paragraphGapRatio ?? 2.0);
  if (verticalGap > paragraphGap) {
    return false;
  }

  // Standard proximity check
  const maxVerticalGap = lineHeight * config.verticalThresholdRatio;
  if (verticalGap > maxVerticalGap) return false;

  // Horizontal alignment check (relaxed for same-paragraph lines)
  const horizontalThreshold = config.horizontalThreshold;
  if (Math.abs(px - cx) > horizontalThreshold) return false;

  // Overlap requirement
  if (config.requireOverlap) {
    const overlapStart = Math.max(px, cx);
    const overlapEnd = Math.min(px + pw, cx + cw);
    if (overlapEnd <= overlapStart) return false;
  }

  // Sentence boundary: if the previous line ends a sentence and the next line
  // starts with a capital letter or is indented, start a new group
  if (currentGroup.length > 0 && endsWithSentenceEnd(prev.text)) {
    // Check if current line starts with capital letter (new sentence indicator)
    const currTrimmed = curr.text.trimStart();
    if (currTrimmed.length > 0 && /^[A-Z]/.test(currTrimmed)) {
      // Check if there's a notable gap suggesting paragraph break vs. just new sentence
      if (verticalGap > lineHeight * 0.3) {
        return false;
      }
    }
  }

  return true;
}

function buildTextBlock(lines: OcrResult[]): TextBlock {
  const sorted = [...lines].sort((a, b) => {
    const dy = a.bbox[1] - b.bbox[1];
    if (Math.abs(dy) > 10) return dy;
    return a.bbox[0] - b.bbox[0];
  });

  const text = sorted.map((l) => l.text).join(' ');

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const line of sorted) {
    const [x, y, w, h] = line.bbox;
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x + w);
    maxY = Math.max(maxY, y + h);
  }

  return { lines: sorted, text, bbox: [minX, minY, maxX - minX, maxY - minY] };
}
