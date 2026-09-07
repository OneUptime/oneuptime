import MetricMonitorResponse from "Common/Types/Monitor/MetricMonitor/MetricMonitorResponse";
import VMwareSource from "Common/Models/DatabaseModels/VMwareSource";
import VMwareResource from "Common/Models/DatabaseModels/VMwareResource";
import VMwareSourceService from "Common/Server/Services/VMwareSourceService";
import VMwareResourceService from "Common/Server/Services/VMwareResourceService";
import MetricService from "Common/Server/Services/MetricService";
import MetricTypeService from "Common/Server/Services/MetricTypeService";
import MonitorStep from "Common/Types/Monitor/MonitorStep";
import ObjectID from "Common/Types/ObjectID";
import RollingTime from "Common/Types/RollingTime/RollingTime";
import MetricsAggregationType from "Common/Types/Metrics/MetricsAggregationType";
import { buildVmwareMonitorConfig } from "Common/Types/Monitor/VmwareAlertTemplates";
import {
  VmwareResourceType,
  VMWARE_SOURCE_ATTRIBUTE,
  VMWARE_RESOURCE_GROUP_KEYS,
} from "Common/Types/Monitor/MonitorStepVmwareMonitor";
import VmwareMonitorSeries from "Common/Server/Utils/Monitor/VmwareMonitorSeries";
import { monitorVmware } from "../../../../FeatureSet/Workers/Jobs/TelemetryMonitor/MonitorTelemetryMonitor";
import { describe, expect, test, beforeEach } from "@jest/globals";

jest.mock("Common/Server/Infrastructure/Queue", () => ({
  __esModule: true,
  default: { addJob: jest.fn() },
  QueueName: { Telemetry: "Telemetry" },
}));
jest.mock("Common/Server/Utils/VM/VMRunner", () => ({
  __esModule: true,
  default: {},
}));
jest.mock("Common/Server/Services/VMwareSourceService", () => ({
  __esModule: true,
  default: { findOneBy: jest.fn() },
}));
jest.mock("Common/Server/Services/VMwareResourceService", () => ({
  __esModule: true,
  default: { findBy: jest.fn() },
}));
jest.mock("Common/Server/Services/MetricService", () => ({
  __esModule: true,
  default: { aggregateBy: jest.fn() },
}));
jest.mock("Common/Server/Services/MetricTypeService", () => ({
  __esModule: true,
  default: { findBy: jest.fn() },
}));

