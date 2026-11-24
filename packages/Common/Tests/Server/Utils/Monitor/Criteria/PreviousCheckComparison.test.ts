import PreviousCheckComparison, {
  PreviousCheckReads,
  PreviousCheckSource,
} from "../../../../../Server/Utils/Monitor/Criteria/PreviousCheckComparison";
import { CheckWindowJudgement } from "../../../../../Server/Utils/Monitor/Criteria/CheckWindowCounts";
import CriteriaFilterMatchHistory, {
  CriteriaFilterMatchHistoryReads,
} from "../../../../../Server/Utils/Monitor/Criteria/CriteriaFilterMatchHistory";
import MetricService, {
  MonitorPreviousCheckRow,
} from "../../../../../Server/Services/MetricService";
import logger from "../../../../../Server/Utils/Logger";
import {
  CheckOn,
  CriteriaFilter,
  CriteriaFilterUtil,
  EvaluateOverTimeType,
  FilterType,
  NoDataPolicy,
  PreviousCheckChangeType,
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
 * Comparing a check with the one before it (#10821): the threshold made
 * from the previous check's value, the filters that take one, and the
 * judgement around the read, with the database's previous checks stubbed.
 * MonitorCriteriaEvaluatorPreviousCheck plays whole monitors through the
 * evaluator; PreviousCheckClickhouseIntegration reads a real ClickHouse.
 */

const WRITTEN_AT: Date = new Date("2026-11-24T12:00:05.300Z");
const MINUTE: number = 60 * 1000;

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const MONITOR_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const STEP_ID: string = "33333333-3333-4333-8333-333333333333";
const PROBE_A: string = "44444444-4444-4444-8444-444444444444";
const PROBE_B: string = "55555555-5555-4555-8555-555555555555";

const RESPONSE_TIME: CriteriaFilter = {
  checkOn: CheckOn.ResponseTime,
  filterType: FilterType.GreaterThan,
  value: undefined,
};

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

// A previous check written `minutesAgo` before WRITTEN_AT.
function row(input: {
  value: number;
  minutesAgo?: number;
  probeId?: string;
  diskPath?: string;
}): MonitorPreviousCheckRow {
  return {
    group: {
      probeId: input.probeId ?? PROBE_A,
      ...(input.diskPath !== undefined ? { diskPath: input.diskPath } : {}),
    },
    value: input.value,
    at: new Date(WRITTEN_AT.getTime() - (input.minutesAgo ?? 1) * MINUTE),
  };
}

interface ReadAsked {
  metricName: string;
  windowStart: Date;
  before: Date;
  attributes: Record<string, string> | undefined;
  groupByAttributeKeys: Array<string>;
}

let readsAsked: Array<ReadAsked> = [];

function stubPreviousChecks(rows: Array<MonitorPreviousCheckRow>): void {
  jest
    .spyOn(MetricService, "readPreviousMonitorChecks")
    .mockImplementation(
      async (data: {
        metricName: string;
        windowStart: Date;
        before: Date;
        attributes?: Record<string, string> | undefined;
        groupByAttributeKeys: Array<string>;
      }): Promise<Array<MonitorPreviousCheckRow>> => {
        readsAsked.push({
          metricName: data.metricName,
          windowStart: data.windowStart,
          before: data.before,
          attributes: data.attributes,
          groupByAttributeKeys: data.groupByAttributeKeys,
        });

        // The window bounds the read, as the statement's time range does.
        return rows.filter((previous: MonitorPreviousCheckRow): boolean => {
          return (
            previous.at.getTime() >= data.windowStart.getTime() &&
            previous.at.getTime() < data.before.getTime()
          );
        });
      },
    );
}

interface Judged {
  judgement: CheckWindowJudgement;
  thisCheckFilters: Array<CriteriaFilter>;
}

async function judge(input: {
  filter: CriteriaFilter;
  monitorType?: MonitorType;
  probeId?: string;
  metOnThisCheck?: boolean;
  // What the check's own evaluator finds for a threshold: met above it.
  thisCheckValue?: number;
  diskValues?: Record<string, number>;
  diskPaths?: Array<string>;
  reads?: PreviousCheckReads;
  checkWrittenAt?: Date;
}): Promise<Judged> {
  const thisCheckFilters: Array<CriteriaFilter> = [];

  const judgement: CheckWindowJudgement =
    await PreviousCheckComparison.judgeFilter({
      projectId: PROJECT_ID,
      monitorId: MONITOR_ID,
      monitorStepId: STEP_ID,
      monitorType: input.monitorType ?? MonitorType.Website,
      probeId: input.probeId ?? PROBE_A,
      criteriaFilter: input.filter,
      checkWrittenAt: input.checkWrittenAt ?? WRITTEN_AT,
      diskPaths: input.diskPaths,
      reads: input.reads,
      isMetOnThisCheck: async (): Promise<boolean> => {
        return Boolean(input.metOnThisCheck);
      },
      judgeThisCheck: async (
        filter: CriteriaFilter,
      ): Promise<string | null> => {
        thisCheckFilters.push(filter);

        const value: number | undefined =
          input.diskValues && filter.serverMonitorOptions?.diskPath
            ? input.diskValues[filter.serverMonitorOptions.diskPath]
            : input.thisCheckValue;

        if (value === undefined) {
          return null;
        }

        const threshold: number = filter.value as number;
        const isMet: boolean =
          filter.filterType === FilterType.GreaterThan
            ? value > threshold
            : filter.filterType === FilterType.GreaterThanOrEqualTo
              ? value >= threshold
              : filter.filterType === FilterType.LessThan
                ? value < threshold
                : filter.filterType === FilterType.LessThanOrEqualTo
                  ? value <= threshold
                  : filter.filterType === FilterType.EqualTo
                    ? value === threshold
                    : value !== threshold;

        return isMet
          ? `${filter.checkOn} is ${value}, which is ${filter.filterType?.toLowerCase()} ${threshold}.`
          : null;
      },
    });

  return { judgement, thisCheckFilters };
}

describe("CriteriaFilterUtil: the threshold made from the previous check", () => {
  test.each([
    {
      name: "more than 50% above 410 is above 615",
      filterType: FilterType.GreaterThan,
      change: { type: PreviousCheckChangeType.Percentage, value: 50 },
      previousValue: 410,
      expected: { filterType: FilterType.GreaterThan, threshold: 615 },
    },
    {
      name: "at least 50% above 410 is at or above 615",
      filterType: FilterType.GreaterThanOrEqualTo,
      change: { type: PreviousCheckChangeType.Percentage, value: 50 },
      previousValue: 410,
      expected: {
        filterType: FilterType.GreaterThanOrEqualTo,
        threshold: 615,
      },
    },
    {
      name: "more than 200 ms above 410 is above 610",
      filterType: FilterType.GreaterThan,
      change: { type: PreviousCheckChangeType.Amount, value: 200 },
      previousValue: 410,
      expected: { filterType: FilterType.GreaterThan, threshold: 610 },
    },
    {
      name: "dropping by more than 1 from 30 is below 29",
      filterType: FilterType.LessThan,
      change: { type: PreviousCheckChangeType.Amount, value: 1 },
      previousValue: 30,
      expected: { filterType: FilterType.LessThan, threshold: 29 },
    },
    {
      name: "at least 10% below 200 is at or below 180",
      filterType: FilterType.LessThanOrEqualTo,
      change: { type: PreviousCheckChangeType.Percentage, value: 10 },
      previousValue: 200,
      expected: { filterType: FilterType.LessThanOrEqualTo, threshold: 180 },
    },
    {
      name: "no change: any rise above the previous value",
      filterType: FilterType.GreaterThan,
      change: { type: PreviousCheckChangeType.Amount, value: 0 },
      previousValue: 410,
      expected: { filterType: FilterType.GreaterThan, threshold: 410 },
    },
    {
      name: "the same as the previous check, whatever the change",
      filterType: FilterType.EqualTo,
      change: { type: PreviousCheckChangeType.Percentage, value: 50 },
      previousValue: 200,
      expected: { filterType: FilterType.EqualTo, threshold: 200 },
    },
    {
      name: "different from the previous check",
      filterType: FilterType.NotEqualTo,
      change: { type: PreviousCheckChangeType.Amount, value: 5 },
      previousValue: 200,
      expected: { filterType: FilterType.NotEqualTo, threshold: 200 },
    },
    {
      name: "50% above a reading below zero is still above it",
      filterType: FilterType.GreaterThan,
      change: { type: PreviousCheckChangeType.Percentage, value: 50 },
      previousValue: -10,
      expected: { filterType: FilterType.GreaterThan, threshold: -5 },
    },
    {
      name: "50% below a reading below zero is further below it",
      filterType: FilterType.LessThan,
      change: { type: PreviousCheckChangeType.Percentage, value: 50 },
      previousValue: -10,
      expected: { filterType: FilterType.LessThan, threshold: -15 },
    },
    {
      name: "at least 50% above 0 needs a rise",
      filterType: FilterType.GreaterThanOrEqualTo,
      change: { type: PreviousCheckChangeType.Percentage, value: 50 },
      previousValue: 0,
      expected: { filterType: FilterType.GreaterThan, threshold: 0 },
    },
    {
      name: "at least 50% below 0 needs a fall",
      filterType: FilterType.LessThanOrEqualTo,
      change: { type: PreviousCheckChangeType.Percentage, value: 50 },
      previousValue: 0,
      expected: { filterType: FilterType.LessThan, threshold: 0 },
    },
    {
      name: "at least 5 above 0 is an amount: 5",
      filterType: FilterType.GreaterThanOrEqualTo,
      change: { type: PreviousCheckChangeType.Amount, value: 5 },
      previousValue: 0,
      expected: { filterType: FilterType.GreaterThanOrEqualTo, threshold: 5 },
    },
  ])(
    "$name",
    (testCase: {
      filterType: FilterType;
      change: { type: PreviousCheckChangeType; value: number };
      previousValue: number;
      expected: { filterType: FilterType; threshold: number };
    }) => {
      expect(
        CriteriaFilterUtil.getPreviousCheckComparison({
          previousValue: testCase.previousValue,
          filterType: testCase.filterType,
          change: testCase.change,
        }),
      ).toEqual(testCase.expected);
    },
  );

  test.each([
    FilterType.Contains,
    FilterType.True,
    FilterType.IsEmpty,
    undefined,
  ])(
    "%s compares no number with the previous check's",
    (filterType: FilterType | undefined) => {
      expect(
        CriteriaFilterUtil.getPreviousCheckComparison({
          previousValue: 10,
          filterType: filterType,
          change: { type: PreviousCheckChangeType.Amount, value: 1 },
        }),
      ).toBeNull();
    },
  );

  test("a previous value that is no number makes no threshold", () => {
    expect(
      CriteriaFilterUtil.getPreviousCheckComparison({
        previousValue: NaN,
        filterType: FilterType.GreaterThan,
        change: { type: PreviousCheckChangeType.Amount, value: 1 },
      }),
    ).toBeNull();
  });
});

describe("CriteriaFilterUtil: which filters compare with the previous check", () => {
  test("a window of some minutes, of type Previous Check, on a check with a record", () => {
    expect(
      CriteriaFilterUtil.isComparedWithPreviousCheck(
        previousCheck(RESPONSE_TIME),
        MonitorType.Website,
      ),
    ).toBe(true);

    // Without the box ticked, or without minutes, it is judged on the check alone.
    expect(
      CriteriaFilterUtil.isComparedWithPreviousCheck(
        { ...previousCheck(RESPONSE_TIME), evaluateOverTime: false },
        MonitorType.Website,
      ),
    ).toBe(false);
    expect(
      CriteriaFilterUtil.isComparedWithPreviousCheck(
        previousCheck(RESPONSE_TIME, { minutes: 0 }),
        MonitorType.Website,
      ),
    ).toBe(false);
  });

  test("on a monitor with no checks at a cadence it is judged as All Values", () => {
    const filter: CriteriaFilter = previousCheck({
      checkOn: CheckOn.IsOnline,
      filterType: FilterType.False,
      value: undefined,
    });

    // A Server monitor's Is Online is the time since its agent last reported.
    expect(
      CriteriaFilterUtil.getEffectiveEvaluateOverTimeType(
        filter,
        MonitorType.Server,
      ),
    ).toBe(EvaluateOverTimeType.AllValues);
    expect(
      CriteriaFilterUtil.isComparedWithPreviousCheck(
        filter,
        MonitorType.Server,
      ),
    ).toBe(false);
    expect(
      CriteriaFilterUtil.isComparedWithPreviousCheck(filter, MonitorType.Ping),
    ).toBe(true);
  });

  test("a measured value compares a value; a yes or no check whether it started to match", () => {
    expect(
      CriteriaFilterUtil.comparesValueWithPreviousCheck(
        previousCheck(RESPONSE_TIME),
        MonitorType.API,
      ),
    ).toBe(true);
    expect(
      CriteriaFilterUtil.comparesValueWithPreviousCheck(
        previousCheck({
          checkOn: CheckOn.IsOnline,
          filterType: FilterType.False,
          value: undefined,
        }),
        MonitorType.Ping,
      ),
    ).toBe(false);
    expect(
      CriteriaFilterUtil.comparesValueWithPreviousCheck(
        previousCheck({
          checkOn: CheckOn.ResponseBody,
          filterType: FilterType.Contains,
          value: "Error",
        }),
        MonitorType.Website,
      ),
    ).toBe(false);
  });

  test("the Evaluate list offers Previous Check where the checks are kept", () => {
    expect(
      CriteriaFilterUtil.getEvaluateOverTimeTypeByCriteriaFilter(
        RESPONSE_TIME,
        MonitorType.Website,
      ),
    ).toContain(EvaluateOverTimeType.PreviousCheck);
    expect(
      CriteriaFilterUtil.getEvaluateOverTimeTypeByCriteriaFilter(
        { checkOn: CheckOn.ResponseBody, filterType: undefined, value: "" },
        MonitorType.API,
      ),
    ).toContain(EvaluateOverTimeType.PreviousCheck);
    expect(
      CriteriaFilterUtil.getEvaluateOverTimeTypeByCriteriaFilter(
        { checkOn: CheckOn.IsOnline, filterType: undefined, value: "" },
        MonitorType.Server,
      ),
    ).not.toContain(EvaluateOverTimeType.PreviousCheck);
    expect(
      CriteriaFilterUtil.getEvaluateOverTimeTypeByCriteriaFilter(
        { checkOn: CheckOn.IncomingRequest, filterType: undefined, value: "" },
        MonitorType.IncomingRequest,
      ),
    ).not.toContain(EvaluateOverTimeType.PreviousCheck);
  });

  test("a change is its own, or an amount of 0", () => {
    expect(
      CriteriaFilterUtil.getPreviousCheckChange(previousCheck(RESPONSE_TIME)),
    ).toEqual({ type: PreviousCheckChangeType.Amount, value: 0 });
    expect(
      CriteriaFilterUtil.getPreviousCheckChange(
        previousCheck(RESPONSE_TIME, {
          changeType: PreviousCheckChangeType.Percentage,
          changeValue: 50,
        }),
      ),
    ).toEqual({ type: PreviousCheckChangeType.Percentage, value: 50 });
    expect(
      CriteriaFilterUtil.getPreviousCheckChange(
        previousCheck(RESPONSE_TIME, { changeValue: -3 }),
      ),
    ).toEqual({ type: PreviousCheckChangeType.Amount, value: 0 });
  });
});

describe("PreviousCheckComparison: where the previous check is read from", () => {
  test("a measured value: the series its check is written to, one group a probe", () => {
    expect(
      PreviousCheckComparison.getSource({
        criteriaFilter: previousCheck(RESPONSE_TIME),
        monitorType: MonitorType.Website,
        monitorStepId: STEP_ID,
      }),
    ).toEqual({
      metricName: MonitorMetricType.ResponseTime,
      attributes: {},
      groupByAttributeKeys: ["probeId"],
      isMatchHistory: false,
      condition: null,
    } as PreviousCheckSource);
  });

  test("a disk's usage: one group a probe and disk", () => {
    expect(
      PreviousCheckComparison.getSource({
        criteriaFilter: previousCheck({
          checkOn: CheckOn.DiskUsagePercent,
          filterType: FilterType.GreaterThan,
          value: undefined,
          serverMonitorOptions: { diskPath: "*" },
        }),
        monitorType: MonitorType.Server,
        monitorStepId: STEP_ID,
      })?.groupByAttributeKeys,
    ).toEqual(["probeId", "diskPath"]);
  });

  test("a body check: its match history, read by its filter key", () => {
    const filter: CriteriaFilter = previousCheck({
      checkOn: CheckOn.ResponseBody,
      filterType: FilterType.Contains,
      value: "Maintenance",
    });

    expect(
      PreviousCheckComparison.getSource({
        criteriaFilter: filter,
        monitorType: MonitorType.Website,
        monitorStepId: STEP_ID,
      }),
    ).toEqual({
      metricName: CRITERIA_FILTER_MATCH_METRIC_NAME,
      attributes: {
        [CRITERIA_FILTER_KEY_ATTRIBUTE]:
          CriteriaFilterMatchHistory.getFilterKey({
            monitorStepId: STEP_ID,
            criteriaFilter: filter,
          }),
      },
      groupByAttributeKeys: ["probeId"],
      isMatchHistory: true,
      condition: { comparison: "eq", threshold: 1 },
    } as PreviousCheckSource);
  });

  test("Is Online False: the online series, a check matching when it is not 1", () => {
    expect(
      PreviousCheckComparison.getSource({
        criteriaFilter: previousCheck({
          checkOn: CheckOn.IsOnline,
          filterType: FilterType.False,
          value: undefined,
        }),
        monitorType: MonitorType.Ping,
        monitorStepId: STEP_ID,
      }),
    ).toMatchObject({
      metricName: MonitorMetricType.IsOnline,
      isMatchHistory: false,
      condition: { comparison: "ne", threshold: 1 },
    });
  });

  test("a check nothing records has none", () => {
    expect(
      PreviousCheckComparison.getSource({
        criteriaFilter: previousCheck({
          checkOn: CheckOn.ExpiresInHours,
          filterType: FilterType.LessThan,
          value: undefined,
        }),
        monitorType: MonitorType.SSLCertificate,
        monitorStepId: STEP_ID,
      }),
    ).toBeNull();
  });

  test("a certificate's days left are read from the series each check writes (#10905)", () => {
    expect(
      PreviousCheckComparison.getSource({
        criteriaFilter: previousCheck({
          checkOn: CheckOn.ExpiresInDays,
          filterType: FilterType.LessThan,
          value: undefined,
        }),
        monitorType: MonitorType.SSLCertificate,
        monitorStepId: STEP_ID,
      }),
    ).toMatchObject({
      metricName: MonitorMetricType.SslCertificateExpiresInDays,
      groupByAttributeKeys: ["probeId"],
      isMatchHistory: false,
      // A measured value: its previous value makes the threshold.
      condition: null,
    });
  });
});

describe("PreviousCheckComparison.judgeFilter: a measured value", () => {
  beforeEach(() => {
    readsAsked = [];
    jest.spyOn(logger, "error").mockImplementation(() => {
      return undefined as never;
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  const UP_HALF: CriteriaFilter = previousCheck(RESPONSE_TIME, {
    changeType: PreviousCheckChangeType.Percentage,
    changeValue: 50,
  });

  test("more than 50% above the previous check: met, with what it was compared with", async () => {
    stubPreviousChecks([row({ value: 410 })]);

    const judged: Judged = await judge({
      filter: UP_HALF,
      thisCheckValue: 820,
    });

    expect(judged.judgement.rootCause).toBe(
      "Response Time (in ms) is more than 50% above the previous check. The previous check, 1 minute ago, read 410, so this check needed more than 615: Response Time (in ms) is 820, which is greater than 615.",
    );
    expect(judged.judgement.message).toBe(judged.judgement.rootCause);
  });

  test("this check is judged by the filter's own comparison, with the threshold as a number", async () => {
    stubPreviousChecks([row({ value: 410 })]);

    const judged: Judged = await judge({
      filter: UP_HALF,
      thisCheckValue: 500,
    });

    expect(judged.thisCheckFilters).toEqual([
      {
        checkOn: CheckOn.ResponseTime,
        filterType: FilterType.GreaterThan,
        value: 615,
        evaluateOverTime: false,
      },
    ]);
    expect(judged.judgement.rootCause).toBeNull();
    expect(judged.judgement.message).toBe(
      "Response Time (in ms) is not more than 50% above the previous check. The previous check, 1 minute ago, read 410, so this check needed more than 615.",
    );
  });

  test("the previous check is read before this check was written, over the window", async () => {
    stubPreviousChecks([row({ value: 410 })]);

    await judge({ filter: UP_HALF, thisCheckValue: 820 });

    expect(readsAsked).toEqual([
      {
        metricName: MonitorMetricType.ResponseTime,
        windowStart: new Date(WRITTEN_AT.getTime() - 5 * MINUTE),
        before: WRITTEN_AT,
        attributes: {},
        groupByAttributeKeys: ["probeId"],
      },
    ]);
  });

  describe("the first check: If No Data decides", () => {
    test("Ignore waits", async () => {
      stubPreviousChecks([]);

      const judged: Judged = await judge({
        filter: UP_HALF,
        thisCheckValue: 820,
      });

      expect(judged.judgement).toEqual({
        rootCause: null,
        message:
          "Response Time (in ms) has no previous check in the last 5 minutes, so it was not compared with one.",
      });
      expect(judged.thisCheckFilters).toEqual([]);
    });

    test("Trigger matches", async () => {
      stubPreviousChecks([]);

      const judged: Judged = await judge({
        filter: previousCheck(RESPONSE_TIME, {
          changeType: PreviousCheckChangeType.Percentage,
          changeValue: 50,
          onNoDataPolicy: NoDataPolicy.Trigger,
        }),
        thisCheckValue: 100,
      });

      expect(judged.judgement.rootCause).toBe(
        "Response Time (in ms) has no previous check in the last 5 minutes, and its If No Data setting is Trigger.",
      );
    });

    test("Treat As Zero compares with a previous value of 0", async () => {
      stubPreviousChecks([]);

      const judged: Judged = await judge({
        filter: previousCheck(RESPONSE_TIME, {
          changeType: PreviousCheckChangeType.Amount,
          changeValue: 500,
          onNoDataPolicy: NoDataPolicy.TreatAsZero,
        }),
        thisCheckValue: 820,
      });

      expect(judged.thisCheckFilters[0]!.value).toBe(500);
      expect(judged.judgement.rootCause).toContain(
        "It has no previous check in the last 5 minutes, so it was compared with 0 (its If No Data setting is Treat As Zero), so this check needed more than 500",
      );
    });
  });

  test("a probe with no previous check while another has one", async () => {
    stubPreviousChecks([row({ value: 410, probeId: PROBE_A })]);

    const reads: PreviousCheckReads = new PreviousCheckReads();

    const probeA: Judged = await judge({
      filter: UP_HALF,
      probeId: PROBE_A,
      thisCheckValue: 820,
      reads: reads,
    });
    const probeB: Judged = await judge({
      filter: UP_HALF,
      probeId: PROBE_B,
      thisCheckValue: 820,
      reads: reads,
    });

    expect(probeA.judgement.rootCause).not.toBeNull();
    expect(probeB.judgement).toEqual({
      rootCause: null,
      message:
        "Response Time (in ms) has no previous check in the last 5 minutes, so it was not compared with one.",
    });
    // Both probes' previous checks came from one read.
    expect(readsAsked).toHaveLength(1);
  });

  test("a check after a gap longer than the window has no previous check", async () => {
    // Every 5 minutes as a rule, then a 12-minute gap.
    stubPreviousChecks([
      row({ value: 410, minutesAgo: 12 }),
      row({ value: 400, minutesAgo: 17 }),
    ]);

    const judged: Judged = await judge({
      filter: previousCheck(RESPONSE_TIME, {
        minutes: 10,
        changeType: PreviousCheckChangeType.Percentage,
        changeValue: 50,
      }),
      thisCheckValue: 820,
    });

    expect(judged.judgement).toEqual({
      rootCause: null,
      message:
        "Response Time (in ms) has no previous check in the last 10 minutes, so it was not compared with one.",
    });
  });

  test("a check within the window after a gap is compared with it", async () => {
    stubPreviousChecks([row({ value: 410, minutesAgo: 9 })]);

    const judged: Judged = await judge({
      filter: previousCheck(RESPONSE_TIME, {
        minutes: 10,
        changeType: PreviousCheckChangeType.Percentage,
        changeValue: 50,
      }),
      thisCheckValue: 820,
    });

    expect(judged.judgement.rootCause).toContain(
      "The previous check, 9 minutes ago, read 410",
    );
  });

  test("dropping by more than 1 from the previous check", async () => {
    stubPreviousChecks([row({ value: 30 })]);

    const dropping: CriteriaFilter = previousCheck(
      {
        checkOn: CheckOn.CPUUsagePercent,
        filterType: FilterType.LessThan,
        value: undefined,
      },
      { changeType: PreviousCheckChangeType.Amount, changeValue: 1 },
    );

    expect(
      (await judge({ filter: dropping, thisCheckValue: 28 })).judgement
        .rootCause,
    ).toContain("CPU Usage (in %) is more than 1 below the previous check.");
    expect(
      (await judge({ filter: dropping, thisCheckValue: 29 })).judgement
        .rootCause,
    ).toBeNull();
  });

  test("different from the previous check: a status code that changed", async () => {
    stubPreviousChecks([row({ value: 200 })]);

    const changed: CriteriaFilter = previousCheck({
      checkOn: CheckOn.ResponseStatusCode,
      filterType: FilterType.NotEqualTo,
      value: undefined,
    });

    const judged: Judged = await judge({
      filter: changed,
      thisCheckValue: 503,
    });

    expect(judged.thisCheckFilters[0]).toMatchObject({
      filterType: FilterType.NotEqualTo,
      value: 200,
    });
    expect(judged.judgement.rootCause).toContain(
      "Response Status Code is different from the previous check. The previous check, 1 minute ago, read 200, so this check needed anything but 200",
    );
    expect(
      (await judge({ filter: changed, thisCheckValue: 200 })).judgement
        .rootCause,
    ).toBeNull();
  });

  test("a previous check that cannot be read is never a breach", async () => {
    jest
      .spyOn(MetricService, "readPreviousMonitorChecks")
      .mockRejectedValue(new Error("ClickHouse is down") as never);

    const judged: Judged = await judge({
      filter: UP_HALF,
      thisCheckValue: 820,
    });

    expect(judged.judgement).toEqual({
      rootCause: null,
      message:
        "The previous check could not be read, so Response Time (in ms) was not compared with it.",
    });
  });

  test("a filter compared with Contains reads no number and is not judged", async () => {
    stubPreviousChecks([row({ value: 200 })]);

    const judged: Judged = await judge({
      filter: previousCheck({
        checkOn: CheckOn.ResponseTime,
        filterType: FilterType.Contains,
        value: undefined,
      }),
      thisCheckValue: 820,
    });

    expect(judged.judgement.rootCause).toBeNull();
    expect(judged.judgement.message).toBe(
      "Response Time (in ms) compares a number with the previous check's, and Contains does not, so it was not judged.",
    );
  });
});

describe("PreviousCheckComparison.judgeFilter: each disk against its own previous check", () => {
  beforeEach(() => {
    readsAsked = [];
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  const DISK_RISING: CriteriaFilter = previousCheck(
    {
      checkOn: CheckOn.DiskUsagePercent,
      filterType: FilterType.GreaterThan,
      value: undefined,
      serverMonitorOptions: { diskPath: "*" },
    },
    { changeType: PreviousCheckChangeType.Amount, changeValue: 10 },
  );

  test("a disk that rose past its own previous check matches; one that did not, not", async () => {
    // A Server monitor's rows carry no probe.
    stubPreviousChecks([
      row({ value: 50, probeId: "", diskPath: "/" }),
      row({ value: 40, probeId: "", diskPath: "/data" }),
    ]);

    const judged: Judged = await judge({
      filter: DISK_RISING,
      monitorType: MonitorType.Server,
      probeId: "",
      diskPaths: ["/", "/data"],
      diskValues: { "/": 55, "/data": 70 },
    });

    expect(
      judged.thisCheckFilters.map((filter: CriteriaFilter) => {
        return [filter.serverMonitorOptions?.diskPath, filter.value];
      }),
    ).toEqual([
      ["/", 60],
      ["/data", 50],
    ]);
    expect(judged.judgement.rootCause).toMatch(
      /^Disk \/data - Disk Usage \(in %\) is more than 10 above the previous check\. The previous check, 1 minute ago, read 40, so this check needed more than 50: /,
    );
  });

  test("no disk rose: the first disk's message, unmet", async () => {
    stubPreviousChecks([
      row({ value: 50, probeId: "", diskPath: "/" }),
      row({ value: 40, probeId: "", diskPath: "/data" }),
    ]);

    const judged: Judged = await judge({
      filter: DISK_RISING,
      monitorType: MonitorType.Server,
      probeId: "",
      diskPaths: ["/", "/data"],
      diskValues: { "/": 51, "/data": 41 },
    });

    expect(judged.judgement.rootCause).toBeNull();
    expect(judged.judgement.message).toMatch(/^Disk \/ - /);
  });

  test("a disk new since the previous check has none", async () => {
    stubPreviousChecks([row({ value: 50, probeId: "", diskPath: "/" })]);

    const judged: Judged = await judge({
      filter: DISK_RISING,
      monitorType: MonitorType.Server,
      probeId: "",
      diskPaths: ["/", "/mnt/new"],
      diskValues: { "/": 51, "/mnt/new": 99 },
    });

    expect(judged.judgement.rootCause).toBeNull();
    expect(judged.judgement.message).toBe(
      "Disk / - Disk Usage (in %) is not more than 10 above the previous check. The previous check, 1 minute ago, read 50, so this check needed more than 60.",
    );
  });
});

describe("PreviousCheckComparison.judgeFilter: a yes or no check started to match", () => {
  beforeEach(() => {
    readsAsked = [];
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  const MAINTENANCE: CriteriaFilter = previousCheck({
    checkOn: CheckOn.ResponseBody,
    filterType: FilterType.Contains,
    value: "Maintenance",
  });

  test("the body started containing the text: met", async () => {
    stubPreviousChecks([row({ value: 0 })]);

    const judged: Judged = await judge({
      filter: MAINTENANCE,
      metOnThisCheck: true,
    });

    expect(judged.judgement.rootCause).toBe(
      'Response Body Contains "Maintenance" matched on this check, and did not on the previous check, 1 minute ago: it started matching.',
    );
    expect(readsAsked[0]!.metricName).toBe(CRITERIA_FILTER_MATCH_METRIC_NAME);
  });

  test("it still contains the text: not met", async () => {
    stubPreviousChecks([row({ value: 1 })]);

    expect(
      (await judge({ filter: MAINTENANCE, metOnThisCheck: true })).judgement,
    ).toEqual({
      rootCause: null,
      message:
        'Response Body Contains "Maintenance" matched on this check, as it did on the previous check, 1 minute ago: it did not start matching on this one.',
    });
  });

  test("it stopped containing the text: not met, and said so", async () => {
    stubPreviousChecks([row({ value: 1 })]);

    expect(
      (await judge({ filter: MAINTENANCE, metOnThisCheck: false })).judgement,
    ).toEqual({
      rootCause: null,
      message:
        'Response Body Contains "Maintenance" did not match on this check, though it did on the previous check, 1 minute ago: it stopped matching.',
    });
  });

  test("the opposite condition matches on the check it stopped on", async () => {
    // Not Contains keeps a history of its own: 0 on the maintenance page.
    stubPreviousChecks([row({ value: 0 })]);

    const judged: Judged = await judge({
      filter: previousCheck({
        checkOn: CheckOn.ResponseBody,
        filterType: FilterType.NotContains,
        value: "Maintenance",
      }),
      metOnThisCheck: true,
    });

    expect(judged.judgement.rootCause).toContain("it started matching");
  });

  test("neither check matched: not met", async () => {
    stubPreviousChecks([row({ value: 0 })]);

    expect(
      (await judge({ filter: MAINTENANCE, metOnThisCheck: false })).judgement,
    ).toEqual({
      rootCause: null,
      message:
        'Response Body Contains "Maintenance" did not match on this check, nor on the previous check, 1 minute ago.',
    });
  });

  test("Is Online False matches on the check the device went down", async () => {
    stubPreviousChecks([row({ value: 1 })]);

    const wentDown: Judged = await judge({
      filter: previousCheck({
        checkOn: CheckOn.IsOnline,
        filterType: FilterType.False,
        value: undefined,
      }),
      monitorType: MonitorType.Ping,
      metOnThisCheck: true,
    });

    expect(wentDown.judgement.rootCause).toBe(
      "Is Online False matched on this check, and did not on the previous check, 1 minute ago: it started matching.",
    );
    expect(readsAsked[0]!.metricName).toBe(MonitorMetricType.IsOnline);
  });

  test("Is Online True matches on the check it came back", async () => {
    stubPreviousChecks([row({ value: 0 })]);

    expect(
      (
        await judge({
          filter: previousCheck({
            checkOn: CheckOn.IsOnline,
            filterType: FilterType.True,
            value: undefined,
          }),
          monitorType: MonitorType.Ping,
          metOnThisCheck: true,
        })
      ).judgement.rootCause,
    ).toContain("it started matching");
  });

  describe("no previous check", () => {
    test("Ignore waits", async () => {
      stubPreviousChecks([]);

      expect(
        (await judge({ filter: MAINTENANCE, metOnThisCheck: true })).judgement,
      ).toEqual({
        rootCause: null,
        message:
          'Response Body Contains "Maintenance" has no previous check in the last 5 minutes, so it was not compared with one.',
      });
    });

    test("Treat As Zero reads it as a check that did not match", async () => {
      stubPreviousChecks([]);

      const asZero: CriteriaFilter = previousCheck(MAINTENANCE, {
        onNoDataPolicy: NoDataPolicy.TreatAsZero,
      });

      expect(
        (await judge({ filter: asZero, metOnThisCheck: true })).judgement
          .rootCause,
      ).toBe(
        'Response Body Contains "Maintenance" matched on this check. It has no previous check in the last 5 minutes, which its If No Data setting (Treat As Zero) reads as one it did not match on.',
      );
      expect(
        (await judge({ filter: asZero, metOnThisCheck: false })).judgement
          .rootCause,
      ).toBeNull();
    });
  });
});

describe("PreviousCheckReads: one read for everything judged as of one moment", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("filters of one series share a read; another moment reads again", async () => {
    readsAsked = [];
    stubPreviousChecks([row({ value: 410 })]);

    const reads: PreviousCheckReads = PreviousCheckReads.forMatchHistoryReads(
      new CriteriaFilterMatchHistoryReads(),
    );

    await judge({
      filter: previousCheck(RESPONSE_TIME, { changeValue: 100 }),
      thisCheckValue: 900,
      reads: reads,
    });
    await judge({
      filter: previousCheck(
        { ...RESPONSE_TIME, filterType: FilterType.LessThan },
        { changeValue: 100 },
      ),
      thisCheckValue: 900,
      reads: reads,
    });

    expect(readsAsked).toHaveLength(1);

    // A stored check of another probe, written earlier: read with its own time.
    await judge({
      filter: previousCheck(RESPONSE_TIME, { changeValue: 100 }),
      thisCheckValue: 900,
      reads: reads,
      checkWrittenAt: new Date(WRITTEN_AT.getTime() - 20 * 1000),
    });

    expect(readsAsked).toHaveLength(2);
  });

  test("the reads of one probe result are its match histories' companion", () => {
    const matchHistoryReads: CriteriaFilterMatchHistoryReads =
      new CriteriaFilterMatchHistoryReads();

    expect(PreviousCheckReads.forMatchHistoryReads(matchHistoryReads)).toBe(
      PreviousCheckReads.forMatchHistoryReads(matchHistoryReads),
    );
    expect(PreviousCheckReads.forMatchHistoryReads(matchHistoryReads)).not.toBe(
      PreviousCheckReads.forMatchHistoryReads(
        new CriteriaFilterMatchHistoryReads(),
      ),
    );
  });
});

describe("PreviousCheckComparison: the words", () => {
  test.each([
    [
      FilterType.GreaterThan,
      PreviousCheckChangeType.Percentage,
      50,
      "more than 50% above",
    ],
    [
      FilterType.GreaterThanOrEqualTo,
      PreviousCheckChangeType.Amount,
      200,
      "at least 200 above",
    ],
    [
      FilterType.LessThan,
      PreviousCheckChangeType.Amount,
      1,
      "more than 1 below",
    ],
    [
      FilterType.LessThanOrEqualTo,
      PreviousCheckChangeType.Percentage,
      12.5,
      "at least 12.5% below",
    ],
    [FilterType.GreaterThan, PreviousCheckChangeType.Amount, 0, "above"],
    [
      FilterType.GreaterThanOrEqualTo,
      PreviousCheckChangeType.Amount,
      0,
      "at or above",
    ],
    [FilterType.LessThan, PreviousCheckChangeType.Percentage, 0, "below"],
    [
      FilterType.LessThanOrEqualTo,
      PreviousCheckChangeType.Amount,
      0,
      "at or below",
    ],
    [FilterType.EqualTo, PreviousCheckChangeType.Amount, 5, "the same as"],
    [
      FilterType.NotEqualTo,
      PreviousCheckChangeType.Amount,
      5,
      "different from",
    ],
  ])(
    "%s with a change of %s %s reads %s",
    (
      filterType: FilterType,
      changeType: PreviousCheckChangeType,
      changeValue: number,
      expected: string,
    ) => {
      expect(
        PreviousCheckComparison.describeRelation(
          previousCheck(
            { ...RESPONSE_TIME, filterType: filterType },
            { changeType: changeType, changeValue: changeValue },
          ),
        ),
      ).toBe(expected);
    },
  );

  test.each([
    [0, "less than a minute ago"],
    [59 * 1000, "less than a minute ago"],
    [MINUTE, "1 minute ago"],
    [7 * MINUTE + 30 * 1000, "7 minutes ago"],
    [119 * MINUTE, "119 minutes ago"],
    [180 * MINUTE, "3 hours ago"],
  ])("%s ms ago reads %s", (milliseconds: number, expected: string) => {
    expect(PreviousCheckComparison.describeAgo(milliseconds)).toBe(expected);
  });

  test("a database metric is named by its name in the catalog", () => {
    expect(
      PreviousCheckComparison.getFilterLabel(
        previousCheck({
          checkOn: CheckOn.DatabaseMetric,
          filterType: FilterType.GreaterThan,
          value: undefined,
          databaseMonitorOptions: {
            metricType: MonitorMetricType.DatabaseConnectionsUsedPercent,
          },
        }),
        MonitorType.Database,
      ),
    ).not.toBe(CheckOn.DatabaseMetric);
  });
});
