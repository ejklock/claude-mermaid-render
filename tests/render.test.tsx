import { expect, test } from 'claude-code/testing'

import { diagramsInFile, diagramsTouched, splitMermaid } from '../hooks/fences'
import { renderUnicode } from '../hooks/diagram'
import { messagesFor } from '../hooks/messages'

const FLOW = ['flowchart LR', '  A[Pedido] --> B{Pago?}', '  B -->|sim| C[Enviar]', '  B -->|não| D[Cancelar]'].join('\n')
const REPLY = `Aqui está o fluxo:\n\n\`\`\`mermaid\n${FLOW}\n\`\`\`\n\nDepois disso o pedido fecha.`
const VIEWPORT = { columns: 120, rows: 40 }
const PT = { options: { language: 'pt-BR' } }

test('splits prose from closed mermaid fences only', () => {
  expect(splitMermaid(REPLY).map(segment => segment.kind)).toEqual(['markdown', 'mermaid', 'markdown'])
  expect(splitMermaid('texto\n```mermaid\ngraph TD\n  A-->B').map(segment => segment.kind)).toEqual(['markdown'])
  expect(splitMermaid('````markdown\n```mermaid\ngraph TD\n```\n````').map(segment => segment.kind)).toEqual(['markdown'])
})

test('a reply with a diagram draws prose and a titled card on the terminal', PT, async $ => {
  const ui = await $.ui.mount({
    plugin: 'mermaid-render',
    surface: 'terminal',
    component: 'AssistantMessage',
    props: { text: REPLY, isFirstOfReply: true },
    viewport: VIEWPORT,
  })

  expect(await ui.find({ type: 'Markdown', text: /Aqui está o fluxo/ })).toBeDefined()
  expect(await ui.find({ type: 'Markdown', text: /pedido fecha/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'Fluxograma' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /Pedido/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /Cancelar/ })).toBeDefined()
})

test('a horizontal flowchart too wide for the terminal is laid out vertically', PT, async $ => {
  const ui = await $.ui.mount({
    plugin: 'mermaid-render',
    surface: 'terminal',
    component: 'AssistantMessage',
    props: { text: REPLY, isFirstOfReply: false },
    viewport: { columns: 40, rows: 40 },
  })

  expect(await ui.find({ type: 'Text', text: /disposto na vertical/ })).toBeDefined()
})

test('a diagram that does not parse shows the reason and its source', PT, async $ => {
  const ui = await $.ui.mount({
    plugin: 'mermaid-render',
    surface: 'terminal',
    component: 'AssistantMessage',
    props: { text: '```mermaid\npie\n  "a": 1\n```', isFirstOfReply: true },
    viewport: VIEWPORT,
  })

  expect(await ui.find({ type: 'Text', text: /Não foi possível desenhar/ })).toBeDefined()
  expect(await ui.find({ type: 'Code', text: /pie/ })).toBeDefined()
})

test('a reply without a closed mermaid fence is left to the engine', async ($, on) => {
  on('ui.render', { component: 'AssistantMessage' }, ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text key="engine">engine</Text>
  })
  const ui = await $.ui.mount({
    plugin: 'mermaid-render',
    surface: 'terminal',
    component: 'AssistantMessage',
    props: { text: 'escrevendo...\n```mermaid\ngraph TD', isFirstOfReply: true },
    viewport: VIEWPORT,
  })

  expect(await ui.find({ text: 'engine' })).toBeDefined()
})

test('a Read of a .mmd file draws its diagram under the tool row', PT, async $ => {
  const ui = await $.ui.mount({
    plugin: 'mermaid-render',
    surface: 'terminal',
    component: 'ToolUse',
    props: {
      tool_use_id: 'toolu_1',
      tool: 'Read',
      input: { file_path: '/repo/docs/fluxo.mmd' },
      isRunning: false,
      isErrored: false,
      isInterrupted: false,
      output: { type: 'text', file: { filePath: '/repo/docs/fluxo.mmd', content: FLOW, numLines: 4, startLine: 1, totalLines: 4 } },
    },
    viewport: VIEWPORT,
  })

  expect(await ui.find({ type: 'Text', text: /1 diagrama Mermaid/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /Enviar/ })).toBeDefined()
})

test('the desktop draws the SVG the node renderer answers', async ($, on) => {
  on('process.run', () => ({
    value: {
      exitCode: 0,
      stdout: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 120"><rect width="300" height="120"/></svg>',
      stderr: '',
      isStdoutTruncated: false,
      isStderrTruncated: false,
    },
  }))
  const ui = await $.ui.mount({
    plugin: 'mermaid-render',
    surface: 'desktop',
    component: 'AssistantMessage',
    props: { text: REPLY, isFirstOfReply: true },
    viewport: VIEWPORT,
  })

  expect(await ui.find({ type: 'Svg' })).toBeDefined()
})

const SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 120"><rect width="300" height="120"/></svg>'
const ran = (exitCode: number, stdout = '') => ({ value: { exitCode, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } })
const fence = (source: string, mark = '```') => `${mark}mermaid\n${source}\n${mark}`
const readCall = (path: string, content: string) => ({
  tool: 'Read',
  input: { file_path: path },
  isRunning: false,
  isErrored: false,
  isInterrupted: false,
  output: { type: 'text', file: { filePath: path, content, numLines: 1, startLine: 1, totalLines: 1 } },
})

test('C1 a CRLF fence gives one mermaid segment without carriage returns', () => {
  expect(splitMermaid('```mermaid\r\ngraph TD\r\n  A-->B\r\n```\r\n')).toEqual([{ kind: 'mermaid', source: 'graph TD\n  A-->B' }])
})

test('C1 text mixing LF and CRLF lines finds every fence', () => {
  const text = 'um\r\n```mermaid\r\ngraph TD\r\n  A-->B\r\n```\r\ndois\n```mermaid\ngraph LR\n  C-->D\n```\r\n'
  const sources = splitMermaid(text).flatMap(segment => (segment.kind === 'mermaid' ? [segment.source] : []))

  expect(sources).toEqual(['graph TD\n  A-->B', 'graph LR\n  C-->D'])
})

test('C1 a tilde fence closed by tildes in CRLF is found', () => {
  expect(splitMermaid('~~~mermaid\r\ngraph TD\r\n  A-->B\r\n~~~\r\n')).toEqual([{ kind: 'mermaid', source: 'graph TD\n  A-->B' }])
})

test('C1 plain LF input gives the segments it always gave', () => {
  expect(splitMermaid(REPLY)).toEqual([
    { kind: 'markdown', text: 'Aqui está o fluxo:' },
    { kind: 'mermaid', source: FLOW },
    { kind: 'markdown', text: 'Depois disso o pedido fecha.' },
  ])
})

test('C1 a CRLF opener with no closer stays prose', () => {
  expect(splitMermaid('texto\r\n```mermaid\r\ngraph TD\r\n  A-->B').map(segment => segment.kind)).toEqual(['markdown'])
})

test('C1 a markdown file in CRLF yields its diagrams', () => {
  expect(diagramsInFile('/repo/README.md', 'x\r\n```mermaid\r\ngraph TD\r\n  A-->B\r\n```\r\n')).toEqual(['graph TD\n  A-->B'])
})

