import GlobalConfigService from "../../../Server/Services/GlobalConfigService";
import GlobalOidcProjectService from "../../../Server/Services/GlobalOidcProjectService";
import GlobalOidcService from "../../../Server/Services/GlobalOidcService";
import GlobalSsoProjectService from "../../../Server/Services/GlobalSsoProjectService";
import GlobalSsoService from "../../../Server/Services/GlobalSsoService";
import GlobalOidc from "../../../Models/DatabaseModels/GlobalOidc";
import GlobalOidcProject from "../../../Models/DatabaseModels/GlobalOidcProject";
import GlobalSso from "../../../Models/DatabaseModels/GlobalSso";
import GlobalSsoProject from "../../../Models/DatabaseModels/GlobalSsoProject";
import {
  GLOBAL_SSO_AUTHORIZATION_CACHE_TTL_MS,
  GlobalProviderTrust,
  clearGlobalSsoAuthorizationCaches,
} from "../../../Server/Utils/GlobalSsoAuthorization";
import GlobalSsoProviderChanges from "../../../Server/Utils/GlobalSsoProviderChanges";
import RealtimeAccessChanges, {
  RealtimeAccessChange,
  RealtimeAccessChangeKind,
} from "../../../Server/Utils/Realtime/RealtimeAccessChanges";
import ObjectID from "../../../Types/ObjectID";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * The STATEFUL half of Global SSO / Global OIDC enforcement.
 *
 * A Global SSO/OIDC token is a self-contained 30-day JWT with no project
 * binding. Its signature, expiry, type, user and pinned-provider checks are
 * pinned elsewhere (Common/Tests/Server/Utils/GlobalSSOToken.test.ts and
 * Common/Tests/Server/Middleware/UserAuthorizationSSOProvider.test.ts) and
 * together they can only ever answer "this person authenticated against SOME
 * instance-wide provider within the last month". This file pins the two
 * questions the token itself cannot answer, and which therefore have to be
 * asked of Postgres on every request:
 *
 *   1. IS THE PROVIDER STILL TRUSTED? getProviderTrust().isUsable - the admin
 *      "Enabled" toggle, and a delete, must cut access off now rather than in
 *      thirty days.
 *   2. DOES THE PROVIDER GOVERN THIS PROJECT? doesProviderGovernProject() -
 *      consulted only for a provider whose admin opted into
 *      `restrictToAttachedProjects`, because attachments are the PROVISIONING
 *      allow-list by default and reading them as an access boundary for
 *      everyone would lock existing users out on upgrade.
 *
 * Because both run per-request they are backed by 60s in-process caches, so
 * the caching is part of the contract and not an implementation detail:
 *
 *   - a cached `false` that is dropped (the classic truthiness-cache bug) is a
 *     query per request for exactly the providers an attacker is hammering;
 *   - a cache that is not invalidated on write turns an admin's "Disable"
 *     click into a no-op for a minute;
 *   - and the invalidation has to run in the SUCCESS hook, not only the
 *     before-hook: a clear that lands before the row is written can be
 *     re-filled with the PRE-change answer by a concurrent request on the same
 *     node, handing the disabled provider another full TTL of life.
 *
 * Nothing here touches a database. findOneBy/findBy are spied on each service
 * so the test both controls the rows AND counts the round trips.
 *
 * Deliberately NOT covered here (they belong to the middleware suites):
 * isGlobalSsoTokenAuthorizedForProject, isSsoSatisfiedForProject, and the
 * token-shaped checks in UserAuthorization.
 */

const PROVIDER_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const OTHER_PROVIDER_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);

/*
 * One id used against BOTH the SSO service and the OIDC service. The two live
 * in different tables and could genuinely collide, so the cache keys are
 * namespaced; these tests are what stops that namespacing from regressing.
 */
const SHARED_PROVIDER_ID: ObjectID = new ObjectID(
  "33333333-3333-4333-8333-333333333333",
);

const PROJECT_A: ObjectID = new ObjectID(
  "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
);
const PROJECT_B: ObjectID = new ObjectID(
  "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
);
const PROJECT_C: ObjectID = new ObjectID(
  "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
);

// The shape the services pass to findOneBy / findBy.
interface DatabaseCallArgs {
  query: Record<string, unknown>;
  select: Record<string, unknown>;
  props: Record<string, unknown>;
  limit?: number | undefined;
  skip?: number | undefined;
}

function spyOnQuery(service: any, methodName: string): jest.SpyInstance {
  return jest.spyOn(service, methodName) as unknown as jest.SpyInstance;
}

function callArgs(spy: jest.SpyInstance, callIndex: number): DatabaseCallArgs {
  const calls: Array<Array<unknown>> = spy.mock.calls as Array<Array<unknown>>;
  const call: Array<unknown> | undefined = calls[callIndex];

  expect(call).toBeDefined();

  return (call as Array<unknown>)[0] as DatabaseCallArgs;
}

/*
 * The before-hooks also check, under a lock, that a write leaves every
 * project that requires SSO a provider to sign in with
 * (GlobalSsoProviderChanges, pinned in GlobalSsoProviderChanges.test.ts).
 * Here only what the hooks do to the caches and the announcements counts, so
 * that check finds nothing to hold.
 */
function stubSignInWayChecks(): void {
  jest
    .spyOn(GlobalSsoProviderChanges, "beforeProviderUpdate")
    .mockResolvedValue(null);
  jest
    .spyOn(GlobalSsoProviderChanges, "beforeProviderDelete")
    .mockResolvedValue(null);
  jest
    .spyOn(GlobalSsoProviderChanges, "beforeAttachmentCreate")
    .mockResolvedValue(null);
  jest
    .spyOn(GlobalSsoProviderChanges, "beforeAttachmentUpdate")
    .mockResolvedValue(null);
  jest
    .spyOn(GlobalSsoProviderChanges, "beforeAttachmentDelete")
    .mockResolvedValue(null);
}

// Calls a protected hook without widening the service's public surface.
function callHook(
  service: any,
  hookName: string,
  args: Array<unknown>,
): Promise<unknown> {
  const hooks: Record<string, (...a: Array<unknown>) => Promise<unknown>> =
    service as unknown as Record<
      string,
      (...a: Array<unknown>) => Promise<unknown>
    >;

  const hook: ((...a: Array<unknown>) => Promise<unknown>) | undefined =
    hooks[hookName];

  if (!hook) {
    throw new Error(`Hook ${hookName} is not defined on the service`);
  }

  return hook.apply(service, args);
}

/*
 * `isEnabled` / `restrictToAttachedProjects` are written through an untyped
 * view of the row on purpose: the point of several tests below is what happens
 * when Postgres hands back null, or the column is missing entirely (an old row
 * read by a new binary), which the model's `boolean | undefined` type cannot
 * express.
 */
function setRawColumns(
  row: unknown,
  columns: Record<string, unknown>,
): unknown {
  const mutable: Record<string, unknown> = row as Record<string, unknown>;

  for (const columnName of Object.keys(columns)) {
    mutable[columnName] = columns[columnName];
  }

  return row;
}

interface AttachmentRowSpec {
  projectId: ObjectID | undefined;
  isEnabled: unknown;
}

beforeEach(() => {
  /*
   * The caches live at module scope, so without this a `true` cached by one
   * test would answer the next test's question before its stub ever ran.
   */
  clearGlobalSsoAuthorizationCaches();
});

afterEach(() => {
  jest.restoreAllMocks();
  clearGlobalSsoAuthorizationCaches();
});

/*
 * -------------------------------------------------------------------------
 * getProviderTrust
 * ----------------------------------------------------------------------
 */

interface TrustSuite {
  name: string;
  service: any;
  getTrust: (providerId: ObjectID) => Promise<GlobalProviderTrust>;
  buildRow: (isEnabled: unknown, restrict: unknown) => unknown;
}

