import { describe, expect, test } from "@jest/globals";
import XcpNgResource from "Common/Models/DatabaseModels/XcpNgResource";
import PageMap from "../../FeatureSet/Dashboard/src/Utils/PageMap";
import {
  ResourceTopologyGraph,
  ResourceTopologyNode,
  ResourceTopologyRelation,
} from "../../FeatureSet/Dashboard/src/Components/ResourceTopology/ResourceTopologyModel";
import { OpenIssueRecord } from "../../FeatureSet/Dashboard/src/Components/ResourceTopology/ResourceTopologyIssues";
import {
  XCP_NG_ROOT_ID,
  buildXcpNgTopology,
  xcpNgHostNodeId,
  xcpNgStorageNodeId,
  xcpNgVmNodeId,
} from "../../FeatureSet/Dashboard/src/Components/ResourceTopology/Builders/XcpNgTopology";

/*
 * An XCP-ng pool's topology (Builders/XcpNgTopology): the pool, its hosts,
 * the VMs each host runs and the storage repositories they use - shared
 * ones on the pool, local ones on their host - with the health the pool's
 * Overview gives each, VMs tied to the repositories their virtual disks are
 * on, and open incidents and alerts placed on the part their labels name.
 */

const NOW: Date = new Date("2026-11-24T12:00:00Z");
const FRESH: Date = new Date(NOW.getTime() - 30 * 1000);
const HOUR: number = 60 * 60 * 1000;
const GIB: number = 1024 * 1024 * 1024;

type RowFields = {
  [Key in keyof XcpNgResource]?: XcpNgResource[Key] | undefined;
};

function row(fields: RowFields): XcpNgResource {
  return Object.assign(new XcpNgResource(), { lastSeenAt: FRESH, ...fields });
}

function node(graph: ResourceTopologyGraph, id: string): ResourceTopologyNode {
  const found: ResourceTopologyNode | undefined = graph.nodes.get(id);
  if (!found) {
    throw new Error(`no ${id} in the graph`);
  }
  return found;
}

function issue(id: string, labels: Record<string, string>): OpenIssueRecord {
  return {
    type: "alert",
    id: id,
    title: id,
    number: id,
    severityName: "Warning",
    severityColor: null,
    stateName: "Created",
    createdAt: NOW,
    seriesLabels: labels,
    relatedIds: {},
  };
}

function issueIds(graph: ResourceTopologyGraph, id: string): Array<string> {
  return node(graph, id).issues.map((item: { id: string }): string => {
    return item.id;
  });
}

