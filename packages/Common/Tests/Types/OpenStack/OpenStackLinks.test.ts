import { describe, expect, test } from "@jest/globals";
import { JSONObject } from "../../../Types/JSON";
import { SeededRandom, seededRandom, shuffled } from "../../Helpers/SeededRandom";
import {
  OPENSTACK_CEPH_STATUS_FACT,
  OPENSTACK_STORAGE_POOL_CEPH_LINK_FACT,
  OpenStackCephClusterCandidate,
  OpenStackHostNameForms,
  OpenStackMagnumClusterOfStack,
  OpenStackReachAcrossProducts,
  OpenStackServerOfNode,
  OpenStackStoragePoolCephLink,
  describeOpenStackReachAcrossProducts,
  getEmptyOpenStackReachAcrossProducts,
  getOnlyOpenStackMatch,
  getOpenStackCephHealthNow,
  getOpenStackCephStatusFact,
  getOpenStackHostNameForms,
  getOpenStackMagnumClusterOfServers,
  getOpenStackPoolNameCandidates,
  getOpenStackServerNamesOfStack,
  getOpenStackStackNameOfServer,
  getOpenStackStoragePoolCephChoice,
  getOpenStackStoragePoolCephLink,
  isOpenStackHostNameMatch,
  isOpenStackRbdProtocol,
  isOpenStackReachEmpty,
  isOpenStackStoragePoolCephLinked,
  parseOpenStackRbdLocation,
} from "../../../Types/OpenStack/OpenStackLinks";

/*
 * No link is made on a guess. A name that matches two parts links to neither. Each of the
 * joins between a cloud and the rest of OneUptime is held to that here.
 */

describe("a name that matches two parts links to neither", () => {
  test("one match is the match", () => {
    expect(getOnlyOpenStackMatch(["a"])).toBe("a");
  });

  test("none is none", () => {
    expect(getOnlyOpenStackMatch([])).toBeNull();
  });

  test("two is none, whichever they are", () => {
    expect(getOnlyOpenStackMatch(["a", "b"])).toBeNull();
    expect(getOnlyOpenStackMatch(["a", "a"])).toBeNull();
  });
});

describe("whether a host's name is a hypervisor's", () => {
  test.each([
    // The same name, in any case.
    ["compute-01", "compute-01", true],
    ["COMPUTE-01.example.internal", "compute-01.example.internal", true],
    // Nova keeps one length and the agent another.
    ["compute-01", "compute-01.example.internal", true],
    ["compute-01.example.internal", "compute-01", true],
    // Two full names in two domains are two machines, however alike they start.
    ["compute-01.east.example", "compute-01.west.example", false],
    // A name that merely begins another is another name.
    ["compute-1", "compute-10.example.internal", false],
    ["compute", "compute-01.example.internal", false],
    // An address is only ever itself.
    ["10.0.0.1", "10.0.0.1", true],
    ["10.0.0.1", "10.0.0.1.example.internal", false],
    ["10.0.0", "10.0.0.1", false],
    ["fe80::1", "fe80::1", true],
    // And nothing matches nothing.
    ["", "", false],
    ["compute-01", "", false],
    [null, "compute-01", false],
    [undefined, undefined, false],
  ])("%s and %s: %s", (first: unknown, second: unknown, match: boolean) => {
    expect(isOpenStackHostNameMatch(first as string, second as string)).toBe(
      match,
    );
    expect(isOpenStackHostNameMatch(second as string, first as string)).toBe(
      match,
    );
  });

  test.each([
    "localhost",
    "LOCALHOST",
    "localhost.localdomain",
    "localhost6",
    "ip6-localhost",
  ])("%s is every machine's name, so it is no machine's", (name: string) => {
    expect(isOpenStackHostNameMatch(name, name)).toBe(false);
    expect(isOpenStackHostNameMatch(name, "compute-01")).toBe(false);
    expect(getOpenStackHostNameForms(name)).toEqual({
      names: [],
      anyDomainOf: null,
    });
  });

  test("something far longer than a name can be is nobody's name", () => {
    const long: string = "a".repeat(100000);
    expect(isOpenStackHostNameMatch(long, long)).toBe(false);
    expect(isOpenStackHostNameMatch(long, `${long}.example`)).toBe(false);
    expect(getOpenStackHostNameForms(long).names).toEqual([]);
  });

  test("a long run of digits and dots is read in one pass, whatever it holds", () => {
    const digits: string = `${"1.".repeat(100000)}x`;
    expect(isOpenStackHostNameMatch(digits, "1.")).toBe(false);
    expect(getOpenStackHostNameForms("1.".repeat(100)).names).toEqual([
      "1.".repeat(100),
    ]);
  });

  test("a short name that fits two hypervisors in two domains links to neither", () => {
    const matches: Array<string> = [
      "compute-01.east.example",
      "compute-01.west.example",
    ].filter((name: string): boolean => {
      return isOpenStackHostNameMatch("compute-01", name);
    });
    expect(matches).toHaveLength(2);
    expect(getOnlyOpenStackMatch(matches)).toBeNull();
  });
});

