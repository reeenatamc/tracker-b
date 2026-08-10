/**
 * Draws the app icons.
 *
 * The mark is the session progress bar from the Today screen — segments filled
 * left to right — because that is the app's one recurring visual idea and it
 * reads at 48px. Written as a script rather than committed binaries so the
 * palette stays in one place: change the tokens, re-run, done.
 *
 * Run with: npm run icons
 */

import { deflateSync } from 'node:zlib'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const OUT_DIR = resolve(ROOT, 'public')

type Rgb = [number, number, number]

const GROUND: Rgb = [0x0e, 0x11, 0x16]
const RESERVE: Rgb = [0x3f, 0xd0, 0xb6]
const LINE: Rgb = [0x26, 0x2e, 0x3a]

const SEGMENTS = 5
const FILLED = 3

function drawIcon(size: number, { maskable = false } = {}): Buffer {
  const pixels = Buffer.alloc(size * size * 3)

  // Maskable icons get cropped to a circle by the launcher, so the mark shrinks
  // into the guaranteed-safe centre rather than running to the edges.
  const inset = maskable ? 0.28 : 0.18
  const barWidth = size * (1 - inset * 2)
  const left = (size - barWidth) / 2
  const gap = Math.max(2, Math.round(size * 0.022))
  const segmentWidth = (barWidth - gap * (SEGMENTS - 1)) / SEGMENTS
  const barHeight = Math.max(3, Math.round(size * 0.09))
  const top = (size - barHeight) / 2

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let colour = GROUND

      if (y >= top && y < top + barHeight) {
        const offset = x - left
        if (offset >= 0 && offset <= barWidth) {
          const slot = Math.floor(offset / (segmentWidth + gap))
          const withinSlot = offset - slot * (segmentWidth + gap)
          if (slot < SEGMENTS && withinSlot <= segmentWidth) {
            colour = slot < FILLED ? RESERVE : LINE
          }
        }
      }

      const index = (y * size + x) * 3
      pixels[index] = colour[0]
      pixels[index + 1] = colour[1]
      pixels[index + 2] = colour[2]
    }
  }

  return encodePng(size, size, pixels)
}

// ------------------------------------------------------------------ png output

/** Minimal truecolour PNG writer: signature, IHDR, IDAT, IEND. */
function encodePng(width: number, height: number, rgb: Buffer): Buffer {
  // Each scanline is prefixed with its filter type; 0 means "no filtering".
  const raw = Buffer.alloc(height * (width * 3 + 1))
  for (let y = 0; y < height; y++) {
    raw[y * (width * 3 + 1)] = 0
    rgb.copy(raw, y * (width * 3 + 1) + 1, y * width * 3, (y + 1) * width * 3)
  }

  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 2 // colour type: truecolour
  // bytes 10–12 stay zero: deflate, adaptive filtering, no interlace

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

function chunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length, 0)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body), 0)
  return Buffer.concat([length, body, crc])
}

const CRC_TABLE = Array.from({ length: 256 }, (_, index) => {
  let value = index
  for (let bit = 0; bit < 8; bit++) {
    value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1
  }
  return value >>> 0
})

function crc32(buffer: Buffer): number {
  let crc = 0xffffffff
  for (const byte of buffer) {
    crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8)
  }
  return (crc ^ 0xffffffff) >>> 0
}

// ---------------------------------------------------------------------- main

mkdirSync(OUT_DIR, { recursive: true })

const icons: Array<[file: string, size: number, maskable: boolean]> = [
  ['icon-192.png', 192, false],
  ['icon-512.png', 512, false],
  ['icon-maskable-512.png', 512, true],
  ['apple-touch-icon.png', 180, false],
]

for (const [file, size, maskable] of icons) {
  writeFileSync(resolve(OUT_DIR, file), drawIcon(size, { maskable }))
  console.log(`  ${file}  ${size}×${size}`)
}
