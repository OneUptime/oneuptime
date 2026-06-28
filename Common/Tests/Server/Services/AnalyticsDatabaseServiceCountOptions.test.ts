import { LogService } from "../../../Server/Services/LogService";
import ClickhouseDatabase from "../../../Server/Infrastructure/ClickhouseDatabase";
import { Statement } from "../../../Server/Utils/AnalyticsDatabase/Statement";
import CountBy from "../../../Server/Types/AnalyticsDatabase/CountBy";
import Log from "../../../Models/AnalyticsModels/Log";

describe("AnalyticsDatabaseService count query settings + execute options", () => {
  describe("toCountStatement max_execution_time", () => {
    test("honors a per-count maxExecutionTimeInSeconds override", () => {
      const service: LogService = new LogService();
      const statement: Statement = service.toCountStatement({
        query: {},
        props: { isRoot: true },
        maxExecutionTimeInSeconds: 15,
      } as CountBy<Log>);

      expect(statement.query).toContain("max_execution_time = 15");
      expect(statement.query).toContain("timeout_overflow_mode = 'break'");
    });

    test("defaults to the 45s cap when no override is provided", () => {
      const service: LogService = new LogService();
      const statement: Statement = service.toCountStatement({
        query: {},
        props: { isRoot: true },
      } as CountBy<Log>);

      expect(statement.query).toContain("max_execution_time = 45");
    });
  });

  describe("executeQuery forwards execute options to the ClickHouse client", () => {
    type QueryMock = jest.Mock;

    const buildServiceWithMockClient: (queryMock: QueryMock) => LogService = (
      queryMock: QueryMock,
    ): LogService => {
      const fakeClient: unknown = { query: queryMock };
      const fakeDatabase: unknown = {
        getDataSource: () => {
          return fakeClient;
        },
        getDatasourceOptions: () => {
          return { database: "test" };
        },
      };
      return new LogService(fakeDatabase as ClickhouseDatabase);
    };

    test("passes abort_signal and clickhouse_settings through to query()", async () => {
      const queryMock: QueryMock = jest.fn().mockResolvedValue({
        json: async () => {
          return { data: [] };
        },
      });
      const service: LogService = buildServiceWithMockClient(queryMock);

      const controller: AbortController = new AbortController();
      await service.executeQuery("SELECT 1", {
        abortSignal: controller.signal,
        clickhouseSettings: {
          send_progress_in_http_headers: 1,
        } as never,
      });

      expect(queryMock).toHaveBeenCalledTimes(1);
      const callArg: Record<string, unknown> = queryMock.mock
        .calls[0]![0] as Record<string, unknown>;
      expect(callArg["abort_signal"]).toBe(controller.signal);
      expect(callArg["clickhouse_settings"]).toEqual({
        send_progress_in_http_headers: 1,
      });
    });

    test("omits abort_signal entirely when no signal is supplied", async () => {
      const queryMock: QueryMock = jest.fn().mockResolvedValue({
        json: async () => {
          return { data: [] };
        },
      });
      const service: LogService = buildServiceWithMockClient(queryMock);

      await service.executeQuery("SELECT 1");

      const callArg: Record<string, unknown> = queryMock.mock
        .calls[0]![0] as Record<string, unknown>;
      expect("abort_signal" in callArg).toBe(false);
    });
  });
});
