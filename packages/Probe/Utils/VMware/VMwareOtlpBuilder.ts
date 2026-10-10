import { JSONArray, JSONObject } from "Common/Types/JSON";
import {
  VCENTER_METRICS,
  VCenterMetricDefinition,
} from "./VCenterMetricDefinitions";
import {
  VMwareComputeResource,
  VMwareDatacenter,
  VMwareHost,
  VMwareInventorySnapshot,
  VMwareResourcePool,
  VMwareVirtualMachine,
  VMwareVsanMetric,
} from "./VMwareInventory";
import { PerfEntityMetric, PerfSeries } from "./VSphereSoapClient";

/*
 * One collection as OpenTelemetry metrics - exactly what the VMware agent's
 * vcenter receiver (0.161.0) emits for the same inventory: one OTLP resource
 * per vSphere object, with the object's identity in the resource attributes
 * (vcenter.datacenter.name, vcenter.cluster.name, vcenter.host.name,
 * vcenter.vm.name / vcenter.vm.id, ...), the receiver's metric names, units,
 * kinds and datapoint attributes, and the receiver's arithmetic
 * (processors.go, metrics.go, resources.go). The server adds
 * vmware.vcenter.name, as the agent's resource processor does, and the
 * ingest - VMwareSnapshotScan, the metric catalog, the alert templates - then
 * cannot tell the two apart.
 *
 * Where the receiver would emit a number it never read (Go's zero value for
 * a property vSphere did not return) or divide by zero, this leaves the
 * datapoint out instead - except the few the snapshot scan's powered-on
 * inference relies on, which are emitted as the receiver emits them.
 */

export const VMWARE_PROBE_SCOPE_NAME: string = "oneuptime-probe-vmware";

type AttributeValue = string | boolean;

interface MetricBuffer {
  definition: VCenterMetricDefinition;
  dataPoints: JSONArray;
}

export interface VMwareOtlpBuildResult {
  resourceMetrics: JSONArray;
  resourceCount: number;
  datapointCount: number;
  datacenterCount: number;
  clusterCount: number;
  hostCount: number;
  vmCount: number;
  poweredOnVmCount: number;
  templateCount: number;
  datastoreCount: number;
  resourcePoolCount: number;
  // Objects left out of the metrics, and why (the receiver's partial errors).
  warnings: Array<string>;
}

// Unix nanoseconds, as the string OTLP/JSON writes a fixed64.
export function toUnixNano(date: Date): string {
  return (BigInt(date.getTime()) * BigInt(1_000_000)).toString();
}

const ENTITY_STATUSES: ReadonlyArray<string> = ["red", "yellow", "green", "gray"];

function entityStatusOf(status: string | null): string {
  return status && ENTITY_STATUSES.includes(status) ? status : "gray";
}

// HostSystemPowerState -> the receiver's power_state ("standBy" included).
export function hostPowerStateOf(powerState: string | null): string {
  switch ((powerState || "").toLowerCase()) {
    case "poweredon":
      return "on";
    case "poweredoff":
      return "off";
    case "standby":
      return "standby";
    default:
      return "unknown";
  }
}

// VirtualMachinePowerState -> the receiver's power_state.
export function vmPowerStateOf(powerState: string | null): string {
  switch (powerState) {
    case "poweredOn":
      return "on";
    case "poweredOff":
      return "off";
    case "suspended":
      return "suspended";
    default:
      return "unknown";
  }
}

class ResourceMetricsBuilder {
  private readonly metrics: Map<string, MetricBuffer> = new Map();
  private readonly startTimeUnixNano: string;

  public constructor(startTimeUnixNano: string) {
    this.startTimeUnixNano = startTimeUnixNano;
  }

  public record(
    name: string,
    value: number | null | undefined,
    timeUnixNano: string,
    attributes: Array<[string, AttributeValue]> = [],
  ): void {
    const definition: VCenterMetricDefinition | undefined =
      VCENTER_METRICS[name];

    if (
      !definition ||
      value === null ||
      value === undefined ||
      !Number.isFinite(value)
    ) {
      return;
    }

    let buffer: MetricBuffer | undefined = this.metrics.get(name);

    if (!buffer) {
      buffer = { definition: definition, dataPoints: [] };
      this.metrics.set(name, buffer);
    }

    const dataPoint: JSONObject = {};

    if (attributes.length > 0) {
      dataPoint["attributes"] = attributes.map(
        ([key, attributeValue]: [string, AttributeValue]): JSONObject => {
          return {
            key: key,
            value:
              typeof attributeValue === "boolean"
                ? { boolValue: attributeValue }
                : { stringValue: attributeValue },
          };
        },
      );
    }

    dataPoint["startTimeUnixNano"] = this.startTimeUnixNano;
    dataPoint["timeUnixNano"] = timeUnixNano;

    if (definition.valueType === "int") {
      dataPoint["asInt"] = Math.trunc(value).toString();
    } else {
      dataPoint["asDouble"] = value;
    }

    buffer.dataPoints.push(dataPoint);
  }

