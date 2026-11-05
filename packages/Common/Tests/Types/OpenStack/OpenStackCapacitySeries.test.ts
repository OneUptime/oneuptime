import { describe, expect, test } from "@jest/globals";
import { JSONArray, JSONObject } from "../../../Types/JSON";
import { OpenStackCapacityHost } from "../../../Types/OpenStack/OpenStackCapacity";
import {
  OPENSTACK_CAPACITY_ALLOCATED_SERIES,
  OPENSTACK_CAPACITY_CAN_LOSE_A_HOST_SERIES,
  OPENSTACK_CAPACITY_DAYS_UNTIL_FULL_SERIES,
  OPENSTACK_CAPACITY_FLAVOR_FITS_SERIES,
  OPENSTACK_CAPACITY_TOTAL_SERIES,
  OpenStackCapacitySeriesRow,
  buildOpenStackCapacityResourceMetrics,
  getOpenStackCapacitySeriesKey,
  getOpenStackCapacitySeriesRows,
  isOpenStackFlavorWatched,
} from "../../../Types/OpenStack/OpenStackCapacitySeries";
import {
  OpenStackCapacityFlavor,
  OpenStackCapacityFlavorRow,
  OpenStackCapacitySnapshot,
  buildOpenStackCapacitySnapshot,
} from "../../../Types/OpenStack/OpenStackCapacitySnapshot";
import { getOpenStackMetricByMetricName } from "../../../Types/Monitor/OpenStackMetricCatalog";

/*
 * What OneUptime writes from a snapshot: whatever a template or a page reads back is written with
 * the labels it is read by, and only what can be said is written at all.
 */

const NOW: Date = new Date("2026-11-04T12:00:00Z");

function host(
  name: string,
  used: number,
  extra?: Partial<OpenStackCapacityHost>,
): OpenStackCapacityHost {
  return {
    name,
    regionName: "RegionOne",
    zone: "nova",
    aggregates: [],
    state: "up",
    instanceCount: 0,
    inventories: {
      VCPU: { total: 10, reserved: 0, allocationRatio: 1, used },
      MEMORY_MB: { total: 8192, reserved: 0, allocationRatio: 1, used: 0 },
    },
    ...extra,
  };
}

function flavor(
  name: string,
  resources: Record<string, number>,
  extra?: Partial<OpenStackCapacityFlavor>,
): OpenStackCapacityFlavor {
  return {
    id: `id-${name}`,
    name,
    regionName: "RegionOne",
    request: { resources, requiredTraits: [], forbiddenTraits: [] },
    isPublic: true,
    isDisabled: false,
    instanceCount: 0,
    placementAnswer: null,
    ...extra,
  };
}

function snapshotOf(
  hosts: Array<OpenStackCapacityHost>,
  flavors: Array<OpenStackCapacityFlavor> = [],
): OpenStackCapacitySnapshot {
  return buildOpenStackCapacitySnapshot({
    hosts,
    flavors,
    pools: [
      {
        kind: "external-ip-pool",
        id: "net-1",
        name: "public",
        regionName: "RegionOne",
        used: 200,
        capacity: 253,
        percent: 79,
      },
      {
        kind: "storage-pool",
        id: "ceph#vms",
        name: "ceph#vms",
        regionName: "RegionOne",
        used: 1000,
        capacity: 4000,
        percent: 25,
      },
    ],
    now: NOW,
  });
}

interface Point {
  labels: Record<string, string>;
  value: number;
  time: string;
}

function pointsOf(resourceMetrics: JSONArray, name: string): Array<Point> {
  const points: Array<Point> = [];

  for (const resource of resourceMetrics as Array<JSONObject>) {
    for (const scope of resource["scopeMetrics"] as Array<JSONObject>) {
      for (const metric of scope["metrics"] as Array<JSONObject>) {
        if (metric["name"] !== name) {
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
          points.push({
            labels,
            value: point["asDouble"] as number,
            time: point["timeUnixNano"] as string,
          });
        }
      }
    }
  }

  return points;
}

function build(snapshot: OpenStackCapacitySnapshot): JSONArray {
  return buildOpenStackCapacityResourceMetrics({
    cloudName: "acme",
    now: NOW,
    snapshot,
  });
}