test('C2 a tilde fence in a reply draws a card', PT, async $ => {
  const ui = await $.ui.mount({
    plugin: 'mermaid-render',
    surface: 'terminal',
    component: 'AssistantMessage',
    props: { text: fence(FLOW, '~~~'), isFirstOfReply: true },
    viewport: VIEWPORT,
  })

  expect(await ui.find({ type: 'Text', text: 'Fluxograma' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /Cancelar/ })).toBeDefined()
})

test('C2 two fences in a reply draw two cards with prose between', async $ => {
  const ui = await $.ui.mount({
    plugin: 'mermaid-render',
    surface: 'terminal',
    component: 'AssistantMessage',
    props: { text: `${fence(FLOW)}\n\nentre os dois\n\n${fence('graph TD\n  X-->Y')}`, isFirstOfReply: true },
    viewport: VIEWPORT,
  })

  expect(await ui.findAll({ type: 'Text', text: 'mermaid' })).toHaveLength(2)
  expect(await ui.find({ type: 'Markdown', text: /entre os dois/ })).toBeDefined()
})

test('C2 a finished Write of a markdown file draws its one card', PT, async $ => {
  const content = `# Doc\n\n${fence(FLOW)}\n`
  const ui = await $.ui.mount({
    plugin: 'mermaid-render',
    surface: 'terminal',
    component: 'ToolUse',
    props: {
      tool_use_id: 'toolu_2',
      tool: 'Write',
      input: { file_path: '/repo/doc.md', content },
      isRunning: false,
      isErrored: false,
      isInterrupted: false,
      output: { type: 'create', filePath: '/repo/doc.md', content },
    },
    viewport: VIEWPORT,
  })

  expect(await ui.find({ type: 'Text', text: /1 diagrama Mermaid/ })).toBeDefined()
  expect(await ui.findAll({ type: 'Text', text: 'mermaid' })).toHaveLength(1)
})

type GroupFlags = { isActive?: boolean; isExpanded?: boolean; path?: string }

async function expandedSeenByEngine($: Parameters<Parameters<typeof test>[1]>[0], on: Parameters<Parameters<typeof test>[1]>[1], flags: GroupFlags) {
  let seen: { isExpanded: boolean } | undefined
  on('ui.render', { component: 'ToolGroup' }, ($, e) => {
    seen = e.props
    const { Text } = $.ui.resolve(e)
    return <Text key="engine">engine</Text>
  })
  const props = {
    calls: [readCall(flags.path ?? '/repo/fluxo.mmd', FLOW)],
    isActive: flags.isActive ?? false,
    isExpanded: flags.isExpanded ?? false,
  }
  const ui = await $.ui.mount({ plugin: 'mermaid-render', surface: 'terminal', component: 'ToolGroup', props, viewport: VIEWPORT })
  await ui.find({ text: 'engine' })

  return seen?.isExpanded
}

test('C2 a finished folded group holding a diagram read is drawn expanded', async ($, on) => {
  expect(await expandedSeenByEngine($, on, {})).toBe(true)
})

test('C2 an active group is passed on unchanged', async ($, on) => {
  expect(await expandedSeenByEngine($, on, { isActive: true })).toBe(false)
})

test('C2 an already expanded group is passed on unchanged', async ($, on) => {
  expect(await expandedSeenByEngine($, on, { isExpanded: true })).toBe(true)
})

test('C2 a group with no diagram call is passed on unchanged', async ($, on) => {
  expect(await expandedSeenByEngine($, on, { path: '/repo/notas.txt' })).toBe(false)
})

const PNG_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='
/** The 1x1 PNG padded with trailing zero bytes to `bytes` bytes, in base64. */
const base64Of = (bytes: number) => btoa(atob(PNG_BASE64).padEnd(bytes, '\0'))
const PNG_LIMIT = 2097152

type PngAnswer = string | Error

/**
 * Answers node with an SVG, rsvg-convert with `rsvgExit`, fs.read with `png` (or rejects), the rest with success.
 * A list answers each successive read in turn, the last one repeating. Returns every argv, with the paths read, the `as` of each read and the paths written.
 */
function answerRuns(on: Parameters<Parameters<typeof test>[1]>[1], rsvgExit: number, png: PngAnswer | PngAnswer[] = PNG_BASE64) {
  const runs: string[][] = []
  const reads: string[] = []
  const readAs: string[] = []
  const writes: string[] = []
  const answers = Array.isArray(png) ? png : [png]
  on('env.get', () => ({ value: '/var/tmp-test/' }))
  on('fs.write', (_, { path }) => {
    writes.push(path)

    return { value: undefined }
  })
  on('fs.read', (_, { path, as }) => {
    const answer = answers[Math.min(reads.length, answers.length - 1)] ?? PNG_BASE64
    reads.push(path)
    readAs.push(String(as))
    if (answer instanceof Error) throw answer

    return { value: { base64: answer } }
  })
  on('process.run', (_, { argv }) => {
    runs.push([...argv])
    if (argv[0] === 'node') return ran(0, SVG)

    return ran(argv[1] === 'rsvg-convert' ? rsvgExit : 0)
  })

  return Object.assign(runs, { reads, readAs, writes })
}

const removed = (runs: string[][]) => runs.filter(argv => argv[0] === 'rm').flatMap(argv => argv.slice(1))
const rasterized = (runs: string[][]) => runs.filter(argv => argv[1] === 'rsvg-convert').length
const mountReply = ($: Parameters<Parameters<typeof test>[1]>[0], source: string) =>
  $.ui.mount({ plugin: 'mermaid-render', surface: 'terminal', component: 'AssistantMessage', props: { text: fence(source), isFirstOfReply: true }, viewport: VIEWPORT })

test('image mode card holds the PNG bytes read from under the answered TMPDIR', { options: { terminalRender: 'image' } }, async ($, on) => {
  const runs = answerRuns(on, 0)
  const ui = await mountReply($, 'graph TD\n  P1-->P2')
  const image = await ui.find({ type: 'Image' })

  expect(image?.props.source).toEqual({ png: PNG_BASE64 })
  expect(runs.reads).toHaveLength(1)
  expect(runs.reads[0]).toMatch(/^\/var\/tmp-test\/mermaid-render\/[0-9a-f]+-\d+\.png$/)
  expect(runs.readAs).toEqual(['bytes'])
})

test('image mode redraw of the same diagram runs no second rasterize or read', { options: { terminalRender: 'image' } }, async ($, on) => {
  const runs = answerRuns(on, 0)
  await (await mountReply($, 'graph TD\n  H1-->H2')).find({ type: 'Image' })
  await (await mountReply($, 'graph TD\n  H1-->H2')).find({ type: 'Image' })

  expect(rasterized(runs)).toBe(1)
  expect(runs.reads).toHaveLength(1)
})

test('a successful rasterize removes the svg and the png in one rm', { options: { terminalRender: 'image' } }, async ($, on) => {
  const runs = answerRuns(on, 0)
  const ui = await mountReply($, 'graph TD\n  S1-->S2')
  await ui.find({ type: 'Image' })

  expect(runs.filter(argv => argv[0] === 'rm')).toHaveLength(1)
  expect(removed(runs).filter(path => path.endsWith('.svg'))).toHaveLength(1)
  expect(removed(runs).filter(path => path.endsWith('.png'))).toHaveLength(1)
})