const rows: Array<XcpNgResource> = [
  row({
    kind: "Host",
    externalId: "h1",
    name: "xcp-01",
    powerState: "Running",
    isUp: true,
    isEnabled: true,
    latestCpuPercent: 42,
    latestMemoryPercent: 60,
    metricsUpdatedAt: FRESH,
  }),
  row({
    kind: "Host",
    externalId: "h2",
    name: "xcp-02",
    powerState: "Running",
    isUp: true,
    isEnabled: false,
  }),
  row({
    kind: "Host",
    externalId: "h3",
    name: "xcp-03",
    powerState: "Halted",
    isUp: false,
  }),
  row({
    kind: "Host",
    externalId: "h4",
    name: "xcp-04",
    powerState: "Unknown",
    isUp: false,
  }),
  row({
    kind: "VM",
    externalId: "v1",
    name: "web-01",
    powerState: "Running",
    isUp: true,
    isControlDomain: false,
    parentHostExternalId: "h1",
    parentHostName: "xcp-01",
    latestCpuPercent: 12,
    metricsUpdatedAt: FRESH,
  }),
  row({
    kind: "VM",
    externalId: "v2",
    name: "db-01",
    powerState: "Halted",
    isUp: false,
    isControlDomain: false,
    parentHostExternalId: "h1",
    parentHostName: "xcp-01",
    lastRunningAt: new Date(NOW.getTime() - 2 * HOUR),
  }),
  row({
    kind: "VM",
    externalId: "v3",
    name: "archive",
    powerState: "Halted",
    isUp: false,
    isControlDomain: false,
    parentHostExternalId: "h2",
    parentHostName: "xcp-02",
    lastRunningAt: new Date(NOW.getTime() - 30 * 24 * HOUR),
  }),
  row({
    kind: "VM",
    externalId: "v4",
    name: "win-03",
    powerState: "Suspended",
    isUp: false,
    isControlDomain: false,
  }),
  row({
    kind: "VM",
    externalId: "v5",
    name: "orphan",
    powerState: "Running",
    isUp: true,
    isControlDomain: false,
    parentHostExternalId: "gone",
    parentHostName: "gone",
  }),
  row({
    kind: "VM",
    externalId: "dom0-h1",
    name: "Control domain on host: xcp-01",
    isUp: true,
    isControlDomain: true,
    parentHostExternalId: "h1",
  }),
  row({
    kind: "StorageRepository",
    externalId: "s1",
    name: "NFS VM store",
    isShared: true,
    contentType: "user",
    srType: "nfs",
    latestDiskBytes: 92 * GIB,
    maxDiskBytes: 100 * GIB,
    virtualAllocationBytes: 80 * GIB,
  }),
  row({
    kind: "StorageRepository",
    externalId: "s2",
    name: "Local storage",
    isShared: false,
    parentHostExternalId: "h1",
    parentHostName: "xcp-01",
    contentType: "user",
    latestDiskBytes: 10 * GIB,
    maxDiskBytes: 100 * GIB,
    virtualAllocationBytes: 300 * GIB,
  }),
  row({
    kind: "StorageRepository",
    externalId: "s3",
    name: "Full",
    isShared: true,
    contentType: "user",
    latestDiskBytes: 99 * GIB,
    maxDiskBytes: 100 * GIB,
    virtualAllocationBytes: 0,
  }),
  row({
    kind: "StorageRepository",
    externalId: "s4",
    name: "XCP-ng Tools",
    isShared: true,
    contentType: "iso",
    latestDiskBytes: 0,
    maxDiskBytes: 0,
  }),
  row({
    kind: "VDI",
    externalId: "d1",
    name: "web-01 system",
    vmExternalId: "v1",
    storageRepositoryExternalId: "s1",
  }),
  row({
    kind: "VDI",
    externalId: "d2",
    name: "web-01 data",
    vmExternalId: "v1",
    storageRepositoryExternalId: "s1",
  }),
  row({
    kind: "VDI",
    externalId: "d3",
    name: "db-01 system",
    vmExternalId: "v2",
    storageRepositoryExternalId: "s2",
  }),
  row({
    kind: "VDI",
    externalId: "d4",
    name: "unattached",
    storageRepositoryExternalId: "s1",
  }),
  row({
    kind: "VDI",
    externalId: "d5",
    name: "dom0 disk",
    vmExternalId: "dom0-h1",
    storageRepositoryExternalId: "s2",
  }),
];

const graph: ResourceTopologyGraph = buildXcpNgTopology({
  pool: { id: "pool-row", name: "Production", lastSeenAt: FRESH },
  rows: rows,
  issues: [
    issue("by-xcp-ng-id", { "xcp_ng.id": "H3" }),
    issue("by-uuid", { uuid: "v1" }),
    issue("by-sr-uuid", { sr_uuid: "s3" }),
    issue("unknown", { "xcp_ng.id": "nobody" }),
  ],
  now: NOW,
});

