import { JSONArray, JSONObject, JSONValue } from "../../../../Types/JSON";
import fs from "fs";
import path from "path";

/*
 * WHAT THE STORAGE ARRAY AGENT SENDS FOR A POWERSCALE CLUSTER, RECORDED.
 *
 * PowerScaleCapture.json is the first round of polls the agent's own
 * collector config (agents/StorageArrayAgent/
 * otel-collector-config.powerscale.yaml), run on the collector image it
 * pins, made of the simulated four-node cluster `ps-prod`: snmpsim replaying
 * the ISILON-MIB walks in Examples/snmp-simulator/data/powerscale-node-<n>,
 * written by Examples/snmp-simulator/powerscale/make-walks.py from Dell's
 * MIB and the public captures of real clusters. Node 3 is offline, node 2
 * needs attention with a drive being smartfailed, node 4 has an empty bay.
 * Examples/snmp-simulator/powerscale/record-capture.sh records it again;
 * only the series' order and their timestamps are normalized.
 *
 * It is OTLP/JSON exactly as the agent POSTs it to /otlp/v1/metrics, so a
 * test hands it to the ingest's scan unchanged.
 */

export const POWERSCALE_CAPTURE_PATH: string = path.join(
  __dirname,
  "PowerScaleCapture.json",
);

// 26 November 2026, 09:00 UTC: every datapoint's time in the capture.
export const POWERSCALE_CAPTURE_TIME_MS: number = Date.UTC(2026, 10, 26, 9);

export const POWERSCALE_CLUSTER_NAME: string = "ps-prod";

export function readPowerScaleCapture(): JSONObject {
  return JSON.parse(
    fs.readFileSync(POWERSCALE_CAPTURE_PATH, "utf8"),
  ) as JSONObject;
}

// One datapoint of the capture, with the metric it belongs to.
export interface PowerScaleCapturedPoint {
  metricName: string;
  unit: string;
  // The datapoint as OTLP/JSON carries it (attributes, asInt / asDouble).
  datapoint: JSONObject;
  // Its labels, as strings.
  labels: Record<string, string>;
  value: number;
  resourceAttributes: Record<string, string>;
}

function attributeValue(value: JSONValue): string {
  const object: JSONObject = (value || {}) as JSONObject;
  for (const key of ["stringValue", "intValue", "doubleValue", "boolValue"]) {
    if (object[key] !== undefined) {
      return String(object[key]);
    }
  }
  return "";
}

function attributesOf(
  attributes: JSONArray | undefined,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const attribute of attributes || []) {
    const entry: JSONObject = attribute as JSONObject;
    out[entry["key"] as string] = attributeValue(entry["value"] as JSONValue);
  }
  return out;
}

// Every datapoint of a capture (the recorded one unless another is given).
export function getPowerScaleCapturedPoints(
  capture: JSONObject = readPowerScaleCapture(),
): Array<PowerScaleCapturedPoint> {
  const points: Array<PowerScaleCapturedPoint> = [];
  for (const resourceMetrics of (capture["resourceMetrics"] as JSONArray) ||
    []) {
    const resource: JSONObject = (resourceMetrics as JSONObject)[
      "resource"
    ] as JSONObject;
    const resourceAttributes: Record<string, string> = attributesOf(
      (resource?.["attributes"] as JSONArray) || [],
    );
    for (const scope of ((resourceMetrics as JSONObject)[
      "scopeMetrics"
    ] as JSONArray) || []) {
      for (const metric of ((scope as JSONObject)["metrics"] as JSONArray) ||
        []) {
        const metricObject: JSONObject = metric as JSONObject;
        const data: JSONObject = (metricObject["gauge"] ||
          metricObject["sum"]) as JSONObject;
        for (const datapoint of (data?.["dataPoints"] as JSONArray) || []) {
          const point: JSONObject = datapoint as JSONObject;
          const value: number =
            point["asDouble"] !== undefined
              ? Number(point["asDouble"])
              : Number(point["asInt"]);
          points.push({
            metricName: metricObject["name"] as string,
            unit: (metricObject["unit"] as string) || "",
            datapoint: point,
            labels: attributesOf(point["attributes"] as JSONArray),
            value,
            resourceAttributes,
          });
        }
      }
    }
  }
  return points;
}

