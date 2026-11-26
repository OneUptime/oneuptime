import Route from "Common/Types/API/Route";
import OneUptimeDate from "Common/Types/Date";
import RangeStartAndEndDateTime from "Common/Types/Time/RangeStartAndEndDateTime";
import TimeRange from "Common/Types/Time/TimeRange";
import { getTimeRangeButtonLabel } from "Common/UI/Components/Date/TimeRangeLabel";
import {
  RecordingHealthDiagnosis,
  RecordingHealthState,
} from "Common/Types/Rum/SessionReplayHealth";
import { SessionReplayHealthError } from "../../../Components/SessionReplay/SessionReplayHealthError";
import {
  formatCompact,
  formatDurationMsInLanguage,
} from "../../../Components/TelemetryResource/telemetryFormat";
import {
  composedValue,
  getGlobalTranslator,
  translatePlural,
  translateTemplate,
  translationKey,
  Translator,
} from "Common/UI/Utils/TranslateTemplate";

/*
 * The pure decisions behind the RUM application overview page.
 *
 * Overview.tsx is React and pulls Common/UI/Config (which reads `window` on
 * load) through its chrome, so the page module cannot be imported by a node
 * test. These three are the parts a test should exercise for real rather
 * than read off the source, so they live here; Overview.tsx imports and
 * re-exports them.
 */

/*
 * The range a tile counted, named as the range picker above the tiles names
 * it - "Past 1 Hour", not "selected range" - so a viewer who clicks through
 * to a list showing a different default window is never told two counts for
 * one thing without being shown why (correlation-11).
 *
 * In the reader's language (issue #10552). A quick range is the picker's own
 * label, an English key every Dashboard language words, which the tile draws
 * in the reader's language (ResourceOverviewTile.sublabel). A custom range,
 * a zoom among them, is the window's two ends, which the shared helper
 * writes in the reader's language, on their clock and in their time zone,
 * naming a day once when the window is within it
 * (OneUptimeDate.getLocalDateTimeRangeEnds): "Nov 5, 2025, 5:14 AM – 6:14
 * AM", what the picker's button says. The range used to be lowercased out of
 * the TimeRange value ("past 1 hour", "custom range"), which no locale words
 * and which read English on every page; lowercasing a translated label would
 * be wrong too, as German keeps a noun's capital.
 */
export function describeTimeRangeForTile(
  timeRange: RangeStartAndEndDateTime,
): string {
  return getTimeRangeButtonLabel(timeRange);
}

/*
 * The URL grammar every telemetry explorer reads (range=<TimeRange>, plus
 * start/end for Custom), stamped onto a list route so the list can open on
 * the window the tile counted. Values are encoded because Route appends
 * them verbatim and rejects raw spaces and colons.
 */
export function buildRangedListRoute(
  listRoute: Route,
  timeRange: RangeStartAndEndDateTime,
): Route {
  const route: Route = new Route(listRoute.toString());
  const params: Record<string, string> = {
    range: encodeURIComponent(String(timeRange.range)),
  };

  if (timeRange.range === TimeRange.CUSTOM && timeRange.startAndEndDate) {
    params["start"] = encodeURIComponent(
      OneUptimeDate.toString(timeRange.startAndEndDate.startValue),
    );
    params["end"] = encodeURIComponent(
      OneUptimeDate.toString(timeRange.startAndEndDate.endValue),
    );
  }

  try {
    return route.addQueryParams(params);
  } catch {
    return listRoute;
  }
}

/*
 * What the "Recording Health" Details row says for each state the
 * diagnosis can find: a few words, as the card's other values are, in the
 * reader's language (the page looks them up). The whole sentence - what
 * stopped, since when, for which reason, and what to do - is on the
 * application's Health page, in the Session Replay section of its menu.
 *
 * The row used to carry that sentence, composed in English with its values
 * glued in ("Uploads paused 3 hours ago", "12 uploads refused in 24h: ...",
 * "No session recorded in the past 7 hours"), so it read in English on a
 * German or a Persian Overview beside rows in the reader's language.
 */
export const RECORDING_HEALTH_ROW_WORDS: Readonly<
  Record<RecordingHealthState, string>
> = {
  "disabled-project": translationKey("Switched off for this project"),
  "disabled-app": translationKey("Switched off for this application"),
  "budget-paused": translationKey("Uploads paused"),
  refusing: translationKey("Uploads refused"),
  "never-loaded": translationKey("Recorder never loaded"),
  "loaded-never-uploaded": translationKey("Nothing uploaded yet"),
  stale: translationKey("Uploads stopped"),
  "healthy-quiet": translationKey("No recent sessions"),
  healthy: translationKey("Healthy"),
  unknown: translationKey("Unknown"),
};

// While the health is read, and when it could not be.
export const RECORDING_HEALTH_ROW_CHECKING: string =
  translationKey("Checking…");
export const RECORDING_HEALTH_ROW_FAILED: string = translationKey(
  "Could not be loaded",
);

/*
 * The "Recording Health" detail row's value, in English (the page draws it
 * in the reader's language), or undefined to leave the row out entirely.
 *
 * A viewer without the List Session Replays permission (or on a plan that
 * does not include replay) is shown nothing rather than a permission error
 * in a list of SDK facts - they cannot act on it here, and the settings
 * page is where that conversation belongs. Every other failure IS named,
 * because a silent row would read as "healthy".
 */
