import EvaluateOverTime, {
  OverTimeEvaluation,
  OverTimeEvaluationStatus,
  OverTimeWindowReads,
} from "../../../../../Server/Utils/Monitor/Criteria/EvaluateOverTime";
import { CriteriaFilterMatchHistoryReads } from "../../../../../Server/Utils/Monitor/Criteria/CriteriaFilterMatchHistory";
import MetricService from "../../../../../Server/Services/MetricService";
import logger from "../../../../../Server/Utils/Logger";
import Metric from "../../../../../Models/AnalyticsModels/Metric";
import {
  CheckOn,
  CriteriaFilter,
  EvaluateOverTimeType,
  FilterType,
} from "../../../../../Types/Monitor/CriteriaFilter";
import MonitorMetricType from "../../../../../Types/Monitor/MonitorMetricType";
import { MonitorStepSeriesScope } from "../../../../../Types/Monitor/MonitorStepSeries";
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
 * THE OVER-TIME WINDOWS OF ONE PROBE RESULT, READ ONCE EACH.
 *
 * A probe result is judged against every over-time filter its criteria
 * reach, and the probe agreement pass judges every other probe's last check
 * against them again (MonitorResource). Each judgement read its window, the
 * same rows each time: a monitor checked from five probes with two over-time
 * filters read ten windows a result, and on 2026-11-28 those reads kept
 * ClickHouse's 16 cores busy. OverTimeWindowReads reads each window of a
 * series once for the result, as of one moment, and hands it to every
 * filter, evaluation and probe that asks for it.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const MONITOR_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const OTHER_MONITOR_ID: ObjectID = new ObjectID(
  "33333333-3333-4333-8333-333333333333",
);
const STEP_A: string = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const STEP_B: string = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

const NOW: Date = new Date("2026-11-28T19:20:00.000Z");
const MINUTE_IN_MS: number = 60 * 1000;

const ONE_STEP: MonitorStepSeriesScope = {
  monitorStepId: STEP_A,
  readsRowsWithoutStep: true,
};

type WindowRead = Parameters<typeof MetricService.readMonitorWindowRows>[0];

let reads: Array<WindowRead> = [];
let readError: Error | null = null;

function overTime(input: {
  checkOn?: CheckOn | undefined;
  minutes?: number | undefined;
  type: EvaluateOverTimeType;
  value: number;
}): CriteriaFilter {
  return {
    checkOn: input.checkOn || CheckOn.ResponseTime,
    filterType: FilterType.GreaterThan,
    value: input.value,
    evaluateOverTime: true,
    evaluateOverTimeOptions: {
      timeValueInMinutes: input.minutes || 5,
      evaluateOverTimeType: input.type,
    },
  };
}

// A check a minute for the five minutes before NOW, newest first.
function lastFiveMinutes(value: number): Array<Metric> {
  return [0, 1, 2, 3, 4].map((minutesAgo: number): Metric => {
    const metric: Metric = new Metric();
    metric.value = value;
    metric.time = new Date(NOW.getTime() - minutesAgo * MINUTE_IN_MS);
    return metric;
  });
}

function evaluate(input: {
  criteriaFilter: CriteriaFilter;
  windowReads?: OverTimeWindowReads | undefined;
  monitorId?: ObjectID | undefined;
  stepScope?: MonitorStepSeriesScope | undefined;
  miscData?: Record<string, string> | undefined;
}): Promise<OverTimeEvaluation> {
  return EvaluateOverTime.evaluateOverTime({
    projectId: PROJECT_ID,
    monitorId: input.monitorId || MONITOR_ID,
    criteriaFilter: input.criteriaFilter,
    monitoringInterval: "* * * * *",
    stepScope: input.stepScope || ONE_STEP,
    miscData: input.miscData,
    windowReads: input.windowReads,
  });
}

