export class Mark {
  constructor (
    color,
    minDistance,
    distanceThreshold,
    connectionProbability,
    filled,
    markWidth = 2, // Default markWidth
    hatchAngle = 0.7, // Default hatchAngle
    alpha = 1.0,
    trace = false,
    gradient = null
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
    // console.log('started', this.filled);
  }

  addPoint (x, y) {
    var visible = true
    this.points.push({ x, y, visible })
    if (this.points.length > 1) {
      this.connectNewPoint(this.points[this.points.length - 1])
    }
  }

  connectNewPoint (newPoint) {
    const canvas = document.getElementById('myCanvas')
    const ctx = canvas.getContext('2d')
    ctx.linecap = 'round'
    ctx.lineJoin = 'round'
    // ctx.shadowColor = 'rgba(0, 0, 0, 0.5)'
    // ctx.shadowBlur = 10
    // ctx.shadowOffsetX = 5
    // ctx.shadowOffsetY = 5
    for (let i = 0; i < this.points.length - 1; i++) {
      const existingPoint = this.points[i]
      const dx = newPoint.x - existingPoint.x
      const dy = newPoint.y - existingPoint.y
      const distance = Math.sqrt(dx * dx + dy * dy)
      if (!newPoint.visible) {
      } else {
        if (
          distance <= this.distanceThreshold &&
          Math.random() < this.connectionProbability / 100
        ) {
          this.drawSquigglyLine(ctx, existingPoint, newPoint)
        }
      }
    }
  }

  drawLinesBatch (lines, canvas) {
    const ctx = canvas.getContext('2d')

    ctx.beginPath()
    lines.forEach(line => {
      this.drawSquigglyLine(ctx, line.start, line.end)
    })
    ctx.stroke()
  }

  drawLine (point1, point2) {
    const ctx = document.getElementById('myCanvas').getContext('2d')
    ctx.strokeStyle = this.color
    ctx.lineWidth = 2
    ctx.beginPath()
    ctx.moveTo(point1.x, point1.y)
    ctx.lineTo(point2.x, point2.y)
    ctx.stroke()
  }

