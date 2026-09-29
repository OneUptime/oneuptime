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

import HostService from "../../../Server/Services/HostService";
import Host from "../../../Models/DatabaseModels/Host";
import ObjectID from "../../../Types/ObjectID";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * The L1 memo inside HostService.findOrCreateByHostIdentifier.
 *
 * The method used to run an unconditional case-insensitive Postgres SELECT
 * per call, and the metrics ingest path calls it once per unique host per
 * job (runBatchHostEnrichment) on top of autoDiscoverHost's Redis-cache
 * misses. The memo collapses repeats within 60 seconds to zero database
 * round trips.
 *
 * What is pinned here:
 *
 *   1. A REPEAT RESOLUTION DOES NOT REACH POSTGRES, and returns the same
 *      identity as the resolving call — via a FRESH model instance, never a
 *      shared mutable one.
 *   2. The memo key folds case and whitespace exactly as the SQL predicate
 *      (findWithSameText) does, and never leaks across projects.
 *   3. EVERY successful path memoizes — cold find, create, and the
 *      create-race refetch — mirroring the service-resolution cache.
 *   4. FAILURES ARE NEVER MEMOIZED, and the create-race unique-violation
 *      handling is byte-for-byte the old behaviour: lookup miss -> create
 *      throws -> case-insensitive refetch -> winner returned.
 *   5. Entries expire on the 60s TTL, so a deleted-then-recreated host is
 *      re-resolved within a minute.
 *
 * Postgres is mocked at the same seams the service actually calls
 * (findOneBy / create / updateOneById); every test uses a fresh projectId
 * so the module-level memo never leaks state between tests — the same
 * isolation idiom as OpenTelemetryServiceResolutionCache.test.ts.
 */

type FindOneBySpy = jest.SpyInstance;

function buildHost(overrides?: { id?: string; hostIdentifier?: string }): Host {
  const host: Host = new Host();
  host._id = overrides?.id ?? ObjectID.generate().toString();
  host.hostIdentifier = overrides?.hostIdentifier ?? "web-01";
  return host;
}