const TRUST_SUITES: Array<TrustSuite> = [
  {
    name: "GlobalSsoService",
    service: GlobalSsoService,
    getTrust: (providerId: ObjectID): Promise<GlobalProviderTrust> => {
      return GlobalSsoService.getProviderTrust(providerId);
    },
    buildRow: (isEnabled: unknown, restrict: unknown): unknown => {
      const row: GlobalSso = new GlobalSso();
      row.id = PROVIDER_ID;
      return setRawColumns(row, {
        isEnabled: isEnabled,
        restrictToAttachedProjects: restrict,
      });
    },
  },
  {
    name: "GlobalOidcService",
    service: GlobalOidcService,
    getTrust: (providerId: ObjectID): Promise<GlobalProviderTrust> => {
      return GlobalOidcService.getProviderTrust(providerId);
    },
    buildRow: (isEnabled: unknown, restrict: unknown): unknown => {
      const row: GlobalOidc = new GlobalOidc();
      row.id = PROVIDER_ID;
      return setRawColumns(row, {
        isEnabled: isEnabled,
        restrictToAttachedProjects: restrict,
      });
    },
  },
];

describe.each(TRUST_SUITES)(
  "$name.getProviderTrust",
  (suite: TrustSuite): void => {
    function stubRow(row: unknown): jest.SpyInstance {
      const spy: jest.SpyInstance = spyOnQuery(suite.service, "findOneBy");
      spy.mockResolvedValue(row);
      return spy;
    }

    test("enabled, not restricted -> usable and instance-wide", async () => {
      stubRow(suite.buildRow(true, false));

      const trust: GlobalProviderTrust = await suite.getTrust(PROVIDER_ID);

      expect(trust).toEqual({
        isUsable: true,
        restrictToAttachedProjects: false,
        signInsEndedAtMs: null,
      });
    });

    test("enabled and restricted -> usable, and the opt-in is reported", async () => {
      stubRow(suite.buildRow(true, true));

      const trust: GlobalProviderTrust = await suite.getTrust(PROVIDER_ID);

      expect(trust).toEqual({
        isUsable: true,
        restrictToAttachedProjects: true,
        signInsEndedAtMs: null,
      });
    });

    test("disabled -> NOT usable, whether or not it is restricted", async () => {
      /*
       * "Disabled" has exactly one meaning. This is the check that makes the
       * admin toggle revoke the 30-day tokens the provider already minted, so
       * the restrict flag must not be able to soften it in either direction.
       */
      const unrestricted: jest.SpyInstance = stubRow(
        suite.buildRow(false, false),
      );

      expect((await suite.getTrust(PROVIDER_ID)).isUsable).toBe(false);

      unrestricted.mockRestore();
      clearGlobalSsoAuthorizationCaches();

      stubRow(suite.buildRow(false, true));

      expect((await suite.getTrust(PROVIDER_ID)).isUsable).toBe(false);
    });

    test("the SAME row is usable once isEnabled is flipped back on", async () => {
      /*
       * The pair for the two denials above: identical setup, one field
       * changed. Without this an implementation that always answered `false`
       * would satisfy the disabled cases.
       */
      stubRow(suite.buildRow(true, true));

      expect((await suite.getTrust(PROVIDER_ID)).isUsable).toBe(true);
    });

    test("a deleted provider (no row) -> not usable, not restricted", async () => {
      stubRow(null);

      expect(await suite.getTrust(PROVIDER_ID)).toEqual({
        isUsable: false,
        restrictToAttachedProjects: false,
        signInsEndedAtMs: null,
      });
    });

    test.each([
      ["undefined", undefined],
      ["null", null],
    ])(
      "isEnabled %s fails CLOSED, and the same row with true is open",
      async (_label: string, missingValue: unknown) => {
        stubRow(suite.buildRow(missingValue, true));

        expect((await suite.getTrust(PROVIDER_ID)).isUsable).toBe(false);

        jest.restoreAllMocks();
        clearGlobalSsoAuthorizationCaches();

        stubRow(suite.buildRow(true, true));

        expect((await suite.getTrust(PROVIDER_ID)).isUsable).toBe(true);
      },
    );

    test.each([
      ["undefined", undefined],
      ["null", null],
    ])(
      "restrictToAttachedProjects %s fails CLOSED to the safe DEFAULT, and true opts in",
      async (_label: string, missingValue: unknown) => {
        stubRow(suite.buildRow(true, missingValue));

        /*
         * "Closed" for THIS flag means `false` - the default every existing
         * installation gets, where a global login satisfies every project the
         * user belongs to. A null read as `true` would silently start denying
         * projects nobody attached.
         */
        expect(
          (await suite.getTrust(PROVIDER_ID)).restrictToAttachedProjects,
        ).toBe(false);

        jest.restoreAllMocks();
        clearGlobalSsoAuthorizationCaches();

        stubRow(suite.buildRow(true, true));

        expect(
          (await suite.getTrust(PROVIDER_ID)).restrictToAttachedProjects,
        ).toBe(true);
      },
    );

    test("the SELECT asks for restrictToAttachedProjects", async () => {
      /*
       * If the column is not selected, the hydrated row carries `undefined`,
       * `Boolean(undefined)` is false, and the admin's opt-in silently never
       * takes effect - a bug no behavioural assertion above would catch,
       * because "not restricted" is also the legitimate default.
       */
      const spy: jest.SpyInstance = stubRow(suite.buildRow(true, true));

      await suite.getTrust(PROVIDER_ID);

      const args: DatabaseCallArgs = callArgs(spy, 0);

      expect(args.select["restrictToAttachedProjects"]).toBe(true);
      expect(args.select["isEnabled"]).toBe(true);
      expect(args.query["_id"]).toBe(PROVIDER_ID.toString());
      expect(args.props["isRoot"]).toBe(true);
    });

    test("a repeat question does NOT hit the database", async () => {
      const spy: jest.SpyInstance = stubRow(suite.buildRow(true, false));

      expect((await suite.getTrust(PROVIDER_ID)).isUsable).toBe(true);
      expect((await suite.getTrust(PROVIDER_ID)).isUsable).toBe(true);
      expect((await suite.getTrust(PROVIDER_ID)).isUsable).toBe(true);

      expect(spy).toHaveBeenCalledTimes(1);
    });

    test("a DISABLED provider is cached too - it must not re-query per request", async () => {
      /*
       * The truthiness-cache bug: a cached `{ isUsable: false }` that reads as
       * a miss means every single request against a revoked provider pays a
       * query, which is precisely the traffic an attacker with a stale token
       * generates.
       */
      const spy: jest.SpyInstance = stubRow(suite.buildRow(false, false));

      expect((await suite.getTrust(PROVIDER_ID)).isUsable).toBe(false);
      expect((await suite.getTrust(PROVIDER_ID)).isUsable).toBe(false);

      expect(spy).toHaveBeenCalledTimes(1);
    });

    test("a 'row not found' answer is cached too", async () => {
      const spy: jest.SpyInstance = stubRow(null);

      await suite.getTrust(PROVIDER_ID);
      await suite.getTrust(PROVIDER_ID);

      expect(spy).toHaveBeenCalledTimes(1);
    });

    test("different provider ids are cached independently", async () => {
      const spy: jest.SpyInstance = spyOnQuery(suite.service, "findOneBy");

      spy.mockImplementation((async (
        findBy: DatabaseCallArgs,
      ): Promise<unknown> => {
        return findBy.query["_id"] === PROVIDER_ID.toString()
          ? suite.buildRow(true, false)
          : suite.buildRow(false, false);
      }) as never);

      expect((await suite.getTrust(PROVIDER_ID)).isUsable).toBe(true);
      expect((await suite.getTrust(OTHER_PROVIDER_ID)).isUsable).toBe(false);

      // Two distinct ids, two queries - one answer did not stand in for the other.
      expect(spy).toHaveBeenCalledTimes(2);

      // And both are now cached, each under its own key.
      expect((await suite.getTrust(PROVIDER_ID)).isUsable).toBe(true);
      expect((await suite.getTrust(OTHER_PROVIDER_ID)).isUsable).toBe(false);
      expect(spy).toHaveBeenCalledTimes(2);
    });

    test("concurrent misses for one provider share a single query", async () => {
      /*
       * The multi-tenant permission path fans out over every project the user
       * belongs to at once. Without in-flight de-duplication a cold cache
       * means one query per project for the same provider.
       */
      const spy: jest.SpyInstance = stubRow(suite.buildRow(true, false));

      const answers: Array<GlobalProviderTrust> = await Promise.all([
        suite.getTrust(PROVIDER_ID),
        suite.getTrust(PROVIDER_ID),
        suite.getTrust(PROVIDER_ID),
        suite.getTrust(PROVIDER_ID),
        suite.getTrust(PROVIDER_ID),
      ]);

      expect(
        answers.every((trust: GlobalProviderTrust): boolean => {
          return trust.isUsable;
        }),
      ).toBe(true);
      expect(spy).toHaveBeenCalledTimes(1);
    });

    test("the cached answer expires after the TTL, so re-enabling takes effect", async () => {
      const nowSpy: jest.SpyInstance = jest.spyOn(Date, "now");
      let clock: number = 1_700_000_000_000;
      nowSpy.mockImplementation((): number => {
        return clock;
      });

      const spy: jest.SpyInstance = spyOnQuery(suite.service, "findOneBy");
      spy.mockResolvedValue(suite.buildRow(false, false));

      expect((await suite.getTrust(PROVIDER_ID)).isUsable).toBe(false);

      // Still inside the window: served from cache, the new row is not seen.
      spy.mockResolvedValue(suite.buildRow(true, false));
      clock += GLOBAL_SSO_AUTHORIZATION_CACHE_TTL_MS - 1;
      expect((await suite.getTrust(PROVIDER_ID)).isUsable).toBe(false);
      expect(spy).toHaveBeenCalledTimes(1);

      // Past the window: re-read, and the provider is live again.
      clock += 2;
      expect((await suite.getTrust(PROVIDER_ID)).isUsable).toBe(true);
      expect(spy).toHaveBeenCalledTimes(2);
    });
  },
);

