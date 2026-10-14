import AnalyticsDatabaseService from "../../../Server/Services/AnalyticsDatabaseService";
import logger from "../../../Server/Utils/Logger";
import "../TestingUtils/Init";
import { Statement } from "../../../Server/Utils/AnalyticsDatabase/Statement";
import AnalyticsBaseModel from "../../../Models/AnalyticsModels/AnalyticsBaseModel/AnalyticsBaseModel";
import Route from "../../../Types/API/Route";
import AnalyticsTableEngine from "../../../Types/AnalyticsDatabase/AnalyticsTableEngine";
import AnalyticsTableColumn from "../../../Types/AnalyticsDatabase/TableColumn";
import TableColumnType from "../../../Types/AnalyticsDatabase/TableColumnType";
import AggregationType from "../../../Types/BaseDatabase/AggregationType";
import QueryTimeoutException from "../../../Types/Exception/QueryTimeoutException";
import PositiveNumber from "../../../Types/PositiveNumber";
import ObjectID from "../../../Types/ObjectID";
import GenericObject from "../../../Types/GenericObject";
import ModelPermission from "../../../Server/Types/AnalyticsDatabase/ModelPermission";
import { ClickHouseError } from "@clickhouse/client";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * executeQuery and the reads built on it, when ClickHouse stops a read at
 * its time limit (issue #4707).
 *
 * The service is driven over a stand-in for the ClickHouse client that
 * answers the way a real server does (captured on 26.7; the real-server
 * proof is App's LogSearchTimeLimitClickhouse suite): an HTTP error before
 * the rows, an empty or cut-off body after a 200, an error block after the
 * rows. Whatever the shape, findBy, aggregateBy and an exact countBy reject
 * with the QueryTimeoutException the API answers 504 with — never a
 * SyntaxError, never an empty list — and the reads carry 'throw' and ask
 * ClickHouse to hold their answer until they are done.
 */

class LogLikeModel extends AnalyticsBaseModel {
  public constructor() {
    super({
      tableName: "LogLike",
      singularName: "Log",
      pluralName: "Logs",
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
          key: "body",
          title: "Body",
          description: "The log line",
          required: false,
          type: TableColumnType.Text,
        }),
        new AnalyticsTableColumn({
          key: "count",
          title: "Count",
          description: "A number",
          required: false,
          type: TableColumnType.Number,
        }),
      ],
      crudApiPath: new Route("log-like"),
      primaryKeys: ["projectId", "time"],
      sortKeys: ["projectId", "time"],
      partitionKey: "projectId",
      tableEngine: AnalyticsTableEngine.MergeTree,
    });
  }
}

const PROJECT_ID: ObjectID = new ObjectID(
  "a0000000-0000-4000-8000-000000004707",
);

const LIMIT_MESSAGE_45: string =
  "This query took longer than 45 seconds and was stopped before it finished. Try a shorter time range or more specific filters.";

const TIMEOUT_TEXT: string =
  "Code: 159. DB::Exception: Timeout exceeded: elapsed 45006.551 ms, maximum: 45000 ms. (TIMEOUT_EXCEEDED) (version 26.7.13.12 (official build))";

const TAG: string = "idcuincekuppkrhu";

interface QueryCall {
  query: string;
  clickhouse_settings?: Record<string, unknown>;
}

// What the stand-in client is asked to answer with next.
type Answer =
  | { kind: "body"; body: string; headers?: Record<string, string> }
  | { kind: "error"; error: unknown };

function timeoutBeforeRows(): ClickHouseError {
  return new ClickHouseError({
    message: TIMEOUT_TEXT,
    code: "159",
    type: "TIMEOUT_EXCEEDED",
  });
}

const STREAMED_ROWS: string =
  '{\n\t"meta": [{"name": "body", "type": "String"}],\n\n\t"data":\n\t[\n\t\t{\n\t\t\t"body": "a"\n\t\t}';

const ANSWERS_THAT_STOPPED: Array<[string, Answer]> = [
  [
    "an HTTP error before the rows (408, code 159)",
    { kind: "error", error: timeoutBeforeRows() },
  ],
  ["an empty body after a 200 ('break')", { kind: "body", body: "" }],
  ["a body cut off mid-row ('break')", { kind: "body", body: STREAMED_ROWS }],
  [
    "rows followed by 26.x's error block",
    {
      kind: "body",
      body: `${STREAMED_ROWS}\r\n__exception__\r\n${TAG}\r\n${TIMEOUT_TEXT}\n141 ${TAG}\r\n__exception__\r\n`,
      headers: { "x-clickhouse-exception-tag": TAG },
    },
  ],
  [
    "24.x's whole document carrying an exception member",
    {
      kind: "body",
      body: JSON.stringify({ data: [{ body: "a" }], exception: TIMEOUT_TEXT }),
    },
  ],
];