const sizeCases: [string, number, boolean][] = [
  ['exactly the size limit', PNG_LIMIT, true],
  ['one byte over the size limit', PNG_LIMIT + 1, false],
  ['one byte under the size limit, base64 padded with two characters', PNG_LIMIT - 1, true],
  ['the 70-byte fixture', 70, true],
]
for (const [label, bytes, isDrawn] of sizeCases) {
  test(`image mode with a PNG of ${label}`, { options: { terminalRender: 'image' } }, async ($, on) => {
    const runs = answerRuns(on, 0, base64Of(bytes))
    const ui = await mountReply($, 'graph TD\n  Q1-->Q2')

    if (isDrawn) expect(await ui.find({ type: 'Image' })).toBeDefined()
    else expect(await ui.find({ type: 'Text', text: /Q1/ })).toBeDefined()
    expect(await ui.findAll({ type: 'Image' })).toHaveLength(isDrawn ? 1 : 0)
    expect(removed(runs).filter(path => path.endsWith('.png'))).toHaveLength(1)
  })
}

test('image mode with an unreadable PNG falls back to Unicode art and caches the failure', { options: { terminalRender: 'image' } }, async ($, on) => {
  const runs = answerRuns(on, 0, new Error('missing'))
  const ui = await mountReply($, 'graph TD\n  U1-->U2')

  expect(await ui.find({ type: 'Text', text: /U1/ })).toBeDefined()
  expect(await ui.findAll({ type: 'Image' })).toHaveLength(0)
  expect(removed(runs).filter(path => path.endsWith('.svg'))).toHaveLength(1)
  expect(removed(runs).filter(path => path.endsWith('.png'))).toHaveLength(1)
  await mountReply($, 'graph TD\n  U1-->U2')
  expect(rasterized(runs)).toBe(1)
})

test('a failed rasterize reads nothing, removes the svg and png and falls back to Unicode art', { options: { terminalRender: 'image' } }, async ($, on) => {
  const runs = answerRuns(on, 1)
  const ui = await mountReply($, 'graph TD\n  F1-->F2')

  expect(await ui.find({ type: 'Text', text: /F1/ })).toBeDefined()
  expect(await ui.findAll({ type: 'Image' })).toHaveLength(0)
  expect(runs.reads).toHaveLength(0)
  expect(removed(runs).filter(path => path.endsWith('.svg'))).toHaveLength(1)
  expect(removed(runs).filter(path => path.endsWith('.png'))).toHaveLength(1)
})

test('an evicted diagram is rasterized again when drawn again', { options: { terminalRender: 'image' } }, async ($, on) => {
  const runs = answerRuns(on, 0)
  await mountReply($, 'graph TD\n  E0-->Z')
  for (let index = 1; index <= 201; index += 1) await mountReply($, `graph TD\n  E${index}-->Z`)
  await (await mountReply($, 'graph TD\n  E0-->Z')).find({ type: 'Image' })

  const outputs = rasterizedStems(runs).map(output => output.replace(/-\d+\.png$/, ''))
  const firstOutput = outputs[0]

  expect(outputs.filter(output => output === firstOutput)).toHaveLength(2)
})

/** The base64 of a PNG whose base64 text is `chars` long (a multiple of 4) and whose bytes stay within the size limit. */
const base64Chars = (chars: number) => base64Of((chars / 4) * 3)
const PNG_CACHE_BUDGET = 67108864
const BUDGET_SHARE = 2097152

/** Draws `count` distinct diagrams, one after another, each answered with its own PNG. */
async function drawEach($: Mount, prefix: string, count: number) {
  for (let index = 0; index < count; index += 1) {
    await (await mountReply($, `graph TD\n  ${prefix}${index}-->Z`)).find({ type: 'Image' })
  }
}
const rasterizedStems = (runs: string[][]) =>
  runs.filter(argv => argv[1] === 'rsvg-convert').map(argv => argv[argv.indexOf('--output') + 1] ?? '')

test('image mode keeps every PNG while the cached base64 sums exactly to the byte budget', { options: { terminalRender: 'image' } }, async ($, on) => {
  const share = base64Chars(BUDGET_SHARE)
  const count = PNG_CACHE_BUDGET / BUDGET_SHARE
  const runs = answerRuns(on, 0, share)
  await drawEach($, 'BA', count)
  await (await mountReply($, 'graph TD\n  BA0-->Z')).find({ type: 'Image' })

  expect(rasterized(runs)).toBe(count)
})

test('image mode evicts the oldest PNG when a new entry passes the byte budget and keeps the newest', { options: { terminalRender: 'image' } }, async ($, on) => {
  const share = base64Chars(BUDGET_SHARE)
  const count = PNG_CACHE_BUDGET / BUDGET_SHARE
  const runs = answerRuns(on, 0, [...Array(count - 1).fill(share), base64Chars(BUDGET_SHARE - 4), base64Chars(96)])
  await drawEach($, 'BB', count)
  await (await mountReply($, 'graph TD\n  BBX-->Z')).find({ type: 'Image' })
  await (await mountReply($, 'graph TD\n  BBX-->Z')).find({ type: 'Image' })
  expect(rasterized(runs)).toBe(count + 1)
  await (await mountReply($, 'graph TD\n  BB0-->Z')).find({ type: 'Image' })

  expect(rasterized(runs)).toBe(count + 2)
  await (await mountReply($, 'graph TD\n  BB1-->Z')).find({ type: 'Image' })
  expect(rasterized(runs)).toBe(count + 2)
})

test('image mode evicts several oldest PNGs for one store that overshoots the byte budget and keeps the rest', { options: { terminalRender: 'image' } }, async ($, on) => {
  const share = base64Chars(BUDGET_SHARE)
  const small = base64Chars(96)
  const smallCount = 4
  const bigCount = PNG_CACHE_BUDGET / BUDGET_SHARE - 1
  const runs = answerRuns(on, 0, [...Array(smallCount).fill(small), ...Array(bigCount).fill(share), share])
  await drawEach($, 'BD', smallCount + bigCount)
  await (await mountReply($, 'graph TD\n  BDX-->Z')).find({ type: 'Image' })
  const drawn = smallCount + bigCount + 1
  expect(rasterized(runs)).toBe(drawn)

  await (await mountReply($, `graph TD\n  BD${smallCount}-->Z`)).find({ type: 'Image' })
  await (await mountReply($, 'graph TD\n  BDX-->Z')).find({ type: 'Image' })
  expect(rasterized(runs)).toBe(drawn)
  // Newest evicted first: each redraw stores again and may push out an older entry, so the older ones must not be redrawn before it.
  for (let step = 1; step <= smallCount; step += 1) {
    await (await mountReply($, `graph TD\n  BD${smallCount - step}-->Z`)).find({ type: 'Image' })
    expect(rasterized(runs)).toBe(drawn + step)
  }
})

test('image mode counts a failed PNG as zero bytes and evicts nothing for it', { options: { terminalRender: 'image' } }, async ($, on) => {
  const share = base64Chars(BUDGET_SHARE)
  const count = PNG_CACHE_BUDGET / BUDGET_SHARE
  const runs = answerRuns(on, 0, [...Array(count).fill(share), new Error('missing')])
  await drawEach($, 'BC', count)
  await mountReply($, 'graph TD\n  BCX-->Z')
  await (await mountReply($, 'graph TD\n  BC0-->Z')).find({ type: 'Image' })

  expect(rasterized(runs)).toBe(count + 1)
})

