import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { useVault, useWorkspace } from '../store'
import {
  DEFAULTS,
  fontCss,
  isArrow,
  isImage,
  isStroke,
  boxOfObject,
  inkOf,
  numberOf,
  pointsOf,
  styleOf,
  type CanvasObject,
  type Endpoint
} from '../../../shared/canvas'
import {
  PORT_AT,
  arrowEnds,
  objectAt,
  pointIn,
  snapAt,
  type Port,
  type Snap
} from '../../../shared/arrow'
import { gathered, lockFor, movedProps, resizedProps } from '../../../shared/edit'
import { MIN_SIZE, boxFromDrag, boxOf, type Handle } from '../../../shared/geometry'
import { simplify, strokeMeets, strokePath, toleranceAt, type Point } from '../../../shared/scribble'
import { isImageName } from '../../../shared/image'
import {
  CANVAS_KEYS,
  gridStep,
  type Box,
  keyText,
  percent,
  toScreen,
  toWorld,
  zoomTo
} from '../../../shared/viewport'
import { CanvasItem } from './CanvasItem'
import { CanvasBar, CanvasRail } from './CanvasRail'
import { Icon } from './Icon'

// The canvas surface. Step 3 gave it a plane to stand on, step 4 put boxes and
// text on it with the tool rail down the left, step 5 added the pen and step 6
// the arrow.
//
// Drawn as SVG rather than a 2D context, and the reason shows up in this step:
// a box holds text with a size, a weight and an alignment, and on a canvas
// element each of those is a text engine written by hand before a single box
// appears. In SVG an object is also a node, so a check can ask the window what
// is on the surface, and the theme reaches it through the same variables as the
// rest of the app. The cost is speed at thousands of nodes, which is a number
// and gets measured when there is something to measure.

// Every kind that changes the canvas carries a mark. Everything written under
// one mark is one move to undo, however many events the hand sent - the rule is
// in history.ts and the marks come from the store's gesture().
type Drag =
  | { kind: 'pan'; id: number; x: number; y: number }
  // A move carries what every object being moved WAS when the hand took hold of
  // it, and the travel is measured from the press rather than from the last
  // event. Adding up rounded steps loses a fraction of a unit on every one of
  // the hundred events a drag sends; measured from the press there is one
  // rounding. What each kind of object does with that travel - a box has an x,
  // a scribble has only its points, an arrow has ends and a bound one is not
  // its to move - is movedProps, out in shared where it can be measured.
  | { kind: 'move'; id: number; mark: string; x: number; y: number; held: CanvasObject[] }
  // One end of an arrow being pointed somewhere else.
  | { kind: 'endpoint'; id: number; mark: string; object: string; which: 'from' | 'to' }
  | {
      kind: 'resize'
      id: number
      mark: string
      handle: Handle
      x: number
      y: number
      held: CanvasObject
    }
  // The selection rectangle. It keeps what was already held so that Shift adds
  // to a selection rather than starting one.
  | { kind: 'marquee'; id: number; from: { x: number; y: number }; add: string[] }
  // Drawing a rectangle out, and drawing a line by hand. Two gestures that look
  // alike and are not: one remembers a corner, the other keeps everywhere the
  // hand has been.
  | { kind: 'draw'; id: number; from: { x: number; y: number } }
  | { kind: 'pen'; id: number }
  // The eraser going over the plane: where the hand was last, so the stretch
  // between two events is asked too, and one mark for everything it takes.
  | { kind: 'erase'; id: number; mark: string; last: { x: number; y: number } }
  // Drawing an arrow out: where the hand went down, and where it is now. The
  // start is carried only when the gesture began on a port: that end is
  // already decided, and asking the plane what is under the press would tie it
  // wherever the maths thinks the edge is instead of to the dot that was
  // pulled.
  | { kind: 'arrow'; id: number; from: { x: number; y: number }; start?: Endpoint }

