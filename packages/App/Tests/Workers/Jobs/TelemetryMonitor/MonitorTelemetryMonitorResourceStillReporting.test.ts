import Includes from "Common/Types/BaseDatabase/Includes";
import Dictionary from "Common/Types/Dictionary";
import MetricsAggregationType from "Common/Types/Metrics/MetricsAggregationType";
import MetricsViewConfig from "Common/Types/Metrics/MetricsViewConfig";
import { FilterType } from "Common/Types/Monitor/CriteriaFilter";
import MetricMonitorResponse from "Common/Types/Monitor/MetricMonitor/MetricMonitorResponse";
import MonitorCriteria from "Common/Types/Monitor/MonitorCriteria";
import MonitorCriteriaInstance from "Common/Types/Monitor/MonitorCriteriaInstance";
import MonitorStep from "Common/Types/Monitor/MonitorStep";
import { MonitorStepCephMonitorUtil } from "Common/Types/Monitor/MonitorStepCephMonitor";
import { MonitorStepDockerMonitorUtil } from "Common/Types/Monitor/MonitorStepDockerMonitor";
import { MonitorStepDockerSwarmMonitorUtil } from "Common/Types/Monitor/MonitorStepDockerSwarmMonitor";
import { MonitorStepHostMonitorUtil } from "Common/Types/Monitor/MonitorStepHostMonitor";
import { MonitorStepIoTMonitorUtil } from "Common/Types/Monitor/MonitorStepIoTMonitor";
import { MonitorStepKubernetesMonitorUtil } from "Common/Types/Monitor/MonitorStepKubernetesMonitor";
import { MonitorStepMetricMonitorUtil } from "Common/Types/Monitor/MonitorStepMetricMonitor";
import { MonitorStepPodmanMonitorUtil } from "Common/Types/Monitor/MonitorStepPodmanMonitor";
import { MonitorStepProxmoxMonitorUtil } from "Common/Types/Monitor/MonitorStepProxmoxMonitor";
import { MonitorStepStorageArrayMonitorUtil } from "Common/Types/Monitor/MonitorStepStorageArrayMonitor";
import { MonitorStepVMwareMonitorUtil } from "Common/Types/Monitor/MonitorStepVMwareMonitor";
import MonitorType, {
  MonitorTypeHelper,
} from "Common/Types/Monitor/MonitorType";
import {
  buildHealthyCriteriaInstance,
  buildUnhealthyCriteriaInstance,
} from "Common/Types/Monitor/Recommendation/RecommendationCriteriaBuilder";
import ObjectID from "Common/Types/ObjectID";
import RollingTime from "Common/Types/RollingTime/RollingTime";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * A grouped check with no series cannot say by itself whether every series is
 * gone or nothing arrived at all. So when a criteria of its step counts a
 * missing series as zero, the worker reads the resource's heartbeat over the
 * same window and says what it found on the response (GroupedSeriesGone).
 *
 * Driven through the queue entry point the worker runs, with the datastores
 * replaced, for every metric-backed monitor type, from MonitorTypeHelper's one
 * list. The real criteria evaluator's half of this is in
 * GroupedSeriesGoneRecovery.test.ts.
 */

jest.mock("Common/Server/Infrastructure/Queue", () => {
  return {
    __esModule: true,
    default: { addJob: jest.fn(), getQueue: jest.fn() },
    QueueName: { Telemetry: "Telemetry" },
  };
});

// The worker transitively loads the native `isolated-vm` addon; stub it.
jest.mock("Common/Server/Utils/VM/VMRunner", () => {
  return { __esModule: true, default: {} };
});

jest.mock("Common/Server/Services/MonitorService", () => {
  return {
    __esModule: true,
    default: { findOneById: jest.fn(), findAllBy: jest.fn() },
  };
});

jest.mock("Common/Server/Utils/Monitor/MonitorResource", () => {
  return { __esModule: true, default: { monitorResource: jest.fn() } };
});

jest.mock("Common/Server/Services/MetricService", () => {
  return {
    __esModule: true,
    default: { aggregateBy: jest.fn(), findBy: jest.fn() },
  };
});

