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
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * `shouldRunMaintenance` gates every per-resource Postgres write on the OTLP
 * ingest path — eleven resource types' updateLastSeen, label promotion, the
 * lot. It used to be a read followed by a write, on the documented reasoning
 * that "race-safe is not required — two workers re-running updateLastSeen at
 * the same instant is harmless".
 *
 * That reasoning held at two workers. It failed at 25,000. Concurrent ingest
 * jobs do not arrive politely one at a time; they arrive together, all read
 * the same absent key, and all proceed. A fence written to admit ONE writer
 * per window admitted every worker that happened to be resolving that
 * resource, and the row-lock convoy that followed produced 1,017 active
 * connections with 892 parked on row locks and a 3.7-hour tail.
 *
 * The two properties below are what makes the fence a fence. Both are
 * invisible from any call site — a broken fence still returns booleans and
 * still throttles *something* — so they are checked here directly.
 *
 * `shouldRunMaintenance` is protected; this suite reaches it through a
 * subclass, which is the narrowest way to test the primitive rather than
 * eleven call sites' worth of behaviour.
 */

class FenceProbe extends OtelIngestBaseService {
  public static claim(scope: string, id: string): Promise<boolean> {
    return this.shouldRunMaintenance(scope, id);
  }
}

describe("OtelIngestBaseService.shouldRunMaintenance", () => {
  let cache: Map<string, string>;

  beforeEach(() => {
    cache = new Map<string, string>();

    /*
     * The fence carries an in-process negative memo now (a refusal seen
     * once is not re-asked for 30s). This suite reuses one (scope, id)
     * across tests, so simulate that memo's TTL expiring between cases the
     * same way the fresh `cache` map simulates the Redis TTL expiring. The
     * memo's own behaviour is pinned in
     * OtelIngestMaintenanceFenceNegativeMemo.test.ts.
     */
    OtelIngestBaseService.clearInProcessMemos();

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

    jest.spyOn(GlobalCache, "getString");
    jest.spyOn(GlobalCache, "setString");
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("admits the first caller for a resource", async () => {
    await expect(FenceProbe.claim("k8s-cluster", "abc")).resolves.toBe(true);
  });

  test("refuses every later caller inside the window", async () => {
    await FenceProbe.claim("k8s-cluster", "abc");

    await expect(FenceProbe.claim("k8s-cluster", "abc")).resolves.toBe(false);
    await expect(FenceProbe.claim("k8s-cluster", "abc")).resolves.toBe(false);
  });

  /*
   * The property the outage turned on. A read-then-write lets every member of
   * a simultaneous burst through; an atomic claim lets exactly one.
   */
  test("admits exactly one of a simultaneous burst", async () => {
    const results: Array<boolean> = await Promise.all(
      Array.from({ length: 500 }, () => {
        return FenceProbe.claim("k8s-cluster", "abc");
      }),
    );

    expect(
      results.filter((won: boolean) => {
        return won;
      }),
    ).toHaveLength(1);
  });

  test("claims in one round trip, with no separate read", async () => {
    await FenceProbe.claim("k8s-cluster", "abc");

    expect(GlobalCache.setStringIfNotExists).toHaveBeenCalledTimes(1);
    expect(GlobalCache.getString).not.toHaveBeenCalled();
    expect(GlobalCache.setString).not.toHaveBeenCalled();
  });

  test("keeps different resources and scopes independent", async () => {
    await expect(FenceProbe.claim("k8s-cluster", "abc")).resolves.toBe(true);
    await expect(FenceProbe.claim("k8s-cluster", "def")).resolves.toBe(true);
    await expect(FenceProbe.claim("proxmox-cluster", "abc")).resolves.toBe(
      true,
    );
  });

  /*
   * Jitter stops a fleet-wide restart from re-synchronising every resource's
   * window, which would rebuild the herd on a five-minute period. The upper
   * bound matters too: every markDisconnected* sweep runs at 15 minutes
   * against this 5-minute fence, and +25% keeps it at 6.25 — still 2.4x clear.
   */
  test("jitters the TTL within the bound the disconnect sweeps rely on", async () => {
    const ttls: Set<number> = new Set<number>();

    for (let i: number = 0; i < 200; i++) {
      await FenceProbe.claim("k8s-cluster", `resource-${i}`);
    }

    for (const call of (GlobalCache.setStringIfNotExists as jest.Mock).mock
      .calls) {
      const options: { expiresInSeconds: number } = call[3] as {
        expiresInSeconds: number;
      };
      ttls.add(options.expiresInSeconds);
      expect(options.expiresInSeconds).toBeGreaterThanOrEqual(300);
      expect(options.expiresInSeconds).toBeLessThanOrEqual(375);
    }

    expect(ttls.size).toBeGreaterThan(1);
  });

  /*
   * Fail open. A cache outage must not suppress liveness writes — a resource
   * whose lastSeenAt stops advancing is flipped to "disconnected" 15 minutes
   * later while its telemetry is still arriving.
   */
  test("runs the maintenance anyway when the cache is unavailable", async () => {
    jest
      .spyOn(GlobalCache, "setStringIfNotExists")
      .mockRejectedValue(new Error("redis down"));

    await expect(FenceProbe.claim("k8s-cluster", "abc")).resolves.toBe(true);
  });
});
