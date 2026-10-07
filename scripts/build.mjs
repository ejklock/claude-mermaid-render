import { build } from 'esbuild'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'

const root = fileURLToPath(new URL('..', import.meta.url))
// The plugin lives at the repository root; a path argument builds into another copy.
const mod = process.argv[2] ?? root

// In-process engine: an imported file must stay under 1 MiB, so ELK is stubbed.
await build({
  entryPoints: [join(root, 'src', 'vendor.ts')],
  outfile: join(mod, 'hooks', 'vendor', 'mermaid.js'),
  bundle: true,
  minify: true,
  format: 'esm',
  platform: 'neutral',
  target: 'es2022',
  legalComments: 'none',
  alias: { 'elkjs/lib/elk.bundled.js': join(root, 'src', 'elk-stub.ts') },
})

// SVG renderer the mod runs with node: not imported, so no size limit.
await build({
  entryPoints: [join(root, 'src', 'svg-cli.ts')],
  outfile: join(mod, 'renderer', 'svg.mjs'),
  bundle: true,
  minify: true,
  format: 'esm',
  platform: 'node',
  target: 'node20',
  legalComments: 'none',
})
