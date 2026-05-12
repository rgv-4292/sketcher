import { Mark } from './mark.js'

export class Page {
  constructor(canvasId) {
    this.canvasId = canvasId
    this.marks = []
    const canvas = document.getElementById(canvasId)
    this.canvasParams = {
      width: canvas ? canvas.width : 720,
      height: canvas ? canvas.height : 960,
      backgroundColor: '#f0ebe8'
    }
    this.tempMarks = []
    this.transitioning = false
    this.stepCount = 12
  }

  addMark(mark) {
    this.marks.push(mark)
  }

  addTempMark(mark) {
    this.tempMarks.push(mark)
  }

  removeLastMark() {
    this.marks.pop()
  }

  clearCanvas(targetCanvas) {
    const canvas = targetCanvas || document.getElementById(this.canvasId)
    const ctx = canvas.getContext('2d')
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    ctx.fillStyle = this.canvasParams.backgroundColor
    ctx.fillRect(0, 0, canvas.width, canvas.height)
  }

  shuffle(array) {
    let currentIndex = array.length
    while (currentIndex != 0) {
      let randomIndex = Math.floor(Math.random() * currentIndex)
      currentIndex--
        ;[array[currentIndex], array[randomIndex]] = [
          array[randomIndex],
          array[currentIndex]
        ]
    }
  }

  render(trans = false, targetCanvas) {
    this.clearCanvas(targetCanvas)

    const masksByIndex = []
    this.marks.forEach((mark, i) => {
      if (mark.isMask && mark.points.length >= 3) {
        masksByIndex.push({ index: i, polygon: mark.points.map(p => ({ x: p.x, y: p.y })) })
      }
    })

    this.marks.forEach((mark, i) => {
      try {
        const maskPolygons = masksByIndex
          .filter(m => m.index > i)
          .map(m => m.polygon)
        mark.render(this.alpha, trans, targetCanvas, maskPolygons)
      } catch (error) {
        console.log(error)
      }
    })

    const allMaskPolygons = masksByIndex.map(m => m.polygon)
    this.tempMarks.forEach(mark => {
      try {
        mark.render(this.alpha, trans, targetCanvas, allMaskPolygons)
      } catch (error) {
        console.log(error)
      }
    })
  }