jest.mock("Common/Server/Services/MetricTypeService", () => {
  return { __esModule: true, default: { findBy: jest.fn() } };
});

jest.mock("Common/Server/Services/HostService", () => {
  return {
    __esModule: true,
    default: { getExpectedHostIdentifiers: jest.fn(), findOneBy: jest.fn() },
  };
});

jest.mock("Common/Server/Services/IoTFleetService", () => {
  return { __esModule: true, default: { findOneBy: jest.fn() } };
});

jest.mock("Common/Server/Services/IoTDeviceCredentialService", () => {
  return {
    __esModule: true,
    default: { getExpectedDeviceExternalIds: jest.fn() },
  };
});

jest.mock("Common/Server/Utils/Logger", () => {
  return {
    __esModule: true,
    default: {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    },
  };
});

import MonitorService from "Common/Server/Services/MonitorService";
import MonitorResourceUtil from "Common/Server/Utils/Monitor/MonitorResource";
import InfrastructureResourceBinding from "Common/Server/Utils/Monitor/InfrastructureResourceBinding";
import MetricService from "Common/Server/Services/MetricService";
import MetricTypeService from "Common/Server/Services/MetricTypeService";
import ReceivingCoverage from "Common/Server/Utils/Telemetry/ReceivingCoverage";
import { processTelemetryMonitorEvaluationFromQueue } from "../../../../FeatureSet/Workers/Jobs/TelemetryMonitor/MonitorTelemetryMonitor";

const monitorId: ObjectID = ObjectID.generate();
const projectId: ObjectID = ObjectID.generate();

const findOneById: jest.Mock =
  MonitorService.findOneById as unknown as jest.Mock;
const monitorResource: jest.Mock =
  MonitorResourceUtil.monitorResource as unknown as jest.Mock;
const metricAggregateBy: jest.Mock =
  MetricService.aggregateBy as unknown as jest.Mock;
const metricFindBy: jest.Mock = MetricService.findBy as unknown as jest.Mock;
const metricTypeFindBy: jest.Mock =
  MetricTypeService.findBy as unknown as jest.Mock;

const SERIES_KEY: string = "series.key";

function buildView(input: { grouped: boolean }): MetricsViewConfig {
  return {
    queryConfigs: [
      {
        metricAliasData: {
          metricVariable: "a",
          title: "a",
          description: "a",
          legend: "a",
          legendUnit: undefined,
        },
        metricQueryData: {
          filterData: {
            metricName: "test.state.count",
            // The state in a label: a series exists only while something is in it.
            attributes: { status: "red" },
            aggegationType: MetricsAggregationType.Max,
            aggregateBy: {},
          },
          ...(input.grouped ? { groupByAttributeKeys: [SERIES_KEY] } : {}),
        },
      },
    ],
    formulaConfigs: [],
  };
}

function fireCriteria(): MonitorCriteriaInstance {
  return buildUnhealthyCriteriaInstance({
    offlineMonitorStatusId: ObjectID.generate(),
    incidentSeverityId: ObjectID.generate(),
    alertSeverityId: ObjectID.generate(),
    monitorName: "Grouped check",
    metricAlias: "a",
    filterType: FilterType.GreaterThan,
    value: 0,
  });
}

// Recovers at 0, counting a missing series as 0.
function recoverCriteria(): MonitorCriteriaInstance {
  return buildHealthyCriteriaInstance({
    onlineMonitorStatusId: ObjectID.generate(),
    metricAlias: "a",
    filterType: FilterType.EqualTo,
    value: 0,
    treatNoDataAsZero: true,
  });
}

function withCriteria(
  step: MonitorStep,
  instances: Array<MonitorCriteriaInstance>,
): MonitorStep {
  const criteria: MonitorCriteria = new MonitorCriteria();
  criteria.data = { monitorCriteriaInstanceArray: instances };
  step.setMonitorCriteria(criteria);
  return step;
}

// What each monitor type's heartbeat is, for a step of that type.
interface HeartbeatCase {
  step: (view: MetricsViewConfig) => MonitorStep;
  metricNames: Array<string>;
  scope: Dictionary<string>;
}

