import VSphereSoapClient, {
  MoRef,
  PerfCounterInfo,
  PerfEntityMetric,
  PerfQuery,
  VSphereFault,
  VSphereObject,
  VSphereServiceContent,
} from "./VSphereSoapClient";
import VSphereXml, { XmlElement } from "./VSphereXml";
import {
  VMwareComputeResource,
  VMwareDatacenter,
  VMwareDatastore,
  VMwareHost,
  VMwareInventorySnapshot,
  VMwareResourcePool,
  VMwareResourcePoolQuickStats,
  VMwareVirtualMachine,
  VMwareVsanMetric,
  VMwareVsanResults,
  aboutFromServiceContent,
  childNumber,
  emptyVsanResults,
  getInventoryPath,
  readBoolean,
  readNumber,
  readRefList,
  readRefValue,
  readString,
} from "./VMwareInventory";

/*
 * Reads one vCenter's inventory and performance data the way the VMware
 * agent's vcenter receiver (opentelemetry-collector-contrib 0.161.0, the
 * version the agent pins) does: datacenter by datacenter, each object kind
 * through a container view, with the same properties, the same real-time
 * performance counters and the same vSAN queries - so the metrics built
 * from it (VMwareOtlpBuilder) are the ones the agent sends.
 *
 * What it does differently is all about load on vCenter:
 *
 *   - every property read is paged (maxObjects), so no single answer holds
 *     a large inventory;
 *   - performance counters are asked only for objects that have real-time
 *     samples (powered-on VMs, not templates) and only for counters a
 *     default agent turns into metrics, in batches sized like the
 *     receiver's (maxQueryMetrics / counters per object);
 *   - a counter this vCenter does not define is left out (and said so),
 *     instead of failing every performance query;
 *   - a part that fails (vSAN not licensed, one datacenter's datastores)
 *     becomes a warning on the collection, never the end of it.
 */

export const COLLECTION_PAGE_SIZE: number = 500;
export const MAX_QUERY_METRICS: number = 256;
export const REALTIME_INTERVAL_ID: number = 20;

/*
 * The real-time counters each kind is asked for: the receiver's
 * hostPerfMetricList and vmPerfMetricList, without the counters that only
 * feed metrics the receiver leaves off by default (cpu.idle/wait/ready,
 * broadcast/multicast, mem.granted/active/vmmemctl - the VMware agent
 * config does not turn them on) and without disk.total*Latency for VMs,
 * which the receiver asks for but never records.
 */
export const HOST_PERF_COUNTERS: ReadonlyArray<string> = [
  "net.bytesTx.average",
  "net.bytesRx.average",
  "net.packetsTx.summation",
  "net.packetsRx.summation",
  "net.usage.average",
  "net.errorsRx.summation",
  "net.errorsTx.summation",
  "net.droppedTx.summation",
  "net.droppedRx.summation",
  "disk.totalReadLatency.average",
  "disk.totalWriteLatency.average",
  "disk.maxTotalLatency.latest",
  "disk.read.average",
  "disk.write.average",
  "cpu.reservedCapacity.average",
  "cpu.totalCapacity.average",
];

export const VM_PERF_COUNTERS: ReadonlyArray<string> = [
  "net.packetsTx.summation",
  "net.packetsRx.summation",
  "net.droppedTx.summation",
  "net.droppedRx.summation",
  "net.bytesRx.average",
  "net.bytesTx.average",
  "net.usage.average",
  "disk.maxTotalLatency.latest",
  "virtualDisk.totalWriteLatency.average",
  "virtualDisk.totalReadLatency.average",
  "virtualDisk.read.average",
  "virtualDisk.write.average",
];

export const DATASTORE_PATHS: Array<string> = [
  "name",
  "summary.capacity",
  "summary.freeSpace",
];

export const COMPUTE_PATHS: Array<string> = ["name", "host", "summary"];

export const HOST_PATHS: Array<string> = [
  "name",
  "runtime.powerState",
  "summary.hardware.memorySize",
  "summary.hardware.numCpuCores",
  "summary.hardware.cpuMhz",
  "config.vsanHostConfig.clusterInfo.nodeUuid",
  "summary.quickStats.overallMemoryUsage",
  "summary.quickStats.overallCpuUsage",
  "summary.overallStatus",
  "vm",
  "parent",
];