describe("what a read has to ask a database for a name", () => {
  test.each<[string, OpenStackHostNameForms]>([
    ["compute-01", { names: ["compute-01"], anyDomainOf: "compute-01" }],
    ["COMPUTE-01", { names: ["compute-01"], anyDomainOf: "compute-01" }],
    [
      "compute-01.example.internal",
      {
        names: ["compute-01.example.internal", "compute-01"],
        anyDomainOf: null,
      },
    ],
    ["10.0.0.1", { names: ["10.0.0.1"], anyDomainOf: null }],
    ["fe80::1", { names: ["fe80::1"], anyDomainOf: null }],
    [".example", { names: [".example"], anyDomainOf: null }],
    ["", { names: [], anyDomainOf: null }],
  ])("%s", (name: string, forms: OpenStackHostNameForms) => {
    expect(getOpenStackHostNameForms(name)).toEqual(forms);
  });

  test("nothing at all asks for nothing", () => {
    expect(getOpenStackHostNameForms(null).names).toEqual([]);
    expect(getOpenStackHostNameForms(undefined).names).toEqual([]);
  });

  test("asks for exactly what the rule accepts, or a LIMIT could cut one of two real matches", () => {
    const names: Array<string> = [
      "compute-01",
      "COMPUTE-01",
      "compute-1",
      "compute",
      "compute-01.example.internal",
      "compute-01.EXAMPLE.internal",
      "compute-01.east.example",
      "compute-01.east",
      "web_1",
      "webx1",
      "web_1.example",
      "10.0.0.1",
      "10.0.0",
      "10.0.0.1.example",
      "fe80::1",
      "fe80::1.example",
      "localhost",
      "localhost.example",
      ".example",
      "",
    ];
    const asked: (forms: OpenStackHostNameForms, other: string) => boolean = (
      forms: OpenStackHostNameForms,
      other: string,
    ): boolean => {
      const lower: string = other.toLowerCase();
      return (
        forms.names.includes(lower) ||
        (forms.anyDomainOf !== null &&
          lower.startsWith(`${forms.anyDomainOf}.`))
      );
    };
    for (const first of names) {
      for (const second of names) {
        const matches: boolean = isOpenStackHostNameMatch(first, second);
        // A match is always asked for. What is asked for and isn't one is held by the rule.
        if (matches) {
          expect({
            first,
            second,
            asked: asked(getOpenStackHostNameForms(first), second),
          }).toEqual({ first, second, asked: true });
        }
        expect(isOpenStackHostNameMatch(second, first)).toBe(matches);
      }
    }
  });
});

