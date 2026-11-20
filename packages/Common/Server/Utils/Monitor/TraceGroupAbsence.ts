import { JSONObject } from "../../../Types/JSON";
import {
  CheckOn,
  CriteriaFilter,
  CriteriaFilterUtil,
} from "../../../Types/Monitor/CriteriaFilter";
import MonitorCriteriaInstance from "../../../Types/Monitor/MonitorCriteriaInstance";
import MonitorStep from "../../../Types/Monitor/MonitorStep";
import TraceMonitorGroupResult from "../../../Types/Monitor/TraceMonitor/TraceMonitorGroupResult";
import MetricSeriesFingerprint from "../../../Utils/Metrics/MetricSeriesFingerprint";
import CompareCriteria from "./Criteria/CompareCriteria";

/*
 * A GROUP THAT WENT QUIET, FOR A GROUPED TRACES MONITOR (#9711).
 *
 * A grouped count only has a group for the values its window's spans
 * carry: a device that stopped sending spans has no span to make a group
 * of, so "fewer than 1 span per install" never sees it - exactly the case
 * a fleet of kiosks wants to hear about. As a host's silence is found
 * (HostAbsenceSeries), the groups to expect are the ones seen recently:
 * here the groups the monitor's spans were in over the week before its
 * window. Each expected group with no span in the window is counted as 0,
 * so the criteria judge it, and it alerts on its own, as one device of the
 * fleet, and resolves when it reports again. A group silent for longer
 * than the week ages out of the expected set, and its alert resolves.
 *
 * Only when a criteria of the monitor can match 0 spans: a monitor that
 * alerts on "more than 10 error spans per route" has nothing to gain from
 * the routes that went quiet, and reads nothing more.
 *
 * When every expected group is quiet - nothing the monitor matches sent a
 * span - the whole app went quiet, not one device: no group is judged
 * then (TraceMonitorResponse.isQuietWindow), so a fleet that loses its
 * network at once does not raise an alert per device. That silence is the
 * whole app's monitor's to report, App Stopped Reporting's for a mobile
 * app.
 *
 * Pure, but for the cache of the expected groups: reading a week of spans
 * every minute would cost far more than the window itself, and a group
 * expected ten minutes late is still expected.
 */

// How far back a group is expected to keep reporting.
export const TRACE_GROUP_EXPECTED_LOOKBACK_DAYS: number = 7;

// The most recently seen groups expected at most: a fleet, not an audience.
export const TRACE_GROUP_EXPECTED_LIMIT: number = 1000;

// How long the expected groups of a monitor are read again after.
export const TRACE_GROUP_EXPECTED_CACHE_MINUTES: number = 10;

/*
 * WHICH DEVICE A GROUP IS, IN WORDS (#9925).
 *
 * A group of one install's spans (Device Stopped Reporting groups by the
 * install OpenTelemetry Android names) is identified by an opaque id: an
 * alert that says "Install: 1b4e28ba-2fa1-..." tells a kiosk fleet's
 * on-call engineer nothing, where "Device: Store 0412, lane 3" says which
 * kiosk to walk to. So a group whose group-by names one device carries what
 * its spans last said about that device: its name - the `host.name` a fleet
 * that names its devices sets (docs/rum/android-setup, "Name each device") -
 * and its model.
 *
 * Only for display, beside the group's labels: it is never part of the
 * labels its alert's fingerprint is made of, so a device renamed while its
 * alert is open stays the same alert, and one that sends no name at all
 * reads by its model and install, as before.
 */

// The group-by keys that each name one device of a mobile app.
export const TRACE_GROUP_DEVICE_KEYS: ReadonlyArray<string> = [
  "resource.app.installation.id",
  "resource.device.id",
];

export interface TraceGroupContextLabel {
  // The label it is shown under (SeriesLabelDisplay names it).
  label: string;
  // The span attributes it is read from, the first that has a value winning.
  attributes: ReadonlyArray<string>;
}

/*
 * What a device's group says about the device: its name, then its model -
 * the name OpenTelemetry Android sets (`device.model.name`, "Pixel 7"), else
 * the identifier opentelemetry-swift sets (`device.model.identifier`,
 * "iPhone15,2").
 */
export const TRACE_GROUP_DEVICE_CONTEXT: ReadonlyArray<TraceGroupContextLabel> =
  [
    { label: "device.name", attributes: ["resource.host.name"] },
    {
      label: "device.model.name",
      attributes: [
        "resource.device.model.name",
        "resource.device.model.identifier",
      ],
    },
  ];

