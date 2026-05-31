console.log('[overlay] Starting...');

// Track current overlay config for dynamic updates
type OverlayDisplayMode = 'sideBySide' | 'hover';

let overlayConfig = {
  fontSize: 12,
  backgroundOpacity: 0.45,
  displayMode: 'sideBySide' as OverlayDisplayMode,
};

window.electronAPI.onPipelineStatus((status) => {
  console.log('[overlay] Pipeline status:', status);
});

// Listen for runtime config updates from Settings
window.electronAPI.onOverlayConfig((config) => {
  console.log('[overlay] Config updated:', config);
  const cfg = config as Record<string, unknown>;
  if (cfg.fontSize) overlayConfig.fontSize = cfg.fontSize as number;
  if (cfg.backgroundOpacity !== undefined) overlayConfig.backgroundOpacity = cfg.backgroundOpacity as number;
  if (cfg.displayMode) {
    overlayConfig.displayMode = cfg.displayMode as OverlayDisplayMode;
    // Re-render existing results with new mode
    if (lastRenderedItems) {
      renderTranslations(lastRenderedItems);
    }
  }
});

// Throttle renders to once per animation frame to prevent jank
let pendingItems: Array<{ bbox: [number, number, number, number]; translated: string; confidence?: number }> | null = null;
let rafScheduled = false;
let lastRenderedItems: Array<{ bbox: [number, number, number, number]; translated: string; confidence?: number }> | null = null;
let lastRenderPositionSet: Set<string> = new Set();
let lastRenderTimestamp = 0;
let renderSkipCount = 0;

/**
 * Compute a similarity signature for a set of items.
 * Uses grid-snapped positions + translated text for matching.
 * Items that overlap in position with similar text produce the same signature.
 */
/**
 * Compute position set for overlap-based stability check.
 * Returns a Set of grid-snapped position keys.
 */
function computePositionSet(items: Array<{ bbox: [number, number, number, number] }>): Set<string> {
  const GRID = 40; // 40px grid — aggressive snapping to absorb OCR position jitter
  const set = new Set<string>();
  for (const i of items) {
    const gx = Math.round(i.bbox[0] / GRID);
    const gy = Math.round(i.bbox[1] / GRID);
    set.add(`${gx},${gy}`);
  }
  return set;
}

/**
 * Check if two position sets are similar enough to skip re-rendering.
 * Uses Jaccard-like overlap: intersection / max(|old|, |new|).
 * Threshold: 70% overlap means the layout is essentially the same.
 */
function isLayoutStable(oldSet: Set<string>, newSet: Set<string>): boolean {
  if (oldSet.size === 0 || newSet.size === 0) return false;
  let intersection = 0;
  for (const key of newSet) {
    if (oldSet.has(key)) intersection++;
  }
  const maxSet = Math.max(oldSet.size, newSet.size);
  const similarity = intersection / maxSet;
  return similarity >= 0.7;
}

window.electronAPI.onPipelineResults((frame) => {
  const f = frame as { results: Array<{ bbox: [number, number, number, number]; translated: string; confidence?: number }>; processingTime: number; locked?: boolean };

  // Update lock indicator
  const lockIndicator = document.getElementById('lock-indicator');
  if (lockIndicator) {
    if (f.locked) {
      lockIndicator.classList.add('visible');
    } else {
      lockIndicator.classList.remove('visible');
    }
  }

  // Stability check: skip re-render if layout positions are essentially the same
  const newPosSet = computePositionSet(f.results);
  if (isLayoutStable(lastRenderPositionSet, newPosSet) && !f.locked) {
    renderSkipCount++;
    if (renderSkipCount <= 3) {
      console.log(`[overlay] Skipping re-render (layout stable, skip #${renderSkipCount})`);
    }
    return;
  }

  console.log(`[overlay] Received ${f.results.length} translations in ${f.processingTime}ms (locked=${f.locked ?? false})`);

  // 最小显示时间保护：如果上次渲染不到3秒，跳过非locked帧
  // locked帧总是允许通过（保持lock状态指示器更新）
  const elapsed = Date.now() - lastRenderTimestamp;
  if (lastRenderTimestamp > 0 && elapsed < OVERLAY_MIN_DISPLAY_TIME_MS && !f.locked) {
    console.log(`[overlay] Min display time: ${elapsed}ms < ${OVERLAY_MIN_DISPLAY_TIME_MS}ms, skipping non-locked frame`);
    return;
  }

  pendingItems = f.results;
  lastRenderPositionSet = newPosSet;
  renderSkipCount = 0;

  if (!rafScheduled) {
    rafScheduled = true;
    requestAnimationFrame(() => {
      rafScheduled = false;
      if (pendingItems) {
        renderTranslations(pendingItems);
        lastRenderedItems = pendingItems;
        lastRenderTimestamp = Date.now();
        pendingItems = null;
      }
    });
  }
});

