/*
 * MonitorCriteriaEvaluator reaches the template renderer, which loads the
 * native isolated-vm addon. The JavaScript expression checks below stub the
 * sandbox call itself, and the prebuilt binary cannot always dlopen in the
 * test environment.
 */
jest.mock("isolated-vm", () => {
  return {};
});

import MonitorCriteriaEvaluator from "../../../../Server/Utils/Monitor/MonitorCriteriaEvaluator";
import { CriteriaFilterMatchHistoryReads } from "../../../../Server/Utils/Monitor/Criteria/CriteriaFilterMatchHistory";
import GlobalConfigService from "../../../../Server/Services/GlobalConfigService";
import MetricService from "../../../../Server/Services/MetricService";
import FindBy from "../../../../Server/Types/AnalyticsDatabase/FindBy";
import VMUtil from "../../../../Server/Utils/VM/VMAPI";
import logger from "../../../../Server/Utils/Logger";
import Metric from "../../../../Models/AnalyticsModels/Metric";
import Monitor from "../../../../Models/DatabaseModels/Monitor";
import InBetween from "../../../../Types/BaseDatabase/InBetween";
import OneUptimeDate from "../../../../Types/Date";
import FilterCondition from "../../../../Types/Filter/FilterCondition";
import ReturnResult from "../../../../Types/IsolatedVM/ReturnResult";
import { JSONObject } from "../../../../Types/JSON";
import {
  CheckOn,
  CriteriaFilter,
  EvaluateOverTimeType,
  FilterType,
  NoDataPolicy,
} from "../../../../Types/Monitor/CriteriaFilter";
import {
  CRITERIA_FILTER_KEY_ATTRIBUTE,
  CRITERIA_FILTER_MATCH_METRIC_NAME,
} from "../../../../Types/Monitor/CriteriaFilterMatchHistory";
import MonitorCriteria from "../../../../Types/Monitor/MonitorCriteria";
import MonitorCriteriaInstance from "../../../../Types/Monitor/MonitorCriteriaInstance";
import MonitorEvaluationSummary, {
  MonitorEvaluationCriteriaResult,
  MonitorEvaluationFilterResult,
} from "../../../../Types/Monitor/MonitorEvaluationSummary";
import MonitorStep from "../../../../Types/Monitor/MonitorStep";
import MonitorType from "../../../../Types/Monitor/MonitorType";
import ObjectID from "../../../../Types/ObjectID";
import ProbeApiIngestResponse from "../../../../Types/Probe/ProbeApiIngestResponse";
import ProbeMonitorResponse from "../../../../Types/Probe/ProbeMonitorResponse";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * Issue #4686, end to end through the real criteria evaluator: a Response
 * Body check that waits before it fires.
 *
 * Each test plays a monitor's checks one minute apart through
 * MonitorCriteriaEvaluator.processMonitorStep, the way MonitorResource does
 * for every probe result. The only stand-in is the metric store: an
 * in-memory table that MetricService.insertJsonRows writes and
 * MetricService.findBy reads, so the rows the evaluator writes for a filter's
 * match history (through the real MonitorMetricUtil) are the rows it reads
 * back on the next check.
 */

const START: Date = new Date("2026-10-13T09:00:00.000Z");
const MINUTE_IN_MS: number = 60 * 1000;
const EVERY_MINUTE: string = "* * * * *";

const HEALTHY_PAGE: string =
  "<html><head><title>App Title</title></head></html>";
const PLACEHOLDER_PAGE: string = "Application starting...";

interface StoredRow {
  monitorId: string;
  filterKey: string;
  value: number;
  time: Date;
  probeId: string | undefined;
}

let store: Array<StoredRow> = [];
let matchHistoryReads: number = 0;

function atMinute(minute: number): void {
  jest.setSystemTime(new Date(START.getTime() + minute * MINUTE_IN_MS));
}

function overTime(
  criteriaFilter: CriteriaFilter,
  input: {
    minutes?: number;
    type?: EvaluateOverTimeType;
  } = {},
): CriteriaFilter {
  return {
    ...criteriaFilter,
    evaluateOverTime: true,
    evaluateOverTimeOptions: {
      timeValueInMinutes: input.minutes ?? 5,
      evaluateOverTimeType: input.type ?? EvaluateOverTimeType.AllValues,
    },
  };
}

const BODY_MISSING_TITLE: CriteriaFilter = {
  checkOn: CheckOn.ResponseBody,
  filterType: FilterType.NotContains,
  value: "App Title",
};

const IS_OFFLINE: CriteriaFilter = {
  checkOn: CheckOn.IsOnline,
  filterType: FilterType.False,
  value: undefined,
};

