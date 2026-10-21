/*
 * Scheduled Maintenance shows its events two ways, each a page of its own:
 * All Events, the list, and Maintenance Calendar, under the side menu's
 * Calendar section. The list and the calendar share their card, filters and
 * buttons (ScheduledMaintenanceTable), drawn as one or the other.
 *
 * The calendar used to be the Calendar half of a List | Calendar switch on
 * the list, the reader's choice remembered in their browser. A reader who
 * left it on Calendar is taken to the calendar's page the first time they
 * open All Events again, and the old choice is forgotten: from then on All
 * Events is the list, and the calendar is where the side menu says. The
 * switch never put the view in the page's address, so no link carries it.
 */
export enum ScheduledMaintenanceView {
  List = "list",
  Calendar = "calendar",
}

// Where the List | Calendar switch kept a reader's choice.
export const PREVIOUS_VIEW_STORAGE_KEY: string =
  "oneuptime.scheduled-maintenance-view";

/*
 * Whether the reader last left the list on its calendar: true once, and the
 * choice forgotten whatever it was. Browser storage can be missing or refuse
 * access (a private window, blocked site data): then there is no choice.
 */
export function takePreviousCalendarChoice(
  storage?: Pick<Storage, "getItem" | "removeItem"> | null | undefined,
): boolean {
  try {
    const store: Pick<Storage, "getItem" | "removeItem"> | null =
      storage !== undefined
        ? storage
        : typeof window !== "undefined" && window.localStorage
          ? window.localStorage
          : null;

    if (!store) {
      return false;
    }

    const previous: string | null = store.getItem(PREVIOUS_VIEW_STORAGE_KEY);

    if (previous === null) {
      return false;
    }

    store.removeItem(PREVIOUS_VIEW_STORAGE_KEY);

    return previous === ScheduledMaintenanceView.Calendar;
  } catch {
    return false;
  }
}
