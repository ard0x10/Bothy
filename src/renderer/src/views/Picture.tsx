import { fileUrl } from '../../../shared/image'
import { useVault, useWorkspace } from '../store'

// A picture of the open card on its own, in the middle of the window over the
// scrim. Its natural size, and no larger than leaves a margin of scrim round
// it: a small picture blown up to the window only shows its pixels.
//
// Drawn here rather than inside the panel. The panel slides in on a transform,
// and a transform makes itself the box a fixed child is placed in, so a layer
// opened during the slide would be centred on the panel instead of the window.
//
// A press on the scrim puts it away and a press on the picture does not, so
// a person looking closely is not thrown out by where their pointer happens
// to be. Escape is App's, in its one chain.
export function Picture() {
  const picture = useVault((state) => state.picture)
  const openId = useVault((state) => state.openId)
  const showPicture = useVault((state) => state.showPicture)
  const workspace = useWorkspace()

  if (!picture || !workspace || picture.cardId !== openId) return null
  // Gone from files/ while it was up: nothing to show, rather than a broken
  // image in the middle of the window.
  if (!workspace.files.includes(picture.name)) return null

  return (
    <div className="picture-scrim" onMouseDown={() => showPicture(null)}>
      <img
        className="picture-image"
        src={fileUrl(workspace.path, picture.name)}
        alt=""
        draggable={false}
        onMouseDown={(event) => event.stopPropagation()}
      />
    </div>
  )
}
