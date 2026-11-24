/*
 * MonitorCriteriaEvaluator reaches the template renderer, which loads the
 * native isolated-vm addon, which the prebuilt binary cannot always dlopen
 * in the test environment. No check here runs an expression.
 */
jest.mock("isolated-vm", () => {
  return {};
});

import MonitorCriteriaEvaluator from "../../../../Server/Utils/Monitor/MonitorCriteriaEvaluator";
import MonitorMetricUtil from "../../../../Server/Utils/Monitor/MonitorMetricUtil";
import DataToProcess from "../../../../Server/Utils/Monitor/DataToProcess";
import { CriteriaFilterMatchHistoryReads } from "../../../../Server/Utils/Monitor/Criteria/CriteriaFilterMatchHistory";
import GlobalConfigService from "../../../../Server/Services/GlobalConfigService";
import MetricService, {
  MonitorPreviousCheckRow,
} from "../../../../Server/Services/MetricService";
import TelemetryUtil from "../../../../Server/Utils/Telemetry/Telemetry";
import logger from "../../../../Server/Utils/Logger";
import Monitor from "../../../../Models/DatabaseModels/Monitor";
import OneUptimeDate from "../../../../Types/Date";
import FilterCondition from "../../../../Types/Filter/FilterCondition";
import { BasicDiskMetrics } from "../../../../Types/Infrastructure/BasicMetrics";
import { JSONObject } from "../../../../Types/JSON";
import {
  CheckOn,
  CriteriaFilter,
  EvaluateOverTimeType,
  FilterType,
  NoDataPolicy,
  PreviousCheckChangeType,
} from "../../../../Types/Monitor/CriteriaFilter";
import MonitorCriteria from "../../../../Types/Monitor/MonitorCriteria";
import MonitorCriteriaInstance from "../../../../Types/Monitor/MonitorCriteriaInstance";
import MonitorEvaluationSummary, {
  MonitorEvaluationCriteriaResult,
  MonitorEvaluationFilterResult,
} from "../../../../Types/Monitor/MonitorEvaluationSummary";
import MonitorStep from "../../../../Types/Monitor/MonitorStep";
import MonitorType from "../../../../Types/Monitor/MonitorType";
import ObjectID from "../../../../Types/ObjectID";
import ProbeApiIngestResponse, {
  PerSeriesCriteriaMatch,
} from "../../../../Types/Probe/ProbeApiIngestResponse";
import ProbeMonitorResponse from "../../../../Types/Probe/ProbeMonitorResponse";
import ServerMonitorResponse from "../../../../Types/Monitor/ServerMonitor/ServerMonitorResponse";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * #10821 end to end through the real criteria evaluator: a filter that
 * compares a check with the one before it.
 *
 * Each check is played the way MonitorResource handles a probe result: the
 * time it began to be written is taken, its series are written through the
 * real MonitorMetricUtil, and it is judged through
 * MonitorCriteriaEvaluator.processMonitorStep, which writes its match
 * history after. The metric store is an in-memory table the writes land in
 * and readPreviousMonitorChecks reads as its statement does - the newest row
 * a group before the check, to the second (the statement itself runs
 * against a real ClickHouse in MetricServicePreviousCheckClickhouseIntegration).
 */

const START: Date = new Date("2026-11-24T09:00:00.000Z");
const MINUTE_IN_MS: number = 60 * 1000;
const EVERY_MINUTE: string = "* * * * *";

const PROBE_A: ObjectID = new ObjectID("44444444-4444-4444-8444-444444444444");
const PROBE_B: ObjectID = new ObjectID("55555555-5555-4555-8555-555555555555");

const HEALTHY_PAGE: string = "<html><title>Shop</title></html>";
const MAINTENANCE_PAGE: string = "<html><title>Maintenance</title></html>";

interface StoredRow {
  projectId: string;
  monitorId: string;
  name: string;
  value: number | null;
  time: Date;
  attributes: Record<string, string>;
}

let store: Array<StoredRow> = [];

function atMinute(minute: number): void {
  jest.setSystemTime(new Date(START.getTime() + minute * MINUTE_IN_MS));
}

