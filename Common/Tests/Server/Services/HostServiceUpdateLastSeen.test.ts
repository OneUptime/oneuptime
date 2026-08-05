import GlobalCache from "../../../Server/Infrastructure/GlobalCache";
import HostService from "../../../Server/Services/HostService";
import Host from "../../../Models/DatabaseModels/Host";
import ObjectID from "../../../Types/ObjectID";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * Regression suite for issue #3006.
 *
 * HostService.updateLastSeen writes liveness (lastSeenAt +
 * otelCollectorStatus) in the SAME hook-free UPDATE as a dozen optional
 * columns harvested from OpenTelemetry resource attributes. Because that
 * raw path bypasses DatabaseService's length validation, an oversized
 * attribute reached Postgres unchecked and failed the whole statement —
 * so a host with telemetry still arriving stopped advancing lastSeenAt and
 * MarkDisconnectedHosts flipped it to "disconnected" 15 minutes later.
 *
 * Two independent guards are pinned here:
 *   1. collector-supplied strings are clamped to their column widths, so
 *      the statement does not fail in the first place, and
 *   2. if the enriched write fails ANYWAY (for any reason at all), the
 *      liveness columns are retried on their own. Enrichment is what gets
 *      dropped, never the heartbeat.
 *
 * Everything external is mocked — no Postgres, no Redis.
 */

const HOST_ID: ObjectID = ObjectID.generate();

/** Longer than every ShortText column (100) and the old LongText bound (500). */
const HUGE_IP_LIST: string = Array.from(
  { length: 55 },
  (_unused: unknown, i: number) => {
    return `fe80::42:acff:fe11:${(0x1000 + i).toString(16)}`;
  },
).join(", ");

type WriteCall = { id: ObjectID; data: Record<string, unknown> };

/** The (inline) shape of updateLastSeen's optional metadata argument. */
type UpdateLastSeenExtra = Parameters<typeof HostService.updateLastSeen>[1];

/** The argument to the hook-free UPDATE the service ultimately issues. */
type ColumnWrite = Parameters<
  typeof HostService.updateColumnsByIdWithoutHooks
>[0];

let writes: Array<WriteCall> = [];
let cache: Map<string, string> = new Map<string, string>();
let deletedCacheKeys: Array<string> = [];

function mockCache(): void {
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
}

function recordWrite(input: {
  id: ObjectID;
  data: unknown;
}): Record<string, unknown> {
  const data: Record<string, unknown> = {
    ...(input.data as Record<string, unknown>),
  };
  writes.push({ id: input.id, data: data });
  return data;
}

/** Records every hook-free UPDATE instead of issuing it. */
function mockWritesSucceeding(): void {
  jest
    .spyOn(HostService, "updateColumnsByIdWithoutHooks")
    .mockImplementation(async (input: ColumnWrite) => {
      recordWrite(input);
    });
}

/**
 * Fails any write that carries more than the two liveness columns — the
 * shape of a Postgres rejection caused by one bad optional column.
 */
function mockEnrichedWriteFailing(
  message: string = `value too long for type character varying(100)`,
): void {
  jest
    .spyOn(HostService, "updateColumnsByIdWithoutHooks")
    .mockImplementation(async (input: ColumnWrite) => {
      const data: Record<string, unknown> = recordWrite(input);
      if (Object.keys(data).length > 2) {
        throw new Error(message);
      }
    });
}

function lastWrite(): Record<string, unknown> {
  return writes[writes.length - 1]?.data as Record<string, unknown>;
}

