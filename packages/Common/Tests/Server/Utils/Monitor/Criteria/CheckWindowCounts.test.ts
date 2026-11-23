import CheckWindowCounts, {
  CheckWindowCountReads,
  CheckWindowJudgement,
  CheckWindowSource,
  CheckWindowTally,
} from "../../../../../Server/Utils/Monitor/Criteria/CheckWindowCounts";
import CriteriaFilterMatchHistory, {
  CriteriaFilterMatchHistoryReads,
} from "../../../../../Server/Utils/Monitor/Criteria/CriteriaFilterMatchHistory";
import MetricService, {
  MonitorCheckSummaryRow,
} from "../../../../../Server/Services/MetricService";
import logger from "../../../../../Server/Utils/Logger";
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
import MonitorMetricType from "../../../../../Types/Monitor/MonitorMetricType";
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

/*
 * Counting a window's checks (#10355): the pure judgement - what a tally of
 * checks comes to against a "more than 30" - and the read around it, with
 * the database's summary stubbed.
 */

const NOW: Date = new Date("2026-11-20T12:00:00.000Z");
const MINUTE: number = 60 * 1000;
const HOUR: number = 60 * MINUTE;

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const MONITOR_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const PROBE_A: ObjectID = new ObjectID("33333333-3333-4333-8333-333333333333");
const PROBE_B: ObjectID = new ObjectID("44444444-4444-4444-8444-444444444444");

function counted(input: {
  type: EvaluateOverTimeType;
  minutes?: number;
  countFilterType?: FilterType;
  countValue?: number;
  onNoDataPolicy?: NoDataPolicy;
  filter?: Partial<CriteriaFilter>;
}): CriteriaFilter {
  return {
    checkOn: CheckOn.IsOnline,
    filterType: FilterType.False,
    value: undefined,
    ...input.filter,
    evaluateOverTime: true,
    evaluateOverTimeOptions: {
      timeValueInMinutes: input.minutes ?? 480,
      evaluateOverTimeType: input.type,
      countFilterType: input.countFilterType ?? FilterType.GreaterThan,
      countValue: input.countValue ?? 30,
      ...(input.onNoDataPolicy ? { onNoDataPolicy: input.onNoDataPolicy } : {}),
    },
  };
}

// A tally of `checks` checks one minute apart, ending now.
function tally(input: {
  checks: number;
  matched: number;
  changes?: number;
  firstMinutesAgo?: number;
  lastMinutesAgo?: number;
}): CheckWindowTally {
  const firstMinutesAgo: number =
    input.firstMinutesAgo ?? Math.max(0, input.checks - 1);

  return {
    checkCount: input.checks,
    matchCount: input.matched,
    changeCount: input.changes ?? 0,
    firstAt: new Date(NOW.getTime() - firstMinutesAgo * MINUTE),
    lastAt: new Date(NOW.getTime() - (input.lastMinutesAgo ?? 0) * MINUTE),
    lastMatched: null,
  };
}

function judge(input: {
  filter: CriteriaFilter;
  tally: CheckWindowTally;
  minutes?: number;
  intervalMs?: number | null;
}): CheckWindowJudgement {
  const minutes: number =
    input.minutes ??
    Number(input.filter.evaluateOverTimeOptions?.timeValueInMinutes);

  return CheckWindowCounts.judge({
    criteriaFilter: input.filter,
    type: input.filter.evaluateOverTimeOptions!.evaluateOverTimeType!,
    label: CriteriaFilterMatchHistory.getFilterLabel(input.filter),
    tally: input.tally,
    windowStartMs: NOW.getTime() - minutes * MINUTE,
    windowEndMs: NOW.getTime(),
    intervalMs: input.intervalMs === undefined ? MINUTE : input.intervalMs,
  });
}

