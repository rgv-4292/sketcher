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

    // Pass 1: collect all mask polygons with their array index
    const masksByIndex = []
    this.marks.forEach((mark, i) => {
      if (mark.isMask && mark.points.length >= 3) {
        masksByIndex.push({ index: i, polygon: mark.points.map(p => ({ x: p.x, y: p.y })) })
      }
    })

    // Pass 2: render each mark, passing only masks that appear AFTER it in the array
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

    // tempMarks get all masks applied
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
    const svgDOM = parser.parseFromString(
      svgString,
      'image/svg+xml'
    ).documentElement
    let minDistance = parseFloat(document.getElementById('minDistance').value)
    let distanceThreshold = parseInt(document.getElementById('distanceThreshold').value)
    let connectionProbability = parseInt(document.getElementById('connectionProbability').value)
    let markWidth = parseFloat(document.getElementById('markWidth').value)
    let hatchAngle = parseFloat(document.getElementById('hatchAngle').value)
    console.log(minDistance, distanceThreshold, connectionProbability, markWidth, hatchAngle)

    // Mount into a hidden offscreen container so SVG.js can work but layout is unaffected
    const container = document.createElement('div')
    container.style.cssText = 'position:absolute;visibility:hidden;pointer-events:none;width:0;height:0;overflow:hidden;'
    document.body.appendChild(container)

    try {
      const draw = SVG().addTo(container).size('400', '700').svg(svgDOM.outerHTML)
      const backgroundColor = this.backgroundColor
      const canvasParams = {
        width: parseFloat(draw.attr('width')),
        height: parseFloat(draw.attr('height')),
        backgroundColor: backgroundColor
      }
      const marks = []
      draw.find('path').each(function (element) {
        const path = element
        const length = path.length()
        const points = []
        const dist = 2
        for (let i = 0; i <= length; i += dist) {
          const point = path.pointAt(i)
          var value = noise.simplex2(point.x / 50, point.y / 50)
          points.push({
            x: parseInt(point.x + value * 2),
            y: parseInt(point.y + value * 2),
            visible: true
          })
        }
        var attributes = path.attr('style')
        const styleDict = styleStringToDict(attributes)
        var myColor = hexToRgba(styleDict['stroke'], 0.75)
        try {
          var myWidth = styleDict['stroke-width']
          var mySat = Math.max(0.7, Math.max(myWidth / 4, 2.7))
        } catch (error) {
          var myWidth = 1.0
          var mySat = 0.7
          console.log(error)
        }
        var isFilled = false
        var fillOpacity
        
        var myDensity = 3
        var myTrace = false
        var isMask = false
        // var myGradient = false
        var myFillMode = 'none'
        try {
          var myFill = styleDict['fill']
          console.log(myFill)
          if (myFill && myFill !== 'none') {
            myColor = hexToRgba(myFill, 0.75)
            fillOpacity = styleDict['fill-opacity']
            console.log(styleDict)
            myDensity = mapRange(parseFloat(fillOpacity), 0, 1, 16, 2)
            if (fillOpacity == 1) { isMask = true }
            isFilled = true
            myFillMode = 'solid'
          }

        } catch (error) {
          console.log(error)
        }

        const mark = {
          color: myColor,
          minDistance: minDistance,
          distanceThreshold: distanceThreshold,
          connectionProbability: connectionProbability,
          filled: isFilled,
          points: points,
          markWidth: markWidth,
          hatchAngle: hatchAngle,
          alpha: 0.75,
          trace: myTrace,
          // gradient: myGradient,
          fillMode: myFillMode,
          density: myDensity,
          isMask: isMask,
        }
        marks.push(mark)
      })
      return {
        canvasParams: canvasParams,
        marks: marks
      }
    } finally {
      // Always remove the container from the DOM regardless of success or error
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

  mapRange(value, inMin, inMax, outMin, outMax) {
    return (value - inMin) * (outMax - outMin) / (inMax - inMin) + outMin;
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

    const { matched, unmatchedFrom, unmatchedTo } = this.matchMarks(
      fromMarks,
      toMarks
    )

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
      const targetPoints = fromMark.points.map(() => ({
        x: target.x,
        y: target.y,
        visible: true
      }))
      return { fromMark, targetPoints }
    })

    const unmatchedToData = unmatchedTo.map(toIdx => {
      const toMark = toMarks[toIdx]
      const source = this.nearestFromCentroid(toMark, fromMarks, matched)
      const sourcePoints = toMark.points.map(() => ({
        x: source.x,
        y: source.y,
        visible: true
      }))
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
        const width =
          fromMark.markWidth + (toMark.markWidth - fromMark.markWidth) * t
        const hatch =
          fromMark.hatchAngle + (toMark.hatchAngle - fromMark.hatchAngle) * t

        const tempMark = Mark.fromJSON({
          ...toMark.toJSON(),
          color,
          markWidth: width,
          hatchAngle: hatch,
          points: interpPoints,
          alpha: 1
        })
        tempMark.render(1, false, offscreen)
      })

      unmatchedFromData.forEach(({ fromMark, targetPoints }) => {
        const interpPoints = this.interpolatePoints(
          fromMark.points,
          targetPoints,
          t
        )
        const alpha = 1 - t
        const tempMark = Mark.fromJSON({
          ...fromMark.toJSON(),
          points: interpPoints,
          alpha
        })
        tempMark.render(1, false, offscreen)
      })

      unmatchedToData.forEach(({ toMark, sourcePoints }) => {
        const interpPoints = this.interpolatePoints(
          sourcePoints,
          toMark.points,
          t
        )
        const alpha = t
        const tempMark = Mark.fromJSON({
          ...toMark.toJSON(),
          points: interpPoints,
          alpha
        })
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

// --- Module-level helpers (used by svgToJson) ---

function hexToRgba(hex, alpha = 0.75) {
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
    console.log(error)
    return `rgba(0, 0, 0, ${alpha})`
  }
}

function styleStringToDict(styleString) {
  const styleDict = {}
  styleString.split(';').forEach(style => {
    if (style) {
      let [key, value] = style.split(':')
      key = key.trim()
      value = value.trim()
      styleDict[key] = value
    }
  })
  return styleDict
}
