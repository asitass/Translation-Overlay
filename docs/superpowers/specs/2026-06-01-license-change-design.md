# License Change: MIT → AGPL-3.0-or-later

## Context

Translation Overlay 当前使用 MIT 协议，这是最宽松的开源协议之一。虽然 MIT 有助于最大化传播，但它允许任何人（包括商业公司）闭源修改并销售你的代码，无需回馈社区。

项目维护者希望选择一个更具保护性的协议，以：
- 防止大公司白嫖闭源商用
- 确保所有修改和衍生作品必须开源回馈
- 为未来可能的云端/SaaS 版本提供预防性保护

## Decision

**从 MIT License 切换到 GNU Affero General Public License v3.0 or later (AGPL-3.0-or-later)**

选择 AGPL-3.0 而非 GPL-3.0 的原因：
- 桌面应用阶段两者效果等价（AGPL 的额外网络条款对桌面应用无影响）
- 未来若提供云端翻译服务，AGPL 的网络条款自动生效，无需再换协议
- 预防性策略，一次到位

## Dependency Compatibility

项目所有主要依赖均使用 MIT 或 Apache-2.0 协议，与 AGPL-3.0 完全兼容：

| Dependency | License |
|---|---|
| @mkljczk/bergamot-translator | Apache-2.0 |
| tesseract.js | Apache-2.0 |
| sharp | Apache-2.0 |
| onnxruntime-node | MIT |
| better-sqlite3 | MIT |
| electron | MIT |
| @vitalets/google-translate-api | MIT |

AGPL 的 copyleft 条款仅适用于项目自身的代码分发，不影响通过 npm/node_modules 引用的独立库。

## Changes Required

### 1. Replace LICENSE file
- Replace MIT license text with full AGPL-3.0 license text
- Update copyright line: `Copyright (c) 2026 Translation Overlay Contributors`

### 2. Update README.md
- Change license badge from MIT to AGPL-3.0
- Update badge URL and alt text

### 3. Update README.zh-CN.md
- Sync license references in Chinese README

### 4. Update package.json
- Change `"license": "MIT"` to `"license": "AGPL-3.0-or-later"`

### 5. Check and update other files
- CONTRIBUTING.md — if it references MIT
- .github/ templates — if they reference MIT
- Any other documentation files

## Files to Modify

1. `/home/ubuntu/Translation-Overlay/LICENSE` — Replace content
2. `/home/ubuntu/Translation-Overlay/README.md` — Update badge + references
3. `/home/ubuntu/Translation-Overlay/README.zh-CN.md` — Update references
4. `/home/ubuntu/Translation-Overlay/package.json` — Update license field
5. `/home/ubuntu/Translation-Overlay/CONTRIBUTING.md` — If applicable

## Verification

- [ ] LICENSE file contains full AGPL-3.0 text
- [ ] All README badge links point to AGPL-3.0
- [ ] package.json license field is correct
- [ ] No remaining references to MIT in the repo (search for "MIT" and "License")
- [ ] Build still works (`npm run build`)
