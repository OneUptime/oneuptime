import OneUptimeDate from "../../../Types/Date";
import { JSONArray, JSONObject, JSONValue } from "../../../Types/JSON";
import logger from "../Logger";

/*
 * ------------------------------------------------------------------
 * IoT snapshot scan — pure fold & derive helpers
 * ------------------------------------------------------------------
 *
 * Cloned from ProxmoxCephSnapshotScan.ts (the Proxmox half). The
 * ingest service owns the I/O: it walks the OTLP payload, calls
 * bufferIoTSnapshotMetric per datapoint, and at flush time maps the
 * folded buffers through deriveIoTFleetSnapshotExtras before handing
 * the results to IoTDeviceService / IoTFleetService. Everything in
 * this module is pure (Map/object mutation only — no DB, no network),
 * which is what makes the snapshot-scan semantics unit-testable:
 *
 *   - identity labels fold first-non-null-wins; status/metric fields
 *     fold newest-observedAt-wins,
 *   - count columns are only derived when the batch carried the
 *     matching identity series (never zero a count on a partial
 *     batch — the COALESCE-per-column contract),
 *   - non-allow-listed metric names are skipped via the exported
 *     IOT_SNAPSHOT_METRIC_NAMES set.
 */

/*
 * IoT snapshot metrics — emitted by IoT devices / gateways pushing
 * OTLP, identity in the `device.id` datapoint label plus the
 * iot.device.kind / iot.device.type / iot.device.firmware attributes
 * the device's SDK stamps. Unlike K8s there is no separate object
 * stream: identity, status AND the latest-metric mirror all arrive on
 * every scrape, so the same scan feeds the IoTDevice inventory upsert
 * and the IoTFleet count snapshot columns (single source — the
 * list-page counts and the sidebar badges can never drift).
 *
 * iot_cpu_usage_ratio is already a true 0..1 ratio — no allocatable-
 * denominator cache is needed, unlike K8s cpuCoresToPercent.
 */
export const IOT_SNAPSHOT_METRIC_NAMES: ReadonlySet<string> = new Set([
  // Identity / status (fleet counts derive from these)
  "iot_device_up",
  "iot_device_info",
  // Latest-metric mirror (inventory columns)
  "iot_battery_percent",
  "iot_signal_strength_dbm",
  "iot_temperature_celsius",
  "iot_cpu_usage_ratio",
  "iot_memory_usage_bytes",
  "iot_memory_size_bytes",
  "iot_uptime_seconds",
]);

/*
 * One IoT device folded across a batch. Identity labels are
 * first-non-null-wins (stable for the lifetime of the device);
 * status / metric fields are newest-observedAt-wins.
 */
export interface IoTDeviceBufferEntry {
  kind: string; // device class — Device | Sensor | Gateway
  externalId: string; // raw `device.id` label
  name: string | null;
  deviceType: string | null;
  firmwareVersion: string | null;
  isUp: boolean | null;
  uptimeSeconds: number | null;
  latestCpuPercent: number | null;
  latestMemoryBytes: number | null;
  maxMemoryBytes: number | null;
  latestBatteryPercent: number | null;
  latestSignalStrengthDbm: number | null;
  latestTemperatureCelsius: number | null;
  observedAt: Date;
}

/*
 * Per-fleet IoT snapshot state. The saw* flags implement the
 * never-zero-a-count-on-a-partial-batch contract: a count column is
 * only written when the batch carried the matching identity series.
 */
export interface IoTFleetSnapshotBufferEntry {
  sawDeviceIdentity: boolean; // iot_device_info, or iot_device_up
  sawDeviceUp: boolean; // iot_device_up
  agentVersion?: string | undefined;
}

// The IoTFleet snapshot columns derived from one folded batch.
export interface IoTFleetSnapshotExtras {
  agentVersion?: string | undefined;
  deviceCount?: number | undefined;
  onlineDeviceCount?: number | undefined;
}

/*
 * Same finite-or-null coercion contract as the ingest service's
 * toNumberOrNull (NaN / ±Infinity fold to null so a malformed
 * datapoint is skipped rather than poisoning a snapshot column).
 */
