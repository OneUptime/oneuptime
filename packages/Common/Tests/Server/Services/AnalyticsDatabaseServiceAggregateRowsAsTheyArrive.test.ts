import AnalyticsDatabaseService from "../../../Server/Services/AnalyticsDatabaseService";
import logger from "../../../Server/Utils/Logger";
import EventLoop from "../../../Server/Utils/EventLoop";
import "../TestingUtils/Init";
import AnalyticsBaseModel from "../../../Models/AnalyticsModels/AnalyticsBaseModel/AnalyticsBaseModel";
import Route from "../../../Types/API/Route";
import AnalyticsTableEngine from "../../../Types/AnalyticsDatabase/AnalyticsTableEngine";
import AnalyticsTableColumn from "../../../Types/AnalyticsDatabase/TableColumn";
import TableColumnType from "../../../Types/AnalyticsDatabase/TableColumnType";
import AggregatedResult from "../../../Types/BaseDatabase/AggregatedResult";
import AggregationType from "../../../Types/BaseDatabase/AggregationType";
import GenericObject from "../../../Types/GenericObject";
import ObjectID from "../../../Types/ObjectID";
import QueryTimeoutException from "../../../Types/Exception/QueryTimeoutException";
import ServerException from "../../../Types/Exception/ServerException";
import { JSONObject } from "../../../Types/JSON";
import ModelPermission from "../../../Server/Types/AnalyticsDatabase/ModelPermission";
import { Statement } from "../../../Server/Utils/AnalyticsDatabase/Statement";
import AggregateBy from "../../../Server/Types/AnalyticsDatabase/AggregateBy";
import { SeededRandom, seededRandom } from "../../Helpers/SeededRandom";
import { ClickHouseError } from "@clickhouse/client";
import { Readable } from "stream";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * A GROUPED AGGREGATE'S ROWS, READ AS THEY ARRIVE (issue #10316).
 *
 * An aggregate grouped by attribute keys - a grouped Metrics monitor's read,
 * a row per series and bucket - used to come back as one FORMAT JSON
 * document, read whole as text and parsed in one JSON.parse. It is now read
 * as JSONCompactEachRowWithNames through the client's exec, row by row as
 * the bytes come in (ClickhouseReadResult.readRows). Every other aggregate
 * is read as before. These tests hold the two paths to the same answer:
 * the same rows, the same aggregated result - values read as numbers, rows
 * without a time left out, every group-by column kept, the Top-K count and
 * the truncation flag - the same request, and the same errors.
 */

class MetricLikeModel extends AnalyticsBaseModel {
  public constructor() {
    super({
      tableName: "MetricLike",
      singularName: "Metric",
      pluralName: "Metrics",
      tableColumns: [
        new AnalyticsTableColumn({
          key: "projectId",
          title: "Project",
          description: "The project",
          required: true,
          type: TableColumnType.ObjectID,
        }),
        new AnalyticsTableColumn({
          key: "time",
          title: "Time",
          description: "When",
          required: true,
          type: TableColumnType.DateTime64,
        }),
        new AnalyticsTableColumn({
          key: "value",
          title: "Value",
          description: "A number",
          required: false,
          type: TableColumnType.Number,
        }),
        new AnalyticsTableColumn({
          key: "name",
          title: "Name",
          description: "The metric",
          required: false,
          type: TableColumnType.Text,
        }),
        new AnalyticsTableColumn({
          key: "attributes",
          title: "Attributes",
          description: "Its labels",
          required: false,
          type: TableColumnType.JSON,
        }),
      ],
      crudApiPath: new Route("metric-like"),
      primaryKeys: ["projectId", "time"],
      sortKeys: ["projectId", "time"],
      partitionKey: "projectId",
      tableEngine: AnalyticsTableEngine.MergeTree,
    });
  }
}

const PROJECT_ID: ObjectID = new ObjectID(
  "a0000000-0000-4000-8000-000000010316",
);

const COLUMNS: Array<string> = [
  "value",
  "time",
  "name",
  "attributes",
  "__total_groups",
];

