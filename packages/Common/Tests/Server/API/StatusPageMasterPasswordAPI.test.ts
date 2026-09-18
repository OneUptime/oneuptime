import StatusPage from "../../../Models/DatabaseModels/StatusPage";
import StatusPageAPI from "../../../Server/API/StatusPageAPI";
import { EncryptionSecret } from "../../../Server/EnvironmentConfig";
import StatusPageService from "../../../Server/Services/StatusPageService";
import CookieUtil from "../../../Server/Utils/Cookie";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../../../Server/Utils/Express";
import PasswordHash from "../../../Server/Utils/PasswordHash";
import Response from "../../../Server/Utils/Response";
import BadDataException from "../../../Types/Exception/BadDataException";
import HashedString from "../../../Types/HashedString";
import ObjectID from "../../../Types/ObjectID";
import { MASTER_PASSWORD_INVALID_MESSAGE } from "../../../Types/StatusPage/MasterPassword";
import { mockRouter } from "./Helpers";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from "@jest/globals";

jest.mock("../../../Server/Utils/Express", () => {
  return {
    getRouter: () => {
      return mockRouter;
    },
  };
});

jest.mock("../../../Server/Utils/Response", () => {
  return {
    sendEntityArrayResponse: jest.fn().mockImplementation((...args: []) => {
      return args;
    }),
    sendJsonObjectResponse: jest.fn().mockImplementation((...args: []) => {
      return args;
    }),
    sendEmptySuccessResponse: jest.fn(),
    sendEntityResponse: jest.fn().mockImplementation((...args: []) => {
      return args;
    }),
    sendErrorResponse: jest.fn().mockImplementation((...args: []) => {
      return args;
    }),
  };
});

