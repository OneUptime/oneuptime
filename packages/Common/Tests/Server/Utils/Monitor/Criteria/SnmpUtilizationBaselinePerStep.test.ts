import SnmpMonitorCriteria, {
  SNMP_INTERFACE_NAME_ATTRIBUTE,
} from "../../../../../Server/Utils/Monitor/Criteria/SnmpMonitorCriteria";
import PerEntityCriteriaFanOut, {
  FanOutEntity,
} from "../../../../../Server/Utils/Monitor/PerEntityCriteriaFanOut";
import MetricBaselineService, {
  BaselineSummary,
  MetricBaselineQuery,
  MetricBaselineRequest,
} from "../../../../../Server/Services/MetricBaselineService";
import AggregationInterval from "../../../../../Types/BaseDatabase/AggregationInterval";
import AggregationType from "../../../../../Types/BaseDatabase/AggregationType";
import Includes from "../../../../../Types/BaseDatabase/Includes";
import {
  CheckOn,
  CriteriaFilter,
  FilterType,
} from "../../../../../Types/Monitor/CriteriaFilter";
import MonitorCriteriaInstance from "../../../../../Types/Monitor/MonitorCriteriaInstance";
import MonitorMetricType from "../../../../../Types/Monitor/MonitorMetricType";
import MonitorStepSeries, {
  MONITOR_STEP_ID_ATTRIBUTE,
  MonitorStepSeriesScope,
} from "../../../../../Types/Monitor/MonitorStepSeries";
import SnmpInterface from "../../../../../Types/Monitor/SnmpMonitor/SnmpInterface";
import ObjectID from "../../../../../Types/ObjectID";
import ProbeMonitorResponse from "../../../../../Types/Probe/ProbeMonitorResponse";
import FilterCondition from "../../../../../Types/Filter/FilterCondition";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { SpyInstance } from "jest-mock";

/*
 * AN SNMP INTERFACE'S UTILIZATION, JUDGED AGAINST ITS OWN STEP'S HISTORY
 * (#10985).
 *
 * The anomaly condition used to read the monitor's hourly rollup, keyed by
 * the monitor alone: both steps of a two-step Network Device monitor, and
 * every port of a device, in one mean and spread. It now reads the rows its
 * step's checks wrote - of the interfaces in scope, the busiest of them each
 * minute, as the check takes the busiest. These pin what it asks for; that
 * the read does what it asks of a real ClickHouse is
 * SnmpUtilizationBaselineClickhouseIntegration.test.ts.
 */

const STEP_A: string = "0193a0a0-0000-7000-8000-00000010985a";
const STEP_B: string = "0193a0a0-0000-7000-8000-00000010985b";

function scopeOf(stepId: string, stepCount: number): MonitorStepSeriesScope {
  return {
    monitorStepId: stepId,
    readsRowsWithoutStep: stepCount <= 1,
  };
}

function port(input: {
  name: string;
  alias?: string | undefined;
  utilizationPercent?: number | undefined;
}): SnmpInterface {
  return {
    interfaceIndex: 1,
    name: input.name,
    alias: input.alias,
    isOperationallyUp: true,
    isAdministrativelyUp: true,
    utilizationPercent: input.utilizationPercent,
  };
}

function anomalyFilter(
  interfaceName?: string,
  filterType: FilterType = FilterType.AnomalouslyHigh,
): CriteriaFilter {
  return {
    checkOn: CheckOn.SnmpInterfaceUtilizationPercent,
    filterType: filterType,
    value: undefined,
    ...(interfaceName !== undefined
      ? { snmpMonitorOptions: { interfaceName: interfaceName } }
      : {}),
  };
}

function walk(input: {
  monitorId: ObjectID;
  projectId: ObjectID;
  stepId: string;
  interfaces: Array<SnmpInterface>;
}): ProbeMonitorResponse {
  return {
    projectId: input.projectId,
    monitorId: input.monitorId,
    monitorStepId: new ObjectID(input.stepId),
    probeId: ObjectID.generate(),
    failureCause: "",
    monitoredAt: new Date(),
    snmpResponse: {
      isOnline: true,
      responseTimeInMs: 30,
      failureCause: "",
      oidResponses: [],
      interfaces: input.interfaces,
    },
  };
}

