import { contextBridge, ipcRenderer } from 'electron';

// IPC channel names inlined (preload scripts can't import relative modules)
const CHANNELS = {
  PIPELINE_RESULTS: 'pipeline:results',
  PIPELINE_STATUS: 'pipeline:status',
  BERGAMOT_STATUS: 'bergamot:status',
  OVERLAY_CONFIG: 'overlay:config',
} as const;

const INVOKES = {
  PIPELINE_START: 'pipeline:start',
  PIPELINE_STOP: 'pipeline:stop',
  CONFIG_GET: 'config:get',
  CONFIG_UPDATE: 'config:update',
  BERGAMOT_GET_STATUS: 'bergamot:get-status',
} as const;

contextBridge.exposeInMainWorld('electronAPI', {
  platform: process.platform,

  onPipelineResults: (callback: (frame: unknown) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, frame: unknown) => callback(frame);
    ipcRenderer.on(CHANNELS.PIPELINE_RESULTS, handler);
    return () => ipcRenderer.removeListener(CHANNELS.PIPELINE_RESULTS, handler);
  },

  onPipelineStatus: (callback: (status: string) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, status: string) => callback(status);
    ipcRenderer.on(CHANNELS.PIPELINE_STATUS, handler);
    return () => ipcRenderer.removeListener(CHANNELS.PIPELINE_STATUS, handler);
  },

  onBergamotStatus: (callback: (status: string) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, status: string) => callback(status);
    ipcRenderer.on(CHANNELS.BERGAMOT_STATUS, handler);
    return () => ipcRenderer.removeListener(CHANNELS.BERGAMOT_STATUS, handler);
  },

  startPipeline: () => ipcRenderer.invoke(INVOKES.PIPELINE_START),
  stopPipeline: () => ipcRenderer.invoke(INVOKES.PIPELINE_STOP),

  getConfig: () => ipcRenderer.invoke(INVOKES.CONFIG_GET),
  updateConfig: (config: unknown) => ipcRenderer.invoke(INVOKES.CONFIG_UPDATE, config),

  bergamotGetStatus: () => ipcRenderer.invoke(INVOKES.BERGAMOT_GET_STATUS),

  onOverlayConfig: (callback: (config: { fontSize?: number; backgroundOpacity?: number; displayMode?: string }) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, config: unknown) => callback(config as { fontSize?: number; backgroundOpacity?: number; displayMode?: string });
    ipcRenderer.on(CHANNELS.OVERLAY_CONFIG, handler);
    return () => ipcRenderer.removeListener(CHANNELS.OVERLAY_CONFIG, handler);
  },
});
