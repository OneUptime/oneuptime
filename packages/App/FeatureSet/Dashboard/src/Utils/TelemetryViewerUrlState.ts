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
  /*
   * The saved view the explorer currently has selected. Owned so that
   * DESELECTING one removes it — a lingering id would silently re-apply a
   * view the user cleared on the next refresh. It is also what lets the
   * Insights tab name the view whose scope it inherited, and what lets the
   * trip back re-select it rather than leaving the user with the view's
   * filters but no view.
   */
  "savedView",
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
    notifyTelemetryViewerUrlStateListeners();
  };

export type TelemetryViewerUrlStateListener = () => void;

/*
 * Everything that wants to re-read the URL after an explorer writes it.
 *
 * `Navigation.setQueryString` goes through `history.replaceState`, which
 * fires no event and triggers no react-router render — that is the whole
 * point of it, and it is why the surrounding page never learns that the
 * explorer's scope moved. The Viewer / Insights tab links need to learn,
 * though: their hrefs carry the current scope, so a link computed at the
 * last render would hand the sibling tab a stale slice (or none at all,
 * for a filter the user set after the tabs rendered).
 *
 * A module-level listener set rather than a context: the writer is a plain
 * function called from effects deep inside three different explorers, and
 * threading a provider through all of them to deliver a notification would
 * be far more machinery than the notification is worth.
 */
const urlStateListeners: Set<TelemetryViewerUrlStateListener> =
  new Set<TelemetryViewerUrlStateListener>();

export type SubscribeToTelemetryViewerUrlStateFunction = (
  listener: TelemetryViewerUrlStateListener,
) => () => void;

/** Subscribe to explorer URL writes. Returns the unsubscribe function. */
export const subscribeToTelemetryViewerUrlState: SubscribeToTelemetryViewerUrlStateFunction =
  (listener: TelemetryViewerUrlStateListener): (() => void) => {
    urlStateListeners.add(listener);

    return (): void => {
      urlStateListeners.delete(listener);
    };
  };

export type NotifyTelemetryViewerUrlStateListenersFunction = () => void;

/**
 * Tell every subscriber the URL moved.
 *
 * Exported so a surface that changes the query string by another route can
 * keep the tab links honest. Each listener is isolated: one that throws must
 * not stop the rest from hearing about the change.
 */
export const notifyTelemetryViewerUrlStateListeners: NotifyTelemetryViewerUrlStateListenersFunction =
  (): void => {
    for (const listener of Array.from(urlStateListeners)) {
      try {
        listener();
      } catch {
        // A broken subscriber is not a reason to drop the notification.
      }
    }
  };