test('two rasterizes of one diagram write, convert, read and remove under different paths', { options: { terminalRender: 'image' } }, async ($, on) => {
  const runs = answerRuns(on, 0)
  const first = mountReply($, 'graph TD\n  CC1-->CC2')
  const second = mountReply($, 'graph TD\n  CC1-->CC2')
  await (await first).find({ type: 'Image' })
  await (await second).find({ type: 'Image' })

  const stems = runs.reads.map(path => path.replace(/\.png$/, ''))
  expect(stems).toHaveLength(2)
  expect(stems[0]).not.toBe(stems[1])
  for (const stem of stems) {
    expect(stem).toMatch(/\/[0-9a-f]+-\d+$/)
    expect(runs.writes.filter(path => path.startsWith(stem))).toEqual([`${stem}.svg`])
    expect(rasterizedStems(runs).filter(path => path === `${stem}.png`)).toHaveLength(1)
    expect(runs.filter(argv => argv[1] === 'rsvg-convert' && argv.includes(`${stem}.svg`))).toHaveLength(1)
    expect(runs.filter(argv => argv[0] === 'rm' && argv.includes(`${stem}.svg`) && argv.includes(`${stem}.png`))).toHaveLength(1)
  }
  expect(runs.filter(argv => argv[0] === 'rm')).toHaveLength(2)
})

const SCRATCH_DIR = '/var/tmp-test/mermaid-render/'

test('every scratch path of a rasterize carries the answered session id', { options: { terminalRender: 'image' } }, async ($, on) => {
  const runs = answerRuns(on, 0)
  on('session.id', () => ({ value: 'sess-42' }))
  await (await mountReply($, 'graph TD\n  SA1-->SA2')).find({ type: 'Image' })

  const stem = runs.reads[0]?.replace(/\.png$/, '') ?? ''
  expect(stem).toMatch(/^\/var\/tmp-test\/mermaid-render\/[0-9a-f]+-sess-42-\d+$/)
  expect(runs.writes).toEqual([`${stem}.svg`])
  expect(rasterizedStems(runs)).toEqual([`${stem}.png`])
  expect(runs.filter(argv => argv[0] === 'rm' && argv.includes(`${stem}.svg`) && argv.includes(`${stem}.png`))).toHaveLength(1)
})

test('two sessions rasterizing one diagram write under different session parts', { options: { terminalRender: 'image' } }, async ($, on) => {
  const runs = answerRuns(on, 0)
  const ids = ['sess-a', 'sess-b']
  let asked = 0
  on('session.id', () => ({ value: ids[asked++] ?? 'sess-x' }))
  const first = mountReply($, 'graph TD\n  SB1-->SB2')
  const second = mountReply($, 'graph TD\n  SB1-->SB2')
  await (await first).find({ type: 'Image' })
  await (await second).find({ type: 'Image' })

  expect(runs.reads).toHaveLength(2)
  expect(runs.reads.some(path => path.includes('-sess-a-'))).toBe(true)
  expect(runs.reads.some(path => path.includes('-sess-b-'))).toBe(true)
})

test('a session id with unsafe characters keeps every scratch path inside the scratch directory', { options: { terminalRender: 'image' } }, async ($, on) => {
  const runs = answerRuns(on, 0)
  on('session.id', () => ({ value: '../x y/z' }))
  await (await mountReply($, 'graph TD\n  SC1-->SC2')).find({ type: 'Image' })

  const written = [...runs.writes, ...runs.reads, ...rasterizedStems(runs)]
  expect(written.length).toBeGreaterThan(0)
  for (const path of written) {
    expect(path.startsWith(SCRATCH_DIR)).toBe(true)
    expect(path.slice(SCRATCH_DIR.length)).toMatch(/^[0-9a-f]+-[A-Za-z0-9-]+-\d+\.(svg|png)$/)
  }
})

test('image mode still draws when the session id cannot be read', { options: { terminalRender: 'image' } }, async ($, on) => {
  const runs = answerRuns(on, 0)
  on('session.id', () => {
    throw new Error('no session')
  })
  const ui = await mountReply($, 'graph TD\n  SD1-->SD2')

  expect(await ui.find({ type: 'Image' })).toBeDefined()
  expect(runs.reads[0]).toMatch(/^\/var\/tmp-test\/mermaid-render\/[0-9a-f]+-\d+\.png$/)
})

test('an evicted diagram is rasterized again under a new path', { options: { terminalRender: 'image' } }, async ($, on) => {
  const runs = answerRuns(on, 0)
  await (await mountReply($, 'graph TD\n  CD0-->Z')).find({ type: 'Image' })
  for (let index = 1; index <= 201; index += 1) await mountReply($, `graph TD\n  CD${index}-->Z`)
  await (await mountReply($, 'graph TD\n  CD0-->Z')).find({ type: 'Image' })

  const outputs = rasterizedStems(runs)
  expect(outputs.filter(output => output === outputs[0])).toHaveLength(1)
  expect(new Set(outputs).size).toBe(outputs.length)
})

type Mount = Parameters<Parameters<typeof test>[1]>[0]
type On = Parameters<Parameters<typeof test>[1]>[1]
type ToolFlags = { isRunning?: boolean; isErrored?: boolean; isInterrupted?: boolean }

const toolProps = (tool: string, input: unknown, output: unknown, flags: ToolFlags = {}) => ({
  tool_use_id: 'toolu_9',
  tool,
  input,
  output,
  isRunning: false,
  isErrored: false,
  isInterrupted: false,
  ...flags,
})

const withEngineRow = new WeakSet<object>()

/** Mounts a ToolUse over an engine row and returns the order of engine row and cards drawn. */
async function rowsDrawn($: Mount, on: On, props: ReturnType<typeof toolProps>) {
  // The kit allows hooks beneath the plugin only before the first mount, so one engine row serves every mount of a test.
  if (!withEngineRow.has(on)) {
    withEngineRow.add(on)
    on('ui.render', { component: 'ToolUse' }, ($, e) => {
      const { Text } = $.ui.resolve(e)
      return <Text key="engine">engine</Text>
    })
  }
  const ui = await $.ui.mount({ plugin: 'mermaid-render', surface: 'terminal', component: 'ToolUse', props, viewport: VIEWPORT })
  await ui.find({ text: 'engine' })
  const found = await ui.findAll({ type: 'Text', text: /^(engine|mermaid)$/ })

  return { ui, order: found.map(node => String(node.props.children ?? node.text)) }
}

const bashOut = (stdout: string, extra: object = {}) => ({ stdout, stderr: '', interrupted: false, ...extra })
const bash = (command: string, output: unknown, flags?: ToolFlags) => toolProps('Bash', { command }, output, flags)
const NO_CARD = ['engine']
const ONE_CARD = ['engine', 'mermaid']
const TWO_CARDS = ['engine', 'mermaid', 'mermaid']
const OTHER = 'graph TD\n  X1 --> Y1'

test('BE1 a Bash stdout fence with prose around it draws the engine row and one card', async ($, on) => {
  const { ui, order } = await rowsDrawn($, on, bash('cat notas.md', bashOut(`antes\n${fence(FLOW)}\ndepois\n`)))

  expect(order).toEqual(ONE_CARD)
  expect(await ui.find({ type: 'Text', text: /Cancelar/ })).toBeDefined()
})

test('BE1 two Bash stdout fences draw two cards in order', async ($, on) => {
  const { ui, order } = await rowsDrawn($, on, bash('cat notas.md', bashOut(`${fence(FLOW)}\n\n${fence(OTHER)}`)))
  const labels = (await ui.findAll({ type: 'Text', text: /Cancelar|X1/ })).map(node => String(node.props.children ?? node.text))

  expect(order).toEqual(TWO_CARDS)
  expect(labels[0]).toMatch(/Cancelar/)
  expect(labels[labels.length - 1]).toMatch(/X1/)
})

