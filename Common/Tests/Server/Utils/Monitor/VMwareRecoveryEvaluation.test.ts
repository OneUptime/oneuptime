import MonitorStatusService from "../../../../Server/Services/MonitorStatusService";
import MonitorStatus from "../../../../Models/DatabaseModels/MonitorStatus";
import Monitor from "../../../../Models/DatabaseModels/Monitor";
import MonitorCriteriaEvaluator from "../../../../Server/Utils/Monitor/MonitorCriteriaEvaluator";
import VMwareRecoveryPolicy from "../../../../Server/Utils/Monitor/VMwareRecoveryPolicy";
import VmwareMonitorSeries, {
  VmwareSeriesResult,
} from "../../../../Server/Utils/Monitor/VmwareMonitorSeries";
import VMwareResource from "../../../../Models/DatabaseModels/VMwareResource";
import VMwareSource from "../../../../Models/DatabaseModels/VMwareSource";
import MetricSeriesFingerprint from "../../../../Utils/Metrics/MetricSeriesFingerprint";
import MonitorCriteriaInstance from "../../../../Types/Monitor/MonitorCriteriaInstance";
import AggregateModel from "../../../../Types/BaseDatabase/AggregatedModel";
import AggregatedResult from "../../../../Types/BaseDatabase/AggregatedResult";
import { JSONObject } from "../../../../Types/JSON";
import MetricMonitorResponse from "../../../../Types/Monitor/MetricMonitor/MetricMonitorResponse";
import MonitorEvaluationSummary from "../../../../Types/Monitor/MonitorEvaluationSummary";
import MonitorStep from "../../../../Types/Monitor/MonitorStep";
import MonitorType from "../../../../Types/Monitor/MonitorType";
import { getVmwareAlertTemplateById } from "../../../../Types/Monitor/VmwareAlertTemplates";
import MetricQueryConfigData from "../../../../Types/Metrics/MetricQueryConfigData";
import MetricsViewConfig from "../../../../Types/Metrics/MetricsViewConfig";
import MetricSeriesResult from "../../../../Types/Monitor/MetricMonitor/MetricSeriesResult";
import ObjectID from "../../../../Types/ObjectID";
import ProbeApiIngestResponse, {
  PerSeriesCriteriaMatch,
} from "../../../../Types/Probe/ProbeApiIngestResponse";

jest.mock("isolated-vm", () => {
  return {};
});

interface SeriesInput {
  id: string;
  values: Array<number>;
  recoveryValues?: Array<number>;
}

afterEach(() => {
  jest.restoreAllMocks();
});

interface Evaluation {
  data: MetricMonitorResponse;
  response: ProbeApiIngestResponse;
  step: MonitorStep;
}

function shouldChangeStatus(result: Evaluation): boolean {
  const criterion: MonitorCriteriaInstance | undefined =
    result.step.data!.monitorCriteria.data!.monitorCriteriaInstanceArray.find(
      (candidate: MonitorCriteriaInstance): boolean => {
        return candidate.data!.id === result.response.criteriaMetId;
      },
    );
  return VMwareRecoveryPolicy.shouldChangeStatus({
    monitorType: MonitorType.VMware,
    criteriaInstance: criterion,
    operationalMonitorStatusIds: result.data.operationalMonitorStatusIds,
    unavailableSeriesFingerprints: result.data.unavailableSeriesFingerprints,
    recoveredSeriesFingerprints: result.data.recoveredSeriesFingerprints,
    evaluatedSeriesFingerprints: result.data.seriesBreakdown!.map(
      (series: MetricSeriesResult): string => {
        return series.fingerprint;
      },
    ),
  });
}

