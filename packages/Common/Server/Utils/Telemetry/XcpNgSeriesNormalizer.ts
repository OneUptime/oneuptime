import { JSONArray, JSONObject, JSONValue } from "../../../Types/JSON";
import {
  XCP_NG_DERIVED_SERIES_SCOPE_NAME,
  XCP_NG_ID_ATTRIBUTE,
  XCP_NG_SCOPE_ATTRIBUTE,
  XcpNgDerivedSeries,
  XcpNgHostPowerState,
  XcpNgLabel,
  XcpNgScope,
  XcpNgSeries,
  XcpNgTelemetryUtil,
  XcpNgVmPowerState,
} from "../../../Types/XcpNg/XcpNgTelemetry";
import { getXcpNgLabel, isXcpNgStaleDatapoint } from "./XcpNgSnapshotScan";

/*
 * ------------------------------------------------------------------
 * XCP-ng series normalizer - pure
 * ------------------------------------------------------------------
 *
 * Runs on one pool's OTLP resource block before its rows are built, the way
 * OpenStackInstanceMetricsIngest does for an OpenStack cloud, so whichever
 * way the pool's series arrived - the XCP-ng Agent today, a probe reading
 * Xen Orchestra without an agent tomorrow (#10996) - the rows OneUptime
 * stores are the same. It does three things:
 *
 *   1. THE TRAP, again. Xen Orchestra types eight series `counter` that hold
 *      XAPI's per-second rates (XCP_NG_RATE_TYPED_AS_COUNTER_SERIES). The
 *      agent turns them into gauges; a collector configured by hand may not,
 *      and its cumulative sums would make every throughput chart wrong. Any
 *      of the eight still arriving as a sum is turned into a gauge here, its
 *      values untouched.
 *
 *   2. ONE WAY TO NAME AN OBJECT. Xen Orchestra names a host or VM by `uuid`,
 *      a storage repository by `sr_uuid`, a virtual disk by `vdi_uuid`.
 *      Every datapoint is stamped with xcp_ng.scope (what kind of object)
 *      and xcp_ng.id (its UUID), so a page, a monitor filter or a template
 *      reads one attribute whatever series it reads.
 *
 *   3. HEALTH AS NUMBERS. Xen Orchestra puts a host's and a VM's state in a
 *      label (xcp_host_status{power_state="Halted"} 1), which a threshold
 *      cannot read. The derived 0/1 gauges of XcpNgDerivedSeries say it as a
 *      value, per object, on every scrape, so "a host is offline" is
 *      `xcp_ng.host.running < 1` the way Proxmox's is `pve_up < 1`. They
 *      carry the status series' labels minus the state ones (power_state,
 *      enabled), so a state change never splits an object's series in two.
 *
 * A staleness marker (the prometheus receiver's flag for a series that just
 * disappeared: a deleted VM, a host removed from the pool) derives nothing:
 * a VM someone deleted must not read as one that stopped.
 */

const STATE_LABELS: ReadonlySet<string> = new Set<string>([
  XcpNgLabel.PowerState,
  XcpNgLabel.Enabled,
]);

export interface XcpNgVmStatusReading {
  uuid: string;
  powerState: string;
}

function getMetricDataPoints(metric: JSONObject): Array<JSONObject> {
  for (const key of ["gauge", "sum"]) {
    const body: JSONObject | undefined = metric[key] as JSONObject | undefined;
    const points: JSONValue | undefined = body?.["dataPoints"];
    if (Array.isArray(points)) {
      return points as Array<JSONObject>;
    }
  }
  return [];
}

function forEachMetric(
  envelope: JSONObject,
  visit: (metric: JSONObject) => void,
): void {
  const scopeMetrics: JSONValue | undefined = envelope["scopeMetrics"];
  if (!Array.isArray(scopeMetrics)) {
    return;
  }
  for (const scopeMetric of scopeMetrics as JSONArray) {
    const metrics: JSONValue | undefined = (scopeMetric as JSONObject)?.[
      "metrics"
    ];
    if (!Array.isArray(metrics)) {
      continue;
    }
    for (const metric of metrics as JSONArray) {
      if (metric && typeof metric === "object") {
        visit(metric as JSONObject);
      }
    }
  }
}

/*
 * The VMs a block reports a status for, and their state: what the caller
 * looks up "ran in the last day" for, before normalizing.
 */
export function readXcpNgVmStatuses(
  envelope: JSONObject,
): Array<XcpNgVmStatusReading> {
  const readings: Array<XcpNgVmStatusReading> = [];
  forEachMetric(envelope, (metric: JSONObject) => {
    if (metric["name"] !== XcpNgSeries.VmStatus) {
      return;
    }
    for (const datapoint of getMetricDataPoints(metric)) {
      if (isXcpNgStaleDatapoint(datapoint)) {
        continue;
      }
      const uuid: string | null = getXcpNgLabel(datapoint, XcpNgLabel.Uuid);
      const powerState: string | null = getXcpNgLabel(
        datapoint,
        XcpNgLabel.PowerState,
      );
      if (uuid && powerState) {
        readings.push({ uuid: uuid.toLowerCase(), powerState });
      }
    }
  });
  return readings;
}

