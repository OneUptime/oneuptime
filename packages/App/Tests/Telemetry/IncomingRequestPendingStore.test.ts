/*
 * IncomingRequestPendingStore keeps every request an Incoming Request
 * monitor received that no worker has evaluated yet, oldest first, so the
 * monitor's one job can evaluate them in the order they arrived (#10582).
 * What it does is its Lua, so it runs here against a real Redis.
 *
 * It needs Redis: CI's test-setup.sh starts one on localhost:6310 and `npm
 * test` exports its settings from config.env. Locally, a disposable one:
 *
 *   docker run -d --rm -p 16379:6379 valkey/valkey:9.1-alpine
 *   VALKEY_HOST=localhost VALKEY_PORT=16379 \
 *     npx jest Tests/Telemetry/IncomingRequestPendingStore.test.ts
 *
 * Only random secret keys' lists are touched, and they are removed
 * afterwards.
 */

jest.mock("Common/Server/Utils/Logger", () => {
  return {
    __esModule: true,
    default: {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      trace: jest.fn(),
    },
  };
});

import IncomingRequestPendingStore, {
  MAX_PENDING_BYTES_PER_MONITOR,
  MAX_PENDING_REQUESTS_PER_MONITOR,
  PendingIncomingRequest,
  PushedIncomingRequest,
  SkippedIncomingRequests,
} from "../../FeatureSet/Telemetry/Utils/IncomingRequestPendingStore";
import { IncomingRequestIngestJobData } from "../../FeatureSet/Telemetry/Services/Queue/TelemetryQueueService";
import Redis, { ClientType } from "Common/Server/Infrastructure/Redis";
import logger from "Common/Server/Utils/Logger";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import { createHash } from "crypto";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

const DAY_IN_SECONDS: number = 24 * 60 * 60;

const secretKeys: Array<string> = [];

function client(): ClientType {
  return Redis.getClient()!;
}

function newMonitor(): { secretKey: string; hash: string } {
  const secretKey: string = ObjectID.generate().toString();
  secretKeys.push(secretKey);

  return {
    secretKey: secretKey,
    hash: IncomingRequestPendingStore.getSecretKeyHash(secretKey),
  };
}

function request(
  secretKey: string,
  body: JSONObject,
): IncomingRequestIngestJobData {
  return {
    secretKey: secretKey,
    requestHeaders: { "content-type": "application/json" },
    requestBody: body,
    requestMethod: "POST",
    ingestionTimestamp: new Date("2026-11-21T09:00:00.000Z"),
  };
}

// Keeps a request whose body says which one it is; returns its id.
async function push(
  secretKey: string,
  sequence: number,
  extra: JSONObject = {},
): Promise<string> {
  const requestId: string = `request-${sequence}-${ObjectID.generate().toString()}`;

  await IncomingRequestPendingStore.push({
    secretKey: secretKey,
    requestId: requestId,
    payload: request(secretKey, { sequence: sequence, ...extra }),
  });

  return requestId;
}

function sequenceOf(pending: PendingIncomingRequest | null): number | null {
  if (!pending) {
    return null;
  }

  return (pending.payload.requestBody as JSONObject)["sequence"] as number;
}

// The sequences waiting, oldest first, read without changing anything.
async function waitingSequences(hash: string): Promise<Array<number>> {
  const ids: Array<string> = await client().lrange(
    IncomingRequestPendingStore.getListKey(hash),
    0,
    -1,
  );

  const sequences: Array<number> = [];

  for (const id of ids) {
    const json: string | null = await client().hget(
      IncomingRequestPendingStore.getRequestsKey(hash),
      id,
    );

    sequences.push(
      (JSON.parse(json!) as { requestBody: JSONObject }).requestBody[
        "sequence"
      ] as number,
    );
  }

  return sequences;
}

async function storedBytes(hash: string): Promise<number> {
  return Number(
    (await client().hget(
      IncomingRequestPendingStore.getRequestsKey(hash),
      "bytes",
    )) || 0,
  );
}

async function keysExist(hash: string): Promise<{
  list: boolean;
  requests: boolean;
}> {
  return {
    list:
      (await client().exists(IncomingRequestPendingStore.getListKey(hash))) ===
      1,
    requests:
      (await client().exists(
        IncomingRequestPendingStore.getRequestsKey(hash),
      )) === 1,
  };
}

