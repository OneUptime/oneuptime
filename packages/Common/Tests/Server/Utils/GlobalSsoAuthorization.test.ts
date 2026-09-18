import {
  GLOBAL_SSO_AUTHORIZATION_CACHE_TTL_MS,
  GlobalProviderAttachments,
  GlobalProviderTrust,
  clearGlobalSsoAuthorizationCaches,
  doAttachmentsGovernProject,
  globalProviderCacheKey,
  globalSsoAttachmentsCache,
  globalSsoProviderTrustCache,
  loadAttachmentsOnce,
  loadTrustOnce,
} from "../../../Server/Utils/GlobalSsoAuthorization";
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
 * The stateful half of Global SSO enforcement, at the level of the pure
 * helpers the two provider services are built out of.
 *
 * A Global SSO/OIDC token is a 30-day JWT with NO project binding. The
 * stateless checks it can answer on its own (signature / expiry / Global type /
 * user / pinned provider) belong to
 * Common/Tests/Server/Utils/GlobalSSOToken.test.ts and
 * Common/Tests/Server/Middleware/UserAuthorizationSSOProvider.test.ts, and the
 * service-level wiring (getProviderTrust / doesProviderGovernProject actually
 * querying Postgres, and the write hooks invalidating) belongs to
 * Common/Tests/Server/Services/GlobalSsoProviderAuthorization.test.ts. None of
 * that is repeated here.
 *
 * What this file pins down is everything those layers stand on:
 *
 *   - doAttachmentsGovernProject, the policy decision itself. The dangerous
 *     case is not "attached project is allowed"; it is "rows exist but every
 *     one of them is disabled", which must DENY. Reading that as "no
 *     attachments, therefore instance-wide" would mean an admin disabling the
 *     last attachment WIDENS the provider to every project on the instance.
 *   - globalProviderCacheKey, where the dangerous case is a Global SSO row
 *     vouching for a Global OIDC row that happens to share its id.
 *   - the two caches, where the dangerous case is a cached negative
 *     (isUsable:false, or an empty attachment set) being mistaken for a cache
 *     miss - the reason the services read with an explicit `undefined` check.
 *   - loadTrustOnce / loadAttachmentsOnce, the in-flight de-duplication that
 *     collapses the multi-tenant permission fan-out (N projects, concurrently)
 *     from N copies of the same query down to one.
 */

/*
 * Minimal structural view of a jest spy - the @jest/globals and @types/jest spy
 * types disagree in this repo, so annotate with just the surface used here.
 * (Same workaround as Common/Tests/Server/Infrastructure/InMemoryTTLCache.test.ts.)
 */
type NowSpyLike = {
  mockReturnValue: (value: number) => unknown;
  mockRestore: () => void;
};

function spyNow(value: number): NowSpyLike {
  const spy: NowSpyLike = jest.spyOn(Date, "now") as unknown as NowSpyLike;
  spy.mockReturnValue(value);
  return spy;
}

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: Error) => void;
}

function createDeferred<T>(): Deferred<T> {
  let resolveFn!: (value: T) => void;
  let rejectFn!: (error: Error) => void;

  const promise: Promise<T> = new Promise<T>(
    (resolve: (value: T) => void, reject: (error: Error) => void): void => {
      resolveFn = resolve;
      rejectFn = reject;
    },
  );

  return { promise: promise, resolve: resolveFn, reject: rejectFn };
}

function attachments(data: {
  hasAnyAttachmentRows: boolean;
  enabledProjectIds: Array<string>;
}): GlobalProviderAttachments {
  return {
    hasAnyAttachmentRows: data.hasAnyAttachmentRows,
    enabledProjectIds: data.enabledProjectIds,
  };
}

const USABLE_UNRESTRICTED: GlobalProviderTrust = {
  isUsable: true,
  restrictToAttachedProjects: false,
};

const DISABLED_PROVIDER: GlobalProviderTrust = {
  isUsable: false,
  restrictToAttachedProjects: false,
};

/*
 * The caches and the in-flight maps are module-level singletons shared by every
 * service, so each test starts and ends from a clean slate.
 */
beforeEach(() => {
  clearGlobalSsoAuthorizationCaches();
});

afterEach(() => {
  jest.restoreAllMocks();
  clearGlobalSsoAuthorizationCaches();
});

describe("doAttachmentsGovernProject - no attachment rows at all is instance-wide", () => {
  test("a provider with no attachment rows governs ANY project", () => {
    const noRows: GlobalProviderAttachments = attachments({
      hasAnyAttachmentRows: false,
      enabledProjectIds: [],
    });

    const projects: Array<ObjectID> = [
      ObjectID.generate(),
      ObjectID.generate(),
      ObjectID.generate(),
    ];

    for (const projectId of projects) {
      expect(doAttachmentsGovernProject(noRows, projectId)).toBe(true);
    }
  });

  test("`hasAnyAttachmentRows` is the gate, not the length of the enabled list", () => {
    const projectId: ObjectID = ObjectID.generate();

    /*
     * The flag - not the emptiness of `enabledProjectIds` - decides whether the
     * provider is in instance-wide mode. Both directions are asserted so that
     * neither a blanket true nor a blanket false would satisfy this test.
     */
    expect(
      doAttachmentsGovernProject(
        attachments({ hasAnyAttachmentRows: false, enabledProjectIds: [] }),
        projectId,
      ),
    ).toBe(true);

    expect(
      doAttachmentsGovernProject(
        attachments({ hasAnyAttachmentRows: true, enabledProjectIds: [] }),
        projectId,
      ),
    ).toBe(false);
  });
});

