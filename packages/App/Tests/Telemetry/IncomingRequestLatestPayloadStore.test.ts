/*
 * IncomingRequestLatestPayloadStore keeps the newest unevaluated request of
 * each Incoming Request monitor, so a coalesced ingest job evaluates that
 * rather than whichever request happened to create the job.
 *
 * These cover what the store sends to Redis and how it reads the answers.
 * The Lua it relies on (replace-with-expiry, clear-only-if-unchanged) is run
 * against a real Redis in IncomingRequestCoalescingRedis.test.ts.
 */

jest.mock("Common/Server/Infrastructure/Redis", () => {
  return {
    __esModule: true,
    default: {
      getClient: jest.fn(),
      isConnected: jest.fn(),
    },
  };
});

jest.mock("Common/Server/Utils/Logger", () => {
  return {
    __esModule: true,
    default: {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    },
  };
});

import IncomingRequestLatestPayloadStore, {
  LatestIncomingRequestPayload,
} from "../../FeatureSet/Telemetry/Utils/IncomingRequestLatestPayloadStore";
import { IncomingRequestIngestJobData } from "../../FeatureSet/Telemetry/Services/Queue/TelemetryQueueService";
import Redis from "Common/Server/Infrastructure/Redis";
import logger from "Common/Server/Utils/Logger";
import { createHash } from "crypto";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

const SECRET_KEY: string = "2d229271-17c4-4b4f-9a3b-3c6ff1a1a2ee";
const OTHER_SECRET_KEY: string = "7b1e0c55-3f0e-4d1a-8f43-0d6a2b9c4e11";
const PAYLOAD_ID: string = "0f6a7a3e-5d8e-4f63-9a8c-6c2a1e7b9d10";
const DAY_IN_SECONDS: number = 24 * 60 * 60;

type MockClient = {
  eval: jest.Mock;
  hmget: jest.Mock;
};

let client: MockClient;

function request(
  overrides: Partial<IncomingRequestIngestJobData> = {},
): IncomingRequestIngestJobData {
  return {
    secretKey: SECRET_KEY,
    requestHeaders: { "content-type": "application/json" },
    requestBody: { status: "resolved", alerts: [{ fingerprint: "abc" }] },
    requestMethod: "POST",
    ingestionTimestamp: new Date("2026-10-05T12:19:00.000Z"),
    coalescedPayloadId: PAYLOAD_ID,
    ...overrides,
  };
}

function expectedKey(secretKey: string): string {
  return `incoming-request:latest-payload:${createHash("sha256").update(secretKey).digest("hex")}`;
}

beforeEach(() => {
  client = {
    eval: jest.fn(() => {
      return Promise.resolve(1);
    }) as unknown as jest.Mock,
    hmget: jest.fn(() => {
      return Promise.resolve([null, null]);
    }) as unknown as jest.Mock,
  };

  jest.mocked(Redis.getClient).mockReturnValue(client as never);
  jest.mocked(Redis.isConnected).mockReturnValue(true);
});

afterEach(() => {
  jest.clearAllMocks();
});

describe("IncomingRequestLatestPayloadStore.getKey", () => {
  test("never spells the secret key out in the Redis key name", () => {
    const key: string = IncomingRequestLatestPayloadStore.getKey(SECRET_KEY);

    expect(key).toBe(expectedKey(SECRET_KEY));
    expect(key).not.toContain(SECRET_KEY);
  });

  test("one slot per monitor: the same key for the same secret, another for another", () => {
    expect(IncomingRequestLatestPayloadStore.getKey(SECRET_KEY)).toBe(
      IncomingRequestLatestPayloadStore.getKey(SECRET_KEY),
    );
    expect(IncomingRequestLatestPayloadStore.getKey(SECRET_KEY)).not.toBe(
      IncomingRequestLatestPayloadStore.getKey(OTHER_SECRET_KEY),
    );
  });

  /*
   * The slot belongs to a coalescing group, and the group is the job's
   * deduplication id, which carries the secret key exactly as it was sent.
   * Two spellings are two groups, so they must be two slots: a shared slot
   * would be evaluated by two jobs at once, and the older request could be
   * evaluated after the newer one.
   */
  test("is keyed exactly like the job's deduplication id, so case matters", () => {
    expect(
      IncomingRequestLatestPayloadStore.getKey(SECRET_KEY.toUpperCase()),
    ).not.toBe(IncomingRequestLatestPayloadStore.getKey(SECRET_KEY));
  });
});

