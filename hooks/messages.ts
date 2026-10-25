type Plural = { one: string; other: string }

export type Messages = {
  kinds: Record<string, string>
  lines: Plural
  diagrams: Plural
  couldNotDraw: (reason: string) => string
  turned: string
  tooWide: (columns: number) => string
  alt: (kind: string) => string
  plural: Intl.PluralRules
}

const en: Messages = {
  kinds: {
    flowchart: 'Flowchart',
    graph: 'Flowchart',
    sequenceDiagram: 'Sequence',
    stateDiagram: 'State',
    'stateDiagram-v2': 'State',
    classDiagram: 'Class',
    erDiagram: 'Entity relationship',
  },
  lines: { one: 'line', other: 'lines' },
  diagrams: { one: 'Mermaid diagram', other: 'Mermaid diagrams' },
  couldNotDraw: reason => `Could not draw: ${reason}`,
  turned: '↕ laid out vertically to fit the terminal width',
  tooWide: columns => `↔ the diagram is ${columns} columns wide; widen the terminal to see all of it`,
  alt: kind => `${kind} diagram`,
  plural: new Intl.PluralRules('en'),
}

const ptBR: Messages = {
  kinds: {
    flowchart: 'Fluxograma',
    graph: 'Fluxograma',
    sequenceDiagram: 'Sequência',
    stateDiagram: 'Estados',
    'stateDiagram-v2': 'Estados',
    classDiagram: 'Classes',
    erDiagram: 'Entidade-relacionamento',
  },
  lines: { one: 'linha', other: 'linhas' },
  diagrams: { one: 'diagrama Mermaid', other: 'diagramas Mermaid' },
  couldNotDraw: reason => `Não foi possível desenhar: ${reason}`,
  turned: '↕ disposto na vertical para caber na largura do terminal',
  tooWide: columns => `↔ o diagrama tem ${columns} colunas; alargue o terminal para vê-lo inteiro`,
  alt: kind => `diagrama ${kind}`,
  plural: new Intl.PluralRules('pt-BR'),
}

/** Only the exact value `pt-BR` selects Portuguese; anything else, or nothing, is English. */
export function messagesFor(language: unknown): Messages {
  return language === 'pt-BR' ? ptBR : en
}

/** The count line of a tool row, with each language's plural form. */
export function countLine(messages: Messages, lines: number, diagrams: number): string {
  const word = (count: number, forms: Plural) => forms[messages.plural.select(count) === 'one' ? 'one' : 'other']

  return `  ⎿  ${lines} ${word(lines, messages.lines)} · ${diagrams} ${word(diagrams, messages.diagrams)}`
}
