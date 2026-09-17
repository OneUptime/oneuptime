import GlobalCache from "../../../Server/Infrastructure/GlobalCache";
import ServiceService from "../../../Server/Services/ServiceService";
import SingleFlight from "../../../Server/Utils/SingleFlight";
import ObjectID from "../../../Types/ObjectID";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * Regression suite for the row-lock convoy outage.
 *
 * `Service.lastSeenAt` is the hottest UPDATE in the product: every
 * metric/log/trace/profile batch re-resolves the same serviceId, and every
 * OTLP resource inside a batch does it again. It was throttled — and the
 * throttle did not work.
 *
 * The throttle keyed on the serviceId but STORED a fingerprint of the
 * collector-supplied metadata, and skipped only when the stored fingerprint
 * matched. That is fine while one producer owns a row. It collapses the moment
 * two producers of the SAME row disagree, and `Service` is unique on
 * (projectId, name) alone — so the same `service.name` running in dev and prod
 * inside one project is ONE row with two permanently disagreeing fingerprints.
 * A writes fp_A; B reads fp_A, sees a mismatch, writes fp_B; A reads fp_B,
 * sees a mismatch, writes fp_A. Forever. For those rows the throttle admitted
 * not one write per minute but one write per BATCH.
 *
 * At 100 worker pods and ~25K concurrent jobs that was thousands of
 * simultaneous UPDATEs onto ~2,300 rows. Postgres queues row-lock waiters
 * strictly, so they did not collide and retry — they lined up: 1,017 active
 * connections, 892 parked on locks, the tail waiting 3.7 hours. The database
 * had capacity the entire time.
 *
 * What is pinned here, in order of how badly it hurt:
 *
 *   1. LIVENESS IS GATED ON PRESENCE, NEVER ON METADATA. No payload, however
 *      it flaps, can make a second heartbeat happen inside one window. This is
 *      the assertion that would have caught the outage.
 *   2. ENRICHMENT IS RATE-LIMITED SEPARATELY. A real change still lands
 *      promptly, but a permanently-flapping service cannot buy more than one
 *      enrichment write per window with it.
 *   3. THE CLAIMS ARE ATOMIC. Check-then-act admits every concurrent caller;
 *      SET NX admits exactly one.
 *   4. THE WRITE IS NON-BLOCKING. SKIP LOCKED, so contention can never queue,
 *      including when everything above fails open.
 *   5. LIVENESS SURVIVES EVERYTHING ELSE FAILING — a Redis outage, a bad
 *      metadata column, a lost race. A suppressed heartbeat strands a healthy
 *      service as "disconnected" while its telemetry is still arriving, which
 *      is the failure this must never trade away for efficiency.
 *
 * Everything external is mocked — no Postgres, no Redis.
 */

const SERVICE_ID: ObjectID = ObjectID.generate();

const LIVENESS_NAMESPACE: string = "service-last-seen";
const FINGERPRINT_NAMESPACE: string = "service-metadata-fingerprint";
const WRITE_WINDOW_NAMESPACE: string = "service-metadata-write-window";

type WriteCall = { id: ObjectID; data: Record<string, unknown> };

let writes: Array<WriteCall>;
let cache: Map<string, string>;
let deletedKeys: Array<string>;
let ttls: Map<string, number>;
/** Set to false to simulate every row being locked by another writer. */
let writeLands: boolean;

function cacheKey(namespace: string, key: string): string {
  return `${namespace}:${key}`;
}

/**
 * A faithful in-memory Redis: SET NX only succeeds on an absent key, and the
 * compare-and-claim only succeeds when the stored value differs. Getting
 * either of these wrong here would make the suite agree with a broken
 * implementation, so they are modelled rather than stubbed.
 */