function previousCheck(
  filter: CriteriaFilter,
  input: {
    minutes?: number;
    changeType?: PreviousCheckChangeType;
    changeValue?: number;
    onNoDataPolicy?: NoDataPolicy;
  } = {},
): CriteriaFilter {
  return {
    ...filter,
    evaluateOverTime: true,
    evaluateOverTimeOptions: {
      timeValueInMinutes: input.minutes ?? 5,
      evaluateOverTimeType: EvaluateOverTimeType.PreviousCheck,
      ...(input.changeType ? { changeType: input.changeType } : {}),
      ...(input.changeValue !== undefined
        ? { changeValue: input.changeValue }
        : {}),
      ...(input.onNoDataPolicy ? { onNoDataPolicy: input.onNoDataPolicy } : {}),
    },
  };
}

function criteria(input: {
  name: string;
  filters: Array<CriteriaFilter>;
}): MonitorCriteriaInstance {
  const instance: MonitorCriteriaInstance = new MonitorCriteriaInstance();
  instance.data = {
    id: input.name,
    monitorStatusId: undefined,
    filterCondition: FilterCondition.All,
    filters: input.filters,
    incidents: [],
    alerts: [],
    name: input.name,
    description: "",
    changeMonitorStatus: true,
    createIncidents: false,
    createAlerts: false,
    isEnabled: true,
  };
  return instance;
}

function stepWith(instances: Array<MonitorCriteriaInstance>): MonitorStep {
  const step: MonitorStep = new MonitorStep();
  const monitorCriteria: MonitorCriteria = new MonitorCriteria();
  monitorCriteria.data = { monitorCriteriaInstanceArray: instances };
  step.data!.monitorCriteria = monitorCriteria;
  return step;
}

function monitorOf(monitorType: MonitorType): Monitor {
  const monitor: Monitor = new Monitor();
  monitor.id = ObjectID.generate();
  monitor.projectId = ObjectID.generate();
  monitor.monitorType = monitorType;
  monitor.monitoringInterval = EVERY_MINUTE;
  monitor.name = "Shop";
  return monitor;
}

interface Check {
  criteriaMet: string | null;
  rootCause: string | null;
  perSeriesMatches: Array<PerSeriesCriteriaMatch> | undefined;
  summary: MonitorEvaluationSummary;
}

/*
 * One check, as MonitorResource handles it: written from checkWrittenAt,
 * then judged. A stored check read back for probe agreement is judged with
 * nothing written, by the stamp it was stored with.
 */
async function check(input: {
  monitor: Monitor;
  monitorStep: MonitorStep;
  dataToProcess: DataToProcess;
  isStoredCheck?: boolean;
  matchHistoryReads?: CriteriaFilterMatchHistoryReads;
  /*
   * How long writing the check's series takes before it is judged: a write
   * that runs into the next seconds must still not be read as its own
   * previous check.
   */
  writeTakesMs?: number;
}): Promise<Check> {
  const summary: MonitorEvaluationSummary = {
    evaluatedAt: OneUptimeDate.getCurrentDate(),
    criteriaResults: [],
    events: [],
  };

  const checkWrittenAt: Date = OneUptimeDate.getCurrentDate();

  if (!input.isStoredCheck) {
    await MonitorMetricUtil.saveMonitorMetrics({
      monitorId: input.monitor.id!,
      projectId: input.monitor.projectId!,
      dataToProcess: input.dataToProcess,
      probeName: undefined,
      monitorName: input.monitor.name,
      // Each row names the step it is judged as, as MonitorResource writes it.
      monitorStepId: input.monitorStep.id,
    });
  }

  if (input.writeTakesMs) {
    jest.setSystemTime(
      new Date(OneUptimeDate.getCurrentDate().getTime() + input.writeTakesMs),
    );
  }

  const response: ProbeApiIngestResponse =
    await MonitorCriteriaEvaluator.processMonitorStep({
      dataToProcess: input.dataToProcess,
      monitorStep: input.monitorStep,
      monitor: input.monitor,
      probeApiIngestResponse: {
        monitorId: input.monitor.id!,
        criteriaMetId: undefined,
        rootCause: null,
      },
      evaluationSummary: summary,
      recordMatchHistory: !input.isStoredCheck,
      ...(input.isStoredCheck ? {} : { checkWrittenAt: checkWrittenAt }),
      matchHistoryReads: input.matchHistoryReads,
    });

  return {
    criteriaMet: response.criteriaMetId || null,
    rootCause: response.rootCause || null,
    perSeriesMatches: response.perSeriesMatches,
    summary: summary,
  };
}

