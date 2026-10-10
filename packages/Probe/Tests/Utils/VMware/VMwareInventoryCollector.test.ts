import { describe, expect, test } from "@jest/globals";
import VMwareInventoryCollector, {
  HOST_PERF_COUNTERS,
  MAX_QUERY_METRICS,
  VM_PERF_COUNTERS,
  getPerfBatchSize,
  parseVsanEntityMetrics,
} from "../../../Utils/VMware/VMwareInventoryCollector";
import {
  VMwareComputeResource,
  VMwareDatacenter,
  VMwareHost,
  VMwareInventorySnapshot,
  VMwareResourcePool,
  VMwareVirtualMachine,
  getInventoryPath,
} from "../../../Utils/VMware/VMwareInventory";
import VSphereSoapClient, {
  MoRef,
  PerfCounterInfo,
  PerfEntityMetric,
  PerfQuery,
  VSphereFault,
  VSphereObject,
  VSphereServiceContent,
} from "../../../Utils/VMware/VSphereSoapClient";
import { parseXml } from "../../../Utils/VMware/VSphereXml";
import {
  ReplayTransport,
  createReplayTransport,
  loadExchanges,
} from "./Helpers/ReplayTransport";

const COLLECTED_AT: Date = new Date("2026-10-10T12:00:00.000Z");

async function collectFrom(fixture: string): Promise<{
  snapshot: VMwareInventorySnapshot;
  replay: ReplayTransport;
}> {
  const replay: ReplayTransport = createReplayTransport(loadExchanges(fixture));
  const client: VSphereSoapClient = new VSphereSoapClient({
    transport: replay.transport,
    userAgent: "test",
  });

  await client.negotiateVersion();
  await client.retrieveServiceContent();
  await client.login("oneuptime", "secret");

  const snapshot: VMwareInventorySnapshot = await new VMwareInventoryCollector(
    client,
    {
      collectVsan: true,
      now: (): Date => {
        return COLLECTED_AT;
      },
    },
  ).collect();

  return { snapshot: snapshot, replay: replay };
}

function byName<T extends { name: string }>(items: Iterable<T>): Map<string, T> {
  const map: Map<string, T> = new Map();

  for (const item of items) {
    map.set(item.name, item);
  }

  return map;
}

