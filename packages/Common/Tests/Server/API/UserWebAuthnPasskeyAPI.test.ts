import UserWebAuthnAPI from "../../../Server/API/UserWebAuthnAPI";
import UserMiddleware from "../../../Server/Middleware/UserAuthorization";
import UserWebAuthnService from "../../../Server/Services/UserWebAuthnService";
import Response from "../../../Server/Utils/Response";
import { ExpressRequest, ExpressResponse } from "../../../Server/Utils/Express";
import ObjectID from "../../../Types/ObjectID";
import { mockRouter } from "./Helpers";
import { getJestSpyOn } from "../../Spy";
import { confirmEverySession } from "../TestingUtils/ReauthenticationConfirmed";
import Reauthentication from "../../../Server/Utils/Reauthentication/Reauthentication";
import ReauthenticationRequiredException from "../../../Types/Exception/ReauthenticationRequiredException";

/* These tests exercise the route contract; persistence is covered separately. */
jest.mock("../../../Server/API/BaseAPI", () => {
  return {
    __esModule: true,
    default: class {
      public entityType: any;
      public router: typeof mockRouter = mockRouter;

      public constructor(model: any) {
        this.entityType = model;
      }
    },
  };
});

jest.mock("../../../Server/API/CommonAPI", () => {
  return {
    __esModule: true,
    default: {
      // The session the route asks to have confirmed (#10155).
      getDatabaseCommonInteractionProps: jest.fn(
        async (req: { userAuthorization?: { userId?: unknown } }) => {
          return {
            userId: req.userAuthorization?.userId,
            sessionId: "session-of-the-request",
          };
        },
      ),
    },
  };
});

jest.mock("../../../Server/Middleware/UserAuthorization", () => {
  return {
    __esModule: true,
    default: {
      getUserMiddleware: jest.fn(),
      requireUserAuthentication: jest.fn(),
    },
  };
});

jest.mock("../../../Server/Services/UserWebAuthnService", () => {
  return {
    __esModule: true,
    default: { generateRegistrationOptions: jest.fn() },
  };
});

jest.mock("../../../Server/Services/UserTwoFactorBackupCodeService", () => {
  return { __esModule: true, default: {} };
});

jest.mock("../../../Server/Utils/TwoFactorBackupCodeNotification", () => {
  return { __esModule: true, default: {} };
});

jest.mock("../../../Server/Utils/Logger", () => {
  return { __esModule: true, default: { error: jest.fn() } };
});

jest.mock("../../../Server/Utils/Express", () => {
  return {
    getRouter: () => {
      return mockRouter;
    },
  };
});

jest.mock("../../../Server/Utils/Response", () => {
  return {
    sendEntityArrayResponse: jest.fn(),
    sendJsonArrayResponse: jest.fn(),
    sendJsonObjectResponse: jest.fn(),
    sendEmptySuccessResponse: jest.fn(),
    sendEntityResponse: jest.fn(),
    sendErrorResponse: jest.fn(),
    setNoCacheHeaders: jest.fn(),
  };
});

const ROUTE: string = "/user-webauthn/generate-registration-options";
const USER_ID: ObjectID = new ObjectID("11111111-1111-4111-8111-111111111111");