export const RESOURCE_POOL_PATHS: Array<string> = [
  "name",
  "owner",
  "summary.config.cpuAllocation.shares.shares",
  "summary.config.memoryAllocation.shares.shares",
  "summary.quickStats",
];

export const VM_PATHS: Array<string> = [
  "name",
  "config.hardware.numCPU",
  "config.instanceUuid",
  "config.template",
  "runtime.powerState",
  "runtime.maxCpuUsage",
  "summary.quickStats.guestMemoryUsage",
  "summary.quickStats.balloonedMemory",
  "summary.quickStats.swappedMemory",
  "summary.quickStats.ssdSwappedMemory",
  "summary.quickStats.overallCpuUsage",
  "summary.quickStats.overallCpuReadiness",
  "summary.overallStatus",
  "summary.config.memorySizeMB",
  "summary.storage.committed",
  "summary.storage.uncommitted",
  "summary.runtime.host",
  "resourcePool",
];

// The vSAN performance labels the receiver asks for, per query type.
export const VSAN_QUERY_LABELS: Record<string, Array<string>> = {
  "cluster-domclient:*": [
    "iopsRead",
    "iopsWrite",
    "throughputRead",
    "throughputWrite",
    "latencyAvgRead",
    "latencyAvgWrite",
    "congestion",
  ],
  "host-domclient:*": [
    "iopsRead",
    "iopsWrite",
    "throughputRead",
    "throughputWrite",
    "latencyAvgRead",
    "latencyAvgWrite",
    "congestion",
    "clientCacheHitRate",
  ],
  "virtual-machine:*": [
    "iopsRead",
    "iopsWrite",
    "throughputRead",
    "throughputWrite",
    "latencyRead",
    "latencyWrite",
  ],
};

export interface VMwareInventoryCollectorOptions {
  // Ask vSAN's performance service (skipped where vCenter has none).
  collectVsan: boolean;
  now?: () => Date;
}

// How many objects one performance query names (the receiver's batching).
export function getPerfBatchSize(counterCount: number): number {
  if (counterCount <= 0) {
    return 1;
  }

  return Math.max(1, Math.floor(MAX_QUERY_METRICS / counterCount));
}

function refKey(ref: MoRef): string {
  return ref.value;
}

function readQuickStats(
  element: XmlElement | undefined,
): VMwareResourcePoolQuickStats | null {
  if (!element) {
    return null;
  }

  return {
    overallCpuUsage: childNumber(element, ["overallCpuUsage"]),
    guestMemoryUsage: childNumber(element, ["guestMemoryUsage"]),
    hostMemoryUsage: childNumber(element, ["hostMemoryUsage"]),
    overheadMemory: childNumber(element, ["overheadMemory"]),
    swappedMemory: childNumber(element, ["swappedMemory"]),
    balloonedMemory: childNumber(element, ["balloonedMemory"]),
    privateMemory: childNumber(element, ["privateMemory"]),
    sharedMemory: childNumber(element, ["sharedMemory"]),
  };
}

/*
 * vSAN's CSV samples ("2026-10-10 13:05:00,..." and "12,15,...") as numbers
 * at times. The timestamps are UTC (vSAN's performance service reports in
 * UTC); a value that is not a whole number drops its sample, as does a
 * series whose lengths disagree.
 */
export function parseVsanEntityMetrics(entity: XmlElement): {
  uuid: string | null;
  metrics: Array<VMwareVsanMetric>;
} {
  const entityRefId: string = (
    VSphereXml.childText(entity, "entityRefId") || ""
  ).trim();
  const colon: number = entityRefId.indexOf(":");
  const uuid: string | null =
    colon === -1 ? null : entityRefId.substring(colon + 1) || null;

  const sampleInfo: string = (
    VSphereXml.childText(entity, "sampleInfo") || ""
  ).trim();

  if (!sampleInfo) {
    return { uuid: uuid, metrics: [] };
  }

  const timestamps: Array<Date> = sampleInfo
    .split(",")
    .map((text: string): Date => {
      return new Date(`${text.trim().replace(" ", "T")}Z`);
    });

  if (
    timestamps.some((date: Date): boolean => {
      return Number.isNaN(date.getTime());
    })
  ) {
    return { uuid: uuid, metrics: [] };
  }

  const metrics: Array<VMwareVsanMetric> = [];

  for (const series of VSphereXml.children(entity, "value")) {
    const label: string = (
      VSphereXml.path(series, ["metricId", "label"])?.text || ""
    ).trim();
    const interval: number = Number.parseInt(
      VSphereXml.path(series, ["metricId", "metricsCollectInterval"])?.text ||
        "",
      10,
    );
    const values: Array<number> = (VSphereXml.childText(series, "values") || "")
      .split(",")
      .map((text: string): number => {
        return Number(text.trim());
      });

    if (
      !label ||
      values.length !== timestamps.length ||
      values.some((value: number): boolean => {
        return !Number.isInteger(value);
      })
    ) {
      continue;
    }

    metrics.push({
      label: label,
      intervalInSeconds:
        Number.isFinite(interval) && interval > 0 ? interval : 300,
      timestamps: timestamps,
      values: values,
    });
  }

  return { uuid: uuid, metrics: metrics };
}

