import {
  ShedCounterClient,
  getRecentShedCount,
  recordShed,
  shedBucketKey,
} from "../../../../Server/Utils/Telemetry/TelemetryWriterShedMetrics";
import { describe, expect, test } from "@jest/globals";

jest.mock("../../../../Server/Utils/Logger", () => {
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

/*
 * The KEDA scaling signal for the telemetry-writer tier: a Redis-backed,
 * minute-bucketed shed counter. All tests inject a fake client — no Redis.
 */

class FakeClient implements ShedCounterClient {
  public store: Map<string, string> = new Map();
  public ttls: Map<string, number> = new Map();
  public failNextCalls: boolean = false;

  public async incr(key: string): Promise<number> {
    if (this.failNextCalls) {
      throw new Error("redis down");
    }
    const next: number = parseInt(this.store.get(key) ?? "0", 10) + 1;
    this.store.set(key, String(next));
    return next;
  }

  public async expire(key: string, seconds: number): Promise<unknown> {
    if (this.failNextCalls) {
      throw new Error("redis down");
    }
    this.ttls.set(key, seconds);
    return 1;
  }

  public async get(key: string): Promise<string | null> {
    if (this.failNextCalls) {
      throw new Error("redis down");
    }
    return this.store.get(key) ?? null;
  }
}

// 2026-07-22T12:00:30Z — mid-minute so bucket boundaries are unambiguous.
const NOW: Date = new Date(1784721630000);
const NOW_MINUTE: number = Math.floor(NOW.getTime() / 60_000);

describe("recordShed", () => {
  test("increments the current minute bucket and stamps a TTL", async () => {
    const client: FakeClient = new FakeClient();

    await recordShed({ now: NOW, client });
    await recordShed({ now: NOW, client });

    const key: string = shedBucketKey(NOW_MINUTE);
    expect(client.store.get(key)).toBe("2");
    expect(client.ttls.get(key)).toBe(300);
  });

  test("sheds in different minutes land in different buckets", async () => {
    const client: FakeClient = new FakeClient();
    const nextMinute: Date = new Date(NOW.getTime() + 60_000);

    await recordShed({ now: NOW, client });
    await recordShed({ now: nextMinute, client });

    expect(client.store.get(shedBucketKey(NOW_MINUTE))).toBe("1");
    expect(client.store.get(shedBucketKey(NOW_MINUTE + 1))).toBe("1");
  });

  test("swallows Redis failures and a missing client", async () => {
    const client: FakeClient = new FakeClient();
    client.failNextCalls = true;

    await expect(recordShed({ now: NOW, client })).resolves.toBeUndefined();
    await expect(
      recordShed({ now: NOW, client: null }),
    ).resolves.toBeUndefined();
  });
});

describe("getRecentShedCount", () => {
  test("sums the current and previous minute buckets", async () => {
    const client: FakeClient = new FakeClient();
    client.store.set(shedBucketKey(NOW_MINUTE), "7");
    client.store.set(shedBucketKey(NOW_MINUTE - 1), "5");
    // An older bucket must NOT be counted.
    client.store.set(shedBucketKey(NOW_MINUTE - 2), "100");

    await expect(getRecentShedCount({ now: NOW, client })).resolves.toBe(12);
  });

  test("empty buckets read as zero", async () => {
    const client: FakeClient = new FakeClient();
    await expect(getRecentShedCount({ now: NOW, client })).resolves.toBe(0);
  });

  test("garbled bucket contents are ignored", async () => {
    const client: FakeClient = new FakeClient();
    client.store.set(shedBucketKey(NOW_MINUTE), "not-a-number");
    client.store.set(shedBucketKey(NOW_MINUTE - 1), "-4");

    await expect(getRecentShedCount({ now: NOW, client })).resolves.toBe(0);
  });

  test("returns 0 (not an error) when Redis is down or absent — biases KEDA against scaling on missing data", async () => {
    const client: FakeClient = new FakeClient();
    client.failNextCalls = true;

    await expect(getRecentShedCount({ now: NOW, client })).resolves.toBe(0);
    await expect(getRecentShedCount({ now: NOW, client: null })).resolves.toBe(
      0,
    );
  });
});
