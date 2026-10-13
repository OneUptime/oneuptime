import CriteriaFilterMatchHistory, {
  CriteriaFilterCheck,
  CriteriaFilterMatchHistoryReads,
  FilterKeepingMatchHistory,
  MatchHistoryJudgement,
} from "../../../../../Server/Utils/Monitor/Criteria/CriteriaFilterMatchHistory";
import MonitorMetricUtil from "../../../../../Server/Utils/Monitor/MonitorMetricUtil";
import MetricService from "../../../../../Server/Services/MetricService";
import FindBy from "../../../../../Server/Types/AnalyticsDatabase/FindBy";
import logger from "../../../../../Server/Utils/Logger";
import Metric from "../../../../../Models/AnalyticsModels/Metric";
import InBetween from "../../../../../Types/BaseDatabase/InBetween";
import SortOrder from "../../../../../Types/BaseDatabase/SortOrder";
import { LIMIT_PER_PROJECT } from "../../../../../Types/Database/LimitMax";
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
const SECOND_IN_MS: number = 1000;

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const MONITOR_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const STEP_ID: ObjectID = new ObjectID("33333333-3333-4333-8333-333333333333");

const PROBE_A: ObjectID = new ObjectID("44444444-4444-4444-8444-444444444444");
const PROBE_B: ObjectID = new ObjectID("55555555-5555-4555-8555-555555555555");

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

// All Values over a window of the given length.
function allValues(
  minutes: number,
  onNoDataPolicy?: NoDataPolicy,
): Partial<CriteriaFilter> {
  return {
    evaluateOverTimeOptions: {
      timeValueInMinutes: minutes,
      evaluateOverTimeType: EvaluateOverTimeType.AllValues,
      ...(onNoDataPolicy ? { onNoDataPolicy: onNoDataPolicy } : {}),
    },
  };
}

/*
 * A stored check, `minutesAgo` before now: 1 matched, 0 did not. Written by
 * `probeId`, or by no probe.
 */
function storedCheck(input: {
  matched: boolean;
  minutesAgo: number;
  probeId?: ObjectID;
}): Metric {
  const metric: Metric = new Metric();
  metric.value = input.matched ? 1 : 0;
  metric.time = new Date(NOW.getTime() - input.minutesAgo * MINUTE_IN_MS);
  metric.attributes = {
    [CRITERIA_FILTER_KEY_ATTRIBUTE]: FILTER_KEY,
    ...(input.probeId ? { probeId: input.probeId.toString() } : {}),
  };
  return metric;
}

/*
 * The checks before this one, one a minute, the oldest first and the newest
 * a minute ago: everyMinuteBefore([1, 1, 0]) is three checks, 3, 2 and 1
 * minutes ago.
 */
function everyMinuteBefore(
  matched: Array<0 | 1>,
  probeId?: ObjectID,
): Array<Metric> {
  return matched.map((value: 0 | 1, index: number) => {
    return storedCheck({
      matched: value === 1,
      minutesAgo: matched.length - index,
      ...(probeId ? { probeId: probeId } : {}),
    });
  });
}

let findByCalls: Array<FindBy<Metric>> = [];
let storedChecks: Array<Metric> = [];
let readError: Error | null = null;

