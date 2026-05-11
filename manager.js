import { Mark } from './mark.js'
import { Page } from './page.js'
 
const CACHE_KEY = 'sketcher_manager_cache'
const ACTIVE_BOOK_KEY = 'sketcher_active_book'
const VIDEO_PAGE_LIMIT = 20

let books = []
let activeBook = null
let activeManifest = null
let dragSrcIndex = null
let selectedPageIndex = null
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
  try {
    return JSON.parse(localStorage.getItem(CACHE_KEY) || '{}')
  } catch { return {} }
}

function saveCache(cache) {
  localStorage.setItem(CACHE_KEY, JSON.stringify(cache))
}

function getCachedManifest(bookName) {
  const cache = loadCache()
  return cache[bookName] || null
}

function setCachedManifest(bookName, manifest) {
  const cache = loadCache()
  cache[bookName] = manifest
  saveCache(cache)
}

// --- Status ---

function setStatus(msg) {
  document.getElementById('statusBar').textContent = msg
}

// --- Progress ---

function showProgress(label, percent) {
  const container = document.getElementById('progressContainer')
  container.classList.add('visible')
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
  selectedPageIndex = null
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
  const exportPngBtn = document.getElementById('exportPngBtn')
  const exportVideoBtn = document.getElementById('exportVideoBtn')

  title.textContent = activeManifest.name
  bookSettings.style.display = 'flex'
  document.getElementById('defaultPageDuration').value = activeManifest.defaultPageDuration
  document.getElementById('defaultTransDuration').value = activeManifest.defaultTransitionDuration

  emptyState.style.display = activeManifest.pages.length === 0 ? 'flex' : 'none'
  pageList.style.display = activeManifest.pages.length > 0 ? 'flex' : 'none'
  newPageBtn.style.display = 'block'
  exportPngBtn.disabled = selectedPageIndex === null
  exportVideoBtn.disabled = activeManifest.pages.length === 0

  pageList.innerHTML = ''
  activeManifest.pages.forEach((page, index) => {
    pageList.appendChild(createPageItem(page, index))
  })

  // Kick off background thumbnail loading
  loadThumbnailsInBackground()
}

// --- Thumbnail lazy loader ---

let _thumbLoadId = 0

async function loadThumbnailsInBackground() {
  if (!activeManifest || !activeBook) return
  const runId = ++_thumbLoadId
  const pages = activeManifest.pages

  for (let i = 0; i < pages.length; i++) {
    if (runId !== _thumbLoadId) return
    const page = pages[i]
    try {
      const data = await api('getPage', { bookName: activeBook, pageId: page.id })
      if (runId !== _thumbLoadId) return
      const thumbnail = data.pageData && data.pageData.thumbnail
      if (thumbnail) {
        const thumbDiv = document.querySelector(`.page-thumb[data-page-id="${page.id}"]`)
        if (thumbDiv) {
          const img = thumbDiv.querySelector('img')
          if (img) {
            img.src = thumbnail
            img.style.display = 'block'
            thumbDiv.style.background = 'none'
          }
        }
      }
    } catch (err) {
      console.warn(`Thumbnail load failed for ${page.id}:`, err)
    }
  }
}

