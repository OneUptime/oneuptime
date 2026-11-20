import {
  AwsAddedMetricUnitState,
  CloudConnectionPullState,
} from "../CloudConnectorTypes";
import {
  AWS_CLOUDWATCH_UNITS,
  AwsMetricDimension,
  AwsMetricQuery,
  AwsMetricResult,
} from "./AwsCloudWatch";

/*
 * AN ADDED AWS METRIC'S UNIT, LEARNED AND KEPT RIGHT BY THE READ (#10077).
 *
 * GetMetricData answers values with no unit, and a query of it that names a
 * unit (MetricStat.Unit) is answered only with the data published in that
 * unit. So a unit is learned by asking for it (#9809, findAwsMetricUnit) -
 * once when the metric is added, and again only when its More Metrics were
 * listed. The read asks too now, in the GetMetricData call it makes anyway
 * for the addition's values, over the same window and period: no request
 * more, only the metrics the queries read (GetMetricData's price, $0.01 per
 * 1,000):
 *
 *   - a unit not known: a query per CloudWatch unit
 *     (AWS_CLOUDWATCH_UNITS, 27). The one whose query has the addition's
 *     samples is its unit, the most samples where it was sent in two;
 *   - a unit known - learned, kept with the addition, or the one AWS
 *     documents - and not confirmed for a day: one query of that unit. Its
 *     samples at each time the addition's own query has a value confirm it.
 *     Fewer, and the publisher sends another unit now (Bytes where it sent
 *     None): the next read asks every unit.
 *
 * At most AWS_UNIT_PROBES_PER_READ additions a read, each at most once an
 * hour but right after a check found another unit, and only while the call
 * has room for the queries (MAX_QUERIES_PER_CALL), so the read never makes
 * a call more for them. A window with no data says nothing, and is asked
 * again an hour later. What it learns is kept in the account's read state
 * by the addition's key, and the addition's points are written with it from
 * the read that learned it.
 */

export const AWS_UNIT_PROBES_PER_READ: number = 3;
// How often one addition is asked at most, while its unit is not learned.
export const AWS_UNIT_PROBE_EVERY_MS: number = 60 * 60 * 1000;
// How long a learned unit stands before the read checks it again.
export const AWS_UNIT_CHECK_EVERY_MS: number = 24 * 60 * 60 * 1000;

// A probe of one addition's unit, riding in the call that reads it.
export interface AwsUnitProbe {
  key: string;
  // "every": a query per unit; "check": one, of the unit it is believed to have.
  kind: "every" | "check";
  // The unit a check confirms.
  unit?: string | undefined;
  // The addition's own query in the call, whose times a check is held to.
  queryId: string;
  // Its series: what the probe's queries ask of.
  namespace: string;
  metricName: string;
  dimensions: Array<AwsMetricDimension>;
  // Its probe queries' ids start with this.
  prefix: string;
}

function isOlderThan(
  iso: string | undefined,
  ageMs: number,
  now: Date,
): boolean {
  const time: number = iso ? Date.parse(iso) : NaN;

  return !Number.isFinite(time) || now.getTime() - time >= ageMs;
}

/*
 * The unit an addition's datapoints were found to carry, by the read
 * (#10077): from the account's read state - its own, in an organization - or
 * "" when none was learned.
 */
export function getAwsLearnedUnit(data: {
  pullState: CloudConnectionPullState | undefined;
  accountId?: string | undefined;
  key: string;
}): string {
  const ofAccount: CloudConnectionPullState | undefined = data.accountId
    ? data.pullState?.accountStates?.[data.accountId]
    : undefined;

  return (
    ofAccount?.awsAddedMetricUnits?.[data.key]?.unit ||
    data.pullState?.awsAddedMetricUnits?.[data.key]?.unit ||
    ""
  );
}

/*
 * Which additions read in one call have their unit asked this read, and
 * how: in the order they are read, each once, within `probesLeft` and the
 * queries the call has `room` for.
 */
