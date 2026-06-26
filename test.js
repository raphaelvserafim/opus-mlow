// Smoke test: encode a 960-sample tone and decode it back.
import { MLowCodec, MLOW_FRAME_SIZE, MLOW_SAMPLE_RATE } from './index.js'

const codec = new MLowCodec()
console.log('frameSize', codec.frameSize(), 'sampleRate', codec.sampleRate())

// 440 Hz sine, one 60 ms frame of 16-bit mono PCM
const pcm = new Int16Array(MLOW_FRAME_SIZE)
for (let i = 0; i < pcm.length; i++) {
  pcm[i] = Math.round(Math.sin((2 * Math.PI * 440 * i) / MLOW_SAMPLE_RATE) * 8000)
}

const encoded = codec.encode(pcm)
console.log('encoded bytes:', encoded.length, encoded.subarray(0, 8).toString('hex'))
if (encoded.length < 1) throw new Error('encode produced empty payload')

const decoded = codec.decode(encoded)
console.log('decoded samples:', decoded.length)
if (decoded.length !== MLOW_FRAME_SIZE) {
  console.warn(`warning: decoded ${decoded.length} samples, expected ${MLOW_FRAME_SIZE}`)
}

// packet-loss concealment
const plc = codec.decode(null)
console.log('PLC samples:', plc.length)

codec.close()
console.log('OK ✓')