  isPointInPolygon(x, y, points) {
    let inside = false
    for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
      const xi = points[i].x, yi = points[i].y
      const xj = points[j].x, yj = points[j].y
      const intersect =
        yi > y != yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi
      if (intersect) inside = !inside
    }
    return inside
  }

  toJSON() {
    return {
      canvasParams: this.canvasParams,
      marks: this.marks.map(mark => mark.toJSON())
    }
  }

  loadFromJSON(json_file) {
    try {
      const data =
        typeof json_file === 'object' ? json_file : JSON.parse(json_file)
      this.canvasParams = data.canvasParams
      this.marks = data.marks.map(markData => Mark.fromJSON(markData))
      this.render()
    } catch (error) {
      console.error('Error loading JSON:', error)
    }
  }

  svgToJson(svgString) {
    noise.seed(Math.random())
    const parser = new DOMParser()
    const svgDOM = parser.parseFromString(svgString, 'image/svg+xml').documentElement

    let minDistance = parseFloat(document.getElementById('minDistance').value)
    let distanceThreshold = parseInt(document.getElementById('distanceThreshold').value)
    let connectionProbability = parseInt(document.getElementById('connectionProbability').value)
    let myMarkWidth = parseFloat(document.getElementById('markWidth').value)
    let myHatchAngle = parseFloat(document.getElementById('hatchAngle').value)

    // --- Resolve SVG dimensions to pixels ---
    // Priority: explicit px width/height → viewBox → fallback 744×1052 (A4 at 96dpi)
    const svgPxDims = resolveSvgDimensions(svgDOM)
    const svgW = svgPxDims.width
    const svgH = svgPxDims.height

    // Target canvas dimensions
    const targetCanvas = document.getElementById(this.canvasId)
    const canvasW = targetCanvas ? targetCanvas.width : this.canvasParams.width
    const canvasH = targetCanvas ? targetCanvas.height : this.canvasParams.height

    // Scale factor: fit SVG into canvas preserving aspect ratio
    const scale = Math.min(canvasW / svgW, canvasH / svgH)
    const offsetX = (canvasW - svgW * scale) / 2
    const offsetY = (canvasH - svgH * scale) / 2

    // viewBox origin (for coordinate remapping)
    const vb = svgDOM.getAttribute('viewBox')
    let vbX = 0, vbY = 0, vbW = svgW, vbH = svgH
    if (vb) {
      const parts = vb.trim().split(/[\s,]+/).map(parseFloat)
      if (parts.length === 4) { vbX = parts[0]; vbY = parts[1]; vbW = parts[2]; vbH = parts[3] }
    }

    // Mount into a hidden container so SVG.js can traverse paths without affecting layout
    const container = document.createElement('div')
    container.style.cssText = 'position:absolute;visibility:hidden;pointer-events:none;width:0;height:0;overflow:hidden;'
    document.body.appendChild(container)

    try {
      // Give SVG.js the SVG at its native viewBox size so pointAt() returns viewBox coords
      const draw = SVG().addTo(container).size(vbW, vbH).svg(svgDOM.outerHTML)

      const backgroundColor = this.canvasParams.backgroundColor
      const canvasParams = {
        width: canvasW,
        height: canvasH,
        backgroundColor: backgroundColor
      }

      // Map a viewBox coordinate to canvas pixel coordinate
      const toCanvas = (vx, vy) => ({
        x: offsetX + ((vx - vbX) / vbW) * svgW * scale,
        y: offsetY + ((vy - vbY) / vbH) * svgH * scale
      })

      const marks = []
      draw.find('path').each(function (element) {
        const path = element
        const length = path.length()
        const points = []
        const dist = 2
        for (let i = 0; i <= length; i += dist) {
          const pt = path.pointAt(i)
          const value = noise.simplex2(pt.x / 50, pt.y / 50)
          const canvas = toCanvas(pt.x + value * 2, pt.y + value * 2)
          points.push({ x: Math.round(canvas.x), y: Math.round(canvas.y), visible: true })
        }

        const styleAttr = path.attr('style') || ''
        const styleDict = styleStringToDict(styleAttr)

        let myColor = hexToRgba(styleDict['stroke'] || '#000000', 0.75)
        let myWidth = parseFloat(styleDict['stroke-width']) || 1.0

        let isFilled = false
        let myDensity = 3
        let myTrace = false
        let isMask = false
        let myFillMode = 'none'

        const myFill = styleDict['fill']
        if (myFill && myFill !== 'none') {
          myColor = hexToRgba(myFill, 0.75)
          const fillOpacity = parseFloat(styleDict['fill-opacity'] ?? '1')
          myDensity = mapRange(fillOpacity, 0, 1, 16, 2)
          consoloe.log('fillOpacity', fillOpacity, 'myDensity', myDensity)
          if (fillOpacity >= 1) isMask = true
          isFilled = true
          myFillMode = 'solid'
        }

        marks.push({
          color: myColor,
          minDistance,
          distanceThreshold,
          connectionProbability,
          filled: isFilled,
          points,
          markWidth: myMarkWidth,
          hatchAngle: myHatchAngle,
          alpha: 0.75,
          trace: myTrace,
          fillMode: myFillMode,
          density: myDensity,
          isMask
        })
      })

      return { canvasParams, marks }

    } finally {
      document.body.removeChild(container)
    }
  }

  namedColorToRgba(color) {
    const colors = {
      black: 'rgba(0, 0, 0, 1)',
      white: 'rgba(255, 255, 255, 1)',
      red: 'rgba(255, 0, 0, 1)',
      green: 'rgba(0, 255, 0, 1)',
      blue: 'rgba(0, 0, 255, 1)'
    }
    return colors[color.toLowerCase()] || 'rgba(0, 0, 0, 1)'
  }

  // --- Transition helpers ---

  computeCentroid(points) {
    const sum = points.reduce(
      (acc, p) => ({ x: acc.x + p.x, y: acc.y + p.y }),
      { x: 0, y: 0 }
    )
    return { x: sum.x / points.length, y: sum.y / points.length }
  }

  resamplePoints(points, targetCount) {
    if (points.length === targetCount) return points
    if (points.length === 1) {
      return Array(targetCount).fill({ ...points[0] })
    }
    const result = []
    const step = (points.length - 1) / (targetCount - 1)
    for (let i = 0; i < targetCount; i++) {
      const t = i * step
      const idx = Math.floor(t)
      const frac = t - idx
      const p1 = points[idx]
      const p2 = points[Math.min(idx + 1, points.length - 1)]
      result.push({
        x: p1.x + (p2.x - p1.x) * frac,
        y: p1.y + (p2.y - p1.y) * frac,
        visible: true
      })
    }
    return result
  }

  scorePair(markA, markB) {
    const centA = this.computeCentroid(markA.points)
    const centB = this.computeCentroid(markB.points)
    const dist = Math.hypot(centB.x - centA.x, centB.y - centA.y)
    const typePenalty = markA.filled !== markB.filled ? 500 : 0
    const countDiff = Math.abs(markA.points.length - markB.points.length)
    return dist + typePenalty + countDiff * 0.5
  }

  matchMarks(fromMarks, toMarks) {
    const matched = []
    const usedTo = new Set()

    fromMarks.forEach((fromMark, fromIdx) => {
      let bestScore = Infinity
      let bestToIdx = -1
      toMarks.forEach((toMark, toIdx) => {
        if (usedTo.has(toIdx)) return
        const score = this.scorePair(fromMark, toMark)
        if (score < bestScore) {
          bestScore = score
          bestToIdx = toIdx
        }
      })
      if (bestToIdx >= 0) {
        matched.push({ fromIdx, toIdx: bestToIdx })
        usedTo.add(bestToIdx)
      }
    })

    const unmatchedFrom = fromMarks
      .map((_, i) => i)
      .filter(i => !matched.find(m => m.fromIdx === i))

    const unmatchedTo = toMarks
      .map((_, i) => i)
      .filter(i => !usedTo.has(i))

    return { matched, unmatchedFrom, unmatchedTo }
  }

  nearestToCentroid(fromMark, toMarks, matched) {
    let bestDist = Infinity
    let bestCentroid = null
    const centFrom = this.computeCentroid(fromMark.points)
    matched.forEach(({ toIdx }) => {
      const cent = this.computeCentroid(toMarks[toIdx].points)
      const dist = Math.hypot(cent.x - centFrom.x, cent.y - centFrom.y)
      if (dist < bestDist) {
        bestDist = dist
        bestCentroid = cent
      }
    })
    return bestCentroid || centFrom
  }

  nearestFromCentroid(toMark, fromMarks, matched) {
    let bestDist = Infinity
    let bestCentroid = null
    const centTo = this.computeCentroid(toMark.points)
    matched.forEach(({ fromIdx }) => {
      const cent = this.computeCentroid(fromMarks[fromIdx].points)
      const dist = Math.hypot(cent.x - centTo.x, cent.y - centTo.y)
      if (dist < bestDist) {
        bestDist = dist
        bestCentroid = cent
      }
    })
    return bestCentroid || centTo
  }

  interpolatePoints(fromPoints, toPoints, t) {
    return fromPoints.map((p, i) => ({
      x: p.x + (toPoints[i].x - p.x) * t,
      y: p.y + (toPoints[i].y - p.y) * t,
      visible: true
    }))
  }

  interpolateColor(color1, color2, t) {
    const parseColor = color => {
      const match = color.match(
        /rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*(\d+\.?\d*))?\)/
      )
      if (match) {
        const [, r, g, b, a] = match.map(Number)
        return [r, g, b, a !== undefined ? a : 1]
      }
      return [0, 0, 0, 1]
    }
    const [r1, g1, b1, a1] = parseColor(color1)
    const [r2, g2, b2, a2] = parseColor(color2)
    const r = Math.round(r1 + (r2 - r1) * t)
    const g = Math.round(g1 + (g2 - g1) * t)
    const b = Math.round(b1 + (b2 - b1) * t)
    const a = (a1 + (a2 - a1) * t).toFixed(2)
    return `rgba(${r},${g},${b},${a})`
  }

  lerpHexColor(hex1, hex2, t) {
    const parse = hex => {
      const r = parseInt(hex.slice(1, 3), 16)
      const g = parseInt(hex.slice(3, 5), 16)
      const b = parseInt(hex.slice(5, 7), 16)
      return [r, g, b]
    }
    const [r1, g1, b1] = parse(hex1)
    const [r2, g2, b2] = parse(hex2)
    const r = Math.round(r1 + (r2 - r1) * t).toString(16).padStart(2, '0')
    const g = Math.round(g1 + (g2 - g1) * t).toString(16).padStart(2, '0')
    const b = Math.round(b1 + (b2 - b1) * t).toString(16).padStart(2, '0')
    return `#${r}${g}${b}`
  }

  async startTransition(newJSON) {
    const FRAMES = 7
    const FRAME_DURATION = 100

    const fromMarks = this.marks.map(m => Mark.fromJSON(m.toJSON()))
    const toMarks = newJSON.marks.map(markData => Mark.fromJSON(markData))

    const fromBg = this.canvasParams.backgroundColor || '#f0ebe8'
    const toBg = newJSON.canvasParams.backgroundColor || '#f0ebe8'

    if (fromMarks.length === 0) {
      this.marks = toMarks
      this.tempMarks = []
      this.render()
      return
    }

    const { matched, unmatchedFrom, unmatchedTo } = this.matchMarks(fromMarks, toMarks)

    const matchedPairs = matched.map(({ fromIdx, toIdx }) => {
      const from = fromMarks[fromIdx]
      const to = toMarks[toIdx]
      const targetCount = Math.max(from.points.length, to.points.length)
      return {
        fromPoints: this.resamplePoints(from.points, targetCount),
        toPoints: this.resamplePoints(to.points, targetCount),
        fromMark: from,
        toMark: to
      }
    })

    const unmatchedFromData = unmatchedFrom.map(fromIdx => {
      const fromMark = fromMarks[fromIdx]
      const target = this.nearestToCentroid(fromMark, toMarks, matched)
      const targetPoints = fromMark.points.map(() => ({ x: target.x, y: target.y, visible: true }))
      return { fromMark, targetPoints }
    })

    const unmatchedToData = unmatchedTo.map(toIdx => {
      const toMark = toMarks[toIdx]
      const source = this.nearestFromCentroid(toMark, fromMarks, matched)
      const sourcePoints = toMark.points.map(() => ({ x: source.x, y: source.y, visible: true }))
      return { toMark, sourcePoints }
    })

    const offscreen = document.createElement('canvas')
    offscreen.width = this.canvasParams.width
    offscreen.height = this.canvasParams.height

    const frames = []

    for (let f = 0; f < FRAMES; f++) {
      const t = f / (FRAMES - 1)

      const offCtx = offscreen.getContext('2d')
      offCtx.fillStyle = this.lerpHexColor(fromBg, toBg, t)
      offCtx.fillRect(0, 0, offscreen.width, offscreen.height)

      matchedPairs.forEach(({ fromPoints, toPoints, fromMark, toMark }) => {
        const interpPoints = this.interpolatePoints(fromPoints, toPoints, t)
        const color = this.interpolateColor(fromMark.color, toMark.color, t)
        const width = fromMark.markWidth + (toMark.markWidth - fromMark.markWidth) * t
        const hatch = fromMark.hatchAngle + (toMark.hatchAngle - fromMark.hatchAngle) * t
        const tempMark = Mark.fromJSON({
          ...toMark.toJSON(), color, markWidth: width, hatchAngle: hatch, points: interpPoints, alpha: 1
        })
        tempMark.render(1, false, offscreen)
      })

      unmatchedFromData.forEach(({ fromMark, targetPoints }) => {
        const interpPoints = this.interpolatePoints(fromMark.points, targetPoints, t)
        const tempMark = Mark.fromJSON({ ...fromMark.toJSON(), points: interpPoints, alpha: 1 - t })
        tempMark.render(1, false, offscreen)
      })

      unmatchedToData.forEach(({ toMark, sourcePoints }) => {
        const interpPoints = this.interpolatePoints(sourcePoints, toMark.points, t)
        const tempMark = Mark.fromJSON({ ...toMark.toJSON(), points: interpPoints, alpha: t })
        tempMark.render(1, false, offscreen)
      })

      const bitmap = await createImageBitmap(offscreen)
      frames.push(bitmap)
    }

    const mainCanvas = document.getElementById(this.canvasId)
    const mainCtx = mainCanvas.getContext('2d')

    let frameIndex = 0
    let lastTime = null

    const playFrame = (timestamp) => {
      if (!lastTime) lastTime = timestamp
      const elapsed = timestamp - lastTime

      if (elapsed >= FRAME_DURATION) {
        mainCtx.drawImage(frames[frameIndex], 0, 0)
        frames[frameIndex].close()
        frameIndex++
        lastTime = timestamp
      }

      if (frameIndex < frames.length) {
        requestAnimationFrame(playFrame)
      } else {
        this.marks = toMarks
        this.tempMarks = []
        this.canvasParams.backgroundColor = toBg
        this.render()
      }
    }

    requestAnimationFrame(playFrame)
  }
}

