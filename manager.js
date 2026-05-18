import { Mark } from './mark.js'
import { Page } from './page.js'

const CACHE_KEY = 'sketcher_manager_cache'
const ACTIVE_BOOK_KEY = 'sketcher_active_book'
const THUMB_PREFIX = 'sketcher_thumb::'
const VIDEO_PAGE_LIMIT = 20

let books = []
let activeBook = null
let activeManifest = null
let dragSrcIndex = null
let dragOverIndex = null
let selectedPages = new Set()
let exportCancelled = false

// --- API ---

async function api(operation, params = {}) {
  const res = await fetch('/.netlify/functions/github', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ operation, ...params })
  })
  const data = await res.json()
  if (!res.ok) throw new Error(data.error || 'API error')
  return data
}

// --- Cache ---

function loadCache() {
  try { return JSON.parse(localStorage.getItem(CACHE_KEY) || '{}') }
  catch { return {} }
}

function saveCache(cache) {
  localStorage.setItem(CACHE_KEY, JSON.stringify(cache))
}

function getCachedManifest(bookName) {
  return loadCache()[bookName] || null
}

function setCachedManifest(bookName, manifest) {
  const cache = loadCache()
  cache[bookName] = manifest
  saveCache(cache)
}

// --- Thumbnail cache ---

function thumbKey(bookName, pageId) {
  return `${THUMB_PREFIX}${bookName}::${pageId}`
}

function getCachedThumb(bookName, pageId) {
  try { return localStorage.getItem(thumbKey(bookName, pageId)) || null }
  catch { return null }
}

function setCachedThumb(bookName, pageId, dataUrl) {
  try {
    localStorage.setItem(thumbKey(bookName, pageId), dataUrl)
  } catch {
    const victims = []
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i)
      if (k && k.startsWith(THUMB_PREFIX)) victims.push(k)
    }
    victims.slice(0, Math.ceil(victims.length / 2)).forEach(k => localStorage.removeItem(k))
    try { localStorage.setItem(thumbKey(bookName, pageId), dataUrl) } catch {}
  }
}

function clearCachedThumb(bookName, pageId) {
  try { localStorage.removeItem(thumbKey(bookName, pageId)) } catch {}
}

// --- Status ---

function setStatus(msg) {
  document.getElementById('statusBar').textContent = msg
}

// --- Progress ---

function showProgress(label, percent) {
  document.getElementById('progressContainer').classList.add('visible')
  document.getElementById('progressLabel').textContent = label
  document.getElementById('progressBarInner').style.width = `${percent}%`
}

function updateProgress(label, percent) {
  document.getElementById('progressLabel').textContent = label
  document.getElementById('progressBarInner').style.width = `${percent}%`
}

function hideProgress() {
  document.getElementById('progressContainer').classList.remove('visible')
}

document.getElementById('progressCancel').addEventListener('click', () => {
  exportCancelled = true
  hideProgress()
  setStatus('Export cancelled')
})

// --- Book list ---

async function loadBooks(forceRefresh = false) {
  setStatus('Loading books...')
  try {
    const cache = loadCache()
    if (!forceRefresh && cache._books) {
      books = cache._books
    } else {
      const data = await api('listBooks')
      books = data.books
      cache._books = books
      saveCache(cache)
    }
    renderBookList()
    setStatus(`${books.length} book(s) found`)
  } catch (err) {
    setStatus(`Error: ${err.message}`)
  }
}

function renderBookList() {
  const list = document.getElementById('bookList')
  list.innerHTML = ''
  books.forEach(name => {
    const item = document.createElement('div')
    item.className = 'book-item' + (activeBook === name ? ' active' : '')
    item.textContent = name
    item.addEventListener('click', () => selectBook(name))
    list.appendChild(item)
  })
}

async function selectBook(name) {
  activeBook = name
  selectedPages = new Set()
  localStorage.setItem(ACTIVE_BOOK_KEY, name)
  renderBookList()
  setStatus(`Loading ${name}...`)
  try {
    let manifest = getCachedManifest(name)
    if (!manifest) {
      const data = await api('getManifest', { bookName: name })
      manifest = data.manifest
      setCachedManifest(name, manifest)
    }
    activeManifest = manifest
    renderPagePanel()
    setStatus(`${name} — ${manifest.pages.length} page(s)`)
  } catch (err) {
    setStatus(`Error loading book: ${err.message}`)
  }
}

