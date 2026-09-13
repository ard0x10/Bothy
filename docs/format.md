# Bothy's files, for an agent

<!-- Written by `npm run docs` from the schema in src/shared/schema and the app's own writers. Do not edit it by hand: it is written again from the code. -->

Bothy is a kanban and a canvas kept as plain files in a folder. This guide is for an agent that reads and writes those files itself. An agent that can connect to Bothy's MCP server should use the server instead: it checks every value before writing, and when it refuses it says why.

Every example is one workspace, `My Project`, in a vault at `D:\Vault`, followed from the first file to the last.

## Before you touch a workspace

Bothy keeps its settings outside the vault. Below, that folder is called the settings folder:

- Windows: `%APPDATA%\bothy`
- macOS: `~/Library/Application Support/bothy`
- Linux: `$XDG_CONFIG_HOME/bothy`, or `~/.config/bothy` when that is not set

The person chooses in Bothy which workspaces an agent may use. Read `state.json` in the settings folder before you read or write anything in a vault, every time: the choice can change while you work.

- A workspace is yours to use only when `ai.on` is `true` and the `id` in its `workspace.json` is listed under its vault folder in `ai.vaults`. Vault folders are compared without regard to case.
- Anything else - no file, no `ai`, the switch off, the workspace not listed - means: do not read the workspace, do not write it, and do not mention it. A workspace that is not listed is not there.
- When nothing you were asked about is open to you, tell the person, in these words: "AI access is off in Bothy. It can be turned on in Settings, under AI, where the workspaces an agent may use are chosen."
- The rest of `state.json` is Bothy's. Do not write this file.

Here `My Project` is open to an agent, and no other workspace in `D:\Vault` is:

```json settings/state.json
{
  "theme": "dark",
  "ai": {
    "on": true,
    "vaults": {
      "D:\\Vault": [
        "w_3c1a"
      ]
    }
  }
}
```

## The vault

- The vault is a folder. Every folder directly in it is a workspace, except one whose name starts with a dot. A workspace holds one kanban and one canvas.
- The name of a workspace is `name` in its `workspace.json`, not its folder. Renaming a workspace never moves the folder.
- What is thrown away goes to `.trash` in the vault, where Bothy keeps it for 30 days and can put it back.

```text
D:\Vault\
  My Project\
    workspace.json
    kanban\columns.json
    kanban\cards\<file name>.md
    canvas\canvas.json
    files\             attachments and pictures, by bare name
  .trash\
```

### `<vault>/<workspace>/workspace.json`

The name and settings of one workspace. Keys not listed here are kept when the app changes one of these.

