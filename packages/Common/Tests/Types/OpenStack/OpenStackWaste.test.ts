import { describe, expect, test } from "@jest/globals";
import {
  OpenStackCapacityHost,
  OpenStackInstancesOnHost,
  OpenStackInventory,
} from "../../../Types/OpenStack/OpenStackCapacity";
import { readOpenStackPriceList } from "../../../Types/OpenStack/OpenStackPriceList";
import {
  OPENSTACK_WASTE_FLOATING_IP_DAYS,
  OPENSTACK_WASTE_IMAGE_DAYS,
  OPENSTACK_WASTE_INSTANCE_DAYS,
  OPENSTACK_WASTE_ITEMS_KEPT,
  OPENSTACK_WASTE_ROWS_READ,
  OPENSTACK_WASTE_RULES,
  OPENSTACK_WASTE_SNAPSHOT_DAYS,
  OPENSTACK_WASTE_VOLUME_DAYS,
  OpenStackMovableHostFlavor,
  OpenStackWasteFinding,
  OpenStackWasteInput,
  OpenStackWasteItem,
  OpenStackWasteRow,
  OpenStackWasteRuleId,
  OpenStackWasteRuleWords,
  getOpenStackImagesInUse,
  getOpenStackMovableHosts,
  getOpenStackWasteFindings,
  getOpenStackWasteSince,
  isOpenStackFloatingIpWaste,
  isOpenStackImageWaste,
  isOpenStackInstanceWaste,
  isOpenStackSnapshotWaste,
  isOpenStackVolumeWaste,
} from "../../../Types/OpenStack/OpenStackWaste";

const NOW: Date = new Date("2026-12-15T12:00:00.000Z");
const DAY_MS: number = 24 * 60 * 60 * 1000;

function daysAgo(days: number): string {
  return new Date(NOW.getTime() - days * DAY_MS).toISOString();
}

function row(data: Partial<OpenStackWasteRow>): OpenStackWasteRow {
  return {
    externalId: "id",
    name: "name",
    regionName: "RegionOne",
    openStackProjectId: "project",
    createdAt: daysAgo(400),
    stateChangedAt: daysAgo(400),
    diskCapacityBytes: 10 * 1024 * 1024 * 1024,
    facts: {},
    ...data,
  };
}

describe("a volume attached to nothing", () => {
  const volume: (data: Partial<OpenStackWasteRow>) => OpenStackWasteRow = (
    data: Partial<OpenStackWasteRow>,
  ): OpenStackWasteRow => {
    return row({
      status: "available",
      facts: { attachedToInstance: null },
      ...data,
    });
  };

  test.each([
    ["available and detached for over 30 days", volume({}), true],
    ["exactly 30 days", volume({ stateChangedAt: daysAgo(30) }), true],
    ["29 days is not yet", volume({ stateChangedAt: daysAgo(29) }), false],
    [
      "attached, whatever its status says",
      volume({ facts: { attachedToInstance: "server-1" } }),
      false,
    ],
    ["in use", volume({ status: "in-use" }), false],
    ["attaching", volume({ status: "attaching" }), false],
    ["detaching", volume({ status: "detaching" }), false],
    ["being backed up", volume({ status: "backing-up" }), false],
    ["being restored", volume({ status: "restoring-backup" }), false],
    ["in error is a fault, not waste", volume({ status: "error" }), false],
    ["reserved", volume({ status: "reserved" }), false],
    [
      "a row that doesn't say whether it's attached",
      volume({ facts: {} }),
      false,
    ],
    [
      "a row with no date is never old",
      volume({ stateChangedAt: null, createdAt: null }),
      false,
    ],
    [
      "a date that can't be read is never old",
      volume({ stateChangedAt: "not a date", createdAt: "not a date" }),
      false,
    ],
    [
      "a date ahead of now is never old",
      volume({ stateChangedAt: daysAgo(-40) }),
      false,
    ],
    [
      "the cloud's own clock says it changed yesterday, though OneUptime's seen no change",
      volume({
        facts: { attachedToInstance: null, updatedAt: daysAgo(1) },
      }),
      false,
    ],
    [
      "connected today, and the cloud's own clock says a year ago",
      volume({
        createdAt: daysAgo(0),
        stateChangedAt: daysAgo(0),
        facts: { attachedToInstance: null, updatedAt: daysAgo(365) },
      }),
      true,
    ],
    [
      "connected today, with nothing but OneUptime's own sight to go on",
      volume({ createdAt: daysAgo(0), stateChangedAt: daysAgo(0) }),
      false,
    ],
  ])("%s", (_name: string, given: OpenStackWasteRow, expected: boolean) => {
    expect(isOpenStackVolumeWaste({ row: given, now: NOW })).toBe(expected);
  });
});