test('BE1 an unclosed Bash stdout fence is left to the engine', async ($, on) => {
  const { order } = await rowsDrawn($, on, bash('cat notas.md', bashOut('```mermaid\ngraph TD\n  A-->B')))

  expect(order).toEqual(NO_CARD)
})

test('BE1 a mermaid fence nested in another fence draws no card', async ($, on) => {
  const { order } = await rowsDrawn($, on, bash('cat notas.md', bashOut(`\`\`\`\`markdown\n${fence(FLOW)}\n\`\`\`\``)))

  expect(order).toEqual(NO_CARD)
})

test('BE1 a CRLF Bash stdout fence draws one card', async ($, on) => {
  const { order } = await rowsDrawn($, on, bash('cat notas.md', bashOut('```mermaid\r\ngraph TD\r\n  A-->B\r\n```\r\n')))

  expect(order).toEqual(ONE_CARD)
})

test('BE2 a cat of a .mmd file draws one card of the whole stdout', async ($, on) => {
  const { order } = await rowsDrawn($, on, bash('cat demo/checkout.mmd', bashOut(FLOW)))

  expect(order).toEqual(ONE_CARD)
})

test('BE2 a sed of an upper case .MERMAID file draws one card', async ($, on) => {
  const { order } = await rowsDrawn($, on, bash("sed -n '1,40p' x.MERMAID", bashOut('sequenceDiagram\n  A->>B: oi')))

  expect(order).toEqual(ONE_CARD)
})

test('BE2 blank lines, frontmatter or a comment before the header still draw one card', async ($, on) => {
  const blank = await rowsDrawn($, on, bash('cat a.mmd', bashOut(`\n\n${FLOW}`)))
  const comment = await rowsDrawn($, on, bash('cat a.mmd', bashOut(`%% nota\n${FLOW}`)))
  const front = await rowsDrawn($, on, bash('cat a.mmd', bashOut(`---\ntitle: x\n---\n${FLOW}`)))

  expect([blank.order, comment.order, front.order]).toEqual([ONE_CARD, ONE_CARD, ONE_CARD])
})

test('BE2 line numbered stdout of a .mmd file draws no card', async ($, on) => {
  const { order } = await rowsDrawn($, on, bash('cat -n a.mmd', bashOut('     1\tflowchart LR\n     2\t  A-->B')))

  expect(order).toEqual(NO_CARD)
})

test('BE2 empty stdout of a .mmd command draws no card', async ($, on) => {
  const { order } = await rowsDrawn($, on, bash('cat a.mmd', bashOut('')))

  expect(order).toEqual(NO_CARD)
})

test('BE2 a diagram header from a command naming no .mmd path draws no card', async ($, on) => {
  const { order } = await rowsDrawn($, on, bash('echo "flowchart LR"', bashOut(FLOW)))

  expect(order).toEqual(NO_CARD)
})

const cleanBash = (output: unknown, flags?: ToolFlags) => bash('cat notas.md', output, flags)
const FENCED = bashOut(fence(FLOW))
const NOT_CLEAN: [string, ReturnType<typeof toolProps>][] = [
  ['isRunning', cleanBash(FENCED, { isRunning: true })],
  ['isErrored', cleanBash(FENCED, { isErrored: true })],
  ['isInterrupted', cleanBash(FENCED, { isInterrupted: true })],
  ['result interrupted', cleanBash(bashOut(fence(FLOW), { interrupted: true }))],
  ['result isImage', cleanBash(bashOut(fence(FLOW), { isImage: true }))],
  ['result backgroundTaskId', cleanBash(bashOut(fence(FLOW), { backgroundTaskId: 'b1' }))],
  ['undefined output', cleanBash(undefined)],
  ['string output', cleanBash(fence(FLOW))],
  ['object without stdout', cleanBash({ stderr: fence(FLOW), interrupted: false })],
]

for (const [name, props] of NOT_CLEAN) {
  test(`BE3 a Bash call with ${name} is left to the engine`, async ($, on) => {
    const { order } = await rowsDrawn($, on, props)

    expect(order).toEqual(NO_CARD)
  })
}

async function groupExpanded($: Mount, on: On, calls: object[], flags: { isActive?: boolean; isExpanded?: boolean } = {}) {
  let seen: boolean | undefined
  on('ui.render', { component: 'ToolGroup' }, ($, e) => {
    seen = e.props.isExpanded
    const { Text } = $.ui.resolve(e)
    return <Text key="engine">engine</Text>
  })
  const props = { calls, isActive: flags.isActive ?? false, isExpanded: flags.isExpanded ?? false }
  const ui = await $.ui.mount({ plugin: 'mermaid-render', surface: 'terminal', component: 'ToolGroup', props, viewport: VIEWPORT })
  await ui.find({ text: 'engine' })

  return seen
}

const bashCall = (command: string, output: unknown, flags: ToolFlags = {}) => ({
  tool: 'Bash',
  input: { command },
  isRunning: false,
  isErrored: false,
  isInterrupted: false,
  output,
  ...flags,
})

test('BE4 a finished folded group holding a Bash call with a stdout fence is drawn expanded', async ($, on) => {
  expect(await groupExpanded($, on, [bashCall('cat n.md', FENCED)])).toBe(true)
})

test('BE4 a finished folded group holding a Bash cat of a .mmd file is drawn expanded', async ($, on) => {
  expect(await groupExpanded($, on, [bashCall('cat a.mmd', bashOut(FLOW))])).toBe(true)
})

test('BE4 an active group holding a Bash diagram is passed on unchanged', async ($, on) => {
  expect(await groupExpanded($, on, [bashCall('cat n.md', FENCED)], { isActive: true })).toBe(false)
})

test('BE4 an already expanded group holding a Bash diagram is passed on unchanged', async ($, on) => {
  expect(await groupExpanded($, on, [bashCall('cat n.md', FENCED)], { isExpanded: true })).toBe(true)
})

test('BE4 a group whose Bash calls have no diagram is passed on unchanged', async ($, on) => {
  expect(await groupExpanded($, on, [bashCall('ls', bashOut('a\nb'))])).toBe(false)
})

test('BE4 a group whose diagram Bash call is still running is passed on unchanged', async ($, on) => {
  expect(await groupExpanded($, on, [bashCall('cat n.md', FENCED, { isRunning: true })])).toBe(false)
})

const F1 = 'graph TD\n  Alfa1 --> Alfa2'
const F2 = 'graph TD\n  Beta1 --> Beta2'
const F3 = 'graph TD\n  Gama1 --> Gama2'
const DOC = `# Doc\n\n${fence(F1)}\n\nmeio\n\n${fence(F2)}\n\nfim\n\n${fence(F3)}\n`

type EditArgs = { path?: string; old: string; next: string; replaceAll?: boolean; original?: string | null }
const edit = ({ path = '/repo/doc.md', old, next, replaceAll = false, original = DOC }: EditArgs, flags?: ToolFlags) =>
  toolProps(
    'Edit',
    { file_path: path, old_string: old, new_string: next, replace_all: replaceAll },
    { filePath: path, oldString: old, newString: next, originalFile: original, structuredPatch: [], userModified: false, replaceAll },
    flags,
  )

