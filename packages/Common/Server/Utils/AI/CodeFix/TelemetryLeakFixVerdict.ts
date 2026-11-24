import FixProductionStatus from "../../../../Types/AI/FixProductionStatus";
import {
  FIX_PRODUCTION_THRESHOLDS,
  FixProductionVerdict,
  HOUR_IN_MS,
  capitalize,
  describeDuration,
  formatCount,
} from "./FixProductionVerdict";

/*
 * WHETHER A CODE FIX STOPPED A TELEMETRY LEAK IN PRODUCTION (#10368) - the
 * pure decisions behind TelemetryLeakFixWatch, so every threshold is
 * pinned by tests.
 *
 * A merged fix has stopped nothing until the service runs it, and a scrub
 * rule that hides the data at ingest hides the very thing the fix should
 * stop. So the deployed fix's version is watched, by what tells:
 *
 *   - where a scrub rule contains the leak, the rule's own counter
 *     (ScrubRuleValueCount, #10366): the values it changed in the new
 *     version. A rule that changes nothing there is a version that no
 *     longer writes the data;
 *   - where no rule does, the new version's records at each place, read
 *     with the scanner's own matchers (the hourly scan reads too few of
 *     them, and of no version in particular).
 *
 * One value changed, or one record holding the data, after the fix shipped
 * is a fix that did not stop it: Regressed. Silence counts only over
 * enough of the version's traffic: it must have run a day AND sent at
 * least as many of the store's records as the old version did in the hour
 * the leak was last seen, whichever comes later. A version that never
 * does within the watch is Unverifiable - too quiet to tell.
 */

export const TELEMETRY_LEAK_FIX_THRESHOLDS: {
  // Old pods still write for a while after a deploy starts.
  readonly rolloutGraceMinutes: number;
  // The least time the new version runs before it can be called fixed.
  readonly minWatchHours: number;
  // The longest it is watched; then it is decided either way.
  readonly maxWatchDays: number;
  // The window before the merge whose rule changes are kept for the summary.
  readonly baselineDays: number;
} = {
  rolloutGraceMinutes: FIX_PRODUCTION_THRESHOLDS.rolloutGraceMinutes,
  minWatchHours: 24,
  maxWatchDays: 7,
  baselineDays: 7,
};

// One store's traffic: what the new version sent, against what it must.
export interface TelemetryLeakTraffic {
  // "logs", "spans", "exceptions": what the store's records are called.
  noun: string;
  // The store's records the deployed fix sent since it shipped.
  since: number;
  // What the old version sent in the hour the leak was last seen.
  before: number;
}

export interface TelemetryLeakMeasure {
  // Values the containing rules changed in the deployed fix.
  valuesChanged: number;
  // Records of the deployed fix read at the places no rule covers.
  recordsRead: number;
  // Of them, the ones that still held the data.
  recordsWithData: number;
  // Whether any place is contained by a rule, and any is not.
  hasRules: boolean;
  hasUncoveredPlaces: boolean;
  traffic: Array<TelemetryLeakTraffic>;
}

// Whether every store sent at least what its old version did in the leak's hour.
export function hasEnoughTraffic(
  traffic: ReadonlyArray<TelemetryLeakTraffic>,
): boolean {
  return traffic.every((store: TelemetryLeakTraffic): boolean => {
    return store.since >= store.before;
  });
}

