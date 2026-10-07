# Changelog

## 0.1.1

- Find mermaid fences in Markdown with CRLF line endings.
- `renderer/svg.mjs` answers malformed input with one `invalid input:` line and exit code 1.
- Image mode removes its intermediate SVG and any failed or evicted PNG.

## 0.1.0

- Render mermaid fences in Claude's replies as titled cards.
- Render diagrams from `Read` and `Write` of `.mmd`, `.mermaid` and Markdown files.
- Colored Unicode art in any terminal, with a vertical layout when a flowchart is too wide.
- Native SVG on desktop and VS Code; optional `image` mode for kitty-graphics terminals.
- Twelve SVG themes; `terminalRender` and `theme` options.