function mockCache(): void {
  jest
    .spyOn(GlobalCache, "setStringIfNotExists")
    .mockImplementation(
      async (
        namespace: string,
        key: string,
        value: string,
        options?: { expiresInSeconds: number },
      ) => {
        const full: string = cacheKey(namespace, key);
        if (cache.has(full)) {
          return false;
        }
        cache.set(full, value);
        ttls.set(full, options?.expiresInSeconds ?? 0);
        return true;
      },
    );

  jest
    .spyOn(GlobalCache, "setStringIfChanged")
    .mockImplementation(
      async (
        namespace: string,
        key: string,
        value: string,
        options?: { expiresInSeconds: number },
      ) => {
        const full: string = cacheKey(namespace, key);
        if (cache.get(full) === value) {
          return false;
        }
        cache.set(full, value);
        ttls.set(full, options?.expiresInSeconds ?? 0);
        return true;
      },
    );

  jest
    .spyOn(GlobalCache, "deleteKey")
    .mockImplementation(async (namespace: string, key: string) => {
      const full: string = cacheKey(namespace, key);
      deletedKeys.push(full);
      cache.delete(full);
    });
}

function mockWritesSucceeding(): void {
  jest
    .spyOn(ServiceService, "updateColumnsByIdIfUnlockedWithoutHooks")
    .mockImplementation(async (input: { id: ObjectID; data: unknown }) => {
      writes.push({
        id: input.id,
        data: { ...(input.data as Record<string, unknown>) },
      });
      return writeLands;
    });
}

function lastWrite(): Record<string, unknown> {
  return writes[writes.length - 1]!.data;
}

/** Columns written, sorted — `lastSeenAt` alone means liveness-only. */
function columnsOf(write: WriteCall): Array<string> {
  return Object.keys(write.data).sort();
}

function isLivenessOnly(write: WriteCall): boolean {
  return columnsOf(write).join(",") === "lastSeenAt";
}

beforeEach(() => {
  writes = [];
  cache = new Map<string, string>();
  deletedKeys = [];
  ttls = new Map<string, number>();
  writeLands = true;
  SingleFlight.clear();
  mockCache();
  mockWritesSucceeding();
});

afterEach(() => {
  jest.restoreAllMocks();
  SingleFlight.clear();
});

describe("ServiceService.updateLastSeen — liveness is gated on presence", () => {
  test("writes lastSeenAt on the first call", async () => {
    await ServiceService.updateLastSeen(SERVICE_ID);

    expect(writes).toHaveLength(1);
    expect(lastWrite()["lastSeenAt"]).toBeInstanceOf(Date);
    expect(writes[0]!.id.toString()).toBe(SERVICE_ID.toString());
  });

  test("skips the second identical call inside the window", async () => {
    await ServiceService.updateLastSeen(SERVICE_ID, {
      serviceVersion: "1.0.0",
    });
    await ServiceService.updateLastSeen(SERVICE_ID, {
      serviceVersion: "1.0.0",
    });

    expect(writes).toHaveLength(1);
  });

  /*
   * THE OUTAGE, reproduced. Two producers of one Service row that disagree on
   * a fingerprinted attribute — dev and prod under a single service.name, or
   * an active-active pair differing only in cloud.region. Under the old
   * throttle each call busted the other's key and every one of these 20 calls
   * issued its own UPDATE.
   *
   * The liveness heartbeat must now happen exactly ONCE regardless.
   */
  test("flapping producers cannot force more than one heartbeat per window", async () => {
    for (let i: number = 0; i < 10; i++) {
      await ServiceService.updateLastSeen(SERVICE_ID, {
        deploymentEnvironment: "production",
      });
      await ServiceService.updateLastSeen(SERVICE_ID, {
        deploymentEnvironment: "development",
      });
    }

    const heartbeats: Array<WriteCall> = writes.filter((write: WriteCall) => {
      return write.data["lastSeenAt"] !== undefined;
    });

    /*
     * Every write refreshes lastSeenAt, so the bound that matters is the total
     * number of statements: one liveness claim plus at most one enrichment
     * claim per window. Twenty flapping batches used to mean twenty UPDATEs.
     */
    expect(heartbeats.length).toBeLessThanOrEqual(2);
    expect(writes.length).toBeLessThanOrEqual(2);
  });

  test("flapping across many distinct payloads is bounded just the same", async () => {
    for (let i: number = 0; i < 50; i++) {
      await ServiceService.updateLastSeen(SERVICE_ID, {
        serviceVersion: `1.0.${i}`,
      });
    }

    expect(writes.length).toBeLessThanOrEqual(2);
  });

  test("a different service is throttled independently", async () => {
    const other: ObjectID = ObjectID.generate();

    await ServiceService.updateLastSeen(SERVICE_ID);
    await ServiceService.updateLastSeen(other);

    expect(writes).toHaveLength(2);
  });

  test("claims the liveness gate atomically, never read-then-write", async () => {
    jest.spyOn(GlobalCache, "getString");
    jest.spyOn(GlobalCache, "setString");

    await ServiceService.updateLastSeen(SERVICE_ID, {
      serviceVersion: "1.0.0",
    });

    expect(GlobalCache.setStringIfNotExists).toHaveBeenCalledWith(
      LIVENESS_NAMESPACE,
      SERVICE_ID.toString(),
      "1",
      expect.anything(),
    );
    // A read here would be the check-then-act race coming back.
    expect(GlobalCache.getString).not.toHaveBeenCalled();
    expect(GlobalCache.setString).not.toHaveBeenCalled();
  });

  /*
   * The liveness key must hold a constant. Storing anything attribute-derived
   * is what let the payload bust the gate in the first place — the exact
   * regression this whole file exists to prevent.
   */
  test("stores a constant in the liveness key, never anything payload-derived", async () => {
    await ServiceService.updateLastSeen(SERVICE_ID, {
      serviceVersion: "1.2.3",
      cloudRegion: "us-east-1",
    });

    expect(cache.get(cacheKey(LIVENESS_NAMESPACE, SERVICE_ID.toString()))).toBe(
      "1",
    );
  });

  test("jitters the liveness TTL so windows cannot re-synchronise fleet-wide", async () => {
    await ServiceService.updateLastSeen(SERVICE_ID);

    const ttl: number = ttls.get(
      cacheKey(LIVENESS_NAMESPACE, SERVICE_ID.toString()),
    )!;

    expect(ttl).toBeGreaterThanOrEqual(60);
    expect(ttl).toBeLessThanOrEqual(75);
  });
});