beforeAll(async () => {
  await Redis.connect();
});

afterAll(async () => {
  const keys: Array<string> = secretKeys.flatMap(
    (secretKey: string): Array<string> => {
      const hash: string =
        IncomingRequestPendingStore.getSecretKeyHash(secretKey);
      return [
        IncomingRequestPendingStore.getListKey(hash),
        IncomingRequestPendingStore.getRequestsKey(hash),
      ];
    },
  );

  if (keys.length > 0) {
    await client().del(...keys);
  }

  await Redis.disconnect();
});

beforeEach(() => {
  jest.clearAllMocks();
});

describe("IncomingRequestPendingStore keys", () => {
  test("a monitor's requests are named by the hash of its secret key, never the key itself", () => {
    const secretKey: string = "6f5c1f0e-8d2b-4b7a-9c3e-2a1d0b9e8f7c";
    const hash: string = createHash("sha256").update(secretKey).digest("hex");

    expect(IncomingRequestPendingStore.getSecretKeyHash(secretKey)).toBe(hash);
    expect(IncomingRequestPendingStore.getListKey(hash)).toBe(
      `incoming-request:pending:${hash}`,
    );
    expect(IncomingRequestPendingStore.getRequestsKey(hash)).toBe(
      `incoming-request:pending-requests:${hash}`,
    );
    expect(IncomingRequestPendingStore.getListKey(hash)).not.toContain(
      secretKey,
    );
  });

  test("the key as sent names it: another spelling of a key is another monitor's list", () => {
    expect(
      IncomingRequestPendingStore.getSecretKeyHash(
        "6F5C1F0E-8D2B-4B7A-9C3E-2A1D0B9E8F7C",
      ),
    ).not.toBe(
      IncomingRequestPendingStore.getSecretKeyHash(
        "6f5c1f0e-8d2b-4b7a-9c3e-2a1d0b9e8f7c",
      ),
    );
  });
});

describe("IncomingRequestPendingStore order", () => {
  test("requests wait in the order they were kept: the oldest first, the newest last", async () => {
    const { secretKey, hash } = newMonitor();

    for (let sequence: number = 1; sequence <= 5; sequence++) {
      await push(secretKey, sequence);
    }

    const oldest: PendingIncomingRequest | null =
      await IncomingRequestPendingStore.peekOldest(hash);
    const newest: PendingIncomingRequest | null =
      await IncomingRequestPendingStore.peekNewest(hash);

    expect(sequenceOf(oldest)).toBe(1);
    expect(sequenceOf(newest)).toBe(5);
    expect(oldest!.waiting).toBe(5);
    expect(newest!.waiting).toBe(5);
    expect(oldest!.failures).toBe(0);
    expect(oldest!.skipped).toEqual({ overLimit: 0, afterFailures: 0 });
    expect(await waitingSequences(hash)).toEqual([1, 2, 3, 4, 5]);
  });

  test("a request is read back exactly as it was kept", async () => {
    const { secretKey, hash } = newMonitor();
    const kept: IncomingRequestIngestJobData = {
      ...request(secretKey, { alertActiveID: 48214, status: "triggered" }),
      requestHeaders: { "content-type": "text/plain", "x-sender": "orion" },
      requestMethod: "GET",
      receivedViaProbeId: "1b0f9a52-3c47-4d0e-9b6a-7e2f1c8d5a43",
      presentedSecretHashes: ["abc"],
    };

    await IncomingRequestPendingStore.push({
      secretKey: secretKey,
      requestId: "the-request",
      payload: kept,
    });

    const oldest: PendingIncomingRequest | null =
      await IncomingRequestPendingStore.peekOldest(hash);

    expect(oldest!.requestId).toBe("the-request");
    expect(oldest!.payload).toEqual({
      ...kept,
      // A date travels as JSON, as it does on a job.
      ingestionTimestamp: kept.ingestionTimestamp.toISOString(),
    });
  });

  test("nothing waiting reads as null, at either end", async () => {
    const { hash } = newMonitor();

    expect(await IncomingRequestPendingStore.peekOldest(hash)).toBeNull();
    expect(await IncomingRequestPendingStore.peekNewest(hash)).toBeNull();
    expect(await IncomingRequestPendingStore.hasPending(hash)).toBe(false);
  });

  test("each monitor's requests wait apart from every other monitor's", async () => {
    const first: { secretKey: string; hash: string } = newMonitor();
    const second: { secretKey: string; hash: string } = newMonitor();

    await push(first.secretKey, 1);
    await push(second.secretKey, 10);
    await push(first.secretKey, 2);

    expect(await waitingSequences(first.hash)).toEqual([1, 2]);
    expect(await waitingSequences(second.hash)).toEqual([10]);
  });

  test("push says how many are waiting, this one included", async () => {
    const { secretKey } = newMonitor();

    const results: Array<PushedIncomingRequest> = [];

    for (let sequence: number = 1; sequence <= 3; sequence++) {
      results.push(
        await IncomingRequestPendingStore.push({
          secretKey: secretKey,
          requestId: `id-${sequence}`,
          payload: request(secretKey, { sequence: sequence }),
        }),
      );
    }

    expect(results).toEqual([
      { waiting: 1, skipped: 0 },
      { waiting: 2, skipped: 0 },
      { waiting: 3, skipped: 0 },
    ]);
  });
});

