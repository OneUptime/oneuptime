/*
 * MonitorCriteriaEvaluator reaches the template renderer, which loads the native isolated-vm addon.
 * Nothing here uses the sandbox, and the prebuilt binary cannot always dlopen in the test
 * environment.
 */
jest.mock("isolated-vm", () => {
  return {};
});

import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import {
  OpenStackResourceBufferEntry,
  bufferOpenStackSnapshotMetric,
  finishOpenStackBatch,
  getOpenStackHostsWithPartReadings,
  isOpenStackSnapshotDatapoint,
} from "../../../../Server/Utils/Telemetry/OpenStackSnapshotScan";
import { JSONArray, JSONObject } from "../../../../Types/JSON";
import MonitorStep from "../../../../Types/Monitor/MonitorStep";
import {
  OpenStackAlertTemplate,
  getOpenStackAlertTemplateById,
} from "../../../../Types/Monitor/OpenStackAlertTemplates";
import ObjectID from "../../../../Types/ObjectID";
import {
  OpenStackCapacityHost,
  OpenStackCapacityResource,
  OpenStackFlavorFit,
  OpenStackFlavorRequest,
  OpenStackPlacementAnswer,
  getOpenStackAllocationMismatches,
  getOpenStackFitOnHost,
  getOpenStackFlavorFit,
  getOpenStackFlavorRequest,
  getOpenStackInventoryCapacity,
  getOpenStackInventoryFree,
  getOpenStackPlacementAnswer,
  readOpenStackAllocationCandidates,
} from "../../../../Types/OpenStack/OpenStackCapacity";
import { getOpenStackShortHostName } from "../../../../Types/OpenStack/OpenStackHealthRules";
import {
  OPENSTACK_CAPACITY_CAN_LOSE_A_HOST_SERIES,
  OPENSTACK_CAPACITY_DAYS_UNTIL_FULL_SERIES,
  OPENSTACK_CAPACITY_FLAVOR_FITS_SERIES,
  buildOpenStackCapacityResourceMetrics,
  getOpenStackCapacitySeriesRows,
} from "../../../../Types/OpenStack/OpenStackCapacitySeries";
import {
  OpenStackCapacityFlavor,
  OpenStackCapacityFlavorRow,
  OpenStackCapacityFlavorSourceRow,
  OpenStackCapacityHostSourceRow,
  OpenStackCapacitySnapshot,
  buildOpenStackCapacitySnapshot,
  getOpenStackCapacityResourceOf,
  readOpenStackCapacityFlavor,
  readOpenStackCapacityHost,
} from "../../../../Types/OpenStack/OpenStackCapacitySnapshot";
import { getOpenStackCapacityForecasts } from "../../../../Server/Utils/OpenStack/OpenStackCapacityRefresh";
import { OpenStackGrowthSample } from "../../../../Types/OpenStack/OpenStackForecast";
import {
  SamplesByAlias,
  evaluateTemplateCriteria,
} from "../../../Types/Monitor/Utils/TemplateCriteriaEvaluation";

/*
 * THE WHOLE WAY, ON WHAT REAL CLOUDS SAID.
 *
 * What the agent's exporter answered, through the real snapshot scan, into a snapshot, into the
 * series the templates read, and through the real evaluator. Each recording is a real DevStack's
 * one host, so what takes several hosts says at the top of its own test what it edited.
 */

const FIXTURES: string = path.join(__dirname, "../../../Fixtures/OpenStack");
const OBSERVED_AT_MS: number = 1793785799000;
const NOW: Date = new Date(OBSERVED_AT_MS + 60 * 1000);

function datapointsOf(text: string): Array<{
  metricName: string;
  datapoint: JSONObject;
}> {
  const points: Array<{ metricName: string; datapoint: JSONObject }> = [];

  for (const line of text.split("\n")) {
    if (!line || line.startsWith("#")) {
      continue;
    }
    const brace: number = line.indexOf("{");
    const space: number = line.lastIndexOf(" ");
    const attributes: JSONArray = [];

    if (brace >= 0) {
      const body: string = line.substring(brace + 1, line.lastIndexOf("}"));
      let at: number = 0;
      while (at < body.length) {
        const equals: number = body.indexOf("=", at);
        const key: string = body.substring(at, equals);
        let end: number = equals + 2;
        while (body[end] !== '"') {
          end += body[end] === "\\" ? 2 : 1;
        }
        const value: string = body.substring(equals + 2, end);
        // What the collector does: an empty label is no label.
        if (value) {
          attributes.push({ key, value: { stringValue: value } });
        }
        at = end + 2;
      }
    }

    attributes.push({
      key: "openstack.region.name",
      value: { stringValue: "RegionOne" },
    });

    points.push({
      metricName: line.substring(0, brace >= 0 ? brace : space),
      datapoint: {
        attributes,
        asDouble: Number(line.substring(space + 1)),
        timeUnixNano: `${OBSERVED_AT_MS}000000`,
      },
    });
  }

  return points;
}

function scan(
  texts: ReadonlyArray<string>,
): Array<OpenStackResourceBufferEntry> {
  const buffer: Map<string, OpenStackResourceBufferEntry> = new Map();

  for (const text of texts) {
    for (const point of datapointsOf(text)) {
      if (isOpenStackSnapshotDatapoint(point)) {
        bufferOpenStackSnapshotMetric({ ...point, buffer });
      }
    }
  }

  return finishOpenStackBatch(buffer.values());
}