// --- Page panel ---

function renderPagePanel() {
  const title = document.getElementById('pagePanelTitle')
  const emptyState = document.getElementById('emptyState')
  const pageList = document.getElementById('pageList')
  const newPageBtn = document.getElementById('newPageBtn')
  const bookSettings = document.getElementById('bookSettings')

  title.textContent = activeManifest.name
  bookSettings.style.display = 'flex'
  document.getElementById('defaultPageDuration').value = activeManifest.defaultPageDuration
  document.getElementById('defaultTransDuration').value = activeManifest.defaultTransitionDuration
  document.getElementById('captionFontSize').value = activeManifest.captionFontSize || 24

  emptyState.style.display = activeManifest.pages.length === 0 ? 'flex' : 'none'
  pageList.style.display = activeManifest.pages.length > 0 ? 'flex' : 'none'
  newPageBtn.style.display = 'block'
  document.getElementById('selectAllBtn').style.display = 'inline-block'
  document.getElementById('deselectAllBtn').style.display = 'inline-block'
  document.getElementById('exportPngBtn').disabled = selectedPages.size === 0
  document.getElementById('exportVideoBtn').disabled = selectedPages.size === 0

  pageList.innerHTML = ''
  activeManifest.pages.forEach((page, index) => {
    pageList.appendChild(createPageItem(page, index))
  })

  loadThumbnailsInBackground()
}

function updateSelectionUI() {
  document.getElementById('exportPngBtn').disabled = selectedPages.size === 0
  document.getElementById('exportVideoBtn').disabled = !activeManifest || activeManifest.pages.length === 0
  document.querySelectorAll('.page-item').forEach((el, i) => {
    el.classList.toggle('selected', selectedPages.has(i))
    const cb = el.querySelector('.page-select-cb')
    if (cb) cb.checked = selectedPages.has(i)
  })
}

// --- Thumbnail background loader ---

let _thumbLoadId = 0

async function loadThumbnailsInBackground() {
  if (!activeManifest || !activeBook) return
  const runId = ++_thumbLoadId
  const pages = activeManifest.pages

  for (let i = 0; i < pages.length; i++) {
    if (runId !== _thumbLoadId) return
    const page = pages[i]
    const cached = getCachedThumb(activeBook, page.id)
    if (cached) continue
    try {
      const data = await api('getPage', { bookName: activeBook, pageId: page.id })
      if (runId !== _thumbLoadId) return
      const thumbnail = data.pageData && data.pageData.thumbnail
      if (thumbnail) {
        setCachedThumb(activeBook, page.id, thumbnail)
        applyThumbToDOM(page.id, thumbnail)
      }
    } catch (err) {
      console.warn(`Thumbnail load failed for ${page.id}:`, err)
    }
  }
}

function applyThumbToDOM(pageId, dataUrl) {
  const thumbDiv = document.querySelector(`.page-thumb[data-page-id="${pageId}"]`)
  if (!thumbDiv) return
  const img = thumbDiv.querySelector('img')
  if (img) {
    img.src = dataUrl
    img.style.display = 'block'
    thumbDiv.style.background = 'none'
  }
}

