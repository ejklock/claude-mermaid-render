// Regenerates docs/images from the plugin's own renderers: the terminal card
// from hooks/diagram.ts, the SVG pictures from renderer/svg.mjs. Needs Node 22+
// (type stripping) and rsvg-convert on PATH.
import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'

import { renderUnicode } from '../hooks/diagram.ts'

const root = fileURLToPath(new URL('..', import.meta.url))
const out = join(root, 'docs', 'images')
mkdirSync(out, { recursive: true })

const FLOW = `flowchart LR
  A[Carrinho] --> B{Pagamento ok?}
  B -->|sim| C[Emitir nota]
  B -->|não| D[Avisar cliente]
  C --> E((Fim))
  D --> E`
const SEQUENCE = `sequenceDiagram
  participant C as Cliente
  participant L as Loja
  participant P as Pagamento
  C->>L: Finaliza pedido
  L->>P: Autoriza cartão
  P-->>L: Aprovado
  L-->>C: Pedido confirmado`
const STATE = `stateDiagram-v2
  [*] --> Rascunho
  Rascunho --> Revisao: enviar
  Revisao --> Publicado: aprovar
  Revisao --> Rascunho: pedir ajustes
  Publicado --> [*]`

// Claude Code's dark theme, close enough for a picture of the terminal.
const T = { bg: '#1e1e2e', chrome: '#2a2a3c', text: '#e6e6e6', dim: '#8b8b9e', inactive: '#6c6c80', claude: '#d97757', success: '#4eba65', prompt: '#b1b9f9' }
const CELL_W = 8.6
// Menlo's box-drawing glyphs span 1.164em: rows this tall join like a terminal's.
const CELL_H = 16.3
const FONT = "Menlo, 'SF Mono', 'DejaVu Sans Mono', monospace"
const GLYPH_COLOR = { label: T.text, line: T.inactive, arrow: T.claude }

function svgFor(source, theme = 'tokyo-night') {
  return execFileSync('node', [join(root, 'renderer', 'svg.mjs')], { input: JSON.stringify({ source, theme }) }).toString()
}

function png(svg, name, zoom = 2) {
  const path = join(out, name)
  execFileSync('rsvg-convert', ['--zoom', String(zoom), '--output', path], { input: svg })
  console.log('wrote', path)
}

const escape = text => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

/** One row of text: runs placed cell by cell, so a fallback glyph never shifts the grid. */
function row(runs, col, line) {
  let x = col
  return runs
    .map(({ text, color, bold }) => {
      const cells = [...text]
        .map((char, index) => (char === ' ' ? '' : `<tspan x="${((x + index) * CELL_W).toFixed(1)}">${escape(char)}</tspan>`))
        .join('')
      x += [...text].length
      return `<text y="${(line * CELL_H + 14).toFixed(1)}" fill="${color}" font-weight="${bold ? 700 : 400}">${cells}</text>`
    })
    .join('')
}

/** A terminal window showing a reply whose diagram the plugin drew as a card. */
function terminal(source, columns = 96) {
  const art = renderUnicode(source, columns - 10)
  if (!art.isRendered) throw new Error(art.reason)
  const inner = Math.max(art.width, 40)
  const rows = []
  const add = (runs, col = 2) => rows.push({ runs, col })

  add([{ text: '> ', color: T.prompt }, { text: 'Desenhe o fluxo de checkout em mermaid', color: T.text }])
  add([])
  add([{ text: '⏺ ', color: T.text }, { text: 'Aqui está o fluxo de checkout:', color: T.text }])
  add([])
  add([{ text: `╭${'─'.repeat(inner + 2)}╮`, color: '#8a5340' }], 4)
  const title = '◆ Fluxograma · LR'
  add([
    { text: '│ ', color: '#8a5340' },
    { text: '◆ ', color: T.claude },
    { text: 'Fluxograma', color: T.text, bold: true },
    { text: ' · LR', color: T.dim },
    { text: ' '.repeat(inner - [...title].length - 7), color: T.dim },
    { text: 'mermaid', color: T.dim },
    { text: ' │', color: '#8a5340' },
  ], 4)
  add([{ text: `│${' '.repeat(inner + 2)}│`, color: '#8a5340' }], 4)
  for (const line of art.lines) {
    const width = line.reduce((sum, run) => sum + [...run.text].length, 0)
    add([
      { text: '│ ', color: '#8a5340' },
      ...line.map(run => ({ text: run.text, color: GLYPH_COLOR[run.glyph], bold: run.glyph === 'label' })),
      { text: `${' '.repeat(inner - width)} │`, color: '#8a5340' },
    ], 4)
  }
  add([{ text: `╰${'─'.repeat(inner + 2)}╯`, color: '#8a5340' }], 4)
  add([])
  add([{ text: '  O pedido só segue para a nota fiscal quando o pagamento é aprovado.', color: T.text }])

  const width = Math.round((inner + 12) * CELL_W)
  const height = rows.length * CELL_H + 64
  const body = rows.map((r, index) => row(r.runs, r.col, index)).join('\n')

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
<rect width="100%" height="100%" rx="12" fill="${T.bg}"/>
<rect width="100%" height="34" rx="12" fill="${T.chrome}"/><rect y="22" width="100%" height="12" fill="${T.chrome}"/>
<circle cx="20" cy="17" r="6" fill="#ff5f57"/><circle cx="40" cy="17" r="6" fill="#febc2e"/><circle cx="60" cy="17" r="6" fill="#28c840"/>
<text x="${width / 2}" y="22" fill="${T.dim}" font-family="${FONT}" font-size="13" text-anchor="middle">claude — mermaid-render</text>
<g transform="translate(0 50)" font-family="${FONT}" font-size="14" xml:space="preserve">
${body}
</g>
</svg>`
}

function socialPreview(diagramSvg) {
  const data = Buffer.from(diagramSvg).toString('base64')
  return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="1280" height="640">
<rect width="1280" height="640" fill="#1a1b26"/>
<text x="80" y="150" fill="#c0caf5" font-family="Inter, 'Helvetica Neue', Arial, sans-serif" font-size="68" font-weight="700">mermaid-render</text>
<text x="80" y="210" fill="#7aa2f7" font-family="Inter, 'Helvetica Neue', Arial, sans-serif" font-size="30">Mermaid diagrams, beautifully rendered inside Claude Code</text>
<image x="80" y="270" width="1120" height="300" xlink:href="data:image/svg+xml;base64,${data}" preserveAspectRatio="xMidYMid meet"/>
</svg>`
}

png(terminal(FLOW), 'terminal-card.png')
const flow = svgFor(FLOW)
png(flow, 'svg-flowchart.png')
png(svgFor(SEQUENCE), 'svg-sequence.png')
png(svgFor(STATE, 'catppuccin-mocha'), 'svg-state.png')
png(socialPreview(flow), 'social-preview.png', 1)
writeFileSync(join(out, 'svg-flowchart.svg'), flow)
console.log('wrote', join(out, 'svg-flowchart.svg'))
