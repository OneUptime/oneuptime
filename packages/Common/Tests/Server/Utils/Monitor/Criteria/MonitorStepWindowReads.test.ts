/*
 * MonitorCriteriaEvaluator reaches the template renderer, which loads the
 * native isolated-vm addon, which the prebuilt binary cannot always dlopen
 * in the test environment. No check here runs an expression.
 */
jest.mock("isolated-vm", () => {
  return {};
});

import CheckWindowCounts, {
  CheckWindowCountReads,
  CheckWindowSource,
} from "../../../../../Server/Utils/Monitor/Criteria/CheckWindowCounts";
import EvaluateOverTime, {
  OverTimeWindowReads,
} from "../../../../../Server/Utils/Monitor/Criteria/EvaluateOverTime";
import PreviousCheckComparison, {
  PreviousCheckReads,
  PreviousCheckSource,
} from "../../../../../Server/Utils/Monitor/Criteria/PreviousCheckComparison";
import MonitorCriteriaEvaluator from "../../../../../Server/Utils/Monitor/MonitorCriteriaEvaluator";
import DataToProcess from "../../../../../Server/Utils/Monitor/DataToProcess";
import MetricService, {
  MonitorCheckSummaryRow,
  MonitorPreviousCheckRow,
} from "../../../../../Server/Services/MetricService";
import { Statement } from "../../../../../Server/Utils/AnalyticsDatabase/Statement";
import logger from "../../../../../Server/Utils/Logger";
import Monitor from "../../../../../Models/DatabaseModels/Monitor";
import Metric from "../../../../../Models/AnalyticsModels/Metric";
import OneUptimeDate from "../../../../../Types/Date";
import FilterCondition from "../../../../../Types/Filter/FilterCondition";
import { JSONObject } from "../../../../../Types/JSON";
import {
  CheckOn,
  CriteriaFilter,
  EvaluateOverTimeType,
  FilterType,
} from "../../../../../Types/Monitor/CriteriaFilter";
import { CRITERIA_FILTER_KEY_ATTRIBUTE } from "../../../../../Types/Monitor/CriteriaFilterMatchHistory";
import MonitorCriteria from "../../../../../Types/Monitor/MonitorCriteria";
import MonitorCriteriaInstance from "../../../../../Types/Monitor/MonitorCriteriaInstance";
import MonitorMetricType from "../../../../../Types/Monitor/MonitorMetricType";
import MonitorStep from "../../../../../Types/Monitor/MonitorStep";
import {
  MONITOR_STEP_ID_ATTRIBUTE,
  MonitorStepSeriesScope,
} from "../../../../../Types/Monitor/MonitorStepSeries";
import MonitorSteps from "../../../../../Types/Monitor/MonitorSteps";
import MonitorType from "../../../../../Types/Monitor/MonitorType";
import ObjectID from "../../../../../Types/ObjectID";
import ProbeMonitorResponse from "../../../../../Types/Probe/ProbeMonitorResponse";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import type { SpyInstance } from "jest-mock";

