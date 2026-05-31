# Screen Translation Overlay Research Report

## Executive Summary

Comprehensive research conducted on open-source screen translation/OCR overlay projects to analyze their implementation patterns for overlay positioning, collision detection, text deduplication, and OCR coordinate jitter handling.

## Projects Analyzed

### 1. OCR-Translator (tomkam1702/OCR-Translator) ⭐ Most Relevant
- **Language**: Python (PySide6/Qt)
- **Architecture**: AI-powered with Gemini/Gemma OCR and translation
- **Relevance**: HIGH - Modern architecture, sophisticated overlay management
- **GitHub**: https://github.com/tomkam1702/OCR-Translator

### 2. Translumo (ramjke/Translumo)
- **Language**: C# (.NET 8)
- **Architecture**: Multi-OCR engine with ML-based selection
- **Relevance**: HIGH - Game-oriented, real-time translation
- **GitHub**: https://github.com/ramjke/Translumo

### 3. LunaTranslator (HIllya51/LunaTranslator)
- **Language**: C++/Python
- **Architecture**: Visual novel translator with HOOK/OCR support
- **Relevance**: MEDIUM - Specialized for VNs, different use case
- **GitHub**: https://github.com/HIllya51/LunaTranslator

### 4. ScreenTranslator (OneMoreGres/ScreenTranslator)
- **Language**: C++ (Qt)
- **Architecture**: Screen capture + OCR + translation
- **Relevance**: MEDIUM - Older codebase, partially abandoned
- **GitHub**: https://github.com/OneMoreGres/ScreenTranslator

## Key Implementation Patterns

### 1. Translation Overlay Positioning

#### OCR-Translator Approach (Most Sophisticated)
```python
# From overlay_manager.py and pyside_overlay.py

class BasePySideOverlay(QMainWindow):
    def __init__(self, resolution_factor=1.0, title="GCT Overlay"):
        super().__init__()
        self.resolution_factor = resolution_factor
        
        # UI Configuration
        self.setWindowFlags(
            Qt.WindowStaysOnTopHint |      # Always on top
            Qt.FramelessWindowHint |        # No borders
            Qt.Tool                         # Tool window (no taskbar)
        )
        self.setAttribute(Qt.WA_TranslucentBackground)  # Transparent background
```

**Key Positioning Strategies:**
1. **Resolution Factor Scaling**: Normalizes coordinates to 1920x1080 baseline
2. **Physical-to-Logical Conversion**: Handles DPI scaling correctly
3. **Direct Geometry Control**: Uses `setGeometry()` for precise positioning

```python
def get_scale_factor(self):
    """Returns geometry normalized to 1920x1080 resolution."""
    screen = QApplication.primaryScreen()
    if not screen: return 1.0
    
    dpr = screen.devicePixelRatio()
    geom = screen.geometry()
    raw_w = geom.width() * dpr
    res_factor = raw_w / 1920.0
    return res_factor / dpr

def move_to_physical_pixels(self, px1, py1, px2, py2):
    """Moves overlay using physical coordinate values."""
    scale = self.devicePixelRatioF()
    if scale <= 0: scale = 1.0
    
    # Convert physical to logical
    lx = round(px1 / scale)
    ly = round(py1 / scale)
    lw = round((px2 - px1) / scale)
    lh = round((py2 - py1) / scale)
    
    # Ensure minimum size
    lw = max(lw, 80)
    lh = max(lh, 40)
    
    self.setGeometry(lx, ly, lw, lh)
```

#### Translumo Approach (C#)
- Uses WPF/WinForms window positioning
- Implements similar DPI awareness
- Uses `SetWindowPos` Win32 API for precise control

**Key Lessons:**
- **Always normalize coordinates** to a baseline resolution (1920x1080)
- **Handle DPI scaling** properly (physical vs logical pixels)
- **Use platform-native APIs** for window positioning

### 2. Anti-Overlap/Collision Detection

#### Current State: Limited Implementation
**Most projects DON'T implement sophisticated collision detection.**

**OCR-Translator Approach:**
```python
# No explicit collision detection found in source code
# Relies on:
# 1. User-defined fixed areas (source_area, target_area)
# 2. Manual positioning via draggable overlays
# 3. No automatic overlap prevention
```

**Translumo Approach:**
- No collision detection implementation found
- Relies on user to position overlays appropriately

