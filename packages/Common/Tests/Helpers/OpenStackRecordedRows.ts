import fs from "fs";
import path from "path";
import { ParsedOpenStackResource } from "../../Server/Services/OpenStackResourceService";
import {
  OpenStackResourceBufferEntry,
  bufferOpenStackSnapshotMetric,
  finishOpenStackBatch,
  isOpenStackSnapshotDatapoint,
} from "../../Server/Utils/Telemetry/OpenStackSnapshotScan";
import { JSONArray, JSONObject } from "../../Types/JSON";

/*
 * WHAT A REAL CLOUD SAID, AS THE ROWS ONEUPTIME WOULD HOLD.
 *
 * Tests/Ops/openstack-e2e records what the agent's exporter answers on real DevStacks, into
 * Tests/Fixtures/OpenStack. This reads a recording through the real snapshot scan, the code
 * ingest runs. Not a test file itself (jest only collects *.test.ts).
 */

export const OPENSTACK_FIXTURES_FOLDER: string = path.join(
  __dirname,
  "..",
  "Fixtures",
  "OpenStack",
);

export interface RecordedSeries {
  name: string;
  labels: Record<string, string>;
  value: number;
}

/*
 * Prometheus' text format. A label value can hold anything a tenant typed, so this
 * reads escapes rather than splitting on commas.
 */
export function parsePrometheusText(text: string): Array<RecordedSeries> {
  const series: Array<RecordedSeries> = [];
  for (const line of text.split("\n")) {
    if (!line.trim() || line.startsWith("#")) {
      continue;
    }
    const labelsAt: number = line.indexOf("{");
    const valueAt: number = line.lastIndexOf(" ");
    if (labelsAt < 0) {
      series.push({
        name: line.substring(0, valueAt),
        labels: {},
        value: Number.parseFloat(line.substring(valueAt + 1)),
      });
      continue;
    }

    const labels: Record<string, string> = {};
    let at: number = labelsAt + 1;
    while (at < line.length && line[at] !== "}") {
      const equals: number = line.indexOf("=", at);
      const key: string = line.substring(at, equals);
      at = equals + 2; // Past the = and the opening quote.
      let value: string = "";
      while (line[at] !== '"') {
        if (line[at] === "\\") {
          at += 1;
          value += line[at] === "n" ? "\n" : line[at];
        } else {
          value += line[at];
        }
        at += 1;
      }
      labels[key] = value;
      at += 1; // Past the closing quote.
      if (line[at] === ",") {
        at += 1;
      }
    }
    series.push({
      name: line.substring(0, labelsAt),
      labels,
      value: Number.parseFloat(line.substring(valueAt + 1)),
    });
  }
  return series;
}

export function readRecordedSeries(folder: string): Array<RecordedSeries> {
  const series: Array<RecordedSeries> = [];
  for (const file of fs.readdirSync(folder).sort()) {
    if (file.endsWith(".prom")) {
      series.push(
        ...parsePrometheusText(
          fs.readFileSync(path.join(folder, file), "utf8"),
        ),
      );
    }
  }
  return series;
}

// What the agent's collector turns a series into before it reaches OneUptime.
export function toRecordedDatapoint(
  series: RecordedSeries,
  observedAtMs: number,
): JSONObject {
  const attributes: JSONArray = Object.keys(series.labels).map(
    (key: string): JSONObject => {
      return { key, value: { stringValue: series.labels[key] as string } };
    },
  );
  attributes.push({
    key: "openstack.region.name",
    value: { stringValue: "RegionOne" },
  });
  return {
    attributes,
    timeUnixNano: `${observedAtMs}000000`,
    asDouble: series.value,
  };
}

// A batch through the real scan, as ingest folds one.
export function scanRecordedSeries(
  series: ReadonlyArray<RecordedSeries>,
  observedAtMs: number,
): Array<OpenStackResourceBufferEntry> {
  const buffer: Map<string, OpenStackResourceBufferEntry> = new Map();
  for (const one of series) {
    const datapoint: JSONObject = toRecordedDatapoint(one, observedAtMs);
    if (isOpenStackSnapshotDatapoint({ metricName: one.name, datapoint })) {
      bufferOpenStackSnapshotMetric({
        metricName: one.name,
        datapoint,
        buffer,
      });
    }
  }
  return finishOpenStackBatch(buffer.values());
}

// What ingest hands OpenStackResourceService.bulkUpsert for an entry.
export function toParsedOpenStackResource(
  entry: OpenStackResourceBufferEntry,
): ParsedOpenStackResource {
  return {
    kind: entry.kind,
    externalId: entry.externalId,
    name: entry.name,
    regionName: entry.regionName,
    availabilityZone: entry.availabilityZone,
    hypervisorName: entry.hypervisorName,
    openStackProjectId: entry.openStackProjectId,
    status: entry.status,
    adminState: entry.adminState,
    disabledReason: entry.disabledReason,
    vcpuCapacity: entry.vcpuCapacity,
    vcpuAllocated: entry.vcpuAllocated,
    memoryCapacityBytes: entry.memoryCapacityBytes,
    memoryAllocatedBytes: entry.memoryAllocatedBytes,
    diskCapacityBytes: entry.diskCapacityBytes,
    diskAllocatedBytes: entry.diskAllocatedBytes,
    instanceCount: entry.instanceCount,
    facts: entry.facts,
    lastSeenAt: entry.observedAt,
  };
}

export function readRecordedOpenStackResources(data: {
  release: string;
  scene: string;
  observedAtMs: number;
}): Array<ParsedOpenStackResource> {
  return scanRecordedSeries(
    readRecordedSeries(
      path.join(
        OPENSTACK_FIXTURES_FOLDER,
        data.release,
        data.scene,
        "exporter",
      ),
    ),
    data.observedAtMs,
  ).map(toParsedOpenStackResource);
}
