import type { ElementTable, Register, RenderElement, RenderSurface } from 'claude-code'

import { header, renderUnicode } from './diagram'
import type { Failure, Glyph, Unicode } from './diagram'
import { applyEdit, diagramsInFile, diagramsInOutput, diagramsTouched, isDiagramFile, splitMermaid } from './fences'
import type { Segment } from './fences'

type Svg = { isRendered: true; svg: string; width: number; height: number }
type Png = { path: string; width: number; height: number }
/** What the hook fetched through $ for one source, before anything is drawn. */
type Prepared = { svg?: Svg | Failure; png?: Png }
type Draw = { ui: ElementTable; surface: RenderSurface; width: number; prepared: Map<string, Prepared> }
type FileDiagrams = { path: string; lines: number; sources: string[] }

const KINDS: Record<string, string> = {
  flowchart: 'Fluxograma',
  graph: 'Fluxograma',
  sequenceDiagram: 'Sequência',
  stateDiagram: 'Estados',
  'stateDiagram-v2': 'Estados',
  classDiagram: 'Classes',
  erDiagram: 'Entidade-relacionamento',
}
const GLYPH_COLOR: Record<Glyph, string> = { label: 'text', line: 'inactive', arrow: 'claude' }
const SVG_LIMIT = 131072
const CACHE_LIMIT = 200
// The card's border and padding.
const CARD_CHROME = 4

const unicodeCache = new Map<string, Unicode | Failure>()
const svgCache = new Map<string, Svg | Failure>()
const pngCache = new Map<string, Png | undefined>()

export const register: Register = (on, options) => {
  const terminalRender = String(options.terminalRender ?? 'unicode')
  const theme = String(options.theme ?? 'tokyo-night')

  // A run of reads folds into one count line; unfold the finished ones that
  // read or wrote a diagram, so each row below can draw it.
  on('ui.render', { component: 'ToolGroup' }, ($, e, next) => {
    const hasDiagram = e.props.calls.some(call => {
      if (fileDiagrams(call.tool, call.output) !== undefined) return true
      if (call.isRunning || call.isErrored || call.isInterrupted) return false
      if (call.tool === 'Bash') return bashDiagrams(call.input, call.output).length > 0

      return call.tool === 'Edit' && editDiagrams(call.output).length > 0
    })

    return !e.props.isActive && !e.props.isExpanded && hasDiagram
      ? next({ ...e, props: { ...e.props, isExpanded: true } })
      : next(e)
  })

  on('ui.render', async ($, e, next) => {
    let segments: Segment[] = []
    let file: FileDiagrams | undefined
    let indent = 0
    // Sources of a Bash or Edit row, drawn under the engine's own row.
    let kept: string[] = []
    if (e.component === 'AssistantMessage' && e.props.isSummary !== true) {
      segments = splitMermaid(e.props.text)
      indent = 2
    } else if (e.component === 'ToolUse' && !e.props.isRunning && !e.props.isErrored) {
      const isInterrupted = e.props.isInterrupted === true
      file = fileDiagrams(e.props.tool, e.props.output)
      segments = (file?.sources ?? []).map(source => ({ kind: 'mermaid', source }))
      indent = 7
      if (file === undefined && !isInterrupted) {
        kept = e.props.tool === 'Bash' ? bashDiagrams(e.props.input, e.props.output) : e.props.tool === 'Edit' ? editDiagrams(e.props.output) : []
        segments = kept.map(source => ({ kind: 'mermaid', source }))
      }
    }
    const sources = segments.flatMap(segment => (segment.kind === 'mermaid' ? [segment.source] : []))
    if (sources.length === 0) return next(e)

    const wantsSvg = e.surface !== 'terminal' || terminalRender === 'image'
    const prepared = new Map<string, Prepared>()
    for (const source of wantsSvg ? sources : []) {
      const key = `${theme}|${source}`
      let svg = svgCache.get(key)
      if (svg === undefined) {
        // SVG layout needs ELK, too large to import: renderer/svg.mjs runs it under node.
        try {
          const ran = await $.process.run(['/usr/bin/env', 'node', `${$.plugin.root}/renderer/svg.mjs`], {
            stdin: JSON.stringify({ source, theme }),
            timeoutMs: 15000,
          })
          svg = ran.exitCode === 0 && !ran.isStdoutTruncated ? parseSvg(ran.stdout) : failure(source, ran.stderr)
        } catch (error) {
          svg = failure(source, error instanceof Error ? error.message : String(error))
        }
        remember(svgCache, key, svg)
      }

      let png: Png | undefined
      if (e.surface === 'terminal' && svg.isRendered) {
        if (!pngCache.has(key)) {
          // The terminal reads the PNG itself, so no pixel crosses $.
          const dir = `${((await $.env.get('TMPDIR')) ?? '/tmp').replace(/\/$/, '')}/mermaid-render`
          const name = `${dir}/${hash(key)}`
          let isRasterized = false
          try {
            await $.process.run(['mkdir', '-p', dir])
            await $.fs.write(`${name}.svg`, svg.svg)
            const ran = await $.process.run(
              ['/usr/bin/env', 'rsvg-convert', '--zoom', '2', '--output', `${name}.png`, `${name}.svg`],
              { timeoutMs: 15000 },
            )
            isRasterized = ran.exitCode === 0
          } catch {
            isRasterized = false
          }
          const evicted = remember(pngCache, key, isRasterized ? { path: `${name}.png`, width: svg.width, height: svg.height } : undefined)
          // Only the PNG is the cache; the SVG is scratch, and a failed run may leave a half-written PNG.
          const stale = [`${name}.svg`, ...(isRasterized ? [] : [`${name}.png`]), ...(evicted === undefined ? [] : [evicted.path])]
          await $.process.run(['rm', '-f', ...stale]).catch(() => undefined)
        }
        png = pngCache.get(key)
      }
      prepared.set(source, { svg, png })
    }

    const ui = $.ui.resolve(e)
    const draw: Draw = { ui, surface: e.surface, width: (e.viewport?.columns ?? 100) - indent - CARD_CHROME, prepared }
    if (e.component === 'ToolUse' && file !== undefined) return toolRow(draw, e.props.tool, file)
    if (kept.length > 0) return underEngineRow(draw, await next(e), kept)

    return reply(draw, segments, e.component === 'AssistantMessage' && e.props.isFirstOfReply)
  })
}

