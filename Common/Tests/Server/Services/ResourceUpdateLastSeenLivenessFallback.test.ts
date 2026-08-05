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
 * Issue #3006 was reported against Host, but HostService.updateLastSeen was
 * never the only service shaped that way. Ten siblings write the same two
 * liveness columns (lastSeenAt + otelCollectorStatus) in the SAME hook-free
 * UPDATE as a handful of optional columns harvested from OpenTelemetry
 * resource attributes — and each has its own markDisconnected* job that
 * flips the resource to "disconnected" 15 minutes after lastSeenAt stops
 * advancing.
 *
 * The clamp that stops a Postgres rejection now lives inside
 * updateColumnsByIdWithoutHooks (see HookFreeWriteLengthClamp.test.ts), so
 * the statement should not fail in the first place. This suite pins the
 * SECOND, independent guard, per service: if the enriched write fails
 * ANYWAY — for any reason at all, a constraint nobody predicted, a column
 * type nobody clamped — the liveness columns are retried on their own.
 * Enrichment is what gets dropped, never the heartbeat.
 *
 * Also pinned per service: the throttle that keeps the steady state cheap
 * must not swallow the retry, and a Redis outage must fail OPEN. Marking a
 * live resource disconnected because the cache went down would be the same
 * bug wearing a different hat.
 *
 * Everything external is mocked — no Postgres, no Redis.
 */

type WriteCall = { id: ObjectID; data: Record<string, unknown> };

/*
 * Which hook-free write primitive this service's heartbeat uses.
 *
 * `updateColumnsByIdIfUnlockedWithoutHooks` is the SKIP LOCKED variant: it
 * yields instead of queueing when another writer holds the row, which caps the
 * number of backends blocked on any one row at one. The hottest heartbeats
 * (Host, and Service in its own suite) are on it because they are the ones the
 * row-lock convoy formed on. The rest stay on the blocking write: every one of
 * them is fenced upstream by shouldRunMaintenance at five minutes, so their
 * arrival rate never approaches their service rate and there is nothing for
 * SKIP LOCKED to save them from.
 *
 * If a heartbeat moves between the two, change it HERE — the assertions below
 * are about liveness surviving, not about which primitive delivers it.
 */
type WriteMethodName =
  | "updateColumnsByIdWithoutHooks"
  | "updateColumnsByIdIfUnlockedWithoutHooks";

type ServiceCase = {
  /** Name of the service, used as the describe() title. */
  name: string;
  service: {
    updateLastSeen(id: ObjectID, extra?: never): Promise<void>;
  } & Record<
    WriteMethodName,
    (input: { id: ObjectID; data: unknown }) => Promise<unknown>
  >;
  writeMethod: WriteMethodName;
  /** A metadata payload this service accepts, and a different one. */
  extra: Record<string, unknown>;
  otherExtra: Record<string, unknown>;
  /** A string column whose value the collector supplies. */
  oversizedExtra: Record<string, unknown>;
};

/** Longer than any bounded column on any of these models. */
const OVERSIZED: string = "x".repeat(5000);

/* eslint-disable @typescript-eslint/no-explicit-any */
const SERVICE_CASES: Array<ServiceCase> = [
  {
    name: "DockerHostService",
    service: DockerHostService as any,
    writeMethod: "updateColumnsByIdWithoutHooks",
    extra: { osType: "linux" },
    otherExtra: { osType: "windows" },
    oversizedExtra: { osVersion: OVERSIZED },
  },
  {
    name: "PodmanHostService",
    service: PodmanHostService as any,
    writeMethod: "updateColumnsByIdWithoutHooks",
    extra: { osType: "linux" },
    otherExtra: { osType: "windows" },
    oversizedExtra: { osVersion: OVERSIZED },
  },
  {
    name: "KubernetesClusterService",
    service: KubernetesClusterService as any,
    writeMethod: "updateColumnsByIdWithoutHooks",
    extra: { agentVersion: "1.2.3" },
    otherExtra: { agentVersion: "1.2.4" },
    oversizedExtra: { agentVersion: OVERSIZED },
  },
  {
    name: "ProxmoxClusterService",
    service: ProxmoxClusterService as any,
    writeMethod: "updateColumnsByIdWithoutHooks",
    extra: { pveVersion: "8.1.4" },
    otherExtra: { pveVersion: "8.2.0" },
    oversizedExtra: { pveVersion: OVERSIZED },
  },
  {
    name: "IoTFleetService",
    service: IoTFleetService as any,
    writeMethod: "updateColumnsByIdWithoutHooks",
    extra: { agentVersion: "1.2.3" },
    otherExtra: { agentVersion: "1.2.4" },
    oversizedExtra: { agentVersion: OVERSIZED },
  },
  {
    name: "DockerSwarmClusterService",
    service: DockerSwarmClusterService as any,
    writeMethod: "updateColumnsByIdWithoutHooks",
    extra: { dockerVersion: "25.0.3" },
    otherExtra: { dockerVersion: "26.0.0" },
    oversizedExtra: { swarmId: OVERSIZED },
  },
  {
    name: "CephClusterService",
    service: CephClusterService as any,
    writeMethod: "updateColumnsByIdWithoutHooks",
    extra: { cephVersion: "18.2.2" },
    otherExtra: { cephVersion: "19.0.0" },
    oversizedExtra: { fsid: OVERSIZED },
  },
  {
    name: "ServerlessFunctionService",
    service: ServerlessFunctionService as any,
    writeMethod: "updateColumnsByIdWithoutHooks",
    extra: { runtimeName: "nodejs" },
    otherExtra: { runtimeName: "python" },
    oversizedExtra: { functionVersion: OVERSIZED },
  },
  {
    name: "CloudResourceService",
    service: CloudResourceService as any,
    writeMethod: "updateColumnsByIdWithoutHooks",
    extra: { cloudProvider: "aws" },
    otherExtra: { cloudProvider: "gcp" },
    oversizedExtra: { cloudRegion: OVERSIZED },
  },
  {
    name: "RumApplicationService",
    service: RumApplicationService as any,
    writeMethod: "updateColumnsByIdWithoutHooks",
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
    writeMethod: "updateColumnsByIdIfUnlockedWithoutHooks",
    extra: { osType: "linux" },
    otherExtra: { osType: "windows" },
    oversizedExtra: { hostId: OVERSIZED },
  },
];
/* eslint-enable @typescript-eslint/no-explicit-any */