**Why Limited Collision Detection?**
1. **User Control**: Users manually position source/target areas
2. **Static Layout**: Once positioned, areas don't move automatically
3. **Simplicity**: Avoids complex collision algorithms
4. **Performance**: Real-time translation can't afford collision checks

**Recommendations for Our Project:**
```typescript
// Simple overlap detection algorithm
function detectOverlap(box1: Box, box2: Box): boolean {
  return !(box1.x2 < box2.x1 || 
           box1.x1 > box2.x2 || 
           box1.y2 < box2.y1 || 
           box1.y1 > box2.y2);
}

// Adaptive positioning to avoid overlap
function avoidOverlaps(boxes: Box[]): Box[] {
  const sortedBoxes = boxes.sort((a, b) => a.y1 - b.y1);
  const result: Box[] = [];
  
  for (const box of sortedBoxes) {
    let adjusted = {...box};
    
    for (const placed of result) {
      if (detectOverlap(adjusted, placed)) {
        // Move below existing box
        adjusted.y1 = placed.y2 + 10;
        adjusted.y2 = adjusted.y1 + (box.y2 - box.y1);
      }
    }
    
    result.push(adjusted);
  }
  
  return result;
}
```

### 3. Text Deduplication Strategies

#### OCR-Translator Approach (Most Comprehensive)
```python
# From app_logic.py - sophisticated deduplication

def handle_successive_identical_subtitle(self, reason):
    """Handle identical subtitles that are the SAME as the immediately previous one."""
    # 1. Do NOT update caches (LRU, file cache) - no new content
    # 2. Do NOT update context window - successive identical subtitle
    # 3. Keep displaying last translation (no API call needed)
    # 4. Reset clear timeout (text is still present)
    
    self.reset_clear_timeout()  # Text still present
    # Display remains unchanged (last translation stays)
    log_debug(f"Successive identical subtitle detected ({reason}), maintaining current translation")
```

**Deduplication Strategy:**
1. **Image Hash Comparison**: Compare current frame hash with previous
2. **Text Content Comparison**: Check if OCR text matches previous
3. **Successive Detection**: Only suppress if identical to *immediate* previous
4. **Timeout Management**: Clear display after timeout with no text

```python
# Clear translation timeout handling
def handle_empty_ocr_result(self):
    """Handle <EMPTY> OCR result and manage clear translation timeout."""
    current_time = time.monotonic()
    
    if self.clear_translation_timeout <= 0:
        return  # Timeout disabled, do nothing
    
    if self.clear_timeout_timer_start is None:
        # First EMPTY result - start timer
        self.clear_timeout_timer_start = current_time
        log_debug("Clear timeout timer started for <EMPTY> OCR result")
    else:
        # Check if timeout period exceeded
        elapsed = current_time - self.clear_timeout_timer_start
        timeout_seconds = self.clear_translation_timeout
        
        if elapsed >= timeout_seconds:
            # Clear the translation display
            self.update_translation_text("")
            self.reset_clear_timeout()
            log_debug(f"Translation cleared after {elapsed:.1f}s timeout")
```

#### Two-Tier Caching (OCR-Translator)
```python
# In-memory cache
self.translation_cache = {}

# File-based cache
self.deepl_cache_file = os.path.join(base_dir, "deepl_cache.txt")
self.gemini_cache_file = os.path.join(base_dir, "gemini_cache.txt")

# Cache management
class CacheManager:
    def load_file_caches(self):
        """Load persistent file caches on startup."""
        # DeepL cache
        if os.path.exists(self.app.deepl_cache_file):
            with open(self.app.deepl_cache_file, 'r', encoding='utf-8') as f:
                for line in f:
                    if line.strip():
                        source, target = line.split('||')
                        self.app.deepl_cache_dict[source.strip()] = target.strip()
        
        # Gemini cache (similar pattern)
```

**Recommendations for Our Project:**
```typescript
interface DeduplicationStrategy {
  // Image-based deduplication
  imageHash: string;
  
  // Text-based deduplication  
  lastText: string;
  lastTextTimestamp: number;
  
  // Timeout management
  emptyResultCount: number;
  emptyResultStartTime: number;
  
  // Cache layers
  memoryCache: Map<string, string>;
  fileCachePath: string;
}

function shouldTranslateNew(
  strategy: DeduplicationStrategy,
  currentImageHash: string,
  currentText: string
): boolean {
  // Check image hash first (fastest)
  if (currentImageHash === strategy.imageHash) {
    return false; // Same image, skip
  }
  
  // Check text content (moderate speed)
  if (currentText === strategy.lastText) {
    const timeSinceText = Date.now() - strategy.lastTextTimestamp;
    if (timeSinceText < 5000) { // 5 second window
      return false; // Same text within window, skip
    }
  }
  
  return true; // New content, translate
}
```