  public get datapointCount(): number {
    let count: number = 0;

    for (const buffer of this.metrics.values()) {
      count += buffer.dataPoints.length;
    }

    return count;
  }

  // The OTLP resource, or null when nothing was recorded for it.
  public emit(
    resourceAttributes: Array<[string, string]>,
    scope: { name: string; version: string },
  ): JSONObject | null {
    if (this.metrics.size === 0) {
      return null;
    }

    const metrics: JSONArray = [];

    for (const name of Array.from(this.metrics.keys()).sort()) {
      const buffer: MetricBuffer = this.metrics.get(name)!;
      const metric: JSONObject = {
        name: name,
        description: buffer.definition.description,
        unit: buffer.definition.unit,
      };

      if (buffer.definition.kind === "sum") {
        metric["sum"] = {
          dataPoints: buffer.dataPoints,
          // CUMULATIVE, not monotonic: the receiver's every sum.
          aggregationTemporality: 2,
        };
      } else {
        metric["gauge"] = { dataPoints: buffer.dataPoints };
      }

      metrics.push(metric);
    }

    return {
      resource: {
        attributes: resourceAttributes.map(
          ([key, value]: [string, string]): JSONObject => {
            return { key: key, value: { stringValue: value } };
          },
        ),
      },
      scopeMetrics: [
        {
          scope: { name: scope.name, version: scope.version },
          metrics: metrics,
        },
      ],
    };
  }
}

interface DatacenterStats {
  clusterStatusCounts: Map<string, number>;
  // power state (vSphere's) -> status -> count
  hostStats: Map<string, Map<string, number>>;
  vmStats: Map<string, Map<string, number>>;
  datastoreCount: number;
  diskCapacity: number;
  diskFree: number;
  cpuLimit: number;
  memoryLimit: number;
}

interface VmGroupInfo {
  poweredOn: number;
  poweredOff: number;
  suspended: number;
  templates: number;
}

function increment(
  map: Map<string, Map<string, number>>,
  outer: string,
  inner: string,
): void {
  let innerMap: Map<string, number> | undefined = map.get(outer);

  if (!innerMap) {
    innerMap = new Map();
    map.set(outer, innerMap);
  }

  innerMap.set(inner, (innerMap.get(inner) || 0) + 1);
}

export default class VMwareOtlpBuilder {
  private readonly snapshot: VMwareInventorySnapshot;
  private readonly scope: { name: string; version: string };
  private readonly startTimeUnixNano: string;
  private readonly resourceMetrics: JSONArray = [];
  private readonly warnings: Array<string> = [];
  private datapointCount: number = 0;

  private constructor(
    snapshot: VMwareInventorySnapshot,
    scopeVersion: string,
  ) {
    this.snapshot = snapshot;
    this.scope = { name: VMWARE_PROBE_SCOPE_NAME, version: scopeVersion };
    this.startTimeUnixNano = toUnixNano(snapshot.collectedAt);
  }

  public static build(
    snapshot: VMwareInventorySnapshot,
    scopeVersion: string,
  ): VMwareOtlpBuildResult {
    return new VMwareOtlpBuilder(snapshot, scopeVersion).buildAll();
  }

  private buildAll(): VMwareOtlpBuildResult {
    let clusterCount: number = 0;
    let hostCount: number = 0;
    let vmCount: number = 0;
    let poweredOnVmCount: number = 0;
    let templateCount: number = 0;
    let datastoreCount: number = 0;
    let resourcePoolCount: number = 0;

    for (const datacenter of this.snapshot.datacenters) {
      this.processDatacenter(datacenter);

      datastoreCount += datacenter.datastores.length;
      hostCount += datacenter.hosts.size;

      for (const compute of datacenter.computes.values()) {
        if (compute.isCluster) {
          clusterCount++;
        }
      }

      for (const pool of datacenter.resourcePools.values()) {
        if (!pool.isVirtualApp) {
          resourcePoolCount++;
        }
      }

      for (const vm of datacenter.vms.values()) {
        if (vm.isTemplate) {
          templateCount++;
          continue;
        }

        vmCount++;

        if (vm.powerState === "poweredOn") {
          poweredOnVmCount++;
        }
      }
    }

    return {
      resourceMetrics: this.resourceMetrics,
      resourceCount: this.resourceMetrics.length,
      datapointCount: this.datapointCount,
      datacenterCount: this.snapshot.datacenters.length,
      clusterCount: clusterCount,
      hostCount: hostCount,
      vmCount: vmCount,
      poweredOnVmCount: poweredOnVmCount,
      templateCount: templateCount,
      datastoreCount: datastoreCount,
      resourcePoolCount: resourcePoolCount,
      warnings: this.warnings,
    };
  }

