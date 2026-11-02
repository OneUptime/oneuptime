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
      metricsUpdatedAt: FRESH,
      hostCount: 3,
      poweredOnHostCount: 3,
      notRespondingHostCount: 0,
      standbyHostCount: 0,
    }),
    row({
      kind: VMwareResourceKind.Cluster,
      externalId: "cluster/ams-prod",
      name: "ams-prod",
      clusterName: "ams-prod",
      datacenterName: "Amsterdam",
      metricsUpdatedAt: FRESH,
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
      metricsUpdatedAt: FRESH,
      latestDiskPercent: 93.4,
      maxDiskBytes: 2 * 1024 ** 4,
    }),
    row({
      kind: VMwareResourceKind.Datastore,
      externalId: "ds/busy",
      name: "ssd-busy",
      datacenterName: "Amsterdam",
      metricsUpdatedAt: FRESH,
      latestDiskBytes: 84,
      maxDiskBytes: 100,
    }),
    row({
      kind: VMwareResourceKind.Datastore,
      externalId: "ds/fine",
      name: "ssd-fine",
      datacenterName: "Amsterdam",
      metricsUpdatedAt: FRESH,
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

/*
 * The estate with one row changed: the rows the rules read beside a part
 * (its datacenter's counts, its hosts) are what a test varies.
 */
function estateWith(
  externalId: string,
  fields: Partial<VMwareResource>,
): Array<VMwareResource> {
  return estate().map((item: VMwareResource): VMwareResource => {
    return item.externalId === externalId ? Object.assign(item, fields) : item;
  });
}

// esx-02 reporting now, but no CPU or memory use: not connected, or not up.
const ESX_02_NO_USAGE: Partial<VMwareResource> = {
  metricsUpdatedAt: FRESH,
  latestCpuMhz: 0,
  latestMemoryBytes: 0,
};

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

  /*
   * One of three hosts is not effective, and no host row says why (esx-01
   * runs, esx-02 has not reported lately): a host in maintenance mode - the
   * cluster runs, with less room, so it needs a look.
   */
  test("a cluster with a host that is not effective needs attention", () => {
    const cluster: ResourceTopologyNode = node(
      graph,
      "vmware.cluster:cluster/ams-prod",
    );

    expect(cluster.health).toBe("warning");
    expect(cluster.reasons).toEqual([
      { text: "{{count}} host not effective", values: { count: "1" } },
    ]);
    expect(cluster.facts).toEqual([
      { label: "Effective hosts", value: "2/3", tone: "warning" },
    ]);
  });

  test("a cluster not reported lately is not judged", () => {
    const stale: ResourceTopologyGraph = build(
      estateWith("cluster/ams-prod", { metricsUpdatedAt: STALE }),
    );
    const cluster: ResourceTopologyNode = node(
      stale,
      "vmware.cluster:cluster/ams-prod",
    );

    expect(cluster.health).toBe("unknown");
    expect(cluster.reasons).toEqual([]);
    // What it last said is still drawn.
    expect(cluster.facts?.[0]?.value).toBe("2/3");
  });

  test("a hot host needs attention; a silent one is not reporting, not a problem", () => {
    const hot: ResourceTopologyNode = node(graph, "vmware.host:host/esx-01");

    expect(hot.health).toBe("warning");
    expect(hot.status).toEqual({ text: "Connected" });
    expect(hot.reasons).toEqual([
      { text: "CPU at {{percent}}", values: { percent: "95%" } },
    ]);
    expect(hot.facts).toEqual([
      { label: "CPU", value: "95%", tone: "warning" },
      { label: "Memory", value: "40%", tone: undefined },
    ]);
    expect(node(graph, "vmware.host:host/esx-02").health).toBe("unknown");
    expect(node(graph, "vmware.host:host/esx-02").status).toEqual({
      text: "Not reporting",
    });
  });

  /*
   * A host vCenter lost reports no usage, and its datacenter counts one
   * host not responding: the host is critical, its cluster is critical for
   * it (the host it lost is all that is not effective, so nothing else is
   * said), and a VM on it is not known to be doing anything.
   */
  test("a host vCenter lost is critical, and so is its cluster; its VMs are not judged", () => {
    const rows: Array<VMwareResource> = estate().map(
      (item: VMwareResource): VMwareResource => {
        if (item.externalId === "host/esx-02") {
          return Object.assign(item, ESX_02_NO_USAGE);
        }
        if (item.externalId === "dc/Amsterdam") {
          return Object.assign(item, {
            poweredOnHostCount: 2,
            notRespondingHostCount: 1,
          });
        }
        return item;
      },
    );
    rows.push(
      row({
        kind: VMwareResourceKind.VirtualMachine,
        externalId: "vm/stranded",
        name: "stranded",
        hostName: "esx-02",
        clusterName: "ams-prod",
        datacenterName: "Amsterdam",
        isPoweredOn: true,
        metricsUpdatedAt: FRESH,
        memorySwappedBytes: 1024,
      }),
    );
    const lost: ResourceTopologyGraph = build(rows);
    const host: ResourceTopologyNode = node(lost, "vmware.host:host/esx-02");
    const cluster: ResourceTopologyNode = node(
      lost,
      "vmware.cluster:cluster/ams-prod",
    );

    expect(host.health).toBe("critical");
    expect(host.status).toEqual({ text: "Not responding" });
    expect(host.facts).toEqual([]);
    expect(cluster.health).toBe("critical");
    expect(cluster.reasons).toEqual([
      { text: "{{count}} host not responding", values: { count: "1" } },
    ]);
    expect(node(lost, "vmware.vm:vm/stranded").health).toBe("unknown");
    expect(node(lost, "vmware.vm:vm/stranded").status).toEqual({
      text: "Disconnected",
    });
    // The datacenter's count is the host's own: said once, on the host.
    expect(
      node(lost, "vmware.datacenter:datacenter/Amsterdam").health,
    ).toBe("healthy");
  });

  test("a host vSphere DPM put in standby is off, and its 0% is no reading", () => {
    const rows: Array<VMwareResource> = estate().map(
      (item: VMwareResource): VMwareResource => {
        if (item.externalId === "host/esx-02") {
          return Object.assign(item, ESX_02_NO_USAGE);
        }
        if (item.externalId === "dc/Amsterdam") {
          return Object.assign(item, {
            poweredOnHostCount: 2,
            standbyHostCount: 1,
          });
        }
        return item;
      },
    );
    const asleep: ResourceTopologyNode = node(
      build(rows),
      "vmware.host:host/esx-02",
    );

    expect(asleep.health).toBe("off");
    expect(asleep.status).toEqual({ text: "In standby" });
    expect(asleep.facts).toEqual([]);
    expect(asleep.reasons).toEqual([]);
  });

  test("a host with no usage that the counts cannot place needs a look", () => {
    const unplaced: ResourceTopologyNode = node(
      build(estateWith("host/esx-02", ESX_02_NO_USAGE)),
      "vmware.host:host/esx-02",
    );

    expect(unplaced.health).toBe("warning");
    expect(unplaced.status).toEqual({ text: "No usage reported" });
    expect(unplaced.reasons).toEqual([
      { text: "No CPU or memory use reported" },
    ]);
  });

  test("swapping is critical, CPU ready needs attention, off and templates are off", () => {
    expect(node(graph, "vmware.vm:vm/web-1").health).toBe("critical");
    expect(node(graph, "vmware.vm:vm/web-2").health).toBe("warning");
    expect(node(graph, "vmware.vm:vm/old").health).toBe("off");
    expect(node(graph, "vmware.vm:vm/golden").health).toBe("off");
  });

  test("a datastore more than 90% full is critical, 80% needs attention", () => {
    expect(node(graph, "vmware.datastore:ds/full").health).toBe("critical");
    expect(node(graph, "vmware.datastore:ds/full").reasons).toEqual([
      { text: "{{percent}} full", values: { percent: "93%" } },
    ]);
    expect(node(graph, "vmware.datastore:ds/busy").health).toBe("warning");
    expect(node(graph, "vmware.datastore:ds/busy").status).toEqual({
      text: "{{percent}} used",
      values: { percent: "84%" },
    });
    expect(node(graph, "vmware.datastore:ds/fine").health).toBe("healthy");
    // The status says how full; the card adds only what it does not.
    expect(node(graph, "vmware.datastore:ds/full").status).toEqual({
      text: "{{percent}} used",
      values: { percent: "93%" },
    });
    expect(
      node(graph, "vmware.datastore:ds/full").facts?.map(
        (fact: { label: string }): string => {
          return fact.label;
        },
      ),
    ).toEqual(["Capacity"]);
  });

  test("a datastore not reported lately is not judged on what it last said", () => {
    const stale: ResourceTopologyNode = node(
      build(estateWith("ds/full", { metricsUpdatedAt: STALE })),
      "vmware.datastore:ds/full",
    );

    expect(stale.health).toBe("unknown");
    expect(stale.status).toEqual({ text: "Not reporting" });
    expect(stale.reasons).toEqual([]);
  });

  /*
   * vCenter's alarm roll-up for the datacenter says what no row of a part
   * does: a cluster with a red alarm (an HA failover that failed, say).
   */
  test("a datacenter's own alarms make it critical, for the reason they give", () => {
    const red: ResourceTopologyNode = node(
      build(estateWith("dc/Amsterdam", { criticalClusterCount: 1 })),
      "vmware.datacenter:datacenter/Amsterdam",
    );

    expect(red.health).toBe("critical");
    expect(red.reasons).toEqual([
      {
        text: "{{count}} cluster with a critical alarm",
        values: { count: "1" },
      },
    ]);
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
    // web-1 (swapped) and the full datastore are critical.
    expect(dc.criticalBelow).toBe(2);
    /*
     * And the cluster, the hot host, web-2 and the busy datastore need
     * attention; esx-02, not reporting, is grey - not a problem yet.
     */
    expect(dc.attentionBelow).toBe(6);
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