describe("ServiceService.updateLastSeen — enrichment is gated separately", () => {
  test("writes the descriptive columns on first contact", async () => {
    await ServiceService.updateLastSeen(SERVICE_ID, {
      serviceVersion: "1.2.3",
      deploymentEnvironment: "production",
      cloudRegion: "us-east-1",
    });

    expect(lastWrite()["serviceVersion"]).toBe("1.2.3");
    expect(lastWrite()["deploymentEnvironment"]).toBe("production");
    expect(lastWrite()["cloudRegion"]).toBe("us-east-1");
  });

  /*
   * The fingerprint gate must OPEN for a changed attribute. This is why it is
   * compare-and-claim rather than plain set-if-absent: plain NX fails whenever
   * the key exists, including when it holds a stale fingerprint, so a new
   * service.version would be suppressed and then never written at all.
   */
  test("the fingerprint gate opens for a genuinely changed attribute", async () => {
    await ServiceService.updateLastSeen(SERVICE_ID, {
      serviceVersion: "1.0.0",
    });

    // Only the rate limiter is holding it back, not change detection.
    cache.delete(cacheKey(WRITE_WINDOW_NAMESPACE, SERVICE_ID.toString()));
    SingleFlight.clear();

    await ServiceService.updateLastSeen(SERVICE_ID, {
      serviceVersion: "2.0.0",
    });

    expect(writes).toHaveLength(2);
    expect(lastWrite()["serviceVersion"]).toBe("2.0.0");
  });

  /*
   * The deliberate trade, pinned so nobody "fixes" it by accident.
   *
   * Change detection alone cannot distinguish a real deploy from two
   * producers that disagree forever — both present as "it changed" on every
   * batch. Since the flapping case is unbounded and the deploy case is not,
   * the rate limiter applies to both, and the cost is that a new
   * service.version can lag by up to one enrichment window.
   *
   * That is a descriptive column, not an operational one: nothing is
   * mis-reported by showing the previous version for a few minutes, and
   * `lastSeenAt` — the value anything actually alerts on — is unaffected
   * because it rides the separate liveness gate.
   */
  test("a changed attribute waits for the enrichment rate-limit window", async () => {
    await ServiceService.updateLastSeen(SERVICE_ID, {
      serviceVersion: "1.0.0",
    });
    await ServiceService.updateLastSeen(SERVICE_ID, {
      serviceVersion: "2.0.0",
    });

    expect(writes).toHaveLength(1);
    expect(lastWrite()["serviceVersion"]).toBe("1.0.0");
  });

  test("an unchanged payload claims nothing on the second call", async () => {
    await ServiceService.updateLastSeen(SERVICE_ID, {
      serviceVersion: "1.0.0",
    });
    await ServiceService.updateLastSeen(SERVICE_ID, {
      serviceVersion: "1.0.0",
    });

    expect(writes).toHaveLength(1);
  });

  /*
   * The fingerprint gate alone cannot tell a real deploy from a permanently
   * flapping pair of producers — both look like "it changed". The rate limiter
   * is what bounds the second case, and without it a longer fingerprint TTL
   * just makes every flap more expensive.
   */
  test("the rate limiter bounds enrichment for a permanently flapping service", async () => {
    for (let i: number = 0; i < 25; i++) {
      await ServiceService.updateLastSeen(SERVICE_ID, {
        cloudRegion: "us-east-1",
      });
      await ServiceService.updateLastSeen(SERVICE_ID, {
        cloudRegion: "eu-west-1",
      });
    }

    const enrichmentWrites: Array<WriteCall> = writes.filter(
      (write: WriteCall) => {
        return !isLivenessOnly(write);
      },
    );

    expect(enrichmentWrites).toHaveLength(1);
  });

  test("holds the enrichment window key for longer than the liveness window", async () => {
    await ServiceService.updateLastSeen(SERVICE_ID, {
      serviceVersion: "1.0.0",
    });

    const livenessTtl: number = ttls.get(
      cacheKey(LIVENESS_NAMESPACE, SERVICE_ID.toString()),
    )!;
    const windowTtl: number = ttls.get(
      cacheKey(WRITE_WINDOW_NAMESPACE, SERVICE_ID.toString()),
    )!;

    expect(windowTtl).toBeGreaterThan(livenessTtl);
  });

  test("only lastSeenAt is written once the enrichment window is claimed", async () => {
    await ServiceService.updateLastSeen(SERVICE_ID, {
      serviceVersion: "1.0.0",
    });
    cache.delete(cacheKey(LIVENESS_NAMESPACE, SERVICE_ID.toString()));

    await ServiceService.updateLastSeen(SERVICE_ID, {
      serviceVersion: "9.9.9",
    });

    expect(writes).toHaveLength(2);
    expect(isLivenessOnly(writes[1]!)).toBe(true);
  });

  /*
   * Enrichment is descriptive; liveness is operational. Opening the
   * enrichment gate during a Redis outage would restore the per-batch write
   * storm, and nothing is mis-reported by writing a cloud region a minute
   * later. Liveness gets the opposite treatment — see below.
   */
  test("fails CLOSED for enrichment when the cache is unavailable", async () => {
    jest
      .spyOn(GlobalCache, "setStringIfChanged")
      .mockRejectedValue(new Error("redis down"));

    await ServiceService.updateLastSeen(SERVICE_ID, {
      serviceVersion: "1.2.3",
    });

    expect(writes).toHaveLength(1);
    expect(isLivenessOnly(writes[0]!)).toBe(true);
  });
});