describe("doAttachmentsGovernProject - explicit attachment mode", () => {
  test("a project inside the enabled set is governed", () => {
    const projectId: ObjectID = ObjectID.generate();

    expect(
      doAttachmentsGovernProject(
        attachments({
          hasAnyAttachmentRows: true,
          enabledProjectIds: [projectId.toString()],
        }),
        projectId,
      ),
    ).toBe(true);
  });

  test("a project OUTSIDE the enabled set is NOT governed", () => {
    const attachedProject: ObjectID = ObjectID.generate();
    const otherProject: ObjectID = ObjectID.generate();

    const oneAttachment: GlobalProviderAttachments = attachments({
      hasAnyAttachmentRows: true,
      enabledProjectIds: [attachedProject.toString()],
    });

    // Denied for the project that is not attached...
    expect(doAttachmentsGovernProject(oneAttachment, otherProject)).toBe(false);

    // ...and granted for the one that is, from the very same attachment set.
    expect(doAttachmentsGovernProject(oneAttachment, attachedProject)).toBe(
      true,
    );

    // Attaching the other project as well is all it takes to flip the deny.
    expect(
      doAttachmentsGovernProject(
        attachments({
          hasAnyAttachmentRows: true,
          enabledProjectIds: [
            attachedProject.toString(),
            otherProject.toString(),
          ],
        }),
        otherProject,
      ),
    ).toBe(true);
  });

  test("THE ONE THAT MATTERS: rows exist but every one is disabled DENIES, it does not widen", () => {
    /*
     * An admin who disables the last remaining attachment is NARROWING the
     * provider. If "rows exist, none enabled" collapsed into the same answer as
     * "no rows at all", that click would instead WIDEN the provider from one
     * project to every project on the instance - the exact opposite of the
     * intent, and silently. Disabling an attachment must never grant access.
     */
    const projectId: ObjectID = ObjectID.generate();

    const allAttachmentsDisabled: GlobalProviderAttachments = attachments({
      hasAnyAttachmentRows: true,
      enabledProjectIds: [],
    });

    expect(doAttachmentsGovernProject(allAttachmentsDisabled, projectId)).toBe(
      false,
    );

    // The same provider, same project, with that one attachment re-enabled.
    expect(
      doAttachmentsGovernProject(
        attachments({
          hasAnyAttachmentRows: true,
          enabledProjectIds: [projectId.toString()],
        }),
        projectId,
      ),
    ).toBe(true);

    /*
     * And deleting the rows outright (rather than disabling them) is the
     * genuinely instance-wide state, which does grant. The two states are
     * reached by different admin actions and must not be conflated.
     */
    expect(
      doAttachmentsGovernProject(
        attachments({ hasAnyAttachmentRows: false, enabledProjectIds: [] }),
        projectId,
      ),
    ).toBe(true);
  });

  test("a large attachment set is matched at the start, middle and end", () => {
    const target: ObjectID = ObjectID.generate();

    const filler: Array<string> = [];
    for (let index: number = 0; index < 50; index++) {
      filler.push(ObjectID.generate().toString());
    }

    const atStart: GlobalProviderAttachments = attachments({
      hasAnyAttachmentRows: true,
      enabledProjectIds: [target.toString(), ...filler],
    });
    const atMiddle: GlobalProviderAttachments = attachments({
      hasAnyAttachmentRows: true,
      enabledProjectIds: [
        ...filler.slice(0, 25),
        target.toString(),
        ...filler.slice(25),
      ],
    });
    const atEnd: GlobalProviderAttachments = attachments({
      hasAnyAttachmentRows: true,
      enabledProjectIds: [...filler, target.toString()],
    });

    expect(doAttachmentsGovernProject(atStart, target)).toBe(true);
    expect(doAttachmentsGovernProject(atMiddle, target)).toBe(true);
    expect(doAttachmentsGovernProject(atEnd, target)).toBe(true);

    // A set of the same size that simply does not contain the target denies.
    expect(
      doAttachmentsGovernProject(
        attachments({ hasAnyAttachmentRows: true, enabledProjectIds: filler }),
        target,
      ),
    ).toBe(false);
  });

  test("ids are compared exactly - prefixes, suffixes and case variants do not match", () => {
    const projectId: ObjectID = ObjectID.generate();
    const id: string = projectId.toString();

    const nearMisses: Array<string> = [
      id.slice(0, -1), // one character short
      `${id}0`, // one character too long
      id.toUpperCase(), // same uuid, different case
      ` ${id}`, // leading whitespace
      `${id} `, // trailing whitespace
      id.replace(/-/g, ""), // dashes stripped
    ];

    for (const nearMiss of nearMisses) {
      expect(
        doAttachmentsGovernProject(
          attachments({
            hasAnyAttachmentRows: true,
            enabledProjectIds: [nearMiss],
          }),
          projectId,
        ),
      ).toBe(false);
    }

    // All of the near misses together still deny...
    expect(
      doAttachmentsGovernProject(
        attachments({
          hasAnyAttachmentRows: true,
          enabledProjectIds: nearMisses,
        }),
        projectId,
      ),
    ).toBe(false);

    // ...and adding the exact id to that same list grants.
    expect(
      doAttachmentsGovernProject(
        attachments({
          hasAnyAttachmentRows: true,
          enabledProjectIds: [...nearMisses, id],
        }),
        projectId,
      ),
    ).toBe(true);
  });

  test("substring relationships between short ids never match", () => {
    const projectId: ObjectID = new ObjectID("abc");

    expect(
      doAttachmentsGovernProject(
        attachments({
          hasAnyAttachmentRows: true,
          enabledProjectIds: ["abcd"],
        }),
        projectId,
      ),
    ).toBe(false);
    expect(
      doAttachmentsGovernProject(
        attachments({
          hasAnyAttachmentRows: true,
          enabledProjectIds: ["zabc"],
        }),
        projectId,
      ),
    ).toBe(false);
    expect(
      doAttachmentsGovernProject(
        attachments({ hasAnyAttachmentRows: true, enabledProjectIds: ["abc"] }),
        projectId,
      ),
    ).toBe(true);
  });

  test("the decision does not mutate the attachment set it was handed", () => {
    /*
     * The cached GlobalProviderAttachments object is shared by every concurrent
     * request for that provider, so a decision that sorted or spliced the array
     * in place would corrupt the answer for everyone else.
     */
    const target: ObjectID = ObjectID.generate();
    const enabledProjectIds: Array<string> = [
      ObjectID.generate().toString(),
      target.toString(),
      ObjectID.generate().toString(),
    ];
    const snapshot: Array<string> = [...enabledProjectIds];

    const shared: GlobalProviderAttachments = attachments({
      hasAnyAttachmentRows: true,
      enabledProjectIds: enabledProjectIds,
    });

    expect(doAttachmentsGovernProject(shared, target)).toBe(true);
    expect(doAttachmentsGovernProject(shared, ObjectID.generate())).toBe(false);
    expect(doAttachmentsGovernProject(shared, target)).toBe(true);

    expect(shared.enabledProjectIds).toEqual(snapshot);
    expect(shared.hasAnyAttachmentRows).toBe(true);
  });
});