// The statement MetricService builds, with its 45-second limit.
function groupedStatement(): Statement {
  return new Statement(
    [
      "SELECT max(value) AS value, time, name, attributes, 7 AS __total_groups FROM MetricLike WHERE projectId = ",
      " GROUP BY time, name, attributes SETTINGS max_execution_time = 45, timeout_overflow_mode = 'throw'",
    ],
    [{ value: PROJECT_ID, type: TableColumnType.ObjectID }],
  );
}

// An answer's rows: values as numbers, as text, missing; some without time.
function answerRows(
  count: number,
  random: SeededRandom,
): Array<Array<unknown>> {
  const rows: Array<Array<unknown>> = [];

  for (let index: number = 0; index < count; index++) {
    const pick: number = random(8);
    rows.push([
      pick === 0 ? String(index / 4) : pick === 1 ? null : index / 4,
      pick === 2
        ? null
        : `2026-11-17 10:${String(index % 60).padStart(2, "0")}:00.000000000`,
      `metric-${index % 3}`,
      {
        "resource.host.name": `host-${index % 97}`,
        "resource.container.name": `container-${index} é→😀`,
      },
      "7",
    ]);
  }

  return rows;
}

function jsonBody(rows: Array<Array<unknown>>): string {
  return JSON.stringify({
    meta: COLUMNS.map((name: string) => {
      return { name: name, type: "String" };
    }),
    data: rows.map((row: Array<unknown>): JSONObject => {
      const item: JSONObject = {};
      COLUMNS.forEach((column: string, index: number) => {
        item[column] = row[index] as JSONObject[string];
      });
      return item;
    }),
    rows: rows.length,
  });
}

function eachRowBody(rows: Array<Array<unknown>>): string {
  return [COLUMNS, ...rows]
    .map((line: Array<unknown>): string => {
      return `${JSON.stringify(line)}\n`;
    })
    .join("");
}

// A body's bytes in chunks of drawn sizes, inside characters too.
function chunksOf(text: string, random: SeededRandom): Array<Buffer> {
  const bytes: Buffer = Buffer.from(text, "utf8");
  const chunks: Array<Buffer> = [];
  let offset: number = 0;

  while (offset < bytes.length) {
    const size: number = 1 + random(20_000);
    chunks.push(bytes.subarray(offset, offset + size));
    offset += size;
  }

  return chunks;
}

interface SentRead {
  how: "query" | "exec";
  query: string;
  format?: unknown;
  query_params?: unknown;
  clickhouse_settings?: unknown;
}

let service: AnalyticsDatabaseService<MetricLikeModel>;
let sent: Array<SentRead>;
let rows: Array<Array<unknown>>;
let execFailure: unknown;
let queryFailure: unknown;

beforeEach(() => {
  service = new AnalyticsDatabaseService({ modelType: MetricLikeModel });
  sent = [];
  rows = answerRows(3_000, seededRandom(10316));
  execFailure = undefined;
  queryFailure = undefined;

  const random: SeededRandom = seededRandom(7);

  (service as unknown as { databaseClient: unknown }).databaseClient = {
    query: async (params: SentRead): Promise<unknown> => {
      sent.push({ ...params, how: "query" });

      if (queryFailure) {
        throw queryFailure;
      }

      const body: string = jsonBody(rows);
      return {
        query_id: "query-10316",
        response_headers: {},
        json: async (): Promise<unknown> => {
          return JSON.parse(body);
        },
        text: async (): Promise<string> => {
          return body;
        },
      };
    },
    exec: async (params: SentRead): Promise<unknown> => {
      sent.push({ ...params, how: "exec" });

      if (execFailure) {
        throw execFailure;
      }

      return {
        query_id: "exec-10316",
        response_headers: {},
        stream: Readable.from(chunksOf(eachRowBody(rows), random)),
      };
    },
  };

  // The grouped statement MetricService would build: the base builds none.
  jest
    .spyOn(service, "toAggregateStatement")
    .mockImplementation(
      (): { statement: Statement; columns: Array<string> } => {
        return { statement: groupedStatement(), columns: COLUMNS };
      },
    );

  jest
    .spyOn(ModelPermission, "checkReadPermission")
    .mockImplementation((_modelType: unknown, query: unknown) => {
      return Promise.resolve({ query, select: null } as never);
    });
  jest.spyOn(logger, "debug").mockImplementation(() => {
    return undefined!;
  });
});

