import { describe, expect, it } from 'vite-plus/test'

import { highlightTitleHtml, snippetToStrongHtml } from './snippet.js'

describe('title highlights', () => {
  it('highlights Chinese and case-insensitive repeated terms', () => {
    expect(highlightTitleHtml('开发-Spool spool', '开发 spool')).toBe(
      '<strong>开发</strong>-<strong>Spool</strong> <strong>spool</strong>',
    )
  })
  it('escapes title markup and treats regex symbols literally', () => {
    expect(highlightTitleHtml('<script>a+b</script>', 'a+b')).toBe(
      '&lt;script&gt;<strong>a+b</strong>&lt;/script&gt;',
    )
    expect(highlightTitleHtml('<b>', '')).toBe('&lt;b&gt;')
  })
})

describe('snippetToStrongHtml', () => {
  it('rewrites mark highlights to strong', () => {
    expect(snippetToStrongHtml('a <mark>hit</mark> b')).toBe('a <strong>hit</strong> b')
  })

  it('escapes markup in the surrounding text so it renders inert', () => {
    // An unclosed tag survives the parsers\' tag-stripping and reaches the
    // FTS index; it must not become a live element when shown via innerHTML.
    expect(snippetToStrongHtml('see <img src=x onerror=alert(1)')).toBe(
      'see &lt;img src=x onerror=alert(1)',
    )
    expect(snippetToStrongHtml('<script>alert(1)</script>')).toBe(
      '&lt;script&gt;alert(1)&lt;/script&gt;',
    )
  })

  it('escapes inside and around highlights', () => {
    expect(snippetToStrongHtml('<mark><b></mark> & "x"')).toBe(
      '<strong>&lt;b&gt;</strong> &amp; &quot;x&quot;',
    )
  })

  it('passes plain text through unchanged', () => {
    expect(snippetToStrongHtml('just text')).toBe('just text')
  })
})