function recorded(release: string, scene: string, service: string): string {
  return fs.readFileSync(
    path.join(FIXTURES, release, scene, "exporter", `${service}.prom`),
    "utf8",
  );
}

function hostsOf(
  entries: ReadonlyArray<OpenStackResourceBufferEntry>,
): Array<OpenStackCapacityHost> {
  return entries
    .filter((entry: OpenStackResourceBufferEntry): boolean => {
      return entry.kind === "Hypervisor";
    })
    .map((entry: OpenStackResourceBufferEntry): OpenStackCapacityHost => {
      return readOpenStackCapacityHost(
        entry as unknown as OpenStackCapacityHostSourceRow,
      );
    });
}

function flavorsOf(
  entries: ReadonlyArray<OpenStackResourceBufferEntry>,
): Array<OpenStackCapacityFlavor> {
  return entries
    .filter((entry: OpenStackResourceBufferEntry): boolean => {
      return entry.kind === "Flavor";
    })
    .map((entry: OpenStackResourceBufferEntry): OpenStackCapacityFlavor => {
      return readOpenStackCapacityFlavor({
        row: entry as unknown as OpenStackCapacityFlavorSourceRow,
        instanceCount: 0,
      });
    });
}

function snapshotOfScene(
  release: string,
  scene: string,
): OpenStackCapacitySnapshot {
  const entries: Array<OpenStackResourceBufferEntry> = scan([
    recorded(release, scene, "compute"),
    recorded(release, scene, "placement"),
  ]);

  return buildOpenStackCapacitySnapshot({
    hosts: hostsOf(entries),
    flavors: flavorsOf(entries),
    pools: [],
    now: NOW,
  });
}

function flavorRow(
  snapshot: OpenStackCapacitySnapshot,
  name: string,
): OpenStackCapacityFlavorRow {
  return snapshot.flavors.find((row: OpenStackCapacityFlavorRow): boolean => {
    return row.name === name;
  })!;
}

function seriesPoints(
  snapshot: OpenStackCapacitySnapshot,
  metricName: string,
): Array<{ labels: Record<string, string>; value: number }> {
  const metrics: JSONArray = buildOpenStackCapacityResourceMetrics({
    cloudName: "devstack",
    now: NOW,
    snapshot,
  });
  const points: Array<{ labels: Record<string, string>; value: number }> = [];

  for (const resource of metrics as Array<JSONObject>) {
    for (const scope of resource["scopeMetrics"] as Array<JSONObject>) {
      for (const metric of scope["metrics"] as Array<JSONObject>) {
        if (metric["name"] !== metricName) {
          continue;
        }
        for (const point of (metric["gauge"] as JSONObject)[
          "dataPoints"
        ] as Array<JSONObject>) {
          const labels: Record<string, string> = {};
          for (const attribute of point["attributes"] as Array<JSONObject>) {
            labels[attribute["key"] as string] = (
              attribute["value"] as JSONObject
            )["stringValue"] as string;
          }
          points.push({ labels, value: point["asDouble"] as number });
        }
      }
    }
  }

  return points;
}

function stepOf(id: string): MonitorStep {
  const template: OpenStackAlertTemplate = getOpenStackAlertTemplateById(id)!;

  return template.getMonitorStep({
    cloudIdentifier: "devstack",
    onlineMonitorStatusId: ObjectID.generate(),
    offlineMonitorStatusId: ObjectID.generate(),
    defaultIncidentSeverityId: ObjectID.generate(),
    defaultAlertSeverityId: ObjectID.generate(),
    monitorName: "devstack",
  });
}

// What the worker hands the evaluator of one series, on the cadence this one is written at.
async function judged(
  id: string,
  alias: string,
  value: number | undefined,
): Promise<{ breached: boolean; healthy: boolean }> {
  const step: MonitorStep = stepOf(id);
  const samples: SamplesByAlias =
    value === undefined ? {} : { [alias]: new Array<number>(10).fill(value) };

  return await evaluateTemplateCriteria({
    step,
    viewConfig: step.data!.openstackMonitor!.metricViewConfig,
    samplesByAlias: samples,
    windowMinutes: 10,
  });
}

// A flavor no recording's estate fills: the worker reads it by its name.
function fitsOf(
  snapshot: OpenStackCapacitySnapshot,
  flavor: string,
): number | undefined {
  return seriesPoints(snapshot, OPENSTACK_CAPACITY_FLAVOR_FITS_SERIES).find(
    (point: { labels: Record<string, string> }): boolean => {
      return point.labels["flavor"] === flavor;
    },
  )?.value;
}