async function evaluate(input: {
  template: string;
  series: Array<SeriesInput>;
  disableHealthy?: boolean;
  monitorType?: MonitorType;
  quietNonOperational?: boolean;
  resources?: Array<VMwareResource>;
}): Promise<Evaluation> {
  const id: ObjectID = ObjectID.generate();
  const operationalStatus: MonitorStatus = new MonitorStatus();
  operationalStatus.id = id;
  jest
    .spyOn(MonitorStatusService, "findBy")
    .mockResolvedValue([operationalStatus]);
  const step: MonitorStep = getVmwareAlertTemplateById(
    input.template,
  )!.getMonitorStep({
    sourceIdentifier: "vc-a",
    monitorName: "VMware monitor",
    onlineMonitorStatusId: id,
    offlineMonitorStatusId: ObjectID.generate(),
    defaultIncidentSeverityId: id,
    defaultAlertSeverityId: id,
  });
  if (input.disableHealthy) {
    step.data!.monitorCriteria.data!.monitorCriteriaInstanceArray[1]!.data!.isEnabled =
      false;
  }
  if (input.quietNonOperational) {
    step.data!.monitorCriteria.data!.monitorCriteriaInstanceArray[1]!.data!.monitorStatusId =
      ObjectID.generate();
  }
  const monitor: Monitor = new Monitor();
  monitor._id = id.toString();
  monitor.projectId = id;
  monitor.name = "VMware monitor";
  monitor.monitorType = input.monitorType || MonitorType.VMware;
  if (monitor.monitorType === MonitorType.Metrics) {
    step.data!.metricMonitor = step.data!.vmwareMonitor;
  }
  const metricViewConfig: MetricsViewConfig =
    step.data!.vmwareMonitor!.metricViewConfig;
  const data: MetricMonitorResponse = {
    projectId: id,
    monitorId: id,
    metricViewConfig,
    metricResult: [],
    seriesBreakdown: input.series.map((series: SeriesInput) => {
      const labels: JSONObject = {
        "resource.oneuptime.vmware.source.id": "vc-a",
        "resource.oneuptime.vmware.resource.type":
          step.data!.vmwareMonitor!.resourceFilters.resourceType || "datastore",
        "resource.oneuptime.vmware.resource.id": series.id,
      };
      const aggregatedResults: Array<AggregatedResult> =
        metricViewConfig.queryConfigs.map(
          (_query: MetricQueryConfigData, index: number): AggregatedResult => {
            const values: Array<number> =
              index === 1
                ? series.recoveryValues || series.values
                : series.values;
            return {
              data: values.map((value: number): AggregateModel => {
                return {
                  timestamp: new Date(),
                  value,
                  attributes: labels,
                };
              }),
            };
          },
        );
      return {
        fingerprint: input.resources
          ? MetricSeriesFingerprint.computeFingerprint(labels)
          : series.id,
        labels,
        aggregatedResults,
      };
    }),
  };
  if (input.resources) {
    const now: Date = new Date();
    const source: VMwareSource = Object.assign(new VMwareSource(), {
      sourceIdentifier: "vc-a",
      lastCollectionAt: now,
      collectionIntervalSeconds: 120,
      metrics: {
        "oneuptime.vmware.source.up": 1,
        "oneuptime.vmware.source.inventory.complete": 1,
      },
    });
    const policy: VmwareSeriesResult = VmwareMonitorSeries.apply({
      config: step.data!.vmwareMonitor!,
      source,
      resources: input.resources,
      series: data.seriesBreakdown!,
      now,
    });
    data.unavailableSeriesFingerprints = policy.unavailableSeriesFingerprints;
    data.seriesBreakdown = policy.series.filter(
      (series: MetricSeriesResult) => {
        return series.aggregatedResults.some((result: AggregatedResult) => {
          return result.data.length > 0;
        });
      },
    );
  }
  data.metricResult = metricViewConfig.queryConfigs.map(
    (_query: MetricQueryConfigData, index: number): AggregatedResult => {
      return {
        data: data.seriesBreakdown!.flatMap((series: MetricSeriesResult) => {
          return series.aggregatedResults[index]!.data;
        }),
      };
    },
  );
  const summary: MonitorEvaluationSummary = {
    criteriaResults: [],
    events: [],
  } as unknown as MonitorEvaluationSummary;
  const response: ProbeApiIngestResponse =
    await MonitorCriteriaEvaluator.processMonitorStep({
      dataToProcess: data,
      monitorStep: step,
      monitor,
      evaluationSummary: summary,
      probeApiIngestResponse: { monitorId: id, rootCause: null },
    });
  return { data, response, step };
}

function vmResource(data: {
  id: string;
  expectedRunning: boolean;
  power: number;
}): VMwareResource {
  const now: Date = new Date();
  const metrics: JSONObject = {
    "oneuptime.vmware.resource.observed": 1,
    "oneuptime.vmware.resource.power_state": data.power,
    "oneuptime.vmware.vm.expected_running": Number(data.expectedRunning),
  };
  if (data.power !== 0) {
    metrics["oneuptime.vmware.vm.unexpected_power_off"] = Number(
      data.expectedRunning && data.power !== 1,
    );
  }
  return Object.assign(new VMwareResource(), {
    resourceIdentifier: data.id,
    resourceType: "vm",
    lastSeenAt: now,
    lastReportedAt: now,
    metadata: {
      "oneuptime.vmware.vm.expected_running": data.expectedRunning,
    },
    metrics,
  });
}

function vmFingerprint(resource: VMwareResource): string {
  return MetricSeriesFingerprint.computeFingerprint(
    VmwareMonitorSeries.labels("vc-a", resource),
  );
}