export function Canvas() {
  const workspace = useWorkspace()
  const view = useVault((state) => state.viewport)
  const size = useVault((state) => state.canvasSize)
  const keysOpen = useVault((state) => state.canvasKeysOpen)
  const canvas = useVault((state) => state.canvas)
  const tool = useVault((state) => state.tool)
  const selectedIds = useVault((state) => state.selectedIds)
  const editingId = useVault((state) => state.editingId)
  const history = useVault((state) => state.history)

  const setCanvasSize = useVault((state) => state.setCanvasSize)
  const loadViewport = useVault((state) => state.loadViewport)
  const loadCanvas = useVault((state) => state.loadCanvas)
  const panCanvas = useVault((state) => state.panCanvas)
  const canvasAction = useVault((state) => state.canvasAction)
  const setCanvasKeys = useVault((state) => state.setCanvasKeys)
  const notice = useVault((state) => state.notice)
  const setNotice = useVault((state) => state.setNotice)
  const exportCanvasFile = useVault((state) => state.exportCanvasFile)
  const importCanvasFile = useVault((state) => state.importCanvasFile)
  const exportPicture = useVault((state) => state.exportPicture)
  // Not in the store, unlike the shortcut sheet. That one is remembered
  // because it is a thing you leave open while you work; this one closes the
  // moment it is used, so keeping it would be keeping a state nobody is ever
  // in.
  const [moveOpen, setMoveOpen] = useState(false)
  const selectObjects = useVault((state) => state.selectObjects)
  const toggleObject = useVault((state) => state.toggleObject)
  const editObject = useVault((state) => state.editObject)
  const gesture = useVault((state) => state.gesture)
  const addObject = useVault((state) => state.addObject)
  const addStroke = useVault((state) => state.addStroke)
  const addArrow = useVault((state) => state.addArrow)
  const dropImages = useVault((state) => state.dropImages)
  const pickImages = useVault((state) => state.pickImages)
  const repoint = useVault((state) => state.repoint)
  const newDraw = useVault((state) => state.newDraw)
  const newMarker = useVault((state) => state.newMarker)
  const newArrow = useVault((state) => state.newArrow)
  const pen = useVault((state) => state.pen)
  const eraseObjects = useVault((state) => state.eraseObjects)
  const patchObject = useVault((state) => state.patchObject)
  const patchMany = useVault((state) => state.patchMany)

  const surface = useRef<HTMLElement>(null)
  const drag = useRef<Drag | null>(null)
  const space = useRef(false)
  // The rectangle being drawn out, in world units. State rather than a ref,
  // because it is on screen while the hand is moving.
  const [draft, setDraft] = useState<{ x: number; y: number; w: number; h: number } | null>(null)
  // The stroke as it is being drawn, before it is thinned. Every point the
  // pointer reported, so what is on screen while the hand is moving is the hand
  // rather than an opinion about it; the thinning happens once, on release.
  //
  // Held twice on purpose. The ref is the record - it is written the moment the
  // event arrives, the same as the drag above it, and it is what the release
  // reads. The state is a copy for drawing, and a copy is all it can be: state
  // is applied when React gets round to it, so a run of moves that arrives
  // faster than that would still be in the queue when the hand lets go, and the
  // stroke would be finished from a list that had not caught up yet.
  const trail = useRef<Point[] | null>(null)
  const [drawing, setDrawing] = useState<Point[] | null>(null)
  // The arrow being drawn out. Two points rather than a list: an arrow is where
  // it starts and where it ends, and everything else about it is worked out.
  const [line, setLine] = useState<{ from: Point; to: Point } | null>(null)
  // The selection rectangle as it is being drawn out, in world units.
  const [band, setBand] = useState<Box | null>(null)
  // Where the end under the hand would land if it were let go now: the
  // object it would tie to, the port if it is one, and the point on the plane.
  // Held while an arrow is being drawn or an end is being pointed somewhere,
  // and null the rest of the time. It is what puts the dots on a box that is
  // not selected and lights the one being aimed at - the hand has to see where
  // it is going before it lets go, not after.
  const [snap, setSnap] = useState<Snap | null>(null)

  const path = workspace?.path ?? null
  useEffect(() => {
    if (!path) return
    void loadViewport(path)
    void loadCanvas(path)
  }, [path, loadViewport, loadCanvas])

  useEffect(() => {
    const node = surface.current
    if (!node) return
    const measure = (): void => {
      const box = node.getBoundingClientRect()
      setCanvasSize({ w: box.width, h: box.height })
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(node)
    return () => observer.disconnect()
  }, [setCanvasSize])

  // Wheel is a native listener rather than React's, because it has to be able
  // to say no. Chromium zooms the whole window on Ctrl and wheel, and React
  // attaches wheel passively, where preventDefault does nothing at all.
  //
  // The wheel zooms, Ctrl or not, and no longer pans up and down. Ctrl still
  // zooms because a
  // pinch on a touchpad arrives as Ctrl and the wheel. What is left of the
  // wheel's panning is sideways, which was not taken away: Shift and the wheel,
  // or a touchpad's own sideways travel. Up and down is the right button or
  // Space and a drag.
  useEffect(() => {
    const node = surface.current
    if (!node) return
    const onWheel = (event: WheelEvent): void => {
      event.preventDefault()
      const state = useVault.getState()
      if (event.shiftKey) {
        // A wheel under Shift reports either axis depending on the system.
        state.panCanvas(-(event.deltaX || event.deltaY), 0)
        return
      }
      const box = node.getBoundingClientRect()
      const at = { x: event.clientX - box.left, y: event.clientY - box.top }
      if (event.deltaY !== 0) {
        const next = state.viewport.k * Math.pow(1.0015, -event.deltaY)
        state.setViewport(zoomTo(state.viewport, next, at.x, at.y))
      }
      if (event.deltaX !== 0) useVault.getState().panCanvas(-event.deltaX, 0)
    }
    node.addEventListener('wheel', onWheel, { passive: false })
    return () => node.removeEventListener('wheel', onWheel)
  }, [])

  // Space is held to drag the surface. A state, not a command, which is why it
  // is here rather than with the shortcuts.
  useEffect(() => {
    const down = (event: KeyboardEvent): void => {
      if (event.code !== 'Space' || event.repeat) return
      if (isTyping(event.target)) return
      space.current = true
      surface.current?.classList.add('canvas-grab')
      event.preventDefault()
    }
    const off = (): void => {
      space.current = false
      surface.current?.classList.remove('canvas-grab')
    }
    const up = (event: KeyboardEvent): void => {
      if (event.code === 'Space') off()
    }
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    window.addEventListener('blur', off)
    return () => {
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
      window.removeEventListener('blur', off)
    }
  }, [])

  // Pasting a picture. The clipboard hands over bytes and a type and no file at
  // all - a screenshot has never been on the disk - so this is the one way in
  // that has to write the file itself, and the one that has to make up a name.
  //
  // On the window rather than on the surface because a paste is a key, and keys
  // do not land where the pointer is. What it must not do is take a paste away
  // from a box being typed into, which is what isTyping is for; the shortcut
  // sheet and the rail are in this section too and a paste in either of those
  // is a paste into nothing.
  useEffect(() => {
    const onPaste = (event: ClipboardEvent): void => {
      if (isTyping(event.target)) return
      const files = Array.from(event.clipboardData?.files ?? []).filter((file) =>
        file.type.startsWith('image/')
      )
      if (files.length === 0) return
      event.preventDefault()
      void useVault.getState().pasteImages(files)
    }
    window.addEventListener('paste', onPaste)
    return () => window.removeEventListener('paste', onPaste)
    // Nothing here closes over a render: the workspace, the viewport and the
    // size are all read out of the store when the paste happens, so a listener
    // attached once stays right.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const worldAt = (event: { clientX: number; clientY: number }): { x: number; y: number } => {
    const box = surface.current?.getBoundingClientRect()
    if (!box) return { x: 0, y: 0 }
    return toWorld(view, event.clientX - box.left, event.clientY - box.top)
  }

  // What the drop actually carries. Electron took File.path away, so where a
  // dropped file is has to be asked on the preload's side of the bridge; a file
  // with no path behind it is one the browser made up - a drag out of a web
  // page - and there is nothing on disk to copy.
  const droppedImages = (list: FileList | null): string[] => {
    const out: string[] = []
    for (const file of Array.from(list ?? [])) {
      if (!file.type.startsWith('image/') && !isImageName(file.name)) continue
      const source = window.api.pathForFile(file)
      if (source) out.push(source)
    }
    return out
  }

  // The eraser: every pen stroke the hand passes over goes, as one
  // move to undo however many it took. Strokes only - it was chosen as the
  // thing that takes away a pen's line, and a box or an arrow under the same
  // hand stays. The reach is a distance on the screen, for the same reason the
  // pen's tolerance is, plus half the stroke's own width.
  const erase = (from: { x: number; y: number }, to: { x: number; y: number }, mark: string): void => {
    const objects = useVault.getState().canvas?.objects ?? []
    const reach = ERASER_PX / view.k
    const hit = objects
      .filter(
        (object) =>
          // Said for the reader rather than for the answer: an object with
          // no points meets nothing in strokeMeets either, so a box or an
          // arrow would stay without it.
          isStroke(object) &&
          strokeMeets(
            pointsOf(object),
            [from.x, from.y],
            [to.x, to.y],
            reach + numberOf(object, 'strokeWidth', DEFAULTS.strokeWidth) / 2
          )
      )
      .map((object) => object.id)
    if (hit.length > 0) eraseObjects(hit, mark)
  }

  // The surface itself: panning, drawing a new object, and putting the
  // selection down. Anything that started on an object never gets here.
  const onPointerDown = (event: ReactPointerEvent<HTMLElement>): void => {
    // The rail, the zoom cluster, the shortcut sheet and the box being typed
    // into all sit inside this section, so a press on any of them arrives here
    // as well. Untouched, that press put the selection down before the click it
    // belongs to ever ran - so choosing a colour for the selected box coloured
    // the next box instead, and the box the user had chosen let go. Only a
    // press that landed on the drawing surface is a press on the canvas.
    if (!(event.target as Element | null)?.closest?.('.canvas-surface')) return

    // The middle button, the right one held down, or Space with the left.
    if (event.button === 1 || event.button === 2 || (event.button === 0 && space.current)) {
      event.preventDefault()
      drag.current = { kind: 'pan', id: event.pointerId, x: event.clientX, y: event.clientY }
      event.currentTarget.setPointerCapture(event.pointerId)
      event.currentTarget.classList.add('canvas-grabbing')
      return
    }
    if (event.button !== 0) return

    if (tool === 'select') {
      // A press on the surface is the start of a selection rectangle. It is
      // also, if the hand never travels, a click on nothing - which puts the
      // selection down. Both are the same gesture and the release tells them
      // apart, so the selection is only let go of here when Shift is not held:
      // Shift means "and also these", and it has to keep what is already held.
      event.currentTarget.setPointerCapture(event.pointerId)
      drag.current = {
        kind: 'marquee',
        id: event.pointerId,
        from: worldAt(event),
        add: event.shiftKey ? useVault.getState().selectedIds : []
      }
      if (!event.shiftKey) selectObjects([])
      return
    }
    // The image tool has nothing to draw out: a picture is a file, and where it
    // goes is the only thing a press has to say. So the press opens the picker
    // and the picture lands where the press was, the same as a click with the
    // box tool puts a box down where it was clicked.
    if (tool === 'image') {
      event.preventDefault()
      void pickImages(worldAt(event))
      return
    }
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    if (tool === 'draw' && pen === 'eraser') {
      const at = worldAt(event)
      const held = { kind: 'erase' as const, id: event.pointerId, mark: gesture('erase'), last: at }
      drag.current = held
      erase(at, at, held.mark)
      return
    }
    if (tool === 'draw') {
      const at = worldAt(event)
      drag.current = { kind: 'pen', id: event.pointerId }
      trail.current = [[at.x, at.y]]
      setDrawing(trail.current)
      return
    }
    if (tool === 'arrow') {
      const at = worldAt(event)
      drag.current = { kind: 'arrow', id: event.pointerId, from: at }
      setLine({ from: [at.x, at.y], to: [at.x, at.y] })
      return
    }
    drag.current = { kind: 'draw', id: event.pointerId, from: worldAt(event) }
  }

  // What the end under the hand would tie to if it were let go now. Asked
  // of the store rather than of the render, because a drag reads it many times
  // a second and the list this component was drawn with may be one patch
  // behind. The same call the release makes, so what is shown is what is
  // written rather than a second opinion about it.
  const snapFor = (at: Point, skip: string | null): Snap | null => {
    const objects = useVault.getState().canvas?.objects ?? []
    return snapAt(
      skip ? objects.filter((one) => one.id !== skip) : objects,
      at,
      SNAP_PX / view.k
    )
  }

  const onPointerMove = (event: ReactPointerEvent<HTMLElement>): void => {
    const held = drag.current
    if (!held || held.id !== event.pointerId) return

    if (held.kind === 'pan') {
      panCanvas(event.clientX - held.x, event.clientY - held.y)
      drag.current = { ...held, x: event.clientX, y: event.clientY }
      return
    }
    if (held.kind === 'pen') {
      const at = worldAt(event)
      trail.current = [...(trail.current ?? []), [at.x, at.y]]
      setDrawing(trail.current)
      return
    }
    if (held.kind === 'erase') {
      const at = worldAt(event)
      erase(held.last, at, held.mark)
      drag.current = { ...held, last: at }
      return
    }
    if (held.kind === 'arrow') {
      const at = worldAt(event)
      // Pulled out of a port, the object it came from is left out of the
      // asking: a drag back onto it writes nothing, and a dot lit under the
      // hand would promise an arrow that is not going to be there.
      const found = snapFor([at.x, at.y], held.start && 'of' in held.start ? held.start.of : null)
      setSnap(found)
      setLine({ from: [held.from.x, held.from.y], to: found ? found.point : [at.x, at.y] })
      return
    }
    if (held.kind === 'marquee') {
      const now = worldAt(event)
      setBand({
        x: Math.min(held.from.x, now.x),
        y: Math.min(held.from.y, now.y),
        w: Math.abs(now.x - held.from.x),
        h: Math.abs(now.y - held.from.y)
      })
      return
    }
    if (held.kind === 'endpoint') {
      // Written as a loose point while the hand is moving, and tied to
      // something on release if there is something there. Dragging an end that
      // was tied lets go of the tie on the first move, which is what taking
      // hold of it means.
      //
      // The loose point is the place it would land rather than the
      // place the hand is, whenever the hand is near something: what is drawn
      // under the hand IS the answer, and letting go only writes it down. Kept
      // exact when it is snapped and rounded when it is not - a snapped point
      // is on a dot or an edge, and half a world pixel off that is two on the
      // screen at 4x.
      const at = worldAt(event)
      const found = snapFor([at.x, at.y], held.object)
      setSnap(found)
      const to = found
        ? { x: found.point[0], y: found.point[1] }
        : { x: Math.round(at.x), y: Math.round(at.y) }
      repoint(held.object, held.which, to, held.mark)
      return
    }
    if (held.kind === 'draw') {
      const now = worldAt(event)
      setDraft({
        x: Math.min(held.from.x, now.x),
        y: Math.min(held.from.y, now.y),
        w: Math.abs(now.x - held.from.x),
        h: Math.abs(now.y - held.from.y)
      })
      return
    }

    // Moving and resizing are in world units: the pointer's travel on screen
    // divided by the zoom, so a box follows the cursor at any zoom rather than
    // at a tenth of it.
    const dx = (event.clientX - held.x) / view.k
    const dy = (event.clientY - held.y) / view.k

    if (held.kind === 'move') {
      // Everything being moved, in one write. Several writes would be several
      // entries in the history, and moving five things is one move whatever it
      // was five of. An object with nothing that moving it would change - an
      // arrow tied at both ends - answers null and is simply not in the list.
      const patches: Array<{ id: string; props: Record<string, unknown> }> = []
      for (const object of held.held) {
        const props = movedProps(object, dx, dy)
        if (props) patches.push({ id: object.id, props })
      }
      if (patches.length > 0) patchMany(patches, held.mark)
      return
    }

    // Measured from the press, the same as a move, and against what the object
    // was when it was taken hold of. It used to read the object again on every
    // event and add a step to it, which put a rounding into every one of them.
    // Whether the shape may be squashed is asked of the object and of the key
    // that is down right now, rather than of what was held when the drag
    // started: Shift pressed halfway through a drag lets go of the proportions
    // from there, which is what holding it down has to mean.
    const resized = resizedProps(
      held.held,
      held.handle,
      dx,
      dy,
      lockFor(held.held, event.shiftKey)
    )
    if (resized) patchObject(held.held.id, resized, held.mark)
  }

  const onPointerUp = (event: ReactPointerEvent<HTMLElement>): void => {
    const held = drag.current
    if (!held || held.id !== event.pointerId) return
    drag.current = null
    event.currentTarget.classList.remove('canvas-grabbing')
    // The dots a drag lit go out with the drag, whatever it turned out to be.
    // Cleared here rather than in each branch below: several of them
    // return early, and a dot left burning on a box nobody is aiming at any
    // more would be the kind of thing only a second drag clears.
    setSnap(null)

    // Everything the eraser took went as it passed over it.
    if (held.kind === 'erase') return
    if (held.kind === 'arrow') {
      const at = worldAt(event)
      setLine(null)
      const objects = useVault.getState().canvas?.objects ?? []
      const reach = SNAP_PX / view.k
      // Pulled out of a port, that end is already settled and is not asked
      // again. Everything else is whatever is under where the hand went down.
      const from = held.start ?? bind(objects, [held.from.x, held.from.y], reach, false)
      const to = bind(objects, [at.x, at.y], reach)
      // A port pulled back onto the object it came out of is not an arrow. It
      // would be a line from a box to itself, which nobody draws on purpose and
      // which the ends cannot even point in a direction.
      if (held.start && 'of' in held.start && to && 'of' in to && to.of === held.start.of) return
      // A press that never travelled is not an arrow. Two ends in the same
      // place would be a thing with no direction and nothing to point at, and
      // the surface is where a stray click lands most often.
      //
      // Measured on the screen rather than on the plane, and for the same
      // reason the pen's tolerance is: what is being asked is whether the hand
      // moved, and a hand does not know what the canvas is zoomed to. In world
      // units the same flick of the wrist would draw an arrow at 10% and
      // quietly do nothing at 4x.
      const travelled = Math.hypot(at.x - held.from.x, at.y - held.from.y) * view.k
      if (travelled >= MIN_TRAVEL) addArrow(from, to)
      return
    }
    if (held.kind === 'marquee') {
      setBand(null)
      const to = worldAt(event)
      const rect = {
        x: Math.min(held.from.x, to.x),
        y: Math.min(held.from.y, to.y),
        w: Math.abs(to.x - held.from.x),
        h: Math.abs(to.y - held.from.y)
      }
      // A press that never travelled was a click on the surface, and that has
      // already happened: the selection went down on the way in. Measured on
      // the screen rather than on the plane, like the arrow's and the pen's -
      // whether a hand moved is not a question about what the canvas is zoomed
      // to.
      if (Math.hypot(rect.w, rect.h) * view.k < MIN_TRAVEL) return
      const objects = useVault.getState().canvas?.objects ?? []
      const find = (id: string): CanvasObject | undefined =>
        objects.find((object) => object.id === id)
      const found = gathered(objects, rect, (object) => arrowEnds(object, find))
      selectObjects([...new Set([...held.add, ...found])])
      return
    }
    if (held.kind === 'endpoint') {
      const at = worldAt(event)
      const objects = useVault.getState().canvas?.objects ?? []
      const end = bind(
        objects.filter((one) => one.id !== held.object),
        [at.x, at.y],
        SNAP_PX / view.k
      )
      repoint(held.object, held.which, end, held.mark)
      return
    }
    if (held.kind === 'pen') {
      // Thinned here and nowhere else, so what goes on the plane is what goes
      // in the file. The tolerance is a distance on the screen and is divided
      // by the zoom on the way in: drawn at 4x, the same gesture keeps four
      // times the detail, which is what zooming in to draw something small has
      // to mean.
      const drawn = trail.current ?? []
      trail.current = null
      setDrawing(null)
      if (drawn.length > 0) addStroke(simplify(drawn, toleranceAt(view.k)))
      return
    }
    if (held.kind === 'draw') {
      // A drag makes a box that size; a click makes one of the usual size with
      // its corner where the click was. Both are how a hand puts one down.
      const drawn = boxFromDrag(held.from, worldAt(event))
      const seed = tool === 'text' ? useVault.getState().newText : useVault.getState().newBox
      addObject(tool, drawn ?? { x: held.from.x, y: held.from.y, w: num(seed.w), h: num(seed.h) })
      setDraft(null)
    }
  }

  // A grab that started on an object. Selecting and moving are one gesture: the
  // press selects, and if the hand travels the same press moves what is held.
  const onGrab = (event: ReactPointerEvent<SVGElement>, id: string): void => {
    if (event.button !== 0 || space.current || tool !== 'select') return
    event.stopPropagation()

    let ids = useVault.getState().selectedIds
    if (event.shiftKey) {
      toggleObject(id)
      ids = useVault.getState().selectedIds
      // Shift on something that was held takes it out. Nothing is being picked
      // up, so nothing should move if the hand now travels.
      if (!ids.includes(id)) return
    } else if (!ids.includes(id)) {
      // A press on something that was not held starts a new selection. A press
      // on something that was keeps the whole of it - that is how several
      // things are dragged at once, and it is the only way they can be: the
      // press that starts the drag would otherwise throw the rest away.
      selectObjects([id])
      ids = [id]
    }

    const taken = new Set(ids)
    drag.current = {
      kind: 'move',
      id: event.pointerId,
      mark: gesture('move'),
      x: event.clientX,
      y: event.clientY,
      held: (canvas?.objects ?? []).filter((object) => taken.has(object.id))
    }
    surface.current?.setPointerCapture(event.pointerId)
  }

  const onEndGrab = (event: ReactPointerEvent<SVGElement>, id: string, which: string): void => {
    if (event.button !== 0 || space.current || tool !== 'select') return
    event.stopPropagation()
    selectObjects([id])
    drag.current = {
      kind: 'endpoint',
      id: event.pointerId,
      mark: gesture('end'),
      object: id,
      which: which as 'from' | 'to'
    }
    surface.current?.setPointerCapture(event.pointerId)
  }

  // An arrow pulled out of one of an object's four dots. The same drag the
  // arrow tool starts, with two differences: it starts at the port rather than
  // under the hand, and the end it starts from is decided here rather than
  // asked of the plane on release.
  //
  // Works with the select tool in hand - that is the whole point of it, the dots
  // are only there while something is held - and the press is stopped so that
  // the object under it is not picked up and moved instead.
  const onPortGrab = (event: ReactPointerEvent<SVGElement>, id: string, port: string): void => {
    if (event.button !== 0 || space.current || tool !== 'select') return
    event.stopPropagation()
    const object = canvas?.objects.find((one) => one.id === id)
    if (!object) return
    const on = PORT_AT[port as Port]
    const at = pointIn(boxOfObject(object), on)
    drag.current = {
      kind: 'arrow',
      id: event.pointerId,
      from: { x: at[0], y: at[1] },
      start: { of: id, at: [on[0], on[1]] }
    }
    setLine({ from: at, to: at })
    surface.current?.setPointerCapture(event.pointerId)
  }

  const onResizeGrab = (event: ReactPointerEvent<SVGElement>, id: string, handle: string): void => {
    if (event.button !== 0) return
    event.stopPropagation()
    const object = canvas?.objects.find((one) => one.id === id)
    if (!object) return
    drag.current = {
      kind: 'resize',
      id: event.pointerId,
      mark: gesture('resize'),
      handle: handle as Handle,
      x: event.clientX,
      y: event.clientY,
      held: object
    }
    surface.current?.setPointerCapture(event.pointerId)
  }

  const byId = (id: string): CanvasObject | undefined =>
    canvas?.objects.find((object) => object.id === id)

  const step = gridStep(view.k)
  const middle = toWorld(view, size.w / 2, size.h / 2)
  const objects = canvas?.objects ?? []
  const editing = objects.find((object) => object.id === editingId) ?? null
  const picked = new Set(selectedIds)
  // What the line being drawn will be once it lands: the pen's, or the
  // highlighter's, which is see-through while it is drawn as well as after.
  const inHand = pen === 'highlighter' ? newMarker : newDraw

  return (
    <section
      className={`canvas${tool === 'select' ? '' : ' canvas-drawing'}`}
      ref={surface}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onAuxClick={(event) => event.preventDefault()}
      // Double click opens the words, and it is caught here rather than on the
      // shape. The shape carried this since step 4 and it could never have
      // run: the press that comes first captures the pointer on this section,
      // so the release is retargeted here, and a click's target is the nearest
      // ancestor of where the press and the release landed - this section.
      // Measured, with the words already made transparent to the hand:
      // pointerdown canvas-shape, pointerup canvas, dblclick canvas.
      //
      // Which object it was is answered the way an arrow answers it, by asking
      // the drawing rather than the DOM. A picture is left out: it holds a file,
      // not words, and there is nothing to open. Only with the select tool in
      // hand - with any other, a press on the surface is putting something new
      // down, and the second press of a double click is a second one of those.
      onDoubleClick={(event) => {
        if (tool !== 'select') return
        const at = worldAt(event)
        const hit = objectAt(useVault.getState().canvas?.objects ?? [], [at.x, at.y])
        if (hit && !isImage(hit)) editObject(hit.id)
      }}
      // The right button pans, so its release is not the start of a menu.
      onContextMenu={(event) => event.preventDefault()}
      // A picture dragged in from a folder, and the only way in that says where
      // it goes. preventDefault on the way over is what makes the drop happen
      // at all - without it the window navigates to the file and the app is
      // gone.
      onDragOver={(event) => {
        if (!Array.from(event.dataTransfer?.items ?? []).some((item) => item.kind === 'file')) {
          return
        }
        event.preventDefault()
        event.dataTransfer.dropEffect = 'copy'
      }}
      onDrop={(event) => {
        const sources = droppedImages(event.dataTransfer?.files ?? null)
        if (sources.length === 0) return
        event.preventDefault()
        void dropImages(sources, worldAt(event))
      }}
      data-zoom={percent(view.k)}
      data-at={`${Math.round(middle.x)},${Math.round(middle.y)}`}
      data-tool={tool}
      data-count={objects.length}
      data-picked={selectedIds.length}
      // How deep the history is, both ways. On the element rather than only in
      // the store because a check has to be able to see that a drag of a
      // hundred events left one move behind rather than a hundred, and the
      // number of objects on the canvas cannot tell it that.
      data-undo={history.past.length}
      data-redo={history.future.length}
    >
      <svg className="canvas-surface" width="100%" height="100%">
        <defs>
          <pattern
            id="canvas-grid"
            className="canvas-grid-dots"
            width={step}
            height={step}
            patternUnits="userSpaceOnUse"
            x={((view.x % step) + step) % step}
            y={((view.y % step) + step) % step}
          >
            <circle cx={0.5} cy={0.5} r={0.5} />
          </pattern>
        </defs>
        <rect className="canvas-grid" width="100%" height="100%" fill="url(#canvas-grid)" />
        <g className="canvas-plane" transform={`translate(${view.x} ${view.y}) scale(${view.k})`}>
          {/* In file order, which is the order they are drawn in: the last one
              in the file is the one on top, and that is the whole of z. */}
          {objects.map((object) => (
            <CanvasItem
              key={object.id}
              object={object}
              workspacePath={path ?? ''}
              selected={picked.has(object.id)}
              // Handles are for one thing at a time. Pulling a corner of five
              // things at once is a group scale, and the step's own table does
              // not have it: several things move and are deleted together, and
              // are resized one at a time.
              handles={selectedIds.length === 1 && picked.has(object.id)}
              editing={object.id === editingId}
              k={view.k}
              // Where the arrow's ends have got to. Worked out here, because
              // this is the only place that has the rest of the canvas to look
              // them up in - and null means a binding that points at nothing,
              // which the format says is drawn as nothing and kept anyway.
              ends={isArrow(object) ? arrowEnds(object, byId) : null}
              // The box a drag is aiming at wears its four dots even though it
              // is not held, and the one that would take the end is lit.
              // A hand crossing the canvas with an arrow in it is asking which
              // box, and the answer has to be on the box.
              ports={snap?.end.of === object.id}
              lit={snap?.end.of === object.id ? snap.port : null}
              onGrab={onGrab}
              onResize={onResizeGrab}
              onEnd={onEndGrab}
              onPort={onPortGrab}
            />
          ))}
          {line && (
            <line
              className="canvas-stroke"
              x1={line.from[0]}
              y1={line.from[1]}
              x2={line.to[0]}
              y2={line.to[1]}
              stroke={(typeof newArrow.stroke === 'string' ? newArrow.stroke : null) ?? 'var(--text)'}
              strokeWidth={
                typeof newArrow.strokeWidth === 'number'
                  ? newArrow.strokeWidth
                  : DEFAULTS.strokeWidth
              }
            />
          )}
          {drawing && drawing.length > 0 && (
            <path
              className="canvas-stroke"
              d={strokePath(drawing)}
              fill="none"
              stroke={(typeof inHand.stroke === 'string' ? inHand.stroke : null) ?? 'var(--text)'}
              strokeWidth={
                typeof inHand.strokeWidth === 'number' ? inHand.strokeWidth : DEFAULTS.strokeWidth
              }
              opacity={typeof inHand.opacity === 'number' ? inHand.opacity : undefined}
            />
          )}
          {band && (
            <rect
              className="canvas-band"
              x={band.x}
              y={band.y}
              width={band.w}
              height={band.h}
              strokeWidth={1 / view.k}
            />
          )}
          {draft && draft.w >= MIN_SIZE && draft.h >= MIN_SIZE && (
            <rect
              className="canvas-draft"
              x={draft.x}
              y={draft.y}
              width={draft.w}
              height={draft.h}
              strokeWidth={1.5 / view.k}
            />
          )}
        </g>
      </svg>

      {editing && <Editor object={editing} />}

      <CanvasRail />

      {/* The top of the canvas: the settings, and under them
          whatever the canvas has to say. One stack, so a notice that comes
          while the settings are up stands under them rather than on them. */}
      <div className="canvas-top">
        <CanvasBar />

        {/* The canvas's own way of saying something happened. The kanban says
            it in its header and the canvas has no header, so until step 9
            every notice set while this view was open went nowhere at all.

            Over the plane rather than in a bar of its own, because a bar would
            take height from the drawing for the whole session to carry
            something that is there for a moment. Dismissable by pressing it,
            the same as the kanban's. */}
        {notice && (
          <p className="canvas-notice" onClick={() => setNotice(null)} title="Dismiss">
            {notice}
          </p>
        )}
      </div>


      <div className="canvas-controls">
        <div className="canvas-zoom">
          <button className="canvas-key" title="Fit to view" onClick={() => canvasAction('fit')}>
            <Icon name="fit" />
          </button>
          <button className="canvas-key" title="Zoom out" onClick={() => canvasAction('zoom-out')}>
            <Icon name="minus" />
          </button>
          <button
            className="canvas-percent"
            title="Back to 100%"
            onClick={() => canvasAction('zoom-reset')}
          >
            {percent(view.k)}%
          </button>
          <button className="canvas-key" title="Zoom in" onClick={() => canvasAction('zoom-in')}>
            <Icon name="plus" />
          </button>
        </div>
        <button
          className={`canvas-key canvas-help${moveOpen ? ' is-on' : ''}`}
          title="Export and import"
          data-move="open"
          aria-expanded={moveOpen}
          onClick={() => setMoveOpen(!moveOpen)}
        >
          <Icon name="transfer" />
        </button>
        <button
          className={`canvas-key canvas-help${keysOpen ? ' is-on' : ''}`}
          title="Shortcuts"
          aria-expanded={keysOpen}
          onClick={() => setCanvasKeys(!keysOpen)}
        >
          <Icon name="help" />
        </button>
      </div>

      {moveOpen && (
        <div className="canvas-keys canvas-move">
          {/* What an export covers is said once, at the top, rather than on
              each row. It is the one thing about this sheet somebody has to
              know, and four rows each carrying the same clause would be four
              chances to word it differently. */}
          <p className="canvas-keys-head">
            {selectedIds.length > 0
              ? `Exporting ${selectedIds.length} selected`
              : 'Exporting the whole canvas'}
          </p>
          {[
            { what: 'json', label: 'Export canvas', why: '.json, pictures inside' },
            { what: 'png', label: 'Export picture', why: '.png' },
            { what: 'svg', label: 'Export drawing', why: '.svg' },
            { what: 'import', label: 'Import canvas', why: 'lands beside this one' }
          ].map((move) => (
            <button
              key={move.what}
              className="canvas-move-row"
              data-move={move.what}
              onClick={() => {
                setMoveOpen(false)
                if (move.what === 'json') void exportCanvasFile()
                else if (move.what === 'import') void importCanvasFile()
                else void exportPicture(move.what as 'png' | 'svg')
              }}
            >
              <span className="canvas-move-name">{move.label}</span>
              <span className="canvas-move-why">{move.why}</span>
            </button>
          ))}
        </div>
      )}

      {keysOpen && (
        <div className="canvas-keys">
          <p className="canvas-keys-head">On the canvas</p>
          <dl>
            {CANVAS_KEYS.map((key) => (
              <div key={key.action} className="canvas-keys-row">
                <dt>{key.label}</dt>
                <dd>{keyText(key)}</dd>
              </div>
            ))}
            {POINTER_KEYS.map((row) => (
              <div key={row.how} className="canvas-keys-row">
                <dt>{row.label}</dt>
                <dd>{row.how}</dd>
              </div>
            ))}
          </dl>
        </div>
      )}
    </section>
  )
}

// The box being typed into. A textarea over the object rather than an editable
// node inside the SVG: what the file holds is plain text, and a textarea is the
// one control that cannot quietly put markup in it. It is laid over the object
// with the same maths the plane is drawn with, so what is typed sits where it
// will sit once the typing stops.
function Editor({ object }: { object: CanvasObject }) {
  const view = useVault((state) => state.viewport)
  const patchText = useVault((state) => state.patchText)
  const editObject = useVault((state) => state.editObject)
  const box = boxOf(object.props)
  const style = styleOf(object)
  const at = toScreen(view, box.x, box.y)
  const area = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    const node = area.current
    if (!node) return
    node.focus()
    node.setSelectionRange(node.value.length, node.value.length)
  }, [object.id])

  return (
    <textarea
      ref={area}
      className="canvas-edit"
      value={typeof object.props.text === 'string' ? object.props.text : ''}
      onChange={(event) => patchText(object.id, event.target.value)}
      onBlur={() => editObject(null)}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.stopPropagation()
          editObject(null)
        }
      }}
      style={{
        left: at.x,
        top: at.y,
        width: box.w * view.k,
        height: box.h * view.k,
        // Everything inside the box is a world length, so it is scaled the same
        // way the plane is. Written out rather than left to a class, because a
        // class cannot know the zoom.
        padding: 8 * view.k,
        fontSize: style.size * view.k,
        lineHeight: style.lineHeight,
        fontWeight: style.bold ? 700 : 400,
        fontStyle: style.italic ? 'italic' : 'normal',
        textDecoration: style.underline ? 'underline' : 'none',
        textAlign: style.align,
        fontFamily: fontCss(style.font),
        color: inkOf(object) ?? 'var(--text)'
      }}
    />
  )
}

