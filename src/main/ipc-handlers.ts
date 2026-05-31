import { ipcMain, BrowserWindow } from 'electron';
import { Pipeline } from './services/pipeline';
import { ConfigService } from './services/config';
import { IPC_INVOKES, IPC_CHANNELS } from '../shared/protocol';
import { AppConfig } from '../shared/types';

export function registerIpcHandlers(
  pipeline: Pipeline,
  configService: ConfigService,
  getOverlayWindow: () => BrowserWindow | null,
): void {
  ipcMain.handle(IPC_INVOKES.PIPELINE_START, async () => {
    console.log('[ipc] Pipeline start requested');
    await pipeline.start();
    return { success: true };
  });

  ipcMain.handle(IPC_INVOKES.PIPELINE_STOP, () => {
    console.log('[ipc] Pipeline stop requested');
    pipeline.stop();
    return { success: true };
  });

  ipcMain.handle(IPC_INVOKES.CONFIG_GET, () => {
    return configService.getConfig();
  });

  ipcMain.handle(IPC_INVOKES.CONFIG_UPDATE, (_event, config: Partial<AppConfig>) => {
    console.log('[ipc] Config update requested');

    // 1. Persist and update in-memory config
    configService.updateConfig(config);

    // 2. Get the full merged config
    const fullConfig = configService.getConfig();

    // 3. Propagate to TranslatorService (engine, language changes)
    pipeline.getTranslator().updateConfig(fullConfig.translation);

    // 4. Propagate to Pipeline (interval changes, and configService is updated)
    pipeline.updateConfig(fullConfig);

    // 5. Propagate to Overlay (font, opacity changes)
    const overlay = getOverlayWindow();
    if (overlay && !overlay.isDestroyed()) {
      overlay.webContents.send(IPC_CHANNELS.OVERLAY_CONFIG, fullConfig.overlay);
      console.log('[ipc] Overlay config sent');
    }

    return { success: true };
  });

  ipcMain.handle(IPC_INVOKES.BERGAMOT_GET_STATUS, () => {
    return pipeline.getTranslator().getBergamotStatus();
  });

  console.log('[ipc] Handlers registered');
}
