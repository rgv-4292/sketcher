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
 * Compute the caption layout for a given max width.
 *
 * Splits caption on `|` into hard-line paragraphs, then word-wraps each
 * paragraph to fit within maxWidth pixels.
 *
 * @param {CanvasRenderingContext2D} ctx   context with font already set
 * @param {string}  caption      raw caption text (may contain `|` breaks)
 * @param {number}  fontSize     font size in px (used to compute lineHeight)
 * @param {number}  maxWidth     maximum pixel width for caption text
 * @returns {{ lines: string[], width: number, blockHeight: number, lineHeight: number }}
 */
export function computeCaptionLayout (ctx, caption, fontSize, maxWidth) {
  const lineHeight = Math.round(fontSize * 1.3)
  const hardParagraphs = caption.replace(/\s*\|\s*/g, '\n').split('\n')

  // Wrap each paragraph and collect all visual lines.
  const allLines = []
  for (const para of hardParagraphs) {
    const trimmed = para.trim()
    if (!trimmed) {
      allLines.push('')
    } else {
      const wrapped = wrapText(ctx, trimmed, maxWidth)
      allLines.push(...wrapped)
    }
  }

  const blockHeight = allLines.length * lineHeight + Math.round(fontSize * 0.5)

  return { lines: allLines, width: maxWidth, blockHeight, lineHeight }
}
