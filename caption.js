/**
 * Shared caption helpers for Sketcher overlay and video export.
 *
 * Both the sketcher view (HTML overlay) and the video export (canvas draw)
 * need identical word-wrapping logic so captions look the same.
 */

/**
 * Wrap a single paragraph of text to fit within maxWidth pixels.
 * Requires a canvas 2D context with the target font already set.
 *
 * @param {CanvasRenderingContext2D} ctx  context with font set for measureText
 * @param {string}  text       plain text (no newlines)
 * @param {number}  maxWidth   maximum pixel width per line
 * @returns {string[]}         array of wrapped lines
 */
export function wrapText (ctx, text, maxWidth) {
  const words = text.split(/\s+/).filter(Boolean)
  if (words.length === 0) return ['']

  const lines = []
  let currentLine = words[0]

  for (let i = 1; i < words.length; i++) {
    const word = words[i]
    const testLine = currentLine + ' ' + word
    if (ctx.measureText(testLine).width > maxWidth) {
      lines.push(currentLine)
      currentLine = word
    } else {
      currentLine = testLine
    }
  }
  lines.push(currentLine)
  return lines
}

/**
 * Compute the optimal caption layout for a given canvas size.
 *
 * Strategy:
 *  – Split caption on `|` into hard-line paragraphs.
 *  – Measure the raw (un-wrapped) width of each paragraph at the target font.
 *  – If the widest paragraph fits within canvasWidth, shrink the overlay to
 *    that width so the text sits on a single line (no orphan words).
 *  – If it exceeds canvasWidth, use the full canvas width and word-wrap.
 *
 * @param {CanvasRenderingContext2D} ctx   context with font already set
 * @param {string}  caption      raw caption text (may contain `|` breaks)
 * @param {number}  fontSize     font size in px (used to compute lineHeight)
 * @param {number}  canvasWidth  width of the underlying canvas in px
 * @returns {{ lines: string[], width: number, blockHeight: number, lineHeight: number }}
 */
export function computeCaptionLayout (ctx, caption, fontSize, canvasWidth) {
  const lineHeight = Math.round(fontSize * 1.3)
  const hardParagraphs = caption.replace(/\s*\|\s*/g, '\n').split('\n')

  // Measure the raw width of each paragraph (before any wrapping).
  const rawWidths = hardParagraphs.map(p => {
    const trimmed = p.trim()
    return trimmed ? ctx.measureText(trimmed).width : 0
  })
  const widestRaw = Math.max(...rawWidths, 0)

  // Choose container width.
  const PADDING = 2 // small safety margin for font metric rounding
  const containerWidth = widestRaw + PADDING <= canvasWidth
    ? widestRaw + PADDING          // fits on one line — shrink to text
    : canvasWidth                   // needs wrapping — use full width

  // Wrap each paragraph and collect all visual lines.
  const allLines = []
  for (const para of hardParagraphs) {
    const trimmed = para.trim()
    if (!trimmed) {
      allLines.push('')
    } else {
      const wrapped = wrapText(ctx, trimmed, containerWidth)
      allLines.push(...wrapped)
    }
  }

  const blockHeight = allLines.length * lineHeight + Math.round(fontSize * 0.5)

  return { lines: allLines, width: containerWidth, blockHeight, lineHeight }
}