/*
 * The context labels a grouped monitor's groups carry: the device's, when a
 * group-by key names one device, without what the groups are already split
 * by. None otherwise - a route's or a status's group has no one device.
 */
export function getTraceGroupContextLabels(
  groupByAttributes: Array<string>,
): Array<TraceGroupContextLabel> {
  const namesDevice: boolean = groupByAttributes.some((key: string) => {
    return TRACE_GROUP_DEVICE_KEYS.includes(key.trim());
  });

  if (!namesDevice) {
    return [];
  }

  return TRACE_GROUP_DEVICE_CONTEXT.map(
    (context: TraceGroupContextLabel): TraceGroupContextLabel => {
      return {
        label: context.label,
        attributes: context.attributes.filter((attribute: string) => {
          return !groupByAttributes.includes(attribute);
        }),
      };
    },
  ).filter((context: TraceGroupContextLabel): boolean => {
    return context.attributes.length > 0;
  });
}

// The span attributes the context labels are read from, each once.
export function getTraceGroupContextAttributes(
  labels: Array<TraceGroupContextLabel>,
): Array<string> {
  const attributes: Array<string> = [];

  for (const label of labels) {
    for (const attribute of label.attributes) {
      if (!attributes.includes(attribute)) {
        attributes.push(attribute);
      }
    }
  }

  return attributes;
}

/*
 * A group's context labels from the values its spans last carried for each
 * attribute (an attribute -> value map): the first attribute of a label with
 * a value. A label with none is left out, so a device that sends no name
 * carries no name. Undefined when no label has a value.
 */
export function toGroupContext(input: {
  labels: Array<TraceGroupContextLabel>;
  values: Record<string, string>;
}): JSONObject | undefined {
  const context: JSONObject = {};

  for (const label of input.labels) {
    for (const attribute of label.attributes) {
      const value: string = (input.values[attribute] || "").trim();

      if (value) {
        context[label.label] = value;
        break;
      }
    }
  }

  return Object.keys(context).length > 0 ? context : undefined;
}

/*
 * A group the monitor expects to hear from: its values, and what its spans
 * last said about it (toGroupContext), when the monitor reads that.
 */
export interface ExpectedTraceGroup {
  values: Array<string>;
  context?: JSONObject | undefined;
}

// A group of the window: its values, its count and its context.
export interface WindowTraceGroup {
  values: Array<string>;
  count: number;
  context?: JSONObject | undefined;
}

/*
 * Whether one of the step's criteria that opens an alert or an incident can
 * match a group with no span. A recovery criteria that matches 0 ("at most
 * 10 error spans") has nothing to gain from the groups that went quiet.
 */
export function traceStepCountsQuietGroups(
  monitorStep: MonitorStep | undefined,
): boolean {
  const instances: Array<MonitorCriteriaInstance> =
    monitorStep?.data?.monitorCriteria?.data?.monitorCriteriaInstanceArray ||
    [];

  for (const instance of instances) {
    if (!instance.data?.createAlerts && !instance.data?.createIncidents) {
      continue;
    }

    for (const filter of (instance.data?.filters ||
      []) as Array<CriteriaFilter>) {
      if (
        filter.checkOn !== CheckOn.SpanCount ||
        CriteriaFilterUtil.isAnomalyFilterType(filter.filterType)
      ) {
        continue;
      }

      const threshold: number | null = CompareCriteria.convertToNumber(
        filter.value,
      ) as number | null;

      if (threshold === null || !Number.isFinite(Number(threshold))) {
        continue;
      }

      if (
        CompareCriteria.compareCriteriaNumbers({
          value: 0,
          threshold: Number(threshold),
          criteriaFilter: filter,
        })
      ) {
        return true;
      }
    }
  }

  return false;
}

// The labels a group's values make, one per group-by key.
export function toGroupLabels(
  groupByAttributes: Array<string>,
  values: Array<string>,
): JSONObject {
  const labels: JSONObject = {};

  groupByAttributes.forEach((key: string, index: number) => {
    labels[key] = values[index] ?? "";
  });

  return labels;
}

// A group's identity, as the values it was read with.
function groupKey(values: Array<string>): string {
  return JSON.stringify(values);
}

export interface TraceGroupBreakdown {
  // Quiet groups first, then the window's, at most `limit`.
  groups: Array<TraceMonitorGroupResult>;
  // Every group there was: the window's and the quiet ones.
  totalGroupCount: number;
  // The quiet groups there were, before the cut.
  quietGroupCount: number;
}

