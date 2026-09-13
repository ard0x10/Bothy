import { Fragment, useEffect, useRef, useState, type ReactNode } from 'react'
import {
  CANVAS_PALETTE,
  DEFAULTS,
  FONTS,
  FONT_NAMES,
  IMAGE_OPACITIES,
  NEW_BOX,
  PEN_WIDTHS,
  alphaOf,
  fileOf,
  fontCss,
  isArrow,
  isImage,
  isStroke,
  kindOf,
  numberOf,
  rgbOf,
  shapeOf,
  styleOf,
  withAlpha,
  type CanvasObject,
  type Kind,
  type Shape
} from '../../../shared/canvas'
import { ARROW_DASHES, ARROW_HEADS, dashOf, headOf } from '../../../shared/arrow'
import { seedOf, useVault, type CanvasTool, type PenKind } from '../store'
import { Icon, type IconName } from './Icon'

// The tool rail, step 4 of v0.3, in the middle of the left edge. The
// categories, and beside them, for a category that holds more than one tool, a
// menu of what it holds.
//
// This shape is here because many more tools are planned. A single strip of buttons taxes every new tool with a bit more
// height until it runs off the bottom of the window; this one deepens instead
// of growing, so the twentieth tool costs the same as the third. Which is why
// the outer column takes categories rather than tools.
//
// Before, the column beside it held the settings of what was held, or of the
// next one. That place now goes to what a category holds, opening
// right beside the rail when a tool is chosen, and the settings moved the settings across the top of the canvas. They are CanvasBar,
// below.

type Category = { tool: CanvasTool; icon: IconName; label: string }

// Six. The pen was step 5, the arrow step 6 and the image step 8, and each cost
// the rail one row. What a category holds costs it nothing.
const CATEGORIES: Category[] = [
  { tool: 'select', icon: 'pointer', label: 'Select' },
  { tool: 'box', icon: 'box', label: 'Shapes' },
  { tool: 'text', icon: 'text', label: 'Text' },
  { tool: 'draw', icon: 'pencil', label: 'Pen' },
  { tool: 'arrow', icon: 'arrow', label: 'Arrow' },
  { tool: 'image', icon: 'image', label: 'Image' }
]

type Variant = { value: string; icon: IconName; label: string }

// What a category holds, as we chose: the box is the rectangle among
// the shapes, and the arrow stays a category of its own; the pen has a
// highlighter and an eraser beside it. A category that is not here is one tool,
// and pressing it is choosing it.
const VARIANTS: Partial<Record<CanvasTool, Variant[]>> = {
  box: [
    { value: 'rect', icon: 'box', label: 'Rectangle' },
    { value: 'ellipse', icon: 'ellipse', label: 'Ellipse' },
    { value: 'triangle', icon: 'triangle', label: 'Triangle' },
    { value: 'diamond', icon: 'diamond', label: 'Diamond' }
  ],
  draw: [
    { value: 'pen', icon: 'pencil', label: 'Pen' },
    { value: 'highlighter', icon: 'highlighter', label: 'Highlighter' },
    { value: 'eraser', icon: 'eraser', label: 'Eraser' }
  ]
}

// The menu's border and padding, so its first row stands level with the button
// that opened it.
const FLYOUT_INSET = 5