describe("CheckWindowCounts.judge: a count of the window's checks", () => {
  test("more than 30 failed checks in 8 hours: 31 is met, 30 is not", () => {
    const filter: CriteriaFilter = counted({
      type: EvaluateOverTimeType.Count,
    });

    const met: CheckWindowJudgement = judge({
      filter: filter,
      tally: tally({ checks: 481, matched: 31 }),
    });

    expect(met.rootCause).toBe(
      "Is Online False matched on 31 of the 481 checks over the last 8 hours. That is more than 30.",
    );

    const notMet: CheckWindowJudgement = judge({
      filter: filter,
      tally: tally({ checks: 481, matched: 30 }),
    });

    expect(notMet.rootCause).toBeNull();
    expect(notMet.message).toBe(
      "Is Online False matched on 30 of the 481 checks over the last 8 hours. The criteria needs more than 30.",
    );
  });

  test.each([
    [FilterType.GreaterThan, 30, false],
    [FilterType.GreaterThanOrEqualTo, 30, true],
    [FilterType.LessThan, 30, false],
    [FilterType.LessThanOrEqualTo, 30, true],
    [FilterType.EqualTo, 30, true],
    [FilterType.NotEqualTo, 30, false],
    [FilterType.LessThan, 31, true],
  ] as const)(
    "%s %p against a count of 30 on a covered window is met: %p",
    (countFilterType: FilterType, countValue: number, isMet: boolean) => {
      expect(
        judge({
          filter: counted({
            type: EvaluateOverTimeType.Count,
            countFilterType: countFilterType,
            countValue: countValue,
          }),
          tally: tally({ checks: 481, matched: 30 }),
        }).rootCause !== null,
      ).toBe(isMet);
    },
  );

  test("a count with no comparison saved reads as more than 0", () => {
    const filter: CriteriaFilter = counted({
      type: EvaluateOverTimeType.Count,
    });
    delete filter.evaluateOverTimeOptions!.countFilterType;
    delete filter.evaluateOverTimeOptions!.countValue;

    expect(
      judge({ filter: filter, tally: tally({ checks: 481, matched: 1 }) })
        .rootCause,
    ).toContain("That is more than 0.");
    expect(
      judge({ filter: filter, tally: tally({ checks: 481, matched: 0 }) })
        .rootCause,
    ).toBeNull();
  });
});

describe("CheckWindowCounts.judge: the edges of the window", () => {
  test("a window the checks do not reach back over yet waits, unless more checks cannot change the answer", () => {
    // A monitor that started 20 minutes ago, judged over 8 hours.
    const young: CheckWindowTally = tally({ checks: 20, matched: 3 });

    const waiting: CheckWindowJudgement = judge({
      filter: counted({ type: EvaluateOverTimeType.Count }),
      tally: young,
    });

    expect(waiting.rootCause).toBeNull();
    expect(waiting.message).toBe(
      "Is Online False matched on 3 of the 20 checks over the last 8 hours. The checks reach back 19 minutes so far, so Count waits until they cover the last 8 hours.",
    );

    // 31 failures in its first 40 minutes: already more than 30.
    const pastAlready: CheckWindowJudgement = judge({
      filter: counted({ type: EvaluateOverTimeType.Count }),
      tally: tally({ checks: 40, matched: 31 }),
    });

    expect(pastAlready.rootCause).toContain("That is more than 30.");
  });

  test("a count below a threshold, on a window not covered, never matches early", () => {
    // Fewer than 5 failures - true of every young window - waits.
    expect(
      judge({
        filter: counted({
          type: EvaluateOverTimeType.Count,
          countFilterType: FilterType.LessThan,
          countValue: 5,
        }),
        tally: tally({ checks: 10, matched: 0 }),
      }).rootCause,
    ).toBeNull();
  });

  test("checks that start within one and a half intervals of the window's start cover it", () => {
    const filter: CriteriaFilter = counted({
      type: EvaluateOverTimeType.Percentage,
      minutes: 60,
      countValue: 10,
    });

    // The oldest check is 59 minutes old, one minute into the window.
    expect(
      judge({
        filter: filter,
        tally: tally({ checks: 60, matched: 12, firstMinutesAgo: 59 }),
      }).rootCause,
    ).toBe(
      "Is Online False matched on 20% of the checks over the last hour (12 of 60 checks). That is more than 10%.",
    );

    // Starting three minutes in is not covered: it waits.
    expect(
      judge({
        filter: filter,
        tally: tally({ checks: 58, matched: 12, firstMinutesAgo: 57 }),
      }).rootCause,
    ).toBeNull();
  });

  test("checks that stopped part way through the window do not cover its end", () => {
    // A probe that has not checked for 10 minutes, on a 1-minute interval.
    expect(
      judge({
        filter: counted({
          type: EvaluateOverTimeType.Percentage,
          minutes: 60,
          countValue: 10,
        }),
        tally: tally({
          checks: 50,
          matched: 20,
          firstMinutesAgo: 60,
          lastMinutesAgo: 10,
        }),
      }).rootCause,
    ).toBeNull();
  });

  test("without a schedule, the cadence comes from the checks themselves", () => {
    // 61 checks a minute apart over an hour: covered, with no cron to read.
    expect(
      judge({
        filter: counted({
          type: EvaluateOverTimeType.Percentage,
          minutes: 60,
          countValue: 10,
        }),
        tally: tally({ checks: 61, matched: 30, firstMinutesAgo: 60 }),
        intervalMs: null,
      }).rootCause,
    ).toContain("That is more than 10%.");
  });

  test("a single check never covers a window longer than its interval", () => {
    expect(
      judge({
        filter: counted({
          type: EvaluateOverTimeType.Percentage,
          minutes: 60,
          countValue: 10,
        }),
        tally: tally({ checks: 1, matched: 1, firstMinutesAgo: 0 }),
      }).rootCause,
    ).toBeNull();

    // With no schedule and one check, nothing says how far it reaches.
    expect(
      judge({
        filter: counted({
          type: EvaluateOverTimeType.Percentage,
          minutes: 60,
          countValue: 10,
        }),
        tally: tally({ checks: 1, matched: 1, firstMinutesAgo: 0 }),
        intervalMs: null,
      }).rootCause,
    ).toBeNull();
  });
});

