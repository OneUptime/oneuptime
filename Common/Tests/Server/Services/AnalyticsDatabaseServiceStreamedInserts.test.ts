import AnalyticsDatabaseService, {
  runWithInsertDedup,
  shouldStreamClickhouseInserts,
} from "../../../Server/Services/AnalyticsDatabaseService";
import logger from "../../../Server/Utils/Logger";
import "../TestingUtils/Init";
import AnalyticsBaseModel from "../../../Models/AnalyticsModels/AnalyticsBaseModel/AnalyticsBaseModel";
import Route from "../../../Types/API/Route";
import AnalyticsTableEngine from "../../../Types/AnalyticsDatabase/AnalyticsTableEngine";
import AnalyticsTableColumn from "../../../Types/AnalyticsDatabase/TableColumn";
import TableColumnType from "../../../Types/AnalyticsDatabase/TableColumnType";
import { JSONObject } from "../../../Types/JSON";
import { Readable } from "node:stream";
// Vendored client internals: the exact encoder client.insert() runs values
// through. Used to prove wire-byte equivalence of stream vs array inputs.
import { NodeValuesEncoder } from "@clickhouse/client/dist/utils/encoder";
import {
  describe,
  expect,
  beforeEach,
  afterEach,
  test,
  jest,
} from "@jest/globals";

/*
 * Streamed ClickHouse insert bodies (CLICKHOUSE_STREAMED_INSERTS).
 *
 * insertJsonRows used to pass the raw rows array to @clickhouse/client,
 * whose encoder materializes the entire insert body as one in-memory
 * string. It now passes a fresh object-mode Readable over the SAME array
 * (no copy) unless CLICKHOUSE_STREAMED_INSERTS=false restores the array
 * path. These tests pin:
 *  - values-mode selection per flag state (default/on -> stream, off -> array),
 *  - row-level equivalence (same object references, same order),
 *  - encoder-level byte equivalence via the vendored NodeValuesEncoder,
 *  - per-invocation stream freshness (the fan-in writer retries with the
 *    same rows array; each attempt must get a NEW consumable stream),
 *  - settings passthrough (dedup token, async_insert, wait_for_async_insert,
 *    caller merge) unchanged in both modes,
 *  - the empty-rows early return and error propagation in both modes.
 */

type CapturedInsertCall = {
  table: string;
  values: Array<JSONObject> | Readable;
  format: string;
  clickhouse_settings: JSONObject;
};