/*
 * A VM's stop is worth an alert when it is Halted or Paused (Suspended is
 * someone's choice) and it ran within the last day.
 */
export function isXcpNgVmStoppedAfterRunning(data: {
  powerState: string;
  ranRecently: boolean;
}): boolean {
  if (!data.ranRecently) {
    return false;
  }
  return (
    data.powerState === XcpNgVmPowerState.Halted ||
    data.powerState === XcpNgVmPowerState.Paused
  );
}

function hasAttribute(attributes: JSONArray, key: string): boolean {
  return attributes.some((attribute: JSONValue) => {
    return (attribute as JSONObject | null)?.["key"] === key;
  });
}

function stringAttribute(key: string, value: string): JSONObject {
  return { key, value: { stringValue: value } };
}

/*
 * The object a datapoint describes: its scope, from the series' name, and
 * its UUID, from the label Xen Orchestra names that kind of object by (a
 * pool's own series name the pool in their resource instead).
 */
export function getXcpNgDatapointIdentity(data: {
  metricName: string;
  datapoint: JSONObject;
  poolIdentifier: string;
}): { scope: XcpNgScope; id: string | null } | null {
  const scope: XcpNgScope | null = XcpNgTelemetryUtil.getScopeOfSeries(
    data.metricName,
  );
  if (!scope) {
    return null;
  }
  if (scope === XcpNgScope.Pool) {
    return { scope, id: data.poolIdentifier || null };
  }
  const idLabel: string | null = XcpNgTelemetryUtil.getIdLabelOfScope(scope);
  const id: string | null = idLabel
    ? getXcpNgLabel(data.datapoint, idLabel)
    : null;
  return { scope, id: id ? id.toLowerCase() : null };
}

function stampIdentity(data: {
  metricName: string;
  datapoint: JSONObject;
  poolIdentifier: string;
}): void {
  const identity: { scope: XcpNgScope; id: string | null } | null =
    getXcpNgDatapointIdentity(data);
  if (!identity) {
    return;
  }
  let attributes: JSONArray = data.datapoint["attributes"] as JSONArray;
  if (!Array.isArray(attributes)) {
    attributes = [];
    data.datapoint["attributes"] = attributes;
  }
  if (!hasAttribute(attributes, XCP_NG_SCOPE_ATTRIBUTE)) {
    attributes.push(stringAttribute(XCP_NG_SCOPE_ATTRIBUTE, identity.scope));
  }
  if (identity.id && !hasAttribute(attributes, XCP_NG_ID_ATTRIBUTE)) {
    attributes.push(stringAttribute(XCP_NG_ID_ATTRIBUTE, identity.id));
  }
}

/*
 * A derived datapoint: the status datapoint's labels minus its state ones,
 * the same time, and the 0/1 value.
 */
function deriveDatapoint(source: JSONObject, value: number): JSONObject {
  const attributes: JSONArray = (
    (source["attributes"] as JSONArray) || []
  ).filter((attribute: JSONValue) => {
    const key: JSONValue | undefined = (attribute as JSONObject | null)?.[
      "key"
    ];
    return typeof key === "string" && !STATE_LABELS.has(key);
  });

  const derived: JSONObject = {
    attributes: attributes.map((attribute: JSONValue) => {
      return JSON.parse(JSON.stringify(attribute)) as JSONObject;
    }),
    asDouble: value,
  };
  if (source["timeUnixNano"] !== undefined) {
    derived["timeUnixNano"] = source["timeUnixNano"];
  }
  if (source["startTimeUnixNano"] !== undefined) {
    derived["startTimeUnixNano"] = source["startTimeUnixNano"];
  }
  return derived;
}

function gaugeMetric(
  name: string,
  description: string,
  dataPoints: Array<JSONObject>,
): JSONObject {
  return {
    name,
    description,
    unit: "1",
    gauge: { dataPoints },
  };
}

export interface XcpNgNormalizeResult {
  // How many of the trap's series arrived as sums and were turned into gauges.
  convertedRateSums: number;
  // How many derived datapoints were appended.
  derivedDatapoints: number;
}

/*
 * Normalize one pool's resource block in place. `ranRecentlyVmUuids` holds
 * the (lower-case) UUIDs of the VMs reported Running within the last day,
 * which the caller looks up in the pool's inventory.
 */