describe("OverTimeWindowReads", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(NOW);

    reads = [];
    readError = null;

    jest
      .spyOn(MetricService, "readMonitorWindowRows")
      .mockImplementation(async (read: WindowRead): Promise<Array<Metric>> => {
        reads.push(read);

        if (readError) {
          throw readError;
        }

        return lastFiveMinutes(1200);
      });

    jest.spyOn(logger, "error").mockImplementation(() => {
      return undefined as never;
    });
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  test("filters on the same window of one series read it once, and each judges it", async () => {
    const windowReads: OverTimeWindowReads = new OverTimeWindowReads();

    const allValues: OverTimeEvaluation = await evaluate({
      criteriaFilter: overTime({
        type: EvaluateOverTimeType.AllValues,
        value: 1000,
      }),
      windowReads: windowReads,
    });

    const average: OverTimeEvaluation = await evaluate({
      criteriaFilter: overTime({
        type: EvaluateOverTimeType.Average,
        value: 5000,
      }),
      windowReads: windowReads,
    });

    expect(reads).toHaveLength(1);
    expect(allValues.status).toBe(OverTimeEvaluationStatus.Evaluated);
    expect(allValues.value).toEqual([1200, 1200, 1200, 1200, 1200]);
    expect(average.status).toBe(OverTimeEvaluationStatus.Evaluated);
    expect(average.value).toBe(1200);
  });

  test("filters judged at once share the read still under way", async () => {
    const windowReads: OverTimeWindowReads = new OverTimeWindowReads();

    await Promise.all([
      evaluate({
        criteriaFilter: overTime({
          type: EvaluateOverTimeType.AllValues,
          value: 1000,
        }),
        windowReads: windowReads,
      }),
      evaluate({
        criteriaFilter: overTime({
          type: EvaluateOverTimeType.MaximumValue,
          value: 3000,
        }),
        windowReads: windowReads,
      }),
    ]);

    expect(reads).toHaveLength(1);
  });

  test("a window of another length, step, disk, series or monitor is a read of its own", async () => {
    const windowReads: OverTimeWindowReads = new OverTimeWindowReads();
    const average: CriteriaFilter = overTime({
      type: EvaluateOverTimeType.Average,
      value: 1000,
    });

    await evaluate({ criteriaFilter: average, windowReads: windowReads });
    await evaluate({
      criteriaFilter: overTime({
        type: EvaluateOverTimeType.Average,
        value: 1000,
        minutes: 15,
      }),
      windowReads: windowReads,
    });
    await evaluate({
      criteriaFilter: average,
      windowReads: windowReads,
      stepScope: { monitorStepId: STEP_B, readsRowsWithoutStep: false },
    });
    await evaluate({
      criteriaFilter: overTime({
        checkOn: CheckOn.DiskUsagePercent,
        type: EvaluateOverTimeType.Average,
        value: 80,
      }),
      windowReads: windowReads,
      miscData: { diskPath: "/var" },
    });
    await evaluate({
      criteriaFilter: overTime({
        checkOn: CheckOn.ResponseStatusCode,
        type: EvaluateOverTimeType.Average,
        value: 500,
      }),
      windowReads: windowReads,
    });
    await evaluate({
      criteriaFilter: average,
      windowReads: windowReads,
      monitorId: OTHER_MONITOR_ID,
    });

    expect(reads).toHaveLength(6);
    expect(
      reads.map((read: WindowRead) => {
        return [
          read.monitorId.toString(),
          read.metricName,
          (read.windowEnd.getTime() - read.windowStart.getTime()) /
            MINUTE_IN_MS,
          read.attributes,
        ];
      }),
    ).toEqual([
      [
        MONITOR_ID.toString(),
        MonitorMetricType.ResponseTime,
        5,
        { monitorStepId: [STEP_A, ""] },
      ],
      [
        MONITOR_ID.toString(),
        MonitorMetricType.ResponseTime,
        15,
        { monitorStepId: [STEP_A, ""] },
      ],
      [
        MONITOR_ID.toString(),
        MonitorMetricType.ResponseTime,
        5,
        { monitorStepId: [STEP_B] },
      ],
      [
        MONITOR_ID.toString(),
        MonitorMetricType.DiskUsagePercent,
        5,
        { diskPath: "/var", monitorStepId: [STEP_A, ""] },
      ],
      [
        MONITOR_ID.toString(),
        MonitorMetricType.ResponseStatusCode,
        5,
        { monitorStepId: [STEP_A, ""] },
      ],
      [
        OTHER_MONITOR_ID.toString(),
        MonitorMetricType.ResponseTime,
        5,
        { monitorStepId: [STEP_A, ""] },
      ],
    ]);
  });

  test("the order a window's attributes come in does not split its read", async () => {
    const windowReads: OverTimeWindowReads = new OverTimeWindowReads();

    await windowReads.getRows({
      projectId: PROJECT_ID,
      monitorId: MONITOR_ID,
      metricName: MonitorMetricType.DiskUsagePercent,
      windowStart: new Date(NOW.getTime() - 5 * MINUTE_IN_MS),
      attributes: { diskPath: "/", monitorStepId: [STEP_A] },
    });
    await windowReads.getRows({
      projectId: PROJECT_ID,
      monitorId: MONITOR_ID,
      metricName: MonitorMetricType.DiskUsagePercent,
      windowStart: new Date(NOW.getTime() - 5 * MINUTE_IN_MS),
      attributes: { monitorStepId: [STEP_A], diskPath: "/" },
    });

    expect(reads).toHaveLength(1);
  });

  test("every window ends at the moment the reads were made, however long judging takes", async () => {
    const windowReads: OverTimeWindowReads = new OverTimeWindowReads();

    // Seconds pass before the probe agreement pass judges the next probe.
    jest.setSystemTime(new Date(NOW.getTime() + 7000));

    await evaluate({
      criteriaFilter: overTime({
        type: EvaluateOverTimeType.Average,
        value: 1000,
      }),
      windowReads: windowReads,
    });

    expect(windowReads.now).toEqual(NOW);
    expect(reads[0]!.windowEnd).toEqual(NOW);
    expect(reads[0]!.windowStart).toEqual(
      new Date(NOW.getTime() - 5 * MINUTE_IN_MS),
    );
  });

  test("without reads of its own, a filter reads its window as of now", async () => {
    await evaluate({
      criteriaFilter: overTime({
        type: EvaluateOverTimeType.Average,
        value: 1000,
      }),
    });
    await evaluate({
      criteriaFilter: overTime({
        type: EvaluateOverTimeType.Average,
        value: 1000,
      }),
    });

    // Two evaluations with none to share: a read each, as before.
    expect(reads).toHaveLength(2);
    expect(reads[0]!.windowEnd).toEqual(NOW);
  });

  test("a failed read fails each filter that shares it, and is not sent again", async () => {
    readError = new Error("ClickHouse is restarting");

    const windowReads: OverTimeWindowReads = new OverTimeWindowReads();

    const first: OverTimeEvaluation = await evaluate({
      criteriaFilter: overTime({
        type: EvaluateOverTimeType.AllValues,
        value: 1000,
      }),
      windowReads: windowReads,
    });
    const second: OverTimeEvaluation = await evaluate({
      criteriaFilter: overTime({
        type: EvaluateOverTimeType.Average,
        value: 1000,
      }),
      windowReads: windowReads,
    });

    expect(reads).toHaveLength(1);

    for (const evaluation of [first, second]) {
      expect(evaluation.status).toBe(OverTimeEvaluationStatus.InsufficientData);
      // A read failure is never a breach, whatever the no-data policy says.
      expect(evaluation.isReadError).toBe(true);
    }
  });

  describe("forMatchHistoryReads", () => {
    test("hands one set of reads per probe result, as of the result's moment", () => {
      const matchHistoryReads: CriteriaFilterMatchHistoryReads =
        new CriteriaFilterMatchHistoryReads();

      jest.setSystemTime(new Date(NOW.getTime() + 3000));

      const windowReads: OverTimeWindowReads =
        OverTimeWindowReads.forMatchHistoryReads(matchHistoryReads);

      expect(OverTimeWindowReads.forMatchHistoryReads(matchHistoryReads)).toBe(
        windowReads,
      );
      expect(windowReads.now).toEqual(matchHistoryReads.now);
      expect(windowReads.now).toEqual(NOW);
    });

    test("another probe result's reads are its own", () => {
      const first: OverTimeWindowReads =
        OverTimeWindowReads.forMatchHistoryReads(
          new CriteriaFilterMatchHistoryReads(),
        );
      const second: OverTimeWindowReads =
        OverTimeWindowReads.forMatchHistoryReads(
          new CriteriaFilterMatchHistoryReads(),
        );

      expect(second).not.toBe(first);
    });
  });
});
