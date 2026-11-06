import { JSONArray, JSONObject } from "../../Types/JSON";
import { OpenStackResourceKind } from "../../Types/OpenStack/OpenStackResourceKind";
import {
  OpenStackResourceBufferEntry,
  bufferOpenStackSnapshotMetric,
  finishOpenStackBatch,
  isOpenStackSnapshotDatapoint,
} from "../../Server/Utils/Telemetry/OpenStackSnapshotScan";
import fs from "fs";
import path from "path";

/*
 * What the agent really sent from a deployment tool's real all-in-one, each way its guide runs it
 * (Tests/Ops/openstack-e2e/kolla-guide.sh and osa-guide.sh, imported by import-guide-recording.py),
 * through the real scan.
 */
const FIXTURES: string = path.join(__dirname, "../Fixtures/OpenStack");

export function metricsOfPart(tool: string, part: string): Array<JSONObject> {
  const exported: JSONObject = JSON.parse(
    fs.readFileSync(path.join(FIXTURES, tool, "otlp", `${part}.json`), "utf8"),
  ) as JSONObject;
  const metrics: Array<JSONObject> = [];

  for (const resource of exported["resourceMetrics"] as JSONArray) {
    for (const scope of (resource as JSONObject)["scopeMetrics"] as JSONArray) {
      metrics.push(
        ...((scope as JSONObject)["metrics"] as JSONArray as Array<JSONObject>),
      );
    }
  }

  return metrics;
}

export function rowsOfPart(
  tool: string,
  part: string,
): Array<OpenStackResourceBufferEntry> {
  const buffer: Map<string, OpenStackResourceBufferEntry> = new Map();

  for (const metric of metricsOfPart(tool, part)) {
    const body: JSONObject = (metric["gauge"] || metric["sum"]) as JSONObject;

    for (const datapoint of body["dataPoints"] as JSONArray) {
      const point: { metricName: string; datapoint: JSONObject } = {
        metricName: metric["name"] as string,
        datapoint: datapoint as JSONObject,
      };

      if (isOpenStackSnapshotDatapoint(point)) {
        bufferOpenStackSnapshotMetric({ ...point, buffer });
      }
    }
  }

  return finishOpenStackBatch(buffer.values());
}

export function statusByName(
  rows: Array<OpenStackResourceBufferEntry>,
  kind: OpenStackResourceKind,
): Record<string, string | null> {
  const found: Record<string, string | null> = {};

  for (const row of rows) {
    if (row.kind === kind && row.name) {
      found[row.name] = row.status;
    }
  }

  return found;
}

export function namesOf(
  rows: Array<OpenStackResourceBufferEntry>,
  kind: OpenStackResourceKind,
): Array<string> {
  return Object.keys(statusByName(rows, kind)).sort();
}

// estate.sh's names, and the status it leaves each in.
export const ESTATE_INSTANCES: Record<string, string> = {
  "ou-running": "ACTIVE",
  "ou-stopped": "SHUTOFF",
  "ou-failed": "ERROR",
  "ou-research-1": "ACTIVE",
};
export const ESTATE_VOLUMES: Record<string, string> = {
  "ou-vol-free": "available",
  "ou-vol-used": "in-use",
  "ou-vol-bad": "error",
  "ou-vol-stuck": "attaching",
};