describe("an XCP-ng pool's topology", () => {
  test("the pool is the root, reporting, a step from its Overview", () => {
    const pool: ResourceTopologyNode = node(graph, XCP_NG_ROOT_ID);
    expect(pool.kind).toBe("xcp_ng.pool");
    expect(pool.name).toBe("Production");
    expect(pool.health).toBe("healthy");
    expect(pool.status?.text).toBe("Reporting");
    expect(pool.link).toEqual({
      page: PageMap.XCP_NG_POOL_VIEW,
      modelId: "pool-row",
    });
  });

  test("hosts on the pool; VMs and local storage on their host; shared storage on the pool", () => {
    expect(node(graph, xcpNgHostNodeId("h1")).parentId).toBe(XCP_NG_ROOT_ID);
    expect(node(graph, xcpNgVmNodeId("v1")).parentId).toBe(
      xcpNgHostNodeId("h1"),
    );
    expect(node(graph, xcpNgStorageNodeId("s2")).parentId).toBe(
      xcpNgHostNodeId("h1"),
    );
    expect(node(graph, xcpNgStorageNodeId("s1")).parentId).toBe(XCP_NG_ROOT_ID);
    // A VM whose host the pool no longer reports, or that never ran, hangs from the pool.
    expect(node(graph, xcpNgVmNodeId("v5")).parentId).toBe(XCP_NG_ROOT_ID);
    expect(node(graph, xcpNgVmNodeId("v4")).parentId).toBe(XCP_NG_ROOT_ID);
  });

  test("the kinds are the ones ResourceTopologyKinds registers", () => {
    const kinds: Set<string> = new Set(
      Array.from(graph.nodes.values()).map(
        (candidate: ResourceTopologyNode): string => {
          return candidate.kind;
        },
      ),
    );
    expect(Array.from(kinds).sort()).toEqual([
      "xcp_ng.host",
      "xcp_ng.pool",
      "xcp_ng.sr",
      "xcp_ng.vm",
    ]);
  });

  test("a control domain is its host's own, and a virtual disk is no part: neither is drawn", () => {
    expect(graph.nodes.has(xcpNgVmNodeId("dom0-h1"))).toBe(false);
    expect(
      Array.from(graph.nodes.values()).some(
        (candidate: ResourceTopologyNode): boolean => {
          return candidate.name === "web-01 system";
        },
      ),
    ).toBe(false);
  });

  test("hosts: running healthy with its load, disabled amber, halted and not responding red", () => {
    const running: ResourceTopologyNode = node(graph, xcpNgHostNodeId("h1"));
    expect(running.health).toBe("healthy");
    expect(running.status?.text).toBe("Running");
    expect(running.facts).toEqual([
      { label: "CPU", value: "42%" },
      { label: "Memory", value: "60%" },
    ]);
    const disabled: ResourceTopologyNode = node(graph, xcpNgHostNodeId("h2"));
    expect(disabled.health).toBe("warning");
    expect(disabled.status?.text).toBe("Disabled");
    expect(node(graph, xcpNgHostNodeId("h3")).health).toBe("critical");
    expect(node(graph, xcpNgHostNodeId("h3")).status?.text).toBe("Halted");
    expect(node(graph, xcpNgHostNodeId("h4")).status?.text).toBe(
      "Not responding",
    );
  });

  test("VMs: running healthy; stopped after running amber; halted and left off, or suspended, off", () => {
    expect(node(graph, xcpNgVmNodeId("v1")).health).toBe("healthy");
    const stopped: ResourceTopologyNode = node(graph, xcpNgVmNodeId("v2"));
    expect(stopped.health).toBe("warning");
    expect(stopped.reasons?.[0]?.text).toBe(
      "Halted after running in the last 24 hours.",
    );
    expect(node(graph, xcpNgVmNodeId("v3")).health).toBe("off");
    expect(node(graph, xcpNgVmNodeId("v4")).health).toBe("off");
    expect(node(graph, xcpNgVmNodeId("v4")).status?.text).toBe("Suspended");
    // A VM reads where it runs.
    expect(node(graph, xcpNgVmNodeId("v1")).context).toBe("xcp-01");
  });

  test("storage: nearly full amber, full red, over-provisioned amber, an ISO library unknown", () => {
    const nearlyFull: ResourceTopologyNode = node(
      graph,
      xcpNgStorageNodeId("s1"),
    );
    expect(nearlyFull.health).toBe("warning");
    expect(nearlyFull.status).toEqual({
      text: "{{percent}} used",
      values: { percent: "92.0%" },
    });
    expect(node(graph, xcpNgStorageNodeId("s3")).health).toBe("critical");
    const thin: ResourceTopologyNode = node(graph, xcpNgStorageNodeId("s2"));
    expect(thin.health).toBe("warning");
    expect(thin.reasons?.[0]?.text).toBe(
      "Its disks are allocated {{percent}} of its size: they can fill it as they grow.",
    );
    // An ISO library has no size to fill: it says what it is.
    expect(node(graph, xcpNgStorageNodeId("s4")).health).toBe("unknown");
    expect(node(graph, xcpNgStorageNodeId("s4")).status?.text).toBe(
      "ISO library",
    );
  });

  test("a VM uses the storage repositories its virtual disks are on, once each", () => {
    const relations: Array<string> = graph.relations.map(
      (relation: ResourceTopologyRelation): string => {
        return `${relation.from} ${relation.label} ${relation.to}`;
      },
    );
    expect(relations.sort()).toEqual([
      `${xcpNgVmNodeId("v1")} Uses ${xcpNgStorageNodeId("s1")}`,
      `${xcpNgVmNodeId("v2")} Uses ${xcpNgStorageNodeId("s2")}`,
    ]);
    expect(graph.relations[0]!.inverseLabel).toBe("Used by");
  });

  test("each part is a step from its own page, by its UUID", () => {
    expect(node(graph, xcpNgHostNodeId("h1")).link).toEqual({
      page: PageMap.XCP_NG_POOL_VIEW_HOST_DETAIL,
      modelId: "pool-row",
      subModelId: "h1",
    });
    expect(node(graph, xcpNgVmNodeId("v1")).link?.page).toBe(
      PageMap.XCP_NG_POOL_VIEW_VM_DETAIL,
    );
    expect(node(graph, xcpNgStorageNodeId("s1")).link?.page).toBe(
      PageMap.XCP_NG_POOL_VIEW_STORAGE_DETAIL,
    );
  });

  test("open incidents and alerts land on the part their labels name, whatever the case; the rest on the pool", () => {
    expect(issueIds(graph, xcpNgHostNodeId("h3"))).toEqual(["by-xcp-ng-id"]);
    expect(issueIds(graph, xcpNgVmNodeId("v1"))).toEqual(["by-uuid"]);
    expect(issueIds(graph, xcpNgStorageNodeId("s3"))).toEqual(["by-sr-uuid"]);
    expect(issueIds(graph, XCP_NG_ROOT_ID)).toEqual(["unknown"]);
  });

  test("a part is searchable by its UUID", () => {
    expect(node(graph, xcpNgVmNodeId("v1")).keywords).toContain("v1");
    expect(node(graph, xcpNgStorageNodeId("s1")).keywords).toEqual([
      "s1",
      "nfs",
    ]);
  });
});

