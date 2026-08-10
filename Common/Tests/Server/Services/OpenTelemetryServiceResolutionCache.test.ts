import GlobalCache from "../../../Server/Infrastructure/GlobalCache";
import ProjectService from "../../../Server/Services/ProjectService";
import ServiceService from "../../../Server/Services/ServiceService";
import OTelIngestService from "../../../Server/Services/OpenTelemetryIngestService";
import Service from "../../../Models/DatabaseModels/Service";
import ObjectID from "../../../Types/ObjectID";
import { JSONObject } from "../../../Types/JSON";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * Regression suite for the Postgres CPU incident.
 *
 * `findOrCreateTelemetryService` resolves an OTLP resource's `service.name` to
 * a Service row, and it was the one ungated operation on the hottest read path
 * in the product. Three multipliers stack on it, none of which the code
 * guarded:
 *
 *   1. It runs once per OTLP *resource*, not per request — the shipped
 *      host-metrics collector config produces hundreds per batch.
 *   2. It runs again for every signal type a collector exports (metrics, logs,
 *      traces, profiles re-resolve the same resource set).
 *   3. It runs from every ingest pod, concurrently.
 *
 * And the query it issued was the most expensive shape available.
 * `QueryHelper.findWithSameText` emits `LOWER("Service"."name") = $2`, while
 * every live index on Service is over the RAW name column — so Postgres uses
 * only the `projectId` prefix as an index qual and then heap-fetches and
 * filters every service in the project. Cost per call is O(services in
 * project), not O(log n). Production sat at 100% CPU with a 100% buffer cache
 * hit ratio and ~110 B/s of reads: pure in-memory CPU burn.
 *
 * What is pinned here:
 *
 *   1. A REPEATED RESOLUTION DOES NOT REACH POSTGRES. This is the assertion
 *      that would have prevented the incident.
 *   2. THE CACHE KEY FOLDS CASE AND WHITESPACE exactly as the SQL predicate
 *      does. If it did not, two spellings of one service.name would occupy two
 *      entries for one row and the cache would miss what it just wrote.
 *   3. PROJECTS ARE ISOLATED. A shared service.name across tenants must never
 *      resolve to another tenant's row.
 *   4. EVERY path that learns a Service — cold read, create, and the
 *      create-race refetch — populates the cache. The refetch emits SQL
 *      byte-identical to the cold read, so leaving it uncached would keep a
 *      first-contact stampede hitting Postgres.
 *   5. A CACHE OUTAGE NEVER FAILS INGEST. Telemetry must keep flowing when
 *      Redis is unavailable.
 *
 * Everything external is mocked — no Postgres, no Redis.
 */

jest.mock("../../../Server/Infrastructure/GlobalCache");
jest.mock("../../../Server/Services/ServiceService");
jest.mock("../../../Server/Services/ProjectService");
jest.mock("../../../Server/Services/LabelService");
/*
 * PasswordHash carries a pre-existing TS5.9 diagnostic that fails any suite
 * whose runtime require graph reaches it (DatabaseService, the base class of
 * every concrete service, imports it). Nothing password-related is under
 * test here, so the module is replaced WITH A FACTORY — an automock would
 * still require (and type-check) the real file.
 */
