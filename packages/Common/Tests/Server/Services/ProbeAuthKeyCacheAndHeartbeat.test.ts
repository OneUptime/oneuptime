/*
 * Probe liveness hardening in ProbeService: a customer's probes were flagged
 * Disconnected because /probe-ingest/alive hung 45+ seconds — every probe
 * request re-authenticated with a Probe SELECT that queued behind a starved
 * Postgres pool, and the throttled lastAlive stamp could silently suppress
 * its own retry after a failed write. This suite pins the fixes:
 *
 *   - verifyProbeKey: Redis-cached SHA-256 key verification (namespace
 *     "probe-auth-key-hash", TTL 120s) with DB fallback, so repeat probe
 *     requests skip the per-request Probe SELECT entirely.
 *   - boundedCacheOperation: a 2s cap on every cache op — ioredis has no
 *     command timeout, so a stalled-but-open Redis socket must not hang
 *     probe auth.
 *   - updateLastAlive: clears the 30s "probe-last-alive" throttle stamp when
 *     the DB write FAILS, so the next request retries instead of silently
 *     letting lastAlive cross the 3-minute Disconnected cutoff.
 *   - onUpdateSuccess/onDeleteSuccess: key rotation and probe deletion
 *     overwrite the cached auth hash cluster-wide with a revocation
 *     sentinel, and verifyProbeKey's write-only-if-unchanged re-read keeps
 *     an in-flight verification from resurrecting the revoked hash.
 *
 * GlobalCache and MonitorService are mocked at the module boundary — the
 * real modules pull in Redis and the whole database stack. DB calls are
 * spied on the ProbeService singleton. No Postgres, no Redis.
 */

const mockGetString: jest.Mock = jest.fn();
const mockSetString: jest.Mock = jest.fn();
const mockDeleteKey: jest.Mock = jest.fn();

jest.mock("../../../Server/Infrastructure/GlobalCache", () => {
  return {
    __esModule: true,
    default: {
      getString: (...args: Array<unknown>) => {
        return mockGetString(...args);
      },
      setString: (...args: Array<unknown>) => {
        return mockSetString(...args);
      },
      deleteKey: (...args: Array<unknown>) => {
        return mockDeleteKey(...args);
      },
    },
  };
});

const mockRefreshProbeStatus: jest.Mock = jest.fn();

jest.mock("../../../Server/Services/MonitorService", () => {
  return {
    __esModule: true,
    default: {
      refreshProbeStatus: (...args: Array<unknown>) => {
        return mockRefreshProbeStatus(...args);
      },
    },
  };
});

jest.mock("../../../Server/Utils/Logger", () => {
  return {
    __esModule: true,
    default: {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    },
    getLogAttributesFromRequest: jest.fn(() => {
      return {};
    }),
  };
});

import crypto from "crypto";
import logger from "../../../Server/Utils/Logger";
import ProbeService from "../../../Server/Services/ProbeService";
import Probe, {
  ProbeConnectionStatus,
} from "../../../Models/DatabaseModels/Probe";
import ObjectID from "../../../Types/ObjectID";
import OneUptimeDate from "../../../Types/Date";
import BadDataException from "../../../Types/Exception/BadDataException";
import UpdateBy from "../../../Server/Types/Database/UpdateBy";
import DeleteBy from "../../../Server/Types/Database/DeleteBy";
import { OnDelete, OnUpdate } from "../../../Server/Types/Database/Hooks";
import { describe, expect, test, beforeEach, afterEach } from "@jest/globals";

const PROBE_ID: ObjectID = new ObjectID("11111111-1111-4111-8111-111111111111");
const SECOND_PROBE_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const PROBE_KEY: string = "probe-key-abc-123";
const ROTATED_PROBE_KEY: string = "probe-key-rotated-456";

const AUTH_CACHE_NAMESPACE: string = "probe-auth-key-hash";
const AUTH_CACHE_TTL_IN_SECONDS: number = 120;
const AUTH_CACHE_REVOKED_SENTINEL: string = "revoked";
const LAST_ALIVE_CACHE_NAMESPACE: string = "probe-last-alive";
const CACHE_OPERATION_TIMEOUT_IN_MS: number = 2000;

type Sha256Function = (value: string) => string;

/*
 * Computed independently of ProbeService.hashProbeKey so the tests pin the
 * EXACT on-the-wire cache format, not whatever the service happens to do.
 */
const sha256: Sha256Function = (value: string): string => {
  return crypto.createHash("sha256").update(value).digest("hex");
};

