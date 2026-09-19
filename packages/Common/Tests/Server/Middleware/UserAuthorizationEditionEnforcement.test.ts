import UserMiddleware from "../../../Server/Middleware/UserAuthorization";
import AccessTokenService from "../../../Server/Services/AccessTokenService";
import GlobalConfigService from "../../../Server/Services/GlobalConfigService";
import ProjectService from "../../../Server/Services/ProjectService";
import EnterpriseEdition from "../../../Server/Enterprise/EnterpriseEdition";
import { EnterpriseLicenseStatus } from "../../../Server/Enterprise/EnterpriseLicenseSnapshot";
import { ExpressRequest } from "../../../Server/Utils/Express";
import UserPermissionUtil from "../../../Server/Utils/UserPermission/UserPermission";
import Dictionary from "../../../Types/Dictionary";
import BadDataException from "../../../Types/Exception/BadDataException";
import SsoAuthorizationException from "../../../Types/Exception/SsoAuthorizationException";
import TenantNotFoundException from "../../../Types/Exception/TenantNotFoundException";
import ObjectID from "../../../Types/ObjectID";
import { UserTenantAccessPermission } from "../../../Types/Permission";
import {
  createLicenseSnapshotWithStatus,
  installFakeEnterpriseModule,
  uninstallEnterpriseModule,
} from "../Enterprise/FakeEnterpriseModule";
import { setTestBillingEnabled } from "../Enterprise/TestBillingFlag";
import { getJestSpyOn } from "../../Spy";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

type SpyInstance = ReturnType<typeof getJestSpyOn>;

jest.mock("../../../Server/Utils/Logger");
jest.mock("../../../Server/Services/AccessTokenService");
jest.mock("../../../Server/Services/GlobalConfigService");
jest.mock("../../../Server/Services/ProjectService");
jest.mock("../../../Server/Services/TeamMemberService");
jest.mock("../../../Server/Services/UserService");
/*
 * PasswordHash carries a pre-existing TS5.9 diagnostic that fails any suite
 * whose runtime require graph reaches it; nothing password-related is under
 * test here, so it is replaced with a factory (see UserAuthorization.test.ts).
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
jest.mock("../../../Server/EnvironmentConfig", () => {
  const billingFlag: typeof import("../Enterprise/TestBillingFlag") =
    jest.requireActual(
      "../Enterprise/TestBillingFlag",
    ) as typeof import("../Enterprise/TestBillingFlag");

  return billingFlag.withLiveBillingFlag(
    jest.requireActual("../../../Server/EnvironmentConfig") as Record<
      string,
      unknown
    >,
  );
});

/*
 * Project, instance-wide and specific-provider SSO requirements are enforced
 * by UserMiddleware on every tenant request. Design v2 section 0:
 *
 *   - Enterprise Edition loaded: ENFORCED, whatever the license says (valid,
 *     grace, expired, missing, invalid, not yet loaded) and whatever billing
 *     says. A lapsed license must never let a password through where SSO is
 *     required - that would let users removed at the identity provider back
 *     in.
 *   - Community Edition: RELAXED. The SSO login routes do not exist there, so
 *     enforcing a leftover requirement would lock every user out.
 *   - Error while deciding: ENFORCED.
 *
 * Billing and the edition are pinned in every test (CI's config.env sets
 * BILLING_ENABLED=true).
 */

const ALL_STATUSES: ReadonlyArray<EnterpriseLicenseStatus> = [
  "missing",
  "valid",
  "grace",
  "expired",
  "invalid",
];

type EnterpriseState = {
  label: string;
  install: () => void;
};

const ENTERPRISE_STATES: Array<EnterpriseState> = [
  ...ALL_STATUSES.map((status: EnterpriseLicenseStatus): EnterpriseState => {
    return {
      label: `${status} license`,
      install: (): void => {
        installFakeEnterpriseModule({
          snapshot: createLicenseSnapshotWithStatus(status),
        });
      },
    };
  }),
  {
    label: "license not loaded yet",
    install: (): void => {
      installFakeEnterpriseModule({ snapshot: null });
    },
  },
  {
    label: "license that entitles no feature",
    install: (): void => {
      installFakeEnterpriseModule({
        snapshot: createLicenseSnapshotWithStatus("valid", { features: [] }),
      });
    },
  },
];

const BILLING_VALUES: ReadonlyArray<boolean> = [false, true];

// [label, billing, install] for every Enterprise Edition state x billing.
const ENTERPRISE_MATRIX: Array<[string, boolean, () => void]> =
  BILLING_VALUES.flatMap(
    (billing: boolean): Array<[string, boolean, () => void]> => {
      return ENTERPRISE_STATES.map(
        (state: EnterpriseState): [string, boolean, () => void] => {
          return [`billing=${billing}, ${state.label}`, billing, state.install];
        },
      );
    },
  );

const projectId: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const otherProjectId: ObjectID = new ObjectID(
  "33333333-3333-4333-8333-333333333333",
);
const userId: ObjectID = new ObjectID("22222222-2222-4222-8222-222222222222");

