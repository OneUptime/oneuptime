import LogCountBaselineService from "../../../Server/Services/LogCountBaselineService";
import SpanCountBaselineService from "../../../Server/Services/SpanCountBaselineService";
import { CountBaselineSummary } from "../../../Server/Utils/Monitor/Criteria/CountAnomaly";
import CountWindowBaseline, {
  CountBaselinePlan,
} from "../../../Server/Utils/Monitor/CountWindowBaseline";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";

/*
 * What the Logs and Traces baselines ask ClickHouse, and what they make of
 * the answer. That the SQL does what it says against the real rollups is in
 * MonitorCountBaselineClickhouse.test.ts (packages/App).
 */

const windowEnd: Date = new Date("2026-11-02T09:40:00.000Z");
const projectId: ObjectID = new ObjectID("7800000000000000000000a1");
const serviceId: ObjectID = new ObjectID("7800000000000000000000b1");

const plan: CountBaselinePlan = CountWindowBaseline.getPlan({
  windowEnd,
  windowSeconds: 60,
});

// Every window of the weeks read, holding `count`, as ClickHouse answers.
function rowsOf(
  count: number | ((weeksBack: number) => number),
  weeksBack: Array<number> = [1, 2],
): Array<JSONObject> {
  return plan.weeks
    .filter((week: CountBaselinePlan["weeks"][number]): boolean => {
      return weeksBack.includes(week.weeksBack);
    })
    .flatMap((week: CountBaselinePlan["weeks"][number]): Array<JSONObject> => {
      return new Array<number>(week.windowCount)
        .fill(0)
        .map((_: number, index: number): JSONObject => {
          return {
            // UInt64 comes back from ClickHouse as a string.
            windowIndex: String(week.firstWindow + index),
            c: String(
              typeof count === "function" ? count(week.weeksBack) : count,
            ),
          };
        });
    });
}

interface ServiceCase {
  name: string;
  table: string;
  state: string;
  service: {
    executeQuery: (...args: Array<never>) => unknown;
  };
  read: (filters: {
    matching?: boolean;
    windowSeconds?: number;
    windowDays?: number;
    minSamples?: number;
    services?: Array<ObjectID | string>;
    project?: ObjectID | string;
  }) => Promise<CountBaselineSummary | null>;
  matchCondition: string;
}

const CASES: Array<ServiceCase> = [
  {
    name: "LogCountBaselineService",
    table: "LogCountBaseline",
    state: "logCountState",
    service: LogCountBaselineService as unknown as ServiceCase["service"],
    matchCondition: "severityText IN ('Error', 'Fatal')",
    read: (filters: {
      matching?: boolean;
      windowSeconds?: number;
      windowDays?: number;
      minSamples?: number;
      services?: Array<ObjectID | string>;
      project?: ObjectID | string;
    }): Promise<CountBaselineSummary | null> => {
      return LogCountBaselineService.getBaseline({
        projectId: filters.project || projectId,
        telemetryServiceIds: filters.services,
        severityTexts: filters.matching ? ["Error", "Fatal"] : undefined,
        windowEnd,
        windowSeconds: filters.windowSeconds || 60,
        windowDays: filters.windowDays,
        minSamples: filters.minSamples,
      });
    },
  },
  {
    name: "SpanCountBaselineService",
    table: "SpanCountBaseline",
    state: "spanCountState",
    service: SpanCountBaselineService as unknown as ServiceCase["service"],
    matchCondition: "statusCode IN (2)",
    read: (filters: {
      matching?: boolean;
      windowSeconds?: number;
      windowDays?: number;
      minSamples?: number;
      services?: Array<ObjectID | string>;
      project?: ObjectID | string;
    }): Promise<CountBaselineSummary | null> => {
      return SpanCountBaselineService.getBaseline({
        projectId: filters.project || projectId,
        telemetryServiceIds: filters.services,
        spanStatusCodes: filters.matching ? [2] : undefined,
        windowEnd,
        windowSeconds: filters.windowSeconds || 60,
        windowDays: filters.windowDays,
        minSamples: filters.minSamples,
      });
    },
  },
];

