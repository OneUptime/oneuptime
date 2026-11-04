import { describe, expect, test } from "@jest/globals";
import { JSONObject } from "Common/Types/JSON";
import { OpenStackCredential } from "Common/Types/OpenStack/OpenStackProbeCollection";
import {
  WANTED_COMPUTE_MICROVERSION,
  chooseComputeMicroversion,
  compareMicroversions,
  computeMicroversionHeaders,
  toNovaLimits,
  toNovaQuota,
} from "../../../Utils/OpenStack/Collectors/ComputeCollector";
import {
  getPortScopes,
  toNeutronQuota,
} from "../../../Utils/OpenStack/Collectors/NetworkCollector";
import {
  toPlacementAllocations,
  toPlacementInventories,
  toPlacementUsages,
} from "../../../Utils/OpenStack/Collectors/PlacementCollector";
import {
  CINDER_MICROVERSION,
  toCinderLimits,
} from "../../../Utils/OpenStack/Collectors/VolumeCollector";
import OpenStackCollectorMemory, {
  INSTANCE_STATE_IDLE_TIMEOUT_IN_MS,
  OpenStackInstanceState,
  TOKEN_EXPIRY_MARGIN_IN_MS,
  TOKEN_UNKNOWN_EXPIRY_IN_MS,
  getOpenStackCredentialKey,
} from "../../../Utils/OpenStack/OpenStackCollectorMemory";
import {
  toCinderPool,
  toCinderVolume,
  toGlanceImage,
  toKeystoneProject,
  toNeutronFloatingIp,
  toNeutronNetwork,
  toNeutronPort,
  toNeutronRouter,
  toNeutronSubnetAvailabilities,
  toNovaAggregate,
  toNovaHypervisor,
  toNovaServer,
} from "../../../Utils/OpenStack/OpenStackInventory";
import { OpenStackToken } from "../../../Utils/OpenStack/OpenStackKeystone";

/*
 * The smaller parts a collection is made of, on what a healthy DevStack never answers: an
 * older Nova, a backend that says "infinite", an instance that failed before it was placed,
 * and what the probe keeps between collections.
 */

const PROJECT: { id: string; name: string } = { id: "p1", name: "payments" };

describe("the compute microversion", () => {
  test.each([
    ["2.87", "2.87", 0],
    ["2.88", "2.87", 1],
    ["2.9", "2.87", -78],
    ["3.0", "2.87", 1],
    ["1.100", "2.1", -1],
    ["not a version", "2.87", 0],
    ["2", "2.87", 0],
    ["2.x", "2.87", 0],
  ])("%s against %s", (first: string, second: string, sign: number) => {
    expect(Math.sign(compareMicroversions(first, second))).toBe(
      Math.sign(sign),
    );
  });

  function versions(max: unknown, min?: unknown): JSONObject {
    return {
      versions: [
        { id: "v2.0", version: "", min_version: "" },
        { id: "v2.1", version: max, min_version: min },
      ],
    } as unknown as JSONObject;
  }

  test("the one that says what a hypervisor holds, where Nova speaks it", () => {
    expect(chooseComputeMicroversion(versions("2.96", "2.1"))).toBe(
      WANTED_COMPUTE_MICROVERSION,
    );
    expect(WANTED_COMPUTE_MICROVERSION).toBe("2.87");
  });

  test("the most an older Nova speaks", () => {
    expect(chooseComputeMicroversion(versions("2.60", "2.1"))).toBe("2.60");
  });

  test("the least a newer Nova speaks, which then has no such numbers to send", () => {
    expect(chooseComputeMicroversion(versions("2.200", "2.90"))).toBe("2.90");
  });

  test("a minimum that says nothing is no reason to go without", () => {
    expect(chooseComputeMicroversion(versions("2.96"))).toBe("2.87");
    expect(chooseComputeMicroversion(versions("2.96", ""))).toBe("2.87");
  });

  test.each([
    ["no list", {}],
    ["no v2.1", { versions: [{ id: "v2.0", version: "2.1" }] }],
    ["a v2.1 with no version", { versions: [{ id: "v2.1", version: "" }] }],
    ["a v2.1 with nonsense", { versions: [{ id: "v2.1", version: "many" }] }],
    ["a list of nothing useful", { versions: [null, 7] }],
    ["a list that is not one", { versions: "2.87" }],
  ])(
    "%s: a Nova older than microversions, asked without saying",
    (_name: string, body: Record<string, unknown>) => {
      expect(chooseComputeMicroversion(body as JSONObject)).toBeNull();
    },
  );

  test("said both ways, because older Novas only read the one", () => {
    expect(computeMicroversionHeaders("2.87")).toEqual({
      "OpenStack-API-Version": "compute 2.87",
      "X-OpenStack-Nova-API-Version": "2.87",
    });
    expect(computeMicroversionHeaders(null)).toEqual({});
  });
});