function reply(draw: Draw, segments: Segment[], isFirstOfReply: boolean): RenderElement {
  const { Box, Text, Markdown } = draw.ui

  return (
    <Box flexDirection="row">
      <Box width={2} flexShrink={0}>
        <Text>{isFirstOfReply ? '⏺' : ' '}</Text>
      </Box>
      <Box flexDirection="column" flexGrow={1} gap={1}>
        {segments.map((segment, index) =>
          segment.kind === 'markdown' ? <Markdown key={`md-${index}`} text={segment.text} /> : card(draw, segment.source, index),
        )}
      </Box>
    </Box>
  )
}

function underEngineRow(draw: Draw, engineRow: RenderElement, sources: string[]): RenderElement {
  const { Box } = draw.ui

  return (
    <Box flexDirection="column">
      {engineRow}
      <Box flexDirection="column" marginLeft={5} marginTop={1} gap={1}>
        {sources.map((source, index) => card(draw, source, index))}
      </Box>
    </Box>
  )
}

function toolRow(draw: Draw, tool: string, file: FileDiagrams): RenderElement {
  const { Box, Text } = draw.ui
  const count = file.sources.length

  return (
    <Box flexDirection="column">
      <Text>
        <Text color="success">⏺ </Text>
        <Text bold>{tool}</Text>
        <Text>({file.path})</Text>
      </Text>
      <Text dimColor>
        {`  ⎿  ${file.lines} linhas · ${count} ${count === 1 ? 'diagrama' : 'diagramas'} Mermaid`}
      </Text>
      <Box flexDirection="column" marginLeft={5} marginTop={1} gap={1}>
        {file.sources.map((source, index) => card(draw, source, index))}
      </Box>
    </Box>
  )
}

/** The diagrams a finished, clean foreground Bash run printed. */
function bashDiagrams(input: unknown, output: unknown): string[] {
  const command = (input as { command?: unknown } | undefined)?.command
  const result = output as { stdout?: unknown; interrupted?: unknown; isImage?: unknown; backgroundTaskId?: unknown } | undefined
  const stdout = result?.stdout
  const isClean = result?.interrupted !== true && result?.isImage !== true && result?.backgroundTaskId === undefined
  if (typeof command !== 'string' || typeof stdout !== 'string' || !isClean) return []

  return diagramsInOutput(command, stdout)
}

/** The diagrams a finished Edit left in its file: the whole of a .mmd, else the fences the edit touched. */
function editDiagrams(output: unknown): string[] {
  const result = output as
    | { filePath?: unknown; oldString?: unknown; newString?: unknown; originalFile?: unknown; replaceAll?: unknown }
    | undefined
  const { filePath, oldString, newString, originalFile } = result ?? {}
  if (typeof filePath !== 'string' || typeof oldString !== 'string' || typeof newString !== 'string') return []
  const original = originalFile === null ? null : typeof originalFile === 'string' ? originalFile : undefined
  if (original === undefined) return []

  const edited = applyEdit(original, oldString, newString, result?.replaceAll === true)
  if (isDiagramFile(filePath)) return edited.content.trim() === '' ? [] : [edited.content]

  return diagramsTouched(edited.content, edited.spans)
}