// An expected group as read, from either shape it is handed in.
function toExpectedGroup(
  group: ExpectedTraceGroup | Array<string>,
): ExpectedTraceGroup {
  return Array.isArray(group) ? { values: group } : group;
}

/*
 * The window's groups, with every expected group that sent no span in it
 * counted as 0 and named quiet. The quiet ones come first, in the order they
 * were last seen, the most recent first: they are what such a monitor is for,
 * and a cap must never cut one for a busy group. A group whose every value
 * is empty is no group - a span that names no install is no install.
 *
 * Each group keeps the context its spans last carried (which device it is),
 * for display: a quiet group's from the week before the window, a window
 * group's from the window. The fingerprint is made of the labels alone.
 */
export function mergeQuietGroups(input: {
  groupByAttributes: Array<string>;
  // The window's groups, the busiest first.
  windowGroups: Array<WindowTraceGroup>;
  // How many groups the window had, before its read's cut.
  windowGroupCount: number;
  // The groups seen before the window, the most recently seen first.
  expectedGroups: Array<ExpectedTraceGroup | Array<string>>;
  limit: number;
}): TraceGroupBreakdown {
  const inWindow: Set<string> = new Set<string>(
    input.windowGroups.map((group: WindowTraceGroup) => {
      return groupKey(group.values);
    }),
  );

  const toResult: (
    values: Array<string>,
    spanCount: number,
    isQuiet: boolean,
    context: JSONObject | undefined,
  ) => TraceMonitorGroupResult = (
    values: Array<string>,
    spanCount: number,
    isQuiet: boolean,
    context: JSONObject | undefined,
  ): TraceMonitorGroupResult => {
    const labels: JSONObject = toGroupLabels(input.groupByAttributes, values);

    return {
      fingerprint: MetricSeriesFingerprint.computeFingerprint(labels),
      labels: labels,
      spanCount: spanCount,
      ...(isQuiet ? { isQuiet: true } : {}),
      ...(context && Object.keys(context).length > 0
        ? { context: context }
        : {}),
    };
  };

  const quiet: Array<TraceMonitorGroupResult> = [];
  const seenQuiet: Set<string> = new Set<string>();

  for (const expected of input.expectedGroups) {
    const { values, context } = toExpectedGroup(expected);
    const key: string = groupKey(values);

    if (
      inWindow.has(key) ||
      seenQuiet.has(key) ||
      values.every((value: string) => {
        return value === "";
      })
    ) {
      continue;
    }

    seenQuiet.add(key);
    quiet.push(toResult(values, 0, true, context));
  }

  const limit: number = Math.max(0, Math.floor(input.limit));

  const groups: Array<TraceMonitorGroupResult> = [
    ...quiet,
    ...input.windowGroups.map((group: WindowTraceGroup) => {
      return toResult(group.values, group.count, false, group.context);
    }),
  ].slice(0, limit);

  return {
    groups: groups,
    totalGroupCount: input.windowGroupCount + quiet.length,
    quietGroupCount: quiet.length,
  };
}

interface CachedGroups {
  expiresAt: number;
  groups: Array<ExpectedTraceGroup>;
}

/*
 * The expected groups of each monitor, for TRACE_GROUP_EXPECTED_CACHE_MINUTES,
 * keyed by the monitor and what it reads - a monitor whose filters changed
 * reads again at once.
 */
export class TraceGroupExpectedCache {
  private static cache: Map<string, CachedGroups> = new Map<
    string,
    CachedGroups
  >();

  // Past this many monitors, the oldest entries go first.
  private static readonly MAX_ENTRIES: number = 5000;

  public static async read(input: {
    key: string;
    now: Date;
    load: () => Promise<Array<ExpectedTraceGroup>>;
  }): Promise<Array<ExpectedTraceGroup>> {
    const cached: CachedGroups | undefined = this.cache.get(input.key);

    if (cached && cached.expiresAt > input.now.getTime()) {
      return cached.groups;
    }

    const groups: Array<ExpectedTraceGroup> = await input.load();

    if (this.cache.size >= this.MAX_ENTRIES) {
      const oldest: string | undefined = this.cache.keys().next().value;

      if (oldest !== undefined) {
        this.cache.delete(oldest);
      }
    }

    this.cache.delete(input.key);
    this.cache.set(input.key, {
      expiresAt:
        input.now.getTime() + TRACE_GROUP_EXPECTED_CACHE_MINUTES * 60 * 1000,
      groups: groups,
    });

    return groups;
  }

  public static clear(): void {
    this.cache.clear();
  }
}
