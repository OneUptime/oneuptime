import TelemetrySavedViewState, {
  TelemetrySavedViewTimeRange,
} from "Common/Types/Telemetry/TelemetrySavedViewState";

/*
 * Which saved view — if any — an explorer should apply on first mount.
 *
 * Three things want to decide this and they can disagree:
 *
 *  - the URL, which may name a specific view (a Viewer -> Insights -> Viewer
 *    round trip, or a link someone pasted into a channel);
 *  - the URL again, which may instead carry raw scope with no view at all
 *    (a cross-signal pivot, an AI-investigation deep link, the Insights tab
 *    handing back a scope the user built by hand);
 *  - the project's default saved view, which the explorer applies when the
 *    user arrives with no other instruction.
 *
 * Getting the precedence wrong is not cosmetic. The Logs explorer used to
 * auto-apply the project default unconditionally, so on any project with a
 * default view every filter-carrying deep link into /logs was silently
 * overwritten a tick after it rendered — the user saw their filtered view
 * flash and then turn into someone else's saved view.
 *
 * Pure and generic over the saved-view model so App/Tests can pin the
 * precedence without a renderer, and so the Logs, Traces and Metrics
 * explorers share one answer.
 */

export interface InitialSavedViewInput<T> {
  /** Every saved view available to this explorer, already fetched. */
  savedViews: Array<T>;
  getId: (savedView: T) => string | null | undefined;
  isDefault: (savedView: T) => boolean;
  /** The `savedView` URL param, when the link named one. */
  urlSavedViewId?: string | null | undefined;
  /**
   * Whether the URL carried scope of its own (filters / a window / a search).
   * A deep link that describes a slice must not be overwritten by the
   * project default.
   */
  hasUrlScope: boolean;
  /**
   * Whether the embedding page owns the view — an incident's pinned window,
   * or the entity hub's controlled time cursor. A saved view carries its own
   * window, so applying one would move the page off the moment it is about.
   */
  hostOwnsView: boolean;
}

export type InitialSavedViewSource = "url" | "default" | "none";

export interface InitialSavedViewResolution<T> {
  savedView: T | null;
  source: InitialSavedViewSource;
  /**
   * True when the URL named a view that is not in the list — deleted, or
   * belonging to another project. The explorer clears the stale param rather
   * than leaving a link that promises a view it cannot produce.
   */
  isUrlSavedViewMissing: boolean;
}

export function resolveInitialSavedView<T>(
  input: InitialSavedViewInput<T>,
): InitialSavedViewResolution<T> {
  const savedViews: Array<T> = Array.isArray(input.savedViews)
    ? input.savedViews
    : [];

  const urlSavedViewId: string =
    typeof input.urlSavedViewId === "string" ? input.urlSavedViewId.trim() : "";

  const namedView: T | undefined =
    urlSavedViewId.length > 0
      ? savedViews.find((savedView: T): boolean => {
          return (input.getId(savedView) || "").toString() === urlSavedViewId;
        })
      : undefined;

  /*
   * An explicitly named view wins over the host's window. The host skip
   * exists to protect a moment the user did not choose; naming a view IS the
   * user choosing, and the two only ever co-occur when a link was built from
   * inside such a page.
   */
  if (namedView) {
    return {
      savedView: namedView,
      source: "url",
      isUrlSavedViewMissing: false,
    };
  }

  const isUrlSavedViewMissing: boolean =
    urlSavedViewId.length > 0 && !namedView;

  /*
   * The URL asked for a specific view and it is gone. Falling through to the
   * project default here would answer a precise request with an unrelated
   * view, which reads as a bug; showing the explorer's own defaults does not.
   */
  if (isUrlSavedViewMissing) {
    return { savedView: null, source: "none", isUrlSavedViewMissing: true };
  }

  if (input.hostOwnsView || input.hasUrlScope) {
    return { savedView: null, source: "none", isUrlSavedViewMissing: false };
  }

  const defaultView: T | undefined = savedViews.find(
    (savedView: T): boolean => {
      return input.isDefault(savedView);
    },
  );

  if (defaultView) {
    return {
      savedView: defaultView,
      source: "default",
      isUrlSavedViewMissing: false,
    };
  }

  return { savedView: null, source: "none", isUrlSavedViewMissing: false };
}

/**
 * The URL's own scope, shaped as saved-view state, for layering over a view
 * that the same URL named.
 *
 * Only the fields the link actually spelled out survive. That distinction is
 * the whole point: a link carrying chips but no window is not saying "use
 * the default window", it is saying nothing about the window — and an
 * override of `undefined` there would wipe the named view's own.
 *
 * Returns undefined when the link described nothing, so the caller passes no
 * overrides at all rather than an empty object.
 */
export function buildUrlScopeOverrides(input: {
  search?: string | undefined;
  filters?: Array<[string, string]> | undefined;
  timeRange?: TelemetrySavedViewTimeRange | undefined;
}): Partial<TelemetrySavedViewState> | undefined {
  const overrides: Partial<TelemetrySavedViewState> = {};

  if (typeof input.search === "string" && input.search.length > 0) {
    overrides.search = input.search;
  }

  if (Array.isArray(input.filters) && input.filters.length > 0) {
    overrides.filters = input.filters;
  }

  if (input.timeRange) {
    overrides.timeRange = input.timeRange;
  }

  return Object.keys(overrides).length > 0 ? overrides : undefined;
}