describe("what it writes", () => {
  const metrics: JSONArray = build(
    snapshotOf(
      [host("a", 4), host("b", 4)],
      [flavor("m1.small", { VCPU: 1, MEMORY_MB: 2048 })],
    ),
  );

  test("is the cloud's, stamped the way everything else of it is", () => {
    const resource: JSONObject = (metrics as Array<JSONObject>)[0]!;

    expect(resource["resource"]).toEqual({
      attributes: [
        { key: "openstack.cloud.name", value: { stringValue: "acme" } },
      ],
    });

    const point: Point = pointsOf(
      metrics,
      OPENSTACK_CAPACITY_FLAVOR_FITS_SERIES,
    )[0]!;

    expect(point.labels["openstack.region.name"]).toBe("RegionOne");
    expect(point.labels["openstack_service"]).toBe("placement");
    expect(point.time).toBe(`${NOW.getTime()}000000`);
  });

  test("how much of each thing that fills up is allocated, and what can be", () => {
    const allocated: Array<Point> = pointsOf(
      metrics,
      OPENSTACK_CAPACITY_ALLOCATED_SERIES,
    );
    const total: Array<Point> = pointsOf(
      metrics,
      OPENSTACK_CAPACITY_TOTAL_SERIES,
    );

    // VCPU and MEMORY_MB of one zone, an external network, and a pool.
    expect(allocated).toHaveLength(4);
    expect(total).toHaveLength(4);

    expect(
      allocated.find((point: Point): boolean => {
        return point.labels["resourcetype"] === "VCPU";
      }),
    ).toMatchObject({
      value: 8,
      labels: { capacity_scope: "zone", capacity_name: "nova" },
    });
    expect(
      total.find((point: Point): boolean => {
        return point.labels["resourcetype"] === "VCPU";
      })?.value,
    ).toBe(20);
    expect(
      allocated.find((point: Point): boolean => {
        return point.labels["capacity_scope"] === "external-ip-pool";
      }),
    ).toMatchObject({
      value: 200,
      labels: {
        capacity_name: "public",
        capacity_id: "net-1",
        resourcetype: "IPV4_ADDRESS",
      },
    });
    expect(
      allocated.find((point: Point): boolean => {
        return point.labels["capacity_scope"] === "storage-pool";
      }),
    ).toMatchObject({ value: 1000, labels: { resourcetype: "STORAGE_BYTES" } });
  });

  test("a zone's count of what lost hosts hold: those instances still exist", () => {
    const allocated: Array<Point> = pointsOf(
      build(snapshotOf([host("a", 4), host("b", 6, { state: "lost" })])),
      OPENSTACK_CAPACITY_ALLOCATED_SERIES,
    );

    expect(
      allocated.find((point: Point): boolean => {
        return point.labels["resourcetype"] === "VCPU";
      })?.value,
    ).toBe(10);
  });

  test("a name-less zone has no name label, and reads back as the same key", () => {
    const metricsOf: JSONArray = build(
      snapshotOf([host("a", 4, { zone: null })]),
    );
    const point: Point = pointsOf(
      metricsOf,
      OPENSTACK_CAPACITY_ALLOCATED_SERIES,
    ).find((candidate: Point): boolean => {
      return candidate.labels["capacity_scope"] === "zone";
    })!;

    expect(point.labels["capacity_name"]).toBeUndefined();
    expect(
      getOpenStackCapacitySeriesRows(snapshotOf([host("a", 4, { zone: null })]))
        .filter((row: OpenStackCapacitySeriesRow): boolean => {
          return row.scope === "zone" && row.resourceClass === "VCPU";
        })
        .map((row: OpenStackCapacitySeriesRow): string => {
          return row.key;
        }),
    ).toEqual([
      getOpenStackCapacitySeriesKey({
        regionName: "RegionOne",
        scope: "zone",
        name: null,
        id: null,
        resourceClass: "VCPU",
      }),
    ]);
  });
});