const IS_ONLINE: CriteriaFilter = {
  checkOn: CheckOn.IsOnline,
  filterType: FilterType.True,
  value: undefined,
};

function criteria(input: {
  name: string;
  filters: Array<CriteriaFilter>;
  filterCondition?: FilterCondition;
  isEnabled?: boolean;
}): MonitorCriteriaInstance {
  const instance: MonitorCriteriaInstance = new MonitorCriteriaInstance();
  instance.data = {
    id: input.name,
    monitorStatusId: undefined,
    filterCondition: input.filterCondition ?? FilterCondition.All,
    filters: input.filters,
    incidents: [],
    alerts: [],
    name: input.name,
    description: "",
    changeMonitorStatus: true,
    createIncidents: false,
    createAlerts: false,
    isEnabled: input.isEnabled ?? true,
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
  return monitor;
}

// The customer's criteria: down now, or the title gone for 5 minutes.
function customerStep(): MonitorStep {
  return stepWith([
    criteria({
      name: "Offline",
      filterCondition: FilterCondition.Any,
      filters: [IS_OFFLINE, overTime(BODY_MISSING_TITLE)],
    }),
    criteria({ name: "Online", filters: [IS_ONLINE] }),
  ]);
}

interface Check {
  criteriaMet: string | null;
  rootCause: string | null;
  summary: MonitorEvaluationSummary;
}

async function check(input: {
  monitor: Monitor;
  monitorStep: MonitorStep;
  response?: Partial<ProbeMonitorResponse>;
  body?: string;
  recordMatchHistory?: boolean;
  probeId?: ObjectID;
  matchHistoryReads?: CriteriaFilterMatchHistoryReads;
}): Promise<Check> {
  const dataToProcess: ProbeMonitorResponse = {
    projectId: input.monitor.projectId!,
    monitorId: input.monitor.id!,
    monitorStepId: input.monitorStep.id,
    probeId: input.probeId ?? PROBE_ID,
    failureCause: "",
    monitoredAt: OneUptimeDate.getCurrentDate(),
    isOnline: true,
    responseCode: 200,
    responseTimeInMs: 120,
    responseBody: input.body ?? HEALTHY_PAGE,
    responseHeaders: {},
    ...input.response,
  };

  const summary: MonitorEvaluationSummary = {
    evaluatedAt: OneUptimeDate.getCurrentDate(),
    criteriaResults: [],
    events: [],
  };

  const response: ProbeApiIngestResponse =
    await MonitorCriteriaEvaluator.processMonitorStep({
      dataToProcess: dataToProcess,
      monitorStep: input.monitorStep,
      monitor: input.monitor,
      probeApiIngestResponse: {
        monitorId: input.monitor.id!,
        criteriaMetId: undefined,
        rootCause: null,
      },
      evaluationSummary: summary,
      recordMatchHistory: input.recordMatchHistory ?? true,
      matchHistoryReads: input.matchHistoryReads,
    });

  return {
    criteriaMet: response.criteriaMetId || null,
    rootCause: response.rootCause || null,
    summary: summary,
  };
}

// The message the evaluation log shows for one criteria's filter.
function filterMessage(input: {
  result: Check;
  criteriaName: string;
  checkOn: CheckOn;
}): string | undefined {
  const criteriaResult: MonitorEvaluationCriteriaResult | undefined =
    input.result.summary.criteriaResults.find(
      (result: MonitorEvaluationCriteriaResult) => {
        return result.criteriaName === input.criteriaName;
      },
    );

  return criteriaResult?.filters.find(
    (filter: MonitorEvaluationFilterResult) => {
      return filter.checkOn === input.checkOn;
    },
  )?.message;
}

const PROBE_ID: ObjectID = new ObjectID("44444444-4444-4444-8444-444444444444");

describe("MonitorCriteriaEvaluator: filters judged from their match history", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    atMinute(0);

    store = [];
    matchHistoryReads = 0;

    jest
      .spyOn(GlobalConfigService, "findOneBy")
      .mockResolvedValue(null as never);

    jest
      .spyOn(MetricService, "insertJsonRows")
      .mockImplementation(async (rows: Array<JSONObject>): Promise<void> => {
        for (const row of rows) {
          expect(row["name"]).toBe(CRITERIA_FILTER_MATCH_METRIC_NAME);

          const attributes: JSONObject = row["attributes"] as JSONObject;

          store.push({
            monitorId: row["primaryEntityId"] as string,
            filterKey: attributes[CRITERIA_FILTER_KEY_ATTRIBUTE] as string,
            value: row["value"] as number,
            // Read back the way the analytics layer would.
            time: OneUptimeDate.fromString(row["time"] as string),
            probeId: attributes["probeId"] as string | undefined,
          });
        }
      });

    jest
      .spyOn(MetricService, "findBy")
      .mockImplementation(
        async (findBy: FindBy<Metric>): Promise<Array<Metric>> => {
          const query: JSONObject = findBy.query as unknown as JSONObject;

          if (query["name"] !== CRITERIA_FILTER_MATCH_METRIC_NAME) {
            return [];
          }

          matchHistoryReads++;

          const time: InBetween<Date> = query[
            "time"
          ] as unknown as InBetween<Date>;
          const filterKey: string = (query["attributes"] as JSONObject)[
            CRITERIA_FILTER_KEY_ATTRIBUTE
          ] as string;

          return store
            .filter((row: StoredRow) => {
              return (
                row.monitorId === query["primaryEntityId"]!.toString() &&
                row.filterKey === filterKey &&
                row.time.getTime() >= time.startValue.getTime() &&
                row.time.getTime() <= time.endValue.getTime()
              );
            })
            .map((row: StoredRow) => {
              const metric: Metric = new Metric();
              metric.value = row.value;
              metric.time = row.time;
              metric.attributes = {
                [CRITERIA_FILTER_KEY_ATTRIBUTE]: row.filterKey,
                ...(row.probeId ? { probeId: row.probeId } : {}),
              };
              return metric;
            });
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

  describe("the customer's monitor: offline when down, or when the title is gone for 5 minutes", () => {
    test("a restarting app's placeholder page does not take the monitor offline", async () => {
      const monitor: Monitor = monitorOf(MonitorType.Website);
      const step: MonitorStep = customerStep();

      for (let minute: number = 0; minute < 5; minute++) {
        atMinute(minute);
        expect((await check({ monitor, monitorStep: step })).criteriaMet).toBe(
          "Online",
        );
      }

      // The app restarts and answers 200 with its placeholder for 4 minutes.
      for (let minute: number = 5; minute < 10; minute++) {
        atMinute(minute);

        const result: Check = await check({
          monitor,
          monitorStep: step,
          body: PLACEHOLDER_PAGE,
        });

        expect({ minute, criteriaMet: result.criteriaMet }).toEqual({
          minute,
          criteriaMet: "Online",
        });
      }
    });

    test("5 minutes of the placeholder take it offline, and the root cause says so", async () => {
      const monitor: Monitor = monitorOf(MonitorType.Website);
      const step: MonitorStep = customerStep();

      for (let minute: number = 0; minute < 5; minute++) {
        atMinute(minute);
        await check({ monitor, monitorStep: step });
      }

      for (let minute: number = 5; minute < 10; minute++) {
        atMinute(minute);
        await check({ monitor, monitorStep: step, body: PLACEHOLDER_PAGE });
      }

      atMinute(10);

      const result: Check = await check({
        monitor,
        monitorStep: step,
        body: PLACEHOLDER_PAGE,
      });

      expect(result.criteriaMet).toBe("Offline");
      expect(result.rootCause).toContain(
        'Response Body Not Contains "App Title" matched on every check over the last 5 minutes (6 checks).',
      );
    });

    test("the first healthy page after that brings it back at once", async () => {
      const monitor: Monitor = monitorOf(MonitorType.Website);
      const step: MonitorStep = customerStep();

      for (let minute: number = 0; minute <= 5; minute++) {
        atMinute(minute);
        await check({ monitor, monitorStep: step, body: PLACEHOLDER_PAGE });
      }

      atMinute(6);
      expect(
        (await check({ monitor, monitorStep: step, body: PLACEHOLDER_PAGE }))
          .criteriaMet,
      ).toBe("Offline");

      atMinute(7);
      expect((await check({ monitor, monitorStep: step })).criteriaMet).toBe(
        "Online",
      );
    });

    test("an app that flaps never stays down long enough to fire", async () => {
      const monitor: Monitor = monitorOf(MonitorType.Website);
      const step: MonitorStep = customerStep();

      // Placeholder for 4 minutes, a good page for 1, for half an hour.
      for (let minute: number = 0; minute < 30; minute++) {
        atMinute(minute);

        const result: Check = await check({
          monitor,
          monitorStep: step,
          body: minute % 5 === 4 ? HEALTHY_PAGE : PLACEHOLDER_PAGE,
        });

        expect({ minute, criteriaMet: result.criteriaMet }).toEqual({
          minute,
          criteriaMet: "Online",
        });
      }
    });

    test("a site that is down is still offline on its first check", async () => {
      const monitor: Monitor = monitorOf(MonitorType.Website);

      const result: Check = await check({
        monitor,
        monitorStep: customerStep(),
        response: { isOnline: false, responseBody: undefined },
      });

      expect(result.criteriaMet).toBe("Offline");
    });

    test("a new monitor that starts on the placeholder waits for its first window", async () => {
      const monitor: Monitor = monitorOf(MonitorType.Website);
      const step: MonitorStep = customerStep();

      /*
       * Five checks a minute apart span four minutes: the placeholder has
       * not lasted the window yet.
       */
      for (let minute: number = 0; minute < 5; minute++) {
        atMinute(minute);
        expect({
          minute,
          criteriaMet: (
            await check({ monitor, monitorStep: step, body: PLACEHOLDER_PAGE })
          ).criteriaMet,
        }).toEqual({ minute, criteriaMet: "Online" });
      }

      // The sixth, five minutes after the first, completes it.
      atMinute(5);
      expect(
        (await check({ monitor, monitorStep: step, body: PLACEHOLDER_PAGE }))
          .criteriaMet,
      ).toBe("Offline");
    });

    test("the evaluation log says what the window is waiting for", async () => {
      const monitor: Monitor = monitorOf(MonitorType.Website);
      const step: MonitorStep = customerStep();

      for (let minute: number = 0; minute <= 2; minute++) {
        atMinute(minute);
        await check({ monitor, monitorStep: step, body: PLACEHOLDER_PAGE });
      }

      atMinute(3);

      const result: Check = await check({
        monitor,
        monitorStep: step,
        body: PLACEHOLDER_PAGE,
      });

      expect(
        filterMessage({
          result,
          criteriaName: "Offline",
          checkOn: CheckOn.ResponseBody,
        }),
      ).toBe(
        'Response Body Not Contains "App Title" has matched on every check for 3 minutes (4 checks); All Values waits until it has matched on every check for 5 minutes.',
      );
    });

    /*
     * The window still holds the good page from before the placeholder: the
     * log says how long the placeholder has lasted and what it waits for,
     * not how many of the window's checks matched.
     */
    test("and why a window with a good page in it is not met yet", async () => {
      const monitor: Monitor = monitorOf(MonitorType.Website);
      const step: MonitorStep = customerStep();

      atMinute(0);
      await check({ monitor, monitorStep: step });

      for (let minute: number = 1; minute <= 5; minute++) {
        atMinute(minute);
        await check({ monitor, monitorStep: step, body: PLACEHOLDER_PAGE });
      }

      // Minute 0's good page is still in the window at minute 5.
      atMinute(5);

      const result: Check = await check({
        monitor,
        monitorStep: step,
        body: PLACEHOLDER_PAGE,
      });

      expect(result.criteriaMet).toBe("Online");
      expect(
        filterMessage({
          result,
          criteriaName: "Offline",
          checkOn: CheckOn.ResponseBody,
        }),
      ).toBe(
        'Response Body Not Contains "App Title" has matched on every check for 4 minutes (6 checks); All Values waits until it has matched on every check for 5 minutes.',
      );
    });
  });

  describe("the history is written on every check, whichever criteria wins", () => {
    test("a criteria further down still sees the check where the app was healthy", async () => {
      const monitor: Monitor = monitorOf(MonitorType.Website);
      const step: MonitorStep = stepWith([
        criteria({
          name: "Degraded",
          filters: [
            {
              checkOn: CheckOn.ResponseTime,
              filterType: FilterType.GreaterThan,
              value: 5000,
            },
          ],
        }),
        criteria({ name: "Offline", filters: [overTime(BODY_MISSING_TITLE)] }),
        criteria({ name: "Online", filters: [IS_ONLINE] }),
      ]);

      for (let minute: number = 0; minute <= 5; minute++) {
        atMinute(minute);
        await check({
          monitor,
          monitorStep: step,
          body: minute <= 2 ? HEALTHY_PAGE : PLACEHOLDER_PAGE,
        });
      }

      /*
       * Minute 6: the real page, but slow. "Degraded" matches first, so the
       * "Offline" criteria is never evaluated - and its filter still writes
       * that this check did not match.
       */
      atMinute(6);
      expect(
        (
          await check({
            monitor,
            monitorStep: step,
            response: { responseTimeInMs: 6000 },
          })
        ).criteriaMet,
      ).toBe("Degraded");

      for (let minute: number = 7; minute <= 11; minute++) {
        atMinute(minute);

        /*
         * Without minute 6's row, minutes 5, 7, 8, 9 and 10 would read as
         * five minutes of the placeholder, and this would fire at minute 10.
         */
        expect({
          minute,
          criteriaMet: (
            await check({
              monitor,
              monitorStep: step,
              body: PLACEHOLDER_PAGE,
            })
          ).criteriaMet,
        }).toEqual({ minute, criteriaMet: "Online" });
      }

      atMinute(12);
      expect(
        (await check({ monitor, monitorStep: step, body: PLACEHOLDER_PAGE }))
          .criteriaMet,
      ).toBe("Offline");

      expect(
        store.map((row: StoredRow) => {
          return row.value;
        }),
      ).toEqual([0, 0, 0, 1, 1, 1, 0, 1, 1, 1, 1, 1, 1]);
    });

    test("each check writes one row per filter, with the probe that made it", async () => {
      const monitor: Monitor = monitorOf(MonitorType.Website);

      await check({
        monitor,
        monitorStep: customerStep(),
        body: PLACEHOLDER_PAGE,
      });

      expect(store).toHaveLength(1);
      expect(store[0]!.value).toBe(1);
      expect(store[0]!.probeId).toBe(PROBE_ID.toString());
    });

    test("the probe agreement pass reads the history but writes nothing", async () => {
      const monitor: Monitor = monitorOf(MonitorType.Website);
      const step: MonitorStep = customerStep();

      await check({
        monitor,
        monitorStep: step,
        body: PLACEHOLDER_PAGE,
        recordMatchHistory: false,
      });

      expect(store).toHaveLength(0);
      expect(matchHistoryReads).toBe(1);
    });

    test("a stored check read back for agreement is judged by its own probe's checks, and counted once", async () => {
      const monitor: Monitor = monitorOf(MonitorType.Website);
      const step: MonitorStep = customerStep();

      for (let minute: number = 0; minute <= 5; minute++) {
        atMinute(minute);
        await check({ monitor, monitorStep: step, body: PLACEHOLDER_PAGE });
      }

      /*
       * Half a minute later another probe's result arrives, and the
       * agreement pass reads back this probe's result from minute 5. Its
       * row is in the history already: six checks, not seven.
       */
      atMinute(5.5);

      const result: Check = await check({
        monitor,
        monitorStep: step,
        body: PLACEHOLDER_PAGE,
        recordMatchHistory: false,
        response: {
          // Stored as MonitorResource stores it: a string, hydrated back.
          monitoredAt: new Date(
            START.getTime() + 5 * MINUTE_IN_MS,
          ).toISOString() as unknown as Date,
        },
      });

      expect(result.criteriaMet).toBe("Offline");
      expect(result.rootCause).toContain(
        'Response Body Not Contains "App Title" matched on every check over the last 5 minutes (6 checks).',
      );
      expect(store).toHaveLength(6);
    });

    test("another probe's checks are not mixed in", async () => {
      const monitor: Monitor = monitorOf(MonitorType.Website);
      const step: MonitorStep = customerStep();

      for (let minute: number = 0; minute <= 5; minute++) {
        atMinute(minute);
        await check({ monitor, monitorStep: step, body: PLACEHOLDER_PAGE });
      }

      /*
       * A second probe, which has checked once - at minute 5 - is read
       * back for agreement. Its window holds its own single check, so it
       * waits, however long the first probe has seen the placeholder.
       */
      const secondProbe: ObjectID = ObjectID.generate();

      const result: Check = await check({
        monitor,
        monitorStep: step,
        body: PLACEHOLDER_PAGE,
        recordMatchHistory: false,
        probeId: secondProbe,
      });

      expect(result.criteriaMet).toBe("Online");
      expect(
        filterMessage({
          result,
          criteriaName: "Offline",
          checkOn: CheckOn.ResponseBody,
        }),
      ).toBe(
        'Response Body Not Contains "App Title" has matched on 1 check so far; All Values waits until it has matched on every check for 5 minutes.',
      );
    });

    test("a probe that stopped checking is not judged by the checks it made back then", async () => {
      const monitor: Monitor = monitorOf(MonitorType.Website);
      const step: MonitorStep = customerStep();

      for (let minute: number = 0; minute <= 5; minute++) {
        atMinute(minute);
        await check({ monitor, monitorStep: step, body: PLACEHOLDER_PAGE });
      }

      // Its last result, from minute 5, read back at minute 12.
      atMinute(12);

      const result: Check = await check({
        monitor,
        monitorStep: step,
        body: PLACEHOLDER_PAGE,
        recordMatchHistory: false,
        response: {
          monitoredAt: new Date(START.getTime() + 5 * MINUTE_IN_MS),
        },
      });

      expect(result.criteriaMet).toBe("Online");
      expect(
        filterMessage({
          result,
          criteriaName: "Offline",
          checkOn: CheckOn.ResponseBody,
        }),
      ).toBe(
        'Response Body Not Contains "App Title" has not been checked for 7 minutes, so it was not judged over the last 5 minutes.',
      );
    });

    test("a probe's own result and the agreement pass after it read each history once", async () => {
      const monitor: Monitor = monitorOf(MonitorType.Website);
      const step: MonitorStep = customerStep();
      const secondProbe: ObjectID = ObjectID.generate();

      for (let minute: number = 0; minute <= 4; minute++) {
        atMinute(minute);

        for (const probeId of [PROBE_ID, secondProbe]) {
          await check({
            monitor,
            monitorStep: step,
            body: PLACEHOLDER_PAGE,
            probeId: probeId,
          });
        }
      }

      atMinute(5);
      matchHistoryReads = 0;

      // One probe result, as MonitorResource handles it: one set of reads.
      const reads: CriteriaFilterMatchHistoryReads =
        new CriteriaFilterMatchHistoryReads();

      const ownResult: Check = await check({
        monitor,
        monitorStep: step,
        body: PLACEHOLDER_PAGE,
        matchHistoryReads: reads,
      });

      const otherProbe: Check = await check({
        monitor,
        monitorStep: step,
        body: PLACEHOLDER_PAGE,
        recordMatchHistory: false,
        probeId: secondProbe,
        response: {
          monitoredAt: new Date(START.getTime() + 4 * MINUTE_IN_MS),
        },
        matchHistoryReads: reads,
      });

      expect(ownResult.criteriaMet).toBe("Offline");
      // The second probe has seen the placeholder for 4 minutes so far.
      expect(otherProbe.criteriaMet).toBe("Online");
      expect(matchHistoryReads).toBe(1);
    });

    test("the agreement pass judges only the filters its criteria reach - nothing up front", async () => {
      const sandbox: jest.SpyInstance = jest
        .spyOn(VMUtil, "runCodeInSandbox")
        .mockResolvedValue({
          returnValue: true,
          logMessages: [],
          capturedMetrics: [],
        } as never);

      const monitor: Monitor = monitorOf(MonitorType.API);
      const step: MonitorStep = stepWith([
        criteria({ name: "Offline", filters: [IS_OFFLINE] }),
        criteria({
          name: "Starting",
          filters: [
            overTime({
              checkOn: CheckOn.JavaScriptExpression,
              filterType: FilterType.EvaluatesToTrue,
              value: "'{{responseBody.status}}' === 'starting'",
            }),
          ],
        }),
        criteria({ name: "Online", filters: [IS_ONLINE] }),
      ]);

      // The site is down: Offline matches before the expression is reached.
      const storedResult: Check = await check({
        monitor,
        monitorStep: step,
        response: { isOnline: false },
        recordMatchHistory: false,
      });

      expect(storedResult.criteriaMet).toBe("Offline");
      expect(sandbox).not.toHaveBeenCalled();
      expect(matchHistoryReads).toBe(0);

      /*
       * The same result arriving live is judged for every filter that keeps
       * a history, since every one of them is written.
       */
      await check({
        monitor,
        monitorStep: step,
        response: { isOnline: false },
      });

      expect(sandbox).toHaveBeenCalledTimes(1);
      expect(store).toHaveLength(1);
    });

    test("a disabled criteria writes nothing for its filters", async () => {
      const monitor: Monitor = monitorOf(MonitorType.Website);

      await check({
        monitor,
        monitorStep: stepWith([
          criteria({
            name: "Offline",
            filters: [overTime(BODY_MISSING_TITLE)],
            isEnabled: false,
          }),
          criteria({ name: "Online", filters: [IS_ONLINE] }),
        ]),
        body: PLACEHOLDER_PAGE,
      });

      expect(store).toHaveLength(0);
      expect(matchHistoryReads).toBe(0);
    });

    test("a monitor with no such filter neither writes nor reads a history", async () => {
      const monitor: Monitor = monitorOf(MonitorType.Website);

      const result: Check = await check({
        monitor,
        monitorStep: stepWith([
          criteria({
            name: "Offline",
            filterCondition: FilterCondition.Any,
            filters: [IS_OFFLINE, BODY_MISSING_TITLE],
          }),
          criteria({ name: "Online", filters: [IS_ONLINE] }),
        ]),
        body: PLACEHOLDER_PAGE,
      });

      // As before #4686: the body check fires on the check that saw it.
      expect(result.criteriaMet).toBe("Offline");
      expect(store).toHaveLength(0);
      expect(matchHistoryReads).toBe(0);
      expect(MetricService.insertJsonRows).not.toHaveBeenCalled();
    });

    /*
     * Saved through the API with no minutes, or with the dropdown cleared:
     * judged from a history its If No Data setting would decide every check,
     * and Trigger would keep the monitor offline for good. It is judged on
     * the latest check, as before #4686, and keeps no history.
     */
    test("a window without minutes is judged on the latest check, whatever If No Data says", async () => {
      const monitor: Monitor = monitorOf(MonitorType.Website);
      const step: MonitorStep = stepWith([
        criteria({
          name: "Offline",
          filters: [
            {
              ...BODY_MISSING_TITLE,
              evaluateOverTime: true,
              evaluateOverTimeOptions: {
                timeValueInMinutes: undefined,
                evaluateOverTimeType: EvaluateOverTimeType.AllValues,
                onNoDataPolicy: NoDataPolicy.Trigger,
              },
            },
          ],
        }),
        criteria({ name: "Online", filters: [IS_ONLINE] }),
      ]);

      atMinute(0);
      expect((await check({ monitor, monitorStep: step })).criteriaMet).toBe(
        "Online",
      );

      atMinute(1);
      expect(
        (await check({ monitor, monitorStep: step, body: PLACEHOLDER_PAGE }))
          .criteriaMet,
      ).toBe("Offline");

      expect(store).toHaveLength(0);
      expect(matchHistoryReads).toBe(0);
    });

    test("Any Value fires on the first placeholder and stays for its window", async () => {
      const monitor: Monitor = monitorOf(MonitorType.Website);
      const step: MonitorStep = stepWith([
        criteria({
          name: "Degraded",
          filters: [
            overTime(BODY_MISSING_TITLE, {
              type: EvaluateOverTimeType.AnyValue,
            }),
          ],
        }),
        criteria({ name: "Online", filters: [IS_ONLINE] }),
      ]);

      atMinute(0);
      expect(
        (await check({ monitor, monitorStep: step, body: PLACEHOLDER_PAGE }))
          .criteriaMet,
      ).toBe("Degraded");

      for (let minute: number = 1; minute <= 5; minute++) {
        atMinute(minute);
        expect({
          minute,
          criteriaMet: (await check({ monitor, monitorStep: step }))
            .criteriaMet,
        }).toEqual({ minute, criteriaMet: "Degraded" });
      }

      // The placeholder at minute 0 has left the 5 minute window.
      atMinute(6);
      expect((await check({ monitor, monitorStep: step })).criteriaMet).toBe(
        "Online",
      );
    });
  });

  describe("every check that keeps a match history waits for its window", () => {
    const sandboxAnswers: (code: string) => ReturnResult = (
      code: string,
    ): ReturnResult => {
      return {
        returnValue: code === "return Boolean('starting' === 'starting');",
        logMessages: [],
        capturedMetrics: [],
      };
    };

    interface CheckCase {
      name: string;
      monitorType: MonitorType;
      filter: CriteriaFilter;
      matching: Partial<ProbeMonitorResponse>;
      notMatching: Partial<ProbeMonitorResponse>;
    }

    const httpCases: Array<CheckCase> = [
      {
        name: "Response Body Contains",
        monitorType: MonitorType.Website,
        filter: {
          checkOn: CheckOn.ResponseBody,
          filterType: FilterType.Contains,
          value: "Maintenance",
        },
        matching: { responseBody: "Down for Maintenance" },
        notMatching: { responseBody: HEALTHY_PAGE },
      },
      {
        name: "Response Body Not Contains",
        monitorType: MonitorType.API,
        filter: BODY_MISSING_TITLE,
        matching: { responseBody: PLACEHOLDER_PAGE },
        notMatching: { responseBody: HEALTHY_PAGE },
      },
      {
        name: "Response Header Contains",
        monitorType: MonitorType.Website,
        filter: {
          checkOn: CheckOn.ResponseHeader,
          filterType: FilterType.Contains,
          value: "x-maintenance",
        },
        matching: { responseHeaders: { "X-Maintenance": "1" } },
        notMatching: { responseHeaders: { "content-type": "text/html" } },
      },
      {
        name: "Response Header Not Contains",
        monitorType: MonitorType.API,
        filter: {
          checkOn: CheckOn.ResponseHeader,
          filterType: FilterType.NotContains,
          value: "x-app-version",
        },
        matching: { responseHeaders: { "content-type": "text/html" } },
        notMatching: { responseHeaders: { "x-app-version": "14.0.48" } },
      },
      {
        name: "Response Header Value Contains",
        monitorType: MonitorType.API,
        filter: {
          checkOn: CheckOn.ResponseHeaderValue,
          filterType: FilterType.Contains,
          value: "starting",
        },
        matching: { responseHeaders: { "x-app-state": "starting" } },
        notMatching: { responseHeaders: { "x-app-state": "ready" } },
      },
      {
        name: "Response Header Value Not Contains",
        monitorType: MonitorType.Website,
        filter: {
          checkOn: CheckOn.ResponseHeaderValue,
          filterType: FilterType.NotContains,
          value: "ready",
        },
        matching: { responseHeaders: { "x-app-state": "starting" } },
        notMatching: { responseHeaders: { "x-app-state": "ready" } },
      },
      {
        name: "JavaScript Expression",
        monitorType: MonitorType.API,
        filter: {
          checkOn: CheckOn.JavaScriptExpression,
          filterType: FilterType.EvaluatesToTrue,
          value: "'{{responseBody.status}}' === 'starting'",
        },
        matching: { responseBody: '{"status":"starting"}' },
        notMatching: { responseBody: '{"status":"ok"}' },
      },
      {
        name: "Is Request Timeout True",
        monitorType: MonitorType.Website,
        filter: {
          checkOn: CheckOn.IsRequestTimeout,
          filterType: FilterType.True,
          value: undefined,
        },
        matching: { isTimeout: true },
        notMatching: { isTimeout: false },
      },
      {
        name: "Is Request Timeout False",
        monitorType: MonitorType.API,
        filter: {
          checkOn: CheckOn.IsRequestTimeout,
          filterType: FilterType.False,
          value: undefined,
        },
        matching: { isTimeout: false },
        notMatching: { isTimeout: true },
      },
    ];

    const timeoutCases: Array<CheckCase> = [
      MonitorType.Ping,
      MonitorType.IP,
      MonitorType.Port,
    ].map((monitorType: MonitorType): CheckCase => {
      return {
        name: `Is Request Timeout on a ${monitorType} monitor`,
        monitorType: monitorType,
        filter: {
          checkOn: CheckOn.IsRequestTimeout,
          filterType: FilterType.True,
          value: undefined,
        },
        matching: { isTimeout: true, responseBody: undefined },
        notMatching: { isTimeout: false, responseBody: undefined },
      };
    });

    test.each([...httpCases, ...timeoutCases])(
      "$name: waits 5 minutes, then fires, then recovers",
      async (checkCase: CheckCase) => {
        jest
          .spyOn(VMUtil, "runCodeInSandbox")
          .mockImplementation(
            async (data: { code: string }): Promise<ReturnResult> => {
              return sandboxAnswers(data.code);
            },
          );

        const monitor: Monitor = monitorOf(checkCase.monitorType);
        const step: MonitorStep = stepWith([
          criteria({ name: "Alarm", filters: [overTime(checkCase.filter)] }),
        ]);

        for (let minute: number = 0; minute < 5; minute++) {
          atMinute(minute);
          expect({
            minute,
            criteriaMet: (
              await check({
                monitor,
                monitorStep: step,
                response: checkCase.matching,
              })
            ).criteriaMet,
          }).toEqual({ minute, criteriaMet: null });
        }

        // The sixth check, five minutes after the first, lasts the window.
        atMinute(5);
        expect(
          (
            await check({
              monitor,
              monitorStep: step,
              response: checkCase.matching,
            })
          ).criteriaMet,
        ).toBe("Alarm");

        atMinute(6);
        expect(
          (
            await check({
              monitor,
              monitorStep: step,
              response: checkCase.notMatching,
            })
          ).criteriaMet,
        ).toBeNull();

        // Every check was written: five waiting, one firing, one recovered.
        expect(
          store.map((row: StoredRow) => {
            return row.value;
          }),
        ).toEqual([1, 1, 1, 1, 1, 1, 0]);
      },
    );

    test("the same filter without a window still fires on the check that saw it", async () => {
      const monitor: Monitor = monitorOf(MonitorType.Website);

      expect(
        (
          await check({
            monitor,
            monitorStep: stepWith([
              criteria({
                name: "Alarm",
                filters: [
                  {
                    checkOn: CheckOn.ResponseHeader,
                    filterType: FilterType.Contains,
                    value: "x-maintenance",
                  },
                ],
              }),
            ]),
            response: { responseHeaders: { "x-maintenance": "1" } },
          })
        ).criteriaMet,
      ).toBe("Alarm");
    });
  });
});
