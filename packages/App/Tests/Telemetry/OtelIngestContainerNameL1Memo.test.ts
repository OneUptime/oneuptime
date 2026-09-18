/*
 * The Queue infrastructure module pulls in BullMQ (ESM-only msgpackr) at
 * import time via the services' queue imports; nothing queue-related is
 * under test here, so the module is replaced — same idiom as
 * OtelIngestEntityIdL1Memo.test.ts in this directory.
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

import OtelIngestBaseService from "../../FeatureSet/Telemetry/Services/OtelIngestBaseService";
import GlobalCache from "Common/Server/Infrastructure/GlobalCache";
import logger from "Common/Server/Utils/Logger";
import ObjectID from "Common/Types/ObjectID";
import { JSONArray, JSONObject } from "Common/Types/JSON";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * The shared container-name L1 memo in front of the docker/podman
 * id -> name Redis caches in getDockerServiceName / getPodmanServiceName.
 *
 * docker_stats metric batches carry container.id AND container.name and used
 * to pay one serialized Redis SETEX per resource block; filelog log batches
 * carry only container.id and paid one GET per block. The L1 collapses the
 * steady state to zero round trips — but ONLY for positive outcomes:
 *
 *   1. WRITE DEDUPE: an identical (project, container) -> name write from
 *      this process is suppressed inside the 60s TTL; a RENAME still writes
 *      through immediately (the memoed value differs).
 *   2. READ MEMO: one Redis hit serves same-pod lookups for the TTL, and a
 *      metrics block warms the log path in the same process.
 *   3. MISSES ARE NEVER MEMOED: an unresolved id must retry Redis on every
 *      block, or container-name resolution would be delayed and log rows
 *      misrouted to the DockerHost/PodmanHost entity for the TTL.
 *   4. The memo is set only AFTER a successful Redis write, so a failed
 *      write retries on the next block exactly as before.
 *   5. Memo hits and Redis hits normalize through the same function, so the
 *      returned service name is byte-identical either way.
 */

const PROJECT_ID: ObjectID = ObjectID.generate();
const CONTAINER_ID: string = "4f5a6b7c8d9e0f1a2b3c";
const RAW_NAME: string = "oneuptime-postgres-1";
const NORMALIZED_NAME: string = "oneuptime-postgres";
const CACHE_EXPIRY_SECONDS: number = 24 * 60 * 60;

/* eslint-disable @typescript-eslint/no-explicit-any */
const baseService: Record<string, any> =
  OtelIngestBaseService as unknown as Record<string, any>;
/* eslint-enable @typescript-eslint/no-explicit-any */

function stringAttribute(key: string, value: string): JSONObject {
  return { key: key, value: { stringValue: value } };
}

type RuntimeCase = {
  /** describe() title. */
  name: string;
  /** The private resolver under test. */
  method: string;
  /** The Redis namespace its id -> name cache lives under. */
  namespace: string;
  /** The container.runtime attribute value real batches carry. */
  runtime: string;
};

const RUNTIME_CASES: Array<RuntimeCase> = [
  {
    name: "getDockerServiceName",
    method: "getDockerServiceName",
    namespace: "docker-container-name",
    runtime: "docker",
  },
  {
    name: "getPodmanServiceName",
    method: "getPodmanServiceName",
    namespace: "podman-container-name",
    runtime: "podman",
  },
];

