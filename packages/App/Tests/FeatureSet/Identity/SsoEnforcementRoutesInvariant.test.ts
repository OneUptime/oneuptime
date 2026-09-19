import UserMiddleware from "Common/Server/Middleware/UserAuthorization";
import AccessTokenService from "Common/Server/Services/AccessTokenService";
import GlobalConfigService from "Common/Server/Services/GlobalConfigService";
import ProjectService from "Common/Server/Services/ProjectService";
import EditionEnforcement from "Common/Server/Utils/EditionEnforcement";
import Express, {
  ExpressApplication,
  ExpressRequest,
  ExpressResponse,
  ExpressRouter,
} from "Common/Server/Utils/Express";
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

/*
 * ---------------------------------------------------------------------------------------------
 * THE INVARIANT: SSO enforcement is on if and only if the SSO login routes are served.
 *
 * Enforcing SSO without the login routes locks every user out (there is no way to satisfy the
 * requirement). Serving the login routes without enforcing SSO lets a password through where an
 * owner required SSO - including for people already removed at the identity provider.
 *
 * Both halves are decided by one thing, whether SSO is ACTIVE
 * (EnterpriseEdition.isFeatureActive(SSO)): the Enterprise Edition is loaded and, with billing
 * off, its license covers SSO (or the license state is not known yet).
 *   - "served" is two things. The Identity feature set MOUNTS the enterprise module's identity
 *     routers whenever a module is registered (they are mounted once, at boot), and each of
 *     those routes ANSWERS only while EditionEnforcement.areSsoRoutesServed() - the ee routes
 *     start with a per-request license gate, pinned against this same method by
 *     ee/Tests/Server/Identity/IdentityLicenseGates.test.ts. So a lapsed Enterprise license
 *     keeps the routes mounted but refusing.
 *   - UserMiddleware enforces project and instance-wide SSO requirements exactly when
 *     EditionEnforcement.isSsoEnforced() says so.
 * This suite drives the REAL mount code and the REAL enforcement code through every edition,
 * license and billing state and asserts they never disagree.
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

type MountRecord = { paths: unknown; router: unknown };

const mounted: Array<MountRecord> = [];

const mockExpressApp: ExpressApplication = {
  use: (paths: unknown, router: unknown): void => {
    mounted.push({ paths, router });
  },
} as unknown as ExpressApplication;

jest.mock("Common/Server/Utils/Express", () => {
  const actual: Record<string, unknown> = jest.requireActual(
    "Common/Server/Utils/Express",
  ) as Record<string, unknown>;

  const actualExpress: { getRouter: () => ExpressRouter } = actual[
    "default"
  ] as { getRouter: () => ExpressRouter };

  return {
    ...actual,
    __esModule: true,
    default: {
      getRouter: (): ExpressRouter => {
        return actualExpress.getRouter();
      },
      getExpressApp: (): ExpressApplication => {
        return mockExpressApp;
      },
    },
  };
});

// The core identity routers are not what this suite is about.
jest.mock("../../../FeatureSet/Identity/API/Authentication", () => {
  return { __esModule: true, default: { coreRouter: "authentication" } };
});
jest.mock("../../../FeatureSet/Identity/API/Reseller", () => {
  return { __esModule: true, default: { coreRouter: "reseller" } };
});
jest.mock("../../../FeatureSet/Identity/API/StatusPageAuthentication", () => {
  return { __esModule: true, default: { coreRouter: "status-page" } };
});

/*
 * What the Enterprise Edition's identity router looks like to core: the SAML/OIDC login routes
 * at the same paths customer identity providers are configured with.
 */
const SSO_LOGIN_PATHS: Array<string> = [
  "/sso/:projectId/:projectSsoId",
  "/oidc/:projectId/:projectOidcId",
  "/service-provider-login",
  "/global-sso/:globalSsoId",
];

const buildEnterpriseIdentityRouter: () => ExpressRouter =
  (): ExpressRouter => {
    const router: ExpressRouter = Express.getRouter();

    for (const path of SSO_LOGIN_PATHS) {
      router.get(path, (_req: ExpressRequest, res: ExpressResponse): void => {
        res.send("sso");
      });
    }

    return router;
  };

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

// Applies the state, with the fake Enterprise identity router when ee is loaded.
const applyState: (state: EditionStateCase) => void = (
  state: EditionStateCase,
): void => {
  const fake: FakeEnterpriseModule | null = state.apply();

  if (fake) {
    fake.identityRouters = [buildEnterpriseIdentityRouter()];
  }
};