export default class VMwareInventoryCollector {
  private readonly client: VSphereSoapClient;
  private readonly options: VMwareInventoryCollectorOptions;
  private readonly warnings: Array<string> = [];

  public constructor(
    client: VSphereSoapClient,
    options: VMwareInventoryCollectorOptions,
  ) {
    this.client = client;
    this.options = options;
  }

  public async collect(): Promise<VMwareInventorySnapshot> {
    const content: VSphereServiceContent = this.client.getServiceContent();
    const now: () => Date =
      this.options.now ||
      ((): Date => {
        return new Date();
      });
    const collectedAt: Date = now();

    // Names and parents of the containers, for inventory paths.
    const names: Map<string, string> = new Map();
    const parents: Map<string, string | null> = new Map();
    const vAppParentFolders: Map<string, string | null> = new Map();
    const vAppParentVApps: Map<string, string | null> = new Map();

    const rootView: MoRef = await this.client.createContainerView({
      container: content.rootFolder,
      types: ["Folder", "Datacenter", "ComputeResource", "ResourcePool"],
    });

    let datacenterObjects: Array<VSphereObject> = [];

    try {
      for (const type of ["Folder", "Datacenter", "ComputeResource"]) {
        const objects: Array<VSphereObject> =
          await this.client.retrieveFromView({
            view: rootView,
            type: type,
            paths: ["name", "parent"],
            maxObjects: COLLECTION_PAGE_SIZE,
          });

        for (const object of objects) {
          names.set(refKey(object.ref), readString(object, "name") || "");
          parents.set(refKey(object.ref), readRefValue(object, "parent"));
        }

        if (type === "Datacenter") {
          datacenterObjects = objects;
        }
      }

      const pools: Array<VSphereObject> = await this.client.retrieveFromView({
        view: rootView,
        type: "ResourcePool",
        paths: ["name", "parent"],
        maxObjects: COLLECTION_PAGE_SIZE,
      });

      for (const pool of pools) {
        names.set(refKey(pool.ref), readString(pool, "name") || "");
        parents.set(refKey(pool.ref), readRefValue(pool, "parent"));
      }

      const vApps: Array<VSphereObject> = await this.client.retrieveFromView({
        view: rootView,
        type: "VirtualApp",
        paths: ["parentFolder", "parentVApp"],
        maxObjects: COLLECTION_PAGE_SIZE,
      });

      for (const vApp of vApps) {
        vAppParentFolders.set(
          refKey(vApp.ref),
          readRefValue(vApp, "parentFolder"),
        );
        vAppParentVApps.set(refKey(vApp.ref), readRefValue(vApp, "parentVApp"));
      }
    } finally {
      await this.destroyViewQuietly(rootView);
    }

    const counters: Array<PerfCounterInfo> = await this.readPerfCounters();
    const counterNames: Map<number, string> = new Map();
    const countersByName: Map<string, number> = new Map();

    for (const counter of counters) {
      counterNames.set(counter.key, counter.name);
      countersByName.set(counter.name, counter.key);
    }

    const datacenters: Array<VMwareDatacenter> = [];

    for (const datacenterObject of datacenterObjects) {
      const datacenter: VMwareDatacenter = {
        ref: datacenterObject.ref,
        name: readString(datacenterObject, "name") || "",
        datastores: [],
        computes: new Map(),
        hosts: new Map(),
        resourcePools: new Map(),
        vms: new Map(),
        hostPerf: new Map(),
        vmPerf: new Map(),
        vsan: emptyVsanResults(),
      };

      await this.collectDatacenter({
        datacenter: datacenter,
        rootFolder: content.rootFolder.value,
        names: names,
        parents: parents,
        vAppParentFolders: vAppParentFolders,
        vAppParentVApps: vAppParentVApps,
        countersByName: countersByName,
      });

      datacenters.push(datacenter);
    }

    return {
      about: aboutFromServiceContent(content.about),
      datacenters: datacenters,
      counterNames: counterNames,
      collectedAt: collectedAt,
      warnings: [...this.warnings],
    };
  }