  private warn(message: string): void {
    if (this.warnings.length < 50 && !this.warnings.includes(message)) {
      this.warnings.push(message);
    }
  }

  private emit(
    builder: ResourceMetricsBuilder,
    attributes: Array<[string, string]>,
  ): void {
    const resource: JSONObject | null = builder.emit(attributes, this.scope);

    if (resource) {
      this.datapointCount += builder.datapointCount;
      this.resourceMetrics.push(resource);
    }
  }

  private newBuilder(): ResourceMetricsBuilder {
    return new ResourceMetricsBuilder(this.startTimeUnixNano);
  }

  // processors.go processDatacenterData, in its order.
  private processDatacenter(datacenter: VMwareDatacenter): void {
    const now: string = toUnixNano(this.snapshot.collectedAt);

    const stats: DatacenterStats = {
      clusterStatusCounts: new Map(),
      hostStats: new Map(),
      vmStats: new Map(),
      datastoreCount: 0,
      diskCapacity: 0,
      diskFree: 0,
      cpuLimit: 0,
      memoryLimit: 0,
    };

    // Datastores.
    for (const datastore of datacenter.datastores) {
      const builder: ResourceMetricsBuilder = this.newBuilder();

      if (datastore.capacity !== null && datastore.freeSpace !== null) {
        const used: number = datastore.capacity - datastore.freeSpace;

        builder.record("vcenter.datastore.disk.usage", used, now, [
          ["disk_state", "used"],
        ]);
        builder.record(
          "vcenter.datastore.disk.usage",
          datastore.freeSpace,
          now,
          [["disk_state", "available"]],
        );

        if (datastore.capacity > 0) {
          builder.record(
            "vcenter.datastore.disk.utilization",
            (used / datastore.capacity) * 100,
            now,
          );
        }
      }

      this.emit(builder, [
        ["vcenter.datacenter.name", datacenter.name],
        ["vcenter.datastore.name", datastore.name],
      ]);

      stats.datastoreCount++;
      stats.diskCapacity += datastore.capacity || 0;
      stats.diskFree += datastore.freeSpace || 0;
    }

    // Resource pools (vApps are not resource pools here).
    for (const pool of datacenter.resourcePools.values()) {
      if (pool.isVirtualApp) {
        continue;
      }

      this.buildResourcePool(datacenter, pool, now);
    }

    // Hosts.
    const vmRefToComputeRef: Map<string, string> = new Map();

    for (const host of datacenter.hosts.values()) {
      increment(
        stats.hostStats,
        host.powerState || "unknown",
        entityStatusOf(host.overallStatus),
      );
      stats.cpuLimit += (host.cpuMhz || 0) * (host.numCpuCores || 0);
      stats.memoryLimit += host.memorySize || 0;

      const compute: VMwareComputeResource | undefined = host.parentRef
        ? datacenter.computes.get(host.parentRef)
        : undefined;

      if (!compute) {
        this.warn(
          `Host ${host.name} has no compute resource the probe could read, so its metrics are left out.`,
        );
        continue;
      }

      for (const vmRef of host.vmRefs) {
        vmRefToComputeRef.set(vmRef, compute.ref.value);
      }

      this.buildHost(datacenter, compute, host, now);
    }

    // Virtual machines.
    const vmGroups: Map<string, VmGroupInfo> = new Map();

    for (const vm of datacenter.vms.values()) {
      const computeRef: string | undefined = vmRefToComputeRef.get(vm.ref.value);

      if (!computeRef) {
        this.warn(
          `Virtual machine ${vm.name} is on no host the probe could read, so it is left out.`,
        );
        continue;
      }

      let group: VmGroupInfo | undefined = vmGroups.get(computeRef);

      if (!group) {
        group = { poweredOn: 0, poweredOff: 0, suspended: 0, templates: 0 };
        vmGroups.set(computeRef, group);
      }

      if (vm.isTemplate) {
        group.templates++;
      } else if (vm.powerState === "poweredOff") {
        group.poweredOff++;
        increment(stats.vmStats, "poweredOff", entityStatusOf(vm.overallStatus));
      } else if (vm.powerState === "poweredOn") {
        group.poweredOn++;
        increment(stats.vmStats, "poweredOn", entityStatusOf(vm.overallStatus));
      } else {
        group.suspended++;
        increment(stats.vmStats, "suspended", entityStatusOf(vm.overallStatus));
      }

      const compute: VMwareComputeResource | undefined =
        datacenter.computes.get(computeRef);

      if (compute) {
        this.buildVirtualMachine(datacenter, compute, vm, now);
      }
    }

    // Clusters.
    for (const compute of datacenter.computes.values()) {
      if (!compute.isCluster) {
        continue;
      }

      const status: string = entityStatusOf(compute.overallStatus);
      stats.clusterStatusCounts.set(
        status,
        (stats.clusterStatusCounts.get(status) || 0) + 1,
      );

      this.buildCluster(datacenter, compute, vmGroups.get(compute.ref.value), now);
    }

    this.buildDatacenter(datacenter, stats, now);
  }

