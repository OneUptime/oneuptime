import { describe, expect, test } from "@jest/globals";
import VMwareResource from "Common/Models/DatabaseModels/VMwareResource";
import { VMwareResourceKind } from "Common/Types/Monitor/MonitorStepVMwareMonitor";
import VMwareCollectionStatus from "Common/Types/VMware/VMwareCollectionStatus";
import PageMap from "../../FeatureSet/Dashboard/src/Utils/PageMap";
import {
  ResourceTopologyGraph,
  ResourceTopologyNode,
} from "../../FeatureSet/Dashboard/src/Components/ResourceTopology/ResourceTopologyModel";
import { OpenIssueRecord } from "../../FeatureSet/Dashboard/src/Components/ResourceTopology/ResourceTopologyIssues";
import {
  VMWARE_ROOT_ID,
  VMWARE_TOPOLOGY_STALE_MS,
  buildVMwareTopology,
} from "../../FeatureSet/Dashboard/src/Components/ResourceTopology/Builders/VMwareTopology";

/*
 * A vCenter's topology from its VMwareResource rows: the containment the
 * vCenter's own pages list, the health those pages give, and every open
 * incident or alert on the part its labels name.
 */

const NOW: Date = new Date("2026-10-21T12:00:00Z");
const FRESH: Date = new Date(NOW.getTime() - 60 * 1000);
const STALE: Date = new Date(NOW.getTime() - VMWARE_TOPOLOGY_STALE_MS - 1000);
const VCENTER: { id: string; name: string; lastSeenAt: Date } = {
  id: "vc-row",
  name: "vcenter-prod",
  lastSeenAt: FRESH,
};

function row(fields: Partial<VMwareResource>): VMwareResource {
  return Object.assign(new VMwareResource(), fields);
}

function estate(): Array<VMwareResource> {
  return [
    row({
      kind: VMwareResourceKind.Datacenter,
      externalId: "dc/Amsterdam",
      name: "Amsterdam",
      hostCount: 3,
      poweredOnHostCount: 3,
    }),
    row({
      kind: VMwareResourceKind.Cluster,
      externalId: "cluster/ams-prod",
      name: "ams-prod",
      clusterName: "ams-prod",
      datacenterName: "Amsterdam",
      hostCount: 3,
      effectiveHostCount: 2,
    }),
    row({
      kind: VMwareResourceKind.Host,
      externalId: "host/esx-01",
      hostName: "esx-01",
      clusterName: "ams-prod",
      datacenterName: "Amsterdam",
      metricsUpdatedAt: FRESH,
      latestCpuPercent: 95,
      latestMemoryPercent: 40,
    }),
    row({
      kind: VMwareResourceKind.Host,
      externalId: "host/esx-02",
      hostName: "esx-02",
      clusterName: "ams-prod",
      datacenterName: "Amsterdam",
      metricsUpdatedAt: STALE,
    }),
    row({
      kind: VMwareResourceKind.VirtualMachine,
      externalId: "vm/web-1",
      name: "web-1",
      hostName: "esx-01",
      clusterName: "ams-prod",
      datacenterName: "Amsterdam",
      vmInstanceUuid: "UUID-WEB-1",
      isPoweredOn: true,
      metricsUpdatedAt: FRESH,
      memorySwappedBytes: 512 * 1024 * 1024,
    }),
    row({
      kind: VMwareResourceKind.VirtualMachine,
      externalId: "vm/web-2",
      name: "web-2",
      hostName: "esx-01",
      datacenterName: "Amsterdam",
      isPoweredOn: true,
      metricsUpdatedAt: FRESH,
      cpuReadinessPercent: 14,
    }),
    row({
      kind: VMwareResourceKind.VirtualMachine,
      externalId: "vm/old",
      name: "old",
      hostName: "esx-02",
      datacenterName: "Amsterdam",
      isPoweredOn: false,
    }),
    row({
      kind: VMwareResourceKind.VirtualMachine,
      externalId: "vm/golden",
      name: "golden",
      hostName: "esx-02",
      datacenterName: "Amsterdam",
      isTemplate: true,
    }),
    row({
      kind: VMwareResourceKind.Datastore,
      externalId: "ds/full",
      name: "ssd-full",
      datacenterName: "Amsterdam",
      latestDiskPercent: 93.4,
      maxDiskBytes: 2 * 1024 ** 4,
    }),
    row({
      kind: VMwareResourceKind.Datastore,
      externalId: "ds/busy",
      name: "ssd-busy",
      datacenterName: "Amsterdam",
      latestDiskBytes: 84,
      maxDiskBytes: 100,
    }),
    row({
      kind: VMwareResourceKind.Datastore,
      externalId: "ds/fine",
      name: "ssd-fine",
      datacenterName: "Amsterdam",
      latestDiskPercent: 30,
    }),
    row({
      kind: VMwareResourceKind.ResourcePool,
      externalId: "pool/batch",
      resourcePoolName: "batch",
      resourcePoolPath: "/Amsterdam/host/ams-prod/Resources/batch",
      clusterName: "ams-prod",
      datacenterName: "Amsterdam",
    }),
  ];
}