describe("VMware expected-running policy through inventory and criteria evaluation", () => {
  test("a mixed fleet alerts only for the expected VM and recovers when that VM starts", async () => {
    const expected: VMwareResource = vmResource({
      id: "expected",
      expectedRunning: true,
      power: 2,
    });
    const optional: VMwareResource = vmResource({
      id: "optional",
      expectedRunning: false,
      power: 2,
    });
    const failing: Evaluation = await evaluate({
      template: "vmware-vm-unexpected-off",
      resources: [expected, optional],
      series: [
        { id: "expected", values: [1, 1] },
        { id: "optional", values: [0, 0] },
      ],
    });
    expect(failing.data.unavailableSeriesFingerprints).toEqual([]);
    expect(failing.data.recoveredSeriesFingerprints).toEqual([
      vmFingerprint(optional),
    ]);
    expect(
      failing.response.matchedCriteria![0]!.perSeriesMatches.map(
        (match: PerSeriesCriteriaMatch): string => {
          return match.fingerprint;
        },
      ),
    ).toEqual([vmFingerprint(expected)]);
    expect(shouldChangeStatus(failing)).toBe(true);

    const running: VMwareResource = vmResource({
      id: "expected",
      expectedRunning: true,
      power: 1,
    });
    const recovered: Evaluation = await evaluate({
      template: "vmware-vm-unexpected-off",
      resources: [running, optional],
      series: [
        { id: "expected", values: [0, 0] },
        { id: "optional", values: [0, 0] },
      ],
    });
    expect(recovered.data.unavailableSeriesFingerprints).toEqual([]);
    expect(recovered.data.recoveredSeriesFingerprints).toEqual([
      vmFingerprint(running),
      vmFingerprint(optional),
    ]);
    expect(recovered.response.matchedCriteria).toHaveLength(1);
    expect(shouldChangeStatus(recovered)).toBe(true);
  });
  test("removing an agent expectation explicitly recovers a VM that stays powered off", async () => {
    const resource: VMwareResource = vmResource({
      id: "policy-removed",
      expectedRunning: false,
      power: 2,
    });
    const recovered: Evaluation = await evaluate({
      template: "vmware-vm-unexpected-off",
      resources: [resource],
      series: [{ id: "policy-removed", values: [0, 0] }],
    });
    expect(recovered.data.unavailableSeriesFingerprints).toEqual([]);
    expect(recovered.data.recoveredSeriesFingerprints).toEqual([
      vmFingerprint(resource),
    ]);
    expect(shouldChangeStatus(recovered)).toBe(true);
  });
  test("an explicit no-expectation policy still waits for the unhealthy history to leave the recovery window", async () => {
    const resource: VMwareResource = vmResource({
      id: "policy-removed",
      expectedRunning: false,
      power: 2,
    });
    const recovering: Evaluation = await evaluate({
      template: "vmware-vm-unexpected-off",
      resources: [resource],
      series: [{ id: "policy-removed", values: [0], recoveryValues: [1] }],
    });
    expect(recovering.data.unavailableSeriesFingerprints).toEqual([]);
    expect(recovering.data.recoveredSeriesFingerprints).toEqual([]);
    expect(shouldChangeStatus(recovering)).toBe(false);
  });
  test("a VM with unknown power still blocks recovery even when it is not expected to run", async () => {
    const expected: VMwareResource = vmResource({
      id: "expected",
      expectedRunning: true,
      power: 1,
    });
    const unknown: VMwareResource = vmResource({
      id: "unknown",
      expectedRunning: false,
      power: 0,
    });
    const result: Evaluation = await evaluate({
      template: "vmware-vm-unexpected-off",
      resources: [expected, unknown],
      series: [
        { id: "expected", values: [0, 0] },
        { id: "unknown", values: [0, 0] },
      ],
    });
    expect(result.data.unavailableSeriesFingerprints).toEqual([
      vmFingerprint(unknown),
    ]);
    expect(result.data.recoveredSeriesFingerprints).toEqual([
      vmFingerprint(expected),
    ]);
    expect(shouldChangeStatus(result)).toBe(false);
  });
});