const labelsOf = async (ui: Awaited<ReturnType<typeof rowsDrawn>>['ui'], pattern: RegExp) =>
  (await ui.findAll({ type: 'Text', text: pattern })).map(node => String(node.props.children ?? node.text))

test('BE5 an edit inside the second fence of a markdown file draws that fence updated', async ($, on) => {
  const { ui, order } = await rowsDrawn($, on, edit({ old: 'Beta2', next: 'Novo2' }))

  expect(order).toEqual(ONE_CARD)
  expect(await ui.find({ type: 'Text', text: /Novo2/ })).toBeDefined()
  expect(await labelsOf(ui, /Alfa|Gama|Beta2/)).toEqual([])
})

test('BE5 an edit of prose only is left to the engine', async ($, on) => {
  const { order } = await rowsDrawn($, on, edit({ old: 'meio', next: 'metade' }))

  expect(order).toEqual(NO_CARD)
})

test('BE5 an edit of only the closer line or only the opener line draws that fence', async ($, on) => {
  const closer = await rowsDrawn($, on, edit({ old: 'Beta2\n```', next: 'Beta2\n````' }))
  const opener = await rowsDrawn($, on, edit({ old: '```mermaid\ngraph TD\n  Beta1', next: '```mermaid\n\ngraph TD\n  Beta1' }))

  expect(closer.order).toEqual(ONE_CARD)
  expect(opener.order).toEqual(ONE_CARD)
})

test('BE5 replaceAll over the first and third fences draws two cards in file order', async ($, on) => {
  const original = `${fence('graph TD\n  Zeta1 --> Zeta2')}\n\nmeio\n\n${fence(F2)}\n\n${fence('graph TD\n  Zeta1 --> Zeta3')}\n`
  const { ui, order } = await rowsDrawn($, on, edit({ old: 'Zeta1', next: 'Eta1', replaceAll: true, original }))
  const labels = await labelsOf(ui, /Zeta[23]|Beta/)

  expect(order).toEqual(TWO_CARDS)
  expect(labels.filter(label => label.includes('Zeta2'))).not.toEqual([])
  expect(labels.filter(label => label.includes('Zeta3'))).not.toEqual([])
  expect(labels.filter(label => label.includes('Beta'))).toEqual([])
})

test('BE5 an edit that removes a closer draws no card for the broken fence', async ($, on) => {
  const { order } = await rowsDrawn($, on, edit({ old: 'Gama2\n```\n', next: 'Gama2\n' }))

  expect(order).toEqual(NO_CARD)
})

test('BE5 a null originalFile draws the fence of newString', async ($, on) => {
  const { order } = await rowsDrawn($, on, edit({ old: '', next: fence(F1), original: null }))

  expect(order).toEqual(ONE_CARD)
})

test('BE5 a running or errored Edit is left to the engine', async ($, on) => {
  const running = await rowsDrawn($, on, edit({ old: 'Beta2', next: 'Novo2' }, { isRunning: true }))
  const errored = await rowsDrawn($, on, edit({ old: 'Beta2', next: 'Novo2' }, { isErrored: true }))

  expect([running.order, errored.order]).toEqual([NO_CARD, NO_CARD])
})

test('BE5 an Edit output of the wrong shape is left to the engine', async ($, on) => {
  const input = { file_path: '/repo/doc.md', old_string: 'Beta2', new_string: 'Novo2' }
  const wrong = [undefined, 'edited', { filePath: '/repo/doc.md' }, { filePath: '/repo/doc.md', oldString: 'a', newString: 'b', originalFile: 3 }]
  for (const output of wrong) {
    const { order } = await rowsDrawn($, on, toolProps('Edit', input, output))

    expect(order).toEqual(NO_CARD)
  }
})

test('BE6 an edit of one line of a .mmd file draws one card of the updated content', async ($, on) => {
  const { ui, order } = await rowsDrawn($, on, edit({ path: '/repo/fluxo.mmd', old: 'Cancelar', next: 'Estornar', original: FLOW }))

  expect(order).toEqual(ONE_CARD)
  expect(await ui.find({ type: 'Text', text: /Estornar/ })).toBeDefined()
})

test('BE6 an edit that empties a .mmd file is left to the engine', async ($, on) => {
  const { order } = await rowsDrawn($, on, edit({ path: '/repo/fluxo.mmd', old: FLOW, next: '', original: FLOW }))

  expect(order).toEqual(NO_CARD)
})

test('BE6 an edit of an upper case .MMD file draws one card', async ($, on) => {
  const { order } = await rowsDrawn($, on, edit({ path: '/repo/FLUXO.MMD', old: 'Cancelar', next: 'Estornar', original: FLOW }))

  expect(order).toEqual(ONE_CARD)
})

const TWO_FENCES = `${fence(F1)}\n\nmeio\n\n${fence(F2)}\n`
const touchedBy = (text: string, start: number, end: number) => diagramsTouched(text, [{ start, end }])

test('BE8 in a CRLF file an edit of only the closer line break of the first fence draws that fence', () => {
  const text = TWO_FENCES.replace(/\n/g, '\r\n')
  const closerEnd = text.indexOf('Alfa2') + 'Alfa2\r\n```'.length

  expect(touchedBy(text, closerEnd, closerEnd + 1)).toEqual([F1])
})

test('BE8 in a CRLF file an edit inside the second fence draws only the second fence', () => {
  const text = TWO_FENCES.replace(/\n/g, '\r\n')
  const at = text.indexOf('Beta2')

  expect(touchedBy(text, at, at + 5)).toEqual([F2])
})

test('BE8 in a CRLF file an edit of prose right after the first closer line draws no fence', () => {
  const text = TWO_FENCES.replace(/\n/g, '\r\n')
  const afterCloser = text.indexOf('Alfa2') + 'Alfa2\r\n```\r\n'.length

  expect(touchedBy(text, afterCloser, afterCloser + 4)).toEqual([])
})

test('BE8 in an LF file the closer line, the second fence and the prose between them behave as before', () => {
  const closerStart = TWO_FENCES.indexOf('Alfa2') + 'Alfa2\n'.length
  const afterCloser = closerStart + '```\n'.length
  const at = TWO_FENCES.indexOf('Beta2')

  expect(touchedBy(TWO_FENCES, closerStart, closerStart + 3)).toEqual([F1])
  expect(touchedBy(TWO_FENCES, at, at + 5)).toEqual([F2])
  expect(touchedBy(TWO_FENCES, afterCloser, afterCloser + 4)).toEqual([])
})

const editCall = (args: EditArgs, flags?: ToolFlags) => {
  const { tool, input, output, isRunning, isErrored, isInterrupted } = edit(args, flags)

  return { tool, input, output, isRunning, isErrored, isInterrupted }
}
const FENCE_EDIT: EditArgs = { old: 'Beta2', next: 'Novo2' }
const PROSE_EDIT: EditArgs = { old: 'meio', next: 'metade' }

test('BE9 a finished folded group holding an Edit inside a markdown fence is drawn expanded', async ($, on) => {
  expect(await groupExpanded($, on, [editCall(FENCE_EDIT)])).toBe(true)
})

test('BE9 a finished folded group holding an Edit of a .mmd file is drawn expanded', async ($, on) => {
  const call = editCall({ path: '/repo/fluxo.mmd', old: 'Cancelar', next: 'Estornar', original: FLOW })

  expect(await groupExpanded($, on, [call])).toBe(true)
})

