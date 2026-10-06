import GlobalConfig from "../../../Models/DatabaseModels/GlobalConfig";
import User from "../../../Models/DatabaseModels/User";
import ProjectMiddleware from "../../../Server/Middleware/ProjectAuthorization";
import ApiKeyPermissionService from "../../../Server/Services/ApiKeyPermissionService";
import ApiKeyService from "../../../Server/Services/ApiKeyService";
import GlobalConfigService from "../../../Server/Services/GlobalConfigService";
import ProjectService from "../../../Server/Services/ProjectService";
import UserService from "../../../Server/Services/UserService";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
  OneUptimeRequest,
} from "../../../Server/Utils/Express";
import Email from "../../../Types/Email";
import BadDataException from "../../../Types/Exception/BadDataException";
import Exception from "../../../Types/Exception/Exception";
import Name from "../../../Types/Name";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import { PlanType } from "../../../Types/Billing/SubscriptionPlan";
import UserType from "../../../Types/UserType";
import getJestMockFunction, { MockFunction } from "../../../Tests/MockType";
import { getJestSpyOn } from "../../../Tests/Spy";
import {
  afterAll,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * PasswordHash has a known, pre-existing TS5.9 compile failure under ts-jest
 * that breaks every suite whose import graph reaches it. Nothing here touches
 * password hashing; stub the module before the service import graph drags it
 * into compilation.
 */
jest.mock("../../../Server/Utils/PasswordHash", () => {
  return {
    __esModule: true,
    default: class PasswordHashStub {},
  };
});

/*
 * WHICH key made the request.
 *
 * An API key request carries no user, so before this an audit entry could
 * say "an API key changed this monitor" and nothing more - in a project with
 * a CI key, a Terraform key and an agent's key, that is not an answer. The
 * middleware now stamps the key's id and name on the request, and labels the
 * instance-wide master key (which has no row, so no id and no name of its
 * own) so a change made with it does not read as the master admin having
 * made it by hand.
 *
 * Two properties are pinned beside the happy path: the identity is stamped
 * ONLY for a key that resolved (a refused request must not leave wearing one),
 * and it never changes what the request is authorized to do.
 */

type SpyInstance = ReturnType<typeof getJestSpyOn>;

describe("ProjectMiddleware.isValidProjectIdAndApiKeyMiddleware - API key identity for the audit trail", () => {
  const apiKeyValue: ObjectID = ObjectID.generate();
  const apiKeyId: ObjectID = ObjectID.generate();
  const keyProjectId: ObjectID = ObjectID.generate();
  const masterApiKeyValue: ObjectID = ObjectID.generate();
  const masterAdminUserId: ObjectID = ObjectID.generate();

  const res: ExpressResponse = {} as ExpressResponse;
  let next: MockFunction;

  const spyFindApiKey: SpyInstance = getJestSpyOn(ApiKeyService, "findApiKey");
  const spyFindApiKeyPermissions: SpyInstance = getJestSpyOn(
    ApiKeyPermissionService,
    "findPermissionsByApiKeyId",
  );
  const spyGlobalConfigFindOneBy: SpyInstance = getJestSpyOn(
    GlobalConfigService,
    "findOneBy",
  );
  const spyUserFindOneBy: SpyInstance = getJestSpyOn(UserService, "findOneBy");

  /*
   * A resolved key is held to its project's plan (PlanCutoffCredentialAccess)
   * when BILLING_ENABLED is set - as the Common Test CI job sets it and a bare
   * local run does not. Unstubbed, that is a real ProjectService.findOneById,
   * and "Database not connected" in CI. On a plan that includes API keys the
   * key works, the same either way; ProjectAuthorizationApiKeyPlanCutoff
   * covers the plans below it.
   */
  const spyGetCurrentPlan: SpyInstance = getJestSpyOn(
    ProjectService,
    "getCurrentPlan",
  );

  // The most hostile world by default; each test opts in to what should succeed.
  beforeEach(() => {
    jest.clearAllMocks();
    next = getJestMockFunction();
    spyFindApiKey.mockResolvedValue(null);
    spyFindApiKeyPermissions.mockResolvedValue([]);
    spyGlobalConfigFindOneBy.mockResolvedValue(null);
    spyUserFindOneBy.mockResolvedValue(null);
    spyGetCurrentPlan.mockResolvedValue({
      plan: PlanType.Scale,
      isSubscriptionUnpaid: false,
    });
  });

  afterAll(() => {
    jest.restoreAllMocks();
  });

  const runMiddleware: (
    headers: Record<string, string>,
  ) => Promise<OneUptimeRequest> = async (
    headers: Record<string, string>,
  ): Promise<OneUptimeRequest> => {
    const req: Partial<ExpressRequest> = { headers };

    await expect(
      ProjectMiddleware.isValidProjectIdAndApiKeyMiddleware(
        req as ExpressRequest,
        res,
        next as NextFunction,
      ),
    ).resolves.toBeUndefined();

    return req as OneUptimeRequest;
  };

  const mockProjectKey: (name?: string | undefined) => void = (
    name?: string | undefined,
  ): void => {
    spyFindApiKey.mockResolvedValue({
      id: apiKeyId,
      projectId: keyProjectId,
      ...(name !== undefined ? { name } : {}),
    });
    spyFindApiKeyPermissions.mockResolvedValue([
      {
        permission: Permission.ProjectMember,
        labelIds: [],
        isBlockPermission: false,
      },
    ]);
  };

  const mockMasterKey: () => void = (): void => {
    const globalConfig: GlobalConfig = new GlobalConfig();
    globalConfig._id = ObjectID.getZeroObjectID().toString();
    spyGlobalConfigFindOneBy.mockResolvedValue(globalConfig);

    const masterAdmin: User = new User();
    masterAdmin._id = masterAdminUserId.toString();
    masterAdmin.email = new Email("admin@example.com");
    masterAdmin.name = new Name("Ada Admin");
    spyUserFindOneBy.mockResolvedValue(masterAdmin);
  };

  const expectAccepted: () => void = (): void => {
    expect(next).toHaveBeenCalledTimes(1);
    expect(next.mock.calls[0]).toEqual([]);
  };

  const errorPassedToNext: () => Exception = (): Exception => {
    expect(next).toHaveBeenCalledTimes(1);

    return next.mock.calls[0]![0] as Exception;
  };

  describe("a project API key", () => {
    test("stamps the key's id and name on the request", async () => {
      mockProjectKey("Terraform");

      const req: OneUptimeRequest = await runMiddleware({
        apikey: apiKeyValue.toString(),
      });

      expectAccepted();
      expect(req.apiKeyId?.toString()).toBe(apiKeyId.toString());
      expect(req.apiKeyName).toBe("Terraform");
    });

    test("the id stamped is the key ROW's id, never the secret key value from the header", async () => {
      mockProjectKey("Terraform");

      const req: OneUptimeRequest = await runMiddleware({
        apikey: apiKeyValue.toString(),
      });

      expect(req.apiKeyId?.toString()).not.toBe(apiKeyValue.toString());
      expect(req.apiKeyName).not.toContain(apiKeyValue.toString());
    });

    test("a key with no name still stamps its id, and leaves the name unset", async () => {
      mockProjectKey(undefined);

      const req: OneUptimeRequest = await runMiddleware({
        apikey: apiKeyValue.toString(),
      });

      expectAccepted();
      expect(req.apiKeyId?.toString()).toBe(apiKeyId.toString());
      expect(req.apiKeyName).toBeUndefined();
      expect(req).not.toHaveProperty("apiKeyName");
    });

    test("an empty name is no name", async () => {
      mockProjectKey("");

      const req: OneUptimeRequest = await runMiddleware({
        apikey: apiKeyValue.toString(),
      });

      expect(req.apiKeyId?.toString()).toBe(apiKeyId.toString());
      expect(req).not.toHaveProperty("apiKeyName");
    });

    test("is still an API request for the key's project: the identity changes nothing about authorization", async () => {
      mockProjectKey("Terraform");

      const req: OneUptimeRequest = await runMiddleware({
        apikey: apiKeyValue.toString(),
      });

      expect(req.userType).toBe(UserType.API);
      expect(req.tenantId?.toString()).toBe(keyProjectId.toString());
      expect(req.userAuthorization).toBeUndefined();
      expect(Object.keys(req.userTenantAccessPermission || {})).toEqual([
        keyProjectId.toString(),
      ]);
      // Permissions are looked up by the row id that was stamped.
      expect(spyFindApiKeyPermissions).toHaveBeenCalledWith(
        apiKeyId,
        keyProjectId,
      );
    });

    test("carries no MCP client identity: a key is not a connected client", async () => {
      mockProjectKey("Terraform");

      const req: OneUptimeRequest = await runMiddleware({
        apikey: apiKeyValue.toString(),
      });

      expect(req.mcpOAuth).toBeUndefined();
    });
  });

  describe("the instance master API key", () => {
    test("is labelled 'Master API Key', and has no id - it has no row", async () => {
      mockMasterKey();

      const req: OneUptimeRequest = await runMiddleware({
        apikey: masterApiKeyValue.toString(),
      });

      expectAccepted();
      expect(req.apiKeyName).toBe("Master API Key");
      expect(req.apiKeyId).toBeUndefined();
      expect(req).not.toHaveProperty("apiKeyId");
    });

    test("the label is the exported constant, so the audit trail and this middleware cannot drift", () => {
      expect(ProjectMiddleware.MASTER_API_KEY_AUDIT_NAME).toBe(
        "Master API Key",
      );
    });

    test("the request is still the master admin's - the label is what tells it apart from the admin acting by hand", async () => {
      mockMasterKey();

      const req: OneUptimeRequest = await runMiddleware({
        apikey: masterApiKeyValue.toString(),
      });

      expect(req.userType).toBe(UserType.MasterAdmin);
      expect(req.userAuthorization?.userId.toString()).toBe(
        masterAdminUserId.toString(),
      );
      expect(req.userAuthorization?.isMasterAdmin).toBe(true);
      expect(req.apiKeyName).toBe(ProjectMiddleware.MASTER_API_KEY_AUDIT_NAME);
    });

    test("a project key is looked up first: a key that is a project's is never labelled as the master key", async () => {
      mockProjectKey("Terraform");
      mockMasterKey();

      const req: OneUptimeRequest = await runMiddleware({
        apikey: apiKeyValue.toString(),
      });

      expect(req.apiKeyName).toBe("Terraform");
      expect(req.userType).toBe(UserType.API);
      expect(spyGlobalConfigFindOneBy).not.toHaveBeenCalled();
    });
  });

  describe("a key that does not resolve", () => {
    const expectNoKeyIdentity: (req: OneUptimeRequest) => void = (
      req: OneUptimeRequest,
    ): void => {
      expect(req.apiKeyId).toBeUndefined();
      expect(req.apiKeyName).toBeUndefined();
      expect(req).not.toHaveProperty("apiKeyId");
      expect(req).not.toHaveProperty("apiKeyName");
    };

    test("an unknown but well-formed key is refused, and stamps neither", async () => {
      const req: OneUptimeRequest = await runMiddleware({
        apikey: apiKeyValue.toString(),
      });

      const error: Exception = errorPassedToNext();

      expect(error).toBeInstanceOf(BadDataException);
      expect(error.message).toBe("Invalid API Key");
      expectNoKeyIdentity(req);
    });

    const malformedKeys: Array<[string, string]> = [
      ["empty", ""],
      ["whitespace-only", "   "],
      ["not a UUID", "garbage"],
      ["an OAuth access token", `oumcp_at_${"A".repeat(43)}`],
    ];

    test.each(malformedKeys)(
      "a %s apikey header is refused, and stamps neither",
      async (_label: string, headerValue: string) => {
        const req: OneUptimeRequest = await runMiddleware({
          apikey: headerValue,
        });

        expect(errorPassedToNext()).toBeInstanceOf(BadDataException);
        expectNoKeyIdentity(req);
        // A malformed value never reaches the lookup.
        expect(spyFindApiKey).not.toHaveBeenCalled();
      },
    );

    test("the master key while it is disabled is refused, and is not labelled", async () => {
      // GlobalConfigService.findOneBy answers null: the key is not enabled.
      const req: OneUptimeRequest = await runMiddleware({
        apikey: masterApiKeyValue.toString(),
      });

      expect(errorPassedToNext()).toBeInstanceOf(BadDataException);
      expectNoKeyIdentity(req);
      expect(req.userType).toBeUndefined();
    });

    test("a request with no apikey header is refused, and stamps neither", async () => {
      const req: OneUptimeRequest = await runMiddleware({});

      expect(errorPassedToNext()).toBeInstanceOf(BadDataException);
      expectNoKeyIdentity(req);
    });
  });

  describe("the caller cannot choose the identity", () => {
    test("headers that look like the stamped fields are ignored: the name comes from the key's row", async () => {
      mockProjectKey("Terraform");

      const req: OneUptimeRequest = await runMiddleware({
        apikey: apiKeyValue.toString(),
        apikeyname: "Somebody Else's Key",
        apikeyid: ObjectID.generate().toString(),
        "x-api-key-name": "Somebody Else's Key",
      });

      expect(req.apiKeyName).toBe("Terraform");
      expect(req.apiKeyId?.toString()).toBe(apiKeyId.toString());
    });
  });
});
