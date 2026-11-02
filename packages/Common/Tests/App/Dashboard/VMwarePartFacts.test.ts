import { describe, expect, test } from "@jest/globals";
import VMwareResource from "../../../Models/DatabaseModels/VMwareResource";
import { VMwareResourceKind } from "../../../Types/Monitor/MonitorStepVMwareMonitor";
import MonitorStep from "../../../Types/Monitor/MonitorStep";
import MonitorStepVMwareMonitor from "../../../Types/Monitor/MonitorStepVMwareMonitor";
import ObjectID from "../../../Types/ObjectID";
import {
  VMWARE_HOST_NOT_RESPONDING_TEMPLATE_ID,
  VMwareAlertTemplate,
  VMwareGroupByKey,
  getAllVMwareAlertTemplates,
  getVMwareAlertTemplateById,
} from "../../../Types/Monitor/VMwareAlertTemplates";
import {
  VMWARE_CLUSTER_ALERT_TEMPLATE_IDS,
  VMWARE_DATASTORE_ALERT_TEMPLATE_IDS,
  VMWARE_HOST_ALERT_TEMPLATE_IDS,
  VMWARE_NOT_EFFECTIVE_HOSTS_WORDS,
  VMWARE_VIRTUAL_MACHINE_ALERT_TEMPLATE_IDS,
  VMwareClusterUsage,
  VMwareHostLoad,
  VMwareNotEffectiveHosts,
  countVMwareNotEffectiveHosts,
  getVMwareClusterUsage,
  getVMwareHostLoad,
  getVMwareNotEffectiveHostsTone,
  getVMwareVirtualMachinesOfCluster,
  getVMwareVirtualMachinesOfHost,
  isVMwareRootResourcePool,
  sortVMwareHostsForGlance,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/VMware/Utils/VMwarePartFacts";

/*
 * What an ESXi host, a VM, a datastore and a cluster are, in the numbers
 * their pages show (Pages/VMware/Utils/VMwarePartFacts): the alerts that
 * watch each kind of part, which pool a VM really runs in, a cluster's VMs
 * and how much of its capacity its hosts use, why its hosts are not
 * effective, and the order a glance reads hosts in.
 */

const NOW: Date = new Date("2026-11-02T12:00:00.000Z");
const MINUTE: number = 60 * 1000;
const GIB: number = 1024 * 1024 * 1024;
const FRESH: Date = new Date(NOW.getTime() - 2 * MINUTE);
const STALE: Date = new Date(NOW.getTime() - 16 * MINUTE);

type RowFields = {
  [Key in keyof VMwareResource]?: VMwareResource[Key] | undefined | unknown;
};

function row(fields: RowFields): VMwareResource {
  return Object.assign(new VMwareResource(), fields);
}

function datacenter(fields: RowFields = {}): VMwareResource {
  return row({
    kind: VMwareResourceKind.Datacenter,
    externalId: "datacenter/dc-east",
    name: "dc-east",
    metricsUpdatedAt: FRESH,
    hostCount: 4,
    poweredOnHostCount: 4,
    notRespondingHostCount: 0,
    standbyHostCount: 0,
    ...fields,
  });
}

function host(name: string, fields: RowFields = {}): VMwareResource {
  return row({
    kind: VMwareResourceKind.Host,
    externalId: `host/dc-east/${name}`,
    name: name,
    hostName: name,
    clusterName: "prod-cluster",
    datacenterName: "dc-east",
    metricsUpdatedAt: FRESH,
    latestCpuMhz: 30000,
    latestCpuPercent: 40,
    latestMemoryBytes: 256 * GIB,
    latestMemoryPercent: 50,
    maxMemoryBytes: 512 * GIB,
    ...fields,
  });
}

function silentHost(name: string, fields: RowFields = {}): VMwareResource {
  return host(name, {
    latestCpuMhz: 0,
    latestCpuPercent: 0,
    latestMemoryBytes: 0,
    latestMemoryPercent: 0,
    ...fields,
  });
}

function vm(name: string, fields: RowFields = {}): VMwareResource {
  return row({
    kind: VMwareResourceKind.VirtualMachine,
    externalId: `vm/${name}`,
    name: name,
    hostName: "esx01",
    clusterName: "prod-cluster",
    datacenterName: "dc-east",
    ...fields,
  });
}

function cluster(fields: RowFields = {}): VMwareResource {
  return row({
    kind: VMwareResourceKind.Cluster,
    externalId: "cluster/dc-east/prod-cluster",
    name: "prod-cluster",
    clusterName: "prod-cluster",
    datacenterName: "dc-east",
    metricsUpdatedAt: FRESH,
    hostCount: 2,
    effectiveHostCount: 2,
    cpuEffectiveMhz: 100000,
    memoryEffectiveBytes: 1024 * GIB,
    ...fields,
  });
}

function template(id: string): VMwareAlertTemplate {
  const found: VMwareAlertTemplate | undefined = getVMwareAlertTemplateById(id);
  if (!found) {
    throw new Error(`no template ${id}`);
  }
  return found;
}

function groupByKeysOf(id: string): Array<string> {
  const step: MonitorStep = template(id).getMonitorStep({
    vcenterIdentifier: "vcenter-prod",
    onlineMonitorStatusId: ObjectID.generate(),
    offlineMonitorStatusId: ObjectID.generate(),
    defaultIncidentSeverityId: ObjectID.generate(),
    defaultAlertSeverityId: ObjectID.generate(),
    monitorName: "Test Monitor",
  });
  const monitor: MonitorStepVMwareMonitor | undefined =
    step.data?.vmwareMonitor;
  const keys: Set<string> = new Set();
  for (const queryConfig of (monitor?.metricViewConfig.queryConfigs ||
    []) as Array<{
    metricQueryData: { groupByAttributeKeys?: Array<string> | undefined };
  }>) {
    for (const key of queryConfig.metricQueryData.groupByAttributeKeys || []) {
      keys.add(key);
    }
  }
  return Array.from(keys);
}

function idsOfCategory(category: string): Array<string> {
  return getAllVMwareAlertTemplates()
    .filter((candidate: VMwareAlertTemplate): boolean => {
      return candidate.category === category;
    })
    .map((candidate: VMwareAlertTemplate): string => {
      return candidate.id;
    });
}

describe("the alerts that watch each kind of part", () => {
  test("an ESXi host's are the catalog's Host alerts, in the catalog's order, Host Not Responding first", () => {
    expect(VMWARE_HOST_ALERT_TEMPLATE_IDS).toEqual(idsOfCategory("Host"));
    expect(VMWARE_HOST_ALERT_TEMPLATE_IDS[0]).toBe(
      VMWARE_HOST_NOT_RESPONDING_TEMPLATE_ID,
    );
  });

  test("a VM's are every Virtual Machine alert, the ones that mean trouble first", () => {
    expect([...VMWARE_VIRTUAL_MACHINE_ALERT_TEMPLATE_IDS].sort()).toEqual(
      idsOfCategory("Virtual Machine").sort(),
    );
    expect(VMWARE_VIRTUAL_MACHINE_ALERT_TEMPLATE_IDS.slice(0, 3)).toEqual([
      "vmware-vm-memory-swapping",
      "vmware-vm-memory-ballooning",
      "vmware-vm-cpu-ready-contention",
    ]);
  });

  test("a datastore's are both capacity alerts, critical first", () => {
    expect(VMWARE_DATASTORE_ALERT_TEMPLATE_IDS).toEqual([
      "vmware-datastore-capacity-critical",
      "vmware-datastore-capacity-warning",
    ]);
    expect([...VMWARE_DATASTORE_ALERT_TEMPLATE_IDS].sort()).toEqual(
      idsOfCategory("Datastore").sort(),
    );
  });

  test("a cluster's are its hosts not effective and its vSAN alerts, never a pool's", () => {
    expect(VMWARE_CLUSTER_ALERT_TEMPLATE_IDS).toEqual([
      "vmware-cluster-host-not-effective",
      ...idsOfCategory("vSAN"),
    ]);
    expect(VMWARE_CLUSTER_ALERT_TEMPLATE_IDS).not.toContain(
      "vmware-resource-pool-memory-swapped",
    );
  });

  test.each([
    ["host", VMWARE_HOST_ALERT_TEMPLATE_IDS, VMwareGroupByKey.Host],
    [
      "VM",
      VMWARE_VIRTUAL_MACHINE_ALERT_TEMPLATE_IDS,
      VMwareGroupByKey.VirtualMachine,
    ],
    ["datastore", VMWARE_DATASTORE_ALERT_TEMPLATE_IDS, VMwareGroupByKey.Datastore],
    ["cluster", VMWARE_CLUSTER_ALERT_TEMPLATE_IDS, VMwareGroupByKey.Cluster],
  ] as Array<[string, Array<string>, string]>)(
    "each %s alert is one vCenter-wide monitor that opens one record per %s",
    (_kind: string, ids: Array<string>, key: string) => {
      for (const id of ids) {
        expect({ id, keys: groupByKeysOf(id) }).toEqual({ id, keys: [key] });
      }
    },
  );
});

describe("the pool a VM runs in", () => {
  test("a cluster's or standalone host's root pool, which vSphere names Resources, is no pool of anyone's making", () => {
    expect(
      isVMwareRootResourcePool({
        name: "Resources",
        path: "/dc-east/host/prod-cluster/Resources",
      }),
    ).toBe(true);
    expect(
      isVMwareRootResourcePool({
        name: "Resources",
        path: "/dc-east/host/esx-edge.acme.example/Resources",
      }),
    ).toBe(true);
    // Without a path, a pool named Resources is taken for the root one.
    expect(isVMwareRootResourcePool({ name: "Resources" })).toBe(true);
  });

  test("a pool someone named Resources under the root one, and every other pool, is a real pool", () => {
    expect(
      isVMwareRootResourcePool({
        name: "Resources",
        path: "/dc-east/host/prod-cluster/Resources/Resources",
      }),
    ).toBe(false);
    expect(
      isVMwareRootResourcePool({
        name: "Batch",
        path: "/dc-east/host/prod-cluster/Resources/Batch",
      }),
    ).toBe(false);
    expect(isVMwareRootResourcePool({ name: null })).toBe(false);
  });
});

describe("the VMs of a cluster and of a host", () => {
  const rows: Array<VMwareResource> = [
    vm("web-01"),
    vm("tmpl", { isTemplate: true }),
    vm("dev-01", { clusterName: "dev-cluster", hostName: "esx05" }),
    vm("west-01", { datacenterName: "dc-west" }),
    host("esx01"),
  ];

  test("a cluster's VMs are its own, templates included, in its datacenter", () => {
    expect(
      getVMwareVirtualMachinesOfCluster(rows, cluster()).map(
        (each: VMwareResource): string => {
          return each.name as string;
        },
      ),
    ).toEqual(["web-01", "tmpl"]);
  });

  test("a host's VMs are the ones its name runs, in its datacenter", () => {
    expect(
      getVMwareVirtualMachinesOfHost(rows, host("esx01")).map(
        (each: VMwareResource): string => {
          return each.name as string;
        },
      ),
    ).toEqual(["web-01", "tmpl"]);
    expect(getVMwareVirtualMachinesOfHost(rows, host("esx09"))).toEqual([]);
  });
});

describe("how much of a cluster its hosts use", () => {
  test("what its running hosts use, against what the cluster can give its VMs", () => {
    const usage: VMwareClusterUsage = getVMwareClusterUsage({
      cluster: cluster(),
      hosts: [
        host("esx01", { latestCpuMhz: 30000, latestMemoryBytes: 256 * GIB }),
        host("esx02", { latestCpuMhz: 20000, latestMemoryBytes: 256 * GIB }),
        // Not responding: its zeros are no reading, and add nothing.
        silentHost("esx03"),
        // Another cluster's host is not this cluster's.
        host("esx05", { clusterName: "dev-cluster", latestCpuMhz: 99999 }),
      ],
      datacenters: [
        datacenter({ poweredOnHostCount: 3, notRespondingHostCount: 1 }),
      ],
      now: NOW,
    });
    expect(usage).toEqual({
      cpuUsedMhz: 50000,
      cpuEffectiveMhz: 100000,
      cpuPercent: 50,
      memoryUsedBytes: 512 * GIB,
      memoryEffectiveBytes: 1024 * GIB,
      memoryPercent: 50,
    });
  });

  test("an old cluster reading has no effective capacity, so no share", () => {
    const usage: VMwareClusterUsage = getVMwareClusterUsage({
      cluster: cluster({ metricsUpdatedAt: STALE }),
      hosts: [host("esx01")],
      datacenters: [datacenter()],
      now: NOW,
    });
    expect(usage.cpuUsedMhz).toBe(30000);
    expect(usage.cpuEffectiveMhz).toBeNull();
    expect(usage.cpuPercent).toBeNull();
    expect(usage.memoryPercent).toBeNull();
  });

  test("a cluster with no running host reports no usage at all, not zero", () => {
    const usage: VMwareClusterUsage = getVMwareClusterUsage({
      cluster: cluster(),
      hosts: [silentHost("esx03")],
      datacenters: [
        datacenter({ poweredOnHostCount: 3, notRespondingHostCount: 1 }),
      ],
      now: NOW,
    });
    expect(usage.cpuUsedMhz).toBeNull();
    expect(usage.memoryUsedBytes).toBeNull();
    expect(usage.cpuPercent).toBeNull();
  });
});

describe("why clustered hosts are not effective", () => {
  test("each reason counted once, the most urgent words first", () => {
    expect(
      VMWARE_NOT_EFFECTIVE_HOSTS_WORDS.map(
        (word: { key: keyof VMwareNotEffectiveHosts }): string => {
          return word.key;
        },
      ),
    ).toEqual(["notResponding", "inMaintenance", "noUsage", "offOrStandby"]);

    const westCluster: VMwareResource = cluster({
      externalId: "cluster/dc-west/west-cluster",
      name: "west-cluster",
      clusterName: "west-cluster",
      datacenterName: "dc-west",
      hostCount: 2,
      effectiveHostCount: 1,
    });
    const counts: VMwareNotEffectiveHosts = countVMwareNotEffectiveHosts({
      clusters: [cluster({ hostCount: 5, effectiveHostCount: 2 }), westCluster],
      hosts: [
        host("esx01"),
        host("esx02"),
        // vCenter lost esx03: its datacenter has a lost host and none off.
        silentHost("esx03"),
        host("esx06"),
        host("esx07"),
        host("esx-w1", { clusterName: "west-cluster", datacenterName: "dc-west" }),
        // dc-west has a lost host and one off: which is esx-w2?
        silentHost("esx-w2", {
          clusterName: "west-cluster",
          datacenterName: "dc-west",
        }),
      ],
      datacenters: [
        datacenter({
          hostCount: 5,
          poweredOnHostCount: 4,
          notRespondingHostCount: 1,
          standbyHostCount: 0,
        }),
        datacenter({
          externalId: "datacenter/dc-west",
          name: "dc-west",
          hostCount: 3,
          poweredOnHostCount: 1,
          notRespondingHostCount: 1,
          standbyHostCount: 0,
        }),
      ],
      now: NOW,
    });
    /*
     * prod-cluster: three of five not effective - esx03, which vCenter
     * cannot reach, and two more, connected, that vSphere places no VMs on
     * (maintenance mode). west-cluster: esx-w2 reports no usage its
     * datacenter's counts cannot explain.
     */
    expect(counts).toEqual({
      notResponding: 1,
      inMaintenance: 2,
      noUsage: 1,
      offOrStandby: 0,
    });
  });

  test("hosts off or in standby are counted apart: someone, or DPM, did it", () => {
    const counts: VMwareNotEffectiveHosts = countVMwareNotEffectiveHosts({
      clusters: [cluster({ hostCount: 3, effectiveHostCount: 1 })],
      hosts: [host("esx01"), silentHost("esx02"), silentHost("esx03")],
      datacenters: [
        datacenter({
          hostCount: 3,
          poweredOnHostCount: 1,
          standbyHostCount: 1,
        }),
      ],
      now: NOW,
    });
    expect(counts).toEqual({
      notResponding: 0,
      inMaintenance: 0,
      noUsage: 0,
      offOrStandby: 2,
    });
  });

  test("red while vCenter cannot reach one, amber for maintenance or no usage, calm for hosts off", () => {
    const tone: (counts: Partial<VMwareNotEffectiveHosts>) => string = (
      counts: Partial<VMwareNotEffectiveHosts>,
    ): string => {
      return getVMwareNotEffectiveHostsTone({
        notResponding: 0,
        inMaintenance: 0,
        noUsage: 0,
        offOrStandby: 0,
        ...counts,
      });
    };
    expect(tone({ notResponding: 1, inMaintenance: 3 })).toBe("danger");
    expect(tone({ inMaintenance: 1 })).toBe("warning");
    expect(tone({ noUsage: 1 })).toBe("warning");
    expect(tone({ offOrStandby: 4 })).toBe("positive");
    expect(tone({})).toBe("positive");
  });
});

describe("ESXi hosts at a glance", () => {
  // vCenter lost one host and has none off: a host with no usage is not responding.
  const dc: VMwareResource = datacenter({
    hostCount: 7,
    poweredOnHostCount: 6,
    notRespondingHostCount: 1,
  });

  test("the ones that need attention first, then the running ones, then the ones off or quiet, each by name as people number hosts", () => {
    const order: Array<string> = sortVMwareHostsForGlance({
      hosts: [
        host("esx10"),
        host("esx2"),
        host("esx-quiet", { metricsUpdatedAt: STALE }),
        host("esx-busy", { latestCpuPercent: 95 }),
        silentHost("esx-lost"),
        host("esx1"),
      ],
      datacenters: [dc],
      now: NOW,
    }).map((each: VMwareResource): string => {
      return each.name as string;
    });
    expect(order).toEqual([
      "esx-lost",
      "esx-busy",
      "esx1",
      "esx2",
      "esx10",
      "esx-quiet",
    ]);
  });

  test("a running host shows its latest load; one not running shows none, never an idle 0%", () => {
    const busy: VMwareHostLoad = getVMwareHostLoad({
      host: host("esx02", { latestCpuPercent: 94, latestMemoryPercent: 67 }),
      datacenter: dc,
      now: NOW,
    });
    expect(busy).toEqual({ cpuPercent: 94, memoryPercent: 67 });
    expect(
      getVMwareHostLoad({ host: silentHost("esx03"), datacenter: dc, now: NOW }),
    ).toEqual({ cpuPercent: null, memoryPercent: null });
    expect(
      getVMwareHostLoad({
        host: host("esx01", { metricsUpdatedAt: STALE }),
        datacenter: dc,
        now: NOW,
      }),
    ).toEqual({ cpuPercent: null, memoryPercent: null });
  });
});