describe.each(SERVICE_CASES)(
  "$name.updateLastSeen",
  ({
    service,
    writeMethod,
    extra,
    otherExtra,
    oversizedExtra,
  }: ServiceCase) => {
    let writes: Array<WriteCall>;
    let cache: Map<string, string>;
    let deletedCacheKeys: Array<string>;

    const RESOURCE_ID: ObjectID = ObjectID.generate();

    /**
     * Records every hook-free UPDATE instead of issuing it. Resolves `true`,
     * which the SKIP LOCKED variant reads as "the row was updated" and the
     * blocking variant ignores — so one fake serves both.
     */
    function mockWritesSucceeding(): void {
      jest
        .spyOn(service, writeMethod)
        .mockImplementation(async (input: { id: ObjectID; data: unknown }) => {
          writes.push({
            id: input.id,
            data: { ...(input.data as Record<string, unknown>) },
          });
          return true;
        });
    }

    /**
     * Fails any write carrying more than the two liveness columns — the
     * shape of a Postgres rejection caused by one bad optional column.
     */
    function mockEnrichedWriteFailing(): void {
      jest
        .spyOn(service, writeMethod)
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

    beforeEach(() => {
      writes = [];
      cache = new Map<string, string>();
      deletedCacheKeys = [];

      jest
        .spyOn(GlobalCache, "getString")
        .mockImplementation(async (namespace: string, key: string) => {
          return cache.get(`${namespace}:${key}`) ?? null;
        });
      jest
        .spyOn(GlobalCache, "setString")
        .mockImplementation(
          async (namespace: string, key: string, value: string) => {
            cache.set(`${namespace}:${key}`, value);
          },
        );
      jest
        .spyOn(GlobalCache, "deleteKey")
        .mockImplementation(async (namespace: string, key: string) => {
          deletedCacheKeys.push(`${namespace}:${key}`);
          cache.delete(`${namespace}:${key}`);
        });
    });

    afterEach(() => {
      jest.restoreAllMocks();
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
        await service.updateLastSeen(RESOURCE_ID, extra as never);

        expect(writes).toHaveLength(1);
      });

      test("writes again as soon as any metadata changes", async () => {
        await service.updateLastSeen(RESOURCE_ID, extra as never);
        await service.updateLastSeen(RESOURCE_ID, otherExtra as never);

        expect(writes).toHaveLength(2);
      });

      test("passes collector metadata through to the write path", async () => {
        await service.updateLastSeen(RESOURCE_ID, extra as never);

        for (const [column, value] of Object.entries(extra)) {
          expect(lastWrite()[column]).toBe(value);
        }
      });
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

      test("busts the throttle cache so the next batch is not skipped", async () => {
        await service.updateLastSeen(RESOURCE_ID, oversizedExtra as never);

        expect(deletedCacheKeys).toHaveLength(1);
        expect(deletedCacheKeys[0]).toContain(RESOURCE_ID.toString());
      });

      test("the next batch retries rather than short-circuiting on a cache hit", async () => {
        await service.updateLastSeen(RESOURCE_ID, oversizedExtra as never);
        writes = [];

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
          .spyOn(service, writeMethod)
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

      test("a read failure still writes — never mark a live resource disconnected", async () => {
        jest
          .spyOn(GlobalCache, "getString")
          .mockRejectedValue(new Error("redis down"));

        await service.updateLastSeen(RESOURCE_ID, extra as never);

        expect(writes).toHaveLength(1);
      });

      test("a write failure still writes", async () => {
        jest
          .spyOn(GlobalCache, "setString")
          .mockRejectedValue(new Error("redis down"));

        await service.updateLastSeen(RESOURCE_ID, extra as never);

        expect(writes).toHaveLength(1);
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
});
