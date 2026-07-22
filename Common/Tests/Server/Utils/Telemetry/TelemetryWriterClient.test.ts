import {
  FanInInsertTarget,
  FanInInsertTransport,
  TransientInsertError,
} from "../../../../Server/Utils/Telemetry/TelemetryFanInWriter";
import {
  TELEMETRY_WRITER_INSERT_ROUTE,
  WriterPostFn,
  WriterPostResult,
  createTelemetryWriterTransport,
  getTelemetryWriterRequestTimeoutMs,
  getTelemetryWriterUrl,
  isTelemetryWriterForwardingEnabled,
} from "../../../../Server/Utils/Telemetry/TelemetryWriterClient";
import { JSONObject } from "../../../../Types/JSON";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * The worker-side transport for the telemetry-writer tier. All tests inject
 * a fake post function — no network, no ClickHouse.
 */

const TARGET: FanInInsertTarget = {
  model: { tableName: "LogTable" },
  insertJsonRows: async (): Promise<void> => {
    throw new Error("the remote transport must never insert directly");
  },
};

type PostCall = {
  url: string;
  body: JSONObject;
  timeoutMs: number;
};

function makePost(results: Array<WriterPostResult>): {
  post: WriterPostFn;
  calls: Array<PostCall>;
} {
  const calls: Array<PostCall> = [];
  const post: WriterPostFn = async (
    args: PostCall,
  ): Promise<WriterPostResult> => {
    calls.push(args);
    const result: WriterPostResult | undefined = results.shift();
    if (!result) {
      throw new Error("no scripted result left");
    }
    return result;
  };
  return { post, calls };
}

describe("TelemetryWriterClient", () => {
  const savedUrl: string | undefined = process.env["TELEMETRY_WRITER_URL"];
  const savedTimeout: string | undefined =
    process.env["TELEMETRY_WRITER_REQUEST_TIMEOUT_MS"];

  beforeEach(() => {
    process.env["TELEMETRY_WRITER_URL"] = "http://telemetry-writer:3002";
    delete process.env["TELEMETRY_WRITER_REQUEST_TIMEOUT_MS"];
  });

  afterEach(() => {
    if (savedUrl === undefined) {
      delete process.env["TELEMETRY_WRITER_URL"];
    } else {
      process.env["TELEMETRY_WRITER_URL"] = savedUrl;
    }
    if (savedTimeout === undefined) {
      delete process.env["TELEMETRY_WRITER_REQUEST_TIMEOUT_MS"];
    } else {
      process.env["TELEMETRY_WRITER_REQUEST_TIMEOUT_MS"] = savedTimeout;
    }
  });

  describe("configuration", () => {
    test("forwarding is disabled when TELEMETRY_WRITER_URL is unset or blank", () => {
      delete process.env["TELEMETRY_WRITER_URL"];
      expect(getTelemetryWriterUrl()).toBeNull();
      expect(isTelemetryWriterForwardingEnabled()).toBe(false);

      process.env["TELEMETRY_WRITER_URL"] = "   ";
      expect(isTelemetryWriterForwardingEnabled()).toBe(false);
    });

    test("a trailing slash is normalized away", () => {
      process.env["TELEMETRY_WRITER_URL"] = "http://writer:3002/";
      expect(getTelemetryWriterUrl()).toBe("http://writer:3002");
    });

    test("request timeout defaults to 120s and honors the env override", () => {
      expect(getTelemetryWriterRequestTimeoutMs()).toBe(120_000);
      process.env["TELEMETRY_WRITER_REQUEST_TIMEOUT_MS"] = "5000";
      expect(getTelemetryWriterRequestTimeoutMs()).toBe(5000);
      process.env["TELEMETRY_WRITER_REQUEST_TIMEOUT_MS"] = "not-a-number";
      expect(getTelemetryWriterRequestTimeoutMs()).toBe(120_000);
    });
  });

  describe("request shape", () => {
    test("posts table, rows, token, and settings to the insert route", async () => {
      const { post, calls } = makePost([{ statusCode: 200 }]);
      const transport: FanInInsertTransport =
        createTelemetryWriterTransport(post);

      await transport(TARGET, [{ a: 1 }, { a: 2 }], {
        dedupToken: "job-1:LogTable:0",
        clickhouseSettings: { async_insert: 1 },
      });

      expect(calls).toHaveLength(1);
      expect(calls[0]!.url).toBe(
        `http://telemetry-writer:3002${TELEMETRY_WRITER_INSERT_ROUTE}`,
      );
      expect(calls[0]!.timeoutMs).toBe(120_000);
      expect(calls[0]!.body).toEqual({
        tableName: "LogTable",
        rows: [{ a: 1 }, { a: 2 }],
        dedupToken: "job-1:LogTable:0",
        clickhouseSettings: { async_insert: 1 },
      });
    });

    test("omits clickhouseSettings from the body when not set", async () => {
      const { post, calls } = makePost([{ statusCode: 200 }]);
      const transport: FanInInsertTransport =
        createTelemetryWriterTransport(post);

      await transport(TARGET, [{ a: 1 }], {
        dedupToken: "t",
        clickhouseSettings: undefined,
      });

      expect(
        Object.prototype.hasOwnProperty.call(
          calls[0]!.body,
          "clickhouseSettings",
        ),
      ).toBe(false);
    });

    test("throws a permanent error when the URL is not configured", async () => {
      delete process.env["TELEMETRY_WRITER_URL"];
      const { post } = makePost([]);
      const transport: FanInInsertTransport =
        createTelemetryWriterTransport(post);

      await expect(
        transport(TARGET, [{ a: 1 }], {
          dedupToken: "t",
          clickhouseSettings: undefined,
        }),
      ).rejects.toThrow("TELEMETRY_WRITER_URL is not configured");
    });
  });

  describe("status classification", () => {
    const transientStatuses: Array<number> = [429, 502, 503, 504, 0, -1];
    for (const status of transientStatuses) {
      test(`status ${status} throws TransientInsertError (retry, same token)`, async () => {
        const { post } = makePost([
          { statusCode: status, errorMessage: "nope" },
        ]);
        const transport: FanInInsertTransport =
          createTelemetryWriterTransport(post);

        await expect(
          transport(TARGET, [{ a: 1 }], {
            dedupToken: "t",
            clickhouseSettings: undefined,
          }),
        ).rejects.toBeInstanceOf(TransientInsertError);
      });
    }

    const permanentStatuses: Array<number> = [400, 401, 403, 422, 500];
    for (const status of permanentStatuses) {
      test(`status ${status} throws a permanent (non-transient) error`, async () => {
        const { post } = makePost([
          { statusCode: status, errorMessage: "bad" },
        ]);
        const transport: FanInInsertTransport =
          createTelemetryWriterTransport(post);

        const err: Error = await transport(TARGET, [{ a: 1 }], {
          dedupToken: "t",
          clickhouseSettings: undefined,
        }).then(
          () => {
            throw new Error("expected rejection");
          },
          (e: Error) => {
            return e;
          },
        );
        expect(err).not.toBeInstanceOf(TransientInsertError);
        expect(err.message).toContain(`status ${status}`);
        expect(err.message).toContain("LogTable");
      });
    }

    test("2xx resolves", async () => {
      const { post } = makePost([{ statusCode: 200 }]);
      const transport: FanInInsertTransport =
        createTelemetryWriterTransport(post);
      await expect(
        transport(TARGET, [{ a: 1 }], {
          dedupToken: "t",
          clickhouseSettings: undefined,
        }),
      ).resolves.toBeUndefined();
    });
  });
});
