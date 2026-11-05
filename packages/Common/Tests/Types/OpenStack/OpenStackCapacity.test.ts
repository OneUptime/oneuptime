import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import { JSONObject } from "../../../Types/JSON";
import {
  OPENSTACK_COMPUTE_STATUS_DISABLED_TRAIT,
  OpenStackCapacityHost,
  OpenStackCapacityResource,
  OpenStackCapacityRollup,
  OpenStackFlavorFit,
  OpenStackFlavorRequest,
  OpenStackHostAllocationMismatch,
  OpenStackHostFailureHeadroom,
  OpenStackInventories,
  OpenStackInventory,
  OpenStackOvercommitReading,
  OpenStackPlacementAnswer,
  compareResourceClasses,
  getOpenStackAllocationMismatches,
  getOpenStackCandidatesQuery,
  getOpenStackCapacityHostState,
  getOpenStackCapacityRollup,
  getOpenStackFitOnHost,
  getOpenStackFlavorFit,
  getOpenStackFlavorRequest,
  getOpenStackHostFailureHeadroom,
  getOpenStackInventoryCapacity,
  getOpenStackInventoryFactKey,
  getOpenStackInventoryFree,
  getOpenStackInventorySeenHour,
  getOpenStackOvercommit,
  getOpenStackPlacementAnswer,
  parseOpenStackResourcesQuery,
  readOpenStackAllocationCandidates,
  readOpenStackInventories,
  toOpenStackResourcesQuery,
} from "../../../Types/OpenStack/OpenStackCapacity";
import { SeededRandom, seededRandom } from "../../Helpers/SeededRandom";

/*
 * THE ARITHMETIC, BY HAND.
 *
 * Everything an operator is told about what fits comes from here, so each table below was worked
 * out on paper first, and the working is in the row. Where a row is what a real Placement answered
 * it says so and reads the recording. Everything else is made up, to hold what no recording holds
 * yet, and says that too.
 */

const FIXTURES: string = path.join(__dirname, "../../Fixtures/OpenStack");

function inventory(
  total: number,
  reserved: number,
  allocationRatio: number,
  used: number,
  units?: Partial<OpenStackInventory>,
): OpenStackInventory {
  return { total, reserved, allocationRatio, used, ...units };
}