describe("a floating IP nothing is using", () => {
  const address: (data: Partial<OpenStackWasteRow>) => OpenStackWasteRow = (
    data: Partial<OpenStackWasteRow>,
  ): OpenStackWasteRow => {
    return row({ status: "DOWN", facts: { routerId: null }, ...data });
  };

  test.each([
    ["no router and no port for over 7 days", address({}), true],
    ["exactly 7 days", address({ stateChangedAt: daysAgo(7) }), true],
    ["6 days is not yet", address({ stateChangedAt: daysAgo(6) }), false],
    [
      "associated through a router, though its instance is off and it reads DOWN",
      address({ facts: { routerId: "router-1" } }),
      false,
    ],
    [
      "associated with a port",
      address({ facts: { routerId: null, portId: "port-1" } }),
      false,
    ],
    [
      "reads ACTIVE with no router: it has lost a label, not its use",
      address({ status: "ACTIVE" }),
      false,
    ],
    [
      "a row that doesn't say what it goes through",
      address({ facts: {} }),
      false,
    ],
    ["no date", address({ stateChangedAt: null, createdAt: null }), false],
  ])("%s", (_name: string, given: OpenStackWasteRow, expected: boolean) => {
    expect(isOpenStackFloatingIpWaste({ row: given, now: NOW })).toBe(expected);
  });
});

describe("an instance shut off for a long time", () => {
  test.each([
    ["SHUTOFF for over 30 days", "SHUTOFF", daysAgo(31), true],
    ["exactly 30 days", "SHUTOFF", daysAgo(30), true],
    ["29 days is not yet", "SHUTOFF", daysAgo(29), false],
    ["running", "ACTIVE", daysAgo(400), false],
    ["paused holds a running guest", "PAUSED", daysAgo(400), false],
    ["suspended holds a saved guest", "SUSPENDED", daysAgo(400), false],
    ["shelved has given it all back", "SHELVED_OFFLOADED", daysAgo(400), false],
    ["being resized", "RESIZE", daysAgo(400), false],
    ["being rebuilt", "REBUILD", daysAgo(400), false],
    ["failed is a fault, not waste", "ERROR", daysAgo(400), false],
  ])(
    "%s",
    (_name: string, status: string, since: string, expected: boolean) => {
      expect(
        isOpenStackInstanceWaste({
          row: row({ status, stateChangedAt: since }),
          now: NOW,
        }),
      ).toBe(expected);
    },
  );

  test("an instance touched last week, by the cloud's own clock, isn't called forgotten", () => {
    expect(
      isOpenStackInstanceWaste({
        row: row({
          status: "SHUTOFF",
          facts: { updatedAt: daysAgo(7) },
        }),
        now: NOW,
      }),
    ).toBe(false);
  });
});