jest.mock("../../../Server/Utils/PasswordHash", () => {
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
jest.mock("../../../Server/Utils/Telemetry/EntityRegistry", () => {
  return {
    __esModule: true,
    reconcileEntityRegistryThrottled: jest.fn(),
  };
});

const SERVICE_RESOLUTION_NAMESPACE: string = "service-resolution";

// Stands in for Redis so the two cache layers can be exercised independently.
let fakeRedis: Map<string, JSONObject>;

type CacheKeyFunction = (namespace: string, key: string) => string;
const cacheKey: CacheKeyFunction = (namespace: string, key: string): string => {
  return `${namespace}::${key}`;
};

type ResolutionKeyFunction = (projectId: ObjectID, name: string) => string;
const resolutionKey: ResolutionKeyFunction = (
  projectId: ObjectID,
  name: string,
): string => {
  return `${projectId.toString()}:${name.toLowerCase().trim()}`;
};

type BuildServiceFunction = (overrides?: {
  retainTelemetryDataForDays?: number | null;
}) => Service;

const buildService: BuildServiceFunction = (overrides?: {
  retainTelemetryDataForDays?: number | null;
}): Service => {
  const service: Service = new Service();
  service._id = ObjectID.generate().toString();

  if (
    overrides?.retainTelemetryDataForDays !== undefined &&
    overrides.retainTelemetryDataForDays !== null
  ) {
    service.retainTelemetryDataForDays = overrides.retainTelemetryDataForDays;
  }

  return service;
};

describe("OTelIngestService service-resolution cache", () => {
  let findOneBy: jest.Mock;
  let create: jest.Mock;

  beforeEach(() => {
    fakeRedis = new Map<string, JSONObject>();

    (GlobalCache.getJSONObject as unknown as jest.Mock).mockImplementation(
      async (namespace: string, key: string): Promise<JSONObject | null> => {
        return fakeRedis.get(cacheKey(namespace, key)) ?? null;
      },
    );
    (GlobalCache.setJSON as unknown as jest.Mock).mockImplementation(
      async (
        namespace: string,
        key: string,
        value: JSONObject,
      ): Promise<void> => {
        fakeRedis.set(cacheKey(namespace, key), value);
      },
    );

    findOneBy = ServiceService.findOneBy as unknown as jest.Mock;
    create = ServiceService.create as unknown as jest.Mock;

    findOneBy.mockReset();
    create.mockReset();

    (ServiceService.updateLastSeen as unknown as jest.Mock).mockResolvedValue(
      undefined,
    );
    (ServiceService.attachLabels as unknown as jest.Mock).mockResolvedValue(
      undefined,
    );

    (ProjectService.findOneById as unknown as jest.Mock).mockImplementation(
      async (): Promise<JSONObject> => {
        return {
          defaultTelemetryRetentionInDays: 15,
          telemetryRetentionConfig: null,
        } as unknown as JSONObject;
      },
    );
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  /*
   * THE assertion. Hundreds of resolutions per batch collapsing to one
   * Postgres read is the entire point of the change.
   */
  test("resolves a repeated service.name without touching Postgres again", async () => {
    const projectId: ObjectID = ObjectID.generate();
    const service: Service = buildService();
    findOneBy.mockResolvedValue(service);

    for (let i: number = 0; i < 50; i++) {
      await OTelIngestService.telemetryServiceFromName({
        serviceName: "checkout-api",
        projectId,
      });
    }

    expect(findOneBy).toHaveBeenCalledTimes(1);
  });

  test("returns the same primaryEntityId from cache as from Postgres", async () => {
    const projectId: ObjectID = ObjectID.generate();
    const service: Service = buildService();
    findOneBy.mockResolvedValue(service);

    const first: { primaryEntityId: ObjectID } =
      await OTelIngestService.telemetryServiceFromName({
        serviceName: "checkout-api",
        projectId,
      });
    const second: { primaryEntityId: ObjectID } =
      await OTelIngestService.telemetryServiceFromName({
        serviceName: "checkout-api",
        projectId,
      });

    expect(second.primaryEntityId.toString()).toBe(
      first.primaryEntityId.toString(),
    );
    expect(second.primaryEntityId.toString()).toBe(service._id);
  });

  test("preserves the service-level retention override across a cache hit", async () => {
    const projectId: ObjectID = ObjectID.generate();
    findOneBy.mockResolvedValue(
      buildService({ retainTelemetryDataForDays: 45 }),
    );

    await OTelIngestService.telemetryServiceFromName({
      serviceName: "retention-svc",
      projectId,
    });
    const cached: {
      serviceRetentionInDays: number | null;
      dataRententionInDays: number;
    } = await OTelIngestService.telemetryServiceFromName({
      serviceName: "retention-svc",
      projectId,
    });

    // Would silently fall back to the project default (15) if dropped.
    expect(cached.serviceRetentionInDays).toBe(45);
    expect(cached.dataRententionInDays).toBe(45);
  });

  /*
   * The cache key must fold exactly what LOWER()/trim folds in the predicate.
   * Otherwise a batch could miss the entry the previous batch just wrote.
   */
  test("folds case and surrounding whitespace into one cache entry", async () => {
    const projectId: ObjectID = ObjectID.generate();
    findOneBy.mockResolvedValue(buildService());

    for (const spelling of [
      "Payments",
      "payments",
      "PAYMENTS",
      "  Payments  ",
      "\tpayments\n",
    ]) {
      await OTelIngestService.telemetryServiceFromName({
        serviceName: spelling,
        projectId,
      });
    }

    expect(findOneBy).toHaveBeenCalledTimes(1);
  });

  test("keeps distinct service names apart", async () => {
    const projectId: ObjectID = ObjectID.generate();
    findOneBy.mockResolvedValue(buildService());

    await OTelIngestService.telemetryServiceFromName({
      serviceName: "svc-alpha",
      projectId,
    });
    await OTelIngestService.telemetryServiceFromName({
      serviceName: "svc-beta",
      projectId,
    });

    expect(findOneBy).toHaveBeenCalledTimes(2);
  });

  /*
   * Cross-tenant isolation. Service names are not globally unique, so a
   * project-blind key would leak one tenant's service id into another's rows.
   */
  test("never shares a cache entry across projects", async () => {
    const projectA: ObjectID = ObjectID.generate();
    const projectB: ObjectID = ObjectID.generate();
    const serviceA: Service = buildService();
    const serviceB: Service = buildService();

    findOneBy.mockResolvedValueOnce(serviceA).mockResolvedValueOnce(serviceB);

    const first: { primaryEntityId: ObjectID } =
      await OTelIngestService.telemetryServiceFromName({
        serviceName: "api",
        projectId: projectA,
      });
    const second: { primaryEntityId: ObjectID } =
      await OTelIngestService.telemetryServiceFromName({
        serviceName: "api",
        projectId: projectB,
      });

    expect(findOneBy).toHaveBeenCalledTimes(2);
    expect(first.primaryEntityId.toString()).toBe(serviceA._id);
    expect(second.primaryEntityId.toString()).toBe(serviceB._id);
  });

  /*
   * L2 is what makes the cache work across pods. A key this process has never
   * seen must still resolve without Postgres if another pod warmed Redis.
   */
  test("serves a cold in-process cache from Redis without hitting Postgres", async () => {
    const projectId: ObjectID = ObjectID.generate();
    const serviceId: string = ObjectID.generate().toString();

    fakeRedis.set(
      cacheKey(
        SERVICE_RESOLUTION_NAMESPACE,
        resolutionKey(projectId, "warmed-by-another-pod"),
      ),
      {
        serviceId,
        retainTelemetryDataForDays: 7,
        telemetryRetentionConfig: null,
      },
    );

    const result: {
      primaryEntityId: ObjectID;
      serviceRetentionInDays: number | null;
    } = await OTelIngestService.telemetryServiceFromName({
      serviceName: "warmed-by-another-pod",
      projectId,
    });

    expect(findOneBy).not.toHaveBeenCalled();
    expect(result.primaryEntityId.toString()).toBe(serviceId);
    expect(result.serviceRetentionInDays).toBe(7);
  });

  test("writes through to Redis so other pods benefit", async () => {
    const projectId: ObjectID = ObjectID.generate();
    const service: Service = buildService();
    findOneBy.mockResolvedValue(service);

    await OTelIngestService.telemetryServiceFromName({
      serviceName: "write-through",
      projectId,
    });

    const stored: JSONObject | undefined = fakeRedis.get(
      cacheKey(
        SERVICE_RESOLUTION_NAMESPACE,
        resolutionKey(projectId, "write-through"),
      ),
    );

    expect(stored).toBeDefined();
    expect(stored!["serviceId"]).toBe(service._id);
  });

  test("treats a cached entry with no serviceId as a miss", async () => {
    /*
     * A malformed entry must not stamp rows with a broken primaryEntityId —
     * re-resolve instead.
     */
    const projectId: ObjectID = ObjectID.generate();
    const service: Service = buildService();
    findOneBy.mockResolvedValue(service);

    fakeRedis.set(
      cacheKey(
        SERVICE_RESOLUTION_NAMESPACE,
        resolutionKey(projectId, "malformed"),
      ),
      { retainTelemetryDataForDays: 7, telemetryRetentionConfig: null },
    );

    const result: { primaryEntityId: ObjectID } =
      await OTelIngestService.telemetryServiceFromName({
        serviceName: "malformed",
        projectId,
      });

    expect(findOneBy).toHaveBeenCalledTimes(1);
    expect(result.primaryEntityId.toString()).toBe(service._id);
  });

  /*
   * A newly created service must be cached too, or first contact with a busy
   * new deployment keeps re-reading Postgres for every resource in the batch.
   */
  test("caches a service it just created", async () => {
    const projectId: ObjectID = ObjectID.generate();
    const created: Service = buildService();

    findOneBy.mockResolvedValue(null);
    create.mockResolvedValue(created);

    const first: { primaryEntityId: ObjectID } =
      await OTelIngestService.telemetryServiceFromName({
        serviceName: "brand-new",
        projectId,
      });
    const second: { primaryEntityId: ObjectID } =
      await OTelIngestService.telemetryServiceFromName({
        serviceName: "brand-new",
        projectId,
      });

    expect(create).toHaveBeenCalledTimes(1);
    expect(findOneBy).toHaveBeenCalledTimes(1);
    expect(second.primaryEntityId.toString()).toBe(
      first.primaryEntityId.toString(),
    );
  });

  /*
   * The create-race refetch emits SQL byte-identical to the cold read and is
   * indistinguishable from it in pg_stat_activity. A first-contact stampede is
   * exactly when it runs hot, so it must cache too.
   */
  test("caches the winner after losing a create race", async () => {
    const projectId: ObjectID = ObjectID.generate();
    const winner: Service = buildService();

    findOneBy.mockResolvedValueOnce(null).mockResolvedValueOnce(winner);
    create.mockRejectedValue(new Error("duplicate key value violates unique"));

    const first: { primaryEntityId: ObjectID } =
      await OTelIngestService.telemetryServiceFromName({
        serviceName: "raced",
        projectId,
      });
    const second: { primaryEntityId: ObjectID } =
      await OTelIngestService.telemetryServiceFromName({
        serviceName: "raced",
        projectId,
      });

    expect(first.primaryEntityId.toString()).toBe(winner._id);
    expect(second.primaryEntityId.toString()).toBe(winner._id);
    // Cold read + refetch, then nothing further.
    expect(findOneBy).toHaveBeenCalledTimes(2);
  });

  test("does not cache a failure — a later call can still resolve", async () => {
    const projectId: ObjectID = ObjectID.generate();
    const service: Service = buildService();

    findOneBy.mockResolvedValueOnce(null);
    create.mockRejectedValueOnce(new Error("boom"));
    findOneBy.mockResolvedValueOnce(null);

    await expect(
      OTelIngestService.telemetryServiceFromName({
        serviceName: "transient",
        projectId,
      }),
    ).rejects.toThrow();

    findOneBy.mockResolvedValue(service);

    const recovered: { primaryEntityId: ObjectID } =
      await OTelIngestService.telemetryServiceFromName({
        serviceName: "transient",
        projectId,
      });

    expect(recovered.primaryEntityId.toString()).toBe(service._id);
  });

  /*
   * Ingest must survive a Redis outage. Losing the cache costs CPU; failing
   * the request drops telemetry.
   */
  test("falls back to Postgres when the cache read throws", async () => {
    const projectId: ObjectID = ObjectID.generate();
    const service: Service = buildService();
    findOneBy.mockResolvedValue(service);
    (GlobalCache.getJSONObject as unknown as jest.Mock).mockRejectedValue(
      new Error("redis is down"),
    );

    const result: { primaryEntityId: ObjectID } =
      await OTelIngestService.telemetryServiceFromName({
        serviceName: "redis-down-read",
        projectId,
      });

    expect(result.primaryEntityId.toString()).toBe(service._id);
    expect(findOneBy).toHaveBeenCalledTimes(1);
  });

  test("still serves ingest when the cache write throws", async () => {
    const projectId: ObjectID = ObjectID.generate();
    const service: Service = buildService();
    findOneBy.mockResolvedValue(service);
    (GlobalCache.setJSON as unknown as jest.Mock).mockRejectedValue(
      new Error("redis is down"),
    );

    const result: { primaryEntityId: ObjectID } =
      await OTelIngestService.telemetryServiceFromName({
        serviceName: "redis-down-write",
        projectId,
      });

    expect(result.primaryEntityId.toString()).toBe(service._id);
  });

  test("still serves the L1 memo when Redis is unavailable", async () => {
    const projectId: ObjectID = ObjectID.generate();
    findOneBy.mockResolvedValue(buildService());
    (GlobalCache.getJSONObject as unknown as jest.Mock).mockRejectedValue(
      new Error("redis is down"),
    );
    (GlobalCache.setJSON as unknown as jest.Mock).mockRejectedValue(
      new Error("redis is down"),
    );

    await OTelIngestService.telemetryServiceFromName({
      serviceName: "l1-only",
      projectId,
    });
    await OTelIngestService.telemetryServiceFromName({
      serviceName: "l1-only",
      projectId,
    });

    // L1 is in-process and unaffected by the outage.
    expect(findOneBy).toHaveBeenCalledTimes(1);
  });

  /*
   * The cache must not change WHICH row the cold path selects. Pins the query
   * shape that the (still missing) LOWER(name) expression index has to serve.
   */
  test("leaves the cold-path query shape untouched", async () => {
    const projectId: ObjectID = ObjectID.generate();
    findOneBy.mockResolvedValue(buildService());

    await OTelIngestService.telemetryServiceFromName({
      serviceName: "query-shape",
      projectId,
    });

    const args: {
      select: JSONObject;
      sort: JSONObject;
      props: JSONObject;
    } = (findOneBy.mock.calls[0] as Array<unknown>)[0] as {
      select: JSONObject;
      sort: JSONObject;
      props: JSONObject;
    };

    expect(args.select).toEqual({
      _id: true,
      retainTelemetryDataForDays: true,
      telemetryRetentionConfig: true,
    });
    // Oldest-wins remains the tiebreak if duplicates ever exist.
    expect(args.sort).toEqual({ createdAt: "ASC" });
    expect(args.props).toEqual({ isRoot: true });
  });

  test("still heartbeats lastSeen on a cache hit", async () => {
    /*
     * The cache removes the READ, not the liveness write. A service whose
     * telemetry is still arriving must not go stale just because its
     * resolution was memoized.
     */
    const projectId: ObjectID = ObjectID.generate();
    findOneBy.mockResolvedValue(buildService());

    await OTelIngestService.telemetryServiceFromName({
      serviceName: "heartbeat",
      projectId,
    });
    await OTelIngestService.telemetryServiceFromName({
      serviceName: "heartbeat",
      projectId,
    });

    expect(ServiceService.updateLastSeen).toHaveBeenCalledTimes(2);
  });
});
