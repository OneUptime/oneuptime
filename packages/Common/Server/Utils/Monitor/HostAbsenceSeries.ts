import AggregatedResult from "../../../Types/BaseDatabase/AggregatedResult";
import { JSONObject } from "../../../Types/JSON";
import MetricQueryConfigData from "../../../Types/Metrics/MetricQueryConfigData";
import {
  CheckOn,
  CriteriaFilter,
  NoDataPolicy,
} from "../../../Types/Monitor/CriteriaFilter";
import MetricSeriesResult from "../../../Types/Monitor/MetricMonitor/MetricSeriesResult";
import MonitorCriteriaInstance from "../../../Types/Monitor/MonitorCriteriaInstance";
import MonitorStep from "../../../Types/Monitor/MonitorStep";
import MetricSeriesFingerprint from "../../../Utils/Metrics/MetricSeriesFingerprint";
import { canonicalizeEntityValue } from "../../../Utils/Telemetry/EntityKey";

/*
 * Pure helpers backing per-host "went silent" detection.
 *
 * A group-by-host metric query only returns a series for hosts that
 * emitted rows in the evaluation window — a host that stopped reporting
 * simply has no row, so its absence is invisible to the criteria
 * evaluator and its NoDataPolicy.Trigger check never runs. These helpers
 * let the telemetry monitor reconstruct the "expected" host set (from the
 * Host registry) and synthesize an empty "no data" series for every
 * expected host missing from the current window, so the existing
 * per-series NoDataPolicy path fires one correctly-labeled alert per down
 * host. Kept pure (no DB) so the gating and series-construction logic is
 * unit-testable; the worker supplies the expected-host list.
 */

/**
 * OTel resource attribute keys that identify a host. Metrics store
 * `host.name` under the resource-prefixed key; the bare form is accepted
 * defensively.
 */
export const HOST_NAME_ATTRIBUTE_KEYS: Array<string> = [
  "resource.host.name",
  "host.name",
];

/**
 * A host that reported within this window is treated as a live member of
 * the fleet and therefore "expected" to still be reporting; if it is now
 * silent, that is a real outage worth alerting on. A host silent for
 * longer than this ages out of down-detection so a decommissioned-but-not-
 * archived host does not alert forever. Deliberately generous (a day) so a
 * genuine multi-hour outage keeps alerting rather than silently resolving —
 * missing a real outage is worse than a nuisance alert on a dead host.
 */
export const HOST_ABSENCE_EXPECTED_WINDOW_MINUTES: number = 24 * 60;

/**
 * If the monitor is grouped by exactly one host-name attribute, return
 * that group-by key; otherwise null. Absent-host synthesis only makes
 * sense for a pure per-host group-by — a multi-dimensional group-by
 * (host + device, etc.) can't be enumerated from the host registry, and a
 * non-host group-by isn't about hosts at all.
 */
export function getHostAbsenceGroupByKey(
  groupByAttributeKeys: Array<string>,
): string | null {
  if (!groupByAttributeKeys || groupByAttributeKeys.length !== 1) {
    return null;
  }
  const key: string = groupByAttributeKeys[0]!;
  return HOST_NAME_ATTRIBUTE_KEYS.includes(key) ? key : null;
}

/**
 * True if any metric-value criteria filter on the step opts into no-data
 * detection (NoDataPolicy Trigger or TreatAsZero). When no criterion cares
 * about missing data, seeding absent-host series would be pointless — they
 * would evaluate to "ignore" — so the caller skips the extra work.
 */
export function monitorStepOptsIntoNoDataDetection(
  monitorStep: MonitorStep,
): boolean {
  const instances: Array<MonitorCriteriaInstance> =
    monitorStep.data?.monitorCriteria?.data?.monitorCriteriaInstanceArray || [];

  for (const instance of instances) {
    const filters: Array<CriteriaFilter> = instance.data?.filters || [];
    for (const filter of filters) {
      if (filter.checkOn !== CheckOn.MetricValue) {
        continue;
      }
      const policy: NoDataPolicy | undefined =
        filter.metricMonitorOptions?.onNoDataPolicy;
      if (
        policy === NoDataPolicy.Trigger ||
        policy === NoDataPolicy.TreatAsZero
      ) {
        return true;
      }
    }
  }
  return false;
}

/**
 * True if any query carries attribute equality filters. Such a filter
 * scopes the query to a subset of hosts, so the project-wide expected-host
 * set would over-report absences for out-of-scope hosts; the caller skips
 * absent-host synthesis in that case.
 */
export function queriesScopeHostSubset(
  queryConfigs: Array<MetricQueryConfigData>,
): boolean {
  for (const queryConfig of queryConfigs || []) {
    const attributes: JSONObject | undefined = queryConfig.metricQueryData
      ?.filterData?.attributes as JSONObject | undefined;
    if (attributes && Object.keys(attributes).length > 0) {
      return true;
    }
  }
  return false;
}

/**
 * Build synthetic "no data" series for every expected host absent from the
 * current window's series breakdown. Each synthetic series has empty
 * aggregated-result slots (one per query + formula, matching how present
 * series are shaped) so the criteria evaluator's NoDataPolicy path fires
 * for it, and labels/fingerprint identical to what the host's present
 * series would carry so the resulting alert dedupes and auto-resolves when
 * the host returns. Host identity is compared case-insensitively
 * (canonicalized), matching how ingest stores host.name.
 */
export function buildAbsentHostSeries(input: {
  presentSeries: Array<MetricSeriesResult>;
  expectedHostIdentifiers: Array<string>;
  hostKey: string;
  slotCount: number;
}): Array<MetricSeriesResult> {
  const presentHosts: Set<string> = new Set<string>();
  for (const series of input.presentSeries) {
    const raw: unknown = series.labels?.[input.hostKey];
    if (raw === undefined || raw === null || String(raw) === "") {
      continue;
    }
    presentHosts.add(canonicalizeEntityValue(String(raw)));
  }

  const slotCount: number = Math.max(input.slotCount, 1);
  const seen: Set<string> = new Set<string>();
  const absentSeries: Array<MetricSeriesResult> = [];

  for (const identifierRaw of input.expectedHostIdentifiers) {
    const identifier: string = canonicalizeEntityValue(String(identifierRaw));
    if (!identifier || presentHosts.has(identifier) || seen.has(identifier)) {
      continue;
    }
    seen.add(identifier);

    const labels: JSONObject = { [input.hostKey]: identifier };
    const aggregatedResults: Array<AggregatedResult> = Array.from(
      { length: slotCount },
      (): AggregatedResult => {
        return { data: [] };
      },
    );

    absentSeries.push({
      fingerprint: MetricSeriesFingerprint.computeFingerprint(labels),
      labels,
      aggregatedResults,
    });
  }

  return absentSeries;
}
