import { ADD_TO_CANVAS, DELETE_FROM_CANVAS, UPDATE_CANVAS } from './canvas'
import { READ_CANVAS, READ_CARD, READ_KANBAN } from './read'
import type { Tool } from './result'
import { LIST_WORKSPACES } from './workspaces'
import { ARCHIVE_CARD, CREATE_CARD, DELETE_CARD, MOVE_CARD, UPDATE_CARD } from './write'

export { refusal } from './result'

// What an agent can ask Bothy to do. Step 2 of v0.4 brought the list of
// workspaces, every later tool's starting point; step 3 the reading tools;
// step 4 the ones that write a card; step 5 the ones that write a canvas.

// What every call hears while the switch is off. The tools stay
// listed and a call says why it did nothing, so an agent can tell the person
// what to do instead of reporting that Bothy has no tools.
export const ACCESS_OFF =
  'AI access is off in Bothy. It can be turned on in Settings, under AI, where the workspaces an agent may use are chosen.'

export const TOOLS: Tool[] = [
  LIST_WORKSPACES,
  READ_KANBAN,
  READ_CARD,
  READ_CANVAS,
  CREATE_CARD,
  UPDATE_CARD,
  MOVE_CARD,
  ARCHIVE_CARD,
  DELETE_CARD,
  ADD_TO_CANVAS,
  UPDATE_CANVAS,
  DELETE_FROM_CANVAS
]
