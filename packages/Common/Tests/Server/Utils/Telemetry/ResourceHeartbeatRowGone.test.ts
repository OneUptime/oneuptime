import GlobalCache from "../../../../Server/Infrastructure/GlobalCache";
import ResourceHeartbeat, {
  HEARTBEAT_ROW_PRESENT,
  ResourceHeartbeatResult,
} from "../../../../Server/Utils/Telemetry/ResourceHeartbeat";
import SingleFlight from "../../../../Server/Utils/SingleFlight";
import ObjectID from "../../../../Types/ObjectID";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * A HEARTBEAT SAYS WHEN ITS ROW IS GONE (issue #5214).
 *
 * A resource deleted while its id sat in an ingest cache took heartbeats that
 * updated nothing, for a day: updateColumnsByIdIfUnlockedWithoutHooks answers
 * false both for a row another writer holds and for one that is not there,
 * and nobody asked which. Now a write that changed nothing asks Postgres
 * (hasRowWithIdWithoutHooks, no lock) and the heartbeat answers isRowGone,
 * so ingest stops writing against the id and resolves the resource again.
 *
 * Pinned here:
 *   - a heartbeat that lands, or that the gates hold back, never asks - a
 *     live resource pays nothing for this;
 *   - a write that changed nothing asks, and only a row that is not there is
 *     "gone" - a row another writer held is not;
 *   - the same holds for the liveness-only retry after a failed metadata
 *     write, and for a liveness-only heartbeat;
 *   - a check that cannot be read answers "there" (the caller keeps the id,
 *     as it always did) - a test double without the method included;
 *   - a gone row is never memoized: the next batch asks again;
 *   - concurrent callers in one process share the one answer.
 */

const NAMESPACE: string = "row-gone-test-last-seen";
const WINDOW_SECONDS: number = 60;

let resourceId: ObjectID;
let cache: Map<string, string>;
let writes: Array<Record<string, unknown>>;
let writeLands: boolean;
let writeThrowsWithMetadata: boolean;
let rowExists: boolean | "throws";
let existenceChecks: number;

/* eslint-disable @typescript-eslint/no-explicit-any */
const fakeService: any = {
  updateColumnsByIdIfUnlockedWithoutHooks: async (input: {
    id: ObjectID;
    data: Record<string, unknown>;
  }): Promise<boolean> => {
    writes.push({ ...input.data });
    // Postgres refuses the enriched write only: osType is what is too long.
    if (writeThrowsWithMetadata && "osType" in input.data) {
      throw new Error("value too long for type character varying(100)");
    }
    return writeLands;
  },
  hasRowWithIdWithoutHooks: async (id: ObjectID): Promise<boolean> => {
    existenceChecks++;
    expect(id.toString()).toBe(resourceId.toString());
    if (rowExists === "throws") {
      throw new Error("connection terminated");
    }
    return rowExists;
  },
};
/* eslint-enable @typescript-eslint/no-explicit-any */

async function heartbeat(input?: {
  service?: unknown;
  metadata?: Record<string, unknown> | undefined;
  fingerprint?: string | undefined;
}): Promise<ResourceHeartbeatResult> {
  return await ResourceHeartbeat.write({
    service: (input?.service ?? fakeService) as never,
    id: resourceId,
    cacheNamespace: NAMESPACE,
    throttleInSeconds: WINDOW_SECONDS,
    liveness: { lastSeenAt: "now", otelCollectorStatus: "connected" } as never,
    metadata: (input?.metadata ?? undefined) as never,
    fingerprint: input?.fingerprint ?? "fp-default",
    describe: `test resource ${resourceId.toString()}`,
  });
}

describe("ResourceHeartbeat: a row that is gone", () => {
  beforeEach(() => {
    resourceId = ObjectID.generate();
    cache = new Map<string, string>();
    writes = [];
    writeLands = true;
    writeThrowsWithMetadata = false;
    rowExists = true;
    existenceChecks = 0;

    SingleFlight.clear();
    ResourceHeartbeat.clearRecentHeartbeatMemo();

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

  test("a heartbeat that lands is present, and Postgres is never asked", async () => {
    await expect(heartbeat()).resolves.toEqual(HEARTBEAT_ROW_PRESENT);

    expect(writes).toHaveLength(1);
    expect(existenceChecks).toBe(0);
  });

  test("a heartbeat the gates hold back writes nothing, asks nothing, and is present", async () => {
    // Another worker holds this window.
    cache.set(`${NAMESPACE}:${resourceId.toString()}`, "1");

    await expect(heartbeat()).resolves.toEqual({ isRowGone: false });

    expect(writes).toHaveLength(0);
    expect(existenceChecks).toBe(0);
  });

  test("a write that changed nothing on a row that is gone says so", async () => {
    writeLands = false;
    rowExists = false;

    await expect(heartbeat()).resolves.toEqual({ isRowGone: true });

    expect(writes).toHaveLength(1);
    expect(existenceChecks).toBe(1);
  });

  test("a write another writer held the row against is not 'gone'", async () => {
    writeLands = false;
    rowExists = true;

    await expect(heartbeat()).resolves.toEqual({ isRowGone: false });

    expect(existenceChecks).toBe(1);
  });

  test("an enrichment write that changed nothing on a gone row says so, and its gates are released", async () => {
    writeLands = false;
    rowExists = false;

    await expect(
      heartbeat({ metadata: { osType: "linux" }, fingerprint: "fp-a" }),
    ).resolves.toEqual({ isRowGone: true });

    // The enrichment gates were released, so the next batch retries.
    expect(cache.has(`${NAMESPACE}-fingerprint:${resourceId.toString()}`)).toBe(
      false,
    );
    expect(
      cache.has(`${NAMESPACE}-write-window:${resourceId.toString()}`),
    ).toBe(false);
  });

  test("the liveness-only retry after a failed metadata write says when the row is gone", async () => {
    writeThrowsWithMetadata = true;
    writeLands = false;
    rowExists = false;

    await expect(
      heartbeat({ metadata: { osType: "linux" }, fingerprint: "fp-a" }),
    ).resolves.toEqual({ isRowGone: true });

    // The enriched attempt, then the liveness-only one.
    expect(writes).toHaveLength(2);
    expect(Object.keys(writes[1]!).sort()).toEqual([
      "lastSeenAt",
      "otelCollectorStatus",
    ]);
    expect(existenceChecks).toBe(1);
  });

  test("the liveness-only retry that lands is present, without asking", async () => {
    writeThrowsWithMetadata = true;
    writeLands = true;

    await expect(
      heartbeat({ metadata: { osType: "linux" }, fingerprint: "fp-a" }),
    ).resolves.toEqual({ isRowGone: false });

    expect(existenceChecks).toBe(0);
  });

  test("a check that cannot be read answers 'there': the caller keeps the id", async () => {
    writeLands = false;
    rowExists = "throws";

    await expect(heartbeat()).resolves.toEqual({ isRowGone: false });

    expect(existenceChecks).toBe(1);
  });

  test("a service without the check (an older test double) answers 'there'", async () => {
    writeLands = false;

    const withoutCheck: unknown = {
      updateColumnsByIdIfUnlockedWithoutHooks: async (): Promise<boolean> => {
        return false;
      },
    };

    await expect(heartbeat({ service: withoutCheck })).resolves.toEqual({
      isRowGone: false,
    });
  });

  test("a gone row is never memoized: the next batch asks Postgres again", async () => {
    writeLands = false;
    rowExists = false;

    await heartbeat();
    // The window the first attempt claimed reopens, as its TTL would.
    cache.delete(`${NAMESPACE}:${resourceId.toString()}`);

    await expect(heartbeat()).resolves.toEqual({ isRowGone: true });

    expect(writes).toHaveLength(2);
    expect(existenceChecks).toBe(2);
  });

  test("concurrent callers in one process share the one write and the one answer", async () => {
    writeLands = false;
    rowExists = false;

    const results: Array<ResourceHeartbeatResult> = await Promise.all([
      heartbeat(),
      heartbeat(),
      heartbeat(),
    ]);

    expect(results).toEqual([
      { isRowGone: true },
      { isRowGone: true },
      { isRowGone: true },
    ]);
    expect(writes).toHaveLength(1);
    expect(existenceChecks).toBe(1);
  });
});
