# Resources and dependency attribution

## Project assets

`public/terrain.svg`, CSS surfaces, banners and dice in `public/style.css` / `public/app.js`, and the procedural score/effects in `public/audio.js` were created within this Last Banner project with Codex assistance. The source/history shows code-generated artwork and oscillator synthesis; no external art packs, music recordings or sound samples are bundled. This is provenance evidence, not a guarantee of worldwide uniqueness. No image-generation tool was used for these assets.

Typography uses installed system fonts (Segoe UI, Georgia and generic fallbacks); no font files are copied, bundled or downloaded. The SVG namespace URL is metadata, not a remote asset request. The only CSS image dependency is the included `public/terrain.svg`. The client loads local JS/CSS; Twitch is contacted only for the configured real integration. No paid API is needed at runtime.

The first-party code/art/audio is licensed under **MIT**, copyright (c) 2026 Diego Martin Iglesias, as expressly approved by the owner on 2026-11-02. See `LICENSE` for the full grant. Third-party permissions remain their own.

## npm dependencies (exact lockfile versions)

There are no production npm dependencies. Build/test dependencies are downloaded by `npm ci`; retain their supplied license notices if redistributing them.

| Package | Version | License | Upstream |
| --- | --- | --- | --- |
| TypeScript, `@typescript/typescript-*` optional platform binaries | 7.0.2 | Apache-2.0 | https://github.com/microsoft/TypeScript |
| `@playwright/test`, `playwright`, `playwright-core` | 1.64.1 | Apache-2.0 | https://github.com/microsoft/playwright |
| `@types/node` | 26.6.5 | MIT | https://github.com/DefinitelyTyped/DefinitelyTyped/tree/master/types/node |
| Prettier | 3.9.10 | MIT | https://github.com/prettier/prettier |
| tsx | 4.23.15 | MIT | https://github.com/privatenumber/tsx |
| esbuild, `@esbuild/*` optional platform binaries | 0.28.2 | MIT | https://github.com/evanw/esbuild |
| fsevents (optional macOS dependency) | 2.3.3 | MIT | https://github.com/fsevents/fsevents |
| undici-types | 8.9.0 | MIT | https://github.com/nodejs/undici |
| `vscode-jsonrpc` vendored inside TypeScript | 9.0.0 | MIT | https://github.com/microsoft/vscode-languageserver-node/tree/main/jsonrpc |

Versions/licenses were checked against `package-lock.json`, installed package metadata and supplied license files on 2026-11-02. The TypeScript vendor component is identified from its own package metadata/license rather than a separate lockfile entry. Playwright also retains license notices for its bundled tooling; preserve those if redistributing that tool. Optional binaries vary by OS; the lockfile enumerates them. No node_modules or browser binaries are included in the delivery source archive.

Node.js and OBS Studio are separately installed tools, not bundled distributions. Twitch API/EventSub are external services subject to the evaluator's own account/application authorization. The local OBS recording uses original game visuals and synthesis. FFmpeg was used only to inspect that recording; neither its binary nor its npm installation is included in the candidate repository. No external soundtrack was added.