function toNumberOrNull(value: unknown): number | null {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }

  if (typeof value === "string") {
    const parsed: number = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

/*
 * Same fall-back-to-now parse contract as the ingest service's
 * safeParseUnixNano — only the Date is needed on the snapshot path.
 */
function parseUnixNanoToDate(
  value: string | number | undefined,
  context: string,
): Date {
  let numericValue: number = OneUptimeDate.getCurrentDateAsUnixNano();

  if (value !== undefined && value !== null) {
    try {
      if (typeof value === "string") {
        const parsed: number = Number.parseFloat(value);
        if (isNaN(parsed)) {
          throw new Error(`Invalid timestamp string: ${value}`);
        }
        numericValue = parsed;
      } else if (typeof value === "number") {
        if (!Number.isFinite(value)) {
          throw new Error(`Invalid timestamp number: ${value}`);
        }
        numericValue = value;
      }
    } catch (error) {
      logger.warn(
        `Error processing ${context}: ${error instanceof Error ? error.message : String(error)}, using current time`,
      );
      numericValue = OneUptimeDate.getCurrentDateAsUnixNano();
    }
  }

  return OneUptimeDate.fromUnixNano(numericValue);
}

// Same trim-or-null read contract as OtelIngestBaseService.getStringAttribute.
function getStringAttribute(attributes: JSONArray, key: string): string | null {
  for (const attribute of attributes) {
    if (
      attribute["key"] === key &&
      attribute["value"] &&
      (attribute["value"] as JSONObject)["stringValue"]
    ) {
      const value: JSONValue = (attribute["value"] as JSONObject)[
        "stringValue"
      ];
      if (typeof value === "string" && value.trim()) {
        return value.trim();
      }
    }
  }
  return null;
}

export function getOrCreateIoTFleetSnapshot(
  buffer: Map<string, IoTFleetSnapshotBufferEntry>,
  fleetIdStr: string,
): IoTFleetSnapshotBufferEntry {
  let entry: IoTFleetSnapshotBufferEntry | undefined = buffer.get(fleetIdStr);
  if (!entry) {
    entry = {
      sawDeviceIdentity: false,
      sawDeviceUp: false,
    };
    buffer.set(fleetIdStr, entry);
  }
  return entry;
}

/*
 * Fold one iot_* datapoint into the per-fleet buffers. Identity lives
 * in the `device.id` DATAPOINT label, so this reads the raw datapoint
 * attribute array — not the merged resource-prefixed map the K8s scan
 * uses.
 */
export function bufferIoTSnapshotMetric(data: {
  fleetIdStr: string;
  metricName: string;
  datapoint: JSONObject;
  resourceBuffer: Map<string, Map<string, IoTDeviceBufferEntry>>;
  fleetBuffer: Map<string, IoTFleetSnapshotBufferEntry>;
}): void {
  const valueFromInt: number | null = toNumberOrNull(data.datapoint["asInt"]);
  const valueFromDouble: number | null = toNumberOrNull(
    data.datapoint["asDouble"],
  );
  const rawValue: number | null = valueFromDouble ?? valueFromInt;
  if (rawValue === null) {
    return;
  }

  const observedAt: Date = parseUnixNanoToDate(
    data.datapoint["timeUnixNano"] as string | number | undefined,
    "iot snapshot timeUnixNano",
  );

  const dpAttributes: JSONArray =
    (data.datapoint["attributes"] as JSONArray) || [];

  const fleet: IoTFleetSnapshotBufferEntry = getOrCreateIoTFleetSnapshot(
    data.fleetBuffer,
    data.fleetIdStr,
  );

  // Identity lives in the `device.id` datapoint label.
  const externalId: string | null = getStringAttribute(
    dpAttributes,
    "device.id",
  );
  if (!externalId) {
    return;
  }

  /*
   * Kind/type/firmware: read from the iot.device.* attributes the
   * device SDK stamps; kind falls back to "Device" so inventory still
   * populates without an explicit class label.
   */
  const kind: string =
    getStringAttribute(dpAttributes, "iot.device.kind") || "Device";

  const patch: IoTDeviceBufferEntry = {
    kind,
    externalId,
    name: null,
    deviceType: null,
    firmwareVersion: null,
    isUp: null,
    uptimeSeconds: null,
    latestCpuPercent: null,
    latestMemoryBytes: null,
    maxMemoryBytes: null,
    latestBatteryPercent: null,
    latestSignalStrengthDbm: null,
    latestTemperatureCelsius: null,
    observedAt,
  };

  // deviceType / firmware ride every series the device emits.
  patch.deviceType = getStringAttribute(dpAttributes, "iot.device.type");
  patch.firmwareVersion = getStringAttribute(
    dpAttributes,
    "iot.device.firmware",
  );

  switch (data.metricName) {
    case "iot_device_up": {
      patch.isUp = rawValue >= 1;
      fleet.sawDeviceIdentity = true;
      fleet.sawDeviceUp = true;
      break;
    }
    case "iot_device_info": {
      // Identity-only series — carries the human-readable device name.
      patch.name = getStringAttribute(dpAttributes, "name");
      fleet.sawDeviceIdentity = true;
      break;
    }
    case "iot_battery_percent": {
      patch.latestBatteryPercent = rawValue;
      break;
    }
    case "iot_signal_strength_dbm": {
      patch.latestSignalStrengthDbm = rawValue;
      break;
    }
    case "iot_temperature_celsius": {
      patch.latestTemperatureCelsius = rawValue;
      break;
    }
    case "iot_cpu_usage_ratio": {
      /*
       * Already a true 0..1 ratio — no allocatable-denominator cache
       * needed, unlike K8s cpuCoresToPercent.
       */
      patch.latestCpuPercent = rawValue * 100;
      break;
    }
    case "iot_memory_usage_bytes": {
      patch.latestMemoryBytes = Math.max(0, Math.trunc(rawValue));
      break;
    }
    case "iot_memory_size_bytes": {
      patch.maxMemoryBytes = Math.max(0, Math.trunc(rawValue));
      break;
    }
    case "iot_uptime_seconds": {
      patch.uptimeSeconds = Math.max(0, Math.trunc(rawValue));
      break;
    }
    default: {
      return;
    }
  }

  foldIoTDeviceSnapshot({
    buffer: data.resourceBuffer,
    fleetIdStr: data.fleetIdStr,
    patch,
  });
}

/*
 * Merge a patch into the per-fleet IoT buffer: identity labels are
 * first-non-null-wins (stable, and a batch missing an info series
 * must not blank them), status/metric fields are
 * newest-observedAt-wins (K8s buffer semantics).
 */
export function foldIoTDeviceSnapshot(data: {
  buffer: Map<string, Map<string, IoTDeviceBufferEntry>>;
  fleetIdStr: string;
  patch: IoTDeviceBufferEntry;
}): void {
  let perFleet: Map<string, IoTDeviceBufferEntry> | undefined = data.buffer.get(
    data.fleetIdStr,
  );
  if (!perFleet) {
    perFleet = new Map();
    data.buffer.set(data.fleetIdStr, perFleet);
  }
  const key: string = `${data.patch.kind}|${data.patch.externalId}`;
  const existing: IoTDeviceBufferEntry | undefined = perFleet.get(key);
  if (!existing) {
    perFleet.set(key, data.patch);
    return;
  }

  const patch: IoTDeviceBufferEntry = data.patch;
  const newer: boolean = patch.observedAt >= existing.observedAt;

  // Identity: first-non-null wins.
  if (existing.name === null && patch.name !== null) {
    existing.name = patch.name;
  }
  if (existing.deviceType === null && patch.deviceType !== null) {
    existing.deviceType = patch.deviceType;
  }
  if (existing.firmwareVersion === null && patch.firmwareVersion !== null) {
    existing.firmwareVersion = patch.firmwareVersion;
  }

  // Status / metrics: newest observation wins.
  if (patch.isUp !== null && newer) {
    existing.isUp = patch.isUp;
  }
  if (patch.uptimeSeconds !== null && newer) {
    existing.uptimeSeconds = patch.uptimeSeconds;
  }
  if (patch.latestCpuPercent !== null && newer) {
    existing.latestCpuPercent = patch.latestCpuPercent;
  }
  if (patch.latestMemoryBytes !== null && newer) {
    existing.latestMemoryBytes = patch.latestMemoryBytes;
  }
  if (patch.maxMemoryBytes !== null && newer) {
    existing.maxMemoryBytes = patch.maxMemoryBytes;
  }
  if (patch.latestBatteryPercent !== null && newer) {
    existing.latestBatteryPercent = patch.latestBatteryPercent;
  }
  if (patch.latestSignalStrengthDbm !== null && newer) {
    existing.latestSignalStrengthDbm = patch.latestSignalStrengthDbm;
  }
  if (patch.latestTemperatureCelsius !== null && newer) {
    existing.latestTemperatureCelsius = patch.latestTemperatureCelsius;
  }
  if (patch.observedAt > existing.observedAt) {
    existing.observedAt = patch.observedAt;
  }
}

/*
 * Derive the IoTFleet snapshot columns from one folded batch. Counts
 * are only set when the batch carried the matching identity series —
 * never zero a count on a partial batch. Returns an object whose keys
 * are exactly the columns to write (empty object = nothing to write).
 */
export function deriveIoTFleetSnapshotExtras(
  entries: Array<IoTDeviceBufferEntry>,
  snap: IoTFleetSnapshotBufferEntry | undefined,
): IoTFleetSnapshotExtras {
  const extras: IoTFleetSnapshotExtras = {};

  if (snap?.sawDeviceIdentity) {
    extras.deviceCount = entries.length;
  }
  if (snap?.sawDeviceUp) {
    extras.onlineDeviceCount = entries.filter((e: IoTDeviceBufferEntry) => {
      return e.isUp === true;
    }).length;
  }
  if (snap?.agentVersion) {
    extras.agentVersion = snap.agentVersion;
  }

  return extras;
}