describe("getProviderTrust - the SSO and OIDC caches are separate namespaces", () => {
  test("one id, enabled as SSO and disabled as OIDC, keeps two answers", async () => {
    const ssoSpy: jest.SpyInstance = spyOnQuery(GlobalSsoService, "findOneBy");
    const ssoRow: GlobalSso = new GlobalSso();
    ssoRow.id = SHARED_PROVIDER_ID;
    ssoSpy.mockResolvedValue(
      setRawColumns(ssoRow, {
        isEnabled: true,
        restrictToAttachedProjects: false,
      }),
    );

    const oidcSpy: jest.SpyInstance = spyOnQuery(
      GlobalOidcService,
      "findOneBy",
    );
    const oidcRow: GlobalOidc = new GlobalOidc();
    oidcRow.id = SHARED_PROVIDER_ID;
    oidcSpy.mockResolvedValue(
      setRawColumns(oidcRow, {
        isEnabled: false,
        restrictToAttachedProjects: true,
      }),
    );

    const ssoTrust: GlobalProviderTrust =
      await GlobalSsoService.getProviderTrust(SHARED_PROVIDER_ID);
    const oidcTrust: GlobalProviderTrust =
      await GlobalOidcService.getProviderTrust(SHARED_PROVIDER_ID);

    expect(ssoTrust.isUsable).toBe(true);
    expect(oidcTrust.isUsable).toBe(false);
    expect(oidcTrust.restrictToAttachedProjects).toBe(true);

    // Neither table vouched for the other: each answered from its own query.
    expect(ssoSpy).toHaveBeenCalledTimes(1);
    expect(oidcSpy).toHaveBeenCalledTimes(1);
  });

  test("the reverse pairing holds too - disabled as SSO, enabled as OIDC", async () => {
    /*
     * The mirror of the case above. A cache that collapsed the two would
     * happen to give the right answer for one ordering and the wrong one for
     * the other, so both orderings are pinned.
     */
    const ssoSpy: jest.SpyInstance = spyOnQuery(GlobalSsoService, "findOneBy");
    const ssoRow: GlobalSso = new GlobalSso();
    ssoRow.id = SHARED_PROVIDER_ID;
    ssoSpy.mockResolvedValue(
      setRawColumns(ssoRow, {
        isEnabled: false,
        restrictToAttachedProjects: false,
      }),
    );

    const oidcSpy: jest.SpyInstance = spyOnQuery(
      GlobalOidcService,
      "findOneBy",
    );
    const oidcRow: GlobalOidc = new GlobalOidc();
    oidcRow.id = SHARED_PROVIDER_ID;
    oidcSpy.mockResolvedValue(
      setRawColumns(oidcRow, {
        isEnabled: true,
        restrictToAttachedProjects: false,
      }),
    );

    expect(
      (await GlobalOidcService.getProviderTrust(SHARED_PROVIDER_ID)).isUsable,
    ).toBe(true);
    expect(
      (await GlobalSsoService.getProviderTrust(SHARED_PROVIDER_ID)).isUsable,
    ).toBe(false);
  });
});

/*
 * -------------------------------------------------------------------------
 * doesProviderGovernProject
 * ----------------------------------------------------------------------
 */

interface GovernSuite {
  name: string;
  service: any;
  foreignKey: string;
  buildRows: (specs: Array<AttachmentRowSpec>) => Array<unknown>;
  govern: (providerId: ObjectID, projectId: ObjectID) => Promise<boolean>;
}

const GOVERN_SUITES: Array<GovernSuite> = [
  {
    name: "GlobalSsoProjectService",
    service: GlobalSsoProjectService,
    foreignKey: "globalSsoId",
    buildRows: (specs: Array<AttachmentRowSpec>): Array<unknown> => {
      return specs.map((spec: AttachmentRowSpec): unknown => {
        const row: GlobalSsoProject = new GlobalSsoProject();
        row.globalSsoId = PROVIDER_ID;
        return setRawColumns(row, {
          projectId: spec.projectId,
          isEnabled: spec.isEnabled,
        });
      });
    },
    govern: (providerId: ObjectID, projectId: ObjectID): Promise<boolean> => {
      return GlobalSsoProjectService.doesProviderGovernProject({
        globalSsoId: providerId,
        projectId: projectId,
      });
    },
  },
  {
    name: "GlobalOidcProjectService",
    service: GlobalOidcProjectService,
    foreignKey: "globalOidcId",
    buildRows: (specs: Array<AttachmentRowSpec>): Array<unknown> => {
      return specs.map((spec: AttachmentRowSpec): unknown => {
        const row: GlobalOidcProject = new GlobalOidcProject();
        row.globalOidcId = PROVIDER_ID;
        return setRawColumns(row, {
          projectId: spec.projectId,
          isEnabled: spec.isEnabled,
        });
      });
    },
    govern: (providerId: ObjectID, projectId: ObjectID): Promise<boolean> => {
      return GlobalOidcProjectService.doesProviderGovernProject({
        globalOidcId: providerId,
        projectId: projectId,
      });
    },
  },
];