export function describeRecordingHealthRow(health: {
  isLoading: boolean;
  error: SessionReplayHealthError | null;
  diagnosis: RecordingHealthDiagnosis;
}): string | undefined {
  if (health.isLoading) {
    return RECORDING_HEALTH_ROW_CHECKING;
  }

  if (health.error) {
    if (health.error.kind === "permission" || health.error.kind === "plan") {
      return undefined;
    }

    return RECORDING_HEALTH_ROW_FAILED;
  }

  return (
    RECORDING_HEALTH_ROW_WORDS[health.diagnosis.state] ||
    RECORDING_HEALTH_ROW_WORDS.unknown
  );
}

/*
 * The span the OpenTelemetry browser SDK's DocumentLoadInstrumentation
 * records for each full page load (its children are documentFetch and
 * resourceFetch). Route changes in a single-page app do not produce one.
 */
export const PAGE_LOAD_SPAN_NAME: string = "documentLoad";

export interface TileText {
  // None, and the tile draws the figure's quiet dash (#8262).
  value?: string | undefined;
  sublabel: string;
}

// The whole-range page-load statistics the two page-load tiles read.
export interface PageLoadTileStats {
  count: number;
  errorCount: number;
  p50DurationMs: number;
  p95DurationMs: number;
}

/*
 * "Page loads". A failed lookup is unknown, not zero (correlation-14). When
 * the app reports other events but no documentLoad span at all, the sublabel
 * says which span is missing: "0 page loads" on an app that simply lacks
 * DocumentLoadInstrumentation would otherwise read as "nobody visited".
 */
export function describePageLoadsTile(input: {
  stats: PageLoadTileStats | null;
  failed: boolean;
  eventsTotal: number | null;
}): TileText {
  if (input.failed) {
    return { value: undefined, sublabel: "could not load" };
  }

  if (!input.stats) {
    return { value: undefined, sublabel: "full page loads" };
  }

  if (input.stats.count <= 0) {
    return {
      value: formatCompact(0, getGlobalTranslator()),
      sublabel:
        input.eventsTotal !== null && input.eventsTotal > 0
          ? translateTemplate("no {{spanName}} spans", {
              spanName: PAGE_LOAD_SPAN_NAME,
            })
          : "full page loads",
    };
  }

  return {
    value: formatCompact(input.stats.count, getGlobalTranslator()),
    sublabel:
      input.stats.errorCount > 0
        ? translatePlural(
            { one: "{{count}} failed", other: "{{count}} failed" },
            input.stats.errorCount,
            {
              count: formatCompact(
                input.stats.errorCount,
                getGlobalTranslator(),
              ),
            },
          )
        : "full page loads",
  };
}

/*
 * "Page load time (p95)", with the median in the sublabel so the typical
 * load sits beside the slow tail. No page loads means no time - a dash, not
 * "0 ms".
 */
export function describePageLoadTimeTile(input: {
  stats: PageLoadTileStats | null;
  failed: boolean;
}): TileText {
  if (input.failed) {
    return { value: undefined, sublabel: "could not load" };
  }

  if (!input.stats || input.stats.count <= 0) {
    return { value: undefined, sublabel: "no page loads" };
  }

  return {
    value: formatDurationMsInLanguage(
      input.stats.p95DurationMs,
      getGlobalTranslator(),
    ),
    sublabel: translateTemplate("median {{duration}}", {
      duration: composedValue((sentence: Translator): string => {
        return formatDurationMsInLanguage(input.stats!.p50DurationMs, sentence);
      }),
    }),
  };
}

export interface TimePointLike {
  x: Date;
  y: number;
}

/*
 * Two time series added point by point on their timestamps, sorted - the
 * handled and unhandled exception histograms drawn as one "Exceptions" line.
 */
export function sumTimeSeries(
  a: Array<TimePointLike>,
  b: Array<TimePointLike>,
): Array<TimePointLike> {
  const byTime: Map<number, number> = new Map<number, number>();

  for (const point of [...a, ...b]) {
    const ms: number = point.x.getTime();

    if (Number.isNaN(ms) || !Number.isFinite(point.y)) {
      continue;
    }

    byTime.set(ms, (byTime.get(ms) || 0) + point.y);
  }

  return Array.from(byTime.entries())
    .sort((left: [number, number], right: [number, number]): number => {
      return left[0] - right[0];
    })
    .map(([ms, y]: [number, number]): TimePointLike => {
      return { x: new Date(ms), y };
    });
}

/*
 * "Exceptions". Only the total: the histogram's handled / unhandled split
 * comes from exception.escaped, which a browser's recordException never
 * sets, so every browser exception would read as "handled".
 *
 * An app that has never reported one (isNotSetUp, from RumSignalDiagnosis)
 * shows a dash and "not set up", not a confident 0: the OpenTelemetry
 * browser SDK reports no errors on its own, so zero there says nothing
 * about how many happened (issue #5770).
 */
export function describeExceptionsTile(input: {
  exceptions: { total: number; failed: boolean } | null;
  isNotSetUp?: boolean | undefined;
}): TileText {
  if (!input.exceptions) {
    return { value: undefined, sublabel: "reported by your app" };
  }

  if (input.exceptions.failed) {
    return { value: undefined, sublabel: "could not load" };
  }

  if (input.isNotSetUp && input.exceptions.total === 0) {
    return { value: undefined, sublabel: "not set up" };
  }

  return {
    value: formatCompact(input.exceptions.total, getGlobalTranslator()),
    sublabel: "reported by your app",
  };
}
