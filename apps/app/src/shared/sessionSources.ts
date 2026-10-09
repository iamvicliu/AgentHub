const SESSION_SOURCE_META = {
  hermes: { label: 'Hermes', shortLabel: 'hermes', color: '#B58A36', colorDark: '#D9B86A' },
  openclaw: { label: 'OpenClaw', shortLabel: 'openclaw', color: '#AB675B', colorDark: '#D59C90' },
  pi: { label: 'Pi', shortLabel: 'pi', color: '#A55A7A', colorDark: '#D88AAA' },
  claude: {
    label: 'Claude Code',
    shortLabel: 'claude',
    color: '#C26A4E',
    colorDark: '#E89A7C',
  },
  codex: {
    label: 'Codex CLI',
    shortLabel: 'codex',
    color: '#4A9670',
    colorDark: '#7CC9A2',
  },
  gemini: {
    label: 'Gemini CLI',
    shortLabel: 'gemini',
    color: '#5887D0',
    colorDark: '#8AB0E5',
  },
  opencode: {
    label: 'OpenCode',
    shortLabel: 'opencode',
    color: '#8A6F3D',
    colorDark: '#C9A761',
  },
  // Warm bronzes/mosses only — no blue or purple (see DESIGN.md). Chosen to sit
  // clear of the existing claude/codex/opencode/hermes/openclaw hues.
  workbuddy: {
    label: 'WorkBuddy',
    shortLabel: 'workbuddy',
    color: '#8B5E3C',
    colorDark: '#C08B62',
  },
  dsh: {
    label: 'DeepSeek Harness',
    shortLabel: 'dsh',
    color: '#7D8C4A',
    colorDark: '#AEC178',
  },
  // Cursor's own mark is black; a warm charcoal keeps that without going cold.
  cursor: {
    label: 'Cursor',
    shortLabel: 'cursor',
    color: '#5F5A50',
    colorDark: '#B8B2A6',
  },
} as const

export const SORTED_SESSION_SOURCES = (
  Object.keys(SESSION_SOURCE_META) as (keyof typeof SESSION_SOURCE_META)[]
).sort((a, b) => SESSION_SOURCE_META[a].label.localeCompare(SESSION_SOURCE_META[b].label, 'en'))

export function getSessionSourceColor(source: string): string {
  return SESSION_SOURCE_META[source as keyof typeof SESSION_SOURCE_META]?.color ?? '#888888'
}

export function getSessionSourceColorDark(source: string): string {
  return SESSION_SOURCE_META[source as keyof typeof SESSION_SOURCE_META]?.colorDark ?? '#A8A8A0'
}

export function getSessionSourceLabel(source: string): string {
  return SESSION_SOURCE_META[source as keyof typeof SESSION_SOURCE_META]?.label ?? source
}

export function getSessionSourceShortLabel(source: string): string {
  return SESSION_SOURCE_META[source as keyof typeof SESSION_SOURCE_META]?.shortLabel ?? source
}
