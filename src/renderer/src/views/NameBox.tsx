import { useRef, useState } from 'react'

// Cards, columns and workspaces are all named before they exist, and a rename
// is the same box with something already in it. One of these rather than four,
// so Escape and blur behave the same wherever a name is being typed.
export function NameBox({
  className,
  placeholder,
  initial = '',
  commitUnchanged = false,
  allowEmpty = false,
  keepOpen = false,
  onCommit,
  onCancel
}: {
  className: string
  placeholder: string
  initial?: string
  // Whether leaving the text exactly as it arrived still counts as an answer.
  // Off for the three renames, where retyping the name a thing already has is
  // not an edit and writing the file anyway would be one. On when the box is
  // filled in with a suggestion - a card taking the name of the template it
  // came from is the ordinary case there, not a no-op.
  commitUnchanged?: boolean
  // Whether an empty box is an answer. Off everywhere a thing is being named
  // into existence, since there is no card called nothing. On for the note hung
  // on a label colour, where clearing the box is how the note comes off -
  // and the only way it could come off, short of a second button for it.
  allowEmpty?: boolean
  // Whether Enter leaves the box open, empty and focused, for the next one,
  // so cards can be added one after another by typing and pressing Enter.
  // Escape and clicking away still take it down, so the loop has a door.
  keepOpen?: boolean
  onCommit: (name: string) => void
  onCancel: () => void
}) {
  const [value, setValue] = useState(initial)
  // Enter commits and then takes the box away, so the risk was that removing a
  // focused input would answer with a blur and commit a second time. Measured:
  // it does not, here. Taking this out leaves the run green, which means the
  // guard is doing no work today. It stays anyway, because both paths through
  // commit write to disk and a second one leaves a duplicate file the user has
  // to go and find.
  const done = useRef(false)

  // What is in the box, taken. Closing, the box goes before the answer is
  // handed over - the thing being named does not exist yet, and a box still on
  // screen while it is being made is a second one waiting to be typed into.
  // Staying open, the box is emptied instead and keeps the hand: that is the
  // whole of the fast loop.
  const take = (andClose: boolean): void => {
    if (done.current) return
    const name = value.trim()
    const worth = (name !== '' || allowEmpty) && (commitUnchanged || name !== initial)
    if (andClose) {
      done.current = true
      onCancel()
    } else {
      setValue('')
    }
    if (worth) onCommit(name)
  }

  const commit = (): void => take(true)

  return (
    <input
      className={className}
      autoFocus
      spellCheck={false}
      value={value}
      placeholder={placeholder}
      onChange={(event) => setValue(event.target.value)}
      onBlur={commit}
      onFocus={(event) => event.currentTarget.select()}
      onKeyDown={(event) => {
        if (event.key === 'Enter') take(!keepOpen)
        if (event.key === 'Escape') {
          // The window owns Escape and would close the card behind this box.
          // Backing out of a name is not a reason to lose your place.
          event.stopPropagation()
          onCancel()
        }
      }}
    />
  )
}
