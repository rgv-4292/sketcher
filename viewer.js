import { Mark } from './mark.js'
import { Page } from './page.js'

function getBookFromURL () {
  const params = new URLSearchParams(window.location.search)
  return params.get('book') || null
}

function getCookieKey (bookName) {
  return bookName ? `currentIndex_${bookName}` : 'currentIndex'
}

function setCookie (name, value, days) {
  let expires = ''
  if (days) {
    const date = new Date()
    date.setTime(date.getTime() + days * 24 * 60 * 60 * 1000)
    expires = '; expires=' + date.toUTCString()
  }
  document.cookie = name + '=' + (value || '') + expires + '; path=/'
}

function getCookie (name) {
  const nameEQ = name + '='
  const ca = document.cookie.split(';')
  for (let i = 0; i < ca.length; i++) {
    let c = ca[i]
    while (c.charAt(0) === ' ') c = c.substring(1)
    if (c.indexOf(nameEQ) === 0) return c.substring(nameEQ.length)
  }
  return null
}

document.addEventListener('DOMContentLoaded', async () => {
  const bookName = getBookFromURL()
  const cookieKey = getCookieKey(bookName)
  const page = new Page('myCanvas')

  // Load from book manifest or fall back to legacy flat folder
  if (bookName) {
    await runBookViewer(bookName, cookieKey, page)
  } else {
    await runLegacyViewer(cookieKey, page)
  }
})

async function runBookViewer (bookName, cookieKey, page) {
  let manifest = null

  try {
    const res = await fetch('/.netlify/functions/github', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ operation: 'getManifest', bookName })
    })
    const data = await res.json()
    manifest = data.manifest
  } catch (err) {
    console.error('Could not load manifest:', err)
    return
  }

  if (!manifest || manifest.pages.length === 0) return

  // Resize canvas to match book orientation
  const canvas = document.getElementById('myCanvas')
  canvas.width = manifest.width
  canvas.height = manifest.height
  page.canvasParams.width = manifest.width
  page.canvasParams.height = manifest.height

  let currentIndex = parseInt(getCookie(cookieKey)) || 0
  if (currentIndex >= manifest.pages.length) currentIndex = 0

  async function loadPage (index) {
    const pageEntry = manifest.pages[index]
    try {
      const res = await fetch('/.netlify/functions/github', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          operation: 'getPage',
          bookName,
          pageId: pageEntry.id
        })
      })
      const data = await res.json()
      page.startTransition(data.pageData, !!pageEntry.interpOrder)
      setCookie(cookieKey, index, 7)
    } catch (err) {
      console.error('Error loading page:', err)
    }
  }

  await loadPage(currentIndex)

  document.addEventListener('click', async (event) => {
    const pageWidth = window.innerWidth
    if (event.clientX < pageWidth / 2) {
      currentIndex = currentIndex <= 0 ? manifest.pages.length - 1 : currentIndex - 1
    } else {
      currentIndex = (currentIndex + 1) % manifest.pages.length
    }
    await loadPage(currentIndex)
  })
}

async function runLegacyViewer (cookieKey, page) {
  const jsonFolderPath = './json/'
  let currentIndex = parseInt(getCookie(cookieKey)) || 1

  async function loadAndRenderJson (index) {
    const jsonFileName = `Page_${index.toString().padStart(6, '0')}.json`
    const jsonFilePath = `${jsonFolderPath}${jsonFileName}`
    try {
      const jsonResponse = await fetch(jsonFilePath)
      if (!jsonResponse.ok) {
        currentIndex = Math.max(1, --currentIndex)
        return await loadAndRenderJson(currentIndex)
      }
      const jsonData = await jsonResponse.json()
      page.startTransition(jsonData)
      setCookie(cookieKey, currentIndex, 7)
    } catch (error) {
      console.error('Error loading JSON:', error)
    }
  }

  await loadAndRenderJson(currentIndex)

  document.addEventListener('click', async (event) => {
    const pageWidth = window.innerWidth
    if (event.clientX < pageWidth / 2) {
      currentIndex = Math.max(1, currentIndex - 1)
    } else {
      currentIndex++
    }
    await loadAndRenderJson(currentIndex)
  })
}