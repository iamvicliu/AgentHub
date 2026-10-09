/** Rewrites `<mark>` tags from core's buildLikeSnippet to `<strong>`
 *  so renderer surfaces can style highlights via their own `<strong>`
 *  rules (accent color, font weight, etc.) without each surface
 *  carrying the same regex.
 *
 *  The snippet text comes straight from indexed session content and is
 *  rendered via `dangerouslySetInnerHTML`, so everything except the
 *  highlight markers we inject ourselves is HTML-escaped — a session
 *  whose body contains markup is shown as inert text, never parsed. */
export function snippetToStrongHtml(snippet: string): string {
  return snippet
    .split(/(<\/?mark>)/)
    .map((part) =>
      part === '<mark>' ? '<strong>' : part === '</mark>' ? '</strong>' : escapeHtml(part),
    )
    .join('')
}

export function highlightTitleHtml(title: string, query: string): string {
  const terms = query
    .trim()
    .split(/\s+/)
    .map((term) => term.replace(/^"|"$/g, ''))
    .filter(Boolean)
  if (!terms.length) return escapeHtml(title)
  const pattern = new RegExp(
    terms
      .sort((a, b) => b.length - a.length)
      .map((term) => term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
      .join('|'),
    'gi',
  )
  let offset = 0
  let html = ''
  for (const match of title.matchAll(pattern)) {
    html +=
      escapeHtml(title.slice(offset, match.index)) + `<strong>${escapeHtml(match[0])}</strong>`
    offset = match.index + match[0].length
  }
  return html + escapeHtml(title.slice(offset))
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}
