// The writer first: it loads the services in the order they expect.
import LlmProviderUsageWriter, {
  LlmProviderSeriesPoint,
  LlmProviderUsageWriteResult,
  LlmProviderUsageWriteTarget,
} from "../../../../Server/Utils/LlmObservability/LlmProviderUsageWriter";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";
import MetricService from "../../../../Server/Services/MetricService";
import { Statement } from "../../../../Server/Utils/AnalyticsDatabase/Statement";
import { LlmUsageWindow } from "../../../../Server/Utils/LlmObservability/LlmConnectorTypes";
import TelemetryUtil from "../../../../Server/Utils/Telemetry/Telemetry";
import AnalyticsTableName from "../../../../Types/AnalyticsDatabase/AnalyticsTableName";
import Dictionary from "../../../../Types/Dictionary";
import { JSONObject } from "../../../../Types/JSON";
import { LlmUsageRecord } from "../../../../Types/LlmObservability/LlmConnectionRecords";
import {
  LLM_CONNECTION_ID_ATTRIBUTE,
  LLM_CONNECTION_NAME_ATTRIBUTE,
  LLM_PROVIDER_API_KEY_ATTRIBUTE,
  LLM_PROVIDER_COST_ESTIMATED_ATTRIBUTE,
  LLM_PROVIDER_COST_METRIC_NAME,
  LLM_PROVIDER_MODEL_ATTRIBUTE,
  LLM_PROVIDER_NAME_ATTRIBUTE,
  LLM_PROVIDER_PERSON_ATTRIBUTE,
  LLM_PROVIDER_PROJECT_ATTRIBUTE,
  LLM_PROVIDER_REQUESTS_METRIC_NAME,
  LLM_PROVIDER_TOKENS_METRIC_NAME,
  LLM_PROVIDER_TOKEN_TYPE_ATTRIBUTE,
  LlmProviderSeriesAttributeKeys,
  LlmProviderTokenType,
  LlmProviderUsageMetricNames,
} from "../../../../Types/LlmObservability/LlmProviderUsageMetrics";
import ObjectID from "../../../../Types/ObjectID";

/*
 * A provider account's daily figures kept exactly in an append-only metric
 * table: every read writes only the difference between what the provider
 * now reports and what is stored, so reading a day again writes nothing,
 * a correction writes its difference, and a write that was lost or landed
 * twice is put right by the next read. The store here keeps the rows the
 * writer inserts and answers the stored-sums read the way the SQL groups
 * them.
 */

const PROJECT: ObjectID = new ObjectID("11111111-1111-4111-8111-111111111111");
const SERVICE: ObjectID = new ObjectID("22222222-2222-4222-8222-222222222222");
const CONNECTION: ObjectID = new ObjectID(
  "33333333-3333-4333-8333-333333333333",
);
const OTHER_CONNECTION: ObjectID = new ObjectID(
  "44444444-4444-4444-8444-444444444444",
);

const DAY_1: Date = new Date("2026-10-17T00:00:00Z");
const DAY_2: Date = new Date("2026-10-18T00:00:00Z");
const DAY_3: Date = new Date("2026-10-19T00:00:00Z");
const WINDOW: LlmUsageWindow = {
  startDay: DAY_1,
  endDay: new Date("2026-10-20T00:00:00Z"),
};
const NOW: Date = new Date("2026-10-19T15:00:00Z");

const TARGET: LlmProviderUsageWriteTarget = {
  projectId: PROJECT,
  connectionId: CONNECTION,
  connectionName: "OpenAI production",
  genAiProviderName: "openai",
  serviceId: SERVICE,
  serviceName: "OpenAI production",
  retentionInDays: 30,
  costIsEstimated: false,
  projectPriceOverrides: [],
};

function record(overrides: Partial<LlmUsageRecord> = {}): LlmUsageRecord {
  return {
    day: DAY_2,
    model: "gpt-4o",
    person: "ana@example.com",
    project: "Web",
    apiKey: "web-prod",
    inputTokens: 1000,
    outputTokens: 200,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    requests: 12,
    costUsd: 0.5,
    ...overrides,
  };
}

function parseClickhouseTime(value: unknown): Date {
  return new Date(`${String(value).replace(" ", "T")}Z`);
}

