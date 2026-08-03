/*
 * Shared helpers for the Linux Systemd Units pages (list + detail view).
 *
 * The OTel `systemdreceiver` (config type `systemd`) reports one OTLP
 * *resource* per systemd unit, carrying a single resource attribute —
 * `systemd.unit.name`. OneUptime's metric ingest prefixes resource
 * attributes with `resource.`, so the unit identity is stored as
 * `resource.systemd.unit.name` (the Processes page reads
 * `resource.process.pid` the same way), while the datapoint attribute
 * `systemd.unit.active_state` is stored unprefixed.
 *
 * `host.name` is *not* emitted by the receiver — it is stamped onto every
 * resource by the `resourcedetection` processor, which is why the docs
 * insist on keeping it in the metrics pipeline.
 *
 * Everything here is pure so the pages stay thin and the shaping rules
 * (which are the parts that silently produce a wrong list) are unit
 * tested directly.
 */

export const SYSTEMD_UNIT_STATE_METRIC_NAME: string = "systemd.unit.state";

// Resource attribute — ingest prefixes it.
export const SYSTEMD_UNIT_NAME_ATTR: string = "resource.systemd.unit.name";

// Datapoint attribute — ingest stores it verbatim.
export const SYSTEMD_UNIT_ACTIVE_STATE_ATTR: string =
  "systemd.unit.active_state";

// Stamped by `resourcedetection`; matches Host.hostIdentifier byte-for-byte.
export const HOST_NAME_ATTR: string = "resource.host.name";

/*
 * The `systemd` receiver is Linux-only. v0.142.0 is where it first reached
 * the upstream `otelcol-contrib` binary — anything older refuses to start
 * with `'receivers' unknown type: "systemd"` — but v0.143.0 is the first
 * release worth pointing users at: v0.142.0 alone calls its CPU metric
 * `systemd.unit.cpu.time` (renamed after) and probes cgroups on every unit,
 * logging a scrape error for each non-`.service` one.
 *
 * Quoted in the empty states and in the setup docs.
 */
export const MIN_OTELCOL_CONTRIB_VERSION: string = "v0.143.0";

/*
 * The unit states systemd itself defines, in the order the receiver's
 * `systemd.unit.active_state` enum lists them.
 * https://www.freedesktop.org/software/systemd/man/latest/systemd.html#Units
 */
export const SYSTEMD_ACTIVE_STATES: Array<string> = [
  "active",
  "reloading",
  "inactive",
  "failed",
  "activating",
  "deactivating",
  "maintenance",
  "refreshing",
];

export interface SystemdStateMeta {
  label: string;
  dot: string;
  pill: string;
  // Plain CSS color for places Tailwind classes can't reach (facet dots).
  hex: string;
}

/*
 * Map an `active_state` to the wording and colour `systemctl status` users
 * already expect. Unlike Windows services, systemd has a genuinely failed
 * state — it gets red, because "a unit is failed" is the single thing this
 * page exists to make obvious.
 */
export const activeStateMeta: (state: string | null) => SystemdStateMeta = (
  state: string | null,
): SystemdStateMeta => {
  switch (state) {
    case "active":
      return {
        label: "Active",
        dot: "bg-green-500",
        pill: "bg-green-50 text-green-700 ring-green-600/20",
        hex: "#22c55e",
      };
    case "failed":
      return {
        label: "Failed",
        dot: "bg-red-500",
        pill: "bg-red-50 text-red-700 ring-red-600/20",
        hex: "#ef4444",
      };
    case "inactive":
      return {
        label: "Inactive",
        dot: "bg-gray-400",
        pill: "bg-gray-50 text-gray-600 ring-gray-500/20",
        hex: "#9ca3af",
      };
    case "activating":
      return {
        label: "Activating",
        dot: "bg-blue-500",
        pill: "bg-blue-50 text-blue-700 ring-blue-600/20",
        hex: "#3b82f6",
      };
    case "deactivating":
      return {
        label: "Deactivating",
        dot: "bg-blue-500",
        pill: "bg-blue-50 text-blue-700 ring-blue-600/20",
        hex: "#3b82f6",
      };
    case "reloading":
      return {
        label: "Reloading",
        dot: "bg-blue-500",
        pill: "bg-blue-50 text-blue-700 ring-blue-600/20",
        hex: "#3b82f6",
      };
    case "refreshing":
      return {
        label: "Refreshing",
        dot: "bg-blue-500",
        pill: "bg-blue-50 text-blue-700 ring-blue-600/20",
        hex: "#3b82f6",
      };
    case "maintenance":
      return {
        label: "Maintenance",
        dot: "bg-amber-500",
        pill: "bg-amber-50 text-amber-700 ring-amber-600/20",
        hex: "#f59e0b",
      };
    default:
      return {
        label: state ? state : "Unknown",
        dot: "bg-gray-300",
        pill: "bg-gray-50 text-gray-500 ring-gray-500/20",
        hex: "#d1d5db",
      };
  }
};

