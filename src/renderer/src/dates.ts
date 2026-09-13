export type DueState = 'none' | 'later' | 'soon' | 'today' | 'late'

const DAY = 86_400_000

export function dueState(due: string | undefined): DueState {
  if (!due) return 'none'
  const at = Date.parse(due)
  if (Number.isNaN(at)) return 'none'

  const start = new Date()
  start.setHours(0, 0, 0, 0)
  const days = Math.floor((at - start.getTime()) / DAY)

  if (days < 0) return 'late'
  if (days === 0) return 'today'
  if (days <= 3) return 'soon'
  return 'later'
}

// How long ago a file came into a card, the way a person says it. Past a month
// the count stops being useful and the day itself is clearer.
export function addedAgo(at: number, now = Date.now()): string {
  const seconds = Math.max(0, Math.floor((now - at) / 1000))
  const say = (count: number, unit: string): string =>
    `Added ${count} ${unit}${count === 1 ? '' : 's'} ago`
  if (seconds < 60) return 'Added just now'
  if (seconds < 3600) return say(Math.floor(seconds / 60), 'minute')
  if (seconds < 86_400) return say(Math.floor(seconds / 3600), 'hour')
  if (seconds < 172_800) return 'Added yesterday'
  if (seconds < 30 * 86_400) return say(Math.floor(seconds / 86_400), 'day')
  return (
    'Added ' +
    new Date(at).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
  )
}

export function shortDate(value: string): string {
  const at = Date.parse(value)
  if (Number.isNaN(at)) return value
  return new Date(at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}
