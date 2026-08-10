/*
 * The Queue infrastructure module pulls in BullMQ (ESM-only msgpackr) at
 * import time via the services' queue imports; nothing queue-related is
 * under test here, so the module is replaced — same idiom as
 * OtelIngestMaintenanceFenceRelease.test.ts in this directory.
 */
jest.mock("Common/Server/Infrastructure/Queue", () => {
  return {
    __esModule: true,
    default: {
      addJob: jest.fn(),
    },
    QueueName: {
      Workflow: "Workflow",
      Worker: "Worker",
      Telemetry: "Telemetry",
      Runbook: "Runbook",
    },
  };
});

/*
 * PasswordHash carries a pre-existing TS5.9 diagnostic that fails any suite
 * whose runtime require graph reaches it (DatabaseService, the base class
 * of every concrete service, imports it). Nothing password-related is under
 * test here, so the module is replaced WITH A FACTORY — an automock would
 * still require (and type-check) the real file.
 */
jest.mock("Common/Server/Utils/PasswordHash", () => {
  return {
    __esModule: true,
    default: {
      hash: jest.fn(),
      verify: jest.fn(),
      generateSalt: jest.fn(),
      needsUpgrade: jest.fn(),
      applyPepper: jest.fn(),
    },
  };
});

import GlobalCache from "Common/Server/Infrastructure/GlobalCache";
import OtelIngestBaseService from "../../FeatureSet/Telemetry/Services/OtelIngestBaseService";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * The in-process negative memo in front of the maintenance fence.
 *
 * `shouldRunMaintenance` is an atomic SET NX — correct, but still one Redis
 * round trip PER DISCOVERED RESOURCE PER RESOURCE BLOCK, serialized. A
 * hostmetrics payload with hundreds of ResourceMetrics paid hundreds of
 * round trips per job to be told, hundreds of times, that a fence armed
 * minutes ago is still held. Once a refusal has been observed it stays true
 * for the rest of the window, so it is now remembered in-process for 30s
 * (min(60s, fence TTL / 10)).
 *
 * The asymmetry is the load-bearing design decision and both halves are
 * pinned here:
 *
 *   - ONLY the refusal is memoized. A cached positive would tell this pod
 *     "you hold the fence, run the maintenance" for work a competing pod
 *     may have armed-and-failed (and therefore RELEASED) in the meantime —
 *     suppressing a retry someone else is entitled to. A cached negative
 *     merely delays this pod's next claim attempt by at most 30s, which
 *     the 5-minute fence window already tolerates.
 *
 *   - A release THIS process performs must be visible to itself
 *     immediately: clearMaintenanceFence drops the local memo entry along
 *     with the Redis key, so a failed maintenance attempt retries on the
 *     very next batch instead of idling out the memo TTL.
 *
 * The suite reaches the protected primitive through a subclass, same as
 * OtelIngestMaintenanceFenceAtomicity.test.ts.
 */

class FenceProbe extends OtelIngestBaseService {
  public static claim(scope: string, id: string): Promise<boolean> {
    return this.shouldRunMaintenance(scope, id);
  }

  public static release(scope: string, id: string): Promise<void> {
    return this.clearMaintenanceFence(scope, id);
  }
}

