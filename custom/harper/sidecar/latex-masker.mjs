// Mask LaTeX markup into blanks so Harper only lints prose.
//
// Every masked character is replaced with a space (newlines preserved), so the
// masked string has the SAME length as the source and Harper's lint offsets map
// 1:1 back to source character indices. This is a heuristic (not a full LaTeX
// parser) but removes the vast majority of false positives from commands, math
// and comments while keeping human-readable prose (incl. text inside
// \section{...}, \textbf{...}, etc.).

// Commands whose brace argument is NOT prose (identifiers, paths, keys, urls...).
// For these we blank the command AND its {...}/[...] arguments.
const NON_PROSE_COMMANDS = new Set([
  'documentclass', 'usepackage', 'input', 'include', 'includegraphics',
  'includepdf', 'bibliography', 'bibliographystyle', 'addbibresource',
  'printbibliography', 'cite', 'citep', 'citet', 'citeauthor', 'citeyear',
  'citealp', 'nocite', 'ref', 'eqref', 'pageref', 'autoref', 'cref', 'Cref',
  'label', 'url', 'href', 'texttt', 'verb', 'path', 'lstinputlisting',
  'hypersetup', 'geometry', 'usetikzlibrary', 'pgfplotsset', 'definecolor',
  'setlength', 'newcommand', 'renewcommand', 'newenvironment', 'def',
  'DeclareMathOperator', 'newtheorem', 'pagestyle', 'thispagestyle',
  'bibliographyfont', 'graphicspath', 'RequirePackage', 'newcolumntype',
])

// Environments whose entire body is non-prose (math, code, drawings, tables).
const OPAQUE_ENVIRONMENTS = [
  'equation', 'align', 'alignat', 'gather', 'multline', 'math', 'displaymath',
  'eqnarray', 'array', 'matrix', 'pmatrix', 'bmatrix', 'Bmatrix', 'vmatrix',
  'Vmatrix', 'cases', 'split', 'verbatim', 'Verbatim', 'lstlisting', 'minted',
  'tikzpicture', 'tabular', 'tabularx', 'longtable', 'tabbing', 'picture',
  'tcolorbox', 'forest',
]

export function maskLatex(src) {
  // split by UTF-16 code units so regex .index values line up with arr indices
  const arr = src.split('')
  // maskFlags[i] === 1 means arr[i] was blanked (LaTeX markup, not prose).
  // The caller uses this to drop any lint that overlaps masked characters
  // (masked runs become spaces, which would otherwise trip Harper's
  // "multiple spaces"/"French spaces" formatting rules).
  const maskFlags = new Uint8Array(arr.length)
  const blank = (start, end) => {
    for (let k = start; k < end && k < arr.length; k++) {
      const c = arr[k]
      if (c !== '\n' && c !== '\r') {
        arr[k] = ' '
        maskFlags[k] = 1
      }
    }
  }
  const apply = re => {
    re.lastIndex = 0
    let m
    while ((m = re.exec(src)) !== null) {
      blank(m.index, m.index + m[0].length)
      if (m[0].length === 0) re.lastIndex++
    }
  }

  // 1. Line comments: % ... EOL (ignore escaped \%)
  apply(/(?<!\\)%[^\n]*/g)

  // 2. Opaque environments (math/code/tables) — blank whole body incl. markers.
  for (const env of OPAQUE_ENVIRONMENTS) {
    const e = env.replace(/[*]/g, '\\*')
    apply(new RegExp(`\\\\begin\\{${e}\\*?\\}[\\s\\S]*?\\\\end\\{${e}\\*?\\}`, 'g'))
  }

  // 3. Math delimiters.
  apply(/\$\$[\s\S]*?\$\$/g) // display $$...$$
  apply(/(?<!\\)\$(?:\\.|[^$\\\n])*\$/g) // inline $...$
  apply(/\\\[[\s\S]*?\\\]/g) // \[ ... \]
  apply(/\\\((?:\\.|[^\\])*?\\\)/g) // \( ... \)

  // 4. begin/end environment markers (keep the prose inside non-opaque envs).
  apply(/\\(?:begin|end)\s*\{[^}]*\}(?:\[[^\]]*\])?/g)

  // 5. Non-prose commands together with their bracket/brace arguments.
  for (const cmd of NON_PROSE_COMMANDS) {
    apply(new RegExp(`\\\\${cmd}\\*?\\s*(?:\\[[^\\]]*\\])*\\s*(?:\\{[^{}]*\\})*`, 'g'))
  }

  // 6. Any remaining control word (\section, \textbf, ...) and control symbols.
  //    Only the command token is blanked; the following {prose} is kept.
  apply(/\\[a-zA-Z@]+\*?/g)
  apply(/\\[^a-zA-Z\s]/g)

  // 7. Leftover structural characters that aren't prose.
  apply(/[{}~^]/g)
  apply(/\\\\/g) // line breaks
  apply(/(?<=\s)&(?=\s)|&/g) // alignment ampersands

  return { masked: arr.join(''), maskFlags }
}
