import { renderMermaidASCII } from './vendor/mermaid.js'

export type Glyph = 'label' | 'line' | 'arrow'
export type Run = { glyph: Glyph; text: string }

export type Unicode = {
  isRendered: true
  kind: string
  direction?: string
  /** Set when a horizontal flowchart was laid out vertically to fit. */
  isTurned: boolean
  lines: Run[][]
  width: number
}

export type Failure = { isRendered: false; kind: string; reason: string }

const COMPACT = { colorMode: 'none', paddingX: 4, paddingY: 2, boxBorderPadding: 0 } as const
const ARROWS = new Set('►▶◀◄▲▼△▽▷◁→←↑↓')
const LINES = /[─-╿◇◆○●]/

/**
 * The header Mermaid itself reads: the first line that is neither blank, a
 * %% comment nor front matter. Its first word is the kind, its second the
 * direction of a flowchart.
 */
export function header(source: string): { kind: string; direction?: string } {
  const lines = source.split('\n').map(line => line.trim())
  let index = 0
  if (lines[0] === '---') index = lines.indexOf('---', 1) + 1
  const first = lines.slice(index).find(line => line !== '' && !line.startsWith('%%')) ?? ''
  const [kind = 'diagram', direction] = first.split(/\s+/)
  const isFlow = kind === 'flowchart' || kind === 'graph'

  return { kind, direction: isFlow && direction ? direction.toUpperCase() : undefined }
}

/** Box-drawing art cut into colored runs, laid out vertically when too wide. */
export function renderUnicode(source: string, columns: number): Unicode | Failure {
  const { kind, direction } = header(source)
  try {
    let art = tidy(renderMermaidASCII(source, COMPACT))
    let isTurned = false
    if (widest(art) > columns && (direction === 'LR' || direction === 'RL')) {
      const turned = tidy(renderMermaidASCII(turnVertical(source), COMPACT))
      if (widest(turned) < widest(art)) {
        art = turned
        isTurned = true
      }
    }

    return { isRendered: true, kind, direction, isTurned, lines: art.map(toRuns), width: widest(art) }
  } catch (error) {
    return { isRendered: false, kind, reason: firstLine(error) }
  }
}

function turnVertical(source: string): string {
  return source.replace(/^(\s*(?:flowchart|graph)\s+)(LR|RL)\b/im, '$1TD')
}

function tidy(text: string): string[] {
  const lines = text.split('\n').map(line => line.replace(/\s+$/, ''))
  while (lines.length > 0 && lines[0] === '') lines.shift()
  while (lines.length > 0 && lines[lines.length - 1] === '') lines.pop()

  return lines
}

function widest(lines: string[]): number {
  return lines.reduce((most, line) => Math.max(most, [...line].length), 0)
}

function toRuns(line: string): Run[] {
  const runs: Run[] = []
  for (const char of line) {
    const glyph: Glyph = ARROWS.has(char) ? 'arrow' : LINES.test(char) || char === '╌' ? 'line' : 'label'
    const last = runs[runs.length - 1]
    // A space joins whatever run it sits in, so labels stay one run each.
    if (last !== undefined && (last.glyph === glyph || char === ' ')) last.text += char
    else runs.push({ glyph, text: char })
  }

  return runs
}

function firstLine(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)

  return message.split('\n')[0] ?? message
}