/*
 * Severity-ordered plotting scale for the state chart, worst → best, so
 * Min-aggregation over a bucket surfaces the worst state that bucket saw.
 * Steps are uneven on purpose: the default 5-tick layout over [0, 8] lands
 * on 0/2/4/6/8, so the four states worth reading off an axis — Failed,
 * Inactive, Activating, Active — sit exactly there. 7 is deliberately
 * vacant so Active anchors the top of the range.
 */
export const systemdStatePlotRank: (state: string | null) => number | null = (
  state: string | null,
): number | null => {
  switch (state) {
    case "failed":
      return 0;
    case "maintenance":
      return 1;
    case "inactive":
      return 2;
    case "deactivating":
      return 3;
    case "activating":
      return 4;
    case "refreshing":
      return 5;
    case "reloading":
      return 6;
    case "active":
      return 8;
    default:
      // An unrecognised state isn't plotted; it still shows in State Changes.
      return null;
  }
};

// Highest rank `systemdStatePlotRank` returns; the chart's y-axis maximum.
export const SYSTEMD_PLOT_RANK_MAX: number = 8;

export const systemdPlotRankLabel: (rank: number) => string = (
  rank: number,
): string => {
  switch (rank) {
    case 0:
      return "Failed";
    case 1:
      return "Maintenance";
    case 2:
      return "Inactive";
    case 3:
      return "Deactivating";
    case 4:
      return "Activating";
    case 5:
      return "Refreshing";
    case 6:
      return "Reloading";
    case 8:
      return "Active";
    default:
      // 7 and any fractional tick the chart invents get no label.
      return "";
  }
};

/*
 * The suffix after the final dot is the unit type — `.service`, `.socket`,
 * `.timer`, `.target`, `.mount`, ... The receiver defaults to `*.service`,
 * but `units:` can be widened, and the type is then the useful second facet
 * (it is what the Windows page's "Startup" column has no analogue for:
 * systemd's enablement state is not exposed by the receiver).
 */
export const unitTypeOf: (unitName: string) => string = (
  unitName: string,
): string => {
  const lastDot: number = unitName.lastIndexOf(".");
  if (lastDot < 0 || lastDot === unitName.length - 1) {
    return "";
  }
  return unitName.substring(lastDot + 1).toLowerCase();
};

export const unitTypeLabel: (unitName: string) => string = (
  unitName: string,
): string => {
  const type: string = unitTypeOf(unitName);
  if (!type) {
    return "Unit";
  }
  return `${type.charAt(0).toUpperCase()}${type.substring(1)}`;
};

/*
 * Unit names can contain characters a URL path segment (and OneUptime's
 * Route charset) rejects — escaped device units carry backslashes
 * (`dev-disk-by\x2duuid-….device`) and templated units carry `@`.
 * encodeURIComponent covers everything except `~`, which Route's validation
 * also rejects, so encode it explicitly. Same rule as Windows services.
 */
export const encodeUnitNameForUrl: (name: string) => string = (
  name: string,
): string => {
  return encodeURIComponent(name).replace(/~/g, "%7E");
};

export const decodeUnitNameFromUrl: (segment: string) => string = (
  segment: string,
): string => {
  try {
    return decodeURIComponent(segment);
  } catch {
    // Malformed escape sequence in the URL — fall back to the raw segment.
    return segment;
  }
};

/*
 * The subset of an analytics `Metric` row these helpers read. Kept
 * structural (rather than importing the model) so the shaping rules can be
 * exercised from a plain Node test without dragging in the analytics stack.
 */
export interface SystemdMetricDatapoint {
  time?: Date | string | null | undefined;
  value?: number | string | null | undefined;
  attributes?: Record<string, unknown> | null | undefined;
}

export interface SystemdUnitRow {
  key: string;
  name: string;
  activeState: string | null;
  stateLabel: string;
  unitType: string;
  unitTypeLabel: string;
}

export interface SystemdUnitRollup {
  rows: Array<SystemdUnitRow>;
  latestSampleAt: Date | null;
}

export interface SystemdUnitSample {
  time: Date;
  state: string;
}