describe("what Cinder's RBD driver says of itself", () => {
  const FSID: string = "0f3e8f6a-4d1c-4f7a-9c11-2b6f1e0a9d33";

  test("names the Ceph cluster by its fsid and the pool by its name", () => {
    expect(
      parseOpenStackRbdLocation(
        `ceph:/etc/ceph/ceph.conf:${FSID}:cinder:volumes`,
      ),
    ).toEqual({ clusterName: "ceph", fsid: FSID, poolName: "volumes" });
  });

  test("an uppercase fsid is the same fsid", () => {
    expect(
      parseOpenStackRbdLocation(
        `ceph:/etc/ceph/ceph.conf:${FSID.toUpperCase()}:cinder:volumes`,
      )?.fsid,
    ).toBe(FSID);
  });

  test.each([
    // What the LVM driver really writes: Tests/Fixtures/OpenStack/*/api/cinder-pools.json.
    "LVMVolumeDriver:compute-01:stack-volumes-lvmdriver-1:thin:0",
    "",
    null,
    undefined,
    "a:b:c",
    "ceph:/etc/ceph/ceph.conf:not-a-fsid:cinder:volumes",
  ])("%s says nothing about Ceph", (value: unknown) => {
    expect(parseOpenStackRbdLocation(value as string)).toBeNull();
  });

  test.each([
    ["ceph", true],
    ["Ceph", true],
    ["rbd", true],
    ["iSCSI", false],
    ["", false],
    [null, false],
  ])("a protocol of %s is RBD: %s", (protocol: unknown, isRbd: boolean) => {
    expect(isOpenStackRbdProtocol(protocol as string)).toBe(isRbd);
  });
});