const userRequest: ExpressRequest = {} as ExpressRequest;
const masterAdminRequest: ExpressRequest = {
  userAuthorization: { isMasterAdmin: true },
} as unknown as ExpressRequest;

const tenantPermission: UserTenantAccessPermission = {
  projectId,
  permissions: [],
} as unknown as UserTenantAccessPermission;

let projectRequireSso: SpyInstance;
let projectRequiredProvider: SpyInstance;
let globalRequireSso: SpyInstance;
let tenantPermissionLookup: SpyInstance;
let ssoSatisfied: SpyInstance;

const resolveSingle: (
  req?: ExpressRequest,
) => Promise<UserTenantAccessPermission | null> = async (
  req?: ExpressRequest,
): Promise<UserTenantAccessPermission | null> => {
  return await UserMiddleware.getUserTenantAccessPermissionWithTenantId({
    req: req || userRequest,
    tenantId: projectId,
    userId,
  });
};

const resolveMulti: (
  req?: ExpressRequest,
) => Promise<Dictionary<UserTenantAccessPermission> | null> = async (
  req?: ExpressRequest,
): Promise<Dictionary<UserTenantAccessPermission> | null> => {
  return await UserMiddleware.getUserTenantAccessPermissionForMultiTenant(
    req || userRequest,
    userId,
    [projectId, otherProjectId],
  );
};

