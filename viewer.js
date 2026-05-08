import { Mark } from './mark.js'
import { Page } from './page.js'

function setCookie(name, value, days) {
  let expires = ''
  if (days) {
    const date = new Date()
    date.setTime(date.getTime() + days * 24 * 60 * 60 * 1000)
    expires = '; expires=' + date.toUTCString()
  }
  document.cookie = name + '=' + (value || '') + expires + '; path=/'
}

function getCookie(name) {
  const nameEQ = name + '='
  const ca = document.cookie.split(';')
  for (let i = 0; i < ca.length; i++) {
    let c = ca[i]
    while (c.charAt(0) == ' ') c = c.substring(1, c.length)
    if (c.indexOf(nameEQ) == 0) return c.substring(nameEQ.length, c.length)
  }
  return null
}

document.addEventListener('DOMContentLoaded', async () => {
  const jsonFolderPath = './json/'
  let currentIndex = parseInt(getCookie('currentIndex')) || 1
  const page = new Page('myCanvas')

  async function loadAndRenderJson(index) {
    const jsonFileName = `Page_${index.toString().padStart(6, '0')}.json`
    const jsonFilePath = `${jsonFolderPath}${jsonFileName}`

    try {
      const jsonResponse = await fetch(jsonFilePath)
      if (!jsonResponse.ok) {
        // currentIndex = 1
        return await loadAndRenderJson(--currentIndex)
      }

      const jsonData = await jsonResponse.json()
      // console.log(jsonData)

      page.startTransition(jsonData)
      const currentMarks = page.marks.map(markData => Mark.fromJSON(markData))

      const flattenPoints = marks =>
        marks.reduce((acc, mark) => acc.concat(mark.points), [])

      var current_mark_count = flattenPoints(currentMarks).length

      // Save current index to cookie
      setCookie('currentIndex', currentIndex, 7)
    } catch (error) {
      console.error('Error loading JSON:', error)
    }
  }

  // Initial load
  await loadAndRenderJson(currentIndex)

  // Event listener for clicks/taps to adjust currentIndex
  document.addEventListener('click', async event => {
    const pageWidth = window.innerWidth
    const clickX = event.clientX

    if (clickX < pageWidth / 2) {
      // Left side: Decrease index, never below 1
      currentIndex = Math.max(1, currentIndex - 1)
    } else if (clickX > pageWidth / 2) {
      // Right side: Increase index
      currentIndex++
    }

    await loadAndRenderJson(currentIndex)
  })
})
