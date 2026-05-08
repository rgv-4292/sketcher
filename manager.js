const CACHE_KEY = 'sketcher_manager_cache'
const ACTIVE_BOOK_KEY = 'sketcher_active_book'

let books = []
let activeBook = null
let activeManifest = null
let dragSrcIndex = null

// --- API ---

async function api (operation, params = {}) {
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

function loadCache () {
  try {
    return JSON.parse(localStorage.getItem(CACHE_KEY) || '{}')
  } catch { return {} }
}

function saveCache (cache) {
  localStorage.setItem(CACHE_KEY, JSON.stringify(cache))
}

function getCachedManifest (bookName) {
  const cache = loadCache()
  return cache[bookName] || null
}

function setCachedManifest (bookName, manifest) {
  const cache = loadCache()
  cache[bookName] = manifest
  saveCache(cache)
}

// --- Status ---

function setStatus (msg) {
  document.getElementById('statusBar').textContent = msg
}

// --- Book list ---

async function loadBooks (forceRefresh = false) {
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

function renderBookList () {
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

async function selectBook (name) {
  activeBook = name
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

function renderPagePanel () {
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
  exportPngBtn.disabled = activeManifest.pages.length === 0
  exportVideoBtn.disabled = activeManifest.pages.length === 0

  pageList.innerHTML = ''
  activeManifest.pages.forEach((page, index) => {
    pageList.appendChild(createPageItem(page, index))
  })
}

function createPageItem (page, index) {
  const item = document.createElement('div')
  item.className = 'page-item'
  item.draggable = true
  item.dataset.index = index

  // Thumbnail placeholder
  const thumb = document.createElement('div')
  thumb.className = 'page-thumb'
  thumb.style.background = activeManifest.pages[index].bgColor ||
    (activeManifest.orientation === 'landscape' ? '#1a1a2e' : '#f0ebe8')
  thumb.textContent = index + 1
  thumb.style.color = '#888'

  // Info
  const info = document.createElement('div')
  info.className = 'page-info'

  const captionDisplay = document.createElement('div')
  captionDisplay.className = 'page-caption'
  captionDisplay.textContent = page.caption || `Page ${index + 1}`
  captionDisplay.title = 'Click to edit'
  captionDisplay.addEventListener('click', () => {
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
  editBtn.title = 'Load in Sketcher'
  editBtn.addEventListener('click', () => loadPageInSketcher(page))

  const dupBtn = document.createElement('button')
  dupBtn.className = 'page-btn'
  dupBtn.textContent = 'Dup'
  dupBtn.title = 'Duplicate page'
  dupBtn.addEventListener('click', () => duplicatePage(index))

  const delBtn = document.createElement('button')
  delBtn.className = 'page-btn danger'
  delBtn.textContent = 'Del'
  delBtn.title = 'Delete page'
  delBtn.addEventListener('click', () => deletePage(index))

  actions.append(editBtn, dupBtn, delBtn)

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

async function saveManifest () {
  try {
    await api('saveManifest', {
      bookName: activeBook,
      manifest: activeManifest
    })
    setCachedManifest(activeBook, activeManifest)
    setStatus('Saved')
  } catch (err) {
    setStatus(`Save error: ${err.message}`)
  }
}

// --- Page operations ---

async function createNewPage () {
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
    await api('savePage', {
      bookName: activeBook,
      pageId: id,
      pageData: emptyPage
    })
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

async function duplicatePage (index) {
  if (!activeManifest) return
  const srcPage = activeManifest.pages[index]
  setStatus('Loading page to duplicate...')
  try {
    const data = await api('getPage', {
      bookName: activeBook,
      pageId: srcPage.id
    })
    const newId = generatePageId()
    await api('savePage', {
      bookName: activeBook,
      pageId: newId,
      pageData: data.pageData
    })
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

async function deletePage (index) {
  if (!activeManifest) return
  const page = activeManifest.pages[index]
  setStatus(`Deleting ${page.id}...`)
  try {
    await api('deletePage', {
      bookName: activeBook,
      pageId: page.id
    })
    activeManifest.pages.splice(index, 1)
    await saveManifest()
    renderPagePanel()
    setStatus(`Deleted ${page.id}`)
  } catch (err) {
    setStatus(`Error: ${err.message}`)
  }
}

function loadPageInSketcher (page) {
  localStorage.setItem('sketcher_load_page', JSON.stringify({
    bookName: activeBook,
    pageId: page.id
  }))
  window.location.href = 'index.html'
}

function generatePageId () {
  const ts = Date.now().toString(36).toUpperCase()
  return `${activeBook}_${ts}`
}

// --- Book creation ---

function openNewBookModal () {
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
    const data = await api('createBook', { bookName: name, orientation })
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

// --- Navbar buttons ---

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

document.getElementById('exportPngBtn').addEventListener('click', () => {
  setStatus('PNG export coming soon')
})

document.getElementById('exportVideoBtn').addEventListener('click', () => {
  setStatus('Video export coming soon')
})

// --- Init ---

async function init () {
  const saved = localStorage.getItem(ACTIVE_BOOK_KEY)
  await loadBooks()
  if (saved && books.includes(saved)) {
    await selectBook(saved)
  }
}

init()