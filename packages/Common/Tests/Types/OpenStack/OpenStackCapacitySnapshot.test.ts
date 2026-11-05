import { describe, expect, test } from "@jest/globals";
import { JSONObject } from "../../../Types/JSON";
import {
  OpenStackCapacityHost,
  OpenStackInventories,
  getOpenStackInventoryFactKey,
} from "../../../Types/OpenStack/OpenStackCapacity";
import {
  OPENSTACK_CAPACITY_AGGREGATE_LIMIT,
  OPENSTACK_CAPACITY_FLAVOR_LIMIT,
  OPENSTACK_CAPACITY_HOST_LIST_LIMIT,
  OPENSTACK_CAPACITY_MISMATCH_LIMIT,
  OPENSTACK_PLACEMENT_ANSWER_TRUSTED_MINUTES,
  OpenStackCapacityFlavor,
  OpenStackCapacityFlavorRow,
  OpenStackCapacityForecastRow,
  OpenStackCapacityMismatchRow,
  OpenStackCapacityShortage,
  OpenStackCapacitySnapshot,
  buildOpenStackCapacitySnapshot,
  carryOpenStackAllocationMismatches,
  getOpenStackBareMetalCapacityRows,
  getOpenStackCapacityFlavorRow,
  getOpenStackCapacityHeadline,
  getOpenStackCapacityShortages,
  isOpenStackAllocationMismatchLasting,
  isOpenStackFlavorOffered,
  readOpenStackCapacityExternalNetwork,
  readOpenStackCapacityFlavor,
  readOpenStackCapacityHost,
  readOpenStackCapacityStoragePool,
  readOpenStackPlacementAnswer,
} from "../../../Types/OpenStack/OpenStackCapacitySnapshot";
import {
  OPENSTACK_ALLOCATION_MISMATCH_MINUTES,
  OPENSTACK_CAPACITY_FORECAST_WARNING_DAYS,
} from "../../../Types/OpenStack/OpenStackHealthRules";
import { getOpenStackForecast } from "../../../Types/OpenStack/OpenStackForecast";

/*
 * WHAT THE PAGE READS, WORKED OUT FROM ROWS. Made-up rows in the shape the snapshot scan writes:
 * OpenStackCapacityRecordings.test.ts reads the same code on what a real exporter said.
 */

const NOW: Date = new Date("2026-11-04T12:00:00Z");

function hostOf(
  name: string,
  free: { vcpu: number; memoryMb: number; diskGb: number },
  extra?: Partial<OpenStackCapacityHost>,
): OpenStackCapacityHost {
  const inventories: OpenStackInventories = {
    VCPU: {
      total: free.vcpu,
      reserved: 0,
      allocationRatio: 1,
      used: 0,
      maxUnit: 100000,
    },
    MEMORY_MB: {
      total: free.memoryMb,
      reserved: 0,
      allocationRatio: 1,
      used: 0,
      maxUnit: 10000000,
    },
    DISK_GB: {
      total: free.diskGb,
      reserved: 0,
      allocationRatio: 1,
      used: 0,
      maxUnit: 1000000,
    },
  };

  return {
    name,
    regionName: "RegionOne",
    zone: "nova",
    aggregates: [],
    state: "up",
    instanceCount: 0,
    inventories,
    ...extra,
  };
}