export function CanvasRail() {
  const tool = useVault((state) => state.tool)
  const setTool = useVault((state) => state.setTool)
  const shape = useVault((state) => state.shape)
  const setShape = useVault((state) => state.setShape)
  const pen = useVault((state) => state.pen)
  const setPen = useVault((state) => state.setPen)
  const canUndo = useVault((state) => state.history.past.length > 0)
  const canRedo = useVault((state) => state.history.future.length > 0)
  const undoCanvas = useVault((state) => state.undoCanvas)
  const redoCanvas = useVault((state) => state.redoCanvas)
  // Which category's menu is open, and how far down the rail its button is.
  const [open, setOpen] = useState<{ tool: CanvasTool; top: number } | null>(null)

  // Built like every other menu in the app: it closes on Escape, on a press
  // outside it and on its button pressed again - and on a choice, since a
  // choice is all it is for. Escape stops here, or it would reach App.
  useEffect(() => {
    if (!open) return
    const away = (event: PointerEvent): void => {
      const at = event.target as Element | null
      if (at?.closest?.(`.canvas-flyout, .canvas-tool[data-tool="${open.tool}"]`)) return
      setOpen(null)
    }
    const key = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      event.stopPropagation()
      setOpen(null)
    }
    document.addEventListener('pointerdown', away)
    window.addEventListener('keydown', key, true)
    return () => {
      document.removeEventListener('pointerdown', away)
      window.removeEventListener('keydown', key, true)
    }
  }, [open])

  const chosen = (of: CanvasTool): string | null =>
    of === 'box' ? shape : of === 'draw' ? pen : null

  return (
    <div className="canvas-rail">
      <div className="canvas-tools">
        {CATEGORIES.map((category) => {
          const holds = VARIANTS[category.tool]
          // A category that holds several shows the one it would make, so the
          // button says what pressing the surface is about to do.
          const icon = holds?.find((one) => one.value === chosen(category.tool))?.icon ?? category.icon
          return (
            <button
              key={category.tool}
              className={`canvas-tool${tool === category.tool ? ' is-on' : ''}`}
              title={category.label}
              aria-pressed={tool === category.tool}
              aria-haspopup={holds ? 'menu' : undefined}
              aria-expanded={holds ? open?.tool === category.tool : undefined}
              data-tool={category.tool}
              onClick={(event) => {
                setTool(category.tool)
                if (!holds || open?.tool === category.tool) {
                  setOpen(null)
                  return
                }
                setOpen({ tool: category.tool, top: event.currentTarget.offsetTop })
              }}
            >
              <Icon name={icon} />
            </button>
          )
        })}
      </div>

      {/* Undo and redo, in a box of their own under the rail: they
          are not tools, and nothing about the canvas changes which one is in
          hand. The keys did this already; these say that they can, and when
          there is nothing to take back they say that too. */}
      <div className="canvas-history">
        <button className="canvas-step" title="Undo" disabled={!canUndo} onClick={undoCanvas}>
          <Icon name="undo" />
        </button>
        <button className="canvas-step" title="Redo" disabled={!canRedo} onClick={redoCanvas}>
          <Icon name="redo" />
        </button>
      </div>

      {open && (
        <div
          className="canvas-flyout"
          role="menu"
          data-for={open.tool}
          style={{ top: open.top - FLYOUT_INSET }}
        >
          {(VARIANTS[open.tool] ?? []).map((variant) => {
            const on = chosen(open.tool) === variant.value
            return (
              <button
                key={variant.value}
                className={`canvas-flyout-row${on ? ' is-on' : ''}`}
                role="menuitemradio"
                aria-checked={on}
                data-variant={variant.value}
                onClick={() => {
                  if (open.tool === 'box') setShape(variant.value as Shape)
                  else setPen(variant.value as PenKind)
                  setOpen(null)
                }}
              >
                <Icon name={variant.icon} />
                {variant.label}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

// What the head buttons show. The word would be a second thing to read; the
// shape is the answer itself.
const HEAD_MARK: Record<string, IconName> = { none: 'line', arrow: 'arrow-right', both: 'arrows' }
const DASH_MARK: Record<string, IconName> = { solid: 'line', dashed: 'dashed' }
const ALIGN_MARK: Record<string, IconName> = {
  left: 'align-left',
  center: 'align-center',
  right: 'align-right'
}
const VALIGN_MARK: Record<string, IconName> = {
  top: 'valign-top',
  middle: 'valign-middle',
  bottom: 'valign-bottom'
}

const SIZES = [12, 16, 20, 24, 32, 48]

// What the size box takes when a size is typed rather than picked. Past these a
// box is either unreadable or one letter wide, and a number typed by mistake
// should not be able to do either.
const SIZE_LEAST = 6
const SIZE_MOST = 400

// The corners a rectangle can be given from the border section. The same
// doubling as the pen's widths, from none.
const CORNERS = [0, 4, 8, 16, 32]

// The sections of the bar. Each is one button, and pressing it opens what
// it holds under the bar, where there is room to set it properly rather than a
// row of every control there is.
type Section =
  | 'font'
  | 'size'
  | 'style'
  | 'align'
  | 'colour'
  | 'highlight'
  | 'border'
  | 'fill'
  | 'line'
  | 'ends'
  | 'strength'
  | 'more'

// Which sections each kind of thing has, and where the lines between them fall.
// The shape's is the list, in the order: "Font, divider, font size,
// divider, font style, alignment, divider, text color, Highlight text, divider,
// borderstyle-opacity-corners-color, set color and opacity, more". The others
// are that list with what the kind does not have taken out - a text has no
// border or fill, a line has no words - and the line's own sections put in.
type Layout = 'shape' | 'text' | 'arrow' | 'draw' | 'image'

const LAYOUTS: Record<Layout, Section[][]> = {
  shape: [['font'], ['size'], ['style', 'align'], ['colour', 'highlight'], ['border', 'fill', 'more']],
  text: [['font'], ['size'], ['style', 'align'], ['colour', 'highlight', 'more']],
  arrow: [['line', 'ends', 'more']],
  draw: [['line', 'more']],
  image: [['strength', 'more']]
}

const TITLES: Record<Section, string> = {
  font: 'Font',
  size: 'Size',
  style: 'Text style',
  align: 'Alignment',
  colour: 'Text colour',
  highlight: 'Highlight',
  border: 'Border',
  fill: 'Fill',
  line: 'Line',
  ends: 'Ends',
  strength: 'Strength',
  more: 'More'
}

type Opened = { section: Section; left: number | null; right: number | null }

// The settings of what is held, or of the next thing the tool in hand makes,
// across the top of the canvas, laid out in a row. The next one's settings
// came with them: one place for every setting, whether it is about
// something on the canvas or something about to be.
//
// Sections: pressing one opens its own menu, which keeps each group of
// settings easy to reach. What a section holds is opened under
// the bar like any menu, and closes on Escape, a press outside it and its own
// button pressed again.
export function CanvasBar() {
  const tool = useVault((state) => state.tool)
  const penKind = useVault((state) => state.pen)
  const shapeInHand = useVault((state) => state.shape)
  const selectedIds = useVault((state) => state.selectedIds)
  const canvas = useVault((state) => state.canvas)
  // What the next one will be, asked the way the store asks it when a press
  // on this bar writes to it.
  const seed = useVault((state) => state[seedOf(state)])
  const patchTarget = useVault((state) => state.patchTarget)
  const pickImages = useVault((state) => state.pickImages)
  const patchTargetStyle = useVault((state) => state.patchTargetStyle)
  const removeObjects = useVault((state) => state.removeObjects)
  const orderObjects = useVault((state) => state.orderObjects)
  const duplicateObjects = useVault((state) => state.duplicateObjects)

  const bar = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState<Opened | null>(null)
  // A size being typed, until it is taken. Null is "show the object's own".
  const [sizeDraft, setSizeDraft] = useState<string | null>(null)

  // The topmost held object is what the bar is about. It is the one on top of
  // the drawing, so it is the one the eye is on - and the store settles what a
  // press does by asking the same question, so the bar and what it changes
  // cannot have different ideas about which kind of thing this is.
  const held = new Set(selectedIds)
  const taken = (canvas?.objects ?? []).filter((object) => held.has(object.id))
  const selected = taken.length > 0 ? taken[taken.length - 1] : null
  // How many of what is held the bar is actually about. A selection of a box
  // and two scribbles with the pen's settings showing changes two things, and
  // the heading says two rather than three.
  const about = selected
    ? taken.filter((object) => kindOf(object) === kindOf(selected)).length
    : 0

  // Whether the bar is about a pen or about a shape. Asked of the object when
  // there is one - a stroke carries points, whatever its type says - and of the
  // tool when there is not.
  const pen = selected ? isStroke(selected) : tool === 'draw'
  const arrow = selected ? isArrow(selected) : tool === 'arrow'
  const picture = selected ? isImage(selected) : tool === 'image'
  const words = selected ? selected.type === 'text' : tool === 'text'

  const layout: Layout = picture ? 'image' : arrow ? 'arrow' : pen ? 'draw' : words ? 'text' : 'shape'
  // More is about what is held. With nothing held there is nothing to move to
  // the front, copy or delete, so it is not offered.
  const groups = LAYOUTS[layout]
    .map((group) => group.filter((section) => section !== 'more' || selected !== null))
    .filter((group) => group.length > 0)
  const present = groups.flat()
  const showing = open !== null && present.includes(open.section) ? open : null

  useEffect(() => {
    if (!open) return
    const away = (event: PointerEvent): void => {
      const at = event.target as Element | null
      if (at?.closest?.(`.canvas-pop, .canvas-panel [data-section="${open.section}"]`)) return
      setOpen(null)
    }
    // Stopped here, or it would reach App, which would put the selection down
    // along with the menu.
    const key = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      event.stopPropagation()
      event.stopImmediatePropagation()
      setOpen(null)
    }
    document.addEventListener('pointerdown', away)
    window.addEventListener('keydown', key, true)
    return () => {
      document.removeEventListener('pointerdown', away)
      window.removeEventListener('keydown', key, true)
    }
  }, [open])

  // A section left open when the selection changes kind is a section of a
  // thing that is no longer on the bar.
  const stale = open !== null && showing === null
  useEffect(() => {
    if (stale) setOpen(null)
  }, [stale])

  const selectedId = selected?.id ?? null
  useEffect(() => {
    setSizeDraft(null)
  }, [selectedId])

  const target: Pick<CanvasObject, 'props'> = selected ?? { props: seed }
  // The head and the dash are read through the same functions the drawing uses,
  // so the button that looks pressed and the arrow on the plane cannot have
  // different ideas about what an unwritten field means.
  const asObject: CanvasObject = { id: '', type: 'arrow', props: target.props }
  const style = styleOf({ id: '', type: '', props: target.props })
  const fill = typeof target.props.fill === 'string' ? target.props.fill : null
  const line = typeof target.props.stroke === 'string' ? target.props.stroke : null
  const bordered = line !== null
  const width =
    typeof target.props.strokeWidth === 'number' ? target.props.strokeWidth : DEFAULTS.strokeWidth
  const radius = numberOf({ id: '', type: '', props: target.props }, 'radius', DEFAULTS.radius)
  const cornered = selected ? shapeOf(selected) === 'rect' : shapeInHand === 'rect'

  // The select tool with nothing selected has nothing to settle, and an empty
  // bar is a promise the app is not keeping. Nor has the eraser: it takes
  // away, and what it takes is chosen by where the hand goes.
  const eraser = !selected && tool === 'draw' && penKind === 'eraser'
  if ((selected === null && tool === 'select') || eraser) return null

  const opacity = selected ? numberOf(selected, 'opacity', DEFAULTS.opacity) : DEFAULTS.opacity

  // Toward the room it has: from the left edge of its button in the left half
  // of the bar, from the right edge in the right half, so the last section's
  // menu does not run off the side of the canvas.
  const toggle = (section: Section, button: HTMLElement): void => {
    if (open?.section === section) {
      setOpen(null)
      return
    }
    const panel = bar.current
    if (!panel) return
    const middle = button.offsetLeft + button.offsetWidth / 2
    setOpen(
      middle <= panel.clientWidth / 2
        ? { section, left: button.offsetLeft, right: null }
        : { section, left: null, right: panel.clientWidth - button.offsetLeft - button.offsetWidth }
    )
  }

  // What is in the box is what is taken, read off the box itself. Not because
  // the draft lags: an earlier guess was that it might and a mutation that read the
  // draft instead stayed green, so it does not. The box is simply the one
  // place the typed number is sure to be.
  const takeSize = (raw: string): void => {
    setSizeDraft(null)
    const typed = Number.parseFloat(raw)
    if (!Number.isFinite(typed)) return
    const size = Math.round(Math.min(SIZE_MOST, Math.max(SIZE_LEAST, typed)))
    if (size !== style.size) patchTargetStyle({ size })
  }
  const stepSize = (by: 1 | -1): void => {
    setSizeDraft(null)
    patchTargetStyle({ size: Math.min(SIZE_MOST, Math.max(SIZE_LEAST, style.size + by)) })
  }

  // A border turned on from nothing starts as a new box's does.
  const borderOn = (): Record<string, unknown> =>
    bordered ? {} : { stroke: NEW_BOX.stroke, strokeWidth: NEW_BOX.strokeWidth }

  const face = (section: Section): { body: ReactNode; wide?: boolean; bar?: string | null } => {
    switch (section) {
      case 'font':
        return {
          wide: true,
          body: (
            <>
              <span className="canvas-section-name" style={{ fontFamily: fontCss(style.font) }}>
                {FONT_NAMES[style.font] ?? style.font}
              </span>
              <Icon name="chevron-down" />
            </>
          )
        }
      case 'style':
        return { body: <Icon name="text-style" /> }
      case 'align':
        return { body: <Icon name={ALIGN_MARK[style.align]} /> }
      case 'colour':
        return { body: <Icon name="text-colour" />, bar: style.color }
      case 'highlight':
        return { body: <Icon name="highlighter" />, bar: style.highlight }
      case 'border':
        return { body: <Icon name="border" />, bar: line }
      case 'fill':
        return {
          body: (
            <span className="canvas-fill-chip">
              {fill !== null && <span style={{ background: fill }} />}
            </span>
          )
        }
      case 'line':
        return { body: <Icon name={DASH_MARK[dashOf(asObject)]} />, bar: line }
      case 'ends':
        return { body: <Icon name={HEAD_MARK[headOf(asObject)]} /> }
      case 'strength':
        return {
          wide: true,
          body: <span className="canvas-section-name">{Math.round(opacity * 100)}%</span>
        }
      case 'more':
        return { body: <Icon name="more" /> }
      default:
        return { body: null }
    }
  }

  const trigger = (section: Section): ReactNode => {
    if (section === 'size') {
      return (
        <div
          key="size"
          className={`canvas-size-box${showing?.section === 'size' ? ' is-open' : ''}`}
          data-section="size"
        >
          <input
            className="canvas-size-input"
            type="text"
            inputMode="numeric"
            title="Size"
            aria-label="Size"
            value={sizeDraft ?? String(style.size)}
            // Opens the sizes to pick from, and never closes them: a press on
            // a box already being typed into is someone putting the caret
            // somewhere.
            onFocus={(event) => {
              if (open?.section !== 'size') toggle('size', event.currentTarget.parentElement!)
              event.currentTarget.select()
            }}
            onClick={(event) => {
              if (open?.section !== 'size') toggle('size', event.currentTarget.parentElement!)
            }}
            onChange={(event) => setSizeDraft(event.target.value)}
            onBlur={(event) => takeSize(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                takeSize(event.currentTarget.value)
                setOpen(null)
              } else if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
                event.preventDefault()
                stepSize(event.key === 'ArrowUp' ? 1 : -1)
              }
            }}
          />
          <div className="canvas-stepper">
            <button className="canvas-stepper-up" title="Larger" onClick={() => stepSize(1)}>
              <Icon name="chevron-up" />
            </button>
            <button className="canvas-stepper-down" title="Smaller" onClick={() => stepSize(-1)}>
              <Icon name="chevron-down" />
            </button>
          </div>
        </div>
      )
    }
    const { body, wide, bar: under } = face(section)
    const opened = showing?.section === section
    return (
      <button
        key={section}
        className={
          'canvas-section' +
          (wide ? ' is-wide' : '') +
          (under !== undefined ? ' has-bar' : '') +
          (opened ? ' is-open' : '')
        }
        data-section={section}
        title={TITLES[section]}
        aria-haspopup="true"
        aria-expanded={opened}
        onClick={(event) => toggle(section, event.currentTarget)}
      >
        {body}
        {under !== undefined && under !== null && (
          <span className="canvas-section-bar" style={{ background: rgbOf(under) }} />
        )}
      </button>
    )
  }

  const pop = (section: Section): ReactNode => {
    switch (section) {
      case 'font':
        return FONTS.map((font) => {
          const on = style.font === font
          return (
            <button
              key={font}
              className="canvas-pop-row"
              role="menuitemradio"
              aria-checked={on}
              data-font={font}
              style={{ fontFamily: fontCss(font) }}
              onClick={() => {
                // The default is written as nothing, the way every other unset
                // field is: a file only carries what was chosen.
                patchTargetStyle({ font: font === DEFAULTS.font ? undefined : font })
                setOpen(null)
              }}
            >
              <span className="canvas-pop-tick">{on ? <Icon name="check" /> : null}</span>
              {FONT_NAMES[font]}
            </button>
          )
        })
      case 'size':
        return (
          <div className="canvas-sizes">
            {SIZES.map((size) => (
              <button
                key={size}
                className={`canvas-size${style.size === size ? ' is-on' : ''}`}
                onClick={() => {
                  setSizeDraft(null)
                  patchTargetStyle({ size })
                  setOpen(null)
                }}
              >
                {size}
              </button>
            ))}
          </div>
        )
      case 'style':
        return (
          <div className="canvas-row">
            <button
              className={`canvas-toggle is-mark${style.bold ? ' is-on' : ''}`}
              title="Bold"
              onClick={() => patchTargetStyle({ bold: style.bold ? undefined : true })}
            >
              <b>B</b>
            </button>
            <button
              className={`canvas-toggle is-mark${style.italic ? ' is-on' : ''}`}
              title="Italic"
              onClick={() => patchTargetStyle({ italic: style.italic ? undefined : true })}
            >
              <i>I</i>
            </button>
            <button
              className={`canvas-toggle is-mark${style.underline ? ' is-on' : ''}`}
              title="Underline"
              onClick={() => patchTargetStyle({ underline: style.underline ? undefined : true })}
            >
              <u>U</u>
            </button>
          </div>
        )
      case 'align':
        return (
          <>
            <Label>Across</Label>
            <div className="canvas-row">
              {(['left', 'center', 'right'] as const).map((align) => (
                <button
                  key={align}
                  className={`canvas-toggle is-mark${style.align === align ? ' is-on' : ''}`}
                  title={align}
                  data-align={align}
                  onClick={() =>
                    patchTargetStyle({ align: align === DEFAULTS.align ? undefined : align })
                  }
                >
                  <Icon name={ALIGN_MARK[align]} />
                </button>
              ))}
            </div>
            {/* In the format since step 2 and on no bar before. */}
            <Label>Up and down</Label>
            <div className="canvas-row">
              {(['top', 'middle', 'bottom'] as const).map((valign) => (
                <button
                  key={valign}
                  className={`canvas-toggle is-mark${style.valign === valign ? ' is-on' : ''}`}
                  title={valign}
                  data-valign={valign}
                  onClick={() =>
                    patchTargetStyle({ valign: valign === DEFAULTS.valign ? undefined : valign })
                  }
                >
                  <Icon name={VALIGN_MARK[valign]} />
                </button>
              ))}
            </div>
          </>
        )
      case 'colour':
        return (
          <Colours
            value={style.color}
            none="Follows the fill"
            onPick={(colour, mark) => patchTargetStyle({ color: colour }, mark)}
          />
        )
      case 'highlight':
        return (
          <Colours
            value={style.highlight}
            none="No highlight"
            onPick={(colour, mark) => patchTargetStyle({ highlight: colour }, mark)}
          />
        )
      case 'border':
        // the order: the style, the strength, the corners, the colour.
        return (
          <>
            <Label>Style</Label>
            <div className="canvas-row">
              {(['none', 'solid', 'dashed'] as const).map((kind) => {
                const on = kind === 'none' ? !bordered : bordered && dashOf(asObject) === kind
                return (
                  <button
                    key={kind}
                    className={`canvas-toggle${kind === 'none' ? '' : ' is-mark'}${on ? ' is-on' : ''}`}
                    title={kind}
                    data-border={kind}
                    onClick={() =>
                      patchTarget(
                        kind === 'none'
                          ? { stroke: undefined, strokeWidth: undefined, dash: undefined }
                          : { ...borderOn(), dash: kind === 'dashed' ? 'dashed' : undefined }
                      )
                    }
                  >
                    {kind === 'none' ? 'None' : <Icon name={DASH_MARK[kind]} />}
                  </button>
                )
              })}
            </div>
            <Widths
              value={bordered ? width : null}
              onPick={(size) => patchTarget({ ...borderOn(), strokeWidth: size })}
            />
            <Label>Opacity</Label>
            <Strength
              value={alphaOf(line)}
              off={!bordered}
              onChange={(alpha, mark) => {
                if (line !== null) patchTarget({ stroke: withAlpha(line, alpha) }, mark)
              }}
            />
            {cornered && (
              <>
                <Label>Corners</Label>
                <div className="canvas-row">
                  {CORNERS.map((corner) => (
                    <button
                      key={corner}
                      className={`canvas-toggle${radius === corner ? ' is-on' : ''}`}
                      title={`${corner}`}
                      data-radius={corner}
                      onClick={() => patchTarget({ radius: corner === DEFAULTS.radius ? undefined : corner })}
                    >
                      {corner}
                    </button>
                  ))}
                </div>
              </>
            )}
            <Label>Colour</Label>
            <Colours
              value={line}
              none={null}
              // The colour changes and the strength stays: a pale border made
              // blue is a pale blue border.
              onPick={(colour, mark) => {
                if (colour === undefined) return
                patchTarget(
                  { ...borderOn(), stroke: withAlpha(colour, bordered ? alphaOf(line) : alphaOf(NEW_BOX.stroke)) },
                  mark
                )
              }}
            />
          </>
        )
      case 'fill':
        return (
          <>
            <Colours
              value={fill}
              none="No fill"
              onPick={(colour, mark) =>
                patchTarget(
                  { fill: colour === undefined ? undefined : withAlpha(colour, alphaOf(fill)) },
                  mark
                )
              }
            />
            <Label>Opacity</Label>
            <Strength
              value={alphaOf(fill)}
              off={fill === null}
              onChange={(alpha, mark) => {
                if (fill !== null) patchTarget({ fill: withAlpha(fill, alpha) }, mark)
              }}
            />
          </>
        )
      case 'line':
        return (
          <>
            <Label>Colour</Label>
            <Colours
              value={line}
              none="Follows the surface"
              onPick={(colour, mark) => patchTarget({ stroke: colour }, mark)}
            />
            <Widths value={width} onPick={(size) => patchTarget({ strokeWidth: size })} />
            {arrow && (
              <>
                <Label>Style</Label>
                <div className="canvas-row">
                  {ARROW_DASHES.map((kind) => (
                    <button
                      key={kind}
                      className={`canvas-toggle is-mark${dashOf(asObject) === kind ? ' is-on' : ''}`}
                      title={kind}
                      data-dash={kind}
                      onClick={() => patchTarget({ dash: kind === 'solid' ? undefined : kind })}
                    >
                      <Icon name={DASH_MARK[kind]} />
                    </button>
                  ))}
                </div>
              </>
            )}
          </>
        )
      case 'ends':
        return (
          <div className="canvas-row">
            {ARROW_HEADS.map((kind) => (
              <button
                key={kind}
                className={`canvas-toggle is-mark${headOf(asObject) === kind ? ' is-on' : ''}`}
                title={kind}
                data-head={kind}
                // The default is written as nothing, the way every other
                // unset field is: a file only carries what was chosen.
                onClick={() => patchTarget({ head: kind === 'arrow' ? undefined : kind })}
              >
                <Icon name={HEAD_MARK[kind]} />
              </button>
            ))}
          </div>
        )
      case 'strength':
        // Opacity is here because a reference to draw over is most of what
        // gets put on a canvas, and a reference at full strength is not one.
        return (
          <div className="canvas-row">
            {IMAGE_OPACITIES.map((value) => (
              <button
                key={value}
                className={`canvas-toggle${opacity === value ? ' is-on' : ''}`}
                data-opacity={value}
                title={`${Math.round(value * 100)}%`}
                // Full strength is written as nothing, the way every other
                // unset field is: a file carries what was chosen.
                onClick={() => patchTarget({ opacity: value === 1 ? undefined : value })}
              >
                {Math.round(value * 100)}
              </button>
            ))}
          </div>
        )
      case 'more': {
        // The whole selection, not only the kind the bar is about: moving five
        // things to the front is moving five things. Delete asks nothing, the
        // same as the key it stands for, because Ctrl+Z is one press away.
        const acts: Array<{ act: string; icon: IconName; label: string; run: () => void; danger?: boolean }> = [
          { act: 'front', icon: 'front', label: 'Bring to front', run: () => orderObjects(selectedIds, 'front') },
          { act: 'back', icon: 'back', label: 'Send to back', run: () => orderObjects(selectedIds, 'back') },
          { act: 'duplicate', icon: 'copy', label: 'Duplicate', run: () => duplicateObjects(selectedIds) },
          { act: 'delete', icon: 'trash', label: 'Delete', run: () => removeObjects(selectedIds), danger: true }
        ]
        return acts.map((one) => (
          <button
            key={one.act}
            className={`canvas-pop-row${one.danger ? ' is-danger' : ''}`}
            role="menuitem"
            data-act={one.act}
            onClick={() => {
              setOpen(null)
              one.run()
            }}
          >
            <Icon name={one.icon} />
            {one.label}
          </button>
        ))
      }
      default:
        return null
    }
  }

  return (
    <div
      ref={bar}
      className="canvas-panel"
      data-for={picture ? 'image' : arrow ? 'arrow' : pen ? 'draw' : selected ? selected.type : tool}
    >
      <p className="canvas-panel-head" data-about={about}>
        {!selected ? 'The next one' : <Held taken={taken} />}
      </p>

      {/* A picture has no colour and no words to settle. What it has is a file,
          which is chosen rather than set - so with nothing held the bar is the
          way in. */}
      {picture && !selected ? (
        <>
          <span className="canvas-divider" />
          <div className="canvas-group">
            <span className="canvas-panel-label">Put a picture down</span>
            <button className="canvas-choose" onClick={() => void pickImages(null)}>
              Choose a file…
            </button>
            <span className="canvas-panel-note">
              Or drop one on the canvas, or paste one. It is copied into the workspace.
            </span>
          </div>
        </>
      ) : (
        <>
          {picture && selected && (
            <>
              <span className="canvas-divider" />
              <span className="canvas-panel-label canvas-panel-file" title={fileOf(selected) ?? ''}>
                {fileOf(selected) ?? 'No file'}
              </span>
            </>
          )}
          {groups.map((group, index) => (
            <Fragment key={index}>
              <span className="canvas-divider" />
              {group.map(trigger)}
            </Fragment>
          ))}
        </>
      )}

      {showing && (
        <div
          className="canvas-pop"
          role={showing.section === 'font' || showing.section === 'more' ? 'menu' : 'dialog'}
          aria-label={TITLES[showing.section]}
          data-for={showing.section}
          style={showing.left !== null ? { left: showing.left } : { right: showing.right ?? 0 }}
        >
          {pop(showing.section)}
        </div>
      )}
    </div>
  )
}

// A small heading inside a section's menu.
function Label({ children }: { children: ReactNode }) {
  return <p className="canvas-pop-label">{children}</p>
}

// The palette, "none" first when there is a none to choose, and the system's
// colour well last for a colour that is not on it. Dragging in the well sends a
// colour for every step of the hand, and all of them are one move to undo.
function Colours({
  value,
  none,
  onPick
}: {
  value: string | null
  none: string | null
  onPick: (colour: string | undefined, mark?: string | null) => void
}) {
  const gesture = useVault((state) => state.gesture)
  const mark = useRef<string | null>(null)
  // A colour carrying a strength is still the colour it is.
  const rgb = value === null ? null : rgbOf(value)
  const own = rgb !== null && !CANVAS_PALETTE.includes(rgb)
  return (
    <div className="canvas-swatches">
      {none !== null && (
        <button
          className={`canvas-swatch is-none${value === null ? ' is-on' : ''}`}
          title={none}
          onClick={() => onPick(undefined)}
        />
      )}
      {CANVAS_PALETTE.map((colour) => (
        <button
          key={colour}
          className={`canvas-swatch${rgb === colour ? ' is-on' : ''}`}
          style={{ background: colour }}
          title={colour}
          onClick={() => onPick(colour)}
        />
      ))}
      <input
        className={`canvas-own${own ? ' is-on' : ''}`}
        type="color"
        value={rgb ?? '#000000'}
        title="A colour of your own"
        aria-label="A colour of your own"
        onFocus={() => {
          mark.current = gesture('colour')
        }}
        onBlur={() => {
          mark.current = null
        }}
        onChange={(event) => onPick(event.target.value, mark.current)}
      />
    </div>
  )
}

// What is held, at the top of the bar. It used to be words - "This one",
// "These 4" - and they were replaced by icons of what is held. So it says WHAT is held rather than how much, by drawing
// one icon for each kind in it, a count in front of a kind there is more than
// one of, and a plus between kinds. For example, two texts and a
// rectangle is 2x text + rectangle.
//
// Past four it stops listing. A row of icons is read at a glance or it is not
// worth drawing, and eight of them is a count with extra steps - so it becomes
// the pile and the number, which is the same sentence in one glyph.
const MANY = 4

// The icon that stands for an object. A shape says which shape it is, since
// that is the word for one and the rail already draws all four. A
// text is not a shape here even though the file treats it as one: a label and
// a box are not the same thing to the eye.
const KIND_ICONS: Record<Kind, IconName> = {
  arrow: 'arrow',
  stroke: 'pencil',
  image: 'image',
  shape: 'box'
}

const SHAPE_ICONS: Record<Shape, IconName> = {
  rect: 'box',
  ellipse: 'ellipse',
  triangle: 'triangle',
  diamond: 'diamond'
}

// What each icon is called, for the hand that rests on it. The only words left
// in the head, and they are not on screen until then.
const ICON_WORDS: Partial<Record<IconName, string>> = {
  box: 'rectangle',
  ellipse: 'ellipse',
  triangle: 'triangle',
  diamond: 'diamond',
  text: 'text',
  arrow: 'arrow',
  pencil: 'pen line',
  image: 'picture',
  stack: 'objects'
}

function iconOf(object: CanvasObject): IconName {
  const kind = kindOf(object)
  if (kind !== 'shape') return KIND_ICONS[kind]
  return object.type === 'text' ? 'text' : SHAPE_ICONS[shapeOf(object)]
}

// One entry per kind, in the order the drawing holds them, each with how many
// of it there are.
function heldGroups(objects: CanvasObject[]): { icon: IconName; count: number }[] {
  const out: { icon: IconName; count: number }[] = []
  for (const object of objects) {
    const icon = iconOf(object)
    const found = out.find((group) => group.icon === icon)
    if (found) found.count++
    else out.push({ icon, count: 1 })
  }
  return out
}

const heldWords = (icon: IconName, count: number): string =>
  `${count} ${ICON_WORDS[icon] ?? icon}${count === 1 || icon === 'stack' ? '' : 's'}`

function Held({ taken }: { taken: CanvasObject[] }) {
  if (taken.length > MANY) {
    return (
      <span className="canvas-held" data-icon="stack" data-count={taken.length}>
        <Icon name="stack" />
        <span className="canvas-held-count">{taken.length}</span>
      </span>
    )
  }
  return (
    <>
      {heldGroups(taken).map((group, at) => (
        <Fragment key={group.icon}>
          {at > 0 && <span className="canvas-held-plus">+</span>}
          <span
            className="canvas-held"
            data-icon={group.icon}
            data-count={group.count}
            title={heldWords(group.icon, group.count)}
          >
            {group.count > 1 && <span className="canvas-held-count">{group.count}x</span>}
            <Icon name={group.icon} />
          </span>
        </Fragment>
      ))}
    </>
  )
}

// The widths of a line or a border. The width itself rather than the number
// for it: the choice is about how a line looks, and a row of numbers asks the
// user to imagine that.
function Widths({ value, onPick }: { value: number | null; onPick: (size: number) => void }) {
  return (
    <>
      <Label>Width</Label>
      <div className="canvas-widths">
        {PEN_WIDTHS.map((size) => (
          <button
            key={size}
            className={`canvas-width${value === size ? ' is-on' : ''}`}
            title={`${size}`}
            data-width={size}
            onClick={() => onPick(size)}
          >
            <span style={{ height: Math.min(size, 12) }} />
          </button>
        ))}
      </div>
    </>
  )
}

// A strength from 0 to 100. A drag is one move to undo however many steps the
// hand took; the mark is let go of when the hand is.
function Strength({
  value,
  off,
  onChange
}: {
  value: number
  off: boolean
  onChange: (alpha: number, mark: string | null) => void
}) {
  const gesture = useVault((state) => state.gesture)
  const mark = useRef<string | null>(null)
  const percent = Math.round(value * 100)
  const markNow = (): string => mark.current ?? (mark.current = gesture('strength'))
  return (
    <div className="canvas-alpha">
      <input
        className="canvas-alpha-range"
        type="range"
        min={0}
        max={100}
        step={1}
        value={percent}
        disabled={off}
        aria-label="Opacity"
        onChange={(event) => onChange(Number(event.target.value) / 100, markNow())}
        onPointerUp={() => {
          mark.current = null
        }}
        onBlur={() => {
          mark.current = null
        }}
      />
      <span className="canvas-alpha-value">{percent}%</span>
    </div>
  )
}