function createPageItem(page, index) {
  const item = document.createElement('div')
  item.className = 'page-item' + (selectedPageIndex === index ? ' selected' : '')
  item.draggable = true
  item.dataset.index = index

  item.addEventListener('click', (e) => {
    if (e.target.tagName === 'BUTTON' || e.target.tagName === 'INPUT') return
    selectedPageIndex = index
    document.getElementById('exportPngBtn').disabled = false
    document.querySelectorAll('.page-item').forEach((el, i) => {
      el.classList.toggle('selected', i === index)
    })
  })

  // Thumbnail — size based on book orientation, long edge = 48px
  const THUMB_LONG = 48
  const isPortrait = activeManifest.height >= activeManifest.width
  const thumbW = isPortrait ? Math.round(THUMB_LONG * activeManifest.width / activeManifest.height) : THUMB_LONG
  const thumbH = isPortrait ? THUMB_LONG : Math.round(THUMB_LONG * activeManifest.height / activeManifest.width)

  const thumb = document.createElement('div')
  thumb.className = 'page-thumb'
  thumb.style.background = page.bgColor || '#f0ebe8'
  thumb.style.width = `${thumbW}px`
  thumb.style.height = `${thumbH}px`
  thumb.dataset.pageId = page.id

  const thumbImg = document.createElement('img')
  thumbImg.style.cssText = 'width:100%;height:100%;object-fit:cover;border-radius:3px;display:none;'
  thumb.appendChild(thumbImg)

  // Info
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

  info.appendChild(captionDisplay)
  info.appendChild(meta)

  // Durations
  const durations = document.createElement('div')
  durations.className = 'page-durations'

  const pageDurLabel = document.createElement('span')
  pageDurLabel.textContent = 'pg:'
  const pageDurInput = document.createElement('input')
  pageDurInput.type = 'number'
  pageDurInput.value = page.pageDuration ?? ''
  pageDurInput.placeholder = activeManifest.defaultPageDuration
  pageDurInput.title = 'Page duration (s)'
  pageDurInput.addEventListener('click', e => e.stopPropagation())
  pageDurInput.addEventListener('change', async () => {
    page.pageDuration = pageDurInput.value === '' ? null : parseFloat(pageDurInput.value)
    await saveManifest()
  })

  const transDurLabel = document.createElement('span')
  transDurLabel.textContent = 'tr:'
  const transDurInput = document.createElement('input')
  transDurInput.type = 'number'
  transDurInput.value = page.transitionDuration ?? ''
  transDurInput.placeholder = activeManifest.defaultTransitionDuration
  transDurInput.title = 'Transition duration (s)'
  transDurInput.addEventListener('click', e => e.stopPropagation())
  transDurInput.addEventListener('change', async () => {
    page.transitionDuration = transDurInput.value === '' ? null : parseFloat(transDurInput.value)
    await saveManifest()
  })

  durations.append(pageDurLabel, pageDurInput, transDurLabel, transDurInput)

  // Actions
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
  item.append(thumb, info, durations, actions)

  // Drag and drop
  item.addEventListener('dragstart', (e) => {
    dragSrcIndex = index
    item.classList.add('dragging')
    e.dataTransfer.effectAllowed = 'move'
  })
  item.addEventListener('dragend', () => {
    item.classList.remove('dragging')
    document.querySelectorAll('.page-item').forEach(el => el.classList.remove('drag-over'))
  })
  item.addEventListener('dragover', (e) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    document.querySelectorAll('.page-item').forEach(el => el.classList.remove('drag-over'))
    item.classList.add('drag-over')
  })
  item.addEventListener('drop', async (e) => {
    e.preventDefault()
    if (dragSrcIndex === null || dragSrcIndex === index) return
    const pages = activeManifest.pages
    const moved = pages.splice(dragSrcIndex, 1)[0]
    pages.splice(index, 0, moved)
    dragSrcIndex = null
    renderPagePanel()
    await saveManifest()
  })

  return item
}

// --- Manifest save ---

async function saveManifest() {
  try {
    await api('saveManifest', { bookName: activeBook, manifest: activeManifest })
    setCachedManifest(activeBook, activeManifest)
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
    canvasParams: {
      width: activeManifest.width,
      height: activeManifest.height,
      backgroundColor: '#f0ebe8'
    },
    marks: []
  }
  setStatus('Creating page...')
  try {
    await api('savePage', { bookName: activeBook, pageId: id, pageData: emptyPage })
    activeManifest.pages.push({
      id,
      filename: `${id}.json`,
      caption: '',
      pageDuration: null,
      transitionDuration: null,
      bgColor: '#f0ebe8'
    })
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
    const newEntry = {
      ...srcPage,
      id: newId,
      filename: `${newId}.json`,
      caption: srcPage.caption ? `${srcPage.caption} (copy)` : ''
    }
    activeManifest.pages.splice(index + 1, 0, newEntry)
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
    activeManifest.pages.splice(index, 1)
    if (selectedPageIndex === index) selectedPageIndex = null
    await saveManifest()
    renderPagePanel()
    setStatus(`Deleted ${page.id}`)
  } catch (err) {
    setStatus(`Error: ${err.message}`)
  }
}