describe("IncomingRequestPendingStore removal", () => {
  test("remove takes exactly the request evaluated, and the next becomes the oldest", async () => {
    const { secretKey, hash } = newMonitor();
    const first: string = await push(secretKey, 1);
    await push(secretKey, 2);
    await push(secretKey, 3);

    expect(await IncomingRequestPendingStore.remove(hash, first)).toBe(true);

    expect(sequenceOf(await IncomingRequestPendingStore.peekOldest(hash))).toBe(
      2,
    );
    expect(await waitingSequences(hash)).toEqual([2, 3]);
    expect(
      await client().hexists(
        IncomingRequestPendingStore.getRequestsKey(hash),
        first,
      ),
    ).toBe(0);
  });

  test("a request removed already is not removed twice, and nothing else is", async () => {
    const { secretKey, hash } = newMonitor();
    const first: string = await push(secretKey, 1);
    await push(secretKey, 2);

    expect(await IncomingRequestPendingStore.remove(hash, first)).toBe(true);
    expect(await IncomingRequestPendingStore.remove(hash, first)).toBe(false);
    expect(await waitingSequences(hash)).toEqual([2]);
  });

  test("remove takes a request from wherever the list holds it", async () => {
    const { secretKey, hash } = newMonitor();
    await push(secretKey, 1);
    const middle: string = await push(secretKey, 2);
    await push(secretKey, 3);

    expect(await IncomingRequestPendingStore.remove(hash, middle)).toBe(true);
    expect(await waitingSequences(hash)).toEqual([1, 3]);
  });

  test("removeThrough takes every request up to and including the newest evaluated, and leaves the ones after it", async () => {
    const { secretKey, hash } = newMonitor();
    await push(secretKey, 1);
    await push(secretKey, 2);
    const third: string = await push(secretKey, 3);
    await push(secretKey, 4);

    expect(await IncomingRequestPendingStore.removeThrough(hash, third)).toBe(
      3,
    );
    expect(await waitingSequences(hash)).toEqual([4]);
  });

  test("removeThrough an id no longer waiting removes nothing", async () => {
    const { secretKey, hash } = newMonitor();
    await push(secretKey, 1);
    await push(secretKey, 2);

    expect(
      await IncomingRequestPendingStore.removeThrough(hash, "not-waiting"),
    ).toBe(0);
    expect(await waitingSequences(hash)).toEqual([1, 2]);
  });

  test("the bytes the requests take follow every push and removal", async () => {
    const { secretKey, hash } = newMonitor();
    const first: string = await push(secretKey, 1);
    const afterOne: number = await storedBytes(hash);
    const second: string = await push(secretKey, 2);
    const afterTwo: number = await storedBytes(hash);

    expect(afterOne).toBeGreaterThan(0);
    expect(afterTwo).toBeGreaterThan(afterOne);

    await IncomingRequestPendingStore.remove(hash, first);
    expect(await storedBytes(hash)).toBe(afterTwo - afterOne);

    await IncomingRequestPendingStore.remove(hash, second);
    // Emptied: nothing left of the monitor in Redis.
    expect(await keysExist(hash)).toEqual({ list: false, requests: false });
  });

  test("a monitor whose list emptied holds no keys", async () => {
    const { secretKey, hash } = newMonitor();
    await push(secretKey, 1);
    const last: string = await push(secretKey, 2);

    await IncomingRequestPendingStore.removeThrough(hash, last);

    expect(await keysExist(hash)).toEqual({ list: false, requests: false });
    expect(await IncomingRequestPendingStore.hasPending(hash)).toBe(false);
  });
});

