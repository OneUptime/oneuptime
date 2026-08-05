import APIKeyPermission from "../../../Models/DatabaseModels/ApiKeyPermission";
import GlobalConfig from "../../../Models/DatabaseModels/GlobalConfig";
import User from "../../../Models/DatabaseModels/User";
import ProjectMiddleware from "../../../Server/Middleware/ProjectAuthorization";
import ApiKeyPermissionService from "../../../Server/Services/ApiKeyPermissionService";
import ApiKeyService from "../../../Server/Services/ApiKeyService";
import GlobalConfigService from "../../../Server/Services/GlobalConfigService";
import UserService from "../../../Server/Services/UserService";
import FindOneBy from "../../../Server/Types/Database/FindOneBy";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
  OneUptimeRequest,
} from "../../../Server/Utils/Express";
import Dictionary from "../../../Types/Dictionary";
import Email from "../../../Types/Email";
import BadDataException from "../../../Types/Exception/BadDataException";
import Exception from "../../../Types/Exception/Exception";
import ExceptionCode from "../../../Types/Exception/ExceptionCode";
import NotAuthenticatedException from "../../../Types/Exception/NotAuthenticatedException";
import Name from "../../../Types/Name";
import ObjectID from "../../../Types/ObjectID";
import Permission, {
  UserPermission,
  UserTenantAccessPermission,
} from "../../../Types/Permission";
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
 * ProjectAuthorization.isValidProjectIdAndApiKeyMiddleware is the single door
 * every API-key request in the product walks through, and it had no test at all.
 *
 * Issue #3004 is what that costs. A caller sent a real project API key, the
 * request never reached this middleware (hasApiKey used to mean "usable key",
 * not "key header present"), and it fell through to the anonymous path where a
 * per-model permission check answered 401 "A user should be logged in to read
 * record of Log Pipeline." — an error about session auth, naming a model, at a
 * caller who had attempted neither. It was reported as an RBAC bug in Log
 * Pipeline. Issue #1754 was the same string on a different model.
 *
 * These tests pin the middleware's whole contract: what a resolved key puts on
 * the request (including that the KEY decides the tenant, not the caller), and
 * that every unusable key shape leaves as BadDataException("Invalid API Key")
 * through next(err) rather than being thrown, mis-typed, or handed to Postgres.
 */