  private warn(message: string): void {
    if (!this.warnings.includes(message)) {
      this.warnings.push(message);
    }
  }

  private async destroyViewQuietly(view: MoRef): Promise<void> {
    try {
      await this.client.destroyView(view);
    } catch {
      // A view vCenter already dropped with the session needs nothing more.
    }
  }

  private async readPerfCounters(): Promise<Array<PerfCounterInfo>> {
    try {
      return await this.client.getPerfCounters();
    } catch (error) {
      this.warn(
        `Performance counters could not be read, so latency, throughput and network rates are left out: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return [];
    }
  }

  private async retrieveInDatacenter(data: {
    datacenter: VMwareDatacenter;
    type: string;
    paths: Array<string>;
  }): Promise<Array<VSphereObject>> {
    const view: MoRef = await this.client.createContainerView({
      container: data.datacenter.ref,
      types: [data.type],
    });

    try {
      return await this.client.retrieveFromView({
        view: view,
        type: data.type,
        paths: data.paths,
        maxObjects: COLLECTION_PAGE_SIZE,
      });
    } finally {
      await this.destroyViewQuietly(view);
    }
  }

  private async collectDatacenter(data: {
    datacenter: VMwareDatacenter;
    rootFolder: string;
    names: Map<string, string>;
    parents: Map<string, string | null>;
    vAppParentFolders: Map<string, string | null>;
    vAppParentVApps: Map<string, string | null>;
    countersByName: Map<string, number>;
  }): Promise<void> {
    const datacenter: VMwareDatacenter = data.datacenter;

    // Datastores.
    for (const object of await this.retrieveInDatacenter({
      datacenter: datacenter,
      type: "Datastore",
      paths: DATASTORE_PATHS,
    })) {
      const store: VMwareDatastore = {
        ref: object.ref,
        name: readString(object, "name") || "",
        capacity: readNumber(object, "summary.capacity"),
        freeSpace: readNumber(object, "summary.freeSpace"),
      };

      datacenter.datastores.push(store);
    }

    // Clusters and standalone hosts' compute resources.
    for (const object of await this.retrieveInDatacenter({
      datacenter: datacenter,
      type: "ComputeResource",
      paths: COMPUTE_PATHS,
    })) {
      const summary: XmlElement | undefined = object.properties.get("summary");

      const compute: VMwareComputeResource = {
        ref: object.ref,
        name: readString(object, "name") || "",
        isCluster: object.ref.type === "ClusterComputeResource",
        hostRefs: readRefList(object, "host"),
        totalCpu: childNumber(summary, ["totalCpu"]),
        totalMemory: childNumber(summary, ["totalMemory"]),
        effectiveCpu: childNumber(summary, ["effectiveCpu"]),
        effectiveMemory: childNumber(summary, ["effectiveMemory"]),
        numHosts: childNumber(summary, ["numHosts"]),
        numEffectiveHosts: childNumber(summary, ["numEffectiveHosts"]),
        overallStatus:
          VSphereXml.childText(summary, "overallStatus")?.trim() || null,
        vsanEnabled: false,
        vsanUuid: null,
      };

      datacenter.computes.set(refKey(object.ref), compute);
    }

    // ESXi hosts.
    for (const object of await this.retrieveInDatacenter({
      datacenter: datacenter,
      type: "HostSystem",
      paths: HOST_PATHS,
    })) {
      const host: VMwareHost = {
        ref: object.ref,
        name: readString(object, "name") || "",
        powerState: readString(object, "runtime.powerState")?.trim() || null,
        memorySize: readNumber(object, "summary.hardware.memorySize"),
        numCpuCores: readNumber(object, "summary.hardware.numCpuCores"),
        cpuMhz: readNumber(object, "summary.hardware.cpuMhz"),
        vsanNodeUuid:
          readString(
            object,
            "config.vsanHostConfig.clusterInfo.nodeUuid",
          )?.trim() || null,
        overallMemoryUsage: readNumber(
          object,
          "summary.quickStats.overallMemoryUsage",
        ),
        overallCpuUsage: readNumber(
          object,
          "summary.quickStats.overallCpuUsage",
        ),
        overallStatus:
          readString(object, "summary.overallStatus")?.trim() || null,
        vmRefs: readRefList(object, "vm"),
        parentRef: readRefValue(object, "parent"),
      };

      datacenter.hosts.set(refKey(object.ref), host);
    }

    datacenter.hostPerf = await this.queryRealtimePerf({
      entities: Array.from(datacenter.hosts.values()).map(
        (host: VMwareHost): MoRef => {
          return host.ref;
        },
      ),
      counterNames: HOST_PERF_COUNTERS,
      countersByName: data.countersByName,
      kind: "hosts",
    });

    // Resource pools and vApps.
    for (const object of await this.retrieveInDatacenter({
      datacenter: datacenter,
      type: "ResourcePool",
      paths: RESOURCE_POOL_PATHS,
    })) {
      const isVirtualApp: boolean = object.ref.type === "VirtualApp";
      const ref: string = refKey(object.ref);

      let inventoryPath: string | null;

      if (isVirtualApp) {
        /*
         * govmomi's finder lists a vApp under the datacenter's VM folder
         * ("/DC/vm/folder/vApp"); a vApp inside another vApp under that one.
         */
        const parentFolder: string | null =
          data.vAppParentFolders.get(ref) ?? null;
        const parentVApp: string | null = data.vAppParentVApps.get(ref) ?? null;
        const ownName: string = readString(object, "name") || "";
        const parentPath: string | null = parentFolder
          ? getInventoryPath({
              ref: parentFolder,
              rootFolder: data.rootFolder,
              names: data.names,
              parents: data.parents,
            })
          : parentVApp
            ? this.getVAppPath({
                ref: parentVApp,
                data: data,
                depth: 0,
              })
            : null;

        inventoryPath = parentPath ? `${parentPath}/${ownName}` : null;
      } else {
        inventoryPath = getInventoryPath({
          ref: ref,
          rootFolder: data.rootFolder,
          names: data.names,
          parents: data.parents,
        });
      }

      const pool: VMwareResourcePool = {
        ref: object.ref,
        isVirtualApp: isVirtualApp,
        name: readString(object, "name") || "",
        ownerRef: readRefValue(object, "owner"),
        inventoryPath: inventoryPath,
        cpuShares: readNumber(
          object,
          "summary.config.cpuAllocation.shares.shares",
        ),
        memoryShares: readNumber(
          object,
          "summary.config.memoryAllocation.shares.shares",
        ),
        quickStats: readQuickStats(object.properties.get("summary.quickStats")),
      };

      datacenter.resourcePools.set(ref, pool);
    }

    // Virtual machines and templates.
    for (const object of await this.retrieveInDatacenter({
      datacenter: datacenter,
      type: "VirtualMachine",
      paths: VM_PATHS,
    })) {
      const hasConfig: boolean =
        object.properties.has("config.hardware.numCPU") ||
        object.properties.has("config.instanceUuid") ||
        object.properties.has("config.template");
      const hasStorage: boolean =
        object.properties.has("summary.storage.committed") ||
        object.properties.has("summary.storage.uncommitted");

      const vm: VMwareVirtualMachine = {
        ref: object.ref,
        name: readString(object, "name") || "",
        hasConfig: hasConfig,
        numCpu: readNumber(object, "config.hardware.numCPU"),
        instanceUuid: readString(object, "config.instanceUuid")?.trim() || null,
        isTemplate: readBoolean(object, "config.template"),
        powerState: readString(object, "runtime.powerState")?.trim() || null,
        maxCpuUsage: readNumber(object, "runtime.maxCpuUsage"),
        guestMemoryUsage: readNumber(
          object,
          "summary.quickStats.guestMemoryUsage",
        ),
        balloonedMemory: readNumber(
          object,
          "summary.quickStats.balloonedMemory",
        ),
        swappedMemory: readNumber(object, "summary.quickStats.swappedMemory"),
        ssdSwappedMemory: readNumber(
          object,
          "summary.quickStats.ssdSwappedMemory",
        ),
        grantedMemory: null,
        overallCpuUsage: readNumber(
          object,
          "summary.quickStats.overallCpuUsage",
        ),
        overallCpuReadiness: readNumber(
          object,
          "summary.quickStats.overallCpuReadiness",
        ),
        overallStatus:
          readString(object, "summary.overallStatus")?.trim() || null,
        memorySizeMB: readNumber(object, "summary.config.memorySizeMB"),
        hasStorage: hasStorage,
        storageCommitted: readNumber(object, "summary.storage.committed"),
        storageUncommitted: readNumber(object, "summary.storage.uncommitted"),
        hostRef: readRefValue(object, "summary.runtime.host"),
        resourcePoolRef: readRefValue(object, "resourcePool"),
      };

      datacenter.vms.set(refKey(object.ref), vm);
    }

    /*
     * Real-time samples exist only for powered-on VMs; asking for the others
     * (and for templates) only loads vCenter to answer nothing.
     */
    datacenter.vmPerf = await this.queryRealtimePerf({
      entities: Array.from(datacenter.vms.values())
        .filter((vm: VMwareVirtualMachine): boolean => {
          return !vm.isTemplate && vm.powerState === "poweredOn";
        })
        .map((vm: VMwareVirtualMachine): MoRef => {
          return vm.ref;
        }),
      counterNames: VM_PERF_COUNTERS,
      countersByName: data.countersByName,
      kind: "virtual machines",
    });

    if (this.options.collectVsan) {
      await this.collectVsan(datacenter);
    }
  }

  private getVAppPath(data: {
    ref: string;
    data: {
      rootFolder: string;
      names: Map<string, string>;
      parents: Map<string, string | null>;
      vAppParentFolders: Map<string, string | null>;
      vAppParentVApps: Map<string, string | null>;
    };
    depth: number;
  }): string | null {
    if (data.depth > 16) {
      return null;
    }

    const name: string | undefined = data.data.names.get(data.ref);
    const parentFolder: string | null =
      data.data.vAppParentFolders.get(data.ref) ?? null;
    const parentVApp: string | null =
      data.data.vAppParentVApps.get(data.ref) ?? null;

    if (name === undefined) {
      return null;
    }

    const parentPath: string | null = parentFolder
      ? getInventoryPath({
          ref: parentFolder,
          rootFolder: data.data.rootFolder,
          names: data.data.names,
          parents: data.data.parents,
        })
      : parentVApp
        ? this.getVAppPath({
            ref: parentVApp,
            data: data.data,
            depth: data.depth + 1,
          })
        : null;

    return parentPath ? `${parentPath}/${name}` : null;
  }

  /*
   * Real-time samples (20-second interval, the newest one) of the counters
   * this vCenter defines, for the entities, in batches. A batch that fails
   * because one of its objects went away is asked again without it; any
   * other failure falls back to one query per object - the receiver's
   * recovery, so one bad object never loses everyone's samples.
   */
  private async queryRealtimePerf(data: {
    entities: Array<MoRef>;
    counterNames: ReadonlyArray<string>;
    countersByName: Map<string, number>;
    kind: string;
  }): Promise<Map<string, PerfEntityMetric>> {
    const results: Map<string, PerfEntityMetric> = new Map();

    if (data.entities.length === 0 || data.countersByName.size === 0) {
      return results;
    }

    const counterIds: Array<number> = [];

    for (const name of data.counterNames) {
      const id: number | undefined = data.countersByName.get(name);

      if (id === undefined) {
        this.warn(
          `This vCenter has no ${name} performance counter, so the metrics built from it are left out.`,
        );
        continue;
      }

      counterIds.push(id);
    }

    if (counterIds.length === 0) {
      return results;
    }

    const batchSize: number = getPerfBatchSize(counterIds.length);

    for (
      let start: number = 0;
      start < data.entities.length;
      start += batchSize
    ) {
      let batch: Array<MoRef> = data.entities.slice(start, start + batchSize);

      while (batch.length > 0) {
        try {
          const metrics: Array<PerfEntityMetric> = await this.client.queryPerf(
            batch.map((entity: MoRef): PerfQuery => {
              return {
                entity: entity,
                counterIds: counterIds,
                intervalId: REALTIME_INTERVAL_ID,
                maxSample: 1,
              };
            }),
          );

          for (const metric of metrics) {
            results.set(refKey(metric.entity), metric);
          }

          break;
        } catch (error) {
          if (
            error instanceof VSphereFault &&
            error.faultType === "ManagedObjectNotFound" &&
            error.objectRef
          ) {
            const missing: string = error.objectRef.value;
            const remaining: Array<MoRef> = batch.filter(
              (entity: MoRef): boolean => {
                return entity.value !== missing;
              },
            );

            if (remaining.length < batch.length) {
              batch = remaining;
              continue;
            }
          }

          for (const entity of batch) {
            try {
              const metrics: Array<PerfEntityMetric> =
                await this.client.queryPerf([
                  {
                    entity: entity,
                    counterIds: counterIds,
                    intervalId: REALTIME_INTERVAL_ID,
                    maxSample: 1,
                  },
                ]);

              for (const metric of metrics) {
                results.set(refKey(metric.entity), metric);
              }
            } catch (singleError) {
              this.warn(
                `Performance samples of some ${data.kind} could not be read: ${
                  singleError instanceof Error
                    ? singleError.message
                    : String(singleError)
                }`,
              );
            }
          }

          break;
        }
      }
    }

    return results;
  }

  /*
   * vSAN: each cluster's vSAN uuid (configurationEx), then vSAN's
   * performance service for its clusters, hosts and VMs - the receiver's
   * three queries per cluster. A vCenter without vSAN, or without the
   * performance service turned on, answers with a fault: that is "no vSAN
   * metrics", said once as a warning when it is anything but "not here".
   */
  private async collectVsan(datacenter: VMwareDatacenter): Promise<void> {
    const clusters: Array<VMwareComputeResource> = Array.from(
      datacenter.computes.values(),
    ).filter((compute: VMwareComputeResource): boolean => {
      return compute.isCluster;
    });

    if (clusters.length === 0) {
      return;
    }

    let configurations: Array<VSphereObject>;

    try {
      configurations = await this.retrieveInDatacenter({
        datacenter: datacenter,
        type: "ClusterComputeResource",
        paths: ["configurationEx"],
      });
    } catch (error) {
      this.warn(
        `vSAN configuration could not be read: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return;
    }

    for (const configuration of configurations) {
      const compute: VMwareComputeResource | undefined =
        datacenter.computes.get(refKey(configuration.ref));
      const vsanConfig: XmlElement | null = VSphereXml.child(
        configuration.properties.get("configurationEx") || null,
        "vsanConfigInfo",
      );

      if (!compute || !vsanConfig) {
        continue;
      }

      compute.vsanEnabled =
        VSphereXml.childText(vsanConfig, "enabled")?.trim() === "true";
      compute.vsanUuid =
        VSphereXml.path(vsanConfig, ["defaultConfig", "uuid"])?.text.trim() ||
        null;
    }

    const vsanClusters: Array<VMwareComputeResource> = clusters.filter(
      (cluster: VMwareComputeResource): boolean => {
        return cluster.vsanEnabled;
      },
    );

    if (vsanClusters.length === 0) {
      return;
    }

    const results: VMwareVsanResults = datacenter.vsan;
    const now: Date = this.options.now ? this.options.now() : new Date();
    const time: string = now.toISOString();

    const targets: Array<{
      entityRefId: string;
      into: Map<string, Array<VMwareVsanMetric>>;
    }> = [
      { entityRefId: "cluster-domclient:*", into: results.clustersByUuid },
      { entityRefId: "host-domclient:*", into: results.hostsByUuid },
      { entityRefId: "virtual-machine:*", into: results.vmsByUuid },
    ];

    for (const cluster of vsanClusters) {
      for (const target of targets) {
        try {
          const entities: Array<XmlElement> = await this.client.queryVsanPerf({
            cluster: cluster.ref,
            entityRefId: target.entityRefId,
            labels: VSAN_QUERY_LABELS[target.entityRefId] || [],
            startTime: time,
            endTime: time,
          });

          for (const entity of entities) {
            const parsed: {
              uuid: string | null;
              metrics: Array<VMwareVsanMetric>;
            } = parseVsanEntityMetrics(entity);

            if (parsed.uuid && parsed.metrics.length > 0) {
              target.into.set(parsed.uuid, parsed.metrics);
            }
          }
        } catch (error) {
          const isNotHere: boolean =
            error instanceof VSphereFault &&
            ["NotSupported", "NotFound", "ManagedObjectNotFound"].includes(
              error.faultType,
            );

          if (!isNotHere) {
            this.warn(
              `vSAN performance of cluster ${cluster.name} could not be read: ${
                error instanceof Error ? error.message : String(error)
              }`,
            );
          }

          // One failing query type says the same about the others.
          break;
        }
      }
    }
  }
}