describe("doAttachmentsGovernProject - agreement with the login router's isDefaultAllMode", () => {
  /*
   * App/FeatureSet/Identity/API/GlobalSSO.ts loads the attachments with
   * `findBy({ globalSsoId, isEnabled: true })` and then computes
   * `const isDefaultAllMode: boolean = attachments.length === 0;`.
   *
   * These helpers reproduce both readings from the same raw rows so the two can
   * be compared directly.
   */
  interface AttachmentRow {
    projectId: string;
    isEnabled: boolean;
  }

  function routerIsDefaultAllMode(rows: Array<AttachmentRow>): boolean {
    return (
      rows.filter((row: AttachmentRow) => {
        return row.isEnabled;
      }).length === 0
    );
  }

  function toAttachments(
    rows: Array<AttachmentRow>,
  ): GlobalProviderAttachments {
    // Mirrors GlobalSsoProjectService.doesProviderGovernProject's loader.
    return {
      hasAnyAttachmentRows: rows.length > 0,
      enabledProjectIds: rows
        .filter((row: AttachmentRow) => {
          return row.isEnabled;
        })
        .map((row: AttachmentRow) => {
          return row.projectId;
        }),
    };
  }

  test("no rows at all: both layers read it as instance-wide", () => {
    const rows: Array<AttachmentRow> = [];

    expect(routerIsDefaultAllMode(rows)).toBe(true);
    expect(
      doAttachmentsGovernProject(toAttachments(rows), ObjectID.generate()),
    ).toBe(true);
  });

  test("an enabled row: both layers leave instance-wide mode", () => {
    const attachedProject: ObjectID = ObjectID.generate();
    const rows: Array<AttachmentRow> = [
      { projectId: attachedProject.toString(), isEnabled: true },
    ];

    expect(routerIsDefaultAllMode(rows)).toBe(false);
    expect(
      doAttachmentsGovernProject(toAttachments(rows), attachedProject),
    ).toBe(true);
    expect(
      doAttachmentsGovernProject(toAttachments(rows), ObjectID.generate()),
    ).toBe(false);
  });

  test("rows that exist but are all disabled: the router widens, enforcement narrows - deliberately", () => {
    /*
     * The one place the two readings diverge, and it is intentional.
     *
     * The router's `isDefaultAllMode` only ever REMOVES capability: in
     * default-all mode it disables SSO sign-up and skips auto-provisioning,
     * because there is no attachment telling it which project or team to place
     * a new user in. It never grants project access. This module's answer IS an
     * access decision, so the same state has to deny - otherwise disabling the
     * last attachment would hand the provider every project on the instance.
     */
    const attachedProject: ObjectID = ObjectID.generate();
    const rows: Array<AttachmentRow> = [
      { projectId: attachedProject.toString(), isEnabled: false },
    ];

    expect(routerIsDefaultAllMode(rows)).toBe(true);
    expect(
      doAttachmentsGovernProject(toAttachments(rows), attachedProject),
    ).toBe(false);

    // Re-enabling that same row is what grants access back.
    expect(
      doAttachmentsGovernProject(
        toAttachments([
          { projectId: attachedProject.toString(), isEnabled: true },
        ]),
        attachedProject,
      ),
    ).toBe(true);
  });
});

describe("globalProviderCacheKey", () => {
  test("the same provider id under 'sso' and 'oidc' produces DIFFERENT keys", () => {
    const providerId: ObjectID = ObjectID.generate();

    const ssoKey: string = globalProviderCacheKey("sso", providerId);
    const oidcKey: string = globalProviderCacheKey("oidc", providerId);

    expect(ssoKey).not.toBe(oidcKey);
    expect(ssoKey.startsWith("sso:")).toBe(true);
    expect(oidcKey.startsWith("oidc:")).toBe(true);
    expect(ssoKey).toContain(providerId.toString());
    expect(oidcKey).toContain(providerId.toString());
  });

  test("the key is stable for the same kind and id", () => {
    const id: string = ObjectID.generate().toString();

    // Two distinct ObjectID instances carrying the same id must agree.
    expect(globalProviderCacheKey("sso", new ObjectID(id))).toBe(
      globalProviderCacheKey("sso", new ObjectID(id)),
    );
    expect(globalProviderCacheKey("oidc", new ObjectID(id))).toBe(
      globalProviderCacheKey("oidc", new ObjectID(id)),
    );
  });

  test("different provider ids of the same kind produce different keys", () => {
    const first: ObjectID = ObjectID.generate();
    const second: ObjectID = ObjectID.generate();

    expect(globalProviderCacheKey("sso", first)).not.toBe(
      globalProviderCacheKey("sso", second),
    );
    expect(globalProviderCacheKey("oidc", first)).not.toBe(
      globalProviderCacheKey("oidc", second),
    );
  });

  test("no crafted id can make an OIDC key collide with an SSO key", () => {
    /*
     * The namespace prefix is what stops a Global OIDC row from vouching for a
     * Global SSO row. Ids that look like a namespace of their own must not be
     * able to forge the other side's key.
     */
    const crafted: Array<string> = [
      "oidc:11111111-1111-1111-1111-111111111111",
      "sso:11111111-1111-1111-1111-111111111111",
      ":",
      "",
    ];

    const ssoKeys: Array<string> = crafted.map((id: string) => {
      return globalProviderCacheKey("sso", new ObjectID(id));
    });
    const oidcKeys: Array<string> = crafted.map((id: string) => {
      return globalProviderCacheKey("oidc", new ObjectID(id));
    });

    for (const ssoKey of ssoKeys) {
      expect(oidcKeys).not.toContain(ssoKey);
    }
  });

  test("a trust answer stored under one namespace is invisible to the other", () => {
    const providerId: ObjectID = ObjectID.generate();
    const ssoKey: string = globalProviderCacheKey("sso", providerId);
    const oidcKey: string = globalProviderCacheKey("oidc", providerId);

    globalSsoProviderTrustCache.set(
      ssoKey,
      USABLE_UNRESTRICTED,
      GLOBAL_SSO_AUTHORIZATION_CACHE_TTL_MS,
    );

    // The enabled SAML provider does not make an OIDC provider of the same id usable.
    expect(globalSsoProviderTrustCache.get(oidcKey)).toBeUndefined();
    expect(globalSsoProviderTrustCache.get(ssoKey)).toEqual(
      USABLE_UNRESTRICTED,
    );

    // And the OIDC side can hold the opposite answer at the same time.
    globalSsoProviderTrustCache.set(
      oidcKey,
      DISABLED_PROVIDER,
      GLOBAL_SSO_AUTHORIZATION_CACHE_TTL_MS,
    );

    expect(globalSsoProviderTrustCache.get(ssoKey)?.isUsable).toBe(true);
    expect(globalSsoProviderTrustCache.get(oidcKey)?.isUsable).toBe(false);
  });

  test("an attachment set stored under one namespace is invisible to the other", () => {
    const providerId: ObjectID = ObjectID.generate();
    const projectId: ObjectID = ObjectID.generate();
    const ssoKey: string = globalProviderCacheKey("sso", providerId);
    const oidcKey: string = globalProviderCacheKey("oidc", providerId);

    globalSsoAttachmentsCache.set(
      ssoKey,
      attachments({
        hasAnyAttachmentRows: true,
        enabledProjectIds: [projectId.toString()],
      }),
      GLOBAL_SSO_AUTHORIZATION_CACHE_TTL_MS,
    );

    expect(globalSsoAttachmentsCache.get(oidcKey)).toBeUndefined();

    const cached: GlobalProviderAttachments | undefined =
      globalSsoAttachmentsCache.get(ssoKey);
    expect(cached).toBeDefined();
    expect(doAttachmentsGovernProject(cached!, projectId)).toBe(true);
  });
});

