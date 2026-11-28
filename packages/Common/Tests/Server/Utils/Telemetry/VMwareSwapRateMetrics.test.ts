import MetricType from "../../../../Models/DatabaseModels/MetricType";
import { TelemetryServiceMetadata } from "../../../../Server/Services/OpenTelemetryIngestService";
import { VMwareResourceSwapRateReading } from "../../../../Server/Services/VMwareResourceService";
import TelemetryUtil from "../../../../Server/Utils/Telemetry/Telemetry";
import VMwareSwapRateMetrics, {
  VMwareSwapRatePoint,
  VMwareSwapRateRowContext,
} from "../../../../Server/Utils/Telemetry/VMwareSwapRateMetrics";
import {
  VMwareResourceIdentity,
  resolveVMwareResourceIdentity,
} from "../../../../Server/Utils/Telemetry/VMwareSnapshotScan";
import Dictionary from "../../../../Types/Dictionary";
import { JSONObject } from "../../../../Types/JSON";
import { VMwareResourceKind } from "../../../../Types/Monitor/MonitorStepVMwareMonitor";
import ObjectID from "../../../../Types/ObjectID";
import ServiceType from "../../../../Types/Telemetry/ServiceType";
import {
  VMWARE_SWAP_RATE_METRICS,
  VMwareSwapRateMetric,
  VMwareSwapRateSource,
  getVMwareSwapRateMetricDescription,
} from "../../../../Types/VMware/VMwareSwapRates";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * The swap rates OneUptime writes from a vCenter's reports (#11468), so
 * VM Memory Swapping reads one rate whichever collector a vCenter has: one
 * point per VM or resource pool and direction, at the report's time, under
 * the part's own resource block, with a `source` attribute saying whether
 * vSphere measured it or ingest worked it out.
 */

const VCENTER_ID: string = "0a1b2c3d-0000-4000-8000-000000000001";
const OBSERVED_AT: Date = new Date("2026-11-27T10:02:00.000Z");

const VM: Record<string, unknown> = {
  "vcenter.datacenter.name": "DC1",
  "vcenter.cluster.name": "Prod",
  "vcenter.host.name": "esx-07",
  "vcenter.vm.name": "web-01",
  "vcenter.vm.id": "5030a1b2-0000-4000-8000-000000000001",
};
const VM_EXTERNAL_ID: string = "vm/5030a1b2-0000-4000-8000-000000000001";

const TEMPLATE: Record<string, unknown> = {
  "vcenter.datacenter.name": "DC1",
  "vcenter.cluster.name": "Prod",
  "vcenter.host.name": "esx-07",
  "vcenter.vm_template.name": "ubuntu-template",
  "vcenter.vm_template.id": "5030a1b2-0000-4000-8000-0000000000aa",
};

const POOL: Record<string, unknown> = {
  "vcenter.datacenter.name": "DC1",
  "vcenter.cluster.name": "Prod",
  "vcenter.resource_pool.name": "Batch",
  "vcenter.resource_pool.inventory_path": "/DC1/host/Prod/Resources/Batch",
};

const HOST: Record<string, unknown> = {
  "vcenter.datacenter.name": "DC1",
  "vcenter.cluster.name": "Prod",
  "vcenter.host.name": "esx-07",
};

function context(name: string): VMwareSwapRateRowContext {
  return {
    baseAttributes: {
      "resource.vmware.vcenter.name": "vcsa-prod",
      "resource.vcenter.vm.name": name,
    },
    serviceMetadata: {
      serviceName: name,
      primaryEntityId: ObjectID.generate(),
      primaryEntityType: ServiceType.OpenTelemetry,
    } as unknown as TelemetryServiceMetadata,
  };
}

function remember(
  contexts: Map<string, Map<string, VMwareSwapRateRowContext>>,
  attributes: Record<string, unknown>,
  rowContext: VMwareSwapRateRowContext,
  vcenterIdStr: string = VCENTER_ID,
): void {
  VMwareSwapRateMetrics.rememberRowContext({
    contexts,
    vcenterIdStr,
    vmwareResourceAttributes: attributes,
    context: rowContext,
  });
}

function reading(
  data: Partial<VMwareResourceSwapRateReading> = {},
): VMwareResourceSwapRateReading {
  return {
    kind: VMwareResourceKind.VirtualMachine,
    externalId: VM_EXTERNAL_ID,
    swapOutBytesPerSecond: 524288,
    swapInBytesPerSecond: 0,
    source: VMwareSwapRateSource.VSphere,
    observedAt: OBSERVED_AT,
    ...data,
  };
}

