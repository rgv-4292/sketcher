import { Mark } from './mark.js'
let stepCount = 12


export class Page {
  constructor (canvasId) {
    this.canvasId = canvasId
    this.marks = []
    this.canvasParams = {
      width: 480,
      height: 640,
      backgroundColor: '#f0ebe8' //'#084e47'  '#000000'
    }
    this.tempMarks = []
    this.transitioning = false
    this.stepCount = stepCount
  }

  addMark (mark) {
    // console.log('2')
    this.marks.push(mark)
  }

  addTempMark (mark) {
    // console.log('2')
    this.tempMarks.push(mark)
  }

  removeLastMark () {
    this.marks.pop()
  }

  clearCanvas () {
    const canvas = document.getElementById(this.canvasId)
    const ctx = canvas.getContext('2d')
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    ctx.fillStyle = this.canvasParams.backgroundColor
    ctx.fillRect(0, 0, canvas.width, canvas.height)
  }

  shuffle (array) {
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

  render (trans = false) {
    this.clearCanvas()

    this.marks.forEach(mark => {
      // console.log('mark.filled', mark.filled);
      try {
        if (mark.filled) {
          // console.log('mark.filled', mark.filled)
          // this.drawFilledMark(mark)
          mark.render(this.alpha, trans)
        } else {
          mark.render(this.alpha, trans)
        }
      } catch (error) {
        console.log(error)
      }
    })
    this.tempMarks.forEach(mark => {
      // console.log('mark.filled', mark.filled);
      try {
        if (mark.filled) {
          // console.log('mark.filled', mark.filled)
          // this.drawFilledMark(mark)
          mark.render(this.alpha, trans)
        } else {
          mark.render(this.alpha, trans)
        }
      } catch (error) {
        console.log(error)
      }
    })
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

  toJSON () {
    return {
      canvasParams: this.canvasParams,
      marks: this.marks.map(mark => mark.toJSON())
    }
  }

  loadFromJSON (json_file) {
    // console.log('loading', json_file)
    try {
      const data =
        typeof json_file === 'object' ? json_file : JSON.parse(json_file)

      this.canvasParams = data.canvasParams
      // console.log(this.canvasParams)
      this.marks = data.marks.map(markData => Mark.fromJSON(markData))

      this.render()
    } catch (error) {
      console.error('Error loading JSON:', error)
    }
  }

  svgToJson (svgString) {
    // console.log('Start')
    noise.seed(Math.random())
    // Parse SVG string to DOM element
    const parser = new DOMParser()
    const svgDOM = parser.parseFromString(
      svgString,
      'image/svg+xml'
    ).documentElement

    // Initialize svg.js with the parsed SVG
    const draw = SVG().addTo('body').size('400', '700').svg(svgDOM.outerHTML)

    // console.log('SVG loaded:', draw)

    const backgroundColor = this.backgroundColor // Set a default background color
    const canvasParams = {
      width: parseFloat(draw.attr('width')),
      height: parseFloat(draw.attr('height')),
      backgroundColor: backgroundColor
    }

    const marks = []

    draw.find('path').each(function (element) {
      // console.log('Processing path:', element)

      const path = element
      const pathData = path.attr('d')
      const pathStyle = path.attr('style')

      // Calculate total length of the path
      const length = path.length()
      const points = []
      // var dist = Math.max(Math.max(Math.random() * 9, 5), 2.5)
      const dist = 2
      // console.log(dist)
      // Extract points from the path data
      for (let i = 0; i <= length; i += dist) {
        const point = path.pointAt(i)
        var value = noise.simplex2(point.x / 50, point.y / 50)
        // console.log(value)
        points.push({
          x: parseInt(point.x + value * 2),
          y: parseInt(point.y + value * 2),
          visible: true
        })
        // dist = Math.max(Math.min(Math.random() * 3, 3), 1)
        // console.log(dist)
      }

      // var value = path.attr('stroke')
      var attributes = path.attr('style')
      const styleDict = styleStringToDict(attributes)
      console.log(styleDict)
      var myColor = hexToRgba(styleDict['stroke'], 0.75)
      try {
        var myWidth = styleDict['stroke-width']
        var mySat = Math.max(0.7, Math.max(myWidth / 4, 2.7))
      } catch (error) {
        var myWidth = 1.0
        var mySat = 0.7
      }

      // console.log(myWidth)

      // color: this.namedColorToRgba(myColor) || 'rgba(0,0,0,1.00)', // Get color from path if available
      const mark = {
        color: myColor, //'rgba(0,0,0,1.00)', // Get color from path if available
        minDistance: 3,
        distanceThreshold: 8,
        connectionProbability: 75,
        filled: false,
        points: points,
        markWidth: myWidth,
        hatchAngle: mySat,
        alpha: 0.75
      }

      marks.push(mark)
    })
    draw.clear()
    return {
      canvasParams: canvasParams,
      marks: marks
    }
  }

  namedColorToRgba (color) {
    // console.log(color)
    const colors = {
      black: 'rgba(0, 0, 0, 1)',
      white: 'rgba(255, 255, 255, 1)',
      red: 'rgba(255, 0, 0, 1)',
      green: 'rgba(0, 255, 0, 1)',
      blue: 'rgba(0, 0, 255, 1)'
      // Add more named colors as needed
    }
    return colors[color.toLowerCase()] || 'rgba(0, 0, 0, 1)' // Default to black
  }

  getPointIndex (marksData, pointIndex) {
    let cumulativePoints = 0

    for (let markIndex = 0; markIndex < marksData.length; markIndex++) {
      // console.log(markIndex, 'need point', pointIndex)
      const mark = marksData[markIndex]
      const numPoints = mark.points.length
      // console.log(numPoints)
      // Check if the pointIndex falls within the current mark's points
      if (pointIndex < cumulativePoints + numPoints) {
        // console.log('Full')
        const pointWithinMarkIndex = pointIndex - cumulativePoints
        return {
          markIndex: markIndex,
          pointIndex: pointWithinMarkIndex
        }
      }

      cumulativePoints += numPoints // Increment the cumulative points
      // console.log('cumulativePoints',cumulativePoints)
    }

    // Return null if the pointIndex is out of bounds
    return null
  }

  // Helper function to interpolate color with fallback for missing colors
  interpolateColor (color1, color2, t) {
    const parseColor = color => {
      const match = color.match(
        /rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*(\d+\.?\d*))?\)/
      )
      if (match) {
        const [, r, g, b, a] = match.map(Number)
        return [r, g, b, a !== undefined ? a : 1] // Default alpha to 1 if not present
      }
      return [0, 0, 0, 1] // Fallback to black with full opacity
    }

    const [r1, g1, b1, a1] = parseColor(color1)
    const [r2, g2, b2, a2] = parseColor(color2)

    // Interpolate between the colors
    const r = Math.round(r1 + (r2 - r1) * t)
    const g = Math.round(g1 + (g2 - g1) * t)
    const b = Math.round(b1 + (b2 - b1) * t)
    const a = (a1 + (a2 - a1) * t).toFixed(2) // Alpha interpolated between 0 and 1

    return `rgba(${r},${g},${b},${a})`
  }

