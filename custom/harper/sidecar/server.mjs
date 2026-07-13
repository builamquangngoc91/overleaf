// Tiny HTTP wrapper around harper.js. Accepts LaTeX, masks it to prose, lints
// with Harper, and returns issues as JSON. Runs in a container (Node); no CSP
// applies here, so the WASM grammar engine runs freely off the browser.
import http from 'node:http'
import { LocalLinter, Dialect } from 'harper.js'
import { binary } from 'harper.js/binary'
import { maskLatex } from './latex-masker.mjs'

const PORT = process.env.PORT || 3000
const DIALECT = (process.env.HARPER_DIALECT || 'American')

const linter = new LocalLinter({
  binary,
  dialect: Dialect[DIALECT] ?? Dialect.American,
})
await linter.setup()
console.log(`[harper] linter ready (dialect=${DIALECT})`)

// 0-based line/column for a UTF-16 index, to help the client map to CodeMirror.
function lineCol(text, index) {
  let line = 0
  let lineStart = 0
  for (let i = 0; i < index && i < text.length; i++) {
    if (text[i] === '\n') {
      line++
      lineStart = i + 1
    }
  }
  return { line, ch: index - lineStart }
}

function overlapsMask(maskFlags, start, end) {
  for (let i = start; i < end && i < maskFlags.length; i++) {
    if (maskFlags[i]) return true
  }
  return false
}

async function lintText(text) {
  const { masked, maskFlags } = maskLatex(text)
  const lints = await linter.lint(masked, { language: 'plaintext' })
  return lints
    .filter(lint => {
      const span = lint.span()
      // Drop lints that touch masked (non-prose) characters — these are
      // artefacts of blanking LaTeX markup, not real prose issues.
      return !overlapsMask(maskFlags, span.start, span.end)
    })
    .map(lint => {
      const span = lint.span()
      const start = span.start
      const end = span.end
      return {
      start,
      end,
      ...lineCol(text, start),
      kind: lint.lint_kind(),
      message: lint.message(),
      context: text.slice(start, end),
      suggestions: lint.suggestions().map(s => ({
        replacement: s.get_replacement_text(),
      })),
    }
  })
}

const server = http.createServer((req, res) => {
  if (req.method === 'GET' && req.url === '/health') {
    res.writeHead(200, { 'content-type': 'text/plain' })
    return res.end('ok')
  }
  if (req.method === 'POST' && req.url === '/lint') {
    let body = ''
    req.on('data', c => {
      body += c
      if (body.length > 5_000_000) req.destroy() // 5MB guard
    })
    req.on('end', async () => {
      try {
        const { text = '' } = JSON.parse(body || '{}')
        const issues = await lintText(String(text))
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ issues }))
      } catch (err) {
        res.writeHead(500, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ error: String(err && err.message || err) }))
      }
    })
    return
  }
  res.writeHead(404, { 'content-type': 'text/plain' })
  res.end('not found')
})

server.listen(PORT, () => console.log(`[harper] listening on :${PORT}`))