export interface SystemdStateTransition {
  time: Date;
  fromState: string;
  toState: string;
}

interface ParsedDatapoint {
  time: Date;
  unitName: string;
  state: string | null;
  isAsserted: boolean;
}

const readStringAttribute: (
  attributes: Record<string, unknown> | null | undefined,
  key: string,
) => string | null = (
  attributes: Record<string, unknown> | null | undefined,
  key: string,
): string | null => {
  if (!attributes) {
    return null;
  }
  const raw: unknown = attributes[key];
  if (typeof raw !== "string") {
    return null;
  }
  const trimmed: string = raw.trim();
  return trimmed === "" ? null : trimmed;
};

const parseSampleTime: (
  time: Date | string | null | undefined,
) => Date | null = (time: Date | string | null | undefined): Date | null => {
  if (time === null || time === undefined) {
    return null;
  }
  const parsed: Date = time instanceof Date ? time : new Date(time);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

/*
 * ClickHouse hands Decimal columns back as either a number or its string
 * form depending on the driver path, so never compare `value` directly.
 */
const isAssertedValue: (
  value: number | string | null | undefined,
) => boolean = (value: number | string | null | undefined): boolean => {
  if (value === null || value === undefined) {
    return false;
  }
  const numeric: number = Number(value);
  return Number.isFinite(numeric) && numeric > 0;
};

const parseDatapoints: (
  datapoints: Array<SystemdMetricDatapoint>,
) => Array<ParsedDatapoint> = (
  datapoints: Array<SystemdMetricDatapoint>,
): Array<ParsedDatapoint> => {
  const parsed: Array<ParsedDatapoint> = [];

  for (const datapoint of datapoints) {
    const time: Date | null = parseSampleTime(datapoint.time);
    if (!time) {
      continue;
    }

    const unitName: string | null = readStringAttribute(
      datapoint.attributes,
      SYSTEMD_UNIT_NAME_ATTR,
    );
    if (!unitName) {
      continue;
    }

    parsed.push({
      time: time,
      unitName: unitName,
      state: readStringAttribute(
        datapoint.attributes,
        SYSTEMD_UNIT_ACTIVE_STATE_ATTR,
      ),
      isAsserted: isAssertedValue(datapoint.value),
    });
  }

  return parsed;
};

/*
 * Two states asserted at the same instant is not a shape the receiver
 * produces, but ClickHouse gives no ordering guarantee between rows sharing
 * a timestamp, so the tie has to break deterministically. Break it toward
 * the worse state: a `failed` that loses a coin toss to `active` is the one
 * failure mode of this page that actually matters.
 */
const isWorseState: (
  candidate: string | null,
  current: string | null,
) => boolean = (candidate: string | null, current: string | null): boolean => {
  const candidateRank: number | null = systemdStatePlotRank(candidate);
  const currentRank: number | null = systemdStatePlotRank(current);
  if (candidateRank === null) {
    return false;
  }
  if (currentRank === null) {
    return true;
  }
  return candidateRank < currentRank;
};

/*
 * Roll the per-scrape state set up into one row per unit.
 *
 * `systemd.unit.state` is a state set: every scrape emits one datapoint per
 * possible `active_state` for every unit, valued 1 on the state the unit is
 * actually in and 0 on all the others. So the current state is read off the
 * *attribute* of the asserted (non-zero) datapoint, never off the value —
 * the opposite of the Windows page, where the value *is* the state code.
 *
 * Callers filter the zeros out server-side; the zero handling here is what
 * keeps the page honest if that filter is ever dropped, and it is why a unit
 * whose scrape contains no asserted datapoint still gets a row (as Unknown)
 * instead of silently vanishing from the list.
 */
export const buildSystemdUnitRows: (
  datapoints: Array<SystemdMetricDatapoint>,
) => SystemdUnitRollup = (
  datapoints: Array<SystemdMetricDatapoint>,
): SystemdUnitRollup => {
  const parsed: Array<ParsedDatapoint> = parseDatapoints(datapoints);

  const asserted: Map<string, ParsedDatapoint> = new Map();
  // Units seen only as zeros still deserve a row, at their newest timestamp.
  const seen: Map<string, Date> = new Map();
  let latestSampleAt: Date | null = null;

  for (const datapoint of parsed) {
    if (latestSampleAt === null || datapoint.time > latestSampleAt) {
      latestSampleAt = datapoint.time;
    }

    const seenAt: Date | undefined = seen.get(datapoint.unitName);
    if (!seenAt || datapoint.time > seenAt) {
      seen.set(datapoint.unitName, datapoint.time);
    }

    if (!datapoint.isAsserted) {
      continue;
    }

    const best: ParsedDatapoint | undefined = asserted.get(datapoint.unitName);
    if (
      !best ||
      datapoint.time > best.time ||
      (datapoint.time.getTime() === best.time.getTime() &&
        isWorseState(datapoint.state, best.state))
    ) {
      asserted.set(datapoint.unitName, datapoint);
    }
  }

  const rows: Array<SystemdUnitRow> = [];

  for (const unitName of seen.keys()) {
    const state: string | null = asserted.get(unitName)?.state ?? null;
    rows.push({
      key: unitName,
      name: unitName,
      activeState: state,
      stateLabel: activeStateMeta(state).label,
      unitType: unitTypeOf(unitName),
      unitTypeLabel: unitTypeLabel(unitName),
    });
  }

  return { rows: rows, latestSampleAt: latestSampleAt };
};

/*
 * The receiver stamps every datapoint of a scrape with one timestamp, so a
 * capped fetch that came back holding a single timestamp is a fetch that was
 * cut off inside the newest scrape — units are missing from it. Any second
 * timestamp proves the newest scrape was returned whole.
 *
 * This is the difference between "the list is a complete snapshot" and "the
 * list quietly lost the units the sort happened to put last", so the list
 * page checks it rather than assuming the cap is generous enough.
 */
export const hasSingleSampleTimestamp: (
  datapoints: Array<SystemdMetricDatapoint>,
) => boolean = (datapoints: Array<SystemdMetricDatapoint>): boolean => {
  let seenAt: number | null = null;

  for (const datapoint of datapoints) {
    const time: Date | null = parseSampleTime(datapoint.time);
    if (!time) {
      continue;
    }
    if (seenAt === null) {
      seenAt = time.getTime();
      continue;
    }
    if (seenAt !== time.getTime()) {
      return false;
    }
  }

  return seenAt !== null;
};

/*
 * Collapse one unit's datapoints into an ascending series of "the state at
 * this scrape". One sample per timestamp: a scrape that somehow asserts two
 * states resolves to the worse one, matching `buildSystemdUnitRows`.
 */
export const buildSystemdUnitSamples: (
  datapoints: Array<SystemdMetricDatapoint>,
) => Array<SystemdUnitSample> = (
  datapoints: Array<SystemdMetricDatapoint>,
): Array<SystemdUnitSample> => {
  const byTime: Map<number, string> = new Map();

  for (const datapoint of parseDatapoints(datapoints)) {
    if (!datapoint.isAsserted || !datapoint.state) {
      continue;
    }

    const at: number = datapoint.time.getTime();
    const current: string | undefined = byTime.get(at);
    if (current === undefined || isWorseState(datapoint.state, current)) {
      byTime.set(at, datapoint.state);
    }
  }

  return Array.from(byTime.entries())
    .sort((a: [number, string], b: [number, string]) => {
      return a[0] - b[0];
    })
    .map(([at, state]: [number, string]): SystemdUnitSample => {
      return { time: new Date(at), state: state };
    });
};

export const detectSystemdStateTransitions: (
  samples: Array<SystemdUnitSample>,
) => Array<SystemdStateTransition> = (
  samples: Array<SystemdUnitSample>,
): Array<SystemdStateTransition> => {
  const transitions: Array<SystemdStateTransition> = [];

  for (let i: number = 1; i < samples.length; i++) {
    const previous: SystemdUnitSample = samples[i - 1]!;
    const current: SystemdUnitSample = samples[i]!;
    if (previous.state !== current.state) {
      transitions.push({
        time: current.time,
        fromState: previous.state,
        toState: current.state,
      });
    }
  }

  return transitions;
};

export interface SystemdAvailability {
  activeSampleCount: number;
  totalSampleCount: number;
  percent: number | null;
}

/*
 * "Active" is the healthy state for every unit type the receiver reports —
 * a running `.service`, a listening `.socket`, an armed `.timer` — so the
 * same ratio reads correctly across all of them.
 */
export const computeSystemdAvailability: (
  samples: Array<SystemdUnitSample>,
) => SystemdAvailability = (
  samples: Array<SystemdUnitSample>,
): SystemdAvailability => {
  const activeSampleCount: number = samples.filter(
    (sample: SystemdUnitSample) => {
      return sample.state === "active";
    },
  ).length;

  return {
    activeSampleCount: activeSampleCount,
    totalSampleCount: samples.length,
    percent:
      samples.length === 0 ? null : (activeSampleCount / samples.length) * 100,
  };
};