describe("CheckWindowCounts.judge: an empty window and If No Data", () => {
  const empty: CheckWindowTally = {
    checkCount: 0,
    matchCount: 0,
    changeCount: 0,
    firstAt: null,
    lastAt: null,
    lastMatched: null,
  };

  test("Ignore waits on a window with no checks", () => {
    const judgement: CheckWindowJudgement = judge({
      filter: counted({ type: EvaluateOverTimeType.Count }),
      tally: empty,
    });

    expect(judgement.rootCause).toBeNull();
    expect(judgement.message).toBe(
      "Is Online False has no checks over the last 8 hours, so it was not counted.",
    );
  });

  test("Trigger matches a window with no checks", () => {
    expect(
      judge({
        filter: counted({
          type: EvaluateOverTimeType.Count,
          onNoDataPolicy: NoDataPolicy.Trigger,
        }),
        tally: empty,
      }).rootCause,
    ).toBe(
      "Is Online False has no checks over the last 8 hours, and its If No Data setting is Trigger.",
    );
  });

  test("Treat As Zero judges no checks as a count of 0", () => {
    // Fewer than 5 successful checks in an hour, of none at all: met.
    expect(
      judge({
        filter: counted({
          type: EvaluateOverTimeType.Count,
          countFilterType: FilterType.LessThan,
          countValue: 5,
          onNoDataPolicy: NoDataPolicy.TreatAsZero,
          filter: { filterType: FilterType.True },
        }),
        tally: empty,
      }).rootCause,
    ).toContain("That is fewer than 5.");
  });

  test("Treat As Zero judges a share of the checks the window should hold", () => {
    // 10 of 20 checks in a window that should hold 480: 2%, not 50%.
    const judgement: CheckWindowJudgement = judge({
      filter: counted({
        type: EvaluateOverTimeType.Percentage,
        countValue: 10,
        onNoDataPolicy: NoDataPolicy.TreatAsZero,
      }),
      tally: tally({ checks: 20, matched: 10 }),
    });

    expect(judgement.rootCause).toBeNull();
    expect(judgement.message).toContain("2.1% of the checks");
  });

  test("Trigger matches a window the checks do not cover yet", () => {
    expect(
      judge({
        filter: counted({
          type: EvaluateOverTimeType.Percentage,
          countValue: 10,
          onNoDataPolicy: NoDataPolicy.Trigger,
        }),
        tally: tally({ checks: 20, matched: 0 }),
      }).rootCause,
    ).toContain("its If No Data setting is Trigger");
  });
});