describe("what the agent's series come to, on what real clouds said", () => {
  // The same table as OpenStackCapacity.test.ts, which reads the same clouds' API answers.
  const BY_HAND: Record<string, number> = {
    "ou.tiny": 13,
    "m1.tiny": 13,
    cirros256: 13,
    ds512M: 13,
    ds1G: 13,
    ds2G: 6,
    ds4G: 3,
    "m1.small": 7,
    "m1.medium": 3,
    "m1.large": 1,
    "m1.xlarge": 0,
    "ou.impossible": 0,
  };

  describe.each([
    "epoxy-ovn",
    "flamingo-ovn",
    "gazpacho-ovn",
    "gazpacho-ovs",
    "hibiscus-ovn",
  ])("%s", (release: string) => {
    const snapshot: OpenStackCapacitySnapshot = snapshotOfScene(
      release,
      "healthy",
    );

    test("every flavor matches a hand calculation", () => {
      const counted: Record<string, number> = {};
      for (const flavor of snapshot.flavors) {
        counted[flavor.name] = flavor.fits;
      }

      expect(counted).toEqual(BY_HAND);
    });

    test("it says it calculated, because an agent's cloud never asks Placement", () => {
      expect(
        snapshot.flavors.every((flavor: OpenStackCapacityFlavorRow) => {
          return flavor.source === "inventories";
        }),
      ).toBe(true);
    });

    test("capacity is (total - reserved) x ratio, and what's allocated is what it's promised", () => {
      const vcpu: JSONObject = snapshot.cloud
        .resources[0] as unknown as JSONObject;

      expect(vcpu["resourceClass"]).toBe("VCPU");
      expect(vcpu["capacity"]).toBe(16);
      expect(vcpu["used"]).toBe(3);
      expect(vcpu["lowestRatio"]).toBe(4);
      expect(vcpu["highestRatio"]).toBe(4);
    });

    test("a flavor no host could hold is too large, not short", () => {
      expect(flavorRow(snapshot, "ou.impossible").isTooLargeForEveryHost).toBe(
        true,
      );
      // 8 vCPUs is past max_unit 4, whatever the ratio gives it.
      expect(flavorRow(snapshot, "m1.xlarge").isTooLargeForEveryHost).toBe(
        true,
      );
    });

    test("the zone is the one its nova-compute names, and it has no other host to lean on", () => {
      expect(snapshot.zones).toHaveLength(1);
      expect(snapshot.zones[0]!.name).toBe("nova");
      expect(snapshot.zones[0]!.headroom.state).toBe("too-few-hosts");
    });

    test("what Placement holds is what its instances add up to: no allocation is orphaned", () => {
      const entries: Array<OpenStackResourceBufferEntry> = scan([
        recorded(release, "healthy", "compute"),
        recorded(release, "healthy", "placement"),
      ]);
      const flavors: Array<OpenStackCapacityFlavor> = flavorsOf(entries);
      const flavorResources: Map<
        string,
        Readonly<Record<string, number>>
      > = new Map();

      for (const flavor of flavors) {
        flavorResources.set(
          `${flavor.regionName || ""}/${flavor.id}`,
          flavor.request.resources,
        );
      }

      const instances: Array<OpenStackResourceBufferEntry> = entries.filter(
        (entry: OpenStackResourceBufferEntry): boolean => {
          return entry.kind === "Instance" && Boolean(entry.hypervisorName);
        },
      );

      // Three ou.tiny, on 3 vCPUs and 384 MB.
      expect(instances).toHaveLength(3);
      expect(
        getOpenStackAllocationMismatches({
          hosts: hostsOf(entries),
          flavorResources,
          instances: instances.map((entry: OpenStackResourceBufferEntry) => {
            return {
              regionName: entry.regionName,
              hypervisorName: entry.hypervisorName as string,
              flavorId: entry.facts["flavorId"] as string,
              count: 1,
              movingCount: 0,
            };
          }),
        }),
      ).toEqual([]);
    });
  });
});

describe("Flavor Can No Longer Be Placed, on real drills", () => {
  const ID: string = "openstack-flavor-cannot-be-placed";
  const ALIAS: string = "room_for";

  test.each(["hibiscus-ovn", "gazpacho-ovs"])(
    "%s: nova-compute stopped, so nothing has room, and it fires",
    async (release: string) => {
      const snapshot: OpenStackCapacitySnapshot = snapshotOfScene(
        release,
        "compute-down",
      );

      expect(snapshot.hostsNotCounted).toEqual([
        expect.objectContaining({ state: "lost" }),
      ]);
      expect(fitsOf(snapshot, "m1.small")).toBe(0);
      expect(await judged(ID, ALIAS, fitsOf(snapshot, "m1.small"))).toEqual({
        breached: true,
        healthy: false,
      });
    },
  );

  test.each(["hibiscus-ovn", "gazpacho-ovs"])(
    "%s: started again, it has room, and that recovers",
    async (release: string) => {
      const snapshot: OpenStackCapacitySnapshot = snapshotOfScene(
        release,
        "recovered",
      );

      expect(fitsOf(snapshot, "m1.small")).toBe(7);
      expect(await judged(ID, ALIAS, fitsOf(snapshot, "m1.small"))).toEqual({
        breached: false,
        healthy: true,
      });
    },
  );

  test.each(["hibiscus-ovn", "gazpacho-ovs"])(
    "%s: disabled on purpose is planned work: no series, so it's quiet, and an open incident recovers",
    async (release: string) => {
      const snapshot: OpenStackCapacitySnapshot = snapshotOfScene(
        release,
        "compute-disabled",
      );

      expect(flavorRow(snapshot, "m1.small").fits).toBe(0);
      expect(flavorRow(snapshot, "m1.small").isOnlyOnDisabledHosts).toBe(true);
      expect(fitsOf(snapshot, "m1.small")).toBeUndefined();
      expect(await judged(ID, ALIAS, undefined)).toEqual({
        breached: false,
        healthy: true,
      });
    },
  );

  test("a flavor too large for any host never fires, whatever its count", () => {
    const snapshot: OpenStackCapacitySnapshot = snapshotOfScene(
      "hibiscus-ovn",
      "healthy",
    );

    expect(fitsOf(snapshot, "ou.impossible")).toBeUndefined();
    expect(fitsOf(snapshot, "m1.xlarge")).toBeUndefined();
    expect(fitsOf(snapshot, "m1.large")).toBe(1);
  });
});