function flavorOf(
  name: string,
  resources: Record<string, number>,
  extra?: Partial<OpenStackCapacityFlavor>,
): OpenStackCapacityFlavor {
  return {
    id: name,
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

const SMALL: Record<string, number> = { VCPU: 1, MEMORY_MB: 2048, DISK_GB: 20 };
const XLARGE: Record<string, number> = {
  VCPU: 8,
  MEMORY_MB: 16384,
  DISK_GB: 160,
};

function snapshotOf(data: {
  hosts?: Array<OpenStackCapacityHost>;
  flavors?: Array<OpenStackCapacityFlavor>;
  forecasts?: Array<OpenStackCapacityForecastRow>;
  mismatches?: Array<OpenStackCapacityMismatchRow>;
}): OpenStackCapacitySnapshot {
  return buildOpenStackCapacitySnapshot({
    hosts: data.hosts || [],
    flavors: data.flavors || [],
    pools: [],
    forecasts: data.forecasts,
    mismatches: data.mismatches,
    now: NOW,
  });
}

describe("reading the inventory's rows", () => {
  test("a hypervisor's row is a host", () => {
    expect(
      readOpenStackCapacityHost({
        hypervisorName: "compute-01.example.internal",
        name: "ignored",
        regionName: "RegionOne",
        availabilityZone: "nova",
        status: "up",
        adminState: "enabled",
        instanceCount: 3,
        facts: {
          aggregates: "ssd, gpu,,",
          [getOpenStackInventoryFactKey("VCPU", "total")]: 4,
          [getOpenStackInventoryFactKey("VCPU", "ratio")]: 4,
          [getOpenStackInventoryFactKey("VCPU", "used")]: 3,
        },
      }),
    ).toEqual({
      name: "compute-01.example.internal",
      regionName: "RegionOne",
      zone: "nova",
      aggregates: ["ssd", "gpu"],
      state: "up",
      instanceCount: 3,
      inventories: {
        VCPU: { total: 4, reserved: 0, allocationRatio: 4, used: 3 },
      },
    });
  });

  test("nova-compute stopped is lost, and disabled is disabled", () => {
    expect(
      readOpenStackCapacityHost({
        hypervisorName: "a",
        status: "down",
        adminState: "enabled",
      }).state,
    ).toBe("lost");
    expect(
      readOpenStackCapacityHost({
        hypervisorName: "a",
        status: "up",
        adminState: "disabled",
      }).state,
    ).toBe("disabled");
  });

  test("an agent's flavor asks for what the exporter says of it, as Postgres hands it back", () => {
    const flavor: OpenStackCapacityFlavor = readOpenStackCapacityFlavor({
      row: {
        externalId: "RegionOne/2",
        name: "m1.small",
        regionName: "RegionOne",
        vcpuCapacity: 1,
        // A bigint comes back from Postgres as text.
        memoryCapacityBytes: `${2048 * 1024 * 1024}`,
        diskCapacityBytes: `${20 * 1024 * 1024 * 1024}`,
        facts: { isPublic: true },
      },
      instanceCount: 7,
    });

    expect(flavor.id).toBe("2");
    expect(flavor.request.resources).toEqual({
      VCPU: 1,
      MEMORY_MB: 2048,
      DISK_GB: 20,
    });
    expect(flavor.isPublic).toBe(true);
    expect(flavor.instanceCount).toBe(7);
    expect(flavor.placementAnswer).toBe(null);
  });

  test("a probe's flavor says what Nova would really ask for, which outranks the row's numbers", () => {
    const flavor: OpenStackCapacityFlavor = readOpenStackCapacityFlavor({
      row: {
        externalId: "RegionOne/baremetal",
        name: "bm.gold",
        regionName: "RegionOne",
        vcpuCapacity: 64,
        facts: {
          placementResources: "CUSTOM_BAREMETAL_GOLD:1",
          placementRequired: "CUSTOM_RACK_A,",
          placementForbidden: "CUSTOM_SLOW",
          isDisabled: true,
        },
      },
      instanceCount: 0,
    });

    expect(flavor.request).toEqual({
      resources: { CUSTOM_BAREMETAL_GOLD: 1 },
      requiredTraits: ["CUSTOM_RACK_A"],
      forbiddenTraits: ["CUSTOM_SLOW"],
    });
    expect(flavor.isDisabled).toBe(true);
    expect(flavor.isPublic).toBe(null);
  });

  test("a row with no region keeps its whole id", () => {
    expect(
      readOpenStackCapacityFlavor({
        row: { externalId: "default/42", name: "x" },
        instanceCount: 0,
      }).id,
    ).toBe("42");
  });

  test.each<[string, JSONObject, boolean]>([
    ["no answer", {}, false],
    ["not an object", { placementAnswer: "13" }, false],
    ["a list", { placementAnswer: [] }, false],
    ["no time", { placementAnswer: { fits: 1 } }, false],
    [
      "no count",
      { placementAnswer: { askedAt: "2026-11-04T12:00:00Z" } },
      false,
    ],
    [
      "a whole one",
      { placementAnswer: { askedAt: "2026-11-04T12:00:00Z", fits: 0 } },
      true,
    ],
  ])(
    "what Placement said: %s",
    (_name: string, facts: JSONObject, isRead: boolean) => {
      expect(readOpenStackPlacementAnswer(facts) !== null).toBe(isRead);
    },
  );

  test("a pool and an external network read what fills up, in bytes and in IPv4 addresses", () => {
    expect(
      readOpenStackCapacityStoragePool({
        name: "ceph#vms",
        regionName: "RegionOne",
        diskCapacityBytes: "1000",
        diskAllocatedBytes: "250",
      }),
    ).toEqual({
      kind: "storage-pool",
      id: "ceph#vms",
      name: "ceph#vms",
      regionName: "RegionOne",
      used: 250,
      capacity: 1000,
      percent: 25,
    });
    expect(
      readOpenStackCapacityExternalNetwork({
        externalId: "net-1",
        name: "public",
        regionName: "RegionOne",
        facts: { isExternal: true, ipsUsed: 200, ipsTotal: 253 },
      }),
    ).toMatchObject({
      kind: "external-ip-pool",
      id: "net-1",
      name: "public",
      used: 200,
      capacity: 253,
    });
  });

  test("a tenant's network, and a pool that doesn't say how big it is, aren't anyone's capacity", () => {
    expect(
      readOpenStackCapacityExternalNetwork({
        externalId: "net-1",
        facts: { isExternal: false, ipsUsed: 200, ipsTotal: 253 },
      }),
    ).toBe(null);
    expect(
      readOpenStackCapacityExternalNetwork({
        externalId: "net-1",
        facts: { isExternal: true },
      }),
    ).toBe(null);
    expect(
      readOpenStackCapacityStoragePool({ name: "a", diskCapacityBytes: 0 }),
    ).toBe(null);
    expect(
      readOpenStackCapacityStoragePool({
        diskCapacityBytes: 10,
        diskAllocatedBytes: 1,
      }),
    ).toBe(null);
  });
});

describe("one flavor's row", () => {
  const hosts: Array<OpenStackCapacityHost> = [
    hostOf("a", { vcpu: 10, memoryMb: 4096, diskGb: 100 }, { zone: "zone-a" }),
    hostOf("b", { vcpu: 10, memoryMb: 8192, diskGb: 100 }, { zone: "zone-b" }),
  ];

  test("with nothing but inventories, it says it calculated", () => {
    const row: OpenStackCapacityFlavorRow = getOpenStackCapacityFlavorRow({
      flavor: flavorOf("m1.small", SMALL),
      hosts,
      now: NOW,
    });

    expect(row.source).toBe("inventories");
    expect(row.askedAt).toBe(null);
    expect(row.fits).toBe(6);
    expect(row.byZone).toEqual({ "zone-a": 2, "zone-b": 4 });
    expect(row.isAtLeast).toBe(false);
  });

  test("with Placement's answer, it says that, and what it counted wins", () => {
    const row: OpenStackCapacityFlavorRow = getOpenStackCapacityFlavorRow({
      flavor: flavorOf("m1.small", SMALL, {
        placementAnswer: {
          askedAt: new Date(NOW.getTime() - 10 * 60_000).toISOString(),
          fits: 3,
          hostsWithRoom: 1,
          isCapped: false,
          byZone: { "zone-a": 3 },
          byAggregate: { gold: 3 },
        },
      }),
      hosts,
      now: NOW,
    });

    expect(row.source).toBe("placement");
    expect(row.fits).toBe(3);
    expect(row.hostsWithRoom).toBe(1);
    expect(row.byZone).toEqual({ "zone-a": 3 });
    expect(row.byAggregate).toEqual({ gold: 3 });
    // How spread out it is, only inventories can say.
    expect(row.fitsIfOnePool).toBe(6);
  });

  test("a capped answer is a floor, and says so", () => {
    const row: OpenStackCapacityFlavorRow = getOpenStackCapacityFlavorRow({
      flavor: flavorOf("m1.small", SMALL, {
        placementAnswer: {
          askedAt: NOW.toISOString(),
          fits: 3400,
          hostsWithRoom: 1000,
          isCapped: true,
          byZone: {},
          byAggregate: {},
        },
      }),
      hosts,
      now: NOW,
    });

    expect(row.isAtLeast).toBe(true);
    expect(row.fits).toBe(3400);
  });

  test("an answer the probe stopped repeating is no answer, and inventories are what's left", () => {
    const answer: (askedAgoInMinutes: number) => OpenStackCapacityFlavorRow = (
      askedAgoInMinutes: number,
    ): OpenStackCapacityFlavorRow => {
      return getOpenStackCapacityFlavorRow({
        flavor: flavorOf("m1.small", SMALL, {
          placementAnswer: {
            askedAt: new Date(
              NOW.getTime() - askedAgoInMinutes * 60_000,
            ).toISOString(),
            fits: 3,
            hostsWithRoom: 1,
            isCapped: false,
            byZone: {},
            byAggregate: {},
          },
        }),
        hosts,
        now: NOW,
      });
    };

    expect(answer(OPENSTACK_PLACEMENT_ANSWER_TRUSTED_MINUTES).source).toBe(
      "placement",
    );
    expect(answer(OPENSTACK_PLACEMENT_ANSWER_TRUSTED_MINUTES + 1).source).toBe(
      "inventories",
    );
  });

  test("a time that can't be read is no answer either", () => {
    expect(
      getOpenStackCapacityFlavorRow({
        flavor: flavorOf("m1.small", SMALL, {
          placementAnswer: {
            askedAt: "not a time",
            fits: 3,
            hostsWithRoom: 1,
            isCapped: false,
            byZone: {},
            byAggregate: {},
          },
        }),
        hosts,
        now: NOW,
      }).source,
    ).toBe("inventories");
  });

  test("too large for every host is a flavor nothing here ever could place", () => {
    const row: OpenStackCapacityFlavorRow = getOpenStackCapacityFlavorRow({
      flavor: flavorOf("ou.impossible", { VCPU: 1, MEMORY_MB: 1048576 }),
      hosts,
      now: NOW,
    });

    expect(row.fits).toBe(0);
    expect(row.isTooLargeForEveryHost).toBe(true);
    expect(row.limitedBy).toBe("MEMORY_MB");
  });

  test("Placement finding room outranks a sum that found none: it knows more", () => {
    expect(
      getOpenStackCapacityFlavorRow({
        flavor: flavorOf(
          "custom",
          { VCPU: 1, MEMORY_MB: 1048576 },
          {
            placementAnswer: {
              askedAt: NOW.toISOString(),
              fits: 2,
              hostsWithRoom: 1,
              isCapped: false,
              byZone: {},
              byAggregate: {},
            },
          },
        ),
        hosts,
        now: NOW,
      }).isTooLargeForEveryHost,
    ).toBe(false);
  });

  test("room only on a host someone disabled is planned work, not a shortage", () => {
    const row: OpenStackCapacityFlavorRow = getOpenStackCapacityFlavorRow({
      flavor: flavorOf("m1.small", SMALL),
      hosts: [
        hostOf(
          "a",
          { vcpu: 10, memoryMb: 8192, diskGb: 100 },
          { state: "disabled" },
        ),
      ],
      now: NOW,
    });

    expect(row.fits).toBe(0);
    expect(row.isOnlyOnDisabledHosts).toBe(true);
    expect(row.isTooLargeForEveryHost).toBe(false);
  });

  test("a required trait says what only Placement can answer", () => {
    expect(
      getOpenStackCapacityFlavorRow({
        flavor: flavorOf("gold", SMALL, {
          request: {
            resources: SMALL,
            requiredTraits: ["CUSTOM_GOLD"],
            forbiddenTraits: [],
          },
        }),
        hosts,
        now: NOW,
      }).hasRequiredTraits,
    ).toBe(true);
  });
});

describe("the whole cloud", () => {
  test("adds up by zone, aggregate, region and cloud, and a flavor only counts in its region", () => {
    const snapshot: OpenStackCapacitySnapshot = snapshotOf({
      hosts: [
        hostOf(
          "a",
          { vcpu: 10, memoryMb: 8192, diskGb: 100 },
          { zone: "zone-a", aggregates: ["ssd"] },
        ),
        hostOf(
          "b",
          { vcpu: 10, memoryMb: 8192, diskGb: 100 },
          { zone: "zone-b", aggregates: ["ssd"] },
        ),
        hostOf(
          "c",
          { vcpu: 10, memoryMb: 8192, diskGb: 100 },
          { regionName: "RegionTwo", zone: "zone-a" },
        ),
      ],
      flavors: [
        flavorOf("m1.small", SMALL),
        flavorOf("m1.small", SMALL, { regionName: "RegionTwo" }),
      ],
    });

    expect(snapshot.generatedAt).toBe(NOW.toISOString());
    expect(snapshot.cloud.hostCount).toBe(3);
    expect(snapshot.cloud.resources[0]!.capacity).toBe(30);
    expect(
      snapshot.regions.map((region) => {
        return [region.regionName, region.hostCount];
      }),
    ).toEqual([
      ["RegionOne", 2],
      ["RegionTwo", 1],
    ]);
    expect(
      snapshot.zones.map((zone) => {
        return [zone.regionName, zone.name, zone.hostCount];
      }),
    ).toEqual([
      ["RegionOne", "zone-a", 1],
      ["RegionOne", "zone-b", 1],
      ["RegionTwo", "zone-a", 1],
    ]);
    expect(
      snapshot.aggregates.map((aggregate) => {
        return [aggregate.name, aggregate.hostCount];
      }),
    ).toEqual([["ssd", 2]]);
    expect(
      snapshot.flavors.map((flavor) => {
        return [flavor.regionName, flavor.fits];
      }),
    ).toEqual([
      ["RegionOne", 8],
      ["RegionTwo", 4],
    ]);
  });

  test("a zone says whether it can lose a host, and hosts in no zone are together", () => {
    const snapshot: OpenStackCapacitySnapshot = snapshotOf({
      hosts: [
        hostOf("a", { vcpu: 10, memoryMb: 8192, diskGb: 100 }, { zone: null }),
        hostOf("b", { vcpu: 10, memoryMb: 8192, diskGb: 100 }, { zone: null }),
      ],
    });

    expect(snapshot.zones).toHaveLength(1);
    expect(snapshot.zones[0]!.name).toBe("");
    expect(snapshot.zones[0]!.headroom.state).toBe("can-lose-a-host");
  });

  test("what really runs comes from whoever knows, per zone", () => {
    const seen: Array<Array<string>> = [];
    const snapshot: OpenStackCapacitySnapshot = buildOpenStackCapacitySnapshot({
      hosts: [
        hostOf("a", { vcpu: 10, memoryMb: 8192, diskGb: 100 }, { zone: "z" }),
      ],
      flavors: [],
      pools: [],
      overcommitOf: (hosts: ReadonlyArray<OpenStackCapacityHost>) => {
        seen.push(
          hosts.map((host: OpenStackCapacityHost) => {
            return host.name;
          }),
        );
        return [];
      },
      now: NOW,
    });

    expect(seen).toEqual([["a"]]);
    expect(snapshot.zones[0]!.overcommit).toEqual([]);
  });

  test("hosts that can't give are named, which is why the numbers are lower", () => {
    const snapshot: OpenStackCapacitySnapshot = snapshotOf({
      hosts: [
        hostOf(
          "lost",
          { vcpu: 10, memoryMb: 8192, diskGb: 100 },
          { state: "lost", instanceCount: 42 },
        ),
        hostOf(
          "disabled",
          { vcpu: 10, memoryMb: 8192, diskGb: 100 },
          { state: "disabled" },
        ),
        hostOf("up", { vcpu: 10, memoryMb: 8192, diskGb: 100 }),
      ],
    });

    expect(snapshot.hostsNotCounted).toEqual([
      {
        name: "lost",
        regionName: "RegionOne",
        zone: "nova",
        state: "lost",
        instanceCount: 42,
      },
      {
        name: "disabled",
        regionName: "RegionOne",
        zone: "nova",
        state: "disabled",
        instanceCount: 0,
      },
    ]);
  });

  test("a disabled flavor nobody can ask for isn't on it, and neither is one asking for nothing", () => {
    expect(
      snapshotOf({
        flavors: [
          flavorOf("a", SMALL, { isDisabled: true }),
          flavorOf("b", {}),
          flavorOf("c", SMALL),
        ],
      }).flavors.map((flavor: OpenStackCapacityFlavorRow) => {
        return flavor.name;
      }),
    ).toEqual(["c"]);
  });

  test("flavors are in the order people use them, then public ones, then by name", () => {
    expect(
      snapshotOf({
        flavors: [
          flavorOf("m1.b", SMALL),
          flavorOf("private", SMALL, { isPublic: false }),
          flavorOf("m1.a", SMALL),
          flavorOf("busy", SMALL, { instanceCount: 3, isPublic: false }),
        ],
      }).flavors.map((flavor: OpenStackCapacityFlavorRow) => {
        return flavor.name;
      }),
    ).toEqual(["busy", "m1.a", "m1.b", "private"]);
  });

  describe("holds no more than it says, however large the cloud", () => {
    const manyHosts: Array<OpenStackCapacityHost> = [];
    for (let index: number = 0; index < 5000; index++) {
      manyHosts.push(
        hostOf(
          `compute-${index}`,
          { vcpu: 64, memoryMb: 256000, diskGb: 2000 },
          {
            zone: `zone-${index % 4}`,
            aggregates: [`rack-${index % 500}`],
            state: index % 100 === 0 ? "lost" : "up",
          },
        ),
      );
    }
    const manyFlavors: Array<OpenStackCapacityFlavor> = [];
    for (let index: number = 0; index < 1000; index++) {
      manyFlavors.push(
        flavorOf(
          `flavor-${index}`,
          { VCPU: 1 + (index % 16), MEMORY_MB: 1024 },
          {
            instanceCount: index === 999 ? 5 : 0,
          },
        ),
      );
    }

    const snapshot: OpenStackCapacitySnapshot = snapshotOf({
      hosts: manyHosts,
      flavors: manyFlavors,
    });

    test("a table's limit, and how many were left out", () => {
      expect(snapshot.flavors).toHaveLength(OPENSTACK_CAPACITY_FLAVOR_LIMIT);
      expect(snapshot.flavorsLeftOut).toBe(
        1000 - OPENSTACK_CAPACITY_FLAVOR_LIMIT,
      );
      expect(snapshot.aggregates).toHaveLength(
        OPENSTACK_CAPACITY_AGGREGATE_LIMIT,
      );
      expect(snapshot.aggregatesLeftOut).toBe(
        500 - OPENSTACK_CAPACITY_AGGREGATE_LIMIT,
      );
      expect(snapshot.hostsNotCounted).toHaveLength(
        OPENSTACK_CAPACITY_HOST_LIST_LIMIT,
      );
      expect(snapshot.hostsNotCountedLeftOut).toBe(0);
    });

    test("what people use is the last to be left out", () => {
      expect(snapshot.flavors[0]!.name).toBe("flavor-999");
    });

    test("it is small enough to keep on a row and read back in one go", () => {
      // 500 aggregates on 200 flavors cap at 100 each: this is the largest shape there is.
      expect(JSON.stringify(snapshot).length).toBeLessThan(2 * 1024 * 1024);
    });
  });
});

describe("allocations that go on disagreeing", () => {
  const found = {
    regionName: "RegionOne",
    hypervisorName: "compute-01",
    vcpuExcess: 2,
    memoryMbExcess: 1024,
    instanceCount: 3,
  };

  test("the first time it is seen is when it started", () => {
    expect(
      carryOpenStackAllocationMismatches({
        found: [found],
        previous: [],
        now: NOW,
      }),
    ).toEqual([{ ...found, since: NOW.toISOString() }]);
  });

  test("it keeps that time for as long as it goes on", () => {
    expect(
      carryOpenStackAllocationMismatches({
        found: [{ ...found, vcpuExcess: 4 }],
        previous: [{ ...found, since: "2026-11-01T00:00:00.000Z" }],
        now: NOW,
      }),
    ).toEqual([{ ...found, vcpuExcess: 4, since: "2026-11-01T00:00:00.000Z" }]);
  });

  test("one that stopped is forgotten", () => {
    expect(
      carryOpenStackAllocationMismatches({
        found: [],
        previous: [{ ...found, since: "2026-11-01T00:00:00.000Z" }],
        now: NOW,
      }),
    ).toEqual([]);
  });

  test("the same name in another region is another host", () => {
    expect(
      carryOpenStackAllocationMismatches({
        found: [{ ...found, regionName: "RegionTwo" }],
        previous: [{ ...found, since: "2026-11-01T00:00:00.000Z" }],
        now: NOW,
      })[0]!.since,
    ).toBe(NOW.toISOString());
  });

  test("what holds the most comes first, and a list has a limit", () => {
    const many: Array<typeof found> = [];
    for (let index: number = 0; index < 300; index++) {
      many.push({ ...found, hypervisorName: `h-${index}`, vcpuExcess: index });
    }
    const carried: Array<OpenStackCapacityMismatchRow> =
      carryOpenStackAllocationMismatches({
        found: many,
        previous: [],
        now: NOW,
      });

    expect(carried).toHaveLength(OPENSTACK_CAPACITY_MISMATCH_LIMIT);
    expect(carried[0]!.vcpuExcess).toBe(299);
  });

  test("only what has lasted is a finding", () => {
    const at: (minutesAgo: number) => boolean = (
      minutesAgo: number,
    ): boolean => {
      return isOpenStackAllocationMismatchLasting(
        { since: new Date(NOW.getTime() - minutesAgo * 60_000).toISOString() },
        NOW,
      );
    };

    expect(at(OPENSTACK_ALLOCATION_MISMATCH_MINUTES - 1)).toBe(false);
    expect(at(OPENSTACK_ALLOCATION_MISMATCH_MINUTES)).toBe(true);
    expect(
      isOpenStackAllocationMismatchLasting({ since: "not a time" }, NOW),
    ).toBe(false);
  });
});

describe("what is short, soonest first", () => {
  const roomy: OpenStackCapacityHost = hostOf("a", {
    vcpu: 100,
    memoryMb: 8192,
    diskGb: 1000,
  });

  function forecastOf(
    name: string,
    days: number,
    extra?: Partial<OpenStackCapacityForecastRow>,
  ): OpenStackCapacityForecastRow {
    return {
      scope: "zone",
      name,
      id: "",
      regionName: "RegionOne",
      resourceClass: "VCPU",
      forecast: { state: "days", days },
      ...extra,
    };
  }

  function shortages(
    snapshot: OpenStackCapacitySnapshot,
    regionName: string | null = null,
  ): Array<string> {
    return getOpenStackCapacityShortages({
      snapshot,
      regionName,
      now: NOW,
    }).map((shortage: OpenStackCapacityShortage): string => {
      return `${shortage.kind}:${shortage.name}`;
    });
  }

  test("a cloud with room and no forecasts has nothing to say", () => {
    expect(
      shortages(
        snapshotOf({ hosts: [roomy], flavors: [flavorOf("m1.small", SMALL)] }),
      ),
    ).toEqual([]);
  });

  test("a flavor that can't be placed is short now, and says how far from one pool it is", () => {
    const halfFull: (name: string) => OpenStackCapacityHost = (
      name: string,
    ): OpenStackCapacityHost => {
      return {
        ...hostOf(name, { vcpu: 100, memoryMb: 20000, diskGb: 1000 }),
        inventories: {
          ...hostOf(name, { vcpu: 100, memoryMb: 20000, diskGb: 1000 })
            .inventories,
          MEMORY_MB: {
            total: 20000,
            reserved: 0,
            allocationRatio: 1,
            used: 10000,
            maxUnit: 20000,
          },
        },
      };
    };

    const [shortage] = getOpenStackCapacityShortages({
      snapshot: snapshotOf({
        hosts: [halfFull("a"), halfFull("b")],
        flavors: [flavorOf("m1.xlarge", XLARGE, { instanceCount: 4 })],
      }),
      regionName: null,
      now: NOW,
    });

    expect(shortage).toMatchObject({
      kind: "flavor-cannot-be-placed",
      name: "m1.xlarge",
      days: 0,
      isUrgent: true,
      // 20000 MB free in two pieces, which would be one of them as one pool.
      fitsIfOnePool: 1,
      flavorInUse: 4,
    });
  });

  test("a flavor too large for every host was never going to be placed, so it isn't short", () => {
    expect(
      shortages(
        snapshotOf({
          hosts: [roomy],
          flavors: [flavorOf("ou.impossible", XLARGE)],
        }),
      ),
    ).toEqual([]);
  });

  test("room only on a disabled host is planned work, so it isn't short", () => {
    expect(
      shortages(
        snapshotOf({
          hosts: [
            hostOf(
              "a",
              { vcpu: 100, memoryMb: 8192, diskGb: 1000 },
              { state: "disabled" },
            ),
          ],
          flavors: [flavorOf("m1.small", SMALL)],
        }),
      ),
    ).toEqual([]);
  });

  test("a private flavor nobody runs can't stop anyone", () => {
    const full: OpenStackCapacityHost = hostOf("a", {
      vcpu: 1,
      memoryMb: 16000,
      diskGb: 1000,
    });
    const flavor: OpenStackCapacityFlavor = flavorOf(
      "private",
      { VCPU: 2, MEMORY_MB: 1024 },
      {
        isPublic: false,
        placementAnswer: {
          askedAt: NOW.toISOString(),
          fits: 0,
          hostsWithRoom: 0,
          isCapped: false,
          byZone: {},
          byAggregate: {},
        },
      },
    );

    // Past max_unit here: Placement having said zero is what makes it no longer too large.
    expect(shortages(snapshotOf({ hosts: [full], flavors: [flavor] }))).toEqual(
      [],
    );
    expect(
      isOpenStackFlavorOffered({ isPublic: false, instanceCount: 1 }),
    ).toBe(true);
    expect(
      isOpenStackFlavorOffered({ isPublic: false, instanceCount: 0 }),
    ).toBe(false);
    expect(isOpenStackFlavorOffered({ isPublic: null, instanceCount: 0 })).toBe(
      true,
    );
  });

  test("a zone that can't lose a host is short now, and one with a disabled host never is", () => {
    const tight: (name: string) => OpenStackCapacityHost = (
      name: string,
    ): OpenStackCapacityHost => {
      return {
        ...roomy,
        name,
        inventories: {
          VCPU: { total: 10, reserved: 0, allocationRatio: 1, used: 9 },
        },
      };
    };

    expect(shortages(snapshotOf({ hosts: [tight("a"), tight("b")] }))).toEqual([
      "headroom-gone:nova",
    ]);
    expect(
      shortages(
        snapshotOf({
          hosts: [tight("a"), tight("b"), { ...tight("c"), state: "disabled" }],
        }),
      ),
    ).toEqual([]);
  });

  test("forecasts in order, soonest first, and only out to a quarter", () => {
    expect(
      shortages(
        snapshotOf({
          forecasts: [
            forecastOf("later", 60),
            forecastOf("soon", 9),
            forecastOf("too-far", 91),
            forecastOf("not-growing", 0, {
              forecast: { state: "not-growing" },
            }),
            forecastOf("new-cloud", 0, {
              forecast: { state: "not-enough-history" },
            }),
            forecastOf("full-now", 0, { forecast: { state: "full" } }),
          ],
        }),
      ),
    ).toEqual(["full:full-now", "fills-up:soon", "fills-up:later"]);
  });

  test("urgent is the line the template draws, and no other", () => {
    const line: number = OPENSTACK_CAPACITY_FORECAST_WARNING_DAYS;
    const [under, at] = getOpenStackCapacityShortages({
      snapshot: snapshotOf({
        forecasts: [forecastOf("at", line), forecastOf("under", line - 0.5)],
      }),
      regionName: null,
      now: NOW,
    });

    expect(under!.name).toBe("under");
    expect(under!.isUrgent).toBe(true);
    expect(at!.isUrgent).toBe(false);
  });

  test("an allocation only counts as an orphan once it has lasted, and last on the list", () => {
    const old: string = new Date(NOW.getTime() - 3 * 60 * 60_000).toISOString();
    const mismatch: OpenStackCapacityMismatchRow = {
      regionName: "RegionOne",
      hypervisorName: "compute-9",
      vcpuExcess: 2,
      memoryMbExcess: 0,
      instanceCount: 1,
      since: old,
    };

    expect(
      shortages(
        snapshotOf({
          forecasts: [forecastOf("soon", 9)],
          mismatches: [
            mismatch,
            { ...mismatch, hypervisorName: "new", since: NOW.toISOString() },
            // Less than its instances explain holds nothing back, whatever heal_allocations says.
            {
              ...mismatch,
              hypervisorName: "under",
              vcpuExcess: -2,
              memoryMbExcess: 0,
            },
          ],
        }),
      ),
    ).toEqual(["fills-up:soon", "allocations-disagree:compute-9"]);
  });

  test("a region reads only what's in it", () => {
    const snapshot: OpenStackCapacitySnapshot = snapshotOf({
      forecasts: [
        forecastOf("mine", 9),
        forecastOf("theirs", 8, { regionName: "RegionTwo" }),
      ],
    });

    expect(shortages(snapshot)).toEqual(["fills-up:theirs", "fills-up:mine"]);
    expect(shortages(snapshot, "RegionOne")).toEqual(["fills-up:mine"]);
  });

  test("what's the same day reads in the order that matters most", () => {
    const hosts: Array<OpenStackCapacityHost> = [
      {
        ...roomy,
        name: "a",
        inventories: {
          VCPU: { total: 10, reserved: 0, allocationRatio: 1, used: 9 },
        },
      },
      {
        ...roomy,
        name: "b",
        inventories: {
          VCPU: { total: 10, reserved: 0, allocationRatio: 1, used: 9 },
        },
      },
    ];

    expect(
      shortages(
        snapshotOf({
          hosts,
          flavors: [flavorOf("m1.small", { VCPU: 8 })],
          forecasts: [forecastOf("z", 0, { forecast: { state: "full" } })],
        }),
      ),
    ).toEqual([
      "flavor-cannot-be-placed:m1.small",
      "full:z",
      "headroom-gone:nova",
    ]);
  });
});

describe("the first line of the page", () => {
  test("room for what people run most, and none of what's largest", () => {
    const snapshot: OpenStackCapacitySnapshot = snapshotOf({
      hosts: [hostOf("a", { vcpu: 100, memoryMb: 8192, diskGb: 1000 })],
      flavors: [
        flavorOf("m1.small", SMALL, { instanceCount: 340 }),
        // Past what's free, and within what an empty host could hold.
        flavorOf(
          "m1.large",
          { VCPU: 4, MEMORY_MB: 8192 },
          {
            placementAnswer: {
              askedAt: NOW.toISOString(),
              fits: 0,
              hostsWithRoom: 0,
              isCapped: false,
              byZone: {},
              byAggregate: {},
            },
          },
        ),
      ],
    });

    expect(
      getOpenStackCapacityHeadline({ snapshot, regionName: null }),
    ).toEqual({
      hasRoom: { name: "m1.small", fits: 4, isAtLeast: false },
      noRoom: { name: "m1.large" },
    });
  });

  test("with room for everything it says so", () => {
    expect(
      getOpenStackCapacityHeadline({
        snapshot: snapshotOf({
          hosts: [hostOf("a", { vcpu: 100, memoryMb: 8192, diskGb: 1000 })],
          flavors: [flavorOf("m1.small", SMALL)],
        }),
        regionName: null,
      }),
    ).toEqual({
      hasRoom: { name: "m1.small", fits: 4, isAtLeast: false },
      noRoom: null,
    });
  });

  test("a flavor nothing could ever place isn't what anyone is waiting for", () => {
    expect(
      getOpenStackCapacityHeadline({
        snapshot: snapshotOf({
          hosts: [hostOf("a", { vcpu: 100, memoryMb: 1024, diskGb: 1000 })],
          flavors: [flavorOf("ou.impossible", XLARGE)],
        }),
        regionName: null,
      }),
    ).toBe(null);
  });

  test("a cloud with no flavors has no first line", () => {
    expect(
      getOpenStackCapacityHeadline({
        snapshot: snapshotOf({}),
        regionName: null,
      }),
    ).toBe(null);
  });
});

describe("a forecast", () => {
  const HOUR: number = 60 * 60 * 1000;
  const start: number = NOW.getTime() - 48 * HOUR;

  test("waits for as much history as it is told to", () => {
    const samples: Array<{ time: number; used: number }> = [
      { time: start, used: 10 },
      { time: start + 6 * HOUR, used: 12 },
      { time: start + 12 * HOUR, used: 14 },
    ];

    expect(getOpenStackForecast({ samples, capacity: 100 }).state).toBe("days");
    expect(
      getOpenStackForecast({ samples, capacity: 100, minimumHours: 24 }).state,
    ).toBe("not-enough-history");
  });

  test("a new cloud says it can't tell, whichever way it is heading", () => {
    expect(
      getOpenStackForecast({ samples: [], capacity: 100, minimumHours: 24 }),
    ).toEqual({ state: "not-enough-history" });
  });

  test("full is full, whatever the history", () => {
    expect(
      getOpenStackForecast({
        samples: [{ time: start, used: 100 }],
        capacity: 100,
        minimumHours: 24,
      }),
    ).toEqual({ state: "full" });
  });

  test("in days at the rate it is growing", () => {
    // 1 a day from 50 with 100 of capacity: fifty days.
    const samples: Array<{ time: number; used: number }> = [];
    for (let day: number = 0; day <= 7; day++) {
      samples.push({ time: start + day * 24 * HOUR, used: 43 + day });
    }

    const forecast: ReturnType<typeof getOpenStackForecast> =
      getOpenStackForecast({ samples, capacity: 100, minimumHours: 24 });

    expect(forecast.state).toBe("days");
    expect(forecast.state === "days" && forecast.days).toBeCloseTo(50, 5);
  });
});

describe("bare metal, by resource class", () => {
  function nodeOf(
    name: string,
    inventory: { reserved: number; used: number },
    extra?: Partial<OpenStackCapacityHost>,
  ): OpenStackCapacityHost {
    return {
      name,
      regionName: "RegionOne",
      zone: null,
      aggregates: [],
      state: "up",
      instanceCount: 0,
      inventories: {
        CUSTOM_GOLD: {
          total: 1,
          reserved: inventory.reserved,
          allocationRatio: 1,
          used: inventory.used,
        },
      },
      ...extra,
    };
  }

  const NODES: Array<OpenStackCapacityHost> = [
    nodeOf("free", { reserved: 0, used: 0 }),
    // In use: Nova's Ironic driver reserves a node with an instance on it as well.
    nodeOf("deployed", { reserved: 1, used: 1 }),
    nodeOf("with-its-reservation-skipped", { reserved: 0, used: 1 }),
    nodeOf("in-maintenance", { reserved: 1, used: 0 }),
  ];

  const ASKS_FOR_GOLD: Record<string, number> = { CUSTOM_GOLD: 1 };

  function classFlavor(
    resources: Record<string, number>,
    extra?: Partial<OpenStackCapacityFlavor>,
  ): OpenStackCapacityFlavor {
    return { ...flavorOf("bm.gold", resources), ...extra };
  }

  test("each node is in exactly one of what is free, in use and held back", () => {
    expect(getOpenStackBareMetalCapacityRows(NODES)).toEqual([
      {
        regionName: "RegionOne",
        resourceClass: "CUSTOM_GOLD",
        nodeCount: 4,
        free: 1,
        used: 2,
        heldBack: 1,
      },
    ]);
  });

  test("each region and class is its own, most nodes first", () => {
    const rows: Array<{ regionName: string | null; resourceClass: string }> =
      getOpenStackBareMetalCapacityRows([
        nodeOf("a", { reserved: 0, used: 0 }, { regionName: "RegionTwo" }),
        nodeOf("b", { reserved: 0, used: 0 }),
        {
          ...nodeOf("c", { reserved: 0, used: 0 }),
          inventories: {
            CUSTOM_SILVER: {
              total: 1,
              reserved: 0,
              allocationRatio: 1,
              used: 0,
            },
          },
        },
        {
          ...nodeOf("d", { reserved: 0, used: 0 }),
          inventories: {
            CUSTOM_SILVER: {
              total: 1,
              reserved: 0,
              allocationRatio: 1,
              used: 0,
            },
          },
        },
      ]);

    expect(
      rows.map((row: { regionName: string | null; resourceClass: string }) => {
        return `${row.regionName}/${row.resourceClass}`;
      }),
    ).toEqual([
      "RegionOne/CUSTOM_SILVER",
      "RegionOne/CUSTOM_GOLD",
      "RegionTwo/CUSTOM_GOLD",
    ]);
  });

  test("a node is no host: it isn't in any host's sums, count or list of what isn't counted", () => {
    const snapshot: OpenStackCapacitySnapshot = buildOpenStackCapacitySnapshot({
      hosts: [],
      bareMetalProviders: NODES,
      flavors: [],
      pools: [],
      now: NOW,
    });

    expect(snapshot.cloud.hostCount).toBe(0);
    expect(snapshot.cloud.resources).toEqual([]);
    expect(snapshot.regions).toEqual([]);
    expect(snapshot.zones).toEqual([]);
    expect(snapshot.hostsNotCounted).toEqual([]);
    expect(snapshot.bareMetalClasses?.[0]?.nodeCount).toBe(4);
  });

  test("a cloud without any has nothing to say", () => {
    expect(
      buildOpenStackCapacitySnapshot({
        hosts: [],
        flavors: [],
        pools: [],
        now: NOW,
      }).bareMetalClasses,
    ).toEqual([]);
  });

  test("a flavor that asks for its class is counted against those nodes", () => {
    const row: OpenStackCapacityFlavorRow = getOpenStackCapacityFlavorRow({
      flavor: classFlavor(ASKS_FOR_GOLD),
      hosts: [],
      bareMetalProviders: NODES,
      now: NOW,
    });

    expect(row.fits).toBe(1);
    expect(row.hostsWithRoom).toBe(1);
    expect(row.isTooLargeForEveryHost).toBe(false);
  });

  test("every node of it held back is none for now, and no flavor too large for anything", () => {
    const row: OpenStackCapacityFlavorRow = getOpenStackCapacityFlavorRow({
      flavor: classFlavor(ASKS_FOR_GOLD),
      hosts: [],
      bareMetalProviders: [nodeOf("in-maintenance", { reserved: 1, used: 0 })],
      now: NOW,
    });

    expect(row.fits).toBe(0);
    expect(row.isTooLargeForEveryHost).toBe(false);
    expect(row.limitedBy).toBe("CUSTOM_GOLD");
  });

  test("a flavor that asks for vCPUs is never counted on one", () => {
    const row: OpenStackCapacityFlavorRow = getOpenStackCapacityFlavorRow({
      flavor: classFlavor(SMALL),
      hosts: [],
      bareMetalProviders: NODES,
      now: NOW,
    });

    expect(row.fits).toBe(0);
    expect(row.isTooLargeForEveryHost).toBe(true);
  });

  test("only its own region's are counted, because a flavor means nothing in another", () => {
    const snapshot: OpenStackCapacitySnapshot = buildOpenStackCapacitySnapshot({
      hosts: [],
      bareMetalProviders: [
        nodeOf(
          "elsewhere",
          { reserved: 0, used: 0 },
          { regionName: "RegionTwo" },
        ),
      ],
      flavors: [classFlavor(ASKS_FOR_GOLD)],
      pools: [],
      now: NOW,
    });

    expect(snapshot.flavors[0]?.fits).toBe(0);
  });

  test("a class a real host holds still counts that host", () => {
    const row: OpenStackCapacityFlavorRow = getOpenStackCapacityFlavorRow({
      flavor: classFlavor({ CUSTOM_GOLD: 1 }),
      hosts: [
        {
          ...hostOf("gpu-host", { vcpu: 1, memoryMb: 1, diskGb: 1 }),
          inventories: {
            CUSTOM_GOLD: {
              total: 2,
              reserved: 0,
              allocationRatio: 1,
              used: 0,
            },
          },
        },
      ],
      bareMetalProviders: [nodeOf("free", { reserved: 0, used: 0 })],
      now: NOW,
    });

    expect(row.fits).toBe(3);
  });

  test("a flavor's row from a probe reads what it really asks for", () => {
    const read: OpenStackCapacityFlavor = readOpenStackCapacityFlavor({
      row: {
        externalId: "RegionOne/bm-gold",
        name: "bm.gold",
        regionName: "RegionOne",
        vcpuCapacity: 16,
        memoryCapacityBytes: 1024,
        diskCapacityBytes: 1024,
        facts: { placementResources: "CUSTOM_GOLD:1" },
      },
      instanceCount: 0,
    });

    expect(read.request.resources).toEqual(ASKS_FOR_GOLD);
  });
});
