import { describe, expect, test } from "@jest/globals";
import { JSONObject } from "Common/Types/JSON";
import VMwareOtlpBuilder, {
  VMWARE_PROBE_SCOPE_NAME,
  VMwareOtlpBuildResult,
  hostPowerStateOf,
  toUnixNano,
  vmPowerStateOf,
} from "../../../Utils/VMware/VMwareOtlpBuilder";
import { VCENTER_METRICS } from "../../../Utils/VMware/VCenterMetricDefinitions";
import {
  VMwareComputeResource,
  VMwareDatacenter,
  VMwareHost,
  VMwareInventorySnapshot,
  VMwareResourcePool,
  VMwareVirtualMachine,
  emptyVsanResults,
} from "../../../Utils/VMware/VMwareInventory";

/*
 * The builder's arithmetic, against the receiver's (processors.go,
 * metrics.go, resources.go of opentelemetry-collector-contrib 0.161.0), on a
 * hand-built inventory whose every number is known.
 */

const NOW: Date = new Date("2026-10-10T12:00:00.000Z");
const NOW_NANO: string = toUnixNano(NOW);

function cluster(
  data: Partial<VMwareComputeResource> = {},
): VMwareComputeResource {
  return {
    ref: { type: "ClusterComputeResource", value: "domain-c1" },
    name: "Prod",
    isCluster: true,
    hostRefs: ["host-1"],
    totalCpu: 9600,
    totalMemory: 68719476736,
    effectiveCpu: 9000,
    effectiveMemory: 60000,
    numHosts: 3,
    numEffectiveHosts: 2,
    overallStatus: "green",
    vsanEnabled: false,
    vsanUuid: null,
    ...data,
  };
}

function host(data: Partial<VMwareHost> = {}): VMwareHost {
  return {
    ref: { type: "HostSystem", value: "host-1" },
    name: "esx-01.example.com",
    powerState: "poweredOn",
    memorySize: 68719476736, // 65536 MiB
    numCpuCores: 4,
    cpuMhz: 2400,
    vsanNodeUuid: null,
    overallMemoryUsage: 16384,
    overallCpuUsage: 2400,
    overallStatus: "green",
    vmRefs: ["vm-1"],
    parentRef: "domain-c1",
    ...data,
  };
}

function pool(data: Partial<VMwareResourcePool> = {}): VMwareResourcePool {
  return {
    ref: { type: "ResourcePool", value: "resgroup-1" },
    isVirtualApp: false,
    name: "Resources",
    ownerRef: "domain-c1",
    inventoryPath: "/DC1/host/Prod/Resources",
    cpuShares: 4000,
    memoryShares: 163840,
    quickStats: null,
    ...data,
  };
}

function vm(data: Partial<VMwareVirtualMachine> = {}): VMwareVirtualMachine {
  return {
    ref: { type: "VirtualMachine", value: "vm-1" },
    name: "web-01",
    hasConfig: true,
    numCpu: 2,
    instanceUuid: "50a1-instance",
    isTemplate: false,
    powerState: "poweredOn",
    maxCpuUsage: 0,
    guestMemoryUsage: 1024,
    balloonedMemory: 0,
    swappedMemory: 0,
    ssdSwappedMemory: 0,
    grantedMemory: null,
    overallCpuUsage: 1200,
    overallCpuReadiness: 3,
    overallStatus: "green",
    memorySizeMB: 4096,
    hasStorage: true,
    storageCommitted: 30,
    storageUncommitted: 70,
    hostRef: "host-1",
    resourcePoolRef: "resgroup-1",
    ...data,
  };
}

function snapshotOf(
  data: Partial<VMwareDatacenter> = {},
  counterNames: Map<number, string> = new Map(),
): VMwareInventorySnapshot {
  const datacenter: VMwareDatacenter = {
    ref: { type: "Datacenter", value: "datacenter-1" },
    name: "DC1",
    datastores: [
      {
        ref: { type: "Datastore", value: "datastore-1" },
        name: "ssd-01",
        capacity: 1000,
        freeSpace: 250,
      },
    ],
    computes: new Map([["domain-c1", cluster()]]),
    hosts: new Map([["host-1", host()]]),
    resourcePools: new Map([["resgroup-1", pool()]]),
    vms: new Map([["vm-1", vm()]]),
    hostPerf: new Map(),
    vmPerf: new Map(),
    vsan: emptyVsanResults(),
    ...data,
  };

  return {
    about: {
      name: "VMware vCenter Server",
      fullName: null,
      version: "8.0.2",
      build: null,
      apiType: "VirtualCenter",
      apiVersion: null,
      instanceUuid: null,
    },
    datacenters: [datacenter],
    counterNames: counterNames,
    collectedAt: NOW,
    warnings: [],
  };
}

