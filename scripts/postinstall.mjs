#!/usr/bin/env node
// Build the native library at install time, when and only when it is missing.
//
// Why this exists: the loader looks for prebuilds/<platform>-<arch>/libopus_mlow.<ext>,
// and the published package only carries the platforms whoever ran `npm publish`
// happened to have. On every other machine the package installed fine and then threw
// at the first call — the worst possible moment to find out, because the only symptom
// is a dropped call in production.
//
// Skipped (printing why) when:
//   - OPUS_MLOW_SKIP_BUILD is set — images that mount the .so themselves;
//   - OPUS_MLOW_LIB points at an existing file — the loader prefers it anyway;
//   - a prebuild for this platform is already there.
//
// A failed build does NOT fail `npm install` by default: plenty of installs never
// touch the codec, and breaking those is worse than a loud warning. Set
// OPUS_MLOW_REQUIRE_BUILD=1 — on a server that answers calls, do set it — to turn
// the failure into a non-zero exit instead.

import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const pkgDir = dirname(dirname(fileURLToPath(import.meta.url)))
const strict = process.env.OPUS_MLOW_REQUIRE_BUILD === '1'

const ext = process.platform === 'darwin' ? 'dylib' : process.platform === 'win32' ? 'dll' : 'so'
const triple = `${process.platform}-${process.arch}`
const prebuild = join(pkgDir, 'prebuilds', triple, `libopus_mlow.${ext}`)

const say = (msg) => console.log(`opus-mlow: ${msg}`)

/** A failure that leaves the package unusable on this machine. */
function fail(title, detail) {
  const box = [
    '',
    '  ┌─ opus-mlow ─────────────────────────────────────────────────────────',
    `  │ ${title}`,
    `  │ ${detail}`,
    '  │',
    '  │ Without it, WhatsApp calls are answered and then drop with no audio.',
    '  │',
    '  │ Build it here:',
    '  │   Linux: apt install -y build-essential cmake git',
    '  │   macOS: xcode-select --install && brew install cmake git',
    '  │   cd node_modules/@raphaelvserafim/opus-mlow && npm run build:native',
    '  │',
    '  │ Or point at one you already have, which also survives reinstalls:',
    '  │   OPUS_MLOW_LIB=/opt/lib/libopus_mlow.' + ext,
    '  └─────────────────────────────────────────────────────────────────────',
    '',
  ].join('\n')

  console.error(box)
  process.exit(strict ? 1 : 0)
}

/*
 * `koffi` faltando NÃO é biblioteca quebrada.
 *
 * Só quer dizer que a checagem rodou antes de a dependência estar no lugar —
 * acontece em layouts de install esquisitos e rodando o pacote direto de um
 * checkout. Reprovar aí puniria uma lib perfeitamente boa; o loader acha o
 * koffi na hora da chamada.
 */
const semKoffi = (error) =>
  error?.code === 'ERR_MODULE_NOT_FOUND' && String(error.message).includes('koffi')

/**
 * A biblioteca CARREGA, e não apenas existe.
 *
 * `existsSync` não responde isso, e a diferença é uma ligação derrubada: um
 * `.so` compilado contra uma glibc mais nova que a da máquina está lá, parece
 * certo, e explode no `koffi.load` — no meio de uma chamada, que é o pior
 * momento possível para descobrir. Quem pergunta antes de pular a compilação
 * transforma isso em um build a mais no install.
 */
async function carrega() {
  try {
    const { MLowCodec } = await import(pathToFileURL(join(pkgDir, 'index.js')).href)
    new MLowCodec().close()
    return { ok: true }
  } catch (error) {
    if (semKoffi(error)) return { ok: true, semVerificar: true }
    return { ok: false, motivo: String(error?.message ?? error) }
  }
}

if (process.env.OPUS_MLOW_SKIP_BUILD) {
  say('OPUS_MLOW_SKIP_BUILD is set — not building.')
  process.exit(0)
}

if (process.env.OPUS_MLOW_LIB && existsSync(process.env.OPUS_MLOW_LIB)) {
  say(`using ${process.env.OPUS_MLOW_LIB} — not building.`)
  process.exit(0)
}

if (existsSync(prebuild)) {
  const estado = await carrega()
  if (estado.ok) {
    const nota = estado.semVerificar ? ' (not loaded here — koffi is not installed yet)' : ''
    say(`prebuilt library for ${triple} is already here${nota} — not building.`)
    process.exit(0)
  }
  // Está lá e não serve: quase sempre glibc da máquina mais velha que a de quem
  // publicou. Compilar por cima é a saída, e o `cp` do build sobrescreve.
  say(`the shipped library for ${triple} does not load here (${estado.motivo}) — rebuilding it.`)
} else {
  say(`no prebuilt library for ${triple} — building it now (this takes a minute).`)
}

if (process.platform === 'win32') {
  fail(
    `No prebuilt library for ${triple}, and the build script is Linux/macOS only.`,
    'Build libopus_mlow.dll from the opus_mlow fork and set OPUS_MLOW_LIB to it.',
  )
}

const build = spawnSync('bash', [join(pkgDir, 'scripts', 'build-native.sh')], {
  cwd: pkgDir,
  stdio: 'inherit',
  env: process.env,
})

if (build.error || build.status !== 0) {
  fail(
    `The build failed on ${triple}${build.status ? ` (exit ${build.status})` : ''}.`,
    'It needs a C toolchain, cmake and git to compile the opus_mlow fork.',
  )
}

// Built is not the same as usable: a library that loads halfway is still a dropped
// call. Loading it here costs a second and turns that into an install-time failure.
if (!existsSync(prebuild)) {
  fail('The build finished but left no library behind.', `Expected ${prebuild}.`)
}

const depois = await carrega()
if (!depois.ok) fail('The library was built but does not load.', depois.motivo)
if (depois.semVerificar) {
  say(`built: prebuilds/${triple}/libopus_mlow.${ext} (not loaded here — koffi is not installed yet).`)
} else {
  say(`built and loaded: prebuilds/${triple}/libopus_mlow.${ext}`)
}