describe("what a project may use", () => {
  test("Nova's quotas: every name the exporter has, 0 where this version no longer says", () => {
    const record: ReturnType<typeof toNovaQuota> = toNovaQuota(PROJECT, {
      quota_set: {
        cores: { in_use: 2, reserved: 1, limit: 20 },
        ram: "not a quota",
      },
    });

    expect(record).toMatchObject({ projectId: "p1", projectName: "payments" });
    expect(record.quotas["cores"]).toEqual({
      inUse: 2,
      reserved: 1,
      limit: 20,
    });
    expect(record.quotas["ram"]).toEqual({ inUse: 0, reserved: 0, limit: 0 });
    expect(record.quotas["floating_ips"]).toEqual({
      inUse: 0,
      reserved: 0,
      limit: 0,
    });
    expect(Object.keys(record.quotas)).toHaveLength(14);
  });

  test("Nova's limits: what it does not say is not 0", () => {
    expect(
      toNovaLimits(PROJECT, {
        limits: { absolute: { maxTotalCores: 20, totalCoresUsed: "x" } },
      }),
    ).toMatchObject({
      maxTotalCores: 20,
      totalCoresUsed: null,
      totalRAMUsed: null,
    });
    expect(toNovaLimits(PROJECT, {}).maxTotalCores).toBeNull();
  });

  test("Neutron's quotas say used", () => {
    const record: ReturnType<typeof toNeutronQuota> = toNeutronQuota(PROJECT, {
      quota: { floatingip: { used: 1, reserved: 0, limit: 50 } },
    });

    expect(record.quotas["floatingip"]).toEqual({
      used: 1,
      reserved: 0,
      limit: 50,
    });
    expect(record.quotas["router"]).toEqual({ used: 0, reserved: 0, limit: 0 });
  });

  test("Cinder's, with usage and without", () => {
    expect(
      toCinderLimits(PROJECT, {
        quota_set: {
          gigabytes: { limit: 1000, in_use: 3 },
          backup_gigabytes: 2000,
          gigabytes_lvm: { limit: 100, in_use: 1 },
          gigabytes_ceph: 200,
          gigabytes_bad: "x",
          volumes: 10,
        },
      }),
    ).toEqual({
      projectId: "p1",
      projectName: "payments",
      volumeMaxGb: 1000,
      volumeUsedGb: 3,
      backupMaxGb: 2000,
      // A plain number says how much may be used, and nothing of how much is.
      backupUsedGb: null,
      typeQuotaGb: { lvm: 100, ceph: 200 },
    });
  });

  test("Cinder is asked as what parity was checked against", () => {
    expect(CINDER_MICROVERSION).toBe("3.50");
  });
});

