import UserMiddleware from "Common/Server/Middleware/UserAuthorization";
import AccessTokenService from "Common/Server/Services/AccessTokenService";
import GlobalConfigService from "Common/Server/Services/GlobalConfigService";
import ProjectService from "Common/Server/Services/ProjectService";
import Express, {
  ExpressApplication,
  ExpressRequest,
  ExpressRouter,
  OneUptimeRequest,
} from "Common/Server/Utils/Express";
import Dictionary from "Common/Types/Dictionary";
import SsoAuthorizationException from "Common/Types/Exception/SsoAuthorizationException";
import ObjectID from "Common/Types/ObjectID";
import { UserTenantAccessPermission } from "Common/Types/Permission";
import FakeEnterpriseModule, {
  createEditionStateCases,
  createLicenseSnapshotWithStatus,
  EditionStateCase,
  installFakeEnterpriseModule,
  uninstallEnterpriseModule,
} from "Common/Tests/Server/Enterprise/FakeEnterpriseModule";
import { setTestBillingEnabled } from "Common/Tests/Server/Enterprise/TestBillingFlag";
import { afterEach, beforeEach, describe, expect, it } from "@jest/globals";
import IdentityFeatureSet from "../../../FeatureSet/Identity/Index";
import {
  SSO_ROUTERS,
  SsoRouterEntry,
} from "../../../FeatureSet/Identity/SsoRouters";

/*
 * ---------------------------------------------------------------------------------------------
 * THE INVARIANT: SSO enforcement is on if and only if the SSO login routes are served - and
 * single sign-on is part of every edition, so both are on in EVERY state.
 *
 * Enforcing SSO without the login routes locks every user out (there is no way to satisfy the
 * requirement). Serving the login routes without enforcing SSO lets a password through where an
 * owner required SSO - including for people already removed at the identity provider.
 *
 * The core Identity feature set mounts its SSO routers (FeatureSet/Identity/SsoRouters.ts) in
 * every edition, and UserMiddleware enforces project and instance-wide "Require SSO" in every
 * edition: the Community Edition, every Enterprise license state (lapsed ones included) and the
 * Cloud. This suite drives the REAL mount code and the REAL enforcement code through every
 * edition, license and billing state and asserts both halves are on in each. That every mounted
 * SSO route also ANSWERS in every state is SsoRoutesServedInEveryEdition.test.ts.
 * ---------------------------------------------------------------------------------------------
 */

jest.mock("Common/Server/EnvironmentConfig", () => {
  const billingFlag: typeof import("Common/Tests/Server/Enterprise/TestBillingFlag") =
    jest.requireActual(
      "Common/Tests/Server/Enterprise/TestBillingFlag",
    ) as typeof import("Common/Tests/Server/Enterprise/TestBillingFlag");

  return billingFlag.withLiveBillingFlag(
    jest.requireActual("Common/Server/EnvironmentConfig") as Record<
      string,
      unknown
    >,
  );
});

// The other core identity routers are not what this suite is about.
jest.mock("../../../FeatureSet/Identity/API/Authentication", () => {
  return { __esModule: true, default: { coreRouter: "authentication" } };
});
jest.mock("../../../FeatureSet/Identity/API/Reseller", () => {
  return { __esModule: true, default: { coreRouter: "reseller" } };
});
jest.mock("../../../FeatureSet/Identity/API/StatusPageAuthentication", () => {
  return { __esModule: true, default: { coreRouter: "status-page" } };
});

type MountRecord = { paths: unknown; router: unknown };

const mounted: Array<MountRecord> = [];

// What the Enterprise Edition hands core for identity: its SCIM routers.
const EE_SCIM_ROUTER: { eeRouter: string } = { eeRouter: "scim" };

/*
 * The SAML/OIDC login routes customer identity providers and sign-in pages use: the
 * service-provider-initiated starts, the discovery the login pages call, and the callbacks.
 */
const SSO_LOGIN_ROUTES: Array<string> = [
  "/sso/:projectId/:projectSsoId",
  "/idp-login/:projectId/:projectSsoId",
  "/oidc/:projectId/:projectOidcId",
  "/oidc-callback/:projectId/:projectOidcId",
  "/service-provider-login",
  "/service-provider-login-oidc",
  "/global-sso/:globalSsoId",
  "/global-idp-login/:globalSsoId",
  "/global-oidc/:globalOidcId",
  "/global-oidc-callback/:globalOidcId",
];

const routePathsOf: (router: unknown) => Array<string> = (
  router: unknown,
): Array<string> => {
  const stack: Array<{ route?: { path?: string } }> = ((
    router as { stack?: Array<{ route?: { path?: string } }> }
  ).stack || []) as Array<{ route?: { path?: string } }>;

  return stack
    .map((layer: { route?: { path?: string } }) => {
      return layer.route?.path || "";
    })
    .filter((path: string) => {
      return Boolean(path);
    });
};

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const USER_ID: ObjectID = new ObjectID("22222222-2222-4222-8222-222222222222");
const TENANT_PERMISSION: UserTenantAccessPermission = {
  projectId: PROJECT_ID,
  permissions: [],
} as unknown as UserTenantAccessPermission;

