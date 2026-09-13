// Undo and redo, step 7 of v0.3.
//
// Snapshots, not a command log, and that was settled in section 6 of the design
// doc with our own constraint as the reason: in v0.4 an agent writes into
// canvas.json from outside, and a command log cannot know the inverse of a
// change it never saw. A snapshot does not have to know - it is a whole canvas,
// and going back to one lands on solid ground whoever wrote what in between.
//
// A snapshot is cheap here in a way that is worth saying rather than assuming.
// Editing an object rebuilds that object and reuses every other one, so a
// snapshot of a canvas of N objects is an array of N pointers plus the one
// object that changed: the other N-1 are shared with the canvas on screen.
// Measured rather than argued - a canvas of 500 objects costs 4.2 KB a
// snapshot, so a hundred of them is 425 KB and takes 1.3 ms to build, and a
// canvas of 2,000 objects is 1.6 MB for the same hundred. The table is in
// section 13 of the design doc.
//
// Pure and typed over what it holds, so the rule about what counts as one move
// can be measured without a window.

export type History<T> = {
  // Oldest first. The one on the end is what the next undo goes back to.
  past: T[]
  // What undo walked away from, newest last.
  future: T[]
  // What the entry on the end of the past was made for. Two changes carrying
  // the same mark are one move, and that is the whole of how a drag of a
  // hundred events becomes one press of Ctrl+Z.
  mark: string | null
}

// How far back it goes. A hundred moves is further back than a hand reaches in
// one sitting, and the measurement above is what says a hundred is affordable
// rather than a guess that it is: at 500 objects it is 425 KB, and the cost is
// flat per entry, so the number can move if there is ever a reason. It is a
// limit at all rather than none because a canvas left open for a week would
// otherwise be a list that only grows.
export const HISTORY_DEPTH = 100

export const noHistory = <T>(): History<T> => ({ past: [], future: [], mark: null })

// Take a snapshot of what the canvas was, before it becomes something else.
//
// A mark of null is always its own move. A mark that matches the one on the end
// of the past is the same move carrying on - a hand still dragging, a word
// still being typed - and nothing is recorded, so the snapshot already there
// stays the one undo goes back to. The caller owns what a mark means: a gesture
// hands out a fresh one when it starts, so two drags can never be mistaken for
// one however fast they follow each other.
export function remember<T>(
  history: History<T>,
  before: T,
  mark: string | null,
  depth = HISTORY_DEPTH
): History<T> {
  if (mark !== null && mark === history.mark) return history
  const past = [...history.past, before]
  return {
    past: past.length > depth ? past.slice(past.length - depth) : past,
    // A new change after an undo is a new branch, and what was undone is not
    // coming back. The alternative is a tree, and a tree needs a way to show
    // the user which branch they are on before it is worth anything.
    future: [],
    mark
  }
}

export type Step<T> = { file: T; history: History<T> }

export function undo<T>(history: History<T>, present: T): Step<T> | null {
  if (history.past.length === 0) return null
  return {
    file: history.past[history.past.length - 1],
    history: {
      past: history.past.slice(0, -1),
      future: [...history.future, present],
      // Nothing is carrying on after an undo, so the next change is its own
      // move whatever it is marked with. Without this a drag, an undo and then
      // the same drag again would fold into the entry the undo just left.
      mark: null
    }
  }
}

export function redo<T>(history: History<T>, present: T): Step<T> | null {
  if (history.future.length === 0) return null
  return {
    file: history.future[history.future.length - 1],
    history: {
      past: [...history.past, present],
      future: history.future.slice(0, -1),
      mark: null
    }
  }
}
