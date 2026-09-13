import type { Field } from './field'

// <workspace>/canvas/canvas.json: everything drawn on a workspace's canvas, as
// one flat list. The order of the list is the drawing order - the last object is
// on top - and there is no z field to disagree with it.
//
// Coordinates are absolute, y grows downwards, and a unit is a pixel at zoom 1.
// No object is placed relative to another, except an arrow end bound to one.
// The pan and zoom are not in the file: they change every frame a hand moves,
// and live in the app's settings instead.
//
// An object of a type this build has never heard of, and a field it has never
// heard of, are kept and written back. They are not drawn and not dropped.
//
// Reserved and not read today: `card` on any object, for a canvas object that
// points at a card by its id.
export const CANVAS = {
  where: '<workspace>/canvas/canvas.json',
  means:
    'Everything on the canvas. objects is drawn in order, the last on top. Coordinates are absolute canvas units, y down. Unknown types and keys are kept.'
} as const

export const CANVAS_TYPES = ['box', 'text', 'draw', 'arrow', 'image'] as const
export type CanvasType = (typeof CANVAS_TYPES)[number]

// Ids are wider here than on a card, and the width was measured rather than
// picked. Four hex digits is 65,536 values; by the birthday formula
// 1-e^(-n^2/2N) a canvas of 300 objects collides with itself about half the
// time, and 100 objects 7 in 100. A canvas is hundreds of objects where a board
// is dozens. Eight digits is 4.29 billion, which puts 1,000 objects at about 1
// in 8,600 - small enough that no uniqueness check has to run on every write.
// The reader still separates duplicates, because a file can be written by hand
// or by an agent that does not know the rule.
export const OBJECT_ID_WIDTH = 8

// What a field means when the object does not carry it. One place, because the
// app, the property panel and anything reading the file have to agree about
// what an absent key looks like on screen.
export const DEFAULTS = {
  rotation: 0,
  opacity: 1,
  strokeWidth: 2,
  radius: 0,
  size: 16,
  bold: false,
  italic: false,
  underline: false,
  align: 'left',
  valign: 'top',
  font: 'sans',
  lineHeight: 1.35
} as const

// The faces a box can be written in. The system's own, because no font
// file comes with the app: a name in the file that another machine does not
// have would draw there as something else, and these three are on every one.
export const FONTS = ['sans', 'serif', 'mono'] as const

// The shapes a box can be drawn as. A field on a box rather than
// types of their own: a shape is a box in every way the app asks about, and a
// reader that has never heard of the field draws a rectangle where a type it
// had never heard of would be carried and not drawn at all.
export const SHAPES = ['rect', 'ellipse', 'triangle', 'diamond'] as const

export const ALIGNS = ['left', 'center', 'right'] as const
export const VALIGNS = ['top', 'middle', 'bottom'] as const

export const ARROW_HEADS = ['none', 'arrow', 'both'] as const
export const ARROW_DASHES = ['solid', 'dashed'] as const

// The words of a box or a text, all of them at once: there is no styling of one
// word apart from the rest. In the order the reader looks for them.
export const TEXT_STYLE_FIELDS = [
  { name: 'size', value: { is: 'number' }, default: DEFAULTS.size, means: 'The size of the letters, in canvas units.' },
  {
    name: 'color',
    value: { is: 'colour' },
    means: 'The colour of the letters. Without it they take a colour that reads on the fill, or on the canvas when there is no fill.'
  },
  { name: 'highlight', value: { is: 'colour' }, means: 'A marker colour behind every line of the words.' },
  { name: 'bold', value: { is: 'boolean' }, default: DEFAULTS.bold, means: 'Bold letters.' },
  { name: 'italic', value: { is: 'boolean' }, default: DEFAULTS.italic, means: 'Italic letters.' },
  { name: 'underline', value: { is: 'boolean' }, default: DEFAULTS.underline, means: 'Underlined letters.' },
  {
    name: 'align',
    value: { is: 'one of', values: ALIGNS },
    default: DEFAULTS.align,
    means: 'Where each line sits across the box.'
  },
  {
    name: 'valign',
    value: { is: 'one of', values: VALIGNS },
    default: DEFAULTS.valign,
    means: 'Where the block of lines sits up and down the box.'
  },
  {
    name: 'font',
    value: { is: 'one of', values: FONTS, open: true },
    default: DEFAULTS.font,
    means: 'The face. Another name is kept and drawn in the default face.'
  },
  {
    name: 'lineHeight',
    value: { is: 'number' },
    default: DEFAULTS.lineHeight,
    means: 'The height of a line, as a multiple of the size.'
  }
] as const satisfies readonly Field[]

const ID = {
  name: 'id',
  value: { is: 'id', prefix: 'o', digits: OBJECT_ID_WIDTH },
  required: true,
  means: 'Fixed for the life of the object. Arrows bind to it. A missing or repeated id is replaced when the file is read.'
} as const satisfies Field

const typeField = (type: CanvasType) =>
  ({
    name: 'type',
    value: { is: 'one of', values: [type] },
    required: true,
    means: 'What kind of object this is.'
  }) as const satisfies Field

// Where an object with a rectangle is: a box, a text, an image. An object with
// no width or no height has no place, and fitting the view leaves it out.
const PLACE = [
  { name: 'x', value: { is: 'number' }, required: true, default: 0, means: 'The left edge.' },
  { name: 'y', value: { is: 'number' }, required: true, default: 0, means: 'The top edge.' },
  { name: 'w', value: { is: 'number' }, required: true, default: 0, means: 'The width.' },
  { name: 'h', value: { is: 'number' }, required: true, default: 0, means: 'The height.' },
  {
    name: 'rotation',
    value: { is: 'number' },
    default: DEFAULTS.rotation,
    means: 'Degrees clockwise, around the middle.'
  }
] as const satisfies readonly Field[]

