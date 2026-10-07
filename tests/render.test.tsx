import { expect, test } from 'claude-code/testing'

import { splitMermaid } from '../hooks/fences'

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