describe("Reserved Headroom Gone", () => {
  const ID: string = "openstack-reserved-headroom-gone";
  const ALIAS: string = "can_lose_a_host";

  /*
   * Made from a real recording, and edited: the exporter's own answer for its one host, again under
   * a second name, with what each has allocated scaled by hand, to hold the line to the vCPU. The
   * real drill is further down, on three real hosts.
   */
  function twoHosts(vcpusEach: number): OpenStackCapacitySnapshot {
    const compute: string = recorded("hibiscus-ovn", "healthy", "compute");
    const placement: string = recorded(
      "hibiscus-ovn",
      "healthy",
      "placement",
    ).replace(
      /(openstack_placement_resource_usage\{hostname="compute-01\.example\.internal",resourcetype="VCPU"\}) 3/,
      `$1 ${vcpusEach}`,
    );

    const entries: Array<OpenStackResourceBufferEntry> = scan([
      compute,
      placement,
      compute.replace(/compute-01/g, "compute-02"),
      placement.replace(/compute-01/g, "compute-02"),
    ]);

    return buildOpenStackCapacitySnapshot({
      hosts: hostsOf(entries),
      flavors: [],
      pools: [],
      now: NOW,
    });
  }

  function worst(snapshot: OpenStackCapacitySnapshot): number {
    return Math.min(
      ...seriesPoints(snapshot, OPENSTACK_CAPACITY_CAN_LOSE_A_HOST_SERIES).map(
        (point: { value: number }): number => {
          return point.value;
        },
      ),
    );
  }

  test("two hosts of 16 vCPUs at 4:1 can lose one while what's allocated fits in 16", async () => {
    const snapshot: OpenStackCapacitySnapshot = twoHosts(8);

    expect(snapshot.zones[0]!.headroom.state).toBe("can-lose-a-host");
    expect(worst(snapshot)).toBe(1);
    expect(await judged(ID, ALIAS, worst(snapshot))).toEqual({
      breached: false,
      healthy: true,
    });
  });

  test("one vCPU more and it can't, which fires, and says by how much on the page", async () => {
    const snapshot: OpenStackCapacitySnapshot = twoHosts(9);

    expect(snapshot.zones[0]!.headroom.state).toBe("cannot-lose-a-host");
    expect(snapshot.zones[0]!.headroom.resources[0]!.shortBy).toBe(2);
    expect(worst(snapshot)).toBe(0);
    expect(await judged(ID, ALIAS, worst(snapshot))).toEqual({
      breached: true,
      healthy: false,
    });
  });

  test("a zone of one host has no series: it never had anywhere to go", () => {
    expect(
      seriesPoints(
        snapshotOfScene("hibiscus-ovn", "healthy"),
        OPENSTACK_CAPACITY_CAN_LOSE_A_HOST_SERIES,
      ),
    ).toEqual([]);
  });
});

/*
 * THREE REAL HOSTS ON A REAL PLACEMENT.
 *
 * capacity-record.sh adds three hosts to a DevStack, on Nova's fake driver, which reports what it
 * is told. Each holds two m1.small, and each is set up differently, so a sum that gets any of it
 * wrong can't land on the same number:
 *
 *            total       reserved   cpu ratio  ram ratio   capacity (vCPU, MB, GB)   free
 *   ou-cap-1  10/8192/1028    512        4        1.0        40,  7680, 1028      38, 3584, 988
 *   ou-cap-2  10/8192/1028   1024        2        1.5        20, 10752, 1028      18, 6656, 988
 *   ou-cap-3  10/8192/1028   2048        1        1.0        10,  6144, 1028       8, 2048, 988
 *
 * Every number below is worked out from that table by hand, per host, and written here. All this
 * reads is what each cloud really answered: the exporter's series and Placement's own
 * GET /allocation_candidates, on each release that recorded them. The DevStack's own host is in
 * those answers too, and differs by runner, so each flavor is held to its count in the zone.
 */
const ZONE: string = "ou-zone-a";

interface HandFlavor {
  name: string;
  // Per host, ou-cap-1, ou-cap-2, ou-cap-3.
  perHost: [number, number, number];
  // All of what is free in the zone, 64 vCPUs, 12288 MB and 2964 GB, as one host.
  ifOnePool: number;
}

const HAND_TABLE: ReadonlyArray<HandFlavor> = [
  // 3584 / 512, 6656 / 512, 2048 / 512: memory runs out first on each.
  { name: "m1.tiny", perHost: [7, 13, 4], ifOnePool: 24 },
  // 3584 / 2048, 6656 / 2048, 2048 / 2048.
  { name: "m1.small", perHost: [1, 3, 1], ifOnePool: 6 },
  // Only ou-cap-2 has 4096 free, thanks to its 1.5 ratio: three fit if it were one pool.
  { name: "m1.medium", perHost: [0, 1, 0], ifOnePool: 3 },
  { name: "m1.large", perHost: [0, 0, 0], ifOnePool: 1 },
  { name: "m1.xlarge", perHost: [0, 0, 0], ifOnePool: 0 },
  // THE FRAGMENTED ONE. 12288 MB is free in the zone, and no host has 6912 of it.
  { name: "ou.fragmented", perHost: [0, 0, 0], ifOnePool: 1 },
  { name: "ou.impossible", perHost: [0, 0, 0], ifOnePool: 0 },
  /*
   * 128 MB each, so what runs out differs by host: memory at 4:1 (3584 / 128 = 28 < 38), vCPUs at
   * 2:1 (18 < 52) and at 1:1 (8 < 16). A ratio read wrong moves two of the three.
   */
  { name: "ou.tiny", perHost: [28, 18, 8], ifOnePool: 64 },
  { name: "cirros256", perHost: [14, 18, 8], ifOnePool: 48 },
  { name: "ds512M", perHost: [7, 13, 4], ifOnePool: 24 },
  { name: "ds1G", perHost: [3, 6, 2], ifOnePool: 12 },
  { name: "ds2G", perHost: [1, 3, 1], ifOnePool: 6 },
  { name: "ds4G", perHost: [0, 1, 0], ifOnePool: 3 },
];

