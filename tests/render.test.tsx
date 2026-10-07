import { expect, test } from 'claude-code/testing'

import { diagramsInFile, splitMermaid } from '../hooks/fences'

const FLOW = ['flowchart LR', '  A[Pedido] --> B{Pago?}', '  B -->|sim| C[Enviar]', '  B -->|não| D[Cancelar]'].join('\n')
const REPLY = `Aqui está o fluxo:\n\n\`\`\`mermaid\n${FLOW}\n\`\`\`\n\nDepois disso o pedido fecha.`
const VIEWPORT = { columns: 120, rows: 40 }

test('splits prose from closed mermaid fences only', () => {
  expect(splitMermaid(REPLY).map(segment => segment.kind)).toEqual(['markdown', 'mermaid', 'markdown'])
  expect(splitMermaid('texto\n```mermaid\ngraph TD\n  A-->B').map(segment => segment.kind)).toEqual(['markdown'])
  expect(splitMermaid('````markdown\n```mermaid\ngraph TD\n```\n````').map(segment => segment.kind)).toEqual(['markdown'])
})

test('a reply with a diagram draws prose and a titled card on the terminal', async $ => {
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

test('a horizontal flowchart too wide for the terminal is laid out vertically', async $ => {
  const ui = await $.ui.mount({
    plugin: 'mermaid-render',
    surface: 'terminal',
    component: 'AssistantMessage',
    props: { text: REPLY, isFirstOfReply: false },
    viewport: { columns: 40, rows: 40 },
  })

  expect(await ui.find({ type: 'Text', text: /disposto na vertical/ })).toBeDefined()
})

test('a diagram that does not parse shows the reason and its source', async $ => {
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

test('a Read of a .mmd file draws its diagram under the tool row', async $ => {
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

test('C2 a tilde fence in a reply draws a card', async $ => {
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

test('C2 a finished Write of a markdown file draws its one card', async $ => {
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

/** Answers node with an SVG, rsvg-convert with `rsvgExit`, the rest with success; returns every argv seen. */
function answerRuns(on: Parameters<Parameters<typeof test>[1]>[1], rsvgExit: number) {
  const runs: string[][] = []
  on('env.get', () => ({ value: '/var/tmp-test/' }))
  on('fs.write', () => ({ value: undefined }))
  on('process.run', (_, { argv }) => {
    runs.push([...argv])
    if (argv[1] === 'node') return ran(0, SVG)

    return ran(argv[1] === 'rsvg-convert' ? rsvgExit : 0)
  })

  return runs
}

const removed = (runs: string[][]) => runs.filter(argv => argv[0] === 'rm').flatMap(argv => argv.slice(1))
const mountReply = ($: Parameters<Parameters<typeof test>[1]>[0], source: string) =>
  $.ui.mount({ plugin: 'mermaid-render', surface: 'terminal', component: 'AssistantMessage', props: { text: fence(source), isFirstOfReply: true }, viewport: VIEWPORT })

test('C2 the image mode card holds a PNG under the answered TMPDIR', { options: { terminalRender: 'image' } }, async ($, on) => {
  answerRuns(on, 0)
  const ui = await mountReply($, 'graph TD\n  P1-->P2')
  const image = await ui.find({ type: 'Image' })

  expect((image?.props.source as { file: string; format: string }).file).toMatch(/^\/var\/tmp-test\/mermaid-render\/[0-9a-f]+\.png$/)
})

test('C4 a successful rasterize removes the intermediate svg', { options: { terminalRender: 'image' } }, async ($, on) => {
  const runs = answerRuns(on, 0)
  const ui = await mountReply($, 'graph TD\n  S1-->S2')
  await ui.find({ type: 'Image' })

  expect(removed(runs).filter(path => path.endsWith('.svg'))).toHaveLength(1)
  expect(removed(runs).filter(path => path.endsWith('.png'))).toEqual([])
})

test('C4 a failed rasterize removes the svg and png and falls back to Unicode art', { options: { terminalRender: 'image' } }, async ($, on) => {
  const runs = answerRuns(on, 1)
  const ui = await mountReply($, 'graph TD\n  F1-->F2')

  expect(await ui.find({ type: 'Text', text: /F1/ })).toBeDefined()
  expect(await ui.findAll({ type: 'Image' })).toHaveLength(0)
  expect(removed(runs).filter(path => path.endsWith('.svg'))).toHaveLength(1)
  expect(removed(runs).filter(path => path.endsWith('.png'))).toHaveLength(1)
})

test('C4 an evicted cache entry has its png removed', { options: { terminalRender: 'image' } }, async ($, on) => {
  const runs = answerRuns(on, 0)
  const first = await (await mountReply($, 'graph TD\n  E0-->Z')).find({ type: 'Image' })
  const firstPng = (first?.props.source as { file: string }).file
  for (let index = 1; index <= 201; index += 1) await mountReply($, `graph TD\n  E${index}-->Z`)

  expect(removed(runs)).toContain(firstPng)
})