afterEach(() => {
  jest.restoreAllMocks();
});

function aggregateBy(
  overrides: Partial<AggregateBy<MetricLikeModel>> = {},
): AggregateBy<MetricLikeModel> {
  return {
    query: { projectId: PROJECT_ID } as GenericObject,
    aggregationType: AggregationType.Max,
    aggregateColumnName: "value" as keyof MetricLikeModel,
    aggregationTimestampColumnName: "time" as keyof MetricLikeModel,
    startTimestamp: new Date("2026-11-17T10:00:00.000Z"),
    endTimestamp: new Date("2026-11-17T11:00:00.000Z"),
    groupBy: { name: true } as AggregateBy<MetricLikeModel>["groupBy"],
    groupByAttributeKeys: ["resource.host.name", "resource.container.name"],
    limit: 50_000,
    skip: 0,
    props: { isRoot: true },
    ...overrides,
  } as AggregateBy<MetricLikeModel>;
}

// The same read, through FORMAT JSON: what every grouped read was before.
async function asOneDocument(
  request: AggregateBy<MetricLikeModel>,
): Promise<AggregatedResult> {
  const spy: ReturnType<typeof jest.spyOn> = jest
    .spyOn(
      service as unknown as {
        readsAggregateRowsAsTheyArrive: () => boolean;
      },
      "readsAggregateRowsAsTheyArrive",
    )
    .mockReturnValue(false);

  try {
    return await service.aggregateBy(request);
  } finally {
    spy.mockRestore();
  }
}

async function failureOf(work: () => Promise<unknown>): Promise<unknown> {
  try {
    await work();
  } catch (error) {
    return error;
  }

  throw new Error("Expected the read to fail, and it succeeded.");
}