describe("what can be said about a pool and Ceph", () => {
  const FSID: string = "0f3e8f6a-4d1c-4f7a-9c11-2b6f1e0a9d33";
  const EAST: OpenStackCephClusterCandidate = {
    id: "east",
    name: "ceph-east",
    fsid: FSID,
    poolNames: ["volumes", "images"],
  };
  const WEST: OpenStackCephClusterCandidate = {
    id: "west",
    name: "ceph-west",
    fsid: null,
    poolNames: ["cinder-west"],
  };

  function linkOf(data: {
    poolName?: string | undefined;
    facts?: JSONObject | undefined;
    clusters?: Array<OpenStackCephClusterCandidate> | undefined;
  }): OpenStackStoragePoolCephLink {
    return getOpenStackStoragePoolCephLink({
      poolName: data.poolName ?? "ctl@rbd-1#rbd-1",
      facts: data.facts ?? {},
      clusters: data.clusters ?? [EAST, WEST],
    });
  }

  test("what the driver says is a fact: Cinder named the cluster's fsid", () => {
    const link: OpenStackStoragePoolCephLink = linkOf({
      facts: { cephFsid: FSID.toUpperCase(), cephPool: "volumes" },
    });
    expect(link).toEqual({
      state: "from-fsid",
      clusterId: "east",
      clusterName: "ceph-east",
      cephPoolName: "volumes",
    });
    expect(isOpenStackStoragePoolCephLinked(link)).toBe(true);
  });

  test("two clusters saying one fsid is no fact at all", () => {
    expect(
      linkOf({
        facts: { cephFsid: FSID },
        clusters: [EAST, { ...WEST, fsid: FSID, poolNames: [] }],
      }).state,
    ).toBe("unknown");
  });

  test("an fsid no cluster here says isn't this cluster, however its pools are named", () => {
    const link: OpenStackStoragePoolCephLink = linkOf({
      poolName: "ctl@rbd-1#volumes",
      facts: { cephFsid: "11111111-1111-4111-8111-111111111111" },
    });
    expect(link.state).toBe("suggested");
    expect(isOpenStackStoragePoolCephLinked(link)).toBe(false);
  });

  test("a name is only a suggestion, and someone has to say so before it counts", () => {
    const link: OpenStackStoragePoolCephLink = linkOf({
      poolName: "ctl@rbd-1#volumes",
    });
    expect(link).toEqual({
      state: "suggested",
      clusterId: "east",
      clusterName: "ceph-east",
      cephPoolName: "volumes",
    });
    expect(isOpenStackStoragePoolCephLinked(link)).toBe(false);
  });

  test("a name in two clusters suggests neither", () => {
    expect(
      linkOf({
        poolName: "ctl@rbd-1#volumes",
        clusters: [EAST, { ...WEST, poolNames: ["volumes"] }],
      }),
    ).toEqual({
      state: "unknown",
      clusterId: null,
      clusterName: null,
      cephPoolName: null,
    });
  });

  describe("a name two Cinder pools hold suggests neither of them", () => {
    const ONE_CLUSTER: Array<OpenStackCephClusterCandidate> = [
      { id: "c1", name: "ceph-east", fsid: null, poolNames: ["volumes"] },
    ];

    test("the other direction of two clusters holding one name", () => {
      expect(
        getOpenStackStoragePoolCephLink({
          poolName: "ctl-1@rbd#volumes",
          facts: {},
          clusters: ONE_CLUSTER,
          otherPools: [{ poolName: "ctl-2@rbd#volumes", facts: {} }],
        }).state,
      ).toBe("unknown");
    });

    test("another pool's backend or Ceph pool counts as much as its name", () => {
      for (const other of [
        { poolName: "ctl-2@other#other", facts: { backend: "volumes" } },
        { poolName: "ctl-2@other#other", facts: { cephPool: "volumes" } },
      ]) {
        expect(
          getOpenStackStoragePoolCephLink({
            poolName: "ctl-1@rbd#volumes",
            facts: {},
            clusters: ONE_CLUSTER,
            otherPools: [other],
          }).state,
        ).toBe("unknown");
      }
    });

    test("a pool of another name takes nothing away", () => {
      const link: OpenStackStoragePoolCephLink =
        getOpenStackStoragePoolCephLink({
          poolName: "ctl-1@rbd#volumes",
          facts: {},
          clusters: ONE_CLUSTER,
          otherPools: [{ poolName: "ctl-2@lvm#lvm-1", facts: {} }],
        });
      expect(link.state).toBe("suggested");
      expect(link.clusterId).toBe("c1");
    });

    test("what someone answered, or the driver said, doesn't depend on it", () => {
      const otherPools: Array<{ poolName: string; facts: JSONObject }> = [
        { poolName: "ctl-2@rbd#volumes", facts: {} },
      ];
      expect(
        getOpenStackStoragePoolCephLink({
          poolName: "ctl-1@rbd#volumes",
          facts: {
            [OPENSTACK_STORAGE_POOL_CEPH_LINK_FACT]: {
              cephClusterId: "c1",
              isNotCeph: false,
            },
          },
          clusters: ONE_CLUSTER,
          otherPools,
        }).state,
      ).toBe("confirmed");
      expect(
        getOpenStackStoragePoolCephLink({
          poolName: "ctl-1@rbd#volumes",
          facts: { cephFsid: "abc" },
          clusters: [{ ...ONE_CLUSTER[0]!, fsid: "ABC" }],
          otherPools,
        }).state,
      ).toBe("from-fsid");
    });
  });

  test("a backend's name counts when the pool's own doesn't match", () => {
    expect(
      linkOf({
        poolName: "ctl@something#something",
        facts: { backend: "cinder-west" },
      }).clusterId,
    ).toBe("west");
  });

  test("what an operator answered outranks everything", () => {
    const confirmed: OpenStackStoragePoolCephLink = linkOf({
      poolName: "ctl@rbd-1#volumes",
      facts: {
        cephFsid: FSID,
        [OPENSTACK_STORAGE_POOL_CEPH_LINK_FACT]: {
          cephClusterId: "west",
          isNotCeph: false,
          confirmedAt: "2026-11-04T12:00:00.000Z",
        },
      },
    });
    expect(confirmed.state).toBe("confirmed");
    expect(confirmed.clusterName).toBe("ceph-west");
    expect(isOpenStackStoragePoolCephLinked(confirmed)).toBe(true);
  });

  test("someone saying it isn't on Ceph stops it asking", () => {
    expect(
      linkOf({
        poolName: "ctl@rbd-1#volumes",
        facts: {
          [OPENSTACK_STORAGE_POOL_CEPH_LINK_FACT]: {
            cephClusterId: null,
            isNotCeph: true,
            confirmedAt: "2026-11-04T12:00:00.000Z",
          },
        },
      }).state,
    ).toBe("not-ceph");
  });

  test("a chosen cluster that has since been deleted is no answer: it asks again", () => {
    expect(
      linkOf({
        poolName: "ctl@lvm#lvm",
        facts: {
          [OPENSTACK_STORAGE_POOL_CEPH_LINK_FACT]: {
            cephClusterId: "gone",
            isNotCeph: false,
            confirmedAt: "2026-11-04T12:00:00.000Z",
          },
        },
      }).state,
    ).toBe("unknown");
  });

  test("nothing to link it to, says so", () => {
    expect(linkOf({ clusters: [] }).state).toBe("no-clusters");
  });

  test("an LVM pool on a project with Ceph is asked about, and never guessed", () => {
    const link: OpenStackStoragePoolCephLink = linkOf({
      poolName: "compute-01@lvmdriver-1#lvmdriver-1",
      facts: { backend: "lvmdriver-1", vendor: "Open Source" },
    });
    expect(link.state).toBe("unknown");
    expect(isOpenStackStoragePoolCephLinked(link)).toBe(false);
  });

  test("the names a pool can go by, most certain first", () => {
    expect(
      getOpenStackPoolNameCandidates({
        poolName: "host@backend#tail",
        facts: { cephPool: "real", backend: "backend" },
      }),
    ).toEqual(["real", "tail", "backend"]);
    expect(
      getOpenStackPoolNameCandidates({ poolName: null, facts: null }),
    ).toEqual([]);
  });

  test("a saved answer reads back, and anything else reads as none", () => {
    expect(
      getOpenStackStoragePoolCephChoice({
        [OPENSTACK_STORAGE_POOL_CEPH_LINK_FACT]: {
          cephClusterId: "east",
          confirmedAt: "2026-11-04T12:00:00.000Z",
        },
      }),
    ).toEqual({
      cephClusterId: "east",
      isNotCeph: false,
      confirmedAt: "2026-11-04T12:00:00.000Z",
    });
    expect(getOpenStackStoragePoolCephChoice({})).toBeNull();
    expect(getOpenStackStoragePoolCephChoice(null)).toBeNull();
    expect(
      getOpenStackStoragePoolCephChoice({
        [OPENSTACK_STORAGE_POOL_CEPH_LINK_FACT]: "east",
      }),
    ).toBeNull();
  });

  test("Ceph's own trouble as a pool's fact reads back, and anything else reads as none", () => {
    expect(
      getOpenStackCephStatusFact({
        [OPENSTACK_CEPH_STATUS_FACT]: {
          clusterId: "east",
          clusterName: "ceph-east",
          healthStatus: 2,
        },
      }),
    ).toEqual({ clusterId: "east", clusterName: "ceph-east", healthStatus: 2 });
    expect(
      getOpenStackCephStatusFact({
        [OPENSTACK_CEPH_STATUS_FACT]: { clusterId: "east" },
      }),
    ).toBeNull();
    expect(getOpenStackCephStatusFact({})).toBeNull();
  });
});

