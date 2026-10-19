# Source provenance

This desktop VS Code extension adapts the portable Markdown color engine, selection context, Codex JSONL client, events and model cache reader from [NoteGlow 0.3.1](https://github.com/David2007/noteglow/tree/6e99726be508668c3b8ce405207a26a4b10d4330), maintained by david yang. The Obsidian lineage includes MIT-licensed work by yamantaka520; its copyright is retained in LICENSE and THIRD_PARTY_NOTICES.txt.

Copied modules: `src/markdown-colors.ts`, `src/color-ranges.ts`, `src/context.ts`, `src/models.ts`, `src/codex-events.ts`, `src/codex-client.ts`, `src/types.ts`. The client adds bounded output/deadline and explicit approval configuration. Host integration, local session persistence, native editor adapter, Chinese webview and theme are specific to this extension.

Authentication, personal configuration, conversation history, model caches, private notes and Git history were not copied. Each user installs and signs in to their own Codex CLI. No credentials belong in this repository or the VSIX.

Version 0.2.1 ports the owned `<pre><code>` boundary-whitespace validation fix from [NoteGlow Obsidian bf5aa3f](https://github.com/David2007/noteglow/commit/bf5aa3fedc991426a0b4fdbb1dd42accdacee8ee). It preserves literal code text and rejects non-whitespace siblings. Obsidian-specific DOM selection, CodeMirror mapping and toolbar code are not included; VS Code retains its native source-editor commands.

## Image feature provenance (0.2.0)

Image header inspection and attachment metadata originate from [NoteGlow Obsidian](https://github.com/David2007/noteglow/blob/6717d913813fa8eccccd8f345d6b50234d332a7c/src/image-attachments.ts), fixed at `6717d913813fa8eccccd8f345d6b50234d332a7c`. This extension raises the message count to 10 as explicitly requested, preserves the 10 MiB / 20 MiB / 32MP budgets, and rejects malformed present image fields instead of silently filtering stored records. The private storage adapter, strict Webview byte protocol, native picker/controller, instance import ownership and VS Code resource handling are adapted for this host. Only controlled image arguments were added to the existing bounded/cancellable CLI client; its permission, deadline and output safeguards remain in place. No additional runtime dependency was introduced.
