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
  const lines = markdown.split('\n')
  const segments: Segment[] = []
  let prose: string[] = []
  let index = 0

  const flushProse = () => {
    const text = prose.join('\n').replace(/^\n+|\s+$/g, '')
    if (text !== '') segments.push({ kind: 'markdown', text })
    prose = []
  }

  while (index < lines.length) {
    const line = lines[index] ?? ''
    const opener = OPENER.exec(line)
    if (opener === null) {
      prose.push(line)
      index += 1
      continue
    }
    const fence = opener[1] ?? '```'
    const closer = closingLine(lines, index + 1, fence)
    const isMermaid = (opener[2] ?? '').trim().split(/\s+/)[0]?.toLowerCase() === 'mermaid'
    if (closer === -1 || !isMermaid) {
      const end = closer === -1 ? lines.length : closer + 1
      prose.push(...lines.slice(index, end))
      index = end
      continue
    }
    flushProse()
    segments.push({ kind: 'mermaid', source: lines.slice(index + 1, closer).join('\n') })
    index = closer + 1
  }
  flushProse()

  return segments
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
  if (/\.(mmd|mermaid)$/i.test(path)) return content.trim() === '' ? [] : [content]

  return splitMermaid(content).flatMap(segment => (segment.kind === 'mermaid' ? [segment.source] : []))
}