describe("how long a Ceph cluster's own word counts for", () => {
  const NOW: Date = new Date("2026-11-04T12:00:00.000Z");
  const minutesAgo: (minutes: number) => Date = (minutes: number): Date => {
    return new Date(NOW.getTime() - minutes * 60 * 1000);
  };

  test.each<
    [string, number | null | undefined, Date | string | null, number | null]
  >([
    ["what it just said", 2, minutesAgo(1), 2],
    ["on the line", 1, minutesAgo(15), 1],
    [
      "past the line, an agent that stopped says nothing of now",
      2,
      minutesAgo(16),
      null,
    ],
    ["as it arrives from JSON", 0, minutesAgo(1).toISOString(), 0],
    ["a cluster that never reported", 2, null, null],
    ["a date that isn't one", 2, "soon", null],
    ["no health at all", null, minutesAgo(1), null],
    ["nothing at all", undefined, minutesAgo(1), null],
  ])(
    "%s",
    (
      _name: string,
      healthStatus: number | null | undefined,
      lastSeenAt: Date | string | null,
      expected: number | null,
    ) => {
      expect(
        getOpenStackCephHealthNow({ healthStatus, lastSeenAt, now: NOW }),
      ).toBe(expected);
    },
  );
});

describe("in words", () => {
  const reach: OpenStackReachAcrossProducts = {
    ...getEmptyOpenStackReachAcrossProducts(),
    hostCount: 3,
    kubernetesNodeCount: 2,
    kubernetesClusters: [{ id: "c", name: "prod", nodeCount: 2 }],
    serviceCount: 1,
  };

  test("says each thing it reaches", () => {
    expect(describeOpenStackReachAcrossProducts(reach)).toBe(
      "3 hosts, 2 Kubernetes nodes in 1 cluster, 1 service",
    );
  });

  test("its instances are part of the cloud, and say nothing of whether it reaches beyond", () => {
    expect(
      isOpenStackReachEmpty({
        ...getEmptyOpenStackReachAcrossProducts(),
        instanceCount: 3,
        instances: [{ id: "a", name: "web-1" }],
      }),
    ).toBe(true);
  });

  test("an empty reach is empty", () => {
    expect(isOpenStackReachEmpty(getEmptyOpenStackReachAcrossProducts())).toBe(
      true,
    );
    expect(isOpenStackReachEmpty(null)).toBe(true);
    expect(isOpenStackReachEmpty(reach)).toBe(false);
    expect(
      describeOpenStackReachAcrossProducts(
        getEmptyOpenStackReachAcrossProducts(),
      ),
    ).toBe("");
  });
});