describe("remembering what each part's metrics are stored under", () => {
  test("a VM's and a resource pool's, per vCenter, the first block of each", () => {
    const contexts: Map<
      string,
      Map<string, VMwareSwapRateRowContext>
    > = new Map();
    const first: VMwareSwapRateRowContext = context("web-01");
    remember(contexts, VM, first);
    remember(contexts, VM, context("web-01 again"));
    remember(contexts, POOL, context("Batch"));
    remember(contexts, VM, context("other vCenter"), "another-vcenter");

    const ours: Map<string, VMwareSwapRateRowContext> =
      contexts.get(VCENTER_ID)!;
    const pool: VMwareResourceIdentity = resolveVMwareResourceIdentity(POOL)!;
    expect(Array.from(ours.keys()).sort()).toEqual(
      [
        `ResourcePool|${pool.externalId}`,
        `VirtualMachine|${VM_EXTERNAL_ID}`,
      ].sort(),
    );
    expect(ours.get(`VirtualMachine|${VM_EXTERNAL_ID}`)).toBe(first);
    expect(contexts.get("another-vcenter")!.size).toBe(1);
  });

  test("never a host, a datastore or a template: none of them has a swap rate of OneUptime's", () => {
    const contexts: Map<
      string,
      Map<string, VMwareSwapRateRowContext>
    > = new Map();
    remember(contexts, HOST, context("esx-07"));
    remember(contexts, TEMPLATE, context("ubuntu-template"));
    remember(
      contexts,
      { "vcenter.datacenter.name": "DC1", "vcenter.datastore.name": "ds1" },
      context("ds1"),
    );
    remember(contexts, {}, context("nothing"));
    expect(contexts.get(VCENTER_ID)?.size ?? 0).toBe(0);
  });
});

describe("the metric each rate is written as", () => {
  test("a VM's and a resource pool's, out and in", () => {
    expect(
      VMwareSwapRateMetrics.getMetricName(
        VMwareResourceKind.VirtualMachine,
        "out",
      ),
    ).toBe(VMwareSwapRateMetric.VirtualMachineSwapOut);
    expect(
      VMwareSwapRateMetrics.getMetricName(
        VMwareResourceKind.VirtualMachine,
        "in",
      ),
    ).toBe(VMwareSwapRateMetric.VirtualMachineSwapIn);
    expect(
      VMwareSwapRateMetrics.getMetricName(
        VMwareResourceKind.ResourcePool,
        "out",
      ),
    ).toBe(VMwareSwapRateMetric.ResourcePoolSwapOut);
    expect(
      VMwareSwapRateMetrics.getMetricName(
        VMwareResourceKind.ResourcePool,
        "in",
      ),
    ).toBe(VMwareSwapRateMetric.ResourcePoolSwapIn);
  });

  test("none for any other part", () => {
    for (const kind of [
      VMwareResourceKind.Host,
      VMwareResourceKind.Cluster,
      VMwareResourceKind.Datastore,
      VMwareResourceKind.Datacenter,
      "Unknown",
    ]) {
      expect(VMwareSwapRateMetrics.getMetricName(kind, "out")).toBeNull();
    }
  });
});