  private buildResourcePool(
    datacenter: VMwareDatacenter,
    pool: VMwareResourcePool,
    now: string,
  ): void {
    const compute: VMwareComputeResource | undefined = pool.ownerRef
      ? datacenter.computes.get(pool.ownerRef)
      : undefined;

    if (!compute) {
      this.warn(
        `Resource pool ${pool.name} has no compute resource the probe could read, so it is left out.`,
      );
      return;
    }

    const attributes: Array<[string, string]> = [
      ["vcenter.datacenter.name", datacenter.name],
    ];

    if (compute.isCluster) {
      attributes.push(["vcenter.cluster.name", compute.name]);
    } else {
      const firstHostRef: string | undefined = compute.hostRefs[0];
      const host: VMwareHost | undefined = firstHostRef
        ? datacenter.hosts.get(firstHostRef)
        : undefined;

      if (!host) {
        this.warn(
          `Resource pool ${pool.name} has no host the probe could read, so it is left out.`,
        );
        return;
      }

      attributes.push(["vcenter.host.name", host.name]);
    }

    if (!pool.inventoryPath) {
      this.warn(
        `Resource pool ${pool.name} has no inventory path the probe could work out, so it is left out.`,
      );
      return;
    }

    attributes.push(["vcenter.resource_pool.name", pool.name]);
    attributes.push(["vcenter.resource_pool.inventory_path", pool.inventoryPath]);

    const builder: ResourceMetricsBuilder = this.newBuilder();
    const quickStats: VMwareResourcePool["quickStats"] = pool.quickStats;

    if (quickStats) {
      builder.record(
        "vcenter.resource_pool.cpu.usage",
        quickStats.overallCpuUsage ?? 0,
        now,
      );
      builder.record(
        "vcenter.resource_pool.memory.usage",
        quickStats.guestMemoryUsage ?? 0,
        now,
        [["type", "guest"]],
      );
      builder.record(
        "vcenter.resource_pool.memory.usage",
        quickStats.hostMemoryUsage ?? 0,
        now,
        [["type", "host"]],
      );
      builder.record(
        "vcenter.resource_pool.memory.usage",
        quickStats.overheadMemory ?? 0,
        now,
        [["type", "overhead"]],
      );
      builder.record(
        "vcenter.resource_pool.memory.swapped",
        quickStats.swappedMemory ?? 0,
        now,
      );
      builder.record(
        "vcenter.resource_pool.memory.ballooned",
        quickStats.balloonedMemory ?? 0,
        now,
      );
      builder.record(
        "vcenter.resource_pool.memory.granted",
        quickStats.privateMemory ?? 0,
        now,
        [["type", "private"]],
      );
      builder.record(
        "vcenter.resource_pool.memory.granted",
        quickStats.sharedMemory ?? 0,
        now,
        [["type", "shared"]],
      );
    }

    builder.record("vcenter.resource_pool.cpu.shares", pool.cpuShares, now);
    builder.record("vcenter.resource_pool.memory.shares", pool.memoryShares, now);

    this.emit(builder, attributes);
  }