describe("AnalyticsDatabaseService streamed insert bodies", () => {
  class StreamTestModel extends AnalyticsBaseModel {
    public constructor() {
      super({
        tableName: "StreamInsertTestTable",
        singularName: "<singular-name>",
        pluralName: "<plural-name>",
        tableColumns: [
          new AnalyticsTableColumn({
            key: "column_ObjectID",
            title: "<title>",
            description: "<description>",
            required: true,
            type: TableColumnType.ObjectID,
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

  let service: AnalyticsDatabaseService<StreamTestModel>;
  // Untyped mock (matches the sibling suite's idiom) — @types/jest and
  // @jest/globals disagree on Mock's generic arity in this repo's versions.
  let insertMock: ReturnType<typeof jest.fn>;
  let savedStreamFlag: string | undefined;
  let savedWaitFlag: string | undefined;

  // Distinct object references so identity assertions are meaningful.
  const makeRows: () => Array<JSONObject> = (): Array<JSONObject> => {
    return [
      { a: 1, text: "first" },
      { b: "two", when: "2026-01-01 00:00:00" },
      { c: { nested: true, list: [1, 2, 3] } },
    ];
  };

  const lastInsertCall: () => CapturedInsertCall = (): CapturedInsertCall => {
    expect(insertMock.mock.calls.length).toBeGreaterThan(0);
    return insertMock.mock.calls[insertMock.mock.calls.length - 1]![0] as
      unknown as CapturedInsertCall;
  };

  const consumeStream: (stream: Readable) => Promise<Array<unknown>> = async (
    stream: Readable,
  ): Promise<Array<unknown>> => {
    const out: Array<unknown> = [];
    for await (const value of stream) {
      out.push(value);
    }
    return out;
  };

  beforeEach(() => {
    savedStreamFlag = process.env["CLICKHOUSE_STREAMED_INSERTS"];
    savedWaitFlag = process.env["TELEMETRY_WAIT_FOR_ASYNC_INSERT"];
    delete process.env["CLICKHOUSE_STREAMED_INSERTS"];
    delete process.env["TELEMETRY_WAIT_FOR_ASYNC_INSERT"];

    service = new AnalyticsDatabaseService({
      modelType: StreamTestModel,
    });
    insertMock = jest.fn((): Promise<void> => {
      return Promise.resolve();
    });
    const serviceWithClient: { ingestDatabaseClient: unknown } =
      service as unknown as { ingestDatabaseClient: unknown };
    serviceWithClient.ingestDatabaseClient = { insert: insertMock };

    jest.spyOn(logger, "debug").mockImplementation(() => {
      return undefined!;
    });
    jest.spyOn(logger, "error").mockImplementation(() => {
      return undefined!;
    });
  });

  afterEach(() => {
    if (savedStreamFlag === undefined) {
      delete process.env["CLICKHOUSE_STREAMED_INSERTS"];
    } else {
      process.env["CLICKHOUSE_STREAMED_INSERTS"] = savedStreamFlag;
    }
    if (savedWaitFlag === undefined) {
      delete process.env["TELEMETRY_WAIT_FOR_ASYNC_INSERT"];
    } else {
      process.env["TELEMETRY_WAIT_FOR_ASYNC_INSERT"] = savedWaitFlag;
    }
    jest.restoreAllMocks();
  });

  describe("flag handling", () => {
    test("default (env unset) enables streaming", () => {
      expect(shouldStreamClickhouseInserts()).toBe(true);
    });

    test("explicit 'true' enables streaming", () => {
      process.env["CLICKHOUSE_STREAMED_INSERTS"] = "true";
      expect(shouldStreamClickhouseInserts()).toBe(true);
    });

    test("only the literal 'false' disables streaming", () => {
      process.env["CLICKHOUSE_STREAMED_INSERTS"] = "false";
      expect(shouldStreamClickhouseInserts()).toBe(false);
    });
  });

  describe("values mode", () => {
    test("default: values is a fresh object-mode Readable over the rows", async () => {
      const rows: Array<JSONObject> = makeRows();

      await service.insertJsonRows(rows);

      const call: CapturedInsertCall = lastInsertCall();
      expect(call.table).toBe("StreamInsertTestTable");
      expect(call.format).toBe("JSONEachRow");
      expect(call.values).toBeInstanceOf(Readable);
      expect((call.values as Readable).readableObjectMode).toBe(true);
    });

    test("flag on ('true'): values is a Readable", async () => {
      process.env["CLICKHOUSE_STREAMED_INSERTS"] = "true";

      await service.insertJsonRows(makeRows());

      expect(lastInsertCall().values).toBeInstanceOf(Readable);
    });

    test("flag off ('false'): values is the plain rows array (reference identity)", async () => {
      process.env["CLICKHOUSE_STREAMED_INSERTS"] = "false";
      const rows: Array<JSONObject> = makeRows();

      await service.insertJsonRows(rows);

      const call: CapturedInsertCall = lastInsertCall();
      // The exact same array object, not a copy.
      expect(call.values).toBe(rows);
    });
  });

  describe("equivalence with the array path", () => {
    test("consuming the stream yields exactly the array's row objects, in order, by reference", async () => {
      const rows: Array<JSONObject> = makeRows();

      await service.insertJsonRows(rows);

      const streamed: Array<unknown> = await consumeStream(
        lastInsertCall().values as Readable,
      );

      expect(streamed).toHaveLength(rows.length);
      // Reference identity per element: the stream wraps the array, no copies.
      for (let i: number = 0; i < rows.length; i++) {
        expect(streamed[i]).toBe(rows[i]);
      }
      expect(streamed).toStrictEqual(rows);
    });

    test("the vendored client encoder produces byte-identical output for stream vs array input", async () => {
      /*
       * Run BOTH values shapes through the actual NodeValuesEncoder that
       * client.insert() uses. The stream result is itself a stream of
       * encoded chunks; joined, it must equal the array path's single
       * joined string — this is the "wire bytes are identical by
       * construction" claim, proven against the vendored code.
       */
      const rows: Array<JSONObject> = makeRows();
      const encoder: NodeValuesEncoder = new NodeValuesEncoder();

      const arrayEncoded: string | Readable = encoder.encodeValues(
        rows,
        "JSONEachRow",
      ) as string;
      expect(typeof arrayEncoded).toBe("string");

      const streamEncoded: Readable = encoder.encodeValues(
        Readable.from(makeRows()),
        "JSONEachRow",
      ) as Readable;
      const chunks: Array<unknown> = await consumeStream(streamEncoded);
      expect(chunks.join("")).toBe(arrayEncoded);
    });
  });

  describe("per-attempt stream freshness (fan-in retry contract)", () => {
    test("two calls with the same rows array each get a NEW fully-consumable stream", async () => {
      /*
       * TelemetryFanInWriter.insertGroupWithRetry retries insertJsonRows
       * with the SAME rows array and the SAME dedup token. A stream is
       * single-use, so the second attempt must receive a brand new one —
       * not the first attempt's exhausted (or errored) stream.
       */
      const rows: Array<JSONObject> = makeRows();

      await service.insertJsonRows(rows, { dedupToken: "job:tbl:0" });
      const firstStream: Readable = lastInsertCall().values as Readable;
      const firstConsumed: Array<unknown> = await consumeStream(firstStream);

      await service.insertJsonRows(rows, { dedupToken: "job:tbl:0" });
      const secondStream: Readable = lastInsertCall().values as Readable;

      expect(insertMock).toHaveBeenCalledTimes(2);
      expect(secondStream).not.toBe(firstStream);

      const secondConsumed: Array<unknown> = await consumeStream(secondStream);
      expect(firstConsumed).toStrictEqual(rows);
      expect(secondConsumed).toStrictEqual(rows);
      for (let i: number = 0; i < rows.length; i++) {
        expect(secondConsumed[i]).toBe(rows[i]);
      }
    });
  });

  describe.each([
    ["streamed (default)", undefined],
    ["array (flag off)", "false"],
  ] as Array<[string, string | undefined]>)(
    "settings passthrough — %s mode",
    (_label: string, flagValue: string | undefined) => {
      beforeEach(() => {
        if (flagValue === undefined) {
          delete process.env["CLICKHOUSE_STREAMED_INSERTS"];
        } else {
          process.env["CLICKHOUSE_STREAMED_INSERTS"] = flagValue;
        }
      });

      test("explicit dedup token pins the exact settings object", async () => {
        await service.insertJsonRows(makeRows(), {
          dedupToken: "job-1:StreamInsertTestTable:0",
        });

        expect(lastInsertCall().clickhouse_settings).toStrictEqual({
          async_insert: 1,
          wait_for_async_insert: 0,
          async_insert_deduplicate: 1,
          insert_deduplication_token: "job-1:StreamInsertTestTable:0",
        });
      });

      test("no token and no ambient context pins the exact tokenless settings object", async () => {
        await service.insertJsonRows(makeRows());

        expect(lastInsertCall().clickhouse_settings).toStrictEqual({
          async_insert: 1,
          wait_for_async_insert: 0,
        });
      });

      test("ambient runWithInsertDedup context derives the deterministic token", async () => {
        await runWithInsertDedup("ambient-job", async (): Promise<void> => {
          await service.insertJsonRows(makeRows());
        });

        expect(lastInsertCall().clickhouse_settings).toStrictEqual({
          async_insert: 1,
          wait_for_async_insert: 0,
          async_insert_deduplicate: 1,
          insert_deduplication_token: "ambient-job:StreamInsertTestTable:0",
        });
      });

      test("TELEMETRY_WAIT_FOR_ASYNC_INSERT=true flips wait_for_async_insert", async () => {
        process.env["TELEMETRY_WAIT_FOR_ASYNC_INSERT"] = "true";

        await service.insertJsonRows(makeRows(), { dedupToken: "t" });

        expect(lastInsertCall().clickhouse_settings).toStrictEqual({
          async_insert: 1,
          wait_for_async_insert: 1,
          async_insert_deduplicate: 1,
          insert_deduplication_token: "t",
        });
      });

      test("caller clickhouseSettings merge last and win", async () => {
        await service.insertJsonRows(makeRows(), {
          dedupToken: "tok",
          clickhouseSettings: {
            wait_for_async_insert: 1,
            max_insert_block_size: "1048576",
          },
        });

        expect(lastInsertCall().clickhouse_settings).toStrictEqual({
          async_insert: 1,
          wait_for_async_insert: 1, // caller override wins over the default 0
          async_insert_deduplicate: 1,
          insert_deduplication_token: "tok",
          max_insert_block_size: "1048576",
        });
      });

      test("empty rows: resolves without calling the client", async () => {
        await service.insertJsonRows([]);
        await service.insertJsonRows(
          undefined as unknown as Array<JSONObject>,
        );

        expect(insertMock).not.toHaveBeenCalled();
      });

      test("client rejection propagates the same error instance", async () => {
        const failure: Error = new Error("Timeout error.");
        insertMock.mockImplementationOnce((): Promise<void> => {
          return Promise.reject(failure);
        });

        await expect(service.insertJsonRows(makeRows())).rejects.toBe(failure);
        // The existing failure log must still fire.
        expect(logger.error).toHaveBeenCalled();
      });
    },
  );
});