function loadPageInSketcher(page) {
  localStorage.setItem('sketcher_load_page', JSON.stringify({
    bookName: activeBook,
    pageId: page.id
  }))
  window.location.href = 'index.html'
}

function generatePageId() {
  const ts = Date.now().toString(36).toUpperCase()
  return `${activeBook}_${ts}`
}

// --- Render helpers ---

function renderPageToCanvas(pageJSON, targetCanvas) {
  const ctx = targetCanvas.getContext('2d')
  const bg = pageJSON.canvasParams.backgroundColor || '#f0ebe8'
  ctx.fillStyle = bg
  ctx.fillRect(0, 0, targetCanvas.width, targetCanvas.height)

  // Pass 1: collect mask polygons with their index
  const masksByIndex = []
  pageJSON.marks.forEach((markData, i) => {
    if (markData.isMask && markData.points && markData.points.length >= 3) {
      masksByIndex.push({ index: i, polygon: markData.points.map(p => ({ x: p.x, y: p.y })) })
    }
  })

  // Pass 2: render each mark with only masks that appear after it
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

function renderTransitionFrame(fromJSON, toJSON, t, targetCanvas, pageInstance) {
  // Uses Page's transition helpers synchronously for a single frame
  const fromMarks = fromJSON.marks.map(m => Mark.fromJSON(m))
  const toMarks = toJSON.marks.map(m => Mark.fromJSON(m))

  const fromBg = fromJSON.canvasParams.backgroundColor || '#f0ebe8'
  const toBg = toJSON.canvasParams.backgroundColor || '#f0ebe8'

  const ctx = targetCanvas.getContext('2d')
  ctx.fillStyle = pageInstance.lerpHexColor(fromBg, toBg, t)
  ctx.fillRect(0, 0, targetCanvas.width, targetCanvas.height)

  const { matched, unmatchedFrom, unmatchedTo } = pageInstance.matchMarks(fromMarks, toMarks)

  matched.forEach(({ fromIdx, toIdx }) => {
    const from = fromMarks[fromIdx]
    const to = toMarks[toIdx]
    const targetCount = Math.max(from.points.length, to.points.length)
    const fromPts = pageInstance.resamplePoints(from.points, targetCount)
    const toPts = pageInstance.resamplePoints(to.points, targetCount)
    const interpPoints = pageInstance.interpolatePoints(fromPts, toPts, t)
    const color = pageInstance.interpolateColor(from.color, to.color, t)
    const width = from.markWidth + (to.markWidth - from.markWidth) * t
    const hatch = from.hatchAngle + (to.hatchAngle - from.hatchAngle) * t
    const tempMark = Mark.fromJSON({
      ...to.toJSON(),
      color,
      markWidth: width,
      hatchAngle: hatch,
      points: interpPoints,
      alpha: 1
    })
    tempMark.render(1, false, targetCanvas)
  })

  unmatchedFrom.forEach(fromIdx => {
    const fromMark = fromMarks[fromIdx]
    const target = pageInstance.nearestToCentroid(fromMark, toMarks, matched)
    const targetPoints = fromMark.points.map(() => ({ x: target.x, y: target.y, visible: true }))
    const interpPoints = pageInstance.interpolatePoints(fromMark.points, targetPoints, t)
    const tempMark = Mark.fromJSON({ ...fromMark.toJSON(), points: interpPoints, alpha: 1 - t })
    tempMark.render(1, false, targetCanvas)
  })

  unmatchedTo.forEach(toIdx => {
    const toMark = toMarks[toIdx]
    const source = pageInstance.nearestFromCentroid(toMark, fromMarks, matched)
    const sourcePoints = toMark.points.map(() => ({ x: source.x, y: source.y, visible: true }))
    const interpPoints = pageInstance.interpolatePoints(sourcePoints, toMark.points, t)
    const tempMark = Mark.fromJSON({ ...toMark.toJSON(), points: interpPoints, alpha: t })
    tempMark.render(1, false, targetCanvas)
  })
}

// --- PNG Export ---

async function exportPng() {
  if (selectedPageIndex === null || !activeManifest) return
  const pageEntry = activeManifest.pages[selectedPageIndex]
  setStatus('Fetching page...')

  try {
    const data = await api('getPage', { bookName: activeBook, pageId: pageEntry.id })
    const offscreen = document.createElement('canvas')
    offscreen.width = activeManifest.width
    offscreen.height = activeManifest.height
    renderPageToCanvas(data.pageData, offscreen)

    offscreen.toBlob(blob => {
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${pageEntry.id}.png`
      a.click()
      URL.revokeObjectURL(url)
      setStatus('PNG exported')
    }, 'image/png')
  } catch (err) {
    setStatus(`PNG export error: ${err.message}`)
  }
}

// --- Video Export ---

async function exportVideo() {
  if (!activeManifest || activeManifest.pages.length === 0) return

  const pageCount = Math.min(activeManifest.pages.length, VIDEO_PAGE_LIMIT)
  if (activeManifest.pages.length > VIDEO_PAGE_LIMIT) {
    setStatus(`Warning: only first ${VIDEO_PAGE_LIMIT} pages will be exported`)
  }

  exportCancelled = false
  showProgress('Loading ffmpeg...', 0)

  let ffmpeg

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
    ffmpeg = createFFmpeg({
      corePath: `${window.location.origin}/ffmpeg/ffmpeg-core.js`,
      log: false
    })

    await ffmpeg.load()

    if (exportCancelled) return

    updateProgress('Fetching pages...', 5)

    // Fetch all page JSONs
    const pageJSONs = []
    for (let i = 0; i < pageCount; i++) {
      if (exportCancelled) return
      const entry = activeManifest.pages[i]
      const data = await api('getPage', { bookName: activeBook, pageId: entry.id })
      pageJSONs.push(data.pageData)
      updateProgress(`Fetching page ${i + 1} of ${pageCount}...`, 5 + (i / pageCount) * 15)
    }

    if (exportCancelled) return

    const FPS = 24
    const offscreen = document.createElement('canvas')
    offscreen.width = activeManifest.width
    offscreen.height = activeManifest.height

    const pageHelper = new Page('_offscreen_')
    pageHelper.canvasParams = {
      width: activeManifest.width,
      height: activeManifest.height,
      backgroundColor: '#f0ebe8'
    }

    let frameIndex = 0
    const totalFrames = calculateTotalFrames(pageCount, FPS)

    for (let p = 0; p < pageCount; p++) {
      if (exportCancelled) return

      const entry = activeManifest.pages[p]
      const pageDuration = entry.pageDuration ?? activeManifest.defaultPageDuration
      const transDuration = entry.transitionDuration ?? activeManifest.defaultTransitionDuration
      const pageFrames = Math.round(pageDuration * FPS)
      const transFrames = Math.round(transDuration * FPS)

      updateProgress(
        `Rendering page ${p + 1} of ${pageCount}...`,
        20 + (frameIndex / totalFrames) * 60
      )

      // Render page — 3 variants if threeX enabled, otherwise just one
      let pageVariants
      if (entry.threeX) {
        pageVariants = []
        for (let v = 0; v < 3; v++) {
          renderPageToCanvas(pageJSONs[p], offscreen)
          const blob = await canvasToBlob(offscreen)
          pageVariants.push(new Uint8Array(await blob.arrayBuffer()))
        }
      } else {
        renderPageToCanvas(pageJSONs[p], offscreen)
        const blob = await canvasToBlob(offscreen)
        pageVariants = [new Uint8Array(await blob.arrayBuffer())]
      }

      // Write page hold frames; if threeX cycle A,A,B,B,C,C
      for (let f = 0; f < pageFrames; f++) {
        if (exportCancelled) return
        const variantIndex = entry.threeX ? Math.floor(f / 2) % 3 : 0
        const fname = `frame${String(frameIndex).padStart(6, '0')}.png`
        ffmpeg.FS('writeFile', fname, pageVariants[variantIndex])
        frameIndex++
      }

      // Render transition to next page
      if (p < pageCount - 1) {
        updateProgress(
          `Rendering transition ${p + 1} → ${p + 2}...`,
          20 + (frameIndex / totalFrames) * 60
        )

        for (let f = 0; f < transFrames; f++) {
          if (exportCancelled) return
          const t = transFrames <= 1 ? 1 : f / (transFrames - 1)
          renderTransitionFrame(
            pageJSONs[p],
            pageJSONs[p + 1],
            t,
            offscreen,
            pageHelper
          )
          const transBlob = await canvasToBlob(offscreen)
          const transData = new Uint8Array(await transBlob.arrayBuffer())
          const fname = `frame${String(frameIndex).padStart(6, '0')}.png`
          ffmpeg.FS('writeFile', fname, transData)
          frameIndex++
        }
      }
    }

    if (exportCancelled) return
    updateProgress('Encoding video...', 80)

    await ffmpeg.run(
      '-framerate', String(FPS),
      '-i', 'frame%06d.png',
      '-c:v', 'libx264',
      '-pix_fmt', 'yuv420p',
      '-crf', '23',
      '-movflags', '+faststart',
      `${activeManifest.name}.mp4`
    )

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

function calculateTotalFrames(pageCount, fps, transSteps) {
  let total = 0
  for (let p = 0; p < pageCount; p++) {
    const entry = activeManifest.pages[p]
    const pageDuration = entry.pageDuration ?? activeManifest.defaultPageDuration
    total += Math.round(pageDuration * fps)
    if (p < pageCount - 1) {
      const transDuration = entry.transitionDuration ?? activeManifest.defaultTransitionDuration
      total += Math.round(transDuration * fps)
    }
  }
  return total
}

function canvasToBlob(canvas) {
  return new Promise(resolve => canvas.toBlob(resolve, 'image/png'))
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
  const orientation = document.getElementById('modalOrientation').value
  if (!name) return
  document.getElementById('modal').classList.remove('visible')
  setStatus(`Creating book ${name}...`)
  try {
    await api('createBook', { bookName: name, orientation })
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

// --- Book settings ---

document.getElementById('saveBookSettingsBtn').addEventListener('click', async () => {
  if (!activeManifest) return
  activeManifest.defaultPageDuration = parseFloat(
    document.getElementById('defaultPageDuration').value
  ) || 5
  activeManifest.defaultTransitionDuration = parseFloat(
    document.getElementById('defaultTransDuration').value
  ) || 1
  await saveManifest()
})

// --- Navbar ---

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

document.getElementById('openSketcherBtn').addEventListener('click', () => {
  window.location.href = 'index.html'
})

document.getElementById('openViewerBtn').addEventListener('click', () => {
  if (activeBook) {
    window.location.href = `viewer.html?book=${encodeURIComponent(activeBook)}`
  } else {
    window.location.href = 'viewer.html'
  }
})

document.getElementById('exportPngBtn').addEventListener('click', exportPng)
document.getElementById('exportVideoBtn').addEventListener('click', exportVideo)

// --- Selected page style ---
const style = document.createElement('style')
style.textContent = `.page-item.selected { border-color: #6a8a6a; background: #333; }`
document.head.appendChild(style)

// --- Init ---

async function init() {
  const saved = localStorage.getItem(ACTIVE_BOOK_KEY)
  await loadBooks()
  if (saved && books.includes(saved)) {
    await selectBook(saved)
  }
}

init()