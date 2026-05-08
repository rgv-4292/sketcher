const GITHUB_TOKEN = process.env.GITHUB_TOKEN
const GITHUB_USERNAME = 'rgv-4292'
const REPO_NAME = 'sketcher'
const BASE_PATH = 'json'
const BRANCH = 'main'
const API_BASE = `https://api.github.com/repos/${GITHUB_USERNAME}/${REPO_NAME}/contents`

async function getFile (path) {
  const res = await fetch(`${API_BASE}/${path}`, {
    headers: {
      Authorization: `token ${GITHUB_TOKEN}`,
      'Content-Type': 'application/json'
    }
  })
  if (!res.ok) return null
  return await res.json()
}

async function putFile (path, content, sha = null) {
  const body = {
    message: `Sketcher: update ${path}`,
    content: Buffer.from(content).toString('base64'),
    branch: BRANCH
  }
  if (sha) body.sha = sha
  const res = await fetch(`${API_BASE}/${path}`, {
    method: 'PUT',
    headers: {
      Authorization: `token ${GITHUB_TOKEN}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  })
  if (!res.ok) {
    const err = await res.json()
    throw new Error(err.message || 'GitHub PUT failed')
  }
  return await res.json()
}

async function deleteFile (path, sha) {
  const res = await fetch(`${API_BASE}/${path}`, {
    method: 'DELETE',
    headers: {
      Authorization: `token ${GITHUB_TOKEN}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      message: `Sketcher: delete ${path}`,
      sha,
      branch: BRANCH
    })
  })
  if (!res.ok) {
    const err = await res.json()
    throw new Error(err.message || 'GitHub DELETE failed')
  }
  return await res.json()
}

async function listFolder (path) {
  const res = await fetch(`${API_BASE}/${path}`, {
    headers: {
      Authorization: `token ${GITHUB_TOKEN}`,
      'Content-Type': 'application/json'
    }
  })
  if (!res.ok) return null
  return await res.json()
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) }
  }

  let body
  try {
    body = JSON.parse(event.body)
  } catch {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid JSON body' }) }
  }

  const { operation } = body

  try {
    switch (operation) {

      case 'listBooks': {
        const files = await listFolder(BASE_PATH)
        if (!files) return { statusCode: 200, body: JSON.stringify({ books: [] }) }
        const books = files
          .filter(f => f.type === 'dir')
          .map(f => f.name)
        return { statusCode: 200, body: JSON.stringify({ books }) }
      }

      case 'getManifest': {
        const { bookName } = body
        const file = await getFile(`${BASE_PATH}/${bookName}/${bookName}_manifest.json`)
        if (!file) return { statusCode: 404, body: JSON.stringify({ error: 'Manifest not found' }) }
        const manifest = JSON.parse(Buffer.from(file.content, 'base64').toString('utf8'))
        return { statusCode: 200, body: JSON.stringify({ manifest, sha: file.sha }) }
      }

      case 'saveManifest': {
        const { bookName, manifest } = body
        const path = `${BASE_PATH}/${bookName}/${bookName}_manifest.json`
        const existing = await getFile(path)
        await putFile(path, JSON.stringify(manifest, null, 2), existing ? existing.sha : null)
        return { statusCode: 200, body: JSON.stringify({ success: true }) }
      }

      case 'createBook': {
        const { bookName, orientation } = body
        const width = orientation === 'landscape' ? 640 : 480
        const height = orientation === 'landscape' ? 480 : 640
        const manifest = {
          name: bookName,
          orientation,
          width,
          height,
          defaultPageDuration: 5,
          defaultTransitionDuration: 1,
          pages: []
        }
        const path = `${BASE_PATH}/${bookName}/${bookName}_manifest.json`
        await putFile(path, JSON.stringify(manifest, null, 2))
        return { statusCode: 200, body: JSON.stringify({ success: true, manifest }) }
      }

      case 'savePage': {
        const { bookName, pageId, pageData } = body
        const path = `${BASE_PATH}/${bookName}/${pageId}.json`
        const existing = await getFile(path)
        await putFile(path, JSON.stringify(pageData, null, 2), existing ? existing.sha : null)
        return { statusCode: 200, body: JSON.stringify({ success: true }) }
      }

      case 'getPage': {
        const { bookName, pageId } = body
        const file = await getFile(`${BASE_PATH}/${bookName}/${pageId}.json`)
        if (!file) return { statusCode: 404, body: JSON.stringify({ error: 'Page not found' }) }
        const pageData = JSON.parse(Buffer.from(file.content, 'base64').toString('utf8'))
        return { statusCode: 200, body: JSON.stringify({ pageData }) }
      }

      case 'deletePage': {
        const { bookName, pageId } = body
        const path = `${BASE_PATH}/${bookName}/${pageId}.json`
        const file = await getFile(path)
        if (!file) return { statusCode: 404, body: JSON.stringify({ error: 'Page not found' }) }
        await deleteFile(path, file.sha)
        return { statusCode: 200, body: JSON.stringify({ success: true }) }
      }

      default:
        return { statusCode: 400, body: JSON.stringify({ error: `Unknown operation: ${operation}` }) }
    }
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) }
  }
}