describe("VMware affirmative recovery through the actual criteria evaluator", () => {
  test("a healthy datastore cannot recover a different datastore in the dead band", async () => {
    const result: Evaluation = await evaluate({
      template: "vmware-datastore-capacity",
      series: [
        { id: "breaching", values: [95, 96] },
        { id: "dead-band", values: [85, 84] },
        { id: "healthy", values: [80, 79] },
      ],
    });
    expect(result.data.recoveredSeriesFingerprints).toEqual(["healthy"]);
    expect(result.response.matchedCriteria).toHaveLength(2);
    expect(
      result.response.matchedCriteria![0]!.perSeriesMatches.map(
        (match: PerSeriesCriteriaMatch) => {
          return match.fingerprint;
        },
      ),
    ).toEqual(["breaching"]);
    expect(shouldChangeStatus(result)).toBe(true);
  });
  test("mixed healthy and dead-band resources cannot restore monitor status", async () => {
    const result: Evaluation = await evaluate({
      template: "vmware-datastore-capacity",
      series: [
        { id: "dead-band", values: [85] },
        { id: "healthy", values: [50] },
      ],
    });
    expect(result.data.recoveredSeriesFingerprints).toEqual(["healthy"]);
    expect(result.response.matchedCriteria).toHaveLength(1);
    expect(shouldChangeStatus(result)).toBe(false);
  });
  test("all active resources must affirm recovery before monitor status is restored", async () => {
    const result: Evaluation = await evaluate({
      template: "vmware-datastore-capacity",
      series: [
        { id: "recovered", values: [80, 81] },
        { id: "healthy", values: [50] },
      ],
    });
    expect(result.data.recoveredSeriesFingerprints).toEqual([
      "recovered",
      "healthy",
    ]);
    expect(shouldChangeStatus(result)).toBe(true);
    result.data.unavailableSeriesFingerprints = ["missing-resource"];
    expect(shouldChangeStatus(result)).toBe(false);
  });
  test("no criteria matching in the dead band still publishes an empty recovery gate", async () => {
    const result: Evaluation = await evaluate({
      template: "vmware-datastore-capacity",
      series: [{ id: "dead-band", values: [85] }],
    });
    expect(result.data.recoveredSeriesFingerprints).toEqual([]);
    expect(result.response.matchedCriteria).toEqual([]);
    expect(shouldChangeStatus(result)).toBe(false);
  });
  test("recovery requires every sample at or below the recovery threshold", async () => {
    const result: Evaluation = await evaluate({
      template: "vmware-datastore-capacity",
      series: [
        { id: "recovering", values: [80, 85] },
        { id: "recovered", values: [80, 81] },
      ],
    });
    expect(result.data.recoveredSeriesFingerprints).toEqual(["recovered"]);
  });
  test("a disabled healthy criterion cannot recover a resource", async () => {
    const result: Evaluation = await evaluate({
      template: "vmware-datastore-capacity",
      disableHealthy: true,
      series: [{ id: "resource", values: [50] }],
    });
    expect(result.data.recoveredSeriesFingerprints).toEqual([]);
  });
  test("source no-data opens the collection criterion and fresh success explicitly recovers", async () => {
    const absent: Evaluation = await evaluate({
      template: "vmware-collection-unavailable",
      series: [{ id: "source", values: [] }],
    });
    expect(absent.response.matchedCriteria).toHaveLength(1);
    expect(absent.response.matchedCriteria![0]!.criteriaId).toEqual(
      absent.step.data!.monitorCriteria.data!.monitorCriteriaInstanceArray[0]!
        .data!.id,
    );
    expect(absent.data.recoveredSeriesFingerprints).toEqual([]);
    expect(shouldChangeStatus(absent)).toBe(true);
    const fresh: Evaluation = await evaluate({
      template: "vmware-collection-unavailable",
      series: [{ id: "source", values: [1, 1] }],
    });
    expect(fresh.data.recoveredSeriesFingerprints).toEqual(["source"]);
    expect(shouldChangeStatus(fresh)).toBe(true);
  });
  test("generic metrics preserve their current resolution semantics", async () => {
    const result: Evaluation = await evaluate({
      template: "vmware-datastore-capacity",
      monitorType: MonitorType.Metrics,
      series: [{ id: "resource", values: [80] }],
    });
    expect(result.data.recoveredSeriesFingerprints).toBeUndefined();
  });
});

it("does not mistake a low sample within a high-utilization bucket for recovery", async () => {
  // SQL aggregates a bucket containing [99, 99, 50]: A=min50, B=max99.
  const result: Evaluation = await evaluate({
    template: "vmware-datastore-capacity",
    series: [{ id: "mixed-bucket", values: [50], recoveryValues: [99] }],
  });
  expect(result.data.recoveredSeriesFingerprints).toEqual([]);
  expect(result.response.matchedCriteria).toEqual([]);
});

it("quiet non-operational criteria do not count as recovery and status lookup stays project-scoped", async () => {
  const result: Evaluation = await evaluate({
    template: "vmware-datastore-capacity",
    quietNonOperational: true,
    series: [{ id: "resource", values: [80] }],
  });
  expect(result.data.recoveredSeriesFingerprints).toEqual([]);
  expect(MonitorStatusService.findBy).toHaveBeenCalledTimes(1);
  expect(MonitorStatusService.findBy).toHaveBeenCalledWith(
    expect.objectContaining({
      query: { projectId: result.data.projectId, isOperationalState: true },
    }),
  );
  jest.restoreAllMocks();
});