function judge(input: {
  criteriaFilter: CriteriaFilter;
  matched: boolean;
  monitoringInterval?: string | undefined;
  probeId?: ObjectID | undefined;
  // A stored check read back for probe agreement, made this long ago.
  storedMinutesAgo?: number | undefined;
  reads?: CriteriaFilterMatchHistoryReads | undefined;
}): Promise<MatchHistoryJudgement> {
  const check: CriteriaFilterCheck = {
    filterKey: FILTER_KEY,
    matched: input.matched,
    at: new Date(NOW.getTime() - (input.storedMinutesAgo ?? 0) * MINUTE_IN_MS),
  };

  return CriteriaFilterMatchHistory.judgeWindow({
    projectId: PROJECT_ID,
    monitorId: MONITOR_ID,
    probeId: input.probeId,
    criteriaFilter: input.criteriaFilter,
    check: check,
    isStoredCheck: input.storedMinutesAgo !== undefined,
    monitoringInterval: input.monitoringInterval ?? EVERY_MINUTE,
    reads: input.reads,
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

function keyOf(criteriaFilter: CriteriaFilter): string {
  return CriteriaFilterMatchHistory.getFilterKey({
    monitorStepId: STEP_ID,
    criteriaFilter: criteriaFilter,
  });
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
      expect(keyOf(bodyFilter())).toMatch(/^[0-9a-f]{32}$/);
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

      expect(keyOf(readBack)).toBe(keyOf(written));
    });

    test("names the step as an id or as its string, alike", () => {
      expect(
        CriteriaFilterMatchHistory.getFilterKey({
          monitorStepId: STEP_ID.toString(),
          criteriaFilter: bodyFilter(),
        }),
      ).toBe(keyOf(bodyFilter()));
    });

    test("is kept when only the window, its type or its no-data setting change", () => {
      const key: string = keyOf(bodyFilter());

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
        expect(keyOf(changed)).toBe(key);
      }
    });

    /*
     * A re-save of the monitor that changes nothing must not start every
     * history over: All Values would wait a whole window again, and an
     * outage already under way would stop being reported meanwhile.
     */
    test("is kept when a re-save writes empty fields differently", () => {
      const key: string = keyOf(bodyFilter());

      for (const resaved of [
        bodyFilter({ serverMonitorOptions: null as never }),
        bodyFilter({ metricMonitorOptions: {} as never }),
        bodyFilter({ snmpMonitorOptions: undefined }),
        bodyFilter({
          customCodeMonitorOptions: { pattern: null } as never,
        }),
        bodyFilter({ databaseMonitorOptions: [] as never }),
      ]) {
        expect(keyOf(resaved)).toBe(key);
      }
    });

    test("is kept when a value is saved as its digits", () => {
      expect(keyOf(bodyFilter({ value: "404" }))).toBe(
        keyOf(bodyFilter({ value: 404 })),
      );
    });

    test("reads an empty value like no value", () => {
      const timeout: CriteriaFilter = {
        checkOn: CheckOn.IsRequestTimeout,
        filterType: FilterType.True,
        value: undefined,
      };

      expect(keyOf({ ...timeout, value: "" })).toBe(keyOf(timeout));
      expect(keyOf({ ...timeout, value: null as never })).toBe(keyOf(timeout));
    });

    test("changes with anything that changes what the filter checks", () => {
      const key: string = keyOf(bodyFilter());

      const changedKeys: Array<string> = [
        bodyFilter({ value: "Dashboard" }),
        bodyFilter({ filterType: FilterType.Contains }),
        bodyFilter({ checkOn: CheckOn.ResponseHeader }),
        // Case and surrounding spaces are part of what is looked for.
        bodyFilter({ value: "app title" }),
        bodyFilter({ value: "App Title " }),
        bodyFilter({ value: "0" }),
        bodyFilter({
          customCodeMonitorOptions: { pattern: "x" } as never,
        }),
      ].map((changed: CriteriaFilter): string => {
        return keyOf(changed);
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
      ).not.toBe(keyOf(bodyFilter()));
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

    /*
     * Saved through the API, or with the minutes dropdown cleared: judged
     * from the history, its If No Data setting would decide every check -
     * Trigger would keep the monitor down for good. It is judged on the
     * latest check instead, as it always was.
     */
    test.each([
      ["no minutes", undefined],
      ["0 minutes", 0],
      ["a cleared dropdown", null],
      ["an empty string", ""],
      ["text", "soon"],
    ])(
      "a window of %s is not",
      (_name: string, timeValueInMinutes: unknown) => {
        expect(
          CriteriaFilterMatchHistory.isJudgedFromHistory({
            criteriaFilter: bodyFilter({
              evaluateOverTimeOptions: {
                timeValueInMinutes: timeValueInMinutes as number,
                evaluateOverTimeType: EvaluateOverTimeType.AllValues,
                onNoDataPolicy: NoDataPolicy.Trigger,
              },
            }),
            monitorType: MonitorType.Website,
          }),
        ).toBe(false);
      },
    );

    test("a window saved as a string of minutes is", () => {
      expect(
        CriteriaFilterMatchHistory.isJudgedFromHistory({
          criteriaFilter: bodyFilter({
            evaluateOverTimeOptions: {
              timeValueInMinutes: "5" as unknown as number,
              evaluateOverTimeType: EvaluateOverTimeType.AllValues,
            },
          }),
          monitorType: MonitorType.Website,
        }),
      ).toBe(true);
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
      expect(filters[0]!.filterKey).toBe(keyOf(bodyFilter()));
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

      await CriteriaFilterMatchHistory.record({
        projectId: PROJECT_ID,
        monitorId: MONITOR_ID,
        probeId: PROBE_A,
        checks: [
          { filterKey: "a", matched: true, at: NOW },
          { filterKey: "b", matched: false, at: NOW },
        ],
      });

      expect(save).toHaveBeenCalledTimes(1);
      expect(save.mock.calls[0]![0]).toEqual({
        projectId: PROJECT_ID,
        monitorId: MONITOR_ID,
        probeId: PROBE_A,
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
          checks: [{ filterKey: FILTER_KEY, matched: true, at: NOW }],
        }),
      ).resolves.toBeUndefined();

      expect(logger.error).toHaveBeenCalled();
    });
  });

  describe("judgeWindow: All Values", () => {
    test("is met once the text has been missing on every check for the whole window", async () => {
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
      expect(judgement.message).toBe(
        'Response Body Not Contains "App Title" has matched on 1 check so far; All Values waits until it has matched on every check for 5 minutes.',
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
        'Response Body Not Contains "App Title" has matched on every check for 2 minutes (3 checks); All Values waits until it has matched on every check for 5 minutes.',
      );
    });

    /*
     * Five checks a minute apart span four minutes: the placeholder has not
     * lasted five yet, however the checks are counted.
     */
    test("is not met by five checks a minute apart, which span four minutes", async () => {
      storedChecks = everyMinuteBefore([1, 1, 1, 1]);

      const judgement: MatchHistoryJudgement = await judge({
        criteriaFilter: bodyFilter(),
        matched: true,
      });

      expect(judgement.rootCause).toBeNull();
      expect(judgement.message).toBe(
        'Response Body Not Contains "App Title" has matched on every check for 4 minutes (5 checks); All Values waits until it has matched on every check for 5 minutes.',
      );
    });

    test("measures the checks against themselves when the schedule is unknown", async () => {
      storedChecks = everyMinuteBefore([1, 1]);

      const judgement: MatchHistoryJudgement = await judge({
        criteriaFilter: bodyFilter(),
        matched: true,
        monitoringInterval: "not a schedule",
      });

      expect(judgement.message).toContain("for 2 minutes (3 checks)");
    });

    /*
     * Without a schedule the cadence is the typical gap between the checks,
     * not the widest: measured against the widest, no gap could ever be
     * wider than the interval, and a run would be followed back across an
     * outage nobody saw.
     */
    test("sees a gap in the checks when the schedule is unknown", async () => {
      storedChecks = [
        storedCheck({ matched: true, minutesAgo: 14 }),
        storedCheck({ matched: true, minutesAgo: 13 }),
      ];

      const judgement: MatchHistoryJudgement = await judge({
        criteriaFilter: bodyFilter(),
        matched: true,
        monitoringInterval: "not a schedule",
      });

      expect(judgement.rootCause).toBeNull();
      expect(judgement.message).toBe(
        'Response Body Not Contains "App Title" has matched on 1 check since a 13-minute gap in its checks; All Values waits until it has matched on every check for 5 minutes.',
      );
    });

    test("is not met when the app came back for a single check in the window - flapping", async () => {
      storedChecks = everyMinuteBefore([1, 1, 0, 1, 1]);

      const judgement: MatchHistoryJudgement = await judge({
        criteriaFilter: bodyFilter(),
        matched: true,
      });

      /*
       * Five of the window's six checks matched, but the log says what
       * counts: the run since the app last came back, and what it waits for.
       */
      expect(judgement.rootCause).toBeNull();
      expect(judgement.message).toBe(
        'Response Body Not Contains "App Title" has matched on every check for 2 minutes (3 checks); All Values waits until it has matched on every check for 5 minutes.',
      );
    });

    /*
     * The common case of issue #4686: an app that was healthy starts
     * answering its placeholder. The window still holds the healthy checks
     * from before the restart, and the log used to count them - "matched on
     * 1 of the 2 checks over the last 5 minutes; All Values needs every
     * check" - which reads like the end of the story. It is the start: the
     * log says how long the placeholder has lasted and what the filter waits
     * for.
     */
    test("says how long it has matched, not how many checks of the window did, once a healthy app starts failing", async () => {
      storedChecks = everyMinuteBefore([0, 0, 0, 0, 0]);

      const firstCheck: MatchHistoryJudgement = await judge({
        criteriaFilter: bodyFilter(),
        matched: true,
      });

      expect(firstCheck.rootCause).toBeNull();
      expect(firstCheck.message).toBe(
        'Response Body Not Contains "App Title" has matched on 1 check so far; All Values waits until it has matched on every check for 5 minutes.',
      );

      storedChecks = everyMinuteBefore([0, 0, 1, 1, 1]);

      const fourthCheck: MatchHistoryJudgement = await judge({
        criteriaFilter: bodyFilter(),
        matched: true,
      });

      expect(fourthCheck.rootCause).toBeNull();
      expect(fourthCheck.message).toBe(
        'Response Body Not Contains "App Title" has matched on every check for 3 minutes (4 checks); All Values waits until it has matched on every check for 5 minutes.',
      );
    });

    test("on a monitor checked every 5 minutes, the first failing check after a healthy one waits for the next", async () => {
      storedChecks = [
        storedCheck({ matched: false, minutesAgo: 10 }),
        storedCheck({ matched: false, minutesAgo: 5 }),
      ];

      const judgement: MatchHistoryJudgement = await judge({
        criteriaFilter: bodyFilter(),
        matched: true,
        monitoringInterval: EVERY_FIVE_MINUTES,
      });

      expect(judgement.rootCause).toBeNull();
      expect(judgement.message).toBe(
        'Response Body Not Contains "App Title" has matched on 1 check so far; All Values waits until it has matched on every check for 5 minutes.',
      );
    });

    /*
     * Whatever the message says, the verdict is the window's: a check that
     * did not match within the window keeps All Values from being met, even
     * when the run since it - with a check that lands a little early - is
     * long enough to count as lasting the window.
     */
    test("a run that lasts the window is not met while the window still holds a check that did not match", async () => {
      storedChecks = [
        storedCheck({ matched: false, minutesAgo: 4.99 }),
        storedCheck({ matched: true, minutesAgo: 4.8 }),
        storedCheck({ matched: true, minutesAgo: 3 }),
        storedCheck({ matched: true, minutesAgo: 2 }),
        storedCheck({ matched: true, minutesAgo: 1 }),
      ];

      const judgement: MatchHistoryJudgement = await judge({
        criteriaFilter: bodyFilter(allValues(5, NoDataPolicy.Trigger)),
        matched: true,
      });

      expect(judgement.rootCause).toBeNull();
      expect(judgement.message).toBe(
        'Response Body Not Contains "App Title" has matched on every check for 4 minutes (5 checks); All Values waits until it has matched on every check for 5 minutes.',
      );
    });

    /*
     * Without a schedule, a stored check read back for probe agreement is
     * judged with its history even when it did not match: then the window's
     * count is what there is to say.
     */
    test("counts the window's checks when the newest of them did not match", async () => {
      storedChecks = everyMinuteBefore([1, 1, 1, 1, 1]);

      const judgement: MatchHistoryJudgement = await judge({
        criteriaFilter: bodyFilter(),
        matched: false,
        monitoringInterval: "not a schedule",
        storedMinutesAgo: 0,
      });

      expect(judgement.rootCause).toBeNull();
      expect(judgement.message).toBe(
        'Response Body Not Contains "App Title" matched on 5 of the 6 checks over the last 5 minutes; All Values needs every check.',
      );
    });

    test("waits for a run that started after a check before the window that did not match", async () => {
      storedChecks = [
        storedCheck({ matched: false, minutesAgo: 5.5 }),
        storedCheck({ matched: true, minutesAgo: 4.5 }),
        storedCheck({ matched: true, minutesAgo: 3.5 }),
        storedCheck({ matched: true, minutesAgo: 2.5 }),
        storedCheck({ matched: true, minutesAgo: 1.5 }),
        storedCheck({ matched: true, minutesAgo: 0.5 }),
      ];

      const judgement: MatchHistoryJudgement = await judge({
        criteriaFilter: bodyFilter(allValues(5, NoDataPolicy.Trigger)),
        matched: true,
      });

      /*
       * Every check of the window matched, but the one before it did not:
       * the placeholder has lasted four and a half minutes. That is not
       * missing data, so even Trigger waits.
       */
      expect(judgement.rootCause).toBeNull();
      expect(judgement.message).toBe(
        'Response Body Not Contains "App Title" has matched on every check for 4 minutes (6 checks); All Values waits until it has matched on every check for 5 minutes.',
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

    test("reads this filter's history, every probe's at once, back far enough to find where its run starts", async () => {
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

      /*
       * The 5 minute window, and twice the widest gap the run may cross
       * (two and a half one-minute intervals): back to where the run of
       * matching checks may start, and to another probe's newest check.
       */
      expect(time.startValue).toEqual(
        new Date(NOW.getTime() - 10 * MINUTE_IN_MS),
      );
      expect(time.endValue).toEqual(NOW);
      expect(findByCalls[0]!.select).toEqual({
        value: true,
        time: true,
        attributes: true,
      });
      expect(findByCalls[0]!.props).toEqual({ isRoot: true });

      /*
       * Newest first, so a read that reaches the row limit - every probe's
       * checks over a long window - leaves out the oldest checks: a history
       * that starts later, which makes All Values wait, never checks at
       * random from the middle of a run.
       */
      expect(findByCalls[0]!.sort).toEqual({ time: SortOrder.Descending });
      expect(findByCalls[0]!.limit).toBe(LIMIT_PER_PROJECT);
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

      const timeless: Metric = new Metric();
      timeless.value = 1;

      storedChecks = [
        ...everyMinuteBefore([1, 1, 1, 1, 1]),
        unreadable,
        timeless,
        storedCheck({ matched: false, minutesAgo: 0.5 }),
      ];

      // Any Value counts the checks it read: 5 matched, and the 0.
      const judgement: MatchHistoryJudgement = await judge({
        criteriaFilter: bodyFilter(anyValue()),
        matched: false,
      });

      expect(judgement.message).toBe(
        'Response Body Not Contains "App Title" matched on 5 of the 7 checks over the last 5 minutes, though not on this one.',
      );

      // And All Values reads the 0 as the check the run starts after.
      expect(
        (await judge({ criteriaFilter: bodyFilter(), matched: true })).message,
      ).toBe(
        'Response Body Not Contains "App Title" has matched on 1 check so far; All Values waits until it has matched on every check for 5 minutes.',
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
      expect(judgement.message).toContain(
        "All Values waits until it has matched on every check for 5 minutes",
      );
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

  describe("judgeWindow: gaps in the checks", () => {
    /*
     * A check whose row could not be written, a probe that was down, a
     * monitor that was paused: nobody knows what the missing checks found,
     * so the run of matching checks is not followed back across them.
     */
    test("a run is not followed back across checks that are missing - the app may have been healthy then", async () => {
      storedChecks = [
        storedCheck({ matched: true, minutesAgo: 15 }),
        storedCheck({ matched: true, minutesAgo: 14 }),
      ];

      const judgement: MatchHistoryJudgement = await judge({
        criteriaFilter: bodyFilter(allValues(15)),
        matched: true,
      });

      expect(judgement.rootCause).toBeNull();
      expect(judgement.message).toBe(
        'Response Body Not Contains "App Title" has matched on 1 check since a 14-minute gap in its checks; All Values waits until it has matched on every check for 15 minutes.',
      );
    });

    test("a gap is missing data, so Trigger fires on it", async () => {
      storedChecks = [
        storedCheck({ matched: true, minutesAgo: 15 }),
        storedCheck({ matched: true, minutesAgo: 14 }),
      ];

      expect(
        (
          await judge({
            criteriaFilter: bodyFilter(allValues(15, NoDataPolicy.Trigger)),
            matched: true,
          })
        ).rootCause,
      ).toBe(
        'Response Body Not Contains "App Title" has matched on 1 check since a 14-minute gap in its checks, not yet for 15 minutes, and its If No Data setting is Trigger.',
      );
    });

    /*
     * The gap is missing data, but the window also holds a check from before
     * it that did not match: that is data, and it says the filter has not
     * matched on every check. Trigger has no say.
     */
    test("Trigger does not fire across a gap when the window holds a check that did not match", async () => {
      storedChecks = [
        storedCheck({ matched: false, minutesAgo: 14 }),
        ...everyMinuteBefore([1, 1, 1, 1, 1, 1, 1, 1, 1, 1]),
      ];

      const judgement: MatchHistoryJudgement = await judge({
        criteriaFilter: bodyFilter(allValues(15, NoDataPolicy.Trigger)),
        matched: true,
      });

      expect(judgement.rootCause).toBeNull();
      expect(judgement.message).toBe(
        'Response Body Not Contains "App Title" has matched on every check for 10 minutes (11 checks) since a 4-minute gap in its checks; All Values waits until it has matched on every check for 15 minutes.',
      );
    });

    test("a monitor that was paused waits a whole window from when it resumed", async () => {
      storedChecks = [
        storedCheck({ matched: true, minutesAgo: 9 }),
        storedCheck({ matched: true, minutesAgo: 8 }),
        storedCheck({ matched: true, minutesAgo: 7 }),
        storedCheck({ matched: true, minutesAgo: 2 }),
        storedCheck({ matched: true, minutesAgo: 1 }),
      ];

      const judgement: MatchHistoryJudgement = await judge({
        criteriaFilter: bodyFilter(),
        matched: true,
      });

      expect(judgement.rootCause).toBeNull();
      expect(judgement.message).toBe(
        'Response Body Not Contains "App Title" has matched on every check for 2 minutes (3 checks) since a 5-minute gap in its checks; All Values waits until it has matched on every check for 5 minutes.',
      );
    });

    test("a single missing check is bridged - one row that failed to write costs no window", async () => {
      storedChecks = [
        storedCheck({ matched: true, minutesAgo: 6 }),
        storedCheck({ matched: true, minutesAgo: 5 }),
        storedCheck({ matched: true, minutesAgo: 4 }),
        // 3 minutes ago is missing.
        storedCheck({ matched: true, minutesAgo: 2 }),
        storedCheck({ matched: true, minutesAgo: 1 }),
      ];

      expect(
        (await judge({ criteriaFilter: bodyFilter(), matched: true }))
          .rootCause,
      ).toBe(
        'Response Body Not Contains "App Title" matched on every check over the last 5 minutes (5 checks).',
      );
    });

    test("two missing checks in a row are a gap", async () => {
      storedChecks = [
        storedCheck({ matched: true, minutesAgo: 7 }),
        storedCheck({ matched: true, minutesAgo: 6 }),
        storedCheck({ matched: true, minutesAgo: 5 }),
        storedCheck({ matched: true, minutesAgo: 4 }),
        // 3 and 2 minutes ago are missing.
        storedCheck({ matched: true, minutesAgo: 1 }),
      ];

      expect(
        (await judge({ criteriaFilter: bodyFilter(), matched: true }))
          .rootCause,
      ).toBeNull();
    });
  });

  describe("judgeWindow: the monitor's schedule", () => {
    test("checks every 5 minutes meet a 15 minute window with four checks in a row", async () => {
      storedChecks = [
        storedCheck({ matched: true, minutesAgo: 15 }),
        storedCheck({ matched: true, minutesAgo: 10 }),
        storedCheck({ matched: true, minutesAgo: 5 }),
      ];

      const judgement: MatchHistoryJudgement = await judge({
        criteriaFilter: bodyFilter(allValues(15)),
        matched: true,
        monitoringInterval: EVERY_FIVE_MINUTES,
      });

      expect(judgement.rootCause).toBe(
        'Response Body Not Contains "App Title" matched on every check over the last 15 minutes (4 checks).',
      );
    });

    test("but not with three, which span ten minutes", async () => {
      storedChecks = [
        storedCheck({ matched: true, minutesAgo: 10 }),
        storedCheck({ matched: true, minutesAgo: 5 }),
      ];

      const judgement: MatchHistoryJudgement = await judge({
        criteriaFilter: bodyFilter(allValues(15)),
        matched: true,
        monitoringInterval: EVERY_FIVE_MINUTES,
      });

      expect(judgement.rootCause).toBeNull();
      expect(judgement.message).toBe(
        'Response Body Not Contains "App Title" has matched on every check for 10 minutes (3 checks); All Values waits until it has matched on every check for 15 minutes.',
      );
    });

    /*
     * The default a ticked box gets, on the default interval of a new
     * monitor: a window as long as the interval holds one check, and one
     * check never lasts a window - the placeholder must still be there on
     * the next check.
     */
    test("a 5 minute window on a monitor checked every 5 minutes waits for a second check", async () => {
      storedChecks = [];

      const firstCheck: MatchHistoryJudgement = await judge({
        criteriaFilter: bodyFilter(),
        matched: true,
        monitoringInterval: EVERY_FIVE_MINUTES,
      });

      expect(firstCheck.rootCause).toBeNull();
      expect(firstCheck.message).toBe(
        'Response Body Not Contains "App Title" has matched on 1 check so far; All Values waits until it has matched on every check for 5 minutes.',
      );

      storedChecks = [storedCheck({ matched: true, minutesAgo: 5 })];

      expect(
        (
          await judge({
            criteriaFilter: bodyFilter(),
            matched: true,
            monitoringInterval: EVERY_FIVE_MINUTES,
          })
        ).rootCause,
      ).toBe(
        'Response Body Not Contains "App Title" matched on every check over the last 5 minutes (2 checks).',
      );
    });

    test("and so does a window shorter than the interval", async () => {
      storedChecks = [];

      expect(
        (
          await judge({
            criteriaFilter: bodyFilter(allValues(2)),
            matched: true,
            monitoringInterval: EVERY_FIVE_MINUTES,
          })
        ).rootCause,
      ).toBeNull();

      storedChecks = [storedCheck({ matched: true, minutesAgo: 5 })];

      expect(
        (
          await judge({
            criteriaFilter: bodyFilter(allValues(2)),
            matched: true,
            monitoringInterval: EVERY_FIVE_MINUTES,
          })
        ).rootCause,
      ).not.toBeNull();
    });

    test("a check that arrived a few seconds early still completes the window", async () => {
      storedChecks = [
        storedCheck({
          matched: true,
          minutesAgo: (5 * MINUTE_IN_MS - 10 * SECOND_IN_MS) / MINUTE_IN_MS,
        }),
      ];

      expect(
        (
          await judge({
            criteriaFilter: bodyFilter(),
            matched: true,
            monitoringInterval: EVERY_FIVE_MINUTES,
          })
        ).rootCause,
      ).toBe(
        'Response Body Not Contains "App Title" matched on every check over the last 5 minutes (2 checks).',
      );
    });

    test("checks a minute apart, each a few seconds off, complete the window on the sixth", async () => {
      storedChecks = [4.85, 3.85, 2.85, 1.85, 0.85].map(
        (minutesAgo: number): Metric => {
          return storedCheck({ matched: true, minutesAgo: minutesAgo });
        },
      );

      expect(
        (await judge({ criteriaFilter: bodyFilter(), matched: true }))
          .rootCause,
      ).toBe(
        'Response Body Not Contains "App Title" matched on every check over the last 5 minutes (6 checks).',
      );
    });

    test("but not a run a whole check short", async () => {
      storedChecks = [3.85, 2.85, 1.85, 0.85].map(
        (minutesAgo: number): Metric => {
          return storedCheck({ matched: true, minutesAgo: minutesAgo });
        },
      );

      expect(
        (await judge({ criteriaFilter: bodyFilter(), matched: true }))
          .rootCause,
      ).toBeNull();
    });
  });

  describe("judgeWindow: If No Data", () => {
    test("Trigger makes a window that is still filling up met", async () => {
      storedChecks = everyMinuteBefore([1, 1]);

      const judgement: MatchHistoryJudgement = await judge({
        criteriaFilter: bodyFilter(allValues(5, NoDataPolicy.Trigger)),
        matched: true,
      });

      expect(judgement.rootCause).toBe(
        'Response Body Not Contains "App Title" has matched on every check for 2 minutes (3 checks), not yet for 5 minutes, and its If No Data setting is Trigger.',
      );
    });

    test("Trigger on the very first check", async () => {
      storedChecks = [];

      expect(
        (
          await judge({
            criteriaFilter: bodyFilter(allValues(5, NoDataPolicy.Trigger)),
            matched: true,
          })
        ).rootCause,
      ).toBe(
        'Response Body Not Contains "App Title" has matched on 1 check so far, not yet for 5 minutes, and its If No Data setting is Trigger.',
      );
    });

    test("Trigger never makes a check that did not match met", async () => {
      storedChecks = [];

      expect(
        (
          await judge({
            criteriaFilter: bodyFilter(allValues(5, NoDataPolicy.Trigger)),
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
            criteriaFilter: bodyFilter(allValues(5, NoDataPolicy.TreatAsZero)),
            matched: true,
          })
        ).rootCause,
      ).toBeNull();
    });

    test("a window with no length is judged on this check alone, whatever If No Data says", async () => {
      const noWindowTrigger: CriteriaFilter = bodyFilter({
        evaluateOverTimeOptions: {
          timeValueInMinutes: undefined,
          evaluateOverTimeType: EvaluateOverTimeType.AllValues,
          onNoDataPolicy: NoDataPolicy.Trigger,
        },
      });

      const notMatched: MatchHistoryJudgement = await judge({
        criteriaFilter: noWindowTrigger,
        matched: false,
      });

      expect(notMatched.rootCause).toBeNull();
      expect(notMatched.message).toBe(
        'Response Body Not Contains "App Title" did not match on this check, and has no window to look back over.',
      );

      expect(
        (
          await judge({
            criteriaFilter: bodyFilter(allValues(0)),
            matched: true,
          })
        ).rootCause,
      ).toBe(
        'Response Body Not Contains "App Title" matched on this check, and has no window to look back over.',
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

    test("is not met once the match has left the window", async () => {
      storedChecks = [
        storedCheck({ matched: true, minutesAgo: 6 }),
        ...everyMinuteBefore([0, 0, 0, 0, 0]),
      ];

      expect(
        (
          await judge({
            criteriaFilter: bodyFilter(anyValue()),
            matched: false,
          })
        ).rootCause,
      ).toBeNull();
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
        (
          await judge({
            criteriaFilter: bodyFilter(anyValue()),
            matched: false,
          })
        ).message,
      ).toBe(
        'Response Body Not Contains "App Title" did not match on the only check over the last 5 minutes.',
      );
    });

    test("is not met when the history cannot be read and this check did not match", async () => {
      readError = new Error("ClickHouse is away");

      expect(
        (
          await judge({
            criteriaFilter: bodyFilter(anyValue()),
            matched: false,
          })
        ).rootCause,
      ).toBeNull();
    });
  });

  describe("judgeWindow: each probe by its own checks", () => {
    /*
     * One region is served the placeholder, another the real page. Mixed
     * together, the healthy region's checks would keep All Values from
     * ever holding for the region that saw the outage on every check.
     */
    test("a probe's window holds its own checks, not another probe's", async () => {
      storedChecks = [
        ...everyMinuteBefore([1, 1, 1, 1, 1], PROBE_A),
        ...everyMinuteBefore([0, 0, 0, 0, 0], PROBE_B),
      ];

      expect(
        (
          await judge({
            criteriaFilter: bodyFilter(),
            matched: true,
            probeId: PROBE_A,
          })
        ).rootCause,
      ).toBe(
        'Response Body Not Contains "App Title" matched on every check over the last 5 minutes (6 checks).',
      );

      expect(
        (
          await judge({
            criteriaFilter: bodyFilter(),
            matched: true,
            probeId: PROBE_B,
          })
        ).message,
      ).toBe(
        'Response Body Not Contains "App Title" has matched on 1 check so far; All Values waits until it has matched on every check for 5 minutes.',
      );
    });

    test("Any Value is not met for one probe by another probe's match", async () => {
      storedChecks = [
        storedCheck({ matched: true, minutesAgo: 1, probeId: PROBE_B }),
        storedCheck({ matched: false, minutesAgo: 1, probeId: PROBE_A }),
      ];

      expect(
        (
          await judge({
            criteriaFilter: bodyFilter(anyValue()),
            matched: false,
            probeId: PROBE_A,
          })
        ).rootCause,
      ).toBeNull();
    });

    test("one probe result's reads are shared: each filter's history is read once for every probe", async () => {
      storedChecks = [
        ...everyMinuteBefore([1, 1, 1, 1, 1], PROBE_A),
        ...everyMinuteBefore([1, 1, 1, 1, 1], PROBE_B),
      ];

      const reads: CriteriaFilterMatchHistoryReads =
        new CriteriaFilterMatchHistoryReads();

      for (const probeId of [PROBE_A, PROBE_B, PROBE_A]) {
        expect(
          (
            await judge({
              criteriaFilter: bodyFilter(),
              matched: true,
              probeId: probeId,
              reads: reads,
            })
          ).rootCause,
        ).toContain("matched on every check over the last 5 minutes");
      }

      expect(findByCalls).toHaveLength(1);

      // A window of another length is another read.
      await judge({
        criteriaFilter: bodyFilter(allValues(15)),
        matched: true,
        probeId: PROBE_A,
        reads: reads,
      });

      expect(findByCalls).toHaveLength(2);
    });

    test("a failed shared read fails every judgement that shares it, as not judged", async () => {
      readError = new Error("ClickHouse is away");

      const reads: CriteriaFilterMatchHistoryReads =
        new CriteriaFilterMatchHistoryReads();

      for (const probeId of [PROBE_A, PROBE_B]) {
        expect(
          (
            await judge({
              criteriaFilter: bodyFilter(),
              matched: true,
              probeId: probeId,
              reads: reads,
            })
          ).rootCause,
        ).toBeNull();
      }

      expect(findByCalls).toHaveLength(1);
    });
  });

  /*
   * The probe agreement pass judges every other probe's last check, read
   * back from where it was stored. Each comes to what its probe came to
   * itself: its own checks, up to its own newest one.
   */
  describe("judgeWindow: a stored check read back for probe agreement", () => {
    test("is not counted twice when its own row is in the history", async () => {
      storedChecks = everyMinuteBefore([1, 1, 1, 1, 1, 1], PROBE_B);

      expect(
        (
          await judge({
            criteriaFilter: bodyFilter(),
            matched: true,
            probeId: PROBE_B,
            storedMinutesAgo: 1,
          })
        ).rootCause,
      ).toBe(
        'Response Body Not Contains "App Title" matched on every check over the last 5 minutes (6 checks).',
      );
    });

    test("is counted when its row has not landed yet", async () => {
      storedChecks = [6, 5, 4, 3, 2].map((minutesAgo: number): Metric => {
        return storedCheck({
          matched: true,
          minutesAgo: minutesAgo,
          probeId: PROBE_B,
        });
      });

      expect(
        (
          await judge({
            criteriaFilter: bodyFilter(),
            matched: true,
            probeId: PROBE_B,
            storedMinutesAgo: 1,
          })
        ).rootCause,
      ).toBe(
        'Response Body Not Contains "App Title" matched on every check over the last 5 minutes (6 checks).',
      );
    });

    test("ends the window at the probe's newest check: it does not assume the probe still sees what it saw", async () => {
      storedChecks = [5, 4, 3, 2].map((minutesAgo: number): Metric => {
        return storedCheck({
          matched: true,
          minutesAgo: minutesAgo,
          probeId: PROBE_B,
        });
      });

      /*
       * The probe's checks span 4 minutes, up to its newest a minute ago.
       * By now it may have been 5 minutes, but this probe has not seen it.
       */
      const judgement: MatchHistoryJudgement = await judge({
        criteriaFilter: bodyFilter(),
        matched: true,
        probeId: PROBE_B,
        storedMinutesAgo: 1,
      });

      expect(judgement.rootCause).toBeNull();
      expect(judgement.message).toBe(
        'Response Body Not Contains "App Title" has matched on every check for 4 minutes (5 checks); All Values waits until it has matched on every check for 5 minutes.',
      );
    });

    test("a probe that stopped checking is judged by nothing", async () => {
      storedChecks = [10, 9, 8].map((minutesAgo: number): Metric => {
        return storedCheck({
          matched: true,
          minutesAgo: minutesAgo,
          probeId: PROBE_B,
        });
      });

      const judgement: MatchHistoryJudgement = await judge({
        criteriaFilter: bodyFilter(),
        matched: true,
        probeId: PROBE_B,
        storedMinutesAgo: 8,
      });

      expect(judgement.rootCause).toBeNull();
      expect(judgement.message).toBe(
        'Response Body Not Contains "App Title" has not been checked for 8 minutes, so it was not judged over the last 5 minutes.',
      );
    });

    test("a check from long ago is not placed in the window", async () => {
      storedChecks = [];

      const stale: MatchHistoryJudgement = await judge({
        criteriaFilter: bodyFilter(),
        matched: true,
        probeId: PROBE_B,
        storedMinutesAgo: 40,
      });

      expect(stale.rootCause).toBeNull();
      expect(stale.message).toBe(
        'Response Body Not Contains "App Title" has no checks over the last 5 minutes, so it was not judged.',
      );

      // Nor does it meet Any Value, though it matched.
      expect(
        (
          await judge({
            criteriaFilter: bodyFilter(anyValue()),
            matched: true,
            probeId: PROBE_B,
            storedMinutesAgo: 40,
          })
        ).rootCause,
      ).toBeNull();

      // With Trigger, having no checks is missing data like any other.
      expect(
        (
          await judge({
            criteriaFilter: bodyFilter(allValues(5, NoDataPolicy.Trigger)),
            matched: true,
            probeId: PROBE_B,
            storedMinutesAgo: 40,
          })
        ).rootCause,
      ).toBe(
        'Response Body Not Contains "App Title" has no checks over the last 5 minutes, and its If No Data setting is Trigger.',
      );
    });

    test("a recent one that did not match settles All Values without a read, like a check that just arrived", async () => {
      const judgement: MatchHistoryJudgement = await judge({
        criteriaFilter: bodyFilter(),
        matched: false,
        probeId: PROBE_B,
        storedMinutesAgo: 0.5,
      });

      expect(judgement.rootCause).toBeNull();
      expect(findByCalls).toHaveLength(0);
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