function sumOf(perHost: ReadonlyArray<number>): number {
  return perHost.reduce((total: number, fit: number): number => {
    return total + fit;
  }, 0);
}

function recordedJson(
  release: string,
  scene: string,
  file: string,
): JSONObject {
  return JSON.parse(
    fs.readFileSync(path.join(FIXTURES, release, scene, file), "utf8"),
  ) as JSONObject;
}

describe.each(["hibiscus-ovn", "gazpacho-ovn", "epoxy-ovn"])(
  "three real hosts on a real Placement, on %s",
  (release: string) => {
    const HEALTHY: string = "capacity/healthy";
    const LOST: string = "capacity/host-lost";

    function hostsOfScene(scene: string): Array<OpenStackCapacityHost> {
      return hostsOf(
        scan([
          recorded(release, scene, "compute"),
          recorded(release, scene, "placement"),
        ]),
      );
    }

    function zoneHosts(scene: string): Array<OpenStackCapacityHost> {
      return hostsOfScene(scene).filter(
        (host: OpenStackCapacityHost): boolean => {
          return host.zone === ZONE;
        },
      );
    }

    function requestOf(scene: string, name: string): Array<number> {
      const flavors: Array<JSONObject> = recordedJson(
        release,
        scene,
        "candidates/nova-flavors.json",
      )["flavors"] as Array<JSONObject>;
      const flavor: JSONObject = flavors.find((row: JSONObject): boolean => {
        return row["name"] === name;
      })!;

      return [
        flavor["vcpus"] as number,
        flavor["ram"] as number,
        flavor["disk"] as number,
      ];
    }

    function resourcesOf(scene: string, name: string): Record<string, number> {
      const [vcpus, ram, disk]: Array<number> = requestOf(scene, name);

      return { VCPU: vcpus!, MEMORY_MB: ram!, DISK_GB: disk! };
    }

    // What Placement answered, added up as a probe adds it up, with the hosts Nova's scrape names.
    function placementAnswered(
      scene: string,
      file: string,
    ): OpenStackPlacementAnswer {
      const providers: Array<JSONObject> = recordedJson(
        release,
        scene,
        "placement/placement-providers.json",
      )["resource_providers"] as Array<JSONObject>;
      const hosts: Map<string, OpenStackCapacityHost> = new Map(
        hostsOfScene(scene).map(
          (host: OpenStackCapacityHost): [string, OpenStackCapacityHost] => {
            return [getOpenStackShortHostName(host.name), host];
          },
        ),
      );

      return getOpenStackPlacementAnswer({
        candidates: readOpenStackAllocationCandidates(
          recordedJson(release, scene, `candidates/${file}.json`),
        ),
        providerNames: new Map(
          providers.map((row: JSONObject): [string, string] => {
            return [row["uuid"] as string, row["name"] as string];
          }),
        ),
        hostsByShortName: hosts,
        candidateLimit: 1000,
      });
    }

    describe("what each host holds, by hand", () => {
      test.each([
        // (10 - 0) * 4, (8192 - 512) * 1, (1028 - 0) * 1
        ["ou-cap-1", 40, 7680, 1028, 38, 3584, 988],
        // (10 - 0) * 2, (8192 - 1024) * 1.5, (1028 - 0) * 1
        ["ou-cap-2", 20, 10752, 1028, 18, 6656, 988],
        // (10 - 0) * 1, (8192 - 2048) * 1, (1028 - 0) * 1
        ["ou-cap-3", 10, 6144, 1028, 8, 2048, 988],
      ])(
        "%s has %d vCPUs, %d MB and %d GB to promise, and %d, %d and %d of them left",
        (
          name: string,
          vcpus: number,
          memory: number,
          disk: number,
          vcpusFree: number,
          memoryFree: number,
          diskFree: number,
        ) => {
          const host: OpenStackCapacityHost = zoneHosts(HEALTHY).find(
            (row: OpenStackCapacityHost): boolean => {
              return row.name === name;
            },
          )!;

          expect(host.state).toBe("up");
          expect(
            ["VCPU", "MEMORY_MB", "DISK_GB"].map((resource: string): number => {
              return getOpenStackInventoryCapacity(host.inventories[resource]!);
            }),
          ).toEqual([vcpus, memory, disk]);
          expect(
            ["VCPU", "MEMORY_MB", "DISK_GB"].map((resource: string): number => {
              return getOpenStackInventoryFree(host.inventories[resource]!);
            }),
          ).toEqual([vcpusFree, memoryFree, diskFree]);
        },
      );

      test("the zone adds them up, and what's allocated isn't what's left", () => {
        const zone: OpenStackCapacitySnapshot["zones"][number] =
          snapshotOfScene(release, HEALTHY).zones.find(
            (row: OpenStackCapacitySnapshot["zones"][number]): boolean => {
              return row.name === ZONE;
            },
          )!;

        expect(zone.hostCount).toBe(3);
        expect(
          ["VCPU", "MEMORY_MB", "DISK_GB"].map(
            (name: string): Array<number> => {
              const resource: OpenStackCapacityResource =
                getOpenStackCapacityResourceOf(zone, name)!;

              return [resource.capacity, resource.used];
            },
          ),
        ).toEqual([
          [70, 6],
          [24576, 12288],
          [3084, 120],
        ]);
      });
    });

    describe("how many of each flavor fit, by hand, from what the agent's exporter says", () => {
      test.each(
        HAND_TABLE.map((row: HandFlavor) => {
          return [row.name, row] as [string, HandFlavor];
        }),
      )("%s", (name: string, hand: HandFlavor) => {
        const hosts: Array<OpenStackCapacityHost> = zoneHosts(HEALTHY);
        const resources: Record<string, number> = resourcesOf(HEALTHY, name);

        expect(
          ["ou-cap-1", "ou-cap-2", "ou-cap-3"].map((host: string): number => {
            return getOpenStackFitOnHost({
              inventories: hosts.find((row: OpenStackCapacityHost): boolean => {
                return row.name === host;
              })!.inventories,
              resources,
            }).fit;
          }),
        ).toEqual(hand.perHost);

        const fit: OpenStackFlavorFit = getOpenStackFlavorFit({
          resources,
          hosts,
        });

        expect(fit.fits).toBe(sumOf(hand.perHost));
        expect(fit.fitsIfOnePool).toBe(hand.ifOnePool);
        expect(fit.byZone[ZONE]).toBe(sumOf(hand.perHost));

        // And the page's row, through the scan and the snapshot, says the same of the zone.
        expect(
          flavorRow(snapshotOfScene(release, HEALTHY), name).byZone[ZONE] ?? 0,
        ).toBe(sumOf(hand.perHost));
      });

      test("a fragmented estate: room as one pool, and on no host", () => {
        const fit: OpenStackFlavorFit = getOpenStackFlavorFit({
          resources: resourcesOf(HEALTHY, "ou.fragmented"),
          hosts: zoneHosts(HEALTHY),
        });

        expect(fit).toMatchObject({
          fits: 0,
          hostsWithRoom: 0,
          fitsIfOnePool: 1,
          fitsOnAnEmptyHost: true,
          limitedBy: "MEMORY_MB",
        });
      });

      test("too large for any host is not fragmentation", () => {
        const fit: OpenStackFlavorFit = getOpenStackFlavorFit({
          resources: resourcesOf(HEALTHY, "ou.impossible"),
          hosts: zoneHosts(HEALTHY),
        });

        expect(fit).toMatchObject({
          fits: 0,
          fitsIfOnePool: 0,
          fitsOnAnEmptyHost: false,
        });
      });
    });

    describe("how many fit, from what Placement itself answered", () => {
      test.each(
        HAND_TABLE.map((row: HandFlavor) => {
          return [row.name, row] as [string, HandFlavor];
        }),
      )(
        "%s, asked as Nova asks, comes to the same sum",
        (name: string, hand: HandFlavor) => {
          expect(
            placementAnswered(HEALTHY, `placement-candidates-${name}`).byZone[
              ZONE
            ] ?? 0,
          ).toBe(sumOf(hand.perHost));
        },
      );

      test("a trait only Placement can see: 7 on the one host that holds it, not all 24", () => {
        // 3584 / 512 on ou-cap-1. It's the only host CUSTOM_OU_GOLD is on.
        expect(
          placementAnswered(HEALTHY, "placement-candidates-ou.gold"),
        ).toMatchObject({
          fits: 7,
          hostsWithRoom: 1,
          isCapped: false,
          byZone: { [ZONE]: 7 },
        });

        // Asked with the trait left out, it's what inventories count: 7 + 13 + 4.
        expect(
          placementAnswered(HEALTHY, "placement-candidates-bare-ou.gold")
            .byZone[ZONE],
        ).toBe(24);
        expect(
          getOpenStackFlavorFit({
            resources: resourcesOf(HEALTHY, "ou.gold"),
            hosts: zoneHosts(HEALTHY),
          }).fits,
        ).toBe(24);
      });

      test("every flavor that asks only for amounts: the two paths agree on the whole region", () => {
        for (const hand of HAND_TABLE) {
          expect({
            flavor: hand.name,
            fits: getOpenStackFlavorFit({
              resources: resourcesOf(HEALTHY, hand.name),
              hosts: hostsOfScene(HEALTHY),
            }).fits,
          }).toEqual({
            flavor: hand.name,
            fits: placementAnswered(
              HEALTHY,
              `placement-candidates-${hand.name}`,
            ).fits,
          });
        }
      });

      test("asks Placement what the recording asked it", () => {
        const flavors: Array<JSONObject> = recordedJson(
          release,
          HEALTHY,
          "candidates/nova-flavors.json",
        )["flavors"] as Array<JSONObject>;

        for (const flavor of flavors) {
          const request: OpenStackFlavorRequest = getOpenStackFlavorRequest({
            vcpus: flavor["vcpus"] as number,
            ramMib: flavor["ram"] as number,
            diskGib: flavor["disk"] as number,
            ephemeralGib: flavor["OS-FLV-EXT-DATA:ephemeral"] as number,
            swapMib: Number(flavor["swap"]) || 0,
            extraSpecs: flavor["extra_specs"] as Record<string, string>,
          });
          const answer: JSONObject = recordedJson(
            release,
            HEALTHY,
            `candidates/placement-candidates-${flavor["name"] as string}.json`,
          );

          for (const asked of answer[
            "allocation_requests"
          ] as Array<JSONObject>) {
            const allocations: JSONObject = asked["allocations"] as JSONObject;

            for (const provider of Object.keys(allocations)) {
              expect(
                (allocations[provider] as JSONObject)["resources"],
              ).toEqual(request.resources);
            }
          }

          if (flavor["name"] === "ou.gold") {
            expect(request.requiredTraits).toEqual(["CUSTOM_OU_GOLD"]);
          }
        }
      });
    });

    describe("a host lost, as Nova says and Placement doesn't", () => {
      test("Placement goes on offering it, and only Nova's say takes it back out", () => {
        const body: JSONObject = recordedJson(
          release,
          LOST,
          "candidates/placement-candidates-m1.medium.json",
        );
        const uuids: Array<string> = readOpenStackAllocationCandidates(
          body,
        ).map((candidate: { rootProviderUuid: string }): string => {
          return candidate.rootProviderUuid;
        });
        const providers: Array<JSONObject> = recordedJson(
          release,
          LOST,
          "placement/placement-providers.json",
        )["resource_providers"] as Array<JSONObject>;
        const lost: JSONObject = providers.find((row: JSONObject): boolean => {
          return row["name"] === "ou-cap-2";
        })!;

        expect(uuids).toContain(lost["uuid"]);
        // ou-cap-2 was the one host with room for an m1.medium, so now none has.
        expect(
          placementAnswered(LOST, "placement-candidates-m1.medium").byZone[
            ZONE
          ] ?? 0,
        ).toBe(0);
        expect(
          getOpenStackFlavorFit({
            resources: resourcesOf(LOST, "m1.medium"),
            hosts: zoneHosts(LOST),
          }).byZone[ZONE] ?? 0,
        ).toBe(0);
      });

      const ID: string = "openstack-reserved-headroom-gone";
      const ALIAS: string = "can_lose_a_host";

      function headroomOf(
        scene: string,
      ): OpenStackCapacitySnapshot["zones"][number]["headroom"] {
        return snapshotOfScene(release, scene).zones.find(
          (row: OpenStackCapacitySnapshot["zones"][number]): boolean => {
            return row.name === ZONE;
          },
        )!.headroom;
      }

      function zoneCanLoseAHost(scene: string): number {
        return seriesPoints(
          snapshotOfScene(release, scene),
          OPENSTACK_CAPACITY_CAN_LOSE_A_HOST_SERIES,
        )
          .filter((point: { labels: Record<string, string> }): boolean => {
            return point.labels["availability_zone"] === ZONE;
          })
          .reduce((worst: number, point: { value: number }): number => {
            return Math.min(worst, point.value);
          }, 1);
      }

      test("Reserved Headroom Gone stays quiet while the zone could lose its largest host", async () => {
        // 24576 MB - the largest, 10752, leaves 13824, and 12288 is allocated.
        expect(headroomOf(HEALTHY).state).toBe("can-lose-a-host");
        expect(zoneCanLoseAHost(HEALTHY)).toBe(1);
        expect(await judged(ID, ALIAS, zoneCanLoseAHost(HEALTHY))).toEqual({
          breached: false,
          healthy: true,
        });
      });

      test("fires when one is lost, and says by how much", async () => {
        // 7680 + 6144 left, less the largest of them, is 6144, and 12288 is still allocated.
        const headroom: OpenStackCapacitySnapshot["zones"][number]["headroom"] =
          headroomOf(LOST);

        expect(headroom.state).toBe("cannot-lose-a-host");
        expect(
          headroom.resources.find(
            (resource: { resourceClass: string }): boolean => {
              return resource.resourceClass === "MEMORY_MB";
            },
          )?.shortBy,
        ).toBe(6144);
        expect(zoneCanLoseAHost(LOST)).toBe(0);
        expect(await judged(ID, ALIAS, zoneCanLoseAHost(LOST))).toEqual({
          breached: true,
          healthy: false,
        });
      });

      test("the lost host isn't counted as room, and says so", () => {
        expect(
          snapshotOfScene(release, LOST).hostsNotCounted.map(
            (host: { name: string; state: string }): string => {
              return `${host.name} ${host.state}`;
            },
          ),
        ).toEqual(["ou-cap-2 lost"]);
      });
    });
  },
);

