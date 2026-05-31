/**
 * Shared renderer types and interfaces
 */

export interface TranslationItem {
  bbox: [number, number, number, number];
  original: string;
  translated: string;
}

export interface TranslationFrame {
  results: TranslationItem[];
  timestamp: number;
  processingTime: number;
}

/**
 * Electron API exposed via preload script
 * Available at window.electronAPI in renderer processes
 */
export interface ElectronAPI {
  platform: string;
  onPipelineResults: (cb: (frame: TranslationFrame) => void) => () => void;
  onPipelineStatus: (cb: (status: string) => void) => () => void;
  onBergamotStatus: (cb: (status: string) => void) => () => void;
  startPipeline: () => Promise<unknown>;
  stopPipeline: () => Promise<unknown>;
  getConfig: () => Promise<Record<string, unknown>>;
  updateConfig: (config: unknown) => Promise<{ success: boolean }>;
  bergamotGetStatus: () => Promise<string>;
  onOverlayConfig: (cb: (config: { fontSize?: number; backgroundOpacity?: number }) => void) => () => void;
}

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}

export {};