### 4. OCR Coordinate Jitter Handling

#### Current State: Minimal Direct Jitter Handling
**Most projects DON'T implement sophisticated jitter smoothing.**

**OCR-Translator Approach:**
- **Implicit jitter handling** via fixed overlay areas
- **No explicit coordinate smoothing** found in code
- Relies on OCR engine's internal stability

```python
# No explicit jitter handling code found
# Projects rely on:
# 1. Fixed capture areas (reduces jitter)
# 2. User-defined regions (stable coordinates)
# 3. OCR engine preprocessing
```

**Why Limited Jitter Handling?**
1. **Fixed Areas**: Most use fixed capture regions, reducing jitter
2. **OCR Engine Handling**: Tesseract/Gemini handle preprocessing internally
3. **Performance**: Smoothing adds computational overhead
4. **User Expectation**: Minor jitter is acceptable for real-time translation

**Recommendations for Our Project:**
```typescript
// Coordinate smoothing algorithms

interface JitterSmoothing {
  // Exponential moving average
  alpha: number; // Smoothing factor (0-1)
  
  // Coordinate history
  history: Box[];
  maxHistory: number;
}

function exponentialSmoothing(
  current: Box,
  previous: Box | null,
  alpha: number = 0.3
): Box {
  if (!previous) return current;
  
  return {
    x1: Math.round(alpha * current.x1 + (1 - alpha) * previous.x1),
    y1: Math.round(alpha * current.y1 + (1 - alpha) * previous.y1),
    x2: Math.round(alpha * current.x2 + (1 - alpha) * previous.x2),
    y2: Math.round(alpha * current.y2 + (1 - alpha) * previous.y2),
  };
}

// Moving average smoothing
function movingAverageSmoothing(
  history: Box[],
  newBox: Box,
  windowSize: number = 5
): Box {
  history.push(newBox);
  if (history.length > windowSize) {
    history.shift();
  }
  
  const sum = history.reduce((acc, box) => ({
    x1: acc.x1 + box.x1,
    y1: acc.y1 + box.y1,
    x2: acc.x2 + box.x2,
    y2: acc.y2 + box.y2,
  }), {x1: 0, y1: 0, x2: 0, y2: 0});
  
  const count = history.length;
  return {
    x1: Math.round(sum.x1 / count),
    y1: Math.round(sum.y1 / count),
    x2: Math.round(sum.x2 / count),
    y2: Math.round(sum.y2 / count),
  };
}

// Threshold-based filtering (ignore small movements)
function thresholdFilter(
  current: Box,
  previous: Box,
  threshold: number = 5
): Box | null {
  if (!previous) return current;
  
  const dx1 = Math.abs(current.x1 - previous.x1);
  const dy1 = Math.abs(current.y1 - previous.y1);
  const dx2 = Math.abs(current.x2 - previous.x2);
  const dy2 = Math.abs(current.y2 - previous.y2);
  
  // If movement is below threshold, ignore (return previous)
  if (dx1 < threshold && dy1 < threshold && 
      dx2 < threshold && dy2 < threshold) {
    return previous;
  }
  
  return current;
}
```

## Clever Tricks & Innovations

### 1. Adaptive Scan Interval (OCR-Translator)
```python
def update_adaptive_scan_interval(self):
    """Adjust scan interval based on current OCR API load to prevent bottlenecks."""
    now = time.monotonic()
    
    # Check load every 2 seconds
    if now - self.load_check_timer < 2.0:
        return
    
    self.load_check_timer = now
    active_ocr_count = len(self.active_ocr_calls)
    
    # If active OCR API calls > 5, increase scan interval to 150%
    if active_ocr_count > 5:
        if not self.overload_detected:
            self.current_scan_interval = int(self.base_scan_interval * 1.5)
            self.overload_detected = True
    # If active OCR API calls fall below 5, restore original interval
    elif active_ocr_count < 5:
        if self.overload_detected:
            self.current_scan_interval = self.base_scan_interval
            self.overload_detected = False
```