describe("VMwareInventoryCollector against the recorded vCenter simulator", () => {
  test("reads every datacenter, cluster, host, pool, VM and datastore, and asks nothing more", async () => {
    const { snapshot, replay } = await collectFrom("vcsim-vcenter-collect.json");

    expect(replay.remaining()).toBe(0);
    expect(snapshot.collectedAt).toEqual(COLLECTED_AT);
    expect(snapshot.warnings).toEqual([]);
    expect(snapshot.about.apiType).toBe("VirtualCenter");
    expect(snapshot.datacenters).toHaveLength(1);

    const datacenter: VMwareDatacenter = snapshot.datacenters[0]!;
    expect(datacenter.name).toBe("DC0");
    expect(
      datacenter.datastores.map((store: { name: string }) => {
        return store.name;
      }),
    ).toEqual(["LocalDS_0"]);
    expect(datacenter.datastores[0]!.capacity).toBeGreaterThan(0);
    expect(datacenter.datastores[0]!.freeSpace).toBeGreaterThan(0);

    const computes: Map<string, VMwareComputeResource> = byName(
      datacenter.computes.values(),
    );
    expect(Array.from(computes.keys()).sort()).toEqual([
      "DC0_C0",
      "DC0_C1",
      "DC0_H0",
    ]);
    expect(computes.get("DC0_C0")!.isCluster).toBe(true);
    expect(computes.get("DC0_H0")!.isCluster).toBe(false);
    expect(computes.get("DC0_C0")!.hostRefs).toHaveLength(2);
    expect(computes.get("DC0_C0")!.numHosts).toBe(2);
    expect(computes.get("DC0_C0")!.totalCpu).toBeGreaterThan(0);

    const hosts: Map<string, VMwareHost> = byName(datacenter.hosts.values());
    expect(Array.from(hosts.keys()).sort()).toEqual([
      "DC0_C0_H0",
      "DC0_C0_H1",
      "DC0_C1_H0",
      "DC0_C1_H1",
      "DC0_H0",
    ]);
    const host: VMwareHost = hosts.get("DC0_C0_H0")!;
    expect(host.powerState).toBe("poweredOn");
    expect(host.numCpuCores).toBe(2);
    expect(host.cpuMhz).toBe(2294);
    expect(host.memorySize).toBe(4294430720);
    expect(host.parentRef).toBe(computes.get("DC0_C0")!.ref.value);
  });

  test("works out inventory paths as govmomi's finder spells them - pools under host, vApps under vm", async () => {
    const { snapshot } = await collectFrom("vcsim-vcenter-collect.json");
    const pools: Map<string, VMwareResourcePool> = new Map();

    for (const pool of snapshot.datacenters[0]!.resourcePools.values()) {
      pools.set(`${pool.isVirtualApp ? "app" : "pool"}:${pool.inventoryPath}`, pool);
    }

    expect(Array.from(pools.keys()).sort()).toEqual([
      "app:/F0/DC0/vm/DC0_C0_APP0",
      "app:/F0/DC0/vm/DC0_C1_APP0",
      "pool:/F0/DC0/host/F0/DC0_C0/Resources",
      "pool:/F0/DC0/host/F0/DC0_C0/Resources/DC0_C0_RP1",
      "pool:/F0/DC0/host/F0/DC0_C1/Resources",
      "pool:/F0/DC0/host/F0/DC0_C1/Resources/DC0_C1_RP1",
      "pool:/F0/DC0/host/F0/DC0_H0/Resources",
    ]);
  });

  test("reads each VM's identity, power, quick stats and storage", async () => {
    const { snapshot } = await collectFrom("vcsim-vcenter-collect.json");
    const vms: Map<string, VMwareVirtualMachine> = byName(
      snapshot.datacenters[0]!.vms.values(),
    );

    expect(vms.size).toBe(10);

    const vm: VMwareVirtualMachine = vms.get("DC0_H0_VM0")!;
    expect(vm.hasConfig).toBe(true);
    expect(vm.hasStorage).toBe(true);
    expect(vm.isTemplate).toBe(false);
    expect(vm.powerState).toBe("poweredOn");
    expect(vm.instanceUuid).toBe("b170c191-7587-5f8e-9a15-08c6a0a11ca5");
    expect(vm.numCpu).toBe(1);
    expect(vm.memorySizeMB).toBe(32);
    expect(vm.hostRef).not.toBeNull();
    expect(vm.resourcePoolRef).not.toBeNull();
    expect(vm.storageCommitted).not.toBeNull();
  });

  test("asks real-time samples of hosts and of powered-on VMs, in receiver-sized batches", async () => {
    const { snapshot, replay } = await collectFrom("vcsim-vcenter-collect.json");
    const datacenter: VMwareDatacenter = snapshot.datacenters[0]!;

    expect(datacenter.hostPerf.size).toBe(5);
    expect(datacenter.vmPerf.size).toBe(10);

    const queryPerfBodies: Array<string> = replay.requests
      .filter((request: { body?: string | undefined }) => {
        return (request.body || "").includes("<QueryPerf ");
      })
      .map((request: { body?: string | undefined }) => {
        return request.body || "";
      });

    // Hosts: 16 counters, so up to 16 hosts per query - all five in one.
    expect(queryPerfBodies[0]!.match(/<querySpec>/g)).toHaveLength(5);
    expect(queryPerfBodies[0]!.match(/<metricId>/g)).toHaveLength(5 * 16);
    expect(queryPerfBodies[0]).toContain("<intervalId>20</intervalId>");
    expect(queryPerfBodies[0]).toContain("<maxSample>1</maxSample>");
    // VMs: 12 counters, so up to 21 VMs per query - all ten in one.
    expect(queryPerfBodies[1]!.match(/<querySpec>/g)).toHaveLength(10);
  });

  test("names every counter it read by group.name.rollup", async () => {
    const { snapshot } = await collectFrom("vcsim-vcenter-collect.json");
    const names: Array<string> = Array.from(snapshot.counterNames.values());

    for (const counter of [...HOST_PERF_COUNTERS, ...VM_PERF_COUNTERS]) {
      expect(names).toContain(counter);
    }
  });

  test("a standalone ESXi host reads as ha-datacenter, with no cluster", async () => {
    const { snapshot, replay } = await collectFrom("vcsim-esx-collect.json");

    expect(replay.remaining()).toBe(0);
    expect(snapshot.about.apiType).toBe("HostAgent");
    expect(snapshot.datacenters).toHaveLength(1);

    const datacenter: VMwareDatacenter = snapshot.datacenters[0]!;
    expect(datacenter.name).toBe("ha-datacenter");
    expect(
      Array.from(datacenter.computes.values()).every(
        (compute: VMwareComputeResource) => {
          return !compute.isCluster;
        },
      ),
    ).toBe(true);
    expect(datacenter.hosts.size).toBe(1);
    expect(datacenter.vms.size).toBe(2);
    expect(
      Array.from(datacenter.resourcePools.values())[0]!.inventoryPath,
    ).toMatch(/^\/ha-datacenter\/host\/.+\/Resources$/);
  });
});