const POOL_SIZE = 50;
const MAX_DISPLACEMENT_PX = 20;
const MAX_SCREEN_RATIO = 0.3;
const OVERLAY_MIN_DISPLAY_TIME_MS = 3000; // 翻译至少显示3秒不替换

// Initialize DOM node pool once (avoid creating/destroying nodes every frame)
const container = document.getElementById('translations');
if (!container) {
  console.error('[overlay] translations container not found!');
}

// Two separate pools: one for side-by-side items, one for hover markers
const sideBySidePool: HTMLDivElement[] = [];
const hoverPool: HTMLDivElement[] = [];

function initPools(): void {
  if (!container) return;
  for (let i = 0; i < POOL_SIZE; i++) {
    // Side-by-side element
    const sbEl = document.createElement('div');
    sbEl.className = 'translation-item';
    sbEl.style.display = 'none';
    container.appendChild(sbEl);
    sideBySidePool.push(sbEl);

    // Hover marker element
    const hEl = document.createElement('div');
    hEl.className = 'hover-marker';
    hEl.style.display = 'none';
    const tooltip = document.createElement('div');
    tooltip.className = 'hover-tooltip';
    hEl.appendChild(tooltip);
    container.appendChild(hEl);
    hoverPool.push(hEl);
  }

  // Lock indicator
  const lockIndicator = document.createElement('div');
  lockIndicator.className = 'lock-indicator';
  lockIndicator.id = 'lock-indicator';
  lockIndicator.textContent = '🔒 Locked';
  container.appendChild(lockIndicator);

  console.log(`[overlay] DOM pools initialized with ${POOL_SIZE} nodes each`);
}

// Initialize pool on load
initPools();

// --- Anti-overlap helpers ---

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Spatial hash grid for O(n) collision detection.
 * Divides the screen into cells and indexes rectangles by the cells they overlap.
 * Query returns only nearby rectangles instead of checking all placed items.
 */
class SpatialHash {
  private cellSize: number;
  private cells: Map<string, Rect[]> = new Map();

  constructor(cellSize: number = 60) {
    this.cellSize = cellSize;
  }

  /** Get the cell keys that a rectangle overlaps */
  private getKeys(rect: Rect): string[] {
    const keys: string[] = [];
    const x0 = Math.floor(rect.x / this.cellSize);
    const y0 = Math.floor(rect.y / this.cellSize);
    const x1 = Math.floor((rect.x + rect.w) / this.cellSize);
    const y1 = Math.floor((rect.y + rect.h) / this.cellSize);
    for (let cx = x0; cx <= x1; cx++) {
      for (let cy = y0; cy <= y1; cy++) {
        keys.push(`${cx},${cy}`);
      }
    }
    return keys;
  }

  /** Insert a rectangle into the spatial hash */
  insert(rect: Rect): void {
    const keys = this.getKeys(rect);
    for (const key of keys) {
      let cell = this.cells.get(key);
      if (!cell) {
        cell = [];
        this.cells.set(key, cell);
      }
      cell.push(rect);
    }
  }

  /** Query for all rectangles that could potentially overlap the given rect */
  query(rect: Rect): Rect[] {
    const keys = this.getKeys(rect);
    const seen = new Set<Rect>();
    const result: Rect[] = [];
    for (const key of keys) {
      const cell = this.cells.get(key);
      if (cell) {
        for (const r of cell) {
          if (!seen.has(r)) {
            seen.add(r);
            result.push(r);
          }
        }
      }
    }
    return result;
  }