/*
 * The Metric table as far as the writer sees it: rows appended, and the
 * stored-sums read answered by grouping them by day, metric and series
 * attributes, for one project, service, connection and window.
 */
class FakeMetricStore {
  public rows: Array<JSONObject> = [];
  public statements: Array<Statement> = [];
  public inserts: number = 0;
  public dropNextInsert: boolean = false;
  public duplicateNextInsert: boolean = false;
  public window: LlmUsageWindow = WINDOW;
  public connectionId: ObjectID = CONNECTION;

  public install(): void {
    jest.spyOn(MetricService, "executeQuery").mockImplementation((async (
      statement: Statement,
    ) => {
      this.statements.push(statement);
      const data: Array<JSONObject> = this.storedSums();
      return {
        json: async () => {
          return { data };
        },
      };
    }) as never);

    jest.spyOn(MetricService, "insertJsonRows").mockImplementation((async (
      rows: Array<JSONObject>,
    ) => {
      this.inserts++;

      if (this.dropNextInsert) {
        this.dropNextInsert = false;
        return;
      }

      this.rows.push(...rows);

      if (this.duplicateNextInsert) {
        this.duplicateNextInsert = false;
        this.rows.push(...rows);
      }
    }) as never);
  }

  private storedSums(): Array<JSONObject> {
    const groups: Map<string, JSONObject> = new Map();

    for (const row of this.rows) {
      const attributes: Dictionary<string> = row[
        "attributes"
      ] as Dictionary<string>;
      const time: Date = parseClickhouseTime(row["time"]);

      if (
        row["projectId"] !== PROJECT.toString() ||
        row["primaryEntityId"] !== SERVICE.toString() ||
        !LlmProviderUsageMetricNames.includes(row["name"] as string) ||
        attributes[LLM_CONNECTION_ID_ATTRIBUTE] !==
          this.connectionId.toString() ||
        time.getTime() < this.window.startDay.getTime() ||
        time.getTime() >= this.window.endDay.getTime()
      ) {
        continue;
      }

      const values: Array<string> = LlmProviderSeriesAttributeKeys.map(
        (key: string) => {
          return attributes[key] || "";
        },
      );
      const key: string = JSON.stringify([
        time.getTime(),
        row["name"],
        ...values,
      ]);
      const group: JSONObject = groups.get(key) || {
        daySeconds: String(time.getTime() / 1000),
        metricName: row["name"] as string,
        total: 0,
        ...Object.fromEntries(
          values.map((value: string, index: number) => {
            return [`attribute${index}`, value];
          }),
        ),
      };
      group["total"] = (group["total"] as number) + (row["value"] as number);
      groups.set(key, group);
    }

    return Array.from(groups.values());
  }

  // The day's sum of one metric for one series, as a chart would add it up.
  public sumOf(data: {
    day: Date;
    metricName: string;
    tokenType?: LlmProviderTokenType;
    person?: string;
  }): number {
    return this.rows
      .filter((row: JSONObject) => {
        const attributes: Dictionary<string> = row[
          "attributes"
        ] as Dictionary<string>;
        return (
          row["name"] === data.metricName &&
          parseClickhouseTime(row["time"]).getTime() === data.day.getTime() &&
          (!data.tokenType ||
            attributes[LLM_PROVIDER_TOKEN_TYPE_ATTRIBUTE] === data.tokenType) &&
          (!data.person ||
            attributes[LLM_PROVIDER_PERSON_ATTRIBUTE] === data.person)
        );
      })
      .reduce((sum: number, row: JSONObject) => {
        return sum + (row["value"] as number);
      }, 0);
  }
}

let store: FakeMetricStore;
let registration: jest.SpiedFunction<
  typeof TelemetryUtil.indexMetricNameServiceNameMap
>;

beforeEach(() => {
  store = new FakeMetricStore();
  store.install();
  registration = jest
    .spyOn(TelemetryUtil, "indexMetricNameServiceNameMap")
    .mockResolvedValue(undefined);
});

afterEach(() => {
  jest.restoreAllMocks();
});

async function write(
  records: Array<LlmUsageRecord>,
  target: LlmProviderUsageWriteTarget = TARGET,
): Promise<LlmProviderUsageWriteResult> {
  return await LlmProviderUsageWriter.write({
    target,
    window: WINDOW,
    records,
    now: NOW,
  });
}

