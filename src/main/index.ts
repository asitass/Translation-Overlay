import { app, BrowserWindow, screen, Tray, Menu, dialog } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import { ScreenCapturer } from './services/capturer';
import { OcrService } from './services/ocr';
import { TranslatorService } from './services/translator';
import { ChangeDetector } from './services/change-detector';
import { ConfigService } from './services/config';
import { TranslationCache } from './services/cache';
import { Pipeline } from './services/pipeline';
import { registerIpcHandlers } from './ipc-handlers';

const isLinux = process.platform === 'linux';
const isWin = process.platform === 'win32';

if (isLinux) {
  app.commandLine.appendSwitch('enable-transparent-visuals');
  app.commandLine.appendSwitch('no-sandbox');
  app.commandLine.appendSwitch('disable-dev-shm-usage');
}

// Windows transparent overlay needs these flags
if (isWin) {
  app.commandLine.appendSwitch('enable-transparent-visuals');
  app.commandLine.appendSwitch('ignore-gpu-blacklist');
}

let overlayWindow: BrowserWindow | null = null;
let settingsWindow: BrowserWindow | null = null;
let pipeline: Pipeline | null = null;
let tray: Tray | null = null;

// --- File logging for packaged mode debugging (sync to survive crashes) ---
const logFilePath = path.join(app.getPath('userData'), 'app.log');

function log(msg: string): void {
  // console.log is already overridden to write to file, so just call it
  console.log(msg);
}

// Override console.log/warn/error to also write to log file
// so all service logs (pipeline, ocr, translator, etc.) are captured
const origConsoleLog = console.log;
const origConsoleWarn = console.warn;
const origConsoleError = console.error;

// Buffered async log writer — avoids blocking the main thread with sync file I/O.
// Logs are buffered and flushed periodically or when the buffer exceeds a threshold.
const logBuffer: string[] = [];
const LOG_FLUSH_INTERVAL = 2000; // Flush every 2 seconds
const LOG_BUFFER_MAX = 50;       // Flush when buffer exceeds 50 lines
let logFlushTimer: ReturnType<typeof setInterval> | null = null;

function flushLogBuffer(): void {
  if (logBuffer.length === 0) return;
  const content = logBuffer.join('');
  logBuffer.length = 0;
  // Use async write with fire-and-forget (no await to avoid blocking)
  fs.promises.appendFile(logFilePath, content).catch(() => { /* ignore */ });
}

function fileLog(level: string, args: unknown[]): void {
  const ts = new Date().toISOString();
  const msg = args.map(a => typeof a === 'string' ? a : JSON.stringify(a)).join(' ');
  logBuffer.push(`[${ts}] [${level}] ${msg}\n`);
  if (logBuffer.length >= LOG_BUFFER_MAX) {
    flushLogBuffer();
  }
}

// Start periodic flush timer
logFlushTimer = setInterval(flushLogBuffer, LOG_FLUSH_INTERVAL);

console.log = (...args: unknown[]) => { origConsoleLog(...args); fileLog('INFO', args); };
console.warn = (...args: unknown[]) => { origConsoleWarn(...args); fileLog('WARN', args); };
console.error = (...args: unknown[]) => { origConsoleError(...args); fileLog('ERROR', args); };

log('=== App starting ===');
log(`platform: ${process.platform}, arch: ${process.arch}, isPackaged: ${app.isPackaged}`);
log(`app.getPath("userData"): ${app.getPath('userData')}`);
log(`log file: ${logFilePath}`);
log(`__dirname: ${__dirname}`);

// Log proxy configuration (set via HTTPS_PROXY / HTTP_PROXY environment variables)
// Example: HTTPS_PROXY=http://127.0.0.1:7890 npm run dev
if (!process.env.HTTPS_PROXY && !process.env.HTTP_PROXY) {
  log('[main] No proxy configured. Set HTTPS_PROXY or HTTP_PROXY if needed (e.g. for Google Translate API).');
}
log(`[main] Proxy config: HTTPS_PROXY=${process.env.HTTPS_PROXY || 'none'}`);