function build(
  rows: Array<VMwareResource> = estate(),
  issues: Array<OpenIssueRecord> = [],
  overrides: Partial<Parameters<typeof buildVMwareTopology>[0]> = {},
): ResourceTopologyGraph {
  return buildVMwareTopology({
    vcenter: VCENTER,
    rows: rows,
    issues: issues,
    now: NOW,
    ...overrides,
  });
}

function node(graph: ResourceTopologyGraph, id: string): ResourceTopologyNode {
  const found: ResourceTopologyNode | undefined = graph.nodes.get(id);

  if (!found) {
    throw new Error(`no ${id} in the graph`);
  }

  return found;
}

function issue(
  id: string,
  type: "incident" | "alert",
  seriesLabels: Record<string, string>,
): OpenIssueRecord {
  return {
    type: type,
    id: id,
    title: `Issue ${id}`,
    number: id,
    severityName: "High",
    severityColor: "#dc2626",
    stateName: "Created",
    createdAt: NOW,
    seriesLabels: seriesLabels,
    relatedIds: {},
  };
}

describe("containment, as the vCenter's pages list it", () => {
  const graph: ResourceTopologyGraph = build();

  test("vCenter > datacenter > cluster > host > virtual machine", () => {
    expect(node(graph, VMWARE_ROOT_ID).name).toBe("vcenter-prod");
    expect(node(graph, "vmware.datacenter:datacenter/Amsterdam").parentId).toBe(
      VMWARE_ROOT_ID,
    );
    expect(node(graph, "vmware.cluster:cluster/ams-prod").parentId).toBe(
      "vmware.datacenter:datacenter/Amsterdam",
    );
    expect(node(graph, "vmware.host:host/esx-01").parentId).toBe(
      "vmware.cluster:cluster/ams-prod",
    );
    expect(node(graph, "vmware.vm:vm/web-1").parentId).toBe(
      "vmware.host:host/esx-01",
    );
  });

  test("datastores sit in their datacenter, resource pools on their cluster", () => {
    expect(node(graph, "vmware.datastore:ds/full").parentId).toBe(
      "vmware.datacenter:datacenter/Amsterdam",
    );
    expect(node(graph, "vmware.resourcepool:pool/batch").parentId).toBe(
      "vmware.cluster:cluster/ams-prod",
    );
  });

  test("a template is its own kind; a VM's instance UUID and pool find it", () => {
    expect(node(graph, "vmware.vm:vm/golden").kind).toBe("vmware.template");
    expect(node(graph, "vmware.vm:vm/web-1").keywords).toContain("UUID-WEB-1");
    expect(graph.countsByKind.get("vmware.vm")).toBe(3);
    expect(graph.countsByKind.get("vmware.template")).toBe(1);
  });

  test("every part links to its own page in the vCenter", () => {
    expect(node(graph, VMWARE_ROOT_ID).link).toEqual({
      page: PageMap.VMWARE_VCENTER_VIEW,
      modelId: "vc-row",
    });
    expect(node(graph, "vmware.vm:vm/web-1").link).toEqual({
      page: PageMap.VMWARE_VCENTER_VIEW_VIRTUAL_MACHINE_DETAIL,
      modelId: "vc-row",
      subModelId: encodeURIComponent("vm/web-1"),
    });
    expect(node(graph, "vmware.host:host/esx-01").link?.page).toBe(
      PageMap.VMWARE_VCENTER_VIEW_HOST_DETAIL,
    );
  });

  test("a part whose parent row is missing still finds its place", () => {
    const orphans: ResourceTopologyGraph = build([
      row({
        kind: VMwareResourceKind.VirtualMachine,
        externalId: "vm/lonely",
        name: "lonely",
        hostName: "esx-nowhere",
        clusterName: "ghost",
        datacenterName: "Frankfurt",
        isPoweredOn: false,
      }),
    ]);
    const vm: ResourceTopologyNode = node(orphans, "vmware.vm:vm/lonely");
    const cluster: ResourceTopologyNode = node(orphans, vm.parentId!);

    expect(cluster.kind).toBe("vmware.cluster");
    expect(cluster.name).toBe("ghost");
    expect(node(orphans, cluster.parentId!).name).toBe("Frankfurt");
  });
});