function point(
  metricName: string,
  value: number,
  attributes: Dictionary<string> = {},
  day: Date = DAY_2,
): LlmProviderSeriesPoint {
  return {
    day,
    metricName,
    attributes: {
      [LLM_PROVIDER_MODEL_ATTRIBUTE]: "gpt-4o",
      [LLM_PROVIDER_PERSON_ATTRIBUTE]: "",
      [LLM_PROVIDER_PROJECT_ATTRIBUTE]: "",
      [LLM_PROVIDER_API_KEY_ATTRIBUTE]: "",
      [LLM_PROVIDER_TOKEN_TYPE_ATTRIBUTE]: "",
      [LLM_PROVIDER_COST_ESTIMATED_ATTRIBUTE]: "",
      ...attributes,
    },
    value,
  };
}

describe("LlmProviderUsageWriter.toSeriesPoints", () => {
  test("a record is tokens by type, requests and the provider's cost", () => {
    const points: Array<LlmProviderSeriesPoint> =
      LlmProviderUsageWriter.toSeriesPoints({
        records: [record({ cacheReadTokens: 400, cacheWriteTokens: 50 })],
        costIsEstimated: false,
        projectPriceOverrides: [],
      });

    const summary: Array<[string, string, number]> = points.map(
      (entry: LlmProviderSeriesPoint): [string, string, number] => {
        return [
          entry.metricName,
          entry.attributes[LLM_PROVIDER_TOKEN_TYPE_ATTRIBUTE] ||
            entry.attributes[LLM_PROVIDER_COST_ESTIMATED_ATTRIBUTE] ||
            "",
          entry.value,
        ];
      },
    );

    expect(summary).toEqual([
      [LLM_PROVIDER_TOKENS_METRIC_NAME, "input", 1000],
      [LLM_PROVIDER_TOKENS_METRIC_NAME, "output", 200],
      [LLM_PROVIDER_TOKENS_METRIC_NAME, "cache_read", 400],
      [LLM_PROVIDER_TOKENS_METRIC_NAME, "cache_write", 50],
      [LLM_PROVIDER_REQUESTS_METRIC_NAME, "", 12],
      [LLM_PROVIDER_COST_METRIC_NAME, "false", 0.5],
    ]);
    expect(points[0]!.attributes).toMatchObject({
      [LLM_PROVIDER_MODEL_ATTRIBUTE]: "gpt-4o",
      [LLM_PROVIDER_PERSON_ATTRIBUTE]: "ana@example.com",
      [LLM_PROVIDER_PROJECT_ATTRIBUTE]: "Web",
      [LLM_PROVIDER_API_KEY_ATTRIBUTE]: "web-prod",
    });
  });

  test("a provider that reports no money gets an estimate, marked as one", () => {
    const points: Array<LlmProviderSeriesPoint> =
      LlmProviderUsageWriter.toSeriesPoints({
        records: [
          record({
            model: "gpt-4o",
            inputTokens: 1_000_000,
            outputTokens: 0,
            costUsd: null,
          }),
          record({ model: "no-such-model", costUsd: null, person: "bob" }),
        ],
        costIsEstimated: true,
        projectPriceOverrides: [],
      });

    const costs: Array<LlmProviderSeriesPoint> = points.filter(
      (entry: LlmProviderSeriesPoint) => {
        return entry.metricName === LLM_PROVIDER_COST_METRIC_NAME;
      },
    );

    // gpt-4o at $2.50 per million input tokens; the unknown model has no estimate.
    expect(costs).toHaveLength(1);
    expect(costs[0]!.value).toBe(2.5);
    expect(costs[0]!.attributes[LLM_PROVIDER_COST_ESTIMATED_ATTRIBUTE]).toBe(
      "true",
    );
  });

  test("no cost is made up for a provider that reports money", () => {
    const points: Array<LlmProviderSeriesPoint> =
      LlmProviderUsageWriter.toSeriesPoints({
        records: [record({ costUsd: null, requests: null })],
        costIsEstimated: false,
        projectPriceOverrides: [],
      });

    expect(
      points.map((entry: LlmProviderSeriesPoint) => {
        return entry.metricName;
      }),
    ).toEqual([
      LLM_PROVIDER_TOKENS_METRIC_NAME,
      LLM_PROVIDER_TOKENS_METRIC_NAME,
    ]);
  });

  test("records of the same series add up; zeros make no point", () => {
    const points: Array<LlmProviderSeriesPoint> =
      LlmProviderUsageWriter.toSeriesPoints({
        records: [
          record({ outputTokens: 0, requests: 0, costUsd: 0 }),
          record({
            outputTokens: 0,
            requests: 0,
            costUsd: 0,
            inputTokens: 500,
          }),
        ],
        costIsEstimated: false,
        projectPriceOverrides: [],
      });

    expect(points).toHaveLength(1);
    expect(points[0]!.value).toBe(1500);
  });
});

