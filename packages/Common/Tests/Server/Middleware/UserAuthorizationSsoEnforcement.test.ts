import UserMiddleware from "../../../Server/Middleware/UserAuthorization";
import AccessTokenService from "../../../Server/Services/AccessTokenService";
import GlobalConfigService from "../../../Server/Services/GlobalConfigService";
import ProjectService from "../../../Server/Services/ProjectService";
import EnterpriseEdition from "../../../Server/Enterprise/EnterpriseEdition";
import { ExpressRequest } from "../../../Server/Utils/Express";
import UserPermissionUtil from "../../../Server/Utils/UserPermission/UserPermission";
import Dictionary from "../../../Types/Dictionary";
import BadDataException from "../../../Types/Exception/BadDataException";
import SsoAuthorizationException from "../../../Types/Exception/SsoAuthorizationException";
import TenantNotFoundException from "../../../Types/Exception/TenantNotFoundException";
import ObjectID from "../../../Types/ObjectID";
import { UserTenantAccessPermission } from "../../../Types/Permission";
import FakeEnterpriseModule, {
  createEditionStateCases,
  createLicenseSnapshot,
  createLicenseSnapshotWithStatus,
  EditionStateCase,
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
 * Project, required-provider and instance-wide SSO requirements are enforced
 * by UserMiddleware on every tenant request, in EVERY edition and license
 * state: single sign-on is part of the Community Edition, so a configured
 * requirement never depends on ee/ being loaded or on the license.
 *
 *   - the Community Edition (ee/ not loaded), billing off and on;
 *   - the Enterprise Edition with a valid license, in the trial, in grace,
 *     with an accepted legacy license, with an expired, missing or invalid
 *     license, with a license that leaves SCIM and audit logs out, and in the
 *     unknown license states;
 *   - OneUptime Cloud (billing on, ee/ loaded), whatever the license says.
 *
 * What never changes: nothing is enforced when nothing is configured, and
 * master admins are exempt from the INSTANCE-WIDE requirement only (so a
 * broken global IdP cannot lock them out) and stay held to a project's own.
 * A requirement that cannot be read - the project's own, the provider it
 * pins, or the instance-wide one - refuses the request with the error, on
 * the single-tenant path and in the multi-tenant fan-out alike: it is never
 * "not required", nor "any provider will do". An unknown project is
 * TenantNotFound on the single-tenant path, and left out of the fan-out.
 *
 * Billing and the edition are pinned in every test (CI's config.env sets
 * BILLING_ENABLED=true).
 */

const EDITION_CASES: Array<EditionStateCase> = createEditionStateCases();

const EVERY_STATE: Array<[string, EditionStateCase]> = EDITION_CASES.map(
  (editionCase: EditionStateCase): [string, EditionStateCase] => {
    return [editionCase.label, editionCase];
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

const defaultPermission: (id: ObjectID) => UserTenantAccessPermission = (
  id: ObjectID,
): UserTenantAccessPermission => {
  return UserPermissionUtil.getDefaultUserTenantAccessPermission(id);
};

describe("UserMiddleware enforces SSO requirements in every edition", () => {
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

  test("the matrix covers the Community Edition, every license state (lapsed and unknown included) and the Cloud", () => {
    const labels: Array<string> = EVERY_STATE.map(
      ([label]: [string, EditionStateCase]): string => {
        return label;
      },
    );

    expect(labels).toEqual(
      expect.arrayContaining([
        "billing=false, Community Edition",
        "billing=true, Community Edition",
        "billing=false, Enterprise Edition, valid license",
        "billing=false, Enterprise Edition, no license, inside the 14-day trial",
        "billing=false, Enterprise Edition, license expired less than 30 days ago (grace)",
        "billing=false, Enterprise Edition, license expired more than 30 days ago",
        "billing=false, Enterprise Edition, no license after the trial",
        "billing=false, Enterprise Edition, invalid license",
        "billing=false, Enterprise Edition, valid license without SCIM or audit logs",
        "billing=false, Enterprise Edition, license not read yet (unknown)",
        "billing=true, Enterprise Edition, valid license",
      ]),
    );
    // Lapsed Enterprise states, where SCIM and audit logging stop, are in it.
    expect(
      EDITION_CASES.filter((editionCase: EditionStateCase): boolean => {
        return editionCase.isLoaded && !editionCase.isActive;
      }).length,
    ).toBeGreaterThanOrEqual(4);
  });

  describe.each(EVERY_STATE)(
    "%s",
    (_label: string, editionCase: EditionStateCase) => {
      beforeEach(() => {
        editionCase.apply();
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
        expect(projectRequiredProvider).toHaveBeenCalledWith(projectId);
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
        expect(globalRequireSso).toHaveBeenCalled();
      });

      test("the instance-wide requirement is satisfied by an SSO token", async () => {
        globalRequireSso.mockResolvedValue(true);
        ssoSatisfied.mockResolvedValue(true);

        await expect(resolveSingle()).resolves.toBe(tenantPermission);
      });

      test("nothing is enforced when nothing is configured", async () => {
        await expect(resolveSingle()).resolves.toBe(tenantPermission);
        expect(ssoSatisfied).not.toHaveBeenCalled();
        expect(projectRequiredProvider).not.toHaveBeenCalled();
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

      test("an unknown project is refused as TenantNotFound", async () => {
        projectRequireSso.mockRejectedValue(
          new BadDataException("Project not found"),
        );

        await expect(resolveSingle()).rejects.toThrow(
          new TenantNotFoundException("Invalid tenantId"),
        );
      });

      test("any other project lookup error propagates: the request is refused, never let through", async () => {
        projectRequireSso.mockRejectedValue(new Error("database down"));

        await expect(resolveSingle()).rejects.toThrow("database down");
        // A project's own requirement binds master admins too, so they are refused as well.
        await expect(resolveSingle(masterAdminRequest)).rejects.toThrow(
          "database down",
        );
        expect(ssoSatisfied).not.toHaveBeenCalled();
      });

      test("the multi-tenant path refuses the whole request when a project's own requirement cannot be read: never 'not required'", async () => {
        // A database error on one project; the other reads as not required.
        projectRequireSso.mockImplementation(
          async (id: ObjectID): Promise<boolean> => {
            if (id.toString() === projectId.toString()) {
              throw new Error("database down");
            }
            return false;
          },
        );
        // A satisfied SSO sign-in changes nothing: the rule is not known.
        ssoSatisfied.mockResolvedValue(true);

        // A project's own requirement binds master admins too.
        for (const req of [userRequest, masterAdminRequest]) {
          await expect(resolveMulti(req)).rejects.toThrow("database down");
        }

        // With the instance-wide requirement on, the same.
        globalRequireSso.mockResolvedValue(true);

        await expect(resolveMulti()).rejects.toThrow("database down");
      });

      test("the multi-tenant path leaves out a project that does not exist, whatever AccessTokenService still holds for it", async () => {
        projectRequireSso.mockImplementation(
          async (id: ObjectID): Promise<boolean> => {
            if (id.toString() === projectId.toString()) {
              throw new BadDataException("Project not found");
            }
            return false;
          },
        );

        for (const req of [userRequest, masterAdminRequest]) {
          const result: Dictionary<UserTenantAccessPermission> | null =
            await resolveMulti(req);

          expect(result).toEqual({
            [otherProjectId.toString()]: tenantPermission,
          });
        }

        expect(tenantPermissionLookup).not.toHaveBeenCalledWith(
          userId,
          projectId,
          expect.anything(),
        );

        // Under the instance-wide requirement too: left out, not handed the default permission.
        globalRequireSso.mockResolvedValue(true);

        expect(await resolveMulti()).toEqual({
          [otherProjectId.toString()]: defaultPermission(otherProjectId),
        });
      });

      test("an instance-wide requirement that cannot be read refuses the request, with an SSO sign-in or without: never 'not required'", async () => {
        globalRequireSso.mockRejectedValue(new Error("database down"));

        await expect(resolveSingle()).rejects.toThrow("database down");

        ssoSatisfied.mockResolvedValue(true);

        await expect(resolveSingle()).rejects.toThrow("database down");
        expect(ssoSatisfied).not.toHaveBeenCalled();
      });

      test("the multi-tenant path refuses the whole request when the instance-wide requirement cannot be read", async () => {
        globalRequireSso.mockRejectedValue(new Error("database down"));

        await expect(resolveMulti()).rejects.toThrow("database down");

        ssoSatisfied.mockResolvedValue(true);

        await expect(resolveMulti()).rejects.toThrow("database down");
        expect(tenantPermissionLookup).not.toHaveBeenCalled();
      });

      test("master admins are not asked the instance-wide requirement, so it failing to read does not refuse them", async () => {
        globalRequireSso.mockRejectedValue(new Error("database down"));

        await expect(resolveSingle(masterAdminRequest)).resolves.toBe(
          tenantPermission,
        );
        expect(await resolveMulti(masterAdminRequest)).toEqual({
          [projectId.toString()]: tenantPermission,
          [otherProjectId.toString()]: tenantPermission,
        });
        expect(globalRequireSso).not.toHaveBeenCalled();
      });

      test("a project's pinned provider that cannot be read refuses the request: never 'any provider will do'", async () => {
        projectRequireSso.mockResolvedValue(true);
        projectRequiredProvider.mockRejectedValue(new Error("database down"));
        // An SSO sign-in from some provider is on the request.
        ssoSatisfied.mockResolvedValue(true);

        // A project's own requirement binds master admins too.
        for (const req of [userRequest, masterAdminRequest]) {
          await expect(resolveSingle(req)).rejects.toThrow("database down");
          await expect(resolveMulti(req)).rejects.toThrow("database down");
        }

        expect(ssoSatisfied).not.toHaveBeenCalled();
      });

      test("the provider pinned under the instance-wide requirement that cannot be read refuses the request too", async () => {
        globalRequireSso.mockResolvedValue(true);
        projectRequiredProvider.mockRejectedValue(new Error("database down"));
        ssoSatisfied.mockResolvedValue(true);

        await expect(resolveSingle()).rejects.toThrow("database down");
        await expect(resolveMulti()).rejects.toThrow("database down");
        expect(ssoSatisfied).not.toHaveBeenCalled();
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
          defaultPermission(projectId),
        );
        expect(result?.[otherProjectId.toString()]).toBe(tenantPermission);
      });

      test("the multi-tenant path applies the instance-wide requirement to every project", async () => {
        globalRequireSso.mockResolvedValue(true);

        const result: Dictionary<UserTenantAccessPermission> | null =
          await resolveMulti();

        expect(result).toEqual({
          [projectId.toString()]: defaultPermission(projectId),
          [otherProjectId.toString()]: defaultPermission(otherProjectId),
        });
      });

      test("the multi-tenant path exempts master admins from the instance-wide requirement only", async () => {
        globalRequireSso.mockResolvedValue(true);
        projectRequireSso.mockImplementation(
          async (id: ObjectID): Promise<boolean> => {
            return id.toString() === otherProjectId.toString();
          },
        );

        const result: Dictionary<UserTenantAccessPermission> | null =
          await resolveMulti(masterAdminRequest);

        expect(globalRequireSso).not.toHaveBeenCalled();
        expect(result).toEqual({
          [projectId.toString()]: tenantPermission,
          [otherProjectId.toString()]: defaultPermission(otherProjectId),
        });
      });

      test("the multi-tenant path passes each project's required provider on", async () => {
        const providerId: ObjectID = ObjectID.generate();
        projectRequireSso.mockResolvedValue(true);
        projectRequiredProvider.mockResolvedValue(providerId);
        ssoSatisfied.mockResolvedValue(true);

        const result: Dictionary<UserTenantAccessPermission> | null =
          await resolveMulti();

        expect(result).toEqual({
          [projectId.toString()]: tenantPermission,
          [otherProjectId.toString()]: tenantPermission,
        });
        expect(ssoSatisfied).toHaveBeenCalledWith(
          expect.objectContaining({
            projectId: otherProjectId,
            requiredSsoProviderId: providerId,
          }),
        );
      });
    },
  );

  describe("the license never decides single sign-on", () => {
    test("enforcement does not ask the enterprise facade at all", async () => {
      installFakeEnterpriseModule({
        snapshot: createLicenseSnapshotWithStatus("expired"),
      });
      const isFeatureActive: SpyInstance = getJestSpyOn(
        EnterpriseEdition,
        "isFeatureActive",
      );
      const isFeatureAvailableSync: SpyInstance = getJestSpyOn(
        EnterpriseEdition,
        "isFeatureAvailableSync",
      );
      projectRequireSso.mockResolvedValue(true);
      globalRequireSso.mockResolvedValue(true);

      await expect(resolveSingle()).rejects.toThrow(
        new SsoAuthorizationException(),
      );
      await resolveMulti();

      expect(isFeatureActive).not.toHaveBeenCalled();
      expect(isFeatureAvailableSync).not.toHaveBeenCalled();
    });

    test("a facade that throws changes nothing", async () => {
      installFakeEnterpriseModule();
      getJestSpyOn(EnterpriseEdition, "isFeatureActive").mockImplementation(
        (): boolean => {
          throw new Error("facade exploded");
        },
      );
      projectRequireSso.mockResolvedValue(true);

      await expect(resolveSingle()).rejects.toThrow(
        new SsoAuthorizationException(),
      );
      expect((await resolveMulti())?.[projectId.toString()]).toEqual(
        defaultPermission(projectId),
      );
    });

    test("a license that lapses, is renewed and lapses again never lets a password session into an SSO-required project", async () => {
      projectRequireSso.mockResolvedValue(true);

      const fake: FakeEnterpriseModule = installFakeEnterpriseModule({
        snapshot: createLicenseSnapshotWithStatus("valid"),
      });

      for (const snapshot of [
        createLicenseSnapshotWithStatus("valid"),
        createLicenseSnapshotWithStatus("expired"),
        createLicenseSnapshotWithStatus("grace"),
        createLicenseSnapshotWithStatus("missing"),
        createLicenseSnapshotWithStatus("invalid"),
        createLicenseSnapshot({ features: [] }),
        null,
      ]) {
        fake.setSnapshot(snapshot);

        await expect(resolveSingle()).rejects.toThrow(
          new SsoAuthorizationException(),
        );
      }

      expect(tenantPermissionLookup).toHaveBeenCalled();
    });

    test("moving between the Community and the Enterprise image keeps enforcing the same stored requirement", async () => {
      globalRequireSso.mockResolvedValue(true);

      await expect(resolveSingle()).rejects.toThrow(
        new SsoAuthorizationException(),
      );

      installFakeEnterpriseModule({
        snapshot: createLicenseSnapshotWithStatus("expired"),
      });

      await expect(resolveSingle()).rejects.toThrow(
        new SsoAuthorizationException(),
      );

      uninstallEnterpriseModule();
      setTestBillingEnabled(true);

      await expect(resolveSingle()).rejects.toThrow(
        new SsoAuthorizationException(),
      );
    });
  });
});