- formatVersion (number; default 1): The version of this file format. A file without it is version 1.
- id (id, w_ and 4 hex digits; always written): Fixed for the life of the workspace. Renaming a workspace changes its name here and never moves its folder.
- name (text; always written): What the workspace is called.
- labels (list of object; always written): Names given to the colour labels. A colour with no entry is still there, unnamed.
  - key (one of: green, yellow, orange, red, purple, blue): Which of the colours this entry is about. An entry with no key is a label from before the colours: a name and a colour of its own.
  - name (text): A name given to the colour. Cards still carry the colour word.
  - color (colour, #rrggbb or #rrggbbaa): A colour of the workspace's own for this label, over the app's.
- lastTab (one of: kanban, canvas; always written; default "kanban"): The view the workspace was left on.
- background (object | object): The kanban's ground. No key means the app's own, following the theme.
  either:
    - type (one of: color; always written): A plain colour.
    - color (colour, #rrggbb or #rrggbbaa; always written): The colour, six digits.
  or:
    - type (one of: gradient; always written): Two colours, top left to bottom right.
    - from (colour, #rrggbb or #rrggbbaa; always written): The top left colour, six digits.
    - to (colour, #rrggbb or #rrggbbaa; always written): The bottom right colour, six digits.
- bookmarked (true, or left out for off): In the Bookmarks section of the sidebar.

```json My Project/workspace.json
{
  "formatVersion": 1,
  "id": "w_3c1a",
  "name": "My Project",
  "labels": [
    {
      "key": "red",
      "name": "Urgent"
    }
  ],
  "lastTab": "kanban"
}
```

### `<workspace>/kanban/columns.json`

The columns of the kanban, left to right, and the cards in each, top to bottom. Keys not listed here, on the file or on a column, are kept.

- formatVersion (number; always written; default 1): The version of this file format.
- columns (list of object; always written): The columns, left to right.
  - id (id, c_ and 4 hex digits; always written): Fixed for the life of the column.
  - title (text; always written): The name at the head of the column.
  - cards (list of id, k_ and 4 hex digits; always written): The ids of the cards in the column, top to bottom. A card file no column lists is shown at the end of the first column, and nothing is written until it is moved.
  - wipLimit (number): How many cards the column is meant to hold at most.

```json My Project/kanban/columns.json
{
  "formatVersion": 1,
  "columns": [
    {
      "id": "c_1a2b",
      "title": "To do",
      "cards": [
        "k_0b1e"
      ]
    },
    {
      "id": "c_3c4d",
      "title": "Doing",
      "cards": [],
      "wipLimit": 3
    },
    {
      "id": "c_5e6f",
      "title": "Done",
      "cards": []
    }
  ]
}
```

### `<workspace>/kanban/cards/<file name>.md`

One card. YAML frontmatter holds the fields below; the body under it is free text the app shows as markdown. Keys not listed here are kept and written back untouched.

- id (id, k_ and 4 hex digits; always written): Fixed for the life of the card. columns.json lists the card by it; the file name may change, the id does not.
- title (text; always written): What the card is called. A new card's file name is made from it once; a new title does not rename the file.
- archived (true, or left out for off): Off the kanban but kept, still in its place in columns.json. Taking the key away brings the card back where it was.
- cover (colour, #rrggbb or #rrggbbaa | bare file name in files/): A band across the top of the card: a colour, or a picture from files/ when the name ends in an image extension.
- tags (list of one of: green, yellow, orange, red, purple, blue, or another word, which is kept): The colour labels the card wears, by colour word. A workspace may give a colour a name in workspace.json; the card still carries the word. A word that is not one of the colours is a label from before them, and is kept.
- start (day, 2026-09-20): The first day of the work.
- due (day, 2026-09-20): The last day of the work. Anything that is not a day is kept but is not read as a date.
- priority (one of: low, medium, high, or another word, which is kept): How much the card matters.
- checklists (list of object): Sub tasks. They live here and nowhere else: a "- [ ]" line in the body is text the app does not touch.
  - name (text; always written; default "Checklist"): The heading of the list.
  - items (list of object; always written): The items, top to bottom.
    - text (text; always written): What is to be done.
    - done (true or false; always written): Whether it is ticked.
- files (list of bare file name in files/): Attachments, by bare name in the workspace's files/ folder. A name with no file behind it is kept and shown as missing.
- created (day, 2026-09-20 | moment, 2026-09-20T14:22:00.000Z): When the card was made. The app writes the day.
- modified (day, 2026-09-20 | moment, 2026-09-20T14:22:00.000Z): When the card was last changed.

The body starts after the line that closes the frontmatter and one empty line. `estimate` below is a key of the person's own.

```md My Project/kanban/cards/menu-sounds.md
---
id: k_0b1e
title: Menu sounds
tags:
  - blue
due: 2026-10-01
priority: high
checklists:
  - name: Checklist
    items:
      - text: Record the clicks
        done: true
      - text: Mix them
        done: false
created: 2026-09-12
estimate: 3
---

Every button on the title screen needs one.
```

### `<workspace>/canvas/canvas.json`

Everything on the canvas. objects is drawn in order, the last on top. Coordinates are absolute canvas units, y down. Unknown types and keys are kept.

- formatVersion (number; always written; default 1): The version of this file format.
- objects: everything drawn, bottom to top. Each object is one of these:

- box: A rectangle, or another shape inside one, that can hold words.
  - id (id, o_ and 8 hex digits; always written): Fixed for the life of the object. Arrows bind to it. A missing or repeated id is replaced when the file is read.
  - x (number; always written; default 0): The left edge.
  - y (number; always written; default 0): The top edge.
  - w (number; always written; default 0): The width.
  - h (number; always written; default 0): The height.
  - rotation (number; default 0): Degrees clockwise, around the middle.
  - opacity (number; default 1): How solid the whole object is, from 0 to 1.
  - shape (one of: rect, ellipse, triangle, diamond; default "rect"): The outline drawn inside the rectangle.
  - fill (colour, #rrggbb or #rrggbbaa): The colour inside. Without it the box is empty.
  - stroke (colour, #rrggbb or #rrggbbaa): The colour of the border. Without it there is no border.
  - strokeWidth (number; default 2): The width of the line, in canvas units.
  - dash (one of: solid, dashed; default "solid"): Whether the border is solid or dashed.
  - radius (number; default 0): How round the corners are.
  - text (text): The words inside. New lines are kept.
  - textStyle (object): How the words look.
    - size (number; default 16): The size of the letters, in canvas units.
    - color (colour, #rrggbb or #rrggbbaa): The colour of the letters. Without it they take a colour that reads on the fill, or on the canvas when there is no fill.
    - highlight (colour, #rrggbb or #rrggbbaa): A marker colour behind every line of the words.
    - bold (true or false; default false): Bold letters.
    - italic (true or false; default false): Italic letters.
    - underline (true or false; default false): Underlined letters.
    - align (one of: left, center, right; default "left"): Where each line sits across the box.
    - valign (one of: top, middle, bottom; default "top"): Where the block of lines sits up and down the box.
    - font (one of: sans, serif, mono, or another word, which is kept; default "sans"): The face. Another name is kept and drawn in the default face.
    - lineHeight (number; default 1.35): The height of a line, as a multiple of the size.
- text: Words on the canvas with no box around them. The same fields as a box.
  The fields of a box.
- draw: A line drawn by hand, through its points in the order they were drawn.
  - id (as in box)
  - points (list of point, [x, y]; always written): The points of the line, absolute. The line has no x, y, w or h: they are worked out from the points.
  - stroke (colour, #rrggbb or #rrggbbaa): The colour of the line. Without it the line follows the canvas, so it shows in both themes.
  - strokeWidth (as in box)
  - opacity (as in box)
- arrow: A line between two ends. An end tied to an object follows it when it moves; a tie to an id that is not there is kept and not drawn.
  - id (as in box)
  - from (object | object; always written): The end the line starts at.
    either:
      - of (text; always written): The id of the object the end is tied to.
      - at (point, [x, y]): Where on that object, as fractions of its box: [0, 0] is the top left corner, [1, 0.5] the middle of the right edge. Without it the end aims at the middle and touches the edge.
    or:
      - x (number; always written): Where the end is, across.
      - y (number; always written): Where the end is, down.
  - to (object | object; always written): The end the line finishes at.
    (the fields of from in arrow)
  - stroke (as in draw)
  - strokeWidth (as in box)
  - head (one of: none, arrow, both; default "arrow"): Which ends have a head: none, the to end, or both.
  - dash (one of: solid, dashed; default "solid"): Whether the line is solid or dashed.
  - opacity (as in box)
- image: A picture from the workspace's files/ folder.
  - id (as in box)
  - x (as in box)
  - y (as in box)
  - w (as in box)
  - h (as in box)
  - rotation (as in box)
  - opacity (as in box)
  - radius (number; default 0): How round the corners are.
  - file (bare file name in files/; always written): The picture's bare name in files/. A name that could hold a path draws nothing.

```json My Project/canvas/canvas.json
{
  "formatVersion": 1,
  "objects": [
    {
      "id": "o_1a2b3c4d",
      "type": "box",
      "x": -100,
      "y": -60,
      "w": 200,
      "h": 120,
      "fill": "#f6d365",
      "stroke": "#00000022",
      "strokeWidth": 1,
      "radius": 8,
      "textStyle": {
        "size": 16,
        "align": "center",
        "valign": "middle"
      },
      "text": "Plan"
    }
  ]
}
```

## Writing a file

1. Read the file right before you change it, and write it back whole.
2. Keep every key you did not mean to change, keys this guide does not list included. Bothy keeps them, and so do you.
3. Write the new text to a file beside it named after it with `.tmp` and digits on the end, `columns.json.tmp1` for instance, and rename that over the file. Bothy never reads a file with a name like that, so it never sees half of one.
4. Do not write over a `canvas.json` whose `formatVersion` is not 1. Write `formatVersion` as 1 in a file you make.
5. A new id is a letter, an underscore and random hex digits, used by nothing else in the workspace: `k_` and 4 digits for a card, `c_` and 4 for a column, `o_` and 8 for a canvas object. Never change an id.
6. A card's `id`, `created` and `modified` are Bothy's. Give a card you make `created` as the day, and leave the three alone after that.
7. Where a field takes words from a list, write one the list gives: a label is one of green, yellow, orange, red, purple, blue; a priority is one of low, medium, high. A word already in a file that is not on the list is kept, not written anew.

## While Bothy is open

Bothy does not have to be open: what you write is on screen the next time it is. While it is open, it watches the vault and takes in what you write at once. Where the person is changing something at the same moment, both are kept: your change and theirs are put together, and where both of you changed the same field of the same thing, theirs is the one that stays and yours is one Ctrl+Z away. So look before you write.

Read `editing.json` in the settings folder before every write. It lists what the person's hand is on:

- `workspace` is the workspace folder; `kind` is `canvas` or `kanban`; `id` is the canvas object or the card.
- `fields` are what is being changed: a field name, `textStyle.<name>` for one inside `textStyle`, `*` for the whole object, `place` for a card being dragged.
- Do not change a field that is listed, or anything on an object listed with `*`, or the place of a card listed with `place`. Tell the person what you left alone, and why.
- Anything else can be changed: it is kept beside what the person is doing.
- `pid` is Bothy's process. When no process with that id is running, the file says nothing.

Here the words of the box `Plan` are being typed, so its `text` is not yours to change. Its colour still is:

```json settings/editing.json
{
  "pid": 20412,
  "items": [
    {
      "workspace": "D:\\Vault\\My Project",
      "kind": "canvas",
      "id": "o_1a2b3c4d",
      "fields": [
        "text"
      ]
    }
  ]
}
```

## Leaving a trail

Bothy puts a short line on screen for what an agent changed, and learns what changed from a trail. Right after each change is on disk, leave one file in `ai-trail` in the settings folder. With no trail, Bothy still shows the change, and says it was changed outside Bothy.

- Write the file under a name that ends in `.part`, then rename it to one that ends in `.json`. Bothy reads it and deletes it.
- The file holds one change, or a list of the changes one piece of work made, in the order they were made.
- `at`: when, in milliseconds since 1970. `workspace`: the workspace folder, whole. `workspaceName`: its name.
- `card` or `object`: the id, one of the two. `kind`: an object's type. `title`: a card's title, or an object's words, which may be empty.
- `action`: for a card one of added, changed, moved, archived, unarchived, trashed; for an object one of added, changed, trashed. `column`: the title of the column a card was added to or moved into.

## Recipes

### Make a card

1. Pick a file name from the title: lower case, every run of other characters one `-`, at most 60 characters, `card` when nothing is left. If that name is taken, add `-2`, then `-3`.
2. Write the card with a new id, its title and `created`.
3. Put its id in `columns.json`, in the column and at the place it goes.

```md My Project/kanban/cards/fix-the-stinger.md
---
id: k_7f2a
title: Fix the stinger
created: 2026-09-20
---

```

```json My Project/kanban/columns.json
{
  "formatVersion": 1,
  "columns": [
    {
      "id": "c_1a2b",
      "title": "To do",
      "cards": [
        "k_0b1e"
      ]
    },
    {
      "id": "c_3c4d",
      "title": "Doing",
      "cards": [
        "k_7f2a"
      ],
      "wipLimit": 3
    },
    {
      "id": "c_5e6f",
      "title": "Done",
      "cards": []
    }
  ]
}
```

```json settings/ai-trail/1789906920000-3f9a1c2e.json
{
  "at": 1789906920000,
  "workspace": "D:\\Vault\\My Project",
  "workspaceName": "My Project",
  "card": "k_7f2a",
  "title": "Fix the stinger",
  "action": "added",
  "column": "Doing"
}
```

Bothy shows: `AI added "Fix the stinger" to Doing`

### Change a card

Change the fields and the body in the file; leave the rest as it is. A new title does not rename the file. To take a field out, take its key out.

```md My Project/kanban/cards/fix-the-stinger.md
---
id: k_7f2a
title: Fix the stinger
due: 2026-09-25
created: 2026-09-20
---

It clips on the last beat.
```

```json settings/ai-trail/1789906921000-5b2d7e41.json
{
  "at": 1789906921000,
  "workspace": "D:\\Vault\\My Project",
  "workspaceName": "My Project",
  "card": "k_7f2a",
  "title": "Fix the stinger",
  "action": "changed"
}
```

Bothy shows: `AI changed "Fix the stinger"`

### Move a card

Take its id out of the list it is in and put it where it goes. The card file does not change.

```json My Project/kanban/columns.json
{
  "formatVersion": 1,
  "columns": [
    {
      "id": "c_1a2b",
      "title": "To do",
      "cards": [
        "k_0b1e"
      ]
    },
    {
      "id": "c_3c4d",
      "title": "Doing",
      "cards": [],
      "wipLimit": 3
    },
    {
      "id": "c_5e6f",
      "title": "Done",
      "cards": [
        "k_7f2a"
      ]
    }
  ]
}
```

```json settings/ai-trail/1789906922000-9e4c0a17.json
{
  "at": 1789906922000,
  "workspace": "D:\\Vault\\My Project",
  "workspaceName": "My Project",
  "card": "k_7f2a",
  "title": "Fix the stinger",
  "action": "moved",
  "column": "Done"
}
```

Bothy shows: `AI moved "Fix the stinger" to Done`

### Archive a card

Add `archived: true` to its frontmatter, and leave its id where it is in `columns.json`. Taking the key out brings the card back to that place.

```md My Project/kanban/cards/fix-the-stinger.md
---
id: k_7f2a
title: Fix the stinger
archived: true
due: 2026-09-25
created: 2026-09-20
---

It clips on the last beat.
```

```json settings/ai-trail/1789906923000-2c8f6b90.json
{
  "at": 1789906923000,
  "workspace": "D:\\Vault\\My Project",
  "workspaceName": "My Project",
  "card": "k_7f2a",
  "title": "Fix the stinger",
  "action": "archived"
}
```

Bothy shows: `AI archived "Fix the stinger"`

### Throw a card away

1. Move its file, unchanged, into `.trash/<workspace folder>/` in the vault, named with the time and two underscores in front: the time as `2026-09-20T14-22-00-000Z`, which is an ISO time with `:` and `.` written as `-`.
2. Take its id out of `columns.json`.

```text move
My Project/kanban/cards/fix-the-stinger.md
.trash/My Project/2026-09-20T14-22-00-000Z__fix-the-stinger.md
```

```json My Project/kanban/columns.json
{
  "formatVersion": 1,
  "columns": [
    {
      "id": "c_1a2b",
      "title": "To do",
      "cards": [
        "k_0b1e"
      ]
    },
    {
      "id": "c_3c4d",
      "title": "Doing",
      "cards": [],
      "wipLimit": 3
    },
    {
      "id": "c_5e6f",
      "title": "Done",
      "cards": []
    }
  ]
}
```

```json settings/ai-trail/1789906924000-7d1e3f52.json
{
  "at": 1789906924000,
  "workspace": "D:\\Vault\\My Project",
  "workspaceName": "My Project",
  "card": "k_7f2a",
  "title": "Fix the stinger",
  "action": "trashed"
}
```

Bothy shows: `AI moved "Fix the stinger" to the trash`

### Add to the canvas

Put the new objects on the end of `objects`, each with a new id and a place. A field left out takes the default above. An arrow end tied to an object follows it when it moves.

```json My Project/canvas/canvas.json
{
  "formatVersion": 1,
  "objects": [
    {
      "id": "o_1a2b3c4d",
      "type": "box",
      "x": -100,
      "y": -60,
      "w": 200,
      "h": 120,
      "fill": "#f6d365",
      "stroke": "#00000022",
      "strokeWidth": 1,
      "radius": 8,
      "textStyle": {
        "size": 16,
        "align": "center",
        "valign": "middle"
      },
      "text": "Plan"
    },
    {
      "id": "o_5e6f7a8b",
      "type": "text",
      "x": 160,
      "y": -32,
      "w": 240,
      "h": 64,
      "textStyle": {
        "size": 24,
        "align": "left",
        "valign": "top"
      },
      "text": "Ask about the budget"
    },
    {
      "id": "o_9c0d1e2f",
      "type": "arrow",
      "from": {
        "of": "o_1a2b3c4d"
      },
      "to": {
        "of": "o_5e6f7a8b"
      },
      "strokeWidth": 2
    }
  ]
}
```

```json settings/ai-trail/1789906925000-4a6b8c0d.json
[
  {
    "at": 1789906925000,
    "workspace": "D:\\Vault\\My Project",
    "workspaceName": "My Project",
    "object": "o_5e6f7a8b",
    "kind": "text",
    "title": "Ask about the budget",
    "action": "added"
  },
  {
    "at": 1789906925000,
    "workspace": "D:\\Vault\\My Project",
    "workspaceName": "My Project",
    "object": "o_9c0d1e2f",
    "kind": "arrow",
    "title": "",
    "action": "added"
  }
]
```

Bothy shows: `AI changed 2 things on the canvas: "Ask about the budget", an arrow`

### Take something off the canvas

1. Write the object, as `objects` held it, to `.trash/<workspace folder>/<time>__<id>.canvas.json` in the vault, the time written as for a card.
2. Take it out of `objects`. An arrow tied to it stays in the file and is not drawn until the object is back.

```json .trash/My Project/2026-09-20T14-22-00-000Z__o_9c0d1e2f.canvas.json
{
  "formatVersion": 1,
  "object": {
    "id": "o_9c0d1e2f",
    "type": "arrow",
    "from": {
      "of": "o_1a2b3c4d"
    },
    "to": {
      "of": "o_5e6f7a8b"
    },
    "strokeWidth": 2
  }
}
```

```json My Project/canvas/canvas.json
{
  "formatVersion": 1,
  "objects": [
    {
      "id": "o_1a2b3c4d",
      "type": "box",
      "x": -100,
      "y": -60,
      "w": 200,
      "h": 120,
      "fill": "#f6d365",
      "stroke": "#00000022",
      "strokeWidth": 1,
      "radius": 8,
      "textStyle": {
        "size": 16,
        "align": "center",
        "valign": "middle"
      },
      "text": "Plan"
    },
    {
      "id": "o_5e6f7a8b",
      "type": "text",
      "x": 160,
      "y": -32,
      "w": 240,
      "h": 64,
      "textStyle": {
        "size": 24,
        "align": "left",
        "valign": "top"
      },
      "text": "Ask about the budget"
    }
  ]
}
```

```json settings/ai-trail/1789906926000-6f0e2d4c.json
{
  "at": 1789906926000,
  "workspace": "D:\\Vault\\My Project",
  "workspaceName": "My Project",
  "object": "o_9c0d1e2f",
  "kind": "arrow",
  "title": "",
  "action": "trashed"
}
```

Bothy shows: `AI moved an arrow to the trash`