/** The diagrams a finished Read or Write handled, with the file they came from. */
function fileDiagrams(tool: string, output: unknown): FileDiagrams | undefined {
  const result = output as { type?: string; file?: { filePath: string; content: string }; filePath?: string; content?: string } | undefined
  const file =
    tool === 'Read' && result?.type === 'text' && result.file !== undefined
      ? { path: result.file.filePath, content: result.file.content }
      : tool === 'Write' && typeof result?.filePath === 'string' && typeof result.content === 'string'
        ? { path: result.filePath, content: result.content }
        : undefined
  if (file === undefined) return undefined
  const sources = diagramsInFile(file.path, file.content)

  return sources.length === 0 ? undefined : { path: file.path, lines: file.content.split('\n').length, sources }
}

function card(draw: Draw, source: string, index: number): RenderElement {
  const { Box, Text, Code } = draw.ui
  const width = Math.max(20, draw.width)
  const body = cardBody(draw, source, width)
  const { kind, direction } = header(source)
  const isFailed = 'reason' in body

  return (
    <Box
      key={`mermaid-${index}`}
      flexDirection="column"
      borderStyle="round"
      borderColor={isFailed ? 'warning' : 'claude'}
      borderDimColor={!isFailed}
      paddingX={1}
    >
      <Box flexDirection="row" justifyContent="space-between">
        <Text>
          <Text color={isFailed ? 'warning' : 'claude'}>{isFailed ? '▲ ' : '◆ '}</Text>
          <Text bold>{KINDS[kind] ?? kind}</Text>
          {direction !== undefined && <Text dimColor>{` · ${direction}`}</Text>}
        </Text>
        <Text dimColor>mermaid</Text>
      </Box>
      {'reason' in body ? (
        <Box flexDirection="column" marginTop={1}>
          <Text color="warning">Não foi possível desenhar: {body.reason}</Text>
          <Code source={source} language="mermaid" />
        </Box>
      ) : (
        <Box flexDirection="column" marginTop={1}>
          {body.element}
        </Box>
      )}
    </Box>
  )
}

/** The picture a surface draws best, falling back to box-drawing art. */
function cardBody(draw: Draw, source: string, width: number): { element: RenderElement } | { reason: string } {
  const { ui } = draw
  const { svg, png } = draw.prepared.get(source) ?? {}
  const alt = `diagrama ${header(source).kind}`

  if (draw.surface !== 'terminal' && svg?.isRendered && svg.svg.length <= SVG_LIMIT && 'Svg' in ui) {
    const { Svg } = ui
    return { element: <Svg source={svg.svg} alt={alt} /> }
  }

  if (draw.surface === 'terminal' && png !== undefined && 'Image' in ui) {
    const { Image } = ui
    // A cell is about twice as tall as it is wide.
    const columns = Math.min(255, width, Math.max(16, Math.ceil(png.width / 8)))
    const rows = Math.min(255, Math.max(3, Math.round((columns * png.height) / png.width / 2)))
    return { element: <Image source={{ file: png.path, format: 'png' }} columns={columns} rows={rows} alt={alt} /> }
  }

  let art = unicodeCache.get(`${width}|${source}`)
  if (art === undefined) {
    art = renderUnicode(source, width)
    remember(unicodeCache, `${width}|${source}`, art)
  }
  if (!art.isRendered) return { reason: art.reason }

  return { element: unicodeArt(ui, art, width) }
}

function unicodeArt(ui: ElementTable, art: Unicode, width: number): RenderElement {
  const { Box, Text } = ui

  return (
    <Box flexDirection="column">
      {art.lines.map(runs => (
        <Text wrap="truncate-end">
          {runs.map(run => (
            <Text color={GLYPH_COLOR[run.glyph]} bold={run.glyph === 'label'}>
              {run.text}
            </Text>
          ))}
        </Text>
      ))}
      {art.isTurned && <Text dimColor>{'\n↕ disposto na vertical para caber na largura do terminal'}</Text>}
      {art.width > width && <Text dimColor>{`\n↔ o diagrama tem ${art.width} colunas; alargue o terminal para vê-lo inteiro`}</Text>}
    </Box>
  )
}

function parseSvg(svg: string): Svg {
  const [, width = '640', height = '360'] = /viewBox="[\d.]+ [\d.]+ ([\d.]+) ([\d.]+)"/.exec(svg) ?? []

  return { isRendered: true, svg, width: Number(width), height: Number(height) }
}

function failure(source: string, reason: string): Failure {
  return { isRendered: false, kind: header(source).kind, reason: reason.trim() || 'renderer/svg.mjs falhou' }
}

/** Stores the value and returns the entry it pushed out, if any. */
function remember<T>(cache: Map<string, T>, key: string, value: T): T | undefined {
  let evicted: T | undefined
  if (cache.size >= CACHE_LIMIT) {
    const oldest = cache.keys().next().value as string
    evicted = cache.get(oldest)
    cache.delete(oldest)
  }
  cache.set(key, value)

  return evicted
}

function hash(text: string): string {
  let value = 0x811c9dc5
  for (let index = 0; index < text.length; index += 1) {
    value ^= text.charCodeAt(index)
    value = Math.imul(value, 0x01000193)
  }

  return (value >>> 0).toString(16)
}