describe("OtelIngestBaseService maintenance-fence negative memo", () => {
  /** Stands in for Redis; SET NX succeeds only on an absent key. */
  let cache: Map<string, string>;
  let nowMs: number;

  function claimCallCount(): number {
    return (GlobalCache.setStringIfNotExists as jest.Mock).mock.calls.length;
  }

  beforeEach(() => {
    cache = new Map<string, string>();
    nowMs = 1_700_000_000_000;

    OtelIngestBaseService.clearInProcessMemos();

    jest.spyOn(Date, "now").mockImplementation(() => {
      return nowMs;
    });

    jest
      .spyOn(GlobalCache, "setStringIfNotExists")
      .mockImplementation(async (namespace: string, key: string) => {
        const full: string = `${namespace}-${key}`;
        if (cache.has(full)) {
          return false;
        }
        cache.set(full, "1");
        return true;
      });

    jest
      .spyOn(GlobalCache, "deleteKey")
      .mockImplementation(async (namespace: string, key: string) => {
        cache.delete(`${namespace}-${key}`);
      });
  });

  afterEach(() => {
    jest.restoreAllMocks();
    OtelIngestBaseService.clearInProcessMemos();
  });

  /*
   * THE assertion: a refused fence is asked of Redis ONCE, and every later
   * resource block inside the memo window is answered locally.
   */
  test("a refusal is served from memory afterwards", async () => {
    await expect(FenceProbe.claim("host", "h1")).resolves.toBe(true);
    await expect(FenceProbe.claim("host", "h1")).resolves.toBe(false);
    expect(claimCallCount()).toBe(2);

    await expect(FenceProbe.claim("host", "h1")).resolves.toBe(false);
    await expect(FenceProbe.claim("host", "h1")).resolves.toBe(false);
    await expect(FenceProbe.claim("host", "h1")).resolves.toBe(false);

    expect(claimCallCount()).toBe(2);
  });

  test("a winning claim is NEVER cached — the next attempt asks Redis again", async () => {
    await expect(FenceProbe.claim("host", "h1")).resolves.toBe(true);

    /*
     * Another worker's failed maintenance releases the fence (or its TTL
     * expires). If the positive outcome had been memoized, this pod would
     * "win" locally without Redis ever being asked — and the maintenance
     * another pod is waiting on could be double-run or wrongly claimed.
     */
    cache.clear();

    await expect(FenceProbe.claim("host", "h1")).resolves.toBe(true);
    expect(claimCallCount()).toBe(2);
  });

  test("the memoed refusal expires after 30 seconds and Redis is consulted again", async () => {
    await FenceProbe.claim("host", "h1");
    await FenceProbe.claim("host", "h1");
    expect(claimCallCount()).toBe(2);

    nowMs += 30 * 1000 + 1;

    await expect(FenceProbe.claim("host", "h1")).resolves.toBe(false);
    expect(claimCallCount()).toBe(3);
  });

  test("the memo TTL sits far inside the fence window", async () => {
    /*
     * At 30s the memo can only ever extend a refusal that the 300-375s
     * fence window would have produced anyway — the added lastSeenAt
     * staleness is bounded by a tenth of the window. Pinned by observing
     * that a claim after memo expiry, but inside the fence window, is
     * still refused BY REDIS (not by the memo).
     */
    await FenceProbe.claim("host", "h1");
    nowMs += 31 * 1000;

    const before: number = claimCallCount();
    await expect(FenceProbe.claim("host", "h1")).resolves.toBe(false);
    expect(claimCallCount()).toBe(before + 1);
  });

  test("releasing the fence clears the local refusal too — the next batch retries immediately", async () => {
    await FenceProbe.claim("host", "h1");
    await FenceProbe.claim("host", "h1"); // refusal memoized

    /*
     * The armed worker's gated work failed; it releases what it armed.
     * Without the local clear, this process would keep answering "held"
     * from memory for up to 30s after the Redis key was already gone.
     */
    await FenceProbe.release("host", "h1");

    await expect(FenceProbe.claim("host", "h1")).resolves.toBe(true);
  });

  test("a release still clears the memo when Redis is down", async () => {
    await FenceProbe.claim("host", "h1");
    await FenceProbe.claim("host", "h1"); // refusal memoized

    jest
      .spyOn(GlobalCache, "deleteKey")
      .mockRejectedValue(new Error("redis down"));
    await FenceProbe.release("host", "h1");

    /*
     * The Redis key survived (delete failed, best-effort), so the claim is
     * refused — but by REDIS, proving the local memo entry was dropped and
     * the process went back to asking.
     */
    const before: number = claimCallCount();
    await expect(FenceProbe.claim("host", "h1")).resolves.toBe(false);
    expect(claimCallCount()).toBe(before + 1);
  });

  test("scopes and ids stay independent in the memo", async () => {
    await FenceProbe.claim("host", "h1");
    await FenceProbe.claim("host", "h1"); // h1 refusal memoized

    await expect(FenceProbe.claim("host", "h2")).resolves.toBe(true);
    await expect(FenceProbe.claim("docker-host", "h1")).resolves.toBe(true);
  });

  test("a cache outage is not memoized — every batch keeps failing open", async () => {
    jest
      .spyOn(GlobalCache, "setStringIfNotExists")
      .mockRejectedValue(new Error("redis down"));

    /*
     * Fail-open returns true, and true must never be cached: when Redis
     * comes back the very next claim must go through the real fence.
     */
    await expect(FenceProbe.claim("host", "h1")).resolves.toBe(true);
    await expect(FenceProbe.claim("host", "h1")).resolves.toBe(true);
    expect(claimCallCount()).toBe(2);
  });

  test("the atomic claim semantics under a concurrent burst are unchanged", async () => {
    const results: Array<boolean> = await Promise.all(
      Array.from({ length: 200 }, () => {
        return FenceProbe.claim("k8s-cluster", "burst");
      }),
    );

    expect(
      results.filter((won: boolean) => {
        return won;
      }),
    ).toHaveLength(1);
  });
});
