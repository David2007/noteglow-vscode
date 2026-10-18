# Source provenance

This desktop VS Code extension adapts the portable Markdown color engine, selection context, Codex JSONL client, events and model cache reader from [NoteGlow 0.3.1](https://github.com/David2007/noteglow/tree/6e99726be508668c3b8ce405207a26a4b10d4330), maintained by david yang. The Obsidian lineage includes MIT-licensed work by yamantaka520; its copyright is retained in LICENSE and THIRD_PARTY_NOTICES.txt.

Copied modules: `src/markdown-colors.ts`, `src/color-ranges.ts`, `src/context.ts`, `src/models.ts`, `src/codex-events.ts`, `src/codex-client.ts`, `src/types.ts`. The client adds bounded output/deadline and explicit approval configuration. Host integration, local session persistence, native editor adapter, Chinese webview and theme are specific to this extension.

Authentication, personal configuration, conversation history, model caches, private notes and Git history were not copied. Each user installs and signs in to their own Codex CLI. No credentials belong in this repository or the VSIX.
