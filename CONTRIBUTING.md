# Contributing to Translation Overlay

Thank you for your interest in contributing! Here's how to get started.

## Development Setup

```bash
# 1. Clone and install
git clone https://github.com/asitass/Translation-Overlay.git
cd Translation-Overlay
npm install

# 2. Build and run
npm run dev

# 3. Run tests
npm test
```

### Prerequisites
- Node.js >= 18
- npm >= 9

## How to Contribute

### Reporting Issues
- Check [existing issues](https://github.com/asitass/Translation-Overlay/issues) first
- Include your OS, Node.js version, and steps to reproduce
- Attach logs from `app.log` (located in the app's user data directory) if applicable

### Submitting Changes
1. Fork the repository
2. Create a feature branch: `git checkout -b feat/your-feature`
3. Make your changes
4. Run tests: `npm test`
5. Build to verify: `npm run build`
6. Commit with a clear message
7. Open a Pull Request

### Code Style
- TypeScript strict mode — no `any`, use `unknown` when needed
- Follow existing patterns in the codebase
- Add comments for non-obvious logic
- Keep logging detailed for debugging

### Commit Messages
- Use conventional commit format: `feat:`, `fix:`, `docs:`, `refactor:`, `test:`
- Keep messages concise but descriptive

## Project Structure

```
src/main/services/   — Core services (OCR, translation, pipeline)
src/main/            — Electron main process
src/renderer/        — UI (overlay + settings windows)
src/shared/          — Shared types and constants
tests/               — Vitest unit tests
config/              — Default configuration
```

## Questions?

Feel free to open an issue with the "question" label.