const POINTER_KEYS = [
  { label: 'Pan', how: 'Middle or right drag, or Space + drag' },
  { label: 'Pan sideways', how: 'Shift + wheel' },
  { label: 'Zoom', how: 'Wheel' },
  { label: 'Edit text', how: 'Double click a box' },
  { label: 'Select several', how: 'Drag on the surface' },
  { label: 'Add to selection', how: 'Shift + click' }
]

// What an end drawn here ties to: whatever object is under it, or the place
// itself when there is nothing there. One function, used for both ends and for
// an end being pointed somewhere else, so an arrow cannot tie itself down one
// way when it is drawn and another way when it is edited.
//
// Where it lands on that object - the `at` - is decided here,
// and every end that lands on an object now carries one. Near a port it is that
// port; near an edge it is the nearest point on that edge; deeper inside than
// the band it is the nearest port again. See snapAt, in shared/arrow.
//
// `into` is the difference between the two gestures that call this. An end the
// hand DRAGGED onto a box takes the nearest of the four when it is deep inside
// it. The press that STARTS an arrow does not:
// deep inside, it is tied by the line, because the side a
// press happens to be nearest is not the side the arrow will leave by. objectAt
// answers that case - there is still a box under the press - and the store's
// tie() works out the place, as it does for every arrow in a file written
// before today.
const bind = (objects: CanvasObject[], at: Point, reach: number, into = true): Endpoint => {
  const snapped = snapAt(objects, at, reach, into)
  if (snapped) return snapped.end
  const hit = objectAt(objects, at)
  return hit ? { of: hit.id } : { x: Math.round(at[0]), y: Math.round(at[1]) }
}

// How far the hand has to travel, on screen, for a press to have been a drag.
// Small: the question is only whether it moved at all.
const MIN_TRAVEL = 6

// How near a port an arrow's end has to come, on screen, to be tied to it
// instead of to wherever the line happened to meet the box. A little wider than
// the dot that shows it - the dot's own 9 across, standing 14 out from the edge
// - so the reach covers both the dot and the edge under it, and a hand that
// meant one of the four does not have to be exact. Divided by the zoom on the
// way in, like every other distance the hand is measured by.
const SNAP_PX = 20

// How far from the hand the eraser reaches, on screen: half of the 16 a
// finger-sized mark is, so a line has to be gone over rather than gone near.
const ERASER_PX = 8

const num = (value: unknown, fallback = 120): number =>
  typeof value === 'number' && Number.isFinite(value) ? value : fallback

export function isTyping(target: EventTarget | null): boolean {
  const node = target as HTMLElement | null
  if (!node) return false
  return node.isContentEditable === true || /^(INPUT|TEXTAREA)$/.test(node.tagName ?? '')
}