/*
 * The capture with only the resources whose metrics a predicate keeps: how
 * a test sends one receiver's poll (the cluster's, the quotas', a node's)
 * as a batch of its own, as the collector may export them.
 */
export function filterPowerScaleCapture(
  keep: (metricName: string, labels: Record<string, string>) => boolean,
  capture: JSONObject = readPowerScaleCapture(),
): JSONObject {
  const copy: JSONObject = JSON.parse(JSON.stringify(capture)) as JSONObject;
  for (const resourceMetrics of (copy["resourceMetrics"] as JSONArray) || []) {
    for (const scope of ((resourceMetrics as JSONObject)[
      "scopeMetrics"
    ] as JSONArray) || []) {
      const scopeObject: JSONObject = scope as JSONObject;
      const metrics: JSONArray = [];
      for (const metric of (scopeObject["metrics"] as JSONArray) || []) {
        const metricObject: JSONObject = metric as JSONObject;
        const data: JSONObject = (metricObject["gauge"] ||
          metricObject["sum"]) as JSONObject;
        const kept: JSONArray = (
          (data?.["dataPoints"] as JSONArray) || []
        ).filter((datapoint: JSONValue): boolean => {
          return keep(
            metricObject["name"] as string,
            attributesOf((datapoint as JSONObject)["attributes"] as JSONArray),
          );
        });
        if (kept.length > 0) {
          data["dataPoints"] = kept;
          metrics.push(metricObject);
        }
      }
      scopeObject["metrics"] = metrics;
    }
  }
  return copy;
}

/*
 * EVERY SERIES THE AGENT SENDS, LABEL BY LABEL: label name -> the values it
 * can take, or null for a free-form label (a node's or quota's name, a
 * path, a serial number). Transcribed from the agent's collector config and
 * Dell's ISILON-MIB, as PURE_SERIES is from Pure's exporters, and held to
 * the recorded capture (PowerScaleCapture.test.ts): every label the capture
 * carries is here, and every value it carries is one listed.
 */
export type PowerScaleSeriesLabels = Record<string, Array<string> | null>;

const SCRAPE_ENDPOINTS: Array<string> = ["cluster", "quotas", "node"];
const YES_NO: Array<string> = ["0", "1"];

// ISILON-MIB quotaType: defaultUser, user, defaultGroup, group, directory, special, max.
const QUOTA_TYPES: Array<string> = ["0", "1", "2", "3", "4", "5", "6"];

/*
 * diskStatus: the MIB lists HEALTHY, L3, DEAD and SMARTFAIL "but not
 * limited to"; OneFS's drive states add the rest (isi devices drive list).
 */
export const POWERSCALE_DRIVE_STATUSES: Array<string> = [
  "HEALTHY",
  "L3",
  "SMARTFAIL",
  "DEAD",
  "REPLACE",
  "STALLED",
  "NEW",
  "USED",
  "PREPARING",
  "EMPTY",
  "WRONG_TYPE",
  "BOOT_DRIVE",
  "SED_ERROR",
  "ERASE",
  "INSECURE",
  "UNENCRYPTED",
  "JOURNAL",
];

const CLUSTER_IDENTITY: PowerScaleSeriesLabels = {
  cluster: null,
  cluster_guid: null,
  configured_nodes: null,
  online_nodes: null,
  offline_nodes: null,
  system_description: null,
  scrape_endpoint: SCRAPE_ENDPOINTS,
};
const CLUSTER: PowerScaleSeriesLabels = { cluster: null };
const NODE: PowerScaleSeriesLabels = { node: null, system_description: null };
const PROTOCOL: PowerScaleSeriesLabels = { ...NODE, protocol: null };
const QUOTA: PowerScaleSeriesLabels = {
  path: null,
  type: QUOTA_TYPES,
  id: null,
  quota: null,
};
const QUOTA_LIMITS: PowerScaleSeriesLabels = {
  ...QUOTA,
  includes_snapshots: YES_NO,
  includes_overhead: YES_NO,
  hard_defined: YES_NO,
  hard_limit: null,
  soft_defined: YES_NO,
  soft_limit: null,
  advisory_defined: YES_NO,
  advisory_limit: null,
  grace_period: null,
  scrape_endpoint: SCRAPE_ENDPOINTS,
};
const DRIVE_PERF: PowerScaleSeriesLabels = {
  ...NODE,
  perf_bay: null,
  drive: null,
};