describe("what Placement says", () => {
  test("inventories, with what it does not say left as nothing", () => {
    expect(
      toPlacementInventories({
        inventories: {
          VCPU: { total: 4, reserved: 0, allocation_ratio: 16 },
          DISK_GB: { total: "x" },
          MEMORY_MB: null,
        },
      }),
    ).toEqual([
      { resourceClass: "VCPU", total: 4, reserved: 0, allocationRatio: 16 },
      {
        resourceClass: "DISK_GB",
        total: null,
        reserved: null,
        allocationRatio: null,
      },
      {
        resourceClass: "MEMORY_MB",
        total: null,
        reserved: null,
        allocationRatio: null,
      },
    ]);
    expect(toPlacementInventories({})).toEqual([]);
  });

  test("usages, without what is not a number", () => {
    expect(
      toPlacementUsages({ usages: { VCPU: 3, DISK_GB: "x", MEMORY_MB: null } }),
    ).toEqual({ VCPU: 3 });
    expect(toPlacementUsages({})).toEqual({});
  });

  test("allocations, one per consumer and resource", () => {
    expect(
      toPlacementAllocations({
        allocations: {
          "server-1": { resources: { VCPU: 1, MEMORY_MB: 512, DISK_GB: "x" } },
          "server-2": {},
          "server-3": null,
        },
      }),
    ).toEqual([
      { consumerId: "server-1", resourceClass: "VCPU", amount: 1 },
      { consumerId: "server-1", resourceClass: "MEMORY_MB", amount: 512 },
    ]);
    expect(toPlacementAllocations({})).toEqual([]);
  });
});

describe("the scopes ports are read under", () => {
  test("with nothing named, one list of every port: that is what was asked for", () => {
    expect(getPortScopes({ collectPorts: true })).toEqual([{}]);
  });

  test("each network and project named is a list of its own", () => {
    expect(
      getPortScopes({
        collectPorts: true,
        portNetworkIds: ["n1", "n2"],
        portProjectIds: ["p1"],
      }),
    ).toEqual([
      { network_id: "n1" },
      { network_id: "n2" },
      { project_id: "p1" },
    ]);
  });
});

