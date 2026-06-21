import AnalyticsDatabaseService from "../../../Server/Services/AnalyticsDatabaseService";
import {
  SQL,
  Statement,
} from "../../../Server/Utils/AnalyticsDatabase/Statement";
import logger from "../../../Server/Utils/Logger";
import "../TestingUtils/Init";
import AnalyticsBaseModel from "../../../Models/AnalyticsModels/AnalyticsBaseModel/AnalyticsBaseModel";
import Route from "../../../Types/API/Route";
import AnalyticsTableEngine from "../../../Types/AnalyticsDatabase/AnalyticsTableEngine";
import AnalyticsTableColumn from "../../../Types/AnalyticsDatabase/TableColumn";
import TableColumnType from "../../../Types/AnalyticsDatabase/TableColumnType";
import AggregationType from "../../../Types/BaseDatabase/AggregationType";
import BadDataException from "../../../Types/Exception/BadDataException";
import GenericObject from "../../../Types/GenericObject";
import {
  describe,
  expect,
  beforeEach,
  test,
  afterEach,
  jest,
} from "@jest/globals";

describe("AnalyticsDatabaseService", () => {
  class TestModel extends AnalyticsBaseModel {
    public constructor() {
      super({
        tableName: "<table-name>",
        singularName: "<singular-name>",
        pluralName: "<plural-name>",
        tableColumns: [
          new AnalyticsTableColumn({
            key: `column_ObjectID`,
            title: "<title>",
            description: "<description>",
            required: true,
            type: TableColumnType.ObjectID,
          }),
          new AnalyticsTableColumn({
            key: `column_1`,
            title: "<title>",
            description: "<description>",
            required: false,
            type: TableColumnType.Text,
          }),
          new AnalyticsTableColumn({
            key: `column_2`,
            title: "<title>",
            description: "<description>",
            required: false,
            type: TableColumnType.Number,
          }),
        ],
        crudApiPath: new Route("route"),
        primaryKeys: ["column_ObjectID"],
        sortKeys: ["column_ObjectID"],
        partitionKey: "column_ObjectID",
        tableEngine: AnalyticsTableEngine.MergeTree,
      });
    }
  }

  let service: AnalyticsDatabaseService<TestModel>;
  beforeEach(() => {
    service = new AnalyticsDatabaseService({
      modelType: TestModel,
    });
  });

  describe("toCountStatement", () => {
    beforeEach(() => {
      service.statementGenerator.toWhereStatement = jest.fn(() => {
        return SQL`<where-statement>`;
      });
      jest.spyOn(logger, "debug").mockImplementation(() => {
        return undefined!;
      });
    });

    afterEach(() => {
      jest.restoreAllMocks();
    });

    test("should return count statement", () => {
      const statement: Statement = service.toCountStatement({
        query: { field: "value" } as GenericObject,
        props: { prop: "test" } as GenericObject,
      });

      expect(service.statementGenerator.toWhereStatement).toBeCalledWith({
        field: "value",
      });

      expect(logger.debug).toHaveBeenCalledTimes(2);
      expect(logger.debug).toHaveBeenNthCalledWith(
        1,
        "<table-name> Count Statement",
        { tableName: "<table-name>" },
      );
      expect(logger.debug).toHaveBeenNthCalledWith(2, statement, {
        tableName: "<table-name>",
      });

      expect(statement.query).toBe(
        "SELECT\n" +
          "    count() as count\n" +
          "FROM {p0:Identifier}.{p1:Identifier}\n" +
          "WHERE TRUE <where-statement>" +
          " SETTINGS max_execution_time = 45, timeout_overflow_mode = 'break', max_memory_usage = 3221225472, max_bytes_before_external_group_by = 1610612736, max_bytes_before_external_sort = 1610612736",
      );
      expect(statement.query_params).toStrictEqual({
        p0: "oneuptime",
        p1: "<table-name>",
      });
    });

    test("optionally adds LIMIT", () => {
      const statement: Statement = service.toCountStatement({
        query: { field: "value" } as GenericObject,
        props: { prop: "test" } as GenericObject,
        limit: 123,
      });

      expect(statement.query).toBe(
        "SELECT\n" +
          "    count() as count\n" +
          "FROM {p0:Identifier}.{p1:Identifier}\n" +
          "WHERE TRUE <where-statement>\n" +
          "LIMIT {p2:Int32}\n" +
          " SETTINGS max_execution_time = 45, timeout_overflow_mode = 'break', max_memory_usage = 3221225472, max_bytes_before_external_group_by = 1610612736, max_bytes_before_external_sort = 1610612736",
      );
      expect(statement.query_params).toStrictEqual({
        p0: "oneuptime",
        p1: "<table-name>",
        p2: 123,
      });
    });

    test("optionally adds OFFSET", () => {
      const statement: Statement = service.toCountStatement({
        query: { field: "value" } as GenericObject,
        props: { prop: "test" } as GenericObject,
        skip: 123,
      });

      expect(statement.query).toBe(
        "SELECT\n" +
          "    count() as count\n" +
          "FROM {p0:Identifier}.{p1:Identifier}\n" +
          "WHERE TRUE <where-statement>\n" +
          "OFFSET {p2:Int32}\n" +
          " SETTINGS max_execution_time = 45, timeout_overflow_mode = 'break', max_memory_usage = 3221225472, max_bytes_before_external_group_by = 1610612736, max_bytes_before_external_sort = 1610612736",
      );
      expect(statement.query_params).toStrictEqual({
        p0: "oneuptime",
        p1: "<table-name>",
        p2: 123,
      });
    });
  });

  describe("toFindStatement", () => {
    beforeEach(() => {
      service.statementGenerator.toSelectStatement = jest.fn(() => {
        return {
          statement: SQL`<select-statement>`,
          columns: ["<column-1>", "<column-2>"],
        };
      });
      service.statementGenerator.toWhereStatement = jest.fn(() => {
        return SQL`<where-statement>`;
      });
      service.statementGenerator.toSortStatement = jest.fn(() => {
        return SQL`<sort-statement>`;
      });
      jest.spyOn(logger, "debug").mockImplementation(() => {
        return undefined!;
      });
    });

    afterEach(() => {
      jest.restoreAllMocks();
    });

    test("should return find statement", () => {
      const { statement, columns } = service.toFindStatement({
        select: { columns: ["col1", "col2"] } as GenericObject,
        query: { field: "value" } as GenericObject,
        props: { prop: "test" } as GenericObject,
        sort: { field: "asc" } as GenericObject,
        limit: 123,
        skip: 234,
      });

      expect(service.statementGenerator.toSelectStatement).toBeCalledWith({
        columns: ["col1", "col2"],
      });
      expect(service.statementGenerator.toWhereStatement).toBeCalledWith({
        field: "value",
      });
      expect(service.statementGenerator.toSortStatement).toBeCalledWith({
        field: "asc",
      });

      expect(jest.mocked(logger.debug)).toHaveBeenCalledTimes(2);
      expect(jest.mocked(logger.debug)).toHaveBeenNthCalledWith(
        1,
        "<table-name> Find Statement",
        { tableName: "<table-name>" },
      );
      expect(jest.mocked(logger.debug)).toHaveBeenNthCalledWith(2, statement, {
        tableName: "<table-name>",
      });

      expect(statement.query).toBe(
        "SELECT <select-statement> FROM {p0:Identifier}.{p1:Identifier} WHERE TRUE <where-statement> ORDER BY <sort-statement> LIMIT {p2:Int32} OFFSET {p3:Int32}\n" +
          "SETTINGS max_execution_time = 45, timeout_overflow_mode = 'break', max_memory_usage = 3221225472, max_bytes_before_external_group_by = 1610612736, max_bytes_before_external_sort = 1610612736",
      );
      expect(statement.query_params).toStrictEqual({
        p0: "oneuptime",
        p1: "<table-name>",
        p2: 123, // limit
        p3: 234, // offset
      });
      expect(columns).toStrictEqual(["<column-1>", "<column-2>"]);
    });
  });

  describe("aggregateBy input validation", () => {
    beforeEach(() => {
      jest.spyOn(logger, "error").mockImplementation(() => {
        return undefined!;
      });

      /*
       * The base getException method is async and throws without await in the
       * catch block, creating unhandled rejections. Override to throw synchronously.
       */
      (service as any).getException = (error: Error): never => {
        throw error;
      };
    });

    afterEach(() => {
      jest.restoreAllMocks();
    });

    const makeAggregateBy: (overrides?: Record<string, unknown>) => any = (
      overrides: Record<string, unknown> = {},
    ): any => {
      return {
        aggregationType: AggregationType.Sum,
        aggregateColumnName: "column_2",
        aggregationTimestampColumnName: "column_ObjectID",
        startTimestamp: new Date("2024-01-01"),
        endTimestamp: new Date("2024-01-02"),
        query: {},
        limit: 10,
        skip: 0,
        props: {
          isRoot: true,
        },
        ...overrides,
      };
    };

    test("should reject invalid aggregationType (SQL injection payload)", async () => {
      await expect(
        service.aggregateBy(
          makeAggregateBy({
            aggregationType:
              "COUNT) as aggregationResult FROM system.one UNION ALL SELECT name FROM system.tables --",
          }),
        ),
      ).rejects.toThrow(BadDataException);
    });

    test("should reject invalid aggregationType (arbitrary string)", async () => {
      await expect(
        service.aggregateBy(makeAggregateBy({ aggregationType: "INVALID" })),
      ).rejects.toThrow("Invalid aggregationType");
    });

    test("should reject invalid aggregateColumnName", async () => {
      await expect(
        service.aggregateBy(
          makeAggregateBy({ aggregateColumnName: "nonexistent_column" }),
        ),
      ).rejects.toThrow("Invalid aggregateColumnName");
    });

    test("should reject SQL injection in aggregateColumnName", async () => {
      await expect(
        service.aggregateBy(
          makeAggregateBy({
            aggregateColumnName: "col); DROP TABLE logs; --",
          }),
        ),
      ).rejects.toThrow("Invalid aggregateColumnName");
    });

    test("should reject invalid aggregationTimestampColumnName", async () => {
      await expect(
        service.aggregateBy(
          makeAggregateBy({
            aggregationTimestampColumnName: "nonexistent_column",
          }),
        ),
      ).rejects.toThrow("Invalid aggregationTimestampColumnName");
    });

    test("should reject SQL injection in aggregationTimestampColumnName", async () => {
      await expect(
        service.aggregateBy(
          makeAggregateBy({
            aggregationTimestampColumnName:
              "createdAt, INTERVAL 1 hour)) as ts FROM system.one UNION ALL SELECT 1 --",
          }),
        ),
      ).rejects.toThrow("Invalid aggregationTimestampColumnName");
    });
  });

  describe("toDeleteStatement", () => {
    beforeEach(() => {
      service.statementGenerator.toWhereStatement = jest.fn(() => {
        return SQL`<where-statement>`;
      });
      jest.spyOn(logger, "debug").mockImplementation(() => {
        return undefined!;
      });
    });

    afterEach(() => {
      jest.restoreAllMocks();
    });

    test("should return delete statement", () => {
      const statement: Statement = service.toDeleteStatement({
        query: { field: "value" } as GenericObject,
        props: { prop: "test" } as GenericObject,
      });

      expect(service.statementGenerator.toWhereStatement).toBeCalledWith({
        field: "value",
      });

      expect(logger.debug).toHaveBeenCalledTimes(2);
      expect(logger.debug).toHaveBeenNthCalledWith(
        1,
        "<table-name> Delete Statement",
        { tableName: "<table-name>" },
      );
      expect(logger.debug).toHaveBeenNthCalledWith(2, statement, {
        tableName: "<table-name>",
      });

      expect(statement.query).toBe(
        "DELETE FROM {p0:Identifier}.{p1:Identifier}\n" +
          "WHERE TRUE <where-statement>",
      );
      expect(statement.query_params).toStrictEqual({
        p0: "oneuptime",
        p1: "<table-name>",
      });
    });
  });

  /*
   * Per-call exec options (clickhouse_settings + query_id) added for the
   * telemetry V3 backfill engine — long INSERT...SELECT statements need
   * HTTP progress-header keepalive, dedup tokens and deterministic query
   * ids per call. Must be strictly additive: option-less calls keep the
   * exact pre-existing exec/query payload.
   */
  describe("execute / executeQuery per-call options", () => {
    let exec: ReturnType<typeof jest.fn>;
    let query: ReturnType<typeof jest.fn>;

    beforeEach(() => {
      exec = jest.fn(() => {
        return Promise.resolve({});
      });
      query = jest.fn(() => {
        return Promise.resolve({});
      });
      (service as any).database = {};
      (service as any).databaseClient = { exec, query };
    });

    test("execute threads clickhouse settings and query id into client.exec", async () => {
      await service.execute("INSERT INTO Foo SELECT 1", {
        clickhouseSettings: {
          insert_deduplication_token: "v3copy:Foo:1:202601",
          send_progress_in_http_headers: 1,
        },
        queryId: "v3copy:Foo:1:202601:123",
      });

      expect(exec).toHaveBeenCalledWith({
        query: "INSERT INTO Foo SELECT 1",
        query_params: undefined,
        clickhouse_settings: {
          insert_deduplication_token: "v3copy:Foo:1:202601",
          send_progress_in_http_headers: 1,
        },
        query_id: "v3copy:Foo:1:202601:123",
      });
    });

    test("execute without options keeps the pre-existing exec payload", async () => {
      await service.execute("SELECT 1");

      expect(exec).toHaveBeenCalledWith({
        query: "SELECT 1",
        query_params: undefined,
      });
    });

    test("executeQuery threads clickhouse settings into client.query", async () => {
      await service.executeQuery("SELECT 1", {
        clickhouseSettings: { max_execution_time: 1800 },
      });

      expect(query).toHaveBeenCalledWith({
        query: "SELECT 1",
        format: "JSON",
        query_params: undefined,
        clickhouse_settings: { max_execution_time: 1800 },
      });
    });

    test("executeQuery without options keeps the pre-existing query payload", async () => {
      await service.executeQuery("SELECT 1");

      expect(query).toHaveBeenCalledWith({
        query: "SELECT 1",
        format: "JSON",
        query_params: undefined,
      });
    });
  });
});