  getRGB (str) {
    var match = str.match(
      /rgba?\((\d{1,3}), ?(\d{1,3}), ?(\d{1,3})\)?(?:, ?(\d(?:\.\d*)?)\))?/
    )
    return `${match[1]}, ${match[2]}, ${match[3]}`
  }

  subtractMark (mark2) {
    // mark1: First closed loop, which will be modified
    // mark2: Second closed loop, which will subtract from the first

    const points1 = this.points.map(p => ({ x: p.x, y: p.y }))
    const points2 = mark2.points.map(p => ({ x: p.x, y: p.y }))

    // Step 1: Find all intersection points between the two polygons
    const intersections = this.findIntersections(points1, points2)

    // Step 2: Split the first polygon at intersection points
    const newPoints1 = this.splitPolygonAtIntersections(points1, intersections)

    // Step 3: Remove the part of the first polygon that is inside the second polygon
    const finalPoints = this.removeInsidePolygon(newPoints1, points2)

    // Step 4: Add points from the second polygon that are inside the first polygon
    const mergedPoints = this.addInsidePointsFromPolygon(
      finalPoints,
      points2,
      points1
    )

    // Update mark1's points with the result
    mark1.points = mergedPoints
  }

  // Function to find all intersection points between two polygons
  findIntersections (points1, points2) {
    const intersections = []

    for (let i = 0; i < points1.length; i++) {
      const p1Start = points1[i]
      const p1End = points1[(i + 1) % points1.length]

      for (let j = 0; j < points2.length; j++) {
        const p2Start = points2[j]
        const p2End = points2[(j + 1) % points2.length]

        const intersection = this.getLineIntersection(
          p1Start,
          p1End,
          p2Start,
          p2End
        )
        if (intersection) {
          intersections.push(intersection)
        }
      }
    }

    return intersections
  }

  // Function to get the intersection point of two line segments
  getLineIntersection (p1Start, p1End, p2Start, p2End) {
    const denominator =
      (p1End.x - p1Start.x) * (p2End.y - p2Start.y) -
      (p1End.y - p1Start.y) * (p2End.x - p2Start.x)
    if (denominator === 0) return null

    const t =
      ((p2Start.x - p1Start.x) * (p2End.y - p2Start.y) -
        (p2Start.y - p1Start.y) * (p2End.x - p2Start.x)) /
      denominator
    const u =
      ((p2Start.x - p1Start.x) * (p1End.y - p1Start.y) -
        (p2Start.y - p1Start.y) * (p1End.x - p1Start.x)) /
      denominator

    if (t >= 0 && t <= 1 && u >= 0 && u <= 1) {
      return {
        x: p1Start.x + t * (p1End.x - p1Start.x),
        y: p1Start.y + t * (p1End.y - p1Start.y)
      }
    }

    return null
  }

  // Function to split the first polygon at intersection points
  splitPolygonAtIntersections (points1, intersections) {
    // Insert intersection points into points1 in correct order
    let splitPoints = []
    let inserted = false

    for (let i = 0; i < points1.length; i++) {
      splitPoints.push(points1[i])
      intersections.forEach(intersect => {
        if (
          this.isPointOnLineSegment(
            intersect,
            points1[i],
            points1[(i + 1) % points1.length]
          )
        ) {
          splitPoints.push(intersect)
          inserted = true
        }
      })
    }

    return splitPoints
  }

  // Function to check if a point lies on a line segment
  isPointOnLineSegment (p, start, end) {
    const crossProduct =
      (p.y - start.y) * (end.x - start.x) - (p.x - start.x) * (end.y - start.y)
    if (Math.abs(crossProduct) > Number.EPSILON) return false

    const dotProduct =
      (p.x - start.x) * (end.x - start.x) + (p.y - start.y) * (end.y - start.y)
    if (dotProduct < 0) return false

    const squaredLength =
      (end.x - start.x) * (end.x - start.x) +
      (end.y - start.y) * (end.y - start.y)
    if (dotProduct > squaredLength) return false

    return true
  }

  // Function to remove part of the polygon that is inside another polygon
  removeInsidePolygon (points1, points2) {
    return points1.filter(
      point => !this.isPointInPolygon(point.x, point.y, points2)
    )
  }

  // Function to add points from second polygon that are inside the first polygon
  addInsidePointsFromPolygon (finalPoints, points2, points1) {
    return [
      ...finalPoints,
      ...points2.filter(p => this.isPointInPolygon(p.x, p.y, points1))
    ]
  }

  drawSquigglyLine (ctx, point1, point2) {
    const pressure = this.markWidth
    const step = Math.max(
      1,
      Math.min(
        Math.random() * 5,
        Math.hypot(point2.x - point1.x, point2.y - point1.y)
      )
    )

    let lastx = point1.x,
      lasty = point1.y

    ctx.lineWidth = this.hatchAngle // Thinner line width for squiggle effect

    for (let i = 0; i <= step; i++) {
      const t = i / step
      const x =
        point1.x +
        (point2.x - point1.x) * t +
        (Math.random() * 2 - 1) * pressure
      const y =
        point1.y +
        (point2.y - point1.y) * t +
        (Math.random() * 2 - 1) * pressure

      try {
        ctx.strokeStyle = `rgba(${this.getRGB(this.color)}, ${
          i === 0 || i === step ? 0.03 : 0.25
        })`
        // console.log(ctx.strokeStyle)
      } catch (error) {
        ctx.strokeStyle = `rgba(255,0,0, ${
          i === 0 || i === step ? 0.03 : 0.25
        })`
      }

      ctx.beginPath()
      ctx.moveTo(lastx, lasty)
      ctx.lineTo(x, y)
      ctx.stroke()

      lastx = x
      lasty = y
    }
  }

  render (alpha = 1, transition = false) {
    const canvas = document.getElementById('myCanvas')
    const ctx = canvas.getContext('2d')
    ctx.globalAlpha = this.alpha
    // console.log('rendering')
    if (this.filled) {
      if (!transition) {
        this.drawFilledMark()
      }
      if (this.trace || transition) {
        for (let i = 1; i < this.points.length; i++) {
          this.connectNewPoint(this.points[i])
        }
      }
    } else {
      for (let i = 1; i < this.points.length; i++) {
        this.connectNewPoint(this.points[i])
      }
    }

    ctx.globalAlpha = 1
  }

  drawFilledMark () {
    const canvas = document.getElementById('myCanvas')
    const ctx = canvas.getContext('2d')

    const markWidth = this.markWidth // Use markWidth from the mark
    var stepVal = markWidth
    let hatchAngle = Math.random() * 360 // Use random hatchAngle for each mark
    ctx.strokeStyle = this.color
    ctx.lineWidth = 0.3

    // try {
    //   this.points = this.points.filter(
    //     item =>
    //       item.hasOwnProperty('visible') &&
    //       !(item.x === this.gradient.x && item.y === this.gradient.y)
    //   )
    // } catch (error) {
    //   // console.log(error)
    // }

    const points = this.points.map(p => ({ x: p.x, y: p.y }))
    const minX = Math.min(...points.map(p => p.x))
    const maxX = Math.max(...points.map(p => p.x))
    const minY = Math.min(...points.map(p => p.y))
    const maxY = Math.max(...points.map(p => p.y))

    // Clip to the polygon

    this.clipToPolygon(ctx, points)

    if (this.gradient == null) {
      this.gradient = points[0]
    }

    const farthest = this.farthestDistance(
      this.gradient,
      this.points
    ).maxDistance

    // Draw hatch lines inside the clipped area
    for (let y = minY; y <= maxY; y += stepVal) {
      for (let x = minX; x <= maxX; x += stepVal) {
        if (this.isPointInPolygon(x, y, points)) {
          hatchAngle = Math.random() * 360
          const val = this.distanceBetweenPoints(
            this.gradient.x,
            this.gradient.y,
            x,
            y
          )
          ctx.lineWidth = 0.5
          ctx.lineWidth = this.mapValue(val, 0, farthest * 1.1, 0.6, 0.0)
          // // console.log(ctx.lineWidth, val)

          if (val < farthest * 0.9 && ctx.lineWidth >= 0.2) {
            if (ctx.lineWidth < 0.3) {
              const test = Math.random() * 50
              if (test > 10) {
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
          stepVal = parseInt(this.mapValue(val, 0, farthest * 1.02, 2, 5))
        }
      }
    }

    // Restore context to remove clipping
    ctx.restore()
  }

  distanceBetweenPoints (x1, y1, x2, y2) {
    return Math.sqrt(Math.pow(x2 - x1, 2) + Math.pow(y2 - y1, 2))
  }

  farthestDistance (point, points) {
    let maxDistance = 0
    let farthestPoint = null

    points.forEach(p => {
      const distance = Math.sqrt(
        Math.pow(p.x - point.x, 2) + Math.pow(p.y - point.y, 2)
      )
      if (distance > maxDistance) {
        maxDistance = distance
        farthestPoint = p
      }
    })

    return { maxDistance, farthestPoint }
  }

  mapValue (
    val,
    startRangeBegin,
    startRangeFinish,
    endRangeBegin,
    endRangeFinish
  ) {
    // Calculate the proportion of the value in the start range
    const proportion =
      (val - startRangeBegin) / (startRangeFinish - startRangeBegin)

    // Map the proportion to the end range
    var answer = endRangeBegin + proportion * (endRangeFinish - endRangeBegin)
    answer = answer.toFixed(2)
    if (answer < 0.0) {
      answer = 0.0
    }
    return answer
  }

  // Function to clip the drawing area to the polygon
  clipToPolygon (ctx, points) {
    ctx.save() // Save the current state
    ctx.beginPath()
    ctx.moveTo(points[0].x, points[0].y)
    for (let i = 1; i < points.length; i++) {
      ctx.lineTo(points[i].x, points[i].y)
    }
    ctx.closePath()
    ctx.clip() // Clip the drawing area to the polygon
  }

  // No change to the drawHatchLine function
  drawHatchLine (ctx, x, y, angle) {
    const length = 10 // Length of each hatch line
    const radians = (Math.PI / 180) * angle // Convert angle to radians
    ctx.beginPath()
    ctx.moveTo(x, y)
    ctx.lineTo(x + Math.cos(radians) * length, y + Math.sin(radians) * length)
    ctx.stroke()
  }

  // No change to the isPointInPolygon function
  isPointInPolygon (x, y, points) {
    let inside = false
    for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
      const xi = points[i].x,
        yi = points[i].y
      const xj = points[j].x,
        yj = points[j].y
      const intersect =
        yi > y != yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi
      if (intersect) inside = !inside
    }
    return inside
  }

  //   fillPolygon () {
  //     const canvas = document.getElementById('myCanvas')
  //     const ctx = canvas.getContext('2d')
  //     const gap = 2 // Gap between hatch marks
  //     const angle = (Math.random() * 360 * Math.PI) / 180 // Convert angle to radians
  //     ctx.strokeStyle = this.color
  //     ctx.lineWidth = 0.3 // Thin line for hatch marks
  // console.log(angle)
  //     // Function to check if a point is inside the polygon
  //     function isPointInPolygon (x, y, points) {
  //       let inside = false
  //       for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
  //         const xi = points[i].x,
  //           yi = points[i].y
  //         const xj = points[j].x,
  //           yj = points[j].y
  //         const intersect =
  //           yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi
  //         if (intersect) inside = !inside
  //       }
  //       return inside
  //     }

  //     // Draw hatch marks within the polygon
  //     for (let y = -gap / 2; y < canvas.height; y += gap) {
  //       for (let x = -gap / 2; x < canvas.width; x += gap) {
  //         const offsetX = x + Math.random() * (gap / 2)
  //         const offsetY = y + Math.random() * (gap / 2)
  //         console.log(offsetX, offsetY)
  //         if (isPointInPolygon(offsetX, offsetY, this.points)) {
  //           ctx.beginPath()
  //           ctx.moveTo(offsetX, offsetY)
  //           ctx.lineTo(
  //             offsetX + Math.cos(angle) * gap,
  //             offsetY + Math.sin(angle) * gap
  //           )
  //           ctx.stroke()
  //         }
  //       }
  //     }
  //   }

  toJSON () {
    return {
      color: this.color,
      minDistance: this.minDistance,
      distanceThreshold: this.distanceThreshold,
      connectionProbability: this.connectionProbability,
      filled: this.filled,
      points: this.points,
      markWidth: this.markWidth, // Include markWidth in JSON
      hatchAngle: this.hatchAngle, // Include hatchAngle in JSON
      alpha: this.alpha,
      trace: this.trace,
      gradient: this.gradient
    }
  }

  static fromJSON (data) {
    const mark = new Mark(
      data.color,
      data.minDistance,
      data.distanceThreshold,
      data.connectionProbability,
      data.filled,
      data.markWidth, // Load markWidth from JSON
      data.hatchAngle, // Load hatchAngle from JSON
      data.alpha,
      data.trace,
      data.gradient
    )

    mark.points = data.points.map(point => ({
      x: Math.floor(point.x),
      y: Math.floor(point.y),
      visible: point.visible
    }))
    mark.points.forEach(point => {
      try {
        if (point.visible == null) {
          point.visible = true
        }
      } catch (error) {}
    })
    // console.log(mark.points)
    return mark
  }

  hexToRgb (color) {
    // Map of color names to hex values
    // console.log(color)
    const colorHexMap = {
      black: '#000000',
      white: '#FFFFFF',
      red: '#FF0000',
      green: '#008000',
      blue: '#0000FF'
    }

    // Convert named color to hex if necessary
    const hex = color.startsWith('#')
      ? color
      : colorHexMap[color.toLowerCase()] || '#000000'

    // Convert hex to RGB
    let bigint = parseInt(hex.slice(1), 16)
    let r = (bigint >> 16) & 255
    let g = (bigint >> 8) & 255
    let b = bigint & 255
    return `${r}, ${g}, ${b}`
  }
}
