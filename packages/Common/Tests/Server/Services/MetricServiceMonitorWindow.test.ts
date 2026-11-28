import MetricService from "../../../Server/Services/MetricService";
import { Statement } from "../../../Server/Utils/AnalyticsDatabase/Statement";
import Metric from "../../../Models/AnalyticsModels/Metric";
import BadDataException from "../../../Types/Exception/BadDataException";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * The statement an over-time window and a match history are read with
 * (MetricService.readMonitorWindowRows): every probe result reads one for
 * each over-time filter its criteria reach, so it is the read monitoring
 * sends ClickHouse most. On 2026-11-28 the find it replaced - `_id` read and
 * sorted by, the key range read twice to page exactly (__sortKeyTopValues),
 * the attributes map read for every row beside the monitor's - ran 18,904
 * times in 30 minutes at 17 seconds each and kept ClickHouse's 16 cores
 * busy. This pins what is left: one pass over the sort key, in PREWHERE,
 * reading each row's time, value and the attributes asked for.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const MONITOR_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const STEP_ID: string = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

const START: Date = new Date("2026-11-28T19:10:00.000Z");
const END: Date = new Date("2026-11-28T19:20:00.000Z");

describe("MetricService.readMonitorWindowRows", () => {
  let statements: Array<Statement> = [];
  let rows: Array<JSONObject> = [];

  beforeEach(() => {
    statements = [];
    rows = [];

    jest
      .spyOn(MetricService, "executeQuery")
      .mockImplementation(
        async (statement: Statement | string): Promise<never> => {
          statements.push(statement as Statement);

          return {
            json: async (): Promise<{ data: Array<JSONObject> }> => {
              return { data: rows };
            },
          } as never;
        },
      );
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  function read(
    overrides: Partial<
      Parameters<typeof MetricService.readMonitorWindowRows>[0]
    > = {},
  ): Promise<Array<Metric>> {
    return MetricService.readMonitorWindowRows({
      projectId: PROJECT_ID,
      monitorId: MONITOR_ID,
      metricName: "oneuptime.monitor.response.time",
      windowStart: START,
      windowEnd: END,
      attributes: { monitorStepId: [STEP_ID, ""] },
      limit: 10000,
      ...overrides,
    });
  }

  test("reads the window in one pass, the sort key in PREWHERE, the step after it", async () => {
    await read();

    expect(statements).toHaveLength(1);

    const query: string = statements[0]!.query;
    const params: Record<string, unknown> = statements[0]!.query_params;

    // The sort key, in order (projectId, name, primaryEntityId, time).
    expect(query).toMatch(
      /PREWHERE projectId = \{p\d+:String\} AND name = \{p\d+:String\} AND primaryEntityId = \{p\d+:String\} AND time >= \{p\d+:DateTime64\(9\)\} AND time <= \{p\d+:DateTime64\(9\)\} WHERE isNotNull\(value\) AND attributes\[\{p\d+:String\}\] IN \{p\d+:Array\(String\)\} AND retentionDate >= now\(\) ORDER BY time DESC LIMIT \{p\d+:Int32\}/,
    );
    expect(Object.values(params)).toEqual(
      expect.arrayContaining([
        PROJECT_ID.toString(),
        "oneuptime.monitor.response.time",
        MONITOR_ID.toString(),
        "monitorStepId",
        [STEP_ID, ""],
        10000,
      ]),
    );

    // Nothing from the criteria reaches the text.
    expect(query).not.toContain(STEP_ID);
    expect(query).not.toContain(MONITOR_ID.toString());
    expect(query).toContain("max_execution_time = 45");
  });

  test("reads each row's time and value, never its id, its whole attributes or a page bound", async () => {
    await read();

    const query: string = statements[0]!.query;

    expect(query).toMatch(/^SELECT time, value FROM /);
    expect(query).not.toContain("_id");
    expect(query).not.toContain("__sortKey");
    expect(query).not.toContain("GLOBAL IN");
    expect(query).not.toContain("OFFSET");
    // The map is read by the one key the step is in, never handed back.
    expect(query.substring(0, query.indexOf(" FROM "))).not.toContain(
      "attributes",
    );
  });

  test("reads the attributes asked for, each by its key, and hands them back as the row's", async () => {
    rows = [
      {
        time: "2026-11-28 19:19:00.000000000",
        value: 1,
        attribute0: "probe-a",
      },
      {
        time: "2026-11-28 19:18:00.000000000",
        value: 0,
        attribute0: "",
      },
    ];

    const metrics: Array<Metric> = await read({
      attributes: { criteriaFilterKey: "abc" },
      readAttributeKeys: ["probeId"],
    });

    const query: string = statements[0]!.query;

    expect(query).toMatch(
      /^SELECT time, value, attributes\[\{p\d+:String\}\] AS attribute0 FROM /,
    );
    expect(query).toMatch(
      /WHERE isNotNull\(value\) AND attributes\[\{p\d+:String\}\] = \{p\d+:String\} AND retentionDate/,
    );
    expect(Object.values(statements[0]!.query_params)).toEqual(
      expect.arrayContaining(["probeId", "criteriaFilterKey", "abc"]),
    );

    expect(metrics).toHaveLength(2);
    expect(metrics[0]!.value).toBe(1);
    expect(metrics[0]!.attributes).toEqual({ probeId: "probe-a" });
    // A map reads a missing key as "": the row has no such attribute.
    expect(metrics[1]!.attributes).toEqual({});
  });

  test("hands back each row's time and value as the find did", async () => {
    rows = [{ time: "2026-11-28 19:19:00.000000000", value: 250 }];

    const metrics: Array<Metric> = await read();

    expect(metrics).toHaveLength(1);
    expect(metrics[0]).toBeInstanceOf(Metric);
    expect(metrics[0]!.value).toBe(250);
    expect(metrics[0]!.time).toBeDefined();
    expect(metrics[0]!.attributes).toBeUndefined();
  });

  test("with no attribute filter, reads every row of the series in the window", async () => {
    await read({ attributes: undefined });

    expect(statements[0]!.query).toMatch(
      /WHERE isNotNull\(value\) AND retentionDate >= now\(\) ORDER BY/,
    );
  });

  test("a step list with no value matches no row, never every row", async () => {
    await read({ attributes: { monitorStepId: [] } });

    expect(statements[0]!.query).toContain(" AND 0");
  });

  test.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])(
    "refuses a limit of %p rows",
    async (limit: number) => {
      await expect(read({ limit: limit })).rejects.toBeInstanceOf(
        BadDataException,
      );
      expect(statements).toHaveLength(0);
    },
  );

  test("reads a limit with a fraction as its whole rows", async () => {
    await read({ limit: 2.5 });

    expect(statements[0]!.query_params).toEqual(
      expect.objectContaining({
        [Object.keys(statements[0]!.query_params).pop()!]: 2,
      }),
    );
  });
});
