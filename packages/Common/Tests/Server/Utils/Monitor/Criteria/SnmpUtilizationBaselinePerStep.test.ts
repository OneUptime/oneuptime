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
  MetricSeriesBaselines,
} from "../../../../../Server/Services/MetricBaselineService";
import AggregatedModel from "../../../../../Types/BaseDatabase/AggregatedModel";
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
import MetricSeriesFingerprint from "../../../../../Utils/Metrics/MetricSeriesFingerprint";
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
 * AN SNMP INTERFACE'S UTILIZATION, JUDGED AGAINST ITS OWN HISTORY ON ITS OWN
 * STEP (#10985).
 *
 * The anomaly condition used to read the monitor's hourly rollup, keyed by
 * the monitor alone: both steps of a two-step Network Device monitor, and
 * every port of a device, in one mean and spread. It now reads, once an hour
 * a step, one series a port from the rows its step's checks wrote, and judges
 * each in-scope port against its own. These pin what it asks for and how it
 * judges the answer; that the read does what it asks of a real ClickHouse is
 * SnmpUtilizationBaselineClickhouseIntegration.test.ts.
 */

const STEP_A: string = "0193a0a0-0000-7000-8000-00000010985a";
const STEP_B: string = "0193a0a0-0000-7000-8000-00000010985b";

// A step's scope on a monitor of this many steps, as the evaluator makes it.
function scopeOf(stepId: string, stepCount: number): MonitorStepSeriesScope {
  return MonitorStepSeries.getScope({
    monitorStepId: stepId,
    monitorSteps: {
      data: {
        monitorStepsInstanceArray: new Array(stepCount).fill({}),
      },
    } as never,
  });
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
    sampleCount: 168,
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

// An hour's baselines of a step: one series a port, named as its rows name it.
function seriesOf(
  ports: Record<string, BaselineSummary>,
  fallback: BaselineSummary | null = null,
): MetricSeriesBaselines {
  return {
    series: new Map<string, BaselineSummary>(
      Object.entries(ports).map(
        ([name, baseline]: [string, BaselineSummary]): [
          string,
          BaselineSummary,
        ] => {
          return [
            SnmpMonitorCriteria.getInterfaceSeriesFingerprint(name),
            baseline,
          ];
        },
      ),
    ),
    fallback,
  };
}

describe("SnmpMonitorCriteria.getUtilizationBaselineQuery", () => {
  test("a step of a monitor with several reads its own rows alone, a series a port, and never the monitor's rollup", () => {
    expect(
      SnmpMonitorCriteria.getUtilizationBaselineQuery(scopeOf(STEP_A, 2)),
    ).toEqual({
      aggregationType: AggregationType.Max,
      isNarrowedByAttributes: true,
      interval: AggregationInterval.Minute,
      scope: {
        attributes: { [MONITOR_STEP_ID_ATTRIBUTE]: STEP_A },
        groupByAttributeKeys: [SNMP_INTERFACE_NAME_ATTRIBUTE],
      },
      readsOnlyItsOwnRows: true,
    });
  });

  test("the step of a monitor with one also reads the rows written before rows named their step, and may fall back on the rollup", () => {
    const query: MetricBaselineQuery =
      SnmpMonitorCriteria.getUtilizationBaselineQuery(scopeOf(STEP_A, 1));

    const stepFilter: unknown =
      query.scope?.attributes[MONITOR_STEP_ID_ATTRIBUTE];

    expect(stepFilter).toBeInstanceOf(Includes);
    expect((stepFilter as Includes).values).toEqual([STEP_A, ""]);
    expect(query.readsOnlyItsOwnRows).toBe(false);
    expect(query.scope?.groupByAttributeKeys).toEqual([
      SNMP_INTERFACE_NAME_ATTRIBUTE,
    ]);
  });

  test("it reads exactly the rows a step's windows read", () => {
    for (const stepCount of [0, 1, 2, 5]) {
      const scope: MonitorStepSeriesScope = scopeOf(STEP_B, stepCount);

      expect(
        SnmpMonitorCriteria.getUtilizationBaselineQuery(scope).scope
          ?.attributes,
      ).toEqual(MonitorStepSeries.toQueryAttributes(scope));
    }
  });

  test("two steps never share a read", () => {
    expect(
      SnmpMonitorCriteria.getUtilizationBaselineQuery(scopeOf(STEP_A, 2)).scope,
    ).not.toEqual(
      SnmpMonitorCriteria.getUtilizationBaselineQuery(scopeOf(STEP_B, 2)).scope,
    );
  });

  test("with no step, it reads every row of the monitor, still a series a port", () => {
    expect(SnmpMonitorCriteria.getUtilizationBaselineQuery(undefined)).toEqual({
      aggregationType: AggregationType.Max,
      isNarrowedByAttributes: true,
      interval: AggregationInterval.Minute,
      scope: {
        attributes: {},
        groupByAttributeKeys: [SNMP_INTERFACE_NAME_ATTRIBUTE],
      },
      readsOnlyItsOwnRows: false,
    });
  });
});

describe("SnmpMonitorCriteria.getInterfaceSeriesFingerprint", () => {
  test("is the fingerprint the baseline read gives a port's rows", () => {
    for (const name of ["Gi0/1", "TenGigabitEthernet1/0/1", "eth0.100"]) {
      expect(SnmpMonitorCriteria.getInterfaceSeriesFingerprint(name)).toBe(
        MetricSeriesFingerprint.computeFingerprint(
          MetricSeriesFingerprint.extractSeriesLabels({
            sample: {
              attributes: { [SNMP_INTERFACE_NAME_ATTRIBUTE]: name },
            } as unknown as AggregatedModel,
            attributeKeys: [SNMP_INTERFACE_NAME_ATTRIBUTE],
          }),
        ),
      );
    }
  });

  test("two ports never share one, and a port the walk gave no name has the rows' that name none", () => {
    const fingerprints: Set<string> = new Set<string>(
      ["Gi0/1", "Gi0/2", "gi0/1", ""].map((name: string): string => {
        return SnmpMonitorCriteria.getInterfaceSeriesFingerprint(name);
      }),
    );

    expect(fingerprints.size).toBe(4);
    expect(SnmpMonitorCriteria.getInterfaceSeriesFingerprint(undefined)).toBe(
      SnmpMonitorCriteria.getInterfaceSeriesFingerprint(""),
    );
    expect(SnmpMonitorCriteria.getInterfaceSeriesFingerprint("Gi0/1")).not.toBe(
      MetricSeriesFingerprint.WholeMonitorFingerprint,
    );
  });
});

describe("SnmpMonitorCriteria's anomaly condition, each port judged against its own history on its own step", () => {
  let getSeriesBaselinesSpy: SpyInstance<
    typeof MetricBaselineService.getSeriesBaselines
  >;
  let requests: Array<MetricBaselineRequest>;

  const projectId: ObjectID = ObjectID.generate();
  const monitorId: ObjectID = ObjectID.generate();

  /*
   * A two-step monitor: a core switch, its uplink around 70% and a backup
   * link around 3%, and an access switch whose ports run around 5%. The
   * monitor's rollup would have put all of them in one mean and spread.
   */
  const STEP_BASELINES: Record<string, MetricSeriesBaselines> = {
    [STEP_A]: seriesOf({
      Uplink0: baselineOf({ mean: 70, stddev: 3 }),
      Backup0: baselineOf({ mean: 3, stddev: 0.5 }),
    }),
    [STEP_B]: seriesOf({
      Fa0: baselineOf({ mean: 5, stddev: 1 }),
      Fa1: baselineOf({ mean: 5, stddev: 1 }),
    }),
  };

  beforeEach(() => {
    requests = [];
    getSeriesBaselinesSpy = jest
      .spyOn(MetricBaselineService, "getSeriesBaselines")
      .mockImplementation(
        async (
          request: MetricBaselineRequest & { query: MetricBaselineQuery },
        ): Promise<MetricSeriesBaselines> => {
          requests.push(request);

          const step: unknown =
            request.query.scope?.attributes[MONITOR_STEP_ID_ATTRIBUTE];

          return (
            (typeof step === "string" && STEP_BASELINES[step]) || seriesOf({})
          );
        },
      );
  });

  afterEach(() => {
    getSeriesBaselinesSpy.mockRestore();
  });

  async function judge(input: {
    stepId: string;
    stepCount?: number;
    ports: Array<SnmpInterface>;
    filter?: CriteriaFilter;
  }): Promise<string | null> {
    return await SnmpMonitorCriteria.isMonitorInstanceCriteriaFilterMet({
      dataToProcess: walk({
        projectId,
        monitorId,
        stepId: input.stepId,
        interfaces: input.ports,
      }),
      criteriaFilter: input.filter || anomalyFilter(),
      stepScope: scopeOf(input.stepId, input.stepCount ?? 2),
    });
  }

  test("the same 75% is an anomaly on the access switch and normal on the core's uplink", async () => {
    const access: string | null = await judge({
      stepId: STEP_B,
      ports: [
        port({ name: "Fa0", utilizationPercent: 75 }),
        port({ name: "Fa1", utilizationPercent: 5 }),
      ],
    });
    const core: string | null = await judge({
      stepId: STEP_A,
      ports: [
        port({ name: "Uplink0", utilizationPercent: 75 }),
        port({ name: "Backup0", utilizationPercent: 3 }),
      ],
    });

    expect(access).toContain("SNMP interface Fa0 utilization 75.00%");
    expect(access).toContain("mean 5.00%");
    expect(core).toBeNull();
  });

  test("a quiet port gone busy is caught though the busiest port is at its usual level", async () => {
    const result: string | null = await judge({
      stepId: STEP_A,
      ports: [
        port({ name: "Uplink0", utilizationPercent: 71 }),
        port({ name: "Backup0", utilizationPercent: 40 }),
      ],
    });

    expect(result).toContain("SNMP interface Backup0 utilization 40.00%");
    expect(result).toContain("above its same-hour baseline");
    expect(result).toContain("mean 3.00%");
  });

  test("the uplink dropping to 8% is anomalously low against its own history", async () => {
    const result: string | null = await judge({
      stepId: STEP_A,
      ports: [
        port({ name: "Uplink0", utilizationPercent: 8 }),
        port({ name: "Backup0", utilizationPercent: 3 }),
      ],
      filter: anomalyFilter(undefined, FilterType.AnomalouslyLow),
    });

    expect(result).toContain("SNMP interface Uplink0 utilization 8.00%");
    expect(result).toContain("below its same-hour baseline");
  });

  test("Anomalous reads either way; AnomalouslyHigh never a drop, AnomalouslyLow never a rise", async () => {
    const dropped: Array<SnmpInterface> = [
      port({ name: "Uplink0", utilizationPercent: 8 }),
    ];
    const rose: Array<SnmpInterface> = [
      port({ name: "Backup0", utilizationPercent: 40 }),
    ];

    expect(
      await judge({
        stepId: STEP_A,
        ports: dropped,
        filter: anomalyFilter(undefined, FilterType.Anomalous),
      }),
    ).toContain("below");
    expect(
      await judge({
        stepId: STEP_A,
        ports: rose,
        filter: anomalyFilter(undefined, FilterType.Anomalous),
      }),
    ).toContain("above");
    expect(
      await judge({
        stepId: STEP_A,
        ports: dropped,
        filter: anomalyFilter(undefined, FilterType.AnomalouslyHigh),
      }),
    ).toBeNull();
    expect(
      await judge({
        stepId: STEP_A,
        ports: rose,
        filter: anomalyFilter(undefined, FilterType.AnomalouslyLow),
      }),
    ).toBeNull();
  });

  test("with several ports outside their bands, the furthest is named and the others counted", async () => {
    const result: string | null = await judge({
      stepId: STEP_B,
      ports: [
        port({ name: "Fa0", utilizationPercent: 20 }),
        port({ name: "Fa1", utilizationPercent: 90 }),
      ],
    });

    expect(result).toMatch(/^SNMP interface Fa1 utilization 90\.00%/);
    expect(result).toContain(
      "1 more interface(s) are outside their own baselines too: Fa0.",
    );
  });

  test("each read is the step's own: the utilization series of the monitor, a series a port, once for every port", async () => {
    await judge({
      stepId: STEP_A,
      ports: [
        port({ name: "Uplink0", utilizationPercent: 75 }),
        port({ name: "Backup0", utilizationPercent: 3 }),
      ],
    });
    await judge({
      stepId: STEP_B,
      ports: [port({ name: "Fa0", utilizationPercent: 75 })],
    });

    expect(requests).toHaveLength(2);

    for (const [index, stepId] of [STEP_A, STEP_B].entries()) {
      const request: MetricBaselineRequest = requests[index]!;

      expect(request.metricName).toBe(
        MonitorMetricType.SnmpInterfaceUtilizationPercent,
      );
      expect(request.primaryEntityId).toBe(monitorId.toString());
      expect(request.projectId).toBe(projectId.toString());
      expect(request.query).toEqual(
        SnmpMonitorCriteria.getUtilizationBaselineQuery(scopeOf(stepId, 2)),
      );
    }
  });

  test("a port still learning raises nothing, while one with a history beside it is judged", async () => {
    getSeriesBaselinesSpy.mockResolvedValue(
      seriesOf({
        New0: baselineOf({ mean: 5, stddev: 1, isReliable: false }),
        Old0: baselineOf({ mean: 5, stddev: 1 }),
      }),
    );

    expect(
      await judge({
        stepId: STEP_B,
        ports: [port({ name: "New0", utilizationPercent: 99 })],
      }),
    ).toBeNull();
    expect(
      await judge({
        stepId: STEP_B,
        ports: [
          port({ name: "New0", utilizationPercent: 99 }),
          port({ name: "Old0", utilizationPercent: 50 }),
        ],
      }),
    ).toContain("SNMP interface Old0 utilization 50.00%");
  });

  test("a port with no history at all raises nothing", async () => {
    getSeriesBaselinesSpy.mockResolvedValue(seriesOf({}));

    expect(
      await judge({
        stepId: STEP_B,
        ports: [port({ name: "Fa0", utilizationPercent: 99 })],
      }),
    ).toBeNull();
  });

  test("the rollup the read falls back on judges every port that has no baseline of its own", async () => {
    getSeriesBaselinesSpy.mockResolvedValue(
      seriesOf({}, baselineOf({ mean: 20, stddev: 5 })),
    );

    expect(
      await judge({
        stepId: STEP_B,
        stepCount: 1,
        ports: [port({ name: "Fa0", utilizationPercent: 90 })],
      }),
    ).toContain("mean 20.00%");
  });

  test("a read that fails raises nothing, and throws nothing", async () => {
    getSeriesBaselinesSpy.mockRejectedValue(new Error("ClickHouse is down"));

    expect(
      await judge({
        stepId: STEP_B,
        ports: [port({ name: "Fa0", utilizationPercent: 99 })],
      }),
    ).toBeNull();
  });

  test("a port that reported no utilization is not judged", async () => {
    expect(
      await judge({
        stepId: STEP_B,
        ports: [
          port({ name: "Fa0", utilizationPercent: undefined }),
          port({ name: "Fa1", utilizationPercent: 5 }),
        ],
      }),
    ).toBeNull();
  });

  test("a static threshold reads no baseline at all", async () => {
    const result: string | null = await judge({
      stepId: STEP_B,
      ports: [port({ name: "Fa0", utilizationPercent: 75 })],
      filter: {
        checkOn: CheckOn.SnmpInterfaceUtilizationPercent,
        filterType: FilterType.GreaterThan,
        value: 80,
      },
    });

    expect(result).toBeNull();
    expect(getSeriesBaselinesSpy).not.toHaveBeenCalled();
  });

  test("a criteria naming a port by its alias judges that port alone", async () => {
    const backupBusy: string | null = await judge({
      stepId: STEP_A,
      ports: [
        port({ name: "Uplink0", utilizationPercent: 99 }),
        port({ name: "Backup0", alias: "Backup", utilizationPercent: 40 }),
      ],
      filter: anomalyFilter("backup"),
    });

    expect(backupBusy).toContain("SNMP interface Backup0 utilization 40.00%");
    expect(backupBusy).not.toContain("Uplink0");

    expect(
      await judge({
        stepId: STEP_A,
        ports: [
          port({ name: "Uplink0", utilizationPercent: 99 }),
          port({ name: "Backup0", alias: "Backup", utilizationPercent: 3 }),
        ],
        filter: anomalyFilter("backup"),
      }),
    ).toBeNull();
  });

  /*
   * A criteria fanned out per port is judged for the whole monitor first, and
   * fans out only when that is met: the whole pass has to see any port's
   * anomaly, and each port's own pass only its own.
   */
  test("an Interface Name of * is met when any port is outside its band, and each port it fans out to is judged against its own", async () => {
    const ports: Array<SnmpInterface> = [
      port({ name: "Uplink0", utilizationPercent: 71 }),
      port({ name: "Backup0", alias: "Backup", utilizationPercent: 40 }),
    ];

    expect(
      await judge({ stepId: STEP_A, ports, filter: anomalyFilter("*") }),
    ).toContain("SNMP interface Backup0 utilization 40.00%");

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
      interfaces: ports,
    });

    const entities: Array<FanOutEntity> =
      PerEntityCriteriaFanOut.getSnmpInterfaceEntities({
        dataToProcess,
        criteriaInstance,
      });

    expect(entities).toHaveLength(2);

    const verdicts: Array<string | null> = [];

    for (const entity of entities) {
      verdicts.push(
        await SnmpMonitorCriteria.isMonitorInstanceCriteriaFilterMet({
          dataToProcess,
          criteriaFilter: entity.narrowFilter(anomalyFilter("*")),
          stepScope: scopeOf(STEP_A, 2),
        }),
      );
    }

    expect(verdicts[0]).toBeNull();
    expect(verdicts[1]).toContain("SNMP interface Backup0 utilization 40.00%");
  });
});
