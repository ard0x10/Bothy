import { useCallback, useEffect, useState } from 'react'
import type { TrashEntry } from '../../../shared/types'
import { KEEP_DAYS } from '../../../shared/trash'
import { useVault } from '../store'
import { Icon } from './Icon'

// What is waiting, and the two things that can be done with it. The list is
// read when the sheet opens rather than held in the store: it is the only
// screen that needs it, and it goes stale the moment anything is put back.
export function Trash() {
  const open = useVault((state) => state.trashOpen)
  const closeTrash = useVault((state) => state.closeTrash)
  const reload = useVault((state) => state.reload)
  const settleCanvas = useVault((state) => state.settleCanvas)
  const reloadCanvas = useVault((state) => state.reloadCanvas)
  const [entries, setEntries] = useState<TrashEntry[] | null>(null)
  const [why, setWhy] = useState<string | null>(null)
  const [confirming, setConfirming] = useState<string | null>(null)

  const read = useCallback(async () => {
    setEntries(await window.api.readTrash())
  }, [])

  useEffect(() => {
    if (!open) return
    setWhy(null)
    setConfirming(null)
    void read()
  }, [open, read])

  if (!open) return null

  const restore = async (entry: TrashEntry): Promise<void> => {
    // Main puts a canvas object back by writing canvas.json. An edit this
    // window is still holding back for the disk would land on top of that and
    // take the object off again, so it goes out first.
    if (entry.kind === 'canvas') await settleCanvas()
    const result = await window.api.restoreTrash(entry.path)
    setWhy(result.ok ? null : result.why)
    await read()
    // The vault gained a file or a folder, so the app has to read it again.
    await reload()
    // Main's own write is not news to the watcher, so the canvas is read here,
    // and quietly: what came back is this window's doing, not a change from
    // outside Bothy (v0.4 step 7).
    if (entry.kind === 'canvas') await reloadCanvas(true)
  }

  const forget = async (entry: TrashEntry): Promise<void> => {
    setConfirming(null)
    const result = await window.api.deleteTrash(entry.path)
    setWhy(result.ok ? null : result.why)
    await read()
  }

  return (
    <div className="trash-scrim" onMouseDown={closeTrash}>
      <section className="trash" onMouseDown={(event) => event.stopPropagation()}>
        <header className="trash-head">
          <h2>Trash</h2>
          <span className="trash-note">Cleared after {KEEP_DAYS} days</span>
          <button className="panel-icon" title="Close (Esc)" onClick={closeTrash}>
            <Icon name="close" />
          </button>
        </header>

        {why && <p className="trash-why">{why}</p>}

        {entries !== null && entries.length === 0 && (
          <p className="trash-empty">Nothing has been thrown away.</p>
        )}

        <ul className="trash-list">
          {(entries ?? []).map((entry) => (
            <li key={entry.path} className="trash-row">
              <span className="trash-name" title={entry.folder}>
                {entry.name}
              </span>
              <span className="trash-where">
                {entry.kind === 'workspace'
                  ? 'workspace'
                  : entry.kind === 'canvas'
                    ? `${entry.workspace} · canvas`
                    : entry.workspace}
              </span>
              <span className="trash-when">{ago(entry.at)}</span>
              <button
                className="trash-act"
                disabled={!entry.restorable}
                title={
                  entry.restorable
                    ? 'Put it back where it came from'
                    : entry.kind === 'canvas'
                      ? 'It is already on the canvas, or the canvas it came from is gone or cannot be read'
                      : 'Something is already there, or the workspace it came from is gone'
                }
                onClick={() => void restore(entry)}
              >
                Put back
              </button>
              {confirming === entry.path ? (
                <button className="trash-act is-danger" onClick={() => void forget(entry)}>
                  Really
                </button>
              ) : (
                <button className="trash-act" onClick={() => setConfirming(entry.path)}>
                  Delete
                </button>
              )}
            </li>
          ))}
        </ul>
      </section>
    </div>
  )
}

const DAY = 86_400_000

function ago(at: string): string {
  const days = Math.floor((Date.now() - Date.parse(at)) / DAY)
  if (Number.isNaN(days)) return ''
  if (days <= 0) return 'today'
  if (days === 1) return 'yesterday'
  return `${days} days ago`
}