describe.each(GOVERN_SUITES)(
  "$name.doesProviderGovernProject",
  (suite: GovernSuite): void => {
    function stubAttachments(
      specs: Array<AttachmentRowSpec>,
    ): jest.SpyInstance {
      const spy: jest.SpyInstance = spyOnQuery(suite.service, "findBy");
      spy.mockResolvedValue(suite.buildRows(specs));
      return spy;
    }

    test("NO attachment rows at all -> instance-wide, every project governed", async () => {
      /*
       * This is the shape every existing installation is in, and it is what
       * the login routers already treat an unattached provider as. Denying
       * here would lock people out the moment an admin ticked the opt-in.
       */
      stubAttachments([]);

      expect(await suite.govern(PROVIDER_ID, PROJECT_A)).toBe(true);
      expect(await suite.govern(PROVIDER_ID, PROJECT_C)).toBe(true);
    });

    test("an attached, enabled project is governed; one outside the set is not", async () => {
      stubAttachments([
        { projectId: PROJECT_A, isEnabled: true },
        { projectId: PROJECT_B, isEnabled: true },
      ]);

      expect(await suite.govern(PROVIDER_ID, PROJECT_A)).toBe(true);
      expect(await suite.govern(PROVIDER_ID, PROJECT_B)).toBe(true);
      expect(await suite.govern(PROVIDER_ID, PROJECT_C)).toBe(false);
    });

    test("rows exist but ALL are disabled -> denied, NOT widened", async () => {
      /*
       * The widening bug. If "no ENABLED rows" collapsed into "no rows", an
       * admin disabling the last attachment would hand the provider every
       * project on the instance instead of none.
       */
      stubAttachments([
        { projectId: PROJECT_A, isEnabled: false },
        { projectId: PROJECT_B, isEnabled: false },
      ]);

      expect(await suite.govern(PROVIDER_ID, PROJECT_A)).toBe(false);
      expect(await suite.govern(PROVIDER_ID, PROJECT_C)).toBe(false);
    });

    test("the same rows govern again as soon as one is re-enabled", async () => {
      /*
       * The pair for the all-disabled denial: identical rows, one flag
       * flipped. A blanket `false` would pass the test above and fail here.
       */
      stubAttachments([
        { projectId: PROJECT_A, isEnabled: true },
        { projectId: PROJECT_B, isEnabled: false },
      ]);

      expect(await suite.govern(PROVIDER_ID, PROJECT_A)).toBe(true);
    });

    test("a DISABLED row for our project does not borrow another project's enabled row", async () => {
      stubAttachments([
        { projectId: PROJECT_A, isEnabled: false },
        { projectId: PROJECT_B, isEnabled: true },
      ]);

      expect(await suite.govern(PROVIDER_ID, PROJECT_A)).toBe(false);
      expect(await suite.govern(PROVIDER_ID, PROJECT_B)).toBe(true);
    });

    test.each([
      ["undefined", undefined],
      ["null", null],
    ])(
      "isEnabled %s on the row fails CLOSED, and true on the same row opens it",
      async (_label: string, missingValue: unknown) => {
        stubAttachments([{ projectId: PROJECT_A, isEnabled: missingValue }]);

        expect(await suite.govern(PROVIDER_ID, PROJECT_A)).toBe(false);

        jest.restoreAllMocks();
        clearGlobalSsoAuthorizationCaches();

        stubAttachments([{ projectId: PROJECT_A, isEnabled: true }]);

        expect(await suite.govern(PROVIDER_ID, PROJECT_A)).toBe(true);
      },
    );

    test("a row with no projectId is ignored, not treated as a wildcard", async () => {
      /*
       * `projectId` is NOT NULL in the schema, but the enforcement path must
       * not crash on - or be widened by - a row that arrives without one.
       */
      stubAttachments([
        { projectId: undefined, isEnabled: true },
        { projectId: PROJECT_A, isEnabled: true },
      ]);

      expect(await suite.govern(PROVIDER_ID, PROJECT_A)).toBe(true);
      expect(await suite.govern(PROVIDER_ID, PROJECT_C)).toBe(false);
    });

    test("a projectId-less row still counts as 'this provider has attachments'", async () => {
      /*
       * On its own such a row governs nothing, but it must not fall back to
       * the instance-wide reading either - that would be the widening bug
       * arriving through a different door.
       */
      stubAttachments([{ projectId: undefined, isEnabled: true }]);

      expect(await suite.govern(PROVIDER_ID, PROJECT_A)).toBe(false);
    });

    test("the query does NOT filter on isEnabled, but the SELECT asks for it", async () => {
      /*
       * Filtering in SQL would make "no rows" ambiguous: a provider with two
       * disabled attachments would come back empty and be read as
       * instance-wide. All rows are fetched and the enabled ones picked out in
       * memory precisely so the two cases stay distinguishable.
       */
      const spy: jest.SpyInstance = stubAttachments([
        { projectId: PROJECT_A, isEnabled: false },
      ]);

      await suite.govern(PROVIDER_ID, PROJECT_A);

      const args: DatabaseCallArgs = callArgs(spy, 0);

      expect(args.query).not.toHaveProperty("isEnabled");
      expect(args.select["isEnabled"]).toBe(true);
      expect(args.select["projectId"]).toBe(true);
      expect(String(args.query[suite.foreignKey])).toBe(PROVIDER_ID.toString());
      expect(args.props["isRoot"]).toBe(true);
      expect(args.skip).toBe(0);
      expect(typeof args.limit).toBe("number");
    });

    test("ONE query serves several projects - the attachment SET is what is cached", async () => {
      const spy: jest.SpyInstance = stubAttachments([
        { projectId: PROJECT_A, isEnabled: true },
      ]);

      expect(await suite.govern(PROVIDER_ID, PROJECT_A)).toBe(true);
      expect(await suite.govern(PROVIDER_ID, PROJECT_C)).toBe(false);
      expect(await suite.govern(PROVIDER_ID, PROJECT_B)).toBe(false);
      expect(await suite.govern(PROVIDER_ID, PROJECT_A)).toBe(true);

      // One round trip answered both a granted and a denied question.
      expect(spy).toHaveBeenCalledTimes(1);
    });

    test("an EMPTY attachment set is cached too", async () => {
      const spy: jest.SpyInstance = stubAttachments([]);

      expect(await suite.govern(PROVIDER_ID, PROJECT_A)).toBe(true);
      expect(await suite.govern(PROVIDER_ID, PROJECT_B)).toBe(true);

      expect(spy).toHaveBeenCalledTimes(1);
    });

    test("concurrent misses for one provider share a single query", async () => {
      const spy: jest.SpyInstance = stubAttachments([
        { projectId: PROJECT_A, isEnabled: true },
      ]);

      const answers: Array<boolean> = await Promise.all([
        suite.govern(PROVIDER_ID, PROJECT_A),
        suite.govern(PROVIDER_ID, PROJECT_B),
        suite.govern(PROVIDER_ID, PROJECT_C),
        suite.govern(PROVIDER_ID, PROJECT_A),
      ]);

      expect(answers).toEqual([true, false, false, true]);
      expect(spy).toHaveBeenCalledTimes(1);
    });

    test("the cached attachment set expires after the TTL", async () => {
      const nowSpy: jest.SpyInstance = jest.spyOn(Date, "now");
      let clock: number = 1_700_000_000_000;
      nowSpy.mockImplementation((): number => {
        return clock;
      });

      const spy: jest.SpyInstance = spyOnQuery(suite.service, "findBy");
      spy.mockResolvedValue(
        suite.buildRows([{ projectId: PROJECT_A, isEnabled: true }]),
      );

      expect(await suite.govern(PROVIDER_ID, PROJECT_A)).toBe(true);

      spy.mockResolvedValue(
        suite.buildRows([{ projectId: PROJECT_A, isEnabled: false }]),
      );

      clock += GLOBAL_SSO_AUTHORIZATION_CACHE_TTL_MS - 1;
      expect(await suite.govern(PROVIDER_ID, PROJECT_A)).toBe(true);
      expect(spy).toHaveBeenCalledTimes(1);

      clock += 2;
      expect(await suite.govern(PROVIDER_ID, PROJECT_A)).toBe(false);
      expect(spy).toHaveBeenCalledTimes(2);
    });
  },
);