  startTransition (newJSON) {
    this.transitioning = true
    const newMarks = newJSON.marks.map(markData => Mark.fromJSON(markData))
    const currentMarks = this.marks.map(markData => Mark.fromJSON(markData))
    // console.log(currentMarks)
    this.shuffle(currentMarks)

    const flattenPoints = marks =>
      marks.reduce((acc, mark) => acc.concat(mark.points), [])

    // console.log(flattenPoints(newMarks))
    // console.log(flattenPoints(currentMarks))
    var current_mark_count = flattenPoints(currentMarks).length
    var mark_count = flattenPoints(newMarks).length
    var points_to_count = Math.max(current_mark_count, mark_count)
    var cnt = 0
    const transitionSteps = this.stepCount// Number of steps for the transition
    const stepInterval = 60 // Time between each step in milliseconds
    let step = 0

    // Helper function to calculate interpolation for points
    const interpolate = (p1, p2, t) => ({
      x: p1.x + (p2.x - p1.x) * t,
      y: p1.y + (p2.y - p1.y) * t
    })

    const interpolateLinear = (p1, p2, t) => ({
      value: p1 + (p2 - p1) * t
    })

    const performTransition = () => {
      if (step < transitionSteps) {
        // this.marks = currentMarks
        // console.log('step', step)
        const progress = (step + 1) / transitionSteps
        cnt = 0
        var trigger = true
        var addedMark = new Mark('', 0, 0, 0, 0, 0, 0, 0, false, null)
        this.tempMarks = []
        for (let pnt = 0; pnt < points_to_count; pnt++) {
          try {
            if (current_mark_count > 0) {
              var from_point = this.getPointIndex(this.marks, pnt)
              var to_point = this.getPointIndex(newMarks, pnt)
              if (!!from_point && !!to_point) {
                const oldPoint =
                  this.marks[from_point.markIndex].points[from_point.pointIndex]
                const newPoint =
                  newMarks[to_point.markIndex].points[to_point.pointIndex]
                Object.assign(
                  oldPoint,
                  interpolate(oldPoint, newPoint, progress)
                )

                try {
                  this.marks[from_point.markIndex].color =
                    this.interpolateColor(
                      this.marks[from_point.markIndex].color,
                      newMarks[to_point.markIndex].color,
                      progress
                    )
                  const oldMarkWidth =
                    this.marks[from_point.markIndex].markWidth
                  const newMarkWidth = newMarks[to_point.markIndex].markWidth
                  this.marks[from_point.markIndex].markWidth =
                    interpolateLinear(
                      oldMarkWidth,
                      newMarkWidth,
                      progress
                    ).value
                  // console.log(
                  //   oldMarkWidth,
                  //   newMarkWidth,
                  //   progress,
                  //   this.marks[from_point.markIndex].markWidth
                  // )
                  const oldHatchAngle =
                    this.marks[from_point.markIndex].hatchAngle
                  const newHatchAngle = newMarks[to_point.markIndex].hatchAngle
                  this.marks[from_point.markIndex].hatchAngle =
                    interpolateLinear(
                      oldHatchAngle,
                      newHatchAngle,
                      progress
                    ).value
                  // console.log(
                  //   oldHatchAngle,
                  //   newHatchAngle,
                  //   progress,
                  //   this.marks[from_point.markIndex].hatchAngle
                  // )
                } catch (error) {
                  console.log(error)
                }
              } else if (!!from_point && to_point == null) {
                // first json has more points
                // fade the whole mark
                // console.log('first json has more points')
                // this.marks[from_point.markIndex].alpha = Math.max(
                //   Math.min(1, 1 - progress * 2),
                //   0
                // )

                if (trigger) {
                  addedMark = new Mark(
                    this.marks[from_point.markIndex].color,
                    this.marks[from_point.markIndex].minDistance,
                    this.marks[from_point.markIndex].distanceThreshold,
                    this.marks[from_point.markIndex].connectionProbability,
                    this.marks[from_point.markIndex].filled,
                    this.marks[from_point.markIndex].markWidth, // Pass the current markWidth
                    this.marks[from_point.markIndex].hatchAngle, // Pass the current hatchAngle
                    0.75,
                    this.marks[from_point.markIndex].trace,
                    this.marks[from_point.markIndex].gradient
                  )

                  trigger = false
                }

                addedMark.addPoint(
                  this.marks[from_point.markIndex].points[from_point.pointIndex]
                    .x,
                  this.marks[from_point.markIndex].points[from_point.pointIndex]
                    .y,
                  false
                )

                this.marks[from_point.markIndex].points[
                  from_point.pointIndex
                ].visible = true

                addedMark.alpha = Math.max(Math.min(1, 1 - progress), 0)
                // console.log(addedMark.alpha)
              } else if (!!to_point) {
                // next json has more points
                // console.log('next json has more points')
                if (trigger) {
                  addedMark = new Mark(
                    newMarks[to_point.markIndex].color,
                    newMarks[to_point.markIndex].minDistance,
                    newMarks[to_point.markIndex].distanceThreshold,
                    newMarks[to_point.markIndex].connectionProbability,
                    newMarks[to_point.markIndex].filled,
                    newMarks[to_point.markIndex].markWidth, // Pass the current markWidth
                    newMarks[to_point.markIndex].hatchAngle, // Pass the current hatchAngle
                    newMarks[to_point.markIndex].alpha,
                    newMarks[to_point.markIndex].trace,
                    newMarks[to_point.markIndex].gradient
                  )

                  trigger = false
                }
                var to_point = this.getPointIndex(newMarks, pnt)
                addedMark.addPoint(
                  newMarks[to_point.markIndex].points[to_point.pointIndex].x,
                  newMarks[to_point.markIndex].points[to_point.pointIndex].y
                )
                addedMark.alpha = Math.max(Math.min(1, progress / 3), 0)
                // console.log(addedMark.alpha, progress)
              } else {
              }
            } else {
            }
          } catch (error) {
            console.log(error)
          }
        }
        this.addTempMark(addedMark)
        this.render()
        step += 1
        this.marks = currentMarks
        setTimeout(performTransition, stepInterval)
      } else {
        // Final render to ensure full transition is shown
        this.marks = newMarks
        this.tempMarks = []
        this.render()
      }
    }

    performTransition()
    this.transitioning = false
    this.render()
  }
}