describe("getPerfBatchSize", () => {
  test("is the receiver's maxQueryMetrics divided by the counters per object", () => {
    expect(MAX_QUERY_METRICS).toBe(256);
    expect(getPerfBatchSize(HOST_PERF_COUNTERS.length)).toBe(16);
    expect(getPerfBatchSize(VM_PERF_COUNTERS.length)).toBe(21);
    expect(getPerfBatchSize(300)).toBe(1);
    expect(getPerfBatchSize(0)).toBe(1);
  });
});

describe("getInventoryPath", () => {
  const names: Map<string, string> = new Map([
    ["group-d1", "Datacenters"],
    ["folder-1", "Prod"],
    ["datacenter-2", "DC1"],
    ["group-h4", "host"],
    ["domain-c7", "Cluster%2fA"],
    ["resgroup-8", "Resources"],
    ["resgroup-9", "Web"],
  ]);
  const parents: Map<string, string | null> = new Map([
    ["group-d1", null],
    ["folder-1", "group-d1"],
    ["datacenter-2", "folder-1"],
    ["group-h4", "datacenter-2"],
    ["domain-c7", "group-h4"],
    ["resgroup-8", "domain-c7"],
    ["resgroup-9", "resgroup-8"],
  ]);

  test("walks up to the root folder, which is not part of the path", () => {
    expect(
      getInventoryPath({
        ref: "resgroup-9",
        rootFolder: "group-d1",
        names: names,
        parents: parents,
      }),
    ).toBe("/Prod/DC1/host/Cluster%2fA/Resources/Web");
  });

  test("is null for an object whose ancestors the probe could not read, or a loop", () => {
    expect(
      getInventoryPath({
        ref: "resgroup-9",
        rootFolder: "group-d1",
        names: names,
        parents: new Map([["resgroup-9", "unknown-1"]]),
      }),
    ).toBeNull();

    expect(
      getInventoryPath({
        ref: "a",
        rootFolder: "root",
        names: new Map([
          ["a", "A"],
          ["b", "B"],
        ]),
        parents: new Map([
          ["a", "b"],
          ["b", "a"],
        ]),
      }),
    ).toBeNull();
  });
});