describe("ServiceService.updateLastSeen — liveness survives everything else", () => {
  /*
   * A cache outage must never suppress the heartbeat. The disconnection sweep
   * runs 15 minutes after lastSeenAt stops advancing, so a fail-closed gate
   * would show healthy services as down while their telemetry kept arriving.
   * Affordable only because the write itself cannot queue.
   */
  test("fails OPEN for liveness when the cache is unavailable", async () => {
    jest
      .spyOn(GlobalCache, "setStringIfNotExists")
      .mockRejectedValue(new Error("redis down"));

    await ServiceService.updateLastSeen(SERVICE_ID, {
      serviceVersion: "1.0.0",
    });

    expect(writes).toHaveLength(1);
    expect(lastWrite()["lastSeenAt"]).toBeInstanceOf(Date);
  });

  test("keeps writing liveness on every call while the cache stays down", async () => {
    jest
      .spyOn(GlobalCache, "setStringIfNotExists")
      .mockRejectedValue(new Error("redis down"));

    await ServiceService.updateLastSeen(SERVICE_ID, {
      serviceVersion: "1.0.0",
    });
    SingleFlight.clear();
    await ServiceService.updateLastSeen(SERVICE_ID, {
      serviceVersion: "1.0.0",
    });

    expect(writes).toHaveLength(2);
  });

  /*
   * Issue #3006's shape: one bad collector-supplied column must not take the
   * heartbeat down with it.
   */
  test("retries with liveness only when the enriched write fails", async () => {
    let attempt: number = 0;
    jest
      .spyOn(ServiceService, "updateColumnsByIdIfUnlockedWithoutHooks")
      .mockImplementation(async (input: { id: ObjectID; data: unknown }) => {
        attempt++;
        const data: Record<string, unknown> = {
          ...(input.data as Record<string, unknown>),
        };
        writes.push({ id: input.id, data: data });
        if (attempt === 1) {
          throw new Error("value too long for type character varying(100)");
        }
        return true;
      });

    await ServiceService.updateLastSeen(SERVICE_ID, {
      cloudRegion: "x".repeat(5000),
    });

    expect(writes).toHaveLength(2);
    expect(columnsOf(writes[1]!)).toEqual(["lastSeenAt"]);
  });

  test("does not throw when the enriched write fails — ingest keeps going", async () => {
    let attempt: number = 0;
    jest
      .spyOn(ServiceService, "updateColumnsByIdIfUnlockedWithoutHooks")
      .mockImplementation(async () => {
        attempt++;
        if (attempt === 1) {
          throw new Error("value too long");
        }
        return true;
      });

    await expect(
      ServiceService.updateLastSeen(SERVICE_ID, { cloudRegion: "x" }),
    ).resolves.toBeUndefined();
  });

  test("re-opens the enrichment gates after a failed write so the next batch retries", async () => {
    jest
      .spyOn(ServiceService, "updateColumnsByIdIfUnlockedWithoutHooks")
      .mockImplementation(async (input: { id: ObjectID; data: unknown }) => {
        const data: Record<string, unknown> = {
          ...(input.data as Record<string, unknown>),
        };
        writes.push({ id: input.id, data: data });
        if (Object.keys(data).length > 1) {
          throw new Error("value too long");
        }
        return true;
      });

    await ServiceService.updateLastSeen(SERVICE_ID, { cloudRegion: "x" });

    expect(deletedKeys).toContain(
      cacheKey(FINGERPRINT_NAMESPACE, SERVICE_ID.toString()),
    );
    expect(deletedKeys).toContain(
      cacheKey(WRITE_WINDOW_NAMESPACE, SERVICE_ID.toString()),
    );
  });

  test("surfaces a genuinely broken database rather than hiding it", async () => {
    jest
      .spyOn(ServiceService, "updateColumnsByIdIfUnlockedWithoutHooks")
      .mockRejectedValue(new Error("connection terminated"));

    await expect(
      ServiceService.updateLastSeen(SERVICE_ID, { serviceVersion: "1.0.0" }),
    ).rejects.toThrow("connection terminated");
  });

  test("a failing cache delete does not stop the liveness retry", async () => {
    jest
      .spyOn(GlobalCache, "deleteKey")
      .mockRejectedValue(new Error("redis down"));

    let attempt: number = 0;
    jest
      .spyOn(ServiceService, "updateColumnsByIdIfUnlockedWithoutHooks")
      .mockImplementation(async (input: { id: ObjectID; data: unknown }) => {
        attempt++;
        writes.push({
          id: input.id,
          data: { ...(input.data as Record<string, unknown>) },
        });
        if (attempt === 1) {
          throw new Error("value too long");
        }
        return true;
      });

    await ServiceService.updateLastSeen(SERVICE_ID, { cloudRegion: "x" });

    expect(columnsOf(writes[1]!)).toEqual(["lastSeenAt"]);
  });
});

