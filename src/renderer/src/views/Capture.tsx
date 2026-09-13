import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { CaptureTarget, CaptureWhere } from '../../../shared/types'
import { placeIn, workspaceIn } from '../../../shared/capture'
import { Icon } from './Icon'

// Step 6 of v0.2: a card without going to get one. The whole surface is one
// line of text and, the two menus that say where it lands - in a
// window that centres itself over whatever you were doing and puts itself down
// again the moment you look away.
//
// It runs in the same bundle as the app, on the same html, chosen by the hash.
// A second entry point would be a second build target and a second preload for
// what is, in the end, an input box.
export function Capture() {
  const [target, setTarget] = useState<CaptureTarget>({ places: [], path: null })
  const [value, setValue] = useState('')
  // What the person picked in the menus, and null while they have not. Null is
  // not "nowhere": it is "wherever the window is", which is the default we
  // settled on and the answer placeIn gives.
  const [picked, setPicked] = useState<CaptureWhere | null>(null)
  const [open, setOpen] = useState<'workspace' | 'column' | null>(null)
  const field = useRef<HTMLInputElement | null>(null)
  const shell = useRef<HTMLDivElement | null>(null)
  const asked = useRef(0)

  // The box was a fixed 168 and everything under the menus was
  // empty. It is as tall as what is in it now, and it says so to main after
  // every render: its rows, or an open list if that reaches further, and the
  // same room under the last of them as there is over the first. Only a change
  // is sent, so typing costs nothing.
  //
  // A list opens downwards since the box stopped having room to spare above
  // it, and the window grows to hold it while it is open. Before a paint, so
  // the frame with the list cut off at the window's edge is never drawn.
  useLayoutEffect(() => {
    const box = shell.current
    if (!box) return
    const rows = [...box.children].filter((row) => row.getBoundingClientRect().height > 0)
    if (rows.length === 0) return
    const list = box.querySelector('.capture-menu-list')
    const lowest = Math.max(
      ...rows.map((row) => row.getBoundingClientRect().bottom),
      list ? list.getBoundingClientRect().bottom : 0
    )
    const style = getComputedStyle(box)
    const height = lowest + parseFloat(style.paddingBottom) + parseFloat(style.borderBottomWidth)
    if (Math.abs(height - asked.current) < 0.5) return
    asked.current = height
    void window.api.fitCapture(height)
  })

  // Asked for, then listened for. Listening alone loses the first answer -
  // main sends it the moment the window object exists, which is before this
  // renderer has loaded, so the first box of every run heard nothing and said
  // "nowhere to put it yet" for the rest of the session.
  useEffect(() => {
    void window.api.captureTarget().then(setTarget)
    return window.api.onCaptureTarget(setTarget)
  }, [])

  // The window is hidden rather than destroyed between captures, so it is the
  // same renderer every time and it has to clear itself and take focus again.
  // Without this the second capture of the day opens holding the first one's
  // text, with the caret nowhere.
  //
  // The destination is cleared with the text, and for the same reason: both are
  // this capture's, not the next one's. A box that keeps the folder you sent
  // one note to an hour ago, while forgetting what you wrote, would be keeping
  // the half nobody remembers choosing.
  useEffect(() => {
    const wake = (): void => {
      setValue('')
      setPicked(null)
      setOpen(null)
      field.current?.focus()
    }
    wake()
    window.addEventListener('focus', wake)
    return () => window.removeEventListener('focus', wake)
  }, [])

  // Two answers, not one. The folder the box is standing in is a real answer
  // even when it cannot take a card - it is what a brand new workspace is - and
  // the menu is the way out of it. `where` is null exactly then.
  const place = workspaceIn(target, picked)
  const where = placeIn(target, picked)
  const column = place && where ? place.columns.find((one) => one.id === where.columnId) : null

  const send = (): void => {
    const title = value.trim()
    if (!title || !where) return
    setValue('')
    void window.api.submitCapture(title, where)
  }

  return (
    <div className="capture" ref={shell}>
      <input
        ref={field}
        className="capture-input"
        autoFocus
        spellCheck={false}
        placeholder="What is it?"
        value={value}
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') send()
          // Escape closes an open menu first, and only puts the box down when
          // there is none. Otherwise the gesture that means "not that one"
          // would throw away what has already been typed.
          if (event.key === 'Escape') {
            if (open) setOpen(null)
            else void window.api.closeCapture()
          }
        }}
      />

      {place && (
        <div className="capture-where-row">
          <Menu
            label="Workspace"
            value={place.name}
            open={open === 'workspace'}
            onOpen={(on) => setOpen(on ? 'workspace' : null)}
            options={target.places.map((one) => ({
              key: one.path,
              title: one.name,
              // A workspace with no columns cannot hold a card. Shown and not
              // choosable, rather than left out: a folder simply absent from
              // the list reads as a folder that is gone.
              disabled: one.columns.length === 0
            }))}
            chosen={place.path}
            // Changing workspace drops the column with it - the ids belong to
            // the folder that was left, and placeIn answers the first column of
            // the one arrived at, which is where an unchosen capture goes.
            onPick={(path) => {
              setPicked({ path, columnId: '' })
              field.current?.focus()
            }}
          />
          <Menu
            label="Column"
            value={column ? column.title : 'No columns'}
            open={open === 'column'}
            onOpen={(on) => setOpen(on ? 'column' : null)}
            options={place.columns.map((one) => ({ key: one.id, title: one.title }))}
            chosen={where?.columnId ?? null}
            onPick={(columnId) => {
              setPicked({ path: place.path, columnId })
              field.current?.focus()
            }}
          />
        </div>
      )}

      {/* Nowhere to land is a real answer and it is said out loud rather than
          left to the menus, which a person about to press Enter is not
          reading. The two cases are different problems with different ways
          out, so they are two sentences. */}
      {!where && (
        <p className="capture-where is-nowhere">
          {place
            ? `${place.name} has no column to put it in. Pick another workspace.`
            : 'Nowhere to put it yet. Open a vault with a column in it.'}
        </p>
      )}
    </div>
  )
}

type Option = { key: string; title: string; disabled?: boolean }

// A menu drawn in the page rather than a <select>.
//
// The reason is the window, not the look: this box hides itself on blur, and
// what a native select popup does to the blur of the window under it is a thing
// this run cannot measure - the box is opened by a key the operating system
// delivers. A list that is part of the page cannot take focus off the window,
// so the question does not have to be answered.
function Menu({
  label,
  value,
  options,
  chosen,
  open,
  onOpen,
  onPick
}: {
  label: string
  value: string
  options: Option[]
  chosen: string | null
  open: boolean
  onOpen: (on: boolean) => void
  onPick: (key: string) => void
}) {
  return (
    <div className="capture-menu">
      <button
        type="button"
        className="capture-menu-face"
        title={label}
        aria-label={label}
        onClick={() => onOpen(!open)}
      >
        <span className="capture-menu-value">{value}</span>
        <span className="capture-menu-caret">
          <Icon name="chevron-down" />
        </span>
      </button>
      {open && (
        <ul className="capture-menu-list">
          {options.map((option) => (
            <li key={option.key}>
              <button
                type="button"
                className={'capture-menu-option' + (option.key === chosen ? ' is-chosen' : '')}
                disabled={option.disabled}
                onClick={() => {
                  onPick(option.key)
                  onOpen(false)
                }}
              >
                {option.title}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