function createPageItem(page, index) {
  const item = document.createElement('div')
  item.className = 'page-item' + (selectedPages.has(index) ? ' selected' : '')
  item.draggable = true
  item.dataset.index = index

  const selectCb = document.createElement('input')
  selectCb.type = 'checkbox'
  selectCb.className = 'page-select-cb'
  selectCb.checked = selectedPages.has(index)
  selectCb.title = 'Select for export'
  selectCb.addEventListener('click', (e) => {
    e.stopPropagation()
    selectedPages[selectCb.checked ? 'add' : 'delete'](index)
    updateSelectionUI()
  })

  item.addEventListener('click', (e) => {
    if (e.target.tagName === 'BUTTON' || e.target.tagName === 'INPUT') return
    selectedPages[selectedPages.has(index) ? 'delete' : 'add'](index)
    updateSelectionUI()
  })

  const THUMB_LONG = 48
  const isPortrait = activeManifest.height >= activeManifest.width
  const thumbW = isPortrait ? Math.round(THUMB_LONG * activeManifest.width / activeManifest.height) : THUMB_LONG
  const thumbH = isPortrait ? THUMB_LONG : Math.round(THUMB_LONG * activeManifest.height / activeManifest.width)

  const thumb = document.createElement('div')
  thumb.className = 'page-thumb'
  thumb.style.cssText = `background:${page.bgColor || '#f0ebe8'};width:${thumbW}px;height:${thumbH}px;`
  thumb.dataset.pageId = page.id

  const thumbImg = document.createElement('img')
  thumbImg.style.cssText = 'width:100%;height:100%;object-fit:cover;border-radius:3px;display:none;'
  thumb.appendChild(thumbImg)

  const cached = getCachedThumb(activeBook, page.id)
  if (cached) {
    thumbImg.src = cached
    thumbImg.style.display = 'block'
    thumb.style.background = 'none'
  }

  const info = document.createElement('div')
  info.className = 'page-info'

  const captionDisplay = document.createElement('div')
  captionDisplay.className = 'page-caption'
  captionDisplay.textContent = page.caption || `Page ${index + 1}`
  captionDisplay.title = 'Click to edit caption'
  captionDisplay.addEventListener('click', (e) => {
    e.stopPropagation()
    const input = document.createElement('input')
    input.className = 'page-caption-input'
    input.value = page.caption || ''
    input.placeholder = `Page ${index + 1}`
    captionDisplay.replaceWith(input)
    input.focus()
    const finish = async () => {
      page.caption = input.value
      captionDisplay.textContent = input.value || `Page ${index + 1}`
      input.replaceWith(captionDisplay)
      await saveManifest()
    }
    input.addEventListener('blur', finish)
    input.addEventListener('keydown', e => { if (e.key === 'Enter') input.blur() })
  })

  const meta = document.createElement('div')
  meta.className = 'page-meta'
  meta.textContent = page.id

  info.append(captionDisplay, meta)

  const durations = document.createElement('div')
  durations.className = 'page-durations'

  const makeDurInput = (label, getVal, setVal) => {
    const lbl = document.createElement('span')
    lbl.textContent = label
    const inp = document.createElement('input')
    inp.type = 'number'
    inp.value = getVal() ?? ''
    inp.placeholder = label === 'pg:' ? activeManifest.defaultPageDuration : activeManifest.defaultTransitionDuration
    inp.title = label === 'pg:' ? 'Page duration (s)' : 'Transition duration (s)'
    inp.addEventListener('click', e => e.stopPropagation())
    inp.addEventListener('change', async () => {
      setVal(inp.value === '' ? null : parseFloat(inp.value))
      await saveManifest()
    })
    return [lbl, inp]
  }

  durations.append(
    ...makeDurInput('pg:', () => page.pageDuration, v => { page.pageDuration = v }),
    ...makeDurInput('tr:', () => page.transitionDuration, v => { page.transitionDuration = v })
  )

  // Interp Order checkbox
  const interpLbl = document.createElement('span')
  interpLbl.textContent = 'Interp Order'
  interpLbl.title = 'Interpolate marks in draw order instead of by point size (still couples by fill type)'
  interpLbl.style.cssText = 'font-size:11px;color:#777;white-space:nowrap;cursor:default;'
  const interpCb = document.createElement('input')
  interpCb.type = 'checkbox'
  interpCb.checked = !!page.interpOrder
  interpCb.title = interpLbl.title
  interpCb.style.cssText = 'width:13px;height:13px;cursor:pointer;accent-color:#6a8a6a;flex-shrink:0;'
  interpCb.addEventListener('click', async e => {
    e.stopPropagation()
    page.interpOrder = interpCb.checked
    await saveManifest()
  })
  durations.appendChild(interpLbl)
  durations.appendChild(interpCb)

  // Captioned checkbox
  const captionedLbl = document.createElement('span')
  captionedLbl.textContent = 'Captioned'
  captionedLbl.title = 'Show page caption as text overlay during video render'
  captionedLbl.style.cssText = 'font-size:11px;color:#777;white-space:nowrap;cursor:default;'
  const captionedCb = document.createElement('input')
  captionedCb.type = 'checkbox'
  captionedCb.checked = !!page.captioned
  captionedCb.title = captionedLbl.title
  captionedCb.style.cssText = 'width:13px;height:13px;cursor:pointer;accent-color:#6a8a6a;flex-shrink:0;'
  captionedCb.addEventListener('click', async e => {
    e.stopPropagation()
    page.captioned = captionedCb.checked
    await saveManifest()
  })
  durations.appendChild(captionedLbl)
  durations.appendChild(captionedCb)

  const actions = document.createElement('div')
  actions.className = 'page-actions'

  const editBtn = document.createElement('button')
  editBtn.className = 'page-btn'
  editBtn.textContent = 'Edit'
  editBtn.addEventListener('click', e => { e.stopPropagation(); loadPageInSketcher(page) })

  const dupBtn = document.createElement('button')
  dupBtn.className = 'page-btn'
  dupBtn.textContent = 'Dup'
  dupBtn.addEventListener('click', e => { e.stopPropagation(); duplicatePage(index) })

  const threeXBtn = document.createElement('button')
  threeXBtn.className = 'page-btn' + (page.threeX ? ' active' : '')
  threeXBtn.textContent = '3x'
  threeXBtn.title = 'Triple render for sketch flicker effect in video'
  threeXBtn.addEventListener('click', async e => {
    e.stopPropagation()
    page.threeX = !page.threeX
    threeXBtn.className = 'page-btn' + (page.threeX ? ' active' : '')
    await saveManifest()
  })

  const delBtn = document.createElement('button')
  delBtn.className = 'page-btn danger'
  delBtn.textContent = 'Del'
  delBtn.addEventListener('click', e => { e.stopPropagation(); deletePage(index) })

  actions.append(editBtn, dupBtn, threeXBtn, delBtn)
  item.append(selectCb, thumb, info, durations, actions)

  item.addEventListener('mousedown', (e) => {
    item.draggable = (e.target.tagName !== 'BUTTON' && e.target.tagName !== 'INPUT')
  })
  item.addEventListener('dragstart', (e) => {
    dragSrcIndex = index
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', String(index))
    setTimeout(() => item.classList.add('dragging'), 0)
  })
  item.addEventListener('dragend', () => {
    item.classList.remove('dragging')
    document.querySelectorAll('.page-item').forEach(el => el.classList.remove('drag-over'))
    dragSrcIndex = null
    dragOverIndex = null
  })
  item.addEventListener('dragenter', (e) => {
    e.preventDefault()
    if (dragSrcIndex === null || dragSrcIndex === index) return
    document.querySelectorAll('.page-item').forEach(el => el.classList.remove('drag-over'))
    item.classList.add('drag-over')
    dragOverIndex = index
  })
  item.addEventListener('dragover', (e) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
  })
  item.addEventListener('dragleave', (e) => {
    if (!item.contains(e.relatedTarget)) item.classList.remove('drag-over')
  })
  item.addEventListener('drop', async (e) => {
    e.preventDefault()
    e.stopPropagation()
    item.classList.remove('drag-over')
    if (dragSrcIndex === null || dragSrcIndex === index) return
    const src = dragSrcIndex
    dragSrcIndex = null
    dragOverIndex = null
    const pages = activeManifest.pages
    const moved = pages.splice(src, 1)[0]
    pages.splice(index, 0, moved)
    selectedPages = remapSelectedAfterDrag(selectedPages, src, index, pages.length)
    renderPagePanel()
    await saveManifest()
  })

  return item
}