describe("doesProviderGovernProject - the SSO and OIDC caches are separate namespaces", () => {
  test("one id governs different project sets under each provider type", async () => {
    const ssoSpy: jest.SpyInstance = spyOnQuery(
      GlobalSsoProjectService,
      "findBy",
    );
    const ssoRow: GlobalSsoProject = new GlobalSsoProject();
    ssoRow.globalSsoId = SHARED_PROVIDER_ID;
    ssoSpy.mockResolvedValue([
      setRawColumns(ssoRow, { projectId: PROJECT_A, isEnabled: true }),
    ]);

    const oidcSpy: jest.SpyInstance = spyOnQuery(
      GlobalOidcProjectService,
      "findBy",
    );
    const oidcRow: GlobalOidcProject = new GlobalOidcProject();
    oidcRow.globalOidcId = SHARED_PROVIDER_ID;
    oidcSpy.mockResolvedValue([
      setRawColumns(oidcRow, { projectId: PROJECT_B, isEnabled: true }),
    ]);

    const ssoGovernsA: boolean =
      await GlobalSsoProjectService.doesProviderGovernProject({
        globalSsoId: SHARED_PROVIDER_ID,
        projectId: PROJECT_A,
      });
    const ssoGovernsB: boolean =
      await GlobalSsoProjectService.doesProviderGovernProject({
        globalSsoId: SHARED_PROVIDER_ID,
        projectId: PROJECT_B,
      });
    const oidcGovernsA: boolean =
      await GlobalOidcProjectService.doesProviderGovernProject({
        globalOidcId: SHARED_PROVIDER_ID,
        projectId: PROJECT_A,
      });
    const oidcGovernsB: boolean =
      await GlobalOidcProjectService.doesProviderGovernProject({
        globalOidcId: SHARED_PROVIDER_ID,
        projectId: PROJECT_B,
      });

    expect(ssoGovernsA).toBe(true);
    expect(ssoGovernsB).toBe(false);
    expect(oidcGovernsA).toBe(false);
    expect(oidcGovernsB).toBe(true);

    expect(ssoSpy).toHaveBeenCalledTimes(1);
    expect(oidcSpy).toHaveBeenCalledTimes(1);
  });
});

/*
 * -------------------------------------------------------------------------
 * Cache invalidation on write
 * ----------------------------------------------------------------------
 */

interface CacheProbes {
  ssoTrust: jest.SpyInstance;
  oidcTrust: jest.SpyInstance;
  ssoAttachments: jest.SpyInstance;
  oidcAttachments: jest.SpyInstance;
}

function installProbes(): CacheProbes {
  /*
   * An announcement a hook sends applies on this server too, and drops these
   * caches again (GlobalConfigService.forgetSignInRules). Which writes send
   * one is pinned below; here only the hooks' own clears count.
   */
  jest
    .spyOn(RealtimeAccessChanges, "announce")
    .mockImplementation((): void => {});

  stubSignInWayChecks();

  const ssoTrust: jest.SpyInstance = spyOnQuery(GlobalSsoService, "findOneBy");
  const ssoRow: GlobalSso = new GlobalSso();
  ssoRow.id = PROVIDER_ID;
  ssoTrust.mockResolvedValue(
    setRawColumns(ssoRow, {
      isEnabled: true,
      restrictToAttachedProjects: true,
    }),
  );

  const oidcTrust: jest.SpyInstance = spyOnQuery(
    GlobalOidcService,
    "findOneBy",
  );
  const oidcRow: GlobalOidc = new GlobalOidc();
  oidcRow.id = PROVIDER_ID;
  oidcTrust.mockResolvedValue(
    setRawColumns(oidcRow, {
      isEnabled: true,
      restrictToAttachedProjects: true,
    }),
  );

  const ssoAttachments: jest.SpyInstance = spyOnQuery(
    GlobalSsoProjectService,
    "findBy",
  );
  const ssoAttachmentRow: GlobalSsoProject = new GlobalSsoProject();
  ssoAttachmentRow.globalSsoId = PROVIDER_ID;
  ssoAttachments.mockResolvedValue([
    setRawColumns(ssoAttachmentRow, {
      projectId: PROJECT_A,
      isEnabled: true,
    }),
  ]);

  const oidcAttachments: jest.SpyInstance = spyOnQuery(
    GlobalOidcProjectService,
    "findBy",
  );
  const oidcAttachmentRow: GlobalOidcProject = new GlobalOidcProject();
  oidcAttachmentRow.globalOidcId = PROVIDER_ID;
  oidcAttachments.mockResolvedValue([
    setRawColumns(oidcAttachmentRow, {
      projectId: PROJECT_A,
      isEnabled: true,
    }),
  ]);

  return {
    ssoTrust: ssoTrust,
    oidcTrust: oidcTrust,
    ssoAttachments: ssoAttachments,
    oidcAttachments: oidcAttachments,
  };
}

// Asks all four cached questions, so one hook call can be checked against all.
async function askEverything(): Promise<void> {
  await GlobalSsoService.getProviderTrust(PROVIDER_ID);
  await GlobalOidcService.getProviderTrust(PROVIDER_ID);
  await GlobalSsoProjectService.doesProviderGovernProject({
    globalSsoId: PROVIDER_ID,
    projectId: PROJECT_A,
  });
  await GlobalOidcProjectService.doesProviderGovernProject({
    globalOidcId: PROVIDER_ID,
    projectId: PROJECT_A,
  });
}

/*
 * The attachment-set reads doesProviderGovernProject makes (they ask for
 * `projectId`), not the attachment write hooks' own reads of which
 * providers the rows they wrote name.
 */
function attachmentSetQueries(spy: jest.SpyInstance): number {
  return (spy.mock.calls as Array<Array<unknown>>).filter(
    (call: Array<unknown>): boolean => {
      return Boolean((call[0] as DatabaseCallArgs).select["projectId"]);
    },
  ).length;
}

function expectQueryCounts(probes: CacheProbes, expected: number): void {
  expect(probes.ssoTrust).toHaveBeenCalledTimes(expected);
  expect(probes.oidcTrust).toHaveBeenCalledTimes(expected);
  expect(attachmentSetQueries(probes.ssoAttachments)).toBe(expected);
  expect(attachmentSetQueries(probes.oidcAttachments)).toBe(expected);
}

interface HookCase {
  hookName: string;
  buildArgs: () => Array<unknown>;
}

interface HookSuite {
  name: string;
  service: any;
  hookCases: Array<HookCase>;
  /*
   * What onBeforeDelete carries to onDeleteSuccess: nothing for a provider,
   * the providers of the attachments it removes (read while they are there).
   */
  deleteCarryForward: unknown;
}

function buildProviderHookCases(buildRow: () => unknown): Array<HookCase> {
  const createBy: () => Record<string, unknown> = (): Record<
    string,
    unknown
  > => {
    return { data: buildRow(), props: { isRoot: true } };
  };

  const updateBy: () => Record<string, unknown> = (): Record<
    string,
    unknown
  > => {
    return {
      query: { _id: PROVIDER_ID.toString() },
      data: { isEnabled: false },
      props: { isRoot: true },
    };
  };

  const deleteBy: () => Record<string, unknown> = (): Record<
    string,
    unknown
  > => {
    return { query: { _id: PROVIDER_ID.toString() }, props: { isRoot: true } };
  };

  return [
    {
      hookName: "onBeforeCreate",
      buildArgs: (): Array<unknown> => {
        return [createBy()];
      },
    },
    {
      hookName: "onCreateSuccess",
      buildArgs: (): Array<unknown> => {
        return [{ createBy: createBy(), carryForward: null }, buildRow()];
      },
    },
    {
      hookName: "onBeforeUpdate",
      buildArgs: (): Array<unknown> => {
        return [updateBy()];
      },
    },
    {
      hookName: "onUpdateSuccess",
      buildArgs: (): Array<unknown> => {
        return [{ updateBy: updateBy(), carryForward: null }, [PROVIDER_ID]];
      },
    },
    {
      hookName: "onBeforeDelete",
      buildArgs: (): Array<unknown> => {
        return [deleteBy()];
      },
    },
    {
      hookName: "onDeleteSuccess",
      buildArgs: (): Array<unknown> => {
        return [{ deleteBy: deleteBy(), carryForward: null }, [PROVIDER_ID]];
      },
    },
  ];
}