describe("the caches - round trip", () => {
  test("the trust cache round-trips a value", () => {
    const key: string = globalProviderCacheKey("sso", ObjectID.generate());
    const trust: GlobalProviderTrust = {
      isUsable: true,
      restrictToAttachedProjects: true,
    };

    expect(globalSsoProviderTrustCache.get(key)).toBeUndefined();

    globalSsoProviderTrustCache.set(
      key,
      trust,
      GLOBAL_SSO_AUTHORIZATION_CACHE_TTL_MS,
    );

    expect(globalSsoProviderTrustCache.get(key)).toEqual(trust);
    expect(
      globalSsoProviderTrustCache.get(key)?.restrictToAttachedProjects,
    ).toBe(true);
  });

  test("the attachments cache round-trips a value", () => {
    const key: string = globalProviderCacheKey("oidc", ObjectID.generate());
    const attached: ObjectID = ObjectID.generate();
    const value: GlobalProviderAttachments = attachments({
      hasAnyAttachmentRows: true,
      enabledProjectIds: [attached.toString()],
    });

    expect(globalSsoAttachmentsCache.get(key)).toBeUndefined();

    globalSsoAttachmentsCache.set(
      key,
      value,
      GLOBAL_SSO_AUTHORIZATION_CACHE_TTL_MS,
    );

    const cached: GlobalProviderAttachments | undefined =
      globalSsoAttachmentsCache.get(key);

    expect(cached).toEqual(value);
    expect(doAttachmentsGovernProject(cached!, attached)).toBe(true);
    expect(doAttachmentsGovernProject(cached!, ObjectID.generate())).toBe(
      false,
    );
  });

  test("the two caches are separate stores - the same key in each holds its own value", () => {
    const key: string = globalProviderCacheKey("sso", ObjectID.generate());

    globalSsoProviderTrustCache.set(
      key,
      USABLE_UNRESTRICTED,
      GLOBAL_SSO_AUTHORIZATION_CACHE_TTL_MS,
    );

    expect(globalSsoAttachmentsCache.get(key)).toBeUndefined();

    globalSsoAttachmentsCache.set(
      key,
      attachments({ hasAnyAttachmentRows: false, enabledProjectIds: [] }),
      GLOBAL_SSO_AUTHORIZATION_CACHE_TTL_MS,
    );

    expect(globalSsoProviderTrustCache.get(key)).toEqual(USABLE_UNRESTRICTED);
    expect(globalSsoAttachmentsCache.get(key)?.hasAnyAttachmentRows).toBe(
      false,
    );
  });
});

describe("the caches - a cached negative is a HIT, not a miss", () => {
  test("a cached isUsable:false is served from cache rather than re-queried", () => {
    /*
     * The services read with `if (cached !== undefined) { return cached; }`.
     * A truthiness read of the interesting FIELD - `if (cached?.isUsable)` -
     * would treat a cached "this provider is disabled" as a cache miss and send
     * a query to Postgres on every single request from every still-signed-in
     * holder of that provider's 30-day tokens. Exactly the population that is
     * largest right after an admin disables a provider.
     */
    const disabledKey: string = globalProviderCacheKey(
      "sso",
      ObjectID.generate(),
    );
    const neverLookedUpKey: string = globalProviderCacheKey(
      "sso",
      ObjectID.generate(),
    );

    globalSsoProviderTrustCache.set(
      disabledKey,
      DISABLED_PROVIDER,
      GLOBAL_SSO_AUTHORIZATION_CACHE_TTL_MS,
    );

    const cachedNegative: GlobalProviderTrust | undefined =
      globalSsoProviderTrustCache.get(disabledKey);

    // The cached negative is present and says "no".
    expect(cachedNegative).toBeDefined();
    expect(cachedNegative).not.toBeUndefined();
    expect(cachedNegative?.isUsable).toBe(false);
    expect(globalSsoProviderTrustCache.has(disabledKey)).toBe(true);

    // A key that was genuinely never looked up is the other answer entirely.
    expect(globalSsoProviderTrustCache.get(neverLookedUpKey)).toBeUndefined();
    expect(globalSsoProviderTrustCache.has(neverLookedUpKey)).toBe(false);

    /*
     * The distinction the explicit undefined check preserves, spelled out: the
     * correct read sees a hit for the disabled provider, the truthiness-on-the-
     * field read does not.
     */
    const correctReadIsAHit: boolean = cachedNegative !== undefined;
    const truthinessOnFieldIsAHit: boolean = Boolean(cachedNegative?.isUsable);

    expect(correctReadIsAHit).toBe(true);
    expect(truthinessOnFieldIsAHit).toBe(false);
  });

  test("a cached EMPTY attachment set is a hit too - default-all does not re-query", () => {
    const key: string = globalProviderCacheKey("oidc", ObjectID.generate());

    const instanceWide: GlobalProviderAttachments = attachments({
      hasAnyAttachmentRows: false,
      enabledProjectIds: [],
    });

    globalSsoAttachmentsCache.set(
      key,
      instanceWide,
      GLOBAL_SSO_AUTHORIZATION_CACHE_TTL_MS,
    );

    const cached: GlobalProviderAttachments | undefined =
      globalSsoAttachmentsCache.get(key);

    expect(cached).toBeDefined();
    expect(cached?.enabledProjectIds).toEqual([]);
    expect(globalSsoAttachmentsCache.has(key)).toBe(true);

    // An empty list is falsy-adjacent but must still count as an answer.
    const correctReadIsAHit: boolean = cached !== undefined;
    const truthinessOnLengthIsAHit: boolean = Boolean(
      cached?.enabledProjectIds.length,
    );

    expect(correctReadIsAHit).toBe(true);
    expect(truthinessOnLengthIsAHit).toBe(false);
  });
});