describe("CheckWindowCounts.judge: a share of the checks", () => {
  test("12.5% of the checks is more than 10%, written with one decimal", () => {
    expect(
      judge({
        filter: counted({
          type: EvaluateOverTimeType.Percentage,
          minutes: 60,
          countValue: 10,
        }),
        tally: tally({ checks: 64, matched: 8, firstMinutesAgo: 60 }),
      }).rootCause,
    ).toBe(
      "Is Online False matched on 12.5% of the checks over the last hour (8 of 64 checks). That is more than 10%.",
    );
  });

  test("a share is never met early: more checks can lower it", () => {
    // Every check so far failed, but the window is not covered.
    expect(
      judge({
        filter: counted({
          type: EvaluateOverTimeType.Percentage,
          countValue: 10,
        }),
        tally: tally({ checks: 5, matched: 5 }),
      }).rootCause,
    ).toBeNull();
  });
});

describe("CheckWindowCounts.judge: status changes", () => {
  test("changed more than 5 times in the last hour", () => {
    const filter: CriteriaFilter = counted({
      type: EvaluateOverTimeType.StatusChanges,
      minutes: 60,
      countValue: 5,
    });

    expect(
      judge({
        filter: filter,
        tally: tally({
          checks: 61,
          matched: 6,
          changes: 7,
          firstMinutesAgo: 60,
        }),
      }).rootCause,
    ).toBe(
      "Is Online False changed between matching and not matching 7 times over the last hour (61 checks). That is more than 5.",
    );

    expect(
      judge({
        filter: filter,
        tally: tally({
          checks: 61,
          matched: 1,
          changes: 1,
          firstMinutesAgo: 60,
        }),
      }).message,
    ).toBe(
      "Is Online False changed between matching and not matching 1 time over the last hour (61 checks). The criteria needs more than 5.",
    );
  });

  test("more than 5 changes in a young window is already met", () => {
    expect(
      judge({
        filter: counted({
          type: EvaluateOverTimeType.StatusChanges,
          minutes: 60,
          countValue: 5,
        }),
        tally: tally({ checks: 12, matched: 6, changes: 6 }),
      }).rootCause,
    ).toContain("That is more than 5.");
  });
});

describe("CheckWindowCounts.addCheck", () => {
  test("counts the check, and a change when it differs from the last one", () => {
    const before: CheckWindowTally = {
      ...tally({ checks: 3, matched: 1, changes: 2 }),
      lastMatched: false,
    };

    const changed: CheckWindowTally = CheckWindowCounts.addCheck({
      tally: before,
      matched: true,
      at: NOW,
    });

    expect(changed).toMatchObject({
      checkCount: 4,
      matchCount: 2,
      changeCount: 3,
      lastMatched: true,
    });

    const same: CheckWindowTally = CheckWindowCounts.addCheck({
      tally: before,
      matched: false,
      at: NOW,
    });

    expect(same.changeCount).toBe(2);
  });

  test("the first check of an empty window is no change", () => {
    const first: CheckWindowTally = CheckWindowCounts.addCheck({
      tally: {
        checkCount: 0,
        matchCount: 0,
        changeCount: 0,
        firstAt: null,
        lastAt: null,
        lastMatched: null,
      },
      matched: true,
      at: NOW,
    });

    expect(first).toEqual({
      checkCount: 1,
      matchCount: 1,
      changeCount: 0,
      firstAt: NOW,
      lastAt: NOW,
      lastMatched: true,
    });
  });
});