describe("what a record keeps of an answer", () => {
  test("an instance with no id is not an instance", () => {
    expect(toNovaServer({ name: "x" })).toBeNull();
  });

  test("an instance that failed before it was placed has nowhere to say it runs", () => {
    expect(
      toNovaServer({
        id: "s1",
        status: "ERROR",
        "OS-EXT-SRV-ATTR:hypervisor_hostname": null,
        fault: {
          message: "No valid host was found.",
          details:
            "Traceback (most recent call last): a long secret-looking thing",
        },
      }),
    ).toMatchObject({
      id: "s1",
      hypervisorHostname: null,
      faultMessage: "No valid host was found.",
    });
  });

  test("a fault's traceback stays with Nova", () => {
    expect(
      JSON.stringify(
        toNovaServer({
          id: "s1",
          fault: { message: "m", details: "Traceback" },
        }),
      ),
    ).not.toContain("Traceback");
  });

  test("an older Nova's flavor has an id, a newer one's a name", () => {
    expect(toNovaServer({ id: "s", flavor: { id: "1" } })?.flavorId).toBe("1");
    expect(
      toNovaServer({ id: "s", flavor: { original_name: "m1" } }),
    ).toMatchObject({ flavorId: null, flavorName: "m1" });
  });

  test("a hypervisor's vCPUs: its topology when it has one, as the exporter counts", () => {
    expect(
      toNovaHypervisor({
        vcpus: 4,
        cpu_info: { topology: { cells: 2, sockets: 1, cores: 8, threads: 2 } },
      }).vcpus,
    ).toBe(32);
  });

  test("before microversion 2.28 cpu_info is JSON in a string", () => {
    expect(
      toNovaHypervisor({
        vcpus: 4,
        cpu_info: JSON.stringify({
          topology: { sockets: 1, cores: 2, threads: 2 },
        }),
      }).vcpus,
    ).toBe(4);
  });

  test.each([
    ["none", undefined],
    ["an empty one", {}],
    ["one that is not JSON", "not json"],
  ])("cpu_info of %s: the plain number", (_name: string, cpuInfo: unknown) => {
    expect(
      toNovaHypervisor({ vcpus: 4, cpu_info: cpuInfo } as JSONObject).vcpus,
    ).toBe(4);
  });

  test("from 2.88 a hypervisor says none of it, and it stays unsaid", () => {
    expect(
      toNovaHypervisor({
        hypervisor_hostname: "h",
        service: { host: "short" },
      }),
    ).toMatchObject({
      hostname: "h",
      serviceHost: "short",
      vcpus: null,
      memoryMb: null,
      localGb: null,
      runningVms: null,
    });
  });

  test("an aggregate only there to set a zone is no group anyone made", () => {
    expect(
      toNovaAggregate({ name: "a", metadata: { availability_zone: "z" } })
        .isZoneOnly,
    ).toBe(true);
    expect(
      toNovaAggregate({
        name: "a",
        metadata: { availability_zone: "z", ssd: "1" },
      }).isZoneOnly,
    ).toBe(false);
    expect(toNovaAggregate({ name: "a" }).isZoneOnly).toBe(false);
  });

  test('a backend\'s "infinite" and "unknown" are no capacity', () => {
    expect(
      toCinderPool({
        name: "p",
        capabilities: {
          free_capacity_gb: "infinite",
          total_capacity_gb: "unknown",
        },
      }),
    ).toMatchObject({ freeCapacityGb: null, totalCapacityGb: null });
  });

  test("a number in a string is that number", () => {
    expect(
      toCinderPool({ capabilities: { free_capacity_gb: "12.5" } })
        .freeCapacityGb,
    ).toBe(12.5);
  });

  test("a volume says the first thing it is attached to", () => {
    expect(
      toCinderVolume({
        attachments: [{ server_id: "s1" }, { server_id: "s2" }],
      }).serverId,
    ).toBe("s1");
    expect(toCinderVolume({ attachments: [] }).serverId).toBeNull();
    expect(toCinderVolume({}).serverId).toBeNull();
  });

  test("an image still queued has no size yet, and reads 0 as the exporter's does", () => {
    expect(toGlanceImage({ id: "i", size: null }).sizeBytes).toBe(0);
  });

  test("a floating IP's router and port, and nothing made up when it has neither", () => {
    expect(
      toNeutronFloatingIp({ router_id: "r", port_id: "p", tenant_id: "t" }),
    ).toMatchObject({ routerId: "r", portId: "p", projectId: "t" });
    expect(toNeutronFloatingIp({})).toMatchObject({
      routerId: null,
      portId: null,
      projectId: null,
    });
  });

  test("a router's gateway, and one with none", () => {
    expect(
      toNeutronRouter({ external_gateway_info: { network_id: "n" } })
        .externalNetworkId,
    ).toBe("n");
    expect(
      toNeutronRouter({ external_gateway_info: null }).externalNetworkId,
    ).toBeNull();
  });

  test("a network's segment can be a number or text, and the series are text", () => {
    expect(
      toNeutronNetwork({ "provider:segmentation_id": 1234 }).segmentationId,
    ).toBe("1234");
    expect(toNeutronNetwork({}).mtu).toBe(0);
    expect(toNeutronNetwork({ project_id: "p" }).tenantId).toBe("p");
    expect(toNeutronNetwork({ tenant_id: "t", project_id: "p" }).tenantId).toBe(
      "t",
    );
  });

  test("a port's addresses, and what is not one left out", () => {
    expect(
      toNeutronPort({
        fixed_ips: [{ ip_address: "10.0.0.1" }, {}, null, { ip_address: "" }],
      }).fixedIps,
    ).toEqual(["10.0.0.1"]);
    expect(toNeutronPort({}).fixedIps).toEqual([]);
  });

  test("a network's availability, one record per subnet", () => {
    expect(
      toNeutronSubnetAvailabilities({
        network_id: "n",
        network_name: "net",
        tenant_id: "t",
        subnet_ip_availability: [
          { cidr: "10.0.0.0/24", total_ips: 253, used_ips: 3, ip_version: 4 },
          {
            cidr: "2001:db8::/64",
            total_ips: 1.8e19,
            used_ips: 2,
            ip_version: 6,
          },
        ],
      }),
    ).toHaveLength(2);
    expect(toNeutronSubnetAvailabilities({ network_id: "n" })).toEqual([]);
  });

  test("a project's tags, and what is not a tag left out", () => {
    expect(toKeystoneProject({ tags: ["a", 1, null, {}] }).tags).toEqual([
      "a",
      "1",
    ]);
    expect(toKeystoneProject({}).tags).toEqual([]);
  });
});