describe("an image nothing was booted from", () => {
  const inUse: Set<string> = new Set(["used"]);
  const image: (data: Partial<OpenStackWasteRow>) => OpenStackWasteRow = (
    data: Partial<OpenStackWasteRow>,
  ): OpenStackWasteRow => {
    return row({
      externalId: "spare",
      status: "active",
      facts: {
        visibility: "private",
        createdAtSeconds: (NOW.getTime() - 100 * DAY_MS) / 1000,
      },
      ...data,
    });
  };

  test.each([
    ["private, old and unused", image({}), inUse, true],
    [
      "shared counts as well",
      image({
        facts: {
          visibility: "shared",
          createdAtSeconds: (NOW.getTime() - 100 * DAY_MS) / 1000,
        },
      }),
      inUse,
      true,
    ],
    ["an instance runs on it", image({ externalId: "used" }), inUse, false],
    [
      "public: what people boot from next",
      image({
        facts: {
          visibility: "public",
          createdAtSeconds: (NOW.getTime() - 100 * DAY_MS) / 1000,
        },
      }),
      inUse,
      false,
    ],
    [
      "community: the same",
      image({
        facts: {
          visibility: "community",
          createdAtSeconds: (NOW.getTime() - 100 * DAY_MS) / 1000,
        },
      }),
      inUse,
      false,
    ],
    [
      "protected: someone said to keep it",
      image({
        facts: {
          visibility: "private",
          isProtected: true,
          createdAtSeconds: (NOW.getTime() - 100 * DAY_MS) / 1000,
        },
      }),
      inUse,
      false,
    ],
    [
      "uploaded this week, and it just hasn't been used yet",
      image({
        facts: {
          visibility: "private",
          createdAtSeconds:
            (NOW.getTime() - (OPENSTACK_WASTE_IMAGE_DAYS - 1) * DAY_MS) / 1000,
        },
      }),
      inUse,
      false,
    ],
    ["not active", image({ status: "queued" }), inUse, false],
    ["deactivated by hand", image({ status: "deactivated" }), inUse, false],
    ["a row with no visibility", image({ facts: {} }), inUse, false],
    ["a cloud that can't say what's in use", image({}), null, false],
  ])(
    "%s",
    (
      _name: string,
      given: OpenStackWasteRow,
      imagesInUse: Set<string> | null,
      expected: boolean,
    ) => {
      expect(isOpenStackImageWaste({ row: given, imagesInUse, now: NOW })).toBe(
        expected,
      );
    },
  );

  test("what's in use is what instances and volumes say. None is a boot from a volume", () => {
    expect(
      Array.from(
        getOpenStackImagesInUse({
          instanceImageIds: ["a", null],
          volumeImageIds: ["b"],
          instancesNotSaying: 0,
        })!,
      ).sort(),
    ).toEqual(["a", "b"]);
  });

  test("one instance not saying means nobody can say: an image in use would read as unused", () => {
    expect(
      getOpenStackImagesInUse({
        instanceImageIds: ["a"],
        volumeImageIds: [],
        instancesNotSaying: 1,
      }),
    ).toBeNull();
  });
});

describe("an old snapshot", () => {
  test.each([
    [
      "by the cloud's clock, over 90 days",
      { createdAt: daysAgo(91) },
      "available",
      true,
    ],
    [
      "by the cloud's clock, 89 days",
      { createdAt: daysAgo(89) },
      "available",
      false,
    ],
    ["being made", { createdAt: daysAgo(91) }, "creating", false],
    ["being deleted", { createdAt: daysAgo(91) }, "deleting", false],
    ["in error", { createdAt: daysAgo(91) }, "error", false],
  ])(
    "%s",
    (
      _name: string,
      facts: Record<string, string>,
      status: string,
      expected: boolean,
    ) => {
      expect(
        isOpenStackSnapshotWaste({
          row: row({ status, facts, createdAt: daysAgo(0) }),
          now: NOW,
        }),
      ).toBe(expected);
    },
  );

  test("with no clock from the cloud, how long OneUptime has seen it is all there is", () => {
    expect(
      isOpenStackSnapshotWaste({
        row: row({ status: "available", createdAt: daysAgo(100) }),
        now: NOW,
      }),
    ).toBe(true);
    expect(
      isOpenStackSnapshotWaste({
        row: row({ status: "available", createdAt: daysAgo(10) }),
        now: NOW,
      }),
    ).toBe(false);
  });
});

