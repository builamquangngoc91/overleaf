import { expressify } from '@overleaf/promise-utils'
import { fetchJson } from '@overleaf/fetch-utils'
import logger from '@overleaf/logger'

// Proxy to the `harper` grammar-checker sidecar (see docker-compose.yml).
// Kept server-side so the browser stays same-origin + authenticated and the
// grammar WASM engine runs off the page (the editor CSP forbids browser WASM).
const HARPER_URL = process.env.HARPER_URL || 'http://harper:3000'

async function check(req, res) {
  const { text = '' } = req.body
  try {
    const result = await fetchJson(new URL('/lint', HARPER_URL), {
      method: 'POST',
      json: { text: String(text) },
    })
    res.json(result)
  } catch (err) {
    logger.warn({ err }, 'harper grammar check failed')
    res.status(502).json({ error: 'grammar service unavailable', issues: [] })
  }
}

export default {
  check: expressify(check),
}