function host(
  name: string,
  inventories: OpenStackInventories,
  extra?: Partial<OpenStackCapacityHost>,
): OpenStackCapacityHost {
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

// A host with these amounts free, and the ratios and reservations out of the way.
function hostWithFree(
  name: string,
  vcpu: number,
  memoryMb: number,
  diskGb: number,
  extra?: Partial<OpenStackCapacityHost>,
): OpenStackCapacityHost {
  return host(
    name,
    {
      VCPU: inventory(vcpu, 0, 1, 0, { maxUnit: 100000 }),
      MEMORY_MB: inventory(memoryMb, 0, 1, 0, { maxUnit: 10000000 }),
      DISK_GB: inventory(diskGb, 0, 1, 0, { maxUnit: 1000000 }),
    },
    extra,
  );
}

const M1_SMALL: Record<string, number> = {
  VCPU: 1,
  MEMORY_MB: 2048,
  DISK_GB: 20,
};
const M1_MEDIUM: Record<string, number> = {
  VCPU: 2,
  MEMORY_MB: 4096,
  DISK_GB: 40,
};

describe("capacity is (total - reserved) x allocation ratio", () => {
  test.each([
    // total, reserved, ratio, used, capacity, free
    ["no ratio, nothing reserved", 100, 0, 1, 0, 100, 100],
    ["a ratio over 1", 32, 0, 16, 0, 512, 512],
    ["a reserved amount", 65536, 4096, 1, 0, 61440, 61440],
    ["both, in that order", 65536, 4096, 1.5, 0, 92160, 92160],
    ["a ratio under 1", 100, 0, 0.5, 0, 50, 50],
    ["allocated comes off what's left", 32, 0, 16, 500, 512, 12],
    ["more reserved than there is, is none", 10, 20, 2, 0, 0, 0],
    ["over its capacity has no room, and no debt", 10, 0, 1, 25, 10, 0],
  ])(
    "%s",
    (
      _name: string,
      total: number,
      reserved: number,
      ratio: number,
      used: number,
      capacity: number,
      free: number,
    ) => {
      const reading: OpenStackInventory = inventory(
        total,
        reserved,
        ratio,
        used,
      );

      expect(getOpenStackInventoryCapacity(reading)).toBe(capacity);
      expect(getOpenStackInventoryFree(reading)).toBe(free);
    },
  );
});

describe("how many fit on one host", () => {
  test("the lowest count of what it asks for, and which class that was", () => {
    /*
     * Free: 13 vCPUs, 15087 MB, 141 GB. m1.small asks 1, 2048, 20:
     * 13 / 1 = 13, 15087 / 2048 = 7, 141 / 20 = 7. Seven, and memory is the first to run out.
     */
    expect(
      getOpenStackFitOnHost({
        inventories: {
          VCPU: inventory(4, 0, 4, 3),
          MEMORY_MB: inventory(15983, 512, 1, 384),
          DISK_GB: inventory(144, 0, 1, 3),
        },
        resources: M1_SMALL,
      }),
    ).toEqual({ fit: 7, limitedBy: "MEMORY_MB" });
  });

  test.each([
    [
      "an allocation ratio over 1 gives room the host's own size doesn't have",
      { VCPU: inventory(4, 0, 16, 0) },
      { VCPU: 2 },
      { fit: 32, limitedBy: "VCPU" },
    ],
    [
      "a fractional ratio floors: (10 - 0) x 1.5 = 15, and 15 / 4 = 3",
      { VCPU: inventory(10, 0, 1.5, 0) },
      { VCPU: 4 },
      { fit: 3, limitedBy: "VCPU" },
    ],
    [
      "a reserved amount takes room: (1024 - 512) / 256 = 2",
      { MEMORY_MB: inventory(1024, 512, 1, 0) },
      { MEMORY_MB: 256 },
      { fit: 2, limitedBy: "MEMORY_MB" },
    ],
    [
      "a class the host doesn't hold is none at all",
      { VCPU: inventory(10, 0, 1, 0) },
      { VCPU: 1, VGPU: 1 },
      { fit: 0, limitedBy: "VGPU" },
    ],
    [
      "past max_unit is none, whatever is free",
      { VCPU: inventory(64, 0, 16, 0, { maxUnit: 8 }) },
      { VCPU: 16 },
      { fit: 0, limitedBy: "VCPU" },
    ],
    [
      "under min_unit is none",
      { MEMORY_MB: inventory(1024, 0, 1, 0, { minUnit: 512 }) },
      { MEMORY_MB: 256 },
      { fit: 0, limitedBy: "MEMORY_MB" },
    ],
    [
      "off step_size is none",
      { MEMORY_MB: inventory(4096, 0, 1, 0, { stepSize: 1024 }) },
      { MEMORY_MB: 1500 },
      { fit: 0, limitedBy: "MEMORY_MB" },
    ],
    [
      "on step_size counts",
      { MEMORY_MB: inventory(4096, 0, 1, 0, { stepSize: 1024 }) },
      { MEMORY_MB: 2048 },
      { fit: 2, limitedBy: "MEMORY_MB" },
    ],
    [
      "Nova's max_unit is the host's total when nothing says: 8 vCPUs on a 4 thread host don't fit, at any ratio",
      { VCPU: inventory(4, 0, 16, 0) },
      { VCPU: 8 },
      { fit: 0, limitedBy: "VCPU" },
    ],
    [
      "a class asked for zero of is not asked for",
      { VCPU: inventory(4, 0, 1, 0) },
      { VCPU: 1, DISK_GB: 0 },
      { fit: 4, limitedBy: "VCPU" },
    ],
    [
      "nothing asked for fits nowhere",
      { VCPU: inventory(4, 0, 1, 0) },
      {},
      { fit: 0, limitedBy: null },
    ],
    [
      "a bare metal node holds one of its own class",
      { CUSTOM_BAREMETAL_GOLD: inventory(1, 0, 1, 0, { maxUnit: 1 }) },
      { CUSTOM_BAREMETAL_GOLD: 1 },
      { fit: 1, limitedBy: "CUSTOM_BAREMETAL_GOLD" },
    ],
    [
      "a bare metal node that's taken holds none",
      { CUSTOM_BAREMETAL_GOLD: inventory(1, 0, 1, 1, { maxUnit: 1 }) },
      { CUSTOM_BAREMETAL_GOLD: 1 },
      { fit: 0, limitedBy: "CUSTOM_BAREMETAL_GOLD" },
    ],
  ])(
    "%s",
    (
      _name: string,
      inventories: OpenStackInventories,
      resources: Record<string, number>,
      expected: { fit: number; limitedBy: string | null },
    ) => {
      expect(getOpenStackFitOnHost({ inventories, resources })).toEqual(
        expected,
      );
    },
  );
});

describe("on what real Placements answered", () => {
  /*
   * Every release's one DevStack host, from placement-inventories.json and placement-usages.json,
   * which is what the rig recorded it saying. By hand, for a host of 4 threads at 4:1, memory less
   * 512 MB reserved, and three ou.tiny on it (1 vCPU, 128 MB, 1 GB each):
   *
   *   vCPUs  (4 - 0) x 4 = 16, less 3 = 13 free. max_unit 4.
   *   memory (15983 - 512) x 1 = 15471, less 384 = 15087 free (15086 on the hosts that report
   *          15982, which changes no row below). max_unit 15983.
   *   disk   (144 - 0) x 1 = 144, less 3 = 141 free. max_unit 144.
   */
  const RELEASES: Array<string> = [
    "epoxy-ovn",
    "flamingo-ovn",
    "gazpacho-ovn",
    "gazpacho-ovs",
    "hibiscus-ovn",
  ];

  // flavor: vcpus / 13, memory / 15087, disk / 141, and the lowest.
  const BY_HAND: Record<string, number> = {
    "ou.tiny": 13, // 1, 128, 1: 13, 117, 141
    "m1.tiny": 13, // 1, 512, 1: 13, 29, 141
    cirros256: 13, // 1, 256, 1: 13, 58, 141
    ds512M: 13, // 1, 512, 5: 13, 29, 28
    ds1G: 13, // 1, 1024, 10: 13, 14, 14
    ds2G: 6, // 2, 2048, 10: 6, 7, 14
    ds4G: 3, // 4, 4096, 20: 3, 3, 7
    "m1.small": 7, // 1, 2048, 20: 13, 7, 7
    "m1.medium": 3, // 2, 4096, 40: 6, 3, 3
    "m1.large": 1, // 4, 8192, 80: 3, 1, 1
    "m1.xlarge": 0, // 8 vCPUs is past max_unit 4, and memory and disk past theirs too
    "ou.impossible": 0, // 1 TB of memory
  };

  function recorded(release: string, name: string): JSONObject {
    return JSON.parse(
      fs.readFileSync(
        path.join(FIXTURES, release, "healthy", "api", `${name}.json`),
        "utf8",
      ),
    ) as JSONObject;
  }

  function hostOf(release: string): OpenStackCapacityHost {
    const held: JSONObject = recorded(release, "placement-inventories")[
      "inventories"
    ] as JSONObject;
    const usages: JSONObject = recorded(release, "placement-usages")[
      "usages"
    ] as JSONObject;
    const inventories: OpenStackInventories = {};

    for (const resourceClass of Object.keys(held)) {
      const reading: JSONObject = held[resourceClass] as JSONObject;
      inventories[resourceClass] = {
        total: reading["total"] as number,
        reserved: reading["reserved"] as number,
        allocationRatio: reading["allocation_ratio"] as number,
        used: (usages[resourceClass] as number) || 0,
        minUnit: reading["min_unit"] as number,
        maxUnit: reading["max_unit"] as number,
        stepSize: reading["step_size"] as number,
      };
    }

    return host("compute-01.example.internal", inventories);
  }

  describe.each(RELEASES)("%s", (release: string) => {
    test("an allocation ratio over 1 and a reserved amount are what it really has", () => {
      const inventories: OpenStackInventories = hostOf(release).inventories;

      expect(inventories["VCPU"]!.allocationRatio).toBe(4);
      expect(inventories["MEMORY_MB"]!.reserved).toBe(512);
    });

    test("every flavor it lists fits as many as a hand calculation says", () => {
      const flavors: Array<JSONObject> = recorded(release, "nova-flavors")[
        "flavors"
      ] as Array<JSONObject>;
      const counted: Record<string, number> = {};

      for (const flavor of flavors) {
        counted[flavor["name"] as string] = getOpenStackFlavorFit({
          resources: getOpenStackFlavorRequest({
            vcpus: flavor["vcpus"] as number,
            ramMib: flavor["ram"] as number,
            diskGib: flavor["disk"] as number,
            ephemeralGib: flavor["OS-FLV-EXT-DATA:ephemeral"] as number,
            swapMib: Number(flavor["swap"]) || 0,
            extraSpecs: flavor["extra_specs"] as JSONObject,
          }).resources,
          hosts: [hostOf(release)],
        }).fits;
      }

      expect(counted).toEqual(BY_HAND);
    });

    test("what's left out of max_unit says the same, because Nova sets it to the total", () => {
      const withUnits: OpenStackCapacityHost = hostOf(release);
      const withoutUnits: OpenStackCapacityHost = host("compute-01", {});

      for (const resourceClass of Object.keys(withUnits.inventories)) {
        const reading: OpenStackInventory = withUnits.inventories[
          resourceClass
        ] as OpenStackInventory;

        expect(reading.maxUnit).toBe(reading.total);
        expect(reading.minUnit).toBe(1);
        expect(reading.stepSize).toBe(1);

        withoutUnits.inventories[resourceClass] = {
          total: reading.total,
          reserved: reading.reserved,
          allocationRatio: reading.allocationRatio,
          used: reading.used,
        };
      }

      for (const resources of [
        { VCPU: 8, MEMORY_MB: 16384, DISK_GB: 160 },
        M1_SMALL,
        { VCPU: 1, MEMORY_MB: 128, DISK_GB: 1 },
      ]) {
        expect(
          getOpenStackFitOnHost({
            inventories: withoutUnits.inventories,
            resources,
          }),
        ).toEqual(
          getOpenStackFitOnHost({
            inventories: withUnits.inventories,
            resources,
          }),
        );
      }
    });

    test("capacity is what the exporter's series say it is too", () => {
      const prom: string = fs.readFileSync(
        path.join(FIXTURES, release, "healthy", "exporter", "placement.prom"),
        "utf8",
      );
      const read: (metric: string, resourceClass: string) => number = (
        metric: string,
        resourceClass: string,
      ): number => {
        const start: number = prom.indexOf(
          `openstack_placement_resource_${metric}{hostname="compute-01.example.internal",resourcetype="${resourceClass}"}`,
        );
        const line: string = prom.substring(start, prom.indexOf("\n", start));
        return Number(line.substring(line.lastIndexOf(" ") + 1));
      };

      for (const resourceClass of ["VCPU", "MEMORY_MB", "DISK_GB"]) {
        const fromApi: OpenStackInventory = hostOf(release).inventories[
          resourceClass
        ] as OpenStackInventory;

        expect(
          getOpenStackInventoryFree({
            total: read("total", resourceClass),
            reserved: read("reserved", resourceClass),
            allocationRatio: read("allocation_ratio", resourceClass),
            used: read("usage", resourceClass),
          }),
        ).toBe(getOpenStackInventoryFree(fromApi));
      }
    });
  });
});

describe("how many fit across hosts", () => {
  test("a fragmented estate: thousands free, and no room for one large instance", () => {
    /*
     * Made up, and the point of the issue: 1000 hosts, each with 100 vCPUs and 3 GB free, is
     * 100,000 vCPUs and 3 TB free, and m1.medium's 4 GB fits on none of them. As one pool it would
     * be 3,000000 / 4096 = 732 instances, which is the number a free count leads people to.
     */
    const hosts: Array<OpenStackCapacityHost> = [];
    for (let index: number = 0; index < 1000; index++) {
      hosts.push(hostWithFree(`host-${index}`, 100, 3000, 1000));
    }

    const fit: OpenStackFlavorFit = getOpenStackFlavorFit({
      resources: M1_MEDIUM,
      hosts,
    });

    expect(fit.fits).toBe(0);
    expect(fit.hostsWithRoom).toBe(0);
    expect(fit.fitsIfOnePool).toBe(732);
    expect(fit.limitedBy).toBe("MEMORY_MB");
    // It would fit on none of them even empty, as these have nothing allocated.
    expect(fit.fitsOnAnEmptyHost).toBe(false);
  });

  test("a fragmented estate that could hold it empty says so", () => {
    /*
     * Hand-checked, not recorded: three hosts of 8192 MB at 1:1, less 512 reserved, which is 7680.
     * m1.small x 2 on each leaves 3584, and m1.medium asks 4096. 10752 MB is free in all, which
     * would be 2 as one pool. None fits, and any of them could hold one empty.
     */
    const hosts: Array<OpenStackCapacityHost> = ["a", "b", "c"].map(
      (name: string) => {
        return host(name, {
          VCPU: inventory(10, 0, 4, 2),
          MEMORY_MB: inventory(8192, 512, 1, 4096),
          DISK_GB: inventory(1028, 0, 1, 40),
        });
      },
    );

    const medium: OpenStackFlavorFit = getOpenStackFlavorFit({
      resources: M1_MEDIUM,
      hosts,
    });

    expect(medium).toEqual({
      fits: 0,
      hostsWithRoom: 0,
      fitsIfOnePool: 2,
      fitsOnDisabledHosts: 0,
      fitsOnAnEmptyHost: true,
      limitedBy: "MEMORY_MB",
      byZone: { nova: 0 },
      byAggregate: {},
    });

    // 3584 / 2048 = 1 per host, where one pool would read 10752 / 2048 = 5.
    const small: OpenStackFlavorFit = getOpenStackFlavorFit({
      resources: M1_SMALL,
      hosts,
    });

    expect(small.fits).toBe(3);
    expect(small.hostsWithRoom).toBe(3);
    expect(small.fitsIfOnePool).toBe(5);
    expect(small.limitedBy).toBe(null);
  });

  test("a lost host and a disabled host are not capacity", () => {
    const hosts: Array<OpenStackCapacityHost> = [
      hostWithFree("up", 10, 8192, 100),
      hostWithFree("lost", 10, 8192, 100, { state: "lost" }),
      hostWithFree("disabled", 10, 8192, 100, { state: "disabled" }),
    ];

    const fit: OpenStackFlavorFit = getOpenStackFlavorFit({
      resources: M1_SMALL,
      hosts,
    });

    // 8192 / 2048 = 4, 100 / 20 = 5, on the one host that can give.
    expect(fit.fits).toBe(4);
    expect(fit.hostsWithRoom).toBe(1);
    expect(fit.fitsIfOnePool).toBe(4);
    // What a disabled host would give back once enabled, which is planned, not short.
    expect(fit.fitsOnDisabledHosts).toBe(4);
  });

  test("the only room being on a lost host is none, and it could still hold one empty", () => {
    const fit: OpenStackFlavorFit = getOpenStackFlavorFit({
      resources: M1_SMALL,
      hosts: [hostWithFree("lost", 10, 8192, 100, { state: "lost" })],
    });

    expect(fit.fits).toBe(0);
    expect(fit.fitsOnDisabledHosts).toBe(0);
    expect(fit.fitsOnAnEmptyHost).toBe(true);
  });

  test("counted per zone and per aggregate, and a host in two aggregates counts in both", () => {
    const fit: OpenStackFlavorFit = getOpenStackFlavorFit({
      resources: M1_SMALL,
      hosts: [
        hostWithFree("a", 10, 4096, 100, {
          zone: "zone-a",
          aggregates: ["ssd", "gpu"],
        }),
        hostWithFree("b", 10, 8192, 100, {
          zone: "zone-a",
          aggregates: ["ssd"],
        }),
        hostWithFree("c", 10, 2048, 100, { zone: "zone-b" }),
        hostWithFree("d", 10, 2048, 100, { zone: null }),
      ],
    });

    expect(fit.fits).toBe(2 + 4 + 1 + 1);
    expect(fit.byZone).toEqual({ "zone-a": 6, "zone-b": 1, "": 1 });
    expect(fit.byAggregate).toEqual({ ssd: 6, gpu: 2 });
  });

  test("a zone with no room reads 0, rather than not being there", () => {
    const fit: OpenStackFlavorFit = getOpenStackFlavorFit({
      resources: M1_SMALL,
      hosts: [hostWithFree("a", 10, 1024, 100, { zone: "zone-a" })],
    });

    expect(fit.byZone).toEqual({ "zone-a": 0 });
  });

  test("a flavor that asks for nothing fits nowhere", () => {
    expect(
      getOpenStackFlavorFit({
        resources: {},
        hosts: [hostWithFree("a", 10, 1024, 100)],
      }).fits,
    ).toBe(0);
  });

  test("whatever the estate, per host never reads above one pool, and the zones add up", () => {
    const random: SeededRandom = seededRandom(5745);

    for (let round: number = 0; round < 200; round++) {
      const hosts: Array<OpenStackCapacityHost> = [];
      const hostCount: number = random(30);

      for (let index: number = 0; index < hostCount; index++) {
        hosts.push(
          host(
            `host-${index}`,
            {
              VCPU: inventory(
                1 + random(128),
                random(4),
                1 + random(16),
                random(400),
              ),
              MEMORY_MB: inventory(
                1024 + random(512000),
                random(8192),
                1 + random() * 2,
                random(600000),
              ),
              DISK_GB: inventory(1 + random(4000), 0, 1, random(4000)),
            },
            {
              zone: `zone-${random(3)}`,
              state: (["up", "up", "up", "lost", "disabled"] as const)[
                random(5)
              ],
            },
          ),
        );
      }

      const fit: OpenStackFlavorFit = getOpenStackFlavorFit({
        resources: {
          VCPU: 1 + random(16),
          MEMORY_MB: 256 + random(32768),
          DISK_GB: random(200),
        },
        hosts,
      });

      expect(fit.fits).toBeLessThanOrEqual(fit.fitsIfOnePool);
      expect(fit.hostsWithRoom).toBeLessThanOrEqual(fit.fits);
      expect(
        Object.values(fit.byZone).reduce((sum: number, value: number) => {
          return sum + value;
        }, 0),
      ).toBe(fit.fits);
    }
  });
});

describe("what a flavor asks Placement for", () => {
  test.each<
    [
      string,
      Parameters<typeof getOpenStackFlavorRequest>[0],
      OpenStackFlavorRequest,
    ]
  >([
    [
      "vCPUs, RAM and disk",
      { vcpus: 2, ramMib: 4096, diskGib: 40 },
      {
        resources: { VCPU: 2, MEMORY_MB: 4096, DISK_GB: 40 },
        requiredTraits: [],
        forbiddenTraits: [],
      },
    ],
    [
      "ephemeral disk and swap are disk too, swap rounded up to a GB",
      { vcpus: 1, ramMib: 512, diskGib: 10, ephemeralGib: 5, swapMib: 1025 },
      {
        resources: { VCPU: 1, MEMORY_MB: 512, DISK_GB: 17 },
        requiredTraits: [],
        forbiddenTraits: [],
      },
    ],
    [
      "a disk of 0 asks for no disk: it boots from a volume, or uses a shared pool",
      { vcpus: 1, ramMib: 512, diskGib: 0 },
      {
        resources: { VCPU: 1, MEMORY_MB: 512 },
        requiredTraits: [],
        forbiddenTraits: [],
      },
    ],
    [
      "resources:<class> replaces what it would have asked for, which is how bare metal reads",
      {
        vcpus: 8,
        ramMib: 8192,
        diskGib: 100,
        extraSpecs: {
          "resources:VCPU": "0",
          "resources:MEMORY_MB": "0",
          "resources:DISK_GB": "0",
          "resources:CUSTOM_BAREMETAL_GOLD": "1",
        },
      },
      {
        resources: { CUSTOM_BAREMETAL_GOLD: 1 },
        requiredTraits: [],
        forbiddenTraits: [],
      },
    ],
    [
      "traits required and forbidden, and a numbered group adds to the same request",
      {
        vcpus: 4,
        ramMib: 8192,
        diskGib: 80,
        extraSpecs: {
          "trait:HW_CPU_X86_AVX2": "required",
          "trait:CUSTOM_SLOW": "forbidden",
          "trait1:CUSTOM_GPU_KIND": "required",
          "trait:CUSTOM_IGNORED": "preferred",
          "resources1:VGPU": "1",
          "resources2:VGPU": "1",
          "hw_rng:allowed": "True",
        },
      },
      {
        resources: { VCPU: 4, MEMORY_MB: 8192, DISK_GB: 80, VGPU: 2 },
        requiredTraits: ["CUSTOM_GPU_KIND", "HW_CPU_X86_AVX2"],
        forbiddenTraits: ["CUSTOM_SLOW"],
      },
    ],
    [
      "a pinned flavor asks for PCPU rather than VCPU",
      {
        vcpus: 4,
        ramMib: 4096,
        diskGib: 10,
        extraSpecs: { "hw:cpu_policy": "dedicated" },
      },
      {
        resources: { PCPU: 4, MEMORY_MB: 4096, DISK_GB: 10 },
        requiredTraits: [],
        forbiddenTraits: [],
      },
    ],
    [
      "emulator threads on their own take one more",
      {
        vcpus: 4,
        ramMib: 4096,
        diskGib: 10,
        extraSpecs: {
          "hw:cpu_policy": "dedicated",
          "hw:emulator_threads_policy": "isolate",
        },
      },
      {
        resources: { PCPU: 5, MEMORY_MB: 4096, DISK_GB: 10 },
        requiredTraits: [],
        forbiddenTraits: [],
      },
    ],
    [
      "a thread policy is a trait",
      {
        vcpus: 1,
        ramMib: 1,
        diskGib: 1,
        extraSpecs: { "hw:cpu_thread_policy": "isolate" },
      },
      {
        resources: { VCPU: 1, MEMORY_MB: 1, DISK_GB: 1 },
        requiredTraits: [],
        forbiddenTraits: ["HW_CPU_HYPERTHREADING"],
      },
    ],
    [
      "nonsense in an extra spec asks for nothing more",
      {
        vcpus: 1,
        ramMib: 1,
        diskGib: 1,
        extraSpecs: {
          "resources:VCPU": "lots",
          "resources:": "1",
          "resources:CUSTOM_X": "-4",
          "aggregate_instance_extra_specs:ssd": "true",
          ":": "1",
          "resources one:VGPU": "1",
        },
      },
      {
        resources: { VCPU: 1, MEMORY_MB: 1, DISK_GB: 1 },
        requiredTraits: [],
        forbiddenTraits: [],
      },
    ],
    [
      "a row with nothing known asks for nothing",
      { vcpus: null, ramMib: undefined, diskGib: null },
      { resources: {}, requiredTraits: [], forbiddenTraits: [] },
    ],
  ])(
    "%s",
    (
      _name: string,
      flavor: Parameters<typeof getOpenStackFlavorRequest>[0],
      expected: OpenStackFlavorRequest,
    ) => {
      expect(getOpenStackFlavorRequest(flavor)).toEqual(expected);
    },
  );

  test("a long hostile extra spec key takes no longer than its length", () => {
    const key: string = `resources${"1".repeat(2000000)}!:VCPU`;
    const startedAt: number = Date.now();

    expect(
      getOpenStackFlavorRequest({
        vcpus: 1,
        ramMib: 1,
        diskGib: 1,
        extraSpecs: { [key]: "1" },
      }).resources,
    ).toEqual({ VCPU: 1, MEMORY_MB: 1, DISK_GB: 1 });
    // Far above what it takes: only something quadratic comes near this.
    expect(Date.now() - startedAt).toBeLessThan(5000);
  });

  test("a query names its classes in order, and reads back", () => {
    const query: string = toOpenStackResourcesQuery({
      VCPU: 2,
      DISK_GB: 0,
      MEMORY_MB: 4096,
    });

    expect(query).toBe("MEMORY_MB:4096,VCPU:2");
    expect(parseOpenStackResourcesQuery(query)).toEqual({
      VCPU: 2,
      MEMORY_MB: 4096,
    });
  });

  test.each([
    [null, {}],
    ["", {}],
    ["nonsense", {}],
    [":1", {}],
    ["VCPU:lots", {}],
    ["VCPU:-1", {}],
    ["VCPU:0", {}],
    ["VCPU:2,,MEMORY_MB:1", { VCPU: 2, MEMORY_MB: 1 }],
  ])("reading %s", (text: string | null, expected: Record<string, number>) => {
    expect(parseOpenStackResourcesQuery(text)).toEqual(expected);
  });

  test("it asks Placement what a boot would be told", () => {
    expect(
      getOpenStackCandidatesQuery({
        resources: M1_SMALL,
        requiredTraits: ["HW_CPU_X86_AVX2"],
        forbiddenTraits: ["CUSTOM_SLOW"],
      }),
    ).toEqual({
      resources: "DISK_GB:20,MEMORY_MB:2048,VCPU:1",
      required: `HW_CPU_X86_AVX2,!CUSTOM_SLOW,!${OPENSTACK_COMPUTE_STATUS_DISABLED_TRAIT}`,
    });
  });
});

describe("a host's state", () => {
  test.each<[string | null, string | null, string]>([
    ["up", "enabled", "up"],
    ["down", "enabled", "lost"],
    ["up", "disabled", "disabled"],
    // Someone disabled it first: that it also stopped is part of the same planned work.
    ["down", "disabled", "disabled"],
    // A credential that can't read Nova's services says nothing, which is no failure.
    [null, null, "up"],
  ])(
    "status %s, admin state %s is %s",
    (status: string | null, adminState: string | null, expected: string) => {
      expect(getOpenStackCapacityHostState({ status, adminState })).toBe(
        expected,
      );
    },
  );
});

describe("what a row holds of Placement", () => {
  function factsFor(
    readings: Record<
      string,
      Partial<Record<"total" | "reserved" | "ratio" | "used" | "seen", number>>
    >,
  ): JSONObject {
    const facts: JSONObject = { aggregates: "ssd" };
    for (const resourceClass of Object.keys(readings)) {
      for (const field of Object.keys(readings[resourceClass]!) as Array<
        "total" | "reserved" | "ratio" | "used" | "seen"
      >) {
        facts[getOpenStackInventoryFactKey(resourceClass, field)] =
          readings[resourceClass]![field]!;
      }
    }
    return facts;
  }

  test("reads back what each number said", () => {
    expect(
      readOpenStackInventories(
        factsFor({
          VCPU: { total: 4, reserved: 0, ratio: 4, used: 3, seen: 100 },
          MEMORY_MB: {
            total: 16000,
            reserved: 512,
            ratio: 1,
            used: 0,
            seen: 100,
          },
        }),
      ),
    ).toEqual({
      VCPU: { total: 4, reserved: 0, allocationRatio: 4, used: 3 },
      MEMORY_MB: { total: 16000, reserved: 512, allocationRatio: 1, used: 0 },
    });
  });

  test("a class whose reserved or ratio hasn't arrived yet reads as none reserved, at 1:1", () => {
    expect(
      readOpenStackInventories(factsFor({ VCPU: { total: 8, seen: 5 } })),
    ).toEqual({
      VCPU: { total: 8, reserved: 0, allocationRatio: 1, used: 0 },
    });
  });

  test("a used figure with no total is a share of nothing", () => {
    expect(
      readOpenStackInventories(factsFor({ VCPU: { used: 3, seen: 5 } })),
    ).toEqual({});
  });

  test("a class the provider stopped reporting goes, after two hours of grace", () => {
    const facts: JSONObject = factsFor({
      VCPU: { total: 8, seen: 100 },
      VGPU: { total: 2, seen: 98 },
      PCPU: { total: 2, seen: 97 },
    });

    expect(Object.keys(readOpenStackInventories(facts)).sort()).toEqual([
      "VCPU",
      "VGPU",
    ]);
  });

  test("the hour is an hour, so a row with nothing new isn't rewritten by it", () => {
    const hour: number = getOpenStackInventorySeenHour(
      new Date("2026-11-04T12:00:00Z"),
    );

    expect(
      getOpenStackInventorySeenHour(new Date("2026-11-04T12:59:59Z")),
    ).toBe(hour);
    expect(
      getOpenStackInventorySeenHour(new Date("2026-11-04T13:00:00Z")),
    ).toBe(hour + 1);
  });

  test("a resource class with a colon in its name can't happen, and a stray fact reads as nothing", () => {
    expect(
      readOpenStackInventories({
        "inventory:": 1,
        "inventory:total": 1,
        "inventory:VCPU:total": "eight",
        unrelated: 1,
      }),
    ).toEqual({});
    expect(readOpenStackInventories(null)).toEqual({});
  });
});

describe("what a zone, an aggregate, a region and a cloud add up to", () => {
  const hosts: Array<OpenStackCapacityHost> = [
    host(
      "a",
      {
        VCPU: inventory(32, 0, 16, 100),
        MEMORY_MB: inventory(65536, 4096, 1.5, 32768),
      },
      { instanceCount: 10 },
    ),
    host(
      "b",
      {
        VCPU: inventory(32, 2, 4, 10),
        MEMORY_MB: inventory(65536, 4096, 1, 1024),
      },
      { instanceCount: 2 },
    ),
    host(
      "lost",
      {
        VCPU: inventory(64, 0, 16, 200),
        MEMORY_MB: inventory(131072, 0, 1, 64000),
      },
      { state: "lost", instanceCount: 42 },
    ),
    host(
      "disabled",
      {
        VCPU: inventory(64, 0, 16, 8),
        MEMORY_MB: inventory(131072, 0, 1, 1024),
      },
      { state: "disabled", instanceCount: 1 },
    ),
  ];

  const rollup: OpenStackCapacityRollup = getOpenStackCapacityRollup({
    scope: "zone",
    name: "nova",
    regionName: "RegionOne",
    hosts,
  });

  function resource(name: string): OpenStackCapacityResource {
    return rollup.resources.find((candidate: OpenStackCapacityResource) => {
      return candidate.resourceClass === name;
    })!;
  }

  test("capacity and allocated come from the hosts that can give", () => {
    // 32 x 16 = 512, and (32 - 2) x 4 = 120.
    expect(resource("VCPU").capacity).toBe(632);
    expect(resource("VCPU").used).toBe(110);
    expect(resource("VCPU").free).toBe(522);
    // (65536 - 4096) x 1.5 = 92160, and (65536 - 4096) x 1 = 61440.
    expect(resource("MEMORY_MB").capacity).toBe(153600);
    expect(resource("MEMORY_MB").used).toBe(33792);
    expect(resource("MEMORY_MB").percent).toBeCloseTo(22, 5);
  });

  test("what lost and disabled hosts hold isn't room, and isn't forgotten either", () => {
    expect(resource("VCPU").usedOnOtherHosts).toBe(208);
    expect(rollup.lostHostCount).toBe(1);
    expect(rollup.disabledHostCount).toBe(1);
    expect(rollup.hostCount).toBe(4);
    expect(rollup.instanceCount).toBe(55);
  });

  test("the ratio is what capacity comes to, and the lowest and highest that are set", () => {
    // 632 / (32 + 30)
    expect(resource("VCPU").allocationRatio).toBeCloseTo(10.1935, 3);
    expect(resource("VCPU").lowestRatio).toBe(4);
    expect(resource("VCPU").highestRatio).toBe(16);
    expect(resource("VCPU").physical).toBe(62);
  });

  test("a zone with every host lost has no capacity, and says what it held", () => {
    const allLost: OpenStackCapacityRollup = getOpenStackCapacityRollup({
      scope: "zone",
      name: "nova",
      regionName: null,
      hosts: [host("lost", { VCPU: inventory(8, 0, 1, 4) }, { state: "lost" })],
    });

    expect(allLost.resources[0]).toEqual({
      resourceClass: "VCPU",
      capacity: 0,
      used: 0,
      free: 0,
      percent: null,
      usedOnOtherHosts: 4,
      physical: 0,
      allocationRatio: null,
      lowestRatio: null,
      highestRatio: null,
    });
  });

  test("the classes every page knows come first, and a bare metal class has a line of its own", () => {
    expect(
      [
        "CUSTOM_BAREMETAL_GOLD",
        "DISK_GB",
        "VGPU",
        "VCPU",
        "MEMORY_MB",
        "PCPU",
      ].sort(compareResourceClasses),
    ).toEqual([
      "VCPU",
      "PCPU",
      "MEMORY_MB",
      "DISK_GB",
      "CUSTOM_BAREMETAL_GOLD",
      "VGPU",
    ]);
  });

  test("a bare metal node adds up like anything else", () => {
    const nodes: OpenStackCapacityRollup = getOpenStackCapacityRollup({
      scope: "zone",
      name: "metal",
      regionName: null,
      hosts: [
        host("node-1", {
          CUSTOM_BAREMETAL_GOLD: inventory(1, 0, 1, 1, { maxUnit: 1 }),
        }),
        host("node-2", {
          CUSTOM_BAREMETAL_GOLD: inventory(1, 0, 1, 0, { maxUnit: 1 }),
        }),
      ],
    });

    expect(nodes.resources).toHaveLength(1);
    expect(nodes.resources[0]!.capacity).toBe(2);
    expect(nodes.resources[0]!.used).toBe(1);
  });
});

describe("whether a zone can lose a host", () => {
  function stateOf(hosts: Array<OpenStackCapacityHost>): string {
    return getOpenStackHostFailureHeadroom(hosts).state;
  }

  const big: (
    used: number,
    extra?: Partial<OpenStackCapacityHost>,
  ) => OpenStackCapacityHost = (
    used: number,
    extra?: Partial<OpenStackCapacityHost>,
  ): OpenStackCapacityHost => {
    return host(
      extra?.name || "big",
      { VCPU: inventory(100, 0, 1, used) },
      extra,
    );
  };

  test("what's allocated fits in what's left once the largest host is gone", () => {
    /*
     * 300 vCPUs across three hosts of 100. Lose one and 200 are left, and 150 are allocated: yes.
     */
    const headroom: OpenStackHostFailureHeadroom =
      getOpenStackHostFailureHeadroom([
        big(50, { name: "a" }),
        big(50, { name: "b" }),
        big(50, { name: "c" }),
      ]);

    expect(headroom.state).toBe("can-lose-a-host");
    expect(headroom.runningHostCount).toBe(3);
    expect(headroom.resources).toEqual([
      {
        resourceClass: "VCPU",
        used: 150,
        capacity: 300,
        largestHost: "a",
        largestHostCapacity: 100,
        remaining: 200,
        shortBy: 0,
      },
    ]);
  });

  test("past that it can't, and it says by how much", () => {
    const headroom: OpenStackHostFailureHeadroom =
      getOpenStackHostFailureHeadroom([
        big(90, { name: "a" }),
        big(90, { name: "b" }),
        big(90, { name: "c" }),
      ]);

    expect(headroom.state).toBe("cannot-lose-a-host");
    expect(headroom.resources[0]!.shortBy).toBe(70);
  });

  test("exactly enough is enough", () => {
    expect(
      stateOf([
        big(100, { name: "a" }),
        big(100, { name: "b" }),
        big(0, { name: "c" }),
      ]),
    ).toBe("can-lose-a-host");
  });

  test("the largest host is the one that counts, not the fullest", () => {
    // 60 on the small ones: lose the 200, and 200 must fit in 200.
    expect(
      stateOf([
        host("large", { VCPU: inventory(200, 0, 1, 80) }),
        host("small-1", { VCPU: inventory(100, 0, 1, 60) }),
        host("small-2", { VCPU: inventory(100, 0, 1, 60) }),
      ]),
    ).toBe("can-lose-a-host");
    expect(
      stateOf([
        host("large", { VCPU: inventory(200, 0, 1, 81) }),
        host("small-1", { VCPU: inventory(100, 0, 1, 60) }),
        host("small-2", { VCPU: inventory(100, 0, 1, 60) }),
      ]),
    ).toBe("cannot-lose-a-host");
  });

  test("an allocation ratio counts: it's what Placement would promise after an evacuation", () => {
    expect(
      stateOf([
        host("a", { VCPU: inventory(10, 0, 4, 20) }),
        host("b", { VCPU: inventory(10, 0, 4, 20) }),
      ]),
    ).toBe("can-lose-a-host");
    expect(
      stateOf([
        host("a", { VCPU: inventory(10, 0, 1, 6) }),
        host("b", { VCPU: inventory(10, 0, 1, 6) }),
      ]),
    ).toBe("cannot-lose-a-host");
  });

  test("any class short is short", () => {
    expect(
      stateOf([
        host("a", {
          VCPU: inventory(100, 0, 1, 1),
          MEMORY_MB: inventory(1000, 0, 1, 900),
        }),
        host("b", {
          VCPU: inventory(100, 0, 1, 1),
          MEMORY_MB: inventory(1000, 0, 1, 900),
        }),
      ]),
    ).toBe("cannot-lose-a-host");
  });

  test("a lost host's instances want room, and it can't be lost twice", () => {
    /*
     * Three hosts of 100, one lost with 80 on it. The other two hold 40 between them, and could
     * take its 80 (120 in all, with 200 left). Losing another leaves 100, which isn't enough.
     */
    const headroom: OpenStackHostFailureHeadroom =
      getOpenStackHostFailureHeadroom([
        big(20, { name: "a" }),
        big(20, { name: "b" }),
        big(80, { name: "lost", state: "lost" }),
      ]);

    expect(headroom.state).toBe("cannot-lose-a-host");
    expect(headroom.runningHostCount).toBe(2);
    expect(headroom.resources[0]!.used).toBe(120);
    expect(headroom.resources[0]!.remaining).toBe(100);
    expect(headroom.resources[0]!.shortBy).toBe(20);
  });

  test("a host someone disabled is planned work: never a page, and the page says why", () => {
    const headroom: OpenStackHostFailureHeadroom =
      getOpenStackHostFailureHeadroom([
        big(90, { name: "a" }),
        big(90, { name: "b" }),
        big(0, { name: "maintenance", state: "disabled" }),
      ]);

    expect(headroom.state).toBe("host-disabled");
    // The numbers are still there for a person to read.
    expect(headroom.resources[0]!.shortBy).toBe(80);
  });

  test("one host never had anywhere to go, so it says that, not that something is wrong", () => {
    expect(stateOf([big(90)])).toBe("too-few-hosts");
    expect(stateOf([])).toBe("too-few-hosts");
  });

  test("hosts that hold nothing it can move say nothing", () => {
    expect(
      stateOf([
        host("node-1", { CUSTOM_BAREMETAL_GOLD: inventory(1, 0, 1, 1) }),
        host("node-2", { CUSTOM_BAREMETAL_GOLD: inventory(1, 0, 1, 1) }),
      ]),
    ).toBe("not-reported");
  });
});

describe("what Placement says of a flavor", () => {
  /*
   * In the shape of the API reference for GET /allocation_candidates at microversion 1.39, and
   * made up until the rig's capacity scenes are read in OpenStackCapacityRecordings.test.ts.
   */
  function candidateOf(
    uuid: string,
    amounts: Record<string, number>,
  ): JSONObject {
    return { allocations: { [uuid]: { resources: amounts } } };
  }

  const ANSWER: JSONObject = {
    allocation_requests: [
      candidateOf("uuid-1", M1_SMALL),
      candidateOf("uuid-2", M1_SMALL),
      candidateOf("uuid-3", M1_SMALL),
    ],
    provider_summaries: {
      "uuid-1": {
        resources: {
          VCPU: { capacity: 40, used: 2 },
          MEMORY_MB: { capacity: 7680, used: 4096 },
          DISK_GB: { capacity: 1028, used: 40 },
        },
        traits: ["COMPUTE_NET_ATTACH_INTERFACE"],
        parent_provider_uuid: null,
        root_provider_uuid: "uuid-1",
      },
      "uuid-2": {
        resources: {
          VCPU: { capacity: 20, used: 2 },
          MEMORY_MB: { capacity: 10752, used: 4096 },
          DISK_GB: { capacity: 1028, used: 40 },
        },
        traits: [],
        parent_provider_uuid: null,
        root_provider_uuid: "uuid-2",
      },
      "uuid-3": {
        resources: {
          VCPU: { capacity: 10, used: 2 },
          MEMORY_MB: { capacity: 6144, used: 4096 },
          DISK_GB: { capacity: 1028, used: 40 },
        },
        traits: [],
        parent_provider_uuid: null,
        root_provider_uuid: "uuid-3",
      },
    },
  };

  test("each host's count is the same sum as ever", () => {
    // 3584 / 2048 = 1, 6656 / 2048 = 3, 2048 / 2048 = 1.
    expect(readOpenStackAllocationCandidates(ANSWER)).toEqual([
      { rootProviderUuid: "uuid-1", fit: 1 },
      { rootProviderUuid: "uuid-2", fit: 3 },
      { rootProviderUuid: "uuid-3", fit: 1 },
    ]);
  });

  test("no candidates is the answer zero, and an answer with no list is no answer", () => {
    expect(
      readOpenStackAllocationCandidates({
        allocation_requests: [],
        provider_summaries: {},
      }),
    ).toEqual([]);
    expect(readOpenStackAllocationCandidates({})).toEqual([]);
    expect(readOpenStackAllocationCandidates(null)).toEqual([]);
  });

  test("a nested provider's host is its root, and the lowest of its providers counts", () => {
    expect(
      readOpenStackAllocationCandidates({
        allocation_requests: [
          {
            allocations: {
              compute: { resources: { VCPU: 1, MEMORY_MB: 2048 } },
              gpu: { resources: { VGPU: 1 } },
            },
          },
        ],
        provider_summaries: {
          compute: {
            resources: {
              VCPU: { capacity: 16, used: 0 },
              MEMORY_MB: { capacity: 8192, used: 0 },
            },
            root_provider_uuid: "compute",
          },
          gpu: {
            resources: { VGPU: { capacity: 2, used: 1 } },
            root_provider_uuid: "compute",
          },
        },
      }),
    ).toEqual([{ rootProviderUuid: "compute", fit: 1 }]);
  });

  test("a host with two ways to place one takes the better, which can only read low", () => {
    expect(
      readOpenStackAllocationCandidates({
        allocation_requests: [
          { allocations: { "numa-0": { resources: { VCPU: 2 } } } },
          { allocations: { "numa-1": { resources: { VCPU: 2 } } } },
        ],
        provider_summaries: {
          "numa-0": {
            resources: { VCPU: { capacity: 4, used: 0 } },
            root_provider_uuid: "compute",
          },
          "numa-1": {
            resources: { VCPU: { capacity: 8, used: 0 } },
            root_provider_uuid: "compute",
          },
        },
      }),
    ).toEqual([{ rootProviderUuid: "compute", fit: 4 }]);
  });

  test("a sharing provider beside a host is not the host", () => {
    expect(
      readOpenStackAllocationCandidates({
        allocation_requests: [
          {
            allocations: {
              shared: { resources: { DISK_GB: 10 } },
              compute: { resources: { VCPU: 1 } },
            },
          },
        ],
        provider_summaries: {
          shared: {
            resources: { DISK_GB: { capacity: 100, used: 0 } },
            root_provider_uuid: "shared",
          },
          compute: {
            resources: { VCPU: { capacity: 4, used: 0 } },
            root_provider_uuid: "compute",
          },
        },
      }),
    ).toEqual([{ rootProviderUuid: "compute", fit: 4 }]);
  });

  describe("what an answer adds up to", () => {
    const providerNames: Map<string, string> = new Map([
      ["uuid-1", "ou-cap-1.example.org"],
      ["uuid-2", "ou-cap-2.example.org"],
      ["uuid-3", "ou-cap-3.example.org"],
    ]);

    function answerWith(
      states: Record<string, "up" | "lost" | "disabled">,
      candidateLimit: number = 1000,
    ): OpenStackPlacementAnswer {
      return getOpenStackPlacementAnswer({
        candidates: readOpenStackAllocationCandidates(ANSWER),
        providerNames,
        hostsByShortName: new Map(
          Object.keys(states).map((name: string) => {
            return [
              name,
              {
                name,
                zone: "zone-a",
                aggregates: name === "ou-cap-1" ? ["gold"] : [],
                state: states[name]!,
              },
            ];
          }),
        ),
        candidateLimit,
        requestCount: 3,
      });
    }

    test("host by host, in zones and aggregates, and Nova's short name joins them", () => {
      expect(
        answerWith({ "ou-cap-1": "up", "ou-cap-2": "up", "ou-cap-3": "up" }),
      ).toEqual({
        fits: 5,
        hostsWithRoom: 3,
        isCapped: false,
        byZone: { "zone-a": 5 },
        byAggregate: { gold: 1 },
      });
    });

    test("Placement goes on offering a lost host, and that is taken back out", () => {
      expect(
        answerWith({ "ou-cap-1": "up", "ou-cap-2": "lost", "ou-cap-3": "up" })
          .fits,
      ).toBe(2);
    });

    test("a disabled host is left out too, should it have been asked without the trait", () => {
      expect(
        answerWith({
          "ou-cap-1": "up",
          "ou-cap-2": "up",
          "ou-cap-3": "disabled",
        }).fits,
      ).toBe(4);
    });

    test("a provider Nova doesn't list still counts, in no zone, because it would be offered", () => {
      expect(answerWith({}).byZone).toEqual({ "": 5 });
    });

    test("as many candidates as it asked for may not be all of them", () => {
      expect(answerWith({ "ou-cap-1": "up" }, 3).isCapped).toBe(true);
      expect(answerWith({ "ou-cap-1": "up" }, 4).isCapped).toBe(false);
    });
  });
});

describe("allocation beside what hosts really use", () => {
  const hosts: Array<OpenStackCapacityHost> = [
    host("compute-1.example.org", {
      VCPU: inventory(32, 0, 16, 256),
      MEMORY_MB: inventory(65536, 0, 1, 32768),
    }),
    host("compute-2.example.org", {
      VCPU: inventory(32, 0, 16, 128),
      MEMORY_MB: inventory(65536, 0, 1, 32768),
    }),
    host(
      "lost.example.org",
      { VCPU: inventory(32, 0, 16, 512) },
      { state: "lost" },
    ),
  ];

  function read(
    usage: Record<
      string,
      { cpuPercent: number | null; memoryPercent: number | null }
    >,
  ): Array<OpenStackOvercommitReading> {
    return getOpenStackOvercommit({
      hosts,
      realUsageByHost: new Map(Object.entries(usage)),
      cpuLinePercent: 90,
      memoryLinePercent: 90,
    });
  }

  test("says how far a ratio could move, from what the hosts really do", () => {
    const [cpu, memory] = read({
      "compute-1": { cpuPercent: 40, memoryPercent: 45 },
      "compute-2": { cpuPercent: 20, memoryPercent: 45 },
    });

    /*
     * 384 vCPUs allocated on 64 threads is 6:1, at a real 30% on average. The 90% line would come
     * at three times that: 18:1.
     */
    expect(cpu!.resourceClass).toBe("VCPU");
    expect(cpu!.allocationRatio).toBe(16);
    expect(cpu!.allocatedRatio).toBe(6);
    expect(cpu!.realPercent).toBe(30);
    expect(cpu!.busiestPercent).toBe(40);
    expect(cpu!.hostsWithReading).toBe(2);
    expect(cpu!.hostCount).toBe(2);
    expect(cpu!.ratioAtLine).toBeCloseTo(18, 5);

    // 65536 MB of 131072 is 0.5:1 at 45%, so the line is at 1:1.
    expect(memory!.ratioAtLine).toBeCloseTo(1, 5);
  });

  test("hosts already past the line say a lower ratio than they run at", () => {
    const [cpu] = read({
      "compute-1": { cpuPercent: 95, memoryPercent: null },
      "compute-2": { cpuPercent: 95, memoryPercent: null },
    });

    expect(cpu!.ratioAtLine!).toBeLessThan(cpu!.allocatedRatio!);
  });

  test("with no source it says nothing at all: allocation is never put in its place", () => {
    expect(read({})).toEqual([]);
  });

  test("a figure read off too few hosts says what those few are doing, so it isn't said", () => {
    const fewer: Array<OpenStackCapacityHost> = [
      ...hosts,
      host("compute-3.example.org", { VCPU: inventory(32, 0, 16, 1) }),
      host("compute-4.example.org", { VCPU: inventory(32, 0, 16, 1) }),
    ];

    expect(
      getOpenStackOvercommit({
        hosts: fewer,
        realUsageByHost: new Map([
          ["compute-1", { cpuPercent: 40, memoryPercent: null }],
        ]),
        cpuLinePercent: 90,
        memoryLinePercent: 90,
      }),
    ).toEqual([]);
  });

  test("hosts reporting nothing busy have no line to reach", () => {
    const [cpu] = read({
      "compute-1": { cpuPercent: 0, memoryPercent: null },
      "compute-2": { cpuPercent: 0, memoryPercent: null },
    });

    expect(cpu!.ratioAtLine).toBe(null);
  });
});

describe("allocations no instance explains", () => {
  const ouTiny: Record<string, number> = {
    VCPU: 1,
    MEMORY_MB: 128,
    DISK_GB: 1,
  };
  const flavorResources: Map<
    string,
    Readonly<Record<string, number>>
  > = new Map([
    ["RegionOne/ou.tiny", ouTiny],
    ["RegionOne/pinned", { PCPU: 2, MEMORY_MB: 1024 }],
  ]);

  function hostHolding(vcpu: number, memoryMb: number): OpenStackCapacityHost {
    return host("compute-01.example.internal", {
      VCPU: inventory(4, 0, 4, vcpu),
      MEMORY_MB: inventory(15983, 512, 1, memoryMb),
      DISK_GB: inventory(144, 0, 1, 999),
    });
  }

  function mismatches(
    hostHeld: OpenStackCapacityHost,
    instances: Array<{
      flavorId: string | null;
      count: number;
      movingCount?: number;
    }>,
  ): Array<OpenStackHostAllocationMismatch> {
    return getOpenStackAllocationMismatches({
      hosts: [hostHeld],
      flavorResources,
      instances: instances.map(
        (row: {
          flavorId: string | null;
          count: number;
          movingCount?: number;
        }) => {
          return {
            regionName: "RegionOne",
            // Nova's short name on a service, full on a hypervisor: either joins.
            hypervisorName: "compute-01",
            flavorId: row.flavorId,
            count: row.count,
            movingCount: row.movingCount || 0,
          };
        },
      ),
    });
  }

  test("what a real recording holds adds up: three ou.tiny on 3 vCPUs and 384 MB", () => {
    expect(
      mismatches(hostHolding(3, 384), [{ flavorId: "ou.tiny", count: 3 }]),
    ).toEqual([]);
  });

  test("more than its instances explain is what an orphaned allocation looks like", () => {
    expect(
      mismatches(hostHolding(5, 1408), [{ flavorId: "ou.tiny", count: 3 }]),
    ).toEqual([
      {
        regionName: "RegionOne",
        hypervisorName: "compute-01.example.internal",
        vcpuExcess: 2,
        memoryMbExcess: 1024,
        instanceCount: 3,
      },
    ]);
  });

  test("an allocation on a host with no instances at all", () => {
    expect(mismatches(hostHolding(2, 1024), [])).toEqual([
      {
        regionName: "RegionOne",
        hypervisorName: "compute-01.example.internal",
        vcpuExcess: 2,
        memoryMbExcess: 1024,
        instanceCount: 0,
      },
    ]);
  });

  test("less than they explain says so, the other way round", () => {
    expect(
      mismatches(hostHolding(2, 256), [{ flavorId: "ou.tiny", count: 3 }])[0],
    ).toMatchObject({ vcpuExcess: -1, memoryMbExcess: -128 });
  });

  test("disk is no evidence: an instance booted from a volume holds none of its flavor's", () => {
    // Disk reads 999 against 3 here, and nothing is said of it.
    expect(
      mismatches(hostHolding(3, 384), [{ flavorId: "ou.tiny", count: 3 }]),
    ).toEqual([]);
  });

  test("anything on the host moving means it can't be judged: a move holds its own allocations", () => {
    expect(
      mismatches(hostHolding(9, 9000), [
        { flavorId: "ou.tiny", count: 3, movingCount: 1 },
      ]),
    ).toEqual([]);
  });

  test("a flavor the cloud no longer lists means it can't be judged either", () => {
    expect(
      mismatches(hostHolding(9, 9000), [
        { flavorId: "gone", count: 1 },
        { flavorId: "ou.tiny", count: 3 },
      ]),
    ).toEqual([]);
    expect(
      mismatches(hostHolding(9, 9000), [{ flavorId: null, count: 1 }]),
    ).toEqual([]);
  });

  test("a pinned flavor reads the same whichever class Placement holds it in", () => {
    const pinned: OpenStackCapacityHost = host("compute-01", {
      PCPU: inventory(8, 0, 1, 2),
      MEMORY_MB: inventory(4096, 0, 1, 1024),
    });

    expect(mismatches(pinned, [{ flavorId: "pinned", count: 1 }])).toEqual([]);
  });

  test("a provider with neither vCPUs nor memory is no host: a bare metal node, a NIC's", () => {
    expect(
      mismatches(
        host("node", { CUSTOM_BAREMETAL_GOLD: inventory(1, 0, 1, 1) }),
        [],
      ),
    ).toEqual([]);
  });

  test("the same host name in another region is another host", () => {
    expect(
      getOpenStackAllocationMismatches({
        hosts: [hostHolding(3, 384)],
        flavorResources: new Map([["RegionTwo/ou.tiny", ouTiny]]),
        instances: [
          {
            regionName: "RegionTwo",
            hypervisorName: "compute-01",
            flavorId: "ou.tiny",
            count: 3,
            movingCount: 0,
          },
        ],
      })[0],
    ).toMatchObject({ vcpuExcess: 3, memoryMbExcess: 384, instanceCount: 0 });
  });
});