/*
 * EVERY WINDOW OF A STEP READS THAT STEP'S ROWS (#10906).
 *
 * The statements a window is read with take the step's values; each source
 * a counted window or a previous check reads from names them for a series,
 * and leaves a match history (whose filter key is already the step's)
 * alone; reads shared while a check is judged never hand one step's rows to
 * another; the rows of a window read whole carry the step's filter; and
 * every monitor type's evaluator is handed the step being judged.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const MONITOR_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const PROBE_ID: ObjectID = new ObjectID("33333333-3333-4333-8333-333333333333");
const STEP_A: string = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const STEP_B: string = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

const ONE_STEP: MonitorStepSeriesScope = {
  monitorStepId: STEP_A,
  readsRowsWithoutStep: true,
};
const SEVERAL_STEPS: MonitorStepSeriesScope = {
  monitorStepId: STEP_A,
  readsRowsWithoutStep: false,
};

const START: Date = new Date("2026-11-24T08:00:00.000Z");
const END: Date = new Date("2026-11-24T09:00:00.000Z");

function counted(filter: CriteriaFilter): CriteriaFilter {
  return {
    ...filter,
    evaluateOverTime: true,
    evaluateOverTimeOptions: {
      timeValueInMinutes: 10,
      evaluateOverTimeType: EvaluateOverTimeType.Count,
      countFilterType: FilterType.GreaterThan,
      countValue: 2,
    },
  };
}

function againstPrevious(filter: CriteriaFilter): CriteriaFilter {
  return {
    ...filter,
    evaluateOverTime: true,
    evaluateOverTimeOptions: {
      timeValueInMinutes: 5,
      evaluateOverTimeType: EvaluateOverTimeType.PreviousCheck,
    },
  };
}

const RESPONSE_TIME_ABOVE_300: CriteriaFilter = {
  checkOn: CheckOn.ResponseTime,
  filterType: FilterType.GreaterThan,
  value: 300,
};

const OFFLINE: CriteriaFilter = {
  checkOn: CheckOn.IsOnline,
  filterType: FilterType.False,
  value: undefined,
};

const BODY_HAS_ERROR: CriteriaFilter = {
  checkOn: CheckOn.ResponseBody,
  filterType: FilterType.Contains,
  value: "Error",
};

const DISK_ABOVE_80: CriteriaFilter = {
  checkOn: CheckOn.DiskUsagePercent,
  filterType: FilterType.GreaterThan,
  value: 80,
  serverMonitorOptions: { diskPath: "*" },
};

describe("every window of a step reads that step's rows", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("the statements a window is read with", () => {
    let statements: Array<Statement> = [];

    beforeEach(() => {
      statements = [];

      jest
        .spyOn(MetricService, "executeQuery")
        .mockImplementation(
          async (statement: Statement | string): Promise<never> => {
            statements.push(statement as Statement);

            return {
              json: async (): Promise<{ data: Array<JSONObject> }> => {
                return { data: [] };
              },
            } as never;
          },
        );
    });

    function summarize(
      attributes: Record<string, string | Array<string>>,
    ): Promise<Array<MonitorCheckSummaryRow>> {
      return MetricService.summarizeMonitorChecks({
        projectId: PROJECT_ID,
        monitorId: MONITOR_ID,
        metricName: MonitorMetricType.IsOnline,
        windowStart: START,
        windowEnd: END,
        attributes: attributes,
        groupByAttributeKeys: ["probeId"],
        condition: { comparison: "ne", threshold: 1 },
      });
    }

    function readPrevious(
      attributes: Record<string, string | Array<string>>,
    ): Promise<Array<MonitorPreviousCheckRow>> {
      return MetricService.readPreviousMonitorChecks({
        projectId: PROJECT_ID,
        monitorId: MONITOR_ID,
        metricName: MonitorMetricType.ResponseTime,
        windowStart: START,
        before: END,
        attributes: attributes,
        groupByAttributeKeys: ["probeId"],
      });
    }

    describe.each([
      ["summarizeMonitorChecks", summarize],
      ["readPreviousMonitorChecks", readPrevious],
    ] as Array<
      [
        string,
        (
          attributes: Record<string, string | Array<string>>,
        ) => Promise<unknown>,
      ]
    >)(
      "%s",
      (
        _name: string,
        read: (
          attributes: Record<string, string | Array<string>>,
        ) => Promise<unknown>,
      ) => {
        test("a step and the rows that name none: one IN over the attribute, its values parameters", async () => {
          await read({ [MONITOR_STEP_ID_ATTRIBUTE]: [STEP_A, ""] });

          const query: string = statements[0]!.query;

          expect(query).toMatch(
            /AND attributes\[\{p\d+:String\}\] IN \{p\d+:Array\(String\)\}/,
          );
          expect(query).not.toContain(STEP_A);
          expect(Object.values(statements[0]!.query_params)).toEqual(
            expect.arrayContaining([MONITOR_STEP_ID_ATTRIBUTE, [STEP_A, ""]]),
          );
        });

        test("one value is still an equality, as a match history's filter key always was", async () => {
          await read({ [CRITERIA_FILTER_KEY_ATTRIBUTE]: "abc" });

          expect(statements[0]!.query).toMatch(
            /AND attributes\[\{p\d+:String\}\] = \{p\d+:String\}/,
          );
          expect(statements[0]!.query).not.toContain(" IN ");
        });

        test("a list with no value matches no row, never every row", async () => {
          await read({ [MONITOR_STEP_ID_ATTRIBUTE]: [] });

          expect(statements[0]!.query).toContain(" AND 0");
          expect(statements[0]!.query).not.toMatch(/IN \{p\d+:Array/);
        });

        test("several attributes are all required, on the table's sort key", async () => {
          await read({
            [CRITERIA_FILTER_KEY_ATTRIBUTE]: "abc",
            [MONITOR_STEP_ID_ATTRIBUTE]: [STEP_A],
          });

          const query: string = statements[0]!.query;

          expect(query).toMatch(
            /AND attributes\[\{p\d+:String\}\] = \{p\d+:String\} AND attributes\[\{p\d+:String\}\] IN \{p\d+:Array\(String\)\}/,
          );
          expect(query).toMatch(
            /WHERE projectId = \{p\d+:String\} AND name = \{p\d+:String\} AND primaryEntityId = \{p\d+:String\}/,
          );
        });
      },
    );
  });

  describe("the source a counted window and a previous check read from", () => {
    test("a series names the step's values: its own, and none on a monitor with one step", () => {
      for (const [scope, values] of [
        [SEVERAL_STEPS, [STEP_A]],
        [ONE_STEP, [STEP_A, ""]],
      ] as Array<[MonitorStepSeriesScope, Array<string>]>) {
        const source: CheckWindowSource | null = CheckWindowCounts.getSource({
          criteriaFilter: counted(OFFLINE),
          monitorType: MonitorType.Website,
          monitorStepId: STEP_A,
          stepScope: scope,
        });

        expect(source?.metricName).toBe(MonitorMetricType.IsOnline);
        expect(source?.attributes).toEqual({
          [MONITOR_STEP_ID_ATTRIBUTE]: values,
        });
        expect(source?.groupByAttributeKeys).toEqual(["probeId"]);

        const previous: PreviousCheckSource | null =
          PreviousCheckComparison.getSource({
            criteriaFilter: againstPrevious(RESPONSE_TIME_ABOVE_300),
            monitorType: MonitorType.Website,
            monitorStepId: STEP_A,
            stepScope: scope,
          });

        expect(previous?.metricName).toBe(MonitorMetricType.ResponseTime);
        expect(previous?.attributes).toEqual({
          [MONITOR_STEP_ID_ATTRIBUTE]: values,
        });

        // A yes or no series, compared by whether it started matching.
        const startedMatching: PreviousCheckSource | null =
          PreviousCheckComparison.getSource({
            criteriaFilter: againstPrevious(OFFLINE),
            monitorType: MonitorType.Website,
            monitorStepId: STEP_A,
            stepScope: scope,
          });

        expect(startedMatching?.attributes).toEqual({
          [MONITOR_STEP_ID_ATTRIBUTE]: values,
        });
        expect(startedMatching?.condition).toEqual({
          comparison: "ne",
          threshold: 1,
        });
      }
    });

    test("each disk of a disk series is still a group of its own, within the step", () => {
      const source: CheckWindowSource | null = CheckWindowCounts.getSource({
        criteriaFilter: counted(DISK_ABOVE_80),
        monitorType: MonitorType.Server,
        monitorStepId: STEP_A,
        stepScope: ONE_STEP,
      });

      expect(source?.groupByAttributeKeys).toEqual(["probeId", "diskPath"]);
      expect(source?.attributes).toEqual({
        [MONITOR_STEP_ID_ATTRIBUTE]: [STEP_A, ""],
      });
    });

    test("a match history is read by its filter key alone: the key is already the step's", () => {
      for (const scope of [ONE_STEP, SEVERAL_STEPS]) {
        const source: CheckWindowSource | null = CheckWindowCounts.getSource({
          criteriaFilter: counted(BODY_HAS_ERROR),
          monitorType: MonitorType.Website,
          monitorStepId: STEP_A,
          stepScope: scope,
        });

        expect(source?.isMatchHistory).toBe(true);
        expect(Object.keys(source?.attributes || {})).toEqual([
          CRITERIA_FILTER_KEY_ATTRIBUTE,
        ]);

        // Each step's filter has a history of its own.
        const other: CheckWindowSource | null = CheckWindowCounts.getSource({
          criteriaFilter: counted(BODY_HAS_ERROR),
          monitorType: MonitorType.Website,
          monitorStepId: STEP_B,
          stepScope: scope,
        });

        expect(other?.attributes[CRITERIA_FILTER_KEY_ATTRIBUTE]).not.toEqual(
          source?.attributes[CRITERIA_FILTER_KEY_ATTRIBUTE],
        );

        const previous: PreviousCheckSource | null =
          PreviousCheckComparison.getSource({
            criteriaFilter: againstPrevious(BODY_HAS_ERROR),
            monitorType: MonitorType.Website,
            monitorStepId: STEP_A,
            stepScope: scope,
          });

        expect(Object.keys(previous?.attributes || {})).toEqual([
          CRITERIA_FILTER_KEY_ATTRIBUTE,
        ]);
      }
    });

    test("with no step scope a series is read whole, as before", () => {
      expect(
        CheckWindowCounts.getSource({
          criteriaFilter: counted(OFFLINE),
          monitorType: MonitorType.Website,
          monitorStepId: STEP_A,
        })?.attributes,
      ).toEqual({});
    });
  });

  describe("reads shared while a check is judged", () => {
    test("two steps' counted windows of one series are two reads, each with its step", async () => {
      const summarize: SpyInstance<
        typeof MetricService.summarizeMonitorChecks
      > = jest
        .spyOn(MetricService, "summarizeMonitorChecks")
        .mockResolvedValue([]);

      const reads: CheckWindowCountReads = new CheckWindowCountReads(END);

      for (const stepId of [STEP_A, STEP_B, STEP_A]) {
        await CheckWindowCounts.judgeFilter({
          projectId: PROJECT_ID,
          monitorId: MONITOR_ID,
          monitorStepId: stepId,
          stepScope: { monitorStepId: stepId, readsRowsWithoutStep: false },
          monitorType: MonitorType.Website,
          probeId: PROBE_ID,
          criteriaFilter: counted(OFFLINE),
          check: { filterKey: "", matched: false, at: END },
          monitoringInterval: "* * * * *",
          reads: reads,
        });
      }

      // Step A twice shares one read; step B never shares step A's.
      expect(summarize).toHaveBeenCalledTimes(2);
      expect(
        summarize.mock.calls.map((call: Array<unknown>): unknown => {
          return (call[0] as { attributes: unknown }).attributes;
        }),
      ).toEqual([
        { [MONITOR_STEP_ID_ATTRIBUTE]: [STEP_A] },
        { [MONITOR_STEP_ID_ATTRIBUTE]: [STEP_B] },
      ]);
    });

    test("two steps' previous checks of one series are two reads, each with its step", async () => {
      const readPrevious: SpyInstance<
        typeof MetricService.readPreviousMonitorChecks
      > = jest
        .spyOn(MetricService, "readPreviousMonitorChecks")
        .mockResolvedValue([]);

      const reads: PreviousCheckReads = new PreviousCheckReads();

      for (const stepId of [STEP_A, STEP_B]) {
        await PreviousCheckComparison.judgeFilter({
          projectId: PROJECT_ID,
          monitorId: MONITOR_ID,
          monitorStepId: stepId,
          stepScope: { monitorStepId: stepId, readsRowsWithoutStep: false },
          monitorType: MonitorType.Website,
          probeId: PROBE_ID,
          criteriaFilter: againstPrevious(RESPONSE_TIME_ABOVE_300),
          checkWrittenAt: END,
          reads: reads,
          isMetOnThisCheck: async (): Promise<boolean> => {
            return false;
          },
          judgeThisCheck: async (): Promise<string | null> => {
            return null;
          },
        });
      }

      expect(readPrevious).toHaveBeenCalledTimes(2);
      expect(
        readPrevious.mock.calls.map((call: Array<unknown>): unknown => {
          return (call[0] as { attributes: unknown }).attributes;
        }),
      ).toEqual([
        { [MONITOR_STEP_ID_ATTRIBUTE]: [STEP_A] },
        { [MONITOR_STEP_ID_ATTRIBUTE]: [STEP_B] },
      ]);
    });
  });

  describe("a window read whole (Average, Percentile, All Values and the rest)", () => {
    let reads: Array<Record<string, string | Array<string>> | undefined> = [];

    beforeEach(() => {
      reads = [];

      jest
        .spyOn(MetricService, "readMonitorWindowRows")
        .mockImplementation((async (input: {
          attributes?: Record<string, string | Array<string>>;
        }): Promise<Array<Metric>> => {
          reads.push(input.attributes);
          return [];
        }) as never);
    });

    function average(filter: CriteriaFilter): CriteriaFilter {
      return {
        ...filter,
        evaluateOverTime: true,
        evaluateOverTimeOptions: {
          timeValueInMinutes: 5,
          evaluateOverTimeType: EvaluateOverTimeType.Average,
        },
      };
    }

    test("a step of a monitor with several reads its own rows, beside the disk it names", async () => {
      await EvaluateOverTime.evaluateOverTime({
        projectId: PROJECT_ID,
        monitorId: MONITOR_ID,
        criteriaFilter: average({ ...DISK_ABOVE_80 }),
        miscData: { diskPath: "/data" },
        stepScope: SEVERAL_STEPS,
      });

      expect(reads[0]).toEqual({
        diskPath: "/data",
        [MONITOR_STEP_ID_ATTRIBUTE]: [STEP_A],
      });
    });

    test("a monitor with one step reads its rows and the rows that name none", async () => {
      await EvaluateOverTime.evaluateOverTime({
        projectId: PROJECT_ID,
        monitorId: MONITOR_ID,
        criteriaFilter: average(RESPONSE_TIME_ABOVE_300),
        stepScope: ONE_STEP,
      });

      expect(reads[0]![MONITOR_STEP_ID_ATTRIBUTE]).toEqual([STEP_A, ""]);
    });

    test("with no step the window is read as before, and the disk it names is never changed", async () => {
      const miscData: JSONObject = { diskPath: "/" };

      await EvaluateOverTime.evaluateOverTime({
        projectId: PROJECT_ID,
        monitorId: MONITOR_ID,
        criteriaFilter: average(RESPONSE_TIME_ABOVE_300),
      });

      expect(reads[0]).toEqual({});

      expect(
        EvaluateOverTime.getWindowAttributes({
          miscData: miscData,
          stepScope: SEVERAL_STEPS,
        }),
      ).toEqual({ diskPath: "/", [MONITOR_STEP_ID_ATTRIBUTE]: [STEP_A] });
      expect(miscData).toEqual({ diskPath: "/" });
    });
  });

  describe("every monitor type's evaluator is handed the step being judged", () => {
    /*
     * One check of each monitor type whose evaluator reads a window of the
     * series its checks write, judged with a filter over a window: each
     * evaluator must hand its window read the step's scope.
     */
    const probeCheck: (
      monitor: Monitor,
      step: MonitorStep,
      extra?: Partial<ProbeMonitorResponse>,
    ) => DataToProcess = (
      monitor: Monitor,
      step: MonitorStep,
      extra: Partial<ProbeMonitorResponse> = {},
    ): DataToProcess => {
      return {
        projectId: monitor.projectId!,
        monitorId: monitor.id!,
        monitorStepId: step.id,
        probeId: PROBE_ID,
        failureCause: "",
        monitoredAt: OneUptimeDate.getCurrentDate(),
        isOnline: true,
        responseTimeInMs: 120,
        responseCode: 200,
        ...extra,
      } as ProbeMonitorResponse;
    };

    const CASES: Array<{
      monitorType: MonitorType;
      filter: CriteriaFilter;
      check: (monitor: Monitor, step: MonitorStep) => DataToProcess;
    }> = [
      {
        monitorType: MonitorType.Website,
        filter: RESPONSE_TIME_ABOVE_300,
        check: probeCheck,
      },
      {
        monitorType: MonitorType.API,
        filter: RESPONSE_TIME_ABOVE_300,
        check: probeCheck,
      },
      {
        monitorType: MonitorType.Ping,
        filter: { ...RESPONSE_TIME_ABOVE_300 },
        check: probeCheck,
      },
      {
        monitorType: MonitorType.Port,
        filter: { ...RESPONSE_TIME_ABOVE_300 },
        check: probeCheck,
      },
      {
        monitorType: MonitorType.IP,
        filter: { ...RESPONSE_TIME_ABOVE_300 },
        check: probeCheck,
      },
      {
        monitorType: MonitorType.SSLCertificate,
        filter: {
          checkOn: CheckOn.IsOnline,
          filterType: FilterType.True,
          value: undefined,
        },
        check: probeCheck,
      },
      {
        monitorType: MonitorType.DNS,
        filter: {
          checkOn: CheckOn.DnsResponseTime,
          filterType: FilterType.GreaterThan,
          value: 300,
        },
        check: probeCheck,
      },
      {
        monitorType: MonitorType.Domain,
        filter: {
          checkOn: CheckOn.DomainExpiresDaysIn,
          filterType: FilterType.LessThan,
          value: 30,
        },
        check: probeCheck,
      },
      {
        monitorType: MonitorType.NTP,
        filter: {
          checkOn: CheckOn.NtpResponseTime,
          filterType: FilterType.GreaterThan,
          value: 300,
        },
        check: (monitor: Monitor, step: MonitorStep): DataToProcess => {
          return probeCheck(monitor, step, {
            ntpResponse: {
              isOnline: true,
              responseTimeInMs: 30,
            },
          } as unknown as Partial<ProbeMonitorResponse>);
        },
      },
      {
        monitorType: MonitorType.Database,
        filter: {
          checkOn: CheckOn.DatabaseMetric,
          filterType: FilterType.GreaterThan,
          value: 80,
          databaseMonitorOptions: {
            metricType: MonitorMetricType.DatabaseConnectionsUsedPercent,
          },
        },
        check: (monitor: Monitor, step: MonitorStep): DataToProcess => {
          return probeCheck(monitor, step, {
            databaseMonitorResponse: {
              isOnline: true,
              responseTimeInMs: 30,
              failureCause: "",
              metrics: {
                [MonitorMetricType.DatabaseConnectionsUsedPercent]: 40,
              },
              collectedGroups: [],
              unavailableGroups: [],
            },
          } as unknown as Partial<ProbeMonitorResponse>);
        },
      },
      {
        monitorType: MonitorType.ExternalStatusPage,
        filter: {
          checkOn: CheckOn.ExternalStatusPageResponseTime,
          filterType: FilterType.GreaterThan,
          value: 300,
        },
        check: probeCheck,
      },
      {
        monitorType: MonitorType.NetworkDevice,
        filter: {
          checkOn: CheckOn.SnmpResponseTime,
          filterType: FilterType.GreaterThan,
          value: 300,
        },
        check: (monitor: Monitor, step: MonitorStep): DataToProcess => {
          return probeCheck(monitor, step, {
            snmpResponse: {
              isOnline: true,
              responseTimeInMs: 30,
              interfaces: [],
              oidResponses: [],
            },
          } as unknown as Partial<ProbeMonitorResponse>);
        },
      },
      {
        monitorType: MonitorType.ProbeStatus,
        filter: {
          checkOn: CheckOn.ConnectedProbes,
          filterType: FilterType.LessThan,
          value: 2,
        },
        check: (monitor: Monitor, step: MonitorStep): DataToProcess => {
          return {
            projectId: monitor.projectId!,
            monitorId: monitor.id!,
            monitorStepId: step.id,
            probes: [],
            connectedProbeCount: 3,
            disconnectedProbeCount: 0,
          } as unknown as DataToProcess;
        },
      },
      {
        monitorType: MonitorType.Server,
        filter: {
          checkOn: CheckOn.CPUUsagePercent,
          filterType: FilterType.GreaterThan,
          value: 90,
        },
        check: (monitor: Monitor): DataToProcess => {
          return {
            projectId: monitor.projectId!,
            monitorId: monitor.id!,
            hostname: "db-01",
            requestReceivedAt: OneUptimeDate.getCurrentDate(),
            onlyCheckRequestReceivedAt: false,
            basicInfrastructureMetrics: {
              cpuMetrics: { percentUsed: 5, cores: 4 },
              memoryMetrics: {
                total: 100,
                free: 90,
                used: 10,
                percentFree: 90,
                percentUsed: 10,
              },
              diskMetrics: [
                {
                  total: 100,
                  free: 10,
                  used: 90,
                  diskPath: "/data",
                  percentUsed: 90,
                  percentFree: 10,
                },
              ],
            },
          } as unknown as DataToProcess;
        },
      },
    ];

    function monitorOf(input: {
      monitorType: MonitorType;
      filter: CriteriaFilter;
      stepCount: number;
    }): { monitor: Monitor; judged: MonitorStep } {
      const instance: MonitorCriteriaInstance = new MonitorCriteriaInstance();
      instance.data = {
        id: "over-a-window",
        monitorStatusId: undefined,
        filterCondition: FilterCondition.All,
        filters: [
          {
            ...input.filter,
            evaluateOverTime: true,
            evaluateOverTimeOptions: {
              timeValueInMinutes: 5,
              evaluateOverTimeType: EvaluateOverTimeType.Average,
            },
          },
        ],
        incidents: [],
        alerts: [],
        name: "over-a-window",
        description: "",
        changeMonitorStatus: true,
        createIncidents: false,
        createAlerts: false,
        isEnabled: true,
      };

      const steps: Array<MonitorStep> = [];

      for (let index: number = 0; index < input.stepCount; index++) {
        const step: MonitorStep = new MonitorStep();
        const monitorCriteria: MonitorCriteria = new MonitorCriteria();
        monitorCriteria.data = {
          monitorCriteriaInstanceArray: index === 1 ? [instance] : [],
        };
        step.data!.monitorCriteria = monitorCriteria;
        steps.push(step);
      }

      if (input.stepCount === 1) {
        const monitorCriteria: MonitorCriteria = new MonitorCriteria();
        monitorCriteria.data = { monitorCriteriaInstanceArray: [instance] };
        steps[0]!.data!.monitorCriteria = monitorCriteria;
      }

      const monitorSteps: MonitorSteps = new MonitorSteps();
      monitorSteps.data = {
        monitorStepsInstanceArray: steps,
        defaultMonitorStatusId: undefined,
      };

      const monitor: Monitor = new Monitor();
      monitor.id = MONITOR_ID;
      monitor.projectId = PROJECT_ID;
      monitor.monitorType = input.monitorType;
      monitor.monitoringInterval = "* * * * *";
      monitor.monitorSteps = monitorSteps;

      return {
        monitor: monitor,
        judged: steps[input.stepCount === 1 ? 0 : 1]!,
      };
    }

    let scopes: Array<MonitorStepSeriesScope | undefined> = [];
    let windowReads: Array<OverTimeWindowReads | undefined> = [];

    beforeEach(() => {
      scopes = [];
      windowReads = [];

      jest
        .spyOn(EvaluateOverTime, "getOverTimeValueForCriteriaFilter")
        .mockImplementation(
          async (data: {
            stepScope: MonitorStepSeriesScope | undefined;
            windowReads?: OverTimeWindowReads | undefined;
          }): Promise<never> => {
            scopes.push(data.stepScope);
            windowReads.push(data.windowReads);
            return { earlyReturn: { result: null }, value: undefined } as never;
          },
        );

      jest.spyOn(logger, "error").mockImplementation(() => {
        return undefined as never;
      });
    });

    async function judge(input: {
      monitor: Monitor;
      judged: MonitorStep;
      dataToProcess: DataToProcess;
    }): Promise<void> {
      await MonitorCriteriaEvaluator.processMonitorStep({
        dataToProcess: input.dataToProcess,
        monitorStep: input.judged,
        monitor: input.monitor,
        probeApiIngestResponse: {
          monitorId: input.monitor.id!,
          criteriaMetId: undefined,
          rootCause: null,
        },
        evaluationSummary: {
          evaluatedAt: OneUptimeDate.getCurrentDate(),
          criteriaResults: [],
          events: [],
        },
      });
    }

    test.each(
      CASES.map(
        (testCase: {
          monitorType: MonitorType;
          filter: CriteriaFilter;
          check: (monitor: Monitor, step: MonitorStep) => DataToProcess;
        }) => {
          return [testCase.monitorType, testCase] as const;
        },
      ),
    )(
      "%s: the second step of two reads its own rows alone",
      async (
        _monitorType: MonitorType,
        testCase: {
          monitorType: MonitorType;
          filter: CriteriaFilter;
          check: (monitor: Monitor, step: MonitorStep) => DataToProcess;
        },
      ) => {
        const { monitor, judged } = monitorOf({
          monitorType: testCase.monitorType,
          filter: testCase.filter,
          stepCount: 2,
        });

        await judge({
          monitor: monitor,
          judged: judged,
          dataToProcess: testCase.check(monitor, judged),
        });

        expect(scopes.length).toBeGreaterThan(0);

        for (const scope of scopes) {
          expect(scope).toEqual({
            monitorStepId: judged.id.toString(),
            readsRowsWithoutStep: false,
          });
        }

        /*
         * And the windows read for the check: one set, handed to every
         * window the check's evaluation reads, so each is read once.
         */
        expect(windowReads[0]).toBeInstanceOf(OverTimeWindowReads);

        for (const reads of windowReads) {
          expect(reads).toBe(windowReads[0]);
        }
      },
    );

    test("a disk named \"*\" reads each disk's window with the step's scope", async () => {
      const serverCase: (monitor: Monitor, step: MonitorStep) => DataToProcess =
        CASES.find((testCase: { monitorType: MonitorType }): boolean => {
          return testCase.monitorType === MonitorType.Server;
        })!.check;

      const { monitor, judged } = monitorOf({
        monitorType: MonitorType.Server,
        filter: DISK_ABOVE_80,
        stepCount: 1,
      });

      await judge({
        monitor: monitor,
        judged: judged,
        dataToProcess: serverCase(monitor, judged),
      });

      expect(scopes.length).toBeGreaterThan(0);

      for (const scope of scopes) {
        expect(scope).toEqual({
          monitorStepId: judged.id.toString(),
          readsRowsWithoutStep: true,
        });
      }

      expect(windowReads[0]).toBeInstanceOf(OverTimeWindowReads);

      for (const reads of windowReads) {
        expect(reads).toBe(windowReads[0]);
      }
    });
  });
});