describe("passkey registration API", () => {
  let generate: jest.SpyInstance;

  beforeAll(() => {
    mockRouter.routes.length = 0;
    new UserWebAuthnAPI();
  });

  beforeEach(() => {
    // Every session here has confirmed it's its person's (#10155).
    confirmEverySession();

    jest.clearAllMocks();
    generate = getJestSpyOn(
      UserWebAuthnService,
      "generateRegistrationOptions",
    ).mockResolvedValue({
      options: { challenge: "challenge" },
      challenge: "challenge",
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  /*
   * getUserMiddleware resolves the session; requireUserAuthentication turns a
   * request that has none (a settings page left open until the access-token
   * cookie expired) into a 401 the browser client refreshes on, rather than
   * letting the handler dereference a missing userAuthorization. Both are
   * mocked to distinct functions so the identity check below is real: with
   * the second left out of the mock, the route would register `undefined` in
   * its place and toEqual would still match a one-element list.
   */
  test("requires authentication before allowing registration", () => {
    expect(mockRouter.match("post", ROUTE).middlewares).toStrictEqual([
      UserMiddleware.getUserMiddleware,
      UserMiddleware.requireUserAuthentication,
    ]);
  });

  test.each([true, false, undefined, "true", "false", 1, null])(
    "only an explicit boolean true enables passkey registration: %p",
    async (isPasskey: any) => {
      const request: ExpressRequest = {
        body: { isPasskey, userId: "attacker-chosen-owner" },
        userAuthorization: { userId: USER_ID },
      } as any;
      const response: ExpressResponse = {} as ExpressResponse;
      const next: jest.Mock = jest.fn();
      await mockRouter
        .match("post", ROUTE)
        .handlerFunction(request, response, next);
      expect(generate).toHaveBeenCalledWith({
        userId: USER_ID,
        isPasskey: isPasskey === true,
      });
      expect(Response.sendJsonObjectResponse).toHaveBeenCalledWith(
        request,
        response,
        { options: { challenge: "challenge" }, challenge: "challenge" },
      );
      expect(next).not.toHaveBeenCalled();
    },
  );

  test("preserves clients that send no registration options body", async () => {
    const next: jest.Mock = jest.fn();
    await mockRouter
      .match("post", ROUTE)
      .handlerFunction(
        { userAuthorization: { userId: USER_ID } } as any,
        {} as ExpressResponse,
        next,
      );
    expect(generate).toHaveBeenCalledWith({
      userId: USER_ID,
      isPasskey: false,
    });
    expect(next).not.toHaveBeenCalled();
  });

  /*
   * A key or a passkey is a way in, so its options wait until the session
   * confirms it's its person's (#10155): asked before the browser's prompt,
   * with the request's own session.
   */
  test("asks the request's session to have confirmed it's its person's before making options", async () => {
    const confirmed: jest.SpyInstance = confirmEverySession() as never;
    const next: jest.Mock = jest.fn();

    await mockRouter.match("post", ROUTE).handlerFunction(
      {
        body: { isPasskey: true },
        userAuthorization: { userId: USER_ID },
      } as any,
      {} as ExpressResponse,
      next,
    );

    expect(confirmed).toHaveBeenCalledWith({
      userId: USER_ID,
      sessionId: "session-of-the-request",
    });
    expect(confirmed.mock.invocationCallOrder[0]!).toBeLessThan(
      generate.mock.invocationCallOrder[0]!,
    );
  });

  test("a session that has not confirmed gets the refusal, and no options are made", async () => {
    const refusal: ReauthenticationRequiredException =
      new ReauthenticationRequiredException();

    getJestSpyOn(Reauthentication, "assertConfirmed").mockRejectedValue(
      refusal,
    );

    const next: jest.Mock = jest.fn();

    await mockRouter.match("post", ROUTE).handlerFunction(
      {
        body: { isPasskey: true },
        userAuthorization: { userId: USER_ID },
      } as any,
      {} as ExpressResponse,
      next,
    );

    expect(next).toHaveBeenCalledWith(refusal);
    expect(generate).not.toHaveBeenCalled();
    expect(Response.sendJsonObjectResponse).not.toHaveBeenCalled();
  });

  test("forwards storage failures without returning unusable options", async () => {
    const failure: Error = new Error("Challenge store unavailable");
    generate.mockRejectedValue(failure);
    const next: jest.Mock = jest.fn();
    await mockRouter.match("post", ROUTE).handlerFunction(
      {
        body: { isPasskey: true },
        userAuthorization: { userId: USER_ID },
      } as any,
      {} as ExpressResponse,
      next,
    );
    expect(next).toHaveBeenCalledWith(failure);
    expect(Response.sendJsonObjectResponse).not.toHaveBeenCalled();
  });
});