const ROLLING_TIME: RollingTime = RollingTime.Past5Minutes;

const WITH_A_HEARTBEAT: Partial<Record<MonitorType, HeartbeatCase>> = {
  [MonitorType.Host]: {
    step: (view: MetricsViewConfig): MonitorStep => {
      return new MonitorStep().setHostMonitor({
        ...MonitorStepHostMonitorUtil.getDefault(),
        hostIdentifier: "web-01",
        metricViewConfig: view,
        rollingTime: ROLLING_TIME,
      });
    },
    metricNames: ["system.memory.usage"],
    scope: { "resource.host.name": "web-01" },
  },
  [MonitorType.Kubernetes]: {
    step: (view: MetricsViewConfig): MonitorStep => {
      return new MonitorStep().setKubernetesMonitor({
        ...MonitorStepKubernetesMonitorUtil.getDefault(),
        clusterIdentifier: "prod",
        // Narrower than the heartbeat can be read: it has no namespace.
        resourceFilters: { namespace: "payments" },
        metricViewConfig: view,
        rollingTime: ROLLING_TIME,
      });
    },
    metricNames: ["k8s.node.condition_ready"],
    scope: { "resource.k8s.cluster.name": "prod" },
  },
  [MonitorType.Docker]: {
    step: (view: MetricsViewConfig): MonitorStep => {
      return new MonitorStep().setDockerMonitor({
        ...MonitorStepDockerMonitorUtil.getDefault(),
        hostIdentifier: "docker-01",
        metricViewConfig: view,
        rollingTime: ROLLING_TIME,
      });
    },
    metricNames: ["container.memory.percent"],
    scope: {
      "resource.host.name": "docker-01",
      "resource.container.runtime": "docker",
    },
  },
  [MonitorType.Podman]: {
    step: (view: MetricsViewConfig): MonitorStep => {
      return new MonitorStep().setPodmanMonitor({
        ...MonitorStepPodmanMonitorUtil.getDefault(),
        hostIdentifier: "podman-01",
        metricViewConfig: view,
        rollingTime: ROLLING_TIME,
      });
    },
    metricNames: ["container.memory.percent"],
    scope: {
      "resource.host.name": "podman-01",
      "resource.container.runtime": "podman",
    },
  },
  [MonitorType.DockerSwarm]: {
    step: (view: MetricsViewConfig): MonitorStep => {
      return new MonitorStep().setDockerSwarmMonitor({
        ...MonitorStepDockerSwarmMonitorUtil.getDefault(),
        clusterIdentifier: "swarm-01",
        metricViewConfig: view,
        rollingTime: ROLLING_TIME,
      });
    },
    metricNames: ["container.memory.percent"],
    scope: { "resource.docker.swarm.cluster.name": "swarm-01" },
  },
  [MonitorType.Proxmox]: {
    step: (view: MetricsViewConfig): MonitorStep => {
      return new MonitorStep().setProxmoxMonitor({
        ...MonitorStepProxmoxMonitorUtil.getDefault(),
        clusterIdentifier: "pve-01",
        metricViewConfig: view,
        rollingTime: ROLLING_TIME,
      });
    },
    metricNames: ["pve_up"],
    scope: { "resource.proxmox.cluster.name": "pve-01" },
  },
  [MonitorType.VMware]: {
    step: (view: MetricsViewConfig): MonitorStep => {
      return new MonitorStep().setVMwareMonitor({
        ...MonitorStepVMwareMonitorUtil.getDefault(),
        vcenterIdentifier: "vcenter-01",
        metricViewConfig: view,
        rollingTime: ROLLING_TIME,
      });
    },
    metricNames: ["vcenter.datacenter.cpu.limit"],
    scope: { "resource.vmware.vcenter.name": "vcenter-01" },
  },
  [MonitorType.Ceph]: {
    step: (view: MetricsViewConfig): MonitorStep => {
      return new MonitorStep().setCephMonitor({
        ...MonitorStepCephMonitorUtil.getDefault(),
        clusterIdentifier: "ceph-01",
        metricViewConfig: view,
        rollingTime: ROLLING_TIME,
      });
    },
    metricNames: ["ceph_health_status"],
    scope: { "resource.ceph.cluster.name": "ceph-01" },
  },
  [MonitorType.StorageArray]: {
    step: (view: MetricsViewConfig): MonitorStep => {
      return new MonitorStep().setStorageArrayMonitor({
        ...MonitorStepStorageArrayMonitorUtil.getDefault(),
        arrayIdentifier: "array-01",
        metricViewConfig: view,
        rollingTime: ROLLING_TIME,
      });
    },
    metricNames: ["purefa_info", "purefb_info"],
    scope: { "resource.storage.array.name": "array-01" },
  },
};