export function normalizeXcpNgEnvelope(data: {
  envelope: JSONObject;
  poolIdentifier: string;
  ranRecentlyVmUuids: ReadonlySet<string>;
}): XcpNgNormalizeResult {
  const result: XcpNgNormalizeResult = {
    convertedRateSums: 0,
    derivedDatapoints: 0,
  };

  const hostRunning: Array<JSONObject> = [];
  const hostEnabled: Array<JSONObject> = [];
  const vmRunning: Array<JSONObject> = [];
  const vmStoppedAfterRunning: Array<JSONObject> = [];

  forEachMetric(data.envelope, (metric: JSONObject) => {
    const metricName: JSONValue | undefined = metric["name"];
    if (typeof metricName !== "string") {
      return;
    }

    // 1. A rate typed as a counter is a gauge.
    if (
      XcpNgTelemetryUtil.isRateTypedAsCounter(metricName) &&
      metric["sum"] &&
      !metric["gauge"]
    ) {
      const sum: JSONObject = metric["sum"] as JSONObject;
      metric["gauge"] = { dataPoints: sum["dataPoints"] || [] };
      delete metric["sum"];
      result.convertedRateSums++;
    }

    for (const datapoint of getMetricDataPoints(metric)) {
      // 2. One way to name an object.
      stampIdentity({
        metricName,
        datapoint,
        poolIdentifier: data.poolIdentifier,
      });

      if (isXcpNgStaleDatapoint(datapoint)) {
        continue;
      }

      // 3. Health as numbers.
      if (metricName === XcpNgSeries.HostStatus) {
        const powerState: string | null = getXcpNgLabel(
          datapoint,
          XcpNgLabel.PowerState,
        );
        if (powerState) {
          hostRunning.push(
            deriveDatapoint(
              datapoint,
              powerState === XcpNgHostPowerState.Running ? 1 : 0,
            ),
          );
        }
        const enabled: string | null = getXcpNgLabel(
          datapoint,
          XcpNgLabel.Enabled,
        );
        if (enabled) {
          hostEnabled.push(
            deriveDatapoint(
              datapoint,
              enabled.toLowerCase() === "true" ? 1 : 0,
            ),
          );
        }
      } else if (metricName === XcpNgSeries.VmStatus) {
        const powerState: string | null = getXcpNgLabel(
          datapoint,
          XcpNgLabel.PowerState,
        );
        const uuid: string | null = getXcpNgLabel(datapoint, XcpNgLabel.Uuid);
        if (powerState && uuid) {
          vmRunning.push(
            deriveDatapoint(
              datapoint,
              powerState === XcpNgVmPowerState.Running ? 1 : 0,
            ),
          );
          vmStoppedAfterRunning.push(
            deriveDatapoint(
              datapoint,
              isXcpNgVmStoppedAfterRunning({
                powerState,
                ranRecently: data.ranRecentlyVmUuids.has(uuid.toLowerCase()),
              })
                ? 1
                : 0,
            ),
          );
        }
      }
    }
  });

  const derived: Array<JSONObject> = [];
  if (hostRunning.length > 0) {
    derived.push(
      gaugeMetric(
        XcpNgDerivedSeries.HostRunning,
        "1 while Xen Orchestra reports the host Running, else 0 (derived by OneUptime from xcp_host_status).",
        hostRunning,
      ),
    );
  }
  if (hostEnabled.length > 0) {
    derived.push(
      gaugeMetric(
        XcpNgDerivedSeries.HostEnabled,
        "1 while the host is enabled, 0 in maintenance mode (derived by OneUptime from xcp_host_status).",
        hostEnabled,
      ),
    );
  }
  if (vmRunning.length > 0) {
    derived.push(
      gaugeMetric(
        XcpNgDerivedSeries.VmRunning,
        "1 while the VM is Running, else 0 (derived by OneUptime from xcp_vm_status).",
        vmRunning,
      ),
    );
    derived.push(
      gaugeMetric(
        XcpNgDerivedSeries.VmStoppedAfterRunning,
        "1 while a VM that ran in the last 24 hours is Halted or Paused, else 0 (derived by OneUptime).",
        vmStoppedAfterRunning,
      ),
    );
  }

  if (derived.length === 0) {
    return result;
  }

  // The derived datapoints get the identity stamps the others got.
  for (const metric of derived) {
    for (const datapoint of getMetricDataPoints(metric)) {
      stampIdentity({
        metricName: metric["name"] as string,
        datapoint,
        poolIdentifier: data.poolIdentifier,
      });
      result.derivedDatapoints++;
    }
  }

  let scopeMetrics: JSONValue | undefined = data.envelope["scopeMetrics"];
  if (!Array.isArray(scopeMetrics)) {
    scopeMetrics = [];
    data.envelope["scopeMetrics"] = scopeMetrics;
  }
  (scopeMetrics as JSONArray).push({
    scope: { name: XCP_NG_DERIVED_SERIES_SCOPE_NAME, version: "1" },
    metrics: derived,
  });

  return result;
}