describe("IncomingRequestPendingStore failures", () => {
  test("each failed evaluation is counted on its request, and read back with it", async () => {
    const { secretKey, hash } = newMonitor();
    const first: string = await push(secretKey, 1);

    expect(await IncomingRequestPendingStore.countFailure(hash, first)).toBe(1);
    expect(await IncomingRequestPendingStore.countFailure(hash, first)).toBe(2);

    const oldest: PendingIncomingRequest | null =
      await IncomingRequestPendingStore.peekOldest(hash);
    expect(oldest!.failures).toBe(2);
  });

  test("a failure of a request no longer waiting is not counted", async () => {
    const { secretKey, hash } = newMonitor();
    const first: string = await push(secretKey, 1);
    await IncomingRequestPendingStore.remove(hash, first);

    expect(await IncomingRequestPendingStore.countFailure(hash, first)).toBe(0);
  });

  test("a request skipped after failing is removed, with its count, and counted as skipped", async () => {
    const { secretKey, hash } = newMonitor();
    const first: string = await push(secretKey, 1);
    await push(secretKey, 2);
    await IncomingRequestPendingStore.countFailure(hash, first);

    expect(
      await IncomingRequestPendingStore.skipAfterFailures(hash, first),
    ).toBe(true);

    const oldest: PendingIncomingRequest | null =
      await IncomingRequestPendingStore.peekOldest(hash);

    expect(sequenceOf(oldest)).toBe(2);
    expect(oldest!.skipped).toEqual({ overLimit: 0, afterFailures: 1 });
    expect(
      await client().hexists(
        IncomingRequestPendingStore.getRequestsKey(hash),
        `failures:${first}`,
      ),
    ).toBe(0);
  });

  test("a request evaluated already cannot be skipped, nor counted as skipped", async () => {
    const { secretKey, hash } = newMonitor();
    const first: string = await push(secretKey, 1);
    await push(secretKey, 2);
    await IncomingRequestPendingStore.remove(hash, first);

    expect(
      await IncomingRequestPendingStore.skipAfterFailures(hash, first),
    ).toBe(false);
    expect(await IncomingRequestPendingStore.getSkipped(hash)).toEqual({
      overLimit: 0,
      afterFailures: 0,
    });
  });
});