describe("CheckWindowCounts.getSource", () => {
  test("Is Online is counted from the online series: True is 1, False anything else", () => {
    const source: CheckWindowSource | null = CheckWindowCounts.getSource({
      criteriaFilter: counted({ type: EvaluateOverTimeType.Count }),
      monitorType: MonitorType.Ping,
      monitorStepId: "step",
    });

    expect(source).toEqual({
      metricName: MonitorMetricType.IsOnline,
      attributes: {},
      groupByAttributeKeys: ["probeId"],
      condition: { comparison: "ne", threshold: 1 },
      isMatchHistory: false,
    });

    expect(
      CheckWindowCounts.getSeriesCondition({
        checkOn: CheckOn.IsOnline,
        filterType: FilterType.True,
        value: undefined,
      }),
    ).toEqual({ comparison: "eq", threshold: 1 });
  });

  test.each([
    [FilterType.GreaterThan, "gt"],
    [FilterType.GreaterThanOrEqualTo, "gte"],
    [FilterType.LessThan, "lt"],
    [FilterType.LessThanOrEqualTo, "lte"],
    [FilterType.EqualTo, "eq"],
    [FilterType.NotEqualTo, "ne"],
  ] as const)(
    "a measured value compared %s its threshold is counted with %s",
    (filterType: FilterType, comparison: string) => {
      expect(
        CheckWindowCounts.getSeriesCondition({
          checkOn: CheckOn.ResponseTime,
          filterType: filterType,
          value: "300",
        }),
      ).toEqual({ comparison: comparison, threshold: 300 });
    },
  );

  test("a condition with no number to compare is not counted", () => {
    expect(
      CheckWindowCounts.getSeriesCondition({
        checkOn: CheckOn.ResponseTime,
        filterType: FilterType.GreaterThan,
        value: "fast",
      }),
    ).toBeNull();
    expect(
      CheckWindowCounts.getSeriesCondition({
        checkOn: CheckOn.ResponseTime,
        filterType: FilterType.Contains,
        value: "300",
      }),
    ).toBeNull();
    expect(
      CheckWindowCounts.getSeriesCondition({
        checkOn: CheckOn.IsOnline,
        filterType: FilterType.GreaterThan,
        value: 1,
      }),
    ).toBeNull();
  });

  test("a disk's usage is counted disk by disk", () => {
    expect(
      CheckWindowCounts.getSource({
        criteriaFilter: {
          checkOn: CheckOn.DiskUsagePercent,
          filterType: FilterType.GreaterThan,
          value: 90,
          serverMonitorOptions: { diskPath: "*" },
        },
        monitorType: MonitorType.Server,
        monitorStepId: "step",
      })?.groupByAttributeKeys,
    ).toEqual(["probeId", "diskPath"]);
  });

  test("a response body is counted from its match history, under its filter key", () => {
    const filter: CriteriaFilter = counted({
      type: EvaluateOverTimeType.Count,
      filter: {
        checkOn: CheckOn.ResponseBody,
        filterType: FilterType.NotContains,
        value: "App Title",
      },
    });

    expect(
      CheckWindowCounts.getSource({
        criteriaFilter: filter,
        monitorType: MonitorType.Website,
        monitorStepId: "step",
      }),
    ).toEqual({
      metricName: CRITERIA_FILTER_MATCH_METRIC_NAME,
      attributes: {
        [CRITERIA_FILTER_KEY_ATTRIBUTE]:
          CriteriaFilterMatchHistory.getFilterKey({
            monitorStepId: "step",
            criteriaFilter: filter,
          }),
      },
      groupByAttributeKeys: ["probeId"],
      condition: { comparison: "eq", threshold: 1 },
      isMatchHistory: true,
    });
  });
});