describe("ServiceService.updateLastSeen — contention is yielded, not queued", () => {
  test("uses the non-blocking write primitive", async () => {
    await ServiceService.updateLastSeen(SERVICE_ID);

    expect(
      ServiceService.updateColumnsByIdIfUnlockedWithoutHooks,
    ).toHaveBeenCalled();
  });

  /*
   * A skipped liveness bump is a non-event: whoever holds the row lock is
   * writing the same timestamp. Re-opening the window for it would generate
   * pointless retries against a row that is demonstrably being written.
   */
  test("a skipped liveness-only write is dropped silently", async () => {
    writeLands = false;

    await ServiceService.updateLastSeen(SERVICE_ID);

    expect(deletedKeys).toHaveLength(0);
  });

  /*
   * Enrichment is different: the writer holding the lock may be storing an
   * OLDER payload, and the gates this call just claimed would suppress the
   * newer one for the rest of the window. It has to be retried.
   */
  test("a skipped enrichment write re-opens the gates for the next batch", async () => {
    writeLands = false;

    await ServiceService.updateLastSeen(SERVICE_ID, {
      serviceVersion: "1.2.3",
    });

    expect(deletedKeys).toContain(
      cacheKey(FINGERPRINT_NAMESPACE, SERVICE_ID.toString()),
    );
    expect(deletedKeys).toContain(
      cacheKey(WRITE_WINDOW_NAMESPACE, SERVICE_ID.toString()),
    );
  });

  test("the re-opened gates actually let the next batch through", async () => {
    writeLands = false;
    await ServiceService.updateLastSeen(SERVICE_ID, {
      serviceVersion: "1.2.3",
    });

    writeLands = true;
    SingleFlight.clear();
    await ServiceService.updateLastSeen(SERVICE_ID, {
      serviceVersion: "1.2.3",
    });

    expect(writes).toHaveLength(2);
    expect(lastWrite()["serviceVersion"]).toBe("1.2.3");
  });
});