describe("since when a row has been as it is", () => {
  test("a status seen to change, later than the cloud's stopped clock, wins", () => {
    expect(
      getOpenStackWasteSince(
        row({
          createdAt: daysAgo(100),
          stateChangedAt: daysAgo(5),
          facts: { updatedAt: daysAgo(90) },
        }),
      ),
    ).toBe(new Date(daysAgo(5)).getTime());
  });

  test("the cloud's clock, later than a status seen to change, wins too", () => {
    expect(
      getOpenStackWasteSince(
        row({
          createdAt: daysAgo(100),
          stateChangedAt: daysAgo(50),
          facts: { updatedAt: daysAgo(3) },
        }),
      ),
    ).toBe(new Date(daysAgo(3)).getTime());
  });

  test("a row with no status change falls back on when it was first seen", () => {
    expect(
      getOpenStackWasteSince(
        row({ stateChangedAt: null, createdAt: daysAgo(12) }),
      ),
    ).toBe(new Date(daysAgo(12)).getTime());
  });
});

/*
 * THE HOST RULE BY HAND.
 *
 * Three hosts of a zone, each offering 40 vCPUs and 40 GB of memory (40,960 MB), 1,000 GB of disk.
 * A flavor "small" asks 2 vCPUs, 2,048 MB, 20 GB. 90% of a host's memory is 36,864 MB.
 *
 *   busy-1   holds 15 small:  30 vCPUs, 30,720 MB  allocated 75%
 *   busy-2   holds 15 small:  30 vCPUs, 30,720 MB  allocated 75%
 *   quiet    holds  2 small:   4 vCPUs,  4,096 MB  allocated 10%: idle
 *
 * quiet's two instances each fit on busy-1 (10 vCPUs and 10,240 MB free). Moved there, busy-1 holds
 * 34 vCPUs and 34,816 MB. Without quiet, the zone has 80 vCPUs and 81,920 MB of capacity, 64 vCPUs
 * and 65,536 MB in use. Lose one of the two: 40 vCPUs left, and 64 in use won't fit, so the zone
 * could not lose a host. So on this estate quiet is NOT named, and the first test says why. Add a
 * fourth host and it could.
 */
function inventory(used: number, total: number): OpenStackInventory {
  return { total, reserved: 0, allocationRatio: 1, used };
}

function host(
  name: string,
  smallCount: number,
  extra: Partial<OpenStackCapacityHost> = {},
): OpenStackCapacityHost {
  return {
    name,
    regionName: "RegionOne",
    zone: "nova",
    aggregates: [],
    state: "up",
    instanceCount: smallCount,
    inventories: {
      VCPU: inventory(smallCount * 2, 40),
      MEMORY_MB: inventory(smallCount * 2048, 40960),
      DISK_GB: inventory(smallCount * 20, 1000),
    },
    ...extra,
  };
}

const SMALL: OpenStackMovableHostFlavor = {
  regionName: "RegionOne",
  flavorId: "small",
  resources: { VCPU: 2, MEMORY_MB: 2048, DISK_GB: 20 },
};

function onHost(
  name: string,
  count: number,
  movingCount: number = 0,
  flavorId: string | null = "small",
): OpenStackInstancesOnHost {
  return {
    regionName: "RegionOne",
    hypervisorName: name,
    flavorId,
    count,
    movingCount,
  };
}

function movable(
  hosts: Array<OpenStackCapacityHost>,
  rows?: Array<OpenStackInstancesOnHost>,
): Array<string | null> {
  return getOpenStackMovableHosts({
    hosts,
    instancesOnHosts:
      rows ||
      hosts.map((entry: OpenStackCapacityHost): OpenStackInstancesOnHost => {
        return onHost(entry.name, entry.instanceCount);
      }),
    flavors: [SMALL],
  }).map((item: OpenStackWasteItem): string | null => {
    return item.name;
  });
}