interface Point {
  attributes: Record<string, string | boolean>;
  value: number;
  time: string;
}

// The datapoints of one metric on the resource whose attributes match.
function points(
  result: VMwareOtlpBuildResult,
  resourceMatch: Record<string, string>,
  metricName: string,
): Array<Point> {
  for (const resource of result.resourceMetrics as Array<JSONObject>) {
    const attributes: Record<string, string> = {};

    for (const attribute of (resource["resource"] as JSONObject)[
      "attributes"
    ] as Array<JSONObject>) {
      attributes[attribute["key"] as string] = (
        attribute["value"] as JSONObject
      )["stringValue"] as string;
    }

    const matches: boolean = Object.entries(resourceMatch).every(
      ([key, value]: [string, string]) => {
        return attributes[key] === value;
      },
    );

    if (!matches) {
      continue;
    }

    for (const scope of resource["scopeMetrics"] as Array<JSONObject>) {
      for (const metric of scope["metrics"] as Array<JSONObject>) {
        if (metric["name"] !== metricName) {
          continue;
        }

        const body: JSONObject = (metric["sum"] ||
          metric["gauge"]) as JSONObject;

        return (body["dataPoints"] as Array<JSONObject>).map(
          (dataPoint: JSONObject): Point => {
            const pointAttributes: Record<string, string | boolean> = {};

            for (const attribute of (dataPoint["attributes"] ||
              []) as Array<JSONObject>) {
              const value: JSONObject = attribute["value"] as JSONObject;
              pointAttributes[attribute["key"] as string] =
                value["boolValue"] !== undefined
                  ? (value["boolValue"] as boolean)
                  : (value["stringValue"] as string);
            }

            return {
              attributes: pointAttributes,
              value:
                dataPoint["asInt"] !== undefined
                  ? Number(dataPoint["asInt"])
                  : (dataPoint["asDouble"] as number),
              time: dataPoint["timeUnixNano"] as string,
            };
          },
        );
      }
    }
  }

  return [];
}

function resourceKeys(result: VMwareOtlpBuildResult): Array<string> {
  return (result.resourceMetrics as Array<JSONObject>).map(
    (resource: JSONObject): string => {
      return (
        (resource["resource"] as JSONObject)["attributes"] as Array<JSONObject>
      )
        .map((attribute: JSONObject) => {
          return attribute["key"] as string;
        })
        .join(",");
    },
  );
}

