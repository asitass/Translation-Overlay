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
    <a href="#download">Download</a>
  </p>
</p>

<!-- TODO: Replace with actual demo GIF -->
<p align="center">
  <img src="docs/demo/demo.gif" alt="Translation Overlay Demo" width="720">
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

<details>
<summary><b>Detailed Setup</b></summary>

### Prerequisites
- Node.js >= 18
- npm >= 9

### Development
```bash
npm run build      # Build TypeScript
npm run dev        # Build + rebuild native modules + launch Electron
npm test           # Run tests
```

### Packaging
```bash
npm run pack:linux    # Linux AppImage
npm run pack:win      # Windows NSIS installer
npm run pack          # Current platform
```

CI builds run via GitHub Actions — push a `v*` tag to trigger automated cross-platform releases.
</details>

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