describe("parseVsanEntityMetrics", () => {
  test("reads vSAN's CSV samples as UTC times and whole numbers, per label", () => {
    const parsed: ReturnType<typeof parseVsanEntityMetrics> =
      parseVsanEntityMetrics(
        parseXml(
          `<returnval><entityRefId>cluster-domclient:52b8-uuid</entityRefId><sampleInfo>2026-10-10 11:55:00,2026-10-10 12:00:00</sampleInfo><value><metricId><label>iopsRead</label><metricsCollectInterval>300</metricsCollectInterval></metricId><values>10,12</values></value><value><metricId><label>congestion</label></metricId><values>0,3</values></value><value><metricId><label>broken</label></metricId><values>1</values></value></returnval>`,
        ),
      );

    expect(parsed.uuid).toBe("52b8-uuid");
    expect(parsed.metrics).toEqual([
      {
        label: "iopsRead",
        intervalInSeconds: 300,
        timestamps: [
          new Date("2026-10-10T11:55:00Z"),
          new Date("2026-10-10T12:00:00Z"),
        ],
        values: [10, 12],
      },
      {
        label: "congestion",
        intervalInSeconds: 300,
        timestamps: [
          new Date("2026-10-10T11:55:00Z"),
          new Date("2026-10-10T12:00:00Z"),
        ],
        values: [0, 3],
      },
    ]);
  });

  test("an entity with no samples yet has no metrics (a new cluster)", () => {
    expect(
      parseVsanEntityMetrics(
        parseXml(
          "<returnval><entityRefId>host-domclient:abc</entityRefId><sampleInfo></sampleInfo></returnval>",
        ),
      ).metrics,
    ).toEqual([]);
  });
});

/*
 * A client double for the recovery paths the simulator cannot produce: a VM
 * deleted between the inventory read and the performance query, a counter
 * vCenter does not define, a vSAN cluster.
 */
class FakeClient {
  // The VM performance queries asked; hosts' are kept apart.
  public readonly queries: Array<Array<string>> = [];
  public readonly hostQueries: Array<Array<string>> = [];
  public perfFailures: Array<(entities: Array<string>) => VSphereFault | null> =
    [];
  public vsanAnswers: Map<string, string> = new Map();
  public vsanFault: VSphereFault | null = null;
  public readonly objects: Map<string, Array<VSphereObject>> = new Map();
  public counters: Array<PerfCounterInfo> = [];

  public getServiceContent(): VSphereServiceContent {
    return {
      rootFolder: { type: "Folder", value: "root" },
      propertyCollector: { type: "PropertyCollector", value: "pc" },
      viewManager: { type: "ViewManager", value: "vm" },
      sessionManager: { type: "SessionManager", value: "sm" },
      perfManager: { type: "PerformanceManager", value: "perf" },
      about: {
        name: "VMware vCenter Server",
        fullName: null,
        version: "8.0.2",
        build: null,
        apiType: "VirtualCenter",
        apiVersion: null,
        instanceUuid: null,
      },
    };
  }

  public async createContainerView(data: {
    container: MoRef;
    types: Array<string>;
  }): Promise<MoRef> {
    return { type: "ContainerView", value: `view-${data.types.join("+")}` };
  }

  public async destroyView(): Promise<void> {
    // Nothing to destroy.
  }

  public async retrieveFromView(data: {
    view: MoRef;
    type: string;
  }): Promise<Array<VSphereObject>> {
    return this.objects.get(data.type) || [];
  }

  public async getPerfCounters(): Promise<Array<PerfCounterInfo>> {
    return this.counters;
  }

  public async queryPerf(
    queries: Array<PerfQuery>,
  ): Promise<Array<PerfEntityMetric>> {
    const entities: Array<string> = queries.map((query: PerfQuery) => {
      return query.entity.value;
    });

    const toSamples: () => Array<PerfEntityMetric> =
      (): Array<PerfEntityMetric> => {
        return queries.map((query: PerfQuery): PerfEntityMetric => {
          return {
            entity: query.entity,
            sampleInfo: [{ timestamp: "2026-10-10T12:00:00Z", interval: 20 }],
            series: [],
          };
        });
      };

    if (queries[0]?.entity.type === "HostSystem") {
      this.hostQueries.push(entities);
      return toSamples();
    }

    this.queries.push(entities);

    const failure: ((entities: Array<string>) => VSphereFault | null) | undefined =
      this.perfFailures.shift();
    const fault: VSphereFault | null = failure ? failure(entities) : null;

    if (fault) {
      throw fault;
    }

    return toSamples();
  }

  public async queryVsanPerf(data: {
    entityRefId: string;
  }): Promise<Array<ReturnType<typeof parseXml>>> {
    if (this.vsanFault) {
      throw this.vsanFault;
    }

    const answer: string | undefined = this.vsanAnswers.get(data.entityRefId);
    return answer ? [parseXml(answer)] : [];
  }
}

