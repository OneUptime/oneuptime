import Dictionary from "Common/Types/Dictionary";
import Navigation from "Common/UI/Utils/Navigation";

/**
 * The query params the telemetry explorers (Logs / Traces / Metrics /
 * Exceptions) own. Every write clears the ones the current view isn't using,
 * which is what lets a filter be *removed* from the URL — while leaving every
 * other param on the route alone.
 *
 * Only one explorer is mounted per route at a time, so a single shared set is
 * enough; the names are identical across the four anyway.
 */
export const TelemetryViewerUrlParamNames: Array<string> = [
  "search",
  "filters",
  "range",
  "start",
  "end",
  "page",
  "pageSize",
  "view",
  "rootOnly",
  "status",
];

export type BuildTelemetryViewerUrlParamsFunction = (
  values: Dictionary<string | null>,
) => Dictionary<string | null>;

/**
 * Expand the params a view wants to set into the full owned set, with the
 * unused ones explicitly nulled so {@link Navigation.setQueryString} deletes
 * them.
 */
export const buildTelemetryViewerUrlParams: BuildTelemetryViewerUrlParamsFunction =
  (values: Dictionary<string | null>): Dictionary<string | null> => {
    const params: Dictionary<string | null> = {};

    for (const name of TelemetryViewerUrlParamNames) {
      params[name] = null;
    }

    for (const name of Object.keys(values)) {
      params[name] = values[name] ?? null;
    }

    return params;
  };

export type WriteTelemetryViewerUrlStateFunction = (
  values: Dictionary<string | null>,
) => void;

/**
 * Mirror an explorer's view into the URL.
 *
 * Goes through {@link Navigation.setQueryString} rather than calling
 * `history.replaceState` directly, which matters for two reasons:
 *
 *  - it *merges* instead of replacing the whole query string. The explorers
 *    used to build a fresh `URLSearchParams` and overwrite `location.search`
 *    wholesale, which silently deleted every param owned by anything else on
 *    the route — a co-mounted table's saved filters, the Profiles tab's
 *    deep-link ids, dashboard variables.
 *  - it preserves `window.history.state`. Passing `null` (as the old code did)
 *    wipes react-router's `{usr, key, idx}` bookkeeping on the current entry,
 *    which corrupts its history index and drops any navigation state.
 */
export const writeTelemetryViewerUrlState: WriteTelemetryViewerUrlStateFunction =
  (values: Dictionary<string | null>): void => {
    Navigation.setQueryString(buildTelemetryViewerUrlParams(values));
  };