describe("IncomingRequestLatestPayloadStore.store", () => {
  test("replaces the slot with the request and arms a one-day expiry in one evaluation", async () => {
    const payload: IncomingRequestIngestJobData = request();

    await IncomingRequestLatestPayloadStore.store({
      secretKey: SECRET_KEY,
      payloadId: PAYLOAD_ID,
      payload,
    });

    expect(client.eval).toHaveBeenCalledTimes(1);

    const args: Array<unknown> = client.eval.mock.calls[0]!;
    const script: string = args[0] as string;

    expect(script).toContain("HSET");
    expect(script).toContain("EXPIRE");
    expect(args[1]).toBe(1);
    expect(args[2]).toBe(expectedKey(SECRET_KEY));
    expect(args[3]).toBe(PAYLOAD_ID);
    expect(JSON.parse(args[4] as string)).toEqual(
      JSON.parse(JSON.stringify(payload)),
    );
    expect(args[5]).toBe(String(DAY_IN_SECONDS));
    expect(IncomingRequestLatestPayloadStore.TTL_SECONDS).toBe(DAY_IN_SECONDS);
  });

  test("keeps a plain-text body as text", async () => {
    await IncomingRequestLatestPayloadStore.store({
      secretKey: SECRET_KEY,
      payloadId: PAYLOAD_ID,
      payload: request({ requestBody: "ping", requestMethod: "GET" }),
    });

    const stored: IncomingRequestIngestJobData = JSON.parse(
      client.eval.mock.calls[0]![4] as string,
    ) as IncomingRequestIngestJobData;

    expect(stored.requestBody).toBe("ping");
    expect(stored.requestMethod).toBe("GET");
  });

  /*
   * The caller adds the job only after the request is stored. Answering a
   * missing Redis with a quiet no-op would queue a job whose request is not
   * there, and that job would evaluate nothing.
   */
  test("throws when Redis is not connected, without writing", async () => {
    jest.mocked(Redis.isConnected).mockReturnValue(false);

    await expect(
      IncomingRequestLatestPayloadStore.store({
        secretKey: SECRET_KEY,
        payloadId: PAYLOAD_ID,
        payload: request(),
      }),
    ).rejects.toThrow("Redis not connected");

    expect(client.eval).not.toHaveBeenCalled();
  });

  test("throws when there is no Redis client", async () => {
    jest.mocked(Redis.getClient).mockReturnValue(null);

    await expect(
      IncomingRequestLatestPayloadStore.store({
        secretKey: SECRET_KEY,
        payloadId: PAYLOAD_ID,
        payload: request(),
      }),
    ).rejects.toThrow("Redis not connected");
  });

  test("passes a Redis error on", async () => {
    client.eval.mockImplementation(() => {
      return Promise.reject(new Error("OOM command not allowed"));
    });

    await expect(
      IncomingRequestLatestPayloadStore.store({
        secretKey: SECRET_KEY,
        payloadId: PAYLOAD_ID,
        payload: request(),
      }),
    ).rejects.toThrow("OOM command not allowed");
  });
});