function remapSelectedAfterDrag(selected, src, dst, total) {
  const next = new Set()
  selected.forEach(i => {
    if (i === src) { next.add(dst); return }
    let ni = i
    if (src < dst) { if (i > src && i <= dst) ni = i - 1 }
    else { if (i >= dst && i < src) ni = i + 1 }
    next.add(ni)
  })
  return next
}

// --- Manifest save ---

async function saveManifest() {
  try {
    await api('saveManifest', { bookName: activeBook, manifest: activeManifest })
    setCachedManifest(activeBook, JSON.parse(JSON.stringify(activeManifest)))
    setStatus('Saved')
  } catch (err) {
    setStatus(`Save error: ${err.message}`)
  }
}

// --- Page operations ---

async function createNewPage() {
  if (!activeManifest) return
  const id = generatePageId()
  const emptyPage = {
    canvasParams: { width: activeManifest.width, height: activeManifest.height, backgroundColor: '#f0ebe8' },
    marks: []
  }
  setStatus('Creating page...')
  try {
    await api('savePage', { bookName: activeBook, pageId: id, pageData: emptyPage })
    activeManifest.pages.push({ id, filename: `${id}.json`, caption: '', pageDuration: null, transitionDuration: null, bgColor: '#f0ebe8' })
    await saveManifest()
    renderPagePanel()
    setStatus(`Created ${id}`)
  } catch (err) {
    setStatus(`Error: ${err.message}`)
  }
}

