import CriteriaFilterMatchHistory, {
  CriteriaFilterCheck,
  FilterKeepingMatchHistory,
  MatchHistoryJudgement,
} from "../../../../../Server/Utils/Monitor/Criteria/CriteriaFilterMatchHistory";
import MonitorMetricUtil from "../../../../../Server/Utils/Monitor/MonitorMetricUtil";
import MetricService from "../../../../../Server/Services/MetricService";
import FindBy from "../../../../../Server/Types/AnalyticsDatabase/FindBy";
import logger from "../../../../../Server/Utils/Logger";
import Metric from "../../../../../Models/AnalyticsModels/Metric";
import InBetween from "../../../../../Types/BaseDatabase/InBetween";
import FilterCondition from "../../../../../Types/Filter/FilterCondition";
import { JSONObject } from "../../../../../Types/JSON";
import {
  CheckOn,
  CriteriaFilter,
  EvaluateOverTimeType,
  FilterType,
  NoDataPolicy,
} from "../../../../../Types/Monitor/CriteriaFilter";
import {
  CRITERIA_FILTER_KEY_ATTRIBUTE,
  CRITERIA_FILTER_MATCH_METRIC_NAME,
} from "../../../../../Types/Monitor/CriteriaFilterMatchHistory";
import MonitorCriteria from "../../../../../Types/Monitor/MonitorCriteria";
import MonitorCriteriaInstance from "../../../../../Types/Monitor/MonitorCriteriaInstance";
import MonitorStep from "../../../../../Types/Monitor/MonitorStep";
import MonitorType from "../../../../../Types/Monitor/MonitorType";
import ObjectID from "../../../../../Types/ObjectID";
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
 * A filter judged from its match history (issue #4686).
 *
 * The window arithmetic is anchored to a fixed "now", the history read is
 * stubbed in memory so every query can be asserted on, and the write is
 * stubbed at MonitorMetricUtil, which owns the row shape (its own suite).
 */

const NOW: Date = new Date("2026-10-13T12:00:00.000Z");
const MINUTE_IN_MS: number = 60 * 1000;

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const MONITOR_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const STEP_ID: ObjectID = new ObjectID("33333333-3333-4333-8333-333333333333");

// A probe that checks every minute.
const EVERY_MINUTE: string = "* * * * *";
const EVERY_FIVE_MINUTES: string = "*/5 * * * *";

const FILTER_KEY: string = "0123456789abcdef0123456789abcdef";

function bodyFilter(overrides: Partial<CriteriaFilter> = {}): CriteriaFilter {
  return {
    checkOn: CheckOn.ResponseBody,
    filterType: FilterType.NotContains,
    value: "App Title",
    evaluateOverTime: true,
    evaluateOverTimeOptions: {
      timeValueInMinutes: 5,
      evaluateOverTimeType: EvaluateOverTimeType.AllValues,
    },
    ...overrides,
  };
}

function anyValue(minutes: number = 5): Partial<CriteriaFilter> {
  return {
    evaluateOverTimeOptions: {
      timeValueInMinutes: minutes,
      evaluateOverTimeType: EvaluateOverTimeType.AnyValue,
    },
  };
}

// A stored check, `minutesAgo` before now: 1 matched, 0 did not.
function storedCheck(input: { matched: boolean; minutesAgo: number }): Metric {
  const metric: Metric = new Metric();
  metric.value = input.matched ? 1 : 0;
  metric.time = new Date(NOW.getTime() - input.minutesAgo * MINUTE_IN_MS);
  return metric;
}

/*
 * The checks before this one, one a minute, the oldest first and the newest
 * a minute ago: everyMinuteBefore([1, 1, 0]) is three checks, 3, 2 and 1
 * minutes ago.
 */
function everyMinuteBefore(matched: Array<0 | 1>): Array<Metric> {
  return matched.map((value: 0 | 1, index: number) => {
    return storedCheck({
      matched: value === 1,
      minutesAgo: matched.length - index,
    });
  });
}

function thisCheck(matched: boolean): CriteriaFilterCheck {
  return { filterKey: FILTER_KEY, matched: matched, at: NOW };
}

let findByCalls: Array<FindBy<Metric>> = [];
let storedChecks: Array<Metric> = [];
let readError: Error | null = null;

function judge(input: {
  criteriaFilter: CriteriaFilter;
  matched: boolean;
  monitoringInterval?: string | undefined;
}): Promise<MatchHistoryJudgement> {
  return CriteriaFilterMatchHistory.judgeWindow({
    projectId: PROJECT_ID,
    monitorId: MONITOR_ID,
    criteriaFilter: input.criteriaFilter,
    check: thisCheck(input.matched),
    monitoringInterval: input.monitoringInterval ?? EVERY_MINUTE,
  });
}

function criteriaInstance(input: {
  filters: Array<CriteriaFilter>;
  isEnabled?: boolean;
}): MonitorCriteriaInstance {
  const instance: MonitorCriteriaInstance = new MonitorCriteriaInstance();
  instance.data = {
    id: ObjectID.generate().toString(),
    monitorStatusId: undefined,
    filterCondition: FilterCondition.Any,
    filters: input.filters,
    incidents: [],
    alerts: [],
    name: "Criteria",
    description: "",
    isEnabled: input.isEnabled ?? true,
  };
  return instance;
}

function stepWith(instances: Array<MonitorCriteriaInstance>): MonitorStep {
  const step: MonitorStep = new MonitorStep();
  step.id = STEP_ID;
  const monitorCriteria: MonitorCriteria = new MonitorCriteria();
  monitorCriteria.data = { monitorCriteriaInstanceArray: instances };
  step.data!.monitorCriteria = monitorCriteria;
  return step;
}

describe("CriteriaFilterMatchHistory", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(NOW);

    findByCalls = [];
    storedChecks = [];
    readError = null;

    jest
      .spyOn(MetricService, "findBy")
      .mockImplementation((findBy: FindBy<Metric>): Promise<Array<Metric>> => {
        findByCalls.push(findBy);

        if (readError) {
          return Promise.reject(readError);
        }

        return Promise.resolve(storedChecks);
      });

    jest.spyOn(logger, "error").mockImplementation(() => {
      return undefined as never;
    });
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  describe("getFilterKey", () => {
    test("is 32 hex characters", () => {
      expect(
        CriteriaFilterMatchHistory.getFilterKey({
          monitorStepId: STEP_ID,
          criteriaFilter: bodyFilter(),
        }),
      ).toMatch(/^[0-9a-f]{32}$/);
    });

    test("does not depend on the order the filter's keys come back in", () => {
      /*
       * jsonb hands keys back in its own order: a filter read from Postgres
       * must keep the history it was written under.
       */
      const written: CriteriaFilter = bodyFilter();
      const readBack: CriteriaFilter = JSON.parse(
        JSON.stringify({
          value: written.value,
          evaluateOverTimeOptions: written.evaluateOverTimeOptions,
          filterType: written.filterType,
          evaluateOverTime: written.evaluateOverTime,
          checkOn: written.checkOn,
        }),
      ) as CriteriaFilter;

      expect(
        CriteriaFilterMatchHistory.getFilterKey({
          monitorStepId: STEP_ID,
          criteriaFilter: readBack,
        }),
      ).toBe(
        CriteriaFilterMatchHistory.getFilterKey({
          monitorStepId: STEP_ID,
          criteriaFilter: written,
        }),
      );
    });

    test("names the step as an id or as its string, alike", () => {
      expect(
        CriteriaFilterMatchHistory.getFilterKey({
          monitorStepId: STEP_ID.toString(),
          criteriaFilter: bodyFilter(),
        }),
      ).toBe(
        CriteriaFilterMatchHistory.getFilterKey({
          monitorStepId: STEP_ID,
          criteriaFilter: bodyFilter(),
        }),
      );
    });

    test("is kept when only the window, its type or its no-data setting change", () => {
      const key: string = CriteriaFilterMatchHistory.getFilterKey({
        monitorStepId: STEP_ID,
        criteriaFilter: bodyFilter(),
      });

      for (const changed of [
        bodyFilter({
          evaluateOverTimeOptions: {
            timeValueInMinutes: 30,
            evaluateOverTimeType: EvaluateOverTimeType.AnyValue,
            onNoDataPolicy: NoDataPolicy.Trigger,
          },
        }),
        bodyFilter({ evaluateOverTime: false }),
        bodyFilter({ metricCriteriaContext: { metricName: "x" } as never }),
      ]) {
        expect(
          CriteriaFilterMatchHistory.getFilterKey({
            monitorStepId: STEP_ID,
            criteriaFilter: changed,
          }),
        ).toBe(key);
      }
    });

    test("changes with anything that changes what the filter checks", () => {
      const key: string = CriteriaFilterMatchHistory.getFilterKey({
        monitorStepId: STEP_ID,
        criteriaFilter: bodyFilter(),
      });

      const changedKeys: Array<string> = [
        bodyFilter({ value: "Dashboard" }),
        bodyFilter({ filterType: FilterType.Contains }),
        bodyFilter({ checkOn: CheckOn.ResponseHeader }),
        bodyFilter({ value: "app title" }),
      ].map((changed: CriteriaFilter): string => {
        return CriteriaFilterMatchHistory.getFilterKey({
          monitorStepId: STEP_ID,
          criteriaFilter: changed,
        });
      });

      for (const changedKey of changedKeys) {
        expect(changedKey).not.toBe(key);
      }

      expect(new Set(changedKeys).size).toBe(changedKeys.length);
    });

    test("differs between two steps of one monitor, which check different URLs", () => {
      expect(
        CriteriaFilterMatchHistory.getFilterKey({
          monitorStepId: ObjectID.generate(),
          criteriaFilter: bodyFilter(),
        }),
      ).not.toBe(
        CriteriaFilterMatchHistory.getFilterKey({
          monitorStepId: STEP_ID,
          criteriaFilter: bodyFilter(),
        }),
      );
    });
  });

  describe("isJudgedFromHistory", () => {
    test("a body filter evaluated over time on a Website monitor is", () => {
      expect(
        CriteriaFilterMatchHistory.isJudgedFromHistory({
          criteriaFilter: bodyFilter(),
          monitorType: MonitorType.Website,
        }),
      ).toBe(true);
    });

    test("a body filter judged on its latest check is not", () => {
      expect(
        CriteriaFilterMatchHistory.isJudgedFromHistory({
          criteriaFilter: bodyFilter({ evaluateOverTime: false }),
          monitorType: MonitorType.Website,
        }),
      ).toBe(false);
    });

    test("a filter with the box ticked but no window is not", () => {
      const criteriaFilter: CriteriaFilter = bodyFilter();
      delete criteriaFilter.evaluateOverTimeOptions;

      expect(
        CriteriaFilterMatchHistory.isJudgedFromHistory({
          criteriaFilter: criteriaFilter,
          monitorType: MonitorType.Website,
        }),
      ).toBe(false);
    });

    test("a check with a series of its own is not - its series is", () => {
      expect(
        CriteriaFilterMatchHistory.isJudgedFromHistory({
          criteriaFilter: bodyFilter({
            checkOn: CheckOn.ResponseTime,
            filterType: FilterType.GreaterThan,
            value: 3000,
          }),
          monitorType: MonitorType.Website,
        }),
      ).toBe(false);
    });

    test("a check that keeps no history on this monitor type is not", () => {
      expect(
        CriteriaFilterMatchHistory.isJudgedFromHistory({
          criteriaFilter: bodyFilter({
            checkOn: CheckOn.JavaScriptExpression,
            filterType: FilterType.EvaluatesToTrue,
            value: "{{rowCount}} > 0",
          }),
          monitorType: MonitorType.SQLQuery,
        }),
      ).toBe(false);
    });
  });

  describe("getFiltersKeepingHistory", () => {
    test("collects them from every criteria, not only the first", () => {
      const headerFilter: CriteriaFilter = bodyFilter({
        checkOn: CheckOn.ResponseHeader,
        filterType: FilterType.Contains,
        value: "x-maintenance",
      });

      const filters: Array<FilterKeepingMatchHistory> =
        CriteriaFilterMatchHistory.getFiltersKeepingHistory({
          monitorType: MonitorType.Website,
          monitorStep: stepWith([
            criteriaInstance({ filters: [bodyFilter()] }),
            criteriaInstance({ filters: [headerFilter] }),
          ]),
        });

      expect(
        filters.map((entry: FilterKeepingMatchHistory) => {
          return entry.criteriaFilter.checkOn;
        }),
      ).toEqual([CheckOn.ResponseBody, CheckOn.ResponseHeader]);
    });

    test("keeps one history for a filter two criteria share", () => {
      const filters: Array<FilterKeepingMatchHistory> =
        CriteriaFilterMatchHistory.getFiltersKeepingHistory({
          monitorType: MonitorType.Website,
          monitorStep: stepWith([
            criteriaInstance({ filters: [bodyFilter()] }),
            criteriaInstance({
              // Same check, its own window: still the same history.
              filters: [bodyFilter(anyValue(15))],
            }),
          ]),
        });

      expect(filters).toHaveLength(1);
      expect(filters[0]!.filterKey).toBe(
        CriteriaFilterMatchHistory.getFilterKey({
          monitorStepId: STEP_ID,
          criteriaFilter: bodyFilter(),
        }),
      );
    });

    test("leaves out disabled criteria", () => {
      expect(
        CriteriaFilterMatchHistory.getFiltersKeepingHistory({
          monitorType: MonitorType.Website,
          monitorStep: stepWith([
            criteriaInstance({ filters: [bodyFilter()], isEnabled: false }),
          ]),
        }),
      ).toEqual([]);
    });

    test("leaves out filters judged any other way", () => {
      expect(
        CriteriaFilterMatchHistory.getFiltersKeepingHistory({
          monitorType: MonitorType.Website,
          monitorStep: stepWith([
            criteriaInstance({
              filters: [
                bodyFilter({ evaluateOverTime: false }),
                {
                  checkOn: CheckOn.IsOnline,
                  filterType: FilterType.False,
                  value: undefined,
                  evaluateOverTime: true,
                  evaluateOverTimeOptions: {
                    timeValueInMinutes: 5,
                    evaluateOverTimeType: EvaluateOverTimeType.AllValues,
                  },
                },
              ],
            }),
          ]),
        }),
      ).toEqual([]);
    });

    test("a monitor type without match histories keeps none", () => {
      expect(
        CriteriaFilterMatchHistory.getFiltersKeepingHistory({
          monitorType: MonitorType.SyntheticMonitor,
          monitorStep: stepWith([
            criteriaInstance({ filters: [bodyFilter()] }),
          ]),
        }),
      ).toEqual([]);
    });

    test("a step without criteria keeps none", () => {
      expect(
        CriteriaFilterMatchHistory.getFiltersKeepingHistory({
          monitorType: MonitorType.Website,
          monitorStep: new MonitorStep(),
        }),
      ).toEqual([]);
    });
  });

  describe("record", () => {
    test("hands every check to the monitor metrics writer, with the probe", async () => {
      const save: SpyInstance<
        typeof MonitorMetricUtil.saveCriteriaFilterMatches
      > = jest
        .spyOn(MonitorMetricUtil, "saveCriteriaFilterMatches")
        .mockResolvedValue();
      const probeId: ObjectID = ObjectID.generate();

      await CriteriaFilterMatchHistory.record({
        projectId: PROJECT_ID,
        monitorId: MONITOR_ID,
        probeId: probeId,
        checks: [
          { filterKey: "a", matched: true, at: NOW },
          { filterKey: "b", matched: false, at: NOW },
        ],
      });

      expect(save).toHaveBeenCalledTimes(1);
      expect(save.mock.calls[0]![0]).toEqual({
        projectId: PROJECT_ID,
        monitorId: MONITOR_ID,
        probeId: probeId,
        matches: [
          { filterKey: "a", matched: true },
          { filterKey: "b", matched: false },
        ],
      });
    });

    test("writes nothing when no filter keeps a history", async () => {
      const save: SpyInstance<
        typeof MonitorMetricUtil.saveCriteriaFilterMatches
      > = jest
        .spyOn(MonitorMetricUtil, "saveCriteriaFilterMatches")
        .mockResolvedValue();

      await CriteriaFilterMatchHistory.record({
        projectId: PROJECT_ID,
        monitorId: MONITOR_ID,
        checks: [],
      });

      expect(save).not.toHaveBeenCalled();
    });

    test("a write that fails costs the evaluation nothing", async () => {
      jest
        .spyOn(MonitorMetricUtil, "saveCriteriaFilterMatches")
        .mockRejectedValue(new Error("ClickHouse is away"));

      await expect(
        CriteriaFilterMatchHistory.record({
          projectId: PROJECT_ID,
          monitorId: MONITOR_ID,
          checks: [thisCheck(true)],
        }),
      ).resolves.toBeUndefined();

      expect(logger.error).toHaveBeenCalled();
    });
  });

  describe("judgeWindow: All Values", () => {
    test("is met once the text has been missing on every check of the window", async () => {
      storedChecks = everyMinuteBefore([1, 1, 1, 1, 1]);

      const judgement: MatchHistoryJudgement = await judge({
        criteriaFilter: bodyFilter(),
        matched: true,
      });

      expect(judgement.rootCause).toBe(
        'Response Body Not Contains "App Title" matched on every check over the last 5 minutes (6 checks).',
      );
      expect(judgement.message).toBe(judgement.rootCause);
    });

    /*
     * Issue #4686: the first page of a restarting app ("Application
     * starting...") fired the incident. A brand new window must wait.
     */
    test("waits on the first check of a placeholder page", async () => {
      storedChecks = [];

      const judgement: MatchHistoryJudgement = await judge({
        criteriaFilter: bodyFilter(),
        matched: true,
      });

      expect(judgement.rootCause).toBeNull();
      /*
       * A check stands for the interval before it, as the coverage rule
       * counts it: one check a minute covers a minute.
       */
      expect(judgement.message).toBe(
        'Response Body Not Contains "App Title" has matched on every check for 1 minute (1 check); All Values waits until it has for 5 minutes.',
      );
    });

    test("still waits three checks into a five minute window", async () => {
      storedChecks = everyMinuteBefore([1, 1]);

      const judgement: MatchHistoryJudgement = await judge({
        criteriaFilter: bodyFilter(),
        matched: true,
      });

      expect(judgement.rootCause).toBeNull();
      expect(judgement.message).toBe(
        'Response Body Not Contains "App Title" has matched on every check for 3 minutes (3 checks); All Values waits until it has for 5 minutes.',
      );
    });

    test("is met by five checks a minute apart, which cover five minutes", async () => {
      storedChecks = everyMinuteBefore([1, 1, 1, 1]);

      expect(
        (await judge({ criteriaFilter: bodyFilter(), matched: true }))
          .rootCause,
      ).toBe(
        'Response Body Not Contains "App Title" matched on every check over the last 5 minutes (5 checks).',
      );
    });

    test("counts the time from the checks themselves when the schedule is unknown", async () => {
      storedChecks = everyMinuteBefore([1, 1]);

      const judgement: MatchHistoryJudgement = await judge({
        criteriaFilter: bodyFilter(),
        matched: true,
        monitoringInterval: "not a schedule",
      });

      // The checks are a minute apart, so each still stands for a minute.
      expect(judgement.message).toContain("for 3 minutes (3 checks)");
    });

    test("waits when the checks start part way through the window - a monitor that was paused", async () => {
      storedChecks = [
        storedCheck({ matched: true, minutesAgo: 2 }),
        storedCheck({ matched: true, minutesAgo: 1 }),
      ];

      expect(
        (await judge({ criteriaFilter: bodyFilter(), matched: true }))
          .rootCause,
      ).toBeNull();
    });

    test("is not met when the app came back for a single check in the window - flapping", async () => {
      storedChecks = everyMinuteBefore([1, 1, 0, 1, 1]);

      const judgement: MatchHistoryJudgement = await judge({
        criteriaFilter: bodyFilter(),
        matched: true,
      });

      expect(judgement.rootCause).toBeNull();
      expect(judgement.message).toBe(
        'Response Body Not Contains "App Title" matched on 5 of the 6 checks over the last 5 minutes; All Values needs every check.',
      );
    });

    test("stops the moment the app recovers, without reading the history", async () => {
      storedChecks = everyMinuteBefore([1, 1, 1, 1, 1]);

      const judgement: MatchHistoryJudgement = await judge({
        criteriaFilter: bodyFilter(),
        matched: false,
      });

      expect(judgement.rootCause).toBeNull();
      expect(judgement.message).toBe(
        'Response Body Not Contains "App Title" did not match on this check, so it has not matched on every check over the last 5 minutes.',
      );
      // A healthy check settles All Values: a healthy app costs no read.
      expect(findByCalls).toHaveLength(0);
    });

    test("reads exactly this filter's history over exactly the window", async () => {
      storedChecks = everyMinuteBefore([1, 1, 1, 1, 1]);

      await judge({ criteriaFilter: bodyFilter(), matched: true });

      expect(findByCalls).toHaveLength(1);

      const query: JSONObject = findByCalls[0]!.query as unknown as JSONObject;

      expect(query["projectId"]).toBe(PROJECT_ID);
      expect(query["primaryEntityId"]).toBe(MONITOR_ID);
      expect(query["name"]).toBe(CRITERIA_FILTER_MATCH_METRIC_NAME);
      expect(query["attributes"]).toEqual({
        [CRITERIA_FILTER_KEY_ATTRIBUTE]: FILTER_KEY,
      });

      const time: InBetween<Date> = query["time"] as unknown as InBetween<Date>;

      expect(time.startValue).toEqual(new Date(NOW.getTime() - 5 * MINUTE_IN_MS));
      expect(time.endValue).toEqual(NOW);
      expect(findByCalls[0]!.select).toEqual({ value: true, time: true });
      expect(findByCalls[0]!.props).toEqual({ isRoot: true });
    });

    test("is not met when the history cannot be read - a read failure is never a breach", async () => {
      readError = new Error("ClickHouse is away");

      const judgement: MatchHistoryJudgement = await judge({
        criteriaFilter: bodyFilter(),
        matched: true,
      });

      expect(judgement.rootCause).toBeNull();
      expect(judgement.message).toBe(
        'The checks of the last 5 minutes could not be read, so Response Body Not Contains "App Title" was not judged over them.',
      );
      expect(logger.error).toHaveBeenCalled();
    });

    test("skips stored rows it cannot read, and reads 0 as did not match", async () => {
      const unreadable: Metric = new Metric();
      unreadable.time = new Date(NOW.getTime() - 3 * MINUTE_IN_MS);

      storedChecks = [
        ...everyMinuteBefore([1, 1, 1, 1, 1]),
        unreadable,
        storedCheck({ matched: false, minutesAgo: 0.5 }),
      ];

      const judgement: MatchHistoryJudgement = await judge({
        criteriaFilter: bodyFilter(),
        matched: true,
      });

      expect(judgement.message).toBe(
        'Response Body Not Contains "App Title" matched on 6 of the 7 checks over the last 5 minutes; All Values needs every check.',
      );
    });

    test("an aggregate saved through the API is judged as All Values", async () => {
      storedChecks = everyMinuteBefore([1, 1, 0, 1, 1]);

      const judgement: MatchHistoryJudgement = await judge({
        criteriaFilter: bodyFilter({
          evaluateOverTimeOptions: {
            timeValueInMinutes: 5,
            evaluateOverTimeType: EvaluateOverTimeType.Average,
          },
        }),
        matched: true,
      });

      expect(judgement.rootCause).toBeNull();
      expect(judgement.message).toContain("All Values needs every check");
    });

    test("a window saved as a string, as the dashboard used to, is the same window", async () => {
      storedChecks = everyMinuteBefore([1, 1, 1, 1, 1]);

      const judgement: MatchHistoryJudgement = await judge({
        criteriaFilter: bodyFilter({
          evaluateOverTimeOptions: {
            timeValueInMinutes: "5" as unknown as number,
            evaluateOverTimeType: EvaluateOverTimeType.AllValues,
          },
        }),
        matched: true,
      });

      expect(judgement.rootCause).toContain("over the last 5 minutes");
    });
  });

  describe("judgeWindow: the monitor's schedule decides when the window is covered", () => {
    test("checks every 5 minutes cover a 15 minute window with three checks", async () => {
      storedChecks = [
        storedCheck({ matched: true, minutesAgo: 10 }),
        storedCheck({ matched: true, minutesAgo: 5 }),
      ];

      const judgement: MatchHistoryJudgement = await judge({
        criteriaFilter: bodyFilter(anyValueAsAll(15)),
        matched: true,
        monitoringInterval: EVERY_FIVE_MINUTES,
      });

      expect(judgement.rootCause).toBe(
        'Response Body Not Contains "App Title" matched on every check over the last 15 minutes (3 checks).',
      );
    });

    test("but not with two", async () => {
      storedChecks = [storedCheck({ matched: true, minutesAgo: 5 })];

      expect(
        (
          await judge({
            criteriaFilter: bodyFilter(anyValueAsAll(15)),
            matched: true,
            monitoringInterval: EVERY_FIVE_MINUTES,
          })
        ).rootCause,
      ).toBeNull();
    });

    /*
     * The trap the form's "For the last" description warns about: a window
     * no longer than the monitoring interval holds a single check, so that
     * check covers it - the same rule every over-time filter has.
     */
    test("a 5 minute window on a monitor checked every 5 minutes holds one check", async () => {
      storedChecks = [];

      expect(
        (
          await judge({
            criteriaFilter: bodyFilter(),
            matched: true,
            monitoringInterval: EVERY_FIVE_MINUTES,
          })
        ).rootCause,
      ).toBe(
        'Response Body Not Contains "App Title" matched on every check over the last 5 minutes (1 check).',
      );
    });
  });

  describe("judgeWindow: If No Data", () => {
    test("Trigger makes a window that is still filling up met", async () => {
      storedChecks = everyMinuteBefore([1, 1]);

      const judgement: MatchHistoryJudgement = await judge({
        criteriaFilter: bodyFilter({
          evaluateOverTimeOptions: {
            timeValueInMinutes: 5,
            evaluateOverTimeType: EvaluateOverTimeType.AllValues,
            onNoDataPolicy: NoDataPolicy.Trigger,
          },
        }),
        matched: true,
      });

      expect(judgement.rootCause).toBe(
        'Response Body Not Contains "App Title" has matched on every check for 3 minutes (3 checks), not yet 5 minutes, and its If No Data setting is Trigger.',
      );
    });

    test("Trigger never makes a check that did not match met", async () => {
      storedChecks = [];

      expect(
        (
          await judge({
            criteriaFilter: bodyFilter({
              evaluateOverTimeOptions: {
                timeValueInMinutes: 5,
                evaluateOverTimeType: EvaluateOverTimeType.AllValues,
                onNoDataPolicy: NoDataPolicy.Trigger,
              },
            }),
            matched: false,
          })
        ).rootCause,
      ).toBeNull();
    });

    test("Treat As Zero waits, like Ignore: missing checks did not match", async () => {
      storedChecks = everyMinuteBefore([1, 1]);

      expect(
        (
          await judge({
            criteriaFilter: bodyFilter({
              evaluateOverTimeOptions: {
                timeValueInMinutes: 5,
                evaluateOverTimeType: EvaluateOverTimeType.AllValues,
                onNoDataPolicy: NoDataPolicy.TreatAsZero,
              },
            }),
            matched: true,
          })
        ).rootCause,
      ).toBeNull();
    });

    test("a window with no length waits, or is met with Trigger", async () => {
      const noWindow: CriteriaFilter = bodyFilter({
        evaluateOverTimeOptions: {
          timeValueInMinutes: 0,
          evaluateOverTimeType: EvaluateOverTimeType.AllValues,
        },
      });

      const ignored: MatchHistoryJudgement = await judge({
        criteriaFilter: noWindow,
        matched: true,
      });

      expect(ignored.rootCause).toBeNull();
      expect(ignored.message).toBe(
        'Response Body Not Contains "App Title" has no window to look back over, so it was not judged.',
      );

      const triggered: MatchHistoryJudgement = await judge({
        criteriaFilter: bodyFilter({
          evaluateOverTimeOptions: {
            timeValueInMinutes: undefined,
            evaluateOverTimeType: EvaluateOverTimeType.AllValues,
            onNoDataPolicy: NoDataPolicy.Trigger,
          },
        }),
        matched: true,
      });

      expect(triggered.rootCause).toBe(
        'Response Body Not Contains "App Title" has no window to look back over, and its If No Data setting is Trigger.',
      );
      expect(findByCalls).toHaveLength(0);
    });
  });

  describe("judgeWindow: Any Value", () => {
    test("is met by this check alone, without reading the history", async () => {
      const judgement: MatchHistoryJudgement = await judge({
        criteriaFilter: bodyFilter(anyValue()),
        matched: true,
      });

      expect(judgement.rootCause).toBe(
        'Response Body Not Contains "App Title" matched on this check (Any Value over the last 5 minutes).',
      );
      expect(findByCalls).toHaveLength(0);
    });

    test("stays met for the window after the app recovers", async () => {
      storedChecks = everyMinuteBefore([0, 0, 1, 0, 0]);

      const judgement: MatchHistoryJudgement = await judge({
        criteriaFilter: bodyFilter(anyValue()),
        matched: false,
      });

      expect(judgement.rootCause).toBe(
        'Response Body Not Contains "App Title" matched on 1 of the 6 checks over the last 5 minutes, though not on this one.',
      );
    });

    test("is not met when no check of the window matched", async () => {
      storedChecks = everyMinuteBefore([0, 0, 0, 0, 0]);

      const judgement: MatchHistoryJudgement = await judge({
        criteriaFilter: bodyFilter(anyValue()),
        matched: false,
      });

      expect(judgement.rootCause).toBeNull();
      expect(judgement.message).toBe(
        'Response Body Not Contains "App Title" did not match on any of the 6 checks over the last 5 minutes.',
      );
    });

    test("names the only check of a new window", async () => {
      storedChecks = [];

      expect(
        (await judge({ criteriaFilter: bodyFilter(anyValue()), matched: false }))
          .message,
      ).toBe(
        'Response Body Not Contains "App Title" did not match on the only check over the last 5 minutes.',
      );
    });

    test("is not met when the history cannot be read and this check did not match", async () => {
      readError = new Error("ClickHouse is away");

      expect(
        (await judge({ criteriaFilter: bodyFilter(anyValue()), matched: false }))
          .rootCause,
      ).toBeNull();
    });
  });

  describe("getFilterLabel", () => {
    test("quotes the text a body filter looks for", () => {
      expect(CriteriaFilterMatchHistory.getFilterLabel(bodyFilter())).toBe(
        'Response Body Not Contains "App Title"',
      );
    });

    test("names a yes/no filter by its condition", () => {
      expect(
        CriteriaFilterMatchHistory.getFilterLabel({
          checkOn: CheckOn.IsRequestTimeout,
          filterType: FilterType.True,
          value: undefined,
        }),
      ).toBe("Is Request Timeout True");
    });

    test("quotes an expression", () => {
      expect(
        CriteriaFilterMatchHistory.getFilterLabel({
          checkOn: CheckOn.JavaScriptExpression,
          filterType: FilterType.EvaluatesToTrue,
          value: "{{responseBody.status}} === 'starting'",
        }),
      ).toBe(
        "JavaScript Expression Evaluates To True \"{{responseBody.status}} === 'starting'\"",
      );
    });
  });
});

// All Values over a window of the given length.
function anyValueAsAll(minutes: number): Partial<CriteriaFilter> {
  return {
    evaluateOverTimeOptions: {
      timeValueInMinutes: minutes,
      evaluateOverTimeType: EvaluateOverTimeType.AllValues,
    },
  };
}