describe("a hypervisor that could be emptied", () => {
  test("the estate worked by hand above: it fits, but the zone couldn't then lose a host", () => {
    expect(
      movable([host("busy-1", 15), host("busy-2", 15), host("quiet", 2)]),
    ).toEqual([]);
  });

  test("with a fourth host the zone can still lose one, so quiet is named", () => {
    /*
     * Four hosts: 3 x 40 = 120 vCPUs without quiet, 64 + 8 in use across busy-1, -2 and -3 (each 10
     * small, 20 vCPUs: 60, and quiet's 4 moved: 64). Lose one, and 80 remain. 64 fits.
     */
    const hosts: Array<OpenStackCapacityHost> = [
      host("busy-1", 10),
      host("busy-2", 10),
      host("busy-3", 10),
      host("quiet", 2),
    ];

    expect(movable(hosts)).toEqual(["quiet"]);
  });

  test("what it frees is the whole host, as Placement offers it", () => {
    const items: Array<OpenStackWasteItem> = getOpenStackMovableHosts({
      hosts: [
        host("busy-1", 10),
        host("busy-2", 10),
        host("busy-3", 10),
        host("quiet", 2),
      ],
      instancesOnHosts: [
        onHost("busy-1", 10),
        onHost("busy-2", 10),
        onHost("busy-3", 10),
        onHost("quiet", 2),
      ],
      flavors: [SMALL],
    });

    expect(items.length).toBe(1);
    expect(items[0]!.frees).toEqual({
      storageGb: 0,
      floatingIps: 0,
      vcpus: 40,
      memoryGb: 40,
      diskGb: 1000,
      hosts: 1,
    });
    expect(items[0]!.instanceCount).toBe(2);
  });

  test("an empty host has nothing to move, and is named if the zone can spare it", () => {
    expect(
      movable([
        host("busy-1", 10),
        host("busy-2", 10),
        host("busy-3", 10),
        host("empty", 0),
      ]),
    ).toEqual(["empty"]);
  });

  test("hosts are taken emptiest first, each on what the last one left, so all of it can be done", () => {
    /*
     * quiet-1 and quiet-2 can't both go. Without quiet-1, 3 x 40 = 120 vCPUs with 40 + 4 in use: lose
     * one and 80 remain: fine. Without quiet-2 too, 2 x 40 = 80 with 40 + 4 + 4 in use: lose one and 40
     * remain, under 48. So only the emptier is named.
     */
    expect(
      movable([
        host("busy-1", 10),
        host("busy-2", 10),
        host("quiet-1", 2),
        host("quiet-2", 1),
      ]),
    ).toEqual(["quiet-2"]);
  });

  test.each([
    [
      "a zone with a host lost is in no state to give up another",
      [
        host("busy-1", 10),
        host("busy-2", 10),
        host("busy-3", 10, { state: "lost" }),
        host("quiet", 2),
      ],
    ],
    [
      "a zone with a host disabled has one taken out on purpose already",
      [
        host("busy-1", 10),
        host("busy-2", 10),
        host("busy-3", 10, { state: "disabled" }),
        host("quiet", 2),
      ],
    ],
    ["one host alone can't move anywhere", [host("quiet", 2)]],
    [
      "two hosts: the one left couldn't lose a host",
      [host("busy-1", 2), host("quiet", 1)],
    ],
    [
      "a host in no zone isn't judged",
      [
        host("busy-1", 10, { zone: null }),
        host("busy-2", 10, { zone: null }),
        host("busy-3", 10, { zone: null }),
        host("quiet", 2, { zone: null }),
      ],
    ],
    [
      "a host in an aggregate has nowhere to go if nothing else is in it",
      [
        host("busy-1", 10),
        host("busy-2", 10),
        host("busy-3", 10),
        host("quiet", 2, { aggregates: ["gpu"] }),
      ],
    ],
    [
      "over a fifth of its memory promised is not idle",
      [
        host("busy-1", 10),
        host("busy-2", 10),
        host("busy-3", 10),
        host("quiet", 2, {
          inventories: {
            VCPU: inventory(4, 40),
            MEMORY_MB: inventory(20000, 40960),
            DISK_GB: inventory(40, 1000),
          },
        }),
      ],
    ],
    [
      "over a fifth of its vCPUs promised is not idle",
      [
        host("busy-1", 10),
        host("busy-2", 10),
        host("busy-3", 10),
        host("quiet", 2, {
          inventories: {
            VCPU: inventory(20, 40),
            MEMORY_MB: inventory(4096, 40960),
            DISK_GB: inventory(40, 1000),
          },
        }),
      ],
    ],
  ])("%s", (_name: string, hosts: Array<OpenStackCapacityHost>) => {
    expect(movable(hosts)).toEqual([]);
  });

  test("a host with something on its way isn't judged", () => {
    expect(
      movable(
        [
          host("busy-1", 10),
          host("busy-2", 10),
          host("busy-3", 10),
          host("quiet", 2),
        ],
        [
          onHost("busy-1", 10),
          onHost("busy-2", 10),
          onHost("busy-3", 10),
          onHost("quiet", 2, 1),
        ],
      ),
    ).toEqual([]);
  });

  test("a host holding a flavor nobody can size isn't judged", () => {
    expect(
      movable(
        [
          host("busy-1", 10),
          host("busy-2", 10),
          host("busy-3", 10),
          host("quiet", 2),
        ],
        [
          onHost("busy-1", 10),
          onHost("busy-2", 10),
          onHost("busy-3", 10),
          onHost("quiet", 2, 0, "unknown"),
        ],
      ),
    ).toEqual([]);
  });

  test("a host whose count disagrees with the instances found on it has something unaccounted for", () => {
    expect(
      movable(
        [
          host("busy-1", 10),
          host("busy-2", 10),
          host("busy-3", 10),
          host("quiet", 2, { instanceCount: 3 }),
        ],
        [
          onHost("busy-1", 10),
          onHost("busy-2", 10),
          onHost("busy-3", 10),
          onHost("quiet", 2),
        ],
      ),
    ).toEqual([]);
  });

  test("a host with more allocated than its instances explain has an orphan on it, and moving them wouldn't empty it", () => {
    expect(
      movable([
        host("busy-1", 10),
        host("busy-2", 10),
        host("busy-3", 10),
        host("quiet", 1, {
          inventories: {
            VCPU: inventory(4, 40),
            MEMORY_MB: inventory(4096, 40960),
            DISK_GB: inventory(40, 1000),
          },
        }),
      ]),
    ).toEqual([]);
  });

  test("a flavor split across hosts' spare room isn't room: what's left fits nowhere whole", () => {
    /*
     * "wide" asks 12 vCPUs. quiet holds one (12 of 100 vCPUs: 12%). Each other host has 10 vCPUs free
     * of its 100: 30 free in all, and not 12 in one place. So it stays put.
     */
    const wide: OpenStackMovableHostFlavor = {
      regionName: "RegionOne",
      flavorId: "wide",
      resources: { VCPU: 12, MEMORY_MB: 2048, DISK_GB: 20 },
    };
    const big: (name: string, vcpuUsed: number) => OpenStackCapacityHost = (
      name: string,
      vcpuUsed: number,
    ): OpenStackCapacityHost => {
      return {
        name,
        regionName: "RegionOne",
        zone: "nova",
        aggregates: [],
        state: "up",
        instanceCount: name === "quiet" ? 1 : 0,
        inventories: {
          VCPU: inventory(vcpuUsed, 100),
          MEMORY_MB: inventory(2048, 409600),
          DISK_GB: inventory(20, 10000),
        },
      };
    };

    expect(
      getOpenStackMovableHosts({
        hosts: [big("a", 90), big("b", 90), big("c", 90), big("quiet", 12)],
        instancesOnHosts: [onHost("quiet", 1, 0, "wide")],
        flavors: [wide],
      }),
    ).toEqual([]);
  });

  test("Nova's short and long names for a host are one host", () => {
    expect(
      movable(
        [
          host("busy-1.example.internal", 10),
          host("busy-2.example.internal", 10),
          host("busy-3.example.internal", 10),
          host("quiet.example.internal", 2),
        ],
        [
          onHost("busy-1", 10),
          onHost("busy-2", 10),
          onHost("busy-3", 10),
          onHost("quiet", 2),
        ],
      ),
    ).toEqual(["quiet.example.internal"]);
  });

  test("zones are judged apart, and what's in one has no room to go to the other", () => {
    expect(
      movable([
        host("a-1", 10, { zone: "a" }),
        host("a-2", 10, { zone: "a" }),
        host("a-3", 10, { zone: "a" }),
        host("a-quiet", 2, { zone: "a" }),
        host("b-1", 18, { zone: "b" }),
        host("b-2", 18, { zone: "b" }),
        host("b-quiet", 2, { zone: "b" }),
      ]),
    ).toEqual(["a-quiet"]);
  });
});

