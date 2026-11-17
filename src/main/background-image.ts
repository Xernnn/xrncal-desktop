import { nativeImage } from 'electron'

/**
 * Largest picture kept as the background, in bytes. It is stored as a data:
 * URL inside the settings, and every settings read (both windows, each
 * start-up effect) parses it and ships it over IPC, and every backup copies
 * it: a 10 MB photo put ~13 MB of base64 into one settings row.
 */
export const MAX_BACKGROUND_BYTES = 4 * 1024 * 1024
/** A wider photo is scaled down to this before it is kept: it is drawn blurred, behind the app. */
const BACKGROUND_WIDTH = 2560

/** A PNG or JPEG scaled to BACKGROUND_WIDTH and re-encoded as JPEG, or null
 *  when it cannot be read (nativeImage decodes those two formats only). */
function shrinkWithNativeImage(buffer: Buffer): Buffer | null {
  const image = nativeImage.createFromBuffer(buffer)
  if (image.isEmpty()) return null
  const scaled = image.getSize().width > BACKGROUND_WIDTH ? image.resize({ width: BACKGROUND_WIDTH, quality: 'good' }) : image
  return scaled.toJPEG(85)
}

/**
 * The picture at `buffer` (named with extension `ext`) as the data: URL the
 * background setting stores - scaled down first when it is over the cap - or
 * `tooLarge` when it cannot be brought under it.
 */
export function backgroundImageDataUrl(
  buffer: Buffer,
  ext: string,
  shrink: (buffer: Buffer) => Buffer | null = shrinkWithNativeImage
): { dataUrl: string } | { tooLarge: true } {
  const type = ext.toLowerCase()
  if (buffer.length <= MAX_BACKGROUND_BYTES) {
    const mime = type === 'jpg' ? 'jpeg' : type || 'png'
    return { dataUrl: `data:image/${mime};base64,${buffer.toString('base64')}` }
  }
  const shrunk = ['png', 'jpg', 'jpeg'].includes(type) ? shrink(buffer) : null
  if (!shrunk || shrunk.length > MAX_BACKGROUND_BYTES) return { tooLarge: true }
  return { dataUrl: `data:image/jpeg;base64,${shrunk.toString('base64')}` }
}
