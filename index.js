import { Mark } from './mark.js'
import { Page } from './page.js'

document.addEventListener('DOMContentLoaded', function () {
  const canvas = document.getElementById('myCanvas')
  const ctx = canvas.getContext('2d')

  let page = new Page('myCanvas')
  const fillColor = page.canvasParams.backgroundColor
  ctx.fillStyle = fillColor
  ctx.fillRect(0, 0, canvas.width, canvas.height)

  let drawing = false
  let controlsVisible = false
  let currentMark = null
  let lastFilledMark = -1

  // --- State ---
  let currentColor = 'rgba(0,0,0,0.75)'
  let currentBgColor = '#f0ebe8'
  let minDistance = parseFloat(document.getElementById('minDistance').value)
  let distanceThreshold = parseInt(document.getElementById('distanceThreshold').value)
  let connectionProbability = parseInt(document.getElementById('connectionProbability').value)
  let markWidth = parseFloat(document.getElementById('markWidth').value)
  let hatchAngle = parseFloat(document.getElementById('hatchAngle').value)
  let scatter = parseInt(document.getElementById('scatter').value)
  let density = parseFloat(document.getElementById('density').value)
  let drawFilledMarks = false
  let doTrace = false
  // fillMode: 'none' | 'gradient' | 'solid'
  let fillMode = 'none'

  // --- Color indicator sync ---
  const colorIndicator = document.getElementById('colorIndicator')
  const bgColorIndicator = document.getElementById('bgColorIndicator')
  const bgColorSwatch = document.getElementById('bgColorSwatch')

  function syncColorIndicator () {
    colorIndicator.style.background = currentColor
  }
  syncColorIndicator()

  function syncBgIndicator () {
    bgColorIndicator.style.background = currentBgColor
    bgColorSwatch.style.background = currentBgColor
  }

  // --- Color Wheel Popup ---
  const colorPopup = document.getElementById('colorPopup')
  const colorPopupOverlay = document.getElementById('colorPopupOverlay')
  const colorWheelCanvas = document.getElementById('colorWheel')
  const colorWheelCtx = colorWheelCanvas.getContext('2d')
  const brightnessSlider = document.getElementById('colorWheelBrightness')
  const colorPreviewBox = document.getElementById('colorPreviewBox')
  const paletteRow = document.getElementById('paletteRow')
  const paletteSaveBtn = document.getElementById('paletteSaveBtn')
  const colorPopupClose = document.getElementById('colorPopupClose')

  let colorPopupTarget = 'mark' // 'mark' or 'bg'
  let currentWheelColor = { h: 0, s: 0, b: 85 }
  let palette = JSON.parse(localStorage.getItem('sketcher_palette') || '[]')

  function drawColorWheel (brightness) {
    const size = colorWheelCanvas.width
    const cx = size / 2, cy = size / 2, r = size / 2
    colorWheelCtx.clearRect(0, 0, size, size)
    const imageData = colorWheelCtx.createImageData(size, size)
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const dx = x - cx, dy = y - cy
        const dist = Math.sqrt(dx * dx + dy * dy)
        if (dist <= r) {
          const angle = Math.atan2(dy, dx) * 180 / Math.PI + 360
          const hue = angle % 360
          const sat = dist / r
          const rgb = hslToRgb(hue / 360, sat, brightness / 100 * 0.5 + 0.1)
          const idx = (y * size + x) * 4
          imageData.data[idx] = rgb[0]
          imageData.data[idx + 1] = rgb[1]
          imageData.data[idx + 2] = rgb[2]
          imageData.data[idx + 3] = 255
        }
      }
    }
    colorWheelCtx.putImageData(imageData, 0, 0)
  }

  function hslToRgb (h, s, l) {
    let r, g, b
    if (s === 0) {
      r = g = b = l
    } else {
      const hue2rgb = (p, q, t) => {
        if (t < 0) t += 1
        if (t > 1) t -= 1
        if (t < 1/6) return p + (q - p) * 6 * t
        if (t < 1/2) return q
        if (t < 2/3) return p + (q - p) * (2/3 - t) * 6
        return p
      }
      const q = l < 0.5 ? l * (1 + s) : l + s - l * s
      const p = 2 * l - q
      r = hue2rgb(p, q, h + 1/3)
      g = hue2rgb(p, q, h)
      b = hue2rgb(p, q, h - 1/3)
    }
    return [Math.round(r * 255), Math.round(g * 255), Math.round(b * 255)]
  }

  function getColorFromWheel (x, y) {
    const size = colorWheelCanvas.width
    const cx = size / 2, cy = size / 2, r = size / 2
    const dx = x - cx, dy = y - cy
    const dist = Math.min(Math.sqrt(dx * dx + dy * dy), r)
    const angle = (Math.atan2(dy, dx) * 180 / Math.PI + 360) % 360
    const sat = dist / r
    const bri = parseInt(brightnessSlider.value)
    const l = bri / 100 * 0.5 + 0.1
    const rgb = hslToRgb(angle / 360, sat, l)
    return `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, 0.75)`
  }

  function updateColorPreview (color) {
    colorPreviewBox.style.background = color
    if (colorPopupTarget === 'mark') {
      currentColor = color
      syncColorIndicator()
    } else {
      currentBgColor = rgbaToHex(color)
      page.canvasParams.backgroundColor = currentBgColor
      syncBgIndicator()
      page.render()
    }
  }

  function rgbaToHex (rgba) {
    const match = rgba.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/)
    if (!match) return '#f0ebe8'
    const r = parseInt(match[1]).toString(16).padStart(2, '0')
    const g = parseInt(match[2]).toString(16).padStart(2, '0')
    const b = parseInt(match[3]).toString(16).padStart(2, '0')
    return `#${r}${g}${b}`
  }

  function renderPalette () {
    paletteRow.innerHTML = ''
    for (let i = 0; i < 8; i++) {
      const swatch = document.createElement('div')
      swatch.className = 'palette-swatch' + (palette[i] ? ' filled' : '')
      swatch.style.background = palette[i] || 'transparent'
      swatch.addEventListener('pointerdown', () => {
        if (palette[i]) {
          updateColorPreview(palette[i])
          colorPreviewBox.style.background = palette[i]
        }
      })
      paletteRow.appendChild(swatch)
    }
  }

  function openColorPopup (target) {
    colorPopupTarget = target
    document.getElementById('colorPopupTitle').textContent =
      target === 'mark' ? 'Mark Color' : 'Background Color'
    const initColor = target === 'mark' ? currentColor : currentBgColor
    colorPreviewBox.style.background = initColor
    drawColorWheel(parseInt(brightnessSlider.value))
    renderPalette()
    colorPopup.classList.add('visible')
    colorPopupOverlay.classList.add('visible')
  }

  colorIndicator.addEventListener('pointerdown', () => openColorPopup('mark'))
  bgColorSwatch.addEventListener('pointerdown', () => openColorPopup('bg'))

  colorWheelCanvas.addEventListener('pointerdown', (e) => {
    const rect = colorWheelCanvas.getBoundingClientRect()
    const scaleX = colorWheelCanvas.width / rect.width
    const scaleY = colorWheelCanvas.height / rect.height
    const x = (e.clientX - rect.left) * scaleX
    const y = (e.clientY - rect.top) * scaleY
    const color = getColorFromWheel(x, y)
    updateColorPreview(color)
  })

  colorWheelCanvas.addEventListener('pointermove', (e) => {
    if (e.buttons !== 1) return
    const rect = colorWheelCanvas.getBoundingClientRect()
    const scaleX = colorWheelCanvas.width / rect.width
    const scaleY = colorWheelCanvas.height / rect.height
    const x = (e.clientX - rect.left) * scaleX
    const y = (e.clientY - rect.top) * scaleY
    const color = getColorFromWheel(x, y)
    updateColorPreview(color)
  })

  brightnessSlider.addEventListener('input', () => {
    drawColorWheel(parseInt(brightnessSlider.value))
  })

  paletteSaveBtn.addEventListener('pointerdown', () => {
    const color = colorPopupTarget === 'mark' ? currentColor : currentBgColor
    if (palette.length >= 8) {
      palette.shift()
    }
    palette.push(color)
    localStorage.setItem('sketcher_palette', JSON.stringify(palette))
    renderPalette()
  })

  colorPopupClose.addEventListener('pointerdown', () => {
    colorPopup.classList.remove('visible')
    colorPopupOverlay.classList.remove('visible')
  })

  colorPopupOverlay.addEventListener('pointerdown', () => {
    colorPopup.classList.remove('visible')
    colorPopupOverlay.classList.remove('visible')
  })

  // --- Fill Mode ---
  const fillModeButtons = {
    none: document.getElementById('fillModeNone'),
    gradient: document.getElementById('fillModeGradient'),
    solid: document.getElementById('fillModeSolid')
  }
  const densityRow = document.getElementById('densityRow')

  function setFillMode (mode) {
    fillMode = mode
    Object.keys(fillModeButtons).forEach(k => {
      fillModeButtons[k].classList.toggle('active', k === mode)
    })
    densityRow.style.display = mode === 'solid' ? 'flex' : 'none'
  }

  fillModeButtons.none.addEventListener('pointerdown', () => setFillMode('none'))
  fillModeButtons.gradient.addEventListener('pointerdown', () => setFillMode('gradient'))
  fillModeButtons.solid.addEventListener('pointerdown', () => setFillMode('solid'))

  // --- Props controls ---
  document.getElementById('filledMarkToggle').addEventListener('change', (e) => {
    drawFilledMarks = e.target.checked
  })

  document.getElementById('checkbox1').addEventListener('change', (e) => {
    doTrace = e.target.checked
  })

  document.getElementById('minDistance').addEventListener('input', (e) => {
    minDistance = parseFloat(e.target.value)
  })

  document.getElementById('distanceThreshold').addEventListener('input', (e) => {
    distanceThreshold = parseInt(e.target.value)
  })

  document.getElementById('connectionProbability').addEventListener('input', (e) => {
    connectionProbability = parseInt(e.target.value)
  })

  document.getElementById('markWidth').addEventListener('input', (e) => {
    markWidth = parseFloat(e.target.value)
  })

  document.getElementById('hatchAngle').addEventListener('input', (e) => {
    hatchAngle = parseFloat(e.target.value)
  })

  document.getElementById('scatter').addEventListener('input', (e) => {
    scatter = parseInt(e.target.value)
  })

  document.getElementById('density').addEventListener('input', (e) => {
    density = parseFloat(e.target.value)
  })

  // --- Presets ---
  const PRESET_KEY = 'sketcher_presets'

  function getPresets () {
    return JSON.parse(localStorage.getItem(PRESET_KEY) || '[null,null,null]')
  }

  function savePresets (presets) {
    localStorage.setItem(PRESET_KEY, JSON.stringify(presets))
  }

  function getCurrentSettings () {
    return {
      name: '',
      currentColor,
      minDistance,
      distanceThreshold,
      connectionProbability,
      markWidth,
      hatchAngle,
      scatter,
      density,
      drawFilledMarks,
      doTrace,
      fillMode
    }
  }

  function applySettings (s) {
    currentColor = s.currentColor
    minDistance = s.minDistance
    distanceThreshold = s.distanceThreshold
    connectionProbability = s.connectionProbability
    markWidth = s.markWidth
    hatchAngle = s.hatchAngle
    scatter = s.scatter ?? 0
    density = s.density ?? 3
    drawFilledMarks = s.drawFilledMarks
    doTrace = s.doTrace
    fillMode = s.fillMode ?? 'none'

    // Sync UI
    document.getElementById('minDistance').value = minDistance
    document.getElementById('distanceThreshold').value = distanceThreshold
    document.getElementById('connectionProbability').value = connectionProbability
    document.getElementById('markWidth').value = markWidth
    document.getElementById('hatchAngle').value = hatchAngle
    document.getElementById('scatter').value = scatter
    document.getElementById('density').value = density
    document.getElementById('filledMarkToggle').checked = drawFilledMarks
    document.getElementById('checkbox1').checked = doTrace
    setFillMode(fillMode)
    syncColorIndicator()
  }

  function initPresetUI () {
    const presets = getPresets()
    for (let i = 0; i < 3; i++) {
      const nameInput = document.getElementById(`preset${i}name`)
      const loadBtn = document.getElementById(`preset${i}load`)
      if (presets[i]) {
        nameInput.value = presets[i].name || `Preset ${i + 1}`
        loadBtn.disabled = false
      }
    }
  }

  for (let i = 0; i < 3; i++) {
    document.getElementById(`preset${i}save`).addEventListener('pointerdown', () => {
      const presets = getPresets()
      const settings = getCurrentSettings()
      settings.name = document.getElementById(`preset${i}name`).value || `Preset ${i + 1}`
      presets[i] = settings
      savePresets(presets)
      document.getElementById(`preset${i}load`).disabled = false
    })

    document.getElementById(`preset${i}load`).addEventListener('pointerdown', () => {
      const presets = getPresets()
      if (presets[i]) {
        applySettings(presets[i])
        document.getElementById(`preset${i}name`).value = presets[i].name || `Preset ${i + 1}`
      }
    })
  }

  initPresetUI()

  // --- Canvas drawing ---
  canvas.addEventListener('pointerdown', startDrawing)
  canvas.addEventListener('pointermove', draw)
  canvas.addEventListener('pointerup', stopDrawing)

  function startDrawing (event) {
    event.preventDefault()
    if (controlsVisible) return

    // Set Gradient mode — only applies when fillMode is 'gradient'
    if (fillMode === 'gradient' && lastFilledMark >= 0) {
      page.marks[lastFilledMark].gradient = {
        x: event.offsetX,
        y: event.offsetY
      }
      page.render()
      return
    }

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
      null,
      fillMode,
      density
    )
    currentMark.addPoint(event.offsetX, event.offsetY)
  }

  function draw (event) {
    event.preventDefault()
    if (!drawing || controlsVisible) return
    const lastPoint = currentMark.points[currentMark.points.length - 1]
    const dx = event.offsetX - lastPoint.x
    const dy = event.offsetY - lastPoint.y
    const scatterAmount = scatter > 0 ? Math.random() * scatter : 0
    if (Math.sqrt(dx * dx + dy * dy) > minDistance + scatterAmount) {
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

  // --- Toolbar buttons ---
  document.getElementById('controlButton').addEventListener('pointerdown', () => {
    controlsVisible = !controlsVisible
    const controls = document.getElementById('controls')
    controls.style.display = controlsVisible ? 'block' : 'none'
    canvas.style.display = controlsVisible ? 'none' : 'block'
  })

  document.getElementById('deleteButton').addEventListener('pointerdown', () => {
    page.removeLastMark()
    page.render()
  })

  document.getElementById('downloadButton').addEventListener('pointerdown', async (event) => {
    const json = page.toJSON()
    if (page.marks.length > 0) {
      if (event.button === 2) {
        const blob = new Blob([JSON.stringify(json, null, 2)], { type: 'application/json' })
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = 'page.json'
        a.click()
        URL.revokeObjectURL(url)
      } else {
        const response = await fetch('/.netlify/functions/postToGitHub', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ content: JSON.stringify(json, null, 2) })
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

  document.getElementById('loadButton').addEventListener('pointerdown', () => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = 'application/json, image/svg+xml'
    input.onchange = (event) => {
      const file = event.target.files[0]
      const reader = new FileReader()
      reader.onload = (e) => {
        const content = e.target.result
        if (file.type === 'image/svg+xml') {
          try {
            const jsonContent = page.svgToJson(content)
            page.loadFromJSON(jsonContent)
            for (let i = 0; i < page.marks.length; i++) {
              if (page.marks[i].filled) lastFilledMark = i
            }
          } catch (error) {
            console.error('Error converting SVG to JSON:', error)
          }
        } else if (file.type === 'application/json') {
          try {
            page.loadFromJSON(content)
            for (let i = 0; i < page.marks.length; i++) {
              if (page.marks[i].filled) lastFilledMark = i
            }
            // Sync bg color from loaded page
            if (page.canvasParams.backgroundColor) {
              currentBgColor = page.canvasParams.backgroundColor
              syncBgIndicator()
            }
          } catch (error) {
            console.error('Error loading JSON:', error)
          }
        }
      }
      reader.readAsText(file)
    }
    input.click()
  })
})