const OPACITY = {
  name: 'opacity',
  value: { is: 'number' },
  default: DEFAULTS.opacity,
  means: 'How solid the whole object is, from 0 to 1.'
} as const satisfies Field

const STROKE_WIDTH = {
  name: 'strokeWidth',
  value: { is: 'number' },
  default: DEFAULTS.strokeWidth,
  means: 'The width of the line, in canvas units.'
} as const satisfies Field

// The ink of a line with no colour of its own follows the canvas, so it can be
// seen in both themes. Naming a colour makes it absolute.
const LINE_STROKE = {
  name: 'stroke',
  value: { is: 'colour' },
  means: 'The colour of the line. Without it the line follows the canvas, so it shows in both themes.'
} as const satisfies Field

// A box and a text are one geometry and one set of fields. They stay two types
// because the file says what was meant: an agent reading the canvas should not
// have to guess which boxes are really labels.
const BOX_FIELDS = [
  ID,
  ...PLACE,
  OPACITY,
  {
    name: 'shape',
    value: { is: 'one of', values: SHAPES },
    default: 'rect',
    means: 'The outline drawn inside the rectangle.'
  },
  { name: 'fill', value: { is: 'colour' }, means: 'The colour inside. Without it the box is empty.' },
  { name: 'stroke', value: { is: 'colour' }, means: 'The colour of the border. Without it there is no border.' },
  STROKE_WIDTH,
  {
    name: 'dash',
    value: { is: 'one of', values: ARROW_DASHES },
    default: 'solid',
    means: 'Whether the border is solid or dashed.'
  },
  { name: 'radius', value: { is: 'number' }, default: DEFAULTS.radius, means: 'How round the corners are.' },
  { name: 'text', value: { is: 'text' }, means: 'The words inside. New lines are kept.' },
  {
    name: 'textStyle',
    value: { is: 'map', fields: TEXT_STYLE_FIELDS },
    means: 'How the words look.'
  }
] as const satisfies readonly Field[]

// An arrow end: tied to an object, or a fixed point.
const BOUND_FIELDS = [
  { name: 'of', value: { is: 'text' }, required: true, means: 'The id of the object the end is tied to.' },
  {
    name: 'at',
    value: { is: 'point' },
    means: 'Where on that object, as fractions of its box: [0, 0] is the top left corner, [1, 0.5] the middle of the right edge. Without it the end aims at the middle and touches the edge.'
  }
] as const satisfies readonly Field[]

const FIXED_FIELDS = [
  { name: 'x', value: { is: 'number' }, required: true, means: 'Where the end is, across.' },
  { name: 'y', value: { is: 'number' }, required: true, means: 'Where the end is, down.' }
] as const satisfies readonly Field[]

const END = {
  is: 'either',
  of: [
    { is: 'map', fields: BOUND_FIELDS },
    { is: 'map', fields: FIXED_FIELDS }
  ]
} as const

export const CANVAS_OBJECTS = {
  box: {
    means: 'A rectangle, or another shape inside one, that can hold words.',
    fields: [...BOX_FIELDS.slice(0, 1), typeField('box'), ...BOX_FIELDS.slice(1)]
  },
  text: {
    means: 'Words on the canvas with no box around them. The same fields as a box.',
    fields: [...BOX_FIELDS.slice(0, 1), typeField('text'), ...BOX_FIELDS.slice(1)]
  },
  draw: {
    means: 'A line drawn by hand, through its points in the order they were drawn.',
    fields: [
      ID,
      typeField('draw'),
      {
        name: 'points',
        value: { is: 'list', of: { is: 'point' } },
        required: true,
        means: 'The points of the line, absolute. The line has no x, y, w or h: they are worked out from the points.'
      },
      LINE_STROKE,
      STROKE_WIDTH,
      OPACITY
    ]
  },
  arrow: {
    means: 'A line between two ends. An end tied to an object follows it when it moves; a tie to an id that is not there is kept and not drawn.',
    fields: [
      ID,
      typeField('arrow'),
      { name: 'from', value: END, required: true, means: 'The end the line starts at.' },
      { name: 'to', value: END, required: true, means: 'The end the line finishes at.' },
      LINE_STROKE,
      STROKE_WIDTH,
      {
        name: 'head',
        value: { is: 'one of', values: ARROW_HEADS },
        default: 'arrow',
        means: 'Which ends have a head: none, the to end, or both.'
      },
      {
        name: 'dash',
        value: { is: 'one of', values: ARROW_DASHES },
        default: 'solid',
        means: 'Whether the line is solid or dashed.'
      },
      OPACITY
    ]
  },
  image: {
    means: "A picture from the workspace's files/ folder.",
    fields: [
      ID,
      typeField('image'),
      ...PLACE,
      OPACITY,
      { name: 'radius', value: { is: 'number' }, default: DEFAULTS.radius, means: 'How round the corners are.' },
      {
        name: 'file',
        value: { is: 'file name' },
        required: true,
        means: "The picture's bare name in files/. A name that could hold a path draws nothing."
      }
    ]
  }
} as const satisfies Record<CanvasType, { means: string; fields: readonly Field[] }>

export const CANVAS_FIELDS = [
  {
    name: 'formatVersion',
    value: { is: 'number' },
    required: true,
    default: 1,
    means: 'The version of this file format.'
  },
  {
    name: 'objects',
    value: { is: 'list', of: { is: 'either', of: CANVAS_TYPES.map((type) => ({ is: 'map', fields: CANVAS_OBJECTS[type].fields })) } },
    required: true,
    means: 'Everything drawn, bottom to top.'
  }
] as const satisfies readonly Field[]