// Catch uncaught errors — log only, don't show blocking dialog (it freezes the app)
process.on('uncaughtException', (err) => {
  log(`UNCAUGHT EXCEPTION: ${err.stack || err}`);
  // Don't use dialog.showErrorBox here — it blocks the event loop and prevents
  // the app from continuing. Just log the error and let the app recover.
});

process.on('unhandledRejection', (reason) => {
  log(`UNHANDLED REJECTION: ${reason}`);
});

/**
 * Resolve resource path.
 * Electron transparently handles asar paths via __dirname.
 */
function res(...segments: string[]): string {
  return path.join(__dirname, '..', '..', ...segments);
}

function getPreloadPath(): string {
  return path.join(__dirname, '..', 'preload', 'index.js');
}

function createOverlay(): BrowserWindow {
  const primaryDisplay = screen.getPrimaryDisplay();
  // Use full screen bounds (not workArea) so overlay covers entire screen.
  // OCR coordinates are in full-screen space; using workArea would cause
  // bottom-of-screen translations to be clipped by the taskbar offset.
  const { width, height } = primaryDisplay.bounds;

  overlayWindow = new BrowserWindow({
    width,
    height,
    x: 0,
    y: 0,
    transparent: true,
    backgroundColor: '#00000000',
    frame: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    hasShadow: false,
    focusable: false,
    show: false,
    webPreferences: {
      preload: getPreloadPath(),
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  // Windows: set overlay to topmost tool window level
  if (isWin) {
    overlayWindow.setAlwaysOnTop(true, 'screen-saver');
  }

  // Prevent overlay from being captured by screen capturer.
  // On Windows, this sets WDA_EXCLUDEFROMCAPTURE, so node-screenshots
  // will capture the underlying content without the overlay.
  // This breaks the overlay→OCR→overlay feedback loop.
  log(`[overlay] Setting content protection (exclude from capture)...`);
  overlayWindow.setContentProtection(true);
  log(`[overlay] Content protection set. Platform=${process.platform}, isWin=${isWin}`);
  log(`[overlay] NOTE: setContentProtection maps to WDA_EXCLUDEFROMCAPTURE on Windows.`);
  log(`[overlay] If feedback loop persists, the native API may not be respected by node-screenshots.`);
  log(`[overlay] Layer-2 fallback: target-language script detection in pipeline.`);

  overlayWindow.webContents.on('console-message', (_event, level, message) => {
    const prefix = ['VERBOSE', 'INFO', 'WARNING', 'ERROR'][level] ?? 'LOG';
    log(`[overlay:${prefix}] ${message}`);
  });

  overlayWindow.setIgnoreMouseEvents(true, { forward: true });
  const overlayHtml = path.join(__dirname, '..', 'renderer', 'overlay', 'index.html');
  log(`[overlay] Loading: ${overlayHtml}`);
  overlayWindow.loadFile(overlayHtml);

  overlayWindow.once('ready-to-show', () => {
    overlayWindow?.show();
    log('[overlay] Window ready and shown');
  });

  overlayWindow.on('closed', () => { overlayWindow = null; });
  log(`[overlay] Created ${width}x${height}`);
  return overlayWindow;
}

function openSettings(): void {
  if (settingsWindow) {
    settingsWindow.focus();
    return;
  }
  settingsWindow = new BrowserWindow({
    width: 600,
    height: 520,
    title: 'Translation Overlay - Settings',
    show: false,
    webPreferences: {
      preload: getPreloadPath(),
      nodeIntegration: false,
      contextIsolation: true,
    },
  });
  const settingsHtml = path.join(__dirname, '..', 'renderer', 'settings', 'index.html');
  log(`[settings] Loading: ${settingsHtml}`);
  settingsWindow.loadFile(settingsHtml);
  settingsWindow.once('ready-to-show', () => {
    settingsWindow?.show();
    log('[settings] Window shown');
  });
  settingsWindow.on('closed', () => { settingsWindow = null; });
}

function createTray(): void {
  const iconPath = res('build', 'icon.png');
  log(`[tray] Icon path: ${iconPath}, exists: ${fs.existsSync(iconPath)}`);

  if (!fs.existsSync(iconPath)) {
    log('[tray] Icon not found, skipping tray creation');
    return;
  }

  try {
    tray = new Tray(iconPath);
    const contextMenu = Menu.buildFromTemplate([
      { label: 'Show Overlay', click: () => { overlayWindow?.show(); } },
      { label: 'Hide Overlay', click: () => { overlayWindow?.hide(); } },
      { type: 'separator' },
      { label: 'Settings', click: () => openSettings() },
      { type: 'separator' },
      { label: 'Quit', click: () => { app.quit(); } },
    ]);
    tray.setToolTip('Translation Overlay');
    tray.setContextMenu(contextMenu);
    tray.on('click', () => {
      if (overlayWindow) {
        if (overlayWindow.isVisible()) overlayWindow.hide();
        else overlayWindow.show();
      }
    });
    log('[tray] Created successfully');
  } catch (err) {
    log(`[tray] Failed to create tray: ${err}`);
  }
}

app.whenReady().then(async () => {
  try {
    log('[main] App ready, initializing services...');

    // Set Electron session proxy for Chromium network stack (used by net.fetch)
    if (process.env.HTTPS_PROXY) {
      try {
        const { session } = require('electron');
        await session.defaultSession.setProxy({ proxyRules: process.env.HTTPS_PROXY });
        log(`[main] Electron session proxy set: ${process.env.HTTPS_PROXY}`);
      } catch (err) {
        log(`[main] Failed to set session proxy: ${err}`);
      }
    }

    const configPath = res('config', 'default.yaml');
    log(`[main] Config path: ${configPath}, exists: ${fs.existsSync(configPath)}`);

    const configService = new ConfigService(configPath, app.getPath('userData'));
    const config = configService.getConfig();
    log('[main] Config loaded');

    log('[main] Creating capturer...');
    const capturer = new ScreenCapturer();

    log('[main] Creating OCR service...');
    const ocr = new OcrService(
      config.ocr.languages,
      config.ocr.confidenceThreshold,
      config.ocr.downscale,
      config.ocr.preprocessing,
      config.ocr.grouping,
      config.ocr.engine ?? 'auto',
    );

    log('[main] Creating cache...');
    // Resolve relative dbPath to userData directory to avoid UNC path issues on Windows
    const dbPath = path.isAbsolute(config.cache.dbPath)
      ? config.cache.dbPath
      : path.join(app.getPath('userData'), config.cache.dbPath);
    const cache = new TranslationCache(dbPath);
    log('[main] Cache ready');

    log('[main] Creating translator...');
    const translator = new TranslatorService(config.translation, cache);
    log('[main] Translator ready');

    const detector = new ChangeDetector();

    log('[main] Creating pipeline...');
    pipeline = new Pipeline(capturer, ocr, translator, detector, configService, cache);

    log('[main] Creating overlay...');
    const overlay = createOverlay();
    pipeline.setMainWindow(overlay);

    log('[main] Creating tray...');
    createTray();

    log('[main] Registering IPC handlers...');
    registerIpcHandlers(pipeline, configService, () => overlayWindow);

    log('[main] Starting pipeline...');
    await pipeline.start();
    log('[main] Pipeline started');

    log('[main] Opening settings window...');
    openSettings();
    log('[main] Initialization complete');

    screen.on('display-metrics-changed', () => {
      if (overlayWindow) {
        const primaryDisplay = screen.getPrimaryDisplay();
        const { width, height } = primaryDisplay.bounds;
        overlayWindow.setSize(width, height);
      }
    });
  } catch (err) {
    log(`[main] FATAL: Initialization failed: ${err}`);
    dialog.showErrorBox('Translation Overlay - Startup Error', String(err));
    app.quit();
  }
});

app.on('window-all-closed', () => {});

app.on('before-quit', async () => {
  log('[main] Quitting...');
  if (pipeline) {
    await pipeline.terminate();
  }
  if (overlayWindow) overlayWindow.destroy();
});