function baselineOf(input: {
  mean: number;
  stddev: number;
  isReliable?: boolean;
}): BaselineSummary {
  return {
    sampleCount: 840,
    mean: input.mean,
    stddev: input.stddev,
    median: input.mean,
    p95: input.mean + 2 * input.stddev,
    minObserved: input.mean - 3 * input.stddev,
    maxObserved: input.mean + 3 * input.stddev,
    isReliable: input.isReliable ?? true,
    windowDays: 14,
    hourOfWeek: 33,
  };
}

function queryOf(request: MetricBaselineRequest): MetricBaselineQuery {
  expect(request.query).toBeDefined();
  return request.query!;
}

describe("SnmpMonitorCriteria.getUtilizationBaselineQuery", () => {
  describe("the step", () => {
    test("a step of a monitor with several reads its own rows alone, and never the monitor's rollup", () => {
      const query: MetricBaselineQuery | undefined =
        SnmpMonitorCriteria.getUtilizationBaselineQuery({
          stepScope: scopeOf(STEP_A, 2),
          criteriaFilter: anomalyFilter(),
          interfaces: [port({ name: "Gi0/1", utilizationPercent: 40 })],
        });

      expect(query).toEqual({
        aggregationType: AggregationType.Max,
        isNarrowedByAttributes: true,
        interval: AggregationInterval.Minute,
        scope: {
          attributes: { [MONITOR_STEP_ID_ATTRIBUTE]: STEP_A },
          groupByAttributeKeys: [],
        },
        readsOnlyItsOwnRows: true,
      });
    });

    test("the step of a monitor with one also reads the rows written before rows named their step, and may fall back on the rollup", () => {
      const query: MetricBaselineQuery | undefined =
        SnmpMonitorCriteria.getUtilizationBaselineQuery({
          stepScope: scopeOf(STEP_A, 1),
          criteriaFilter: anomalyFilter(),
          interfaces: [port({ name: "Gi0/1", utilizationPercent: 40 })],
        });

      const stepFilter: unknown =
        query?.scope?.attributes[MONITOR_STEP_ID_ATTRIBUTE];

      expect(stepFilter).toBeInstanceOf(Includes);
      expect((stepFilter as Includes).values).toEqual([STEP_A, ""]);
      expect(query?.readsOnlyItsOwnRows).toBe(false);
      expect(query?.aggregationType).toBe(AggregationType.Max);
    });

    test("it reads exactly what a step's windows read", () => {
      for (const stepCount of [0, 1, 2, 5]) {
        const scope: MonitorStepSeriesScope = scopeOf(STEP_B, stepCount);

        expect(
          SnmpMonitorCriteria.getUtilizationBaselineQuery({
            stepScope: scope,
            criteriaFilter: anomalyFilter(),
            interfaces: [port({ name: "eth0", utilizationPercent: 3 })],
          })?.scope?.attributes,
        ).toEqual(MonitorStepSeries.toQueryAttributes(scope));
      }
    });

    test("two steps never share a read", () => {
      const first: MetricBaselineQuery | undefined =
        SnmpMonitorCriteria.getUtilizationBaselineQuery({
          stepScope: scopeOf(STEP_A, 2),
          criteriaFilter: anomalyFilter(),
          interfaces: [port({ name: "Gi0/1", utilizationPercent: 40 })],
        });
      const second: MetricBaselineQuery | undefined =
        SnmpMonitorCriteria.getUtilizationBaselineQuery({
          stepScope: scopeOf(STEP_B, 2),
          criteriaFilter: anomalyFilter(),
          interfaces: [port({ name: "Gi0/1", utilizationPercent: 40 })],
        });

      expect(first?.scope).not.toEqual(second?.scope);
    });

    test("with no step and nothing else narrowing it, the monitor's rollup is read as before", () => {
      expect(
        SnmpMonitorCriteria.getUtilizationBaselineQuery({
          stepScope: undefined,
          criteriaFilter: anomalyFilter(),
          interfaces: [port({ name: "Gi0/1", utilizationPercent: 40 })],
        }),
      ).toBeUndefined();
    });
  });

  describe("the interfaces", () => {
    test("every interface, for an empty name or *: no interface narrows the read", () => {
      for (const interfaceName of [undefined, "", "   ", "*", " * "]) {
        const query: MetricBaselineQuery | undefined =
          SnmpMonitorCriteria.getUtilizationBaselineQuery({
            stepScope: scopeOf(STEP_A, 2),
            criteriaFilter: anomalyFilter(interfaceName),
            interfaces: [
              port({ name: "Gi0/1", utilizationPercent: 40 }),
              port({ name: "Gi0/2", utilizationPercent: 2 }),
            ],
          });

        expect(
          query?.scope?.attributes[SNMP_INTERFACE_NAME_ATTRIBUTE],
        ).toBeUndefined();
      }
    });

    test("a named interface reads that interface's rows, by the name its rows carry", () => {
      const query: MetricBaselineQuery | undefined =
        SnmpMonitorCriteria.getUtilizationBaselineQuery({
          stepScope: scopeOf(STEP_A, 2),
          // Typed in another case: the walk's name is what the rows say.
          criteriaFilter: anomalyFilter("gi0/1"),
          interfaces: [port({ name: "Gi0/1", utilizationPercent: 40 })],
        });

      expect(query?.scope?.attributes).toEqual({
        [MONITOR_STEP_ID_ATTRIBUTE]: STEP_A,
        [SNMP_INTERFACE_NAME_ATTRIBUTE]: "Gi0/1",
      });
    });

    test("an interface matched by its alias is read by its name", () => {
      const query: MetricBaselineQuery | undefined =
        SnmpMonitorCriteria.getUtilizationBaselineQuery({
          stepScope: scopeOf(STEP_A, 2),
          criteriaFilter: anomalyFilter("Uplink to core"),
          interfaces: [
            port({
              name: "TenGigabitEthernet1/0/1",
              alias: "Uplink to core",
              utilizationPercent: 60,
            }),
          ],
        });

      expect(query?.scope?.attributes[SNMP_INTERFACE_NAME_ATTRIBUTE]).toBe(
        "TenGigabitEthernet1/0/1",
      );
    });

    test("several interfaces a name matches are read together, each once, in order", () => {
      const query: MetricBaselineQuery | undefined =
        SnmpMonitorCriteria.getUtilizationBaselineQuery({
          stepScope: scopeOf(STEP_A, 2),
          criteriaFilter: anomalyFilter("uplink"),
          interfaces: [
            port({ name: "Gi0/2", alias: "uplink", utilizationPercent: 10 }),
            port({ name: "Gi0/1", alias: "uplink", utilizationPercent: 20 }),
            port({ name: "Gi0/2", alias: "uplink", utilizationPercent: 10 }),
          ],
        });

      const names: unknown =
        query?.scope?.attributes[SNMP_INTERFACE_NAME_ATTRIBUTE];

      expect(names).toBeInstanceOf(Includes);
      expect((names as Includes).values).toEqual(["Gi0/1", "Gi0/2"]);
    });

    test("an interface the walk gave no name is read as the rows that name none", () => {
      const query: MetricBaselineQuery | undefined =
        SnmpMonitorCriteria.getUtilizationBaselineQuery({
          stepScope: scopeOf(STEP_A, 2),
          criteriaFilter: anomalyFilter("Uplink"),
          interfaces: [
            port({ name: "", alias: "Uplink", utilizationPercent: 33 }),
          ],
        });

      expect(query?.scope?.attributes[SNMP_INTERFACE_NAME_ATTRIBUTE]).toBe("");
    });

    test("a named interface with no step narrows the read by itself, and may fall back on the rollup", () => {
      const query: MetricBaselineQuery | undefined =
        SnmpMonitorCriteria.getUtilizationBaselineQuery({
          stepScope: undefined,
          criteriaFilter: anomalyFilter("Gi0/1"),
          interfaces: [port({ name: "Gi0/1", utilizationPercent: 40 })],
        });

      expect(query?.scope?.attributes).toEqual({
        [SNMP_INTERFACE_NAME_ATTRIBUTE]: "Gi0/1",
      });
      expect(query?.isNarrowedByAttributes).toBe(true);
      expect(query?.readsOnlyItsOwnRows).toBe(false);
    });

    test("with nothing in scope, no interface narrows the read: an empty list would read them all", () => {
      const query: MetricBaselineQuery | undefined =
        SnmpMonitorCriteria.getUtilizationBaselineQuery({
          stepScope: scopeOf(STEP_A, 2),
          criteriaFilter: anomalyFilter("Gi0/9"),
          interfaces: [],
        });

      expect(
        query?.scope?.attributes[SNMP_INTERFACE_NAME_ATTRIBUTE],
      ).toBeUndefined();
    });
  });
});