describe.each(RUNTIME_CASES)(
  "$name container-name L1 memo",
  ({ method, namespace, runtime }: RuntimeCase) => {
    /** Stands in for Redis, keyed `namespace:key` like the real client. */
    let fakeRedis: Map<string, string>;
    let nowMs: number;

    /** docker_stats shape: both container.id and container.name. */
    function metricsAttributes(containerName: string): JSONArray {
      return [
        stringAttribute("container.runtime", runtime),
        stringAttribute("container.id", CONTAINER_ID),
        stringAttribute("container.name", containerName),
      ] as JSONArray;
    }

    /** filelog shape: container.id only. */
    function logAttributes(containerId: string): JSONArray {
      return [
        stringAttribute("container.runtime", runtime),
        stringAttribute("container.id", containerId),
      ] as JSONArray;
    }

    /*
     * `null` means "request carries no projectId" — an explicit `undefined`
     * argument would trigger the default parameter instead.
     */
    async function resolve(
      attributes: JSONArray,
      projectId: ObjectID | null = PROJECT_ID,
    ): Promise<string | null> {
      return (await baseService[method](
        { headers: {}, projectId: projectId ?? undefined },
        attributes,
      )) as string | null;
    }

    function nameGetCalls(): number {
      return (GlobalCache.getString as jest.Mock).mock.calls.filter(
        (call: Array<unknown>) => {
          return call[0] === namespace;
        },
      ).length;
    }

    function nameSetCalls(): Array<Array<unknown>> {
      return (GlobalCache.setString as jest.Mock).mock.calls.filter(
        (call: Array<unknown>) => {
          return call[0] === namespace;
        },
      );
    }

    function seedRedis(rawName: string): void {
      fakeRedis.set(
        `${namespace}:${PROJECT_ID.toString()}:${CONTAINER_ID}`,
        rawName,
      );
    }

    beforeEach(() => {
      fakeRedis = new Map<string, string>();
      nowMs = 1_700_000_000_000;

      /*
       * The in-process memos survive across tests inside one process; treat
       * their TTLs as expired between cases, the same way fakeRedis is
       * rebuilt.
       */
      OtelIngestBaseService.clearInProcessMemos();

      jest.spyOn(Date, "now").mockImplementation(() => {
        return nowMs;
      });

      jest
        .spyOn(GlobalCache, "getString")
        .mockImplementation(async (ns: string, key: string) => {
          return fakeRedis.get(`${ns}:${key}`) ?? null;
        });
      jest
        .spyOn(GlobalCache, "setString")
        .mockImplementation(async (ns: string, key: string, value: string) => {
          fakeRedis.set(`${ns}:${key}`, value);
        });

      // The outage / write-failure cases log through here; keep them quiet.
      jest.spyOn(logger, "error").mockImplementation(() => {
        return undefined;
      });
    });

    afterEach(() => {
      jest.restoreAllMocks();
      OtelIngestBaseService.clearInProcessMemos();
    });

    test("repeat metrics blocks write the id -> name mapping once", async () => {
      const first: string | null = await resolve(metricsAttributes(RAW_NAME));
      const second: string | null = await resolve(metricsAttributes(RAW_NAME));

      expect(first).toBe(NORMALIZED_NAME);
      expect(second).toBe(NORMALIZED_NAME);

      const sets: Array<Array<unknown>> = nameSetCalls();
      expect(sets).toHaveLength(1);
      expect(sets[0]).toEqual([
        namespace,
        `${PROJECT_ID.toString()}:${CONTAINER_ID}`,
        RAW_NAME,
        { expiresInSeconds: CACHE_EXPIRY_SECONDS },
      ]);
    });

    test("a renamed container writes through immediately", async () => {
      const first: string | null = await resolve(metricsAttributes("web-1"));
      const second: string | null = await resolve(
        metricsAttributes("renamed-1"),
      );

      expect(first).toBe("web");
      expect(second).toBe("renamed");

      const sets: Array<Array<unknown>> = nameSetCalls();
      expect(sets).toHaveLength(2);
      expect(sets[1]?.[2]).toBe("renamed-1");
    });

    test("repeat log blocks after one Redis hit issue no further GET", async () => {
      seedRedis(RAW_NAME);

      const first: string | null = await resolve(logAttributes(CONTAINER_ID));
      const second: string | null = await resolve(logAttributes(CONTAINER_ID));

      expect(first).toBe(NORMALIZED_NAME);
      expect(second).toBe(NORMALIZED_NAME);
      expect(nameGetCalls()).toBe(1);
    });

    /*
     * THE guardrail: a miss is never memoed. Caching it would delay
     * first-contact name resolution and misroute that container's log rows
     * to the DockerHost/PodmanHost entity for the memo TTL.
     */
    test("a read miss is not memoed: every block retries Redis", async () => {
      const first: string | null = await resolve(logAttributes(CONTAINER_ID));
      const second: string | null = await resolve(logAttributes(CONTAINER_ID));

      expect(first).toBeNull();
      expect(second).toBeNull();
      expect(nameGetCalls()).toBe(2);
    });

    test("a metrics block warms the log path: id-only lookup costs zero GETs", async () => {
      await resolve(metricsAttributes(RAW_NAME));

      const resolved: string | null = await resolve(
        logAttributes(CONTAINER_ID),
      );

      expect(resolved).toBe(NORMALIZED_NAME);
      expect(nameGetCalls()).toBe(0);
    });

    test("a warmed name keeps resolving through a Redis outage; cold ids return null", async () => {
      seedRedis(RAW_NAME);
      await resolve(logAttributes(CONTAINER_ID));

      jest
        .spyOn(GlobalCache, "getString")
        .mockRejectedValue(new Error("redis down"));

      const warm: string | null = await resolve(logAttributes(CONTAINER_ID));
      expect(warm).toBe(NORMALIZED_NAME);

      // Cold entry under the same outage: error swallowed, null returned.
      const cold: string | null = await resolve(
        logAttributes("0000aaaabbbbcccc"),
      );
      expect(cold).toBeNull();
    });

    test("a failed write is not memoed: the next metrics block retries", async () => {
      jest
        .spyOn(GlobalCache, "setString")
        .mockRejectedValue(new Error("redis down"));

      const first: string | null = await resolve(metricsAttributes(RAW_NAME));
      const second: string | null = await resolve(metricsAttributes(RAW_NAME));

      // The name still resolves — the cache is best-effort.
      expect(first).toBe(NORMALIZED_NAME);
      expect(second).toBe(NORMALIZED_NAME);
      expect(nameSetCalls()).toHaveLength(2);
    });

    test("the memo expires on its TTL and falls back to Redis", async () => {
      seedRedis(RAW_NAME);
      await resolve(logAttributes(CONTAINER_ID));
      expect(nameGetCalls()).toBe(1);

      nowMs += 61 * 1000;
      const resolved: string | null = await resolve(
        logAttributes(CONTAINER_ID),
      );

      expect(resolved).toBe(NORMALIZED_NAME);
      expect(nameGetCalls()).toBe(2);
    });

    test("clearInProcessMemos drops the memo: the next read GETs again", async () => {
      seedRedis(RAW_NAME);
      await resolve(logAttributes(CONTAINER_ID));
      expect(nameGetCalls()).toBe(1);

      OtelIngestBaseService.clearInProcessMemos();

      const resolved: string | null = await resolve(
        logAttributes(CONTAINER_ID),
      );
      expect(resolved).toBe(NORMALIZED_NAME);
      expect(nameGetCalls()).toBe(2);
    });

    test("projectId absent: no cache traffic, memo never consulted", async () => {
      const named: string | null = await resolve(
        metricsAttributes(RAW_NAME),
        null,
      );
      expect(named).toBe(NORMALIZED_NAME);
      expect(nameSetCalls()).toHaveLength(0);

      const idOnly: string | null = await resolve(
        logAttributes(CONTAINER_ID),
        null,
      );
      expect(idOnly).toBeNull();
      expect(nameGetCalls()).toBe(0);
    });

    test("memo hits and Redis hits normalize identically", async () => {
      seedRedis("oneuptime-postgres-1");

      const redisHit: string | null = await resolve(
        logAttributes(CONTAINER_ID),
      );
      const memoHit: string | null = await resolve(logAttributes(CONTAINER_ID));

      expect(nameGetCalls()).toBe(1);
      expect(redisHit).toBe("oneuptime-postgres");
      expect(memoHit).toBe(redisHit);
    });
  },
);