describe("what is kept between collections", () => {
  const CREDENTIAL: OpenStackCredential = {
    kind: "applicationCredential",
    id: "an-id",
    secret: "the-secret-itself",
  };

  function key(
    overrides: Partial<Parameters<typeof getOpenStackCredentialKey>[0]> = {},
  ): string {
    return getOpenStackCredentialKey({
      openStackCloudId: "cloud-1",
      authUrl: "https://keystone.example.com",
      credential: CREDENTIAL,
      trustedFingerprints: ["AA", "BB"],
      ...overrides,
    });
  }

  function token(expiresAt: number | null): OpenStackToken {
    return {
      id: "t",
      expiresAt: expiresAt,
      catalog: [],
      projectId: null,
      projectName: null,
      roleNames: [],
      hasAccessRules: false,
      isUnrestricted: false,
    };
  }

  describe("the key everything is kept under", () => {
    test("is a hash: the secret itself is not what the map holds", () => {
      expect(key()).toMatch(/^[0-9a-f]{64}$/);
      expect(key()).not.toContain("the-secret-itself");
    });

    test("is the same for the same thing, whatever order the certificates come in", () => {
      expect(key({ trustedFingerprints: ["BB", "AA"] })).toBe(key());
    });

    test.each([
      ["another cloud", { openStackCloudId: "cloud-2" }],
      ["another address", { authUrl: "https://other.example.com" }],
      ["another secret", { credential: { ...CREDENTIAL, secret: "new" } }],
      ["another certificate", { trustedFingerprints: ["CC"] }],
    ])(
      "%s starts clean: a token bought with the old one is never reused",
      (_name: string, overrides: Record<string, unknown>) => {
        expect(key(overrides)).not.toBe(key());
      },
    );
  });

  describe("a token", () => {
    test("is good until shortly before it ends", () => {
      const memory: OpenStackCollectorMemory = new OpenStackCollectorMemory();
      const expiresAt: number = 1_000_000_000;

      memory.setSession({
        key: "k",
        token: token(expiresAt),
        refusedReads: new Set(),
        now: 0,
      });

      expect(
        memory.getSession("k", expiresAt - TOKEN_EXPIRY_MARGIN_IN_MS - 1),
      ).not.toBeNull();
      expect(
        memory.getSession("k", expiresAt - TOKEN_EXPIRY_MARGIN_IN_MS),
      ).toBeNull();
      // And it is gone now.
      expect(memory.sessionCount()).toBe(0);
    });

    test("that names no end is kept for about as long as Keystone's default", () => {
      const memory: OpenStackCollectorMemory = new OpenStackCollectorMemory();

      memory.setSession({
        key: "k",
        token: token(null),
        refusedReads: new Set(),
        now: 1000,
      });

      expect(
        memory.getSession("k", 1000 + TOKEN_UNKNOWN_EXPIRY_IN_MS - 1),
      ).not.toBeNull();
      expect(
        memory.getSession("k", 1000 + TOKEN_UNKNOWN_EXPIRY_IN_MS),
      ).toBeNull();
    });

    test("can be forgotten: a refused credential's is no use to anyone", () => {
      const memory: OpenStackCollectorMemory = new OpenStackCollectorMemory();

      memory.setSession({
        key: "k",
        token: token(null),
        refusedReads: new Set(),
        now: 0,
      });
      memory.forgetSession("k");

      expect(memory.getSession("k", 1)).toBeNull();
    });

    test("there is a limit to how many, oldest out first", () => {
      const memory: OpenStackCollectorMemory = new OpenStackCollectorMemory();

      for (let index: number = 0; index < 600; index++) {
        memory.setSession({
          key: `k-${index}`,
          token: token(null),
          refusedReads: new Set(),
          now: 0,
        });
      }

      expect(memory.sessionCount()).toBe(500);
      expect(memory.getSession("k-0", 1)).toBeNull();
      expect(memory.getSession("k-599", 1)).not.toBeNull();
    });

    test("what was refused goes with it, so the next collection does not ask to be told again", () => {
      const memory: OpenStackCollectorMemory = new OpenStackCollectorMemory();

      memory.setSession({
        key: "k",
        token: token(null),
        refusedReads: new Set(["identity:users"]),
        now: 0,
      });

      expect(
        memory.getSession("k", 1)?.refusedReads.has("identity:users"),
      ).toBe(true);
    });
  });

  describe("an instance list", () => {
    function state(lastUsedAt: number): OpenStackInstanceState {
      return {
        servers: new Map(),
        lastFullReadAt: lastUsedAt,
        cursor: "2026-11-04T12:00:00Z",
        isOwnProjectOnly: false,
        lastUsedAt: lastUsedAt,
      };
    }

    test("not used for an hour is forgotten: the cloud moved to another probe", () => {
      const memory: OpenStackCollectorMemory = new OpenStackCollectorMemory();

      memory.setInstanceState("k", state(0));

      expect(
        memory.getInstanceState("k", INSTANCE_STATE_IDLE_TIMEOUT_IN_MS),
      ).not.toBeNull();
      expect(
        memory.getInstanceState("k", INSTANCE_STATE_IDLE_TIMEOUT_IN_MS + 1),
      ).toBeNull();
    });

    test("there are far fewer of these than of tokens, because each can hold a whole cloud", () => {
      const memory: OpenStackCollectorMemory = new OpenStackCollectorMemory();

      for (let index: number = 0; index < 40; index++) {
        memory.setInstanceState(`k-${index}`, state(0));
      }

      expect(memory.getInstanceState("k-0", 1)).toBeNull();
      expect(memory.getInstanceState("k-7", 1)).toBeNull();
      expect(memory.getInstanceState("k-8", 1)).not.toBeNull();
      expect(memory.getInstanceState("k-39", 1)).not.toBeNull();
    });
  });

  describe("a small fact", () => {
    test("is recalled for as long as it was asked to be, and no longer", () => {
      const memory: OpenStackCollectorMemory = new OpenStackCollectorMemory();

      memory.remember("k", "value", 1000);

      expect(memory.recall<string>("k", 500, 1500)).toBe("value");
      expect(memory.recall<string>("k", 500, 1501)).toBeUndefined();
    });

    test("that was never kept is nothing", () => {
      expect(
        new OpenStackCollectorMemory().recall<string>("k", 500, 0),
      ).toBeUndefined();
    });

    test("false is a fact too", () => {
      const memory: OpenStackCollectorMemory = new OpenStackCollectorMemory();

      memory.remember("k", false, 0);

      expect(memory.recall<boolean>("k", 500, 1)).toBe(false);
    });

    test("kept again is kept from then", () => {
      const memory: OpenStackCollectorMemory = new OpenStackCollectorMemory();

      memory.remember("k", 1, 0);
      memory.remember("k", 2, 1000);

      expect(memory.recall<number>("k", 500, 1400)).toBe(2);
    });
  });

  test("all of it can go at once", () => {
    const memory: OpenStackCollectorMemory = new OpenStackCollectorMemory();

    memory.setSession({
      key: "k",
      token: token(null),
      refusedReads: new Set(),
      now: 0,
    });
    memory.remember("k", 1, 0);
    memory.backoff.recordFailure("k", {
      now: 0,
      random: 0.5,
      baseInMs: 1000,
      maxInMs: 1000,
      code: "ApiError" as never,
      message: "No.",
    });

    memory.clear();

    expect(memory.sessionCount()).toBe(0);
    expect(memory.recall<number>("k", 500, 1)).toBeUndefined();
    expect(memory.backoff.size()).toBe(0);
  });
});
