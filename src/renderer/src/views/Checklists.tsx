import { useState } from 'react'
import type { Checklist } from '../../../shared/types'
import { Icon } from './Icon'

type Props = { lists: Checklist[]; onChange: (lists: Checklist[]) => void }

export function Checklists({ lists, onChange }: Props) {
  const patch = (index: number, list: Checklist): void =>
    onChange(lists.map((entry, i) => (i === index ? list : entry)))

  return (
    <section className="field">
      <h3 className="field-head">
        <Icon name="checklist" />
        Checklists
      </h3>

      {/* Another list is added from the row under the card's title, the same
          button that added the first one. */}
      {lists.map((list, index) => (
        <ChecklistBlock
          key={index}
          list={list}
          onChange={(next) => patch(index, next)}
          onRemove={() => onChange(lists.filter((_, i) => i !== index))}
        />
      ))}
    </section>
  )
}

function ChecklistBlock({
  list,
  onChange,
  onRemove
}: {
  list: Checklist
  onChange: (list: Checklist) => void
  onRemove: () => void
}) {
  const [adding, setAdding] = useState('')
  const done = list.items.filter((item) => item.done).length

  const add = (): void => {
    const text = adding.trim()
    setAdding('')
    if (text) onChange({ ...list, items: [...list.items, { text, done: false }] })
  }

  return (
    <div className="checklist">
      <header className="checklist-head">
        <input
          className="checklist-name"
          value={list.name}
          onChange={(event) => onChange({ ...list, name: event.target.value })}
        />
        <span className="count">
          {done}/{list.items.length}
        </span>
        <button className="panel-icon" title="Remove this checklist" onClick={onRemove}>
          <Icon name="close" />
        </button>
      </header>

      {list.items.map((item, index) => (
        <div key={index} className={item.done ? 'check is-done' : 'check'}>
          <input
            type="checkbox"
            checked={item.done}
            onChange={(event) =>
              onChange({
                ...list,
                items: list.items.map((one, i) =>
                  i === index ? { ...one, done: event.target.checked } : one
                )
              })
            }
          />
          <input
            className="check-text"
            value={item.text}
            onChange={(event) =>
              onChange({
                ...list,
                items: list.items.map((one, i) =>
                  i === index ? { ...one, text: event.target.value } : one
                )
              })
            }
          />
          <button
            className="panel-icon"
            title="Remove this item"
            onClick={() => onChange({ ...list, items: list.items.filter((_, i) => i !== index) })}
          >
            <Icon name="close" />
          </button>
        </div>
      ))}

      <input
        className="check-add"
        value={adding}
        placeholder="+ item"
        onChange={(event) => setAdding(event.target.value)}
        onBlur={add}
        onKeyDown={(event) => {
          if (event.key === 'Enter') add()
        }}
      />
    </div>
  )
}