export const POWERSCALE_SERIES: Record<string, PowerScaleSeriesLabels> = {
  powerscale_cluster_health: CLUSTER_IDENTITY,
  powerscale_cluster_nodes: CLUSTER_IDENTITY,
  powerscale_cluster_offline_nodes: CLUSTER_IDENTITY,
  powerscale_ifs_total_bytes: CLUSTER,
  powerscale_ifs_used_bytes: CLUSTER,
  powerscale_ifs_available_bytes: CLUSTER,
  powerscale_ifs_free_bytes: CLUSTER,
  powerscale_ifs_used_percent: CLUSTER,
  powerscale_cluster_ifs_read_bytes_per_second: CLUSTER,
  powerscale_cluster_ifs_write_bytes_per_second: CLUSTER,
  powerscale_cluster_network_in_bytes_per_second: CLUSTER,
  powerscale_cluster_network_out_bytes_per_second: CLUSTER,
  powerscale_cluster_cpu_busy_percent: CLUSTER,
  powerscale_quota_usage_bytes: QUOTA_LIMITS,
  powerscale_quota_used_percent: { ...QUOTA_LIMITS, limit: ["hard", "soft"] },
  powerscale_quota_physical_bytes: QUOTA,
  powerscale_quota_inodes: QUOTA,
  powerscale_node_health: { ...NODE, scrape_endpoint: SCRAPE_ENDPOINTS },
  powerscale_node_type: NODE,
  powerscale_node_read_only: NODE,
  powerscale_node_ifs_read_bytes_per_second: NODE,
  powerscale_node_ifs_write_bytes_per_second: NODE,
  powerscale_node_network_in_bytes_per_second: NODE,
  powerscale_node_network_out_bytes_per_second: NODE,
  powerscale_node_cpu_busy_percent: NODE,
  powerscale_protocol_operations_per_second: PROTOCOL,
  powerscale_protocol_in_bytes_per_second: PROTOCOL,
  powerscale_protocol_out_bytes_per_second: PROTOCOL,
  powerscale_protocol_latency_microseconds: PROTOCOL,
  powerscale_protocol_latency_max_microseconds: PROTOCOL,
  powerscale_chassis_service_light: {
    ...NODE,
    chassis_configuration: null,
    chassis_serial: null,
    chassis_model: null,
  },
  powerscale_drive_size_bytes: {
    ...NODE,
    bay: null,
    logical_number: null,
    chassis: null,
    device: null,
    status: POWERSCALE_DRIVE_STATUSES,
    model: null,
    serial: null,
    firmware: null,
    drive: null,
  },
  powerscale_drive_operations_per_second: DRIVE_PERF,
  powerscale_drive_in_bytes_per_second: DRIVE_PERF,
  powerscale_drive_out_bytes_per_second: DRIVE_PERF,
  powerscale_fan_speed_rpm: { ...NODE, fan: null, fan_description: null },
  powerscale_temperature_celsius: {
    ...NODE,
    sensor: null,
    sensor_description: null,
  },
  powerscale_power_sensor_reading: {
    ...NODE,
    power_sensor: null,
    power_sensor_description: null,
  },
  powerscale_interface_status: {
    ...NODE,
    interface: null,
    interface_type: null,
    // IF-MIB ifAdminStatus: up, down, testing.
    admin_status: ["1", "2", "3"],
    speed_mbps: null,
  },
};