describe("IncomingRequestLatestPayloadStore.getLatest", () => {
  test("reads the id and the request of the monitor's slot", async () => {
    const payload: IncomingRequestIngestJobData = request();

    client.hmget.mockImplementation(() => {
      return Promise.resolve([PAYLOAD_ID, JSON.stringify(payload)]);
    });

    const latest: LatestIncomingRequestPayload | null =
      await IncomingRequestLatestPayloadStore.getLatest(SECRET_KEY);

    expect(client.hmget).toHaveBeenCalledWith(
      expectedKey(SECRET_KEY),
      "id",
      "payload",
    );
    expect(latest).not.toBeNull();
    expect(latest!.payloadId).toBe(PAYLOAD_ID);
    expect(latest!.payload).toEqual(JSON.parse(JSON.stringify(payload)));
    // JSON round trip: the worker reads the arrival time back as a string.
    expect(latest!.payload.ingestionTimestamp).toBe("2026-10-05T12:19:00.000Z");
  });

  test("answers null when the monitor has no unevaluated request", async () => {
    await expect(
      IncomingRequestLatestPayloadStore.getLatest(SECRET_KEY),
    ).resolves.toBeNull();
  });

  test.each([
    ["the id", [null, JSON.stringify(request())]],
    ["the request", [PAYLOAD_ID, null]],
    ["both, as empty strings", ["", ""]],
  ])(
    "answers null when the slot is missing %s",
    async (_name: string, reply: Array<string | null>) => {
      client.hmget.mockImplementation(() => {
        return Promise.resolve(reply);
      });

      await expect(
        IncomingRequestLatestPayloadStore.getLatest(SECRET_KEY),
      ).resolves.toBeNull();
    },
  );

  /*
   * A slot that cannot be parsed can never be evaluated, and retrying the
   * job would not change that: it is reported and skipped, and the monitor's
   * next request replaces it.
   */
  test.each([
    ["is not JSON", "{not json"],
    ["is a JSON array", "[1,2,3]"],
    ["is a JSON string", '"text"'],
    ["is JSON null", "null"],
  ])(
    "skips a stored request that %s",
    async (_name: string, payloadJson: string) => {
      client.hmget.mockImplementation(() => {
        return Promise.resolve([PAYLOAD_ID, payloadJson]);
      });

      await expect(
        IncomingRequestLatestPayloadStore.getLatest(SECRET_KEY),
      ).resolves.toBeNull();
      expect(logger.error).toHaveBeenCalled();
    },
  );

  /*
   * A read that cannot happen must fail the job so BullMQ retries it. A null
   * here would complete the job as if a newer request had already been
   * evaluated, and the monitor's newest request would never be.
   */
  test("throws when Redis is not connected", async () => {
    jest.mocked(Redis.isConnected).mockReturnValue(false);

    await expect(
      IncomingRequestLatestPayloadStore.getLatest(SECRET_KEY),
    ).rejects.toThrow("Redis not connected");
    expect(client.hmget).not.toHaveBeenCalled();
  });

  test("passes a Redis error on", async () => {
    client.hmget.mockImplementation(() => {
      return Promise.reject(new Error("connection reset"));
    });

    await expect(
      IncomingRequestLatestPayloadStore.getLatest(SECRET_KEY),
    ).rejects.toThrow("connection reset");
  });
});

describe("IncomingRequestLatestPayloadStore.clearIfUnchanged", () => {
  test("clears the slot only while it still holds the evaluated request", async () => {
    await expect(
      IncomingRequestLatestPayloadStore.clearIfUnchanged({
        secretKey: SECRET_KEY,
        payloadId: PAYLOAD_ID,
      }),
    ).resolves.toBe(true);

    expect(client.eval).toHaveBeenCalledTimes(1);

    const args: Array<unknown> = client.eval.mock.calls[0]!;
    const script: string = args[0] as string;

    // Compare and delete in one evaluation, never a bare DEL.
    expect(script).toContain("HGET");
    expect(script).toContain("== ARGV[1]");
    expect(script).toContain("DEL");
    expect(args[1]).toBe(1);
    expect(args[2]).toBe(expectedKey(SECRET_KEY));
    expect(args[3]).toBe(PAYLOAD_ID);
  });

  test("reports a slot a newer request replaced as not cleared", async () => {
    client.eval.mockImplementation(() => {
      return Promise.resolve(0);
    });

    await expect(
      IncomingRequestLatestPayloadStore.clearIfUnchanged({
        secretKey: SECRET_KEY,
        payloadId: PAYLOAD_ID,
      }),
    ).resolves.toBe(false);
  });

  /*
   * The request was already evaluated. Leaving the slot behind is harmless
   * (the next request replaces it, the expiry reclaims it); failing the job
   * would evaluate it again.
   */
  test("never throws: a Redis error leaves the slot to expire", async () => {
    client.eval.mockImplementation(() => {
      return Promise.reject(new Error("connection reset"));
    });

    await expect(
      IncomingRequestLatestPayloadStore.clearIfUnchanged({
        secretKey: SECRET_KEY,
        payloadId: PAYLOAD_ID,
      }),
    ).resolves.toBe(false);
    expect(logger.warn).toHaveBeenCalled();
  });

  test("never throws: no Redis leaves the slot to expire", async () => {
    jest.mocked(Redis.isConnected).mockReturnValue(false);

    await expect(
      IncomingRequestLatestPayloadStore.clearIfUnchanged({
        secretKey: SECRET_KEY,
        payloadId: PAYLOAD_ID,
      }),
    ).resolves.toBe(false);
    expect(client.eval).not.toHaveBeenCalled();
  });
});