describe("whether a flavor is watched", () => {
  function rowOf(
    name: string,
    resources: Record<string, number>,
    extra?: Partial<OpenStackCapacityFlavor>,
    hosts: Array<OpenStackCapacityHost> = [host("a", 0)],
  ): OpenStackCapacityFlavorRow {
    return snapshotOf(hosts, [flavor(name, resources, extra)]).flavors[0]!;
  }

  test("a public one is, whatever it says", () => {
    expect(isOpenStackFlavorWatched(rowOf("a", { VCPU: 1 }))).toBe(true);
  });

  test("a private one is once someone runs it", () => {
    expect(
      isOpenStackFlavorWatched(rowOf("a", { VCPU: 1 }, { isPublic: false })),
    ).toBe(false);
    expect(
      isOpenStackFlavorWatched(
        rowOf("a", { VCPU: 1 }, { isPublic: false, instanceCount: 1 }),
      ),
    ).toBe(true);
  });

  test("one too large for every host never is: it was never going to be placed", () => {
    expect(isOpenStackFlavorWatched(rowOf("a", { VCPU: 11 }))).toBe(false);
  });

  test("one whose only room is on a host someone disabled isn't: planned work never pages", () => {
    expect(
      isOpenStackFlavorWatched(
        rowOf("a", { VCPU: 1 }, undefined, [
          host("a", 0, { state: "disabled" }),
        ]),
      ),
    ).toBe(false);
  });

  test("one whose only room is on a lost host is: that is what no longer means", () => {
    expect(
      isOpenStackFlavorWatched(
        rowOf("a", { VCPU: 1 }, undefined, [host("a", 0, { state: "lost" })]),
      ),
    ).toBe(true);
  });

  test("only what's watched has a series", () => {
    const points: Array<Point> = pointsOf(
      build(
        snapshotOf(
          [host("a", 0)],
          [
            flavor("fits", { VCPU: 1 }),
            flavor("too-large", { VCPU: 11 }),
            flavor("private", { VCPU: 1 }, { isPublic: false }),
          ],
        ),
      ),
      OPENSTACK_CAPACITY_FLAVOR_FITS_SERIES,
    );

    expect(
      points.map((point: Point): string => {
        return point.labels["flavor"] as string;
      }),
    ).toEqual(["fits"]);
    expect(points[0]!.labels).toMatchObject({
      flavor_id: "id-fits",
      source: "inventories",
    });
  });
});

describe("whether a zone can lose a host", () => {
  function pointsFor(hosts: Array<OpenStackCapacityHost>): Array<Point> {
    return pointsOf(
      build(snapshotOf(hosts)),
      OPENSTACK_CAPACITY_CAN_LOSE_A_HOST_SERIES,
    );
  }

  test("one per class: any one of them short reads 0 at Min", () => {
    const points: Array<Point> = pointsFor([host("a", 9), host("b", 9)]);

    expect(
      points
        .map((point: Point): [string, number] => {
          return [point.labels["resourcetype"] as string, point.value];
        })
        .sort(),
    ).toEqual([
      ["MEMORY_MB", 1],
      ["VCPU", 0],
    ]);
    expect(points[0]!.labels["availability_zone"]).toBe("nova");
  });

  test("a zone of one host has none", () => {
    expect(pointsFor([host("a", 9)])).toEqual([]);
  });

  test("a zone with a host someone disabled has none: an open incident recovers", () => {
    expect(
      pointsFor([
        host("a", 9),
        host("b", 9),
        host("c", 0, { state: "disabled" }),
      ]),
    ).toEqual([]);
  });

  test("a lost host doesn't excuse it", () => {
    expect(
      pointsFor([host("a", 9), host("b", 9), host("c", 0, { state: "lost" })])
        .length,
    ).toBeGreaterThan(0);
  });
});

describe("days until full", () => {
  const base: OpenStackCapacitySnapshot = snapshotOf([host("a", 4)]);

  function daysFor(
    forecast: OpenStackCapacitySnapshot["forecasts"][number]["forecast"],
  ): Array<Point> {
    return pointsOf(
      build({
        ...base,
        forecasts: [
          {
            scope: "zone",
            name: "nova",
            id: "",
            regionName: "RegionOne",
            resourceClass: "VCPU",
            forecast,
          },
        ],
      }),
      OPENSTACK_CAPACITY_DAYS_UNTIL_FULL_SERIES,
    );
  }

  test("a number when there is one, and 0 when it's full", () => {
    expect(daysFor({ state: "days", days: 9.5 })[0]!.value).toBe(9.5);
    expect(daysFor({ state: "full" })[0]!.value).toBe(0);
  });

  test("no series on a new cloud, or on something not growing", () => {
    expect(daysFor({ state: "not-enough-history" })).toEqual([]);
    expect(daysFor({ state: "not-growing" })).toEqual([]);
  });
});

describe("the catalogue", () => {
  test.each([
    OPENSTACK_CAPACITY_ALLOCATED_SERIES,
    OPENSTACK_CAPACITY_TOTAL_SERIES,
    OPENSTACK_CAPACITY_DAYS_UNTIL_FULL_SERIES,
    OPENSTACK_CAPACITY_FLAVOR_FITS_SERIES,
    OPENSTACK_CAPACITY_CAN_LOSE_A_HOST_SERIES,
  ])("%s is in it, and says OneUptime writes it", (name: string) => {
    expect(getOpenStackMetricByMetricName(name)?.fromCapacity).toBe(true);
  });

  test("an empty cloud writes nothing at all", () => {
    expect(
      build(
        buildOpenStackCapacitySnapshot({
          hosts: [],
          flavors: [],
          pools: [],
          now: NOW,
        }),
      ),
    ).toEqual([]);
  });
});
