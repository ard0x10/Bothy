import { useState } from 'react'
import type { Card, Workspace } from '../../../shared/types'
import { coverColor, coverImage } from '../../../shared/cover'
import { fileUrl } from '../../../shared/image'
import { resolveLabel } from '../labels'
import { labelText } from '../../../shared/labels'
import { dueState, shortDate } from '../dates'
import { Icon } from './Icon'

type Props = { card: Card; workspace: Workspace }

// Badges appear only when they carry something. An empty card is one line of
// text, which is where the quiet look comes from.
export function CardTile({ card, workspace }: Props) {
  const checks = card.checklists.flatMap((list) => list.items)
  const done = checks.filter((item) => item.done).length
  const hasBody = card.body.trim().length > 0
  const due = dueState(card.due)
  // Only a picture whose file is in files/. One named and not there would be a
  // broken image for the moment it takes to fail, on every card that has one.
  const named = coverImage(card)
  const picture = named && workspace.files.includes(named) ? named : null
  const colour = coverColor(card)

  return (
    <article className={card.broken ? 'card card-broken' : 'card'}>
      {picture && <CoverPicture workspacePath={workspace.path} name={picture} />}
      {colour && <span className="card-cover" style={{ background: colour }} />}

      {/* Colour. A label on the board is the colour and nothing else -
          the picture of it - so the card carries a short bar and the name,
          if the colour was given one, is what the hand finds on it. A tag
          written by hand is still a dot and a word: it has no colour of its
          own to be recognised by. */}
      {card.tags.length > 0 && (
        <p className="card-tags">
          {card.tags.map((tag) => {
            const label = resolveLabel(workspace, tag)
            const words = labelText(label)
            return label.key ? (
              <span
                key={tag}
                className="tag-pill"
                style={{ background: label.color }}
                title={words}
              />
            ) : (
              <span key={tag} className="tag">
                <span className="tag-dot" style={{ background: label.color }} />
                {label.name}
              </span>
            )
          })}
        </p>
      )}

      <p className="card-title">{card.title}</p>

      {card.broken && <p className="card-warning">frontmatter did not parse, shown as written</p>}

      {(hasBody || card.due || checks.length > 0 || card.files.length > 0) && (
        <p className="card-badges">
          {hasBody && (
            <span title="has a description">
              <Icon name="lines" />
            </span>
          )}
          {card.due && (
            <span className={`due due-${due}`} title={`due ${card.due}`}>
              <Icon name="clock" />
              {shortDate(card.due)}
            </span>
          )}
          {checks.length > 0 && (
            <span title="checklist">
              <Icon name="checklist" />
              {done}/{checks.length}
            </span>
          )}
          {card.files.length > 0 && (
            <span title="files">
              <Icon name="paperclip" />
              {card.files.length}
            </span>
          )}
        </p>
      )}
    </article>
  )
}

// Every cover is the same short band, the pick: the column stays even, and
// a tall screenshot is cut to its middle rather than taking the column over.
//
// A picture whose file is not there is left off rather than drawn broken. The
// card is still a card without it, and the panel is where "missing" is said.
// The name rides along as data-file so the kanban's PNG can swap the picture
// for its bytes - it cannot reach the scheme the window draws it with.
function CoverPicture({ workspacePath, name }: { workspacePath: string; name: string }) {
  const url = fileUrl(workspacePath, name)
  const [gone, setGone] = useState<string | null>(null)
  if (gone === url) return null
  return (
    <img
      className="card-cover-image"
      src={url}
      data-file={name}
      alt=""
      draggable={false}
      onError={() => setGone(url)}
    />
  )
}
