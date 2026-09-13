import { useEffect, useState } from 'react'
import { APP_KEYS, acceleratorText, appKeyText } from '../../../shared/keys'
import { CANVAS_KEYS, keyText } from '../../../shared/viewport'
import { useVault } from '../store'
import { Icon } from './Icon'

// What the `?` at the foot of the panel opens. Step D2.
//
// Two lists under two headings, and the headings are the point: "everywhere"
// and "only on the canvas" is exactly the difference somebody needs to be told,
// and it is the difference the two tables already draw. Neither list is typed
// out here - App.tsx matches through the first and the canvas through the
// second, so a sheet that says a key exists is a sheet the handler agrees with.
//
// Its own class names rather than the canvas sheet's, for the reason the
// colours sheet gives: two panels answering one selector means the first in the
// document wins, and a query that had always meant one of them quietly starts
// meaning the other.
export function Keys() {
  const open = useVault((state) => state.keysOpen)
  const setKeys = useVault((state) => state.setKeys)

  // The quick capture key belongs to main, not to this window: it is registered
  // with the system and another program may already own it. So it is asked for
  // rather than written down here - and the same answer says whether it is on,
  // which is the one row on this sheet that can be a lie on a given machine.
  const [capture, setCapture] = useState<{ accelerator: string; ok: boolean } | null>(null)
  useEffect(() => {
    if (open) void window.api.captureStatus().then(setCapture)
  }, [open])

  if (!open) return null

  return (
    <div className="keys-scrim" onMouseDown={() => setKeys(false)}>
      <section className="keys" onMouseDown={(event) => event.stopPropagation()}>
        <header className="keys-head">
          <h2>Keys</h2>
          <button className="keys-close" title="Close" onClick={() => setKeys(false)}>
            <Icon name="close" />
          </button>
        </header>

        <div className="keys-body">
          <p className="keys-group">Everywhere</p>
          <dl>
            {APP_KEYS.map((key) => (
              <div key={key.action} className="keys-row">
                <dt>{key.label}</dt>
                <dd>{appKeyText(key)}</dd>
              </div>
            ))}
            {capture && (
              <div className="keys-row">
                <dt>
                  Quick capture
                  {/* Said on the row rather than in a line at the bottom: the
                      key that is taken is the row a person is looking at when
                      they wonder why nothing happened. */}
                  {!capture.ok && (
                    <span className="keys-note">taken by something else</span>
                  )}
                </dt>
                <dd>{acceleratorText(capture.accelerator, window.api.platform)}</dd>
              </div>
            )}
          </dl>

          <p className="keys-group">On the canvas</p>
          <dl>
            {CANVAS_KEYS.map((key) => (
              <div key={key.action} className="keys-row">
                <dt>{key.label}</dt>
                <dd>{keyText(key)}</dd>
              </div>
            ))}
          </dl>
        </div>
      </section>
    </div>
  )
}