function hexToRgba (hex, alpha = 0.75) {
  try {
    // Remove the '#' if it's there
    hex = hex.replace(/^#/, '')
    console.log(hex)
    // Parse the hex values depending on the length (3 or 6)
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

function styleStringToDict (styleString) {
  const styleDict = {}

  styleString.split(';').forEach(style => {
    if (style) {
      // Check if there's a valid key-value pair
      let [key, value] = style.split(':')
      key = key.trim() // Remove any extra spaces around the key
      value = value.trim() // Remove any extra spaces around the value
      styleDict[key] = value
    }
  })

  return styleDict
}

/*
 (c) 2017, Vladimir Agafonkin
 Simplify.js, a high-performance JS polyline simplification library
 mourner.github.io/simplify-js
*/

;(function () {
  'use strict'

  // to suit your point format, run search/replace for '.x' and '.y';
  // for 3D version, see 3d branch (configurability would draw significant performance overhead)

  // square distance between 2 points
  function getSqDist (p1, p2) {
    var dx = p1.x - p2.x,
      dy = p1.y - p2.y

    return dx * dx + dy * dy
  }

  // square distance from a point to a segment
  function getSqSegDist (p, p1, p2) {
    var x = p1.x,
      y = p1.y,
      dx = p2.x - x,
      dy = p2.y - y

    if (dx !== 0 || dy !== 0) {
      var t = ((p.x - x) * dx + (p.y - y) * dy) / (dx * dx + dy * dy)

      if (t > 1) {
        x = p2.x
        y = p2.y
      } else if (t > 0) {
        x += dx * t
        y += dy * t
      }
    }

    dx = p.x - x
    dy = p.y - y

    return dx * dx + dy * dy
  }
  // rest of the code doesn't care about point format

  // basic distance-based simplification
  function simplifyRadialDist (points, sqTolerance) {
    var prevPoint = points[0],
      newPoints = [prevPoint],
      point

    for (var i = 1, len = points.length; i < len; i++) {
      point = points[i]

      if (getSqDist(point, prevPoint) > sqTolerance) {
        newPoints.push(point)
        prevPoint = point
      }
    }

    if (prevPoint !== point) newPoints.push(point)

    return newPoints
  }

  function simplifyDPStep (points, first, last, sqTolerance, simplified) {
    var maxSqDist = sqTolerance,
      index

    for (var i = first + 1; i < last; i++) {
      var sqDist = getSqSegDist(points[i], points[first], points[last])

      if (sqDist > maxSqDist) {
        index = i
        maxSqDist = sqDist
      }
    }

    if (maxSqDist > sqTolerance) {
      if (index - first > 1)
        simplifyDPStep(points, first, index, sqTolerance, simplified)
      simplified.push(points[index])
      if (last - index > 1)
        simplifyDPStep(points, index, last, sqTolerance, simplified)
    }
  }

  // simplification using Ramer-Douglas-Peucker algorithm
  function simplifyDouglasPeucker (points, sqTolerance) {
    var last = points.length - 1

    var simplified = [points[0]]
    simplifyDPStep(points, 0, last, sqTolerance, simplified)
    simplified.push(points[last])

    return simplified
  }

  // both algorithms combined for awesome performance
  function simplify (points, tolerance, highestQuality) {
    if (points.length <= 2) return points

    var sqTolerance = tolerance !== undefined ? tolerance * tolerance : 1

    points = highestQuality ? points : simplifyRadialDist(points, sqTolerance)
    points = simplifyDouglasPeucker(points, sqTolerance)

    return points
  }

  // export as AMD module / Node module / browser or worker variable
  if (typeof define === 'function' && define.amd)
    define(function () {
      return simplify
    })
  else if (typeof module !== 'undefined') {
    module.exports = simplify
    module.exports.default = simplify
  } else if (typeof self !== 'undefined') self.simplify = simplify
  else window.simplify = simplify
})()