const sourceFind: jest.Mock = VMwareSourceService.findOneBy as jest.Mock;
const resourceFind: jest.Mock = VMwareResourceService.findBy as jest.Mock;
const aggregate: jest.Mock = MetricService.aggregateBy as jest.Mock;
const units: jest.Mock = MetricTypeService.findBy as jest.Mock;
const projectId: ObjectID = ObjectID.generate();
const monitorId: ObjectID = ObjectID.generate();
const sourceId: ObjectID = ObjectID.generate();
const now: Date = new Date();
const source: VMwareSource = Object.assign(new VMwareSource(), {
  _id: sourceId.toString(),
  sourceIdentifier: "vc-a",
  lastCollectionAt: now,
  collectionIntervalSeconds: 120,
  metrics: {
    "oneuptime.vmware.source.up": 1,
    "oneuptime.vmware.source.inventory.complete": 1,
  },
});
const resource: VMwareResource = Object.assign(new VMwareResource(), {
  resourceIdentifier: "vm-uuid",
  resourceType: "vm",
  lastReportedAt: now,
  metrics: {
    "oneuptime.vmware.resource.observed": 1,
    "oneuptime.vmware.resource.power_state": 1,
    "oneuptime.vmware.vm.cpu.utilization": 95,
  },
});
function step(metric: string = "vm.cpu.utilization"): MonitorStep {
  const value: MonitorStep = new MonitorStep();
  value.data!.vmwareMonitor = buildVmwareMonitorConfig({
    sourceIdentifier: "vc-a",
    metricName: "oneuptime.vmware." + metric,
    metricAlias: "A",
    rollingTime: RollingTime.Past5Minutes,
    aggregationType: MetricsAggregationType.Avg,
    resourceType: metric.startsWith("source.")
      ? undefined
      : VmwareResourceType.VM,
  });
  return value;
}
beforeEach(() => {
  sourceFind.mockReset().mockResolvedValue(source);
  resourceFind.mockReset().mockResolvedValue([resource]);
  aggregate
    .mockReset()
    .mockResolvedValue({
      data: [
        {
          timestamp: now,
          value: 95,
          attributes: VmwareMonitorSeries.labels("vc-a", resource),
        },
      ],
    });
  units.mockReset().mockResolvedValue([]);
});
describe("VMware worker integration", () => {
  test("reuses SQL aggregation with mandatory tenant/source scope and stable grouping", async () => {
    const response: MetricMonitorResponse = await monitorVmware({
      monitorStep: step(),
      monitorId,
      projectId,
    });
    expect(sourceFind.mock.calls[0]![0].query).toEqual({
      projectId,
      sourceIdentifier: "vc-a",
    });
    expect(resourceFind.mock.calls[0]![0].query).toMatchObject({
      projectId,
      sourceId,
      isArchived: false,
    });
    expect(aggregate.mock.calls[0]![0]).toMatchObject({
      query: { projectId, attributes: { [VMWARE_SOURCE_ATTRIBUTE]: "vc-a" } },
      groupByAttributeKeys: VMWARE_RESOURCE_GROUP_KEYS,
      timeoutOverflowMode: "throw",
    });
    expect(response.seriesBreakdown).toHaveLength(1);
    expect(
      response.seriesBreakdown![0]!.aggregatedResults[0]!.data[0]!.value,
    ).toBe(95);
  });
  test("cannot evaluate a source from another project", async () => {
    sourceFind.mockResolvedValue(null);
    await expect(
      monitorVmware({ monitorStep: step(), monitorId, projectId }),
    ).rejects.toThrow(/project/);
    expect(aggregate).not.toHaveBeenCalled();
  });
  test.each(["stale", "partial", "failed", "archived"])(
    "holds existing state when source is %s",
    async (state: string) => {
      const current: VMwareSource = Object.assign(new VMwareSource(), source, {
        metrics: { ...source.metrics },
      });
      if (state === "stale") {
        current.lastCollectionAt = new Date(now.getTime() - 600000);
      }
      if (state === "partial") {
        current.metrics!["oneuptime.vmware.source.inventory.complete"] = 0;
      }
      if (state === "failed") {
        current.metrics!["oneuptime.vmware.source.up"] = 0;
      }
      if (state === "archived") {
        current.isArchived = true;
      }
      sourceFind.mockResolvedValue(current);
      const response: MetricMonitorResponse = await monitorVmware({
        monitorStep: step(),
        monitorId,
        projectId,
      });
      expect(response.skipEvaluationReason).toBeTruthy();
      expect(aggregate).not.toHaveBeenCalled();
    },
  );
  test("source collection monitor still evaluates source failure", async () => {
    sourceFind.mockResolvedValue(
      Object.assign(new VMwareSource(), source, {
        metrics: { "oneuptime.vmware.source.up": 0 },
      }),
    );
    aggregate.mockResolvedValue({
      data: [
        {
          timestamp: now,
          value: 0,
          attributes: { [VMWARE_SOURCE_ATTRIBUTE]: "vc-a" },
        },
      ],
    });
    const response: MetricMonitorResponse = await monitorVmware({
      monitorStep: step("source.up"),
      monitorId,
      projectId,
    });
    expect(response.skipEvaluationReason).toBeUndefined();
    expect(response.metricResult[0]!.data[0]!.value).toBe(0);
    expect(resourceFind).not.toHaveBeenCalled();
  });
  test("source telemetry loss yields one source no-data series", async () => {
    sourceFind.mockResolvedValue(
      Object.assign(new VMwareSource(), source, {
        lastCollectionAt: new Date(now.getTime() - 600000),
      }),
    );
    aggregate.mockResolvedValue({ data: [] });
    const response: MetricMonitorResponse = await monitorVmware({
      monitorStep: step("source.up"),
      monitorId,
      projectId,
    });
    expect(response.seriesBreakdown).toHaveLength(1);
    expect(response.metricResult[0]!.data).toEqual([]);
    expect(response.skipEvaluationReason).toBeUndefined();
  });
  test("refuses incomplete aggregate results instead of silently resolving omitted entities", async () => {
    aggregate.mockResolvedValue({ data: [], truncated: true });
    await expect(
      monitorVmware({ monitorStep: step(), monitorId, projectId }),
    ).rejects.toThrow(/incomplete/);
  });
  test("a missing VM does not recover its existing utilization incident", async () => {
    aggregate.mockResolvedValue({ data: [] });
    const response: MetricMonitorResponse = await monitorVmware({
      monitorStep: step(),
      monitorId,
      projectId,
    });
    expect(response.unavailableSeriesFingerprints).toHaveLength(1);
    expect(response.skipEvaluationReason).toBeTruthy();
  });
});