describe("LlmProviderUsageWriter.computeDeltas", () => {
  const tokens: (value: number, day?: Date) => LlmProviderSeriesPoint = (
    value: number,
    day: Date = DAY_2,
  ): LlmProviderSeriesPoint => {
    return point(
      LLM_PROVIDER_TOKENS_METRIC_NAME,
      value,
      { [LLM_PROVIDER_TOKEN_TYPE_ATTRIBUTE]: "input" },
      day,
    );
  };

  function deltas(
    desired: Array<LlmProviderSeriesPoint>,
    stored: Array<LlmProviderSeriesPoint>,
  ): Array<number> {
    return LlmProviderUsageWriter.computeDeltas({
      desired,
      stored,
      window: WINDOW,
    }).map((entry: LlmProviderSeriesPoint) => {
      return entry.value;
    });
  }

  test("nothing stored: the figures as they are", () => {
    expect(deltas([tokens(100)], [])).toEqual([100]);
  });

  test("the same figure as stored: nothing", () => {
    expect(deltas([tokens(100)], [tokens(60), tokens(40)])).toEqual([]);
  });

  test("a figure that grew or shrank: the difference", () => {
    expect(deltas([tokens(150)], [tokens(100)])).toEqual([50]);
    expect(deltas([tokens(70)], [tokens(100)])).toEqual([-30]);
  });

  test("a series the provider no longer reports in the window is cancelled", () => {
    expect(deltas([], [tokens(100)])).toEqual([-100]);
  });

  test("days outside the window are never touched", () => {
    const before: Date = new Date("2026-10-10T00:00:00Z");
    expect(deltas([tokens(5, before)], [tokens(100, before)])).toEqual([]);
  });

  test("float noise is not usage", () => {
    expect(deltas([tokens(100.4)], [tokens(100)])).toEqual([]);
    expect(
      deltas(
        [point(LLM_PROVIDER_COST_METRIC_NAME, 0.3000000001)],
        [
          point(LLM_PROVIDER_COST_METRIC_NAME, 0.1),
          point(LLM_PROVIDER_COST_METRIC_NAME, 0.2),
        ],
      ),
    ).toEqual([]);
    expect(
      deltas(
        [point(LLM_PROVIDER_COST_METRIC_NAME, 0.30001)],
        [point(LLM_PROVIDER_COST_METRIC_NAME, 0.3)],
      ),
    ).toHaveLength(1);
  });
});

