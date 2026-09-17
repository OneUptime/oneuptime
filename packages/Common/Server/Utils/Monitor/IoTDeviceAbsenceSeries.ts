import AggregatedResult from "../../../Types/BaseDatabase/AggregatedResult";
import { JSONObject } from "../../../Types/JSON";
import MetricSeriesResult from "../../../Types/Monitor/MetricMonitor/MetricSeriesResult";
import MetricSeriesFingerprint from "../../../Utils/Metrics/MetricSeriesFingerprint";

/*
 * Pure helpers backing per-device "went silent" detection for IoT
 * Device monitors — the IoT analogue of HostAbsenceSeries (which also
 * supplies the shared monitorStepOptsIntoNoDataDetection and
 * queriesScopeHostSubset gates; both are entity-agnostic).
 *
 * A group-by-device metric query only returns a series for devices
 * that emitted rows in the evaluation window — a device that stopped
 * reporting simply has no row, so its absence is invisible to the
 * criteria evaluator. These helpers synthesize an empty "no data"
 * series for every REGISTERED device (IoTDeviceCredential) missing
 * from the current window, so the per-series NoDataPolicy path fires
 * one correctly-labeled alert per silent device. Kept pure (no DB) so
 * the gating and series construction are unit-testable; the worker
 * supplies the expected-device list.
 *
 * Unlike hosts there is NO recency aging: registration is an explicit
 * expected-list, so a registered-but-silent device alerts until its
 * credential is disabled or deleted — that is the designed semantic.
 *
 * Device ids are handled VERBATIM: device.id datapoint labels are
 * stored byte-exact (unlike host.name, which is canonicalized at
 * ingest), so canonicalizing here would fork the fingerprint from the
 * device's real series and break incident dedupe/auto-resolve.
 */

// The datapoint label that identifies a device within a fleet.
export const IOT_DEVICE_ID_ATTRIBUTE_KEY: string = "device.id";

/**
 * If the monitor is grouped by exactly the device-id label, return
 * that group-by key; otherwise null. Absent-device synthesis only
 * makes sense for a pure per-device group-by.
 */
export function getIoTDeviceAbsenceGroupByKey(
  groupByAttributeKeys: Array<string>,
): string | null {
  if (!groupByAttributeKeys || groupByAttributeKeys.length !== 1) {
    return null;
  }
  const key: string = groupByAttributeKeys[0]!;
  return key === IOT_DEVICE_ID_ATTRIBUTE_KEY ? key : null;
}

/**
 * Build synthetic "no data" series for every registered device absent
 * from the current window's series breakdown. Each synthetic series
 * has empty aggregated-result slots (one per query + formula,
 * matching how present series are shaped) so the criteria evaluator's
 * NoDataPolicy path fires for it, and labels/fingerprint identical to
 * what the device's present series would carry so the resulting
 * incident dedupes and auto-resolves when the device returns.
 */
export function buildAbsentIoTDeviceSeries(input: {
  presentSeries: Array<MetricSeriesResult>;
  expectedDeviceExternalIds: Array<string>;
  deviceKey: string;
  slotCount: number;
}): Array<MetricSeriesResult> {
  const presentDevices: Set<string> = new Set<string>();
  for (const series of input.presentSeries) {
    const raw: unknown = series.labels?.[input.deviceKey];
    if (raw === undefined || raw === null || String(raw) === "") {
      continue;
    }
    presentDevices.add(String(raw));
  }

  const slotCount: number = Math.max(input.slotCount, 1);
  const seen: Set<string> = new Set<string>();
  const absentSeries: Array<MetricSeriesResult> = [];

  for (const externalId of input.expectedDeviceExternalIds) {
    const identifier: string = String(externalId);
    if (!identifier || presentDevices.has(identifier) || seen.has(identifier)) {
      continue;
    }
    seen.add(identifier);

    const labels: JSONObject = { [input.deviceKey]: identifier };
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