describe("CheckWindowCounts.judgeFilter: the read around the judgement", () => {
  let summaries: Array<MonitorCheckSummaryRow> = [];
  let reads: number = 0;

  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(NOW);
    summaries = [];
    reads = 0;

    jest
      .spyOn(MetricService, "summarizeMonitorChecks")
      .mockImplementation(async (): Promise<Array<MonitorCheckSummaryRow>> => {
        reads++;
        return summaries;
      });

    jest.spyOn(logger, "error").mockImplementation(() => {
      return undefined as never;
    });
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  function row(input: {
    probeId: string;
    diskPath?: string;
    checks: number;
    matched: number;
    changes?: number;
  }): MonitorCheckSummaryRow {
    return {
      group: {
        probeId: input.probeId,
        ...(input.diskPath !== undefined ? { diskPath: input.diskPath } : {}),
      },
      checkCount: input.checks,
      matchCount: input.matched,
      changeCount: input.changes ?? 0,
      firstAt: new Date(NOW.getTime() - 8 * HOUR),
      lastAt: NOW,
      firstMatched: false,
      lastMatched: false,
    };
  }

  function judgeFilter(input: {
    filter: CriteriaFilter;
    probeId?: ObjectID;
    monitorType?: MonitorType;
    reads?: CheckWindowCountReads;
    diskPaths?: Array<string>;
    checkMatched?: boolean;
    isStoredCheck?: boolean;
  }): Promise<CheckWindowJudgement> {
    return CheckWindowCounts.judgeFilter({
      projectId: PROJECT_ID,
      monitorId: MONITOR_ID,
      monitorStepId: "step",
      monitorType: input.monitorType ?? MonitorType.Ping,
      probeId: input.probeId,
      criteriaFilter: input.filter,
      check: {
        filterKey: "",
        matched: input.checkMatched ?? false,
        at: NOW,
      },
      isStoredCheck: input.isStoredCheck,
      monitoringInterval: "* * * * *",
      diskPaths: input.diskPaths,
      reads: input.reads,
    });
  }

  test("each probe's checks are counted on their own", async () => {
    summaries = [
      row({ probeId: PROBE_A.toString(), checks: 481, matched: 31 }),
      row({ probeId: PROBE_B.toString(), checks: 481, matched: 2 }),
    ];

    const filter: CriteriaFilter = counted({
      type: EvaluateOverTimeType.Count,
    });

    expect(
      (await judgeFilter({ filter: filter, probeId: PROBE_A })).rootCause,
    ).toContain("31 of the 481 checks");
    expect(
      (await judgeFilter({ filter: filter, probeId: PROBE_B })).rootCause,
    ).toBeNull();
  });

  test("a probe with no checks in the window has none", async () => {
    summaries = [
      row({ probeId: PROBE_A.toString(), checks: 481, matched: 31 }),
    ];

    expect(
      (
        await judgeFilter({
          filter: counted({ type: EvaluateOverTimeType.Count }),
          probeId: PROBE_B,
        })
      ).message,
    ).toBe(
      "Is Online False has no checks over the last 8 hours, so it was not counted.",
    );
  });

  test("everything judged for one probe result shares one read", async () => {
    summaries = [
      row({ probeId: PROBE_A.toString(), checks: 481, matched: 31 }),
      row({ probeId: PROBE_B.toString(), checks: 481, matched: 2 }),
    ];

    const shared: CheckWindowCountReads =
      CheckWindowCountReads.forMatchHistoryReads(
        new CriteriaFilterMatchHistoryReads(),
      );
    const filter: CriteriaFilter = counted({
      type: EvaluateOverTimeType.Count,
    });

    await judgeFilter({ filter: filter, probeId: PROBE_A, reads: shared });
    await judgeFilter({ filter: filter, probeId: PROBE_B, reads: shared });

    expect(reads).toBe(1);
  });

  test("the same match history reads hand back the same counted reads", () => {
    const matchHistoryReads: CriteriaFilterMatchHistoryReads =
      new CriteriaFilterMatchHistoryReads();

    expect(CheckWindowCountReads.forMatchHistoryReads(matchHistoryReads)).toBe(
      CheckWindowCountReads.forMatchHistoryReads(matchHistoryReads),
    );
    expect(
      CheckWindowCountReads.forMatchHistoryReads(matchHistoryReads).now,
    ).toBe(matchHistoryReads.now);
  });

  test("a match history counts the check that just arrived from memory, once", async () => {
    const filter: CriteriaFilter = counted({
      type: EvaluateOverTimeType.Count,
      countValue: 30,
      filter: {
        checkOn: CheckOn.ResponseBody,
        filterType: FilterType.NotContains,
        value: "App Title",
      },
      minutes: 60,
    });

    summaries = [
      {
        ...row({ probeId: PROBE_A.toString(), checks: 60, matched: 30 }),
        firstAt: new Date(NOW.getTime() - 60 * MINUTE),
      },
    ];

    const justArrived: CheckWindowJudgement = await judgeFilter({
      filter: filter,
      probeId: PROBE_A,
      monitorType: MonitorType.Website,
      checkMatched: true,
    });

    expect(justArrived.rootCause).toContain("31 of the 61 checks");

    // A stored check's row was written when it arrived: not counted again.
    const stored: CheckWindowJudgement = await judgeFilter({
      filter: filter,
      probeId: PROBE_A,
      monitorType: MonitorType.Website,
      checkMatched: true,
      isStoredCheck: true,
    });

    expect(stored.rootCause).toBeNull();
    expect(stored.message).toContain("30 of the 60 checks");
  });

  test("a disk's usage is met when any disk the report names meets it", async () => {
    summaries = [
      row({ probeId: "", diskPath: "/", checks: 481, matched: 2 }),
      row({ probeId: "", diskPath: "/data", checks: 481, matched: 40 }),
    ];

    const judgement: CheckWindowJudgement = await judgeFilter({
      filter: counted({
        type: EvaluateOverTimeType.Count,
        filter: {
          checkOn: CheckOn.DiskUsagePercent,
          filterType: FilterType.GreaterThan,
          value: 90,
          serverMonitorOptions: { diskPath: "*" },
        },
      }),
      monitorType: MonitorType.Server,
      diskPaths: ["/", "/data"],
    });

    expect(judgement.rootCause).toBe(
      'Disk /data - Disk Usage (in %) Greater Than "90" matched on 40 of the 481 checks over the last 8 hours. That is more than 30.',
    );
  });

  test("a window that cannot be read is never a breach", async () => {
    jest
      .spyOn(MetricService, "summarizeMonitorChecks")
      .mockRejectedValue(new Error("ClickHouse is down") as never);

    const judgement: CheckWindowJudgement = await judgeFilter({
      filter: counted({
        type: EvaluateOverTimeType.Count,
        onNoDataPolicy: NoDataPolicy.Trigger,
      }),
      probeId: PROBE_A,
    });

    expect(judgement.rootCause).toBeNull();
    expect(judgement.message).toBe(
      "The checks of the last 8 hours could not be read, so Is Online False was not counted over them.",
    );
  });
});

