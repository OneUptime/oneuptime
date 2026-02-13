import ProjectMiddleware from "../../../Server/Middleware/ProjectAuthorization";
import UserMiddleware from "../../../Server/Middleware/UserAuthorization";
import AccessTokenService from "../../../Server/Services/AccessTokenService";
import ProjectService from "../../../Server/Services/ProjectService";
import UserService from "../../../Server/Services/UserService";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../../../Server/Utils/Express";
import JSONWebToken from "../../../Server/Utils/JsonWebToken";
import logger from "../../../Server/Utils/Logger";
import Response from "../../../Server/Utils/Response";
import Dictionary from "../../../Types/Dictionary";
import Email from "../../../Types/Email";
import BadDataException from "../../../Types/Exception/BadDataException";
import NotAuthenticatedException from "../../../Types/Exception/NotAuthenticatedException";
import SsoAuthorizationException from "../../../Types/Exception/SsoAuthorizationException";
import HashedString from "../../../Types/HashedString";
import JSONFunctions from "../../../Types/JSONFunctions";
import JSONWebTokenData from "../../../Types/JsonWebTokenData";
import ObjectID from "../../../Types/ObjectID";
import {
  UserGlobalAccessPermission,
  UserTenantAccessPermission,
} from "../../../Types/Permission";
import Project from "../../../Models/DatabaseModels/Project";
import {
  describe,
  expect,
  beforeEach,
  test,
  afterEach,
  jest,
} from "@jest/globals";
import { getJestSpyOn } from "../../../Tests/Spy";
import getJestMockFunction from "../../../Tests/MockType";
import UserPermissionUtil from "../../../Server/Utils/UserPermission/UserPermission";

jest.mock("../../../Server/Utils/Logger");
jest.mock("../../../Server/Middleware/ProjectAuthorization");
jest.mock("../../../Server/Utils/JsonWebToken");
jest.mock("../../../Server/Services/UserService");
jest.mock("../../../Server/Services/AccessTokenService");
jest.mock("../../../Server/Utils/Response");
jest.mock("../../../Server/Services/ProjectService");
jest.mock("../../../Types/HashedString");
jest.mock("../../../Types/JSONFunctions");

type StringOrUndefined = string | undefined;

