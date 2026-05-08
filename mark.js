export class Mark {
  constructor(
    color,
    minDistance,
    distanceThreshold,
    connectionProbability,
    filled,
    markWidth = 2,
    hatchAngle = 0.7,
    alpha = 1.0,
    trace = false,
    gradient = null,
    fillMode = 'none',
    density = 3
  ) {
    this.color = color
    this.minDistance = minDistance
    this.distanceThreshold = distanceThreshold
    this.connectionProbability = connectionProbability
    this.points = []
    this.filled = filled
    this.markWidth = markWidth
    this.hatchAngle = hatchAngle
    this.alpha = alpha
    this.trace = trace
    this.gradient = gradient
    this.fillMode = fillMode || 'none'
    this.density = density || 3
  }

  addPoint(x, y) {
    var visible = true
    this.points.push({ x, y, visible })
    if (this.points.length > 1) {
      this.connectNewPoint(this.points[this.points.length - 1])
    }
  }

  connectNewPoint(newPoint, targetCanvas) {
    const canvas = targetCanvas || document.getElementById('myCanvas')
    const ctx = canvas.getContext('2d')
    ctx.linecap = 'round'
    ctx.lineJoin = 'round'
    for (let i = 0; i < this.points.length - 1; i++) {
      const existingPoint = this.points[i]
      const dx = newPoint.x - existingPoint.x
      const dy = newPoint.y - existingPoint.y
      const distance = Math.sqrt(dx * dx + dy * dy)
      if (newPoint.visible) {
        if (
          distance <= this.distanceThreshold &&
          Math.random() < this.connectionProbability / 100
        ) {
          this.drawSquigglyLine(ctx, existingPoint, newPoint)
        }
      }
    }
  }

  drawLinesBatch(lines, canvas) {
    const ctx = canvas.getContext('2d')
    ctx.beginPath()
    lines.forEach(line => {
      this.drawSquigglyLine(ctx, line.start, line.end)
    })
    ctx.stroke()
  }

  drawLine(point1, point2, targetCanvas) {
    const canvas = targetCanvas || document.getElementById('myCanvas')
    const ctx = canvas.getContext('2d')
    ctx.strokeStyle = this.color
    ctx.lineWidth = 2
    ctx.beginPath()
    ctx.moveTo(point1.x, point1.y)
    ctx.lineTo(point2.x, point2.y)
    ctx.stroke()
  }

  getRGB(str) {
    var match = str.match(
      /rgba?\((\d{1,3}), ?(\d{1,3}), ?(\d{1,3})\)?(?:, ?(\d(?:\.\d*)?)\))?/
    )
    return `${match[1]}, ${match[2]}, ${match[3]}`
  }

  drawSquigglyLine(ctx, point1, point2) {
    const pressure = this.markWidth
    const step = Math.max(
      1,
      Math.min(
        Math.random() * 5,
        Math.hypot(point2.x - point1.x, point2.y - point1.y)
      )
    )
    let lastx = point1.x, lasty = point1.y
    ctx.lineWidth = this.hatchAngle

    for (let i = 0; i <= step; i++) {
      const t = i / step
      const x = point1.x + (point2.x - point1.x) * t + (Math.random() * 2 - 1) * pressure
      const y = point1.y + (point2.y - point1.y) * t + (Math.random() * 2 - 1) * pressure
      try {
        ctx.strokeStyle = `rgba(${this.getRGB(this.color)}, ${i === 0 || i === step ? 0.03 : 0.25})`
      } catch (error) {
        ctx.strokeStyle = `rgba(255,0,0, ${i === 0 || i === step ? 0.03 : 0.25})`
      }
      ctx.beginPath()
      ctx.moveTo(lastx, lasty)
      ctx.lineTo(x, y)
      ctx.stroke()
      lastx = x
      lasty = y
    }
  }

  render(alpha = 1, transition = false, targetCanvas) {
    const canvas = targetCanvas || document.getElementById('myCanvas')
    const ctx = canvas.getContext('2d')
    ctx.globalAlpha = this.alpha

    if (this.filled) {
      this.drawFilledMark(targetCanvas)
      if (this.trace) {
        for (let i = 1; i < this.points.length; i++) {
          this.connectNewPoint(this.points[i], targetCanvas)
        }
      }
    } else {
      for (let i = 1; i < this.points.length; i++) {
        this.connectNewPoint(this.points[i], targetCanvas)
      }
    }

    ctx.globalAlpha = 1
  }

  drawFilledMark(targetCanvas) {
    const canvas = targetCanvas || document.getElementById('myCanvas')
    const ctx = canvas.getContext('2d')

    const points = this.points.map(p => ({ x: p.x, y: p.y }))
    if (points.length < 3) return

    const minX = Math.min(...points.map(p => p.x))
    const maxX = Math.max(...points.map(p => p.x))
    const minY = Math.min(...points.map(p => p.y))
    const maxY = Math.max(...points.map(p => p.y))

    ctx.strokeStyle = this.color
    ctx.lineWidth = 0.3

    this.clipToPolygon(ctx, points)

    if (this.fillMode === 'solid') {
      // Uniform density hatch — no gradient falloff
      const stepVal = this.density
      let hatchAngle = Math.random() * 360
      ctx.lineWidth = this.hatchAngle
      for (let y = minY; y <= maxY; y += stepVal) {
        for (let x = minX; x <= maxX; x += stepVal) {
          if (this.isPointInPolygon(x, y, points)) {
            hatchAngle = Math.random() * 360
            const offsetX = Math.random() * stepVal - stepVal / 2
            const offsetY = Math.random() * stepVal - stepVal / 2
            this.drawHatchLine(ctx, x + offsetX, y + offsetY, hatchAngle)
          }
        }
      }
    } else {
      // Gradient or none mode — use existing gradient falloff
      // const markWidth = this.markWidth
      // let stepVal = markWidth
      // let hatchAngle = Math.random() * 360
      // ctx.lineWidth = 0.3

      // const markWidth = this.markWidth
      let stepVal = this.density
      console.log('stepVal', stepVal)
      let hatchAngle = Math.random() * 360
      ctx.lineWidth = this.hatchAngle

      if (this.gradient == null) {
        this.gradient = points[0]
      }

      // Only use gradient falloff in 'gradient' mode
      const useGradient = this.fillMode === 'gradient'
      const farthest = useGradient
        ? this.farthestDistance(this.gradient, this.points).maxDistance
        : 1

      for (let y = minY; y <= maxY; y += stepVal) {
        for (let x = minX; x <= maxX; x += stepVal) {
          if (this.isPointInPolygon(x, y, points)) {
            hatchAngle = Math.random() * 360

            if (useGradient) {
              const val = this.distanceBetweenPoints(
                this.gradient.x, this.gradient.y, x, y
              )
              // ctx.lineWidth = this.mapValue(val, 0, farthest * 1.1, 0.6, 0.0)
              ctx.lineWidth = this.mapValue(val, 0, farthest * 1.1, this.hatchAngle, 0.0)

              if (val < farthest * 0.9 && ctx.lineWidth >= 0.2) {
                if (ctx.lineWidth < 0.3) {
                  if (Math.random() * 50 > 10) {
                    const offsetX = Math.random() * stepVal - stepVal / 2
                    const offsetY = Math.random() * stepVal - stepVal / 2
                    this.drawHatchLine(ctx, x + offsetX, y + offsetY, hatchAngle)
                  }
                } else {
                  const offsetX = Math.random() * stepVal - stepVal / 2
                  const offsetY = Math.random() * stepVal - stepVal / 2
                  this.drawHatchLine(ctx, x + offsetX, y + offsetY, hatchAngle)
                }
              }
              // stepVal = parseInt(this.mapValue(val, 0, farthest * 1.02, 2, 5))
              stepVal = parseInt(this.mapValue(val, 0, farthest * 1.02, this.density, this.density+5))
              console.log('stepVal', stepVal)
            } else {
              // fillMode === 'none' — uniform default density
              ctx.lineWidth = this.hatchAngle
              const offsetX = Math.random() * stepVal - stepVal / 2
              const offsetY = Math.random() * stepVal - stepVal / 2
              this.drawHatchLine(ctx, x + offsetX, y + offsetY, hatchAngle)
            }
          }
        }
      }
    }

    ctx.restore()
  }

  distanceBetweenPoints(x1, y1, x2, y2) {
    return Math.sqrt(Math.pow(x2 - x1, 2) + Math.pow(y2 - y1, 2))
  }

  farthestDistance(point, points) {
    let maxDistance = 0
    let farthestPoint = null
    points.forEach(p => {
      const distance = Math.sqrt(Math.pow(p.x - point.x, 2) + Math.pow(p.y - point.y, 2))
      if (distance > maxDistance) {
        maxDistance = distance
        farthestPoint = p
      }
    })
    return { maxDistance, farthestPoint }
  }

  mapValue(val, startRangeBegin, startRangeFinish, endRangeBegin, endRangeFinish) {
    const proportion = (val - startRangeBegin) / (startRangeFinish - startRangeBegin)
    var answer = endRangeBegin + proportion * (endRangeFinish - endRangeBegin)
    answer = answer.toFixed(2)
    if (answer < 0.0) answer = 0.0
    return answer
  }

  clipToPolygon(ctx, points) {
    ctx.save()
    ctx.beginPath()
    ctx.moveTo(points[0].x, points[0].y)
    for (let i = 1; i < points.length; i++) {
      ctx.lineTo(points[i].x, points[i].y)
    }
    ctx.closePath()
    ctx.clip()
  }

  drawHatchLine(ctx, x, y, angle) {
    const length = 10
    const radians = (Math.PI / 180) * angle
    ctx.beginPath()
    ctx.moveTo(x, y)
    ctx.lineTo(x + Math.cos(radians) * length, y + Math.sin(radians) * length)
    ctx.stroke()
  }

  isPointInPolygon(x, y, points) {
    let inside = false
    for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
      const xi = points[i].x, yi = points[i].y
      const xj = points[j].x, yj = points[j].y
      const intersect = yi > y != yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi
      if (intersect) inside = !inside
    }
    return inside
  }

  // Convert this mark to SVG path string for transition rendering
  toSVGPath() {
    if (this.points.length < 2) return ''
    let d = `M ${this.points[0].x} ${this.points[0].y}`
    for (let i = 1; i < this.points.length; i++) {
      d += ` L ${this.points[i].x} ${this.points[i].y}`
    }
    return d
  }

  toJSON() {
    return {
      color: this.color,
      minDistance: this.minDistance,
      distanceThreshold: this.distanceThreshold,
      connectionProbability: this.connectionProbability,
      filled: this.filled,
      points: this.points,
      markWidth: this.markWidth,
      hatchAngle: this.hatchAngle,
      alpha: this.alpha,
      trace: this.trace,
      gradient: this.gradient,
      fillMode: this.fillMode,
      density: this.density
    }
  }

  static fromJSON(data) {
    const mark = new Mark(
      data.color,
      data.minDistance,
      data.distanceThreshold,
      data.connectionProbability,
      data.filled,
      data.markWidth,
      data.hatchAngle,
      data.alpha,
      data.trace,
      data.gradient,
      data.fillMode || 'none',
      data.density || 3
    )
    mark.points = data.points.map(point => ({
      x: Math.floor(point.x),
      y: Math.floor(point.y),
      visible: point.visible != null ? point.visible : true
    }))
    return mark
  }

  hexToRgb(color) {
    const colorHexMap = {
      black: '#000000',
      white: '#FFFFFF',
      red: '#FF0000',
      green: '#008000',
      blue: '#0000FF'
    }
    const hex = color.startsWith('#')
      ? color
      : colorHexMap[color.toLowerCase()] || '#000000'
    let bigint = parseInt(hex.slice(1), 16)
    let r = (bigint >> 16) & 255
    let g = (bigint >> 8) & 255
    let b = bigint & 255
    return `${r}, ${g}, ${b}`
  }
}