describe("the points", () => {
  const vmContext: VMwareSwapRateRowContext = context("web-01");
  const contexts: Map<string, VMwareSwapRateRowContext> = new Map([
    [`VirtualMachine|${VM_EXTERNAL_ID}`, vmContext],
  ]);

  test("one per direction, a Gauge of doubles at the report's time, saying vSphere measured it", () => {
    const points: Array<VMwareSwapRatePoint> = VMwareSwapRateMetrics.getPoints({
      readings: [reading()],
      contexts,
    });

    expect(points).toEqual([
      {
        metricName: VMwareSwapRateMetric.VirtualMachineSwapOut,
        context: vmContext,
        datapoint: {
          timeUnixNano: `${OBSERVED_AT.getTime()}000000`,
          asDouble: 524288,
          attributes: [{ key: "source", value: { stringValue: "vsphere" } }],
        },
      },
      {
        metricName: VMwareSwapRateMetric.VirtualMachineSwapIn,
        context: vmContext,
        datapoint: {
          timeUnixNano: `${OBSERVED_AT.getTime()}000000`,
          asDouble: 0,
          attributes: [{ key: "source", value: { stringValue: "vsphere" } }],
        },
      },
    ]);
    expect(BigInt(points[0]!.datapoint["timeUnixNano"] as string)).toBe(
      BigInt(OBSERVED_AT.getTime()) * BigInt(1_000_000),
    );
  });

  test("a rate worked out says so", () => {
    const points: Array<VMwareSwapRatePoint> = VMwareSwapRateMetrics.getPoints({
      readings: [reading({ source: VMwareSwapRateSource.Derived })],
      contexts,
    });
    for (const point of points) {
      expect(
        (point.datapoint["attributes"] as Array<JSONObject>)[0]!["value"],
      ).toEqual({ stringValue: "derived" });
    }
  });

  test("a rate not known, below 0 or not a number is no point; the other direction still is", () => {
    for (const swapIn of [null, -1, Number.NaN]) {
      const points: Array<VMwareSwapRatePoint> =
        VMwareSwapRateMetrics.getPoints({
          readings: [
            reading({ swapInBytesPerSecond: swapIn as number | null }),
          ],
          contexts,
        });
      expect(
        points.map((point: VMwareSwapRatePoint) => {
          return point.metricName;
        }),
      ).toEqual([VMwareSwapRateMetric.VirtualMachineSwapOut]);
    }
  });

  test("a part whose block this batch did not read gets no point", () => {
    expect(
      VMwareSwapRateMetrics.getPoints({
        readings: [reading({ externalId: "vm/someone-else" })],
        contexts,
      }),
    ).toEqual([]);
  });

  test("a host's reading, should one come, is no point", () => {
    expect(
      VMwareSwapRateMetrics.getPoints({
        readings: [reading({ kind: VMwareResourceKind.Host })],
        contexts: new Map([[`Host|${VM_EXTERNAL_ID}`, vmContext]]),
      }),
    ).toEqual([]);
  });
});

describe("the catalog", () => {
  test("lists every swap rate with what it is and its unit", () => {
    const catalog: Dictionary<MetricType> = VMwareSwapRateMetrics.getCatalog();
    expect(Object.keys(catalog)).toEqual([...VMWARE_SWAP_RATE_METRICS]);
    for (const metric of VMWARE_SWAP_RATE_METRICS) {
      expect(catalog[metric]!.name).toBe(metric);
      expect(catalog[metric]!.unit).toBe("By/s");
      expect(catalog[metric]!.description).toBe(
        getVMwareSwapRateMetricDescription(metric),
      );
    }
  });

  describe("registering it", () => {
    let indexed: jest.SpiedFunction<
      typeof TelemetryUtil.indexMetricNameServiceNameMap
    >;

    beforeEach(() => {
      VMwareSwapRateMetrics.forgetRegisteredCatalogs();
      indexed = jest
        .spyOn(TelemetryUtil, "indexMetricNameServiceNameMap")
        .mockResolvedValue(undefined as never);
    });

    afterEach(() => {
      jest.restoreAllMocks();
      VMwareSwapRateMetrics.forgetRegisteredCatalogs();
    });

    test("writes it once per project and process", async () => {
      const projectId: ObjectID = ObjectID.generate();
      await VMwareSwapRateMetrics.registerCatalog(projectId);
      await VMwareSwapRateMetrics.registerCatalog(projectId);
      expect(indexed).toHaveBeenCalledTimes(1);
      expect(indexed.mock.calls[0]![0].projectId).toBe(projectId);
      expect(
        Object.keys(indexed.mock.calls[0]![0].metricNameServiceNameMap),
      ).toEqual([...VMWARE_SWAP_RATE_METRICS]);

      await VMwareSwapRateMetrics.registerCatalog(ObjectID.generate());
      expect(indexed).toHaveBeenCalledTimes(2);
    });

    test("a write that fails is tried again next time", async () => {
      const projectId: ObjectID = ObjectID.generate();
      indexed.mockRejectedValueOnce(new Error("Postgres went away"));
      await expect(
        VMwareSwapRateMetrics.registerCatalog(projectId),
      ).rejects.toThrow("Postgres went away");
      await VMwareSwapRateMetrics.registerCatalog(projectId);
      expect(indexed).toHaveBeenCalledTimes(2);
    });
  });
});