describe("LlmProviderUsageWriter SQL and rows", () => {
  test("the stored sums are read for one project, service, connection and window, with every value a parameter", () => {
    const statement: Statement =
      LlmProviderUsageWriter.buildStoredSumsStatement({
        projectId: PROJECT,
        serviceId: SERVICE,
        connectionId: CONNECTION,
        window: WINDOW,
      });

    expect(statement.query).toContain(`FROM ${AnalyticsTableName.Metric}`);
    expect(statement.query).toContain("GROUP BY daySeconds, metricName");
    expect(statement.query).toContain("sum(value) AS total");

    for (const id of [PROJECT, SERVICE, CONNECTION]) {
      expect(statement.query).not.toContain(id.toString());
    }

    const values: Array<unknown> = Object.values(statement.query_params);
    expect(values).toEqual(
      expect.arrayContaining([
        PROJECT.toString(),
        SERVICE.toString(),
        CONNECTION.toString(),
        LLM_CONNECTION_ID_ATTRIBUTE,
        LlmProviderUsageMetricNames,
        ...LlmProviderSeriesAttributeKeys,
      ]),
    );
  });

  test("stored sums are read back as points; anything else is left out", () => {
    const points: Array<LlmProviderSeriesPoint> =
      LlmProviderUsageWriter.readStoredSums([
        {
          daySeconds: String(DAY_2.getTime() / 1000),
          metricName: LLM_PROVIDER_TOKENS_METRIC_NAME,
          attribute0: "gpt-4o",
          attribute1: "ana@example.com",
          attribute2: "Web",
          attribute3: "web-prod",
          attribute4: "input",
          attribute5: "",
          total: 1000,
        },
        {
          daySeconds: "x",
          metricName: LLM_PROVIDER_TOKENS_METRIC_NAME,
          total: 5,
        },
        { daySeconds: "1", metricName: "http.server.duration", total: 5 },
      ]);

    expect(points).toEqual([
      {
        day: DAY_2,
        metricName: LLM_PROVIDER_TOKENS_METRIC_NAME,
        attributes: {
          [LLM_PROVIDER_MODEL_ATTRIBUTE]: "gpt-4o",
          [LLM_PROVIDER_PERSON_ATTRIBUTE]: "ana@example.com",
          [LLM_PROVIDER_PROJECT_ATTRIBUTE]: "Web",
          [LLM_PROVIDER_API_KEY_ATTRIBUTE]: "web-prod",
          [LLM_PROVIDER_TOKEN_TYPE_ATTRIBUTE]: "input",
          [LLM_PROVIDER_COST_ESTIMATED_ATTRIBUTE]: "",
        },
        value: 1000,
      },
    ]);
  });

  test("a row is a delta Sum point of the connection's service at the start of its day", () => {
    const rows: Array<JSONObject> = LlmProviderUsageWriter.buildRows({
      target: TARGET,
      deltas: [
        point(LLM_PROVIDER_TOKENS_METRIC_NAME, -25, {
          [LLM_PROVIDER_TOKEN_TYPE_ATTRIBUTE]: "output",
          [LLM_PROVIDER_PERSON_ATTRIBUTE]: "ana@example.com",
        }),
      ],
      now: NOW,
    });

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      projectId: PROJECT.toString(),
      primaryEntityId: SERVICE.toString(),
      name: LLM_PROVIDER_TOKENS_METRIC_NAME,
      time: "2026-10-18 00:00:00",
      startTime: "2026-10-18 00:00:00",
      timeUnixNano: String(DAY_2.getTime() * 1_000_000),
      metricPointType: "Sum",
      aggregationTemporality: "Delta",
      isMonotonic: false,
      value: -25,
      retentionDate: "2026-11-18 15:00:00",
    });
    // Empty series attributes are left out; the connection is always named.
    expect(rows[0]!["attributes"]).toEqual({
      [LLM_CONNECTION_ID_ATTRIBUTE]: CONNECTION.toString(),
      [LLM_CONNECTION_NAME_ATTRIBUTE]: "OpenAI production",
      [LLM_PROVIDER_NAME_ATTRIBUTE]: "openai",
      [LLM_PROVIDER_MODEL_ATTRIBUTE]: "gpt-4o",
      [LLM_PROVIDER_PERSON_ATTRIBUTE]: "ana@example.com",
      [LLM_PROVIDER_TOKEN_TYPE_ATTRIBUTE]: "output",
    });
    expect(rows[0]!["attributeKeys"]).toEqual(
      Object.keys(rows[0]!["attributes"] as JSONObject).sort(),
    );
    expect((rows[0]!["entityKeys"] as Array<string>).length).toBe(1);
    expect(rows[0]!["serviceEntityKey"]).toBe(
      (rows[0]!["entityKeys"] as Array<string>)[0],
    );
  });
});

