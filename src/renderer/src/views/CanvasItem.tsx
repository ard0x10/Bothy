import { useEffect, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react'
import {
  DEFAULTS,
  boxOfObject,
  cornersOf,
  fileOf,
  fillOf,
  fontCss,
  inkOf,
  isArrow,
  isImage,
  isStroke,
  numberOf,
  pointsOf,
  shapeOf,
  strokeOf,
  styleOf,
  textOf,
  type CanvasObject
} from '../../../shared/canvas'
import { CURSOR, HANDLES, boxOf, handlePoint } from '../../../shared/geometry'
import { boundsOfPoints, strokePath, type Point } from '../../../shared/scribble'
import {
  PORTS,
  PORT_AT,
  dashOf,
  dashPattern,
  headOf,
  headPath,
  pointIn,
  portOut,
  type Ends
} from '../../../shared/arrow'
import { fileUrl } from '../../../shared/image'

// One object on the plane. Step 4 of v0.3 draws two kinds, and they are the
// same shape with different defaults: a text is a box that starts with no fill
// and no border.
//
// The text is in a foreignObject rather than an SVG <text>. SVG text does not
// wrap, and a box with a width that its words have to fit inside is exactly
// what wrapping is - written by hand it would be the measuring and line
// breaking this whole choice of surface was meant to avoid. What it costs is
// step 9: an SVG exported with foreignObject in it will not open the same way
// everywhere, so that step will have to lay the lines out itself or export a
// picture. Written down rather than found later.

type Props = {
  object: CanvasObject
  // Which workspace's files/ folder a picture's name is a name in. It is in the
  // url rather than being whichever workspace is open, so two workspaces each
  // holding a shot.png are two pictures to the window's cache rather than one.
  workspacePath: string
  selected: boolean
  // Whether this one gets handles to pull. Apart from selected since step 7: a
  // selection of five is five outlines and no handles, because pulling a corner
  // of five things at once is a group scale and that is not in this step.
  handles: boolean
  editing: boolean
  // The zoom, so the parts that belong to the hand rather than to the drawing -
  // the outline, the handles - stay the same size on screen at any zoom.
  k: number
  // Where an arrow's ends have got to, worked out by the surface because only
  // it has the rest of the canvas to look a binding up in. Null for anything
  // that is not an arrow, and also for an arrow whose binding points at
  // nothing - which the format says is drawn as nothing and kept anyway.
  ends: Ends | null
  // The four dots without the handles: an arrow is being dragged and this
  // is the object it would land on, which is worth showing on a box nobody has
  // selected. A held object wears them anyway, off `handles`.
  ports: boolean
  // Which of the four the end under the hand would take, or null when it
  // would land on the edge between them rather than on a dot.
  lit: string | null
  onGrab: (event: ReactPointerEvent<SVGElement>, id: string) => void
  onResize: (event: ReactPointerEvent<SVGElement>, id: string, handle: string) => void
  onEnd: (event: ReactPointerEvent<SVGElement>, id: string, which: string) => void
  // Pulling an arrow out of one of the four dots round a held object.
  onPort: (event: ReactPointerEvent<SVGElement>, id: string, port: string) => void
}

export function CanvasItem({
  object,
  workspacePath,
  selected,
  handles,
  editing,
  k,
  ends,
  ports,
  lit,
  onGrab,
  onResize,
  onEnd,
  onPort
}: Props) {
  // Asked of the object rather than of its type name: what makes a thing a
  // stroke is that it carries points, and a type this build has never heard of
  // that carries them is still a line somebody drew.
  if (isStroke(object)) {
    return (
      <StrokeItem
        object={object}
        selected={selected}
        handles={handles}
        k={k}
        onGrab={onGrab}
        onResize={onResize}
      />
    )
  }

  if (isArrow(object)) {
    // An arrow whose binding names an object that is not on the canvas. Not
    // drawn, and not dropped: the object stays in the file, and the day the
    // thing it points at comes back - undone, or written by something else -
    // the arrow is there waiting. The node is still here so that anything
    // looking can see it is present and unbound rather than gone.
    if (!ends) return <g className="canvas-item" data-id={object.id} data-type={object.type} data-unbound="yes" />
    return (
      <ArrowItem
        object={object}
        ends={ends}
        selected={selected}
        handles={handles}
        k={k}
        onGrab={onGrab}
        onEnd={onEnd}
      />
    )
  }

  // A picture, step 8. Asked of the file rather than of the type name, the same
  // as the two above: an object that names a file in files/ is something
  // somebody put on the canvas out of their folder.
  if (isImage(object)) {
    return (
      <ImageItem
        object={object}
        workspacePath={workspacePath}
        selected={selected}
        handles={handles}
        k={k}
        onGrab={onGrab}
        onResize={onResize}
        ports={ports}
        lit={lit}
        onPort={onPort}
      />
    )
  }

  const box = boxOf(object.props)
  const style = styleOf(object)
  const fill = fillOf(object)
  const stroke = typeof object.props.stroke === 'string' ? object.props.stroke : null
  // A border with no width of its own is the default width, the one the export
  // draws it at. Before, the surface drew it at 1 and the export at 2, so a
  // hand-written box came out of the app heavier than it was on screen.
  const strokeWidth =
    typeof object.props.strokeWidth === 'number'
      ? object.props.strokeWidth
      : stroke
        ? DEFAULTS.strokeWidth
        : 0
  const radius = typeof object.props.radius === 'number' ? object.props.radius : 0
  const opacity = typeof object.props.opacity === 'number' ? object.props.opacity : 1
  const rotation = typeof object.props.rotation === 'number' ? object.props.rotation : 0

  const text = textOf(object)
  const ink = inkOf(object)

  const textCss: CSSProperties = {
    display: 'flex',
    flexDirection: 'column',
    justifyContent:
      style.valign === 'middle' ? 'center' : style.valign === 'bottom' ? 'flex-end' : 'flex-start',
    boxSizing: 'border-box',
    width: '100%',
    height: '100%',
    padding: 8,
    overflow: 'hidden',
    // The text is plain and the file keeps it that way, so the line breaks in
    // it are the ones the user typed.
    whiteSpace: 'pre-wrap',
    overflowWrap: 'break-word',
    fontFamily: fontCss(style.font),
    fontSize: style.size,
    fontWeight: style.bold ? 700 : 400,
    fontStyle: style.italic ? 'italic' : 'normal',
    textDecoration: style.underline ? 'underline' : 'none',
    textAlign: style.align,
    lineHeight: style.lineHeight,
    // A colour of its own, or one that can be read on the fill, or the
    // surface's own ink when there is nothing underneath it.
    color: ink ?? 'var(--text)',
    // The shape underneath takes the pointer. Otherwise a drag that started on
    // a word would not be a drag on the box. This is not enough on its own -
    // the foreignObject holding this div takes the pointer as well, and it
    // covers the whole box; see where it is drawn, below.
    pointerEvents: 'none',
    userSelect: 'none'
  }

  const middle = { x: box.x + box.w / 2, y: box.y + box.h / 2 }
  const shape = shapeOf(object)
  const paint = {
    className: 'canvas-shape',
    // A text object has no fill, and a shape with no fill takes no pointer at
    // all - which would make it unclickable. Transparent is a fill.
    fill: fill ?? 'transparent',
    stroke: stroke ?? 'none',
    strokeWidth,
    strokeDasharray:
      stroke && dashOf(object) === 'dashed' ? dashPattern(strokeWidth).join(' ') : undefined,
    onPointerDown: (event: ReactPointerEvent<SVGElement>) => onGrab(event, object.id)
    // No onDoubleClick here. It sat on this shape from step 4 on and never
    // ran once - the surface captures the pointer on the press, so the click
    // lands on the surface. The surface is where it is caught now.
  }

  return (
    <g
      className="canvas-item"
      data-id={object.id}
      data-type={object.type}
      data-shape={shape}
      opacity={opacity}
      transform={rotation ? `rotate(${rotation} ${middle.x} ${middle.y})` : undefined}
    >
      {/* Only the drawn shape takes the pointer, so a press in the
          corner of an ellipse's box is a press on whatever is under it. */}
      {shape === 'ellipse' ? (
        <ellipse cx={middle.x} cy={middle.y} rx={box.w / 2} ry={box.h / 2} {...paint} />
      ) : shape === 'rect' ? (
        <rect x={box.x} y={box.y} width={box.w} height={box.h} rx={radius} {...paint} />
      ) : (
        <polygon
          points={cornersOf(shape, box).map((point) => point.join(',')).join(' ')}
          strokeLinejoin="round"
          {...paint}
        />
      )}

      {/* The words. Transparent to the hand: the div inside has taken no
          pointer since step 4, but the foreignObject is hit tested in its own
          right and is exactly the size of the box, so on a box with words in it
          every press in the middle landed there. Measured - elementFromPoint at
          the middle of a shape answered foreignObject, the press arrived at it,
          and the shape underneath was never selected, let alone double
          clicked. */}
      {!editing && text !== '' && (
        <foreignObject
          x={box.x}
          y={box.y}
          width={box.w}
          height={box.h}
          pointerEvents="none"
        >
          <div className="canvas-text" style={textCss}>
            {/* The marker, behind each line and as long as it. A span
                inside a block of its own: straight inside the column it would
                be a block itself, and the marker would be the box's width. */}
            {style.highlight ? (
              <div>
                <span
                  className="canvas-mark"
                  style={{
                    background: style.highlight,
                    boxDecorationBreak: 'clone',
                    WebkitBoxDecorationBreak: 'clone'
                  }}
                >
                  {text}
                </span>
              </div>
            ) : (
              text
            )}
          </div>
        </foreignObject>
      )}

      {selected && (
        <rect
          className="canvas-picked"
          x={box.x}
          y={box.y}
          width={box.w}
          height={box.h}
          rx={radius}
          fill="none"
          strokeWidth={1.5 / k}
        />
      )}

      {handles && (
        <>
          {HANDLES.map((handle) => {
            const at = handlePoint(box, handle)
            const size = 8 / k
            return (
              <rect
                key={handle}
                className="canvas-handle"
                data-handle={handle}
                x={at.x - size / 2}
                y={at.y - size / 2}
                width={size}
                height={size}
                style={{ cursor: CURSOR[handle] }}
                onPointerDown={(event) => onResize(event, object.id, handle)}
              />
            )
          })}
        </>
      )}

      {/* Outside the handles: the dots are worn by a held object AND by
          one an arrow is being dragged at, and the second of those has no
          handles on it. */}
      {(handles || ports) && (
        <Ports box={box} id={object.id} k={k} lit={lit} onPort={onPort} />
      )}
    </g>
  )
}

// The four dots round a held object: one a little outside the middle of each
// side. Pressing on a dot and dragging pulls out an arrow that starts from the
// middle of that side.
//
// Round, like an arrow's own ends and for the same reason the square handle
// beside each one is square: a square pulls a corner, a circle points
// somewhere. Standing off the edge rather than on it, which is what keeps the
// two apart under the hand - the handle's 8px square reaches 4 out from the
// edge, and the dot starts at 9.
//
// Sized and placed in screen pixels divided by the zoom, the same as the
// handles: what belongs to the hand stays the size of a hand at any zoom.
//
// The arrow it pulls out leaves from the port itself, not from the dot: the dot
// is where the hand aims, the port is where the line is tied.
function Ports({
  box,
  id,
  k,
  lit,
  onPort
}: {
  box: { x: number; y: number; w: number; h: number }
  id: string
  k: number
  lit: string | null
  onPort: (event: ReactPointerEvent<SVGElement>, id: string, port: string) => void
}) {
  const gap = 14 / k
  const size = 4.5 / k
  return (
    <>
      {PORTS.map((port) => {
        const on = PORT_AT[port]
        const at = pointIn(box, on)
        const out = portOut(on)
        return (
          <circle
            key={port}
            className={port === lit ? 'canvas-port is-lit' : 'canvas-port'}
            data-port={port}
            cx={at[0] + out[0] * gap}
            cy={at[1] + out[1] * gap}
            // The one an end would land on is drawn half again as big.
            // Size rather than colour, because the dot is already the accent
            // and a second colour on this surface would have to mean something
            // of its own.
            r={port === lit ? size * 1.5 : size}
            onPointerDown={(event) => onPort(event, id, port)}
          />
        )
      })}
    </>
  )
}

// A stroke, step 5. Two paths on top of each other: the one that is seen, and
// an invisible fat one underneath that the pointer can actually find. A 1px pen
// line is a target no hand can hit, and widening the visible line to make it
// hittable would be the app drawing something other than what was drawn.
function StrokeItem({
  object,
  selected,
  handles,
  k,
  onGrab,
  onResize
}: {
  object: CanvasObject
  selected: boolean
  handles: boolean
  k: number
  onGrab: (event: ReactPointerEvent<SVGElement>, id: string) => void
  onResize: (event: ReactPointerEvent<SVGElement>, id: string, handle: string) => void
}) {
  const points = pointsOf(object)
  const path = strokePath(points)
  const width = numberOf(object, 'strokeWidth', DEFAULTS.strokeWidth)
  // No colour of its own means the surface's own ink, the same as a text with
  // no colour: a stroke drawn in one theme has to still be there in the other.
  const ink = strokeOf(object)
  const opacity = numberOf(object, 'opacity', DEFAULTS.opacity)
  const box = boxOfObject(object)
  // Twelve pixels on screen at any zoom, or the pen itself when it is thicker.
  const reach = Math.max(width, 12 / k)
  // Room for the pen's own thickness, so the outline is around the line rather
  // than through it, plus a little air.
  const pad = width / 2 + 4 / k

  return (
    <g className="canvas-item" data-id={object.id} data-type={object.type} opacity={opacity}>
      <path
        className="canvas-stroke-grab"
        d={path}
        fill="none"
        stroke="transparent"
        strokeWidth={reach}
        onPointerDown={(event) => onGrab(event, object.id)}
      />
      <path
        className="canvas-stroke"
        d={path}
        fill="none"
        stroke={ink ?? 'var(--text)'}
        strokeWidth={width}
      />
      {selected && (
        <rect
          className="canvas-picked"
          x={box.x - pad}
          y={box.y - pad}
          width={box.w + pad * 2}
          height={box.h + pad * 2}
          fill="none"
          strokeWidth={1.5 / k}
        />
      )}

      {/* Step 7's handles. A scribble had none until now, which meant the one
          thing on the canvas that could be drawn at the wrong size was the one
          thing that could not be put right. They sit on the padded outline
          rather than on the points' own bounds, so a handle is somewhere a hand
          can find it rather than on top of the ink. */}
      {handles &&
        HANDLES.map((handle) => {
          const at = handlePoint(
            { x: box.x - pad, y: box.y - pad, w: box.w + pad * 2, h: box.h + pad * 2 },
            handle
          )
          const size = 8 / k
          return (
            <rect
              key={handle}
              className="canvas-handle"
              data-handle={handle}
              x={at.x - size / 2}
              y={at.y - size / 2}
              width={size}
              height={size}
              style={{ cursor: CURSOR[handle] }}
              onPointerDown={(event) => onResize(event, object.id, handle)}
            />
          )
        })}
    </g>
  )
}

// An arrow, step 6. The line, its head or heads, an invisible fat one to take
// the pointer, and - when it is held - a handle on each end to point it
// somewhere else.
function ArrowItem({
  object,
  ends,
  selected,
  handles,
  k,
  onGrab,
  onEnd
}: {
  object: CanvasObject
  ends: Ends
  selected: boolean
  handles: boolean
  k: number
  onGrab: (event: ReactPointerEvent<SVGElement>, id: string) => void
  onEnd: (event: ReactPointerEvent<SVGElement>, id: string, which: string) => void
}) {
  const width = numberOf(object, 'strokeWidth', DEFAULTS.strokeWidth)
  const ink = strokeOf(object)
  const opacity = numberOf(object, 'opacity', DEFAULTS.opacity)
  const head = headOf(object)
  const dash = dashOf(object)
  const reach = Math.max(width, 12 / k)
  const box = boundsOfPoints([ends.from, ends.to]) as { x: number; y: number; w: number; h: number }
  const pad = width / 2 + 4 / k
  const colour = ink ?? 'var(--text)'

  const along = { x1: ends.from[0], y1: ends.from[1], x2: ends.to[0], y2: ends.to[1] }

  return (
    <g className="canvas-item" data-id={object.id} data-type={object.type} opacity={opacity}>
      <line
        className="canvas-arrow-grab"
        {...along}
        stroke="transparent"
        strokeWidth={reach}
        onPointerDown={(event) => onGrab(event, object.id)}
      />
      <line
        className="canvas-arrow"
        {...along}
        stroke={colour}
        strokeWidth={width}
        strokeDasharray={dash === 'dashed' ? dashPattern(width).join(' ') : undefined}
      />
      {(head === 'arrow' || head === 'both') && (
        <path className="canvas-arrow-head" d={headPath(ends.to, ends.from, width)} fill={colour} />
      )}
      {head === 'both' && (
        <path className="canvas-arrow-head" d={headPath(ends.from, ends.to, width)} fill={colour} />
      )}

      {selected && (
        <rect
          className="canvas-picked"
          x={box.x - pad}
          y={box.y - pad}
          width={box.w + pad * 2}
          height={box.h + pad * 2}
          fill="none"
          strokeWidth={1.5 / k}
        />
      )}

      {handles && (
        <>
          {/* The arrow's own handles. They are not the box's eight - an arrow
              has no corners to pull, it has two ends to point somewhere. */}
          {(['from', 'to'] as const).map((which) => {
            const at: Point = which === 'from' ? ends.from : ends.to
            const size = 9 / k
            return (
              <rect
                key={which}
                className="canvas-end"
                data-end={which}
                x={at[0] - size / 2}
                y={at[1] - size / 2}
                width={size}
                height={size}
                rx={size / 2}
                onPointerDown={(event) => onEnd(event, object.id, which)}
              />
            )
          })}
        </>
      )}
    </g>
  )
}

// A picture on the plane, step 8.
//
// The pixels come down a scheme of our own rather than out of the file: the
// window is handed a url, and main works out which file inside which
// workspace's files/ folder that is. So the drawing holds a name and the window
// holds a picture, and neither has a copy of the other's half.
//
// preserveAspectRatio is none on purpose. What the picture is shaped like is
// the object's own width and height - it lands fitted to the view keeping its
// proportions, and a drag with Shift held may squash it. An <image> that
// letterboxed itself inside the rectangle would leave the handles pulling
// something the eye cannot see them pull.
function ImageItem({
  object,
  workspacePath,
  selected,
  handles,
  k,
  onGrab,
  onResize,
  ports,
  lit,
  onPort
}: {
  object: CanvasObject
  workspacePath: string
  selected: boolean
  handles: boolean
  k: number
  onGrab: (event: ReactPointerEvent<SVGElement>, id: string) => void
  onResize: (event: ReactPointerEvent<SVGElement>, id: string, handle: string) => void
  ports: boolean
  lit: string | null
  onPort: (event: ReactPointerEvent<SVGElement>, id: string, port: string) => void
}) {
  const box = boxOf(object.props)
  const name = fileOf(object) ?? ''
  const radius = numberOf(object, 'radius', DEFAULTS.radius)
  const opacity = numberOf(object, 'opacity', DEFAULTS.opacity)
  const rotation = numberOf(object, 'rotation', DEFAULTS.rotation)
  const url = fileUrl(workspacePath, name)

  // Whether the file behind the name is actually there. The format's rule for a
  // name with nothing behind it is the one a card's missing attachment has: the
  // object stays, and the day the file comes back the picture is there again.
  // So it is shown as missing rather than as nothing - an object drawn as
  // nothing is one nobody can find to delete.
  const [missing, setMissing] = useState(false)
  // The name can change under the same object - undo, or a file written from
  // outside. Without this the object would stay missing after the url it was
  // missing at had gone.
  useEffect(() => setMissing(false), [url])

  const middle = { x: box.x + box.w / 2, y: box.y + box.h / 2 }
  const clip = `canvas-clip-${object.id}`

  return (
    <g
      className="canvas-item"
      data-id={object.id}
      data-type={object.type}
      data-file={name}
      data-missing={missing ? 'yes' : undefined}
      opacity={opacity}
      transform={rotation ? `rotate(${rotation} ${middle.x} ${middle.y})` : undefined}
    >
      {radius > 0 && (
        <defs>
          <clipPath id={clip}>
            <rect x={box.x} y={box.y} width={box.w} height={box.h} rx={radius} />
          </clipPath>
        </defs>
      )}

      {missing ? (
        <>
          <rect
            className="canvas-missing"
            x={box.x}
            y={box.y}
            width={box.w}
            height={box.h}
            rx={radius}
            strokeWidth={1.5 / k}
          />
          {/* The name, so what is missing can be gone and found rather than
              guessed at. Clipped to the rectangle, because a long file name
              across the canvas would be worse than a short one cut off. */}
          <text
            className="canvas-missing-name"
            x={middle.x}
            y={middle.y}
            clipPath={radius > 0 ? `url(#${clip})` : undefined}
          >
            {name}
          </text>
        </>
      ) : (
        <image
          href={url}
          x={box.x}
          y={box.y}
          width={box.w}
          height={box.h}
          preserveAspectRatio="none"
          clipPath={radius > 0 ? `url(#${clip})` : undefined}
          onError={() => setMissing(true)}
        />
      )}

      {/* The picture itself takes no pointer: a transparent rectangle over it
          does. An <image> with holes in it - which is most of what gets pasted
          onto a canvas - would otherwise be a thing you can only take hold of
          by the parts that happen to be opaque. */}
      <rect
        className="canvas-shape"
        x={box.x}
        y={box.y}
        width={box.w}
        height={box.h}
        rx={radius}
        fill="transparent"
        stroke="none"
        onPointerDown={(event) => onGrab(event, object.id)}
      />

      {selected && (
        <rect
          className="canvas-picked"
          x={box.x}
          y={box.y}
          width={box.w}
          height={box.h}
          rx={radius}
          fill="none"
          strokeWidth={1.5 / k}
        />
      )}

      {handles && (
        <>
          {HANDLES.map((handle) => {
            const at = handlePoint(box, handle)
            const size = 8 / k
            return (
              <rect
                key={handle}
                className="canvas-handle"
                data-handle={handle}
                x={at.x - size / 2}
                y={at.y - size / 2}
                width={size}
                height={size}
                style={{ cursor: CURSOR[handle] }}
                onPointerDown={(event) => onResize(event, object.id, handle)}
              />
            )
          })}
        </>
      )}

      {/* Outside the handles: the dots are worn by a held object AND by
          one an arrow is being dragged at, and the second of those has no
          handles on it. */}
      {(handles || ports) && (
        <Ports box={box} id={object.id} k={k} lit={lit} onPort={onPort} />
      )}
    </g>
  )
}
