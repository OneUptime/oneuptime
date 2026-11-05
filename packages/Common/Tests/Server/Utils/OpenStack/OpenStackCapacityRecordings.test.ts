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
  getOpenStackAllocationMismatches,
} from "../../../../Types/OpenStack/OpenStackCapacity";
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
    value === undefined
      ? {}
      : { [alias]: new Array<number>(10).fill(value) };

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
      const vcpu: JSONObject = snapshot.cloud.resources[0] as unknown as JSONObject;

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
      const flavorResources: Map<string, Readonly<Record<string, number>>> =
        new Map();

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
          instances: instances.map(
            (entry: OpenStackResourceBufferEntry) => {
              return {
                regionName: entry.regionName,
                hypervisorName: entry.hypervisorName as string,
                flavorId: entry.facts["flavorId"] as string,
                count: 1,
                movingCount: 0,
              };
            },
          ),
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
   * a second name, with what each has allocated scaled by hand. Until the rig's capacity scenes are
   * read here (OpenStackCapacityRecordings is where they go), this is hand-checked.
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