describe("ProjectMiddleware.isValidProjectIdAndApiKeyMiddleware", () => {
  const apiKeyValue: ObjectID = ObjectID.generate();
  const apiKeyId: ObjectID = ObjectID.generate();
  const keyProjectId: ObjectID = ObjectID.generate();
  const masterApiKeyValue: ObjectID = ObjectID.generate();

  const res: ExpressResponse = {} as ExpressResponse;
  let next: MockFunction;

  const spyFindApiKey: jest.SpyInstance = getJestSpyOn(
    ApiKeyService,
    "findApiKey",
  );
  const spyApiKeyPermissionFindBy: jest.SpyInstance = getJestSpyOn(
    ApiKeyPermissionService,
    "findBy",
  );
  const spyGlobalConfigFindOneBy: jest.SpyInstance = getJestSpyOn(
    GlobalConfigService,
    "findOneBy",
  );
  const spyUserFindOneBy: jest.SpyInstance = getJestSpyOn(
    UserService,
    "findOneBy",
  );

  /*
   * Defaults describe the most hostile world: the key is unknown, the master
   * key is disabled and there is no master admin. Every test opts in to the
   * lookups it actually wants to succeed, so nothing passes by accident.
   */
  beforeEach(() => {
    jest.clearAllMocks();
    next = getJestMockFunction();
    spyFindApiKey.mockResolvedValue(null);
    spyApiKeyPermissionFindBy.mockResolvedValue([]);
    spyGlobalConfigFindOneBy.mockResolvedValue(null);
    spyUserFindOneBy.mockResolvedValue(null);
  });

  afterAll(() => {
    jest.restoreAllMocks();
  });

  type RunMiddlewareFunction = (req: Partial<ExpressRequest>) => Promise<void>;

  /*
   * The middleware's own catch calls next(err); it must never reject. Every
   * call site goes through here so that "errors arrive via next, not as a
   * thrown exception" is asserted once per scenario rather than assumed.
   */
  const runMiddleware: RunMiddlewareFunction = async (
    req: Partial<ExpressRequest>,
  ): Promise<void> => {
    await expect(
      ProjectMiddleware.isValidProjectIdAndApiKeyMiddleware(
        req as ExpressRequest,
        res,
        next as NextFunction,
      ),
    ).resolves.toBeUndefined();
  };

  type GetErrorPassedToNextFunction = () => Exception;

  const getErrorPassedToNext: GetErrorPassedToNextFunction = (): Exception => {
    expect(next).toHaveBeenCalledTimes(1);

    return next.mock.calls[0]![0] as Exception;
  };

  describe("when the API key resolves to a project", () => {
    type MockResolvedApiKeyFunction = () => void;

    const mockResolvedApiKey: MockResolvedApiKeyFunction = (): void => {
      const apiKeyPermission: APIKeyPermission = new APIKeyPermission();
      apiKeyPermission.permission = Permission.ProjectMember;
      apiKeyPermission.labels = [];
      apiKeyPermission.isBlockPermission = false;

      spyFindApiKey.mockResolvedValue({
        id: apiKeyId,
        projectId: keyProjectId,
      });
      spyApiKeyPermissionFindBy.mockResolvedValue([apiKeyPermission]);
    };

    test("should call next with no argument and stamp API identity, tenant and permissions on the request", async () => {
      mockResolvedApiKey();

      const req: Partial<ExpressRequest> = {
        headers: { apikey: apiKeyValue.toString() },
      };

      await runMiddleware(req);

      // next() with zero arguments — an argument would be routed as an error.
      expect(next).toHaveBeenCalledTimes(1);
      expect(next.mock.calls[0]).toEqual([]);

      // The header value is what gets looked up, parsed into an ObjectID.
      expect(spyFindApiKey).toHaveBeenCalledWith(
        new ObjectID(apiKeyValue.toString()),
      );

      const oneUptimeRequest: OneUptimeRequest = req as OneUptimeRequest;

      expect(oneUptimeRequest.userType).toEqual(UserType.API);
      expect(oneUptimeRequest.tenantId?.toString()).toEqual(
        keyProjectId.toString(),
      );
      expect(
        oneUptimeRequest.userGlobalAccessPermission?.projectIds.map(
          (projectId: ObjectID) => {
            return projectId.toString();
          },
        ),
      ).toEqual([keyProjectId.toString()]);

      /*
       * A project key gets the DEFAULT api global permission, never the master
       * key's. The two builders differ by exactly one entry — ProjectOwner —
       * so swapping them (they sit next to each other in
       * Utils/APIKey/AccessPermission) would hand every project API key owner
       * rights on its project with nothing else in the request looking wrong.
       */
      expect(
        oneUptimeRequest.userGlobalAccessPermission?.globalPermissions,
      ).not.toContain(Permission.ProjectOwner);

      const tenantAccessPermission:
        | Dictionary<UserTenantAccessPermission>
        | undefined = oneUptimeRequest.userTenantAccessPermission;

      expect(Object.keys(tenantAccessPermission || {})).toEqual([
        keyProjectId.toString(),
      ]);
      expect(
        tenantAccessPermission?.[keyProjectId.toString()]?.projectId.toString(),
      ).toEqual(keyProjectId.toString());
    });

    /*
     * The permissions attached to the request are looked up by the KEY's id,
     * and the rows found are what the request is allowed to do. Without this
     * the key would authenticate but carry no granted permission, which is the
     * 422 "You do not have permissions to ..." the API answers.
     */
    test("should carry the permissions granted to that specific API key", async () => {
      mockResolvedApiKey();

      const req: Partial<ExpressRequest> = {
        headers: { apikey: apiKeyValue.toString() },
      };

      await runMiddleware(req);

      expect(spyApiKeyPermissionFindBy).toHaveBeenCalledWith(
        expect.objectContaining({
          query: { apiKeyId: apiKeyId },
        }),
      );

      const permissions: Array<UserPermission> =
        (req as OneUptimeRequest).userTenantAccessPermission?.[
          keyProjectId.toString()
        ]?.permissions || [];

      expect(
        permissions.map((permission: UserPermission) => {
          return permission.permission;
        }),
      ).toContain(Permission.ProjectMember);
    });

    /*
     * Header shapes that a real caller sends and that MUST still resolve.
     *
     * Padding: a key pasted out of the dashboard or read from a file arrives
     * with surrounding whitespace or a trailing newline (`$(cat key.txt)`).
     * Untrimmed, that string reached the `uuid` column verbatim and raised
     * 22P02, so a copy/paste answered 500.
     *
     * Case: UUID_REGEX carries the `i` flag on purpose. Postgres `uuid`
     * compares case-insensitively and plenty of clients upper-case ids, so
     * losing that flag would start rejecting keys that the database itself
     * considers identical — and the new shape check would turn that into a
     * flat "Invalid API Key" for a key that is genuinely valid.
     *
     * Tuples are [label, header value, value the lookup must receive].
     */
    const resolvableHeaderShapes: Array<[string, string, string]> = [
      [
        "whitespace-padded",
        `  ${apiKeyValue.toString()}  `,
        apiKeyValue.toString(),
      ],
      [
        "newline-terminated",
        `${apiKeyValue.toString()}\n`,
        apiKeyValue.toString(),
      ],
      [
        "upper-cased",
        apiKeyValue.toString().toUpperCase(),
        apiKeyValue.toString().toUpperCase(),
      ],
    ];

    test.each(resolvableHeaderShapes)(
      "should resolve a %s apikey header",
      async (_label: string, headerValue: string, lookedUpValue: string) => {
        mockResolvedApiKey();

        const req: Partial<ExpressRequest> = {
          headers: { apikey: headerValue },
        };

        await runMiddleware(req);

        expect(next.mock.calls[0]).toEqual([]);
        expect(spyFindApiKey).toHaveBeenCalledWith(new ObjectID(lookedUpValue));
        expect((req as OneUptimeRequest).userType).toEqual(UserType.API);
      },
    );

    /*
     * SECURITY: the tenant is decided by the API key, never by the caller.
     *
     * The caller asks for a project they do not own via the `tenantid` header;
     * the request is still scoped to the key's own project. #3004's reporter
     * tried adding projectId to the body, query and headers to make the call
     * work — this test documents why that could never have helped, and, more
     * importantly, why it must never help.
     */
    test("should overwrite a caller-supplied tenantid with the project the key belongs to", async () => {
      mockResolvedApiKey();

      const otherProjectId: ObjectID = ObjectID.generate();

      const req: Partial<ExpressRequest> = {
        headers: {
          apikey: apiKeyValue.toString(),
          tenantid: otherProjectId.toString(),
        },
      };

      await runMiddleware(req);

      expect(next.mock.calls[0]).toEqual([]);

      const oneUptimeRequest: OneUptimeRequest = req as OneUptimeRequest;

      expect(oneUptimeRequest.tenantId?.toString()).toEqual(
        keyProjectId.toString(),
      );
      expect(oneUptimeRequest.tenantId?.toString()).not.toEqual(
        otherProjectId.toString(),
      );
      expect(
        Object.keys(oneUptimeRequest.userTenantAccessPermission || {}),
      ).toEqual([keyProjectId.toString()]);
      expect(
        oneUptimeRequest.userGlobalAccessPermission?.projectIds.map(
          (projectId: ObjectID) => {
            return projectId.toString();
          },
        ),
      ).not.toContain(otherProjectId.toString());
    });
  });

  describe("when the API key cannot be used", () => {
    /*
     * A syntactically fine key that no project owns (revoked, expired, typo'd,
     * or copied from another instance) and that is not the master key. The
     * caller must be told the key is bad, not that some model is unreadable.
     */
    test("should call next with BadDataException 'Invalid API Key' for an unknown but well-formed key", async () => {
      const req: Partial<ExpressRequest> = {
        headers: { apikey: apiKeyValue.toString() },
      };

      await runMiddleware(req);

      const error: Exception = getErrorPassedToNext();

      expect(error).toBeInstanceOf(BadDataException);
      expect(error.message).toEqual("Invalid API Key");
      expect(error.code).toEqual(ExceptionCode.BadDataException);

      // The key was looked up, and the master-key fallback was consulted.
      expect(spyFindApiKey).toHaveBeenCalledTimes(1);
      expect(spyGlobalConfigFindOneBy).toHaveBeenCalledTimes(1);

      /*
       * A rejected request must not walk away wearing an identity. Express
       * still owns this `req` object, and a later handler that reads userType
       * or userTenantAccessPermission without re-checking would treat it as an
       * authenticated API caller.
       */
      expect((req as OneUptimeRequest).userType).toBeUndefined();
      expect(
        (req as OneUptimeRequest).userTenantAccessPermission,
      ).toBeUndefined();
      expect(
        (req as OneUptimeRequest).userGlobalAccessPermission,
      ).toBeUndefined();
    });

    /*
     * The #3004 fix at the middleware level.
     *
     * An `ApiKey` header that arrives blank — an unset shell variable, a client
     * that always sends the header, our own CLI's partial-credential path — is
     * a caller attempting key auth and getting it wrong. It used to be treated
     * as no key at all, drop to the anonymous path, and surface as a 401 about
     * being logged in against whichever model was asked for. It must fail here,
     * as a 400 about the key.
     */
    const unusableHeaderValues: Array<[string, string]> = [
      ["empty", ""],
      ["whitespace-only", "   "],
      ["a non-UUID string", "garbage"],
      ["a UUID with a typo", "not-a-uuid-at-all-1234"],
    ];

    test.each(unusableHeaderValues)(
      "should call next with BadDataException 'Invalid API Key' when the apikey header is %s",
      async (_label: string, headerValue: string) => {
        const req: Partial<ExpressRequest> = {
          headers: { apikey: headerValue },
        };

        await runMiddleware(req);

        const error: Exception = getErrorPassedToNext();

        expect(error).toBeInstanceOf(BadDataException);
        expect(error.message).toEqual("Invalid API Key");

        // Not the "no header" message — the header WAS sent, just unusable.
        expect(error.message).not.toContain(
          "API Key not found in the request header",
        );
        // And not a session-auth error, which is what #3004 reported.
        expect(error).not.toBeInstanceOf(NotAuthenticatedException);
        expect(error.code).toEqual(ExceptionCode.BadDataException);

        // The request is rejected, so it carries no API identity onward.
        expect((req as OneUptimeRequest).userType).toBeUndefined();
        expect(
          (req as OneUptimeRequest).userTenantAccessPermission,
        ).toBeUndefined();
      },
    );

    /*
     * `ApiKey.apiKey` and `GlobalConfig.masterApiKey` are Postgres `uuid`
     * columns. Passing a non-UUID string down to them raises 22P02 "invalid
     * input syntax for type uuid" as a raw QueryFailedError, which is not a
     * OneUptime Exception, so it escapes the error translator and answers 500
     * to what is really a malformed request. The shape check must happen before
     * any lookup — assert the lookups never even run.
     */
    test("should never hit the database for a non-UUID apikey header", async () => {
      const req: Partial<ExpressRequest> = {
        headers: { apikey: "garbage" },
      };

      await runMiddleware(req);

      expect(spyFindApiKey).not.toHaveBeenCalled();
      expect(spyGlobalConfigFindOneBy).not.toHaveBeenCalled();
      expect(getErrorPassedToNext().message).toEqual("Invalid API Key");
    });

    /*
     * Node collapses a header sent twice into an array. Joined, it is never a
     * usable key — but it is unmistakably a caller trying to authenticate by
     * key, so it belongs in the "Invalid API Key" bucket and not the anonymous
     * path.
     */
    test("should call next with BadDataException 'Invalid API Key' when the apikey header was sent twice", async () => {
      const req: Partial<ExpressRequest> = {
        headers: {
          apikey: [apiKeyValue.toString(), ObjectID.generate().toString()],
        },
      };

      await runMiddleware(req);

      const error: Exception = getErrorPassedToNext();

      expect(error).toBeInstanceOf(BadDataException);
      expect(error.message).toEqual("Invalid API Key");
      expect(spyFindApiKey).not.toHaveBeenCalled();
    });

    /*
     * Invoked directly with no `apikey` header at all (the middleware is also
     * mounted on routes that require a key). The distinct "you sent nothing"
     * message is the direct-call contract and must survive the #3004 change,
     * which only re-classified headers that WERE sent.
     */
    test("should call next with the 'API Key not found' message when no apikey header was sent", async () => {
      const req: Partial<ExpressRequest> = {
        headers: {},
      };

      await runMiddleware(req);

      const error: Exception = getErrorPassedToNext();

      expect(error).toBeInstanceOf(BadDataException);
      expect(error.message).toEqual(
        "API Key not found in the request header. Please provide a valid API Key in the request header.",
      );
      expect(spyFindApiKey).not.toHaveBeenCalled();
    });

    /*
     * The header read is `req.headers?.["apikey"]`. Some internal call sites
     * and test doubles hand the middleware a request object with no `headers`
     * at all; without the optional chain that is a TypeError, which the
     * try/catch would dutifully forward to next() as a non-Exception and the
     * error translator would answer 500. It must still be the clean 400.
     */
    test("should report the missing API key rather than throw when the request has no headers object", async () => {
      const req: Partial<ExpressRequest> = {};

      await runMiddleware(req);

      const error: Exception = getErrorPassedToNext();

      expect(error).toBeInstanceOf(BadDataException);
      expect(error.message).toEqual(
        "API Key not found in the request header. Please provide a valid API Key in the request header.",
      );
    });

    /*
     * Even a caller-supplied tenant does not soften the missing-key message:
     * a project id is not a credential.
     */
    test("should still report the missing API key when only a tenantid header was sent", async () => {
      const req: Partial<ExpressRequest> = {
        headers: { tenantid: keyProjectId.toString() },
      };

      await runMiddleware(req);

      expect(getErrorPassedToNext().message).toEqual(
        "API Key not found in the request header. Please provide a valid API Key in the request header.",
      );
    });
  });

  describe("when the key is the instance master API key", () => {
    const masterAdminUserId: ObjectID = ObjectID.generate();

    type MockMasterKeyEnabledFunction = () => void;

    /*
     * The master key is enabled, and the lookup answers ONLY for the key that
     * was actually presented — which is exactly what the `masterApiKey: apiKey`
     * term in the real query does.
     *
     * A blanket "always return a row" stub would be a tautology dressed as a
     * test: it would stay green if the query lost that term, or if the
     * middleware stopped passing the caller's key to isMasterApiKey at all —
     * i.e. if every well-formed key on an instance with the master key enabled
     * were promoted to master admin. That is the worst regression this file
     * could miss, so the fake has to be able to say no.
     */
    const mockMasterKeyEnabled: MockMasterKeyEnabledFunction = (): void => {
      const globalConfig: GlobalConfig = new GlobalConfig();
      globalConfig._id = ObjectID.getZeroObjectID().toString();

      // findApiKey stays null: the master key is not a project API key row.
      spyGlobalConfigFindOneBy.mockImplementation(
        async (
          findBy: FindOneBy<GlobalConfig>,
        ): Promise<GlobalConfig | null> => {
          const query: Record<string, unknown> = (findBy.query || {}) as Record<
            string,
            unknown
          >;

          const isScopedToPresentedKey: boolean =
            String(query["masterApiKey"] ?? "") ===
            masterApiKeyValue.toString();

          const isScopedToEnabledMasterKey: boolean =
            query["isMasterApiKeyEnabled"] === true;

          if (isScopedToPresentedKey && isScopedToEnabledMasterKey) {
            return globalConfig;
          }

          return null;
        },
      );
    };

    test("should promote the request to MasterAdmin and populate userAuthorization", async () => {
      mockMasterKeyEnabled();

      const masterAdmin: User = new User();
      masterAdmin._id = masterAdminUserId.toString();
      masterAdmin.email = new Email("master@oneuptime.com");
      masterAdmin.name = new Name("Master Admin");

      spyUserFindOneBy.mockResolvedValue(masterAdmin);

      const req: Partial<ExpressRequest> = {
        headers: { apikey: masterApiKeyValue.toString() },
      };

      await runMiddleware(req);

      expect(next).toHaveBeenCalledTimes(1);
      expect(next.mock.calls[0]).toEqual([]);

      const oneUptimeRequest: OneUptimeRequest = req as OneUptimeRequest;

      expect(oneUptimeRequest.userType).toEqual(UserType.MasterAdmin);
      expect(oneUptimeRequest.userAuthorization?.userId.toString()).toEqual(
        masterAdminUserId.toString(),
      );
      expect(oneUptimeRequest.userAuthorization?.isMasterAdmin).toStrictEqual(
        true,
      );
      expect(oneUptimeRequest.userAuthorization?.isGlobalLogin).toStrictEqual(
        true,
      );
      expect(oneUptimeRequest.userAuthorization?.email.toString()).toEqual(
        "master@oneuptime.com",
      );
      expect(oneUptimeRequest.userAuthorization?.name?.toString()).toEqual(
        "Master Admin",
      );

      // The project-key branch never ran: there is no tenant to scope this to.
      expect(oneUptimeRequest.userTenantAccessPermission).toBeUndefined();
    });

    /*
     * SECURITY: enabling the master key must not turn every other key into a
     * master key. A well-formed key that is neither a project key nor THE
     * master key is still just an invalid key, and the request must not leave
     * this middleware wearing MasterAdmin.
     */
    test("should not promote a different well-formed key to MasterAdmin while the master key is enabled", async () => {
      mockMasterKeyEnabled();

      const masterAdmin: User = new User();
      masterAdmin._id = masterAdminUserId.toString();
      masterAdmin.email = new Email("master@oneuptime.com");
      masterAdmin.name = new Name("Master Admin");

      spyUserFindOneBy.mockResolvedValue(masterAdmin);

      const req: Partial<ExpressRequest> = {
        // Not the master key, and findApiKey does not know it either.
        headers: { apikey: apiKeyValue.toString() },
      };

      await runMiddleware(req);

      const error: Exception = getErrorPassedToNext();

      expect(error).toBeInstanceOf(BadDataException);
      expect(error.message).toEqual("Invalid API Key");

      const oneUptimeRequest: OneUptimeRequest = req as OneUptimeRequest;

      expect(oneUptimeRequest.userType).not.toEqual(UserType.MasterAdmin);
      expect(oneUptimeRequest.userAuthorization).toBeUndefined();
      // The master admin row is never fetched for a key that did not match.
      expect(spyUserFindOneBy).not.toHaveBeenCalled();
    });

    /*
     * The master key is enabled but the instance has no master admin row. The
     * caller gets a message that names the actual misconfiguration, instead of
     * falling through to a generic "Invalid API Key" that would send an
     * operator hunting for a key problem that does not exist.
     */
    test("should call next with a BadDataException naming the missing master admin user", async () => {
      mockMasterKeyEnabled();
      spyUserFindOneBy.mockResolvedValue(null);

      const req: Partial<ExpressRequest> = {
        headers: { apikey: masterApiKeyValue.toString() },
      };

      await runMiddleware(req);

      const error: Exception = getErrorPassedToNext();

      expect(error).toBeInstanceOf(BadDataException);
      expect(error.message).toEqual(
        "Master Admin user not found. Please make sure you have created a master admin user.",
      );
      expect((req as OneUptimeRequest).userAuthorization).toBeUndefined();
    });
  });

  /*
   * Everything leaves through next(err). The middleware wraps its whole body in
   * a try/catch, so even an unexpected failure from the cached key lookup must
   * be handed to Express rather than rejecting — an unhandled rejection inside
   * an async middleware never reaches the error translator, so the client would
   * hang until the request times out.
   */
  test("should hand an unexpected lookup failure to next instead of rejecting", async () => {
    const lookupFailure: Error = new Error("connection terminated");

    spyFindApiKey.mockRejectedValue(lookupFailure);

    const req: Partial<ExpressRequest> = {
      headers: { apikey: apiKeyValue.toString() },
    };

    await expect(runMiddleware(req)).resolves.toBeUndefined();

    expect(next).toHaveBeenCalledTimes(1);
    expect(next.mock.calls[0]![0]).toBe(lookupFailure);
  });
});