// Mounts the Identity feature set and reports whether the SSO login routes are now served.
const areSsoLoginRoutesMounted: () => Promise<boolean> =
  async (): Promise<boolean> => {
    mounted.length = 0;

    await IdentityFeatureSet.init();

    return mounted.some((record: MountRecord) => {
      const paths: Array<string> = routePathsOf(record.router);

      return SSO_LOGIN_PATHS.every((path: string) => {
        return paths.includes(path);
      });
    });
  };

// Asks the real middleware whether a project that requires SSO refuses a password session.
const isProjectSsoEnforced: () => Promise<boolean> =
  async (): Promise<boolean> => {
    try {
      await UserMiddleware.getUserTenantAccessPermissionWithTenantId({
        req: {} as ExpressRequest,
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

// Same question for the instance-wide "Require SSO for Login".
const isGlobalSsoEnforced: () => Promise<boolean> =
  async (): Promise<boolean> => {
    jest
      .spyOn(ProjectService, "getRequireSsoForLogin")
      .mockResolvedValue(false);
    jest
      .spyOn(GlobalConfigService, "getRequireSsoForLogin")
      .mockResolvedValue(true);

    return await isProjectSsoEnforced();
  };

describe("SSO enforcement is on if and only if the SSO login routes are served", () => {
  beforeEach(() => {
    mounted.length = 0;
    setTestBillingEnabled(false);
    uninstallEnterpriseModule();

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

  it("the states include lapsed Enterprise licenses (mounted, but not answering)", () => {
    expect(
      EDITION_STATES.filter((state: EditionStateCase): boolean => {
        return state.isLoaded && !state.isActive;
      }).length,
    ).toBeGreaterThanOrEqual(4);
  });

  for (const state of EDITION_STATES) {
    it(state.label, async () => {
      applyState(state);

      const mountedNow: boolean = await areSsoLoginRoutesMounted();
      const answering: boolean = EditionEnforcement.areSsoRoutesServed();
      const projectEnforced: boolean = await isProjectSsoEnforced();
      const globalEnforced: boolean = await isGlobalSsoEnforced();

      expect({
        mounted: mountedNow,
        served: mountedNow && answering,
        projectEnforced,
        globalEnforced,
        reportedEnforced: EditionEnforcement.isSsoEnforced(),
      }).toEqual({
        mounted: state.isLoaded,
        served: state.isActive,
        projectEnforced: state.isActive,
        globalEnforced: state.isActive,
        reportedEnforced: state.isActive,
      });
    });
  }

  it("a lapse and a renewal move both halves together, without re-mounting anything", async () => {
    const fake: FakeEnterpriseModule = installFakeEnterpriseModule({
      snapshot: createLicenseSnapshotWithStatus("valid"),
      identityRouters: [buildEnterpriseIdentityRouter()],
    });

    expect(await areSsoLoginRoutesMounted()).toBe(true);

    const halves: () => Promise<{
      served: boolean;
      enforced: boolean;
    }> = async (): Promise<{ served: boolean; enforced: boolean }> => {
      return {
        served: EditionEnforcement.areSsoRoutesServed(),
        enforced: await isProjectSsoEnforced(),
      };
    };

    expect(await halves()).toEqual({ served: true, enforced: true });

    fake.setSnapshot(createLicenseSnapshotWithStatus("expired"));
    expect(await halves()).toEqual({ served: false, enforced: false });

    fake.setSnapshot(createLicenseSnapshotWithStatus("grace"));
    expect(await halves()).toEqual({ served: true, enforced: true });
  });

  it("the enterprise identity routers are mounted at the same places the core ones are", async () => {
    installFakeEnterpriseModule({
      identityRouters: [buildEnterpriseIdentityRouter()],
    });

    await IdentityFeatureSet.init();

    const enterpriseMount: MountRecord | undefined = mounted.find(
      (record: MountRecord) => {
        return routePathsOf(record.router).includes(SSO_LOGIN_PATHS[0]!);
      },
    );

    expect(enterpriseMount?.paths).toEqual(["/api/identity", "/"]);
  });

  it("the Community Edition mounts no enterprise identity router at all", async () => {
    await IdentityFeatureSet.init();

    expect(
      mounted.map((record: MountRecord) => {
        return record.router;
      }),
    ).toEqual([
      { coreRouter: "authentication" },
      { coreRouter: "reseller" },
      { coreRouter: "status-page" },
    ]);
  });
});