describe("HostService.updateLastSeen", () => {
  beforeEach(() => {
    writes = [];
    cache = new Map<string, string>();
    deletedCacheKeys = [];
    mockCache();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("liveness columns", () => {
    beforeEach(() => {
      mockWritesSucceeding();
    });

    test("always writes lastSeenAt and marks the collector connected", async () => {
      await HostService.updateLastSeen(HOST_ID);

      expect(writes).toHaveLength(1);
      expect(lastWrite()["otelCollectorStatus"]).toBe("connected");
      expect(lastWrite()["lastSeenAt"]).toBeInstanceOf(Date);
    });

    test("writes to the host it was given", async () => {
      await HostService.updateLastSeen(HOST_ID);
      expect(writes[0]?.id.toString()).toBe(HOST_ID.toString());
    });

    test("skips the write when the same metadata was written recently", async () => {
      await HostService.updateLastSeen(HOST_ID, { osType: "linux" });
      await HostService.updateLastSeen(HOST_ID, { osType: "linux" });

      expect(writes).toHaveLength(1);
    });

    test("writes again as soon as any metadata changes", async () => {
      await HostService.updateLastSeen(HOST_ID, { osType: "linux" });
      await HostService.updateLastSeen(HOST_ID, { osType: "windows" });

      expect(writes).toHaveLength(2);
    });
  });

  describe("oversized collector metadata", () => {
    beforeEach(() => {
      mockWritesSucceeding();
    });

    test("stores a 55-address host.ip list untouched — the column is text now", async () => {
      await HostService.updateLastSeen(HOST_ID, {
        hostIpAddresses: HUGE_IP_LIST,
      });

      expect(HUGE_IP_LIST.length).toBeGreaterThan(500);
      expect(lastWrite()["hostIpAddresses"]).toBe(HUGE_IP_LIST);
    });

    test("clamps an oversized ShortText attribute instead of failing the write", async () => {
      const longHostId: string = "i".repeat(400);

      await HostService.updateLastSeen(HOST_ID, { hostId: longHostId });

      expect(lastWrite()["hostId"]).toHaveLength(100);
      expect(lastWrite()["hostId"]).toBe("i".repeat(100));
    });

    test("clamps an oversized LongText attribute to 500", async () => {
      const longOsVersion: string = "v".repeat(900);

      await HostService.updateLastSeen(HOST_ID, { osVersion: longOsVersion });

      expect(lastWrite()["osVersion"]).toHaveLength(500);
    });

    test("clamping never costs the liveness columns", async () => {
      await HostService.updateLastSeen(HOST_ID, {
        hostId: "i".repeat(400),
        hostArch: "a".repeat(400),
      });

      expect(lastWrite()["otelCollectorStatus"]).toBe("connected");
      expect(lastWrite()["lastSeenAt"]).toBeInstanceOf(Date);
    });

    const CLAMPED_COLUMNS: Array<[string, number]> = [
      ["osType", 100],
      ["hostId", 100],
      ["hostArch", 100],
      ["hostType", 100],
      ["containerRuntime", 100],
      ["agentVersion", 100],
      ["deploymentEnvironment", 100],
      ["runtimeName", 100],
      ["runtimeVersion", 100],
      ["cloudProvider", 100],
      ["cloudPlatform", 100],
      ["cloudRegion", 100],
      ["cloudAccountId", 100],
      ["osVersion", 500],
    ];

    test.each(CLAMPED_COLUMNS)(
      "%s is clamped to %i characters",
      async (column: string, maxLength: number) => {
        await HostService.updateLastSeen(HOST_ID, {
          [column]: "x".repeat(maxLength + 250),
        } as UpdateLastSeenExtra);

        expect(lastWrite()[column]).toHaveLength(maxLength);
      },
    );

    test("values that already fit are passed through byte-for-byte", async () => {
      await HostService.updateLastSeen(HOST_ID, {
        osType: "linux",
        osVersion: "Debian GNU/Linux 12 (bookworm)",
        hostArch: "amd64",
      });

      expect(lastWrite()["osType"]).toBe("linux");
      expect(lastWrite()["osVersion"]).toBe("Debian GNU/Linux 12 (bookworm)");
      expect(lastWrite()["hostArch"]).toBe("amd64");
    });

    test("numeric and relation columns are left alone by the clamp", async () => {
      const dockerHostId: ObjectID = ObjectID.generate();

      await HostService.updateLastSeen(HOST_ID, {
        cpuCores: 64,
        totalMemoryBytes: 274877906944,
        processCount: 1337,
        dockerHostId: dockerHostId,
      });

      expect(lastWrite()["cpuCores"]).toBe(64);
      expect(lastWrite()["totalMemoryBytes"]).toBe(274877906944);
      expect(lastWrite()["processCount"]).toBe(1337);
      expect(lastWrite()["dockerHostId"]).toBe(dockerHostId);
    });
  });

  describe("fallback when the enriched write fails anyway", () => {
    beforeEach(() => {
      mockEnrichedWriteFailing();
    });

    test("does not throw — ingest keeps going", async () => {
      await expect(
        HostService.updateLastSeen(HOST_ID, {
          hostIpAddresses: HUGE_IP_LIST,
        }),
      ).resolves.toBeUndefined();
    });

    test("retries with liveness only, so lastSeenAt still advances", async () => {
      await HostService.updateLastSeen(HOST_ID, {
        hostIpAddresses: HUGE_IP_LIST,
      });

      expect(writes).toHaveLength(2);
      expect(Object.keys(lastWrite()).sort()).toEqual([
        "lastSeenAt",
        "otelCollectorStatus",
      ]);
      expect(lastWrite()["otelCollectorStatus"]).toBe("connected");
      expect(lastWrite()["lastSeenAt"]).toBeInstanceOf(Date);
    });

    test("busts the throttle cache so the next batch is not skipped", async () => {
      await HostService.updateLastSeen(HOST_ID, {
        hostIpAddresses: HUGE_IP_LIST,
      });

      expect(deletedCacheKeys).toHaveLength(1);
      expect(deletedCacheKeys[0]).toContain(HOST_ID.toString());
    });

    test("the next batch retries rather than short-circuiting on a cache hit", async () => {
      await HostService.updateLastSeen(HOST_ID, {
        hostIpAddresses: HUGE_IP_LIST,
      });
      writes = [];

      await HostService.updateLastSeen(HOST_ID, {
        hostIpAddresses: HUGE_IP_LIST,
      });

      // Enriched attempt + liveness fallback, not a silent no-op.
      expect(writes).toHaveLength(2);
    });

    test("a failing cache delete does not stop the liveness retry", async () => {
      jest
        .spyOn(GlobalCache, "deleteKey")
        .mockRejectedValue(new Error("redis down"));

      await HostService.updateLastSeen(HOST_ID, {
        hostIpAddresses: HUGE_IP_LIST,
      });

      expect(Object.keys(lastWrite()).sort()).toEqual([
        "lastSeenAt",
        "otelCollectorStatus",
      ]);
    });

    test("surfaces a genuinely broken database instead of hiding it", async () => {
      // Both attempts fail — the caller must find out.
      jest
        .spyOn(HostService, "updateColumnsByIdWithoutHooks")
        .mockRejectedValue(new Error("connection terminated"));

      await expect(
        HostService.updateLastSeen(HOST_ID, { osType: "linux" }),
      ).rejects.toThrow("connection terminated");
    });
  });

  describe("cache outages", () => {
    beforeEach(() => {
      mockWritesSucceeding();
    });

    test("a read failure still writes — never mark a live host disconnected", async () => {
      jest
        .spyOn(GlobalCache, "getString")
        .mockRejectedValue(new Error("redis down"));

      await HostService.updateLastSeen(HOST_ID, { osType: "linux" });

      expect(writes).toHaveLength(1);
    });

    test("a write failure still writes", async () => {
      jest
        .spyOn(GlobalCache, "setString")
        .mockRejectedValue(new Error("redis down"));

      await HostService.updateLastSeen(HOST_ID, { osType: "linux" });

      expect(writes).toHaveLength(1);
    });
  });
});

describe("DatabaseService.truncateStringColumnsToMaxLength", () => {
  test("clamps only what exceeds its column width", () => {
    const data: Record<string, unknown> = {
      osType: "l".repeat(101),
      hostArch: "amd64",
    };

    HostService.truncateStringColumnsToMaxLength(data);

    expect(data["osType"]).toHaveLength(100);
    expect(data["hostArch"]).toBe("amd64");
  });

  test("leaves text columns untouched at any length", () => {
    const huge: string = "1.2.3.4, ".repeat(5000);
    const data: Record<string, unknown> = { hostIpAddresses: huge };

    HostService.truncateStringColumnsToMaxLength(data);

    expect(data["hostIpAddresses"]).toBe(huge);
  });

  test("leaves non-string values untouched", () => {
    const date: Date = new Date();
    const id: ObjectID = ObjectID.generate();
    const data: Record<string, unknown> = {
      lastSeenAt: date,
      cpuCores: 8,
      isArchived: false,
      dockerHostId: id,
    };

    HostService.truncateStringColumnsToMaxLength(data);

    expect(data).toEqual({
      lastSeenAt: date,
      cpuCores: 8,
      isArchived: false,
      dockerHostId: id,
    });
  });

  test("ignores keys that are not columns on the model", () => {
    const data: Record<string, unknown> = { notAColumn: "z".repeat(5000) };

    HostService.truncateStringColumnsToMaxLength(data);

    expect(data["notAColumn"]).toHaveLength(5000);
  });

  test("ignores empty strings", () => {
    const data: Record<string, unknown> = { osType: "" };

    HostService.truncateStringColumnsToMaxLength(data);

    expect(data["osType"]).toBe("");
  });

  test("mutates in place and returns the same object", () => {
    const data: Record<string, unknown> = { osType: "l".repeat(200) };

    expect(HostService.truncateStringColumnsToMaxLength(data)).toBe(data);
  });

  test("a value exactly at the limit is not clipped", () => {
    const exact: string = "l".repeat(100);
    const data: Record<string, unknown> = { osType: exact };

    HostService.truncateStringColumnsToMaxLength(data);

    expect(data["osType"]).toBe(exact);
  });

  test("every clamped value stays a prefix of the original", () => {
    const original: string = "abcdefghij".repeat(40);
    const data: Record<string, unknown> = { osType: original };

    HostService.truncateStringColumnsToMaxLength(data);

    expect(original.startsWith(data["osType"] as string)).toBe(true);
  });

  test("Host really does have the columns this suite assumes", () => {
    const host: Host = new Host();
    for (const column of ["osType", "osVersion", "hostIpAddresses"]) {
      expect(host.hasColumn(column)).toBe(true);
    }
  });
});
