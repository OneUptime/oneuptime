import AnalyticsDatabaseService from "../../../Server/Services/AnalyticsDatabaseService";
import CountBy from "../../../Server/Types/AnalyticsDatabase/CountBy";
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
import ExceptionCode from "../../../Types/Exception/ExceptionCode";
import ServerException from "../../../Types/Exception/ServerException";
import TimeoutException from "../../../Types/Exception/TimeoutException";
import GenericObject from "../../../Types/GenericObject";
import PositiveNumber from "../../../Types/PositiveNumber";
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
 * The exact count behind a telemetry explorer's total (issue #4202).
 *
 * A count is allowed to be approximate by default: callers that compare it
 * with a threshold (the telemetry monitors) are fine with a count that ran
 * out of time and returned what it had (timeout_overflow_mode 'break'), or
 * with 0 when the response was cut short. A total a person reads beside the
 * list it describes is not: "0 spans" over a list of spans, or a partial
 * count printed as the total, is a wrong answer. So an exact count fails
 * loudly instead, says what to do when it ran out of time, and every other
 * caller keeps the count it always had.
 */

describe("AnalyticsDatabaseService — exact counts", () => {
  class TelemetryModel extends AnalyticsBaseModel {
    public constructor() {
      super({
        tableName: "<telemetry-table>",
        singularName: "Span",
        pluralName: "Spans",
        tableColumns: [
          new AnalyticsTableColumn({
            key: "projectId",
            title: "<title>",
            description: "<description>",
            required: true,
            type: TableColumnType.ObjectID,
          }),
          new AnalyticsTableColumn({
            key: "name",
            title: "<title>",
            description: "<description>",
            required: false,
            type: TableColumnType.Text,
          }),
          new AnalyticsTableColumn({
            key: "retentionDate",
            title: "<title>",
            description: "<description>",
            required: true,
            type: TableColumnType.Date,
          }),
        ],
        crudApiPath: new Route("route"),
        primaryKeys: ["projectId"],
        sortKeys: ["projectId"],
        partitionKey: "projectId",
        tableEngine: AnalyticsTableEngine.MergeTree,
      });
    }
  }

  let service: AnalyticsDatabaseService<TelemetryModel>;

  beforeEach(() => {
    service = new AnalyticsDatabaseService({ modelType: TelemetryModel });
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

  describe("toCountStatement", () => {
    beforeEach(() => {
      service.statementGenerator.toWhereStatement = jest.fn(() => {
        return SQL`<where-statement>`;
      });
    });

    test("an exact count fails at its time limit instead of returning part of a count", () => {
      const statement: Statement = service.toCountStatement({
        query: { name: "checkout" } as GenericObject,
        props: { isRoot: true },
        exact: true,
      });

      expect(statement.query).toContain("timeout_overflow_mode = 'throw'");
      expect(statement.query).not.toContain("timeout_overflow_mode = 'break'");
      expect(statement.query).toContain("max_execution_time = 45");
    });

    /*
     * The same WHERE a findBy compiles, and the same read-side retention
     * filter: rows past their retention are invisible to the list, so they
     * must be invisible to its total too.
     */
    test("it counts what the list reads: the same where clause and retention filter", () => {
      const statement: Statement = service.toCountStatement({
        query: { name: "checkout" } as GenericObject,
        props: { isRoot: true },
        exact: true,
      });

      expect(service.statementGenerator.toWhereStatement).toHaveBeenCalledWith({
        name: "checkout",
      });
      expect(statement.query).toContain(
        "WHERE TRUE <where-statement> AND retentionDate >= now()",
      );
    });

    test("every other count is unchanged: still 'break'", () => {
      const statement: Statement = service.toCountStatement({
        query: { name: "checkout" } as GenericObject,
        props: { isRoot: true },
      });

      expect(statement.query).toContain("timeout_overflow_mode = 'break'");
      expect(statement.query).not.toContain("timeout_overflow_mode = 'throw'");
    });

    test("exact: false is the default count", () => {
      const statement: Statement = service.toCountStatement({
        query: { name: "checkout" } as GenericObject,
        props: { isRoot: true },
        exact: false,
      });

      expect(statement.query).toContain("timeout_overflow_mode = 'break'");
    });
  });

  describe("countBy", () => {
    let checkReadPermissionMock: jest.Mock;

    beforeEach(() => {
      checkReadPermissionMock = jest
        .spyOn(ModelPermission, "checkReadPermission")
        .mockImplementation((_modelType: unknown, query: unknown) => {
          return Promise.resolve({ query, select: null } as never);
        }) as unknown as jest.Mock;
    });

    const mockCountResponse: (response: unknown) => void = (
      response: unknown,
    ): void => {
      jest.spyOn(service, "executeQuery").mockResolvedValue({
        json: () => {
          return Promise.resolve(response);
        },
      } as never);
    };

    const mockQueryFailure: (error: unknown) => void = (
      error: unknown,
    ): void => {
      jest.spyOn(service, "executeQuery").mockRejectedValue(error as never);
    };

    const count: (exact?: boolean) => Promise<number> = async (
      exact?: boolean,
    ): Promise<number> => {
      const result: PositiveNumber = await service.countBy({
        query: {},
        props: { isRoot: true },
        exact,
      });
      return result.toNumber();
    };

    const timeoutError: () => ClickHouseError = (): ClickHouseError => {
      return new ClickHouseError({
        message:
          "Timeout exceeded: elapsed 45.001 seconds, maximum: 45. (TIMEOUT_EXCEEDED)",
        code: "159",
        type: "TIMEOUT_EXCEEDED",
      });
    };

    test("an exact count reads the number like any other", async () => {
      mockCountResponse({ data: [{ count: "712345" }] });
      expect(await count(true)).toBe(712345);

      mockCountResponse({ data: [{ count: 0 }] });
      expect(await count(true)).toBe(0);
    });

    test("an exact count whose response was cut short fails rather than reading 0", async () => {
      jest.spyOn(service, "executeQuery").mockResolvedValue({
        json: () => {
          return Promise.reject(new Error("truncated response"));
        },
      } as never);

      await expect(count(true)).rejects.toBeInstanceOf(ServerException);
      // Not the "defaulting to 0" warning the approximate count logs.
      expect(logger.warn).not.toHaveBeenCalled();
    });

    test("an exact count with no number in it fails rather than reading 0", async () => {
      for (const response of [
        {},
        { data: [] },
        { data: [{ other: 5 }] },
        { data: [{ count: null }] },
      ]) {
        mockCountResponse(response);
        await expect(count(true)).rejects.toThrow(
          "The span count came back without a number.",
        );
      }
    });

    test("the approximate count still reads a cut-short response as 0", async () => {
      jest.spyOn(service, "executeQuery").mockResolvedValue({
        json: () => {
          return Promise.reject(new Error("truncated response"));
        },
      } as never);

      expect(await count()).toBe(0);
      expect(logger.warn).toHaveBeenCalled();
    });

    test("an exact count that ran out of time says so, as a 408 that says what to do", async () => {
      mockQueryFailure(timeoutError());

      let thrown: unknown = undefined;
      try {
        await count(true);
      } catch (error) {
        thrown = error;
      }

      expect(thrown).toBeInstanceOf(TimeoutException);
      expect((thrown as TimeoutException).code).toBe(
        ExceptionCode.TimeoutException,
      );
      expect((thrown as TimeoutException).code).toBe(408);
      expect((thrown as TimeoutException).message).toBe(
        "Counting every matching span took longer than 45 seconds. Narrow the time range or add a filter to get an exact total.",
      );
    });

    test("TOO_SLOW — ClickHouse giving up up front — is the same answer", async () => {
      mockQueryFailure(
        new ClickHouseError({
          message:
            "Estimated query execution time (120 seconds) is too long. Maximum: 45. (TOO_SLOW)",
          code: "160",
          type: "TOO_SLOW",
        }),
      );

      await expect(count(true)).rejects.toBeInstanceOf(TimeoutException);
    });

    test("any other failure of an exact count is rethrown as it is", async () => {
      const syntaxError: ClickHouseError = new ClickHouseError({
        message: "Syntax error",
        code: "62",
        type: "SYNTAX_ERROR",
      });
      mockQueryFailure(syntaxError);

      await expect(count(true)).rejects.toBe(syntaxError);
    });

    test("an approximate count's failure is rethrown as it is, timeout or not", async () => {
      const error: ClickHouseError = timeoutError();
      mockQueryFailure(error);

      await expect(count()).rejects.toBe(error);
    });

    /*
     * The rewrite a findBy gets has to come before the permission check,
     * which refuses any key that is not a column (a telemetry explorer's
     * `resourceFilters`).
     */
    test("the count's query is rewritten before the permission check sees it", async () => {
      const order: Array<string> = [];
      const rewritten: GenericObject = { name: "rewritten" };

      jest
        .spyOn(
          service as unknown as {
            onBeforeCount: (
              countBy: CountBy<TelemetryModel>,
            ) => Promise<CountBy<TelemetryModel>>;
          },
          "onBeforeCount",
        )
        .mockImplementation(async (countBy: CountBy<TelemetryModel>) => {
          order.push("onBeforeCount");
          return { ...countBy, query: rewritten };
        });
      checkReadPermissionMock.mockImplementation(
        (_modelType: unknown, query: unknown) => {
          order.push("checkReadPermission");
          return Promise.resolve({ query, select: null } as never);
        },
      );
      mockCountResponse({ data: [{ count: 3 }] });

      expect(await count(true)).toBe(3);
      expect(order).toEqual(["onBeforeCount", "checkReadPermission"]);
      expect(checkReadPermissionMock.mock.calls[0]![1]).toBe(rewritten);
    });

    test("ignoreHooks skips the rewrite, as it skips findBy's", async () => {
      const onBeforeCount: jest.Mock = jest.spyOn(
        service as unknown as {
          onBeforeCount: (
            countBy: CountBy<TelemetryModel>,
          ) => Promise<CountBy<TelemetryModel>>;
        },
        "onBeforeCount",
      ) as unknown as jest.Mock;
      mockCountResponse({ data: [{ count: 3 }] });

      await service.countBy({
        query: {},
        props: { isRoot: true, ignoreHooks: true },
      });

      expect(onBeforeCount).not.toHaveBeenCalled();
    });
  });
});

describe("AnalyticsDatabaseService.isQueryTimeoutError", () => {
  test("TIMEOUT_EXCEEDED and TOO_SLOW, by code or by type, are timeouts", () => {
    expect(
      AnalyticsDatabaseService.isQueryTimeoutError(
        new ClickHouseError({
          message: "Timeout exceeded",
          code: "159",
          type: "TIMEOUT_EXCEEDED",
        }),
      ),
    ).toBe(true);
    expect(
      AnalyticsDatabaseService.isQueryTimeoutError(
        new ClickHouseError({ message: "Too slow", code: "160", type: "" }),
      ),
    ).toBe(true);
    expect(
      AnalyticsDatabaseService.isQueryTimeoutError({ type: "TOO_SLOW" }),
    ).toBe(true);
    expect(AnalyticsDatabaseService.isQueryTimeoutError({ code: "159" })).toBe(
      true,
    );
  });

  test("anything else is not", () => {
    for (const error of [
      new ClickHouseError({
        message: "Memory limit exceeded",
        code: "241",
        type: "MEMORY_LIMIT_EXCEEDED",
      }),
      new Error("Timeout exceeded"),
      { code: 159 },
      "TIMEOUT_EXCEEDED",
      null,
      undefined,
    ]) {
      expect(AnalyticsDatabaseService.isQueryTimeoutError(error)).toBe(false);
    }
  });
});
