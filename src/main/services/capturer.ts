import { MonitorInfo } from '../../shared/types';

/**
 * Screen capture service using node-screenshots package
 *
 * Platform support:
 * - Windows: Full support via GDI+
 * - macOS: Full support via CGDisplayCreateImage
 * - Linux: Full support via XCB/Wayland (requires libxcb, libxrandr, dbus)
 *
 * WSL2 Limitations:
 * - Monitor.all() and property methods work fine
 * - captureImageSync() will CRASH the process in WSL2 due to Wayland protocol issues
 * - The actual screenshot functionality must be tested on Windows
 */
export class ScreenCapturer {
  /**
   * Capture the primary screen and return PNG buffer.
   * Uses Electron's screen API to identify the primary monitor,
   * then matches it with node-screenshots Monitor by position.
   */
  captureScreen(_monitorIndex: number = 0): Buffer {
    const { Monitor } = require('node-screenshots');
    const { screen } = require('electron');

    const primaryDisplay = screen.getPrimaryDisplay();
    const { x: primaryX, y: primaryY } = primaryDisplay.bounds;

    console.log(`[capturer] Primary display bounds: x=${primaryX}, y=${primaryY}, ${primaryDisplay.size.width}x${primaryDisplay.size.height}`);

    const monitors = Monitor.all();
    if (monitors.length === 0) {
      throw new Error('[capturer] No monitors found');
    }

    // Log all monitors for debugging
    for (let i = 0; i < monitors.length; i++) {
      const m = monitors[i];
      console.log(`[capturer] Monitor ${i}: ${m.width()}x${m.height()} at (${m.x()}, ${m.y()})`);
    }

    // Find the monitor that matches the primary display position
    let monitor = monitors[0];
    for (const m of monitors) {
      // Match by position (x, y) to find the correct primary monitor
      if (m.x() === primaryX && m.y() === primaryY) {
        monitor = m;
        console.log(`[capturer] Matched primary monitor by position (${primaryX},${primaryY})`);
        break;
      }
    }

    console.log(`[capturer] Capturing monitor: ${monitor.width()}x${monitor.height()} at (${monitor.x()}, ${monitor.y()})`);

    const image = monitor.captureImageSync();
    const buffer = image.toPngSync();
    console.log(`[capturer] Captured ${buffer.length} bytes`);

    return buffer;
  }

  /**
   * Get list of available monitors
   * @returns Array of monitor information
   */
  getMonitorList(): MonitorInfo[] {
    const { Monitor } = require('node-screenshots');

    console.log(`[capturer] Getting monitor list...`);
    const monitors = Monitor.all();

    if (monitors.length === 0) {
      console.log('[capturer] No monitors found, returning empty list');
      return [];
    }

    const result = monitors.map((m: any, i: number) => {
      // These are method calls, not properties
      // Verified: width(), height(), scaleFactor() work in WSL2
      const info: MonitorInfo = {
        id: i,
        width: m.width(),
        height: m.height(),
        scaleFactor: m.scaleFactor() ?? 1.0,
      };
      console.log(`[capturer] Monitor ${i}: ${info.width}x${info.height} scale=${info.scaleFactor}`);
      return info;
    });

    return result;
  }

  /**
   * Get primary monitor size
   * @returns Width and height of primary monitor
   */
  getPrimaryMonitorSize(): { width: number; height: number } {
    // Use Electron's screen API for consistent primary display info
    const { screen } = require('electron');
    const primaryDisplay = screen.getPrimaryDisplay();
    const { width, height } = primaryDisplay.bounds;
    console.log(`[capturer] Primary monitor size (Electron): ${width}x${height}`);
    return { width, height };
  }
}

// Singleton instance
export const screenCapturer = new ScreenCapturer();
