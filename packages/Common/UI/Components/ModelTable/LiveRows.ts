import AnalyticsBaseModel from "../../../Models/AnalyticsModels/AnalyticsBaseModel/AnalyticsBaseModel";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import ModelEventType from "../../../Types/Realtime/ModelEventType";

/*
 * A LIST THAT KEEPS ITSELF CURRENT.
 *
 * Someone who keeps the Incidents or Alerts list open - on a second screen,
 * during an outage, on a NOC wall - used to see the rows as they were when
 * the page loaded: a new incident, an alert a teammate acknowledged, an
 * episode that was resolved, none of it showed until they pressed Refresh,
 * while the header's bell above the list counted the changes live.
 *
 * The server already announces every record of these tables that is
 * created, changed or deleted (a model's enableRealtimeEventsOn, the events
 * the header's counts listen to). A list of such a table now hears them too
 * and reads its page again, quietly: the rows stay on screen while they are
 * read, and a read that fails keeps them (React-free rules here; the hook is
 * UseLiveRows.ts, the table BaseModelTable.tsx).
 *
 * It reads again at most once every LIVE_ROWS_MIN_INTERVAL_IN_MS, however many
 * changes arrive (CoalescedRefresh): a bulk action that resolves thousands
 * of alerts sends an event for every one, and the first change still shows
 * at once. And it waits while the reader is in the middle of something the
 * new rows would pull out from under them: rows ticked for a bulk action, a
 * dialog or a menu open, text being selected, a row being dragged, the
 * pointer on its way to a row, or the page itself loading. It reads again as
 * soon as they are done, and when a hidden tab comes back into view.
 *
 * A row the read brings in is tinted for a moment (LIVE_ROWS_ARRIVED_IN_MS,
 * the tint fading as a link's landing place fades: Theme.css), so the eye
 * finds the new incident among the ones that moved down for it.
 */

// The same pace as the header's counts (Header.tsx).
export const LIVE_ROWS_MIN_INTERVAL_IN_MS: number = 5000;

// How often a list that is waiting for the reader looks again.
export const LIVE_ROWS_HOLD_RECHECK_IN_MS: number = 2000;

/*
 * How long the pointer must have been still, or off the rows, before they
 * move. A row read in above the one under the pointer moves that one down
 * as it is clicked: the click lands on the next incident and opens it.
 * Someone opening a row moves the pointer to it and presses within a second
 * or two; a pointer left lying on a list on a wall screen holds nothing.
 */
export const LIVE_ROWS_POINTER_REST_IN_MS: number = 3000;

/*
 * Whether the pointer is at work on the rows: it moved over them, or
 * pressed on them, less than LIVE_ROWS_POINTER_REST_IN_MS ago. Null is a
 * pointer that is off the rows - it last moved somewhere else.
 */
export const isPointerAtWorkOnRows: (
  lastMovedOverRowsAt: number | null,
  now: number,
  restInMs?: number | undefined,
) => boolean = (
  lastMovedOverRowsAt: number | null,
  now: number,
  restInMs?: number | undefined,
): boolean => {
  if (lastMovedOverRowsAt === null) {
    return false;
  }

  return now - lastMovedOverRowsAt < (restInMs ?? LIVE_ROWS_POINTER_REST_IN_MS);
};

/*
 * How long a row a live read brought in stays marked (data-row-arrived):
 * the time its tint takes to fade (Theme.css, ou-row-arrived). A reader who
 * asks for less motion sees the tint held still for as long, then gone.
 */
export const LIVE_ROWS_ARRIVED_IN_MS: number = 2400;

/*
 * The mark on a row a live read brought in, which Theme.css tints for a
 * moment (ou-row-arrived).
 */
export const ROW_ARRIVED_ATTRIBUTE: string = "data-row-arrived";

/*
 * The rows a live read brought in: on the page now and not before it.
 * Nothing when no page was drawn before it. Only a live read is asked: the
 * reader's own reads (another page, a search) draw rows they asked for.
 */
export const getArrivedRowIds: (
  shownIds: ReadonlyArray<string> | null,
  readIds: ReadonlyArray<string>,
) => Array<string> = (
  shownIds: ReadonlyArray<string> | null,
  readIds: ReadonlyArray<string>,
): Array<string> => {
  if (shownIds === null) {
    return [];
  }

  const shown: Set<string> = new Set(shownIds);

  return readIds.filter((id: string): boolean => {
    return Boolean(id) && !shown.has(id);
  });
};

/*
 * The changes a list of this model hears: the events the server announces
 * for its table, in a fixed order. Nothing for a table that announces none,
 * and nothing for an analytics table (logs, spans), whose lists page through
 * their own time ranges.
 */
export const getLiveRowEventTypes: (
  model: BaseModel | AnalyticsBaseModel | null | undefined,
) => Array<ModelEventType> = (
  model: BaseModel | AnalyticsBaseModel | null | undefined,
): Array<ModelEventType> => {
  if (!model || !(model instanceof BaseModel)) {
    return [];
  }

  const announced: BaseModel["enableRealtimeEventsOn"] =
    model.enableRealtimeEventsOn;

  if (!announced) {
    return [];
  }

  const eventTypes: Array<ModelEventType> = [];

  if (announced.create) {
    eventTypes.push(ModelEventType.Create);
  }

  if (announced.update) {
    eventTypes.push(ModelEventType.Update);
  }

  if (announced.delete) {
    eventTypes.push(ModelEventType.Delete);
  }

  return eventTypes;
};

// What the reader is in the middle of, as the table knows it.
export interface LiveRowsHold {
  // The page is being read (the first read, a new page, a search).
  isLoading: boolean;
  // Rows are ticked for a bulk action.
  hasSelection: boolean;
  // A row is being dragged, or a drop is being saved.
  isReordering: boolean;
  // A dialog or a menu is open anywhere on the page.
  isDialogOrMenuOpen: boolean;
  // The reader is selecting text, to copy it.
  hasTextSelection: boolean;
}

// Whether a change heard now has to wait for the reader.
export const isLiveRowsHeld: (hold: LiveRowsHold) => boolean = (
  hold: LiveRowsHold,
): boolean => {
  return (
    hold.isLoading ||
    hold.hasSelection ||
    hold.isReordering ||
    hold.isDialogOrMenuOpen ||
    hold.hasTextSelection
  );
};

/*
 * A dialog (a form, a confirmation, Ask AI) or a menu (a row's ⋯, the
 * Products menu) open anywhere on the page. A side panel is not a dialog
 * that holds the rows: it has no aria-modal (SideOver).
 */
export const LIVE_ROWS_HOLDING_ELEMENTS_SELECTOR: string = [
  '[role="dialog"][aria-modal="true"]',
  '[role="menu"]',
].join(", ");

export const isDialogOrMenuOpen: (root?: ParentNode | undefined) => boolean = (
  root?: ParentNode | undefined,
): boolean => {
  const scope: ParentNode | undefined =
    root || (typeof document !== "undefined" ? document : undefined);

  if (!scope) {
    return false;
  }

  return Boolean(scope.querySelector(LIVE_ROWS_HOLDING_ELEMENTS_SELECTOR));
};