function buildAttachmentHookCases(
  foreignKey: string,
  buildRow: () => unknown,
): Array<HookCase> {
  const createBy: () => Record<string, unknown> = (): Record<
    string,
    unknown
  > => {
    // No `teams`, so the create hook's team validation is a no-op here.
    return { data: buildRow(), props: { isRoot: true } };
  };

  const updateBy: () => Record<string, unknown> = (): Record<
    string,
    unknown
  > => {
    return {
      query: { [foreignKey]: PROVIDER_ID },
      data: { isEnabled: false },
      props: { isRoot: true },
    };
  };

  const deleteBy: () => Record<string, unknown> = (): Record<
    string,
    unknown
  > => {
    return { query: { [foreignKey]: PROVIDER_ID }, props: { isRoot: true } };
  };

  return [
    {
      hookName: "onBeforeCreate",
      buildArgs: (): Array<unknown> => {
        return [createBy()];
      },
    },
    {
      hookName: "onCreateSuccess",
      buildArgs: (): Array<unknown> => {
        return [{ createBy: createBy(), carryForward: null }, buildRow()];
      },
    },
    {
      hookName: "onBeforeUpdate",
      buildArgs: (): Array<unknown> => {
        return [updateBy()];
      },
    },
    {
      hookName: "onUpdateSuccess",
      buildArgs: (): Array<unknown> => {
        return [{ updateBy: updateBy(), carryForward: null }, [PROVIDER_ID]];
      },
    },
    {
      hookName: "onBeforeDelete",
      buildArgs: (): Array<unknown> => {
        return [deleteBy()];
      },
    },
    {
      hookName: "onDeleteSuccess",
      buildArgs: (): Array<unknown> => {
        return [{ deleteBy: deleteBy(), carryForward: null }, [PROVIDER_ID]];
      },
    },
  ];
}

const HOOK_SUITES: Array<HookSuite> = [
  {
    name: "GlobalSsoService",
    service: GlobalSsoService,
    hookCases: buildProviderHookCases((): unknown => {
      const row: GlobalSso = new GlobalSso();
      row.id = PROVIDER_ID;
      return row;
    }),
    deleteCarryForward: null,
  },
  {
    name: "GlobalOidcService",
    service: GlobalOidcService,
    hookCases: buildProviderHookCases((): unknown => {
      const row: GlobalOidc = new GlobalOidc();
      row.id = PROVIDER_ID;
      return row;
    }),
    deleteCarryForward: null,
  },
  {
    name: "GlobalSsoProjectService",
    service: GlobalSsoProjectService,
    hookCases: buildAttachmentHookCases("globalSsoId", (): unknown => {
      const row: GlobalSsoProject = new GlobalSsoProject();
      row.globalSsoId = PROVIDER_ID;
      row.projectId = PROJECT_A;
      return row;
    }),
    deleteCarryForward: [PROVIDER_ID],
  },
  {
    name: "GlobalOidcProjectService",
    service: GlobalOidcProjectService,
    hookCases: buildAttachmentHookCases("globalOidcId", (): unknown => {
      const row: GlobalOidcProject = new GlobalOidcProject();
      row.globalOidcId = PROVIDER_ID;
      row.projectId = PROJECT_A;
      return row;
    }),
    deleteCarryForward: [PROVIDER_ID],
  },
];

describe("cache invalidation - the control case", () => {
  test("with no write at all, the cached answers keep serving", async () => {
    /*
     * The counterpart to every invalidation test below. Without it, an
     * implementation that simply never cached would pass the whole
     * invalidation suite.
     */
    const probes: CacheProbes = installProbes();

    await askEverything();
    await askEverything();
    await askEverything();

    expectQueryCounts(probes, 1);
  });
});

describe.each(HOOK_SUITES)(
  "$name write hooks drop the authorization caches",
  (suite: HookSuite): void => {
    test.each(suite.hookCases)(
      "$hookName re-arms every cached answer",
      async (hookCase: HookCase) => {
        const probes: CacheProbes = installProbes();

        await askEverything();
        await askEverything();
        expectQueryCounts(probes, 1);

        await callHook(suite.service, hookCase.hookName, hookCase.buildArgs());

        await askEverything();
        expectQueryCounts(probes, 2);
      },
    );

    test("the SUCCESS hooks clear independently of the before-hooks", async () => {
      /*
       * Why both matter. The before-hook clear happens while the row still
       * holds its OLD value, so a concurrent request on the same node can
       * re-fill the cache with the pre-change answer between the clear and the
       * commit - handing a provider that was just disabled another full TTL of
       * life. The success hook is what closes that window, so it is checked on
       * its own here rather than only as one entry in the list above.
       */
      const successHooks: Array<HookCase> = suite.hookCases.filter(
        (hookCase: HookCase): boolean => {
          return hookCase.hookName.endsWith("Success");
        },
      );

      expect(successHooks.length).toBe(3);

      for (const hookCase of successHooks) {
        const probes: CacheProbes = installProbes();

        await askEverything();
        await askEverything();
        expectQueryCounts(probes, 1);

        // Simulates the concurrent re-fill: the cache is warm at commit time.
        await callHook(suite.service, hookCase.hookName, hookCase.buildArgs());

        await askEverything();
        expectQueryCounts(probes, 2);

        jest.restoreAllMocks();
        clearGlobalSsoAuthorizationCaches();
      }
    });

    test("the before-hooks pass their payload straight through", async () => {
      installProbes();

      const updateCase: HookCase | undefined = suite.hookCases.find(
        (hookCase: HookCase): boolean => {
          return hookCase.hookName === "onBeforeUpdate";
        },
      );
      const deleteCase: HookCase | undefined = suite.hookCases.find(
        (hookCase: HookCase): boolean => {
          return hookCase.hookName === "onBeforeDelete";
        },
      );

      expect(updateCase).toBeDefined();
      expect(deleteCase).toBeDefined();

      const updateArgs: Array<unknown> = (updateCase as HookCase).buildArgs();
      const deleteArgs: Array<unknown> = (deleteCase as HookCase).buildArgs();

      const onUpdate: Record<string, unknown> = (await callHook(
        suite.service,
        "onBeforeUpdate",
        updateArgs,
      )) as Record<string, unknown>;
      const onDelete: Record<string, unknown> = (await callHook(
        suite.service,
        "onBeforeDelete",
        deleteArgs,
      )) as Record<string, unknown>;

      expect(onUpdate["updateBy"]).toBe(updateArgs[0]);
      expect(onUpdate["carryForward"]).toBeNull();
      expect(onDelete["deleteBy"]).toBe(deleteArgs[0]);
      expect(onDelete["carryForward"]).toEqual(suite.deleteCarryForward);
    });
  },
);

/*
 * -------------------------------------------------------------------------
 * Telling every server
 * ----------------------------------------------------------------------
 *
 * A write that changes where a global provider signs people in - turning it
 * off or on, deleting it, restricting it to its attached projects or lifting
 * that, or adding, turning off or on or removing an attachment of one that
 * is restricted to its attached projects - is announced to every server
 * (RealtimeAccessChanges, SignInRulesChanged for the whole instance): each
 * forgets what it knew of the global providers and asks the live updates it
 * holds again, as their joins were. Whether an update changed it is
 * GlobalSsoProviderChanges.afterWrite's answer, worked out before the write
 * (pinned in GlobalSsoProviderChanges.test.ts): here it is given. A write
 * that changes nothing about who it signs in - a new certificate, a new
 * name, a switch written back as it was - is not announced.
 */

interface AnnouncementCase {
  label: string;
  service: any;
  hookName: string;
  args: () => Array<unknown>;
  // afterWrite's answer: the update changed where the provider signs people in.
  changedReach?: boolean;
  announces: boolean;
}

function updateSuccess(
  data: Record<string, unknown>,
  updatedIds?: Array<ObjectID>,
): () => Array<unknown> {
  return (): Array<unknown> => {
    return [
      {
        updateBy: {
          query: { _id: PROVIDER_ID.toString() },
          data: data,
          props: { isRoot: true },
        },
        carryForward: null,
      },
      updatedIds || [PROVIDER_ID],
    ];
  };
}

function deleteSuccess(deletedIds: Array<ObjectID>): () => Array<unknown> {
  return (): Array<unknown> => {
    return [
      {
        deleteBy: { query: { _id: PROVIDER_ID.toString() }, props: {} },
        carryForward: null,
      },
      deletedIds,
    ];
  };
}

function createSuccess(buildRow: () => unknown): () => Array<unknown> {
  return (): Array<unknown> => {
    return [
      { createBy: { data: buildRow(), props: {} }, carryForward: null },
      buildRow(),
    ];
  };
}