async function duplicatePage(index) {
  if (!activeManifest) return
  const srcPage = activeManifest.pages[index]
  setStatus('Duplicating page...')
  try {
    const data = await api('getPage', { bookName: activeBook, pageId: srcPage.id })
    const newId = generatePageId()
    await api('savePage', { bookName: activeBook, pageId: newId, pageData: data.pageData })
    if (data.pageData.thumbnail) setCachedThumb(activeBook, newId, data.pageData.thumbnail)
    activeManifest.pages.splice(index + 1, 0, {
      ...srcPage, id: newId, filename: `${newId}.json`,
      caption: srcPage.caption ? `${srcPage.caption} (copy)` : ''
    })
    await saveManifest()
    renderPagePanel()
    setStatus(`Duplicated as ${newId}`)
  } catch (err) {
    setStatus(`Error: ${err.message}`)
  }
}

async function deletePage(index) {
  if (!activeManifest) return
  const page = activeManifest.pages[index]
  setStatus(`Deleting ${page.id}...`)
  try {
    await api('deletePage', { bookName: activeBook, pageId: page.id })
    clearCachedThumb(activeBook, page.id)
    activeManifest.pages.splice(index, 1)
    selectedPages.delete(index)
    const next = new Set()
    selectedPages.forEach(i => next.add(i > index ? i - 1 : i))
    selectedPages = next
    await saveManifest()
    renderPagePanel()
    setStatus(`Deleted ${page.id}`)
  } catch (err) {
    setStatus(`Error: ${err.message}`)
  }
}

function loadPageInSketcher(page) {
  localStorage.setItem('sketcher_load_page', JSON.stringify({ bookName: activeBook, pageId: page.id }))
  window.location.href = 'index.html'
}

function generatePageId() {
  return `${activeBook}_${Date.now().toString(36).toUpperCase()}`
}

// --- Render helpers ---

function renderPageToCanvas(pageJSON, targetCanvas) {
  const ctx = targetCanvas.getContext('2d')
  ctx.fillStyle = pageJSON.canvasParams.backgroundColor || '#f0ebe8'
  ctx.fillRect(0, 0, targetCanvas.width, targetCanvas.height)

  const masksByIndex = []
  pageJSON.marks.forEach((markData, i) => {
    if (markData.isMask && markData.points && markData.points.length >= 3) {
      masksByIndex.push({ index: i, polygon: markData.points.map(p => ({ x: p.x, y: p.y })) })
    }
  })

  pageJSON.marks.forEach((markData, i) => {
    try {
      const mark = Mark.fromJSON(markData)
      const maskPolygons = masksByIndex.filter(m => m.index > i).map(m => m.polygon)
      mark.render(1, false, targetCanvas, maskPolygons)
    } catch (err) {
      console.error('Error rendering mark:', err)
    }
  })
}