describe("LlmProviderUsageWriter.write keeps storage equal to the provider", () => {
  test("the first read writes every figure; reading the same again writes nothing", async () => {
    const records: Array<LlmUsageRecord> = [
      record({ day: DAY_1 }),
      record({ day: DAY_2, person: "bob@example.com", costUsd: 1.25 }),
    ];

    const first: LlmProviderUsageWriteResult = await write(records);
    expect(first.pointsWritten).toBe(8);
    expect(first).toMatchObject({
      seriesCount: 8,
      inputTokens: 2000,
      outputTokens: 400,
      requests: 24,
      costUsd: 1.75,
      daysWithUsage: 2,
    });

    const again: LlmProviderUsageWriteResult = await write(records);
    expect(again.pointsWritten).toBe(0);
    expect(store.inserts).toBe(1);
    // Acknowledged once flushed, so the next read finds them.
    expect(
      (MetricService.insertJsonRows as unknown as jest.Mock).mock.calls[0]![1],
    ).toEqual({ clickhouseSettings: { wait_for_async_insert: 1 } });
    expect(
      store.sumOf({ day: DAY_2, metricName: LLM_PROVIDER_COST_METRIC_NAME }),
    ).toBe(1.25);
  });

  test("a day the provider corrects is written as the difference", async () => {
    await write([record({ outputTokens: 200, costUsd: 0.5 })]);
    await write([record({ outputTokens: 260, costUsd: 0.75 })]);
    await write([record({ outputTokens: 240, costUsd: 0.7 })]);

    expect(
      store.sumOf({
        day: DAY_2,
        metricName: LLM_PROVIDER_TOKENS_METRIC_NAME,
        tokenType: LlmProviderTokenType.Output,
      }),
    ).toBe(240);
    expect(
      store.sumOf({ day: DAY_2, metricName: LLM_PROVIDER_COST_METRIC_NAME }),
    ).toBeCloseTo(0.7, 10);
  });

  test("a write that was lost is written again by the next read", async () => {
    store.dropNextInsert = true;
    await write([record()]);
    expect(store.rows).toHaveLength(0);

    await write([record()]);
    expect(
      store.sumOf({
        day: DAY_2,
        metricName: LLM_PROVIDER_REQUESTS_METRIC_NAME,
      }),
    ).toBe(12);
  });

  test("a write that landed twice is taken back by the next read", async () => {
    store.duplicateNextInsert = true;
    await write([record()]);
    expect(
      store.sumOf({
        day: DAY_2,
        metricName: LLM_PROVIDER_REQUESTS_METRIC_NAME,
      }),
    ).toBe(24);

    const healed: LlmProviderUsageWriteResult = await write([record()]);
    expect(healed.pointsWritten).toBe(4);
    expect(
      store.sumOf({
        day: DAY_2,
        metricName: LLM_PROVIDER_REQUESTS_METRIC_NAME,
      }),
    ).toBe(12);
    expect(
      store.sumOf({ day: DAY_2, metricName: LLM_PROVIDER_COST_METRIC_NAME }),
    ).toBe(0.5);
  });

  test("someone the provider stops naming for a day is cancelled for that day only", async () => {
    await write([record({ person: "ana" }), record({ person: "bob" })]);
    await write([record({ person: "ana" })]);

    expect(
      store.sumOf({
        day: DAY_2,
        metricName: LLM_PROVIDER_REQUESTS_METRIC_NAME,
        person: "bob",
      }),
    ).toBe(0);
    expect(
      store.sumOf({
        day: DAY_2,
        metricName: LLM_PROVIDER_REQUESTS_METRIC_NAME,
        person: "ana",
      }),
    ).toBe(12);
  });

  test("another connection's figures in the same service are never counted or changed", async () => {
    await write([record()], { ...TARGET, connectionId: OTHER_CONNECTION });
    const rowsOfOther: number = store.rows.length;

    store.connectionId = CONNECTION;
    const ours: LlmProviderUsageWriteResult = await write([record()]);

    expect(ours.pointsWritten).toBe(4);
    expect(store.rows).toHaveLength(rowsOfOther + 4);
  });

  test("the metric names are registered, and a registration failure never fails a read", async () => {
    registration.mockRejectedValueOnce(new Error("postgres is down"));

    await expect(write([record({ day: DAY_3 })])).resolves.toMatchObject({
      pointsWritten: 4,
    });

    const call: { metricNameServiceNameMap: JSONObject } = registration.mock
      .calls[0]![0] as unknown as { metricNameServiceNameMap: JSONObject };
    expect(Object.keys(call.metricNameServiceNameMap).sort()).toEqual(
      [...LlmProviderUsageMetricNames].sort(),
    );
  });
});