/*
 * A Metrics monitor's silence keeps its old meaning, so it asks for nothing,
 * and a fleet sends nothing of its own.
 */
const WITHOUT_A_HEARTBEAT: Partial<
  Record<MonitorType, (view: MetricsViewConfig) => MonitorStep>
> = {
  [MonitorType.Metrics]: (view: MetricsViewConfig): MonitorStep => {
    return new MonitorStep().setMetricMonitor({
      ...MonitorStepMetricMonitorUtil.getDefault(),
      metricViewConfig: view,
      rollingTime: ROLLING_TIME,
    });
  },
  [MonitorType.IoTDevice]: (view: MetricsViewConfig): MonitorStep => {
    return new MonitorStep().setIoTMonitor({
      ...MonitorStepIoTMonitorUtil.getDefault(),
      fleetIdentifier: "fleet-1",
      metricViewConfig: view,
      rollingTime: ROLLING_TIME,
    });
  },
};

const HEARTBEAT_TYPES: Array<MonitorType> = Object.keys(
  WITH_A_HEARTBEAT,
) as Array<MonitorType>;

function heartbeatCase(monitorType: MonitorType): HeartbeatCase {
  return WITH_A_HEARTBEAT[monitorType]!;
}

// The grouped step of a type with a heartbeat, with these criteria.
function groupedStep(
  monitorType: MonitorType,
  instances: Array<MonitorCriteriaInstance> = [
    fireCriteria(),
    recoverCriteria(),
  ],
): MonitorStep {
  return withCriteria(
    heartbeatCase(monitorType).step(buildView({ grouped: true })),
    instances,
  );
}

async function checkOnce(
  monitorType: MonitorType,
  step: MonitorStep,
): Promise<MetricMonitorResponse> {
  findOneById.mockResolvedValue({
    id: monitorId,
    _id: monitorId.toString(),
    projectId,
    monitorType,
    monitorSteps: { data: { monitorStepsInstanceArray: [step] } },
  });

  await processTelemetryMonitorEvaluationFromQueue({
    monitorId: monitorId.toString(),
    projectId: projectId.toString(),
    queuedAt: new Date(),
  });

  expect(monitorResource).toHaveBeenCalledTimes(1);
  return monitorResource.mock.calls[0]![0] as MetricMonitorResponse;
}

interface ReadQuery {
  name?: unknown;
  time?: unknown;
  attributes?: Dictionary<unknown>;
  projectId?: unknown;
}

// Only the heartbeat is read by a list of names; the rest name one metric.
function heartbeatReads(): Array<{
  query: ReadQuery;
  limit?: number;
}> {
  return metricFindBy.mock.calls
    .map((call: Array<unknown>) => {
      return call[0] as { query: ReadQuery; limit?: number };
    })
    .filter((read: { query: ReadQuery }) => {
      return read.query.name instanceof Includes;
    });
}

function givenHeartbeatRows(rows: Array<unknown>): void {
  metricFindBy.mockImplementation(async (data: unknown) => {
    return (data as { query: ReadQuery }).query.name instanceof Includes
      ? rows
      : [];
  });
}

// One series with a value, as a read of a grouped query returns it.
function givenOneSeries(): void {
  metricAggregateBy.mockResolvedValue({
    data: [
      {
        timestamp: new Date(),
        value: 1,
        attributes: { [SERIES_KEY]: "one" },
      },
    ],
  });
}