  private buildHost(
    datacenter: VMwareDatacenter,
    compute: VMwareComputeResource,
    host: VMwareHost,
    now: string,
  ): void {
    const attributes: Array<[string, string]> = [
      ["vcenter.datacenter.name", datacenter.name],
    ];

    if (compute.isCluster) {
      attributes.push(["vcenter.cluster.name", compute.name]);
    }

    attributes.push(["vcenter.host.name", host.name]);

    const builder: ResourceMetricsBuilder = this.newBuilder();

    const memoryUsage: number | null = host.overallMemoryUsage;
    const memoryCapacityMiB: number | null =
      host.memorySize === null ? null : Math.floor(host.memorySize / 1048576);
    const cpuUsage: number | null = host.overallCpuUsage;
    const cpuCapacity: number | null =
      host.numCpuCores === null || host.cpuMhz === null
        ? null
        : host.numCpuCores * host.cpuMhz;

    builder.record("vcenter.host.memory.usage", memoryUsage, now);

    if (memoryUsage !== null && memoryCapacityMiB) {
      builder.record(
        "vcenter.host.memory.utilization",
        (100 * memoryUsage) / memoryCapacityMiB,
        now,
      );
    }

    builder.record("vcenter.host.cpu.usage", cpuUsage, now);
    builder.record("vcenter.host.cpu.capacity", cpuCapacity, now);
    builder.record("vcenter.host.memory.capacity", memoryCapacityMiB, now);

    if (cpuUsage !== null && cpuCapacity) {
      builder.record(
        "vcenter.host.cpu.utilization",
        (100 * cpuUsage) / cpuCapacity,
        now,
      );
    }

    const perf: PerfEntityMetric | undefined = datacenter.hostPerf.get(
      host.ref.value,
    );

    if (perf) {
      this.recordPerf(builder, perf, "host");
    }

    if (host.vsanNodeUuid) {
      const vsan: Array<VMwareVsanMetric> | undefined =
        datacenter.vsan.hostsByUuid.get(host.vsanNodeUuid);

      if (vsan) {
        this.recordVsan(builder, vsan, "host");
      }
    }

    this.emit(builder, attributes);
  }

  private buildVirtualMachine(
    datacenter: VMwareDatacenter,
    compute: VMwareComputeResource,
    vm: VMwareVirtualMachine,
    now: string,
  ): void {
    // Powered-off, suspended and template VMs can come without data.
    if (!vm.hasConfig || !vm.hasStorage) {
      return;
    }

    const host: VMwareHost | undefined = vm.hostRef
      ? datacenter.hosts.get(vm.hostRef)
      : undefined;

    if (!host) {
      this.warn(
        `Virtual machine ${vm.name} names no host the probe could read, so its metrics are left out.`,
      );
      return;
    }

    const attributes: Array<[string, string]> = [
      ["vcenter.datacenter.name", datacenter.name],
    ];

    if (compute.isCluster) {
      attributes.push(["vcenter.cluster.name", compute.name]);
    }

    attributes.push(["vcenter.host.name", host.name]);

    if (vm.isTemplate) {
      attributes.push(["vcenter.vm_template.name", vm.name]);

      if (vm.instanceUuid) {
        attributes.push(["vcenter.vm_template.id", vm.instanceUuid]);
      }
    } else {
      attributes.push(["vcenter.vm.name", vm.name]);

      if (vm.instanceUuid) {
        attributes.push(["vcenter.vm.id", vm.instanceUuid]);
      }

      const pool: VMwareResourcePool | undefined = vm.resourcePoolRef
        ? datacenter.resourcePools.get(vm.resourcePoolRef)
        : undefined;

      if (!pool || !pool.inventoryPath) {
        this.warn(
          `Virtual machine ${vm.name} has no resource pool the probe could read, so its metrics are left out.`,
        );
        return;
      }

      if (pool.isVirtualApp) {
        attributes.push(["vcenter.virtual_app.name", pool.name]);
        attributes.push(["vcenter.virtual_app.inventory_path", pool.inventoryPath]);
      } else {
        attributes.push(["vcenter.resource_pool.name", pool.name]);
        attributes.push([
          "vcenter.resource_pool.inventory_path",
          pool.inventoryPath,
        ]);
      }
    }

    const builder: ResourceMetricsBuilder = this.newBuilder();
    const used: number = vm.storageCommitted ?? 0;
    const free: number = vm.storageUncommitted ?? 0;

    builder.record("vcenter.vm.disk.usage", used, now, [["disk_state", "used"]]);
    builder.record("vcenter.vm.disk.usage", free, now, [
      ["disk_state", "available"],
    ]);

    if (!vm.isTemplate) {
      if (free !== 0) {
        builder.record(
          "vcenter.vm.disk.utilization",
          (used / (free + used)) * 100,
          now,
        );
      }

      const memoryUsage: number = vm.guestMemoryUsage ?? 0;

      if (vm.memorySizeMB && vm.memorySizeMB > 0 && memoryUsage > 0) {
        builder.record(
          "vcenter.vm.memory.utilization",
          (memoryUsage / vm.memorySizeMB) * 100,
          now,
        );
      }

      builder.record("vcenter.vm.memory.usage", memoryUsage, now);
      builder.record(
        "vcenter.vm.memory.ballooned",
        vm.balloonedMemory ?? 0,
        now,
      );
      builder.record("vcenter.vm.memory.swapped", vm.swappedMemory ?? 0, now);
      builder.record(
        "vcenter.vm.memory.swapped_ssd",
        vm.ssdSwappedMemory ?? 0,
        now,
      );

      /*
       * Only a powered-on VM reports CPU - and the snapshot scan reads "has
       * CPU datapoints" as "powered on", so a powered-on VM always gets them,
       * 0 MHz included, as the receiver does.
       */
      if (vm.powerState === "poweredOn") {
        const cpuUsage: number = vm.overallCpuUsage ?? 0;

        builder.record("vcenter.vm.cpu.usage", cpuUsage, now);
        builder.record(
          "vcenter.vm.cpu.readiness",
          vm.overallCpuReadiness ?? 0,
          now,
        );

        let cpuLimit: number = (vm.numCpu || 0) * (host.cpuMhz || 0);

        if (vm.maxCpuUsage) {
          cpuLimit = vm.maxCpuUsage;
        }

        if (cpuLimit > 0) {
          builder.record(
            "vcenter.vm.cpu.utilization",
            (100 * cpuUsage) / cpuLimit,
            now,
          );
        }
      }

      const perf: PerfEntityMetric | undefined = datacenter.vmPerf.get(
        vm.ref.value,
      );

      if (perf) {
        this.recordPerf(builder, perf, "vm");
      }

      if (vm.instanceUuid) {
        const vsan: Array<VMwareVsanMetric> | undefined =
          datacenter.vsan.vmsByUuid.get(vm.instanceUuid);

        if (vsan) {
          this.recordVsan(builder, vsan, "vm");
        }
      }
    }

    this.emit(builder, attributes);
  }