describe("CheckWindowCounts.describeComparison and describeWindow", () => {
  test.each([
    [FilterType.GreaterThan, "more than 30"],
    [FilterType.GreaterThanOrEqualTo, "at least 30"],
    [FilterType.LessThan, "fewer than 30"],
    [FilterType.LessThanOrEqualTo, "at most 30"],
    [FilterType.EqualTo, "exactly 30"],
    [FilterType.NotEqualTo, "anything but 30"],
  ] as const)("%s reads as %p", (filterType: FilterType, text: string) => {
    expect(
      CheckWindowCounts.describeComparison({
        type: EvaluateOverTimeType.Count,
        comparison: { filterType: filterType, value: 30 },
      }),
    ).toBe(text);
  });

  test("a percentage carries its percent sign", () => {
    expect(
      CheckWindowCounts.describeComparison({
        type: EvaluateOverTimeType.Percentage,
        comparison: { filterType: FilterType.GreaterThan, value: 12.5 },
      }),
    ).toBe("more than 12.5%");
  });

  test.each([
    [1, "minute"],
    [5, "5 minutes"],
    [60, "hour"],
    [90, "90 minutes"],
    [480, "8 hours"],
    [1440, "24 hours"],
  ])("%p minutes is %p", (minutes: number, name: string) => {
    expect(CheckWindowCounts.describeWindow(minutes)).toBe(name);
  });
});