test('BE9 an active group holding a diagram Edit is passed on unchanged', async ($, on) => {
  expect(await groupExpanded($, on, [editCall(FENCE_EDIT)], { isActive: true })).toBe(false)
})

test('BE9 an already expanded group holding a diagram Edit is passed on unchanged', async ($, on) => {
  expect(await groupExpanded($, on, [editCall(FENCE_EDIT)], { isExpanded: true })).toBe(true)
})

test('BE9 a group whose Edit touched only prose is passed on unchanged', async ($, on) => {
  expect(await groupExpanded($, on, [editCall(PROSE_EDIT)])).toBe(false)
})

for (const flag of ['isRunning', 'isErrored', 'isInterrupted'] as const) {
  test(`BE9 a group whose diagram Edit call has ${flag} is passed on unchanged`, async ($, on) => {
    expect(await groupExpanded($, on, [editCall(FENCE_EDIT, { [flag]: true })])).toBe(false)
  })
}

const WRONG_SHAPES: [string, unknown][] = [
  ['undefined', undefined],
  ['a string', 'edited'],
  ['only a filePath', { filePath: '/repo/doc.md' }],
  ['a numeric originalFile', { filePath: '/repo/doc.md', oldString: 'a', newString: 'b', originalFile: 3 }],
]

for (const [name, output] of WRONG_SHAPES) {
  test(`BE9 a group whose Edit output is ${name} is passed on unchanged`, async ($, on) => {
    expect(await groupExpanded($, on, [{ ...editCall(FENCE_EDIT), output }])).toBe(false)
  })
}

test('BE8 in a CRLF file whose closer is the last line without a trailing newline an edit of its last backtick draws the fence', () => {
  const text = fence(F1).replace(/\n/g, '\r\n')

  expect(touchedBy(text, text.length - 1, text.length)).toEqual([F1])
})

const svgOf = (width: number, height: number) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}"><rect width="${width}" height="${height}"/></svg>`

function answerSvg(on: On, svg: string) {
  on('env.get', () => ({ value: '/var/tmp-test/' }))
  on('fs.write', () => ({ value: undefined }))
  on('fs.read', () => ({ value: { base64: PNG_BASE64 } }))
  on('process.run', (_, { argv }) => ran(0, argv[0] === 'node' ? svg : ''))
}

async function imageBox($: Mount, on: On, svg: string, source: string, viewport: { columns: number; rows: number }) {
  answerSvg(on, svg)
  const ui = await $.ui.mount({
    plugin: 'mermaid-render',
    surface: 'terminal',
    component: 'AssistantMessage',
    props: { text: fence(source), isFirstOfReply: true },
    viewport: viewport as typeof VIEWPORT,
  })
  const image = await ui.find({ type: 'Image' })

  return { columns: image?.props.columns, rows: image?.props.rows }
}

const IMAGE = { options: { terminalRender: 'image' } }

test('image mode fills the card width of a wide picture that fits the terminal height', IMAGE, async ($, on) => {
  expect(await imageBox($, on, svgOf(300, 120), 'graph TD\n  W1-->W2', { columns: 120, rows: 40 })).toEqual({ columns: 114, rows: 23 })
})

test('image mode keeps the picture whose rows equal the terminal height cap', IMAGE, async ($, on) => {
  expect(await imageBox($, on, svgOf(300, 120), 'graph TD\n  W3-->W4', { columns: 120, rows: 35 })).toEqual({ columns: 114, rows: 23 })
})

test('image mode shrinks the picture one row over the terminal height cap', IMAGE, async ($, on) => {
  expect(await imageBox($, on, svgOf(300, 120), 'graph TD\n  W5-->W6', { columns: 120, rows: 34 })).toEqual({ columns: 110, rows: 22 })
})

test('image mode bounds a tall picture by the terminal height', IMAGE, async ($, on) => {
  expect(await imageBox($, on, svgOf(100, 400), 'graph TD\n  W7-->W8', { columns: 120, rows: 40 })).toEqual({ columns: 14, rows: 28 })
})

test('image mode keeps at least 3 rows however short the terminal', IMAGE, async ($, on) => {
  expect(await imageBox($, on, svgOf(300, 120), 'graph TD\n  W15-->W16', { columns: 120, rows: 14 })).toEqual({ columns: 15, rows: 3 })
})

test('image mode never exceeds 255 columns', IMAGE, async ($, on) => {
  expect(await imageBox($, on, svgOf(300, 120), 'graph TD\n  W9-->W10', { columns: 300, rows: 200 })).toEqual({ columns: 255, rows: 51 })
})

test('image mode falls back to a 40-row terminal height when the surface gives no viewport', IMAGE, async ($, on) => {
  answerSvg(on, svgOf(100, 400))
  const ui = await $.ui.mount({
    plugin: 'mermaid-render',
    surface: 'terminal',
    component: 'AssistantMessage',
    props: { text: fence('graph TD\n  W11-->W12'), isFirstOfReply: true },
  })
  const image = await ui.find({ type: 'Image' })

  expect({ columns: image?.props.columns, rows: image?.props.rows }).toEqual({ columns: 14, rows: 28 })
})

test('image mode sizes the picture under a tool row by the same fit', IMAGE, async ($, on) => {
  answerSvg(on, svgOf(300, 120))
  const path = '/repo/docs/tamanho.mmd'
  const ui = await $.ui.mount({
    plugin: 'mermaid-render',
    surface: 'terminal',
    component: 'ToolUse',
    props: toolProps('Read', { file_path: path }, { type: 'text', file: { filePath: path, content: 'graph TD\n  W13-->W14', numLines: 2, startLine: 1, totalLines: 2 } }),
    viewport: VIEWPORT,
  })
  const image = await ui.find({ type: 'Image' })

  expect({ columns: image?.props.columns, rows: image?.props.rows }).toEqual({ columns: 109, rows: 22 })
})

const PT_IMAGE = { options: { terminalRender: 'image', language: 'pt-BR' } }
const FR_IMAGE = { options: { terminalRender: 'image', language: 'fr' } }
const WRONG_CASE = { options: { language: 'pt-br' } }

const mountText = ($: Mount, text: string, columns = 120) =>
  $.ui.mount({ plugin: 'mermaid-render', surface: 'terminal', component: 'AssistantMessage', props: { text, isFirstOfReply: true }, viewport: { columns, rows: 40 } })

const mountRead = ($: Mount, path: string, content: string) =>
  $.ui.mount({
    plugin: 'mermaid-render',
    surface: 'terminal',
    component: 'ToolUse',
    props: toolProps('Read', { file_path: path }, { type: 'text', file: { filePath: path, content, numLines: 2, startLine: 1, totalLines: 2 } }),
    viewport: VIEWPORT,
  })

test('without a language option a flowchart card is titled in English', async $ => {
  const ui = await mountText($, REPLY)

  expect(await ui.find({ type: 'Text', text: 'Flowchart' })).toBeDefined()
  expect(await ui.findAll({ type: 'Text', text: 'Fluxograma' })).toHaveLength(0)
})

test('without a language option a Read of a sequence file shows the English title and count line', async $ => {
  const content = 'sequenceDiagram\n  A->>B: oi\n  B->>A: olá'
  const ui = await mountRead($, '/repo/docs/seq.mmd', content)

  expect(await ui.find({ type: 'Text', text: 'Sequence' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '  ⎿  3 lines · 1 Mermaid diagram' })).toBeDefined()
})