describe("a pool that is not reporting", () => {
  test("seen before: amber, Xen Orchestra stopped reporting it", () => {
    const quiet: ResourceTopologyGraph = buildXcpNgTopology({
      pool: {
        id: "pool-row",
        name: "Lab",
        lastSeenAt: new Date(NOW.getTime() - 3 * HOUR),
      },
      rows: [],
      now: NOW,
    });
    const pool: ResourceTopologyNode = node(quiet, XCP_NG_ROOT_ID);
    expect(pool.health).toBe("warning");
    expect(pool.status?.text).toBe("Not reporting");
    expect(pool.reasons?.[0]?.text).toBe(
      "Xen Orchestra stopped reporting this pool.",
    );
  });

  test("never seen: unknown, and named XCP-ng when it has no name yet", () => {
    const fresh: ResourceTopologyGraph = buildXcpNgTopology({
      pool: { id: "pool-row", name: "", lastSeenAt: null },
      rows: [],
      now: NOW,
    });
    const pool: ResourceTopologyNode = node(fresh, XCP_NG_ROOT_ID);
    expect(pool.health).toBe("unknown");
    expect(pool.status?.text).toBe("No data yet");
    expect(pool.name).toBe("XCP-ng");
    expect(fresh.nodes.size).toBe(1);
  });

  test("a recent part counts as reporting even before the pool's own read", () => {
    const reporting: ResourceTopologyGraph = buildXcpNgTopology({
      pool: { id: "pool-row", name: "Lab", lastSeenAt: null },
      rows: [row({ kind: "Host", externalId: "h1", name: "a", isUp: true })],
      now: NOW,
    });
    expect(node(reporting, XCP_NG_ROOT_ID).health).toBe("healthy");
  });
});
