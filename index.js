import { Mark } from './mark.js'
import { Page } from './page.js'

const THUMB_PREFIX = 'sketcher_thumb::'
const LIVE_SETTINGS_KEY = 'sketcher_live_settings'

document.addEventListener('DOMContentLoaded', function () {
  const canvas = document.getElementById('myCanvas')
  const ctx = canvas.getContext('2d')

  // --- Book state ---
  let activeBookName = localStorage.getItem('sketcher_active_book') || null
  let activeBookManifest = null
  let activePageId = null

  const pendingLoad = JSON.parse(localStorage.getItem('sketcher_load_page') || 'null')
  if (pendingLoad) {
    localStorage.removeItem('sketcher_load_page')
    activeBookName = pendingLoad.bookName
    activePageId = pendingLoad.pageId
    localStorage.setItem('sketcher_active_book', activeBookName)
  }

  let page = new Page('myCanvas')
  ctx.fillStyle = page.canvasParams.backgroundColor
  ctx.fillRect(0, 0, page.canvasParams.width, page.canvasParams.height)

  let drawing = false
  let sidebarVisible = true
  let currentMark = null
  let lastFilledMark = -1
  let unsavedChanges = false

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
  let doTrace = false
  let doMask = false
  let fillMode = 'none'

  // --- Sidebar toggle ---
  const sidebar = document.getElementById('sidebar')
  const controlButton = document.getElementById('controlButton')

  function setSidebar(visible) {
    sidebarVisible = visible
    sidebar.classList.toggle('collapsed', !visible)
    controlButton.classList.toggle('active', visible)
  }

  // Start with sidebar visible
  setSidebar(true)

  controlButton.addEventListener('pointerdown', () => setSidebar(!sidebarVisible))

  // --- Fill-mode-aware UI ---
  // Controls that only apply to filled modes
  const fillOnlyRows = [
    document.getElementById('traceRow'),
    document.getElementById('densityRow'),
  ]
  // The gradient checkbox (always visible, enabled only in gradient mode)
  const gradientCheckbox = document.getElementById('checkbox2')

  function updateFillModeUI() {
    const isFilled = fillMode !== 'none'
    const isGradient = fillMode === 'gradient'

    // Gradient point: always visible, enabled only when gradient
    gradientCheckbox.disabled = !isGradient
    document.getElementById('setGradientRow').classList.toggle('disabled', !isGradient)

    // Trace and density: only relevant when filled
    fillOnlyRows.forEach(row => {
      row.classList.toggle('disabled', !isFilled)
    })
  }

  // --- Color indicator sync ---
  const colorIndicator = document.getElementById('colorIndicator')
  const bgColorSwatch = document.getElementById('bgColorSwatch')

  function syncColorIndicator() {
    colorIndicator.style.background = currentColor
  }
  syncColorIndicator()

  function syncBgIndicator() {
    bgColorSwatch.style.background = currentBgColor
    page.canvasParams.backgroundColor = currentBgColor
    page.render()
  }
  syncBgIndicator()

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

  let colorPopupTarget = 'mark'
  let lastWheelX = null
  let lastWheelY = null
  let palette = JSON.parse(localStorage.getItem('sketcher_palette') || '[]')

  function drawColorWheel(brightness) {
    const size = colorWheelCanvas.width
    const cx = size / 2, cy = size / 2, r = size / 2
    colorWheelCtx.clearRect(0, 0, size, size)
    const imageData = colorWheelCtx.createImageData(size, size)
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const dx = x - cx, dy = y - cy
        const dist = Math.sqrt(dx * dx + dy * dy)
        if (dist <= r) {
          const angle = (Math.atan2(dy, dx) * 180 / Math.PI + 360) % 360
          const sat = dist / r
          const l = brightness / 100
          const rgb = hslToRgb(angle / 360, sat, l)
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

  function getColorFromWheel(x, y) {
    const size = colorWheelCanvas.width
    const cx = size / 2, cy = size / 2, r = size / 2
    const dx = x - cx, dy = y - cy
    const dist = Math.min(Math.sqrt(dx * dx + dy * dy), r)
    const angle = (Math.atan2(dy, dx) * 180 / Math.PI + 360) % 360
    const sat = dist / r
    const l = parseInt(brightnessSlider.value) / 100
    const rgb = hslToRgb(angle / 360, sat, l)
    return `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, 0.75)`
  }

  function hslToRgb(h, s, l) {
    let r, g, b
    if (s === 0) {
      r = g = b = l
    } else {
      const hue2rgb = (p, q, t) => {
        if (t < 0) t += 1
        if (t > 1) t -= 1
        if (t < 1 / 6) return p + (q - p) * 6 * t
        if (t < 1 / 2) return q
        if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6
        return p
      }
      const q = l < 0.5 ? l * (1 + s) : l + s - l * s
      const p = 2 * l - q
      r = hue2rgb(p, q, h + 1 / 3)
      g = hue2rgb(p, q, h)
      b = hue2rgb(p, q, h - 1 / 3)
    }
    return [Math.round(r * 255), Math.round(g * 255), Math.round(b * 255)]
  }

  function updateColorPreview(color) {
    colorPreviewBox.style.background = color
    if (colorPopupTarget === 'mark') {
      currentColor = color
      syncColorIndicator()
    } else {
      currentBgColor = rgbaToHex(color)
      syncBgIndicator()
    }
    saveLiveSettings()
  }

  function rgbaToHex(rgba) {
    const match = rgba.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/)
    if (!match) return '#f0ebe8'
    const r = parseInt(match[1]).toString(16).padStart(2, '0')
    const g = parseInt(match[2]).toString(16).padStart(2, '0')
    const b = parseInt(match[3]).toString(16).padStart(2, '0')
    return `#${r}${g}${b}`
  }

  function renderPalette() {
    paletteRow.innerHTML = ''
    for (let i = 0; i < 14; i++) {
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

  function openColorPopup(target) {
    colorPopupTarget = target
    document.getElementById('colorPopupTitle').textContent =
      target === 'mark' ? 'Mark Color' : 'Background Color'
    colorPreviewBox.style.background = target === 'mark' ? currentColor : currentBgColor
    drawColorWheel(parseInt(brightnessSlider.value))
    renderPalette()
    colorPopup.classList.add('visible')
    colorPopupOverlay.classList.add('visible')
  }

  colorIndicator.addEventListener('pointerdown', () => openColorPopup('mark'))
  bgColorSwatch.addEventListener('pointerdown', () => openColorPopup('bg'))

  colorWheelCanvas.addEventListener('pointerdown', (e) => {
    const rect = colorWheelCanvas.getBoundingClientRect()
    lastWheelX = (e.clientX - rect.left) * (colorWheelCanvas.width / rect.width)
    lastWheelY = (e.clientY - rect.top) * (colorWheelCanvas.height / rect.height)
    updateColorPreview(getColorFromWheel(lastWheelX, lastWheelY))
  })

  colorWheelCanvas.addEventListener('pointermove', (e) => {
    if (e.buttons !== 1) return
    const rect = colorWheelCanvas.getBoundingClientRect()
    lastWheelX = (e.clientX - rect.left) * (colorWheelCanvas.width / rect.width)
    lastWheelY = (e.clientY - rect.top) * (colorWheelCanvas.height / rect.height)
    updateColorPreview(getColorFromWheel(lastWheelX, lastWheelY))
  })

  brightnessSlider.addEventListener('input', () => {
    drawColorWheel(parseInt(brightnessSlider.value))
    if (lastWheelX !== null) updateColorPreview(getColorFromWheel(lastWheelX, lastWheelY))
  })

  paletteSaveBtn.addEventListener('pointerdown', () => {
    const color = colorPopupTarget === 'mark' ? currentColor : currentBgColor
    if (palette.length >= 14) palette.shift()
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

  function setFillMode(mode) {
    fillMode = mode
    Object.keys(fillModeButtons).forEach(k => {
      fillModeButtons[k].classList.toggle('active', k === mode)
    })
    updateFillModeUI()
  }

  fillModeButtons.none.addEventListener('pointerdown', () => { setFillMode('none'); saveLiveSettings() })
  fillModeButtons.gradient.addEventListener('pointerdown', () => { setFillMode('gradient'); saveLiveSettings() })
  fillModeButtons.solid.addEventListener('pointerdown', () => { setFillMode('solid'); saveLiveSettings() })

  // --- Props controls ---
  document.getElementById('checkbox1').addEventListener('change', (e) => { doTrace = e.target.checked; saveLiveSettings() })
  document.getElementById('checkboxMask').addEventListener('change', (e) => { doMask = e.target.checked; saveLiveSettings() })
  document.getElementById('checkbox2').addEventListener('change', () => {})
  document.getElementById('minDistance').addEventListener('input', (e) => { minDistance = parseFloat(e.target.value); saveLiveSettings() })
  document.getElementById('distanceThreshold').addEventListener('input', (e) => { distanceThreshold = parseInt(e.target.value); saveLiveSettings() })
  document.getElementById('connectionProbability').addEventListener('input', (e) => { connectionProbability = parseInt(e.target.value); saveLiveSettings() })
  document.getElementById('markWidth').addEventListener('input', (e) => { markWidth = parseFloat(e.target.value); saveLiveSettings() })
  document.getElementById('hatchAngle').addEventListener('input', (e) => { hatchAngle = parseFloat(e.target.value); saveLiveSettings() })
  document.getElementById('scatter').addEventListener('input', (e) => { scatter = parseInt(e.target.value); saveLiveSettings() })
  document.getElementById('density').addEventListener('input', (e) => { density = parseFloat(e.target.value); saveLiveSettings() })

  // --- Live settings persistence ---
  function getCurrentSettings() {
    return { currentColor, minDistance, distanceThreshold, connectionProbability, markWidth, hatchAngle, scatter, density, doTrace, doMask, fillMode }
  }

  function saveLiveSettings() {
    try { localStorage.setItem(LIVE_SETTINGS_KEY, JSON.stringify(getCurrentSettings())) } catch {}
  }

  function applySettings(s) {
    currentColor = s.currentColor ?? currentColor
    minDistance = s.minDistance ?? minDistance
    distanceThreshold = s.distanceThreshold ?? distanceThreshold
    connectionProbability = s.connectionProbability ?? connectionProbability
    markWidth = s.markWidth ?? markWidth
    hatchAngle = s.hatchAngle ?? hatchAngle
    scatter = s.scatter ?? 0
    density = s.density ?? 3
    doTrace = s.doTrace ?? false
    doMask = s.doMask ?? false
    fillMode = s.fillMode ?? 'none'

    document.getElementById('minDistance').value = minDistance
    document.getElementById('distanceThreshold').value = distanceThreshold
    document.getElementById('connectionProbability').value = connectionProbability
    document.getElementById('markWidth').value = markWidth
    document.getElementById('hatchAngle').value = hatchAngle
    document.getElementById('scatter').value = scatter
    document.getElementById('density').value = density
    document.getElementById('checkbox1').checked = doTrace
    document.getElementById('checkboxMask').checked = doMask
    setFillMode(fillMode)
    syncColorIndicator()
  }

  function restoreLiveSettings() {
    try {
      const saved = localStorage.getItem(LIVE_SETTINGS_KEY)
      if (saved) applySettings(JSON.parse(saved))
    } catch {}
  }

  // --- Presets ---
  const PRESET_KEY = 'sketcher_presets'
  const ACTIVE_PRESET_KEY = 'sketcher_active_preset'

  function getPresets() {
    try { return JSON.parse(localStorage.getItem(PRESET_KEY) || '[null,null,null,null,null,null,null,null,null,null]') }
    catch { return Array(10).fill(null) }
  }

  function initPresetUI() {
    const presets = getPresets()
    for (let i = 0; i < 10; i++) {
      if (presets[i]) {
        document.getElementById(`preset${i}name`).value = presets[i].name || `Preset ${i + 1}`
        document.getElementById(`preset${i}load`).disabled = false
      }
    }
  }

  for (let i = 0; i < 10; i++) {
    document.getElementById(`preset${i}save`).addEventListener('pointerdown', () => {
      const presets = getPresets()
      presets[i] = { ...getCurrentSettings(), name: document.getElementById(`preset${i}name`).value || `Preset ${i + 1}` }
      localStorage.setItem(PRESET_KEY, JSON.stringify(presets))
      document.getElementById(`preset${i}load`).disabled = false
    })
    document.getElementById(`preset${i}load`).addEventListener('pointerdown', () => {
      const presets = getPresets()
      if (presets[i]) {
        applySettings(presets[i])
        document.getElementById(`preset${i}name`).value = presets[i].name || `Preset ${i + 1}`
        localStorage.setItem(ACTIVE_PRESET_KEY, i)
        saveLiveSettings()
      }
    })
  }

  restoreLiveSettings()
  initPresetUI()

  // --- Pressure helpers ---
  function getEventPressure(event) {
    return event.pointerType === 'pen' ? event.pressure : null
  }

  // --- Canvas drawing ---
  canvas.addEventListener('pointerdown', startDrawing)
  canvas.addEventListener('pointermove', draw)
  canvas.addEventListener('pointerup', stopDrawing)
  canvas.addEventListener('pointercancel', stopDrawing)

  function startDrawing(event) {
    event.preventDefault()

    const setGradientCheckbox = document.getElementById('checkbox2')
    if (fillMode === 'gradient' && setGradientCheckbox.checked && lastFilledMark >= 0) {
      page.marks[lastFilledMark].gradient = { x: event.offsetX, y: event.offsetY }
      setGradientCheckbox.checked = false
      page.render()
      return
    }

    drawing = true
    currentMark = new Mark(
      currentColor, minDistance, distanceThreshold, connectionProbability,
      fillMode !== 'none', markWidth, hatchAngle, 0.75, doTrace, null, fillMode, density, doMask
    )
    currentMark.addPoint(event.offsetX, event.offsetY, getEventPressure(event))
  }

  function draw(event) {
    event.preventDefault()
    if (!drawing) return
    const lastPoint = currentMark.points[currentMark.points.length - 1]
    const dx = event.offsetX - lastPoint.x
    const dy = event.offsetY - lastPoint.y
    const scatterAmount = scatter > 0 ? Math.random() * scatter : 0
    if (Math.sqrt(dx * dx + dy * dy) > minDistance + scatterAmount) {
      const pressure = getEventPressure(event)
      currentMark.addPoint(event.offsetX, event.offsetY, pressure)
      currentMark.addPoint(
        event.offsetX + Math.ceil(Math.random() * 4 - 2),
        event.offsetY + Math.ceil(Math.random() * 4 - 2),
        pressure
      )
    }
  }

  function stopDrawing() {
    if (!drawing) return
    if (currentMark.points.length > 4) {
      page.addMark(currentMark)
      if (currentMark.filled) lastFilledMark = page.marks.length - 1
      unsavedChanges = true
    }
    currentMark = null
    drawing = false
    page.render()
  }

  // --- Book loading ---
  async function loadActiveBook() {
    if (!activeBookName) {
      const go = confirm('No active book. Open manager to create or select one?')
      if (go) window.location.href = 'manager.html'
      else canvas.style.display = 'block'
      return
    }
    try {
      const res = await fetch('/.netlify/functions/github', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ operation: 'getManifest', bookName: activeBookName })
      })
      const data = await res.json()
      activeBookManifest = data.manifest
      updateBookIndicator()

      canvas.width = activeBookManifest.width
      canvas.height = activeBookManifest.height
      page.canvasParams.width = activeBookManifest.width
      page.canvasParams.height = activeBookManifest.height
      canvas.style.display = 'block'

      if (activePageId) {
        const pageRes = await fetch('/.netlify/functions/github', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ operation: 'getPage', bookName: activeBookName, pageId: activePageId })
        })
        const pageData = await pageRes.json()
        page.loadFromJSON(pageData.pageData)
        if (page.canvasParams.backgroundColor) {
          currentBgColor = page.canvasParams.backgroundColor
          syncBgIndicator()
          unsavedChanges = false
        }
      } else {
        page.render()
      }
    } catch (err) {
      console.error('Error loading book:', err)
    }
  }

  // --- Save page to book ---
  async function savePageToBook() {
    if (!activeBookName || !activeBookManifest || page.marks.length === 0) return false
    const json = page.toJSON()

    const srcCanvas = document.getElementById('myCanvas')
    const THUMB_LONG = 96
    const isPortrait = srcCanvas.height >= srcCanvas.width
    const thumbW = isPortrait ? Math.round(THUMB_LONG * srcCanvas.width / srcCanvas.height) : THUMB_LONG
    const thumbH = isPortrait ? THUMB_LONG : Math.round(THUMB_LONG * srcCanvas.height / srcCanvas.width)
    const thumbCanvas = document.createElement('canvas')
    thumbCanvas.width = thumbW
    thumbCanvas.height = thumbH
    thumbCanvas.getContext('2d').drawImage(srcCanvas, 0, 0, srcCanvas.width, srcCanvas.height, 0, 0, thumbW, thumbH)
    const thumbnail = thumbCanvas.toDataURL('image/jpeg', 0.6)

    try {
      let pageId = activePageId
      let isNew = !pageId
      if (isNew) pageId = `${activeBookName}_${Date.now().toString(36).toUpperCase()}`

      const res = await fetch('/.netlify/functions/github', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ operation: 'savePage', bookName: activeBookName, pageId, pageData: { ...json, thumbnail } })
      })
      if (!res.ok) throw new Error((await res.json()).error)

      try { localStorage.removeItem(`${THUMB_PREFIX}${activeBookName}::${pageId}`) } catch {}

      if (isNew) {
        activeBookManifest.pages.push({ id: pageId, filename: `${pageId}.json`, caption: '', pageDuration: null, transitionDuration: null, bgColor: json.canvasParams.backgroundColor })
        await fetch('/.netlify/functions/github', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ operation: 'saveManifest', bookName: activeBookName, manifest: activeBookManifest })
        })
        activePageId = pageId
      }
      unsavedChanges = false
      return true
    } catch (err) {
      console.error('Save error:', err)
      return false
    }
  }

  async function navigatePage(direction) {
    if (!activeBookManifest || activeBookManifest.pages.length === 0) return
    if (unsavedChanges) await savePageToBook()

    const pages = activeBookManifest.pages
    let idx = pages.findIndex(p => p.id === activePageId)
    idx = direction === 'prev'
      ? (idx <= 0 ? pages.length - 1 : idx - 1)
      : (idx >= pages.length - 1 ? 0 : idx + 1)
    activePageId = pages[idx].id

    try {
      const res = await fetch('/.netlify/functions/github', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ operation: 'getPage', bookName: activeBookName, pageId: activePageId })
      })
      const data = await res.json()
      page.loadFromJSON(data.pageData)
      if (page.canvasParams.backgroundColor) {
        currentBgColor = page.canvasParams.backgroundColor
        syncBgIndicator()
      }
      unsavedChanges = false
    } catch (err) {
      console.error('Error navigating page:', err)
    }
  }

  document.getElementById('prevPageBtn').addEventListener('pointerdown', () => navigatePage('prev'))
  document.getElementById('nextPageBtn').addEventListener('pointerdown', () => navigatePage('next'))

  function updateBookIndicator() {
    document.getElementById('bookBtn').textContent = activeBookName || 'No Book'
  }

  // --- Remaining toolbar buttons ---
  document.getElementById('deleteButton').addEventListener('pointerdown', () => {
    page.removeLastMark(); unsavedChanges = true; page.render()
  })

  document.getElementById('downloadButton').addEventListener('pointerdown', () => {
    const json = page.toJSON()
    if (!page.marks.length) return
    const blob = new Blob([JSON.stringify(json, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = activePageId ? `${activePageId}.json` : 'page.json'
    a.click()
    URL.revokeObjectURL(url)
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
        const hasMarks = page.marks.length > 0

        const applyLoaded = (loadedJSON, isSVG) => {
          if (hasMarks) {
            const merge = confirm('Current page has marks.\n\nOK = Merge (add loaded marks)\nCancel = Overwrite (replace page)')
            if (merge) {
              loadedJSON.marks.map(m => Mark.fromJSON(m)).forEach(m => {
                page.marks.push(m)
                if (m.filled) lastFilledMark = page.marks.length - 1
              })
              page.render()
              unsavedChanges = true
              return
            }
          }
          page.loadFromJSON(loadedJSON)
          for (let i = 0; i < page.marks.length; i++) {
            if (page.marks[i].filled) lastFilledMark = i
          }
          if (!isSVG && page.canvasParams.backgroundColor) {
            currentBgColor = page.canvasParams.backgroundColor
            syncBgIndicator()
          }
          unsavedChanges = true
        }

        if (file.type === 'image/svg+xml') {
          try { applyLoaded(page.svgToJson(content), true) }
          catch (err) { console.error('SVG load error:', err) }
        } else {
          try { applyLoaded(JSON.parse(content), false) }
          catch (err) { console.error('JSON load error:', err) }
        }
      }
      reader.readAsText(file)
    }
    input.click()
  })

  document.getElementById('bookBtn').addEventListener('pointerdown', async () => {
    if (unsavedChanges) await savePageToBook()
    window.location.href = 'manager.html'
  })

  loadActiveBook()
})
