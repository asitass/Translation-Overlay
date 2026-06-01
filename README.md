<p align="center">
  <h1 align="center">Translation Overlay | 超即时翻译</h1>
  <p align="center">Translate anything on your screen — in real time</p>
  <p align="center">
    <a href="https://github.com/asitass/Translation-Overlay/releases"><img src="https://img.shields.io/github/v/release/asitass/Translation-Overlay?style=flat-square" alt="Release"></a>
    <a href="LICENSE"><img src="https://img.shields.io/github/license/asitass/Translation-Overlay?style=flat-square" alt="MIT License"></a>
    <a href="https://github.com/asitass/Translation-Overlay/actions"><img src="https://img.shields.io/github/actions/workflow/status/asitass/Translation-Overlay/build.yml?style=flat-square" alt="Build Status"></a>
  </p>
  <p align="center">
    <a href="#features">Features</a> •
    <a href="#use-cases">Use Cases</a> •
    <a href="#vs-other-screen-translators">Comparison</a> •
    <a href="#quick-start">Quick Start</a> •
    <a href="#download">Download</a> •
    <a href="#development-workflow">Dev Workflow</a> •
    <a href="#packaging--distribution">Packaging</a> •
    <a href="#cicd-pipeline">CI/CD</a> •
    <a href="#troubleshooting">Troubleshooting</a>
  </p>
  <p align="center">
    <a href="README.md">🇬🇧 English</a> • <a href="README.zh-CN.md">🇨🇳 中文</a>
  </p>
</p>

<p align="center">
  <img src="docs/demo/4.png" alt="Translation Overlay — game dialog translated in real time" width="720">
</p>

Select any region on your screen. Translation Overlay captures the text with OCR, translates it instantly, and displays the result as a transparent, always-on-top overlay — right where the original text is.

---

## Features

- **Offline Translation** — Bergamot WASM engine runs locally, no internet required
- **4 Translation Engines** — Bergamot (offline), Google Translate, Ollama, DeepL with automatic fallback
- **PaddleOCR + Tesseract** — Dual OCR engine with automatic fallback for robust text recognition
- **Smart Lock Mode** — Detects stable content, locks translation to prevent flickering
- **Intelligent Text Merging** — Detects paragraphs, columns, and sentence boundaries for coherent translations
- **Dual Display Modes** — Side-by-side overlay or hover-to-reveal
- **Cross-Platform** — Windows & Linux (AppImage + NSIS installer)
- **SQLite Cache** — Reuses past translations, zero redundant API calls
- **Fully Configurable** — Hot-reload YAML config + runtime settings UI

---

## Use Cases

| | Scenario | How it helps |
|---|---|---|
| 🎮 | Playing foreign-language games | Translate menus, dialogs, subtitles in real time |
| 📺 | Watching raw anime/dramas | Overlay subtitles directly on the video |
| 📚 | Reading foreign docs/research | OCR + translate any static text on screen |
| 🛠️ | Testing localized software | Verify UI translations without switching system language |

<p align="center">
  <img src="docs/demo/1.png" alt="Original game screen" width="360">
  <img src="docs/demo/3.png" alt="Translation overlay in action" width="360">
  <br>
  <em>Original game dialog (left) → Translation overlay at the bottom (right)</em>
</p>

---

## Vs Other Screen Translators

| | Translation Overlay | Translumo | ScreenTranslator | OCR-Translator |
|---|---|---|---|---|
| Offline Translation | ✅ Bergamot WASM | ❌ | ❌ | ❌ |
| Cross-Platform | ✅ Win + Linux | ❌ Windows only | ❌ Windows only | ❌ Windows only |
| Tech Stack | Electron + TypeScript | C# .NET | C++ Qt | Python PySide6 |
| Lock Mode | ✅ Smart stability lock | ❌ | ❌ | Partial |
| License | MIT | Apache 2.0 | MIT | MIT |
| Status | Active | Active | Abandoned | Active |

---

## Quick Start

```bash
# 1. Install
git clone https://github.com/asitass/Translation-Overlay.git
cd Translation-Overlay
npm install

# 2. Build & run
npm run dev
```