function providerAnnouncementCases(
  name: string,
  service: any,
  buildRow: () => unknown,
  credential: Record<string, unknown>,
): Array<AnnouncementCase> {
  return [
    {
      label: `${name}: turned off`,
      service,
      hookName: "onUpdateSuccess",
      args: updateSuccess({ isEnabled: false }),
      changedReach: true,
      announces: true,
    },
    {
      label: `${name}: restricted to its attached projects`,
      service,
      hookName: "onUpdateSuccess",
      args: updateSuccess({ restrictToAttachedProjects: true }),
      changedReach: true,
      announces: true,
    },
    {
      label: `${name}: deleted`,
      service,
      hookName: "onDeleteSuccess",
      args: deleteSuccess([PROVIDER_ID]),
      announces: true,
    },
    {
      label: `${name}: a new certificate or secret and a new name`,
      service,
      hookName: "onUpdateSuccess",
      args: updateSuccess({ ...credential, name: "Renamed" }),
      announces: false,
    },
    {
      label: `${name}: turned on, or opened to every project - told once, so no server keeps refusing the people it now signs in`,
      service,
      hookName: "onUpdateSuccess",
      args: updateSuccess({
        isEnabled: true,
        restrictToAttachedProjects: false,
      }),
      changedReach: true,
      announces: true,
    },
    {
      label: `${name}: turned on alone`,
      service,
      hookName: "onUpdateSuccess",
      args: updateSuccess({ isEnabled: true }),
      changedReach: true,
      announces: true,
    },
    {
      label: `${name}: opened to every project alone`,
      service,
      hookName: "onUpdateSuccess",
      args: updateSuccess({ restrictToAttachedProjects: false }),
      changedReach: true,
      announces: true,
    },
    {
      label: `${name}: saved on again while on, as an edit form sends every switch it shows - nobody is told`,
      service,
      hookName: "onUpdateSuccess",
      args: updateSuccess({ isEnabled: true, name: "Renamed" }),
      changedReach: false,
      announces: false,
    },
    {
      label: `${name}: turned on by an update that wrote no row`,
      service,
      hookName: "onUpdateSuccess",
      args: updateSuccess({ isEnabled: true }, []),
      changedReach: true,
      announces: false,
    },
    {
      label: `${name}: an update that wrote no row`,
      service,
      hookName: "onUpdateSuccess",
      args: updateSuccess({ isEnabled: false }, []),
      changedReach: true,
      announces: false,
    },
    {
      label: `${name}: a delete that deleted no row`,
      service,
      hookName: "onDeleteSuccess",
      args: deleteSuccess([]),
      announces: false,
    },
    {
      label: `${name}: created`,
      service,
      hookName: "onCreateSuccess",
      args: createSuccess(buildRow),
      announces: false,
    },
  ];
}

const ANNOUNCEMENT_CASES: Array<AnnouncementCase> = [
  ...providerAnnouncementCases(
    "GlobalSsoService",
    GlobalSsoService,
    (): unknown => {
      const row: GlobalSso = new GlobalSso();
      row.id = PROVIDER_ID;
      return row;
    },
    { publicCertificate: "a rotated certificate" },
  ),
  ...providerAnnouncementCases(
    "GlobalOidcService",
    GlobalOidcService,
    (): unknown => {
      const row: GlobalOidc = new GlobalOidc();
      row.id = PROVIDER_ID;
      return row;
    },
    { clientSecret: "a rotated client secret" },
  ),
];

describe("write hooks that change who a global provider signs in tell every server", () => {
  let announced: Array<RealtimeAccessChange>;

  beforeEach(() => {
    announced = [];
    jest
      .spyOn(RealtimeAccessChanges, "announce")
      .mockImplementation((change: RealtimeAccessChange): void => {
        announced.push(change);
      });
    stubSignInWayChecks();
  });

  test.each(ANNOUNCEMENT_CASES)(
    "$label",
    async (announcementCase: AnnouncementCase) => {
      jest
        .spyOn(GlobalSsoProviderChanges, "afterWrite")
        .mockResolvedValue(announcementCase.changedReach === true);

      await callHook(
        announcementCase.service,
        announcementCase.hookName,
        announcementCase.args(),
      );

      expect(announced).toEqual(
        announcementCase.announces
          ? [{ kind: RealtimeAccessChangeKind.SignInRulesChanged }]
          : [],
      );
    },
  );

  test("a server that hears it forgets what it knew of the global providers", async () => {
    const trust: jest.SpyInstance = spyOnQuery(GlobalSsoService, "findOneBy");
    const row: GlobalSso = new GlobalSso();
    row.id = PROVIDER_ID;
    trust.mockResolvedValue(
      setRawColumns(row, {
        isEnabled: true,
        restrictToAttachedProjects: false,
      }),
    );

    await GlobalSsoService.getProviderTrust(PROVIDER_ID);
    await GlobalSsoService.getProviderTrust(PROVIDER_ID);
    expect(trust).toHaveBeenCalledTimes(1);

    // What RealtimeAccessChanges runs on each server for an instance-wide change.
    GlobalConfigService.forgetSignInRules();

    await GlobalSsoService.getProviderTrust(PROVIDER_ID);
    expect(trust).toHaveBeenCalledTimes(2);
  });
});

/*
 * An attachment only decides who a provider signs in when the provider is
 * on and restricted to its attached projects; for any other it says where
 * people are provisioned, and adding, turning off or removing one changes
 * nobody's access. So the attachment hooks ask the provider before telling
 * every server - and a provider they cannot name or read counts as
 * restricted, so a failed read never keeps a change quiet.
 */
interface AttachmentAnnouncementSuite {
  name: string;
  service: any;
  providerService: any;
  idColumn: string;
  relation: string;
  buildRow: (providerId: ObjectID | null) => unknown;
}

const ATTACHMENT_ANNOUNCEMENT_SUITES: Array<AttachmentAnnouncementSuite> = [
  {
    name: "GlobalSsoProjectService",
    service: GlobalSsoProjectService,
    providerService: GlobalSsoService,
    idColumn: "globalSsoId",
    relation: "globalSso",
    buildRow: (providerId: ObjectID | null): unknown => {
      const row: GlobalSsoProject = new GlobalSsoProject();
      if (providerId) {
        row.globalSsoId = providerId;
      }
      row.projectId = PROJECT_A;
      return row;
    },
  },
  {
    name: "GlobalOidcProjectService",
    service: GlobalOidcProjectService,
    providerService: GlobalOidcService,
    idColumn: "globalOidcId",
    relation: "globalOidc",
    buildRow: (providerId: ObjectID | null): unknown => {
      const row: GlobalOidcProject = new GlobalOidcProject();
      if (providerId) {
        row.globalOidcId = providerId;
      }
      row.projectId = PROJECT_A;
      return row;
    },
  },
];

const RESTRICTED: GlobalProviderTrust = {
  isUsable: true,
  restrictToAttachedProjects: true,
  signInsEndedAtMs: null,
};
const EVERY_PROJECT: GlobalProviderTrust = {
  isUsable: true,
  restrictToAttachedProjects: false,
  signInsEndedAtMs: null,
};
const OFF_AND_RESTRICTED: GlobalProviderTrust = {
  isUsable: false,
  restrictToAttachedProjects: true,
  signInsEndedAtMs: null,
};