// --- Module-level helpers ---

// Convert SVG attribute value with units to pixels at 96dpi
function svgLengthToPx(value) {
  if (value === null || value === undefined || value === '') return null
  const s = String(value).trim()
  const num = parseFloat(s)
  if (isNaN(num)) return null
  if (s.endsWith('mm')) return num * 3.7795275591    // 96/25.4
  if (s.endsWith('cm')) return num * 37.795275591    // 96/2.54
  if (s.endsWith('in')) return num * 96
  if (s.endsWith('pt')) return num * 1.3333333333    // 96/72
  if (s.endsWith('pc')) return num * 16              // 96/6
  if (s.endsWith('px') || s.endsWith('%') || /^\d/.test(s)) return num
  return num // unitless — treat as px
}

// Resolve the true pixel width/height of an SVG element.
// Priority: explicit px width+height > viewBox w/h > fallback 744×1052 (A4 @ 96dpi)
function resolveSvgDimensions(svgEl) {
  const wAttr = svgEl.getAttribute('width')
  const hAttr = svgEl.getAttribute('height')
  const vb = svgEl.getAttribute('viewBox')

  let vbX = 0, vbY = 0, vbW = null, vbH = null
  if (vb) {
    const parts = vb.trim().split(/[\s,]+/).map(parseFloat)
    if (parts.length === 4) { vbX = parts[0]; vbY = parts[1]; vbW = parts[2]; vbH = parts[3] }
  }

  let w = svgLengthToPx(wAttr)
  let h = svgLengthToPx(hAttr)

  // If width/height are percentages or missing, fall back to viewBox
  const wIsRelative = wAttr && String(wAttr).trim().endsWith('%')
  const hIsRelative = hAttr && String(hAttr).trim().endsWith('%')

  if (!w || wIsRelative) w = vbW
  if (!h || hIsRelative) h = vbH

  // Final fallback: A4 at 96dpi
  if (!w) w = 744
  if (!h) h = 1052

  return { width: w, height: h, vbX, vbY, vbW: vbW || w, vbH: vbH || h }
}

