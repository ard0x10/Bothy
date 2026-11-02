import { useState } from 'react'
import { useVault } from '../store'
import { APP_NAME } from '../../../shared/app'

// What a vault with no workspaces shows where the board would be. Without it
// an empty vault was an empty window, and the one way forward was a button at
// the foot of the sidebar. Two ways in from here: name a workspace of your
// own, or take the example, which is a workspace with a few cards in it that
// each say how to reach one part of the app. Either one is a real workspace,
// so the screen is gone the moment the vault holds one, and comes back only if
// every workspace is thrown away.
//
// The same look as the screen that picks a vault, since this is the step
// straight after it.
export function Welcome() {
  const addWorkspace = useVault((state) => state.addWorkspace)
  const addExampleWorkspace = useVault((state) => state.addExampleWorkspace)
  const [name, setName] = useState('')
  // One press, one workspace. Both buttons write a folder, and a second press
  // while the first is still on its way would write a second one.
  const [busy, setBusy] = useState(false)

  const make = (write: () => Promise<void>): void => {
    if (busy) return
    setBusy(true)
    void write().finally(() => setBusy(false))
  }

  const named = name.trim()

  return (
    <div className="welcome vault-welcome">
      <p className="welcome-mark">Welcome to {APP_NAME}</p>
      <p className="welcome-line">A vault holds workspaces, and each one has a board and a canvas.</p>
      <form
        className="vault-welcome-new"
        onSubmit={(event) => {
          event.preventDefault()
          if (named !== '') make(() => addWorkspace(named))
        }}
      >
        <input
          className="vault-welcome-name"
          autoFocus
          spellCheck={false}
          value={name}
          placeholder="Name your first workspace"
          aria-label="Workspace name"
          onChange={(event) => setName(event.target.value)}
        />
        <button className="welcome-button" type="submit" disabled={busy || named === ''}>
          Create
        </button>
      </form>
      <p className="vault-welcome-or">or</p>
      <button className="welcome-button" disabled={busy} onClick={() => make(addExampleWorkspace)}>
        Start with an example
      </button>
    </div>
  )
}