describe("VMwareOtlpBuilder", () => {
  test("emits one resource per object, in the receiver's order and attribute order", () => {
    const result: VMwareOtlpBuildResult = VMwareOtlpBuilder.build(
      snapshotOf(),
      "14.0.32",
    );

    expect(resourceKeys(result)).toEqual([
      "vcenter.datacenter.name,vcenter.datastore.name",
      "vcenter.datacenter.name,vcenter.cluster.name,vcenter.resource_pool.name,vcenter.resource_pool.inventory_path",
      "vcenter.datacenter.name,vcenter.cluster.name,vcenter.host.name",
      "vcenter.datacenter.name,vcenter.cluster.name,vcenter.host.name,vcenter.vm.name,vcenter.vm.id,vcenter.resource_pool.name,vcenter.resource_pool.inventory_path",
      "vcenter.datacenter.name,vcenter.cluster.name",
      "vcenter.datacenter.name",
    ]);
    expect(result.resourceCount).toBe(6);

    const scope: JSONObject = (
      (result.resourceMetrics[0] as JSONObject)[
        "scopeMetrics"
      ] as Array<JSONObject>
    )[0]!["scope"] as JSONObject;
    expect(scope).toEqual({
      name: VMWARE_PROBE_SCOPE_NAME,
      version: "14.0.32",
    });
  });

  test("every metric carries the receiver's own description, unit and kind", () => {
    const result: VMwareOtlpBuildResult = VMwareOtlpBuilder.build(
      snapshotOf(),
      "x",
    );

    for (const resource of result.resourceMetrics as Array<JSONObject>) {
      for (const scope of resource["scopeMetrics"] as Array<JSONObject>) {
        for (const metric of scope["metrics"] as Array<JSONObject>) {
          const definition: (typeof VCENTER_METRICS)[string] | undefined =
            VCENTER_METRICS[metric["name"] as string];
          expect(definition).toBeDefined();
          expect(metric["description"]).toBe(definition!.description);
          expect(metric["unit"]).toBe(definition!.unit);

          if (definition!.kind === "sum") {
            expect(
              (metric["sum"] as JSONObject)["aggregationTemporality"],
            ).toBe(2);
            expect(metric["gauge"]).toBeUndefined();
          } else {
            expect(metric["gauge"]).toBeDefined();
          }

          const body: JSONObject = (metric["sum"] ||
            metric["gauge"]) as JSONObject;

          for (const dataPoint of body["dataPoints"] as Array<JSONObject>) {
            if (definition!.valueType === "int") {
              expect(typeof dataPoint["asInt"]).toBe("string");
            } else {
              expect(typeof dataPoint["asDouble"]).toBe("number");
            }
            expect(dataPoint["startTimeUnixNano"]).toBe(NOW_NANO);
          }
        }
      }
    }
  });

  test("datastore: used and available bytes, and used percent", () => {
    const result: VMwareOtlpBuildResult = VMwareOtlpBuilder.build(
      snapshotOf(),
      "x",
    );
    const store: Record<string, string> = {
      "vcenter.datastore.name": "ssd-01",
    };

    expect(points(result, store, "vcenter.datastore.disk.usage")).toEqual([
      { attributes: { disk_state: "used" }, value: 750, time: NOW_NANO },
      { attributes: { disk_state: "available" }, value: 250, time: NOW_NANO },
    ]);
    expect(points(result, store, "vcenter.datastore.disk.utilization")).toEqual(
      [{ attributes: {}, value: 75, time: NOW_NANO }],
    );
  });

  test("a datastore vSphere reported no capacity for gets no made-up numbers", () => {
    const result: VMwareOtlpBuildResult = VMwareOtlpBuilder.build(
      snapshotOf({
        datastores: [
          {
            ref: { type: "Datastore", value: "datastore-9" },
            name: "lost",
            capacity: null,
            freeSpace: null,
          },
        ],
      }),
      "x",
    );

    expect(
      points(
        result,
        { "vcenter.datastore.name": "lost" },
        "vcenter.datastore.disk.usage",
      ),
    ).toEqual([]);
    // Still counted.
    expect(
      points(
        result,
        { "vcenter.datacenter.name": "DC1" },
        "vcenter.datacenter.datastore.count",
      )[0]!.value,
    ).toBe(1);
  });

  test("host: usage, capacity and utilization, as the receiver works them out", () => {
    const result: VMwareOtlpBuildResult = VMwareOtlpBuilder.build(
      snapshotOf(),
      "x",
    );
    const esx: Record<string, string> = {
      "vcenter.host.name": "esx-01.example.com",
    };

    expect(points(result, esx, "vcenter.host.memory.usage")[0]!.value).toBe(
      16384,
    );
    expect(points(result, esx, "vcenter.host.memory.capacity")[0]!.value).toBe(
      65536,
    );
    expect(
      points(result, esx, "vcenter.host.memory.utilization")[0]!.value,
    ).toBe(25);
    expect(points(result, esx, "vcenter.host.cpu.usage")[0]!.value).toBe(2400);
    expect(points(result, esx, "vcenter.host.cpu.capacity")[0]!.value).toBe(
      9600,
    );
    expect(points(result, esx, "vcenter.host.cpu.utilization")[0]!.value).toBe(
      25,
    );
  });

  test("a host with no hardware numbers gets no utilization (no division by zero)", () => {
    const result: VMwareOtlpBuildResult = VMwareOtlpBuilder.build(
      snapshotOf({
        hosts: new Map([
          ["host-1", host({ memorySize: 0, numCpuCores: null, cpuMhz: null })],
        ]),
      }),
      "x",
    );
    const esx: Record<string, string> = {
      "vcenter.host.name": "esx-01.example.com",
    };

    expect(points(result, esx, "vcenter.host.memory.utilization")).toEqual([]);
    expect(points(result, esx, "vcenter.host.cpu.utilization")).toEqual([]);
    expect(points(result, esx, "vcenter.host.cpu.capacity")).toEqual([]);
  });

  test("VM: memory, disk and CPU - CPU only while powered on, against the host's MHz", () => {
    const result: VMwareOtlpBuildResult = VMwareOtlpBuilder.build(
      snapshotOf(),
      "x",
    );
    const web: Record<string, string> = { "vcenter.vm.name": "web-01" };

    expect(points(result, web, "vcenter.vm.disk.usage")).toEqual([
      { attributes: { disk_state: "used" }, value: 30, time: NOW_NANO },
      { attributes: { disk_state: "available" }, value: 70, time: NOW_NANO },
    ]);
    expect(points(result, web, "vcenter.vm.disk.utilization")[0]!.value).toBe(
      30,
    );
    expect(points(result, web, "vcenter.vm.memory.usage")[0]!.value).toBe(1024);
    expect(points(result, web, "vcenter.vm.memory.utilization")[0]!.value).toBe(
      25,
    );
    expect(points(result, web, "vcenter.vm.cpu.usage")[0]!.value).toBe(1200);
    expect(points(result, web, "vcenter.vm.cpu.readiness")[0]!.value).toBe(3);
    // 2 vCPUs x 2400 MHz = 4800 MHz: 1200 of it is 25 %.
    expect(points(result, web, "vcenter.vm.cpu.utilization")[0]!.value).toBe(
      25,
    );
  });

  test("a VM's CPU limit replaces its vCPUs x host MHz", () => {
    const result: VMwareOtlpBuildResult = VMwareOtlpBuilder.build(
      snapshotOf({ vms: new Map([["vm-1", vm({ maxCpuUsage: 2400 })]]) }),
      "x",
    );

    expect(
      points(
        result,
        { "vcenter.vm.name": "web-01" },
        "vcenter.vm.cpu.utilization",
      )[0]!.value,
    ).toBe(50);
  });

  test("an idle powered-on VM still reports CPU (0 MHz) - that is what says it is on", () => {
    const result: VMwareOtlpBuildResult = VMwareOtlpBuilder.build(
      snapshotOf({
        vms: new Map([
          ["vm-1", vm({ overallCpuUsage: null, overallCpuReadiness: null })],
        ]),
      }),
      "x",
    );
    const web: Record<string, string> = { "vcenter.vm.name": "web-01" };

    expect(points(result, web, "vcenter.vm.cpu.usage")[0]!.value).toBe(0);
    expect(points(result, web, "vcenter.vm.cpu.readiness")[0]!.value).toBe(0);
  });

  test("a powered-off VM reports memory and disk, and no CPU at all", () => {
    const result: VMwareOtlpBuildResult = VMwareOtlpBuilder.build(
      snapshotOf({
        vms: new Map([["vm-1", vm({ powerState: "poweredOff" })]]),
      }),
      "x",
    );
    const web: Record<string, string> = { "vcenter.vm.name": "web-01" };

    expect(points(result, web, "vcenter.vm.memory.usage")).toHaveLength(1);
    expect(points(result, web, "vcenter.vm.cpu.usage")).toEqual([]);
    expect(points(result, web, "vcenter.vm.cpu.utilization")).toEqual([]);
    expect(points(result, web, "vcenter.vm.cpu.readiness")).toEqual([]);
  });

  test("a template is named as a template and reports disk usage only", () => {
    const result: VMwareOtlpBuildResult = VMwareOtlpBuilder.build(
      snapshotOf({
        vms: new Map([
          [
            "vm-1",
            vm({
              isTemplate: true,
              powerState: "poweredOff",
              name: "ubuntu-tpl",
            }),
          ],
        ]),
      }),
      "x",
    );

    expect(resourceKeys(result)).toContain(
      "vcenter.datacenter.name,vcenter.cluster.name,vcenter.host.name,vcenter.vm_template.name,vcenter.vm_template.id",
    );
    const template: Record<string, string> = {
      "vcenter.vm_template.name": "ubuntu-tpl",
    };
    expect(points(result, template, "vcenter.vm.disk.usage")).toHaveLength(2);
    expect(points(result, template, "vcenter.vm.memory.usage")).toEqual([]);
    expect(result.templateCount).toBe(1);
    expect(result.vmCount).toBe(0);
  });

  test("a VM in a vApp names the vApp, and its inventory path, instead of a pool", () => {
    const result: VMwareOtlpBuildResult = VMwareOtlpBuilder.build(
      snapshotOf({
        resourcePools: new Map([
          ["resgroup-1", pool()],
          [
            "resgroup-v1",
            pool({
              ref: { type: "VirtualApp", value: "resgroup-v1" },
              isVirtualApp: true,
              name: "shop",
              inventoryPath: "/DC1/vm/shop",
            }),
          ],
        ]),
        vms: new Map([["vm-1", vm({ resourcePoolRef: "resgroup-v1" })]]),
      }),
      "x",
    );

    expect(resourceKeys(result)).toContain(
      "vcenter.datacenter.name,vcenter.cluster.name,vcenter.host.name,vcenter.vm.name,vcenter.vm.id,vcenter.virtual_app.name,vcenter.virtual_app.inventory_path",
    );
    // A vApp is not a resource pool of its own.
    expect(result.resourcePoolCount).toBe(1);
  });

  test("a VM without config or storage is counted, with no metrics of its own", () => {
    const result: VMwareOtlpBuildResult = VMwareOtlpBuilder.build(
      snapshotOf({ vms: new Map([["vm-1", vm({ hasConfig: false })]]) }),
      "x",
    );

    expect(
      resourceKeys(result).some((key: string) => {
        return key.includes("vcenter.vm.name");
      }),
    ).toBe(false);
    expect(
      points(
        result,
        { "vcenter.cluster.name": "Prod" },
        "vcenter.cluster.vm.count",
      ),
    ).toContainEqual({
      attributes: { power_state: "on" },
      value: 1,
      time: NOW_NANO,
    });
  });

  test("cluster: capacity, effective, host count by a real boolean, VM count by power state", () => {
    const result: VMwareOtlpBuildResult = VMwareOtlpBuilder.build(
      snapshotOf(),
      "x",
    );
    const prod: Record<string, string> = { "vcenter.cluster.name": "Prod" };

    expect(points(result, prod, "vcenter.cluster.cpu.limit")[0]!.value).toBe(
      9600,
    );
    expect(
      points(result, prod, "vcenter.cluster.cpu.effective")[0]!.value,
    ).toBe(9000);
    expect(points(result, prod, "vcenter.cluster.memory.limit")[0]!.value).toBe(
      68719476736,
    );
    // EffectiveMemory is MiB; the metric is bytes.
    expect(
      points(result, prod, "vcenter.cluster.memory.effective")[0]!.value,
    ).toBe(60000 * 1048576);
    expect(points(result, prod, "vcenter.cluster.host.count")).toEqual([
      { attributes: { effective: false }, value: 1, time: NOW_NANO },
      { attributes: { effective: true }, value: 2, time: NOW_NANO },
    ]);
    expect(points(result, prod, "vcenter.cluster.vm.count")).toEqual([
      { attributes: { power_state: "on" }, value: 1, time: NOW_NANO },
      { attributes: { power_state: "off" }, value: 0, time: NOW_NANO },
      { attributes: { power_state: "suspended" }, value: 0, time: NOW_NANO },
    ]);
    expect(
      points(result, prod, "vcenter.cluster.vm_template.count")[0]!.value,
    ).toBe(0);
  });

  test("datacenter: every status of clusters, hosts and VMs by power state, capacity and disk", () => {
    const result: VMwareOtlpBuildResult = VMwareOtlpBuilder.build(
      snapshotOf({
        hosts: new Map([
          ["host-1", host()],
          [
            "host-2",
            host({
              ref: { type: "HostSystem", value: "host-2" },
              name: "esx-02",
              powerState: "standBy",
              overallStatus: "red",
              vmRefs: [],
            }),
          ],
        ]),
      }),
      "x",
    );
    const dc: Record<string, string> = { "vcenter.datacenter.name": "DC1" };

    expect(points(result, dc, "vcenter.datacenter.cluster.count")).toEqual([
      { attributes: { status: "red" }, value: 0, time: NOW_NANO },
      { attributes: { status: "yellow" }, value: 0, time: NOW_NANO },
      { attributes: { status: "green" }, value: 1, time: NOW_NANO },
      { attributes: { status: "gray" }, value: 0, time: NOW_NANO },
    ]);
    expect(points(result, dc, "vcenter.datacenter.host.count")).toEqual([
      {
        attributes: { status: "green", power_state: "on" },
        value: 1,
        time: NOW_NANO,
      },
      {
        attributes: { status: "red", power_state: "standby" },
        value: 1,
        time: NOW_NANO,
      },
    ]);
    expect(points(result, dc, "vcenter.datacenter.vm.count")).toEqual([
      {
        attributes: { status: "green", power_state: "on" },
        value: 1,
        time: NOW_NANO,
      },
    ]);
    expect(points(result, dc, "vcenter.datacenter.cpu.limit")[0]!.value).toBe(
      2 * 4 * 2400,
    );
    expect(
      points(result, dc, "vcenter.datacenter.memory.limit")[0]!.value,
    ).toBe(2 * 68719476736);
    expect(points(result, dc, "vcenter.datacenter.disk.space")).toEqual([
      { attributes: { disk_state: "used" }, value: 750, time: NOW_NANO },
      { attributes: { disk_state: "available" }, value: 250, time: NOW_NANO },
    ]);
    expect(
      points(result, dc, "vcenter.datacenter.datastore.count")[0]!.value,
    ).toBe(1);
  });

  test("resource pool: quick stats with the memory usage type, and shares", () => {
    const result: VMwareOtlpBuildResult = VMwareOtlpBuilder.build(
      snapshotOf({
        resourcePools: new Map([
          [
            "resgroup-1",
            pool({
              quickStats: {
                overallCpuUsage: 500,
                guestMemoryUsage: 100,
                hostMemoryUsage: 200,
                overheadMemory: 10,
                swappedMemory: 1,
                balloonedMemory: 2,
                privateMemory: 300,
                sharedMemory: 40,
              },
            }),
          ],
        ]),
      }),
      "x",
    );
    const resources: Record<string, string> = {
      "vcenter.resource_pool.name": "Resources",
      "vcenter.resource_pool.inventory_path": "/DC1/host/Prod/Resources",
    };

    expect(
      points(result, resources, "vcenter.resource_pool.cpu.usage")[0]!.value,
    ).toBe(500);
    expect(
      points(result, resources, "vcenter.resource_pool.memory.usage"),
    ).toEqual([
      { attributes: { type: "guest" }, value: 100, time: NOW_NANO },
      { attributes: { type: "host" }, value: 200, time: NOW_NANO },
      { attributes: { type: "overhead" }, value: 10, time: NOW_NANO },
    ]);
    expect(
      points(result, resources, "vcenter.resource_pool.memory.granted"),
    ).toEqual([
      { attributes: { type: "private" }, value: 300, time: NOW_NANO },
      { attributes: { type: "shared" }, value: 40, time: NOW_NANO },
    ]);
    expect(
      points(result, resources, "vcenter.resource_pool.cpu.shares")[0]!.value,
    ).toBe(4000);
    expect(
      points(result, resources, "vcenter.resource_pool.memory.shares")[0]!
        .value,
    ).toBe(163840);
  });

  test("a standalone host's pool is named by its host, not a cluster", () => {
    const result: VMwareOtlpBuildResult = VMwareOtlpBuilder.build(
      snapshotOf({
        computes: new Map([
          [
            "domain-s1",
            cluster({
              ref: { type: "ComputeResource", value: "domain-s1" },
              name: "esx-01.example.com",
              isCluster: false,
            }),
          ],
        ]),
        hosts: new Map([["host-1", host({ parentRef: "domain-s1" })]]),
        resourcePools: new Map([
          ["resgroup-1", pool({ ownerRef: "domain-s1" })],
        ]),
      }),
      "x",
    );

    expect(resourceKeys(result)).toContain(
      "vcenter.datacenter.name,vcenter.host.name,vcenter.resource_pool.name,vcenter.resource_pool.inventory_path",
    );
    // No cluster resource for a standalone host.
    expect(result.clusterCount).toBe(0);
  });

  test("performance samples become the receiver's metrics, rates per second of the 20-second sample", () => {
    const counterNames: Map<number, string> = new Map([
      [1, "net.packetsRx.summation"],
      [2, "net.bytesTx.average"],
      [3, "disk.maxTotalLatency.latest"],
      [4, "cpu.totalCapacity.average"],
      [5, "disk.totalReadLatency.average"],
      [6, "net.errorsTx.summation"],
    ]);
    const sampleTime: string = "2026-10-10T11:59:40Z";
    const result: VMwareOtlpBuildResult = VMwareOtlpBuilder.build(
      snapshotOf(
        {
          hostPerf: new Map([
            [
              "host-1",
              {
                entity: { type: "HostSystem", value: "host-1" },
                sampleInfo: [{ timestamp: sampleTime, interval: 20 }],
                series: [
                  { counterId: 1, instance: "vmnic0", values: [400] },
                  { counterId: 2, instance: "", values: [1234] },
                  { counterId: 3, instance: "", values: [7] },
                  { counterId: 4, instance: "", values: [9000] },
                  { counterId: 5, instance: "naa.600", values: [2] },
                  { counterId: 6, instance: "vmnic0", values: [10] },
                  { counterId: 99, instance: "", values: [1] },
                ],
              },
            ],
          ]),
        },
        counterNames,
      ),
      "x",
    );
    const esx: Record<string, string> = {
      "vcenter.host.name": "esx-01.example.com",
    };
    const sampleNano: string = toUnixNano(new Date(sampleTime));

    expect(points(result, esx, "vcenter.host.network.packet.rate")).toEqual([
      {
        attributes: { direction: "received", object: "vmnic0" },
        value: 20,
        time: sampleNano,
      },
    ]);
    expect(points(result, esx, "vcenter.host.network.throughput")).toEqual([
      {
        attributes: { direction: "transmitted", object: "" },
        value: 1234,
        time: sampleNano,
      },
    ]);
    expect(points(result, esx, "vcenter.host.disk.latency.max")).toEqual([
      { attributes: { object: "" }, value: 7, time: sampleNano },
    ]);
    expect(points(result, esx, "vcenter.host.cpu.reserved")).toEqual([
      {
        attributes: { cpu_reservation_type: "total" },
        value: 9000,
        time: sampleNano,
      },
    ]);
    expect(points(result, esx, "vcenter.host.disk.latency.avg")).toEqual([
      {
        attributes: { direction: "read", object: "naa.600" },
        value: 2,
        time: sampleNano,
      },
    ]);
    expect(
      points(result, esx, "vcenter.host.network.packet.error.rate"),
    ).toEqual([
      {
        attributes: { direction: "transmitted", object: "vmnic0" },
        value: 0.5,
        time: sampleNano,
      },
    ]);
  });

  test("a VM's virtual disk latency names the disk type", () => {
    const counterNames: Map<number, string> = new Map([
      [7, "virtualDisk.totalWriteLatency.average"],
      [8, "virtualDisk.read.average"],
    ]);
    const result: VMwareOtlpBuildResult = VMwareOtlpBuilder.build(
      snapshotOf(
        {
          vmPerf: new Map([
            [
              "vm-1",
              {
                entity: { type: "VirtualMachine", value: "vm-1" },
                sampleInfo: [
                  { timestamp: "2026-10-10T11:59:40Z", interval: 20 },
                ],
                series: [
                  { counterId: 7, instance: "scsi0:0", values: [12] },
                  { counterId: 8, instance: "scsi0:0", values: [800] },
                ],
              },
            ],
          ]),
        },
        counterNames,
      ),
      "x",
    );
    const web: Record<string, string> = { "vcenter.vm.name": "web-01" };

    expect(
      points(result, web, "vcenter.vm.disk.latency.avg")[0]!.attributes,
    ).toEqual({
      direction: "write",
      disk_type: "virtual",
      object: "scsi0:0",
    });
    expect(points(result, web, "vcenter.vm.disk.throughput")[0]).toMatchObject({
      attributes: { direction: "read", object: "scsi0:0" },
      value: 800,
    });
  });

  test("vSAN: operations, per-second throughput, latency and congestion, by the object's uuid", () => {
    const vsan: ReturnType<typeof emptyVsanResults> = emptyVsanResults();
    const timestamps: Array<Date> = [new Date("2026-10-10T11:55:00Z")];
    vsan.clustersByUuid.set("52-cluster", [
      { label: "iopsRead", intervalInSeconds: 300, timestamps, values: [120] },
      {
        label: "throughputWrite",
        intervalInSeconds: 300,
        timestamps,
        values: [3000],
      },
      {
        label: "latencyAvgRead",
        intervalInSeconds: 300,
        timestamps,
        values: [800],
      },
      {
        label: "congestion",
        intervalInSeconds: 300,
        timestamps,
        values: [600],
      },
    ]);
    vsan.hostsByUuid.set("52-host", [
      {
        label: "clientCacheHitRate",
        intervalInSeconds: 300,
        timestamps,
        values: [97],
      },
    ]);
    vsan.vmsByUuid.set("50a1-instance", [
      {
        label: "latencyWrite",
        intervalInSeconds: 300,
        timestamps,
        values: [450],
      },
      {
        label: "latencyAvgWrite",
        intervalInSeconds: 300,
        timestamps,
        values: [1],
      },
    ]);

    const result: VMwareOtlpBuildResult = VMwareOtlpBuilder.build(
      snapshotOf({
        computes: new Map([
          ["domain-c1", cluster({ vsanEnabled: true, vsanUuid: "52-cluster" })],
        ]),
        hosts: new Map([["host-1", host({ vsanNodeUuid: "52-host" })]]),
        vsan: vsan,
      }),
      "x",
    );
    const time: string = toUnixNano(timestamps[0]!);
    const prod: Record<string, string> = { "vcenter.cluster.name": "Prod" };

    expect(
      points(
        result,
        { ...prod, "vcenter.datacenter.name": "DC1" },
        "vcenter.cluster.vsan.operations",
      ),
    ).toEqual([{ attributes: { type: "read" }, value: 120, time: time }]);
    expect(points(result, prod, "vcenter.cluster.vsan.throughput")).toEqual([
      { attributes: { direction: "write" }, value: 10, time: time },
    ]);
    expect(points(result, prod, "vcenter.cluster.vsan.latency.avg")).toEqual([
      { attributes: { type: "read" }, value: 800, time: time },
    ]);
    expect(points(result, prod, "vcenter.cluster.vsan.congestions")).toEqual([
      { attributes: {}, value: 2, time: time },
    ]);
    expect(
      points(
        result,
        { "vcenter.host.name": "esx-01.example.com" },
        "vcenter.host.vsan.cache.hit_rate",
      ),
    ).toEqual([{ attributes: {}, value: 97, time: time }]);
    // A VM's latency label is latencyWrite, not the cluster's latencyAvgWrite.
    expect(
      points(
        result,
        { "vcenter.vm.name": "web-01" },
        "vcenter.vm.vsan.latency.avg",
      ),
    ).toEqual([{ attributes: { type: "write" }, value: 450, time: time }]);
  });

  test("objects the probe could not place are left out with a warning, not guessed", () => {
    const result: VMwareOtlpBuildResult = VMwareOtlpBuilder.build(
      snapshotOf({
        hosts: new Map([["host-1", host({ parentRef: "unknown" })]]),
      }),
      "x",
    );

    expect(result.warnings).toContain(
      "Host esx-01.example.com has no compute resource the probe could read, so its metrics are left out.",
    );
    expect(result.warnings).toContain(
      "Virtual machine web-01 is on no host the probe could read, so it is left out.",
    );
  });

  test("power states read as the receiver writes them", () => {
    expect(hostPowerStateOf("poweredOn")).toBe("on");
    expect(hostPowerStateOf("poweredOff")).toBe("off");
    expect(hostPowerStateOf("standBy")).toBe("standby");
    expect(hostPowerStateOf("unknown")).toBe("unknown");
    expect(hostPowerStateOf(null)).toBe("unknown");
    expect(vmPowerStateOf("poweredOn")).toBe("on");
    expect(vmPowerStateOf("suspended")).toBe("suspended");
    expect(vmPowerStateOf("weird")).toBe("unknown");
  });

  test("counts what it saw for the collection summary", () => {
    const result: VMwareOtlpBuildResult = VMwareOtlpBuilder.build(
      snapshotOf(),
      "x",
    );

    expect(result).toMatchObject({
      datacenterCount: 1,
      clusterCount: 1,
      hostCount: 1,
      vmCount: 1,
      poweredOnVmCount: 1,
      templateCount: 0,
      datastoreCount: 1,
      resourcePoolCount: 1,
    });
    /*
     * Datastore 3, pool 2 (shares), host 6, VM 11, cluster 10, datacenter
     * 11 - every one of them counted.
     */
    expect(result.datapointCount).toBe(43);
  });
});