export function planAwsUnitProbes(data: {
  // Each addition read in the call, its first series: its key and query.
  additions: ReadonlyArray<{
    key: string;
    queryId: string;
    // The unit it is believed to have without a probe: kept or documented, "" for none.
    believedUnit: string;
    namespace: string;
    metricName: string;
    dimensions: Array<AwsMetricDimension>;
  }>;
  units: Readonly<Record<string, AwsAddedMetricUnitState>>;
  now: Date;
  room: number;
  probesLeft: number;
}): Array<AwsUnitProbe> {
  const probes: Array<AwsUnitProbe> = [];
  const seen: Set<string> = new Set<string>();
  let room: number = Math.max(0, data.room);

  for (const addition of data.additions) {
    if (probes.length >= data.probesLeft || seen.has(addition.key)) {
      continue;
    }

    seen.add(addition.key);

    const state: AwsAddedMetricUnitState = data.units[addition.key] || {};
    // Only one of CloudWatch's own units can be asked for: any other is no unit known.
    const unit: string = AWS_CLOUDWATCH_UNITS.includes(
      state.unit || addition.believedUnit,
    )
      ? state.unit || addition.believedUnit
      : "";
    let kind: "every" | "check" | null = null;

    if (state.isChanged || !unit) {
      // Asked every unit: once an hour, but at once after a check found another.
      kind =
        state.isChanged ||
        isOlderThan(state.probedAt, AWS_UNIT_PROBE_EVERY_MS, data.now)
          ? "every"
          : null;
    } else if (
      isOlderThan(state.checkedAt, AWS_UNIT_CHECK_EVERY_MS, data.now) &&
      isOlderThan(state.probedAt, AWS_UNIT_PROBE_EVERY_MS, data.now)
    ) {
      kind = "check";
    }

    if (!kind) {
      continue;
    }

    const size: number = kind === "every" ? AWS_CLOUDWATCH_UNITS.length : 1;

    if (size > room) {
      continue;
    }

    room -= size;
    probes.push({
      key: addition.key,
      kind,
      ...(kind === "check" ? { unit } : {}),
      queryId: addition.queryId,
      namespace: addition.namespace,
      metricName: addition.metricName,
      dimensions: addition.dimensions,
      prefix: `u${probes.length}`,
    });
  }

  return probes;
}

// A probe's queries, beside the call's own: its samples per period in a unit each.
export function buildAwsUnitProbeQueries(
  probe: AwsUnitProbe,
  periodSeconds: number,
): Array<AwsMetricQuery> {
  const units: ReadonlyArray<string> =
    probe.kind === "every" ? AWS_CLOUDWATCH_UNITS : [probe.unit || ""];

  return units.map((unit: string, index: number): AwsMetricQuery => {
    return {
      // Its place in CloudWatch's units: what its answer is read back by.
      id: `${probe.prefix}x${probe.kind === "every" ? index : Math.max(0, AWS_CLOUDWATCH_UNITS.indexOf(unit))}`,
      namespace: probe.namespace,
      metricName: probe.metricName,
      dimensions: probe.dimensions,
      statistic: "SampleCount",
      periodSeconds,
      unit,
    };
  });
}

// A probe query's id: "u", the probe's place, "x", its unit's place.
const UNIT_PROBE_ID: RegExp = new RegExp("^u\\d+x\\d+$");

// Whether a result is one of a probe's queries: none of the call's own.
export function isAwsUnitProbeResult(id: string): boolean {
  return UNIT_PROBE_ID.test(id);
}

/*
 * What a probe's answers say of its addition's unit, as the read state
 * keeps it (AwsAddedMetricUnitState): learned or confirmed, found changed,
 * or - no data in the window - asked again an hour later.
 */
export function readAwsUnitProbe(data: {
  probe: AwsUnitProbe;
  results: ReadonlyArray<AwsMetricResult>;
  state: AwsAddedMetricUnitState | undefined;
  now: Date;
}): AwsAddedMetricUnitState {
  const at: string = data.now.toISOString();
  const previous: AwsAddedMetricUnitState = data.state || {};
  const own: AwsMetricResult | undefined = data.results.find(
    (result: AwsMetricResult): boolean => {
      return result.id === data.probe.queryId;
    },
  );
  const ofProbe: Array<AwsMetricResult> = data.results.filter(
    (result: AwsMetricResult): boolean => {
      return result.id.startsWith(`${data.probe.prefix}x`);
    },
  );

  if (data.probe.kind === "every") {
    let best: string = "";
    let most: number = 0;

    for (const result of ofProbe) {
      const unit: string | undefined =
        AWS_CLOUDWATCH_UNITS[Number(result.id.split("x")[1])];
      const samples: number = result.values.reduce(
        (sum: number, value: number): number => {
          return sum + (Number.isFinite(value) && value > 0 ? value : 0);
        },
        0,
      );

      if (unit && samples > most) {
        most = samples;
        best = unit;
      }
    }

    return best
      ? { unit: best, checkedAt: at, probedAt: at }
      : { ...previous, isChanged: false, probedAt: at };
  }

  // A check: no value in the window says nothing.
  if (!own || own.timestamps.length === 0) {
    return { ...previous, probedAt: at };
  }

  const checked: Set<number> = new Set<number>();

  for (const result of ofProbe) {
    result.timestamps.forEach((time: number, index: number) => {
      if ((result.values[index] || 0) > 0) {
        checked.add(time);
      }
    });
  }

  const isConfirmed: boolean = own.timestamps.every((time: number): boolean => {
    return checked.has(time);
  });

  return isConfirmed
    ? {
        unit: data.probe.unit || previous.unit,
        checkedAt: at,
        probedAt: at,
      }
    : { ...previous, isChanged: true, probedAt: at };
}