  private buildCluster(
    datacenter: VMwareDatacenter,
    compute: VMwareComputeResource,
    group: VmGroupInfo | undefined,
    now: string,
  ): void {
    const builder: ResourceMetricsBuilder = this.newBuilder();

    if (group) {
      builder.record("vcenter.cluster.vm.count", group.poweredOn, now, [
        ["power_state", "on"],
      ]);
      builder.record("vcenter.cluster.vm.count", group.poweredOff, now, [
        ["power_state", "off"],
      ]);
      builder.record("vcenter.cluster.vm.count", group.suspended, now, [
        ["power_state", "suspended"],
      ]);
      builder.record("vcenter.cluster.vm_template.count", group.templates, now);
    }

    builder.record("vcenter.cluster.cpu.limit", compute.totalCpu, now);
    builder.record("vcenter.cluster.cpu.effective", compute.effectiveCpu, now);
    builder.record(
      "vcenter.cluster.memory.effective",
      compute.effectiveMemory === null
        ? null
        : compute.effectiveMemory * 1048576,
      now,
    );
    builder.record("vcenter.cluster.memory.limit", compute.totalMemory, now);

    if (compute.numHosts !== null && compute.numEffectiveHosts !== null) {
      builder.record(
        "vcenter.cluster.host.count",
        compute.numHosts - compute.numEffectiveHosts,
        now,
        [["effective", false]],
      );
      builder.record(
        "vcenter.cluster.host.count",
        compute.numEffectiveHosts,
        now,
        [["effective", true]],
      );
    }

    if (compute.vsanEnabled && compute.vsanUuid) {
      const vsan: Array<VMwareVsanMetric> | undefined =
        datacenter.vsan.clustersByUuid.get(compute.vsanUuid);

      if (vsan) {
        this.recordVsan(builder, vsan, "cluster");
      }
    }

    this.emit(builder, [
      ["vcenter.datacenter.name", datacenter.name],
      ["vcenter.cluster.name", compute.name],
    ]);
  }