// Renders one transition frame using Page's shared interpolation logic.
// All color blending goes through pageInstance.interpolateColor for consistency
// with the live viewer's startTransition.
function renderTransitionFrame(fromJSON, toJSON, t, targetCanvas, pageInstance, interpOrder = false) {
  const fromMarks = fromJSON.marks.map(m => Mark.fromJSON(m))
  const toMarks = toJSON.marks.map(m => Mark.fromJSON(m))

  const fromBg = fromJSON.canvasParams.backgroundColor || '#f0ebe8'
  const toBg = toJSON.canvasParams.backgroundColor || '#f0ebe8'

  const ctx = targetCanvas.getContext('2d')
  ctx.fillStyle = pageInstance.lerpHexColor(fromBg, toBg, t)
  ctx.fillRect(0, 0, targetCanvas.width, targetCanvas.height)

  const { matchedPairs, unmatchedFromData, unmatchedToData } =
    pageInstance.buildTransitionData(fromMarks, toMarks, interpOrder)

  pageInstance.renderTransitionStep(
    fromMarks, toMarks,
    matchedPairs, unmatchedFromData, unmatchedToData,
    t, targetCanvas
  )
}

// --- PNG Export ---

async function exportPng() {
  if (selectedPages.size === 0 || !activeManifest) return
  const indices = [...selectedPages].sort((a, b) => a - b)
  setStatus(`Exporting ${indices.length} PNG(s)...`)

  const offscreen = document.createElement('canvas')
  offscreen.width = activeManifest.width
  offscreen.height = activeManifest.height

  for (const idx of indices) {
    const pageEntry = activeManifest.pages[idx]
    if (!pageEntry) continue
    try {
      const data = await api('getPage', { bookName: activeBook, pageId: pageEntry.id })
      renderPageToCanvas(data.pageData, offscreen)
      await new Promise(resolve => {
        offscreen.toBlob(blob => {
          const url = URL.createObjectURL(blob)
          const a = document.createElement('a')
          a.href = url
          a.download = `${pageEntry.id}.png`
          a.click()
          URL.revokeObjectURL(url)
          resolve()
        }, 'image/png')
      })
    } catch (err) {
      setStatus(`PNG export error: ${err.message}`)
      return
    }
  }
  setStatus(`Exported ${indices.length} PNG(s)`)
}

// --- Video Export ---

