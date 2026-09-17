import GlobalCache from "../../../../Server/Infrastructure/GlobalCache";
import ResourceHeartbeat from "../../../../Server/Utils/Telemetry/ResourceHeartbeat";
import SingleFlight from "../../../../Server/Utils/SingleFlight";
import ObjectID from "../../../../Types/ObjectID";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * The time-based L1 in front of ResourceHeartbeat's Redis gate cascade.
 *
 * SingleFlight already collapses CONCURRENT duplicate heartbeats, but every
 * SEQUENTIAL batch — the next job for the same host a second later — still
 * paid 1-3 serialized Redis round trips (liveness SET NX, fingerprint
 * compare-and-claim, rate-limit SET NX) to learn "nothing to do". The memo
 * remembers a SETTLED heartbeat for (resource, fingerprint) for
 * min(60s, liveness window) so those batches cost zero network round trips.
 *
 * What is pinned here, in order of importance:
 *
 *   1. A repeat identical heartbeat inside the window touches NEITHER Redis
 *      nor Postgres — the whole point of the change.
 *   2. The memo expires with the window: after it, Redis is consulted again.
 *   3. A CHANGED fingerprint bypasses the memo, so the change-promptness
 *      contract of the compare-and-claim gate is untouched.
 *   4. Outcomes that must retry are never memoized: a failed metadata write,
 *      a lock-skipped enrichment write, and any outcome where a gate probe
 *      threw (a Redis outage must keep failing open per batch — memoizing
 *      an outage outcome would suppress liveness for a healthy resource).
 *
 * The gates are modelled faithfully (SET NX only succeeds on an absent key,
 * compare-and-claim only on a differing value) — same discipline as the
 * neighbouring heartbeat suites, and for the same reason: a stubbed-constant
 * gate would let this suite agree with a memo that breaks the throttle.
 */

const RESOURCE_ID: ObjectID = ObjectID.generate();
const NAMESPACE: string = "heartbeat-memo-test-last-seen";
const WINDOW_SECONDS: number = 60;

type WriteCall = { id: ObjectID; data: Record<string, unknown> };

let cache: Map<string, string>;
let writes: Array<WriteCall>;
let writeLands: boolean;
let writeThrows: boolean;
let nowMs: number;

/** The service seam ResourceHeartbeat writes through, recording instead. */
/* eslint-disable @typescript-eslint/no-explicit-any */
const fakeService: any = {
  updateColumnsByIdIfUnlockedWithoutHooks: async (input: {
    id: ObjectID;
    data: unknown;
  }): Promise<boolean> => {
    writes.push({
      id: input.id,
      data: { ...(input.data as Record<string, unknown>) },
    });
    if (
      writeThrows &&
      Object.keys(writes[writes.length - 1]!.data).length > 1
    ) {
      throw new Error("value too long for type character varying(100)");
    }
    return writeLands;
  },
};
/* eslint-enable @typescript-eslint/no-explicit-any */

function gateCallCount(): number {
  return (
    (GlobalCache.setStringIfNotExists as jest.Mock).mock.calls.length +
    (GlobalCache.setStringIfChanged as jest.Mock).mock.calls.length
  );
}

async function heartbeat(input?: {
  fingerprint?: string;
  metadata?: Record<string, unknown>;
  throttleInSeconds?: number;
}): Promise<void> {
  await ResourceHeartbeat.write({
    service: fakeService,
    id: RESOURCE_ID,
    cacheNamespace: NAMESPACE,
    throttleInSeconds: input?.throttleInSeconds ?? WINDOW_SECONDS,
    liveness: { lastSeenAt: "now" } as never,
    metadata: (input?.metadata ?? undefined) as never,
    fingerprint: input?.fingerprint ?? "fp-default",
    describe: `test resource ${RESOURCE_ID.toString()}`,
  });
}

