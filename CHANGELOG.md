# Changelog

## 0.2.0

- Render diagrams from `Bash` output (mermaid fences, or a printed `.mmd` / `.mermaid` file) as cards under the command's own row.
- Render diagrams from `Edit`: the fences an edit touched in a Markdown file, or the whole updated `.mmd` / `.mermaid` file, as cards under the edit's own diff.
- A finished, collapsed group of tool calls unfolds when it holds a `Bash` or `Edit` call that yields a diagram.
- Count the line break of a CRLF closer line as part of its fence, so an edit of only that break still draws the fence.

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