async function exportVideo() {
  if (!activeManifest || selectedPages.size === 0) return

  const allSelected = [...selectedPages].sort((a, b) => a - b)
  const selectedEntries = allSelected.map(i => activeManifest.pages[i]).filter(Boolean).slice(0, VIDEO_PAGE_LIMIT)
  const pageCount = selectedEntries.length

  if (allSelected.length > VIDEO_PAGE_LIMIT) setStatus(`Warning: only first ${VIDEO_PAGE_LIMIT} selected pages will be exported`)

  exportCancelled = false
  showProgress('Loading ffmpeg...', 0)

  try {
    if (!window.FFmpeg) {
      await new Promise((resolve, reject) => {
        const script = document.createElement('script')
        script.src = '/ffmpeg/ffmpeg.min.js'
        script.onload = resolve
        script.onerror = reject
        document.head.appendChild(script)
      })
    }

    const { createFFmpeg } = window.FFmpeg
    const ffmpeg = createFFmpeg({ corePath: `${window.location.origin}/ffmpeg/ffmpeg-core.js`, log: false })
    await ffmpeg.load()
    if (exportCancelled) return

    updateProgress('Fetching pages...', 5)
    const pageJSONs = []
    for (let i = 0; i < pageCount; i++) {
      if (exportCancelled) return
      const data = await api('getPage', { bookName: activeBook, pageId: selectedEntries[i].id })
      pageJSONs.push(data.pageData)
      updateProgress(`Fetching page ${i + 1} of ${pageCount}...`, 5 + (i / pageCount) * 15)
    }
    if (exportCancelled) return

    const FPS = 24
    const offscreen = document.createElement('canvas')
    offscreen.width = activeManifest.width
    offscreen.height = activeManifest.height

    // pageHelper provides access to Page's interpolation and transition methods
    const pageHelper = new Page('_offscreen_')
    pageHelper.canvasParams = { width: activeManifest.width, height: activeManifest.height, backgroundColor: '#f0ebe8' }

    let frameIndex = 0
    const totalFrames = calculateTotalFrames(selectedEntries, FPS)

    for (let p = 0; p < pageCount; p++) {
      if (exportCancelled) return

      const entry = selectedEntries[p]
      const pageDuration = entry.pageDuration ?? activeManifest.defaultPageDuration
      const transDuration = entry.transitionDuration ?? activeManifest.defaultTransitionDuration
      const pageFrames = Math.round(pageDuration * FPS)
      const transFrames = Math.round(transDuration * FPS)
      const captionFontSize = activeManifest.captionFontSize || 24
      const pageCaption = (entry.captioned && entry.caption) ? entry.caption : null

      updateProgress(`Rendering page ${p + 1} of ${pageCount}...`, 20 + (frameIndex / totalFrames) * 60)

      let pageVariants
      if (entry.threeX) {
        pageVariants = []
        for (let v = 0; v < 3; v++) {
          renderPageToCanvas(pageJSONs[p], offscreen)
          if (pageCaption) await drawCaption(offscreen, pageCaption, captionFontSize)
          pageVariants.push(new Uint8Array(await (await canvasToBlob(offscreen)).arrayBuffer()))
        }
      } else {
        renderPageToCanvas(pageJSONs[p], offscreen)
        if (pageCaption) await drawCaption(offscreen, pageCaption, captionFontSize)
        pageVariants = [new Uint8Array(await (await canvasToBlob(offscreen)).arrayBuffer())]
      }

      for (let f = 0; f < pageFrames; f++) {
        if (exportCancelled) return
        ffmpeg.FS('writeFile', `frame${String(frameIndex).padStart(6, '0')}.png`, pageVariants[entry.threeX ? Math.floor(f / 2) % 3 : 0])
        frameIndex++
      }

      if (p < pageCount - 1) {
        updateProgress(`Rendering transition ${p + 1} → ${p + 2}...`, 20 + (frameIndex / totalFrames) * 60)
        const interpOrder = !!selectedEntries[p].interpOrder
        for (let f = 0; f < transFrames; f++) {
          if (exportCancelled) return
          const t = transFrames <= 1 ? 1 : f / (transFrames - 1)
          renderTransitionFrame(pageJSONs[p], pageJSONs[p + 1], t, offscreen, pageHelper, interpOrder)
          const transData = new Uint8Array(await (await canvasToBlob(offscreen)).arrayBuffer())
          ffmpeg.FS('writeFile', `frame${String(frameIndex).padStart(6, '0')}.png`, transData)
          frameIndex++
        }
      }
    }

    if (exportCancelled) return
    updateProgress('Encoding video...', 80)

    await ffmpeg.run('-framerate', String(FPS), '-i', 'frame%06d.png', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '23', '-movflags', '+faststart', `${activeManifest.name}.mp4`)

    updateProgress('Preparing download...', 95)
    const output = ffmpeg.FS('readFile', `${activeManifest.name}.mp4`)
    const blob = new Blob([output.buffer], { type: 'video/mp4' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${activeManifest.name}.mp4`
    a.click()
    URL.revokeObjectURL(url)

    hideProgress()
    setStatus('Video exported successfully')

  } catch (err) {
    hideProgress()
    setStatus(`Video export error: ${err.message}`)
    console.error(err)
  }
}

function calculateTotalFrames(entries, fps) {
  return entries.reduce((total, entry, p) => {
    total += Math.round((entry.pageDuration ?? activeManifest.defaultPageDuration) * fps)
    if (p < entries.length - 1) {
      total += Math.round((entry.transitionDuration ?? activeManifest.defaultTransitionDuration) * fps)
    }
    return total
  }, 0)
}

function canvasToBlob(canvas) {
  return new Promise(resolve => canvas.toBlob(resolve, 'image/png'))
}

// Load the custom font once for canvas use in video export.
let _customFontLoaded = false
async function ensureCustomFont() {
  if (_customFontLoaded) return
  try {
    const font = new FontFace('OldNewspaperTypes', 'url(/font/OldNewspaperTypes-Regular.ttf)')
    await font.load()
    document.fonts.add(font)
    _customFontLoaded = true
  } catch (e) {
    console.warn('Could not load OldNewspaperTypes font:', e)
  }
}

// Draw caption text onto a canvas context.
async function drawCaption(canvas, caption, fontSize) {
  if (!caption) return
  await ensureCustomFont()
  const ctx = canvas.getContext('2d')
  const size = Math.max(8, fontSize || 24)
  const lineHeight = size * 1.3
  const lines = caption.replace(/\|/g, '\n').split('\n')
  ctx.save()
  ctx.font = `${size}px OldNewspaperTypes, Arial`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'bottom'
  const x = canvas.width / 2
  const blockHeight = lines.length * lineHeight
  ctx.shadowColor = 'rgba(255,255,255,0.8)'
  ctx.shadowBlur = size * 0.4
  ctx.fillStyle = 'black'
  lines.forEach((line, i) => {
    const y = canvas.height - Math.round(size * 0.4) - (lines.length - 1 - i) * lineHeight
    ctx.fillText(line, x, y)
  })
  ctx.shadowBlur = 0
  ctx.restore()
}

// --- Book creation ---

function openNewBookModal() {
  document.getElementById('modalBookName').value = ''
  document.getElementById('modal').classList.add('visible')
}

document.getElementById('modalCancel').addEventListener('click', () => {
  document.getElementById('modal').classList.remove('visible')
})

document.getElementById('modalConfirm').addEventListener('click', async () => {
  const name = document.getElementById('modalBookName').value.trim().replace(/\s+/g, '_')
  const format = document.getElementById('modalFormat').value
  if (!name) return
  document.getElementById('modal').classList.remove('visible')
  setStatus(`Creating book ${name}...`)
  try {
    await api('createBook', { bookName: name, format })
    const cache = loadCache()
    cache._books = [...(cache._books || []), name]
    saveCache(cache)
    books.push(name)
    renderBookList()
    await selectBook(name)
    setStatus(`Book ${name} created`)
  } catch (err) {
    setStatus(`Error: ${err.message}`)
  }
})

document.getElementById('saveBookSettingsBtn').addEventListener('click', async () => {
  if (!activeManifest) return
  activeManifest.defaultPageDuration = parseFloat(document.getElementById('defaultPageDuration').value) || 5
  activeManifest.defaultTransitionDuration = parseFloat(document.getElementById('defaultTransDuration').value) || 1
  activeManifest.captionFontSize = parseInt(document.getElementById('captionFontSize').value) || 24
  await saveManifest()
})

document.getElementById('newBookBtn').addEventListener('click', openNewBookModal)
document.getElementById('newPageBtn').addEventListener('click', createNewPage)

document.getElementById('refreshBtn').addEventListener('click', async () => {
  const cache = loadCache()
  delete cache._books
  if (activeBook) delete cache[activeBook]
  saveCache(cache)
  await loadBooks(true)
  if (activeBook) await selectBook(activeBook)
})

document.getElementById('openSketcherBtn').addEventListener('click', () => { window.location.href = 'index.html' })
document.getElementById('openViewerBtn').addEventListener('click', () => {
  window.location.href = activeBook ? `viewer.html?book=${encodeURIComponent(activeBook)}` : 'viewer.html'
})

document.getElementById('exportPngBtn').addEventListener('click', exportPng)
document.getElementById('exportVideoBtn').addEventListener('click', exportVideo)

const style = document.createElement('style')
style.textContent = `.page-item.selected { border-color: #6a8a6a; background: #333; }`
document.head.appendChild(style)

document.getElementById('selectAllBtn').addEventListener('click', () => {
  if (!activeManifest) return
  activeManifest.pages.forEach((_, i) => selectedPages.add(i))
  updateSelectionUI()
})
document.getElementById('deselectAllBtn').addEventListener('click', () => {
  selectedPages.clear()
  updateSelectionUI()
})

async function init() {
  const saved = localStorage.getItem(ACTIVE_BOOK_KEY)
  await loadBooks()
  if (saved && books.includes(saved)) await selectBook(saved)
}

init()