describe("AnalyticsDatabaseService.aggregateBy grouped by attribute keys", () => {
  test("reads its rows as they arrive: through exec, as JSONCompactEachRowWithNames", async () => {
    await service.aggregateBy(aggregateBy());

    expect(sent).toHaveLength(1);
    expect(sent[0]!.how).toBe("exec");
    expect(sent[0]!.query).toBe(
      `${groupedStatement().query}\nFORMAT JSONCompactEachRowWithNames`,
    );
  });

  test("is sent as executeQuery sends a read: the same parameters and settings", async () => {
    await service.aggregateBy(aggregateBy());
    await asOneDocument(aggregateBy());

    const [streamed, whole] = sent as [SentRead, SentRead];

    expect(whole.how).toBe("query");
    expect(whole.format).toBe("JSON");
    expect(streamed.query_params).toEqual(whole.query_params);
    expect(streamed.query_params).toEqual(groupedStatement().query_params);
    // A read with a time limit waits for the end of its query, both ways.
    expect(streamed.clickhouse_settings).toEqual(whole.clickhouse_settings);
    expect(streamed.clickhouse_settings).toEqual({ http_wait_end_of_query: 1 });
  });

  test("aggregates exactly what the same read as one FORMAT JSON document did", async () => {
    const streamed: AggregatedResult = await service.aggregateBy(aggregateBy());
    const whole: AggregatedResult = await asOneDocument(aggregateBy());

    expect(streamed).toEqual(whole);
    // Rows without a time are left out; every other one is kept.
    expect(streamed.data.length).toBe(
      rows.filter((row: Array<unknown>): boolean => {
        return Boolean(row[1]);
      }).length,
    );
    expect(streamed.totalGroups).toBe(7);
    expect(streamed.truncated).toBe(false);
    // A value ClickHouse wrote as text is read as a number, as before.
    expect(
      streamed.data.every((row: GenericObject): boolean => {
        return row["value"] === null || typeof row["value"] === "number";
      }),
    ).toBe(true);
    expect(streamed.data[0]!["attributes"]).toEqual(rows[0]![3]);
    expect(streamed.data[0]!["name"]).toBe("metric-0");
  });

  test("a read that fills its limit is flagged truncated, as before", async () => {
    const request: AggregateBy<MetricLikeModel> = aggregateBy({
      limit: rows.length,
    });
    const streamed: AggregatedResult = await service.aggregateBy(request);

    expect(streamed.truncated).toBe(true);
    expect(streamed).toEqual(
      await asOneDocument(aggregateBy({ limit: rows.length })),
    );
  });

  test("no rows, and one row: the same as before", async () => {
    for (const answer of [[], answerRows(1, seededRandom(3))]) {
      rows = answer;

      const streamed: AggregatedResult =
        await service.aggregateBy(aggregateBy());

      expect(streamed).toEqual(await asOneDocument(aggregateBy()));
    }

    rows = [];
    expect(await service.aggregateBy(aggregateBy())).toEqual({
      data: [],
      truncated: false,
    });
  });

  test("a stop at the time limit is the QueryTimeoutException it was", async () => {
    const timedOut: ClickHouseError = new ClickHouseError({
      code: "159",
      type: "TIMEOUT_EXCEEDED",
      message:
        "Code: 159. DB::Exception: Timeout exceeded: elapsed 45001 ms, maximum: 45000 ms. (TIMEOUT_EXCEEDED)",
    });
    execFailure = timedOut;
    queryFailure = timedOut;

    const streamed: unknown = await failureOf(() => {
      return service.aggregateBy(aggregateBy());
    });
    const whole: unknown = await failureOf(() => {
      return asOneDocument(aggregateBy());
    });

    expect(streamed).toBeInstanceOf(QueryTimeoutException);
    expect((streamed as Error).message).toBe((whole as Error).message);
    expect((streamed as Error).message).toBe(
      "This query took longer than 45 seconds and was stopped before it finished. Try a shorter time range or more specific filters.",
    );
  });

  test("an answer cut off part way is never aggregated as if it were whole", async () => {
    const random: SeededRandom = seededRandom(9);
    (
      service as unknown as { databaseClient: { exec: unknown } }
    ).databaseClient.exec = async (): Promise<unknown> => {
      const body: string = eachRowBody(rows);
      return {
        query_id: "exec-cut",
        response_headers: {},
        // The answer up to the middle of a row.
        stream: Readable.from(
          chunksOf(body.substring(0, Math.floor(body.length / 2)), random),
        ),
      };
    };

    const error: unknown = await failureOf(() => {
      return service.aggregateBy(aggregateBy());
    });

    // The read has a time limit: an answer that ended early is its stop.
    expect(error).toBeInstanceOf(QueryTimeoutException);
    expect(error).not.toBeInstanceOf(ServerException);
  });

  test("hands the event loop back as the rows arrive", async () => {
    let now: number = 0;
    let handBacks: number = 0;

    jest.spyOn(EventLoop, "now").mockImplementation((): number => {
      now += 0.5;
      return now;
    });
    jest
      .spyOn(EventLoop, "yieldToEventLoop")
      .mockImplementation(async (): Promise<void> => {
        handBacks++;
      });

    const result: AggregatedResult = await service.aggregateBy(aggregateBy());

    expect(result.data.length).toBeGreaterThan(2_000);
    expect(handBacks).toBeGreaterThanOrEqual(30);
  });
});

describe("AnalyticsDatabaseService.aggregateBy of every other kind is read as before", () => {
  test("an aggregate with no attribute keys is one FORMAT JSON document, through query", async () => {
    const result: AggregatedResult = await service.aggregateBy(
      aggregateBy({ groupByAttributeKeys: undefined }),
    );

    expect(
      sent.map((read: SentRead) => {
        return read.how;
      }),
    ).toEqual(["query"]);
    expect(sent[0]!.format).toBe("JSON");
    expect(result.data.length).toBeGreaterThan(2_000);
  });

  test("an empty list of attribute keys is no grouping by them", async () => {
    await service.aggregateBy(aggregateBy({ groupByAttributeKeys: [] }));

    expect(
      sent.map((read: SentRead) => {
        return read.how;
      }),
    ).toEqual(["query"]);
  });
});