describe("the caches - TTL", () => {
  test("a trust entry survives to its TTL boundary and is gone after it", () => {
    const t0: number = 1_700_000_000_000;
    const nowSpy: NowSpyLike = spyNow(t0);
    const key: string = globalProviderCacheKey("sso", ObjectID.generate());

    globalSsoProviderTrustCache.set(
      key,
      USABLE_UNRESTRICTED,
      GLOBAL_SSO_AUTHORIZATION_CACHE_TTL_MS,
    );

    expect(globalSsoProviderTrustCache.get(key)).toEqual(USABLE_UNRESTRICTED);

    nowSpy.mockReturnValue(t0 + GLOBAL_SSO_AUTHORIZATION_CACHE_TTL_MS - 1);
    expect(globalSsoProviderTrustCache.get(key)).toEqual(USABLE_UNRESTRICTED);

    nowSpy.mockReturnValue(t0 + GLOBAL_SSO_AUTHORIZATION_CACHE_TTL_MS);
    expect(globalSsoProviderTrustCache.get(key)).toEqual(USABLE_UNRESTRICTED);

    nowSpy.mockReturnValue(t0 + GLOBAL_SSO_AUTHORIZATION_CACHE_TTL_MS + 1);
    expect(globalSsoProviderTrustCache.get(key)).toBeUndefined();
  });

  test("an expired trust entry is a miss, not a stale negative or a stale positive", () => {
    const t0: number = 1_700_000_000_000;
    const nowSpy: NowSpyLike = spyNow(t0);
    const key: string = globalProviderCacheKey("sso", ObjectID.generate());

    globalSsoProviderTrustCache.set(
      key,
      DISABLED_PROVIDER,
      GLOBAL_SSO_AUTHORIZATION_CACHE_TTL_MS,
    );

    expect(globalSsoProviderTrustCache.has(key)).toBe(true);

    nowSpy.mockReturnValue(t0 + GLOBAL_SSO_AUTHORIZATION_CACHE_TTL_MS + 1);

    expect(globalSsoProviderTrustCache.get(key)).toBeUndefined();
    expect(globalSsoProviderTrustCache.has(key)).toBe(false);

    // Re-populating at the later clock gives the entry a fresh full TTL.
    globalSsoProviderTrustCache.set(
      key,
      USABLE_UNRESTRICTED,
      GLOBAL_SSO_AUTHORIZATION_CACHE_TTL_MS,
    );

    expect(globalSsoProviderTrustCache.get(key)).toEqual(USABLE_UNRESTRICTED);
  });

  test("an attachment entry expires on the same 60s TTL", () => {
    const t0: number = 1_700_000_000_000;
    const nowSpy: NowSpyLike = spyNow(t0);
    const key: string = globalProviderCacheKey("oidc", ObjectID.generate());
    const projectId: ObjectID = ObjectID.generate();

    globalSsoAttachmentsCache.set(
      key,
      attachments({
        hasAnyAttachmentRows: true,
        enabledProjectIds: [projectId.toString()],
      }),
      GLOBAL_SSO_AUTHORIZATION_CACHE_TTL_MS,
    );

    expect(globalSsoAttachmentsCache.get(key)).toBeDefined();

    nowSpy.mockReturnValue(t0 + GLOBAL_SSO_AUTHORIZATION_CACHE_TTL_MS);
    expect(globalSsoAttachmentsCache.get(key)).toBeDefined();

    nowSpy.mockReturnValue(t0 + GLOBAL_SSO_AUTHORIZATION_CACHE_TTL_MS + 1);
    expect(globalSsoAttachmentsCache.get(key)).toBeUndefined();
  });
});

describe("clearGlobalSsoAuthorizationCaches", () => {
  test("it empties BOTH caches", () => {
    const ssoKey: string = globalProviderCacheKey("sso", ObjectID.generate());
    const oidcKey: string = globalProviderCacheKey("oidc", ObjectID.generate());

    globalSsoProviderTrustCache.set(
      ssoKey,
      USABLE_UNRESTRICTED,
      GLOBAL_SSO_AUTHORIZATION_CACHE_TTL_MS,
    );
    globalSsoProviderTrustCache.set(
      oidcKey,
      DISABLED_PROVIDER,
      GLOBAL_SSO_AUTHORIZATION_CACHE_TTL_MS,
    );
    globalSsoAttachmentsCache.set(
      ssoKey,
      attachments({ hasAnyAttachmentRows: false, enabledProjectIds: [] }),
      GLOBAL_SSO_AUTHORIZATION_CACHE_TTL_MS,
    );
    globalSsoAttachmentsCache.set(
      oidcKey,
      attachments({ hasAnyAttachmentRows: true, enabledProjectIds: [] }),
      GLOBAL_SSO_AUTHORIZATION_CACHE_TTL_MS,
    );

    expect(globalSsoProviderTrustCache.size()).toBe(2);
    expect(globalSsoAttachmentsCache.size()).toBe(2);

    clearGlobalSsoAuthorizationCaches();

    expect(globalSsoProviderTrustCache.size()).toBe(0);
    expect(globalSsoAttachmentsCache.size()).toBe(0);
    expect(globalSsoProviderTrustCache.get(ssoKey)).toBeUndefined();
    expect(globalSsoProviderTrustCache.get(oidcKey)).toBeUndefined();
    expect(globalSsoAttachmentsCache.get(ssoKey)).toBeUndefined();
    expect(globalSsoAttachmentsCache.get(oidcKey)).toBeUndefined();
  });

  test("clearing twice is harmless, and the caches are usable again afterwards", () => {
    const key: string = globalProviderCacheKey("sso", ObjectID.generate());

    clearGlobalSsoAuthorizationCaches();
    clearGlobalSsoAuthorizationCaches();

    globalSsoProviderTrustCache.set(
      key,
      USABLE_UNRESTRICTED,
      GLOBAL_SSO_AUTHORIZATION_CACHE_TTL_MS,
    );

    expect(globalSsoProviderTrustCache.get(key)).toEqual(USABLE_UNRESTRICTED);
  });
});