const EDITION_STATES: Array<EditionStateCase> = createEditionStateCases();

// Applies the state, with the stand-in Enterprise identity router when ee is loaded.
const applyState: (state: EditionStateCase) => void = (
  state: EditionStateCase,
): void => {
  const fake: FakeEnterpriseModule | null = state.apply();

  if (fake) {
    fake.identityRouters = [EE_SCIM_ROUTER as unknown as ExpressRouter];
  }
};

// Mounts the Identity feature set and reports whether the SSO login routes are now mounted.
const areSsoLoginRoutesMounted: () => Promise<boolean> =
  async (): Promise<boolean> => {
    mounted.length = 0;

    await IdentityFeatureSet.init();

    const mountedPaths: Array<string> = mounted
      .filter((record: MountRecord): boolean => {
        return (
          JSON.stringify(record.paths) ===
          JSON.stringify(["/api/identity", "/"])
        );
      })
      .flatMap((record: MountRecord): Array<string> => {
        return routePathsOf(record.router);
      });

    return SSO_LOGIN_ROUTES.every((path: string): boolean => {
      return mountedPaths.includes(path);
    });
  };

const buildRequest: (data?: {
  isMasterAdmin?: boolean;
}) => ExpressRequest = (data?: { isMasterAdmin?: boolean }): ExpressRequest => {
  return {
    userAuthorization: { isMasterAdmin: data?.isMasterAdmin === true },
  } as unknown as OneUptimeRequest as ExpressRequest;
};

// Asks the real middleware whether the project refuses a password session.
const isProjectSsoEnforced: (data?: {
  isMasterAdmin?: boolean;
}) => Promise<boolean> = async (data?: {
  isMasterAdmin?: boolean;
}): Promise<boolean> => {
  try {
    await UserMiddleware.getUserTenantAccessPermissionWithTenantId({
      req: buildRequest(data),
      tenantId: PROJECT_ID,
      userId: USER_ID,
    });

    return false;
  } catch (err) {
    if (err instanceof SsoAuthorizationException) {
      return true;
    }

    throw err;
  }
};

/*
 * The same question on the multi-project path (project lists, fan-out queries): an enforced
 * project gets the default, permission-less entry instead of the user's real permissions.
 */
const isProjectSsoEnforcedInFanOut: (data?: {
  isMasterAdmin?: boolean;
}) => Promise<boolean> = async (data?: {
  isMasterAdmin?: boolean;
}): Promise<boolean> => {
  const permissions: Dictionary<UserTenantAccessPermission> | null =
    await UserMiddleware.getUserTenantAccessPermissionForMultiTenant(
      buildRequest(data),
      USER_ID,
      [PROJECT_ID],
    );

  return permissions?.[PROJECT_ID.toString()] !== TENANT_PERMISSION;
};

// Only the instance-wide "Require SSO for Login" is set.
const requireSsoInstanceWideOnly: () => void = (): void => {
  jest.spyOn(ProjectService, "getRequireSsoForLogin").mockResolvedValue(false);
  jest
    .spyOn(GlobalConfigService, "getRequireSsoForLogin")
    .mockResolvedValue(true);
};

