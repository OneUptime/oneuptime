import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import OpenStackResource from "../../../Models/DatabaseModels/OpenStackResource";
import {
  OpenStackResourceBufferEntry,
  bufferOpenStackSnapshotMetric,
  finishOpenStackBatch,
  isOpenStackSnapshotDatapoint,
} from "../../../Server/Utils/Telemetry/OpenStackSnapshotScan";
import { JSONArray, JSONObject } from "../../../Types/JSON";
import { OpenStackResourceKind } from "../../../Types/OpenStack/OpenStackResourceKind";
import {
  OPENSTACK_BACKEND_OVN,
  OPENSTACK_BACKEND_OVS,
  OPENSTACK_CATALOG_ORDER,
  OpenStackAccessGap,
  OpenStackHypervisorCounts,
  OpenStackServiceGroup,
  getOpenStackAccessGaps,
  getOpenStackCollectionSeconds,
  getOpenStackHypervisorCounts,
  getOpenStackNetworkBackendName,
  getOpenStackServiceGroups,
  getOpenStackWorkerAlertTemplateIds,
  getOpenStackWorkerCounts,
  getOpenStackWorkerHost,
  getOpenStackWorkerMachine,
  getOpenStackWorkerRank,
  isOpenStackApiExternalId,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/OpenStack/Utils/OpenStackServices";

/*
 * What the Services page and the Overview's cards make of what real clouds' exporters
 * said (Tests/Fixtures/OpenStack), through the scan ingest runs. A page written against
 * how OpenStack ought to report fails here: one family named differently, a backend read
 * from a word no release uses, a worker with no alert behind it. Each drill is on top of
 * the healthy recording of its cloud, as the upsert has it: a scrape that can't reach an
 * API says nothing of its workers, whose rows stay as they were.
 */

const FIXTURES: string = path.join(__dirname, "../../Fixtures/OpenStack");
const OBSERVED_AT_MS: number = 1793785799000;
const NOW: Date = new Date(OBSERVED_AT_MS + 60 * 1000);

interface Series {
  name: string;
  labels: Record<string, string>;
  value: number;
}

// Prometheus' text format: a tenant's label can hold anything, so this reads escapes.
function parse(text: string): Array<Series> {
  const series: Array<Series> = [];
  for (const line of text.split("\n")) {
    if (!line.trim() || line.startsWith("#")) {
      continue;
    }
    const labelsAt: number = line.indexOf("{");
    const valueAt: number = line.lastIndexOf(" ");
    const labels: Record<string, string> = {};
    if (labelsAt >= 0) {
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
    }
    series.push({
      name: line.substring(0, labelsAt >= 0 ? labelsAt : valueAt),
      labels,
      value: Number.parseFloat(line.substring(valueAt + 1)),
    });
  }
  return series;
}

function toRow(entry: OpenStackResourceBufferEntry): OpenStackResource {
  const row: OpenStackResource = new OpenStackResource();
  row.kind = entry.kind;
  row.externalId = entry.externalId;
  row.name = entry.name || undefined;
  row.regionName = entry.regionName || undefined;
  row.availabilityZone = entry.availabilityZone || undefined;
  row.hypervisorName = entry.hypervisorName || undefined;
  row.status = entry.status || undefined;
  row.adminState = entry.adminState || undefined;
  row.disabledReason = entry.disabledReason || undefined;
  row.vcpuCapacity = entry.vcpuCapacity ?? undefined;
  row.vcpuAllocated = entry.vcpuAllocated ?? undefined;
  row.memoryCapacityBytes = entry.memoryCapacityBytes ?? undefined;
  row.memoryAllocatedBytes = entry.memoryAllocatedBytes ?? undefined;
  row.instanceCount = entry.instanceCount ?? undefined;
  row.facts = entry.facts;
  return row;
}

function readScene(release: string, scene: string): Array<OpenStackResource> {
  const folder: string = path.join(FIXTURES, release, scene, "exporter");
  const buffer: Map<string, OpenStackResourceBufferEntry> = new Map();
  for (const file of fs.readdirSync(folder).sort()) {
    if (!file.endsWith(".prom")) {
      continue;
    }
    for (const series of parse(
      fs.readFileSync(path.join(folder, file), "utf8"),
    )) {
      const attributes: JSONArray = Object.keys(series.labels).map(
        (key: string): JSONObject => {
          return { key, value: { stringValue: series.labels[key] as string } };
        },
      );
      attributes.push({
        key: "openstack.region.name",
        value: { stringValue: "RegionOne" },
      });
      const datapoint: JSONObject = {
        attributes,
        timeUnixNano: `${OBSERVED_AT_MS}000000`,
        asDouble: series.value,
      };
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
  return finishOpenStackBatch(buffer.values()).map(toRow);
}

// A later scrape on top of an earlier one: what it read replaces, what it didn't stays.
function onTopOf(
  earlier: Array<OpenStackResource>,
  later: Array<OpenStackResource>,
): Array<OpenStackResource> {
  const rows: Map<string, OpenStackResource> = new Map();
  for (const row of [...earlier, ...later]) {
    rows.set(`${row.kind}/${row.externalId}`, row);
  }
  return Array.from(rows.values());
}

function ofKind(
  rows: Array<OpenStackResource>,
  kind: OpenStackResourceKind,
): Array<OpenStackResource> {
  return rows.filter((row: OpenStackResource): boolean => {
    return row.kind === kind;
  });
}

function groupsOf(
  rows: Array<OpenStackResource>,
): Array<OpenStackServiceGroup> {
  return getOpenStackServiceGroups({
    apis: ofKind(rows, OpenStackResourceKind.Api),
    workers: ofKind(rows, OpenStackResourceKind.Service),
    now: NOW,
  });
}

function groupOf(
  rows: Array<OpenStackResource>,
  service: string,
): OpenStackServiceGroup {
  const group: OpenStackServiceGroup | undefined = groupsOf(rows).find(
    (one: OpenStackServiceGroup): boolean => {
      return one.service === service;
    },
  );
  if (!group) {
    throw new Error(`No group for ${service}`);
  }
  return group;
}

function hasScene(release: string, scene: string): boolean {
  return fs.existsSync(path.join(FIXTURES, release, scene, "exporter"));
}

const RELEASES: Array<string> = fs
  .readdirSync(FIXTURES)
  .filter((entry: string): boolean => {
    return hasScene(entry, "healthy");
  })
  .sort();

test("there are clouds of each backend to read", () => {
  expect(
    RELEASES.filter((release: string): boolean => {
      return release.endsWith("-ovs");
    }).length,
  ).toBeGreaterThan(0);
  expect(
    RELEASES.filter((release: string): boolean => {
      return release.endsWith("-ovn");
    }).length,
  ).toBeGreaterThan(0);
});

describe.each(RELEASES)(
  "a healthy cloud's services, on %s",
  (release: string) => {
    const rows: Array<OpenStackResource> = readScene(release, "healthy");
    const workers: Array<OpenStackResource> = ofKind(
      rows,
      OpenStackResourceKind.Service,
    );

    test("read in the order of Keystone's catalog, each calm", () => {
      const groups: Array<OpenStackServiceGroup> = groupsOf(rows);
      expect(
        groups.map((group: OpenStackServiceGroup): string => {
          return group.service;
        }),
      ).toEqual([...OPENSTACK_CATALOG_ORDER]);
      for (const group of groups) {
        expect({ service: group.service, health: group.health }).toEqual({
          service: group.service,
          health: "Healthy",
        });
        expect(group.isLastKnown).toBe(false);
      }
    });

    test("every worker is under Nova, Neutron or Cinder, and nothing else has one", () => {
      const groups: Array<OpenStackServiceGroup> = groupsOf(rows);
      expect(
        groups
          .filter((group: OpenStackServiceGroup): boolean => {
            return group.workers.length > 0;
          })
          .map((group: OpenStackServiceGroup): string => {
            return group.service;
          })
          .sort(),
      ).toEqual(["compute", "network", "volume"]);
      expect(
        groups.reduce((total: number, group: OpenStackServiceGroup): number => {
          return total + group.workers.length;
        }, 0),
      ).toBe(workers.length);
      expect(getOpenStackWorkerCounts(workers).down).toBe(0);
    });

    test("the backend reads from its agents, as the recording's cloud was built", () => {
      expect(getOpenStackNetworkBackendName(workers)).toBe(
        release.endsWith("-ovn")
          ? OPENSTACK_BACKEND_OVN
          : OPENSTACK_BACKEND_OVS,
      );
    });

    test("a working credential has nothing it can't list", () => {
      const gaps: Array<OpenStackAccessGap> = getOpenStackAccessGaps({
        apis: ofKind(rows, OpenStackResourceKind.Api),
        workers: workers,
        hypervisors: ofKind(rows, OpenStackResourceKind.Hypervisor),
        hasStoragePools:
          ofKind(rows, OpenStackResourceKind.StoragePool).length > 0,
      });
      expect(gaps).toEqual([]);
    });

    test("an API's address reads as an API's, and a worker's as a worker's", () => {
      for (const api of ofKind(rows, OpenStackResourceKind.Api)) {
        expect({ id: api.externalId, api: true }).toEqual({
          id: api.externalId,
          api: isOpenStackApiExternalId(api.externalId as string),
        });
      }
      for (const worker of workers) {
        expect({ id: worker.externalId, api: false }).toEqual({
          id: worker.externalId,
          api: isOpenStackApiExternalId(worker.externalId as string),
        });
      }
    });

    test("every worker has a host, and an alert that would fire for it", () => {
      expect(workers.length).toBeGreaterThan(0);
      for (const worker of workers) {
        expect(getOpenStackWorkerHost(worker)).not.toBe("");
        expect(
          getOpenStackWorkerAlertTemplateIds(worker).length,
        ).toBeGreaterThan(0);
      }
    });

    test("a Cinder host that names its backend has a machine as well", () => {
      const volumes: Array<OpenStackResource> = workers.filter(
        (worker: OpenStackResource): boolean => {
          return worker.name === "cinder-volume";
        },
      );
      expect(volumes.length).toBeGreaterThan(0);
      for (const volume of volumes) {
        expect(getOpenStackWorkerHost(volume)).toContain("@");
        expect(getOpenStackWorkerMachine(volume)).not.toContain("@");
        expect(getOpenStackWorkerMachine(volume)).not.toBe("");
      }
    });

    test("every hypervisor can take instances, and reads up", () => {
      const counts: OpenStackHypervisorCounts =
        getOpenStackHypervisorCounts(rows);
      expect(counts.total).toBeGreaterThan(0);
      expect(counts.up).toBe(counts.total);
    });
  },
);

describe("the failures, on the cloud they were recorded on", () => {
  const RELEASE: string = "gazpacho-ovs";
  const healthy: Array<OpenStackResource> = readScene(RELEASE, "healthy");
  const after: (scene: string) => Array<OpenStackResource> = (
    scene: string,
  ): Array<OpenStackResource> => {
    return onTopOf(healthy, readScene(RELEASE, scene));
  };
  const workersNamed: (
    rows: Array<OpenStackResource>,
    name: string,
  ) => Array<OpenStackResource> = (
    rows: Array<OpenStackResource>,
    name: string,
  ): Array<OpenStackResource> => {
    return ofKind(rows, OpenStackResourceKind.Service).filter(
      (worker: OpenStackResource): boolean => {
        return worker.name === name;
      },
    );
  };

  test("Nova's API down: that service first, and its workers as they last read", () => {
    const rows: Array<OpenStackResource> = after("compute-api-down");
    const groups: Array<OpenStackServiceGroup> = groupsOf(rows);

    expect(groups[0]?.service).toBe("compute");
    expect(groups[0]?.health).toBe("Unhealthy");
    expect(groups[0]?.api?.status).toBe("down");
    expect(groups[0]?.isLastKnown).toBe(true);
    // And a credential is not what's wrong: its API isn't answering.
    expect(
      getOpenStackAccessGaps({
        apis: ofKind(
          readScene(RELEASE, "compute-api-down"),
          OpenStackResourceKind.Api,
        ),
        workers: [],
        hypervisors: [],
      }).filter((gap: OpenStackAccessGap): boolean => {
        return gap.service === "compute";
      }),
    ).toEqual([]);
  });

  test("a nova-compute that stopped: its group needs someone, and its host is lost", () => {
    const rows: Array<OpenStackResource> = after("compute-down");
    const group: OpenStackServiceGroup = groupOf(rows, "compute");

    expect(group.counts.down).toBeGreaterThan(0);
    expect(group.health).not.toBe("Healthy");
    expect(getOpenStackWorkerRank(group.workers[0]!, NOW)).toBe(0);
    expect(group.workers[0]?.name).toBe("nova-compute");
    expect(groupsOf(rows)[0]?.service).toBe("compute");
    // Lost, not idle: it can take nothing, however little it says it holds.
    expect(getOpenStackHypervisorCounts(rows).lost).toBeGreaterThan(0);
  });

  test("a nova-compute someone disabled raises nothing, and reads as planned", () => {
    const rows: Array<OpenStackResource> = after("compute-disabled");
    const group: OpenStackServiceGroup = groupOf(rows, "compute");

    expect(group.counts.disabled).toBeGreaterThan(0);
    expect(group.counts.down).toBe(0);
    expect(group.health).toBe("Healthy");
    expect(
      group.workers
        .filter((worker: OpenStackResource): boolean => {
          return worker.adminState === "disabled";
        })
        .map((worker: OpenStackResource): number => {
          return getOpenStackWorkerRank(worker, NOW);
        }),
    ).toEqual([2]);
    expect(getOpenStackHypervisorCounts(rows).lost).toBe(0);
    expect(getOpenStackHypervisorCounts(rows).disabled).toBeGreaterThan(0);
  });

  test("a stopped scheduler, the cloud's only one, is one critical", () => {
    const rows: Array<OpenStackResource> = after("scheduler-down");
    const group: OpenStackServiceGroup = groupOf(rows, "compute");

    expect(workersNamed(rows, "nova-scheduler").length).toBe(1);
    expect(workersNamed(rows, "nova-scheduler")[0]?.status).toBe("down");
    expect(group.health).toBe("Unhealthy");
    expect(group.counts.down).toBe(1);
  });

  test("a Neutron agent that stopped leaves the backend what it was", () => {
    const rows: Array<OpenStackResource> = after("network-agent-down");
    const group: OpenStackServiceGroup = groupOf(rows, "network");

    expect(group.counts.down).toBeGreaterThan(0);
    expect(group.health).not.toBe("Healthy");
    expect(group.api?.status).toBe("up");
    expect(group.isLastKnown).toBe(false);
    expect(
      getOpenStackNetworkBackendName(
        ofKind(rows, OpenStackResourceKind.Service),
      ),
    ).toBe(OPENSTACK_BACKEND_OVS);
  });

  test("a Cinder service that stopped, with Cinder's API still answering", () => {
    const rows: Array<OpenStackResource> = after("volume-service-down");
    const group: OpenStackServiceGroup = groupOf(rows, "volume");

    expect(group.counts.down).toBeGreaterThan(0);
    expect(group.health).not.toBe("Healthy");
    expect(group.api?.status).toBe("up");
    expect(group.isLastKnown).toBe(false);
  });

  test("everything back up reads calm again", () => {
    for (const group of groupsOf(after("recovered"))) {
      expect({ service: group.service, health: group.health }).toEqual({
        service: group.service,
        health: "Healthy",
      });
    }
  });
});

/*
 * The whole way, for what only the collector knows: how long each API took to collect.
 * The exporter does not say, so the agent's real export is what has to carry it.
 */
describe("how long each API took to collect, from what the collector exports", () => {
  const RELEASES_WITH_EXPORT: Array<string> = RELEASES.filter(
    (release: string): boolean => {
      return fs.existsSync(path.join(FIXTURES, release, "otlp.json"));
    },
  );

  test("there is a real export to read", () => {
    expect(RELEASES_WITH_EXPORT.length).toBeGreaterThan(0);
  });

  test.each(RELEASES_WITH_EXPORT)("on %s", (release: string) => {
    const otlp: JSONObject = JSON.parse(
      fs.readFileSync(path.join(FIXTURES, release, "otlp.json"), "utf8"),
    ) as JSONObject;

    const buffer: Map<string, OpenStackResourceBufferEntry> = new Map();
    for (const resourceMetrics of otlp[
      "resourceMetrics"
    ] as Array<JSONObject>) {
      for (const scope of resourceMetrics[
        "scopeMetrics"
      ] as Array<JSONObject>) {
        for (const metric of scope["metrics"] as Array<JSONObject>) {
          const data: JSONObject =
            (metric["gauge"] as JSONObject) ||
            (metric["sum"] as JSONObject) ||
            ({} as JSONObject);
          for (const datapoint of (data["dataPoints"] as Array<JSONObject>) ||
            []) {
            const metricName: string = metric["name"] as string;
            if (isOpenStackSnapshotDatapoint({ metricName, datapoint })) {
              bufferOpenStackSnapshotMetric({ metricName, datapoint, buffer });
            }
          }
        }
      }
    }

    const apis: Array<OpenStackResource> = finishOpenStackBatch(buffer.values())
      .map(toRow)
      .filter((row: OpenStackResource): boolean => {
        return row.kind === OpenStackResourceKind.Api;
      });

    expect(apis.length).toBe(OPENSTACK_CATALOG_ORDER.length);
    for (const api of apis) {
      const seconds: number | null = getOpenStackCollectionSeconds(api);
      expect({ api: api.name, isSeconds: typeof seconds === "number" }).toEqual(
        {
          api: api.name,
          isSeconds: true,
        },
      );
      expect(seconds).toBeGreaterThan(0);
      // A real scrape, not a timestamp or a count of something.
      expect(seconds).toBeLessThan(60);
    }
  });
});