describe("UserMiddleware SSO enforcement by edition", () => {
  beforeEach(() => {
    setTestBillingEnabled(false);
    uninstallEnterpriseModule();

    projectRequireSso = getJestSpyOn(
      ProjectService,
      "getRequireSsoForLogin",
    ).mockResolvedValue(false);
    projectRequiredProvider = getJestSpyOn(
      ProjectService,
      "getRequireSsoWithSsoProviderId",
    ).mockResolvedValue(null);
    globalRequireSso = getJestSpyOn(
      GlobalConfigService,
      "getRequireSsoForLogin",
    ).mockResolvedValue(false);
    tenantPermissionLookup = getJestSpyOn(
      AccessTokenService,
      "getUserTenantAccessPermission",
    ).mockResolvedValue(tenantPermission);
    // No SSO token on the request unless a test says otherwise.
    ssoSatisfied = getJestSpyOn(
      UserMiddleware,
      "isSsoSatisfiedForProject",
    ).mockResolvedValue(false);
  });

  afterEach(() => {
    uninstallEnterpriseModule();
    setTestBillingEnabled(false);
    jest.restoreAllMocks();
    jest.clearAllMocks();
  });

  describe("Enterprise Edition: enforced whatever the license or billing says", () => {
    describe.each(ENTERPRISE_MATRIX)(
      "%s",
      (_label: string, billing: boolean, install: () => void) => {
        beforeEach(() => {
          setTestBillingEnabled(billing);
          install();
        });

        test("a project that requires SSO refuses a request without an SSO token", async () => {
          projectRequireSso.mockResolvedValue(true);

          await expect(resolveSingle()).rejects.toThrow(
            new SsoAuthorizationException(),
          );
          expect(ssoSatisfied).toHaveBeenCalledWith({
            req: userRequest,
            projectId,
            userId,
            requiredSsoProviderId: undefined,
          });
        });

        test("a project that requires a specific provider passes that provider on", async () => {
          const providerId: ObjectID = ObjectID.generate();
          projectRequireSso.mockResolvedValue(true);
          projectRequiredProvider.mockResolvedValue(providerId);

          await expect(resolveSingle()).rejects.toThrow(
            new SsoAuthorizationException(),
          );
          expect(ssoSatisfied).toHaveBeenCalledWith(
            expect.objectContaining({ requiredSsoProviderId: providerId }),
          );
        });

        test("a satisfied SSO token lets the request through", async () => {
          projectRequireSso.mockResolvedValue(true);
          ssoSatisfied.mockResolvedValue(true);

          await expect(resolveSingle()).resolves.toBe(tenantPermission);
        });

        test("the instance-wide requirement refuses a user without an SSO token", async () => {
          globalRequireSso.mockResolvedValue(true);

          await expect(resolveSingle()).rejects.toThrow(
            new SsoAuthorizationException(),
          );
        });

        test("master admins stay exempt from the instance-wide requirement (password recovery path)", async () => {
          globalRequireSso.mockResolvedValue(true);

          await expect(resolveSingle(masterAdminRequest)).resolves.toBe(
            tenantPermission,
          );
          expect(globalRequireSso).not.toHaveBeenCalled();
        });

        test("master admins are still held to a project's own requirement", async () => {
          projectRequireSso.mockResolvedValue(true);

          await expect(resolveSingle(masterAdminRequest)).rejects.toThrow(
            new SsoAuthorizationException(),
          );
        });

        test("the multi-tenant path hands SSO-required projects the default permission only", async () => {
          projectRequireSso.mockImplementation(
            async (id: ObjectID): Promise<boolean> => {
              return id.toString() === projectId.toString();
            },
          );

          const result: Dictionary<UserTenantAccessPermission> | null =
            await resolveMulti();

          expect(result?.[projectId.toString()]).toEqual(
            UserPermissionUtil.getDefaultUserTenantAccessPermission(projectId),
          );
          expect(result?.[otherProjectId.toString()]).toBe(tenantPermission);
        });

        test("the multi-tenant path applies the instance-wide requirement to every project", async () => {
          globalRequireSso.mockResolvedValue(true);

          const result: Dictionary<UserTenantAccessPermission> | null =
            await resolveMulti();

          expect(result?.[projectId.toString()]).toEqual(
            UserPermissionUtil.getDefaultUserTenantAccessPermission(projectId),
          );
          expect(result?.[otherProjectId.toString()]).toEqual(
            UserPermissionUtil.getDefaultUserTenantAccessPermission(
              otherProjectId,
            ),
          );
        });
      },
    );
  });

  describe("Community Edition: relaxed, because there is no SSO login to satisfy it", () => {
    describe.each(BILLING_VALUES)("billing=%p", (billing: boolean) => {
      beforeEach(() => {
        setTestBillingEnabled(billing);
        uninstallEnterpriseModule();
      });

      test("a project that requires SSO still lets its members in", async () => {
        projectRequireSso.mockResolvedValue(true);

        await expect(resolveSingle()).resolves.toBe(tenantPermission);
        expect(ssoSatisfied).not.toHaveBeenCalled();
        expect(projectRequiredProvider).not.toHaveBeenCalled();
      });

      test("the instance-wide requirement is not even read", async () => {
        globalRequireSso.mockResolvedValue(true);

        await expect(resolveSingle()).resolves.toBe(tenantPermission);
        expect(globalRequireSso).not.toHaveBeenCalled();
        expect(ssoSatisfied).not.toHaveBeenCalled();
      });

      test("an unknown project is still refused as TenantNotFound (the project lookup still runs)", async () => {
        projectRequireSso.mockRejectedValue(
          new BadDataException("Project not found"),
        );

        await expect(resolveSingle()).rejects.toThrow(
          new TenantNotFoundException("Invalid tenantId"),
        );
        expect(projectRequireSso).toHaveBeenCalledWith(projectId);
      });

      test("any other project lookup error still propagates", async () => {
        projectRequireSso.mockRejectedValue(new Error("database down"));

        await expect(resolveSingle()).rejects.toThrow("database down");
      });

      test("the user's real permission is what they get - relaxing SSO grants nothing extra", async () => {
        projectRequireSso.mockResolvedValue(true);
        tenantPermissionLookup.mockResolvedValue(null);

        await expect(resolveSingle()).resolves.toBeNull();
        expect(tenantPermissionLookup).toHaveBeenCalledWith(userId, projectId);
      });

      test("the multi-tenant path returns real permissions without reading any SSO requirement", async () => {
        projectRequireSso.mockResolvedValue(true);
        globalRequireSso.mockResolvedValue(true);

        const result: Dictionary<UserTenantAccessPermission> | null =
          await resolveMulti();

        expect(result).toEqual({
          [projectId.toString()]: tenantPermission,
          [otherProjectId.toString()]: tenantPermission,
        });
        expect(projectRequireSso).not.toHaveBeenCalled();
        expect(globalRequireSso).not.toHaveBeenCalled();
        expect(ssoSatisfied).not.toHaveBeenCalled();
      });
    });
  });

  describe("switching editions changes enforcement with no restart and no data change", () => {
    test("the same stored requirement is relaxed on CE and enforced again once ee is loaded", async () => {
      projectRequireSso.mockResolvedValue(true);

      await expect(resolveSingle()).resolves.toBe(tenantPermission);

      installFakeEnterpriseModule({
        snapshot: createLicenseSnapshotWithStatus("expired"),
      });

      await expect(resolveSingle()).rejects.toThrow(
        new SsoAuthorizationException(),
      );

      uninstallEnterpriseModule();

      await expect(resolveSingle()).resolves.toBe(tenantPermission);
    });
  });

  describe("an error while deciding answers 'enforce'", () => {
    test("single-tenant", async () => {
      getJestSpyOn(EnterpriseEdition, "shouldEnforceSso").mockImplementation(
        (): boolean => {
          throw new Error("facade exploded");
        },
      );
      projectRequireSso.mockResolvedValue(true);

      await expect(resolveSingle()).rejects.toThrow(
        new SsoAuthorizationException(),
      );
    });

    test("multi-tenant", async () => {
      getJestSpyOn(EnterpriseEdition, "shouldEnforceSso").mockImplementation(
        (): boolean => {
          throw new Error("facade exploded");
        },
      );
      projectRequireSso.mockResolvedValue(true);

      const result: Dictionary<UserTenantAccessPermission> | null =
        await resolveMulti();

      expect(result?.[projectId.toString()]).toEqual(
        UserPermissionUtil.getDefaultUserTenantAccessPermission(projectId),
      );
    });
  });
});