describe("ServiceService.updateLastSeen — duplicate in-process callers collapse", () => {
  /*
   * One OTLP batch resolves the same service once per resource, and the
   * collector config OneUptime itself ships emits hundreds of resources per
   * batch. Without in-process coalescing each one independently asks Redis the
   * same question — correct, but it multiplies the round trips by the resource
   * count for no information gained.
   */
  test("concurrent identical calls issue a single write", async () => {
    await Promise.all(
      Array.from({ length: 200 }, () => {
        return ServiceService.updateLastSeen(SERVICE_ID, {
          serviceVersion: "1.0.0",
        });
      }),
    );

    expect(writes).toHaveLength(1);
  });

  test("concurrent identical calls make a single fence claim", async () => {
    await Promise.all(
      Array.from({ length: 200 }, () => {
        return ServiceService.updateLastSeen(SERVICE_ID, {
          serviceVersion: "1.0.0",
        });
      }),
    );

    expect(GlobalCache.setStringIfNotExists).toHaveBeenCalledTimes(2);
  });

  /*
   * Coalescing must not merge callers carrying DIFFERENT metadata — that
   * would silently drop one producer's payload rather than throttling it.
   */
  test("concurrent calls carrying different metadata are not merged", async () => {
    await Promise.all([
      ServiceService.updateLastSeen(SERVICE_ID, { serviceVersion: "1.0.0" }),
      ServiceService.updateLastSeen(SERVICE_ID, { serviceVersion: "2.0.0" }),
    ]);

    // Both were considered; the gates, not the coalescer, decide what lands.
    expect(GlobalCache.setStringIfChanged).toHaveBeenCalledTimes(2);
  });

  test("concurrent calls for different services are not merged", async () => {
    const other: ObjectID = ObjectID.generate();

    await Promise.all([
      ServiceService.updateLastSeen(SERVICE_ID),
      ServiceService.updateLastSeen(other),
    ]);

    expect(writes).toHaveLength(2);
  });

  test("a rejected shared call does not strand later callers", async () => {
    jest
      .spyOn(ServiceService, "updateColumnsByIdIfUnlockedWithoutHooks")
      .mockRejectedValue(new Error("connection terminated"));

    await expect(
      ServiceService.updateLastSeen(SERVICE_ID, { serviceVersion: "1.0.0" }),
    ).rejects.toThrow("connection terminated");

    expect(SingleFlight.inflightCount()).toBe(0);
  });
});