function hexToRgba(hex, alpha = 0.75) {
  if (!hex || hex === 'none') return `rgba(0, 0, 0, ${alpha})`
  try {
    hex = hex.replace(/^#/, '')
    let r, g, b
    if (hex.length === 3) {
      r = parseInt(hex[0] + hex[0], 16)
      g = parseInt(hex[1] + hex[1], 16)
      b = parseInt(hex[2] + hex[2], 16)
    } else if (hex.length === 6) {
      r = parseInt(hex.substring(0, 2), 16)
      g = parseInt(hex.substring(2, 4), 16)
      b = parseInt(hex.substring(4, 6), 16)
    } else {
      throw new Error('Invalid hex color format.')
    }
    return `rgba(${r}, ${g}, ${b}, ${alpha})`
  } catch (error) {
    return `rgba(0, 0, 0, ${alpha})`
  }
}

function mapRange(value, inMin, inMax, outMin, outMax) {
  return (value - inMin) * (outMax - outMin) / (inMax - inMin) + outMin
}

function styleStringToDict(styleString) {
  const styleDict = {}
  if (!styleString) return styleDict
  styleString.split(';').forEach(style => {
    if (style && style.includes(':')) {
      let [key, ...rest] = style.split(':')
      styleDict[key.trim()] = rest.join(':').trim()
    }
  })
  return styleDict
}