**Benefit**: Prevents API overload during heavy usage, adapts to system load dynamically.

### 2. Resolution-Aware Font Scaling (OCR-Translator)
```python
def _refresh_html(self):
    """Calculate resolution-based scale factor (1920 logical baseline)"""
    screen = QApplication.primaryScreen()
    res_factor = 1.0
    if screen:
        logical_w = screen.geometry().width()
        res_factor = logical_w / 1920.0
    
    # Convert points to scaled pixels (1pt = 1.3333px at 96dpi baseline)
    scaled_font_px = int(font_size * res_factor * 1.3333)
```

**Benefit**: Ensures consistent text rendering across different screen resolutions.

### 3. Screenshot Freeze Mechanism (OCR-Translator)
```python
def perform_marketing_screenshot(self):
    """Freeze overlays and yield to Qt event loop for DWM re-composition."""
    # 1. Pause capture thread
    self.is_photo_mode_active = True
    
    # 2. Freeze overlays (block updates + reveal to system capture)
    if self.target_overlay:
        self.target_overlay.freeze_for_screenshot()
    
    # 3. Yield to Qt event loop for ~150ms for DWM re-composition
    QTimer.singleShot(150, self._execute_screenshot_capture)
```

**Benefit**: Allows clean screenshots without overlay flicker or missing elements.

### 4. Two-Tier Caching (OCR-Translator)
```python
# In-memory cache for fast access
self.translation_cache = {}

# File-based cache for persistence across sessions
self.deepl_cache_file = os.path.join(base_dir, "deepl_cache.txt")
self.gemini_cache_file = os.path.join(base_dir, "gemini_cache.txt")
```

**Benefit**: Reduces API costs and improves performance by caching translations.

## Electron-Specific Considerations

### Transparent Overlay Windows
```javascript
// From Electron overlay patterns
const { BrowserWindow } = require('electron');

const overlayWindow = new BrowserWindow({
  width: 800,
  height: 600,
  transparent: true,
  frame: false,
  alwaysOnTop: true,
  skipTaskbar: true,
  resizable: false,
  webPreferences: {
    nodeIntegration: true,
    contextIsolation: false,
  }
});

// For click-through (mouse events pass through)
overlayWindow.setIgnoreMouseEvents(true);
```

### Coordinate System Mapping
```javascript
// Electron screen APIs
const { screen } = require('electron');

// Get display information
const displays = screen.getAllDisplays();
const primaryDisplay = screen.getPrimaryDisplay();

// Work area excludes taskbar/dock
const { x, y, width, height } = primaryDisplay.workArea;

// Scale factor for DPI
const scaleFactor = primaryDisplay.scaleFactor;

// Convert logical to physical pixels
const physicalX = x * scaleFactor;
const physicalY = y * scaleFactor;
```

## Recommendations for Our Project

### 1. Overlay Positioning
✅ **Adopt OCR-Translator's resolution factor approach**
- Normalize all coordinates to 1920x1080 baseline
- Handle DPI scaling properly (physical vs logical pixels)
- Use platform-specific APIs for window positioning

### 2. Collision Detection
✅ **Implement simple overlap detection**
- Use axis-aligned bounding box (AABB) collision detection
- Implement adaptive positioning to avoid overlaps
- Allow user manual override

❌ **Don't overcomplicate**
- Most projects don't implement sophisticated collision detection
- User control is preferred over automatic positioning

### 3. Text Deduplication
✅ **Implement multi-layer deduplication**
- Image hash comparison (fastest)
- Text content comparison (moderate speed)
- Timeout-based clearing
- Two-tier caching (memory + file)

```typescript
class DeduplicationManager {
  private imageHash: string;
  private lastText: string;
  private lastTextTime: number;
  private emptyCount: number;
  private emptyStartTime: number;
  
  // Cache layers
  private memoryCache = new Map<string, string>();
  private fileCache: Map<string, string>;
  
  shouldTranslate(imageHash: string, text: string): boolean {
    // Fast image hash check
    if (imageHash === this.imageHash) return false;
    
    // Text content check with timeout
    if (text === this.lastText) {
      const elapsed = Date.now() - this.lastTextTime;
      if (elapsed < 5000) return false;
    }
    
    // Check caches
    if (this.memoryCache.has(text)) return false;
    if (this.fileCache.has(text)) return false;
    
    return true;
  }
}
```