describe("StatusPageAPI master password", () => {
  const password: string = "correct horse battery staple";

  let statusPageId: ObjectID;
  let statusPage: StatusPage;
  let mockRequest: ExpressRequest;
  let mockResponse: ExpressResponse;
  let nextFunction: NextFunction;

  beforeAll(() => {
    mockRouter.routes.length = 0;
    new StatusPageAPI();
  });

  beforeEach(async () => {
    jest.clearAllMocks();

    statusPageId = ObjectID.generate();
    statusPage = new StatusPage();
    statusPage.id = statusPageId;
    statusPage.isPublicStatusPage = false;
    statusPage.enableMasterPassword = true;
    statusPage.masterPasswordSalt = PasswordHash.generateSalt();
    statusPage.masterPassword = new HashedString(
      await PasswordHash.hash({
        plainValue: password,
        salt: statusPage.masterPasswordSalt,
      }),
      true,
    );

    jest.spyOn(StatusPageService, "findOneById").mockResolvedValue(statusPage);

    mockRequest = {
      params: {
        statusPageId: statusPageId.toString(),
      },
      body: {
        password,
      },
      cookies: {},
      headers: {},
      socket: {},
      ips: [],
    } as unknown as ExpressRequest;

    mockResponse = {
      cookie: jest.fn(),
      send: jest.fn(),
      json: jest.fn(),
      status: jest.fn().mockReturnThis(),
    } as unknown as ExpressResponse;

    nextFunction = jest.fn();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("issues a status-page-scoped cookie for the correct current scrypt password", async () => {
    await mockRouter
      .match("post", "/status-page/master-password/:statusPageId")
      .handlerFunction(mockRequest, mockResponse, nextFunction);

    expect(nextFunction).not.toHaveBeenCalled();
    expect(Response.sendEmptySuccessResponse).toHaveBeenCalledWith(
      mockRequest,
      mockResponse,
    );
    expect(mockResponse.cookie).toHaveBeenCalledTimes(1);

    const cookieCall: Array<unknown> = (mockResponse.cookie as jest.Mock).mock
      .calls[0] as Array<unknown>;
    const cookieName: string = cookieCall[0] as string;
    const cookieToken: string = cookieCall[1] as string;

    expect(cookieName).toBe(
      CookieUtil.getStatusPageMasterPasswordKey(statusPageId),
    );

    const unlockedRequest: ExpressRequest = {
      cookies: {
        [cookieName]: cookieToken,
      },
      headers: {},
      socket: {},
      ips: [],
    } as unknown as ExpressRequest;

    await expect(
      StatusPageService.hasReadAccess({
        statusPageId,
        req: unlockedRequest,
      }),
    ).resolves.toEqual({ hasReadAccess: true });
  });

  it("does not rewrite a hash already using current scrypt parameters", async () => {
    const updateSpy: ReturnType<typeof jest.spyOn> = jest
      .spyOn(StatusPageService, "updateColumnsByIdWithoutHooks")
      .mockResolvedValue(undefined);

    await mockRouter
      .match("post", "/status-page/master-password/:statusPageId")
      .handlerFunction(mockRequest, mockResponse, nextFunction);

    expect(nextFunction).not.toHaveBeenCalled();
    expect(updateSpy).not.toHaveBeenCalled();
    expect(mockResponse.cookie).toHaveBeenCalledTimes(1);
  });

  it("rejects an incorrect password without issuing a cookie", async () => {
    mockRequest.body["password"] = "incorrect password";

    await mockRouter
      .match("post", "/status-page/master-password/:statusPageId")
      .handlerFunction(mockRequest, mockResponse, nextFunction);

    expect(nextFunction).toHaveBeenCalledTimes(1);
    const error: unknown = (nextFunction as jest.Mock).mock.calls[0]?.[0];

    expect(error).toBeInstanceOf(BadDataException);
    expect((error as BadDataException).message).toBe(
      MASTER_PASSWORD_INVALID_MESSAGE,
    );
    expect(mockResponse.cookie).not.toHaveBeenCalled();
    expect(Response.sendEmptySuccessResponse).not.toHaveBeenCalled();
  });

  it.each([123, { password: "nested" }, [password]])(
    "rejects a non-string password body (%p) before hash verification",
    async (invalidPassword: unknown) => {
      (mockRequest.body as Record<string, unknown>)["password"] =
        invalidPassword;
      const verifySpy: ReturnType<typeof jest.spyOn> = jest.spyOn(
        StatusPageService,
        "verifyHashedColumnValue",
      );

      await mockRouter
        .match("post", "/status-page/master-password/:statusPageId")
        .handlerFunction(mockRequest, mockResponse, nextFunction);

      expect(nextFunction).toHaveBeenCalledTimes(1);
      const error: unknown = (nextFunction as jest.Mock).mock.calls[0]?.[0];

      expect(error).toBeInstanceOf(BadDataException);
      expect((error as BadDataException).message).toBe(
        "Master password is required.",
      );
      expect(verifySpy).not.toHaveBeenCalled();
      expect(StatusPageService.findOneById).not.toHaveBeenCalled();
      expect(mockResponse.cookie).not.toHaveBeenCalled();
    },
  );

  it("uses this status page's selected salt when checking the password", async () => {
    statusPage.masterPasswordSalt = PasswordHash.generateSalt();

    await mockRouter
      .match("post", "/status-page/master-password/:statusPageId")
      .handlerFunction(mockRequest, mockResponse, nextFunction);

    expect(nextFunction).toHaveBeenCalledTimes(1);
    const error: unknown = (nextFunction as jest.Mock).mock.calls[0]?.[0];

    expect(error).toBeInstanceOf(BadDataException);
    expect((error as BadDataException).message).toBe(
      MASTER_PASSWORD_INVALID_MESSAGE,
    );
    expect(mockResponse.cookie).not.toHaveBeenCalled();
  });

  it("selects the salt needed for verification but never exposes either credential column", async () => {
    await mockRouter
      .match("post", "/status-page/master-password/:statusPageId")
      .handlerFunction(mockRequest, mockResponse, nextFunction);

    expect(StatusPageService.findOneById).toHaveBeenCalledWith(
      expect.objectContaining({
        select: expect.objectContaining({
          masterPassword: true,
          masterPasswordSalt: true,
        }),
      }),
    );
    expect(Response.sendEmptySuccessResponse).toHaveBeenCalledWith(
      mockRequest,
      mockResponse,
    );
    expect(Response.sendEntityResponse).not.toHaveBeenCalled();
    expect(Response.sendJsonObjectResponse).not.toHaveBeenCalled();
    expect(mockResponse.send).not.toHaveBeenCalled();
    expect(mockResponse.json).not.toHaveBeenCalled();

    const cookieArguments: Array<unknown> = (mockResponse.cookie as jest.Mock)
      .mock.calls[0] as Array<unknown>;
    const serializedCookieArguments: string = JSON.stringify(cookieArguments);

    expect(serializedCookieArguments).not.toContain(password);
    expect(serializedCookieArguments).not.toContain(
      statusPage.masterPassword!.toString(),
    );
    expect(serializedCookieArguments).not.toContain(
      statusPage.masterPasswordSalt,
    );
  });

  it("accepts a legacy unsalted SHA-256 password and upgrades it to scrypt", async () => {
    statusPage.masterPassword = new HashedString(
      await HashedString.hashValue(password, EncryptionSecret),
      true,
    );
    delete statusPage.masterPasswordSalt;

    const updateSpy: ReturnType<typeof jest.spyOn> = jest
      .spyOn(StatusPageService, "updateColumnsByIdWithoutHooks")
      .mockResolvedValue(undefined);

    await mockRouter
      .match("post", "/status-page/master-password/:statusPageId")
      .handlerFunction(mockRequest, mockResponse, nextFunction);

    expect(nextFunction).not.toHaveBeenCalled();
    expect(mockResponse.cookie).toHaveBeenCalledTimes(1);
    expect(updateSpy).toHaveBeenCalledTimes(1);

    const update: {
      id: ObjectID;
      data: Record<string, unknown>;
      expectedData?: Record<string, unknown>;
      skipUpdateDateColumn?: boolean;
    } = updateSpy.mock.calls[0]![0] as unknown as {
      id: ObjectID;
      data: Record<string, unknown>;
      expectedData?: Record<string, unknown>;
      skipUpdateDateColumn?: boolean;
    };

    expect(update.id.toString()).toBe(statusPageId.toString());
    expect(update.skipUpdateDateColumn).toBe(true);
    expect(update.data["masterPassword"]).toEqual(
      expect.stringMatching(/^scrypt\$/),
    );
    expect(update.data["masterPasswordSalt"]).toEqual(
      expect.stringMatching(/^[0-9a-f]{64}$/),
    );
    expect(update.expectedData).toEqual({
      masterPassword: statusPage.masterPassword!.toString(),
      masterPasswordSalt: null,
    });
    await expect(
      PasswordHash.verify({
        plainValue: password,
        storedValue: update.data["masterPassword"] as string,
        salt: update.data["masterPasswordSalt"] as string,
      }),
    ).resolves.toBe(true);
  });

  it("does not upgrade a legacy hash when the password is wrong", async () => {
    statusPage.masterPassword = new HashedString(
      await HashedString.hashValue(password, EncryptionSecret),
      true,
    );
    delete statusPage.masterPasswordSalt;
    mockRequest.body["password"] = "incorrect password";

    const updateSpy: ReturnType<typeof jest.spyOn> = jest
      .spyOn(StatusPageService, "updateColumnsByIdWithoutHooks")
      .mockResolvedValue(undefined);

    await mockRouter
      .match("post", "/status-page/master-password/:statusPageId")
      .handlerFunction(mockRequest, mockResponse, nextFunction);

    expect(nextFunction).toHaveBeenCalledTimes(1);
    expect(updateSpy).not.toHaveBeenCalled();
    expect(mockResponse.cookie).not.toHaveBeenCalled();
  });
});
