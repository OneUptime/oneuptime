import { translationKey } from "Common/UI/Utils/TranslateTemplate";

/*
 * The words of the dashboard's profile widgets, React-free so the
 * extractor finds them and the tests read the same strings the widgets
 * draw. Where the Profiler already says a thing - a kind, a ranking, an
 * empty window - the widgets say it in its words (ProfileCopy,
 * PROFILE_KIND_LABELS), so a tile and the Profiler one click later read
 * alike.
 */

// Top Functions' title until its settings give it one.
export const PROFILE_WIDGET_TOP_FUNCTIONS_TITLE: string =
  translationKey("Top functions");

// Who the widget reads, on the line under its title.
export const PROFILE_WIDGET_ALL_SERVICES: string =
  translationKey("All services");
// A pinned service whose name cannot be found (deleted, or another project's).
export const PROFILE_WIDGET_THIS_SERVICE: string =
  translationKey("This service");

// The dashboard's range was longer than the Profiler reads: its newest 7 days.
export const PROFILE_WIDGET_CAPPED_WINDOW: string =
  translationKey("Last 7 days");
export const PROFILE_WIDGET_CAPPED_WINDOW_EXPLAINED: string = translationKey(
  "The widget reads the newest 7 days of the dashboard's time range: the longest window the Profiler reads.",
);

// The link to the Profiler, pointed at what the widget shows.
export const PROFILE_WIDGET_OPEN_PROFILER: string =
  translationKey("Open in Profiler");
// A function's row opens its panel in the Profiler.
export const PROFILE_WIDGET_OPEN_FUNCTION: string = translationKey(
  "Open {{function}} in the Profiler",
);

// The column of function names in Top Functions.
export const PROFILE_WIDGET_FUNCTION_COLUMN: string =
  translationKey("Function");

export const PROFILE_WIDGET_INVALID_RANGE: string = translationKey(
  "Please select a valid start and end date.",
);

/*
 * A public dashboard reads no profiles: a profile names the code it ran,
 * which a page anyone with the link can open must not show.
 */
export const PROFILE_WIDGET_NOT_ON_PUBLIC_DASHBOARDS: string = translationKey(
  "Profile widgets are not available on public dashboards.",
);