function probeCheck(input: {
  monitor: Monitor;
  monitorStep: MonitorStep;
  probeId?: ObjectID;
  responseTimeInMs?: number;
  isOnline?: boolean;
  body?: string;
  monitoredAt?: Date;
}): ProbeMonitorResponse {
  return {
    projectId: input.monitor.projectId!,
    monitorId: input.monitor.id!,
    monitorStepId: input.monitorStep.id,
    probeId: input.probeId ?? PROBE_A,
    failureCause: "",
    monitoredAt: input.monitoredAt ?? OneUptimeDate.getCurrentDate(),
    isOnline: input.isOnline ?? true,
    responseCode: 200,
    responseTimeInMs: input.responseTimeInMs ?? 120,
    responseBody: input.body ?? HEALTHY_PAGE,
    responseHeaders: {},
  };
}

function serverCheck(input: {
  monitor: Monitor;
  disks: Array<{ diskPath: string; percentUsed: number }>;
}): ServerMonitorResponse {
  return {
    projectId: input.monitor.projectId!,
    monitorId: input.monitor.id!,
    hostname: "db-01",
    requestReceivedAt: OneUptimeDate.getCurrentDate(),
    basicInfrastructureMetrics: {
      cpuMetrics: { percentUsed: 5, cores: 4 },
      memoryMetrics: {
        total: 100,
        free: 90,
        used: 10,
        percentFree: 90,
        percentUsed: 10,
      },
      diskMetrics: input.disks.map(
        (disk: { diskPath: string; percentUsed: number }): BasicDiskMetrics => {
          return {
            total: 100,
            free: 100 - disk.percentUsed,
            used: disk.percentUsed,
            diskPath: disk.diskPath,
            percentUsed: disk.percentUsed,
            percentFree: 100 - disk.percentUsed,
          };
        },
      ),
    },
  } as unknown as ServerMonitorResponse;
}

// The message the evaluation log shows for one criteria's first filter.
function filterMessage(result: Check, criteriaName: string): string {
  const criteriaResult: MonitorEvaluationCriteriaResult | undefined =
    result.summary.criteriaResults.find(
      (row: MonitorEvaluationCriteriaResult) => {
        return row.criteriaName === criteriaName;
      },
    );

  return (
    criteriaResult?.filters.map((filter: MonitorEvaluationFilterResult) => {
      return filter.message;
    })[0] || ""
  );
}

