import { header } from './diagram'

export type Segment =
  | { kind: 'markdown'; text: string }
  | { kind: 'mermaid'; source: string }

const OPENER = /^ {0,3}(`{3,}|~{3,})(.*)$/

/**
 * Splits markdown into prose and mermaid fences, CommonMark style: the closer
 * repeats the opener's character at least as long, and a mermaid fence shown
 * inside another fence is documentation, left as prose. An unclosed mermaid
 * fence (a reply still streaming) stays prose until it closes.
 */
export function splitMermaid(markdown: string): Segment[] {
  const { lines, fences } = scanFences(markdown)
  const segments: Segment[] = []
  let proseFrom = 0

  const flushProse = (to: number) => {
    const text = lines.slice(proseFrom, to).join('\n').replace(/^\n+|\s+$/g, '')
    if (text !== '') segments.push({ kind: 'markdown', text })
  }

  for (const fence of fences) {
    flushProse(fence.opener)
    segments.push({ kind: 'mermaid', source: fence.source })
    proseFrom = fence.closer + 1
  }
  flushProse(lines.length)

  return segments
}

/** A closed top-level mermaid fence: the lines of its opener and closer, and what sits between. */
type Fence = { opener: number; closer: number; source: string }

function scanFences(markdown: string): { lines: string[]; fences: Fence[] } {
  const lines = markdown.split('\n').map(line => (line.endsWith('\r') ? line.slice(0, -1) : line))
  const fences: Fence[] = []
  let index = 0

  while (index < lines.length) {
    const opener = OPENER.exec(lines[index] ?? '')
    if (opener === null) {
      index += 1
      continue
    }
    const closer = closingLine(lines, index + 1, opener[1] ?? '```')
    const isMermaid = (opener[2] ?? '').trim().split(/\s+/)[0]?.toLowerCase() === 'mermaid'
    if (closer !== -1 && isMermaid) fences.push({ opener: index, closer, source: lines.slice(index + 1, closer).join('\n') })
    index = closer === -1 ? lines.length : closer + 1
  }

  return { lines, fences }
}

function closingLine(lines: string[], from: number, fence: string): number {
  const pattern = new RegExp(`^ {0,3}\\${fence[0]}{${fence.length},}\\s*$`)
  for (let index = from; index < lines.length; index += 1) {
    if (pattern.test(lines[index] ?? '')) return index
  }

  return -1
}

/** The mermaid sources a file holds: the whole of a .mmd, the fences of anything else. */
export function diagramsInFile(path: string, content: string): string[] {
  if (isDiagramFile(path)) return content.trim() === '' ? [] : [content]

  return splitMermaid(content).flatMap(segment => (segment.kind === 'mermaid' ? [segment.source] : []))
}

export function isDiagramFile(path: string): boolean {
  return /\.(mmd|mermaid)$/i.test(path)
}

const DIAGRAM_KINDS = new Set([
  'flowchart', 'flowchart-elk', 'graph', 'sequenceDiagram', 'stateDiagram', 'stateDiagram-v2', 'classDiagram', 'erDiagram',
  'pie', 'gantt', 'journey', 'gitGraph', 'mindmap', 'timeline', 'quadrantChart', 'requirementDiagram', 'sankey-beta',
  'xychart-beta', 'block-beta', 'architecture-beta', 'packet-beta', 'kanban', 'C4Context',
])

/** The mermaid sources a finished shell command printed: its fences, else the whole of a .mmd/.mermaid file it named. */
export function diagramsInOutput(command: string, stdout: string): string[] {
  const fenced = splitMermaid(stdout).flatMap(segment => (segment.kind === 'mermaid' ? [segment.source] : []))
  if (fenced.length > 0) return fenced

  const namesDiagramFile = /\.(mmd|mermaid)(?=$|[\s'"`;|&<>)])/i.test(command)
  const source = stdout.replace(/\r\n/g, '\n')

  return namesDiagramFile && DIAGRAM_KINDS.has(header(source).kind) ? [source] : []
}

/** A character range of the edited file that the edit wrote. */
export type Span = { start: number; end: number }

/** The file an edit leaves behind and the ranges it wrote. */
export function applyEdit(original: string | null, oldString: string, newString: string, replaceAll: boolean): { content: string; spans: Span[] } {
  if (original === null) return { content: newString, spans: [{ start: 0, end: newString.length }] }
  if (oldString === '') return { content: original, spans: [] }

  let content = ''
  let from = 0
  const spans: Span[] = []
  for (let at = original.indexOf(oldString); at !== -1; at = replaceAll ? original.indexOf(oldString, from) : -1) {
    content += original.slice(from, at)
    spans.push({ start: content.length, end: content.length + newString.length })
    content += newString
    from = at + oldString.length
  }

  return { content: content + original.slice(from), spans }
}

/** The mermaid fences of a markdown text whose lines, opener to closer, overlap a written span. */
export function diagramsTouched(markdown: string, spans: Span[]): string[] {
  const starts: number[] = []
  let offset = 0
  for (const line of markdown.split('\n')) {
    starts.push(offset)
    offset += line.length + 1
  }
  starts.push(offset)
  const { fences } = scanFences(markdown)

  return fences.flatMap(fence => {
    const start = starts[fence.opener] ?? 0
    // The raw closer line, \r included: scanFences strips the \r from its lines.
    const end = (starts[fence.closer + 1] ?? 0) - 1
    const isTouched = spans.some(span => span.start < end && span.end > start)

    return isTouched ? [fence.source] : []
  })
}