test('without a language option a diagram that does not parse says it could not be drawn', async $ => {
  const ui = await mountText($, '```mermaid\npie\n  "a": 1\n```')

  expect(await ui.find({ type: 'Text', text: /Could not draw:/ })).toBeDefined()
  expect(await ui.find({ type: 'Code', text: /pie/ })).toBeDefined()
})

test('without a language option a flowchart too wide for the terminal says it was laid out vertically', async $ => {
  const ui = await mountText($, REPLY, 40)

  expect(await ui.find({ type: 'Text', text: /laid out vertically/ })).toBeDefined()
})

test('without a language option the image alt is English', { options: { terminalRender: 'image' } }, async ($, on) => {
  answerSvg(on, svgOf(300, 120))
  const ui = await mountText($, fence('graph TD\n  L1-->L2'))

  expect((await ui.find({ type: 'Image' }))?.props.alt).toBe('graph diagram')
})

test('with pt-BR the image alt is Portuguese', PT_IMAGE, async ($, on) => {
  answerSvg(on, svgOf(300, 120))
  const ui = await mountText($, fence('graph TD\n  L3-->L4'))

  expect((await ui.find({ type: 'Image' }))?.props.alt).toBe('diagrama graph')
})

test('an unsupported language value gives English', FR_IMAGE, async ($, on) => {
  answerSvg(on, svgOf(300, 120))
  const ui = await mountText($, fence('graph TD\n  L5-->L6'))

  expect((await ui.find({ type: 'Image' }))?.props.alt).toBe('graph diagram')
})

test('a pt-BR value in the wrong case gives English', WRONG_CASE, async $ => {
  const ui = await mountText($, REPLY)

  expect(await ui.find({ type: 'Text', text: 'Flowchart' })).toBeDefined()
})

test('a one-line file with one diagram uses the singular count line in English', async $ => {
  const ui = await mountRead($, '/repo/docs/one.mmd', 'graph TD')

  expect(await ui.find({ type: 'Text', text: '  ⎿  1 line · 1 Mermaid diagram' })).toBeDefined()
})

test('a one-line file with one diagram uses the singular count line in Portuguese', PT, async $ => {
  const ui = await mountRead($, '/repo/docs/one.mmd', 'graph TD')

  expect(await ui.find({ type: 'Text', text: '  ⎿  1 linha · 1 diagrama Mermaid' })).toBeDefined()
})

test('a markdown file with two fences uses the plural count line in English', async $ => {
  const ui = await mountRead($, '/repo/doc.md', TWO_FENCES)

  expect(await ui.find({ type: 'Text', text: /· 2 Mermaid diagrams$/ })).toBeDefined()
})

test('a markdown file with two fences uses the plural count line in Portuguese', PT, async $ => {
  const ui = await mountRead($, '/repo/doc.md', TWO_FENCES)

  expect(await ui.find({ type: 'Text', text: /· 2 diagramas Mermaid$/ })).toBeDefined()
})

test('messagesFor selects Portuguese for exactly pt-BR', () => {
  expect(messagesFor('pt-BR').kinds.flowchart).toBe('Fluxograma')
})

const NOT_PORTUGUESE: [string, unknown][] = [
  ['en', 'en'],
  ['undefined', undefined],
  ['an empty string', ''],
  ['fr', 'fr'],
  ['lowercase pt-br', 'pt-br'],
  ['uppercase PT-BR', 'PT-BR'],
  ['a non-string', 1],
]

for (const [name, language] of NOT_PORTUGUESE) {
  test(`messagesFor gives English for ${name}`, () => {
    expect(messagesFor(language).kinds.flowchart).toBe('Flowchart')
  })
}

function art(source: string): string[] {
  const drawn = renderUnicode(source, 200)
  if (!drawn.isRendered) throw new Error(drawn.reason)

  return drawn.lines.map(line => line.map(run => run.text).join(''))
}

const rowOf = (lines: string[], text: string): number => lines.findIndex(line => line.includes(text))
const BORDER = /[─┌┐└┘◇┬┴]/

test('a downward edge label in a flowchart sits between the diamond border and the arrow, leaving the junction', () => {
  const lines = art(
    [
      'flowchart TD',
      '  A[View Cart] --> B[Enter Shipping Details]',
      '  B --> C[Choose Payment Method]',
      '  C --> D{Payment Approved?}',
      '  D -->|Yes| E[Order Confirmation]',
      '  D -->|No| F[Show Payment Error]',
      '  F --> C',
    ].join('\n'),
  )
  const bottom = lines.findLastIndex(line => /^◇─.*◇/.test(line))
  const yes = rowOf(lines, 'Yes')

  expect(lines[bottom]).not.toContain('Yes')
  expect(lines[bottom]).toContain('┬')
  expect(yes).toBeGreaterThan(bottom)
  expect(yes).toBeLessThan(lines.findIndex((line, index) => index > bottom && line.includes('▼')))
})

test('a downward edge label sits just below the border junction and above its arrowhead', () => {
  const lines = art('flowchart TD\n  A[Start] -->|go| B[End]')
  const go = rowOf(lines, 'go')

  expect(lines[go - 1]).toMatch(/^└.*┬.*┘$/)
  expect(lines[go + 1]).toContain('▼')
  expect(lines[go]?.replace('go', '')).not.toMatch(BORDER)
})

test('an upward edge label in a bottom-to-top flowchart stays off the borders of its ends', () => {
  const lines = art('flowchart BT\n  A -->|x| B')
  const x = rowOf(lines, 'x')

  expect(lines[x]).not.toMatch(BORDER)
  expect(lines[x - 1]).toContain('▲')
  expect(lines[x + 1]).toMatch(/^┌/)
})

test('an upward edge label in a top-down flowchart is on neither end row of its segment', () => {
  const lines = art('flowchart TD\n  A[Start] --> B[Middle]\n  B --> C[End]\n  B -->|back| A')
  const back = rowOf(lines, 'back')

  expect(lines[back]?.replace('back', '')).not.toMatch(BORDER)
  expect(lines[back - 1]).toContain('▲')
  expect(lines[back + 1]).toContain('┴')
})

test('an upward edge label taller than one row stays off the border of the node it enters', () => {
  const lines = art('flowchart TD\n  A --> B\n  B -->|a b<br/>c d| A')
  const top = lines.findIndex(line => line.includes('┴'))
  const first = rowOf(lines, 'a▲b')
  const second = rowOf(lines, 'c▼d')
  const aBottom = lines.findIndex(line => line.includes('┬'))

  expect(lines[top]).not.toMatch(/[a-d]/)
  expect(first).toBeGreaterThan(aBottom)
  expect(second).toBeGreaterThan(first)
  expect(second).toBeLessThan(top)
})

test('a label taller than the rows between two nodes starts under the node it leaves', () => {
  const lines = art('flowchart TD\n  A[Start] -->|line one<br/>line two<br/>three| B[End]')
  const start = rowOf(lines, 'Start')
  const bottom = start + 1

  expect(lines[start]).toMatch(/│\s*Start\s*│/)
  expect(lines[bottom]).toContain('┬')
  expect(lines[bottom]).not.toMatch(/[a-z]/)
  expect(lines[bottom + 1]).toMatch(/line.one/)
})

test('a horizontal edge label is drawn on the line between its two boxes', () => {
  expect(art('flowchart LR\n  A[One] -->|go| B[Two]')).toEqual(['┌───┐    ┌───┐', '│One├go─►│Two│', '└───┘    └───┘'])
})
