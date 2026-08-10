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

import CephClusterService from "../../../Server/Services/CephClusterService";
import CloudResourceService from "../../../Server/Services/CloudResourceService";
import DockerHostService from "../../../Server/Services/DockerHostService";
import DockerSwarmClusterService from "../../../Server/Services/DockerSwarmClusterService";
import GlobalCache from "../../../Server/Infrastructure/GlobalCache";
import HostService from "../../../Server/Services/HostService";
import IoTFleetService from "../../../Server/Services/IoTFleetService";
import KubernetesClusterService from "../../../Server/Services/KubernetesClusterService";
import PodmanHostService from "../../../Server/Services/PodmanHostService";
import ProxmoxClusterService from "../../../Server/Services/ProxmoxClusterService";
import RumApplicationService from "../../../Server/Services/RumApplicationService";
import ServerlessFunctionService from "../../../Server/Services/ServerlessFunctionService";
import ResourceHeartbeat from "../../../Server/Utils/Telemetry/ResourceHeartbeat";
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
 * Every resource type's liveness heartbeat, pinned together.
 *
 * Eleven services write the same two liveness columns (lastSeenAt +
 * otelCollectorStatus) alongside optional columns harvested from
 * OpenTelemetry resource attributes, and each has its own markDisconnected*
 * job that flips the resource to "disconnected" 15 minutes after lastSeenAt
 * stops advancing. They now share one implementation — ResourceHeartbeat —
 * because eleven hand-copied versions meant eleven copies of the same defect.
 *
 * WHAT THE DEFECT WAS. The throttle keyed on the row id but STORED a
 * fingerprint of the incoming payload, skipping only on a match. That gives
 * zero throttling whenever the fingerprinted payload changes as fast as the
 * batches arrive, and on these paths it does:
 *
 *   - Cluster and fleet snapshots hash per-scrape GAUGES into the
 *     fingerprint — runningTaskCount, osdUpCount, onlineDeviceCount,
 *     capacityUsedPercent. A float utilisation percentage changes on
 *     literally every scrape, so the fingerprint never repeated and the
 *     window never engaged.
 *   - Four of these paths (Proxmox, Ceph, IoTFleet and DockerSwarm snapshot
 *     writebacks) have NO upstream shouldRunMaintenance fence either, so that
 *     broken throttle was the only thing standing between the ingest firehose
 *     and a row shared by every node in the cluster.
 *
 * Result: one UPDATE per batch per shared row, which is the row-lock convoy
 * that took production down.
 *
 * WHAT IS PINNED HERE, per service:
 *
 *   1. Liveness is gated on key PRESENCE, so no payload — however fast it
 *      churns — can force a second heartbeat inside a window. This is the
 *      assertion that would have caught the outage.
 *   2. Enrichment is bounded to one write per window even under continuous
 *      change.
 *   3. Liveness survives a failing enriched write (issue #3006), a Redis
 *      outage (fail open), and losing the row-lock race.
 *
 * Everything external is mocked — no Postgres, no Redis.
 */

type WriteCall = { id: ObjectID; data: Record<string, unknown> };

type ServiceCase = {
  /** Name of the service, used as the describe() title. */
  name: string;
  service: {
    updateLastSeen(id: ObjectID, extra?: never): Promise<void>;
    updateColumnsByIdIfUnlockedWithoutHooks(input: {
      id: ObjectID;
      data: unknown;
    }): Promise<boolean>;
  };
  /** The Redis namespace this model's gates live under. */
  namespace: string;
  /** A metadata payload this service accepts, and a different one. */
  extra: Record<string, unknown>;
  otherExtra: Record<string, unknown>;
  /** A string column whose value the collector supplies. */
  oversizedExtra: Record<string, unknown>;
  /**
   * A payload whose values move on every scrape, if this service has one.
   * These are what defeated the old throttle — see the header.
   */
  churningExtras?: Array<Record<string, unknown>>;
};

/** Longer than any bounded column on any of these models. */
const OVERSIZED: string = "x".repeat(5000);

/* eslint-disable @typescript-eslint/no-explicit-any */
const SERVICE_CASES: Array<ServiceCase> = [
  {
    name: "DockerHostService",
    service: DockerHostService as any,
    namespace: "docker-host-last-seen",
    extra: { osType: "linux" },
    otherExtra: { osType: "windows" },
    oversizedExtra: { osVersion: OVERSIZED },
  },
  {
    name: "PodmanHostService",
    service: PodmanHostService as any,
    namespace: "podman-host-last-seen",
    extra: { osType: "linux" },
    otherExtra: { osType: "windows" },
    oversizedExtra: { osVersion: OVERSIZED },
  },
  {
    name: "KubernetesClusterService",
    service: KubernetesClusterService as any,
    namespace: "k8s-cluster-last-seen",
    extra: { agentVersion: "1.2.3" },
    otherExtra: { agentVersion: "1.2.4" },
    oversizedExtra: { agentVersion: OVERSIZED },
  },
  {
    name: "ProxmoxClusterService",
    service: ProxmoxClusterService as any,
    namespace: "proxmox-cluster-last-seen",
    extra: { pveVersion: "8.1.4" },
    otherExtra: { pveVersion: "8.2.0" },
    oversizedExtra: { pveVersion: OVERSIZED },
    churningExtras: [
      { pveVersion: "8.1.4", onlineNodeCount: 11, guestCount: 240 },
      { pveVersion: "8.1.4", onlineNodeCount: 12, guestCount: 241 },
    ],
  },
  {
    name: "IoTFleetService",
    service: IoTFleetService as any,
    namespace: "iot-fleet-last-seen",
    extra: { agentVersion: "1.2.3" },
    otherExtra: { agentVersion: "1.2.4" },
    oversizedExtra: { agentVersion: OVERSIZED },
    churningExtras: [
      { agentVersion: "1.2.3", onlineDeviceCount: 8014 },
      { agentVersion: "1.2.3", onlineDeviceCount: 8015 },
    ],
  },
  {
    name: "DockerSwarmClusterService",
    service: DockerSwarmClusterService as any,
    namespace: "docker-swarm-cluster-last-seen",
    extra: { dockerVersion: "25.0.3" },
    otherExtra: { dockerVersion: "26.0.0" },
    oversizedExtra: { swarmId: OVERSIZED },
    churningExtras: [
      { dockerVersion: "25.0.3", runningTaskCount: 512, taskCount: 530 },
      { dockerVersion: "25.0.3", runningTaskCount: 513, taskCount: 530 },
    ],
  },
  {
    name: "CephClusterService",
    service: CephClusterService as any,
    namespace: "ceph-cluster-last-seen",
    extra: { cephVersion: "18.2.2" },
    otherExtra: { cephVersion: "19.0.0" },
    oversizedExtra: { fsid: OVERSIZED },
    /*
     * The worst of them: a float utilisation percentage moves on every single
     * scrape, so the old fingerprint was guaranteed never to repeat.
     */
    churningExtras: [
      { cephVersion: "18.2.2", capacityUsedPercent: 61.4, osdUpCount: 48 },
      { cephVersion: "18.2.2", capacityUsedPercent: 61.41, osdUpCount: 48 },
    ],
  },
  {
    name: "ServerlessFunctionService",
    service: ServerlessFunctionService as any,
    namespace: "serverless-function-last-seen",
    extra: { runtimeName: "nodejs" },
    otherExtra: { runtimeName: "python" },
    oversizedExtra: { functionVersion: OVERSIZED },
  },
  {
    name: "CloudResourceService",
    service: CloudResourceService as any,
    namespace: "cloud-resource-last-seen",
    extra: { cloudProvider: "aws" },
    otherExtra: { cloudProvider: "gcp" },
    oversizedExtra: { cloudRegion: OVERSIZED },
  },
  {
    name: "RumApplicationService",
    service: RumApplicationService as any,
    namespace: "rum-application-last-seen",
    extra: { sdkLanguage: "webjs" },
    otherExtra: { sdkLanguage: "swift" },
    oversizedExtra: { clientType: OVERSIZED },
  },
  {
    /*
     * Host rides the same table so the eleven paths stay pinned together —
     * its own richer regression coverage lives in
     * HostServiceUpdateLastSeen.test.ts.
     */
    name: "HostService",
    service: HostService as any,
    namespace: "host-last-seen",
    extra: { osType: "linux" },
    otherExtra: { osType: "windows" },
    oversizedExtra: { hostId: OVERSIZED },
    churningExtras: [
      { osType: "linux", processCount: 412, totalMemoryBytes: 17179869184 },
      { osType: "linux", processCount: 413, totalMemoryBytes: 17179869184 },
    ],
  },
];
/* eslint-enable @typescript-eslint/no-explicit-any */

describe.each(SERVICE_CASES)(
  "$name.updateLastSeen",
  ({
    service,
    namespace,
    extra,
    otherExtra,
    oversizedExtra,
    churningExtras,
  }: ServiceCase) => {
    let writes: Array<WriteCall>;
    let cache: Map<string, string>;
    let deletedCacheKeys: Array<string>;
    /** Set false to simulate the row being held by another writer. */
    let writeLands: boolean;

    const RESOURCE_ID: ObjectID = ObjectID.generate();

    /**
     * A faithful in-memory Redis. SET NX succeeds only on an absent key and
     * compare-and-claim only on a differing value — stubbing either to a
     * constant would make this suite agree with a broken implementation.
     */
    function mockCache(): void {
      jest
        .spyOn(GlobalCache, "setStringIfNotExists")
        .mockImplementation(async (ns: string, key: string, value: string) => {
          const full: string = `${ns}:${key}`;
          if (cache.has(full)) {
            return false;
          }
          cache.set(full, value);
          return true;
        });

      jest
        .spyOn(GlobalCache, "setStringIfChanged")
        .mockImplementation(async (ns: string, key: string, value: string) => {
          const full: string = `${ns}:${key}`;
          if (cache.get(full) === value) {
            return false;
          }
          cache.set(full, value);
          return true;
        });

      jest
        .spyOn(GlobalCache, "deleteKey")
        .mockImplementation(async (ns: string, key: string) => {
          const full: string = `${ns}:${key}`;
          deletedCacheKeys.push(full);
          cache.delete(full);
        });
    }

    /** Records every hook-free UPDATE instead of issuing it. */
    function mockWritesSucceeding(): void {
      jest
        .spyOn(service, "updateColumnsByIdIfUnlockedWithoutHooks")
        .mockImplementation(async (input: { id: ObjectID; data: unknown }) => {
          writes.push({
            id: input.id,
            data: { ...(input.data as Record<string, unknown>) },
          });
          return writeLands;
        });
    }

    /**
     * Fails any write carrying more than the two liveness columns — the
     * shape of a Postgres rejection caused by one bad optional column.
     */
    function mockEnrichedWriteFailing(): void {
      jest
        .spyOn(service, "updateColumnsByIdIfUnlockedWithoutHooks")
        .mockImplementation(async (input: { id: ObjectID; data: unknown }) => {
          const data: Record<string, unknown> = {
            ...(input.data as Record<string, unknown>),
          };
          writes.push({ id: input.id, data: data });
          if (Object.keys(data).length > 2) {
            throw new Error("value too long for type character varying(100)");
          }
          return true;
        });
    }

    function lastWrite(): Record<string, unknown> {
      return writes[writes.length - 1]!.data;
    }

    /**
     * Re-opens the liveness window without touching the enrichment gates.
     * The in-process recent-heartbeat memo is capped at the liveness
     * window, so its entries have expired by then too.
     */
    function expireLivenessWindow(): void {
      cache.delete(`${namespace}:${RESOURCE_ID.toString()}`);
      SingleFlight.clear();
      ResourceHeartbeat.clearRecentHeartbeatMemo();
    }

    beforeEach(() => {
      writes = [];
      cache = new Map<string, string>();
      deletedCacheKeys = [];
      writeLands = true;
      SingleFlight.clear();
      /*
       * Each case reuses one RESOURCE_ID across tests, so the settled-
       * heartbeat memo from a previous test must be treated as expired —
       * exactly as the fresh `cache` map treats the Redis TTLs. The memo's
       * own behaviour is pinned in
       * Utils/Telemetry/ResourceHeartbeatL1Memo.test.ts.
       */
      ResourceHeartbeat.clearRecentHeartbeatMemo();
      mockCache();
    });

    afterEach(() => {
      jest.restoreAllMocks();
      SingleFlight.clear();
      ResourceHeartbeat.clearRecentHeartbeatMemo();
    });

    describe("liveness columns", () => {
      beforeEach(() => {
        mockWritesSucceeding();
      });

      test("always writes lastSeenAt and marks the collector connected", async () => {
        await service.updateLastSeen(RESOURCE_ID);

        expect(writes).toHaveLength(1);
        expect(lastWrite()["otelCollectorStatus"]).toBe("connected");
        expect(lastWrite()["lastSeenAt"]).toBeInstanceOf(Date);
      });

      test("writes to the resource it was given", async () => {
        await service.updateLastSeen(RESOURCE_ID);

        expect(writes[0]!.id.toString()).toBe(RESOURCE_ID.toString());
      });

      test("skips the write when the same metadata was written recently", async () => {
        await service.updateLastSeen(RESOURCE_ID, extra as never);
        SingleFlight.clear();
        await service.updateLastSeen(RESOURCE_ID, extra as never);

        expect(writes).toHaveLength(1);
      });

      test("passes collector metadata through to the write path", async () => {
        await service.updateLastSeen(RESOURCE_ID, extra as never);

        for (const [column, value] of Object.entries(extra)) {
          expect(lastWrite()[column]).toBe(value);
        }
      });

      /*
       * A changed attribute still lands — but in the next window, not on the
       * very next batch. That is a deliberate narrowing of the old contract:
       * change detection cannot tell a real update apart from a gauge that
       * moves every scrape, both present as "it changed", and only one of
       * those is bounded. Bounding both is what removes the convoy. The delay
       * is at most one throttle window and `lastSeenAt` is unaffected, since
       * it rides the separate liveness gate.
       */
      test("a metadata change lands in the next window", async () => {
        await service.updateLastSeen(RESOURCE_ID, extra as never);
        expireLivenessWindow();
        cache.delete(`${namespace}-write-window:${RESOURCE_ID.toString()}`);

        await service.updateLastSeen(RESOURCE_ID, otherExtra as never);

        expect(writes).toHaveLength(2);
        for (const [column, value] of Object.entries(otherExtra)) {
          expect(lastWrite()[column]).toBe(value);
        }
      });

      /*
       * THE OUTAGE, reproduced per service. Continuously-changing metadata
       * must not be able to buy more than one write per window. Under the old
       * throttle each of these calls issued its own UPDATE against a row
       * shared by every node reporting into it.
       */
      test("continuously changing metadata cannot force a write per batch", async () => {
        for (let batch: number = 0; batch < 20; batch++) {
          SingleFlight.clear();
          await service.updateLastSeen(RESOURCE_ID, {
            ...extra,
            ...(batch % 2 === 0 ? otherExtra : {}),
          } as never);
        }

        expect(writes.length).toBeLessThanOrEqual(2);
      });

      if (churningExtras) {
        /*
         * The concrete production shape for this service: a payload whose
         * gauges move on every scrape (task counts, online device counts,
         * capacity percentages). These are hashed into the fingerprint, so
         * the old throttle never engaged for exactly the resources producing
         * the most batches.
         */
        test("per-scrape gauges cannot defeat the throttle", async () => {
          for (let scrape: number = 0; scrape < 20; scrape++) {
            SingleFlight.clear();
            await service.updateLastSeen(
              RESOURCE_ID,
              churningExtras[scrape % churningExtras.length] as never,
            );
          }

          expect(writes.length).toBeLessThanOrEqual(2);
        });

        test("the gauges are still written when a write happens", async () => {
          await service.updateLastSeen(RESOURCE_ID, churningExtras[0] as never);

          for (const [column, value] of Object.entries(churningExtras[0]!)) {
            expect(lastWrite()[column]).toBe(value);
          }
        });
      }
    });

    describe("fallback when the enriched write fails", () => {
      beforeEach(() => {
        mockEnrichedWriteFailing();
      });

      test("does not throw — ingest keeps going", async () => {
        await expect(
          service.updateLastSeen(RESOURCE_ID, oversizedExtra as never),
        ).resolves.toBeUndefined();
      });

      test("retries with liveness only, so lastSeenAt still advances", async () => {
        await service.updateLastSeen(RESOURCE_ID, oversizedExtra as never);

        expect(writes).toHaveLength(2);
        expect(Object.keys(lastWrite()).sort()).toEqual([
          "lastSeenAt",
          "otelCollectorStatus",
        ]);
        expect(lastWrite()["otelCollectorStatus"]).toBe("connected");
        expect(lastWrite()["lastSeenAt"]).toBeInstanceOf(Date);
      });

      test("the retry targets the same resource", async () => {
        await service.updateLastSeen(RESOURCE_ID, oversizedExtra as never);

        expect(writes[1]!.id.toString()).toBe(RESOURCE_ID.toString());
      });

      /*
       * The enrichment gates were claimed before the write that failed, so
       * without releasing them the next batch would short-circuit and the
       * retry would never happen.
       */
      test("re-opens the enrichment gates so the next batch retries", async () => {
        await service.updateLastSeen(RESOURCE_ID, oversizedExtra as never);

        expect(deletedCacheKeys).toContain(
          `${namespace}-fingerprint:${RESOURCE_ID.toString()}`,
        );
        expect(deletedCacheKeys).toContain(
          `${namespace}-write-window:${RESOURCE_ID.toString()}`,
        );
      });

      test("the next batch retries rather than short-circuiting", async () => {
        await service.updateLastSeen(RESOURCE_ID, oversizedExtra as never);
        writes = [];
        expireLivenessWindow();

        await service.updateLastSeen(RESOURCE_ID, oversizedExtra as never);

        // Enriched attempt + liveness fallback, not a silent no-op.
        expect(writes).toHaveLength(2);
      });

      test("a failing cache delete does not stop the liveness retry", async () => {
        jest
          .spyOn(GlobalCache, "deleteKey")
          .mockRejectedValue(new Error("redis down"));

        await service.updateLastSeen(RESOURCE_ID, oversizedExtra as never);

        expect(Object.keys(lastWrite()).sort()).toEqual([
          "lastSeenAt",
          "otelCollectorStatus",
        ]);
      });

      test("surfaces a genuinely broken database instead of hiding it", async () => {
        // Both attempts fail — the caller must find out.
        jest
          .spyOn(service, "updateColumnsByIdIfUnlockedWithoutHooks")
          .mockRejectedValue(new Error("connection terminated"));

        await expect(
          service.updateLastSeen(RESOURCE_ID, extra as never),
        ).rejects.toThrow("connection terminated");
      });
    });

    describe("cache outages fail open", () => {
      beforeEach(() => {
        mockWritesSucceeding();
      });

      /*
       * Never mark a live resource disconnected because the cache went down.
       * Affordable only because the write cannot queue — see the SKIP LOCKED
       * note on the write primitive.
       */
      test("a liveness gate failure still writes", async () => {
        jest
          .spyOn(GlobalCache, "setStringIfNotExists")
          .mockRejectedValue(new Error("redis down"));

        await service.updateLastSeen(RESOURCE_ID, extra as never);

        expect(writes).toHaveLength(1);
        expect(lastWrite()["lastSeenAt"]).toBeInstanceOf(Date);
      });

      test("keeps writing liveness for as long as the cache is down", async () => {
        jest
          .spyOn(GlobalCache, "setStringIfNotExists")
          .mockRejectedValue(new Error("redis down"));

        await service.updateLastSeen(RESOURCE_ID, extra as never);
        SingleFlight.clear();
        await service.updateLastSeen(RESOURCE_ID, extra as never);

        expect(writes).toHaveLength(2);
      });

      /*
       * Enrichment gets the OPPOSITE treatment: opening that gate during an
       * outage would restore the per-batch write storm, and nothing is
       * mis-reported by writing a descriptive column a little later.
       */
      test("a change-detection failure suppresses enrichment, not liveness", async () => {
        jest
          .spyOn(GlobalCache, "setStringIfChanged")
          .mockRejectedValue(new Error("redis down"));

        await service.updateLastSeen(RESOURCE_ID, extra as never);

        expect(writes).toHaveLength(1);
        expect(Object.keys(lastWrite()).sort()).toEqual([
          "lastSeenAt",
          "otelCollectorStatus",
        ]);
      });
    });

    describe("losing the row-lock race", () => {
      beforeEach(() => {
        mockWritesSucceeding();
        writeLands = false;
      });

      test("uses the non-blocking write primitive", async () => {
        await service.updateLastSeen(RESOURCE_ID);

        expect(
          service.updateColumnsByIdIfUnlockedWithoutHooks,
        ).toHaveBeenCalled();
      });

      /*
       * A skipped liveness bump is a non-event — the writer holding the lock
       * is storing the same timestamp. Retrying it would generate pointless
       * statements against a row that is demonstrably being written.
       */
      test("a skipped liveness-only write is dropped silently", async () => {
        await service.updateLastSeen(RESOURCE_ID);

        expect(deletedCacheKeys).toHaveLength(0);
      });

      /*
       * Enrichment is different: the lock holder may be writing an OLDER
       * payload, and the gates this call claimed would suppress the newer one
       * for the rest of the window.
       */
      test("a skipped enrichment write re-opens the gates", async () => {
        await service.updateLastSeen(RESOURCE_ID, extra as never);

        expect(deletedCacheKeys).toContain(
          `${namespace}-fingerprint:${RESOURCE_ID.toString()}`,
        );
      });
    });
  },
);

describe("liveness fallback coverage", () => {
  test("covers every service that writes liveness on the hook-free path", () => {
    /*
     * If a twelfth resource type grows an updateLastSeen, it belongs in
     * SERVICE_CASES — that is the whole point of this suite. Bumping this
     * number without adding the case defeats it.
     */
    expect(SERVICE_CASES).toHaveLength(11);
  });

  test("no service is listed twice", () => {
    const names: Array<string> = SERVICE_CASES.map((c: ServiceCase) => {
      return c.name;
    });

    expect(new Set(names).size).toBe(names.length);
  });

  /*
   * The namespace in each case must match the one the service actually uses,
   * or the gate assertions above silently check keys nobody writes.
   */
  test("no namespace is shared between services", () => {
    const namespaces: Array<string> = SERVICE_CASES.map((c: ServiceCase) => {
      return c.namespace;
    });

    expect(new Set(namespaces).size).toBe(namespaces.length);
  });
});
