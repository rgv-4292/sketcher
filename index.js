import { Mark } from './mark.js'
import { Page } from './page.js'

var totalPoints = 0
let lastFilledMark = -1


document.addEventListener('DOMContentLoaded', function () {
  const canvas = document.getElementById('myCanvas')
  const ctx = canvas.getContext('2d')
  const fillColor = '#f0ebe8'
  ctx.fillStyle = fillColor
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  let drawing = false
  let controlsVisible = false
  let currentMark = null

  let drawFilledMarks = false
  let scatter = parseInt(document.getElementById('scatter').value)
  const checkbox = document.getElementById('filledMarkToggle')
  checkbox.checked = drawFilledMarks
  let doTrace = false
  // Initialize Page
  let page = new Page('myCanvas')

  // Initial control values
  let currentColor = 'rgba(0,0,0,0.75)'
  let minDistance = parseInt(document.getElementById('minDistance').value)
  let distanceThreshold = parseInt(
    document.getElementById('distanceThreshold').value
  )
  let connectionProbability = parseInt(
    document.getElementById('connectionProbability').value
  )
  let markWidth = 2
  let hatchAngle = 0.7

  // Listeners for new sliders, textbox, and checkboxes
  const slider1 = document.getElementById('slider1')
  const slider2 = document.getElementById('slider2')
  const slider3 = document.getElementById('slider3')
  const nameInput = document.getElementById('nameInput')
  const checkbox1 = document.getElementById('checkbox1')
  checkbox1.checked = drawFilledMarks
  const checkbox2 = document.getElementById('checkbox2')

  // Event listener for sliders
  slider1.addEventListener('input', function (event) {
    console.log('Slider 1 value:', event.target.value)
    Page.stepCount = event.target.value
  })

  slider2.addEventListener('input', function (event) {
    console.log('Slider 2 value:', event.target.value)
  })

  slider3.addEventListener('input', function (event) {
    console.log('Slider 3 value:', event.target.value)
  })

  // Event listener for text input
  nameInput.addEventListener('input', function (event) {
    console.log('Name input:', event.target.value)
  })

  // Event listener for checkboxes
  checkbox1.addEventListener('change', function (event) {
    console.log('Checkbox 1 checked:', event.target.checked)
    doTrace = event.target.checked
  })

  checkbox2.addEventListener('change', function (event) {
    console.log('Checkbox 2 checked:', event.target.checked)
    doTrace = event.target.checked
  })

  canvas.addEventListener('pointerdown', startDrawing)
  canvas.addEventListener('pointermove', draw)
  canvas.addEventListener('pointerup', stopDrawing)

  function startDrawing (event) {
    event.preventDefault()
    if (controlsVisible) return
    if (checkbox2.checked) {
      if (lastFilledMark >= 0) {
        console.log("lastFilledMark",lastFilledMark)
        page.marks[lastFilledMark].gradient['x'] = event.offsetX
        page.marks[lastFilledMark].gradient['y'] = event.offsetY
        // console.log(page.marks[lastFilledMark].gradient)

        console.log(page.marks[lastFilledMark].gradient)
        checkbox2.checked = false
        page.render()
        return
      }
    } else {
      drawing = true
      currentMark = new Mark(
        currentColor,
        minDistance,
        distanceThreshold,
        connectionProbability,
        drawFilledMarks,
        markWidth,
        hatchAngle,
        0.75,
        doTrace,
        null
      )

      // console.log(doTrace)
      currentMark.addPoint(event.offsetX, event.offsetY)
    }
  }

  function draw (event) {
    // console.log("A")
    event.preventDefault()
    if (!drawing || controlsVisible || checkbox2.checked) return
    const lastPoint = currentMark.points[currentMark.points.length - 1]
    const dx = event.offsetX - lastPoint.x
    const dy = event.offsetY - lastPoint.y
    // console.log("B")
    if (Math.sqrt(dx * dx + dy * dy) > minDistance + scatter) {
      // console.log("C")
      currentMark.addPoint(event.offsetX, event.offsetY)
      currentMark.addPoint(
        event.offsetX + Math.ceil(Math.random() * 4 - 2),
        event.offsetY + Math.ceil(Math.random() * 4 - 2)
      )
    }
  }

  function stopDrawing () {
    if (drawing) {
      if (currentMark.points.length > 4) {
        page.addMark(currentMark)
        console.log(currentMark.filled, page.marks.length - 1)
        if (currentMark.filled) {
          lastFilledMark = page.marks.length - 1
        }
        currentMark = null
        drawing = false
        page.render()
      } else {
        currentMark = null
        drawing = false
        page.render()
      }
    }
  }

  document
    .getElementById('colorButton')
    .addEventListener('pointerdown', function () {
      currentColor =
        currentColor === 'rgba(0,0,0,0.75)'
          ? 'rgba(255,255,255,0.75)'
          : 'rgba(0,0,0,0.75)'
    })

  // Toggle Controls button fix
  document
    .getElementById('controlButton')
    .addEventListener('pointerdown', function () {
      controlsVisible = !controlsVisible
      const controls = document.getElementById('controls')
      controls.style.display = controlsVisible ? 'block' : 'none'
      canvas.style.display = controlsVisible ? 'none' : 'block'
    })

  document
    .getElementById('minDistance')
    .addEventListener('input', function (event) {
      minDistance = parseInt(event.target.value)
    })

  document
    .getElementById('distanceThreshold')
    .addEventListener('input', function (event) {
      distanceThreshold = parseInt(event.target.value)
    })

  document
    .getElementById('connectionProbability')
    .addEventListener('input', function (event) {
      connectionProbability = parseInt(event.target.value)
    })

  document
    .getElementById('markWidth')
    .addEventListener('input', function (event) {
      markWidth = parseFloat(event.target.value)
    })

  document
    .getElementById('hatchAngle')
    .addEventListener('input', function (event) {
      hatchAngle = parseFloat(event.target.value)
    })

  document
    .getElementById('scatter')
    .addEventListener('input', function (event) {
      scatter = parseInt(event.target.value)
    })

  document
    .getElementById('filledMarkToggle')
    .addEventListener('change', function (event) {
      drawFilledMarks = event.target.checked
    })

  document
    .getElementById('deleteButton')
    .addEventListener('pointerdown', function () {
      page.removeLastMark()
      page.render()
    })

  document
    .getElementById('downloadButton')
    .addEventListener('pointerdown', async function () {
      const json = page.toJSON()
      if (page.marks.length > 0) {
        if (event.button === 2) {
          const blob = new Blob([JSON.stringify(json, null, 2)], {
            type: 'application/json'
          })
          const url = URL.createObjectURL(blob)
          const a = document.createElement('a')
          a.href = url
          a.download = 'page.json'
          a.click()
          URL.revokeObjectURL(url)
        } else {
          console.log(json)
          // Step 1: Send JSON to Netlify serverless function to commit it to GitHub
          const response = await fetch('/.netlify/functions/postToGitHub', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              content: JSON.stringify(json, null, 2)
            })
          })

          const result = await response.json()

          if (response.ok) {
            console.log(result.success)
            page.marks = []
            page.render()
          } else {
            console.error('Error committing file to GitHub:', result.error)
          }
        }
      } else {
        console.log('Nothing to export')
      }
    })

  document
    .getElementById('loadButton')
    .addEventListener('pointerdown', function () {
      const input = document.createElement('input')
      input.type = 'file'
      input.accept = 'application/json, image/svg+xml'
      input.onchange = function (event) {
        const file = event.target.files[0]
        const reader = new FileReader()

        reader.onload = function (e) {
          const content = e.target.result

          if (file.type === 'image/svg+xml') {
            try {
              // console.log('SVG selected',content)
              var jsonContent = page.svgToJson(content)
              // console.log(jsonContent)
              page.loadFromJSON(jsonContent)
              for (var i = 0; i < page.marks.length; i++) {
                if (page.marks[i].filled) {
                  lastFilledMark = i
                }
              }
              console.log('lastFilledMark', lastFilledMark)
            } catch (error) {
              console.error('Error converting SVG to JSON:', error)
            }
          } else if (file.type === 'application/json') {
            try {
              page.loadFromJSON(content)
              for (var i = 0; i < page.marks.length; i++) {
                if (page.marks[i].filled) {
                  lastFilledMark = i
                }
              }
              console.log('lastFilledMark', lastFilledMark)
            } catch (error) {
              console.error('Error loading JSON:', error)
            }
          } else {
            console.error('Unsupported file type')
          }
        }

        reader.readAsText(file)
      }

      input.click()
    })
})

//   document.getElementById('downloadButton').addEventListener('click', function () {
//       const json = page.toJSON();
//       const blob = new Blob([JSON.stringify(json, null, 2)], {
//           type: 'application/json'
//       });
//       const url = URL.createObjectURL(blob);
//       const a = document.createElement('a');
//       a.href = url;
//       a.download = 'page.json';
//       a.click();
//       URL.revokeObjectURL(url);
//   });