describe("IncomingRequestPendingStore limits", () => {
  test(`past ${MAX_PENDING_REQUESTS_PER_MONITOR} waiting, the oldest waiting are skipped and counted - never the oldest of all, which a job may be evaluating, nor the newest`, async () => {
    const { secretKey, hash } = newMonitor();
    const extra: number = 25;

    let skippedByPushes: number = 0;

    for (
      let sequence: number = 1;
      sequence <= MAX_PENDING_REQUESTS_PER_MONITOR + extra;
      sequence++
    ) {
      const pushed: PushedIncomingRequest =
        await IncomingRequestPendingStore.push({
          secretKey: secretKey,
          requestId: `id-${sequence}`,
          payload: request(secretKey, { sequence: sequence }),
        });

      expect(pushed.waiting).toBeLessThanOrEqual(
        MAX_PENDING_REQUESTS_PER_MONITOR,
      );
      skippedByPushes += pushed.skipped;
    }

    const sequences: Array<number> = await waitingSequences(hash);

    expect(sequences).toHaveLength(MAX_PENDING_REQUESTS_PER_MONITOR);
    // The oldest of all stays; requests 2 to 26 were skipped.
    expect(sequences[0]).toBe(1);
    expect(sequences[1]).toBe(extra + 2);
    expect(sequences[sequences.length - 1]).toBe(
      MAX_PENDING_REQUESTS_PER_MONITOR + extra,
    );
    expect(skippedByPushes).toBe(extra);
    expect(await IncomingRequestPendingStore.getSkipped(hash)).toEqual({
      overLimit: extra,
      afterFailures: 0,
    });

    // A skipped request's payload is gone too.
    expect(
      await client().hexists(
        IncomingRequestPendingStore.getRequestsKey(hash),
        "id-2",
      ),
    ).toBe(0);
  });

  test("past the bytes a monitor keeps, the oldest waiting are skipped too", async () => {
    const { secretKey, hash } = newMonitor();
    // Three requests of 6 MB: the third takes the monitor past 16 MB.
    const large: string = "x".repeat(6 * 1024 * 1024);

    await push(secretKey, 1, { large: large });
    await push(secretKey, 2, { large: large });

    const third: PushedIncomingRequest = await IncomingRequestPendingStore.push(
      {
        secretKey: secretKey,
        requestId: "third",
        payload: request(secretKey, { sequence: 3, large: large }),
      },
    );

    expect(third).toEqual({ waiting: 2, skipped: 1 });
    expect(await waitingSequences(hash)).toEqual([1, 3]);
    expect(await storedBytes(hash)).toBeLessThanOrEqual(
      MAX_PENDING_BYTES_PER_MONITOR,
    );
    expect((await IncomingRequestPendingStore.getSkipped(hash)).overLimit).toBe(
      1,
    );
  });

  test("a request larger than the bytes a monitor keeps is still kept whole: it is the newest", async () => {
    const { secretKey, hash } = newMonitor();
    const huge: string = "y".repeat(MAX_PENDING_BYTES_PER_MONITOR + 1024);

    await push(secretKey, 1);
    await push(secretKey, 2);
    await push(secretKey, 3, { huge: huge });

    // The one a job may be evaluating and the newest: 2 is skipped.
    expect(await waitingSequences(hash)).toEqual([1, 3]);

    const newest: PendingIncomingRequest | null =
      await IncomingRequestPendingStore.peekNewest(hash);
    expect((newest!.payload.requestBody as JSONObject)["huge"]).toBe(huge);
  });
});

describe("IncomingRequestPendingStore skipped requests to report", () => {
  test("what the monitor's log said is taken off what is left to say; the rest is kept", async () => {
    const { secretKey, hash } = newMonitor();
    const first: string = await push(secretKey, 1);
    const second: string = await push(secretKey, 2);
    await push(secretKey, 3);

    await IncomingRequestPendingStore.skipAfterFailures(hash, first);
    await IncomingRequestPendingStore.skipAfterFailures(hash, second);

    const said: SkippedIncomingRequests = { overLimit: 0, afterFailures: 1 };
    await IncomingRequestPendingStore.acknowledgeSkipped(hash, said);

    expect(await IncomingRequestPendingStore.getSkipped(hash)).toEqual({
      overLimit: 0,
      afterFailures: 1,
    });

    await IncomingRequestPendingStore.acknowledgeSkipped(hash, said);

    expect(await IncomingRequestPendingStore.getSkipped(hash)).toEqual({
      overLimit: 0,
      afterFailures: 0,
    });
    // A count said in full leaves no field behind.
    expect(
      await client().hexists(
        IncomingRequestPendingStore.getRequestsKey(hash),
        "skippedAfterFailures",
      ),
    ).toBe(0);
  });

  test("an empty list keeps what is left to say, and is deleted once it is said", async () => {
    const { secretKey, hash } = newMonitor();
    const first: string = await push(secretKey, 1);
    const second: string = await push(secretKey, 2);

    await IncomingRequestPendingStore.skipAfterFailures(hash, first);
    await IncomingRequestPendingStore.remove(hash, second);

    expect(await keysExist(hash)).toEqual({ list: false, requests: true });
    expect(await IncomingRequestPendingStore.getSkipped(hash)).toEqual({
      overLimit: 0,
      afterFailures: 1,
    });

    await IncomingRequestPendingStore.acknowledgeSkipped(hash, {
      overLimit: 0,
      afterFailures: 1,
    });

    expect(await keysExist(hash)).toEqual({ list: false, requests: false });
  });

  test("saying nothing touches nothing", async () => {
    const { secretKey, hash } = newMonitor();
    await push(secretKey, 1);

    await IncomingRequestPendingStore.acknowledgeSkipped(hash, {
      overLimit: 0,
      afterFailures: 0,
    });

    expect(await waitingSequences(hash)).toEqual([1]);
  });

  test("an acknowledgement that cannot reach Redis is logged, never thrown: the count is said again", async () => {
    const { hash } = newMonitor();
    const isConnected: jest.SpiedFunction<typeof Redis.isConnected> = jest
      .spyOn(Redis, "isConnected")
      .mockReturnValue(false);

    try {
      await expect(
        IncomingRequestPendingStore.acknowledgeSkipped(hash, {
          overLimit: 1,
          afterFailures: 0,
        }),
      ).resolves.toBeUndefined();
    } finally {
      isConnected.mockRestore();
    }

    expect(logger.warn).toHaveBeenCalled();
  });
});