describe("loadTrustOnce / loadAttachmentsOnce - in-flight de-duplication", () => {
  test("N concurrent callers for the SAME key run the loader ONCE and all get the same value", async () => {
    /*
     * This is the multi-tenant fan-out: the permission path asks about every
     * project the user belongs to concurrently, and on a cold cache each of
     * those asks would otherwise issue its own copy of the same provider query.
     */
    const key: string = globalProviderCacheKey("sso", ObjectID.generate());
    const gate: Deferred<GlobalProviderTrust> =
      createDeferred<GlobalProviderTrust>();

    let loaderCalls: number = 0;

    const load: () => Promise<GlobalProviderTrust> =
      (): Promise<GlobalProviderTrust> => {
        loaderCalls++;
        return gate.promise;
      };

    const pending: Array<Promise<GlobalProviderTrust>> = [];
    for (let index: number = 0; index < 50; index++) {
      pending.push(loadTrustOnce(key, load));
    }

    // Fifty callers, one query.
    expect(pending).toHaveLength(50);
    expect(loaderCalls).toBe(1);

    gate.resolve(USABLE_UNRESTRICTED);

    const results: Array<GlobalProviderTrust> = await Promise.all(pending);

    /*
     * Every caller resolves with the very same object, not merely an equal one:
     * they are all reading the single shared load rather than fifty of their
     * own.
     */
    expect(results).toHaveLength(50);
    for (const result of results) {
      expect(result).toBe(USABLE_UNRESTRICTED);
    }
    expect(loaderCalls).toBe(1);
  });

  test("without the de-duplication the same fan-out would issue one load per caller", () => {
    /*
     * The control for the test above: the counting harness itself is capable of
     * seeing N loads, so "loaderCalls === 1" there is a real observation and not
     * an artefact of how the loader is written.
     */
    const key: string = globalProviderCacheKey("sso", ObjectID.generate());
    const gate: Deferred<GlobalProviderTrust> =
      createDeferred<GlobalProviderTrust>();

    let loaderCalls: number = 0;

    const load: () => Promise<GlobalProviderTrust> =
      (): Promise<GlobalProviderTrust> => {
        loaderCalls++;
        return gate.promise;
      };

    for (let index: number = 0; index < 50; index++) {
      // Calling the loader directly - i.e. skipping loadTrustOnce entirely.
      void load();
    }

    expect(loaderCalls).toBe(50);

    // And through loadTrustOnce, the same fifty asks cost one load.
    loaderCalls = 0;
    for (let index: number = 0; index < 50; index++) {
      void loadTrustOnce(key, load);
    }

    expect(loaderCalls).toBe(1);

    gate.resolve(USABLE_UNRESTRICTED);
  });

  test("concurrent callers for DIFFERENT keys each run their own loader", async () => {
    const firstKey: string = globalProviderCacheKey("sso", ObjectID.generate());
    const secondKey: string = globalProviderCacheKey(
      "sso",
      ObjectID.generate(),
    );
    // Same provider id, other namespace: still a different key, still its own loader.
    const sharedId: ObjectID = ObjectID.generate();
    const ssoKey: string = globalProviderCacheKey("sso", sharedId);
    const oidcKey: string = globalProviderCacheKey("oidc", sharedId);

    const calls: Array<string> = [];

    function loaderFor(
      key: string,
      value: GlobalProviderTrust,
    ): () => Promise<GlobalProviderTrust> {
      return async (): Promise<GlobalProviderTrust> => {
        calls.push(key);
        return value;
      };
    }

    const results: Array<GlobalProviderTrust> = await Promise.all([
      loadTrustOnce(firstKey, loaderFor(firstKey, USABLE_UNRESTRICTED)),
      loadTrustOnce(secondKey, loaderFor(secondKey, DISABLED_PROVIDER)),
      loadTrustOnce(ssoKey, loaderFor(ssoKey, USABLE_UNRESTRICTED)),
      loadTrustOnce(oidcKey, loaderFor(oidcKey, DISABLED_PROVIDER)),
    ]);

    expect(calls.sort()).toEqual([firstKey, secondKey, ssoKey, oidcKey].sort());
    expect(results[0]).toBe(USABLE_UNRESTRICTED);
    expect(results[1]).toBe(DISABLED_PROVIDER);
    expect(results[2]).toBe(USABLE_UNRESTRICTED);
    expect(results[3]).toBe(DISABLED_PROVIDER);
  });

  test("the trust and attachment lookups are de-duplicated independently", async () => {
    const key: string = globalProviderCacheKey("sso", ObjectID.generate());

    let trustCalls: number = 0;
    let attachmentCalls: number = 0;

    const trust: Promise<GlobalProviderTrust> = loadTrustOnce(
      key,
      async (): Promise<GlobalProviderTrust> => {
        trustCalls++;
        return USABLE_UNRESTRICTED;
      },
    );
    const attached: Promise<GlobalProviderAttachments> = loadAttachmentsOnce(
      key,
      async (): Promise<GlobalProviderAttachments> => {
        attachmentCalls++;
        return attachments({
          hasAnyAttachmentRows: false,
          enabledProjectIds: [],
        });
      },
    );

    // The same key string in the two maps must not shadow one another.
    expect(await trust).toBe(USABLE_UNRESTRICTED);
    expect((await attached).hasAnyAttachmentRows).toBe(false);
    expect(trustCalls).toBe(1);
    expect(attachmentCalls).toBe(1);
  });

  test("the in-flight entry is released once it settles, so a later caller loads again", async () => {
    const key: string = globalProviderCacheKey("oidc", ObjectID.generate());

    const values: Array<GlobalProviderAttachments> = [
      attachments({ hasAnyAttachmentRows: false, enabledProjectIds: [] }),
      attachments({ hasAnyAttachmentRows: true, enabledProjectIds: [] }),
    ];

    let loaderCalls: number = 0;

    const load: () => Promise<GlobalProviderAttachments> =
      async (): Promise<GlobalProviderAttachments> => {
        const value: GlobalProviderAttachments | undefined =
          values[loaderCalls];
        loaderCalls++;
        return value!;
      };

    const first: GlobalProviderAttachments = await loadAttachmentsOnce(
      key,
      load,
    );
    expect(first).toBe(values[0]);
    expect(loaderCalls).toBe(1);

    /*
     * The de-dup window is one settle, not one process lifetime - otherwise a
     * provider's very first answer would be pinned forever and the 60s TTL
     * would never take effect.
     */
    const second: GlobalProviderAttachments = await loadAttachmentsOnce(
      key,
      load,
    );
    expect(second).toBe(values[1]);
    expect(loaderCalls).toBe(2);
  });

  test("a REJECTING loader is shared by every concurrent caller and is then released for a retry", async () => {
    const key: string = globalProviderCacheKey("sso", ObjectID.generate());
    const gate: Deferred<GlobalProviderTrust> =
      createDeferred<GlobalProviderTrust>();
    const failure: Error = new Error("connection terminated unexpectedly");

    let loaderCalls: number = 0;

    const failingLoad: () => Promise<GlobalProviderTrust> =
      (): Promise<GlobalProviderTrust> => {
        loaderCalls++;
        return gate.promise;
      };

    const pending: Array<Promise<GlobalProviderTrust>> = [
      loadTrustOnce(key, failingLoad),
      loadTrustOnce(key, failingLoad),
      loadTrustOnce(key, failingLoad),
    ];

    expect(loaderCalls).toBe(1);

    gate.reject(failure);

    /*
     * All three see the failure. A lookup failure must surface as a failure -
     * the enforcement path THROWS rather than turning "could not find out" into
     * "not allowed here" - so a shared rejection has to reach every caller.
     */
    const outcomes: Array<unknown> = await Promise.all(
      pending.map((promise: Promise<GlobalProviderTrust>) => {
        return promise.then(
          (): unknown => {
            return "resolved";
          },
          (error: unknown): unknown => {
            return error;
          },
        );
      }),
    );

    for (const outcome of outcomes) {
      expect(outcome).toBe(failure);
    }
    expect(loaderCalls).toBe(1);

    /*
     * ...and the key is NOT poisoned. A transient database blip must not pin a
     * rejected promise in the map, which would fail every later request for
     * that provider for the life of the process.
     */
    const retried: GlobalProviderTrust = await loadTrustOnce(
      key,
      async (): Promise<GlobalProviderTrust> => {
        loaderCalls++;
        return USABLE_UNRESTRICTED;
      },
    );

    expect(retried).toBe(USABLE_UNRESTRICTED);
    expect(loaderCalls).toBe(2);
  });

  test("a rejecting attachment loader behaves the same way", async () => {
    const key: string = globalProviderCacheKey("oidc", ObjectID.generate());
    const failure: Error = new Error("attachment lookup failed");

    let loaderCalls: number = 0;

    await expect(
      loadAttachmentsOnce(key, async (): Promise<GlobalProviderAttachments> => {
        loaderCalls++;
        throw failure;
      }),
    ).rejects.toBe(failure);

    const retried: GlobalProviderAttachments = await loadAttachmentsOnce(
      key,
      async (): Promise<GlobalProviderAttachments> => {
        loaderCalls++;
        return attachments({
          hasAnyAttachmentRows: true,
          enabledProjectIds: [],
        });
      },
    );

    expect(retried.hasAnyAttachmentRows).toBe(true);
    expect(loaderCalls).toBe(2);
  });

  test("clearGlobalSsoAuthorizationCaches drops IN-FLIGHT entries as well as cached ones", async () => {
    /*
     * A write hook fires while a lookup is already in flight. The in-flight
     * promise is carrying the pre-change answer, so a caller arriving after the
     * clear must start its own lookup instead of joining it.
     */
    const trustKey: string = globalProviderCacheKey("sso", ObjectID.generate());
    const attachmentKey: string = globalProviderCacheKey(
      "sso",
      ObjectID.generate(),
    );

    const trustGate: Deferred<GlobalProviderTrust> =
      createDeferred<GlobalProviderTrust>();
    const attachmentGate: Deferred<GlobalProviderAttachments> =
      createDeferred<GlobalProviderAttachments>();

    let trustCalls: number = 0;
    let attachmentCalls: number = 0;

    const staleTrust: () => Promise<GlobalProviderTrust> =
      (): Promise<GlobalProviderTrust> => {
        trustCalls++;
        return trustGate.promise;
      };
    const staleAttachments: () => Promise<GlobalProviderAttachments> =
      (): Promise<GlobalProviderAttachments> => {
        attachmentCalls++;
        return attachmentGate.promise;
      };

    const inFlightTrust: Promise<GlobalProviderTrust> = loadTrustOnce(
      trustKey,
      staleTrust,
    );
    const inFlightAttachments: Promise<GlobalProviderAttachments> =
      loadAttachmentsOnce(attachmentKey, staleAttachments);

    expect(trustCalls).toBe(1);
    expect(attachmentCalls).toBe(1);

    /*
     * Without a clear, a second caller joins the in-flight lookup: no new load,
     * and it will be handed the pre-change answer.
     */
    const joinedTrust: Promise<GlobalProviderTrust> = loadTrustOnce(
      trustKey,
      staleTrust,
    );
    const joinedAttachments: Promise<GlobalProviderAttachments> =
      loadAttachmentsOnce(attachmentKey, staleAttachments);

    expect(trustCalls).toBe(1);
    expect(attachmentCalls).toBe(1);

    clearGlobalSsoAuthorizationCaches();

    const freshTrust: Promise<GlobalProviderTrust> = loadTrustOnce(
      trustKey,
      async (): Promise<GlobalProviderTrust> => {
        trustCalls++;
        return DISABLED_PROVIDER;
      },
    );
    const freshAttachments: Promise<GlobalProviderAttachments> =
      loadAttachmentsOnce(
        attachmentKey,
        async (): Promise<GlobalProviderAttachments> => {
          attachmentCalls++;
          return attachments({
            hasAnyAttachmentRows: true,
            enabledProjectIds: [],
          });
        },
      );

    /*
     * The clear is what forces the new load. Compare with the two calls above,
     * which added nothing to these counters.
     */
    expect(trustCalls).toBe(2);
    expect(attachmentCalls).toBe(2);

    // The post-clear lookup is the one that sees the admin's change.
    expect(await freshTrust).toBe(DISABLED_PROVIDER);
    expect((await freshAttachments).hasAnyAttachmentRows).toBe(true);

    // Let the pre-clear lookups finish so nothing is left dangling.
    trustGate.resolve(USABLE_UNRESTRICTED);
    attachmentGate.resolve(
      attachments({ hasAnyAttachmentRows: false, enabledProjectIds: [] }),
    );

    /*
     * The callers that joined before the clear still get the pre-change answer -
     * their query was already on the wire. That staleness is bounded by the
     * request in flight, which is why the write hooks clear in the success hook
     * as well as the before-hook.
     */
    expect(await inFlightTrust).toBe(USABLE_UNRESTRICTED);
    expect(await joinedTrust).toBe(USABLE_UNRESTRICTED);
    expect((await inFlightAttachments).hasAnyAttachmentRows).toBe(false);
    expect((await joinedAttachments).hasAnyAttachmentRows).toBe(false);
  });

  test("de-duplication does not populate the cache by itself", () => {
    /*
     * loadOnce only shares the promise; writing the answer into the 60s cache
     * is the loader's job. If sharing implied caching, a loader that threw
     * would still leave something behind.
     */
    const key: string = globalProviderCacheKey("sso", ObjectID.generate());

    const pending: Promise<GlobalProviderTrust> = loadTrustOnce(
      key,
      async (): Promise<GlobalProviderTrust> => {
        return USABLE_UNRESTRICTED;
      },
    );

    expect(globalSsoProviderTrustCache.get(key)).toBeUndefined();
    expect(globalSsoProviderTrustCache.size()).toBe(0);

    return pending.then((): void => {
      expect(globalSsoProviderTrustCache.get(key)).toBeUndefined();
    });
  });
});