// "4,210 logs", "4,210 logs and 980 spans".
function describeTraffic(
  traffic: ReadonlyArray<TelemetryLeakTraffic>,
  key: "since" | "before",
): string {
  const parts: Array<string> = traffic.map(
    (store: TelemetryLeakTraffic): string => {
      return `${formatCount(store[key])} ${store.noun}`;
    },
  );

  if (parts.length <= 1) {
    return parts[0] || "none of its records";
  }

  return `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}

// How the silence was told: the rule's counter, the records, or both.
function describeHowTold(measure: TelemetryLeakMeasure): string {
  if (measure.hasRules && measure.hasUncoveredPlaces) {
    return "the scrub rules that contain it changed no value, and none of its records held the data";
  }

  if (measure.hasRules) {
    return "the scrub rules that contain it changed no value";
  }

  return "none of its records held the data";
}

/*
 * A deployed fix, watched: Regressed on any value changed or record holding
 * the data since it shipped; Verified once it has run minWatchHours and
 * sent as much as the old version did in the leak's hour; Unverifiable once
 * maxWatchDays passed without that; Watching until then. Worded the same on
 * every check that learns nothing, so such a check writes nothing.
 */
export function decideTelemetryLeakVerdict(data: {
  deployedAt: Date;
  now: Date;
  // describeDeploy's words for the deploy that shipped it.
  deployLabel: string;
  measure: TelemetryLeakMeasure;
}): FixProductionVerdict {
  const measure: TelemetryLeakMeasure = data.measure;
  const deploy: string = data.deployLabel;

  if (measure.valuesChanged > 0) {
    return {
      status: FixProductionStatus.Regressed,
      summary: `The scrub rules that contain this leak changed ${formatCount(
        measure.valuesChanged,
      )} ${measure.valuesChanged === 1 ? "value" : "values"} in ${deploy} after it shipped the fix: the code still writes the data.`,
    };
  }

  if (measure.recordsWithData > 0) {
    return {
      status: FixProductionStatus.Regressed,
      summary: `${capitalize(deploy)} still writes the data: ${formatCount(
        measure.recordsWithData,
      )} of its records held it after it shipped the fix.`,
    };
  }

  const watched: number = Math.max(
    0,
    data.now.getTime() -
      (data.deployedAt.getTime() +
        TELEMETRY_LEAK_FIX_THRESHOLDS.rolloutGraceMinutes * 60 * 1000),
  );
  const hasRunADay: boolean =
    watched >= TELEMETRY_LEAK_FIX_THRESHOLDS.minWatchHours * HOUR_IN_MS;
  const enough: boolean = hasEnoughTraffic(measure.traffic);
  const needed: string = describeTraffic(measure.traffic, "before");

  if (hasRunADay && enough) {
    return {
      status: FixProductionStatus.Verified,
      summary: `In the ${describeDuration(
        watched,
      )} since ${deploy} shipped the fix, ${describeHowTold(
        measure,
      )} in ${describeTraffic(
        measure.traffic,
        "since",
      )} - at least the ${needed} the old version sent in the hour the leak was last seen.`,
    };
  }

  if (watched >= TELEMETRY_LEAK_FIX_THRESHOLDS.maxWatchDays * 24 * HOUR_IN_MS) {
    return {
      status: FixProductionStatus.Unverifiable,
      summary: `${capitalize(deploy)} wrote none of the data in the ${
        TELEMETRY_LEAK_FIX_THRESHOLDS.maxWatchDays
      } days after it shipped the fix, but sent only ${describeTraffic(
        measure.traffic,
        "since",
      )}, fewer than the ${needed} the old version sent in the hour the leak was last seen: too little to tell.`,
    };
  }

  return {
    status: FixProductionStatus.Watching,
    summary: `${capitalize(
      deploy,
    )} shipped the fix, and has written none of the data since. It counts as fixed once it has run a day and sent ${needed}, as the old version did in the hour the leak was last seen.`,
  };
}

/*
 * The first check of a fix whose issues hold no place to watch - every
 * finding of them gone, set aside or never counted: nothing tells.
 */
export function decideTelemetryLeakBaseline(data: {
  placeCount: number;
  // Places in records no rule's counter or read can tell about.
  unreadablePlaceCount: number;
}): FixProductionVerdict | null {
  if (data.placeCount === 0) {
    return {
      status: FixProductionStatus.Unverifiable,
      summary:
        "The issue this fix was opened for no longer has a finding to watch, so whether the new version still writes the data cannot be told.",
    };
  }

  if (data.unreadablePlaceCount >= data.placeCount) {
    return {
      status: FixProductionStatus.Unverifiable,
      summary:
        "This leak is in a metric or a session replay, where neither a scrub rule's counter nor a read of the new version's records can tell whether the data still arrives.",
    };
  }

  return null;
}
