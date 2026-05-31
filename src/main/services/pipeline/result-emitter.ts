import { BrowserWindow } from 'electron';
import type { TranslationItem, TranslationFrame, PipelineStatus } from '../../../shared/types';
import { IPC_CHANNELS } from '../../../shared/protocol';

/**
 * ResultEmitter handles IPC communication with the renderer.
 * Encapsulates the BrowserWindow reference and provides typed emission methods.
 */
export class ResultEmitter {
  private mainWindow: BrowserWindow | null = null;

  /**
   * Set the main window reference for IPC communication.
   */
  setMainWindow(win: BrowserWindow): void {
    this.mainWindow = win;
    console.log('[result-emitter] Main window set');
  }

  /**
   * Emit translation results to the renderer via IPC.
   */
  emitResults(items: TranslationItem[], processingTime: number, locked: boolean): void {
    if (!this.mainWindow || this.mainWindow.isDestroyed()) return;

    const frame: TranslationFrame = {
      results: items,
      timestamp: Date.now(),
      processingTime,
      locked,
    };

    this.mainWindow.webContents.send(IPC_CHANNELS.PIPELINE_RESULTS, frame);
    console.log(`[result-emitter] Emitted ${items.length} items to renderer (locked=${locked})`);
  }

  /**
   * Emit pipeline status to renderer.
   */
  emitStatus(status: PipelineStatus): void {
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.webContents.send(IPC_CHANNELS.PIPELINE_STATUS, status);
      console.log('[result-emitter] Status emitted:', status);
    }
  }

  /**
   * Check if the main window is available and not destroyed.
   */
  isAvailable(): boolean {
    return this.mainWindow !== null && !this.mainWindow.isDestroyed();
  }
}
