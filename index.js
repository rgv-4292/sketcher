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

  function debounce(fn, ms) {
    let timer
    return (...args) => { clearTimeout(timer); timer = setTimeout(() => fn(...args), ms) }
  }

  // --- Import helpers ---

  function getImportCentroid(marks) {
    let sx = 0, sy = 0, count = 0
    marks.forEach(m => m.points.forEach(p => { sx += p.x; sy += p.y; count++ }))
    return count ? { x: sx / count, y: sy / count } : { x: 0, y: 0 }
  }

  function rotatePoint(x, y, cx, cy, deg) {
    const rad = (deg * Math.PI) / 180
    const cos = Math.cos(rad), sin = Math.sin(rad)
    return {
      x: cx + (x - cx) * cos - (y - cy) * sin,
      y: cy + (x - cx) * sin + (y - cy) * cos
    }
  }

  // Return a deep clone of marks with all points rotated around their collective centroid.
  function rotateMarks(marks, deg) {
    const c = getImportCentroid(marks)
    return marks.map(m => {
      const clone = Mark.fromJSON(m.toJSON())
      clone.points = m.points.map(p => {
        const r = rotatePoint(p.x, p.y, c.x, c.y, deg)
        return { ...p, x: r.x, y: r.y }
      })
      if (clone.gradient) {
        const rg = rotatePoint(clone.gradient.x, clone.gradient.y, c.x, c.y, deg)
        clone.gradient = { x: rg.x, y: rg.y }
      }
      return clone
    })
  }

  // Bake ghost bitmap: marks rendered onto a tight bounding-box canvas.
  // Returns { bitmap: ImageBitmap, cx: number, cy: number } where cx/cy is
  // the centroid position within the bitmap (used to align to cursor).
  async function bakeGhostBitmap(marks) {
    // Gather all points to find bounds
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
    marks.forEach(m => m.points.forEach(p => {
      minX = Math.min(minX, p.x); minY = Math.min(minY, p.y)
      maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y)
    }))
    if (!isFinite(minX)) return null
    const pad = 20
    minX -= pad; minY -= pad; maxX += pad; maxY += pad
    const w = Math.max(1, Math.ceil(maxX - minX))
    const h = Math.max(1, Math.ceil(maxY - minY))

    // Shift marks so they sit inside the tight canvas
    const shifted = marks.map(m => {
      const clone = Mark.fromJSON(m.toJSON())
      clone.points = m.points.map(p => ({ ...p, x: p.x - minX, y: p.y - minY }))
      if (clone.gradient) clone.gradient = { x: clone.gradient.x - minX, y: clone.gradient.y - minY }
      return clone
    })

    const off = document.createElement('canvas')
    off.width = w; off.height = h
    shifted.forEach(m => { try { m.render(1, false, off, []) } catch (e) { console.log(e) } })

    // Centroid within the bitmap
    let sx = 0, sy = 0, count = 0
    marks.forEach(m => m.points.forEach(p => { sx += p.x; sy += p.y; count++ }))
    const cx = count ? sx / count - minX : w / 2
    const cy = count ? sy / count - minY : h / 2

    return { bitmap: await createImageBitmap(off), cx, cy }
  }

  async function enterImportMode(marks, ownerBase, replaceOwner = null) {
    importOwnerBase = ownerBase
    importReplaceOwner = replaceOwner

    // For re-place, start from the layer's existing stored rotation;
    // for fresh placement, start at 0.
    if (replaceOwner) {
      const existingT = page.layerTransforms[replaceOwner]
      importRotationDeg = (existingT && existingT.rotation) ? existingT.rotation : 0
    } else {
      importRotationDeg = 0
    }

    // Store original centroid before normalising — used by draw() for ghost offset
    importCentroid = getImportCentroid(marks)

    // Normalise marks to centroid-origin for rotation and placement maths
    importMarks = marks.map(m => {
      const clone = Mark.fromJSON(m.toJSON())
      clone.points = m.points.map(p => ({ ...p, x: p.x - importCentroid.x, y: p.y - importCentroid.y }))
      if (clone.gradient) clone.gradient = {
        x: clone.gradient.x - importCentroid.x,
        y: clone.gradient.y - importCentroid.y
      }
      return clone
    })

    if (importGhostBitmap) { importGhostBitmap.bitmap.close(); importGhostBitmap = null }

    // Bake ghost with the current importRotationDeg applied
    const toRotate = importRotationDeg !== 0 ? rotateMarks(importMarks, importRotationDeg) : importMarks
    // const toRotate = importMarks
    const forBake = toRotate.map(m => {
      const clone = Mark.fromJSON(m.toJSON())
      clone.points = m.points.map(p => ({ ...p, x: p.x + importCentroid.x, y: p.y + importCentroid.y }))
      if (clone.gradient) clone.gradient = { x: clone.gradient.x + importCentroid.x, y: clone.gradient.y + importCentroid.y }
      return clone
    })
    importGhostBitmap = await bakeGhostBitmap(forBake)

    importReadyTime = performance.now() + 300
    importMode = true
    canvas.style.cursor = 'crosshair'
    document.getElementById('placementBanner').classList.add('visible')
    refreshLayerList()  // show R slider on re-place target row
  }

  function cancelImportMode() {
    importMode = false
    if (importGhostBitmap) { importGhostBitmap.bitmap.close(); importGhostBitmap = null }
    importMarks = []
    canvas.style.cursor = ''
    document.getElementById('placementBanner').classList.remove('visible')
    page.render()
  }

  let _rebaking = false
  async function rebakeGhost() {
    if (!importMode) return
    if (_rebaking) {
      // Schedule a retry after current bake finishes
      setTimeout(() => rebakeGhost(), 50)
      return
    }
    _rebaking = true
    const deg = importRotationDeg
    // const rotated = rotateMarks(importMarks, deg)  // this is un necessary
    const rotated = importMarks
    const forBake = rotated.map(m => {
      const clone = Mark.fromJSON(m.toJSON())
      clone.points = m.points.map(p => ({ ...p, x: p.x + importCentroid.x, y: p.y + importCentroid.y }))
      if (clone.gradient) clone.gradient = { x: clone.gradient.x + importCentroid.x, y: clone.gradient.y + importCentroid.y }
      return clone
    })
    const result = await bakeGhostBitmap(forBake)
    if (result) {
      if (importGhostBitmap) { importGhostBitmap.bitmap.close(); importGhostBitmap = null }
      importGhostBitmap = result
    }
    _rebaking = false
    // If rotation changed during bake, run again with final value
    // if (importRotationDeg !== deg) rebakeGhost()  // this is un necessary
  }

  const _rebakeDebounced = debounce(async () => { await rebakeGhost() }, 80)

  function placeImport(tapX, tapY) {
    const offsetX = tapX - importCentroid.x
    const offsetY = tapY - importCentroid.y
    // const rotated = rotateMarks(importMarks, importRotationDeg)  // this is unnecessary
    const rotated = importMarks


    let ownerTag
    if (importReplaceOwner && !isImportLayer(importReplaceOwner)) {
      // Drawn layer re-place: bake the transform into the raw mark points permanently,
      // then zero out the transform so the layer's natural position is its new home.
      const dx = offsetX  // delta from transformed centroid to tap
      const dy = offsetY
      const t = getTransform(importReplaceOwner)
      const rad = (t.rotation * Math.PI) / 180
      const cos = Math.cos(rad), sin = Math.sin(rad)
      // Compute raw centroid for rotation pivot
      let sx = 0, sy = 0, count = 0
      page.marks.forEach(m => {
        if (m.owner === importReplaceOwner && m.points.length > 0) {
          m.points.forEach(p => { sx += p.x; sy += p.y; count++ })
        }
      })
      const cx = count ? sx / count : 0
      const cy = count ? sy / count : 0
      // Apply full forward transform + tap delta to each raw point
      page.marks.forEach(m => {
        if (m.owner !== importReplaceOwner) return
        m.points = m.points.map(p => {
          let x = p.x, y = p.y
          if (t.rotation !== 0) {
            x = cx + (p.x - cx) * cos - (p.y - cy) * sin
            y = cy + (p.x - cx) * sin + (p.y - cy) * cos
          }
          return { ...p, x: x + t.offsetX + dx, y: y + t.offsetY + dy }
        })
        if (m.gradient) {
          let gx = m.gradient.x, gy = m.gradient.y
          if (t.rotation !== 0) {
            gx = cx + (m.gradient.x - cx) * cos - (m.gradient.y - cy) * sin
            gy = cy + (m.gradient.x - cx) * sin + (m.gradient.y - cy) * cos
          }
          m.gradient = { x: gx + t.offsetX + dx, y: gy + t.offsetY + dy }
        }
      })
      // Zero out the transform — layer is now at its natural position
      setTransform(importReplaceOwner, { offsetX: 0, offsetY: 0, rotation: 0 })
      cancelImportMode()
      refreshLayerList()
      return
    } else if (importReplaceOwner) {
      // Import re-place: remove old marks, reuse owner tag
      page.marks = page.marks.filter(m => m.owner !== importReplaceOwner)
      ownerTag = importReplaceOwner
    } else {
      // New placement: assign next instance number
      const instanceNum = (importInstanceCounters[importOwnerBase] || 0) + 1
      importInstanceCounters[importOwnerBase] = instanceNum
      ownerTag = `${importOwnerBase}_${String(instanceNum).padStart(2, '0')}`
    }

    rotated.forEach(m => {
      const placed = Mark.fromJSON(m.toJSON())
      placed.points = m.points.map(p => ({ ...p, x: Math.round(p.x + importCentroid.x + offsetX), y: Math.round(p.y + importCentroid.y + offsetY) }))
      if (placed.gradient) placed.gradient = {
        x: placed.gradient.x + importCentroid.x + offsetX,
        y: placed.gradient.y + importCentroid.y + offsetY
      }
      placed.owner = ownerTag
      page.marks.push(placed)
      if (placed.filled) lastFilledMark = page.marks.length - 1
    })
    // Store the placement centroid as the fixed rotation pivot for this layer
    const placedCx = importCentroid.x + offsetX
    const placedCy = importCentroid.y + offsetY
    const tkey = ownerTag
    if (!page.layerTransforms[tkey]) page.layerTransforms[tkey] = { offsetX: 0, offsetY: 0, rotation: 0 }
    page.layerTransforms[tkey].cx = placedCx
    page.layerTransforms[tkey].cy = placedCy
    page.invalidateBuffer()
    unsavedChanges = true
    cancelImportMode()
    refreshLayerList()
  }

  // --- Layer helpers ---

  // Returns true if owner is an import (has _NN suffix from a file placement)
  function isImportLayer(owner) {
    return owner !== null && /_\d+$/.test(owner)
  }

  // Ordered list of all layers: [null, ...unique non-null owners in insertion order]
  function getLayerOrder() {
    const seen = []
    page.marks.forEach(m => {
      if (m.owner !== null && !seen.includes(m.owner)) seen.push(m.owner)
    })
    return [null, ...seen]
  }

  function layerDisplayName(owner) {
    return owner === null ? 'Page' : owner
  }

  function setActiveLayer(owner) {
    activeLayer = owner
    const nameInput = document.getElementById('layerNameInput')
    const isDrawing = owner !== null && !isImportLayer(owner)
    nameInput.value = layerDisplayName(owner)
    nameInput.disabled = !isDrawing
    refreshLayerList()
  }

  function refreshLayerList() {
    const list = document.getElementById('importList')
    list.innerHTML = ''
    const layers = getLayerOrder()

    const idx = layers.indexOf(activeLayer)
    const safeIdx = idx === -1 ? 0 : idx
    document.getElementById('layerCounter').textContent = `${safeIdx + 1} / ${layers.length}`

    layers.forEach(owner => {
      const isActive = owner === activeLayer
      const t = getTransform(owner)

      // --- Main row ---
      const row = document.createElement('div')
      row.className = 'import-row' + (isActive ? ' active-layer' : '')
      row.draggable = true
      row.dataset.owner = owner === null ? '__page__' : owner

      const drag = document.createElement('span')
      drag.textContent = '\u283f'
      drag.dataset.drag = '1'
      drag.style.cssText = 'cursor:grab;color:#666;padding:0 5px 0 0;font-size:14px;user-select:none;touch-action:none;'

      const name = document.createElement('span')
      name.className = 'import-name'
      name.textContent = layerDisplayName(owner)
      name.title = layerDisplayName(owner)

      const selBtn = document.createElement('button')
      selBtn.textContent = 'Select'
      if (isActive) selBtn.style.background = '#5a7a5a'
      selBtn.addEventListener('pointerdown', () => setActiveLayer(owner))

      row.appendChild(drag)
      row.appendChild(name)
      row.appendChild(selBtn)

      const reBtn = document.createElement('button')
      reBtn.textContent = 'Re-place'
      reBtn.addEventListener('pointerdown', async () => {
        let marksForPlacement
        if (isImportLayer(owner)) {
          marksForPlacement = page.marks
            .filter(m => m.owner === owner)
            .map(m => Mark.fromJSON(m.toJSON()))
        } else {
          const rawMarks = page.marks
            .filter(m => m.owner === owner && m.points.length > 0)
            .map(m => Mark.fromJSON(m.toJSON()))
          if (rawMarks.length === 0) return
          const t = getTransform(owner)
          let sx = 0, sy = 0, count = 0
          rawMarks.forEach(m => m.points.forEach(p => { sx += p.x; sy += p.y; count++ }))
          const cx = count ? sx / count : 0
          const cy = count ? sy / count : 0
          const rad = (t.rotation * Math.PI) / 180
          const cos = Math.cos(rad), sin = Math.sin(rad)
          marksForPlacement = rawMarks.map(m => {
            const clone = Mark.fromJSON(m.toJSON())
            clone.points = m.points.map(p => {
              let x = p.x, y = p.y
              if (t.rotation !== 0) {
                x = cx + (p.x - cx) * cos - (p.y - cy) * sin
                y = cy + (p.x - cx) * sin + (p.y - cy) * cos
              }
              return { ...p, x: x + t.offsetX, y: y + t.offsetY }
            })
            return clone
          })
        }
        const base = isImportLayer(owner) ? owner.replace(/_\d+$/, '') : owner
        await enterImportMode(marksForPlacement, base, owner)
      })
      row.appendChild(reBtn)

      if (owner !== null) {
        const delBtn = document.createElement('button')
        delBtn.textContent = 'Del'
        delBtn.className = 'danger'
        delBtn.addEventListener('pointerdown', () => {
          page.marks = page.marks.filter(m => m.owner !== owner)
          delete page.layerTransforms[owner]
          if (activeLayer === owner) setActiveLayer(null)
          page.invalidateBuffer()
          unsavedChanges = true
          page.render()
          refreshLayerList()
        })
        row.appendChild(delBtn)
      }

      list.appendChild(row)

      // --- Transform sub-row: show for active layer OR current re-place target ---
      if (isActive || (importMode && importReplaceOwner === owner)) {
        const sub = document.createElement('div')
        sub.style.cssText = 'padding:6px 4px 6px 18px;display:flex;flex-direction:column;gap:5px;border-left:3px solid #5a7a5a;margin-bottom:4px;'

        // Rotation
        const rRow = document.createElement('div')
        rRow.style.cssText = 'display:flex;align-items:center;gap:6px;'
        const rLbl = document.createElement('label')
        rLbl.textContent = 'R'
        rLbl.style.cssText = 'font-size:11px;color:#aaa;width:12px;'
        const rSlider = document.createElement('input')
        rSlider.type = 'range'
        rSlider.min = -180; rSlider.max = 180; rSlider.step = 1
        // In re-place mode show importRotationDeg; otherwise show stored transform
        rSlider.value = (importMode && importReplaceOwner === owner) ? importRotationDeg : t.rotation
        rSlider.style.cssText = 'flex:1;'
        const rVal = document.createElement('span')
        const displayRot = (importMode && importReplaceOwner === owner) ? importRotationDeg : Math.round(t.rotation)
        rVal.textContent = `${displayRot}\u00b0`
        rVal.style.cssText = 'font-size:11px;color:#aaa;width:32px;text-align:right;'
        rSlider.addEventListener('input', () => {
          const v = parseFloat(rSlider.value)
          rVal.textContent = `${Math.round(v)}\u00b0`
          if (importMode && importReplaceOwner === owner) {
            // In re-place mode: drive the ghost preview rotation directly
            importRotationDeg = v
            renderGhostAtLast()
            _rebakeDebounced()
          } else {
            setTransform(owner, { rotation: v })
          }
        })
        rRow.appendChild(rLbl); rRow.appendChild(rSlider); rRow.appendChild(rVal)
        sub.appendChild(rRow)

        list.appendChild(sub)
      }
    })

    // --- Pointer-based drag-to-reorder ---
    let dragSrc = null
    let dragPlaceholder = null

    list.querySelectorAll('.import-row [data-drag]').forEach(handle => {
      handle.addEventListener('pointerdown', e => {
        const row = handle.closest('.import-row')
        if (!row) return
        e.preventDefault()
        e.stopPropagation()
        dragSrc = row
        dragSrc.style.opacity = '0.4'
        dragPlaceholder = document.createElement('div')
        dragPlaceholder.style.cssText = 'height:2px;background:#7a9a7a;margin:2px 0;pointer-events:none;'

        const onMove = e => {
          if (!dragSrc) return
          const rows = [...list.querySelectorAll('.import-row')].filter(r => r !== dragSrc)
          let inserted = false
          for (const r of rows) {
            const rect = r.getBoundingClientRect()
            if (e.clientY < rect.top + rect.height / 2) {
              list.insertBefore(dragPlaceholder, r)
              inserted = true
              break
            }
          }
          if (!inserted) list.appendChild(dragPlaceholder)
        }

        const onUp = () => {
          document.removeEventListener('pointermove', onMove)
          document.removeEventListener('pointerup', onUp)
          document.removeEventListener('pointercancel', onUp)
          if (!dragSrc) return
          dragSrc.style.opacity = ''
          if (dragPlaceholder && dragPlaceholder.parentNode) {
            list.insertBefore(dragSrc, dragPlaceholder)
            dragPlaceholder.remove()
          }
          const newOrder = [...list.querySelectorAll('.import-row')]
            .map(r => r.dataset.owner === '__page__' ? null : r.dataset.owner)
          dragSrc = null; dragPlaceholder = null
          page.layerOrder = newOrder
          page.invalidateBuffer()
          unsavedChanges = true
          page.render()
          setTimeout(() => refreshLayerList(), 0)
        }

        document.addEventListener('pointermove', onMove)
        document.addEventListener('pointerup', onUp)
        document.addEventListener('pointercancel', onUp)
      })
    })
  }

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

  // --- Import placement state ---
  let importMode = false
  let importMarks = []
  let importCentroid = { x: 0, y: 0 }
  let importGhostBitmap = null
  let importOwnerBase = ''
  let importReplaceOwner = null
  let importRotationDeg = 0
  let importReadyTime = 0
  const importInstanceCounters = {}

  // --- Layer state ---
  let activeLayer = null
  let drawingLayerCounter = 1
  let setLayerOriginPending = false  // true while waiting for canvas tap to set offset

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

  // ESC cancels placement mode
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && importMode) cancelImportMode()
  })

  // --- Layer transform helpers ---

  function getTransform(owner) {
    const key = owner === null ? '__page__' : owner
    if (!page.layerTransforms[key]) page.layerTransforms[key] = { offsetX: 0, offsetY: 0, rotation: 0 }
    return page.layerTransforms[key]
  }

  function setTransform(owner, patch) {
    const key = owner === null ? '__page__' : owner
    if (!page.layerTransforms[key]) page.layerTransforms[key] = { offsetX: 0, offsetY: 0, rotation: 0 }
    // When rotation is first set, compute and store the pivot centroid from current mark positions
    if (patch.rotation !== undefined && page.layerTransforms[key].cx === undefined) {
      let sx = 0, sy = 0, count = 0
      page.marks.forEach(m => {
        if ((m.owner === null ? '__page__' : m.owner) === key && m.points.length > 0) {
          m.points.forEach(p => { sx += p.x; sy += p.y; count++ })
        }
      })
      page.layerTransforms[key].cx = count ? sx / count : page.canvasParams.width / 2
      page.layerTransforms[key].cy = count ? sy / count : page.canvasParams.height / 2
    }
    // When offset changes, clear stored pivot so it recomputes on next rotation use
    if ((patch.offsetX !== undefined || patch.offsetY !== undefined) && patch.rotation === undefined) {
      delete page.layerTransforms[key].cx
      delete page.layerTransforms[key].cy
    }
    Object.assign(page.layerTransforms[key], patch)
    page.invalidateBuffer()
    unsavedChanges = true
    page.render()
  }

  // Push current layer list order into page.layerOrder
  function syncLayerOrder() {
    page.layerOrder = getLayerOrder()
    page.invalidateBuffer()
    unsavedChanges = true
    page.render()
  }

  // After loading from JSON, sync layerTransforms and layerOrder back to index state
  function syncFromPage() {
    // Rebuild drawingLayerCounter from existing layer names
    getLayerOrder().forEach(owner => {
      if (owner !== null && !isImportLayer(owner)) {
        const m = owner.match(/^Layer (\d+)$/)
        if (m) drawingLayerCounter = Math.max(drawingLayerCounter, parseInt(m[1]))
      }
    })
  }

  // --- Bottom bar layer controls ---
  const layerNameInput = document.getElementById('layerNameInput')
  const layerCounter = document.getElementById('layerCounter')

  // Rename: only fires for user drawing layers (input is disabled for Page/import)
  layerNameInput.addEventListener('change', () => {
    const newName = layerNameInput.value.trim()
    if (!newName || activeLayer === null || isImportLayer(activeLayer)) return
    if (newName === activeLayer) return
    // Rename all marks on this layer
    page.marks.forEach(m => { if (m.owner === activeLayer) m.owner = newName })
    activeLayer = newName
    page.invalidateBuffer()
    unsavedChanges = true
    page.render()
    refreshLayerList()
  })

  document.getElementById('layerPrevBtn').addEventListener('pointerdown', () => {
    const layers = getLayerOrder()
    const idx = layers.indexOf(activeLayer)
    const next = idx <= 0 ? layers.length - 1 : idx - 1
    setActiveLayer(layers[next])
  })

  document.getElementById('layerNextBtn').addEventListener('pointerdown', () => {
    const layers = getLayerOrder()
    const idx = layers.indexOf(activeLayer)
    const next = idx >= layers.length - 1 ? 0 : idx + 1
    setActiveLayer(layers[next])
  })

  // + New Drawing Layer button
  document.getElementById('addLayerBtn').addEventListener('pointerdown', () => {
    drawingLayerCounter++
    const newOwner = `Layer ${drawingLayerCounter}`
    // Add a sentinel mark with 0 points so the layer appears in getLayerOrder
    // without requiring an actual drawn mark first.
    // Instead, we track pending empty layers separately.
    // Simpler: just set active, it will appear in list when first mark is drawn.
    // To show it immediately, push a placeholder that getLayerOrder sees.
    // We use a real empty mark as a layer anchor.
    const anchor = Mark.fromJSON({
      color: 'rgba(0,0,0,0)', minDistance: 1, distanceThreshold: 1,
      connectionProbability: 0, filled: false, points: [],
      markWidth: 1, hatchAngle: 0, alpha: 0, trace: false,
      gradient: null, fillMode: 'none', density: 3, isMask: false, owner: newOwner
    })
    page.marks.push(anchor)
    setActiveLayer(newOwner)
    unsavedChanges = true
  })

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

  const _renderBgDebounced = debounce(() => page.render(), 150)

  function syncBgIndicator() {
    bgColorSwatch.style.background = currentBgColor
    page.canvasParams.backgroundColor = currentBgColor
    page.invalidateBuffer()
    _renderBgDebounced()
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

  // Apply the forward layer transform to a canvas context for live preview.
  // Returns true if ctx.save() was called (caller must ctx.restore()).
  function applyLiveTransform(ctx, owner) {
    const t = getTransform(owner)
    if (t.offsetX === 0 && t.offsetY === 0 && t.rotation === 0) return false
    ctx.save()
    ctx.translate(t.offsetX, t.offsetY)
    if (t.rotation !== 0) {
      const pivotX = t.cx !== undefined ? t.cx : page.canvasParams.width / 2
      const pivotY = t.cy !== undefined ? t.cy : page.canvasParams.height / 2
      ctx.translate(pivotX, pivotY)
      ctx.rotate((t.rotation * Math.PI) / 180)
      ctx.translate(-pivotX, -pivotY)
    }
    return true
  }

  // Convert a canvas point to a layer's local space by applying the inverse transform.
  function toLayerSpace(pt, owner) {
    const t = getTransform(owner)
    if (t.offsetX === 0 && t.offsetY === 0 && t.rotation === 0) return pt
    let x = pt.x - t.offsetX
    let y = pt.y - t.offsetY
    if (t.rotation !== 0) {
      const pivotX = t.cx !== undefined ? t.cx : 0
      const pivotY = t.cy !== undefined ? t.cy : 0
      const rad = (-t.rotation * Math.PI) / 180
      const cos = Math.cos(rad), sin = Math.sin(rad)
      const rx = pivotX + (x - pivotX) * cos - (y - pivotY) * sin
      const ry = pivotY + (x - pivotX) * sin + (y - pivotY) * cos
      x = rx; y = ry
    }
    return { x, y }
  }

  // --- Canvas coordinate helper ---
  // Corrects for CSS scaling when canvas is displayed smaller/larger than its pixel dimensions.
  function getCanvasPoint(event) {
    const rect = canvas.getBoundingClientRect()
    const scaleX = canvas.width / rect.width
    const scaleY = canvas.height / rect.height
    return {
      x: (event.clientX - rect.left) * scaleX,
      y: (event.clientY - rect.top) * scaleY
    }
  }

  // --- Canvas drawing ---
  canvas.addEventListener('pointerdown', startDrawing)
  canvas.addEventListener('pointermove', draw)
  canvas.addEventListener('pointerup', stopDrawing)
  canvas.addEventListener('pointercancel', stopDrawing)
  // Keep ghost preview moving even when no button is held (hover on desktop/pen)
  canvas.addEventListener('mousemove', drawGhostPreview)

  function startDrawing(event) {
    event.preventDefault()
    const pt = getCanvasPoint(event)

    // In placement mode, ignore pointerdown — placement fires on pointerup
    if (importMode) return

    // Set layer origin: capture tap as offsetX/Y for active layer
    if (setLayerOriginPending) {
      setTransform(activeLayer, { offsetX: pt.x, offsetY: pt.y })
      setLayerOriginPending = false
      refreshLayerList()  // uncheck the checkbox and update spinners
      return
    }

    const setGradientCheckbox = document.getElementById('checkbox2')
    if (fillMode === 'gradient' && setGradientCheckbox.checked && lastFilledMark >= 0) {
      page.marks[lastFilledMark].gradient = { x: pt.x, y: pt.y }
      setGradientCheckbox.checked = false
      page.render()
      return
    }

    drawing = true
    currentMark = new Mark(
      currentColor, minDistance, distanceThreshold, connectionProbability,
      fillMode !== 'none', markWidth, hatchAngle, 0.75, doTrace, null, fillMode, density, doMask
    )
    const lpt = toLayerSpace(pt, activeLayer)
    const liveCtx = canvas.getContext('2d')
    const liveTransformed = applyLiveTransform(liveCtx, activeLayer)
    currentMark.addPoint(lpt.x, lpt.y, getEventPressure(event))
    if (liveTransformed) liveCtx.restore()
  }

  // Last known cursor position during import mode, for slider-driven re-render
  let _ghostLastPt = null

  function renderGhostAt(pt) {
    if (!importGhostBitmap) return
    _ghostLastPt = pt
    const { bitmap, cx, cy } = importGhostBitmap
    const mainCtx = canvas.getContext('2d')
    if (page._bufferDirty) page._renderToBuffer()
    mainCtx.clearRect(0, 0, canvas.width, canvas.height)
    mainCtx.fillStyle = page.canvasParams.backgroundColor
    mainCtx.fillRect(0, 0, canvas.width, canvas.height)
    mainCtx.drawImage(page._bufferCanvas, 0, 0)
    mainCtx.save()
    mainCtx.globalAlpha = 0.5
    // Always translate to cursor, rotate by current importRotationDeg, draw centred
    mainCtx.translate(pt.x, pt.y)
    if (importRotationDeg !== 0) {
      mainCtx.rotate((importRotationDeg * Math.PI) / 180)
    }
    mainCtx.drawImage(bitmap, -cx, -cy)
    mainCtx.restore()
    mainCtx.globalAlpha = 1
  }

  function renderGhostAtLast() {
    if (_ghostLastPt) renderGhostAt(_ghostLastPt)
  }

  function drawGhostPreview(event) {
    if (!importMode) return
    renderGhostAt(getCanvasPoint(event))
  }

  function draw(event) {
    event.preventDefault()

    if (importMode) {
      renderGhostAt(getCanvasPoint(event))
      return
    }

    if (!drawing) return
    const pt = getCanvasPoint(event)
    const lpt = toLayerSpace(pt, activeLayer)
    const lastPoint = currentMark.points[currentMark.points.length - 1]
    const dx = lpt.x - lastPoint.x
    const dy = lpt.y - lastPoint.y
    const scatterAmount = scatter > 0 ? Math.random() * scatter : 0
    if (Math.sqrt(dx * dx + dy * dy) > minDistance + scatterAmount) {
      const pressure = getEventPressure(event)
      const liveCtx = canvas.getContext('2d')
      const liveTransformed = applyLiveTransform(liveCtx, activeLayer)
      currentMark.addPoint(lpt.x, lpt.y, pressure)
      currentMark.addPoint(
        lpt.x + Math.ceil(Math.random() * 4 - 2),
        lpt.y + Math.ceil(Math.random() * 4 - 2),
        pressure
      )
      if (liveTransformed) liveCtx.restore()
    }
  }

  function stopDrawing(event) {
    // In placement mode, pointerup on the canvas places the import
    if (importMode) {
      if (event && event.type === 'pointerup' && performance.now() >= importReadyTime) {
        const pt = getCanvasPoint(event)
        placeImport(pt.x, pt.y)
      }
      return
    }
    if (!drawing) return
    if (currentMark.points.length > 4) {
      currentMark.owner = activeLayer
      page.addMark(currentMark)
      if (currentMark.filled) lastFilledMark = page.marks.length - 1
      if (currentMark.isMask) {
        page.invalidateBuffer()
      } else {
        page.appendMarkToBuffer(currentMark)
      }
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
        syncFromPage()
        page.layerOrder = page.layerOrder.length ? page.layerOrder : getLayerOrder()
        refreshLayerList()
      } else {
        page.render()
      }
    } catch (err) {
      console.error('Error loading book:', err)
    }
  }

  // Initialise layer UI on startup
  setActiveLayer(null)

  // --- Save page to book ---
  async function savePageToBook() {
    if (!activeBookName || !activeBookManifest || !unsavedChanges) return false
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
      syncFromPage()
      page.layerOrder = page.layerOrder.length ? page.layerOrder : getLayerOrder()
      refreshLayerList()
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
    // Find and remove the last mark belonging to the active layer
    for (let i = page.marks.length - 1; i >= 0; i--) {
      if (page.marks[i].owner === activeLayer) {
        page.marks.splice(i, 1)
        break
      }
    }
    page.invalidateBuffer()
    unsavedChanges = true
    page.render()
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
      const baseName = file.name.replace(/\.[^.]+$/, '') // strip extension
      const reader = new FileReader()
      reader.onload = async (e) => {
        const content = e.target.result
        const hasMarks = page.marks.length > 0

        // Parse to a common JSON structure regardless of source format
        let loadedJSON
        try {
          if (file.type === 'image/svg+xml') {
            loadedJSON = page.svgToJson(content)
          } else {
            loadedJSON = JSON.parse(content)
          }
        } catch (err) {
          console.error('Load parse error:', err)
          return
        }

        if (!hasMarks) {
          // Nothing on canvas — offer place or overwrite
          const placeOnEmpty = confirm(
            'Place mode: tap the canvas to position the import.\n\nOK = Place (tap to position)\nCancel = Load at original position'
          )
          if (placeOnEmpty) {
            const incomingMarks = loadedJSON.marks.map(m => Mark.fromJSON(m))
            await enterImportMode(incomingMarks, baseName)
          } else {
            page.loadFromJSON(loadedJSON)
            page.invalidateBuffer()
            if (loadedJSON.canvasParams?.backgroundColor) {
              currentBgColor = loadedJSON.canvasParams.backgroundColor
              syncBgIndicator()
            }
            for (let i = 0; i < page.marks.length; i++) {
              if (page.marks[i].filled) lastFilledMark = i
            }
            page.render()
            unsavedChanges = true
            refreshLayerList()
          }
          return
        }

        // Canvas has marks — ask what to do
        const overwrite = confirm(
          'Current page has marks.\n\nOK = Overwrite page\nCancel = Add to page'
        )
        if (overwrite) {
          page.loadFromJSON(loadedJSON)
          page.invalidateBuffer()
          if (loadedJSON.canvasParams?.backgroundColor) {
            currentBgColor = loadedJSON.canvasParams.backgroundColor
            syncBgIndicator()
          }
          for (let i = 0; i < page.marks.length; i++) {
            if (page.marks[i].filled) lastFilledMark = i
          }
          page.render()
          unsavedChanges = true
          refreshLayerList()
          return
        }

        // Adding to page — place or merge immediately?
        const placeMode = confirm(
          'Place mode: tap the canvas to position the import.\n\nOK = Place (tap to position)\nCancel = Merge immediately at original position'
        )
        const incomingMarks = loadedJSON.marks.map(m => Mark.fromJSON(m))
        if (placeMode) {
          await enterImportMode(incomingMarks, baseName)
        } else {
          // Immediate merge — no owner tag
          incomingMarks.forEach(m => {
            page.marks.push(m)
            if (m.filled) lastFilledMark = page.marks.length - 1
          })
          page.invalidateBuffer()
          page.render()
          unsavedChanges = true
          refreshLayerList()
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
