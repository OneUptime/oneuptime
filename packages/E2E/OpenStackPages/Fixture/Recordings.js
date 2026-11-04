/*
 * What a real cloud said, as the rows OneUptime would hold for it.
 *
 * Tests/Ops/openstack-e2e deploys OpenStack, breaks it one way at a time and records
 * what the agent's exporter answers (Common/Tests/Fixtures/OpenStack). This reads those
 * answers through the real snapshot scan, the code the telemetry ingest runs, so a
 * page's walk on a recording fails when a page assumes something a cloud never says.
 *
 * rowsFromRecording("gazpacho-ovs/compute-down", { region, loadedAt }) returns rows in
 * the shape OpenStackResourceService writes. Region is how one recording serves as
 * several regions of one cloud: the agent stamps it, the exporter does not know it.
 */
import RECORDINGS from "openstack-recordings";
import {
  bufferOpenStackSnapshotMetric,
  finishOpenStackBatch,
  isOpenStackSnapshotDatapoint,
} from "../../../Common/Server/Utils/Telemetry/OpenStackSnapshotScan";

export const RECORDING_NAMES = Object.keys(RECORDINGS).sort();

export function hasRecording(name) {
  return Boolean(RECORDINGS[name]);
}

/*
 * Prometheus' text format. A label value can hold anything a tenant typed, so this
 * walks the line rather than splitting on commas.
 */
function parsePrometheusText(text) {
  const series = [];
  for (const line of text.split("\n")) {
    if (!line.trim() || line.startsWith("#")) {
      continue;
    }
    const labelsAt = line.indexOf("{");
    const valueAt = line.lastIndexOf(" ");
    if (labelsAt < 0) {
      series.push({
        name: line.substring(0, valueAt),
        labels: {},
        value: Number.parseFloat(line.substring(valueAt + 1)),
      });
      continue;
    }
    const labels = {};
    let at = labelsAt + 1;
    while (at < line.length && line[at] !== "}") {
      const equals = line.indexOf("=", at);
      const key = line.substring(at, equals);
      at = equals + 2; // Past the = and the opening quote.
      let value = "";
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

function toDatapoint(series, region, observedAtMs) {
  const attributes = Object.keys(series.labels).map((key) => {
    return { key, value: { stringValue: series.labels[key] } };
  });
  attributes.push({
    key: "openstack.region.name",
    value: { stringValue: region },
  });
  return {
    attributes,
    timeUnixNano: `${observedAtMs}000000`,
    asDouble: series.value,
  };
}

// A scan's entry as the row the upsert writes. Unset columns stay unset, as read back.
function toRow(entry, observedAtMs) {
  const row = {
    kind: entry.kind,
    externalId: entry.externalId,
    facts: entry.facts,
    lastSeenAt: new Date(observedAtMs),
    metricsUpdatedAt: new Date(observedAtMs),
  };
  for (const field of [
    "name",
    "regionName",
    "availabilityZone",
    "hypervisorName",
    "openStackProjectId",
    "status",
    "adminState",
    "disabledReason",
    "vcpuCapacity",
    "vcpuAllocated",
    "memoryCapacityBytes",
    "memoryAllocatedBytes",
    "diskCapacityBytes",
    "diskAllocatedBytes",
    "instanceCount",
  ]) {
    if (entry[field] !== null && entry[field] !== undefined) {
      row[field] = entry[field];
    }
  }
  // A new row's state began when it was first seen: an estate can say otherwise.
  if (entry.status !== null) {
    row.stateChangedAt = new Date(observedAtMs);
  }
  return row;
}

export function rowsFromRecording(name, data) {
  const files = RECORDINGS[name];
  if (!files) {
    throw new Error(
      `No recording named ${name}. There are: ${RECORDING_NAMES.join(", ")}`,
    );
  }
  const buffer = new Map();
  for (const text of Object.values(files)) {
    for (const series of parsePrometheusText(text)) {
      const datapoint = toDatapoint(series, data.region, data.loadedAt);
      if (isOpenStackSnapshotDatapoint({ metricName: series.name, datapoint })) {
        bufferOpenStackSnapshotMetric({
          metricName: series.name,
          datapoint,
          buffer,
        });
      }
    }
  }
  return finishOpenStackBatch(buffer.values()).map((entry) => {
    return toRow(entry, data.loadedAt);
  });
}
