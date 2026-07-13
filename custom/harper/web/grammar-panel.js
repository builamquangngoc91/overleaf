/* Harper grammar checker panel for Overleaf.
 * Injected (nonce'd) into the editor page. Pure DOM + fetch, no dependencies.
 * Reads the live CodeMirror 6 document, sends it to the server-side grammar
 * proxy (/project/:id/grammar/check -> harper sidecar), shows issues with
 * click-to-jump and one-click fixes, and draws inline squiggly underlines in
 * the editor using the public EditorView.coordsAtPos() API (no CM rebuild).
 */
(function () {
  'use strict'
  if (window.__harperGrammarLoaded) return
  window.__harperGrammarLoaded = true

  var PID = (location.pathname.match(/\/project\/([0-9a-f]{24})/) || [])[1]
  if (!PID) return // only run inside a project editor

  var LS_UNDERLINE = 'harper.underline'
  var underlineOn = localStorage.getItem(LS_UNDERLINE) !== 'off' // default on
  var lastIssues = []

  function getView() {
    var el = document.querySelector('.cm-content')
    return (el && el.cmView && el.cmView.view) || null
  }
  function csrf() {
    var m = document.querySelector('meta[name="ol-csrfToken"]')
    return m ? m.content : ''
  }
  function color(kind) {
    var k = (kind || '').toLowerCase()
    if (k.indexOf('spell') >= 0 || k.indexOf('typo') >= 0) return '#e5484d'
    if (k.indexOf('grammar') >= 0) return '#f5a623'
    return '#4c8dff'
  }
  function wavy(c) {
    var svg =
      "<svg xmlns='http://www.w3.org/2000/svg' width='6' height='4'>" +
      "<path d='M0 3 Q1.5 0 3 3 T6 3' fill='none' stroke='" + c +
      "' stroke-width='1'/></svg>"
    return "url(\"data:image/svg+xml;utf8," + svg.replace(/#/g, '%23') + "\")"
  }

  // ---- styles -------------------------------------------------------------
  var style = document.createElement('style')
  style.textContent = [
    '#harper-btn{position:fixed;right:16px;bottom:16px;z-index:2147483000;',
    'background:#0b7285;color:#fff;border:none;border-radius:20px;padding:8px 14px;',
    'font:600 13px/1.2 sans-serif;cursor:pointer;box-shadow:0 2px 8px rgba(0,0,0,.3)}',
    '#harper-btn:hover{background:#0c8599}',
    '#harper-btn .n{background:#fff;color:#0b7285;border-radius:10px;padding:0 6px;margin-left:6px;font-size:12px}',
    '#harper-panel{position:fixed;right:16px;bottom:60px;z-index:2147483000;width:360px;',
    'max-height:62vh;display:none;flex-direction:column;background:#1e1e1e;color:#eaeaea;',
    'border:1px solid #444;border-radius:8px;box-shadow:0 6px 24px rgba(0,0,0,.4);font:13px/1.4 sans-serif;overflow:hidden}',
    '#harper-panel.open{display:flex}',
    '#harper-head{display:flex;align-items:center;gap:8px;padding:10px 12px;border-bottom:1px solid #444;background:#252525}',
    '#harper-head b{flex:1;font-size:13px}',
    '#harper-head button{background:#3a3a3a;color:#eaeaea;border:1px solid #555;border-radius:5px;padding:4px 8px;cursor:pointer;font-size:12px}',
    '#harper-head button:hover{background:#484848}',
    '#harper-toolbar{display:flex;align-items:center;gap:10px;padding:6px 12px;border-bottom:1px solid #333;font-size:12px;color:#bbb}',
    '#harper-toolbar label{display:flex;align-items:center;gap:5px;cursor:pointer}',
    '#harper-status{margin-left:auto;color:#999}',
    '#harper-list{overflow:auto;padding:4px}',
    '.harper-item{padding:8px;border-radius:6px;cursor:pointer;border:1px solid transparent}',
    '.harper-item:hover{background:#2b2b2b;border-color:#3a3a3a}',
    '.harper-item .top{display:flex;align-items:center;gap:6px;margin-bottom:3px}',
    '.harper-item .dot{width:8px;height:8px;border-radius:50%;flex:none}',
    '.harper-item .kind{font-size:11px;color:#9aa;text-transform:uppercase;letter-spacing:.03em}',
    '.harper-item .ctx{font-family:monospace;background:#2a2a2a;border-radius:3px;padding:0 4px}',
    '.harper-item .msg{color:#cfcfcf;margin:2px 0}',
    '.harper-item .fixes{display:flex;flex-wrap:wrap;gap:4px;margin-top:4px}',
    '.harper-item .fix{background:#14532d;color:#c9f7d6;border:1px solid #1f7a43;border-radius:4px;',
    'padding:1px 7px;font-size:12px;cursor:pointer}',
    '.harper-item .fix:hover{background:#1f7a43}',
    '#harper-empty{padding:16px 12px;color:#8a8;text-align:center}',
    // inline underline overlay
    '#harper-underlines{position:fixed;inset:0;pointer-events:none;z-index:2147481000}',
    '.harper-uline{position:fixed;height:4px;pointer-events:none;background-repeat:repeat-x;background-position:left bottom}',
    // hover tooltip
    '#harper-tip{position:fixed;z-index:2147483600;max-width:320px;background:#1e1e1e;color:#eaeaea;',
    'border:1px solid #555;border-radius:6px;box-shadow:0 4px 16px rgba(0,0,0,.5);padding:8px 10px;',
    'font:12px/1.4 sans-serif;display:none}',
    '#harper-tip.show{display:block}',
    '#harper-tip .tkind{font-size:10px;color:#9aa;text-transform:uppercase;letter-spacing:.03em;margin-bottom:2px}',
    '#harper-tip .tmsg{color:#ddd;margin-bottom:6px}',
    '#harper-tip .fixes{display:flex;flex-wrap:wrap;gap:4px}',
    '.harper-fix{background:#14532d;color:#c9f7d6;border:1px solid #1f7a43;border-radius:4px;',
    'padding:1px 7px;font-size:12px;cursor:pointer}',
    '.harper-fix:hover{background:#1f7a43}',
    '#harper-tip .tnofix{color:#999;font-style:italic}',
    // right-click context menu
    '#harper-menu{position:fixed;z-index:2147483600;min-width:210px;background:#fff;color:#1e1e1e;',
    'border:1px solid #ccc;border-radius:6px;box-shadow:0 6px 24px rgba(0,0,0,.28);padding:4px 0;',
    'font:13px/1.5 sans-serif;display:none}',
    '#harper-menu.show{display:block}',
    '#harper-menu .mh{padding:5px 12px 7px;color:#777;font-size:11px;border-bottom:1px solid #eee;margin-bottom:4px}',
    '#harper-menu .mh b{color:#444}',
    '#harper-menu .mi{padding:5px 12px;cursor:pointer}',
    '#harper-menu .mi:hover{background:#eef4ff}',
    '#harper-menu .mi.rep{color:#0b7285;font-weight:600}',
    '#harper-menu .mi.mut{color:#888}',
    '#harper-menu .sep{height:1px;background:#eee;margin:4px 0}',
  ].join('')
  document.head.appendChild(style)

  // underline overlay container
  var overlay = document.createElement('div')
  overlay.id = 'harper-underlines'
  document.body.appendChild(overlay)

  // hover tooltip
  var tip = document.createElement('div')
  tip.id = 'harper-tip'
  document.body.appendChild(tip)

  // right-click context menu
  var menu = document.createElement('div')
  menu.id = 'harper-menu'
  document.body.appendChild(menu)

  // ---- DOM ----------------------------------------------------------------
  var btn = document.createElement('button')
  btn.id = 'harper-btn'
  btn.innerHTML = 'Grammar<span class="n" id="harper-count">0</span>'

  var panel = document.createElement('div')
  panel.id = 'harper-panel'
  panel.innerHTML =
    '<div id="harper-head"><b>Grammar &middot; Harper</b>' +
    '<button id="harper-recheck">Re-check</button>' +
    '<button id="harper-close">✕</button></div>' +
    '<div id="harper-toolbar">' +
    '<label><input type="checkbox" id="harper-uline-cb"> Underline in editor</label>' +
    '<span id="harper-status">Ready</span></div>' +
    '<div id="harper-list"></div>'
  document.body.appendChild(btn)
  document.body.appendChild(panel)

  var listEl = panel.querySelector('#harper-list')
  var statusEl = panel.querySelector('#harper-status')
  var countEl = btn.querySelector('#harper-count')
  var ulineCb = panel.querySelector('#harper-uline-cb')
  ulineCb.checked = underlineOn

  function setStatus(s) { statusEl.textContent = s }
  function setCount(n) { countEl.textContent = String(n) }

  btn.addEventListener('click', function () {
    panel.classList.toggle('open')
    if (panel.classList.contains('open')) check()
  })
  panel.querySelector('#harper-close').addEventListener('click', function () {
    panel.classList.remove('open')
  })
  panel.querySelector('#harper-recheck').addEventListener('click', check)
  ulineCb.addEventListener('change', function () {
    underlineOn = ulineCb.checked
    localStorage.setItem(LS_UNDERLINE, underlineOn ? 'on' : 'off')
    if (underlineOn) { drawUnderlines() } else { clearUnderlines(); hideTip() }
  })

  // ---- inline underlines --------------------------------------------------
  function clearUnderlines() { overlay.innerHTML = '' }
  function drawUnderlines() {
    clearUnderlines()
    if (!underlineOn) return
    var v = getView()
    if (!v) return
    var scroller = document.querySelector('.cm-scroller')
    var clip = scroller ? scroller.getBoundingClientRect() : null
    var docLen = v.state.doc.length
    lastIssues.forEach(function (it) {
      if (it.start >= docLen || it.end > docLen) return
      var a, b
      try { a = v.coordsAtPos(it.start); b = v.coordsAtPos(it.end) } catch (e) { return }
      if (!a || !b) return
      if (Math.abs(a.top - b.top) > 2) return // spans multiple visual lines: skip
      var left = a.left
      var width = b.right - a.left
      var top = b.bottom - 3
      if (width <= 0) return
      if (clip && (b.bottom < clip.top || a.top > clip.bottom)) return // out of view
      var u = document.createElement('div')
      u.className = 'harper-uline'
      u.style.left = left + 'px'
      u.style.top = top + 'px'
      u.style.width = width + 'px'
      u.style.backgroundImage = wavy(color(it.kind))
      overlay.appendChild(u)
    })
  }
  var rafPending = false
  function scheduleRedraw() {
    if (rafPending) return
    rafPending = true
    requestAnimationFrame(function () { rafPending = false; drawUnderlines() })
  }

  // find the issue under the mouse and show/hide the tooltip
  function handleHover(e) {
    if (!underlineOn) return
    var v = getView()
    if (!v) return
    if (!e.target || !e.target.closest || !e.target.closest('.cm-content')) {
      scheduleHide(); return
    }
    var pos
    try { pos = v.posAtCoords({ x: e.clientX, y: e.clientY }) } catch (_) { pos = null }
    if (pos == null) { scheduleHide(); return }
    var hit = null
    for (var i = 0; i < lastIssues.length; i++) {
      var it = lastIssues[i]
      if (pos >= it.start && pos < it.end) { hit = it; break }
    }
    if (!hit) { scheduleHide(); return }
    clearTimeout(hideTimer)
    if (hit !== tipIssue) showTip(hit)
  }

  // ---- right-click context menu ------------------------------------------
  function issueAt(pos) {
    for (var i = 0; i < lastIssues.length; i++) {
      var it = lastIssues[i]
      if (pos >= it.start && pos < it.end) return it
    }
    return null
  }
  function hideMenu() { menu.classList.remove('show') }
  function ignoreIssue(issue) {
    lastIssues = lastIssues.filter(function (it) { return it !== issue })
    render(lastIssues)
    drawUnderlines()
  }
  function showMenu(issue, x, y) {
    menu.innerHTML = ''
    var h = document.createElement('div')
    h.className = 'mh'
    h.innerHTML = '<b></b>'
    h.querySelector('b').textContent = (issue.context || issue.kind || 'Issue')
    h.appendChild(document.createTextNode(' — ' + (issue.message || '')))
    menu.appendChild(h)

    if (issue.suggestions && issue.suggestions.length) {
      issue.suggestions.slice(0, 6).forEach(function (s) {
        var rep = s.replacement
        var mi = document.createElement('div')
        mi.className = 'mi rep'
        mi.textContent = rep === '' ? 'Delete' : ('Replace with “' + rep + '”')
        mi.addEventListener('click', function () {
          applyFix(issue.start, issue.end, rep)
          hideMenu()
        })
        menu.appendChild(mi)
      })
    } else {
      var no = document.createElement('div')
      no.className = 'mi mut'
      no.textContent = 'No suggestions'
      menu.appendChild(no)
    }

    var sep = document.createElement('div')
    sep.className = 'sep'
    menu.appendChild(sep)
    var ign = document.createElement('div')
    ign.className = 'mi mut'
    ign.textContent = 'Ignore'
    ign.addEventListener('click', function () { ignoreIssue(issue); hideMenu() })
    menu.appendChild(ign)

    menu.classList.add('show')
    var mw = menu.offsetWidth, mh = menu.offsetHeight
    menu.style.left = Math.max(6, Math.min(x, window.innerWidth - mw - 6)) + 'px'
    menu.style.top = Math.max(6, Math.min(y, window.innerHeight - mh - 6)) + 'px'
  }

  // ---- editor actions -----------------------------------------------------
  function jump(from, to) {
    var v = getView()
    if (!v) return
    var len = v.state.doc.length
    v.dispatch({
      selection: { anchor: Math.min(from, len), head: Math.min(to, len) },
      scrollIntoView: true,
    })
    v.focus()
  }
  function applyFix(from, to, insert) {
    var v = getView()
    if (!v) return
    var len = v.state.doc.length
    if (to > len) return
    v.dispatch({
      changes: { from: from, to: to, insert: insert },
      selection: { anchor: from + insert.length },
    })
    v.focus()
    hideTip()
    setTimeout(check, 250)
  }

  // ---- hover tooltip ------------------------------------------------------
  var hideTimer = null
  var tipIssue = null
  function hideTip() {
    clearTimeout(hideTimer)
    tip.classList.remove('show')
    tipIssue = null
  }
  function scheduleHide() {
    clearTimeout(hideTimer)
    hideTimer = setTimeout(hideTip, 250)
  }
  tip.addEventListener('mouseenter', function () { clearTimeout(hideTimer) })
  tip.addEventListener('mouseleave', hideTip)

  function showTip(issue) {
    tipIssue = issue
    tip.innerHTML = ''
    var k = document.createElement('div')
    k.className = 'tkind'
    k.textContent = (issue.kind || 'Issue') + ' · ' + (issue.context || '')
    var m = document.createElement('div')
    m.className = 'tmsg'
    m.textContent = issue.message || ''
    tip.appendChild(k)
    tip.appendChild(m)

    var fixes = document.createElement('div')
    fixes.className = 'fixes'
    if (issue.suggestions && issue.suggestions.length) {
      issue.suggestions.slice(0, 6).forEach(function (s) {
        var f = document.createElement('span')
        f.className = 'harper-fix'
        var rep = s.replacement
        f.textContent = rep === '' ? '(remove)' : rep
        f.addEventListener('click', function (ev) {
          ev.stopPropagation()
          applyFix(issue.start, issue.end, rep)
        })
        fixes.appendChild(f)
      })
    } else {
      var none = document.createElement('span')
      none.className = 'tnofix'
      none.textContent = 'No suggestion'
      fixes.appendChild(none)
    }
    tip.appendChild(fixes)

    // position under the flagged word
    var v = getView()
    var pos = null
    try { pos = v && v.coordsAtPos(issue.start) } catch (e) { pos = null }
    tip.classList.add('show')
    var tw = tip.offsetWidth
    var th = tip.offsetHeight
    var left, top
    if (pos) {
      left = Math.max(6, Math.min(pos.left, window.innerWidth - tw - 6))
      top = pos.bottom + 6
      if (top + th > window.innerHeight - 6) top = pos.top - th - 6
    } else {
      left = 100; top = 100
    }
    tip.style.left = left + 'px'
    tip.style.top = top + 'px'
  }

  function render(issues) {
    listEl.innerHTML = ''
    setCount(issues.length)
    if (!issues.length) {
      listEl.innerHTML = '<div id="harper-empty">No grammar issues 🎉</div>'
      setStatus('0 issues')
      return
    }
    setStatus(issues.length + ' issue' + (issues.length === 1 ? '' : 's'))
    issues.forEach(function (it) {
      var item = document.createElement('div')
      item.className = 'harper-item'

      var top = document.createElement('div')
      top.className = 'top'
      var dot = document.createElement('span')
      dot.className = 'dot'
      dot.style.background = color(it.kind)
      var kind = document.createElement('span')
      kind.className = 'kind'
      kind.textContent = it.kind || 'Issue'
      var ctx = document.createElement('span')
      ctx.className = 'ctx'
      ctx.textContent = it.context || ''
      top.appendChild(dot)
      top.appendChild(kind)
      top.appendChild(ctx)

      var msg = document.createElement('div')
      msg.className = 'msg'
      msg.textContent = it.message || ''

      item.appendChild(top)
      item.appendChild(msg)

      if (it.suggestions && it.suggestions.length) {
        var fixes = document.createElement('div')
        fixes.className = 'fixes'
        it.suggestions.slice(0, 5).forEach(function (s) {
          var f = document.createElement('span')
          f.className = 'fix'
          var rep = s.replacement
          f.textContent = rep === '' ? '(remove)' : rep
          f.addEventListener('click', function (ev) {
            ev.stopPropagation()
            applyFix(it.start, it.end, rep)
          })
          fixes.appendChild(f)
        })
        item.appendChild(fixes)
      }

      item.addEventListener('click', function () { jump(it.start, it.end) })
      listEl.appendChild(item)
    })
  }

  // ---- check --------------------------------------------------------------
  var busy = false
  function check() {
    if (busy) return
    var v = getView()
    if (!v) { setStatus('Editor not ready…'); return }
    busy = true
    setStatus('Checking…')
    var text = v.state.doc.toString()
    fetch('/project/' + PID + '/grammar/check', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf() },
      body: JSON.stringify({ text: text }),
    })
      .then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status)
        return r.json()
      })
      .then(function (d) {
        lastIssues = d.issues || []
        render(lastIssues)
        drawUnderlines()
      })
      .catch(function (e) { setStatus('Failed: ' + e.message) })
      .then(function () { busy = false })
  }

  // ---- wire ---------------------------------------------------------------
  var waitReady = setInterval(function () {
    if (getView()) {
      clearInterval(waitReady)
      var t
      // debounced re-check while panel open or underlines enabled
      document.addEventListener('input', function (e) {
        if (e.target && e.target.closest && e.target.closest('.cm-content')) {
          if (panel.classList.contains('open') || underlineOn) {
            clearUnderlines() // avoid showing stale positions during typing
            hideTip()
            clearTimeout(t)
            t = setTimeout(check, 1500)
          }
        }
      }, true)
      // reposition underlines on scroll / resize
      var scroller = document.querySelector('.cm-scroller')
      if (scroller) scroller.addEventListener('scroll', function () { hideTip(); scheduleRedraw() }, { passive: true })
      window.addEventListener('resize', scheduleRedraw)
      // hover tooltip with suggestions
      var moveScheduled = false, lastEvt = null
      document.addEventListener('mousemove', function (e) {
        if (!underlineOn) return
        lastEvt = e
        if (moveScheduled) return
        moveScheduled = true
        requestAnimationFrame(function () { moveScheduled = false; handleHover(lastEvt) })
      }, { passive: true })

      // right-click menu on a grammar error (native menu stays elsewhere).
      // Capture phase + stopImmediatePropagation suppresses Overleaf's own menu
      // only when the click lands on an underlined issue.
      document.addEventListener('contextmenu', function (e) {
        if (!underlineOn) return
        var v = getView()
        if (!v) return
        if (!e.target || !e.target.closest || !e.target.closest('.cm-content')) return
        var pos
        try { pos = v.posAtCoords({ x: e.clientX, y: e.clientY }) } catch (_) { pos = null }
        if (pos == null) return
        var hit = issueAt(pos)
        if (!hit) return // no issue here → let Overleaf's native menu show
        e.preventDefault()
        e.stopImmediatePropagation()
        hideTip()
        showMenu(hit, e.clientX, e.clientY)
      }, true)
      document.addEventListener('mousedown', function (e) {
        if (!menu.contains(e.target)) hideMenu()
      }, true)
      document.addEventListener('scroll', hideMenu, true)
      window.addEventListener('keydown', function (e) { if (e.key === 'Escape') hideMenu() })
      // initial pass so underlines appear even before opening the panel
      if (underlineOn) check()
    }
  }, 500)
})()
