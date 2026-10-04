import { JSONObject } from "Common/Types/JSON";
import StatusPageEventType from "Common/Types/StatusPage/StatusPageEventType";
import StatusPagesListingMonitors, {
  StatusPageListingMonitors,
} from "Common/Types/StatusPage/StatusPagesListingMonitors";
import {
  PluralTemplate,
  translationKey,
} from "Common/UI/Utils/TranslateTemplate";
import { getIdsFromFormValue } from "../Incident/IncidentStatusPageScopeForm";

/*
 * SUGGESTING THE STATUS PAGES THAT SHOW THE AFFECTED MONITORS.
 *
 * Scheduling maintenance asks which status pages show the event, and an
 * announcement asks the same. Before, that was a plain list of every status
 * page, even with the affected monitors picked on the same step: people
 * guessed which pages listed those monitors, or left the event off the
 * pages their customers read. Now the picker says, under it, "Status pages
 * that show the affected monitors: Public, EU · Add all" - one click adds a
 * page, Add all adds every one.
 *
 * It only suggests. Picking a page publishes the event there and tells the
 * page's subscribers, so a page is never picked without a click (the
 * reason #4291 did not pre-select them). The line is hidden while there is
 * nothing to add: no monitors, no page that lists them, every such page
 * already picked - or while the answer is on its way, or failed.
 *
 * The server works out which pages list the monitors
 * (POST /status-page/listing-monitors, StatusPagesListingMonitors), through
 * monitor groups too, and names only the pages the reader can read, that are
 * not archived and that show this kind of event.
 *
 * React-free, so App's tests can read it; the component is
 * StatusPageSuggestions.tsx.
 */

export interface StatusPageSuggestionsRequest {
  // The affected monitors, in whatever shape the form holds them.
  monitorIds: unknown;
  eventType: StatusPageEventType;
}

/*
 * The line's label, by how many monitors are affected. A plural template
 * (translatePlural): the string extractor reads a plain { one, other }
 * literal as one key with its "_one" form.
 */
export const STATUS_PAGE_SUGGESTIONS_LABEL: PluralTemplate = {
  one: "Status pages that show the affected monitor:",
  other: "Status pages that show the affected monitors:",
};

// One page's button, read out with the page's name.
export const ADD_SUGGESTED_STATUS_PAGE_LABEL: string = translationKey(
  "Add {{statusPageName}}",
);

// Shown when two or more pages are suggested.
export const ADD_ALL_SUGGESTED_STATUS_PAGES: string = translationKey("Add all");

// Read out once a page is added: the button it was on is gone.
export const ADDED_SUGGESTED_STATUS_PAGE_ANNOUNCEMENT: string = translationKey(
  "Added {{statusPageName}} to the status pages.",
);

export const ADDED_SUGGESTED_STATUS_PAGES_ANNOUNCEMENT: PluralTemplate = {
  one: "Added {{count}} status page.",
  other: "Added {{count}} status pages.",
};

/*
 * The monitors in a form value: bare ids (the affected resources picker),
 * {_id, name} objects (a template's monitors, not yet touched), models, or
 * the picker's whole payload for the moment between its change and the
 * form splitting it into the monitors and the other resources. Lower-cased,
 * without duplicates, in the order first seen.
 */
export const getMonitorIdsFromFormValue: (value: unknown) => Array<string> = (
  value: unknown,
): Array<string> => {
  if (
    value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    "__affectedResourcesPayload" in value
  ) {
    return getIdsFromFormValue((value as { monitors?: unknown }).monitors);
  }

  return getIdsFromFormValue(value);
};

/*
 * The request body, or null when there is nothing to ask: no monitor is
 * affected. The ids are sorted, so the body doubles as the request's key, and
 * capped at what one request may name.
 */
export const getStatusPageSuggestionsRequestBody: (
  request: StatusPageSuggestionsRequest | null,
) => JSONObject | null = (
  request: StatusPageSuggestionsRequest | null,
): JSONObject | null => {
  if (!request) {
    return null;
  }

  const monitorIds: Array<string> = getMonitorIdsFromFormValue(
    request.monitorIds,
  )
    .sort()
    .slice(0, StatusPagesListingMonitors.maxIdsPerRequest);

  if (monitorIds.length === 0) {
    return null;
  }

  return {
    monitorIds: monitorIds,
    eventType: request.eventType,
  };
};

// The pages to suggest: the ones that list the monitors, less those picked.
export const getStatusPagesToSuggest: (data: {
  listing: Array<StatusPageListingMonitors>;
  picked: unknown;
}) => Array<StatusPageListingMonitors> = (data: {
  listing: Array<StatusPageListingMonitors>;
  picked: unknown;
}): Array<StatusPageListingMonitors> => {
  const picked: Array<string> = getIdsFromFormValue(data.picked);

  return data.listing.filter((statusPage: StatusPageListingMonitors) => {
    return !picked.includes(statusPage.statusPageId.toLowerCase());
  });
};

/*
 * The picker's value once these pages are added: the pages already picked,
 * in their order, then the added ones, as ids - the shape the status page
 * picker keeps its own picks in.
 */
export const addStatusPagesToFormValue: (data: {
  picked: unknown;
  statusPageIds: Array<string>;
}) => Array<string> = (data: {
  picked: unknown;
  statusPageIds: Array<string>;
}): Array<string> => {
  const ids: Array<string> = getIdsFromFormValue(data.picked);

  for (const id of getIdsFromFormValue(data.statusPageIds)) {
    if (!ids.includes(id)) {
      ids.push(id);
    }
  }

  return ids;
};