describe("IncomingRequestPendingStore expiry and damage", () => {
  test("both keys expire a day after the monitor's last request, and every push re-arms them", async () => {
    const { secretKey, hash } = newMonitor();
    await push(secretKey, 1);

    await client().expire(IncomingRequestPendingStore.getListKey(hash), 60);
    await client().expire(IncomingRequestPendingStore.getRequestsKey(hash), 60);

    await push(secretKey, 2);

    for (const key of [
      IncomingRequestPendingStore.getListKey(hash),
      IncomingRequestPendingStore.getRequestsKey(hash),
    ]) {
      const ttl: number = await client().ttl(key);
      expect(ttl).toBeGreaterThan(DAY_IN_SECONDS - 60);
      expect(ttl).toBeLessThanOrEqual(DAY_IN_SECONDS);
    }

    expect(IncomingRequestPendingStore.TTL_SECONDS).toBe(DAY_IN_SECONDS);
  });

  test("a listed request whose payload is gone is removed, said in the log, and the next one read", async () => {
    const { secretKey, hash } = newMonitor();
    const first: string = await push(secretKey, 1);
    await push(secretKey, 2);

    await client().hdel(
      IncomingRequestPendingStore.getRequestsKey(hash),
      first,
    );

    const oldest: PendingIncomingRequest | null =
      await IncomingRequestPendingStore.peekOldest(hash);

    expect(sequenceOf(oldest)).toBe(2);
    expect(oldest!.waiting).toBe(1);
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining("lost from Redis"),
    );
  });

  test("a request that cannot be read is skipped, counted, and the next one read", async () => {
    const { secretKey, hash } = newMonitor();
    const first: string = await push(secretKey, 1);
    await push(secretKey, 2);

    await client().hset(
      IncomingRequestPendingStore.getRequestsKey(hash),
      first,
      "{not json",
    );

    const oldest: PendingIncomingRequest | null =
      await IncomingRequestPendingStore.peekOldest(hash);

    expect(sequenceOf(oldest)).toBe(2);
    expect(oldest!.skipped.afterFailures).toBe(1);
    expect(await waitingSequences(hash)).toEqual([2]);
  });

  test("a request that is not an object is skipped the same way", async () => {
    const { secretKey, hash } = newMonitor();
    const first: string = await push(secretKey, 1);

    await client().hset(
      IncomingRequestPendingStore.getRequestsKey(hash),
      first,
      "[1,2,3]",
    );

    expect(await IncomingRequestPendingStore.peekOldest(hash)).toBeNull();
    expect(await IncomingRequestPendingStore.getSkipped(hash)).toEqual({
      overLimit: 0,
      afterFailures: 1,
    });
  });

  test("a push that cannot reach Redis throws, so the endpoint answers 503 rather than lose it", async () => {
    const { secretKey } = newMonitor();
    const isConnected: jest.SpiedFunction<typeof Redis.isConnected> = jest
      .spyOn(Redis, "isConnected")
      .mockReturnValue(false);

    try {
      await expect(
        IncomingRequestPendingStore.push({
          secretKey: secretKey,
          requestId: "never-kept",
          payload: request(secretKey, { sequence: 1 }),
        }),
      ).rejects.toThrow("Redis is not connected");
    } finally {
      isConnected.mockRestore();
    }
  });
});
