export function syncAgeKey(timestamp: string, now = Date.now()): { key: string; count: number } {
  const zoned = /(?:Z|[+-]\d{2}:\d{2})$/i.test(timestamp) ? timestamp : `${timestamp}Z`
  const parsed = Date.parse(zoned)
  if (!Number.isFinite(parsed)) throw new Error('Invalid sync timestamp')
  const minutes = Math.max(0, Math.floor((now - parsed) / 60000))
  if (minutes < 1) return { key: 'status.now', count: 0 }
  if (minutes < 60) return { key: 'status.minutesAgo', count: minutes }
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return { key: 'status.hoursAgo', count: hours }
  return { key: 'status.daysAgo', count: Math.floor(hours / 24) }
}
