import { describe, expect, test } from "@jest/globals";
import VMwareInventoryCollector, {
  HOST_PERF_COUNTERS,
  MAX_QUERY_METRICS,
  MAX_SWAP_RATE_SAMPLES,
  REALTIME_SAMPLE_SECONDS,
  SWAP_RATE_PERF_COUNTERS,
  VM_PERF_COUNTERS,
  getPerfBatchSize,
  getSwapRateSampleCount,
  parseVsanEntityMetrics,
  readSwapRates,
} from "../../../Utils/VMware/VMwareInventoryCollector";
import {
  VSPHERE_SWAP_IN_RATE_COUNTER,
  VSPHERE_SWAP_OUT_RATE_COUNTER,
} from "Common/Types/VMware/VMwareSwapRates";
import {
  VMwareComputeResource,
  VMwareDatacenter,
  VMwareHost,
  VMwareInventorySnapshot,
  VMwareResourcePool,
  VMwareSwapRates,
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

function byName<T extends { name: string }>(
  items: Iterable<T>,
): Map<string, T> {
  const map: Map<string, T> = new Map();

  for (const item of items) {
    map.set(item.name, item);
  }

  return map;
}

describe("VMwareInventoryCollector against the recorded vCenter simulator", () => {
  test("reads every datacenter, cluster, host, pool, VM and datastore, and asks nothing more", async () => {
    const { snapshot, replay } = await collectFrom(
      "vcsim-vcenter-collect.json",
    );

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
      pools.set(
        `${pool.isVirtualApp ? "app" : "pool"}:${pool.inventoryPath}`,
        pool,
      );
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
    const { snapshot, replay } = await collectFrom(
      "vcsim-vcenter-collect.json",
    );
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

    // The hosts' samples and their swap rates, then the VMs' (#11468).
    expect(queryPerfBodies).toHaveLength(4);
    // Hosts: 16 counters, so up to 16 hosts per query - all five in one.
    expect(queryPerfBodies[0]!.match(/<querySpec>/g)).toHaveLength(5);
    expect(queryPerfBodies[0]!.match(/<metricId>/g)).toHaveLength(5 * 16);
    expect(queryPerfBodies[0]).toContain("<intervalId>20</intervalId>");
    expect(queryPerfBodies[0]).toContain("<maxSample>1</maxSample>");
    // VMs: 12 counters, so up to 21 VMs per query - all ten in one.
    expect(queryPerfBodies[2]!.match(/<querySpec>/g)).toHaveLength(10);
  });

  test("asks the swap rate counters apart, over the samples of a collection interval", async () => {
    const { replay } = await collectFrom("vcsim-vcenter-collect.json");
    const queryPerfBodies: Array<string> = replay.requests
      .filter((request: { body?: string | undefined }) => {
        return (request.body || "").includes("<QueryPerf ");
      })
      .map((request: { body?: string | undefined }) => {
        return request.body || "";
      });

    for (const [index, entities] of [
      [1, 5],
      [3, 10],
    ] as Array<[number, number]>) {
      const body: string = queryPerfBodies[index]!;
      expect(body.match(/<querySpec>/g)).toHaveLength(entities);
      // mem.swapoutRate.average (86) and mem.swapinRate.average (85).
      expect(body.match(/<metricId>/g)).toHaveLength(entities * 2);
      expect(body).toContain("<counterId>86</counterId>");
      expect(body).toContain("<counterId>85</counterId>");
      expect(body).toContain("<intervalId>20</intervalId>");
      // Two minutes of 20-second samples, the default interval.
      expect(body).toContain("<maxSample>6</maxSample>");
    }
  });

  test("reads every host's and powered-on VM's swap rates: the simulator's are zero", async () => {
    const { snapshot } = await collectFrom("vcsim-vcenter-collect.json");
    const datacenter: VMwareDatacenter = snapshot.datacenters[0]!;

    expect(datacenter.hostSwapRates.size).toBe(5);
    expect(datacenter.vmSwapRates.size).toBe(10);
    for (const rates of [
      ...datacenter.hostSwapRates.values(),
      ...datacenter.vmSwapRates.values(),
    ]) {
      expect(rates.swapOutBytesPerSecond).toBe(0);
      expect(rates.swapInBytesPerSecond).toBe(0);
    }
    // Each sampled at its newest sample, as vCenter stamped it.
    expect(datacenter.vmSwapRates.get("vm-84")!.sampledAt).toEqual(
      new Date("2026-10-10T14:30:15.292Z"),
    );
    // Powered-off VMs and templates are not asked.
    for (const vm of datacenter.vms.values()) {
      expect({
        vm: vm.name,
        asked: datacenter.vmSwapRates.has(vm.ref.value),
      }).toEqual({
        vm: vm.name,
        asked: !vm.isTemplate && vm.powerState === "poweredOn",
      });
    }
  });

  test("names every counter it read by group.name.rollup", async () => {
    const { snapshot } = await collectFrom("vcsim-vcenter-collect.json");
    const names: Array<string> = Array.from(snapshot.counterNames.values());

    for (const counter of [
      ...HOST_PERF_COUNTERS,
      ...VM_PERF_COUNTERS,
      ...SWAP_RATE_PERF_COUNTERS,
    ]) {
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
  // The swap rate pass's queries (#11468), apart from the others.
  public readonly swapQueries: Array<Array<PerfQuery>> = [];
  public swapFailures: Array<(entities: Array<string>) => VSphereFault | null> =
    [];
  // Each entity's samples of each swap rate counter, by counter name.
  public swapSamples: Map<string, Record<string, Array<number>>> = new Map();
  public swapSampleTimes: Array<string> = [
    "2026-10-10T11:59:40Z",
    "2026-10-10T12:00:00Z",
  ];
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

    const swapIds: Map<number, string> = new Map(
      this.counters
        .filter((counter: PerfCounterInfo): boolean => {
          return SWAP_RATE_PERF_COUNTERS.includes(counter.name);
        })
        .map((counter: PerfCounterInfo): [number, string] => {
          return [counter.key, counter.name];
        }),
    );

    if (
      queries[0] &&
      queries[0].counterIds.some((id: number): boolean => {
        return swapIds.has(id);
      })
    ) {
      this.swapQueries.push(queries);
      const failure:
        | ((entities: Array<string>) => VSphereFault | null)
        | undefined = this.swapFailures.shift();
      const fault: VSphereFault | null = failure ? failure(entities) : null;
      if (fault) {
        throw fault;
      }
      return queries.map((query: PerfQuery): PerfEntityMetric => {
        const samples: Record<string, Array<number>> = this.swapSamples.get(
          query.entity.value,
        ) || {};
        return {
          entity: query.entity,
          sampleInfo: this.swapSampleTimes.map((timestamp: string) => {
            return { timestamp: timestamp, interval: 20 };
          }),
          series: query.counterIds.map((id: number) => {
            return {
              counterId: id,
              instance: "*",
              values: samples[swapIds.get(id)!] || [],
            };
          }),
        };
      });
    }

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

    const failure:
      | ((entities: Array<string>) => VSphereFault | null)
      | undefined = this.perfFailures.shift();
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

  return {
    ref: { type: type, value: value },
    properties: map,
    missing: new Map(),
  };
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
      summary:
        "<val><numHosts>1</numHosts><numEffectiveHosts>1</numEffectiveHosts></val>",
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
  client.counters = [
    ...Array.from(new Set([...HOST_PERF_COUNTERS, ...VM_PERF_COUNTERS])).map(
      (name: string, index: number): PerfCounterInfo => {
        return { key: 100 + index, name: name, unit: null };
      },
    ),
    // vSphere defines both swap rates in kiloBytesPerSecond (#11468).
    {
      key: 900,
      name: VSPHERE_SWAP_OUT_RATE_COUNTER,
      unit: "kiloBytesPerSecond",
    },
    {
      key: 901,
      name: VSPHERE_SWAP_IN_RATE_COUNTER,
      unit: "kiloBytesPerSecond",
    },
  ];
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

    const snapshot: VMwareInventorySnapshot =
      await new VMwareInventoryCollector(
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
        return new VSphereFault({
          faultType: "SystemError",
          faultString: "boom",
        });
      },
      (): null => {
        return null;
      },
      (): VSphereFault => {
        return new VSphereFault({
          faultType: "SystemError",
          faultString: "vm-1 broke",
        });
      },
      (): null => {
        return null;
      },
    ];

    const snapshot: VMwareInventorySnapshot =
      await new VMwareInventoryCollector(
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

    const snapshot: VMwareInventorySnapshot =
      await new VMwareInventoryCollector(
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

    const snapshot: VMwareInventorySnapshot =
      await new VMwareInventoryCollector(
        client as unknown as VSphereSoapClient,
        { collectVsan: true },
      ).collect();

    const datacenter: VMwareDatacenter = snapshot.datacenters[0]!;
    expect(datacenter.computes.get("c-1")!.vsanEnabled).toBe(true);
    expect(datacenter.computes.get("c-1")!.vsanUuid).toBe("52aa-cluster");
    expect(
      datacenter.vsan.clustersByUuid.get("52aa-cluster")![0]!.values,
    ).toEqual([42]);

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

describe("vSphere's own swap rates (#11468)", () => {
  test("a VM swapping out reads the average of its samples, in bytes per second", async () => {
    const client: FakeClient = new FakeClient();
    inventoryWithVms(client, 2);
    client.swapSampleTimes = [
      "2026-10-10T11:58:20Z",
      "2026-10-10T11:58:40Z",
      "2026-10-10T11:59:00Z",
      "2026-10-10T11:59:20Z",
      "2026-10-10T11:59:40Z",
      "2026-10-10T12:00:00Z",
    ];
    client.swapSamples.set("vm-0", {
      [VSPHERE_SWAP_OUT_RATE_COUNTER]: [0, 0, 256, 512, 1024, 1280],
      [VSPHERE_SWAP_IN_RATE_COUNTER]: [64, 64, 64, 64, 64, 64],
    });
    client.swapSamples.set("vm-1", {
      [VSPHERE_SWAP_OUT_RATE_COUNTER]: [0, 0, 0, 0, 0, 0],
      [VSPHERE_SWAP_IN_RATE_COUNTER]: [0, 0, 0, 0, 0, 0],
    });

    const snapshot: VMwareInventorySnapshot =
      await new VMwareInventoryCollector(
        client as unknown as VSphereSoapClient,
        { collectVsan: false },
      ).collect();

    const rates: Map<string, VMwareSwapRates> =
      snapshot.datacenters[0]!.vmSwapRates;
    expect(rates.get("vm-0")).toEqual({
      // (0 + 0 + 256 + 512 + 1024 + 1280) / 6 KiB/s.
      swapOutBytesPerSecond: 512 * 1024,
      swapInBytesPerSecond: 64 * 1024,
      sampledAt: new Date("2026-10-10T12:00:00Z"),
    });
    expect(rates.get("vm-1")).toEqual({
      swapOutBytesPerSecond: 0,
      swapInBytesPerSecond: 0,
      sampledAt: new Date("2026-10-10T12:00:00Z"),
    });
    expect(snapshot.warnings).toEqual([]);
  });

  test("hosts and powered-on VMs are asked, in their own pass, over the collection interval's samples", async () => {
    const client: FakeClient = new FakeClient();
    inventoryWithVms(client, 2);

    await new VMwareInventoryCollector(client as unknown as VSphereSoapClient, {
      collectVsan: false,
      swapRateSampleCount: getSwapRateSampleCount(5),
    }).collect();

    expect(
      client.swapQueries.map((queries: Array<PerfQuery>) => {
        return queries.map((query: PerfQuery) => {
          return {
            entity: query.entity.value,
            counterIds: query.counterIds,
            intervalId: query.intervalId,
            maxSample: query.maxSample,
          };
        });
      }),
    ).toEqual([
      [
        {
          entity: "h-1",
          counterIds: [900, 901],
          intervalId: 20,
          maxSample: 15,
        },
      ],
      [
        {
          entity: "vm-0",
          counterIds: [900, 901],
          intervalId: 20,
          maxSample: 15,
        },
        {
          entity: "vm-1",
          counterIds: [900, 901],
          intervalId: 20,
          maxSample: 15,
        },
      ],
    ]);
    // The other counters are still asked for the newest sample alone, as before.
    expect(client.queries).toEqual([["vm-0", "vm-1"]]);
  });

  test("a vCenter without the swap rate counters says so once, and asks nothing of them", async () => {
    const client: FakeClient = new FakeClient();
    inventoryWithVms(client, 2);
    client.counters = client.counters.filter((counter: PerfCounterInfo) => {
      return !SWAP_RATE_PERF_COUNTERS.includes(counter.name);
    });

    const snapshot: VMwareInventorySnapshot =
      await new VMwareInventoryCollector(
        client as unknown as VSphereSoapClient,
        { collectVsan: false },
      ).collect();

    expect(client.swapQueries).toEqual([]);
    expect(snapshot.datacenters[0]!.vmSwapRates.size).toBe(0);
    expect(snapshot.datacenters[0]!.hostSwapRates.size).toBe(0);
    expect(snapshot.warnings).toEqual([
      "This vCenter has no mem.swapoutRate.average performance counter, so the metrics built from it are left out.",
      "This vCenter has no mem.swapinRate.average performance counter, so the metrics built from it are left out.",
    ]);
    // The rest of the collection is as it was.
    expect(client.queries).toEqual([["vm-0", "vm-1"]]);
  });

  test("a VM gone before its swap rates were asked is left out, and the others asked again", async () => {
    const client: FakeClient = new FakeClient();
    inventoryWithVms(client, 3);
    client.swapFailures = [
      // The hosts' pass.
      (): null => {
        return null;
      },
      (): VSphereFault => {
        return new VSphereFault({
          faultType: "ManagedObjectNotFound",
          faultString: "gone",
          objectRef: { type: "VirtualMachine", value: "vm-1" },
        });
      },
    ];
    for (const vm of ["vm-0", "vm-1", "vm-2"]) {
      client.swapSamples.set(vm, {
        [VSPHERE_SWAP_OUT_RATE_COUNTER]: [8],
        [VSPHERE_SWAP_IN_RATE_COUNTER]: [0],
      });
    }

    const snapshot: VMwareInventorySnapshot =
      await new VMwareInventoryCollector(
        client as unknown as VSphereSoapClient,
        { collectVsan: false },
      ).collect();

    expect(
      Array.from(snapshot.datacenters[0]!.vmSwapRates.keys()).sort(),
    ).toEqual(["vm-0", "vm-2"]);
    // The other counters' samples are unaffected by the swap pass's failure.
    expect(Array.from(snapshot.datacenters[0]!.vmPerf.keys()).sort()).toEqual([
      "vm-0",
      "vm-1",
      "vm-2",
    ]);
  });

  test("an entity vSphere sent no sample of either counter for has no swap rates", async () => {
    const client: FakeClient = new FakeClient();
    inventoryWithVms(client, 1);
    client.swapSamples.set("vm-0", {
      [VSPHERE_SWAP_OUT_RATE_COUNTER]: [-1, -1],
      [VSPHERE_SWAP_IN_RATE_COUNTER]: [],
    });

    const snapshot: VMwareInventorySnapshot =
      await new VMwareInventoryCollector(
        client as unknown as VSphereSoapClient,
        { collectVsan: false },
      ).collect();

    expect(snapshot.datacenters[0]!.vmSwapRates.has("vm-0")).toBe(false);
    expect(snapshot.datacenters[0]!.hostSwapRates.has("h-1")).toBe(false);
  });
});

describe("getSwapRateSampleCount", () => {
  test("the 20-second samples of a collection interval, up to five minutes of them", () => {
    expect(REALTIME_SAMPLE_SECONDS).toBe(20);
    expect(MAX_SWAP_RATE_SAMPLES).toBe(15);
    expect(getSwapRateSampleCount(1)).toBe(3);
    expect(getSwapRateSampleCount(2)).toBe(6);
    expect(getSwapRateSampleCount(4)).toBe(12);
    expect(getSwapRateSampleCount(5)).toBe(15);
    expect(getSwapRateSampleCount(60)).toBe(15);
    // Part of a sample is a sample.
    expect(getSwapRateSampleCount(0.5)).toBe(2);
  });

  test("no interval, or none that is one, is the default two minutes", () => {
    for (const minutes of [null, undefined, 0, -3, Number.NaN]) {
      expect(getSwapRateSampleCount(minutes)).toBe(6);
    }
  });
});

describe("readSwapRates", () => {
  const counterNames: Map<number, string> = new Map([
    [86, VSPHERE_SWAP_OUT_RATE_COUNTER],
    [85, VSPHERE_SWAP_IN_RATE_COUNTER],
    [24, "mem.usage.average"],
  ]);
  const counterUnits: Map<number, string | null> = new Map([
    [86, "kiloBytesPerSecond"],
    [85, "kiloBytesPerSecond"],
    [24, "percent"],
  ]);

  interface PerfSeries {
    counterId: number;
    instance?: string;
    values: Array<number>;
  }

  function perf(
    series: Array<PerfSeries>,
    times: Array<string> = ["2026-10-10T12:00:00Z"],
  ): PerfEntityMetric {
    return {
      entity: { type: "VirtualMachine", value: "vm-1" },
      sampleInfo: times.map((timestamp: string) => {
        return { timestamp, interval: 20 };
      }),
      series: series.map((item: PerfSeries) => {
        return {
          counterId: item.counterId,
          instance: item.instance ?? "",
          values: item.values,
        };
      }),
    };
  }

  test("averages each counter's samples, in bytes per second", () => {
    expect(
      readSwapRates({
        perf: perf(
          [
            { counterId: 86, values: [100, 300] },
            { counterId: 85, values: [10] },
          ],
          ["2026-10-10T11:59:40Z", "2026-10-10T12:00:00Z"],
        ),
        counterNames,
        counterUnits,
      }),
    ).toEqual({
      swapOutBytesPerSecond: 200 * 1024,
      swapInBytesPerSecond: 10 * 1024,
      sampledAt: new Date("2026-10-10T12:00:00Z"),
    });
  });

  test("a sample vSphere marks missing (-1) is no sample; a counter with none is unknown", () => {
    expect(
      readSwapRates({
        perf: perf([
          { counterId: 86, values: [-1, 400, -1] },
          { counterId: 85, values: [-1] },
        ]),
        counterNames,
        counterUnits,
      }),
    ).toEqual({
      swapOutBytesPerSecond: 400 * 1024,
      swapInBytesPerSecond: null,
      sampledAt: new Date("2026-10-10T12:00:00Z"),
    });
  });

  test("an instance of a device is not the whole VM's; '' and '*' are", () => {
    expect(
      readSwapRates({
        perf: perf([
          { counterId: 86, instance: "scsi0:0", values: [999] },
          { counterId: 86, instance: "*", values: [1] },
          { counterId: 85, instance: "", values: [2] },
        ]),
        counterNames,
        counterUnits,
      }),
    ).toEqual({
      swapOutBytesPerSecond: 1024,
      swapInBytesPerSecond: 2048,
      sampledAt: new Date("2026-10-10T12:00:00Z"),
    });
  });

  test("a counter in a unit no rate is in is no sample", () => {
    expect(
      readSwapRates({
        perf: perf([{ counterId: 86, values: [5] }]),
        counterNames,
        counterUnits: new Map([[86, "percent"]]),
      }),
    ).toBeNull();
  });

  test("other counters, no series, or no sample time read nothing", () => {
    expect(
      readSwapRates({
        perf: perf([{ counterId: 24, values: [50] }]),
        counterNames,
        counterUnits,
      }),
    ).toBeNull();
    expect(
      readSwapRates({ perf: perf([]), counterNames, counterUnits }),
    ).toBeNull();
    expect(
      readSwapRates({
        perf: perf([{ counterId: 86, values: [5] }], ["not a time"]),
        counterNames,
        counterUnits,
      }),
    ).toBeNull();
  });

  test("the sample time is the newest vSphere stamped, whatever order they came in", () => {
    expect(
      readSwapRates({
        perf: perf(
          [{ counterId: 86, values: [1, 1, 1] }],
          [
            "2026-10-10T12:00:00Z",
            "2026-10-10T11:59:20Z",
            "2026-10-10T11:59:40Z",
          ],
        ),
        counterNames,
        counterUnits,
      })!.sampledAt,
    ).toEqual(new Date("2026-10-10T12:00:00Z"));
  });
});
