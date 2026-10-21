import Dictionary from "Common/Types/Dictionary";

/*
 * Add External Calendar, in the Maintenance Calendar's ⋯ menu, opens
 * Calendar Settings with its Add dialog already open: a link that only took
 * people to the list, where they then had to find the same button again, was
 * a step that taught them nothing (as Network's quick actions say).
 *
 * The ask rides in the address (?open=add-external-calendar). Calendar
 * Settings reads it once, when it opens, and takes it back out of the
 * address, so a refresh, a bookmark or Back does not open the dialog again.
 * Kept free of the routes and of the browser, so it is read and tested on
 * its own.
 */

export const EXTERNAL_CALENDAR_OPEN_QUERY_PARAM: string = "open";

export const ADD_EXTERNAL_CALENDAR_ACTION: string = "add-external-calendar";

// The query string Add External Calendar adds to Calendar Settings' address.
export function getAddExternalCalendarQuery(): Dictionary<string> {
  return {
    [EXTERNAL_CALENDAR_OPEN_QUERY_PARAM]: ADD_EXTERNAL_CALENDAR_ACTION,
  };
}

// Whether an address's query string asks for the Add dialog.
export function isAddExternalCalendarAsked(
  search: string | null | undefined,
): boolean {
  if (!search) {
    return false;
  }

  const params: URLSearchParams = new URLSearchParams(
    search.startsWith("?") ? search.slice(1) : search,
  );

  return (
    params.get(EXTERNAL_CALENDAR_OPEN_QUERY_PARAM) ===
    ADD_EXTERNAL_CALENDAR_ACTION
  );
}
