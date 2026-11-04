import { describe, expect, test } from "@jest/globals";
import { JSONObject } from "../../../Types/JSON";
import {
  OPENSTACK_CEPH_STATUS_FACT,
  OPENSTACK_STORAGE_POOL_CEPH_LINK_FACT,
  OpenStackCephClusterCandidate,
  OpenStackReachAcrossProducts,
  OpenStackStoragePoolCephLink,
  describeOpenStackReachAcrossProducts,
  getEmptyOpenStackReachAcrossProducts,
  getOnlyOpenStackMatch,
  getOpenStackCephStatusFact,
  getOpenStackPoolNameCandidates,
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
    expect(
      isOpenStackHostNameMatch(first as string, second as string),
    ).toBe(match);
    expect(
      isOpenStackHostNameMatch(second as string, first as string),
    ).toBe(match);
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

describe("what Cinder's RBD driver says of itself", () => {
  const FSID: string = "0f3e8f6a-4d1c-4f7a-9c11-2b6f1e0a9d33";

  test("names the Ceph cluster by its fsid and the pool by its name", () => {
    expect(
      parseOpenStackRbdLocation(`ceph:/etc/ceph/ceph.conf:${FSID}:cinder:volumes`),
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