function input(data: Partial<OpenStackWasteInput>): OpenStackWasteInput {
  return {
    volumes: [],
    floatingIps: [],
    instances: [],
    images: [],
    snapshots: [],
    flavorOf: () => {
      return null;
    },
    imagesInUse: new Set<string>(),
    snapshotsAreReported: true,
    movableHosts: [],
    priceList: null,
    now: NOW,
    ...data,
  };
}

function findingOf(
  findings: Array<OpenStackWasteFinding>,
  rule: OpenStackWasteRuleId,
): OpenStackWasteFinding {
  return findings.find((finding: OpenStackWasteFinding): boolean => {
    return finding.rule === rule;
  })!;
}

describe("what the rules say together", () => {
  const prices: ReturnType<typeof readOpenStackPriceList> =
    readOpenStackPriceList({
      vcpuHour: 0.01,
      memoryGbHour: 0.005,
      volumeGbHour: 0.0001,
      floatingIpHour: 0.005,
      imageGbHour: 0.0001,
      snapshotGbHour: 0.0002,
    });
  const volume: OpenStackWasteRow = row({
    externalId: "v",
    status: "available",
    facts: { attachedToInstance: null, volumeType: "ssd" },
  });
  const inUse: OpenStackWasteRow = row({
    externalId: "in-use",
    status: "available",
    facts: { attachedToInstance: "server" },
  });
  const address: OpenStackWasteRow = row({
    externalId: "f",
    status: "DOWN",
    facts: { routerId: null },
  });
  const instance: OpenStackWasteRow = row({
    externalId: "i",
    status: "SHUTOFF",
    facts: { flavorId: "1" },
  });

  test("each rule says what it would free, and at prices, what that comes to a month", () => {
    const findings: Array<OpenStackWasteFinding> = getOpenStackWasteFindings(
      input({
        volumes: [volume, inUse],
        floatingIps: [address],
        instances: [instance],
        flavorOf: () => {
          return { name: "m1", vcpus: 2, ramMib: 2048, diskGb: 20 };
        },
        priceList: prices,
      }),
    );

    const volumes: OpenStackWasteFinding = findingOf(
      findings,
      OpenStackWasteRuleId.UnattachedVolume,
    );
    expect(volumes.count).toBe(1);
    expect(volumes.items[0]!.id).toBe("v");
    expect(volumes.frees.storageGb).toBe(10);
    // 10 GB x 0.0001 an hour x 730 hours.
    expect(volumes.monthlyAmount).toBe(0.73);

    const addresses: OpenStackWasteFinding = findingOf(
      findings,
      OpenStackWasteRuleId.SpareFloatingIp,
    );
    expect(addresses.frees.floatingIps).toBe(1);
    // 0.005 x 730.
    expect(addresses.monthlyAmount).toBe(3.65);

    const instances: OpenStackWasteFinding = findingOf(
      findings,
      OpenStackWasteRuleId.ShutOffInstance,
    );
    expect(instances.frees.vcpus).toBe(2);
    expect(instances.frees.memoryGb).toBe(2);
    expect(instances.frees.diskGb).toBe(20);
    // (2 x 0.01 + 2 x 0.005) x 730 = 21.9.
    expect(instances.monthlyAmount).toBe(21.9);
  });

  test("with no price the rules still say what they'd free, and no amount", () => {
    const finding: OpenStackWasteFinding = findingOf(
      getOpenStackWasteFindings(input({ volumes: [volume] })),
      OpenStackWasteRuleId.UnattachedVolume,
    );

    expect(finding.frees.storageGb).toBe(10);
    expect(finding.monthlyAmount).toBeNull();
  });

  test("an instance of a flavor the cloud no longer lists is named, freeing what's not known", () => {
    const finding: OpenStackWasteFinding = findingOf(
      getOpenStackWasteFindings(
        input({ instances: [instance], priceList: prices }),
      ),
      OpenStackWasteRuleId.ShutOffInstance,
    );

    expect(finding.count).toBe(1);
    expect(finding.frees.vcpus).toBe(0);
    expect(finding.monthlyAmount).toBeNull();
  });

  test("a rule that can't be run says so, and finds nothing", () => {
    const findings: Array<OpenStackWasteFinding> = getOpenStackWasteFindings(
      input({
        images: [
          row({
            status: "active",
            facts: { visibility: "private" },
          }),
        ],
        imagesInUse: null,
        snapshotsAreReported: false,
      }),
    );

    const images: OpenStackWasteFinding = findingOf(
      findings,
      OpenStackWasteRuleId.UnusedImage,
    );
    expect(images.count).toBe(0);
    expect(images.cannotTell).toBe("images-in-use-not-reported");

    const snapshots: OpenStackWasteFinding = findingOf(
      findings,
      OpenStackWasteRuleId.OldSnapshot,
    );
    expect(snapshots.count).toBe(0);
    expect(snapshots.cannotTell).toBe("snapshots-not-reported");
  });

  test("what's listed by name is capped, while what it counts and frees is everything it read", () => {
    const rows: Array<OpenStackWasteRow> = [];

    for (let index: number = 0; index < OPENSTACK_WASTE_ROWS_READ; index++) {
      rows.push(row({ ...volume, externalId: `v${index}` }));
    }

    const finding: OpenStackWasteFinding = findingOf(
      getOpenStackWasteFindings(input({ volumes: rows })),
      OpenStackWasteRuleId.UnattachedVolume,
    );

    expect(finding.count).toBe(OPENSTACK_WASTE_ROWS_READ);
    expect(finding.items.length).toBe(OPENSTACK_WASTE_ITEMS_KEPT);
    expect(finding.frees.storageGb).toBe(OPENSTACK_WASTE_ROWS_READ * 10);
    expect(finding.isPartial).toBe(true);
  });

  test("every rule appears once, whatever it found", () => {
    const rules: Array<OpenStackWasteRuleId> = getOpenStackWasteFindings(
      input({}),
    ).map((finding: OpenStackWasteFinding): OpenStackWasteRuleId => {
      return finding.rule;
    });

    expect([...rules].sort()).toEqual(
      Object.values(OpenStackWasteRuleId).sort(),
    );
  });
});