function object(
  type: string,
  value: string,
  properties: Record<string, string>,
): VSphereObject {
  const map: Map<string, ReturnType<typeof parseXml>> = new Map();

  for (const [path, xml] of Object.entries(properties)) {
    map.set(path, parseXml(xml));
  }

  return { ref: { type: type, value: value }, properties: map, missing: new Map() };
}

function inventoryWithVms(client: FakeClient, vmCount: number): void {
  client.objects.set("Datacenter", [
    object("Datacenter", "dc-1", {
      name: "<val>DC</val>",
      parent: '<val type="Folder">root</val>',
    }),
  ]);
  client.objects.set("ComputeResource", [
    object("ClusterComputeResource", "c-1", {
      name: "<val>Cluster</val>",
      host: '<val><ManagedObjectReference type="HostSystem">h-1</ManagedObjectReference></val>',
      summary: "<val><numHosts>1</numHosts><numEffectiveHosts>1</numEffectiveHosts></val>",
    }),
  ]);
  client.objects.set("HostSystem", [
    object("HostSystem", "h-1", {
      name: "<val>esx-1</val>",
      parent: '<val type="ClusterComputeResource">c-1</val>',
    }),
  ]);
  client.objects.set(
    "VirtualMachine",
    Array.from({ length: vmCount }, (_: unknown, index: number) => {
      return object("VirtualMachine", `vm-${index}`, {
        name: `<val>vm-${index}</val>`,
        "runtime.powerState": "<val>poweredOn</val>",
      });
    }),
  );
  client.counters = Array.from(
    new Set([...HOST_PERF_COUNTERS, ...VM_PERF_COUNTERS]),
  ).map((name: string, index: number): PerfCounterInfo => {
    return { key: 100 + index, name: name, unit: null };
  });
}