beforeEach(() => {
  ReceivingCoverage.clearCache();
  findOneById.mockReset();
  monitorResource.mockReset().mockResolvedValue({});
  metricAggregateBy.mockReset().mockResolvedValue({ data: [] });
  metricFindBy.mockReset().mockResolvedValue([]);
  metricTypeFindBy.mockReset().mockResolvedValue([]);
  jest
    .spyOn(ReceivingCoverage, "planTelemetryEvaluation")
    .mockResolvedValue({ evaluate: true, isIngestBehind: false } as never);
  jest
    .spyOn(InfrastructureResourceBinding, "resolveForEvaluation")
    .mockImplementation(async (data: unknown) => {
      return (data as { monitorStep: MonitorStep }).monitorStep as never;
    });
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("A grouped infrastructure check with no series reads its resource's heartbeat", () => {
  test("every metric-backed type says what its heartbeat is, or why it has none", () => {
    for (const monitorType of MonitorTypeHelper.getMetricBackedMonitorTypes()) {
      expect({
        monitorType,
        isCovered: Boolean(
          WITH_A_HEARTBEAT[monitorType] || WITHOUT_A_HEARTBEAT[monitorType],
        ),
      }).toEqual({ monitorType, isCovered: true });
    }
  });

  test.each(HEARTBEAT_TYPES)(
    "%s: the heartbeat comes back, so the response says the resource still reports",
    async (monitorType: MonitorType) => {
      givenHeartbeatRows([{ time: new Date() }]);

      const response: MetricMonitorResponse = await checkOnce(
        monitorType,
        groupedStep(monitorType),
      );

      expect(response.seriesBreakdown).toEqual([]);
      expect(response.resourceStillReporting).toBe(true);
    },
  );

  test.each(HEARTBEAT_TYPES)(
    "%s: no heartbeat, so the response says it does not",
    async (monitorType: MonitorType) => {
      givenHeartbeatRows([]);

      const response: MetricMonitorResponse = await checkOnce(
        monitorType,
        groupedStep(monitorType),
      );

      expect(heartbeatReads()).toHaveLength(1);
      expect(response.resourceStillReporting).toBe(false);
    },
  );

  test.each(HEARTBEAT_TYPES)(
    "%s: it reads one row of its own heartbeat, over the check's window, by the resource's identity alone",
    async (monitorType: MonitorType) => {
      const response: MetricMonitorResponse = await checkOnce(
        monitorType,
        groupedStep(monitorType),
      );

      const [read] = heartbeatReads();
      const expected: HeartbeatCase = heartbeatCase(monitorType);

      expect(read!.limit).toBe(1);
      expect(String(read!.query.projectId)).toBe(projectId.toString());
      expect(read!.query.time).toEqual(response.startAndEndDate);
      expect((read!.query.name as Includes).values).toEqual(
        expected.metricNames,
      );
      // Not the query's own filter, and not a namespace a heartbeat has no value of.
      expect(read!.query.attributes).toEqual(expected.scope);

      // The same identity the check's own query was read with.
      const checkQuery: ReadQuery = (
        metricAggregateBy.mock.calls[0]![0] as { query: ReadQuery }
      ).query;

      expect(checkQuery.attributes).toEqual(
        expect.objectContaining(expected.scope),
      );
    },
  );

  test("a step that names no resource reads the heartbeat of any of the project's", async () => {
    const step: MonitorStep = new MonitorStep().setHostMonitor({
      ...MonitorStepHostMonitorUtil.getDefault(),
      metricViewConfig: buildView({ grouped: true }),
      rollingTime: ROLLING_TIME,
    });

    await checkOnce(
      MonitorType.Host,
      withCriteria(step, [fireCriteria(), recoverCriteria()]),
    );

    const [read] = heartbeatReads();

    expect(read!.query.attributes).toBeUndefined();
  });

  test("it reads the resource's current value, as the check's own query does", async () => {
    // The binding answers with the step as it stands under the cluster's new name.
    jest
      .spyOn(InfrastructureResourceBinding, "resolveForEvaluation")
      .mockImplementation(async () => {
        return groupedStep(MonitorType.Proxmox) as never;
      });

    const savedUnderTheOldName: MonitorStep =
      new MonitorStep().setProxmoxMonitor({
        ...MonitorStepProxmoxMonitorUtil.getDefault(),
        clusterIdentifier: "the-old-name",
        metricViewConfig: buildView({ grouped: true }),
        rollingTime: ROLLING_TIME,
      });

    await checkOnce(MonitorType.Proxmox, savedUnderTheOldName);

    const [read] = heartbeatReads();

    expect(read!.query.attributes).toEqual({
      "resource.proxmox.cluster.name": "pve-01",
    });
  });

  test("a read that fails is no yes, and the check goes on without it", async () => {
    metricFindBy.mockImplementation(async (data: unknown) => {
      if ((data as { query: ReadQuery }).query.name instanceof Includes) {
        throw new Error("ClickHouse is restarting");
      }

      return [];
    });

    const response: MetricMonitorResponse = await checkOnce(
      MonitorType.Ceph,
      groupedStep(MonitorType.Ceph),
    );

    expect(heartbeatReads()).toHaveLength(1);
    expect(response.resourceStillReporting).toBeUndefined();
  });
});

describe("A check that does not need it reads no heartbeat", () => {
  test.each(HEARTBEAT_TYPES)(
    "%s: a check with a series says nothing more",
    async (monitorType: MonitorType) => {
      givenOneSeries();

      const response: MetricMonitorResponse = await checkOnce(
        monitorType,
        groupedStep(monitorType),
      );

      expect(response.seriesBreakdown).toHaveLength(1);
      expect(heartbeatReads()).toHaveLength(0);
      expect(response.resourceStillReporting).toBeUndefined();
    },
  );

  test("an ungrouped check: a missing series is its whole window, and the criteria already matches it", async () => {
    const response: MetricMonitorResponse = await checkOnce(
      MonitorType.Ceph,
      withCriteria(
        heartbeatCase(MonitorType.Ceph).step(buildView({ grouped: false })),
        [fireCriteria(), recoverCriteria()],
      ),
    );

    expect(response.seriesBreakdown).toBeUndefined();
    expect(heartbeatReads()).toHaveLength(0);
    expect(response.resourceStillReporting).toBeUndefined();
  });

  test("no criteria counts a missing series as zero: nothing can match it either way", async () => {
    const response: MetricMonitorResponse = await checkOnce(
      MonitorType.Ceph,
      groupedStep(MonitorType.Ceph, [
        fireCriteria(),
        buildHealthyCriteriaInstance({
          onlineMonitorStatusId: ObjectID.generate(),
          metricAlias: "a",
          filterType: FilterType.EqualTo,
          value: 0,
        }),
      ]),
    );

    expect(response.seriesBreakdown).toEqual([]);
    expect(heartbeatReads()).toHaveLength(0);
    expect(response.resourceStillReporting).toBeUndefined();
  });

  test("only a criteria that opens something counts it as zero: it could not act on no series", async () => {
    const response: MetricMonitorResponse = await checkOnce(
      MonitorType.Ceph,
      groupedStep(MonitorType.Ceph, [
        buildUnhealthyCriteriaInstance({
          offlineMonitorStatusId: ObjectID.generate(),
          incidentSeverityId: ObjectID.generate(),
          alertSeverityId: ObjectID.generate(),
          monitorName: "Grouped check",
          metricAlias: "a",
          filterType: FilterType.LessThan,
          value: 1,
          treatNoDataAsZero: true,
        }),
      ]),
    );

    expect(heartbeatReads()).toHaveLength(0);
    expect(response.resourceStillReporting).toBeUndefined();
  });

  test.each(Object.keys(WITHOUT_A_HEARTBEAT) as Array<MonitorType>)(
    "%s: it has none to read",
    async (monitorType: MonitorType) => {
      const response: MetricMonitorResponse = await checkOnce(
        monitorType,
        withCriteria(
          WITHOUT_A_HEARTBEAT[monitorType]!(buildView({ grouped: true })),
          [fireCriteria(), recoverCriteria()],
        ),
      );

      expect(response.seriesBreakdown).toEqual([]);
      expect(heartbeatReads()).toHaveLength(0);
      expect(response.resourceStillReporting).toBeUndefined();
    },
  );
});