  private buildDatacenter(
    datacenter: VMwareDatacenter,
    stats: DatacenterStats,
    now: string,
  ): void {
    const builder: ResourceMetricsBuilder = this.newBuilder();

    for (const status of ENTITY_STATUSES) {
      builder.record(
        "vcenter.datacenter.cluster.count",
        stats.clusterStatusCounts.get(status) || 0,
        now,
        [["status", status]],
      );
    }

    for (const [powerState, statuses] of stats.vmStats) {
      for (const [status, count] of statuses) {
        builder.record("vcenter.datacenter.vm.count", count, now, [
          ["status", status],
          ["power_state", vmPowerStateOf(powerState)],
        ]);
      }
    }

    for (const [powerState, statuses] of stats.hostStats) {
      for (const [status, count] of statuses) {
        builder.record("vcenter.datacenter.host.count", count, now, [
          ["status", status],
          ["power_state", hostPowerStateOf(powerState)],
        ]);
      }
    }

    builder.record(
      "vcenter.datacenter.datastore.count",
      stats.datastoreCount,
      now,
    );
    builder.record(
      "vcenter.datacenter.disk.space",
      stats.diskCapacity - stats.diskFree,
      now,
      [["disk_state", "used"]],
    );
    builder.record("vcenter.datacenter.disk.space", stats.diskFree, now, [
      ["disk_state", "available"],
    ]);
    builder.record("vcenter.datacenter.cpu.limit", stats.cpuLimit, now);
    builder.record("vcenter.datacenter.memory.limit", stats.memoryLimit, now);

    this.emit(builder, [["vcenter.datacenter.name", datacenter.name]]);
  }

  /*
   * The receiver's recordHostPerformanceMetrics / recordVMPerformanceMetrics:
   * each sample at its own time, per instance (the "object" attribute -
   * a NIC, a disk, or "" for the whole host / VM).
   */
  private recordPerf(
    builder: ResourceMetricsBuilder,
    perf: PerfEntityMetric,
    kind: "host" | "vm",
  ): void {
    for (const series of perf.series) {
      const name: string | undefined = this.snapshot.counterNames.get(
        series.counterId,
      );

      if (!name) {
        continue;
      }

      series.values.forEach((value: number, index: number) => {
        const sample: { timestamp: string } | undefined =
          perf.sampleInfo[index];
        const time: Date = sample ? new Date(sample.timestamp) : new Date(NaN);

        if (Number.isNaN(time.getTime()) || !Number.isFinite(value)) {
          return;
        }

        this.recordPerfValue({
          builder: builder,
          kind: kind,
          name: name,
          value: value,
          series: series,
          timeUnixNano: toUnixNano(time),
        });
      });
    }
  }