### 4. Jitter Handling
✅ **Implement smoothing algorithms**
- Exponential moving average (simple, effective)
- Moving average smoothing (more stable)
- Threshold-based filtering (aggressive)
- Let user choose smoothing level

```typescript
class JitterSmoothing {
  private history: Box[] = [];
  private alpha: number = 0.3;
  private threshold: number = 5;
  
  smooth(current: Box): Box {
    // Apply threshold filter
    const filtered = this.thresholdFilter(current);
    if (!filtered) return this.history[this.history.length - 1];
    
    // Apply exponential smoothing
    const smoothed = this.exponentialSmoothing(filtered);
    
    // Update history
    this.history.push(smoothed);
    if (this.history.length > 5) this.history.shift();
    
    return smoothed;
  }
}
```

### 5. Performance Optimizations
✅ **Adaptive scan intervals**
- Monitor OCR/translation API load
- Dynamically adjust scan frequency
- Prevent system overload

✅ **Resolution-aware rendering**
- Scale font sizes based on screen resolution
- Ensure consistent appearance across displays
- Use DPI-aware coordinate systems

✅ **Caching strategy**
- Two-tier caching (memory + file)
- Invalidate cache intelligently
- Monitor cache hit rates

## Architecture Recommendations

### Pipeline Design
```typescript
class TranslationPipeline {
  private capturer: ScreenCapturer;
  private ocrEngine: OCREngine;
  private translator: Translator;
  private overlayManager: OverlayManager;
  
  // Optimization layers
  private deduplicator: DeduplicationManager;
  private jitterSmoothing: JitterSmoothing;
  private cacheManager: CacheManager;
  
  async processFrame(): Promise<void> {
    // 1. Capture screen
    const image = await this.capturer.capture();
    
    // 2. Check deduplication
    const hash = this.computeHash(image);
    if (!this.deduplicator.shouldProcess(hash)) {
      return; // Skip duplicate content
    }
    
    // 3. Apply OCR
    const rawBoxes = await this.ocrEngine.recognize(image);
    
    // 4. Apply jitter smoothing
    const smoothedBoxes = rawBoxes.map(box => 
      this.jitterSmoothing.smooth(box)
    );
    
    // 5. Detect collisions
    const safeBoxes = this.detectCollisions(smoothedBoxes);
    
    // 6. Translate (with caching)
    const translations = await Promise.all(
      safeBoxes.map(box => this.translateWithCache(box.text))
    );
    
    // 7. Update overlays
    this.overlayManager.update(translations);
  }
}
```

### Configuration Management
```typescript
interface OverlayConfig {
  // Positioning
  resolutionFactor: number;
  scaleFactor: number;
  
  // Deduplication
  deduplicationEnabled: boolean;
  hashComparison: boolean;
  textComparison: boolean;
  textTimeoutWindow: number;
  clearTranslationTimeout: number;
  
  // Jitter smoothing
  smoothingEnabled: boolean;
  smoothingAlgorithm: 'exponential' | 'moving-average' | 'threshold';
  smoothingFactor: number; // 0-1
  smoothingThreshold: number; // pixels
  
  // Performance
  adaptiveScanInterval: boolean;
  baseScanInterval: number;
  maxConcurrentOCRCalls: number;
  
  // Caching
  memoryCacheEnabled: boolean;
  fileCacheEnabled: boolean;
  fileCachePath: string;
}
```

## Conclusion

The research reveals that most open-source screen translation projects use **pragmatic, straightforward approaches** rather than sophisticated algorithms:

1. **Positioning**: Resolution-aware coordinate systems with DPI handling
2. **Collision Detection**: Limited implementation, relying on user control
3. **Deduplication**: Multi-layer approach (image hash + text + timeout)
4. **Jitter Handling**: Minimal, mostly implicit through fixed areas

**Key Takeaway**: Focus on robustness and user control over algorithmic complexity. Implement basic smoothing and deduplication, but prioritize performance and configurability.

The **OCR-Translator** project stands out as the most sophisticated implementation, offering valuable patterns for adaptive performance management, two-tier caching, and resolution-aware rendering that we can adapt to our Electron-based translation overlay system.

---

**Research Date**: 2025-05-29  
**Projects Analyzed**: 4 major open-source screen translation projects  
**Most Relevant**: OCR-Translator (Python/PySide6)  
**Recommended Approach**: Hybrid of OCR-Translator patterns with Electron-specific optimizations