describe("Capacity Forecast Under N Days", () => {
  const ID: string = "openstack-capacity-forecast-under-days";
  const ALIAS: string = "days_until_full";
  const HOUR: number = 60 * 60 * 1000;

  /*
   * A real cloud's capacity, and a made-up week of what was allocated: what a week's growth looks
   * like isn't something a run of the rig can show.
   */
  function withHistory(
    samplesOf: (capacity: number) => Array<OpenStackGrowthSample>,
  ): OpenStackCapacitySnapshot {
    const snapshot: OpenStackCapacitySnapshot = snapshotOfScene(
      "hibiscus-ovn",
      "healthy",
    );
    const rows: ReturnType<typeof getOpenStackCapacitySeriesRows> =
      getOpenStackCapacitySeriesRows(snapshot);
    const history: Map<string, Array<OpenStackGrowthSample>> = new Map();

    for (const row of rows) {
      history.set(row.key, samplesOf(row.capacity));
    }

    return {
      ...snapshot,
      forecasts: getOpenStackCapacityForecasts({ rows, historyByKey: history }),
    };
  }

  function soonest(snapshot: OpenStackCapacitySnapshot): number | undefined {
    const points: Array<{ value: number }> = seriesPoints(
      snapshot,
      OPENSTACK_CAPACITY_DAYS_UNTIL_FULL_SERIES,
    );

    return points.length > 0
      ? Math.min(
          ...points.map((point: { value: number }): number => {
            return point.value;
          }),
        )
      : undefined;
  }

  test("a new cloud says it hasn't enough history, has no series, and stays quiet", async () => {
    const snapshot: OpenStackCapacitySnapshot = withHistory(() => {
      return [];
    });

    expect(snapshot.forecasts.length).toBeGreaterThan(0);

    for (const row of snapshot.forecasts) {
      expect(row.forecast).toEqual({ state: "not-enough-history" });
    }

    expect(soonest(snapshot)).toBeUndefined();
    expect(await judged(ID, ALIAS, soonest(snapshot))).toEqual({
      breached: false,
      healthy: true,
    });
  });

  test("under a day of history is still not enough, however fast it grows", () => {
    const start: number = NOW.getTime() - 20 * HOUR;
    const snapshot: OpenStackCapacitySnapshot = withHistory(
      (capacity: number) => {
        return [0, 10, 20].map((hour: number): OpenStackGrowthSample => {
          return {
            time: start + hour * HOUR,
            used: (capacity * hour) / 40,
          };
        });
      },
    );

    expect(snapshot.forecasts[0]!.forecast.state).toBe("not-enough-history");
  });

  test("something full in nine days at this week's growth fires", async () => {
    const start: number = NOW.getTime() - 7 * 24 * HOUR;
    // From 0 to 7/16 of it over seven days, so 9 more days to the rest.
    const snapshot: OpenStackCapacitySnapshot = withHistory(
      (capacity: number) => {
        return [0, 1, 2, 3, 4, 5, 6, 7].map(
          (day: number): OpenStackGrowthSample => {
            return {
              time: start + day * 24 * HOUR,
              used: (capacity * day) / 16,
            };
          },
        );
      },
    );

    expect(soonest(snapshot)).toBeCloseTo(9, 5);
    expect(await judged(ID, ALIAS, soonest(snapshot))).toEqual({
      breached: true,
      healthy: false,
    });
  });

  test("once it slows, it recovers", async () => {
    expect(await judged(ID, ALIAS, 30)).toEqual({
      breached: false,
      healthy: true,
    });
  });

  test("a line that isn't growing has nothing to project, and that recovers too", async () => {
    const start: number = NOW.getTime() - 7 * 24 * HOUR;
    const snapshot: OpenStackCapacitySnapshot = withHistory(
      (capacity: number) => {
        return [0, 1, 2, 3].map((day: number): OpenStackGrowthSample => {
          return { time: start + day * 24 * HOUR, used: capacity / 2 };
        });
      },
    );

    expect(snapshot.forecasts[0]!.forecast).toEqual({ state: "not-growing" });
    expect(soonest(snapshot)).toBeUndefined();
  });

  test("a zone whose every host is lost is full, whatever its history says", () => {
    const snapshot: OpenStackCapacitySnapshot = snapshotOfScene(
      "hibiscus-ovn",
      "compute-down",
    );

    expect(
      getOpenStackCapacityForecasts({
        rows: getOpenStackCapacitySeriesRows(snapshot),
        historyByKey: new Map(),
      })[0]!.forecast,
    ).toEqual({ state: "full" });
  });
});

