/**
 * Test ScreenCapturer service
 * NOTE: captureScreen() will crash in WSL2, so we only test getMonitorList() and getPrimaryMonitorSize()
 */

import { ScreenCapturer } from '../../src/main/services/capturer';

describe('ScreenCapturer', () => {
  let capturer: ScreenCapturer;

  beforeAll(() => {
    capturer = new ScreenCapturer();
  });

  describe('getMonitorList', () => {
    it('should return array of monitors', () => {
      const monitors = capturer.getMonitorList();
      expect(Array.isArray(monitors)).toBe(true);
    });

    it('should return monitors with correct structure', () => {
      const monitors = capturer.getMonitorList();
      if (monitors.length > 0) {
        const monitor = monitors[0];
        expect(monitor).toHaveProperty('id');
        expect(monitor).toHaveProperty('width');
        expect(monitor).toHaveProperty('height');
        expect(monitor).toHaveProperty('scaleFactor');

        expect(typeof monitor.id).toBe('number');
        expect(typeof monitor.width).toBe('number');
        expect(typeof monitor.height).toBe('number');
        expect(typeof monitor.scaleFactor).toBe('number');

        expect(monitor.width).toBeGreaterThan(0);
        expect(monitor.height).toBeGreaterThan(0);
        expect(monitor.scaleFactor).toBeGreaterThan(0);
      }
    });
  });

  describe('getPrimaryMonitorSize', () => {
    it('should return size object', () => {
      const size = capturer.getPrimaryMonitorSize();
      expect(size).toHaveProperty('width');
      expect(size).toHaveProperty('height');
    });

    it('should return valid dimensions', () => {
      const size = capturer.getPrimaryMonitorSize();
      expect(typeof size.width).toBe('number');
      expect(typeof size.height).toBe('number');
      expect(size.width).toBeGreaterThan(0);
      expect(size.height).toBeGreaterThan(0);
    });
  });

  describe('captureScreen', () => {
    it.skip('should crash in WSL2 - skip test', () => {
      // This test is skipped because captureImageSync() crashes in WSL2
      // It will work on Windows with actual display
      const buffer = capturer.captureScreen(0);
      expect(Buffer.isBuffer(buffer)).toBe(true);
      expect(buffer.length).toBeGreaterThan(0);
    });
  });
});
