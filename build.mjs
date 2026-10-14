import { copyFile, mkdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { build } from 'esbuild'

const root = path.dirname(fileURLToPath(import.meta.url))
const pkg = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'))

await build({
  entryPoints: [path.join(root, 'src/extension.ts')],
  outfile: path.join(root, 'dist/extension.js'),
  bundle: true,
  platform: 'node',
  // VS Code loads extensions as CommonJS.
  format: 'cjs',
  target: 'node20',
  sourcemap: true,
  external: ['vscode'],
  alias: { '@modelflare/core': path.join(root, './shared/core-ts/src/index.ts') },
  define: { __MODELFLARE_PLUGIN_VERSION__: JSON.stringify(pkg.version) },
  logLevel: 'info',
})

await mkdir(path.join(root, 'assets'), { recursive: true })
await copyFile(path.join(root, './shared/brand/icon-512.png'), path.join(root, 'assets/icon.png'))