describe("a large scrape, split across batches", () => {
  test("a total without its ratio writes no capacity, and says the host needs working out", () => {
    const lines: Array<string> = recorded(
      "hibiscus-ovn",
      "healthy",
      "placement",
    ).split("\n");
    const has: (word: string) => string = (word: string): string => {
      return lines
        .filter((line: string): boolean => {
          return line.startsWith(`openstack_placement_resource_${word}{`);
        })
        .join("\n");
    };

    const first: Array<OpenStackResourceBufferEntry> = scan([
      has("allocation_ratio"),
      has("usage"),
    ]);
    const second: Array<OpenStackResourceBufferEntry> = scan([
      has("total"),
      has("reserved"),
    ]);
    const third: Array<OpenStackResourceBufferEntry> = scan([has("total")]);

    // Only the reading of a total can be short of a ratio: a ratio alone says nothing of capacity.
    expect(getOpenStackHostsWithPartReadings(first)).toEqual([]);
    expect(first[0]!.vcpuCapacity).toBe(null);

    expect(second[0]!.vcpuCapacity).toBe(null);
    expect(getOpenStackHostsWithPartReadings(second)).toEqual([
      "compute-01.example.internal",
    ]);

    // Without this a total alone used to read as a 1:1 host: 4 where Placement promises 16.
    expect(third[0]!.vcpuCapacity).toBe(null);

    // Each batch writes the numbers it has, and the row ends up with them all.
    expect(
      readOpenStackCapacityHost({
        hypervisorName: "compute-01.example.internal",
        facts: { ...first[0]!.facts, ...second[0]!.facts },
      }).inventories["VCPU"],
    ).toEqual({ total: 4, reserved: 0, allocationRatio: 4, used: 3 });
  });

  test("a whole batch writes it as it always did, and asks nothing more", () => {
    const entries: Array<OpenStackResourceBufferEntry> = scan([
      recorded("hibiscus-ovn", "healthy", "placement"),
    ]);

    expect(entries[0]!.vcpuCapacity).toBe(16);
    expect(getOpenStackHostsWithPartReadings(entries)).toEqual([]);
  });
});