  /** Clear all entries */
  clear(): void {
    this.cells.clear();
  }
}

/**
 * Estimate translation render height based on text length, max-width, and font size.
 */
function estimateTranslationHeight(text: string, maxWidth: number, fontSize: number): number {
  const avgCharsPerLine = Math.max(20, Math.floor(maxWidth / (fontSize * 0.6)));
  const lines = Math.ceil(text.length / avgCharsPerLine);
  const lineHeight = Math.round(fontSize * 1.35);
  const padding = 6; // 2px top + 4px bottom (compact)
  return Math.max(18, lines * lineHeight + padding);
}

/**
 * AABB collision detection between two rectangles.
 */
function rectsOverlap(a: Rect, b: Rect): boolean {
  return !(a.x + a.w < b.x || b.x + b.w < a.x ||
           a.y + a.h < b.y || b.y + b.h < a.y);
}

/**
 * Check collision against a set of placed rectangles using spatial hash.
 * Returns true if the candidate overlaps any placed rectangle.
 */
function collidesWithAny(candidate: Rect, spatialHash: SpatialHash): boolean {
  const nearby = spatialHash.query(candidate);
  for (const p of nearby) {
    if (rectsOverlap(candidate, p)) {
      return true;
    }
  }
  return false;
}

/**
 * Get full screen dimensions (matches capturer's coordinate space).
 */
function getScreenSize(): { width: number; height: number } {
  return {
    width: window.screen.width,
    height: window.screen.height,
  };
}

// --- End helpers ---

function renderTranslations(items: Array<{ bbox: [number, number, number, number]; translated: string; confidence?: number }>): void {
  if (!container) return;

  const isHoverMode = overlayConfig.displayMode === 'hover';

  // Filter: skip translations with empty text or invalid bbox
  const meaningful = items.filter(
    (item) => item.translated.trim() !== '' && item.bbox[2] > 0 && item.bbox[3] > 0,
  );

  // Hide all pool elements first
  for (let i = 0; i < POOL_SIZE; i++) {
    sideBySidePool[i].style.display = 'none';
    hoverPool[i].style.display = 'none';
  }

  if (isHoverMode) {
    renderHoverMode(meaningful);
  } else {
    renderSideBySideMode(meaningful);
  }
}

/**
 * Render translations as hover markers with tooltips.
 */
function renderHoverMode(items: Array<{ bbox: [number, number, number, number]; translated: string; confidence?: number }>): void {
  const count = Math.min(items.length, POOL_SIZE);

  for (let i = 0; i < count; i++) {
    const [x, y, w, h] = items[i].bbox;
    const marker = hoverPool[i];
    const tooltip = marker.querySelector('.hover-tooltip') as HTMLDivElement;

    // Place marker at the left edge of the original text, vertically centered
    const markerX = x - 12;
    const markerY = y + h / 2 - 4;

    marker.style.cssText = `
      display: block;
      position: absolute;
      left: 0;
      top: 0;
      transform: translate(${markerX}px, ${markerY}px);
    `;
    tooltip.textContent = items[i].translated;
  }
}

/**
 * Render translations in side-by-side mode with tight positioning below original text.
 */