describe("HostService.findOrCreateByHostIdentifier L1 memo", () => {
  let findOneBy: FindOneBySpy;
  let create: jest.SpyInstance;
  let updateOneById: jest.SpyInstance;
  let nowMs: number;

  beforeEach(() => {
    nowMs = 1_700_000_000_000;
    jest.spyOn(Date, "now").mockImplementation(() => {
      return nowMs;
    });

    findOneBy = jest.spyOn(HostService, "findOneBy") as jest.SpyInstance;
    create = jest.spyOn(HostService, "create") as jest.SpyInstance;
    updateOneById = jest.spyOn(
      HostService,
      "updateOneById",
    ) as jest.SpyInstance;

    create.mockResolvedValue(buildHost());
    updateOneById.mockResolvedValue(undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  /*
   * THE assertion: one SELECT per host per TTL window, not one per call.
   */
  test("resolves a repeated host without touching Postgres again", async () => {
    const projectId: ObjectID = ObjectID.generate();
    findOneBy.mockResolvedValue(buildHost());

    for (let i: number = 0; i < 50; i++) {
      await HostService.findOrCreateByHostIdentifier({
        projectId,
        hostIdentifier: "web-01",
      });
    }

    expect(findOneBy).toHaveBeenCalledTimes(1);
    expect(create).not.toHaveBeenCalled();
  });

  test("returns the same identity from the memo as from Postgres", async () => {
    const projectId: ObjectID = ObjectID.generate();
    const stored: Host = buildHost();
    findOneBy.mockResolvedValue(stored);

    const first: Host = await HostService.findOrCreateByHostIdentifier({
      projectId,
      hostIdentifier: "web-01",
    });
    const second: Host = await HostService.findOrCreateByHostIdentifier({
      projectId,
      hostIdentifier: "web-01",
    });

    expect(second._id).toBe(first._id);
    expect(second._id).toBe(stored._id);
    expect(second.hostIdentifier).toBe(first.hostIdentifier);
    expect(second.projectId?.toString()).toBe(projectId.toString());
  });

  test("a memo hit hands out a FRESH model instance, never a shared one", async () => {
    /*
     * Two ingest jobs must not receive one mutable entity object — a
     * mutation by one caller would silently corrupt the other's view.
     */
    const projectId: ObjectID = ObjectID.generate();
    findOneBy.mockResolvedValue(buildHost());

    await HostService.findOrCreateByHostIdentifier({
      projectId,
      hostIdentifier: "web-01",
    });
    const hitA: Host = await HostService.findOrCreateByHostIdentifier({
      projectId,
      hostIdentifier: "web-01",
    });
    const hitB: Host = await HostService.findOrCreateByHostIdentifier({
      projectId,
      hostIdentifier: "web-01",
    });

    expect(hitA).not.toBe(hitB);
    hitA.hostIdentifier = "mutated-by-caller";
    expect(hitB.hostIdentifier).toBe("web-01");
  });

  test("folds case and surrounding whitespace onto one memo entry, matching the SQL predicate", async () => {
    const projectId: ObjectID = ObjectID.generate();
    findOneBy.mockResolvedValue(buildHost({ hostIdentifier: "primary01" }));

    for (const spelling of [
      "PRIMARY01",
      "primary01",
      "  Primary01  ",
      "\tPRIMARY01\n",
    ]) {
      await HostService.findOrCreateByHostIdentifier({
        projectId,
        hostIdentifier: spelling,
      });
    }

    expect(findOneBy).toHaveBeenCalledTimes(1);
  });

  test("never shares an entry across projects", async () => {
    const projectA: ObjectID = ObjectID.generate();
    const projectB: ObjectID = ObjectID.generate();
    const hostA: Host = buildHost();
    const hostB: Host = buildHost();
    findOneBy.mockResolvedValueOnce(hostA).mockResolvedValueOnce(hostB);

    const first: Host = await HostService.findOrCreateByHostIdentifier({
      projectId: projectA,
      hostIdentifier: "web-01",
    });
    const second: Host = await HostService.findOrCreateByHostIdentifier({
      projectId: projectB,
      hostIdentifier: "web-01",
    });

    expect(findOneBy).toHaveBeenCalledTimes(2);
    expect(first._id).toBe(hostA._id);
    expect(second._id).toBe(hostB._id);
  });

  test("keeps distinct hosts within one project apart", async () => {
    const projectId: ObjectID = ObjectID.generate();
    findOneBy.mockResolvedValue(buildHost());

    await HostService.findOrCreateByHostIdentifier({
      projectId,
      hostIdentifier: "web-01",
    });
    await HostService.findOrCreateByHostIdentifier({
      projectId,
      hostIdentifier: "web-02",
    });

    expect(findOneBy).toHaveBeenCalledTimes(2);
  });

  test("expires on the TTL and re-resolves", async () => {
    const projectId: ObjectID = ObjectID.generate();
    findOneBy.mockResolvedValue(buildHost());

    await HostService.findOrCreateByHostIdentifier({
      projectId,
      hostIdentifier: "web-01",
    });

    nowMs += 61 * 1000;

    await HostService.findOrCreateByHostIdentifier({
      projectId,
      hostIdentifier: "web-01",
    });

    expect(findOneBy).toHaveBeenCalledTimes(2);
  });

  test("memoizes a host it just created", async () => {
    const projectId: ObjectID = ObjectID.generate();
    const created: Host = buildHost({ hostIdentifier: "brand-new" });
    findOneBy.mockResolvedValue(null);
    create.mockResolvedValue(created);

    const first: Host = await HostService.findOrCreateByHostIdentifier({
      projectId,
      hostIdentifier: "brand-new",
    });
    const second: Host = await HostService.findOrCreateByHostIdentifier({
      projectId,
      hostIdentifier: "brand-new",
    });

    expect(create).toHaveBeenCalledTimes(1);
    expect(findOneBy).toHaveBeenCalledTimes(1);
    expect(second._id).toBe(first._id);
  });

  describe("the create race", () => {
    test("still resolves the winner after losing the race — the old handling, untouched", async () => {
      const projectId: ObjectID = ObjectID.generate();
      const winner: Host = buildHost({ hostIdentifier: "raced" });

      findOneBy.mockResolvedValueOnce(null).mockResolvedValueOnce(winner);
      create.mockRejectedValue(
        new Error("duplicate key value violates unique constraint"),
      );

      const resolved: Host = await HostService.findOrCreateByHostIdentifier({
        projectId,
        hostIdentifier: "raced",
      });

      expect(resolved._id).toBe(winner._id);
      // Cold lookup + race refetch: exactly the pre-memo statement count.
      expect(findOneBy).toHaveBeenCalledTimes(2);
      expect(create).toHaveBeenCalledTimes(1);
    });

    test("memoizes the winner, so the stampede that raced stops hitting Postgres", async () => {
      const projectId: ObjectID = ObjectID.generate();
      const winner: Host = buildHost({ hostIdentifier: "raced" });

      findOneBy.mockResolvedValueOnce(null).mockResolvedValueOnce(winner);
      create.mockRejectedValue(
        new Error("duplicate key value violates unique constraint"),
      );

      await HostService.findOrCreateByHostIdentifier({
        projectId,
        hostIdentifier: "raced",
      });
      const second: Host = await HostService.findOrCreateByHostIdentifier({
        projectId,
        hostIdentifier: "raced",
      });

      expect(second._id).toBe(winner._id);
      expect(findOneBy).toHaveBeenCalledTimes(2);
    });

    test("does not memoize a total failure — a later call can still resolve", async () => {
      const projectId: ObjectID = ObjectID.generate();

      findOneBy.mockResolvedValueOnce(null).mockResolvedValueOnce(null);
      create.mockRejectedValueOnce(new Error("boom"));

      await expect(
        HostService.findOrCreateByHostIdentifier({
          projectId,
          hostIdentifier: "transient",
        }),
      ).rejects.toThrow("Failed to create or find host");

      const recoveredHost: Host = buildHost({ hostIdentifier: "transient" });
      findOneBy.mockResolvedValue(recoveredHost);

      const recovered: Host = await HostService.findOrCreateByHostIdentifier({
        projectId,
        hostIdentifier: "transient",
      });

      expect(recovered._id).toBe(recoveredHost._id);
      // 2 from the failed attempt, 1 from the retry — nothing short-circuited.
      expect(findOneBy).toHaveBeenCalledTimes(3);
    });
  });

  describe("legacy-identifier convergence", () => {
    test("still converges a mixed-case identifier on the resolving call", async () => {
      const projectId: ObjectID = ObjectID.generate();
      findOneBy.mockResolvedValue(buildHost({ hostIdentifier: "PRIMARY01" }));

      const resolved: Host = await HostService.findOrCreateByHostIdentifier({
        projectId,
        hostIdentifier: "primary01",
      });

      expect(updateOneById).toHaveBeenCalledTimes(1);
      expect(resolved.hostIdentifier).toBe("primary01");
    });

    test("a memo hit returns the converged identifier without re-issuing the UPDATE", async () => {
      const projectId: ObjectID = ObjectID.generate();
      findOneBy.mockResolvedValue(buildHost({ hostIdentifier: "PRIMARY01" }));

      await HostService.findOrCreateByHostIdentifier({
        projectId,
        hostIdentifier: "primary01",
      });
      const hit: Host = await HostService.findOrCreateByHostIdentifier({
        projectId,
        hostIdentifier: "primary01",
      });

      expect(hit.hostIdentifier).toBe("primary01");
      expect(updateOneById).toHaveBeenCalledTimes(1);
    });

    test("a failed convergence UPDATE still resolves and memoizes the row as it is", async () => {
      const projectId: ObjectID = ObjectID.generate();
      findOneBy.mockResolvedValue(buildHost({ hostIdentifier: "PRIMARY01" }));
      updateOneById.mockRejectedValue(new Error("row locked"));

      const resolved: Host = await HostService.findOrCreateByHostIdentifier({
        projectId,
        hostIdentifier: "primary01",
      });
      const hit: Host = await HostService.findOrCreateByHostIdentifier({
        projectId,
        hostIdentifier: "primary01",
      });

      // The row keeps its legacy casing; both calls agree on it.
      expect(resolved.hostIdentifier).toBe("PRIMARY01");
      expect(hit.hostIdentifier).toBe("PRIMARY01");
      expect(findOneBy).toHaveBeenCalledTimes(1);
    });
  });

  test("leaves the cold-path query shape untouched", async () => {
    const projectId: ObjectID = ObjectID.generate();
    findOneBy.mockResolvedValue(buildHost());

    await HostService.findOrCreateByHostIdentifier({
      projectId,
      hostIdentifier: "Query-Shape",
    });

    const args: {
      select: Record<string, unknown>;
      props: Record<string, unknown>;
    } = (findOneBy.mock.calls[0] as Array<unknown>)[0] as {
      select: Record<string, unknown>;
      props: Record<string, unknown>;
    };

    expect(args.select).toEqual({
      _id: true,
      projectId: true,
      hostIdentifier: true,
    });
    expect(args.props).toEqual({ isRoot: true });
  });
});
