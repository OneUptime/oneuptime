import { JSONArray, JSONObject } from "../../../../Types/JSON";
import { OpenStackResourceKind } from "../../../../Types/OpenStack/OpenStackResourceKind";
import {
  OpenStackResourceBufferEntry,
  bufferOpenStackSnapshotMetric,
  finishOpenStackBatch,
  isOpenStackSnapshotDatapoint,
} from "../../../../Server/Utils/Telemetry/OpenStackSnapshotScan";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * What the agent really sent from a real Kolla-Ansible all-in-one, each way the guide runs it,
 * through the real scan (Tests/Ops/openstack-e2e/kolla-guide.sh, imported by
 * import-guide-recording.py). The bar the issue sets for bringing your own exporter is the same
 * pages on the version the agent pins and on Kolla-Ansible's 1.7.0: this is that, on the tool
 * itself, and what the two do not agree on is written down here as what 1.7.0 goes without.
 *
 * Each part stopped as soon as the agent had reported, so each holds what its first scrapes said,
 * which is why a part is only held to the kinds its own scrapes reach.
 */

const RECORDING: string = path.join(
  __dirname,
  "../../../Fixtures/OpenStack/kolla-aio/otlp",
);

// estate.sh's names, and the status it leaves each in.
const INSTANCES: Record<string, string> = {
  "ou-running": "ACTIVE",
  "ou-stopped": "SHUTOFF",
  "ou-failed": "ERROR",
  "ou-research-1": "ACTIVE",
};
const VOLUMES: Record<string, string> = {
  "ou-vol-free": "available",
  "ou-vol-used": "in-use",
  "ou-vol-bad": "error",
  "ou-vol-stuck": "attaching",
};

function rowsOfPart(part: string): Array<OpenStackResourceBufferEntry> {
  const buffer: Map<string, OpenStackResourceBufferEntry> = new Map();
  const exported: JSONObject = JSON.parse(
    fs.readFileSync(path.join(RECORDING, `${part}.json`), "utf8"),
  ) as JSONObject;

  for (const resource of exported["resourceMetrics"] as JSONArray) {
    for (const scope of (resource as JSONObject)["scopeMetrics"] as JSONArray) {
      for (const metric of (scope as JSONObject)["metrics"] as JSONArray) {
        const named: JSONObject = metric as JSONObject;
        const body: JSONObject = (named["gauge"] || named["sum"]) as JSONObject;

        for (const datapoint of body["dataPoints"] as JSONArray) {
          const point: {
            metricName: string;
            datapoint: JSONObject;
          } = {
            metricName: named["name"] as string,
            datapoint: datapoint as JSONObject,
          };

          if (isOpenStackSnapshotDatapoint(point)) {
            bufferOpenStackSnapshotMetric({ ...point, buffer });
          }
        }
      }
    }
  }

  return finishOpenStackBatch(buffer.values());
}

function statusByName(
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

function namesOf(
  rows: Array<OpenStackResourceBufferEntry>,
  kind: OpenStackResourceKind,
): Array<string> {
  return Object.keys(statusByName(rows, kind)).sort();
}

describe("what the agent sent from a real Kolla-Ansible", () => {
  const pinned: Array<OpenStackResourceBufferEntry> =
    rowsOfPart("own-exporter");
  const stable: Array<OpenStackResourceBufferEntry> =
    rowsOfPart("own-exporter-170");
  const kollas: Array<OpenStackResourceBufferEntry> =
    rowsOfPart("kolla-exporter");
  const fullView: Array<OpenStackResourceBufferEntry> = rowsOfPart("full-view");
  const withoutDocker: Array<OpenStackResourceBufferEntry> =
    rowsOfPart("without-docker");

  test.each([
    ["the agent's own exporter, on the first credential", "full-view"],
    ["your own exporter, at the pinned version", "own-exporter"],
    ["your own exporter, at 1.7.0", "own-exporter-170"],
    ["Kolla-Ansible's own exporter", "kolla-exporter"],
    ["the agent without Docker, on Kolla-Ansible's exporter", "without-docker"],
  ])(
    "%s names each instance estate.sh made, with its status",
    (_: string, part: string) => {
      const instances: Record<string, string | null> = statusByName(
        rowsOfPart(part),
        OpenStackResourceKind.Instance,
      );

      for (const [name, status] of Object.entries(INSTANCES)) {
        expect({ name, status: instances[name] }).toEqual({ name, status });
      }
    },
  );

  test("the version the agent pins names each volume, with its status", () => {
    const volumes: Record<string, string | null> = statusByName(
      pinned,
      OpenStackResourceKind.Volume,
    );

    for (const [name, status] of Object.entries(VOLUMES)) {
      expect({ name, status: volumes[name] }).toEqual({ name, status });
    }
  });

  test("1.7.0, and so Kolla-Ansible's exporter, reads no Cinder at all", () => {
    expect(namesOf(stable, OpenStackResourceKind.Volume)).toEqual([]);
    expect(namesOf(kollas, OpenStackResourceKind.Volume)).toEqual([]);
    expect(namesOf(withoutDocker, OpenStackResourceKind.Volume)).toEqual([]);
  });

  test.each([
    ["instances", OpenStackResourceKind.Instance],
    ["networks", OpenStackResourceKind.Network],
    ["routers", OpenStackResourceKind.Router],
    ["projects", OpenStackResourceKind.Project],
    ["hypervisors", OpenStackResourceKind.Hypervisor],
  ])(
    "the pinned version, 1.7.0 and Kolla-Ansible's exporter name the same %s",
    (_: string, kind: OpenStackResourceKind) => {
      const names: Array<string> = namesOf(pinned, kind);

      expect(names.length).toBeGreaterThan(0);
      expect(namesOf(stable, kind)).toEqual(names);
      expect(namesOf(kollas, kind)).toEqual(names);
    },
  );

  test("every way of running it finds nova-compute up on the same host", () => {
    for (const rows of [pinned, stable, kollas, fullView, withoutDocker]) {
      const computes: Array<OpenStackResourceBufferEntry> = rows.filter(
        (row: OpenStackResourceBufferEntry): boolean => {
          return (
            row.kind === OpenStackResourceKind.Service &&
            row.name === "nova-compute"
          );
        },
      );

      expect(
        computes.map((row: OpenStackResourceBufferEntry): unknown => {
          return { host: row.hypervisorName, status: row.status };
        }),
      ).toEqual([{ host: "compute-01.example.internal", status: "up" }]);
    }
  });

  test("a stock cinder-backup reads down, as the cloud itself says it is", () => {
    // Kolla-Ansible turns it on by default, with no backend to back up to.
    const backup: Array<OpenStackResourceBufferEntry> = pinned.filter(
      (row: OpenStackResourceBufferEntry): boolean => {
        return (
          row.kind === OpenStackResourceKind.Service &&
          row.name === "cinder-backup"
        );
      },
    );

    expect(
      backup.map((row: OpenStackResourceBufferEntry): string | null => {
        return row.status;
      }),
    ).toEqual(["down"]);
  });
});