describe("ResourceHeartbeat recent-heartbeat L1 memo", () => {
  beforeEach(() => {
    cache = new Map<string, string>();
    writes = [];
    writeLands = true;
    writeThrows = false;
    nowMs = 1_700_000_000_000;

    SingleFlight.clear();
    ResourceHeartbeat.clearRecentHeartbeatMemo();

    jest.spyOn(Date, "now").mockImplementation(() => {
      return nowMs;
    });

    jest
      .spyOn(GlobalCache, "setStringIfNotExists")
      .mockImplementation(
        async (namespace: string, key: string, value: string) => {
          const full: string = `${namespace}:${key}`;
          if (cache.has(full)) {
            return false;
          }
          cache.set(full, value);
          return true;
        },
      );
    jest
      .spyOn(GlobalCache, "setStringIfChanged")
      .mockImplementation(
        async (namespace: string, key: string, value: string) => {
          const full: string = `${namespace}:${key}`;
          if (cache.get(full) === value) {
            return false;
          }
          cache.set(full, value);
          return true;
        },
      );
    jest
      .spyOn(GlobalCache, "deleteKey")
      .mockImplementation(async (namespace: string, key: string) => {
        cache.delete(`${namespace}:${key}`);
      });
  });

  afterEach(() => {
    jest.restoreAllMocks();
    SingleFlight.clear();
    ResourceHeartbeat.clearRecentHeartbeatMemo();
  });

  describe("the settled-heartbeat skip", () => {
    test("a repeat identical heartbeat touches neither Redis nor Postgres", async () => {
      await heartbeat({ metadata: { osType: "linux" }, fingerprint: "fp-a" });

      const gatesAfterFirst: number = gateCallCount();
      const writesAfterFirst: number = writes.length;
      expect(writesAfterFirst).toBe(1);

      await heartbeat({ metadata: { osType: "linux" }, fingerprint: "fp-a" });
      await heartbeat({ metadata: { osType: "linux" }, fingerprint: "fp-a" });

      expect(gateCallCount()).toBe(gatesAfterFirst);
      expect(writes).toHaveLength(writesAfterFirst);
    });

    test("a liveness-only heartbeat (no metadata) is memoized too", async () => {
      await heartbeat();
      const gatesAfterFirst: number = gateCallCount();

      await heartbeat();

      expect(gateCallCount()).toBe(gatesAfterFirst);
      expect(writes).toHaveLength(1);
    });

    test("a refused window is memoized after ONE probe — the steady state costs one round trip per window", async () => {
      /*
       * Another pod already holds the liveness gate and the fingerprint is
       * already stored: this pod's first batch probes and is refused, and
       * every later batch in the window must not re-ask.
       */
      cache.set(`${NAMESPACE}:${RESOURCE_ID.toString()}`, "1");
      cache.set(`${NAMESPACE}-fingerprint:${RESOURCE_ID.toString()}`, "fp-a");

      await heartbeat({ metadata: { osType: "linux" }, fingerprint: "fp-a" });
      const gatesAfterFirst: number = gateCallCount();
      expect(writes).toHaveLength(0);

      await heartbeat({ metadata: { osType: "linux" }, fingerprint: "fp-a" });

      expect(gateCallCount()).toBe(gatesAfterFirst);
      expect(writes).toHaveLength(0);
    });

    test("different resources do not share an entry", async () => {
      await heartbeat();

      const otherId: ObjectID = ObjectID.generate();
      await ResourceHeartbeat.write({
        service: fakeService,
        id: otherId,
        cacheNamespace: NAMESPACE,
        throttleInSeconds: WINDOW_SECONDS,
        liveness: { lastSeenAt: "now" } as never,
        metadata: undefined as never,
        fingerprint: "fp-default",
        describe: `test resource ${otherId.toString()}`,
      });

      // Both wrote — the second resource was not suppressed by the first's memo.
      expect(writes).toHaveLength(2);
    });
  });

  describe("memo lifetime", () => {
    test("expires with the window: Redis is consulted again afterwards", async () => {
      await heartbeat();
      const gatesAfterFirst: number = gateCallCount();

      nowMs += WINDOW_SECONDS * 1000 + 1;
      await heartbeat();

      expect(gateCallCount()).toBeGreaterThan(gatesAfterFirst);
    });

    test("is capped at the caller's own window when that is shorter than 60s", async () => {
      await heartbeat({ throttleInSeconds: 10 });
      const gatesAfterFirst: number = gateCallCount();

      // 11s later the 10s window may have reopened; the memo must not outlive it.
      nowMs += 11 * 1000;
      await heartbeat({ throttleInSeconds: 10 });

      expect(gateCallCount()).toBeGreaterThan(gatesAfterFirst);
    });

    test("never outlives the pre-jitter Redis window it fronts", async () => {
      /*
       * Inside the pre-jitter window the Redis liveness key cannot have
       * expired (its jittered TTL >= the window), so a skipped probe is
       * outcome-identical to a refused probe. Just before the boundary the
       * memo may still answer; the write count must therefore stay at one
       * either way.
       */
      await heartbeat();
      nowMs += (WINDOW_SECONDS - 1) * 1000;
      await heartbeat();

      expect(writes).toHaveLength(1);
    });
  });

  describe("change promptness", () => {
    test("a changed fingerprint bypasses the memo and reaches Redis immediately", async () => {
      await heartbeat({ metadata: { osType: "linux" }, fingerprint: "fp-a" });
      const gatesAfterFirst: number = gateCallCount();

      await heartbeat({ metadata: { osType: "windows" }, fingerprint: "fp-b" });

      expect(gateCallCount()).toBeGreaterThan(gatesAfterFirst);
    });

    test("the changed payload still lands in the next window, exactly as before the memo", async () => {
      await heartbeat({ metadata: { osType: "linux" }, fingerprint: "fp-a" });

      // Both windows reopen (as their Redis TTLs would).
      cache.delete(`${NAMESPACE}:${RESOURCE_ID.toString()}`);
      cache.delete(`${NAMESPACE}-write-window:${RESOURCE_ID.toString()}`);

      await heartbeat({ metadata: { osType: "windows" }, fingerprint: "fp-b" });

      expect(writes).toHaveLength(2);
      expect(writes[1]!.data["osType"]).toBe("windows");
    });
  });

  describe("outcomes that must retry are not memoized", () => {
    test("a failed metadata write retries on the very next batch", async () => {
      writeThrows = true;

      await heartbeat({ metadata: { osType: "linux" }, fingerprint: "fp-a" });
      // Enriched attempt + liveness-only fallback.
      expect(writes).toHaveLength(2);

      await heartbeat({ metadata: { osType: "linux" }, fingerprint: "fp-a" });

      // Retried — not silently swallowed by the memo.
      expect(writes).toHaveLength(4);
    });

    test("a lock-skipped enrichment write retries on the very next batch", async () => {
      writeLands = false;

      await heartbeat({ metadata: { osType: "linux" }, fingerprint: "fp-a" });
      expect(writes).toHaveLength(1);

      writeLands = true;
      await heartbeat({ metadata: { osType: "linux" }, fingerprint: "fp-a" });

      expect(writes).toHaveLength(2);
    });

    test("a liveness-gate outage keeps failing open on every batch", async () => {
      /*
       * If an outage outcome were memoized, one failed probe would suppress
       * heartbeats for a healthy resource for a full memo TTL — the exact
       * "shown disconnected while telemetry keeps arriving" failure mode
       * the fail-open policy exists to prevent.
       */
      jest
        .spyOn(GlobalCache, "setStringIfNotExists")
        .mockRejectedValue(new Error("redis down"));

      await heartbeat();
      await heartbeat();
      await heartbeat();

      expect(writes).toHaveLength(3);
    });

    test("an enrichment-gate outage is not memoized — enrichment recovers with Redis", async () => {
      jest
        .spyOn(GlobalCache, "setStringIfChanged")
        .mockRejectedValue(new Error("redis down"));

      await heartbeat({ metadata: { osType: "linux" }, fingerprint: "fp-a" });
      // Liveness-only write; enrichment failed closed.
      expect(writes).toHaveLength(1);
      expect(writes[0]!.data["osType"]).toBeUndefined();

      // Redis comes back; the same batch content must now enrich promptly.
      (GlobalCache.setStringIfChanged as jest.Mock).mockImplementation(
        async (namespace: string, key: string, value: string) => {
          const full: string = `${namespace}:${key}`;
          if (cache.get(full) === value) {
            return false;
          }
          cache.set(full, value);
          return true;
        },
      );

      await heartbeat({ metadata: { osType: "linux" }, fingerprint: "fp-a" });

      expect(writes).toHaveLength(2);
      expect(writes[1]!.data["osType"]).toBe("linux");
    });
  });

  describe("clearRecentHeartbeatMemo", () => {
    test("drops the memo so the next call probes again — the test-only escape hatch works", async () => {
      await heartbeat();
      const gatesAfterFirst: number = gateCallCount();

      ResourceHeartbeat.clearRecentHeartbeatMemo();
      await heartbeat();

      expect(gateCallCount()).toBeGreaterThan(gatesAfterFirst);
    });
  });
});