describe("health, for the reasons the vCenter's pages give", () => {
  const graph: ResourceTopologyGraph = build();

  test("a cluster with hosts that are not effective is critical", () => {
    const cluster: ResourceTopologyNode = node(
      graph,
      "vmware.cluster:cluster/ams-prod",
    );

    expect(cluster.health).toBe("critical");
    expect(cluster.facts).toEqual([
      { label: "Effective hosts", value: "2/3", tone: "critical" },
    ]);
  });

  test("a hot host needs attention; a silent one is not reporting", () => {
    expect(node(graph, "vmware.host:host/esx-01").health).toBe("warning");
    expect(node(graph, "vmware.host:host/esx-02").health).toBe("warning");
    expect(node(graph, "vmware.host:host/esx-02").status?.text).toBe(
      "Not reporting",
    );
  });

  test("swapping is critical, CPU ready needs attention, off and templates are off", () => {
    expect(node(graph, "vmware.vm:vm/web-1").health).toBe("critical");
    expect(node(graph, "vmware.vm:vm/web-2").health).toBe("warning");
    expect(node(graph, "vmware.vm:vm/old").health).toBe("off");
    expect(node(graph, "vmware.vm:vm/golden").health).toBe("off");
  });

  test("a datastore 90% full is critical, 80% needs attention", () => {
    expect(node(graph, "vmware.datastore:ds/full").health).toBe("critical");
    expect(node(graph, "vmware.datastore:ds/busy").health).toBe("warning");
    expect(node(graph, "vmware.datastore:ds/fine").health).toBe("healthy");
    // The status says how full; the card adds only what it does not.
    expect(node(graph, "vmware.datastore:ds/full").status).toEqual({
      text: "{{percent}} used",
      values: { percent: "93.4%" },
    });
    expect(
      node(graph, "vmware.datastore:ds/full").facts?.map(
        (fact: { label: string }): string => {
          return fact.label;
        },
      ),
    ).toEqual(["Capacity"]);
  });

  test("a vCenter whose collection failed is critical", () => {
    const failed: ResourceTopologyGraph = build(estate(), [], {
      vcenter: { ...VCENTER, collectionStatus: VMwareCollectionStatus.Failed },
    });

    expect(node(failed, VMWARE_ROOT_ID).health).toBe("critical");
  });

  test("a vCenter that has sent nothing yet has no data, not a problem", () => {
    const empty: ResourceTopologyGraph = build([], [], {
      vcenter: { id: "vc-row", name: "new" },
    });

    expect(node(empty, VMWARE_ROOT_ID).health).toBe("unknown");
    expect(empty.nodes.size).toBe(1);
  });

  test("what needs attention below a part is counted on it", () => {
    const dc: ResourceTopologyNode = node(
      graph,
      "vmware.datacenter:datacenter/Amsterdam",
    );

    // The datacenter itself is fine; what is inside it is not.
    expect(dc.needsAttention).toBe(false);
    // The cluster, web-1 and the full datastore are critical.
    expect(dc.criticalBelow).toBe(3);
    // And the two hosts, web-2 and the busy datastore need attention.
    expect(dc.attentionBelow).toBe(7);
  });
});

describe("open incidents and alerts land on the part they are about", () => {
  test("by the VM's id, its name, the host, the datastore, the cluster", () => {
    const graph: ResourceTopologyGraph = build(estate(), [
      issue("1", "incident", { "resource.vcenter.vm.id": "uuid-web-1" }),
      issue("2", "alert", { "vcenter.vm.name": "WEB-2" }),
      issue("3", "alert", { "resource.vcenter.host.name": "esx-02" }),
      issue("4", "alert", { "vcenter.datastore.name": "ssd-busy" }),
      issue("5", "alert", { "vcenter.cluster.name": "ams-prod" }),
      issue("6", "alert", {
        "vcenter.resource_pool.inventory_path":
          "/Amsterdam/host/ams-prod/Resources/batch",
      }),
      issue("7", "alert", { "vcenter.datacenter.name": "Amsterdam" }),
      issue("8", "alert", {}),
    ]);

    const on: (id: string) => Array<string> = (id: string): Array<string> => {
      return node(graph, id).issues.map((item: { id: string }): string => {
        return item.id;
      });
    };

    expect(on("vmware.vm:vm/web-1")).toEqual(["1"]);
    expect(on("vmware.vm:vm/web-2")).toEqual(["2"]);
    expect(on("vmware.host:host/esx-02")).toEqual(["3"]);
    expect(on("vmware.datastore:ds/busy")).toEqual(["4"]);
    expect(on("vmware.cluster:cluster/ams-prod")).toEqual(["5"]);
    expect(on("vmware.resourcepool:pool/batch")).toEqual(["6"]);
    expect(on("vmware.datacenter:datacenter/Amsterdam")).toEqual(["7"]);
    // Nothing more precise: the vCenter itself, never dropped.
    expect(on(VMWARE_ROOT_ID)).toEqual(["8"]);
    expect(graph.incidentCount).toBe(1);
    expect(graph.alertCount).toBe(7);
  });

  test("an incident makes a healthy part critical", () => {
    const graph: ResourceTopologyGraph = build(estate(), [
      issue("9", "incident", { "vcenter.datastore.name": "ssd-fine" }),
    ]);

    expect(node(graph, "vmware.datastore:ds/fine").health).toBe("healthy");
    expect(node(graph, "vmware.datastore:ds/fine").effectiveHealth).toBe(
      "critical",
    );
  });
});

describe("a vCenter larger than one read", () => {
  test("says how much of it is drawn", () => {
    const graph: ResourceTopologyGraph = build(estate(), [], {
      totalRows: 5000,
    });

    expect(graph.truncations).toEqual([
      { kind: "vmware.vcenter", shown: estate().length, total: 5000 },
    ]);
    expect(build().truncations).toEqual([]);
  });
});