/*
 * The in-flight slot is released only by the lookup that owns it.
 *
 * A cache clear can happen WHILE a lookup is on the wire - every write to any
 * of the four Global SSO/OIDC services calls clearGlobalSsoAuthorizationCaches
 * twice, and the multi-tenant permission path fans out immediately afterwards.
 * If the older lookup deleted the key blindly when it finally settled, it
 * would evict the NEWER lookup that had since taken the slot, and every
 * caller arriving after that would start its own query - de-duplication
 * silently off in exactly the situation it exists for.
 */
describe("loadTrustOnce - a settling lookup does not evict a newer one", () => {
  const evictionProviderId: ObjectID = ObjectID.generate();

  test("a caller arriving after a clear joins the second lookup rather than starting a third", async () => {
    const key: string = globalProviderCacheKey("sso", evictionProviderId);

    let loadCount: number = 0;
    const releases: Array<(trust: GlobalProviderTrust) => void> = [];

    const blockingLoader: () => Promise<GlobalProviderTrust> =
      (): Promise<GlobalProviderTrust> => {
        loadCount += 1;

        return new Promise((resolve: (trust: GlobalProviderTrust) => void) => {
          releases.push(resolve);
        });
      };

    // Lookup #1 starts and is still in flight.
    const first: Promise<GlobalProviderTrust> = loadTrustOnce(
      key,
      blockingLoader,
    );

    // A write happens: the caches, and the in-flight slot, are dropped.
    clearGlobalSsoAuthorizationCaches();

    // Lookup #2 takes the slot and is also still in flight.
    const second: Promise<GlobalProviderTrust> = loadTrustOnce(
      key,
      blockingLoader,
    );

    expect(loadCount).toBe(2);

    // Lookup #1 now settles. It must NOT take lookup #2's slot with it.
    releases[0]!({ isUsable: true, restrictToAttachedProjects: false });
    await first;

    // A third caller arrives while lookup #2 is STILL in flight.
    const third: Promise<GlobalProviderTrust> = loadTrustOnce(
      key,
      blockingLoader,
    );

    expect(loadCount).toBe(2);

    releases[1]!({ isUsable: false, restrictToAttachedProjects: true });

    await expect(second).resolves.toEqual({
      isUsable: false,
      restrictToAttachedProjects: true,
    });
    await expect(third).resolves.toEqual({
      isUsable: false,
      restrictToAttachedProjects: true,
    });
  });

  test("the owning lookup still releases its own slot, so a later call re-loads", async () => {
    // The guard must not turn into "never release".
    const key: string = globalProviderCacheKey("oidc", evictionProviderId);

    let loadCount: number = 0;
    const loader: () => Promise<GlobalProviderTrust> =
      async (): Promise<GlobalProviderTrust> => {
        loadCount += 1;
        return { isUsable: true, restrictToAttachedProjects: false };
      };

    await loadTrustOnce(key, loader);
    await loadTrustOnce(key, loader);

    expect(loadCount).toBe(2);
  });
});

describe("GLOBAL_SSO_AUTHORIZATION_CACHE_TTL_MS", () => {
  test("is 60 seconds", () => {
    /*
     * This number is the blast radius of a revoked provider: the caches are
     * per-process with no cross-process invalidation, so on any node that did
     * NOT serve the disable, a provider that an admin turned off keeps
     * satisfying SSO enforcement for up to this long. Changing it changes that
     * exposure window.
     */
    expect(GLOBAL_SSO_AUTHORIZATION_CACHE_TTL_MS).toBe(60_000);
    expect(GLOBAL_SSO_AUTHORIZATION_CACHE_TTL_MS).toBe(60 * 1000);
  });
});