describe.each(CASES)("$name.getBaseline", (serviceCase: ServiceCase) => {
  let executeQuery: jest.SpyInstance;

  // Answers each query in turn; the last answer goes on being given.
  function answer(...answers: Array<Array<JSONObject>>): void {
    let call: number = 0;

    executeQuery.mockImplementation(async () => {
      const data: Array<JSONObject> =
        answers[Math.min(call, answers.length - 1)]!;

      call++;

      return {
        json: async (): Promise<{ data: Array<JSONObject> }> => {
          return { data };
        },
      };
    });
  }

  const sqlOf: (call: number) => string = (call: number): string => {
    return executeQuery.mock.calls[call]![0] as string;
  };

  beforeEach(() => {
    executeQuery = jest.spyOn(serviceCase.service as never, "executeQuery");
  });

  afterEach(() => {
    executeQuery.mockRestore();
  });

  test("it reads the windows of the earlier weeks from the rollup", async () => {
    answer(rowsOf(10));

    await serviceCase.read({});

    const sql: string = sqlOf(0);

    expect(sql).toContain(`FROM ${serviceCase.table}`);
    expect(sql).toContain(`projectId = '${projectId.toString()}'`);
    expect(sql).toContain("hourOfWeek IN (9, 10)");
    expect(sql).toContain("day >= toDate('2026-10-19')");
    expect(sql).toContain("day <= toDate('2026-10-26')");
    expect(sql).toContain("GROUP BY windowIndex");
    expect(sql).toContain(`countMerge(${serviceCase.state})`);
  });

  test("it never reads the day being judged", async () => {
    answer(rowsOf(10));

    await serviceCase.read({});

    expect(sqlOf(0)).not.toContain("today()");
    expect(sqlOf(0)).not.toContain("'2026-11-02'");
  });

  test("a window folds that many minutes", async () => {
    answer([]);

    await serviceCase.read({ windowSeconds: 900 });

    expect(sqlOf(0)).toMatch(/minuteOfHour,\s+15\s+\) AS windowIndex/);
  });

  test("a busy scope needs one read", async () => {
    answer(rowsOf(10));

    const summary: CountBaselineSummary | null = await serviceCase.read({});

    expect(executeQuery).toHaveBeenCalledTimes(1);
    expect(summary).toMatchObject({
      mean: 10,
      isReliable: true,
      windowDays: 14,
      hourOfWeek: 9,
    });
  });

  test("the monitor's filter decides what counts, not which rows are read", async () => {
    answer(rowsOf(0));

    const summary: CountBaselineSummary | null = await serviceCase.read({
      matching: true,
    });

    expect(sqlOf(0)).toContain(
      `countMergeIf(${serviceCase.state}, ${serviceCase.matchCondition})`,
    );
    expect(sqlOf(0).split("WHERE")[1]).not.toContain(
      serviceCase.matchCondition,
    );
    expect(executeQuery).toHaveBeenCalledTimes(1);
    expect(summary).toMatchObject({ mean: 0, stddev: 1, isReliable: true });
  });

  test("the monitor's services scope both reads", async () => {
    answer([], [{ c: "0", firstDay: "1970-01-01" }]);

    await serviceCase.read({ services: [serviceId, "other-service"] });

    const clause: string = `primaryEntityId IN ('${serviceId.toString()}', 'other-service')`;

    expect(sqlOf(0)).toContain(clause);
    expect(sqlOf(1)).toContain(clause);
  });

  test("a value is escaped into its literal", async () => {
    answer([], [{ c: "0", firstDay: "1970-01-01" }]);

    await serviceCase.read({ project: "a'b\\c", services: ["d'e"] });

    expect(sqlOf(0)).toContain("projectId = 'a\\'b\\\\c'");
    expect(sqlOf(0)).toContain("primaryEntityId IN ('d\\'e')");
  });

  test("a scope that reported before the weeks read has them as history", async () => {
    answer([], [{ c: "40", firstDay: "2026-08-20" }]);

    const summary: CountBaselineSummary | null = await serviceCase.read({});

    expect(executeQuery).toHaveBeenCalledTimes(2);
    expect(sqlOf(1)).toContain("min(toDate(day))");
    expect(sqlOf(1)).toContain("day <= toDate('2026-10-26')");
    expect(sqlOf(1)).not.toContain("day >=");
    expect(summary).toMatchObject({ mean: 0, stddev: 1, isReliable: true });
  });

  test("a scope nothing has been heard from has no baseline", async () => {
    answer([], [{ c: "0", firstDay: "1970-01-01" }]);

    expect(await serviceCase.read({})).toBeNull();
  });

  test("a scope nine days old has one week of history, and is still learning", async () => {
    answer(rowsOf(10, [1]), [{ c: "40", firstDay: "2026-10-24" }]);

    const summary: CountBaselineSummary | null = await serviceCase.read({});

    expect(summary).toMatchObject({ isReliable: false });
    expect(summary!.sampleCount).toBe(plan.weeks[0]!.windowCount);
  });

  test("a week from before the scope began is not read as silence", async () => {
    answer(rowsOf(10, [1, 2, 3].slice(0, 2)), [
      { c: "40", firstDay: "2026-10-12" },
    ]);

    const summary: CountBaselineSummary | null = await serviceCase.read({
      windowDays: 28,
    });

    expect(summary).toMatchObject({ mean: 10, isReliable: true });
    expect(summary!.nonEmpty).toBeUndefined();
  });

  test("a window asked of no earlier week reads nothing", async () => {
    answer([]);

    expect(await serviceCase.read({ windowDays: 5 })).toBeNull();
    expect(executeQuery).not.toHaveBeenCalled();
  });

  test("the rolling window is capped at what the rollup keeps", async () => {
    answer(rowsOf(10), [{ c: "40", firstDay: "2026-08-20" }]);

    const summary: CountBaselineSummary | null = await serviceCase.read({
      windowDays: 500,
    });

    expect(summary!.windowDays).toBe(90);
  });

  test("minSamples reaches the verdict", async () => {
    answer(rowsOf(10));

    expect((await serviceCase.read({ minSamples: 100000 }))!.isReliable).toBe(
      false,
    );
  });

  test("a failed read is the caller's to handle", async () => {
    executeQuery.mockRejectedValue(new Error("clickhouse down"));

    await expect(serviceCase.read({})).rejects.toThrow("clickhouse down");
  });
});

describe("the status codes a span baseline is given", () => {
  test("numbers saved as text still scope it", async () => {
    const executeQuery: jest.SpyInstance = jest
      .spyOn(SpanCountBaselineService, "executeQuery")
      .mockResolvedValue({
        json: async (): Promise<{ data: Array<JSONObject> }> => {
          return { data: rowsOf(1) };
        },
      } as never);

    await SpanCountBaselineService.getBaseline({
      projectId,
      spanStatusCodes: ["2", "x"] as unknown as Array<number>,
      windowEnd,
      windowSeconds: 60,
    });

    expect(executeQuery.mock.calls[0]![0]).toContain("statusCode IN (2)");

    executeQuery.mockRestore();
  });
});
