// @raphaelvserafim/opus-mlow
// FFI binding for the MLow (SMPL) Opus codec used by WhatsApp VoIP.
// Mirrors WaCalls' internal/voip/media/mlow_codec_real.go.
//
// MLow profile: 16 kHz, mono, 960-sample (60 ms) frames, ~6 kbps, VOIP application,
// SMPL mode enabled via OPUS_SET_USING_SMPL (CTL 4050).

import koffi from 'koffi'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { existsSync } from 'node:fs'

const __dirname = dirname(fileURLToPath(import.meta.url))

// ─── MLow / Opus constants (match mlow_codec_real.go) ───
export const MLOW_SAMPLE_RATE = 16000
export const MLOW_CHANNELS = 1
export const MLOW_FRAME_SIZE = 960 // samples per 60 ms frame @ 16 kHz
const OPUS_APPLICATION_VOIP = 2048
const MLOW_MAX_OUT = 5760 // max decoded samples

// CTL request codes (opus_defines.h)
const OPUS_SET_BITRATE = 4002
const OPUS_SET_COMPLEXITY = 4010
const OPUS_SET_INBAND_FEC = 4012
const OPUS_SET_DTX = 4016
const OPUS_SET_SIGNAL = 4024
const OPUS_SET_USING_SMPL = 4050
const OPUS_SIGNAL_VOICE = 3001

const DEFAULT_BITRATE = 6000
const DEFAULT_COMPLEXITY = 5

// ─── Locate and load the native library ───
function resolveLibPath() {
  if (process.env.OPUS_MLOW_LIB && existsSync(process.env.OPUS_MLOW_LIB)) {
    return process.env.OPUS_MLOW_LIB
  }
  const ext = process.platform === 'darwin' ? 'dylib' : process.platform === 'win32' ? 'dll' : 'so'
  const triple = `${process.platform}-${process.arch}`
  const candidate = join(__dirname, 'prebuilds', triple, `libopus_mlow.${ext}`)
  if (existsSync(candidate)) return candidate
  throw new Error(
    `opus-mlow: no prebuilt native library for ${triple}. ` +
      `Build one with \`npm run build:native\` or set OPUS_MLOW_LIB to a libopus_mlow.${ext}.`,
  )
}

const lib = koffi.load(resolveLibPath())

// Opaque encoder/decoder handles
const Encoder = koffi.pointer('OpusEncoder', koffi.opaque())
const Decoder = koffi.pointer('OpusDecoder', koffi.opaque())

const opus_global_create = lib.func('void opus_global_create(void)')
const opus_encoder_create = lib.func('OpusEncoder* opus_encoder_create(int32_t fs, int channels, int application, _Out_ int* error)')
const opus_decoder_create = lib.func('OpusDecoder* opus_decoder_create(int32_t fs, int channels, _Out_ int* error)')
const opus_encoder_destroy = lib.func('void opus_encoder_destroy(OpusEncoder* enc)')
const opus_decoder_destroy = lib.func('void opus_decoder_destroy(OpusDecoder* dec)')
// Variadic CTLs — must be declared variadic so arm64 (macOS) uses the correct ABI.
const opus_encoder_ctl = lib.func('int opus_encoder_ctl(OpusEncoder* enc, int request, ...)')
const opus_decoder_ctl = lib.func('int opus_decoder_ctl(OpusDecoder* dec, int request, ...)')
const opus_encode = lib.func('int opus_encode(OpusEncoder* enc, int16_t* pcm, int frame_size, _Out_ uint8_t* data, int32_t max_data_bytes)')
const opus_decode = lib.func('int opus_decode(OpusDecoder* dec, uint8_t* data, int32_t len, _Out_ int16_t* pcm, int frame_size, int decode_fec)')

let globalInit = false
function ensureGlobal() {
  if (!globalInit) {
    opus_global_create()
    globalInit = true
  }
}

/**
 * MLow codec instance — one per call direction is fine, but encode and decode
 * are independent so a single instance can do both.
 */
export class MLowCodec {
  constructor(opts = {}) {
    ensureGlobal()
    const bitrate = opts.bitrate ?? DEFAULT_BITRATE
    const complexity = opts.complexity ?? DEFAULT_COMPLEXITY
    const fec = opts.fec ? 1 : 0

    const decErr = [0]
    this._dec = opus_decoder_create(MLOW_SAMPLE_RATE, MLOW_CHANNELS, decErr)
    if (!this._dec || decErr[0] !== 0) throw new Error(`opus_decoder_create failed (${decErr[0]})`)
    opus_decoder_ctl(this._dec, OPUS_SET_USING_SMPL, 'int', 1)

    const encErr = [0]
    this._enc = opus_encoder_create(MLOW_SAMPLE_RATE, MLOW_CHANNELS, OPUS_APPLICATION_VOIP, encErr)
    if (!this._enc || encErr[0] !== 0) {
      opus_decoder_destroy(this._dec)
      throw new Error(`opus_encoder_create failed (${encErr[0]})`)
    }
    opus_encoder_ctl(this._enc, OPUS_SET_USING_SMPL, 'int', 1)
    opus_encoder_ctl(this._enc, OPUS_SET_BITRATE, 'int', bitrate)
    opus_encoder_ctl(this._enc, OPUS_SET_COMPLEXITY, 'int', complexity)
    opus_encoder_ctl(this._enc, OPUS_SET_SIGNAL, 'int', OPUS_SIGNAL_VOICE)
    opus_encoder_ctl(this._enc, OPUS_SET_INBAND_FEC, 'int', fec)
    opus_encoder_ctl(this._enc, OPUS_SET_DTX, 'int', 1)
    this._encBuf = Buffer.alloc(4000)
    this._decBuf = new Int16Array(MLOW_MAX_OUT)
  }

  /**
   * Encode one frame of 16-bit mono PCM (length should be MLOW_FRAME_SIZE = 960).
   * @param {Int16Array} pcm
   * @returns {Buffer} encoded MLow payload
   */
  encode(pcm) {
    if (!this._enc) throw new Error('codec closed')
    const n = opus_encode(this._enc, pcm, pcm.length, this._encBuf, this._encBuf.length)
    if (n < 0) throw new Error(`opus_encode failed (${n})`)
    return Buffer.from(this._encBuf.subarray(0, n))
  }

  /**
   * Decode one MLow payload to 16-bit mono PCM.
   * Pass null to conceal a lost packet (PLC).
   * @param {Buffer|Uint8Array|null} data
   * @returns {Int16Array} decoded PCM samples
   */
  decode(data) {
    if (!this._dec) throw new Error('codec closed')
    if (data == null) {
      const n = opus_decode(this._dec, null, 0, this._decBuf, MLOW_FRAME_SIZE, 0)
      return n > 0 ? this._decBuf.slice(0, n) : new Int16Array(MLOW_FRAME_SIZE)
    }
    const buf = Buffer.isBuffer(data) ? data : Buffer.from(data)
    const n = opus_decode(this._dec, buf, buf.length, this._decBuf, MLOW_MAX_OUT, 0)
    if (n <= 0) return new Int16Array(MLOW_FRAME_SIZE)
    return this._decBuf.slice(0, n)
  }

  frameSize() {
    return MLOW_FRAME_SIZE
  }
  sampleRate() {
    return MLOW_SAMPLE_RATE
  }

  close() {
    if (this._enc) {
      opus_encoder_destroy(this._enc)
      this._enc = null
    }
    if (this._dec) {
      opus_decoder_destroy(this._dec)
      this._dec = null
    }
  }
}

export default MLowCodec
