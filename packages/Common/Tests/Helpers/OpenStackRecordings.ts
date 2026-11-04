import fs from "fs";
import path from "path";
import OpenStackResource from "../../Models/DatabaseModels/OpenStackResource";
import {
  OpenStackResourceBufferEntry,
  bufferOpenStackSnapshotMetric,
  finishOpenStackBatch,
  isOpenStackSnapshotDatapoint,
} from "../../Server/Utils/Telemetry/OpenStackSnapshotScan";
import { JSONArray, JSONObject } from "../../Types/JSON";
import { OpenStackResourceKind } from "../../Types/OpenStack/OpenStackResourceKind";

/*
 * What a real cloud's exporter said, as the rows the snapshot scan makes of it: what a
 * part's page really reads. Tests/Ops/openstack-e2e deploys OpenStack, builds a known
 * estate (estate.sh), breaks it one way at a time and records the answers in
 * Tests/Fixtures/OpenStack. Not a test file itself, so jest does not run it.
 */

const FIXTURES: string = path.join(__dirname, "../Fixtures/OpenStack");
const OBSERVED_AT_MS: number = 1793785799000;

// A minute after the recording's own time, so nothing reads as having just changed.
export const OPENSTACK_RECORDING_NOW: Date = new Date(
  OBSERVED_AT_MS + 60 * 1000,
);

interface Series {
  name: string;
  labels: Record<string, string>;
  value: number;
}

/*
 * Prometheus' text format. A label value can hold anything a tenant typed, so this reads
 * escapes rather than splitting on commas.
 */
function parsePrometheusText(text: string): Array<Series> {
  const series: Array<Series> = [];
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
      at = equals + 2;
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
      at += 1;
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

/*
 * What the agent's collector turns a series into before it reaches OneUptime. It drops a
 * label with nothing in it, which the fold has to read correctly: a volume with no server
 * has no server_id at all (Fixtures/OpenStack/<release>/otlp.json).
 */
function toDatapoint(series: Series): JSONObject {
  const attributes: JSONArray = Object.keys(series.labels)
    .filter((key: string): boolean => {
      return series.labels[key] !== "";
    })
    .map((key: string): JSONObject => {
      return { key, value: { stringValue: series.labels[key] as string } };
    });
  attributes.push({
    key: "openstack.region.name",
    value: { stringValue: "RegionOne" },
  });
  return {
    attributes,
    timeUnixNano: `${OBSERVED_AT_MS}000000`,
    asDouble: series.value,
  };
}

function toRow(entry: OpenStackResourceBufferEntry): OpenStackResource {
  const row: OpenStackResource = new OpenStackResource();
  row.kind = entry.kind;
  row.externalId = entry.externalId;
  row.name = entry.name || undefined;
  row.regionName = entry.regionName || undefined;
  row.availabilityZone = entry.availabilityZone || undefined;
  row.hypervisorName = entry.hypervisorName || undefined;
  row.openStackProjectId = entry.openStackProjectId || undefined;
  row.status = entry.status || undefined;
  row.adminState = entry.adminState || undefined;
  row.disabledReason = entry.disabledReason || undefined;
  row.vcpuCapacity = entry.vcpuCapacity ?? undefined;
  row.vcpuAllocated = entry.vcpuAllocated ?? undefined;
  row.memoryCapacityBytes = entry.memoryCapacityBytes ?? undefined;
  row.memoryAllocatedBytes = entry.memoryAllocatedBytes ?? undefined;
  row.diskCapacityBytes = entry.diskCapacityBytes ?? undefined;
  row.diskAllocatedBytes = entry.diskAllocatedBytes ?? undefined;
  row.instanceCount = entry.instanceCount ?? undefined;
  row.facts = entry.facts;
  row.stateChangedAt = new Date(OBSERVED_AT_MS);
  row.lastSeenAt = new Date(OBSERVED_AT_MS);
  return row;
}

export class OpenStackRecording {
  public readonly rows: Array<OpenStackResource>;

  public constructor(release: string, scene: string) {
    const folder: string = path.join(FIXTURES, release, scene, "exporter");
    const buffer: Map<string, OpenStackResourceBufferEntry> = new Map();
    for (const file of fs.readdirSync(folder).sort()) {
      if (!file.endsWith(".prom")) {
        continue;
      }
      for (const series of parsePrometheusText(
        fs.readFileSync(path.join(folder, file), "utf8"),
      )) {
        const datapoint: JSONObject = toDatapoint(series);
        if (
          isOpenStackSnapshotDatapoint({ metricName: series.name, datapoint })
        ) {
          bufferOpenStackSnapshotMetric({
            metricName: series.name,
            datapoint,
            buffer,
          });
        }
      }
    }
    this.rows = finishOpenStackBatch(buffer.values()).map(toRow);
  }

  public ofKind(kind: OpenStackResourceKind): Array<OpenStackResource> {
    return this.rows.filter((row: OpenStackResource): boolean => {
      return row.kind === kind;
    });
  }

  public named(kind: OpenStackResourceKind, name: string): OpenStackResource {
    const found: OpenStackResource | undefined = this.ofKind(kind).find(
      (row: OpenStackResource): boolean => {
        return row.name === name;
      },
    );
    if (!found) {
      throw new Error(`No ${kind} named ${name} in this recording`);
    }
    return found;
  }
}

export function getOpenStackReleases(): Array<string> {
  return fs
    .readdirSync(FIXTURES)
    .filter((entry: string): boolean => {
      return fs.existsSync(path.join(FIXTURES, entry, "healthy", "exporter"));
    })
    .sort();
}

export function getOpenStackDrilledReleases(): Array<string> {
  return getOpenStackReleases().filter((release: string): boolean => {
    return fs.existsSync(path.join(FIXTURES, release, "compute-down"));
  });
}