function renderSideBySideMode(items: Array<{ bbox: [number, number, number, number]; translated: string; confidence?: number }>): void {
  // Smart priority: sort by area × confidence (larger text with higher confidence first)
  const sorted = [...items];
  sorted.sort((a, b) => {
    const areaA = a.bbox[2] * a.bbox[3];
    const areaB = b.bbox[2] * b.bbox[3];
    const confA = a.confidence ?? 50;
    const confB = b.confidence ?? 50;
    return (areaB * confB) - (areaA * confA);
  });

  // Limit by screen area ratio instead of fixed count
  const { height: screenH, width: screenW } = getScreenSize();
  const maxOverlayArea = screenW * screenH * MAX_SCREEN_RATIO;
  let totalArea = 0;
  const toShow: typeof sorted = [];
  for (const item of sorted) {
    const itemArea = item.bbox[2] * 40;
    if (totalArea + itemArea > maxOverlayArea) break;
    totalArea += itemArea;
    toShow.push(item);
  }

  // Re-sort by Y position for top-to-bottom display
  toShow.sort((a, b) => a.bbox[1] - b.bbox[1]);

  // Use spatial hash for O(n) collision detection instead of O(n²)
  const spatialHash = new SpatialHash(60);

  // Resolve positions with anti-overlap greedy algorithm
  const positioned: Array<{
    index: number;
    finalX: number;
    finalY: number;
    maxWidth: number;
    estHeight: number;
    skipped: boolean;
  }> = [];

  for (let i = 0; i < toShow.length; i++) {
    const [x, y, w, h] = toShow[i].bbox;
    const maxWidth = Math.max(w + 20, 100);
    const fontSize = overlayConfig.fontSize;
    const estHeight = estimateTranslationHeight(toShow[i].translated, maxWidth, fontSize);

    // Tight gap - just 2px below original text
    const gap = 2;
    const candidates: Array<{ cx: number; cy: number }> = [
      { cx: x, cy: y + h + gap },                         // Below (preferred, tight)
      { cx: x + w + 4, cy: y },                            // Right side
      { cx: x, cy: y - estHeight - gap },                  // Above fallback
    ];

    let chosenX = candidates[0].cx;
    let chosenY = candidates[0].cy;
    let foundPosition = false;

    // Try each candidate position
    for (const { cx, cy } of candidates) {
      const candidate: Rect = { x: cx, y: cy, w: maxWidth, h: estHeight };

      // Check screen bounds
      if (cy < 0 || cy + estHeight > screenH || cx + maxWidth > screenW) {
        continue;
      }

      // Check displacement limit (tight - keep close to original)
      const origCenterY = y + h / 2;
      const candCenterY = cy + estHeight / 2;
      if (Math.abs(candCenterY - origCenterY) > MAX_DISPLACEMENT_PX) {
        continue;
      }

      // Check collision using spatial hash (O(k) instead of O(n))
      if (!collidesWithAny(candidate, spatialHash)) {
        chosenX = cx;
        chosenY = cy;
        foundPosition = true;
        break;
      }
    }

    // If no candidate worked, try pushing down incrementally from preferred position
    if (!foundPosition) {
      let pushY = y + h + 2;
      const maxY = pushY + MAX_DISPLACEMENT_PX;
      while (pushY + estHeight <= screenH && pushY <= maxY) {
        const candidate: Rect = { x, y: pushY, w: maxWidth, h: estHeight };
        if (!collidesWithAny(candidate, spatialHash)) {
          chosenX = x;
          chosenY = pushY;
          foundPosition = true;
          break;
        }
        pushY += 4;
      }
    }

    const skipped = !foundPosition;

    positioned.push({
      index: i,
      finalX: chosenX,
      finalY: chosenY,
      maxWidth,
      estHeight,
      skipped,
    });

    if (!skipped) {
      spatialHash.insert({ x: chosenX, y: chosenY, w: maxWidth, h: estHeight });
    }
  }

  // Apply to DOM node pool using transform for GPU-accelerated positioning
  let visibleIdx = 0;
  for (let i = 0; i < POOL_SIZE; i++) {
    const el = sideBySidePool[i];

    // Find next non-skipped position
    while (visibleIdx < positioned.length && positioned[visibleIdx].skipped) {
      visibleIdx++;
    }

    if (visibleIdx < positioned.length) {
      const pos = positioned[visibleIdx];
      const item = toShow[pos.index];

      el.style.cssText = `
        display: block;
        position: absolute;
        left: 0;
        top: 0;
        max-width: ${pos.maxWidth}px;
        font-size: ${overlayConfig.fontSize}px;
        background: rgba(0, 0, 0, ${overlayConfig.backgroundOpacity});
        transform: translate(${pos.finalX}px, ${pos.finalY}px);
      `;
      el.textContent = item.translated;
      visibleIdx++;
    } else {
      el.style.display = 'none';
    }
  }

  const visibleCount = positioned.filter((p) => !p.skipped).length;
  const skippedCount = positioned.filter((p) => p.skipped).length;
  if (skippedCount > 0) {
    console.log(`[overlay] Skipped ${skippedCount} translations (collision/overflow), showing ${visibleCount}`);
  }
}
