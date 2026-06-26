export const MLOW_SAMPLE_RATE: 16000
export const MLOW_CHANNELS: 1
export const MLOW_FRAME_SIZE: 960

export interface MLowCodecOptions {
  /** Target bitrate in bits/s (default 6000). */
  bitrate?: number
  /** Encoder complexity 0–10 (default 5). */
  complexity?: number
  /** Enable in-band FEC (default false). */
  fec?: boolean
}

/**
 * MLow (SMPL) Opus codec — 16 kHz mono, 60 ms (960-sample) frames.
 * Wraps the native libopus_mlow via koffi FFI.
 */
export class MLowCodec {
  constructor(opts?: MLowCodecOptions)
  /** Encode one 960-sample 16-bit mono PCM frame to an MLow payload. */
  encode(pcm: Int16Array): Buffer
  /** Decode an MLow payload to 16-bit mono PCM. Pass null for packet-loss concealment. */
  decode(data: Buffer | Uint8Array | null): Int16Array
  frameSize(): number
  sampleRate(): number
  close(): void
}

export default MLowCodec
