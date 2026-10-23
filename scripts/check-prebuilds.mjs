#!/usr/bin/env node
// Recusa publicar um pacote que já nasce quebrado em alguma plataforma.
//
// Por que isto existe: a 1.0.0 foi publicada de um Mac e levou SÓ o
// `darwin-arm64`. Todo servidor Linux instalou "com sucesso" e derrubou a
// primeira ligação com `no prebuilt native library for linux-x64` — e, como o
// `prepare`/`postinstall` não existia ainda, não havia nem rede de proteção.
// Publicar é o último momento em que isso é barato de consertar.
//
// Rode em qualquer máquina: compile o que falta (`npm run build:native` em cada
// plataforma) ou traga o arquivo pronto antes de publicar.

import { existsSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const pkgDir = dirname(dirname(fileURLToPath(import.meta.url)))

/** As plataformas em que este pacote roda de verdade: Mac de quem desenvolve, Linux de quem atende. */
const EXIGIDAS = [
  ['darwin-arm64', 'dylib'],
  ['linux-x64', 'so'],
]

/** Menor que isto não é biblioteca, é um `cp` que deu errado. */
const MINIMO_BYTES = 100_000

const faltando = []
for (const [triple, ext] of EXIGIDAS) {
  const caminho = join(pkgDir, 'prebuilds', triple, `libopus_mlow.${ext}`)
  if (!existsSync(caminho)) {
    faltando.push(`${triple}: não existe (${caminho})`)
    continue
  }
  const bytes = statSync(caminho).size
  if (bytes < MINIMO_BYTES) faltando.push(`${triple}: só ${bytes} bytes — truncado?`)
}

if (faltando.length) {
  console.error(
    [
      '',
      '  ┌─ opus-mlow: publicação barrada ─────────────────────────────────────',
      ...faltando.map((f) => `  │ ${f}`),
      '  │',
      '  │ Um pacote sem o prebuild de uma plataforma instala sem erro e derruba',
      '  │ a primeira ligação feita nela. Compile antes de publicar:',
      '  │   npm run build:native        (em cada plataforma que falta)',
      '  └─────────────────────────────────────────────────────────────────────',
      '',
    ].join('\n'),
  )
  process.exit(1)
}

console.log(`opus-mlow: prebuilds completos (${EXIGIDAS.map(([t]) => t).join(', ')}).`)
