import ObjectID from "../../../../Types/ObjectID";

/*
 * The policy cache is keyed by projectId plus a CLIENT-supplied appIdentifier,
 * so anyone holding an ingestion key (which ships in public browser JS) can
 * mint unlimited distinct keys. These tests pin that the store is bounded -
 * the regression they guard is the unbounded module-level Map that grew until
 * the ingest pod was OOM-killed - while preserving the store's contracts:
 * negative (null-policy) caching, per-project prefix invalidation, and the
 * kill marker that must always land even at capacity.
 */

jest.mock("../../../../Server/Infrastructure/Redis", () => {
  return {
    __esModule: true,
    default: {
      getClient: jest.fn().mockReturnValue(null),
      isConnected: jest.fn().mockReturnValue(false),
    },
  };
});

jest.mock("../../../../Server/Utils/Logger", () => {
  return {
    __esModule: true,
    default: {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    },
  };
});

import SessionReplayGateCacheStore, {
  MAX_KILL_KEY_CACHE_ENTRIES,
  MAX_POLICY_CACHE_ENTRIES,
  PolicyCacheEntry,
} from "../../../../Server/Utils/SessionReplay/SessionReplayGateCacheStore";

type TestPolicy = { name: string };

function policyKey(prefix: string, index: number): string {
  return `${prefix}:app-${index}`;
}

function fillPolicyCache(prefix: string, count: number): void {
  for (let i: number = 0; i < count; i++) {
    SessionReplayGateCacheStore.setPolicyEntry<TestPolicy>(
      policyKey(prefix, i),
      { name: `policy-${i}` },
    );
  }
}

describe("SessionReplayGateCacheStore bounded policy cache", (): void => {
  beforeEach((): void => {
    jest.clearAllMocks();
    /* Module-level Maps persist across tests. */
    SessionReplayGateCacheStore.clearCache();
  });

  it("evicts the oldest entry instead of growing past the cap under a unique-key flood", (): void => {
    fillPolicyCache("proj", MAX_POLICY_CACHE_ENTRIES + 1);

    expect(
      SessionReplayGateCacheStore.getPolicyEntry<TestPolicy>(
        policyKey("proj", 0),
      ),
    ).toBeUndefined();

    const last: PolicyCacheEntry<TestPolicy> | undefined =
      SessionReplayGateCacheStore.getPolicyEntry<TestPolicy>(
        policyKey("proj", MAX_POLICY_CACHE_ENTRIES),
      );
    expect(last).toBeDefined();
    expect(last?.policy).toEqual({
      name: `policy-${MAX_POLICY_CACHE_ENTRIES}`,
    });
  }, 15000);

  it("rewriting an existing key at capacity evicts nothing", (): void => {
    fillPolicyCache("proj", MAX_POLICY_CACHE_ENTRIES);

    SessionReplayGateCacheStore.setPolicyEntry<TestPolicy>(
      policyKey("proj", 5),
      { name: "rewritten" },
    );

    for (let i: number = 0; i < MAX_POLICY_CACHE_ENTRIES; i++) {
      expect(
        SessionReplayGateCacheStore.getPolicyEntry<TestPolicy>(
          policyKey("proj", i),
        ),
      ).toBeDefined();
    }

    expect(
      SessionReplayGateCacheStore.getPolicyEntry<TestPolicy>(
        policyKey("proj", 5),
      )?.policy,
    ).toEqual({ name: "rewritten" });
  }, 15000);

  it("a rewrite refreshes recency, so the next eviction takes the stale key", (): void => {
    fillPolicyCache("proj", MAX_POLICY_CACHE_ENTRIES);

    SessionReplayGateCacheStore.setPolicyEntry<TestPolicy>(
      policyKey("proj", 0),
      { name: "refreshed" },
    );

    SessionReplayGateCacheStore.setPolicyEntry<TestPolicy>("proj:app-new", {
      name: "new",
    });

    expect(
      SessionReplayGateCacheStore.getPolicyEntry<TestPolicy>(
        policyKey("proj", 1),
      ),
    ).toBeUndefined();
    expect(
      SessionReplayGateCacheStore.getPolicyEntry<TestPolicy>(
        policyKey("proj", 0),
      )?.policy,
    ).toEqual({ name: "refreshed" });
    expect(
      SessionReplayGateCacheStore.getPolicyEntry<TestPolicy>("proj:app-new"),
    ).toBeDefined();
  }, 15000);

  it("still caches null policies - the hot-path refusal must stay cached", (): void => {
    SessionReplayGateCacheStore.setPolicyEntry<TestPolicy>(
      "proj:app-none",
      null,
    );

    const entry: PolicyCacheEntry<TestPolicy> | undefined =
      SessionReplayGateCacheStore.getPolicyEntry<TestPolicy>("proj:app-none");

    expect(entry).toBeDefined();
    expect(entry?.policy).toBeNull();
    expect(typeof entry?.loadedAt).toBe("number");
  });

  it("clearCache(projectId) deletes exactly that project's prefixed entries after evictions", (): void => {
    const projectA: ObjectID = ObjectID.generate();
    const projectB: ObjectID = ObjectID.generate();

    fillPolicyCache(projectA.toString(), MAX_POLICY_CACHE_ENTRIES);
    /* These writes evict projectA's oldest entries. */
    fillPolicyCache(projectB.toString(), 5);

    SessionReplayGateCacheStore.clearCache(projectA);

    for (let i: number = 0; i < MAX_POLICY_CACHE_ENTRIES; i++) {
      expect(
        SessionReplayGateCacheStore.getPolicyEntry<TestPolicy>(
          policyKey(projectA.toString(), i),
        ),
      ).toBeUndefined();
    }

    for (let i: number = 0; i < 5; i++) {
      expect(
        SessionReplayGateCacheStore.getPolicyEntry<TestPolicy>(
          policyKey(projectB.toString(), i),
        ),
      ).toBeDefined();
    }
  }, 15000);
});

describe("SessionReplayGateCacheStore bounded kill-key cache", (): void => {
  beforeEach((): void => {
    jest.clearAllMocks();
    SessionReplayGateCacheStore.clearCache();
  });

  it("the local kill marker always lands, even at capacity", async (): Promise<void> => {
    /* Redis is absent, so the fail-open path caches isDisabled:false. */
    for (let i: number = 0; i < MAX_KILL_KEY_CACHE_ENTRIES; i++) {
      await SessionReplayGateCacheStore.isProjectKilled(ObjectID.generate());
    }

    const killedProject: ObjectID = ObjectID.generate();
    await SessionReplayGateCacheStore.markProjectDisabled(killedProject);

    expect(
      await SessionReplayGateCacheStore.isProjectKilled(killedProject),
    ).toBe(true);
  }, 30000);

  it("an evicted kill entry re-resolves through the normal path", async (): Promise<void> => {
    const firstProject: ObjectID = ObjectID.generate();
    await SessionReplayGateCacheStore.isProjectKilled(firstProject);

    /* Push the first project's entry out of the bounded map. */
    for (let i: number = 0; i < MAX_KILL_KEY_CACHE_ENTRIES; i++) {
      await SessionReplayGateCacheStore.isProjectKilled(ObjectID.generate());
    }

    await expect(
      SessionReplayGateCacheStore.isProjectKilled(firstProject),
    ).resolves.toBe(false);
  }, 30000);
});