  private recordPerfValue(data: {
    builder: ResourceMetricsBuilder;
    kind: "host" | "vm";
    name: string;
    value: number;
    series: PerfSeries;
    timeUnixNano: string;
  }): void {
    const object: string = data.series.instance;
    const value: number = data.value;
    const time: string = data.timeUnixNano;
    const b: ResourceMetricsBuilder = data.builder;
    const prefix: string = data.kind === "host" ? "vcenter.host" : "vcenter.vm";

    switch (data.name) {
      case "disk.maxTotalLatency.latest":
        b.record(`${prefix}.disk.latency.max`, value, time, [["object", object]]);
        return;
      case "net.usage.average":
        b.record(`${prefix}.network.usage`, value, time, [["object", object]]);
        return;
      case "net.bytesTx.average":
        b.record(`${prefix}.network.throughput`, value, time, [
          ["direction", "transmitted"],
          ["object", object],
        ]);
        return;
      case "net.bytesRx.average":
        b.record(`${prefix}.network.throughput`, value, time, [
          ["direction", "received"],
          ["object", object],
        ]);
        return;
      case "net.packetsTx.summation":
        b.record(`${prefix}.network.packet.rate`, value / 20, time, [
          ["direction", "transmitted"],
          ["object", object],
        ]);
        return;
      case "net.packetsRx.summation":
        b.record(`${prefix}.network.packet.rate`, value / 20, time, [
          ["direction", "received"],
          ["object", object],
        ]);
        return;
      case "net.droppedTx.summation":
        b.record(`${prefix}.network.packet.drop.rate`, value / 20, time, [
          ["direction", "transmitted"],
          ["object", object],
        ]);
        return;
      case "net.droppedRx.summation":
        b.record(`${prefix}.network.packet.drop.rate`, value / 20, time, [
          ["direction", "received"],
          ["object", object],
        ]);
        return;
      default:
        break;
    }

    if (data.kind === "host") {
      switch (data.name) {
        case "net.errorsRx.summation":
          b.record("vcenter.host.network.packet.error.rate", value / 20, time, [
            ["direction", "received"],
            ["object", object],
          ]);
          return;
        case "net.errorsTx.summation":
          b.record("vcenter.host.network.packet.error.rate", value / 20, time, [
            ["direction", "transmitted"],
            ["object", object],
          ]);
          return;
        case "cpu.reservedCapacity.average":
          b.record("vcenter.host.cpu.reserved", value, time, [
            ["cpu_reservation_type", "used"],
          ]);
          return;
        case "cpu.totalCapacity.average":
          b.record("vcenter.host.cpu.reserved", value, time, [
            ["cpu_reservation_type", "total"],
          ]);
          return;
        case "disk.totalWriteLatency.average":
          b.record("vcenter.host.disk.latency.avg", value, time, [
            ["direction", "write"],
            ["object", object],
          ]);
          return;
        case "disk.totalReadLatency.average":
          b.record("vcenter.host.disk.latency.avg", value, time, [
            ["direction", "read"],
            ["object", object],
          ]);
          return;
        case "disk.read.average":
          b.record("vcenter.host.disk.throughput", value, time, [
            ["direction", "read"],
            ["object", object],
          ]);
          return;
        case "disk.write.average":
          b.record("vcenter.host.disk.throughput", value, time, [
            ["direction", "write"],
            ["object", object],
          ]);
          return;
        default:
          return;
      }
    }

    switch (data.name) {
      case "virtualDisk.totalReadLatency.average":
        b.record("vcenter.vm.disk.latency.avg", value, time, [
          ["direction", "read"],
          ["disk_type", "virtual"],
          ["object", object],
        ]);
        return;
      case "virtualDisk.totalWriteLatency.average":
        b.record("vcenter.vm.disk.latency.avg", value, time, [
          ["direction", "write"],
          ["disk_type", "virtual"],
          ["object", object],
        ]);
        return;
      case "virtualDisk.read.average":
        b.record("vcenter.vm.disk.throughput", value, time, [
          ["direction", "read"],
          ["object", object],
        ]);
        return;
      case "virtualDisk.write.average":
        b.record("vcenter.vm.disk.throughput", value, time, [
          ["direction", "write"],
          ["object", object],
        ]);
        return;
      default:
        return;
    }
  }

  // The receiver's recordClusterVSANMetrics / recordHostVSANMetrics / recordVMVSANMetrics.
  private recordVsan(
    builder: ResourceMetricsBuilder,
    metrics: Array<VMwareVsanMetric>,
    kind: "cluster" | "host" | "vm",
  ): void {
    const prefix: string = `vcenter.${kind}.vsan`;

    for (const metric of metrics) {
      metric.values.forEach((value: number, index: number) => {
        const timestamp: Date | undefined = metric.timestamps[index];

        if (!timestamp) {
          return;
        }

        const time: string = toUnixNano(timestamp);
        const interval: number = metric.intervalInSeconds || 300;

        switch (metric.label) {
          case "iopsRead":
            builder.record(`${prefix}.operations`, value, time, [["type", "read"]]);
            return;
          case "iopsWrite":
            builder.record(`${prefix}.operations`, value, time, [
              ["type", "write"],
            ]);
            return;
          case "throughputRead":
            builder.record(`${prefix}.throughput`, value / interval, time, [
              ["direction", "read"],
            ]);
            return;
          case "throughputWrite":
            builder.record(`${prefix}.throughput`, value / interval, time, [
              ["direction", "write"],
            ]);
            return;
          case "latencyAvgRead":
          case "latencyRead":
            if (
              (kind === "vm") ===
              (metric.label === "latencyRead")
            ) {
              builder.record(`${prefix}.latency.avg`, value, time, [
                ["type", "read"],
              ]);
            }
            return;
          case "latencyAvgWrite":
          case "latencyWrite":
            if (
              (kind === "vm") ===
              (metric.label === "latencyWrite")
            ) {
              builder.record(`${prefix}.latency.avg`, value, time, [
                ["type", "write"],
              ]);
            }
            return;
          case "congestion":
            if (kind !== "vm") {
              builder.record(`${prefix}.congestions`, value / interval, time);
            }
            return;
          case "clientCacheHitRate":
            if (kind === "host") {
              builder.record("vcenter.host.vsan.cache.hit_rate", value, time);
            }
            return;
          default:
            return;
        }
      });
    }
  }
}