describe("SnmpMonitorCriteria's anomaly condition, judged against each step's own history", () => {
  let getBaselineSpy: SpyInstance<typeof MetricBaselineService.getBaseline>;
  let requests: Array<MetricBaselineRequest>;

  const projectId: ObjectID = ObjectID.generate();
  const monitorId: ObjectID = ObjectID.generate();

  /*
   * A two-step monitor: a core switch whose busiest port runs at 70% and an
   * access switch whose busiest runs at 5% - the baselines each step's own
   * rows give. The monitor's rollup would have mixed them into one.
   */
  const OWN_BASELINES: Record<string, BaselineSummary> = {
    [STEP_A]: baselineOf({ mean: 70, stddev: 3 }),
    [STEP_B]: baselineOf({ mean: 5, stddev: 1 }),
  };

  beforeEach(() => {
    requests = [];
    getBaselineSpy = jest
      .spyOn(MetricBaselineService, "getBaseline")
      .mockImplementation(
        async (
          request: MetricBaselineRequest,
        ): Promise<BaselineSummary | null> => {
          requests.push(request);

          const step: unknown =
            request.query?.scope?.attributes[MONITOR_STEP_ID_ATTRIBUTE];

          return typeof step === "string"
            ? OWN_BASELINES[step] || null
            : // The monitor's rollup: both steps' samples, mixed.
              baselineOf({ mean: 37.5, stddev: 32.5 });
        },
      );
  });

  afterEach(() => {
    getBaselineSpy.mockRestore();
  });

  async function judge(input: {
    stepId: string;
    stepCount: number;
    utilizationPercent: number;
    filterType?: FilterType;
  }): Promise<string | null> {
    return await SnmpMonitorCriteria.isMonitorInstanceCriteriaFilterMet({
      dataToProcess: walk({
        projectId,
        monitorId,
        stepId: input.stepId,
        interfaces: [
          port({ name: "Gi0/1", utilizationPercent: input.utilizationPercent }),
        ],
      }),
      criteriaFilter: anomalyFilter(undefined, input.filterType),
      stepScope: scopeOf(input.stepId, input.stepCount),
    });
  }

  test("the same 75% is an anomaly on the access switch and normal on the core switch", async () => {
    const access: string | null = await judge({
      stepId: STEP_B,
      stepCount: 2,
      utilizationPercent: 75,
    });
    const core: string | null = await judge({
      stepId: STEP_A,
      stepCount: 2,
      utilizationPercent: 75,
    });

    expect(access).toContain("75.00%");
    expect(access).toContain("mean 5.00%");
    expect(core).toBeNull();
  });

  test("the core switch dropping to 5% is anomalously low against its own history", async () => {
    const core: string | null = await judge({
      stepId: STEP_A,
      stepCount: 2,
      utilizationPercent: 5,
      filterType: FilterType.AnomalouslyLow,
    });

    expect(core).toContain("below");
    expect(core).toContain("mean 70.00%");
  });

  test("each read names its own step, the utilization series, the monitor and a minute's busiest", async () => {
    await judge({ stepId: STEP_A, stepCount: 2, utilizationPercent: 75 });
    await judge({ stepId: STEP_B, stepCount: 2, utilizationPercent: 75 });

    expect(requests).toHaveLength(2);

    for (const [index, stepId] of [STEP_A, STEP_B].entries()) {
      const request: MetricBaselineRequest = requests[index]!;

      expect(request.metricName).toBe(
        MonitorMetricType.SnmpInterfaceUtilizationPercent,
      );
      expect(request.primaryEntityId).toBe(monitorId.toString());
      expect(request.projectId).toBe(projectId.toString());
      expect(queryOf(request)).toMatchObject({
        aggregationType: AggregationType.Max,
        interval: AggregationInterval.Minute,
        readsOnlyItsOwnRows: true,
        scope: {
          attributes: { [MONITOR_STEP_ID_ATTRIBUTE]: stepId },
          groupByAttributeKeys: [],
        },
      });
    }
  });

  test("a step whose own history is still learning raises nothing, whatever it reads", async () => {
    getBaselineSpy.mockResolvedValue(
      baselineOf({ mean: 5, stddev: 1, isReliable: false }),
    );

    expect(
      await judge({ stepId: STEP_B, stepCount: 2, utilizationPercent: 99 }),
    ).toBeNull();
  });

  test("a step with no history at all raises nothing", async () => {
    getBaselineSpy.mockResolvedValue(null);

    expect(
      await judge({ stepId: STEP_B, stepCount: 2, utilizationPercent: 99 }),
    ).toBeNull();
  });

  test("a check judged without its step reads the monitor's rollup, as before", async () => {
    const result: string | null =
      await SnmpMonitorCriteria.isMonitorInstanceCriteriaFilterMet({
        dataToProcess: walk({
          projectId,
          monitorId,
          stepId: STEP_B,
          interfaces: [port({ name: "Gi0/1", utilizationPercent: 75 })],
        }),
        criteriaFilter: anomalyFilter(),
      });

    expect(requests[0]?.query).toBeUndefined();
    // Against both steps' samples the access switch's 75% looked normal.
    expect(result).toBeNull();
  });

  test("a static threshold reads no baseline at all", async () => {
    const result: string | null =
      await SnmpMonitorCriteria.isMonitorInstanceCriteriaFilterMet({
        dataToProcess: walk({
          projectId,
          monitorId,
          stepId: STEP_B,
          interfaces: [port({ name: "Gi0/1", utilizationPercent: 75 })],
        }),
        criteriaFilter: {
          checkOn: CheckOn.SnmpInterfaceUtilizationPercent,
          filterType: FilterType.GreaterThan,
          value: 80,
        },
        stepScope: scopeOf(STEP_B, 2),
      });

    expect(result).toBeNull();
    expect(getBaselineSpy).not.toHaveBeenCalled();
  });

  test("a criteria naming one interface is judged against that interface's history", async () => {
    await SnmpMonitorCriteria.isMonitorInstanceCriteriaFilterMet({
      dataToProcess: walk({
        projectId,
        monitorId,
        stepId: STEP_A,
        interfaces: [
          port({ name: "Gi0/1", utilizationPercent: 75 }),
          port({ name: "Gi0/2", alias: "Backup", utilizationPercent: 4 }),
        ],
      }),
      criteriaFilter: anomalyFilter("backup"),
      stepScope: scopeOf(STEP_A, 2),
    });

    expect(queryOf(requests[0]!).scope?.attributes).toEqual({
      [MONITOR_STEP_ID_ATTRIBUTE]: STEP_A,
      [SNMP_INTERFACE_NAME_ATTRIBUTE]: "Gi0/2",
    });
  });

  test("an Interface Name of * fanned out per interface judges each interface against its own history", async () => {
    const criteriaInstance: MonitorCriteriaInstance =
      new MonitorCriteriaInstance();
    criteriaInstance.data = {
      id: "busy-port",
      monitorStatusId: undefined,
      filterCondition: FilterCondition.All,
      filters: [anomalyFilter("*")],
      incidents: [],
      alerts: [],
      name: "Busy port",
      description: "",
    };

    const dataToProcess: ProbeMonitorResponse = walk({
      projectId,
      monitorId,
      stepId: STEP_A,
      interfaces: [
        port({ name: "Gi0/1", utilizationPercent: 75 }),
        port({ name: "Gi0/2", utilizationPercent: 4 }),
      ],
    });

    const entities: Array<FanOutEntity> =
      PerEntityCriteriaFanOut.getSnmpInterfaceEntities({
        dataToProcess,
        criteriaInstance,
      });

    expect(entities).toHaveLength(2);

    for (const entity of entities) {
      await SnmpMonitorCriteria.isMonitorInstanceCriteriaFilterMet({
        dataToProcess,
        criteriaFilter: entity.narrowFilter(anomalyFilter("*")),
        stepScope: scopeOf(STEP_A, 2),
      });
    }

    expect(
      requests.map((request: MetricBaselineRequest): unknown => {
        return queryOf(request).scope?.attributes[
          SNMP_INTERFACE_NAME_ATTRIBUTE
        ];
      }),
    ).toEqual(["Gi0/1", "Gi0/2"]);
  });
});