Or download the pre-built installer from [Releases](https://github.com/asitass/Translation-Overlay/releases).

---

## 🇨🇳 Users in China

If GitHub Releases is inaccessible or slow, use one of these mirrors:

```
# Via gh-proxy (recommended)
https://gh-proxy.com/https://github.com/asitass/Translation-Overlay/releases/latest

# Via moeyy.cn proxy
https://moeyy.cn/gh-proxy/https://github.com/asitass/Translation-Overlay/releases/latest
```

---

## Download

Pre-built packages are available on the [Releases page](https://github.com/asitass/Translation-Overlay/releases).

| Platform | Format | Description |
|----------|--------|-------------|
| Windows | `.exe` (NSIS) | Installer with configurable install directory |
| Windows | `.exe` (Portable) | Standalone, no installation required |
| Linux | `.AppImage` | Download, `chmod +x`, and run |

---

## Usage Guide

### Installation & Launch

**Windows**: Run `Translation Overlay Setup x.x.x.exe` (NSIS installer) and follow the setup wizard, or directly run `Translation Overlay x.x.x.exe` (Portable).

**Linux**: Make the AppImage executable and run:

```bash
chmod +x Translation\ Overlay-x.x.x-x86_64.AppImage
./Translation\ Overlay-x.x.x-x86_64.AppImage
```

On first launch, the app automatically:
- Creates a full-screen transparent overlay window
- Opens the Settings window
- Starts the capture → OCR → translate pipeline
- Adds a system tray icon

> The first launch may take a few seconds longer due to Bergamot translation model warm-up.

### System Tray

- **Left-click** the tray icon → toggle overlay visibility (show/hide)
- **Right-click** the tray icon → context menu: Show Overlay, Hide Overlay, Settings, Quit

### Display Modes

Two display modes configurable in the Settings window:

**Side-by-Side** (default): Translations appear as semi-transparent boxes below the original text. Best for reading documents, web pages, and subtitles.

**Hover**: Small blue dot markers appear at translated regions. Hover over a marker to reveal the translation in a tooltip. Keeps the screen clean.

### Lock Mode

The pipeline intelligently locks translations to prevent flickering:

**Document / Web** (recommended for reading): When the screen content stabilizes (no significant changes), the pipeline locks the current translation and pauses processing. A 🔒 indicator appears in the bottom-right corner. The pipeline automatically unlocks when content changes significantly. Ideal for reading articles, documents, and web pages.

<p align="center">
  <img src="docs/demo/document-mode.png" alt="Lock Mode Demo" width="720">
</p>

**Video / Game** (recommended for dynamic content): Continuously processes each frame, skipping only duplicate text. No locking — every content change triggers re-translation.

### Settings

| Setting | Options | Default |
|---------|---------|---------|
| Primary Engine | Bergamot / Google / Ollama / DeepL | Bergamot |
| Fallback Engine | Bergamot / Google / Ollama / DeepL / None | Google |
| Target Language | Chinese / English / Japanese / Korean | Chinese |
| Display Mode | Side-by-Side / Hover | Side-by-Side |
| Font Size | 10–24 px | 14 px |
| Background Opacity | 0–100% | 75% |
| Lock Mode | Document/Web / Video/Game | Document |
| Ollama Model | Model name | qwen2.5:3b |
| Ollama URL | Server address | http://localhost:11434 |

All settings are applied immediately (no restart required).

### Logs

Logs are written to `app.log` in the application's user data directory:
- Pipeline status (start / stop / lock / unlock)
- OCR processing time and detected text
- Translation engine used and results
- Errors and warnings

---

## Development Workflow

### Prerequisites

- **Node.js** >= 18
- **npm** >= 9
- **Windows**: Build Tools for Visual Studio (`npm install -g windows-build-tools`)
- **Linux**: `build-essential`, `libnss3`, `libatk-bridge2.0-0` (for running AppImage)

### Installation

```bash
npm install
```

`npm install` triggers the following `postinstall` hooks:

1. `electron-builder install-app-deps` — installs and configures native module dependencies
2. `node scripts/patch-bergamot-worker.js` — patches the Bergamot WASM worker for ESM/CJS compatibility and Windows file path handling
3. `node scripts/download-models.js` — downloads OCR and translation model files (~260MB total):
   - **Bergamot NMT models** (7 files, ~115MB) — en↔zh bidirectional
   - **PaddleOCR models** (detection + recognition + dictionary, ~30MB)
   - **Tesseract traineddata** (eng + chi_sim, ~30MB)

First-time installation may take 3-5 minutes depending on network speed. If model downloads fail, the app falls back gracefully at runtime.

### Build Pipeline

```bash
npm run build
```

This executes four steps in sequence:

| Step | Command | Description |
|------|---------|-------------|
| 1 | `tsc` | Compiles main process (`src/` → `dist/`, CommonJS) |
| 2 | `tsc -p tsconfig.renderer.json` | Compiles renderer (`src/renderer/` → `dist/renderer/`, standalone JS) |
| 3 | `node scripts/copy-assets.js` | Copies HTML, CSS, and worker wrapper to `dist/` |
| 4 | `node scripts/strip-cjs.js` | Removes CommonJS boilerplate from renderer output |

### Commands

| Command | Description |
|---------|-------------|
| `npm run build` | Compile TypeScript (main + renderer) |
| `npm run rebuild:electron` | Rebuild native modules for Electron's Node ABI |
| `npm run dev` | Build → rebuild native modules → launch Electron |
| `npm start` | Launch Electron (requires prior `npm run build`) |
| `npm test` | Rebuild native deps + run vitest unit tests |
| `npm run test:watch` | Run vitest in watch mode |
| `npx vitest run src/test/file.test.ts` | Run a single test file |
| `npm run pack:linux` | Package as Linux AppImage |
| `npm run pack:win` | Package as Windows NSIS installer + portable |
| `npm run pack` | Package for the current platform |

---

## Translation Engines

| Engine | Cost | Quality | Latency | Setup |
|---|---|---|---|---|
| **Bergamot (Offline)** | Free | Good | ~15ms/sentence | Models included (~115MB) |
| Google Translate | Free | Good | ~500ms | Built-in, no setup |
| Ollama | Free | Good | ~2-5s | Requires local Ollama |
| DeepL | Paid | Best | ~300ms | API key required |

### Why Bergamot Offline?

Bergamot is a Mozilla-built WASM translation engine powered by intgemm-quantized Marian NMT models:
- **Zero network calls** — your text never leaves your machine
- **~15ms per sentence** — after warm-up, faster than any cloud API
- **en↔zh supported** — English / Simplified Chinese with bidirectional models

---

## Proxy Configuration

If you need a proxy for Google Translate API or other online services:

```bash
# Set environment variable before running
HTTPS_PROXY=http://127.0.0.1:7890 npm run dev
```

Or create a `.env` file (see `.env.example`).

---

## Packaging & Distribution

### Platform Packages

| Platform | Command | Artifact |
|----------|---------|----------|
| Linux | `npm run pack:linux` | `release/*.AppImage` |
| Windows | `npm run pack:win` | `release/*.exe` (NSIS) + `release/*.exe` (Portable) |

### Cross-Compilation (Build Windows Package from Linux)

When running on Linux, `electron-builder` rebuilds native modules for the host platform. To produce Windows packages, use the cross-compilation script:

```bash
bash scripts/pack-win.sh
```

This script:
1. Compiles TypeScript
2. Downloads Windows prebuilt binaries for native modules via `scripts/prepare-win-native.js`
3. Replaces Linux `.node` binaries with Windows versions (better-sqlite3, node-screenshots, sharp)
4. Runs `electron-builder --win --config.npmRebuild=false` (skips native rebuild)
5. Restores the original Linux modules

### Bundled Resources

The following resources are automatically bundled in the installed package:

| Directory | Contents | Size |
|-----------|----------|------|
| `bergamot-models/` | NMT models for en↔zh | ~115MB |
| `paddle-models/` | PaddleOCR detection + recognition models | ~30MB |
| `tessdata/` | Tesseract traineddata (eng, chi_sim) | ~30MB |

Native modules (better-sqlite3, node-screenshots, onnxruntime-node, sharp, etc.) are unpacked from the asar archive — see `asarUnpack` in `electron-builder.yml` for the full list.

---

## CI/CD Pipeline

**File**: `.github/workflows/build.yml`

**Triggers**:
- Push tag matching `v*` (e.g., `v1.0.0`)
- Push to `master` branch
- Manual dispatch via GitHub Actions UI

**Jobs**:

| Job | Runner | Steps | Artifacts |
|-----|--------|-------|-----------|
| `build-windows` | `windows-latest` | Checkout → Node 20 → `npm ci` → `build` → `electron-rebuild` → `electron-builder --win` | `release/*.exe` |
| `build-linux` | `ubuntu-latest` | Checkout → Node 20 → `npm ci` → `build` → `electron-rebuild` → `electron-builder --linux` | `release/*.AppImage` |
| `release` | `ubuntu-latest` | Downloads artifacts from both builds → creates GitHub Release with auto-generated release notes | GitHub Release |

The `release` job only runs on tag pushes (`v*`). It requires both `build-windows` and `build-linux` to succeed.

---

## Troubleshooting

| Problem | Solution |
|---------|----------|
| Model download fails during `npm install` | Run `node scripts/download-models.js` manually. The app falls back at runtime if models are missing. |
| `Error: The module was compiled against a different Node.js version` | Run `npm run rebuild:electron` to rebuild native modules for Electron's Node ABI. |
| AppImage fails to launch on Linux | Install required system libraries: `apt install libnss3 libatk-bridge2.0-0 libgtk-3-0` |
| Google Translate returns no response | Check `HTTPS_PROXY` environment variable — Google Translate may be blocked in your region. |
| Where are the log files? | Logs are written to `app.log` in the application's user data directory. |

---

<details>
<summary><b>Architecture</b></summary>

```
Single Electron Process (TypeScript)
├── Main Process
│   ├── ScreenCapturer    — node-screenshots (cross-platform)
│   ├── OcrService        — PaddleOCR (primary) + Tesseract.js (fallback)
│   ├── TranslatorService — Bergamot / Google / Ollama / DeepL + fallback
│   ├── TranslationCache  — better-sqlite3 (SQLite)
│   ├── ChangeDetector    — pixel diff + text dedup
│   ├── Pipeline          — capture → detect → OCR → translate
│   └── IPC Handlers      — Electron contextBridge
├── Preload
│   └── contextBridge API
└── Renderer
    ├── Overlay Window    — transparent always-on-top translation display
    └── Settings Window   — engine/language/appearance config
```
</details>

<details>
<summary><b>Project Structure</b></summary>

```
src/
├── main/
│   ├── index.ts              # Electron entry point
│   ├── ipc-handlers.ts
│   └── services/
│       ├── capturer.ts       # Screen capture
│       ├── ocr.ts            # OCR orchestrator (PaddleOCR + Tesseract)
│       ├── ocr-engines/      # OCR engine implementations
│       ├── bergamot.ts       # Offline translation (WASM)
│       ├── translator.ts     # Engine orchestrator
│       ├── cache.ts          # SQLite cache
│       ├── change-detector.ts
│       ├── config.ts
│       └── pipeline/         # Capture pipeline with modes
├── preload/
│   └── index.ts
├── renderer/
│   ├── overlay/
│   └── settings/
└── shared/
    ├── types.ts
    ├── constants.ts
    └── protocol.ts

tests/
config/
scripts/
bergamot-models/
tessdata/
paddle-models/
```
</details>

---

## Contributing

PRs welcome! See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

## License

[MIT](LICENSE)

---

<p align="center">
  <a href="https://star-history.com/#asitass/Translation-Overlay&Date">
    <img src="https://api.star-history.com/svg?repos=asitass/Translation-Overlay&type=Date" alt="Star History">
  </a>
</p>