describe("VMwareInventoryCollector recovery", () => {
  test("a VM gone before its samples were asked is left out, and the others asked again", async () => {
    const client: FakeClient = new FakeClient();
    inventoryWithVms(client, 3);
    client.perfFailures = [
      (): VSphereFault => {
        return new VSphereFault({
          faultType: "ManagedObjectNotFound",
          faultString: "gone",
          objectRef: { type: "VirtualMachine", value: "vm-1" },
        });
      },
    ];

    const snapshot: VMwareInventorySnapshot = await new VMwareInventoryCollector(
      client as unknown as VSphereSoapClient,
      { collectVsan: false },
    ).collect();

    expect(client.queries).toEqual([
      ["vm-0", "vm-1", "vm-2"],
      ["vm-0", "vm-2"],
    ]);
    expect(Array.from(snapshot.datacenters[0]!.vmPerf.keys()).sort()).toEqual([
      "vm-0",
      "vm-2",
    ]);
  });

  test("any other failure asks one object at a time, so one bad VM never costs the others their samples", async () => {
    const client: FakeClient = new FakeClient();
    inventoryWithVms(client, 3);
    client.perfFailures = [
      (): VSphereFault => {
        return new VSphereFault({ faultType: "SystemError", faultString: "boom" });
      },
      (): null => {
        return null;
      },
      (): VSphereFault => {
        return new VSphereFault({ faultType: "SystemError", faultString: "vm-1 broke" });
      },
      (): null => {
        return null;
      },
    ];

    const snapshot: VMwareInventorySnapshot = await new VMwareInventoryCollector(
      client as unknown as VSphereSoapClient,
      { collectVsan: false },
    ).collect();

    expect(client.queries).toEqual([
      ["vm-0", "vm-1", "vm-2"],
      ["vm-0"],
      ["vm-1"],
      ["vm-2"],
    ]);
    expect(Array.from(snapshot.datacenters[0]!.vmPerf.keys()).sort()).toEqual([
      "vm-0",
      "vm-2",
    ]);
    expect(snapshot.warnings.join(" ")).toContain("vm-1 broke");
  });

  test("more VMs than one query names are asked in several", async () => {
    const client: FakeClient = new FakeClient();
    inventoryWithVms(client, 45);

    await new VMwareInventoryCollector(client as unknown as VSphereSoapClient, {
      collectVsan: false,
    }).collect();

    expect(
      client.queries.map((query: Array<string>) => {
        return query.length;
      }),
    ).toEqual([21, 21, 3]);
  });

  test("a counter vCenter does not define is left out and said so - the rest are still asked", async () => {
    const client: FakeClient = new FakeClient();
    inventoryWithVms(client, 1);
    client.counters = client.counters.filter((counter: PerfCounterInfo) => {
      return counter.name !== "net.usage.average";
    });

    const snapshot: VMwareInventorySnapshot = await new VMwareInventoryCollector(
      client as unknown as VSphereSoapClient,
      { collectVsan: false },
    ).collect();

    expect(client.queries).toHaveLength(1);
    expect(snapshot.warnings).toContain(
      "This vCenter has no net.usage.average performance counter, so the metrics built from it are left out.",
    );
  });

  test("templates and powered-off VMs are not asked for real-time samples", async () => {
    const client: FakeClient = new FakeClient();
    inventoryWithVms(client, 0);
    client.objects.set("VirtualMachine", [
      object("VirtualMachine", "vm-on", {
        name: "<val>on</val>",
        "runtime.powerState": "<val>poweredOn</val>",
      }),
      object("VirtualMachine", "vm-off", {
        name: "<val>off</val>",
        "runtime.powerState": "<val>poweredOff</val>",
      }),
      object("VirtualMachine", "vm-template", {
        name: "<val>template</val>",
        "config.template": "<val>true</val>",
        "runtime.powerState": "<val>poweredOff</val>",
      }),
    ]);

    await new VMwareInventoryCollector(client as unknown as VSphereSoapClient, {
      collectVsan: false,
    }).collect();

    expect(client.queries).toEqual([["vm-on"]]);
  });

  test("reads vSAN for vSAN clusters only, by their uuid, and keeps going without it", async () => {
    const client: FakeClient = new FakeClient();
    inventoryWithVms(client, 0);
    client.objects.set("ClusterComputeResource", [
      object("ClusterComputeResource", "c-1", {
        configurationEx:
          "<val><vsanConfigInfo><enabled>true</enabled><defaultConfig><uuid>52aa-cluster</uuid></defaultConfig></vsanConfigInfo></val>",
      }),
    ]);
    client.vsanAnswers.set(
      "cluster-domclient:*",
      "<returnval><entityRefId>cluster-domclient:52aa-cluster</entityRefId><sampleInfo>2026-10-10 12:00:00</sampleInfo><value><metricId><label>iopsRead</label><metricsCollectInterval>300</metricsCollectInterval></metricId><values>42</values></value></returnval>",
    );

    const snapshot: VMwareInventorySnapshot = await new VMwareInventoryCollector(
      client as unknown as VSphereSoapClient,
      { collectVsan: true },
    ).collect();

    const datacenter: VMwareDatacenter = snapshot.datacenters[0]!;
    expect(datacenter.computes.get("c-1")!.vsanEnabled).toBe(true);
    expect(datacenter.computes.get("c-1")!.vsanUuid).toBe("52aa-cluster");
    expect(datacenter.vsan.clustersByUuid.get("52aa-cluster")![0]!.values).toEqual([
      42,
    ]);

    // vCenter without the vSAN service: no metrics, and no warning either.
    const noVsan: FakeClient = new FakeClient();
    inventoryWithVms(noVsan, 0);
    noVsan.objects.set(
      "ClusterComputeResource",
      client.objects.get("ClusterComputeResource")!,
    );
    noVsan.vsanFault = new VSphereFault({
      faultType: "ManagedObjectNotFound",
      faultString: "managed object not found: VsanPerformanceManager",
    });

    const quiet: VMwareInventorySnapshot = await new VMwareInventoryCollector(
      noVsan as unknown as VSphereSoapClient,
      { collectVsan: true },
    ).collect();

    expect(quiet.warnings).toEqual([]);
    expect(quiet.datacenters[0]!.vsan.clustersByUuid.size).toBe(0);
  });
});
