import { renderMermaidSVG, THEMES } from 'beautiful-mermaid'

type Palette = { bg: string; fg: string; line?: string; accent?: string; muted?: string; surface?: string; border?: string }

// Reads { source, theme } as JSON on stdin and writes the SVG on stdout; a
// diagram that does not parse exits 1 with its first error line on stderr.
let input = ''
process.stdin.setEncoding('utf8')
process.stdin.on('data', chunk => {
  input += chunk
})
process.stdin.on('end', () => {
  const { source, theme } = JSON.parse(input) as { source: string; theme: string }
  const palette = (THEMES[theme] ?? THEMES['tokyo-night']) as Palette
  try {
    process.stdout.write(flatten(renderMermaidSVG(source, { ...palette, padding: 24 }), palette))
  } catch (error) {
    process.stderr.write(String(error instanceof Error ? error.message : error).split('\n')[0])
    process.exitCode = 1
  }
})

/**
 * Resolves the CSS custom properties and color-mix() the engine draws with
 * into plain hex, and paints the background as a rect: rsvg-convert and
 * other non-browser renderers support neither.
 */
function flatten(svg: string, p: Palette): string {
  const mix = (percent: number) => blend(p.fg, p.bg, percent / 100)
  const colors: Record<string, string> = {
    '--bg': p.bg,
    '--fg': p.fg,
    '--_text': p.fg,
    '--_text-sec': p.muted ?? mix(60),
    '--_text-muted': p.muted ?? mix(40),
    '--_text-faint': mix(25),
    '--_line': p.line ?? mix(50),
    '--_arrow': p.accent ?? mix(85),
    '--_node-fill': p.surface ?? mix(3),
    '--_node-stroke': p.border ?? mix(20),
    '--_group-fill': p.bg,
    '--_group-hdr': mix(5),
    '--_inner-stroke': mix(12),
    '--_key-badge': mix(10),
  }

  return svg
    .replace(/@import url\([^)]*\);?/g, '')
    .replace(/\n\s*svg \{[\s\S]*?\n\s*\}/, '')
    .replace(/font-family: [^;]+;/, "font-family: 'Inter', 'SF Pro Text', 'Helvetica Neue', Arial, sans-serif;")
    .replace(/var\((--[\w-]+)(?:,[^)]*\))?\)/g, (_, name: string) => colors[name] ?? p.fg)
    .replace(/(<svg[^>]*>)/, `$1\n<rect width="100%" height="100%" fill="${p.bg}" />`)
}

function blend(front: string, back: string, amount: number): string {
  const [r1, g1, b1] = rgb(front)
  const [r2, g2, b2] = rgb(back)
  const channel = (a: number, b: number) =>
    Math.round(a * amount + b * (1 - amount))
      .toString(16)
      .padStart(2, '0')

  return `#${channel(r1, r2)}${channel(g1, g2)}${channel(b1, b2)}`
}

function rgb(hex: string): [number, number, number] {
  const full = hex.replace('#', '').replace(/^(.)(.)(.)$/, '$1$1$2$2$3$3')
  const value = Number.parseInt(full, 16)

  return [(value >> 16) & 255, (value >> 8) & 255, value & 255]
}