describe("UserMiddleware", () => {
  const mockedAccessToken: string = ObjectID.generate().toString();
  const projectId: ObjectID = ObjectID.generate();
  const userId: ObjectID = ObjectID.generate();
  const mockedProject: Project = { _id: projectId.toString() } as Project;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("getAccessTokenFromExpressRequest", () => {
    test("should return access token when authorization token is passed in the cookie", () => {
      const req: ExpressRequest = {
        cookies: { "user-token": mockedAccessToken },
        query: {},
      } as any;

      const result: StringOrUndefined =
        UserMiddleware.getAccessTokenFromExpressRequest(req);

      expect(result).toEqual(mockedAccessToken);
    });

    test("should return null when authorization nor accessToken is passed", () => {
      const req: ExpressRequest = {
        cookies: {},
        headers: {},
        query: {},
      } as ExpressRequest;

      const result: StringOrUndefined =
        UserMiddleware.getAccessTokenFromExpressRequest(req);

      expect(result).toBeUndefined();
    });
  });

  describe("getSsoTokens", () => {
    beforeEach(() => {
      jest.clearAllMocks();
    });

    const req: Partial<ExpressRequest> = {
      cookies: { "sso-token": mockedAccessToken },
    };

    test("should return an empty object when ssoToken is not passed", () => {
      const result: Dictionary<string> = UserMiddleware.getSsoTokens({
        headers: {},
      } as ExpressRequest);

      expect(result).toEqual({});
    });

    test("should return an empty object when ssoToken cannot be decoded", () => {
      const error: Error = new Error("Invalid token");
      const spyDecode: jest.SpyInstance = getJestSpyOn(
        JSONWebToken,
        "decode",
      ).mockImplementationOnce((_: string) => {
        throw error;
      }) as jest.SpyInstance;
      const spyErrorLogger: jest.SpyInstance = getJestSpyOn(
        logger,
        "error",
      ) as jest.SpyInstance;

      const result: Dictionary<string> = UserMiddleware.getSsoTokens(
        req as ExpressRequest,
      );

      expect(result).toEqual({});
      expect(spyDecode).toHaveBeenCalledWith(mockedAccessToken);
      expect(spyErrorLogger).toHaveBeenCalledWith(error);
    });

    test("should return an empty object when the decoded sso-token object doesn't have projectId property", () => {
      const spyDecode: jest.SpyInstance = getJestSpyOn(
        JSONWebToken,
        "decode",
      ).mockReturnValueOnce({} as JSONWebTokenData) as jest.SpyInstance;
      const spyErrorLogger: jest.SpyInstance = getJestSpyOn(
        logger,
        "error",
      ) as jest.SpyInstance;

      const result: Dictionary<string> = UserMiddleware.getSsoTokens(
        req as ExpressRequest,
      );

      expect(result).toEqual({});
      expect(spyDecode).toHaveBeenCalledWith(mockedAccessToken);
      expect(spyErrorLogger).not.toBeCalled();
    });

    test("should return a dictionary of string with projectId key", () => {
      getJestSpyOn(JSONWebToken, "decode").mockReturnValueOnce({
        projectId,
      } as JSONWebTokenData);

      const result: Dictionary<string> = UserMiddleware.getSsoTokens(
        req as ExpressRequest,
      );

      expect(result).toEqual({
        [projectId.toString()]: mockedAccessToken,
      });
    });
  });

  describe("doesSsoTokenForProjectExist", () => {
    const req: ExpressRequest = {} as ExpressRequest;

    beforeAll(() => {
      getJestSpyOn(UserMiddleware, "getSsoTokens").mockReturnValue({
        [projectId.toString()]: mockedAccessToken,
      });
    });

    test("should return false, when getSsoTokens does not return a value", () => {
      const spyGetSsoTokens: jest.SpyInstance = getJestSpyOn(
        UserMiddleware,
        "getSsoTokens",
      ).mockImplementationOnce(jest.fn().mockReturnValue(null));

      const result: boolean = UserMiddleware.doesSsoTokenForProjectExist(
        req,
        projectId,
        userId,
      );

      expect(result).toStrictEqual(false);
      expect(spyGetSsoTokens).toHaveBeenCalled();
    });

    test("should return false, when getSsoTokens returns a dictionary that does not contain the projectId's value as key", () => {
      const spyGetSsoTokens: jest.SpyInstance = getJestSpyOn(
        UserMiddleware,
        "getSsoTokens",
      ).mockReturnValueOnce({}) as jest.SpyInstance;

      const result: boolean = UserMiddleware.doesSsoTokenForProjectExist(
        req,
        projectId,
        userId,
      );

      expect(result).toStrictEqual(false);
      expect(spyGetSsoTokens).toHaveBeenCalledWith(req);
    });

    test("should return false, when decoded JWT object's projectId value does not match with projectId passed as parameter", () => {
      const objectId: ObjectID = ObjectID.generate();

      const spyDecode: jest.SpyInstance = getJestSpyOn(
        JSONWebToken,
        "decode",
      ).mockReturnValueOnce({
        projectId: objectId,
        userId,
      } as JSONWebTokenData) as jest.SpyInstance;

      const result: boolean = UserMiddleware.doesSsoTokenForProjectExist(
        req,
        projectId,
        userId,
      );

      expect(result).toStrictEqual(false);
      expect(spyDecode).toHaveBeenCalledWith(mockedAccessToken);
    });

    test("should return false, when decoded JWT object's userId does not match with userId passed as parameter", () => {
      const objectId: ObjectID = ObjectID.generate();

      const spyDecode: jest.SpyInstance = getJestSpyOn(
        JSONWebToken,
        "decode",
      ).mockReturnValueOnce({
        userId: objectId,
        projectId,
      } as JSONWebTokenData);

      const result: boolean = UserMiddleware.doesSsoTokenForProjectExist(
        req,
        projectId,
        userId,
      );

      expect(result).toStrictEqual(false);
      expect(spyDecode).toHaveBeenCalledWith(mockedAccessToken);
    });

    test("should return true", () => {
      getJestSpyOn(JSONWebToken, "decode").mockReturnValueOnce({
        userId,
        projectId,
      } as JSONWebTokenData);

      const result: boolean = UserMiddleware.doesSsoTokenForProjectExist(
        req,
        projectId,
        userId,
      );

      expect(result).toStrictEqual(true);
    });
  });

  describe("getUserMiddleware", () => {
    let req: ExpressRequest;
    let res: ExpressResponse;
    const next: NextFunction = getJestMockFunction();

    const hashValue: string = "hash-value";
    const mockedTenantAccessPermission: UserTenantAccessPermission = {
      projectId,
    } as UserTenantAccessPermission;
    const mockedGlobalAccessPermission: UserGlobalAccessPermission = {
      projectIds: [projectId],
    } as UserGlobalAccessPermission;

    const jwtTokenData: JSONWebTokenData = {
      userId,
      isMasterAdmin: true,
      email: new Email("test@gmail.com"),
      isGlobalLogin: true,
    };

    beforeAll(() => {
      getJestSpyOn(ProjectMiddleware, "getProjectId").mockReturnValue(
        projectId,
      );
      getJestSpyOn(ProjectMiddleware, "hasApiKey").mockReturnValue(false);
      getJestSpyOn(
        UserMiddleware,
        "getAccessTokenFromExpressRequest",
      ).mockReturnValue(mockedAccessToken);
      getJestSpyOn(JSONWebToken, "decode").mockReturnValue(jwtTokenData);
      getJestSpyOn(HashedString, "hashValue").mockResolvedValue(hashValue);
    });

    beforeEach(() => {
      req = { headers: {} } as ExpressRequest;

      res = {} as ExpressResponse;
      res.set = jest.fn() as any;
    });

    afterEach(() => {
      jest.clearAllMocks();
    });

    test("should call isValidProjectIdAndApiKeyMiddleware and return when hasApiKey returns true", async () => {
      getJestSpyOn(ProjectMiddleware, "hasApiKey").mockReturnValueOnce(true);

      const spyGetAccessToken: jest.SpyInstance = getJestSpyOn(
        UserMiddleware,
        "getAccessTokenFromExpressRequest",
      );

      await UserMiddleware.getUserMiddleware(req, res, next);

      expect(
        ProjectMiddleware.isValidProjectIdAndApiKeyMiddleware,
      ).toHaveBeenCalledWith(req, res, next);
      expect(spyGetAccessToken).not.toHaveBeenCalled();
    });

    test("should call function 'next' and return, when getAccessTokenFromExpressRequest returns a null value", async () => {
      const spyGetAccessToken: jest.SpyInstance = getJestSpyOn(
        UserMiddleware,
        "getAccessTokenFromExpressRequest",
      ).mockReturnValueOnce(undefined);

      await UserMiddleware.getUserMiddleware(req, res, next);

      expect(next).toHaveBeenCalled();
      expect(spyGetAccessToken).toHaveBeenCalledWith(req);
      expect(JSONWebToken.decode).not.toHaveBeenCalled();
    });

    test("should call Response.sendErrorResponse with NotAuthenticatedException, when accessToken can not be decoded", async () => {
      const error: Error = new Error("Invalid access token");

      const spyJWTDecode: jest.SpyInstance = getJestSpyOn(
        JSONWebToken,
        "decode",
      ).mockImplementationOnce((_: string) => {
        throw error;
      });

      await UserMiddleware.getUserMiddleware(req, res, next);

      expect(Response.sendErrorResponse).toHaveBeenCalledWith(
        req,
        res,
        new NotAuthenticatedException(
          "AccessToken is invalid or expired. Please refresh your token.",
        ),
      );
      expect(next).not.toHaveBeenCalled();
      expect(spyJWTDecode).toHaveBeenCalledWith(mockedAccessToken);
      expect(UserService.updateOneBy).not.toHaveBeenCalled();
    });

    test("should set global-permissions and global-permissions-hash in the response header, when user has global access permission", async () => {
      getJestSpyOn(ProjectMiddleware, "getProjectId").mockReturnValueOnce(null);
      getJestSpyOn(JSONFunctions, "serialize").mockReturnValueOnce({});
      const spyGetUserGlobalAccessPermission: jest.SpyInstance = getJestSpyOn(
        AccessTokenService,
        "getUserGlobalAccessPermission",
      ).mockResolvedValueOnce(mockedGlobalAccessPermission);

      await UserMiddleware.getUserMiddleware(req, res, next);

      expect(res.set).toHaveBeenCalledWith(
        "global-permissions",
        JSON.stringify({}),
      );
      expect(res.set).toHaveBeenCalledWith(
        "global-permissions-hash",
        hashValue,
      );
      expect(next).toHaveBeenCalled();
      expect(spyGetUserGlobalAccessPermission).toHaveBeenCalledWith(userId);
    });

    test("should not set global-permissions and global-permissions-hash in the response header, when user does not have global access permission", async () => {
      getJestSpyOn(ProjectMiddleware, "getProjectId").mockReturnValueOnce(null);
      const spyGetUserGlobalAccessPermission: jest.SpyInstance = getJestSpyOn(
        AccessTokenService,
        "getUserGlobalAccessPermission",
      ).mockResolvedValueOnce(null);

      await UserMiddleware.getUserMiddleware(req, res, next);

      expect(res.set).not.toHaveBeenCalledWith(
        "global-permissions",
        expect.anything(),
      );
      expect(res.set).not.toHaveBeenCalledWith(
        "global-permissions-hash",
        expect.anything(),
      );
      expect(next).toHaveBeenCalled();
      expect(spyGetUserGlobalAccessPermission).toHaveBeenCalledWith(userId);
    });

    test("should call Response.sendErrorResponse, when tenantId is passed in the header and getUserTenantAccessPermissionWithTenantId throws an exception", async () => {
      const spyGetUserTenantAccessPermissionWithTenantId: jest.SpyInstance =
        getJestSpyOn(
          UserMiddleware,
          "getUserTenantAccessPermissionWithTenantId",
        ).mockRejectedValueOnce(new SsoAuthorizationException());

      await UserMiddleware.getUserMiddleware(req, res, next);

      expect(Response.sendErrorResponse).toHaveBeenCalledWith(
        req,
        res,
        new SsoAuthorizationException(),
      );
      expect(spyGetUserTenantAccessPermissionWithTenantId).toHaveBeenCalledWith(
        {
          req,
          tenantId: projectId,
          userId,
          isGlobalLogin: true,
        },
      );
      expect(next).not.toBeCalled();
    });

    test("should set project-permissions and project-permissions-hash in the response header, when tenantId is passed in the header and user has tenant access permission", async () => {
      getJestSpyOn(JSONFunctions, "serialize").mockReturnValueOnce({});
      const spyGetUserTenantAccessPermissionWithTenantId: jest.SpyInstance =
        getJestSpyOn(
          UserMiddleware,
          "getUserTenantAccessPermissionWithTenantId",
        ).mockResolvedValueOnce(mockedTenantAccessPermission);

      await UserMiddleware.getUserMiddleware(req, res, next);

      expect(res.set).toHaveBeenCalledWith(
        "project-permissions",
        JSON.stringify({}),
      );
      expect(res.set).toHaveBeenCalledWith(
        "project-permissions-hash",
        hashValue,
      );
      expect(next).toHaveBeenCalled();

      expect(spyGetUserTenantAccessPermissionWithTenantId).toHaveBeenCalledWith(
        {
          req,
          tenantId: projectId,
          userId,
          isGlobalLogin: true,
        },
      );
    });

    test("should not call getUserTenantAccessPermissionForMultiTenant, when is-multi-tenant-query is set in the request header and but userGlobalAccessPermission's projectIds length is zero", async () => {
      const mockedRequest: Partial<ExpressRequest> = {
        headers: { "is-multi-tenant-query": "yes" },
      };

      getJestSpyOn(
        AccessTokenService,
        "getUserGlobalAccessPermission",
      ).mockResolvedValueOnce({
        ...mockedGlobalAccessPermission,
        projectIds: [],
      });
      getJestSpyOn(
        UserMiddleware,
        "getUserTenantAccessPermissionWithTenantId",
      ).mockResolvedValueOnce(null);
      const spyGetUserTenantAccessPermissionForMultiTenant: jest.SpyInstance =
        getJestSpyOn(
          UserMiddleware,
          "getUserTenantAccessPermissionForMultiTenant",
        );

      await UserMiddleware.getUserMiddleware(
        mockedRequest as ExpressRequest,
        res,
        next,
      );

      expect(res.set).not.toHaveBeenCalledWith(
        "project-permissions",
        expect.anything(),
      );
      expect(res.set).not.toHaveBeenCalledWith(
        "project-permissions-hash",
        expect.anything(),
      );
      expect(next).toHaveBeenCalled();
      expect(
        spyGetUserTenantAccessPermissionForMultiTenant,
      ).not.toHaveBeenCalled();
    });

    test("should set project-permissions and project-permissions-hash in the response header, when is-multi-tenant-query is set in the request header and getUserTenantAccessPermissionForMultiTenant returned access permission", async () => {
      const mockedRequest: Partial<ExpressRequest> = {
        headers: { "is-multi-tenant-query": "yes" },
      };

      getJestSpyOn(JSONFunctions, "serialize").mockReturnValue({});
      getJestSpyOn(
        AccessTokenService,
        "getUserGlobalAccessPermission",
      ).mockResolvedValueOnce(mockedGlobalAccessPermission);
      getJestSpyOn(
        UserMiddleware,
        "getUserTenantAccessPermissionWithTenantId",
      ).mockResolvedValueOnce(null);
      const spyGetUserTenantAccessPermissionForMultiTenant: jest.SpyInstance =
        getJestSpyOn(
          UserMiddleware,
          "getUserTenantAccessPermissionForMultiTenant",
        ).mockResolvedValueOnce({
          [projectId.toString()]: mockedTenantAccessPermission,
        });

      await UserMiddleware.getUserMiddleware(
        mockedRequest as ExpressRequest,
        res,
        next,
      );

      expect(res.set).toHaveBeenCalledWith(
        "project-permissions",
        JSON.stringify({}),
      );
      expect(res.set).toHaveBeenCalledWith(
        "project-permissions-hash",
        hashValue,
      );
      expect(next).toHaveBeenCalled();
      expect(
        spyGetUserTenantAccessPermissionForMultiTenant,
      ).toHaveBeenCalledWith(
        mockedRequest,
        userId,
        mockedGlobalAccessPermission.projectIds,
      );
    });

    test("should not set project-permissions and project-permissions-hash in the response header, when the project-permissions-hash set in the request header equals the projectPermissionsHash computed from userTenantAccessPermission", async () => {
      const mockedRequest: Partial<ExpressRequest> = {
        headers: { "project-permissions-hash": hashValue },
      };

      const spyGetUserTenantAccessPermissionWithTenantId: jest.SpyInstance =
        getJestSpyOn(
          UserMiddleware,
          "getUserTenantAccessPermissionWithTenantId",
        ).mockResolvedValueOnce(mockedTenantAccessPermission);

      await UserMiddleware.getUserMiddleware(
        mockedRequest as ExpressRequest,
        res,
        next,
      );

      expect(res.set).not.toHaveBeenCalledWith(
        "project-permissions",
        expect.anything(),
      );
      expect(res.set).not.toHaveBeenCalledWith(
        "project-permissions-hash",
        expect.anything(),
      );
      expect(next).toHaveBeenCalled();

      expect(spyGetUserTenantAccessPermissionWithTenantId).toHaveBeenCalledWith(
        {
          req: mockedRequest,
          tenantId: projectId,
          userId,
          isGlobalLogin: true,
        },
      );
    });
  });

  describe("getUserTenantAccessPermissionWithTenantId", () => {
    const req: ExpressRequest = {} as ExpressRequest;

    const spyFindOneById: jest.SpyInstance = getJestSpyOn(
      ProjectService,
      "findOneById",
    );
    const spyDoesSsoTokenForProjectExist: jest.SpyInstance = getJestSpyOn(
      UserMiddleware,
      "doesSsoTokenForProjectExist",
    );

    afterEach(() => {
      jest.clearAllMocks();
    });

    test("should throw 'Invalid tenantId' error, when project is not found for the tenantId", async () => {
      spyFindOneById.mockResolvedValueOnce(null);

      await expect(
        UserMiddleware.getUserTenantAccessPermissionWithTenantId({
          req,
          tenantId: projectId,
          userId,
          isGlobalLogin: true,
        }),
      ).rejects.toThrowError(new BadDataException("Invalid tenantId"));
      expect(spyFindOneById).toHaveBeenCalledWith({
        id: projectId,
        select: {
          requireSsoForLogin: true,
        },
        props: {
          isRoot: true,
        },
      });
    });

    test("should throw SsoAuthorizationException error, when sso login is required but sso token for the projectId does not exist", async () => {
      spyFindOneById.mockResolvedValueOnce({
        ...mockedProject,
        requireSsoForLogin: true,
      });

      spyDoesSsoTokenForProjectExist.mockReturnValueOnce(false);

      await expect(
        UserMiddleware.getUserTenantAccessPermissionWithTenantId({
          req,
          tenantId: projectId,
          userId,
          isGlobalLogin: true,
        }),
      ).rejects.toThrowError(new SsoAuthorizationException());
      expect(spyDoesSsoTokenForProjectExist).toHaveBeenCalledWith(
        req,
        projectId,
        userId,
      );
    });

    test("should return null when getUserTenantAccessPermission returns null", async () => {
      spyFindOneById.mockResolvedValueOnce(mockedProject);

      const spyGetUserTenantAccessPermission: jest.SpyInstance = getJestSpyOn(
        AccessTokenService,
        "getUserTenantAccessPermission",
      ).mockResolvedValueOnce(null);

      const result: UserTenantAccessPermission | null =
        await UserMiddleware.getUserTenantAccessPermissionWithTenantId({
          req,
          tenantId: projectId,
          userId,
          isGlobalLogin: true,
        });

      expect(result).toBeNull();
      expect(spyGetUserTenantAccessPermission).toHaveBeenLastCalledWith(
        userId,
        projectId,
      );
    });

    test("should return UserTenantAccessPermission", async () => {
      const mockedUserTenantAccessPermission: UserTenantAccessPermission = {
        projectId,
      } as UserTenantAccessPermission;

      spyFindOneById.mockResolvedValueOnce(mockedProject);

      const spyGetUserTenantAccessPermission: jest.SpyInstance = getJestSpyOn(
        AccessTokenService,
        "getUserTenantAccessPermission",
      ).mockResolvedValueOnce(mockedUserTenantAccessPermission);

      const result: UserTenantAccessPermission | null =
        await UserMiddleware.getUserTenantAccessPermissionWithTenantId({
          req,
          tenantId: projectId,
          userId,
          isGlobalLogin: true,
        });

      expect(result).toEqual(mockedUserTenantAccessPermission);
      expect(spyGetUserTenantAccessPermission).toHaveBeenLastCalledWith(
        userId,
        projectId,
      );
    });
  });

  describe("getUserTenantAccessPermissionForMultiTenant", () => {
    const req: ExpressRequest = {} as ExpressRequest;
    const mockedUserTenantAccessPermission: UserTenantAccessPermission = {
      projectId,
    } as UserTenantAccessPermission;

    const spyFindBy: jest.SpyInstance = getJestSpyOn(ProjectService, "findBy");
    const spyDoesSsoTokenForProjectExist: jest.SpyInstance = getJestSpyOn(
      UserMiddleware,
      "doesSsoTokenForProjectExist",
    );

    afterEach(() => {
      jest.clearAllMocks();
    });

    test("should return null, when projectIds length is zero", async () => {
      const result: Dictionary<UserTenantAccessPermission> | null =
        await UserMiddleware.getUserTenantAccessPermissionForMultiTenant(
          req,
          userId,
          [],
        );

      expect(result).toBeNull();
      expect(spyFindBy).not.toBeCalled();
    });

    test("should return default tenant access permission, when project for a projectId is found, sso is required for login, but sso token does not exist for that projectId", async () => {
      spyDoesSsoTokenForProjectExist.mockReturnValueOnce(false);
      spyFindBy.mockResolvedValueOnce([
        { ...mockedProject, requireSsoForLogin: true },
      ]);

      const spyGetDefaultUserTenantAccessPermission: jest.SpyInstance =
        getJestSpyOn(
          UserPermissionUtil,
          "getDefaultUserTenantAccessPermission",
        ).mockReturnValueOnce(mockedUserTenantAccessPermission);

      const result: Dictionary<UserTenantAccessPermission> | null =
        await UserMiddleware.getUserTenantAccessPermissionForMultiTenant(
          req,
          userId,
          [projectId],
        );

      expect(result).toEqual({
        [projectId.toString()]: mockedUserTenantAccessPermission,
      });
      expect(spyDoesSsoTokenForProjectExist).toHaveBeenCalledWith(
        req,
        projectId,
        userId,
      );
      expect(spyGetDefaultUserTenantAccessPermission).toHaveBeenCalledWith(
        projectId,
      );
    });

    test("should return user tenant access permission, when project for a projectId is found, sso is not required for login and project level permission exist for the projectId", async () => {
      spyFindBy.mockResolvedValueOnce([mockedProject]);

      const spyGetUserTenantAccessPermission: jest.SpyInstance = getJestSpyOn(
        AccessTokenService,
        "getUserTenantAccessPermission",
      ).mockResolvedValueOnce(mockedUserTenantAccessPermission);

      const result: Dictionary<UserTenantAccessPermission> | null =
        await UserMiddleware.getUserTenantAccessPermissionForMultiTenant(
          req,
          userId,
          [projectId],
        );

      expect(result).toEqual({
        [projectId.toString()]: mockedUserTenantAccessPermission,
      });
      expect(spyDoesSsoTokenForProjectExist).not.toBeCalled();
      expect(spyGetUserTenantAccessPermission).toHaveBeenCalledWith(
        userId,
        projectId,
      );
    });

    test("should return null, when project for a projectId is found, sso is not required for login but project level permission does not exist for the projectId", async () => {
      spyFindBy.mockResolvedValueOnce([mockedProject]);

      const spyGetUserTenantAccessPermission: jest.SpyInstance = getJestSpyOn(
        AccessTokenService,
        "getUserTenantAccessPermission",
      ).mockResolvedValueOnce(null);

      const result: Dictionary<UserTenantAccessPermission> | null =
        await UserMiddleware.getUserTenantAccessPermissionForMultiTenant(
          req,
          userId,
          [projectId],
        );

      expect(result).toBeNull();
      expect(spyGetUserTenantAccessPermission).toHaveBeenCalledWith(
        userId,
        projectId,
      );
    });

    test("should return user tenant access permission, when project for a projectId is not found, but project level permission exist for the projectId", async () => {
      spyFindBy.mockResolvedValueOnce([]);

      getJestSpyOn(
        AccessTokenService,
        "getUserTenantAccessPermission",
      ).mockResolvedValueOnce(mockedUserTenantAccessPermission);

      const result: Dictionary<UserTenantAccessPermission> | null =
        await UserMiddleware.getUserTenantAccessPermissionForMultiTenant(
          req,
          userId,
          [projectId],
        );

      expect(result).toEqual({
        [projectId.toString()]: mockedUserTenantAccessPermission,
      });
    });

    test("should return null, when project for a projectId is not found, and project level permission does not exist for the projectId", async () => {
      spyFindBy.mockResolvedValueOnce([]);

      const spyGetUserTenantAccessPermission: jest.SpyInstance = getJestSpyOn(
        AccessTokenService,
        "getUserTenantAccessPermission",
      ).mockResolvedValueOnce(null);

      const result: Dictionary<UserTenantAccessPermission> | null =
        await UserMiddleware.getUserTenantAccessPermissionForMultiTenant(
          req,
          userId,
          [projectId],
        );

      expect(result).toBeNull();
      expect(spyGetUserTenantAccessPermission).toHaveBeenCalledWith(
        userId,
        projectId,
      );
    });
  });
});
