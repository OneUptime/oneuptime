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
  const savedMaxBody: string | undefined =
    process.env["TELEMETRY_WRITER_MAX_BODY_BYTES"];

  beforeEach(() => {
    process.env["TELEMETRY_WRITER_URL"] = "http://telemetry-writer:3002";
    delete process.env["TELEMETRY_WRITER_REQUEST_TIMEOUT_MS"];
    delete process.env["TELEMETRY_WRITER_MAX_BODY_BYTES"];
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
    if (savedMaxBody === undefined) {
      delete process.env["TELEMETRY_WRITER_MAX_BODY_BYTES"];
    } else {
      process.env["TELEMETRY_WRITER_MAX_BODY_BYTES"] = savedMaxBody;
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

    test("request timeout defaults to 90s (under the BullMQ lock) and honors the env override", () => {
      expect(getTelemetryWriterRequestTimeoutMs()).toBe(90_000);
      process.env["TELEMETRY_WRITER_REQUEST_TIMEOUT_MS"] = "5000";
      expect(getTelemetryWriterRequestTimeoutMs()).toBe(5000);
      process.env["TELEMETRY_WRITER_REQUEST_TIMEOUT_MS"] = "not-a-number";
      expect(getTelemetryWriterRequestTimeoutMs()).toBe(90_000);
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
      expect(calls[0]!.timeoutMs).toBe(90_000);
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

  describe("byte-aware splitting", () => {
    test("a body over TELEMETRY_WRITER_MAX_BODY_BYTES splits into sequential halves with derived tokens", async () => {
      // The 4-row body serializes to ~98 bytes; a 90-byte cap forces one halving.
      process.env["TELEMETRY_WRITER_MAX_BODY_BYTES"] = "90";
      const { post, calls } = makePost([
        { statusCode: 200 },
        { statusCode: 200 },
      ]);
      const transport: FanInInsertTransport =
        createTelemetryWriterTransport(post);

      const rows: Array<JSONObject> = [{ a: 1 }, { a: 2 }, { a: 3 }, { a: 4 }];
      await transport(TARGET, rows, {
        dedupToken: "job-1:LogTable:0",
        clickhouseSettings: undefined,
      });

      expect(calls).toHaveLength(2);
      expect(calls[0]!.body["dedupToken"]).toBe("job-1:LogTable:0#0");
      expect(calls[0]!.body["rows"]).toEqual([{ a: 1 }, { a: 2 }]);
      expect(calls[1]!.body["dedupToken"]).toBe("job-1:LogTable:0#1");
      expect(calls[1]!.body["rows"]).toEqual([{ a: 3 }, { a: 4 }]);
    });

    test("splitting recurses until halves fit, keeping row order and deterministic tokens", async () => {
      process.env["TELEMETRY_WRITER_MAX_BODY_BYTES"] = "100";
      const results: Array<WriterPostResult> = [];
      for (let i: number = 0; i < 8; i++) {
        results.push({ statusCode: 200 });
      }
      const { post, calls } = makePost(results);
      const transport: FanInInsertTransport =
        createTelemetryWriterTransport(post);

      const rows: Array<JSONObject> = [];
      for (let i: number = 0; i < 8; i++) {
        rows.push({ padded: `row-${i}-xxxxxxxxxx` });
      }
      await transport(TARGET, rows, {
        dedupToken: "t",
        clickhouseSettings: undefined,
      });

      // All rows arrive exactly once, in order, across the splits.
      const seen: Array<JSONObject> = calls.flatMap((call: PostCall) => {
        return call.body["rows"] as Array<JSONObject>;
      });
      expect(seen).toEqual(rows);
      // Every posted body fits the cap, and tokens are unique per part.
      const tokens: Array<string> = calls.map((call: PostCall) => {
        return call.body["dedupToken"] as string;
      });
      expect(new Set(tokens).size).toBe(tokens.length);
      for (const call of calls) {
        expect(
          Buffer.byteLength(JSON.stringify(call.body), "utf8"),
        ).toBeLessThanOrEqual(100);
      }
    });

    test("a single oversized row is posted anyway (cannot be split)", async () => {
      process.env["TELEMETRY_WRITER_MAX_BODY_BYTES"] = "50";
      const { post, calls } = makePost([{ statusCode: 200 }]);
      const transport: FanInInsertTransport =
        createTelemetryWriterTransport(post);

      await transport(TARGET, [{ huge: "x".repeat(200) }], {
        dedupToken: "t",
        clickhouseSettings: undefined,
      });

      expect(calls).toHaveLength(1);
      expect(calls[0]!.body["dedupToken"]).toBe("t");
    });

    test("no split below the cap — token and rows pass through untouched", async () => {
      const { post, calls } = makePost([{ statusCode: 200 }]);
      const transport: FanInInsertTransport =
        createTelemetryWriterTransport(post);

      await transport(TARGET, [{ a: 1 }], {
        dedupToken: "plain-token",
        clickhouseSettings: undefined,
      });

      expect(calls).toHaveLength(1);
      expect(calls[0]!.body["dedupToken"]).toBe("plain-token");
    });
  });
});
