import {
  buildRequest,
  buildResponse,
  MockIdentityRouter,
} from "./IdentityRouterTestUtil";
import Express, {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "Common/Server/Utils/Express";
import BadDataException from "Common/Types/Exception/BadDataException";
import { JSONObject } from "Common/Types/JSON";
import {
  MOBILE_PASSKEY_ENROLMENT_EXPIRED_MESSAGE,
  MOBILE_PASSKEY_ENROLMENT_OPTIONS_ROUTE,
} from "Common/Types/Accounts/SecondStepEnrolment";
import MobilePasskeyEnrolmentService from "Common/Server/Services/MobilePasskeyEnrolmentService";
import IdentityRateLimit, {
  IdentityRateLimitBucket,
} from "Common/Server/Middleware/IdentityRateLimit";
import Response from "Common/Server/Utils/Response";
import "../../../FeatureSet/Identity/API/Authentication";

/*
 * POST /identity/mobile-passkey-enrolment-options (#9817): the browser page
 * the mobile app opened reads a passkey's options with the id the app was
 * answered (Server/Services/MobilePasskeyEnrolmentService). Nobody is
 * signed in: the id is the only key, read once. So the route asks the same
 * of its caller as every passkey page's request - this server's own page,
 * on the passkeys' limiter - hands over only the options, never caches
 * them, and refuses an id that is not one, was read, or expired, alike.
 */

jest.mock("Common/Server/Utils/SsoRequiredSignIn", () => {
  return (
    jest.requireActual(
      "./SsoNotRequiredStandIn",
    ) as typeof import("./SsoNotRequiredStandIn")
  ).ssoNotRequired();
});

jest.mock("Common/Server/EnvironmentConfig", () => {
  return {
    ...jest.requireActual("Common/Server/EnvironmentConfig"),
    Host: "EXAMPLE.COM:443",
    HttpProtocol: "https://",
  };
});

jest.mock("Common/Server/Utils/Express", () => {
  const actual: Record<string, unknown> = jest.requireActual(
    "Common/Server/Utils/Express",
  );
  const { createMockIdentityRouter } = jest.requireActual(
    "./IdentityRouterTestUtil",
  );
  const router: MockIdentityRouter = createMockIdentityRouter();
  return {
    ...actual,
    __esModule: true,
    default: {
      getRouter: () => {
        return router;
      },
    },
    getClientIp: () => {
      return "127.0.0.1";
    },
    extractDeviceInfo: () => {
      return { deviceBrowser: "Chrome" };
    },
    headerValueToString: () => {
      return "test-browser";
    },
  };
});

jest.mock("Common/Server/Middleware/IdentityRateLimit", () => {
  const middlewares: Record<string, jest.Mock> = {};
  return {
    __esModule: true,
    IdentityRateLimitBucket: {
      Login: "login",
      TwoFactor: "two-factor",
      BackupCode: "backup-code",
      Passkey: "passkey",
      MagicLink: "magic-link",
      SignUp: "sign-up",
      SignUpInvitation: "sign-up-invitation",
      VerificationEmailResend: "verification-email-resend",
    },
    default: {
      getMiddleware: jest.fn((bucket: string) => {
        middlewares[bucket] = middlewares[bucket] || jest.fn();
        return middlewares[bucket];
      }),
    },
  };
});

jest.mock("Common/Server/Services/MobilePasskeyEnrolmentService", () => {
  return {
    __esModule: true,
    default: {
      isAvailable: jest.fn(),
      storeOptions: jest.fn(),
      takeOptions: jest.fn(),
    },
  };
});

jest.mock("Common/Server/Utils/Logger", () => {
  return {
    __esModule: true,
    default: {
      info: jest.fn(),
      debug: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    },
    getLogAttributesFromRequest: () => {
      return {};
    },
  };
});

jest.mock("Common/Server/Utils/Response", () => {
  return {
    __esModule: true,
    default: {
      sendJsonObjectResponse: jest.fn(),
      sendEntityResponse: jest.fn(),
      sendErrorResponse: jest.fn(),
      setNoCacheHeaders: jest.fn(),
    },
  };
});

const router: MockIdentityRouter =
  Express.getRouter() as unknown as MockIdentityRouter;

const ORIGIN: string = "https://example.com";
const HAND_OFF_ID: string = "H".repeat(43);
const OPTIONS: JSONObject = {
  challenge: "c2lnbi1pbi1jaGFsbGVuZ2U",
  rp: { name: "OneUptime", id: "example.com" },
  user: { id: "dXNlcg", name: "responder@example.com" },
  authenticatorSelection: {
    residentKey: "required",
    userVerification: "required",
  },
};

async function ask(data: {
  body?: unknown;
  origin?: string | null;
}): Promise<{ res: ExpressResponse; next: jest.Mock }> {
  const req: ExpressRequest = buildRequest(
    data.body ?? { handOffId: HAND_OFF_ID },
    {
      headers: data.origin === null ? {} : { origin: data.origin ?? ORIGIN },
    },
  );
  const res: ExpressResponse = buildResponse();
  const next: jest.Mock = jest.fn();

  await router.match("post", MOBILE_PASSKEY_ENROLMENT_OPTIONS_ROUTE)(
    req,
    res,
    next as unknown as NextFunction,
  );

  return { res, next };
}

beforeEach(() => {
  jest.clearAllMocks();
  jest
    .mocked(MobilePasskeyEnrolmentService.takeOptions)
    .mockResolvedValue(OPTIONS);
});

describe(`POST ${MOBILE_PASSKEY_ENROLMENT_OPTIONS_ROUTE}`, () => {
  test("is the identity server's own route, behind the passkeys' limiter, first", () => {
    expect(MOBILE_PASSKEY_ENROLMENT_OPTIONS_ROUTE).toBe(
      "/mobile-passkey-enrolment-options",
    );

    const handlers: Array<unknown> = router.matchAll(
      "post",
      MOBILE_PASSKEY_ENROLMENT_OPTIONS_ROUTE,
    );

    // The limiter the passkey routes share, ahead of the handler.
    expect(handlers).toHaveLength(2);
    expect(handlers[0]).toBe(
      IdentityRateLimit.getMiddleware(IdentityRateLimitBucket.Passkey),
    );
  });

  test("hands this server's page the options, read once by the id, and never cached", async () => {
    const { res, next } = await ask({});

    expect(next).not.toHaveBeenCalled();
    expect(MobilePasskeyEnrolmentService.takeOptions).toHaveBeenCalledWith(
      HAND_OFF_ID,
    );
    expect(Response.setNoCacheHeaders).toHaveBeenCalledWith(res);
    expect(
      (Response.sendJsonObjectResponse as jest.Mock).mock.calls[0]![2],
    ).toEqual({ options: OPTIONS });
  });

  test("the id is what the page sent, whatever else it sent with it", async () => {
    await ask({
      body: {
        handOffId: HAND_OFF_ID,
        userId: "0ddba11c-0000-4000-8000-00000000cafe",
      },
    });

    expect(MobilePasskeyEnrolmentService.takeOptions).toHaveBeenCalledWith(
      HAND_OFF_ID,
    );
  });

  test.each([
    ["another site", "https://evil.example"],
    ["the same host over HTTP", "http://example.com"],
    ["no origin at all", null],
  ])(
    "refuses a request from %s before reading anything",
    async (_name: string, origin: string | null) => {
      const { next } = await ask({ origin });

      expect(next).toHaveBeenCalledTimes(1);
      expect(next.mock.calls[0]![0]).toBeInstanceOf(BadDataException);
      expect(MobilePasskeyEnrolmentService.takeOptions).not.toHaveBeenCalled();
      expect(Response.sendJsonObjectResponse).not.toHaveBeenCalled();
    },
  );

  test("an id that is not one, was read already or has expired is refused alike, saying to start again in the app", async () => {
    jest
      .mocked(MobilePasskeyEnrolmentService.takeOptions)
      .mockRejectedValue(
        new BadDataException(MOBILE_PASSKEY_ENROLMENT_EXPIRED_MESSAGE),
      );

    const { next } = await ask({});

    expect(next).toHaveBeenCalledTimes(1);
    expect((next.mock.calls[0]![0] as Error).message).toBe(
      MOBILE_PASSKEY_ENROLMENT_EXPIRED_MESSAGE,
    );
    expect(Response.sendJsonObjectResponse).not.toHaveBeenCalled();
  });

  test("signs nobody in, and saves nothing", async () => {
    await ask({});

    expect(Response.sendEntityResponse).not.toHaveBeenCalled();
    expect(MobilePasskeyEnrolmentService.storeOptions).not.toHaveBeenCalled();
    expect(
      JSON.stringify(
        (Response.sendJsonObjectResponse as jest.Mock).mock.calls[0]![2],
      ),
    ).not.toMatch(/accessToken|refreshToken/);
  });
});