describe("AnalyticsDatabaseService when ClickHouse stops a read at its time limit", () => {
  let service: AnalyticsDatabaseService<LogLikeModel>;
  let calls: Array<QueryCall>;
  let nextAnswer: Answer;

  beforeEach(() => {
    service = new AnalyticsDatabaseService({ modelType: LogLikeModel });
    calls = [];
    nextAnswer = { kind: "body", body: '{"data": []}' };

    (service as unknown as { databaseClient: unknown }).databaseClient = {
      query: async (params: QueryCall): Promise<unknown> => {
        calls.push(params);

        if (nextAnswer.kind === "error") {
          throw nextAnswer.error;
        }

        const answer: { body: string; headers?: Record<string, string> } =
          nextAnswer;

        return {
          query_id: "query-4707",
          response_headers: answer.headers || {},
          json: async (): Promise<unknown> => {
            return JSON.parse(answer.body);
          },
          text: async (): Promise<string> => {
            return answer.body;
          },
        };
      },
    };

    jest
      .spyOn(ModelPermission, "checkReadPermission")
      .mockImplementation((_modelType: unknown, query: unknown) => {
        return Promise.resolve({ query, select: null } as never);
      });
    jest.spyOn(logger, "debug").mockImplementation(() => {
      return undefined!;
    });
    jest.spyOn(logger, "warn").mockImplementation(() => {
      return undefined!;
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  const findLogs: () => Promise<Array<LogLikeModel>> = (): Promise<
    Array<LogLikeModel>
  > => {
    return service.findBy({
      query: { projectId: PROJECT_ID } as GenericObject,
      select: { body: true } as GenericObject,
      skip: 0,
      limit: 100,
      props: { isRoot: true },
    });
  };

  async function captureError(work: () => Promise<unknown>): Promise<unknown> {
    try {
      await work();
    } catch (error) {
      return error;
    }

    throw new Error("Expected the read to fail, and it succeeded.");
  }

  describe("executeQuery", () => {
    test("a read with a time limit asks ClickHouse to hold its answer until it is done", async () => {
      await service.executeQuery(
        "SELECT 1 SETTINGS max_execution_time = 45, timeout_overflow_mode = 'throw'",
      );

      expect(calls[0]!.clickhouse_settings).toEqual({
        http_wait_end_of_query: 1,
      });
    });

    test("a read with no time limit streams as before", async () => {
      await service.executeQuery("SELECT 1");

      expect(calls[0]!.clickhouse_settings).toBeUndefined();
    });

    test("the caller's own settings win over the default", async () => {
      await service.executeQuery("SELECT 1 SETTINGS max_execution_time = 45", {
        clickhouseSettings: { http_wait_end_of_query: 0, max_threads: 2 },
      });

      expect(calls[0]!.clickhouse_settings).toEqual({
        http_wait_end_of_query: 0,
        max_threads: 2,
      });
    });

    test("names the statement's own limit in the message", async () => {
      nextAnswer = { kind: "error", error: timeoutBeforeRows() };

      const error: unknown = await captureError(() => {
        return service.executeQuery(
          "SELECT 1 SETTINGS max_execution_time = 30",
        );
      });

      expect(error).toBeInstanceOf(QueryTimeoutException);
      expect((error as QueryTimeoutException).message).toBe(
        "This query took longer than 30 seconds and was stopped before it finished. Try a shorter time range or more specific filters.",
      );
    });

    test("any other ClickHouse error is rethrown as it is", async () => {
      const syntax: ClickHouseError = new ClickHouseError({
        message: "Syntax error",
        code: "62",
        type: "SYNTAX_ERROR",
      });
      nextAnswer = { kind: "error", error: syntax };

      expect(
        await captureError(() => {
          return service.executeQuery(
            "SELECT 1 SETTINGS max_execution_time = 45",
          );
        }),
      ).toBe(syntax);
    });
  });

  describe("findBy — the explorers' lists", () => {
    test("asks ClickHouse to stop with an error, not to break off quietly", async () => {
      await findLogs();

      expect(calls[0]!.query).toContain("max_execution_time = 45");
      expect(calls[0]!.query).toContain("timeout_overflow_mode = 'throw'");
      expect(calls[0]!.query).not.toContain("timeout_overflow_mode = 'break'");
      expect(calls[0]!.clickhouse_settings).toEqual({
        http_wait_end_of_query: 1,
      });
    });

    test.each(ANSWERS_THAT_STOPPED)(
      "%s: rejects with the stop, never a SyntaxError or an empty list",
      async (_name: string, answer: Answer) => {
        nextAnswer = answer;

        const error: unknown = await captureError(() => {
          return findLogs();
        });

        expect(error).toBeInstanceOf(QueryTimeoutException);
        expect((error as QueryTimeoutException).code).toBe(504);
        expect((error as QueryTimeoutException).message).toBe(LIMIT_MESSAGE_45);
      },
    );

    test("a whole answer is read as before", async () => {
      nextAnswer = {
        kind: "body",
        body: JSON.stringify({ data: [{ body: "a" }, { body: "b" }] }),
      };

      const logs: Array<LogLikeModel> = await findLogs();

      expect(
        logs.map((log: LogLikeModel): unknown => {
          return log.getColumnValue("body");
        }),
      ).toEqual(["a", "b"]);
    });
  });

  describe("aggregateBy — the charts", () => {
    const aggregate: () => Promise<unknown> = (): Promise<unknown> => {
      return service.aggregateBy({
        query: { projectId: PROJECT_ID } as GenericObject,
        aggregationType: AggregationType.Sum,
        aggregateColumnName: "count" as keyof LogLikeModel,
        aggregationTimestampColumnName: "time" as keyof LogLikeModel,
        startTimestamp: new Date("2026-10-14T09:00:00.000Z"),
        endTimestamp: new Date("2026-10-14T10:00:00.000Z"),
        limit: 100,
        skip: 0,
        props: { isRoot: true },
      });
    };

    test("stops with 'throw' whatever the caller asked for", async () => {
      await aggregate();

      expect(calls[0]!.query).toContain("timeout_overflow_mode = 'throw'");

      await service.aggregateBy({
        query: { projectId: PROJECT_ID } as GenericObject,
        aggregationType: AggregationType.Sum,
        aggregateColumnName: "count" as keyof LogLikeModel,
        aggregationTimestampColumnName: "time" as keyof LogLikeModel,
        startTimestamp: new Date("2026-10-14T09:00:00.000Z"),
        endTimestamp: new Date("2026-10-14T10:00:00.000Z"),
        limit: 100,
        skip: 0,
        timeoutOverflowMode: "break",
        props: { isRoot: true },
      });

      expect(calls[1]!.query).toContain("timeout_overflow_mode = 'throw'");
      expect(calls[1]!.query).not.toContain("'break'");
    });

    test.each(ANSWERS_THAT_STOPPED)(
      "%s: rejects with the stop rather than chart nothing",
      async (_name: string, answer: Answer) => {
        nextAnswer = answer;

        const error: unknown = await captureError(() => {
          return aggregate();
        });

        expect(error).toBeInstanceOf(QueryTimeoutException);
        expect((error as QueryTimeoutException).message).toBe(LIMIT_MESSAGE_45);
      },
    );
  });

  describe("countBy", () => {
    const count: (exact?: boolean) => Promise<number> = async (
      exact?: boolean,
    ): Promise<number> => {
      const result: PositiveNumber = await service.countBy({
        query: { projectId: PROJECT_ID } as GenericObject,
        props: { isRoot: true },
        exact,
      });

      return result.toNumber();
    };

    test.each(ANSWERS_THAT_STOPPED)(
      "an exact count (a total a person reads) — %s: rejects with the count's own message, never 0",
      async (_name: string, answer: Answer) => {
        nextAnswer = answer;

        const error: unknown = await captureError(() => {
          return count(true);
        });

        expect(error).toBeInstanceOf(QueryTimeoutException);
        expect((error as QueryTimeoutException).message).toBe(
          "Counting every matching log took longer than 45 seconds. Narrow the time range or add a filter to get an exact total.",
        );
      },
    );

    /*
     * The default count keeps what its callers (telemetry monitor
     * thresholds, the AI spike detector) have always read: 'break', and 0
     * for a count that was broken off.
     */
    test("the default count still reads an empty answer as 0", async () => {
      nextAnswer = { kind: "body", body: "" };

      expect(await count()).toBe(0);
      expect(calls[0]!.query).toContain("timeout_overflow_mode = 'break'");
      expect(logger.warn).toHaveBeenCalledWith(
        "LogLike count query stopped before it finished, defaulting to 0",
        { tableName: "LogLike" },
      );
    });
  });

  test("a statement built elsewhere keeps its parameters", async () => {
    const statement: Statement = new Statement();
    statement.append("SELECT 1 SETTINGS max_execution_time = 45");

    await service.executeQuery(statement);

    expect(calls[0]!.query).toBe("SELECT 1 SETTINGS max_execution_time = 45");
  });
});