describe("MonitorCriteriaEvaluator: a check compared with the one before it", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    atMinute(0);
    store = [];

    jest
      .spyOn(GlobalConfigService, "findOneBy")
      .mockResolvedValue(null as never);

    jest
      .spyOn(TelemetryUtil, "indexMetricNameServiceNameMap")
      .mockResolvedValue(undefined as never);

    // Every row a check writes: its series, and after it, its match history.
    jest
      .spyOn(MetricService, "insertJsonRows")
      .mockImplementation(async (rows: Array<JSONObject>): Promise<void> => {
        for (const row of rows) {
          store.push({
            projectId: row["projectId"] as string,
            monitorId: row["primaryEntityId"] as string,
            name: row["name"] as string,
            value:
              row["value"] === null || row["value"] === undefined
                ? null
                : (row["value"] as number),
            // Read back the way the analytics layer would: to the second.
            time: OneUptimeDate.fromString(row["time"] as string),
            attributes: row["attributes"] as Record<string, string>,
          });
        }
      });

    // readPreviousMonitorChecks's statement, over the in-memory table.
    jest
      .spyOn(MetricService, "readPreviousMonitorChecks")
      .mockImplementation(
        async (data: {
          projectId: ObjectID;
          monitorId: ObjectID;
          metricName: string;
          windowStart: Date;
          before: Date;
          attributes?: Record<string, string | Array<string>> | undefined;
          groupByAttributeKeys: Array<string>;
        }): Promise<Array<MonitorPreviousCheckRow>> => {
          const before: number =
            Math.floor(data.before.getTime() / 1000) * 1000;
          const newest: Map<string, MonitorPreviousCheckRow> = new Map();

          for (const row of store) {
            if (
              row.projectId !== data.projectId.toString() ||
              row.monitorId !== data.monitorId.toString() ||
              row.name !== data.metricName ||
              row.value === null ||
              row.time.getTime() < data.windowStart.getTime() ||
              row.time.getTime() >= before ||
              Object.entries(data.attributes || {}).some(
                ([key, value]: [string, string | Array<string>]): boolean => {
                  /*
                   * A list is any of its values, a missing key read as "",
                   * as the statement's map reads it: the step (#10906).
                   */
                  return Array.isArray(value)
                    ? !value.includes(row.attributes[key] ?? "")
                    : row.attributes[key] !== value;
                },
              )
            ) {
              continue;
            }

            const group: Record<string, string> = {};

            for (const key of data.groupByAttributeKeys) {
              group[key] = row.attributes[key] || "";
            }

            const key: string = JSON.stringify(group);
            const known: MonitorPreviousCheckRow | undefined = newest.get(key);

            if (!known || known.at.getTime() < row.time.getTime()) {
              newest.set(key, { group: group, value: row.value, at: row.time });
            }
          }

          return Array.from(newest.values());
        },
      );

    jest.spyOn(logger, "error").mockImplementation(() => {
      return undefined as never;
    });
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  describe("response time more than 50% above the previous check", () => {
    const SLOWER: CriteriaFilter = previousCheck(
      {
        checkOn: CheckOn.ResponseTime,
        filterType: FilterType.GreaterThan,
        value: undefined,
      },
      { changeType: PreviousCheckChangeType.Percentage, changeValue: 50 },
    );

    test("the first check has none; a jump from the one before matches, once", async () => {
      const monitor: Monitor = monitorOf(MonitorType.Website);
      const step: MonitorStep = stepWith([
        criteria({ name: "Slower", filters: [SLOWER] }),
      ]);

      const results: Array<Check> = [];

      for (const [minute, responseTimeInMs] of [
        [0, 400],
        [1, 410],
        [2, 820],
        [3, 830],
      ] as Array<[number, number]>) {
        // Written from 0.9 s into the minute, judged 2.5 s later.
        jest.setSystemTime(
          new Date(START.getTime() + minute * MINUTE_IN_MS + 900),
        );
        results.push(
          await check({
            monitor,
            monitorStep: step,
            writeTakesMs: 2500,
            dataToProcess: probeCheck({
              monitor,
              monitorStep: step,
              responseTimeInMs,
            }),
          }),
        );
      }

      expect(
        results.map((result: Check): string | null => {
          return result.criteriaMet;
        }),
      ).toEqual([null, null, "Slower", null]);

      expect(filterMessage(results[0]!, "Slower")).toBe(
        "Response Time (in ms) has no previous check in the last 5 minutes, so it was not compared with one.",
      );
      // The check's own row, written before it was judged, is not its previous.
      expect(filterMessage(results[1]!, "Slower")).toBe(
        "Response Time (in ms) is not more than 50% above the previous check. The previous check, 1 minute ago, read 400, so this check needed more than 600.",
      );
      expect(results[2]!.rootCause).toContain(
        "Response Time (in ms) is more than 50% above the previous check. The previous check, 1 minute ago, read 410, so this check needed more than 615:",
      );
      expect(filterMessage(results[3]!, "Slower")).toContain("read 820");
    });

    test("a check after a gap longer than the window is not compared with the one before the gap", async () => {
      const monitor: Monitor = monitorOf(MonitorType.Website);
      const step: MonitorStep = stepWith([
        criteria({ name: "Slower", filters: [SLOWER] }),
      ]);

      atMinute(0);
      await check({
        monitor,
        monitorStep: step,
        dataToProcess: probeCheck({
          monitor,
          monitorStep: step,
          responseTimeInMs: 400,
        }),
      });

      // The probe was gone for 12 minutes: past the 5-minute window.
      atMinute(12);
      const afterGap: Check = await check({
        monitor,
        monitorStep: step,
        dataToProcess: probeCheck({
          monitor,
          monitorStep: step,
          responseTimeInMs: 2000,
        }),
      });

      expect(afterGap.criteriaMet).toBeNull();
      expect(filterMessage(afterGap, "Slower")).toBe(
        "Response Time (in ms) has no previous check in the last 5 minutes, so it was not compared with one.",
      );
    });

    test("If No Data set to Trigger matches on a check with no previous one", async () => {
      const monitor: Monitor = monitorOf(MonitorType.API);
      const step: MonitorStep = stepWith([
        criteria({
          name: "Slower",
          filters: [
            previousCheck(SLOWER, {
              changeType: PreviousCheckChangeType.Percentage,
              changeValue: 50,
              onNoDataPolicy: NoDataPolicy.Trigger,
            }),
          ],
        }),
      ]);

      const first: Check = await check({
        monitor,
        monitorStep: step,
        dataToProcess: probeCheck({ monitor, monitorStep: step }),
      });

      expect(first.criteriaMet).toBe("Slower");
    });
  });

  describe("probes, each against its own previous check", () => {
    test("a probe with no previous check while another has one", async () => {
      const monitor: Monitor = monitorOf(MonitorType.Website);
      const step: MonitorStep = stepWith([
        criteria({
          name: "Slower",
          filters: [
            previousCheck(
              {
                checkOn: CheckOn.ResponseTime,
                filterType: FilterType.GreaterThan,
                value: undefined,
              },
              { changeType: PreviousCheckChangeType.Amount, changeValue: 300 },
            ),
          ],
        }),
      ]);

      atMinute(0);
      await check({
        monitor,
        monitorStep: step,
        dataToProcess: probeCheck({
          monitor,
          monitorStep: step,
          probeId: PROBE_A,
          responseTimeInMs: 400,
        }),
      });

      atMinute(1);
      const probeAStamp: Date = OneUptimeDate.getCurrentDate();
      const probeA: Check = await check({
        monitor,
        monitorStep: step,
        dataToProcess: probeCheck({
          monitor,
          monitorStep: step,
          probeId: PROBE_A,
          responseTimeInMs: 900,
        }),
      });

      // Probe B checks for the first time, 20 seconds later.
      jest.setSystemTime(new Date(START.getTime() + MINUTE_IN_MS + 20 * 1000));
      const probeBStamp: Date = OneUptimeDate.getCurrentDate();
      const probeB: Check = await check({
        monitor,
        monitorStep: step,
        dataToProcess: probeCheck({
          monitor,
          monitorStep: step,
          probeId: PROBE_B,
          responseTimeInMs: 900,
        }),
      });

      expect(probeA.criteriaMet).toBe("Slower");
      expect(probeB.criteriaMet).toBeNull();
      expect(filterMessage(probeB, "Slower")).toBe(
        "Response Time (in ms) has no previous check in the last 5 minutes, so it was not compared with one.",
      );

      /*
       * The probe agreement pass, 10 seconds on, judges each probe's stored
       * check by its own stamp: probe A's against its check before it, not
       * against the row it wrote itself.
       */
      jest.setSystemTime(new Date(START.getTime() + MINUTE_IN_MS + 30 * 1000));
      const reads: CriteriaFilterMatchHistoryReads =
        new CriteriaFilterMatchHistoryReads();

      const storedA: Check = await check({
        monitor,
        monitorStep: step,
        isStoredCheck: true,
        matchHistoryReads: reads,
        dataToProcess: probeCheck({
          monitor,
          monitorStep: step,
          probeId: PROBE_A,
          responseTimeInMs: 900,
          monitoredAt: probeAStamp,
        }),
      });
      const storedB: Check = await check({
        monitor,
        monitorStep: step,
        isStoredCheck: true,
        matchHistoryReads: reads,
        dataToProcess: probeCheck({
          monitor,
          monitorStep: step,
          probeId: PROBE_B,
          responseTimeInMs: 900,
          monitoredAt: probeBStamp,
        }),
      });

      expect(storedA.criteriaMet).toBe("Slower");
      expect(filterMessage(storedA, "Slower")).toContain("read 400");
      expect(storedB.criteriaMet).toBeNull();
    });
  });

  describe("a grouped monitor: each disk of a server against its own previous check", () => {
    test("only the disk that rose more than 10 points matches, as a series of its own", async () => {
      const monitor: Monitor = monitorOf(MonitorType.Server);
      const step: MonitorStep = stepWith([
        criteria({
          name: "Disk filling fast",
          filters: [
            previousCheck(
              {
                checkOn: CheckOn.DiskUsagePercent,
                filterType: FilterType.GreaterThan,
                value: undefined,
                serverMonitorOptions: { diskPath: "*" },
              },
              { changeType: PreviousCheckChangeType.Amount, changeValue: 10 },
            ),
          ],
        }),
      ]);

      atMinute(0);
      const first: Check = await check({
        monitor,
        monitorStep: step,
        dataToProcess: serverCheck({
          monitor,
          disks: [
            { diskPath: "/", percentUsed: 50 },
            { diskPath: "/data", percentUsed: 40 },
          ],
        }),
      });

      atMinute(1);
      const second: Check = await check({
        monitor,
        monitorStep: step,
        dataToProcess: serverCheck({
          monitor,
          disks: [
            { diskPath: "/", percentUsed: 55 },
            { diskPath: "/data", percentUsed: 70 },
          ],
        }),
      });

      expect(first.criteriaMet).toBeNull();
      expect(second.criteriaMet).toBe("Disk filling fast");
      expect(
        (second.perSeriesMatches || []).map(
          (match: PerSeriesCriteriaMatch): unknown => {
            return match.labels["diskPath"];
          },
        ),
      ).toEqual(["/data"]);
      expect(second.perSeriesMatches![0]!.rootCause).toContain(
        "Disk Usage (in %) is more than 10 above the previous check. The previous check, 1 minute ago, read 40, so this check needed more than 50",
      );
    });
  });

  describe("a text check started or stopped matching", () => {
    test("the page started showing maintenance, then stopped", async () => {
      const monitor: Monitor = monitorOf(MonitorType.Website);
      const step: MonitorStep = stepWith([
        criteria({
          name: "Maintenance started",
          filters: [
            previousCheck({
              checkOn: CheckOn.ResponseBody,
              filterType: FilterType.Contains,
              value: "Maintenance",
            }),
          ],
        }),
        criteria({
          name: "Maintenance ended",
          filters: [
            previousCheck({
              checkOn: CheckOn.ResponseBody,
              filterType: FilterType.NotContains,
              value: "Maintenance",
            }),
          ],
        }),
      ]);

      const results: Array<string | null> = [];
      const messages: Array<string> = [];

      for (const [minute, body] of [
        [0, HEALTHY_PAGE],
        [1, HEALTHY_PAGE],
        [2, MAINTENANCE_PAGE],
        [3, MAINTENANCE_PAGE],
        [4, HEALTHY_PAGE],
        [5, HEALTHY_PAGE],
      ] as Array<[number, string]>) {
        atMinute(minute);

        const result: Check = await check({
          monitor,
          monitorStep: step,
          dataToProcess: probeCheck({ monitor, monitorStep: step, body }),
        });

        results.push(result.criteriaMet);
        messages.push(filterMessage(result, "Maintenance started"));
      }

      expect(results).toEqual([
        null,
        null,
        "Maintenance started",
        null,
        "Maintenance ended",
        null,
      ]);
      expect(messages[3]).toBe(
        'Response Body Contains "Maintenance" matched on this check, as it did on the previous check, 1 minute ago: it did not start matching on this one.',
      );
      expect(messages[4]).toBe(
        'Response Body Contains "Maintenance" did not match on this check, though it did on the previous check, 1 minute ago: it stopped matching.',
      );
    });
  });

  describe("Is Online, on the check it changed", () => {
    test("False matches on the check a host went down; True on the one it came back", async () => {
      const monitor: Monitor = monitorOf(MonitorType.Ping);
      const step: MonitorStep = stepWith([
        criteria({
          name: "Went down",
          filters: [
            previousCheck({
              checkOn: CheckOn.IsOnline,
              filterType: FilterType.False,
              value: undefined,
            }),
          ],
        }),
        criteria({
          name: "Came back",
          filters: [
            previousCheck({
              checkOn: CheckOn.IsOnline,
              filterType: FilterType.True,
              value: undefined,
            }),
          ],
        }),
      ]);

      const results: Array<string | null> = [];

      for (const [minute, isOnline] of [
        [0, true],
        [1, true],
        [2, false],
        [3, false],
        [4, true],
      ] as Array<[number, boolean]>) {
        atMinute(minute);
        results.push(
          (
            await check({
              monitor,
              monitorStep: step,
              dataToProcess: probeCheck({
                monitor,
                monitorStep: step,
                isOnline,
              }),
            })
          ).criteriaMet,
        );
      }

      expect(results).toEqual([null, null, "Went down", null, "Came back"]);
    });
  });
});