describe("SSO enforcement and the SSO login routes: on together, in every state", () => {
  beforeEach(() => {
    mounted.length = 0;
    setTestBillingEnabled(false);
    uninstallEnterpriseModule();

    jest.spyOn(Express, "getExpressApp").mockReturnValue({
      use: (paths: unknown, router: unknown): void => {
        mounted.push({ paths, router });
      },
    } as unknown as ExpressApplication);

    // The project requires SSO, and the request carries no SSO token.
    jest.spyOn(ProjectService, "getRequireSsoForLogin").mockResolvedValue(true);
    jest
      .spyOn(ProjectService, "getRequireSsoWithSsoProviderId")
      .mockResolvedValue(null);
    jest
      .spyOn(GlobalConfigService, "getRequireSsoForLogin")
      .mockResolvedValue(false);
    jest
      .spyOn(AccessTokenService, "getUserTenantAccessPermission")
      .mockResolvedValue(TENANT_PERMISSION);
    jest
      .spyOn(UserMiddleware, "isSsoSatisfiedForProject")
      .mockResolvedValue(false);
  });

  afterEach(() => {
    uninstallEnterpriseModule();
    setTestBillingEnabled(false);
    jest.restoreAllMocks();
  });

  it("the states include the Community Edition, lapsed Enterprise licenses and the Cloud", () => {
    expect(
      EDITION_STATES.filter((state: EditionStateCase): boolean => {
        return !state.isLoaded;
      }).length,
    ).toBe(2);
    expect(
      EDITION_STATES.filter((state: EditionStateCase): boolean => {
        return state.isLoaded && !state.isActive;
      }).length,
    ).toBeGreaterThanOrEqual(4);
    expect(
      EDITION_STATES.some((state: EditionStateCase): boolean => {
        return state.billing;
      }),
    ).toBe(true);
  });

  for (const state of EDITION_STATES) {
    it(state.label, async () => {
      applyState(state);

      const mountedNow: boolean = await areSsoLoginRoutesMounted();
      const projectEnforced: boolean = await isProjectSsoEnforced();
      const projectEnforcedInFanOut: boolean =
        await isProjectSsoEnforcedInFanOut();

      requireSsoInstanceWideOnly();

      const globalEnforced: boolean = await isProjectSsoEnforced();
      const globalEnforcedInFanOut: boolean =
        await isProjectSsoEnforcedInFanOut();

      expect({
        mounted: mountedNow,
        projectEnforced,
        projectEnforcedInFanOut,
        globalEnforced,
        globalEnforcedInFanOut,
      }).toEqual({
        mounted: true,
        projectEnforced: true,
        projectEnforcedInFanOut: true,
        globalEnforced: true,
        globalEnforcedInFanOut: true,
      });
    });
  }

  it("a lapse and a renewal change neither half, and nothing is re-mounted", async () => {
    const fake: FakeEnterpriseModule = installFakeEnterpriseModule({
      snapshot: createLicenseSnapshotWithStatus("valid"),
      identityRouters: [EE_SCIM_ROUTER as unknown as ExpressRouter],
    });

    expect(await areSsoLoginRoutesMounted()).toBe(true);

    const mountedAtBoot: Array<MountRecord> = [...mounted];

    for (const status of ["expired", "missing", "invalid", "grace"] as const) {
      fake.setSnapshot(createLicenseSnapshotWithStatus(status));

      expect({ status, enforced: await isProjectSsoEnforced() }).toEqual({
        status,
        enforced: true,
      });
    }

    fake.setSnapshot(null);
    expect(await isProjectSsoEnforced()).toBe(true);

    // Mounted once, at boot: the license never adds or removes a route.
    expect(mounted).toEqual(mountedAtBoot);
  });

  it("the SSO routers are mounted at /api/identity and /, the places identity providers are configured with", async () => {
    await IdentityFeatureSet.init();

    for (const entry of SSO_ROUTERS) {
      const record: MountRecord | undefined = mounted.find(
        (candidate: MountRecord): boolean => {
          return candidate.router === entry.router;
        },
      );

      expect({ router: entry.name, paths: record?.paths }).toEqual({
        router: entry.name,
        paths: ["/api/identity", "/"],
      });
    }
  });

  it("the Community Edition mounts the core routers, SSO included, and nothing from ee/", async () => {
    await IdentityFeatureSet.init();

    expect(
      mounted.map((record: MountRecord) => {
        return record.router;
      }),
    ).toEqual([
      { coreRouter: "authentication" },
      { coreRouter: "reseller" },
      ...SSO_ROUTERS.map((entry: SsoRouterEntry): ExpressRouter => {
        return entry.router;
      }),
      { coreRouter: "status-page" },
    ]);
  });

  it("the Enterprise Edition adds only its own routers, after the SSO routers", async () => {
    installFakeEnterpriseModule({
      snapshot: createLicenseSnapshotWithStatus("expired"),
      identityRouters: [EE_SCIM_ROUTER as unknown as ExpressRouter],
    });

    await IdentityFeatureSet.init();

    expect(
      mounted.map((record: MountRecord) => {
        return record.router;
      }),
    ).toEqual([
      { coreRouter: "authentication" },
      { coreRouter: "reseller" },
      ...SSO_ROUTERS.map((entry: SsoRouterEntry): ExpressRouter => {
        return entry.router;
      }),
      EE_SCIM_ROUTER,
      { coreRouter: "status-page" },
    ]);
  });

  describe("enforcement is the requirement itself, the same in every state", () => {
    for (const state of EDITION_STATES) {
      it(`${state.label}: a project without the requirement is not refused`, async () => {
        applyState(state);
        jest
          .spyOn(ProjectService, "getRequireSsoForLogin")
          .mockResolvedValue(false);

        expect(await isProjectSsoEnforced()).toBe(false);
        expect(await isProjectSsoEnforcedInFanOut()).toBe(false);
      });

      it(`${state.label}: a request that already signed in with SSO is let through`, async () => {
        applyState(state);
        jest
          .spyOn(UserMiddleware, "isSsoSatisfiedForProject")
          .mockResolvedValue(true);

        expect(await isProjectSsoEnforced()).toBe(false);

        requireSsoInstanceWideOnly();
        expect(await isProjectSsoEnforced()).toBe(false);
      });

      it(`${state.label}: a master admin is exempt from the instance-wide requirement, not from the project's`, async () => {
        applyState(state);

        expect(await isProjectSsoEnforced({ isMasterAdmin: true })).toBe(true);
        expect(
          await isProjectSsoEnforcedInFanOut({ isMasterAdmin: true }),
        ).toBe(true);

        requireSsoInstanceWideOnly();

        expect(await isProjectSsoEnforced({ isMasterAdmin: true })).toBe(false);
        expect(
          await isProjectSsoEnforcedInFanOut({ isMasterAdmin: true }),
        ).toBe(false);
      });
    }
  });
});