type MakeProbeRowFunction = () => Probe;

const makeProbeRow: MakeProbeRowFunction = (): Probe => {
  const probe: Probe = new Probe();
  probe.id = PROBE_ID;
  return probe;
};

describe("ProbeService probe-auth cache and heartbeat throttle", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetString.mockResolvedValue(null);
    mockSetString.mockResolvedValue(undefined);
    mockDeleteKey.mockResolvedValue(undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  describe("verifyProbeKey (cache-backed auth)", () => {
    /*
     * The whole point of the cache: a repeat request from a known probe must
     * authenticate WITHOUT touching Postgres. If findOneBy fires here, the
     * per-request Probe SELECT is back and probe auth queues behind the pool
     * again — the original 45s-hang ingredient.
     */
    test("cache hit with matching SHA-256 authenticates with NO Probe SELECT", async () => {
      mockGetString.mockResolvedValue(sha256(PROBE_KEY));
      // Would return "not found" if consulted — proving the cache decided.
      const findOneBySpy: jest.SpyInstance = jest
        .spyOn(ProbeService, "findOneBy")
        .mockResolvedValue(null);

      const result: boolean = await ProbeService.verifyProbeKey({
        probeId: PROBE_ID,
        probeKey: PROBE_KEY,
      });

      expect(result).toBe(true);
      expect(findOneBySpy).not.toHaveBeenCalled();
      expect(mockSetString).not.toHaveBeenCalled();
      expect(mockGetString).toHaveBeenCalledWith(
        AUTH_CACHE_NAMESPACE,
        PROBE_ID.toString(),
      );
    });

    /*
     * Security invariant: the cache stores only a SHA-256 hex digest of the
     * key with a bounded TTL — a Redis dump must never contain a usable
     * probe credential.
     */
    test("caches only the SHA-256 hex of the key with the 120s TTL — never the raw key", async () => {
      const findOneBySpy: jest.SpyInstance = jest
        .spyOn(ProbeService, "findOneBy")
        .mockResolvedValue(makeProbeRow());

      const result: boolean = await ProbeService.verifyProbeKey({
        probeId: PROBE_ID,
        probeKey: PROBE_KEY,
      });

      expect(result).toBe(true);
      expect(findOneBySpy).toHaveBeenCalledTimes(1);
      expect(mockSetString).toHaveBeenCalledTimes(1);
      expect(mockSetString).toHaveBeenCalledWith(
        AUTH_CACHE_NAMESPACE,
        PROBE_ID.toString(),
        sha256(PROBE_KEY),
        { expiresInSeconds: AUTH_CACHE_TTL_IN_SECONDS },
      );
      // The raw key must not appear ANYWHERE in the cache-write arguments.
      expect(JSON.stringify(mockSetString.mock.calls)).not.toContain(PROBE_KEY);
    });

    test("cache miss verifies against the DB with the presented id+key pair", async () => {
      const findOneBySpy: jest.SpyInstance = jest
        .spyOn(ProbeService, "findOneBy")
        .mockResolvedValue(makeProbeRow());

      const result: boolean = await ProbeService.verifyProbeKey({
        probeId: PROBE_ID,
        probeKey: PROBE_KEY,
      });

      expect(result).toBe(true);
      expect(findOneBySpy).toHaveBeenCalledTimes(1);
      expect(findOneBySpy).toHaveBeenCalledWith(
        expect.objectContaining({
          query: { _id: PROBE_ID.toString(), key: PROBE_KEY },
          props: { isRoot: true },
        }),
      );
    });

    /*
     * A cache entry may only ever be written from a value that was JUST
     * verified against the database — caching an UNVERIFIED hash would let a
     * wrong key poison the cache and then authenticate itself on retry.
     */
    test("DB not-found returns false and writes NOTHING to the cache", async () => {
      const findOneBySpy: jest.SpyInstance = jest
        .spyOn(ProbeService, "findOneBy")
        .mockResolvedValue(null);

      const result: boolean = await ProbeService.verifyProbeKey({
        probeId: PROBE_ID,
        probeKey: "wrong-key",
      });

      expect(result).toBe(false);
      expect(findOneBySpy).toHaveBeenCalledTimes(1);
      expect(mockSetString).not.toHaveBeenCalled();
    });

    /*
     * Key rotation: the cached hash belongs to the OLD key, the probe
     * presents the NEW one. The mismatch must fall through to the DB (so a
     * freshly rotated key works immediately, no TTL wait). The cache write
     * is SKIPPED while a conflicting entry is still present — the
     * write-only-if-unchanged rule never overwrites a value someone else
     * put there — so requests keep DB-verifying until the old entry
     * expires, at which point caching resumes (pinned below).
     */
    test("stale cached hash (rotated key) falls through to the DB and does not clobber the existing entry", async () => {
      mockGetString.mockResolvedValue(sha256(PROBE_KEY));
      const findOneBySpy: jest.SpyInstance = jest
        .spyOn(ProbeService, "findOneBy")
        .mockResolvedValue(makeProbeRow());

      const result: boolean = await ProbeService.verifyProbeKey({
        probeId: PROBE_ID,
        probeKey: ROTATED_PROBE_KEY,
      });

      expect(result).toBe(true);
      expect(findOneBySpy).toHaveBeenCalledTimes(1);
      expect(mockSetString).not.toHaveBeenCalled();
    });

    /*
     * The revocation sentinel written by invalidation can never equal a
     * SHA-256 digest, so it must behave as a miss on the auth path (DB
     * decides) and must NOT be overwritten by the verification it forced —
     * that write-back is exactly the rotation race the sentinel exists to
     * stop.
     */
    test("the revocation sentinel forces a DB check and is never overwritten", async () => {
      mockGetString.mockResolvedValue(AUTH_CACHE_REVOKED_SENTINEL);
      const findOneBySpy: jest.SpyInstance = jest
        .spyOn(ProbeService, "findOneBy")
        .mockResolvedValue(makeProbeRow());

      const result: boolean = await ProbeService.verifyProbeKey({
        probeId: PROBE_ID,
        probeKey: PROBE_KEY,
      });

      expect(result).toBe(true);
      expect(findOneBySpy).toHaveBeenCalledTimes(1);
      expect(mockSetString).not.toHaveBeenCalled();
    });

    /*
     * THE rotation-TOCTOU pin. A verification can straddle a key rotation:
     * its DB SELECT resolves against the pre-rotation row, THEN the
     * rotation commits and invalidation lands. An unconditional cache write
     * here would re-cache the just-revoked key for a fresh TTL —
     * resurrecting a credential the rotation was meant to kill. The
     * pre-write re-read must see the change and skip the write.
     */
    test("a rotation landing mid-verification wins: the straddling write is skipped", async () => {
      mockGetString
        .mockResolvedValueOnce(null) // initial read: plain miss
        .mockResolvedValueOnce(AUTH_CACHE_REVOKED_SENTINEL); // pre-write read: rotation landed
      const findOneBySpy: jest.SpyInstance = jest
        .spyOn(ProbeService, "findOneBy")
        .mockResolvedValue(makeProbeRow());

      const result: boolean = await ProbeService.verifyProbeKey({
        probeId: PROBE_ID,
        probeKey: PROBE_KEY,
      });

      // The DB verified the (pre-rotation) key, so THIS request passes...
      expect(result).toBe(true);
      expect(findOneBySpy).toHaveBeenCalledTimes(1);
      // ...but nothing may be written over the invalidation.
      expect(mockSetString).not.toHaveBeenCalled();
    });

    test("caching resumes once the conflicting entry has expired", async () => {
      // Both reads see an empty slot — the sentinel/old hash TTL'd out.
      mockGetString.mockResolvedValue(null);
      jest.spyOn(ProbeService, "findOneBy").mockResolvedValue(makeProbeRow());

      await ProbeService.verifyProbeKey({
        probeId: PROBE_ID,
        probeKey: ROTATED_PROBE_KEY,
      });

      expect(mockSetString).toHaveBeenCalledWith(
        AUTH_CACHE_NAMESPACE,
        PROBE_ID.toString(),
        sha256(ROTATED_PROBE_KEY),
        { expiresInSeconds: AUTH_CACHE_TTL_IN_SECONDS },
      );
    });

    /*
     * Redis down must degrade to "cache off", not "auth off": the DB is the
     * source of truth and a cache failure may neither fail the request
     * (closed) nor skip verification (open).
     */
    test("cache read rejection falls back to the DB and still authenticates", async () => {
      mockGetString.mockRejectedValue(new Error("Redis connection refused"));
      const findOneBySpy: jest.SpyInstance = jest
        .spyOn(ProbeService, "findOneBy")
        .mockResolvedValue(makeProbeRow());

      const result: boolean = await ProbeService.verifyProbeKey({
        probeId: PROBE_ID,
        probeKey: PROBE_KEY,
      });

      expect(result).toBe(true);
      expect(findOneBySpy).toHaveBeenCalledTimes(1);
    });

    /*
     * THE hang pin. ioredis has no command timeout: a stalled-but-open Redis
     * socket returns a promise that never settles, and before the 2s
     * boundedCacheOperation cap that promise would have hung probe auth
     * forever — the async middleware's rejection-free stall was exactly the
     * silent-hang mode that got healthy probes flagged Disconnected. A
     * never-settling cache read must time out and fall back to the DB.
     */
    test("a never-settling cache read is capped at 2s and falls back to the DB", async () => {
      jest.useFakeTimers();

      mockGetString.mockReturnValue(
        new Promise<string | null>(() => {
          // Never settles — simulates a dead-but-open Redis socket.
        }),
      );
      const findOneBySpy: jest.SpyInstance = jest
        .spyOn(ProbeService, "findOneBy")
        .mockResolvedValue(makeProbeRow());

      const resultPromise: Promise<boolean> = ProbeService.verifyProbeKey({
        probeId: PROBE_ID,
        probeKey: PROBE_KEY,
      });

      /*
       * Two caps fire on this path: the initial read (→ DB fallback) and
       * the pre-write re-read (→ skip the cache write). The microtask
       * flushes between the advances let the promise chain progress far
       * enough that the second bounded op has registered its cap timer
       * before it is advanced.
       */
      jest.advanceTimersByTime(CACHE_OPERATION_TIMEOUT_IN_MS);
      for (let i: number = 0; i < 10; i++) {
        await Promise.resolve();
      }
      jest.advanceTimersByTime(CACHE_OPERATION_TIMEOUT_IN_MS);

      await expect(resultPromise).resolves.toBe(true);
      expect(findOneBySpy).toHaveBeenCalledTimes(1);
    });

    /*
     * The cap timer must not outlive a fast cache operation: a leaked 2s
     * timer per probe request would accumulate thousands of live timers on
     * a busy ingest pod.
     */
    test("a settled cache operation leaves no cap timer behind", async () => {
      jest.useFakeTimers();
      mockGetString.mockResolvedValue(sha256(PROBE_KEY));

      const result: boolean = await ProbeService.verifyProbeKey({
        probeId: PROBE_ID,
        probeKey: PROBE_KEY,
      });

      expect(result).toBe(true);
      expect(jest.getTimerCount()).toBe(0);
    });

    test("missing probeId or probeKey is rejected with BadDataException", async () => {
      await expect(
        ProbeService.verifyProbeKey({
          probeId: undefined as unknown as ObjectID,
          probeKey: PROBE_KEY,
        }),
      ).rejects.toThrow(BadDataException);

      await expect(
        ProbeService.verifyProbeKey({
          probeId: PROBE_ID,
          probeKey: "",
        }),
      ).rejects.toThrow(BadDataException);
    });
  });

  describe("updateLastAlive (throttled heartbeat stamp)", () => {
    /*
     * The throttle is what makes it safe to stamp lastAlive on EVERY
     * authenticated probe request: at most one single-statement UPDATE per
     * probe per 30s, no matter how chatty the probe is.
     */
    test("skips the DB write while the 30s throttle stamp is fresh", async () => {
      mockGetString.mockResolvedValue(
        OneUptimeDate.toString(OneUptimeDate.getSomeSecondsAgo(10)),
      );
      const updateSpy: jest.SpyInstance = jest
        .spyOn(ProbeService, "updateColumnsByIdWithoutHooks")
        .mockResolvedValue(undefined);

      await ProbeService.updateLastAlive(PROBE_ID);

      expect(updateSpy).not.toHaveBeenCalled();
      // The stamp is not refreshed either — that would extend the throttle.
      expect(mockSetString).not.toHaveBeenCalled();
    });

    test("writes exactly one hookless lastAlive UPDATE once the stamp is stale", async () => {
      mockGetString.mockResolvedValue(
        OneUptimeDate.toString(OneUptimeDate.getSomeSecondsAgo(45)),
      );
      const updateSpy: jest.SpyInstance = jest
        .spyOn(ProbeService, "updateColumnsByIdWithoutHooks")
        .mockResolvedValue(undefined);

      await ProbeService.updateLastAlive(PROBE_ID);

      expect(updateSpy).toHaveBeenCalledTimes(1);
      expect(updateSpy).toHaveBeenCalledWith({
        id: PROBE_ID,
        data: { lastAlive: expect.any(Date) },
      });
      // The throttle stamp is re-written for the next 30s window.
      expect(mockSetString).toHaveBeenCalledWith(
        LAST_ALIVE_CACHE_NAMESPACE,
        PROBE_ID.toString(),
        expect.any(String),
      );
    });

    test("writes when no throttle stamp exists (first heartbeat)", async () => {
      // Default mockGetString resolves null — nothing cached yet.
      const updateSpy: jest.SpyInstance = jest
        .spyOn(ProbeService, "updateColumnsByIdWithoutHooks")
        .mockResolvedValue(undefined);

      await ProbeService.updateLastAlive(PROBE_ID);

      expect(updateSpy).toHaveBeenCalledTimes(1);
    });

    /*
     * THE self-heal pin. The throttle stamp is written BEFORE the DB write
     * is attempted (deliberately, as dogpile protection). Leaving it in
     * place after a FAILED write means every request for the next 30s
     * silently skips the retry; a couple of consecutive failures and
     * lastAlive crosses the connection-status worker's 3-minute staleness
     * cutoff — a HEALTHY probe gets flagged Disconnected, which is the
     * customer-reported failure mode. A failed write must clear the stamp
     * so the very next request retries, and must rethrow so the caller's
     * error logging still fires.
     */
    test("a FAILED lastAlive write clears the throttle stamp and rethrows", async () => {
      const updateSpy: jest.SpyInstance = jest
        .spyOn(ProbeService, "updateColumnsByIdWithoutHooks")
        .mockRejectedValue(new Error("connection pool exhausted"));

      await expect(ProbeService.updateLastAlive(PROBE_ID)).rejects.toThrow(
        "connection pool exhausted",
      );

      expect(updateSpy).toHaveBeenCalledTimes(1);
      expect(mockDeleteKey).toHaveBeenCalledWith(
        LAST_ALIVE_CACHE_NAMESPACE,
        PROBE_ID.toString(),
      );
    });

    /*
     * The throttle-clear is best-effort: if Redis is ALSO down, the stamp
     * expires on its own — but the ORIGINAL database error must surface,
     * not the secondary cache error.
     */
    test("throttle-clear failure does not mask the original DB error", async () => {
      mockDeleteKey.mockRejectedValue(new Error("redis down"));
      jest
        .spyOn(ProbeService, "updateColumnsByIdWithoutHooks")
        .mockRejectedValue(new Error("connection pool exhausted"));

      await expect(ProbeService.updateLastAlive(PROBE_ID)).rejects.toThrow(
        "connection pool exhausted",
      );
    });

    test("a successful write leaves the throttle stamp in place", async () => {
      jest
        .spyOn(ProbeService, "updateColumnsByIdWithoutHooks")
        .mockResolvedValue(undefined);

      await ProbeService.updateLastAlive(PROBE_ID);

      expect(mockDeleteKey).not.toHaveBeenCalled();
    });
  });

  describe("auth cache invalidation hooks", () => {
    /*
     * The auth middleware trusts a cached hash of the key, so the moment
     * the key column changes the cached entries for the updated probes must
     * be revoked — otherwise the OLD key keeps authenticating until the
     * 120s TTL runs out. Invalidation WRITES the sentinel rather than
     * deleting: a bare delete can be silently undone by an in-flight
     * verification re-caching the old hash (see the TOCTOU pin above),
     * while the sentinel makes that straggler's write-only-if-unchanged
     * check fail.
     */
    test("onUpdateSuccess writes the revocation sentinel for every updated probe when the key changes", async () => {
      const onUpdate: OnUpdate<Probe> = {
        updateBy: {
          query: {},
          data: { key: ROTATED_PROBE_KEY },
          props: { isRoot: true },
        } as UpdateBy<Probe>,
        carryForward: { probesToNotifyOwners: [] },
      };

      await (ProbeService as any)["onUpdateSuccess"](onUpdate, [
        PROBE_ID,
        SECOND_PROBE_ID,
      ]);

      expect(mockSetString).toHaveBeenCalledTimes(2);
      expect(mockSetString).toHaveBeenCalledWith(
        AUTH_CACHE_NAMESPACE,
        PROBE_ID.toString(),
        AUTH_CACHE_REVOKED_SENTINEL,
        { expiresInSeconds: AUTH_CACHE_TTL_IN_SECONDS },
      );
      expect(mockSetString).toHaveBeenCalledWith(
        AUTH_CACHE_NAMESPACE,
        SECOND_PROBE_ID.toString(),
        AUTH_CACHE_REVOKED_SENTINEL,
        { expiresInSeconds: AUTH_CACHE_TTL_IN_SECONDS },
      );
    });

    test("onUpdateSuccess leaves the cache alone when data does not touch the key", async () => {
      const onUpdate: OnUpdate<Probe> = {
        updateBy: {
          query: {},
          data: { name: "renamed probe" },
          props: { isRoot: true },
        } as UpdateBy<Probe>,
        carryForward: { probesToNotifyOwners: [] },
      };

      await (ProbeService as any)["onUpdateSuccess"](onUpdate, [PROBE_ID]);

      expect(mockSetString).not.toHaveBeenCalled();
      expect(mockRefreshProbeStatus).not.toHaveBeenCalled();
    });

    /*
     * Invalidation is best-effort per probe: one Redis failure must be
     * logged loudly (a revoked key may keep working for up to the TTL) but
     * must neither fail the surrounding update nor stop the remaining
     * probes from being invalidated.
     */
    test("an invalidation failure is logged, does not throw, and does not stop the remaining probes", async () => {
      mockSetString
        .mockRejectedValueOnce(new Error("redis write failed"))
        .mockResolvedValue(undefined);

      await expect(
        ProbeService.invalidateProbeAuthCache([PROBE_ID, SECOND_PROBE_ID]),
      ).resolves.toBeUndefined();

      // Both probes were attempted despite the first failure...
      expect(mockSetString).toHaveBeenCalledTimes(2);
      expect(mockSetString).toHaveBeenCalledWith(
        AUTH_CACHE_NAMESPACE,
        SECOND_PROBE_ID.toString(),
        AUTH_CACHE_REVOKED_SENTINEL,
        { expiresInSeconds: AUTH_CACHE_TTL_IN_SECONDS },
      );
      // ...and the failure was surfaced in the logs.
      expect(logger.error).toHaveBeenCalledWith(
        expect.stringContaining("CRITICAL"),
        expect.anything(),
      );
    });

    /*
     * Existing behavior preserved: the cache-invalidation addition must not
     * displace the connection-status owner-notification path that
     * onUpdateSuccess already ran.
     */
    test("connection-status change still refreshes monitors and notifies owners", async () => {
      const probeRow: Probe = makeProbeRow();
      const notifySpy: jest.SpyInstance = jest
        .spyOn(ProbeService, "notifyOwnersOnStatusChange")
        .mockResolvedValue(undefined);

      const onUpdate: OnUpdate<Probe> = {
        updateBy: {
          query: {},
          data: { connectionStatus: ProbeConnectionStatus.Disconnected },
          props: { isRoot: true },
        } as UpdateBy<Probe>,
        carryForward: { probesToNotifyOwners: [probeRow] },
      };

      await (ProbeService as any)["onUpdateSuccess"](onUpdate, [PROBE_ID]);

      expect(mockRefreshProbeStatus).toHaveBeenCalledTimes(1);
      expect(mockRefreshProbeStatus).toHaveBeenCalledWith(PROBE_ID);
      expect(notifySpy).toHaveBeenCalledWith({ probeId: PROBE_ID });
      // A status flip is not a key change — cached auth stays valid.
      expect(mockDeleteKey).not.toHaveBeenCalled();
    });

    /*
     * A deleted probe's key must stop authenticating immediately, not after
     * the cache TTL.
     */
    test("onDeleteSuccess writes the revocation sentinel for every deleted probe", async () => {
      const onDelete: OnDelete<Probe> = {
        deleteBy: {
          query: {},
          props: { isRoot: true },
        } as DeleteBy<Probe>,
        carryForward: null,
      };

      await (ProbeService as any)["onDeleteSuccess"](onDelete, [
        PROBE_ID,
        SECOND_PROBE_ID,
      ]);

      expect(mockSetString).toHaveBeenCalledTimes(2);
      expect(mockSetString).toHaveBeenCalledWith(
        AUTH_CACHE_NAMESPACE,
        PROBE_ID.toString(),
        AUTH_CACHE_REVOKED_SENTINEL,
        { expiresInSeconds: AUTH_CACHE_TTL_IN_SECONDS },
      );
      expect(mockSetString).toHaveBeenCalledWith(
        AUTH_CACHE_NAMESPACE,
        SECOND_PROBE_ID.toString(),
        AUTH_CACHE_REVOKED_SENTINEL,
        { expiresInSeconds: AUTH_CACHE_TTL_IN_SECONDS },
      );
    });
  });
});