describe.each(ATTACHMENT_ANNOUNCEMENT_SUITES)(
  "$name tells every server only when an attachment decides who its provider signs in",
  (suite: AttachmentAnnouncementSuite): void => {
    let announced: Array<RealtimeAccessChange>;
    let trustByProvider: Map<string, GlobalProviderTrust | Error>;
    let trust: jest.SpyInstance;

    beforeEach(() => {
      announced = [];
      trustByProvider = new Map();

      jest
        .spyOn(RealtimeAccessChanges, "announce")
        .mockImplementation((change: RealtimeAccessChange): void => {
          announced.push(change);
        });
      stubSignInWayChecks();

      trust = spyOnQuery(suite.providerService, "getProviderTrust");
      trust.mockImplementation(
        async (providerId: ObjectID): Promise<GlobalProviderTrust> => {
          const answer: GlobalProviderTrust | Error | undefined =
            trustByProvider.get(providerId.toString());

          if (answer instanceof Error) {
            throw answer;
          }

          if (!answer) {
            throw new Error("No trust stubbed for this provider");
          }

          return answer;
        },
      );
    });

    // The rows the hooks read back: one attachment per provider id given.
    function stubAttachmentRows(
      providerIds: Array<ObjectID>,
    ): jest.SpyInstance {
      const spy: jest.SpyInstance = spyOnQuery(suite.service, "findBy");
      spy.mockResolvedValue(
        providerIds.map((providerId: ObjectID): unknown => {
          return suite.buildRow(providerId);
        }),
      );
      return spy;
    }

    async function created(row: unknown): Promise<void> {
      await callHook(suite.service, "onCreateSuccess", [
        { createBy: { data: row, props: {} }, carryForward: null },
        row,
      ]);
    }

    async function updated(
      data: Record<string, unknown>,
      updatedIds: Array<ObjectID>,
    ): Promise<void> {
      await callHook(suite.service, "onUpdateSuccess", [
        {
          updateBy: {
            query: { _id: PROVIDER_ID.toString() },
            data: data,
            props: { isRoot: true },
          },
          carryForward: null,
        },
        updatedIds,
      ]);
    }

    // onBeforeDelete then onDeleteSuccess, as DatabaseService runs them.
    async function deleted(deletedIds: Array<ObjectID>): Promise<void> {
      const deleteBy: Record<string, unknown> = {
        query: { projectId: PROJECT_A.toString() },
        props: { isRoot: true },
      };

      const onDelete: unknown = await callHook(
        suite.service,
        "onBeforeDelete",
        [deleteBy],
      );

      await callHook(suite.service, "onDeleteSuccess", [onDelete, deletedIds]);
    }

    function expectAnnounced(announces: boolean): void {
      expect(announced).toEqual(
        announces
          ? [{ kind: RealtimeAccessChangeKind.SignInRulesChanged }]
          : [],
      );
    }

    test("an attachment added to a provider restricted to its attached projects is told", async () => {
      trustByProvider.set(PROVIDER_ID.toString(), RESTRICTED);

      await created(suite.buildRow(PROVIDER_ID));

      expectAnnounced(true);
      expect(trust).toHaveBeenCalledTimes(1);
      expect((trust.mock.calls[0] as Array<ObjectID>)[0]!.toString()).toBe(
        PROVIDER_ID.toString(),
      );
    });

    test("an attachment added to a provider that signs people in to every project is not", async () => {
      trustByProvider.set(PROVIDER_ID.toString(), EVERY_PROJECT);

      await created(suite.buildRow(PROVIDER_ID));

      expectAnnounced(false);
    });

    test("an attachment added to a provider that is off is not: its sign-ins already stopped", async () => {
      trustByProvider.set(PROVIDER_ID.toString(), OFF_AND_RESTRICTED);

      await created(suite.buildRow(PROVIDER_ID));

      expectAnnounced(false);
    });

    test("an attachment that names its provider by the relation is read the same", async () => {
      trustByProvider.set(PROVIDER_ID.toString(), RESTRICTED);
      const row: Record<string, unknown> = suite.buildRow(null) as Record<
        string,
        unknown
      >;
      row[suite.relation] = { _id: PROVIDER_ID.toString() };

      await created(row);

      expectAnnounced(true);
      expect((trust.mock.calls[0] as Array<ObjectID>)[0]!.toString()).toBe(
        PROVIDER_ID.toString(),
      );
    });

    test("an attachment whose provider cannot be named is told", async () => {
      await created(suite.buildRow(null));

      expectAnnounced(true);
      expect(trust).not.toHaveBeenCalled();
    });

    test("a provider that cannot be read counts as restricted", async () => {
      trustByProvider.set(
        PROVIDER_ID.toString(),
        new Error("The database is not answering"),
      );

      await created(suite.buildRow(PROVIDER_ID));

      expectAnnounced(true);
    });

    test.each([
      ["turned off", false],
      ["turned on: no server keeps refusing the people it now signs in", true],
    ])(
      "an attachment %s is told when that changed where its provider signs people in, and nothing more is read once it is written",
      async (_label: string, isEnabled: boolean) => {
        jest
          .spyOn(GlobalSsoProviderChanges, "afterWrite")
          .mockResolvedValue(true);
        const rows: jest.SpyInstance = stubAttachmentRows([PROVIDER_ID]);

        await updated({ isEnabled: isEnabled }, [ObjectID.generate()]);

        expectAnnounced(true);
        expect(rows).not.toHaveBeenCalled();
        expect(trust).not.toHaveBeenCalled();
      },
    );

    test.each([
      ["turned off", false],
      ["turned on", true],
    ])(
      "an attachment %s is not told when that changed nothing - a provider that signs people in to every project, or a switch written back as it was",
      async (_label: string, isEnabled: boolean) => {
        jest
          .spyOn(GlobalSsoProviderChanges, "afterWrite")
          .mockResolvedValue(false);

        await updated({ isEnabled: isEnabled }, [ObjectID.generate()]);

        expectAnnounced(false);
      },
    );

    test("an attachment turned on by an update that wrote no row is not told, and nothing is read for it", async () => {
      const rows: jest.SpyInstance = stubAttachmentRows([PROVIDER_ID]);

      await updated({ isEnabled: true }, []);

      expectAnnounced(false);
      expect(rows).not.toHaveBeenCalled();
      expect(trust).not.toHaveBeenCalled();
    });

    test("changing only an attachment's teams is not told, and nothing is read for it", async () => {
      const rows: jest.SpyInstance = stubAttachmentRows([PROVIDER_ID]);

      await updated({ teams: [] }, [ObjectID.generate()]);

      expectAnnounced(false);
      expect(rows).not.toHaveBeenCalled();
      expect(trust).not.toHaveBeenCalled();
    });

    test("an attachment removed is told for a restricted provider, read before the rows are gone", async () => {
      trustByProvider.set(PROVIDER_ID.toString(), RESTRICTED);
      const rows: jest.SpyInstance = stubAttachmentRows([PROVIDER_ID]);

      await deleted([ObjectID.generate()]);

      expectAnnounced(true);
      expect(rows).toHaveBeenCalledTimes(1);
      expect(callArgs(rows, 0).query).toEqual({
        projectId: PROJECT_A.toString(),
      });
    });

    test("an attachment removed is not told for a provider that signs people in to every project", async () => {
      trustByProvider.set(PROVIDER_ID.toString(), EVERY_PROJECT);
      stubAttachmentRows([PROVIDER_ID]);

      await deleted([ObjectID.generate()]);

      expectAnnounced(false);
    });

    test("a remove whose rows cannot be read beforehand is told", async () => {
      const rows: jest.SpyInstance = spyOnQuery(suite.service, "findBy");
      rows.mockRejectedValue(new Error("The database is not answering"));

      await deleted([ObjectID.generate()]);

      expectAnnounced(true);
      expect(trust).not.toHaveBeenCalled();
    });

    test("a remove that removed no row is not told", async () => {
      trustByProvider.set(PROVIDER_ID.toString(), RESTRICTED);
      stubAttachmentRows([PROVIDER_ID]);

      await deleted([]);

      expectAnnounced(false);
    });

    test("several attachments of one provider ask it once; one restricted provider among several is enough", async () => {
      trustByProvider.set(PROVIDER_ID.toString(), EVERY_PROJECT);
      trustByProvider.set(OTHER_PROVIDER_ID.toString(), RESTRICTED);
      stubAttachmentRows([PROVIDER_ID, PROVIDER_ID, OTHER_PROVIDER_ID]);

      await deleted([ObjectID.generate()]);

      expectAnnounced(true);
      expect(trust).toHaveBeenCalledTimes(2);
    });
  },
);