describe("a Magnum cluster and the Kubernetes cluster it is", () => {
  const STACK: string = "ou-cluster-real-rfhmez6mgxk3";

  describe("the stack a server's name says built it", () => {
    test.each<[string, string]>([
      ["a control plane node", `${STACK}-master-0`],
      ["a worker", `${STACK}-node-12`],
      ["a worker on an older driver", `${STACK}-minion-3`],
    ])("%s", (_name: string, serverName: string) => {
      expect(getOpenStackStackNameOfServer(serverName)).toBe(STACK);
    });

    test("only the end of a name is read, so a stack can be called anything", () => {
      expect(getOpenStackStackNameOfServer("node-1-master-2-node-3")).toBe(
        "node-1-master-2",
      );
    });

    test.each<[string, string | null | undefined]>([
      ["no name", null],
      ["nothing", undefined],
      ["an empty name", ""],
      ["a name of its own", "web-1"],
      ["a role and no stack", "master-0"],
      ["a dash where the stack would be", "-master-0"],
      ["no number", `${STACK}-master`],
      ["a number with nothing in it", `${STACK}-master-`],
      ["a number that isn't one", `${STACK}-master-1a`],
      ["a role nothing gives", `${STACK}-worker-1`],
      ["a dash after the number", `${STACK}-master-1-`],
      ["a capital in the role", `${STACK}-Master-1`],
    ])("%s names no stack", (_name: string, serverName) => {
      expect(getOpenStackStackNameOfServer(serverName)).toBeNull();
    });

    test("a name as long as OpenStack allows, of nothing but dashes, costs one pass", () => {
      expect(getOpenStackStackNameOfServer("-".repeat(255))).toBeNull();
    });
  });

  describe("the names a stack's servers can have", () => {
    test("each role, up to what the cluster was asked for and past it", () => {
      const names: Array<string> = getOpenStackServerNamesOfStack({
        stackName: STACK,
        masterCount: 3,
        nodeCount: 40,
      });

      expect(names).toEqual(
        expect.arrayContaining([
          `${STACK}-master-0`,
          `${STACK}-master-2`,
          `${STACK}-master-22`,
          `${STACK}-node-0`,
          `${STACK}-node-39`,
          `${STACK}-node-59`,
          `${STACK}-minion-59`,
        ]),
      );
      expect(names).not.toContain(`${STACK}-master-23`);
      expect(names).not.toContain(`${STACK}-node-60`);
    });

    test.each<[string, number | null | undefined]>([
      ["not known", undefined],
      ["null", null],
      ["none", 0],
      ["a nonsense count", -5],
    ])("a count that is %s still looks at the first few", (_name, count) => {
      const names: Array<string> = getOpenStackServerNamesOfStack({
        stackName: STACK,
        masterCount: count,
        nodeCount: count,
      });
      expect(names).toContain(`${STACK}-master-0`);
      expect(names).toContain(`${STACK}-node-19`);
      expect(names).not.toContain(`${STACK}-node-20`);
    });

    test("a count past anything real is no unbounded read", () => {
      expect(
        getOpenStackServerNamesOfStack({
          stackName: STACK,
          masterCount: 1_000_000_000,
          nodeCount: 1_000_000_000,
        }).length,
      ).toBe(15000);
    });

    test("every name it gives reads back as that stack", () => {
      const random: SeededRandom = seededRandom(5743);
      for (let round: number = 0; round < 50; round++) {
        const stackName: string = `${["ou", "prod-a", "node-1", "x-master-1"][random(4)]}-${random(1_000_000)}`;
        for (const name of getOpenStackServerNamesOfStack({
          stackName,
          masterCount: random(5),
          nodeCount: random(50),
        })) {
          expect(getOpenStackStackNameOfServer(name)).toBe(stackName);
        }
      }
    });
  });

  describe("the one Magnum cluster these servers say they are", () => {
    const CLOUD: string = "cloud-a";

    const server: (
      name: string | null,
      overrides?: Partial<OpenStackServerOfNode>,
    ) => OpenStackServerOfNode = (
      name: string | null,
      overrides: Partial<OpenStackServerOfNode> = {},
    ): OpenStackServerOfNode => {
      return {
        instanceId: `uuid-of-${name}`,
        openStackCloudId: CLOUD,
        regionName: "RegionOne",
        name,
        ...overrides,
      };
    };

    const cluster: (
      externalId: string,
      stackName: string,
      overrides?: Partial<OpenStackMagnumClusterOfStack>,
    ) => OpenStackMagnumClusterOfStack = (
      externalId: string,
      stackName: string,
      overrides: Partial<OpenStackMagnumClusterOfStack> = {},
    ): OpenStackMagnumClusterOfStack => {
      return {
        openStackCloudId: CLOUD,
        regionName: "RegionOne",
        externalId,
        stackName,
        ...overrides,
      };
    };

    const answer: (
      servers: Array<OpenStackServerOfNode>,
      clusters: Array<OpenStackMagnumClusterOfStack>,
    ) => string | null = (
      servers: Array<OpenStackServerOfNode>,
      clusters: Array<OpenStackMagnumClusterOfStack>,
    ): string | null => {
      return (
        getOpenStackMagnumClusterOfServers({ servers, clusters })?.externalId ||
        null
      );
    };

    test("its servers say which it is", () => {
      expect(
        answer(
          [server("a-master-0"), server("a-node-0"), server("a-node-1")],
          [cluster("one", "a"), cluster("two", "b")],
        ),
      ).toBe("one");
    });

    test("a machine joined by hand, or a node group of its own, says nothing either way", () => {
      expect(
        answer(
          [server("a-master-0"), server("by-hand"), server("gpu-b1-node-0")],
          [cluster("one", "a")],
        ),
      ).toBe("one");
    });

    test.each<
      [string, Array<OpenStackServerOfNode>, Array<OpenStackMagnumClusterOfStack>]
    >([
      ["no servers", [], [cluster("one", "a")]],
      ["no clusters", [server("a-master-0")], []],
      ["no name that says anything", [server("web-1"), server(null)], [cluster("one", "web")]],
      ["a stack no cluster names", [server("c-master-0")], [cluster("one", "a")]],
      [
        "servers of two clusters",
        [server("a-master-0"), server("b-node-0")],
        [cluster("one", "a"), cluster("two", "b")],
      ],
      [
        "one stack name two clusters could be, in two of a cloud's projects",
        [server("a-master-0")],
        [cluster("one", "a"), cluster("two", "a")],
      ],
      [
        "a stack of that name in another region",
        [server("a-master-0")],
        [cluster("one", "a", { regionName: "RegionTwo" })],
      ],
      [
        "a stack of that name in another cloud",
        [server("a-master-0")],
        [cluster("one", "a", { openStackCloudId: "cloud-b" })],
      ],
      [
        "a server whose UUID two clouds hold",
        [
          server("a-master-0", { instanceId: "same" }),
          server("a-master-0", { instanceId: "same", openStackCloudId: "cloud-b" }),
        ],
        [cluster("one", "a")],
      ],
    ])("%s: no link", (_name, servers, clusters) => {
      expect(answer(servers, clusters)).toBeNull();
    });

    test("whichever order things are read in", () => {
      const random: SeededRandom = seededRandom(5743);
      const servers: Array<OpenStackServerOfNode> = [
        server("a-master-0"),
        server("a-node-0"),
        server("web-1"),
        server(null),
      ];
      const clusters: Array<OpenStackMagnumClusterOfStack> = [
        cluster("one", "a"),
        cluster("two", "b"),
        cluster("three", "a", { regionName: "RegionTwo" }),
      ];
      for (let round: number = 0; round < 50; round++) {
        expect(
          answer(shuffled(servers, random), shuffled(clusters, random)),
        ).toBe("one");
      }
    });
  });
});