describe("what a rule says for itself", () => {
  const rules: Array<[string, OpenStackWasteRuleWords]> = Object.entries(
    OPENSTACK_WASTE_RULES,
  );

  test.each(rules)(
    "%s's command only ever reads",
    (_rule: string, words: OpenStackWasteRuleWords) => {
      expect(words.command.startsWith("openstack ")).toBe(true);
      expect(words.command).toMatch(/\b(list|show)\b/);
      expect(words.command).not.toMatch(
        /\b(delete|remove|purge|create|set|unset|add|stop|start|reboot|shelve|migrate|evacuate)\b/,
      );
    },
  );

  test.each([
    [OpenStackWasteRuleId.UnattachedVolume, OPENSTACK_WASTE_VOLUME_DAYS],
    [OpenStackWasteRuleId.SpareFloatingIp, OPENSTACK_WASTE_FLOATING_IP_DAYS],
    [OpenStackWasteRuleId.ShutOffInstance, OPENSTACK_WASTE_INSTANCE_DAYS],
    [OpenStackWasteRuleId.UnusedImage, OPENSTACK_WASTE_IMAGE_DAYS],
    [OpenStackWasteRuleId.OldSnapshot, OPENSTACK_WASTE_SNAPSHOT_DAYS],
  ])("%s's words say the same days as its rule", (rule, days) => {
    expect(OPENSTACK_WASTE_RULES[rule].description).toContain(`${days} days`);
  });
});
