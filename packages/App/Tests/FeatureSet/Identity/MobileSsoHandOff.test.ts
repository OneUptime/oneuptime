import {
  createMockIdentityRouter,
  MockIdentityRouter,
  RouteHandler,
} from "./IdentityRouterTestUtil";
import FakeMobileSsoHandOffRedis from "Common/Tests/Server/TestingUtils/Redis/FakeMobileSsoHandOffRedis";
import BadDataException from "Common/Types/Exception/BadDataException";
import ObjectID from "Common/Types/ObjectID";
import {
  MOBILE_SSO_EXCHANGE_ROUTE,
  MOBILE_SSO_HAND_OFF_EXPIRED_ERROR,
  MOBILE_SSO_HAND_OFF_EXPIRED_MESSAGE,
} from "Common/Types/SSO/MobileSsoHandOff";
import IdentityRateLimit, {
  IdentityRateLimitBucket,
} from "Common/Server/Middleware/IdentityRateLimit";
import MobileSsoHandOffService from "Common/Server/Services/MobileSsoHandOffService";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "Common/Server/Utils/Express";
import Response from "Common/Server/Utils/Response";
import {
  MOBILE_SSO_FLOW_OF_ANOTHER_BROWSER,
  MOBILE_SSO_HAND_OFF_FAILED_ERROR,
  MobileSsoSuccessParams,
  buildMobileSsoSuccessUrl,
  getMobileSsoIntentCookieName,
  getMobileSsoRelayState,
  isMobileSsoRequest,
  readMobileSsoFlowId,
  respondToMobileSsoSuccess,
  startMobileSsoHandOff,
} from "../../../FeatureSet/Identity/Utils/MobileSso";
import { beforeEach, describe, expect, jest, test } from "@jest/globals";

/*
 * ---------------------------------------------------------------------------
 * THE MOBILE APP SIGNS IN WITH SSO WITHOUT A SESSION ON ITS DEEP LINK (#9989).
 *
 * An SSO sign-in started from the app ends on oneuptime://sso-callback - a
 * custom scheme any Android app can say it handles. That link used to carry
 * the session's tokens. Now an app that starts its sign-in with a state and
 * a PKCE challenge is handed a one-time code and its state instead, and
 * redeems the code with its verifier at POST /identity/mobile-sso-exchange.
 *
 * This drives the routers' shared plumbing (Utils/MobileSso) and the
 * exchange route over the real hand-off service, on a Redis stand-in that
 * runs its scripts, through a whole sign-in: the start, the identity
 * provider's round trip (RelayState, the intent cookie), the deep link, the
 * exchange. And it holds the cases an attacker reaches for:
 *
 *   - an intercepted deep link: a code without the verifier redeems nothing,
 *     and does not spend the code for the app that holds it;
 *   - a replayed callback, a lost or forged flow: an error on the deep link,
 *     never the session;
 *   - a malformed hand-off, or Redis down: refused on the deep link, never
 *     started without one - which would end on the link that carries the
 *     session;
 *   - an app from before this, which names no hand-off: the link it always
 *     had, so it keeps working until the store releases move everyone on.
 * ---------------------------------------------------------------------------
 */

const mockRouter: MockIdentityRouter = createMockIdentityRouter();

/*
 * The server's protocol, read as the code runs: an HTTPS server - every
 * hosted one - unless a test says it is reached over plain HTTP.
 */
const mockServer: { protocol: string } = { protocol: "https://" };

jest.mock("Common/Server/EnvironmentConfig", () => {
  const actual: Record<string, unknown> = jest.requireActual(
    "Common/Server/EnvironmentConfig",
  ) as Record<string, unknown>;

  return {
    ...actual,
    __esModule: true,
    get HttpProtocol(): string {
      return mockServer.protocol;
    },
  };
});

const mockRedis: { client: FakeMobileSsoHandOffRedis; connected: boolean } = {
  client: new FakeMobileSsoHandOffRedis(),
  connected: true,
};

jest.mock("Common/Server/Infrastructure/Redis", () => {
  return {
    __esModule: true,
    default: {
      getClient: (): unknown => {
        return mockRedis.client;
      },
      isConnected: (): boolean => {
        return mockRedis.connected;
      },
    },
  };
});

jest.mock("Common/Server/Utils/Express", () => {
  const actual: Record<string, unknown> = jest.requireActual(
    "Common/Server/Utils/Express",
  ) as Record<string, unknown>;

  return {
    ...actual,
    __esModule: true,
    default: {
      getRouter: (): MockIdentityRouter => {
        return mockRouter;
      },
    },
  };
});

jest.mock("Common/Server/Middleware/IdentityRateLimit", () => {
  const middlewares: Record<string, unknown> = {};

  return {
    __esModule: true,
    IdentityRateLimitBucket: {
      MobileSsoExchange: "mobile-sso-exchange",
    },
    default: {
      getMiddleware: jest.fn((bucket: string): unknown => {
        middlewares[bucket] =
          middlewares[bucket] ||
          ((): void => {
            // The limiter itself is IdentityRateLimit's own suite's.
          });
        return middlewares[bucket];
      }),
    },
  };
});

jest.mock("Common/Server/Utils/Response", () => {
  return {
    __esModule: true,
    default: {
      setNoCacheHeaders: jest.fn(),
      sendJsonObjectResponse: jest.fn(),
    },
  };
});

// The route registers on import, onto the mock router above.
import "../../../FeatureSet/Identity/API/MobileSsoExchange";

// RFC 7636, appendix B.
const VERIFIER: string = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
const CHALLENGE: string = "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM";
const STATE: string = "a1b2c3d4".repeat(8);

const HAND_OFF_QUERY: Record<string, string> = {
  mobile: "true",
  state: STATE,
  codeChallenge: CHALLENGE,
  codeChallengeMethod: "S256",
};

const PROVIDER_ID: ObjectID = new ObjectID(
  "6570b1d3-e2f4-4a5c-8d7e-8f9010000001",
);

const SIGN_IN: MobileSsoSuccessParams = {
  accessToken: "access-token-of-the-new-session",
  refreshToken: "refresh-token-of-the-new-session",
  refreshTokenExpiresAt: new Date("2026-12-31T23:59:59.000Z"),
  userId: "11111111-1111-4111-8111-111111111111",
  email: "responder@acme.com",
  name: "Ada Responder",
  isMasterAdmin: false,
  ssoToken: "project-sso-token",
  projectId: "22222222-2222-4222-8222-222222222222",
};

const SECRETS: Array<string> = [
  SIGN_IN.accessToken,
  SIGN_IN.refreshToken,
  SIGN_IN.ssoToken!,
  SIGN_IN.email,
  SIGN_IN.userId,
];

interface FakeResponse {
  cookiesSet: Array<{ name: string; value: string }>;
  redirectedTo: Array<string>;
  express: ExpressResponse;
}

const createFakeResponse: () => FakeResponse = (): FakeResponse => {
  const cookiesSet: Array<{ name: string; value: string }> = [];
  const redirectedTo: Array<string> = [];

  return {
    cookiesSet,
    redirectedTo,
    express: {
      cookie: (name: string, value: string): void => {
        cookiesSet.push({ name, value });
      },
      clearCookie: (): void => {
        // Not what these tests watch.
      },
      redirect: (url: string): void => {
        redirectedTo.push(url);
      },
    } as unknown as ExpressResponse,
  };
};

const createFakeRequest: (data: {
  query?: Record<string, unknown>;
  body?: Record<string, unknown>;
  cookies?: Record<string, string>;
}) => ExpressRequest = (data: {
  query?: Record<string, unknown>;
  body?: Record<string, unknown>;
  cookies?: Record<string, string>;
}): ExpressRequest => {
  return {
    query: data.query || {},
    body: data.body,
    cookies: data.cookies || {},
  } as unknown as ExpressRequest;
};

const paramsOf: (deepLink: string) => URLSearchParams = (
  deepLink: string,
): URLSearchParams => {
  expect(deepLink.startsWith("oneuptime://sso-callback?")).toBe(true);

  return new URLSearchParams(deepLink.slice(deepLink.indexOf("?") + 1));
};

// The start route's work: the flow it keeps, and the cookie and RelayState.
const start: (
  query: Record<string, unknown>,
  rememberInCookie?: boolean,
) => Promise<{
  flowId: string | null;
  response: FakeResponse;
}> = async (
  query: Record<string, unknown>,
  rememberInCookie: boolean = true,
): Promise<{ flowId: string | null; response: FakeResponse }> => {
  const response: FakeResponse = createFakeResponse();
  const handOff: { flowId: string | null } | null = await startMobileSsoHandOff(
    {
      req: createFakeRequest({ query }),
      res: response.express,
      providerId: PROVIDER_ID,
      rememberInCookie,
    },
  );

  expect(handOff).not.toBeNull();

  return { flowId: handOff!.flowId, response };
};

// The identity provider's answer reaching the router, and its deep link.
const finish: (flowId: string | null) => Promise<string> = async (
  flowId: string | null,
): Promise<string> => {
  const response: FakeResponse = createFakeResponse();

  await respondToMobileSsoSuccess({
    res: response.express,
    flowId,
    signIn: SIGN_IN,
  });

  expect(response.redirectedTo).toHaveLength(1);

  return response.redirectedTo[0]!;
};

interface ExchangeResult {
  error: unknown;
  answer: unknown;
}

const exchange: (body: unknown) => Promise<ExchangeResult> = async (
  body: unknown,
): Promise<ExchangeResult> => {
  (Response.sendJsonObjectResponse as jest.Mock).mockClear();

  const handler: RouteHandler = mockRouter.match(
    "post",
    MOBILE_SSO_EXCHANGE_ROUTE,
  );
  let error: unknown = null;

  await handler(
    { body } as unknown as ExpressRequest,
    {} as unknown as ExpressResponse,
    ((err?: unknown): void => {
      error = err || null;
    }) as unknown as NextFunction,
  );

  const calls: Array<Array<unknown>> = (
    Response.sendJsonObjectResponse as jest.Mock
  ).mock.calls;

  return { error, answer: calls.length ? calls[0]![2] : null };
};

beforeEach(() => {
  mockRedis.client = new FakeMobileSsoHandOffRedis();
  mockRedis.connected = true;
  mockServer.protocol = "https://";
});

// What the browser that started `flowId`'s sign-in posts the provider's answer with.
const acsOf: (data: {
  relayState?: string | undefined;
  intentCookie?: string | undefined;
}) => ExpressRequest = (data: {
  relayState?: string | undefined;
  intentCookie?: string | undefined;
}): ExpressRequest => {
  return createFakeRequest({
    body: data.relayState === undefined ? {} : { RelayState: data.relayState },
    cookies:
      data.intentCookie === undefined
        ? {}
        : { [getMobileSsoIntentCookieName(PROVIDER_ID)]: data.intentCookie },
  });
};

describe("a whole sign-in, from the app's start to its exchange", () => {
  test("hands the app a one-time code and its state, which redeems the session with the verifier", async () => {
    const { flowId, response } = await start(HAND_OFF_QUERY);

    expect(MobileSsoHandOffService.isFlowId(flowId)).toBe(true);

    // The flow rides through SAML's round trip in RelayState and the cookie.
    expect(getMobileSsoRelayState(flowId)).toBe(`mobile:${flowId}`);
    expect(response.cookiesSet).toEqual([
      { name: getMobileSsoIntentCookieName(PROVIDER_ID), value: flowId },
    ]);

    // The provider's answer, posted by the browser that started the sign-in.
    const acs: ExpressRequest = acsOf({
      relayState: getMobileSsoRelayState(flowId),
      intentCookie: flowId!,
    });

    expect(isMobileSsoRequest({ req: acs, providerId: PROVIDER_ID })).toBe(
      true,
    );
    expect(readMobileSsoFlowId({ req: acs, providerId: PROVIDER_ID })).toBe(
      flowId,
    );

    const deepLink: string = await finish(flowId);
    const params: URLSearchParams = paramsOf(deepLink);

    expect([...params.keys()].sort()).toEqual(["code", "state"]);
    expect(params.get("state")).toBe(STATE);

    for (const secret of SECRETS) {
      expect(deepLink).not.toContain(secret);
    }

    const result: ExchangeResult = await exchange({
      code: params.get("code"),
      codeVerifier: VERIFIER,
      state: STATE,
    });

    expect(result.error).toBeNull();
    expect(result.answer).toEqual({
      accessToken: SIGN_IN.accessToken,
      refreshToken: SIGN_IN.refreshToken,
      refreshTokenExpiresAt: "2026-12-31T23:59:59.000Z",
      userId: SIGN_IN.userId,
      email: SIGN_IN.email,
      name: SIGN_IN.name,
      isMasterAdmin: false,
      ssoToken: SIGN_IN.ssoToken,
      projectId: SIGN_IN.projectId,
    });

    // The same answer the deep link used to carry, value for value.
    const legacy: URLSearchParams = paramsOf(buildMobileSsoSuccessUrl(SIGN_IN));

    for (const [key, value] of legacy.entries()) {
      expect(String((result.answer as Record<string, unknown>)[key])).toBe(
        value,
      );
    }
  });

  test("hands back a Global SSO sign-in's token, and no project's", async () => {
    const { flowId } = await start(HAND_OFF_QUERY);
    const response: FakeResponse = createFakeResponse();

    await respondToMobileSsoSuccess({
      res: response.express,
      flowId,
      signIn: {
        ...SIGN_IN,
        ssoToken: undefined,
        projectId: undefined,
        globalSsoToken: "global-sso-token",
      },
    });

    const params: URLSearchParams = paramsOf(response.redirectedTo[0]!);
    const result: ExchangeResult = await exchange({
      code: params.get("code"),
      codeVerifier: VERIFIER,
      state: STATE,
    });

    expect(result.answer).toMatchObject({ globalSsoToken: "global-sso-token" });
    expect(result.answer).not.toHaveProperty("ssoToken");
    expect(result.answer).not.toHaveProperty("projectId");
  });

  test("carries an OIDC sign-in's flow in its signed state cookie alone: no intent cookie", async () => {
    const { flowId, response } = await start(HAND_OFF_QUERY, false);

    expect(MobileSsoHandOffService.isFlowId(flowId)).toBe(true);
    expect(response.cookiesSet).toEqual([]);
    expect(
      readMobileSsoFlowId({ req: createFakeRequest({}), carried: flowId }),
    ).toBe(flowId);
  });

  test("finds the flow in the intent cookie when the identity provider drops RelayState", async () => {
    const { flowId } = await start(HAND_OFF_QUERY);
    const acs: ExpressRequest = createFakeRequest({
      body: {},
      cookies: { [getMobileSsoIntentCookieName(PROVIDER_ID)]: flowId! },
    });

    expect(isMobileSsoRequest({ req: acs, providerId: PROVIDER_ID })).toBe(
      true,
    );
    expect(readMobileSsoFlowId({ req: acs, providerId: PROVIDER_ID })).toBe(
      flowId,
    );
  });
});

describe("what an app that intercepted the deep link gets", () => {
  test("nothing for a code without the verifier, and the code stays the app's", async () => {
    const { flowId } = await start(HAND_OFF_QUERY);
    const params: URLSearchParams = paramsOf(await finish(flowId));

    for (const codeVerifier of ["x".repeat(43), CHALLENGE, undefined]) {
      const stolen: ExchangeResult = await exchange({
        code: params.get("code"),
        codeVerifier,
        state: STATE,
      });

      expect(stolen.answer).toBeNull();
      expect(stolen.error).toBeInstanceOf(BadDataException);
      expect((stolen.error as Error).message).toBe(
        MOBILE_SSO_HAND_OFF_EXPIRED_MESSAGE,
      );
    }

    const own: ExchangeResult = await exchange({
      code: params.get("code"),
      codeVerifier: VERIFIER,
      state: STATE,
    });

    expect(own.error).toBeNull();
    expect(own.answer).toMatchObject({ accessToken: SIGN_IN.accessToken });
  });

  test("nothing a second time: a code works once", async () => {
    const { flowId } = await start(HAND_OFF_QUERY);
    const params: URLSearchParams = paramsOf(await finish(flowId));
    const body: Record<string, unknown> = {
      code: params.get("code"),
      codeVerifier: VERIFIER,
      state: STATE,
    };

    expect((await exchange(body)).error).toBeNull();

    const again: ExchangeResult = await exchange(body);

    expect(again.answer).toBeNull();
    expect((again.error as Error).message).toBe(
      MOBILE_SSO_HAND_OFF_EXPIRED_MESSAGE,
    );
  });
});

describe("a sign-in that claims a hand-off it cannot finish", () => {
  test("a replayed callback ends on an error the second time, never the session", async () => {
    const { flowId } = await start(HAND_OFF_QUERY);

    paramsOf(await finish(flowId));

    const replay: string = await finish(flowId);

    expect(paramsOf(replay).get("error")).toBe(
      MOBILE_SSO_HAND_OFF_EXPIRED_ERROR,
    );
    for (const secret of SECRETS) {
      expect(replay).not.toContain(secret);
    }
  });

  test.each([
    ["a flow nobody started", "f".repeat(43)],
    ["a forged RelayState", "not-a-flow"],
    ["a flow id with more after it", `${"f".repeat(43)}&accessToken=x`],
  ])(
    "%s ends on an error, never the session",
    async (_label: string, claimed: string) => {
      const acs: ExpressRequest = acsOf({
        relayState: `mobile:${claimed}`,
        intentCookie: claimed,
      });

      expect(isMobileSsoRequest({ req: acs, providerId: PROVIDER_ID })).toBe(
        true,
      );

      const flowId: string | null = readMobileSsoFlowId({
        req: acs,
        providerId: PROVIDER_ID,
      });

      expect(flowId).toBe(claimed);

      const deepLink: string = await finish(flowId);

      expect(paramsOf(deepLink).get("error")).toBe(
        MOBILE_SSO_HAND_OFF_EXPIRED_ERROR,
      );
      expect(paramsOf(deepLink).get("errorDescription")).toBe(
        MOBILE_SSO_HAND_OFF_EXPIRED_MESSAGE,
      );
      for (const secret of SECRETS) {
        expect(deepLink).not.toContain(secret);
      }
    },
  );

  test("Redis down when the provider answers: an error on the deep link, never the session", async () => {
    const { flowId } = await start(HAND_OFF_QUERY);

    mockRedis.connected = false;

    const deepLink: string = await finish(flowId);

    expect(paramsOf(deepLink).get("error")).toBe(
      MOBILE_SSO_HAND_OFF_FAILED_ERROR,
    );
    for (const secret of SECRETS) {
      expect(deepLink).not.toContain(secret);
    }
  });
});

/*
 * RelayState rides in the address the browser is sent to the provider with,
 * where a page's Referer can carry it off. With someone's flow id, a person
 * could post their own sign-in's answer into that flow and hand the app
 * that started it a code for their own account. So on an HTTPS server a
 * flow RelayState names is taken only with the intent cookie of the browser
 * that started it.
 */
describe("a flow RelayState names, from another browser", () => {
  test("is answered as a lost flow without the intent cookie that names it", async () => {
    const { flowId } = await start(HAND_OFF_QUERY);

    for (const intentCookie of [undefined, "true", "g".repeat(43)]) {
      const acs: ExpressRequest = acsOf({
        relayState: getMobileSsoRelayState(flowId),
        intentCookie,
      });

      expect(isMobileSsoRequest({ req: acs, providerId: PROVIDER_ID })).toBe(
        true,
      );

      const claimed: string | null = readMobileSsoFlowId({
        req: acs,
        providerId: PROVIDER_ID,
      });

      expect(claimed).toBe(MOBILE_SSO_FLOW_OF_ANOTHER_BROWSER);
      expect(MobileSsoHandOffService.isFlowId(claimed)).toBe(false);

      const deepLink: string = await finish(claimed);

      expect(paramsOf(deepLink).get("error")).toBe(
        MOBILE_SSO_HAND_OFF_EXPIRED_ERROR,
      );
      expect(deepLink).not.toContain("code=");
    }

    // And the flow is still there for the browser that started it.
    const own: string = await finish(
      readMobileSsoFlowId({
        req: acsOf({
          relayState: getMobileSsoRelayState(flowId),
          intentCookie: flowId!,
        }),
        providerId: PROVIDER_ID,
      }),
    );

    expect(paramsOf(own).get("state")).toBe(STATE);
  });

  test("is taken by RelayState alone on a server reached over plain HTTP, which keeps no such cookie across the post", async () => {
    mockServer.protocol = "http://";

    const { flowId } = await start(HAND_OFF_QUERY);

    expect(
      readMobileSsoFlowId({
        req: acsOf({ relayState: getMobileSsoRelayState(flowId) }),
        providerId: PROVIDER_ID,
      }),
    ).toBe(flowId);
  });
});

describe("a start that cannot keep its hand-off", () => {
  test.each([
    ["names part of one", { mobile: "true", state: STATE }],
    [
      "asks for the plain method",
      { ...HAND_OFF_QUERY, codeChallengeMethod: "plain" },
    ],
    ["has a short challenge", { ...HAND_OFF_QUERY, codeChallenge: "abc" }],
  ])(
    "is refused on the deep link when it %s, and keeps nothing",
    async (_label: string, query: Record<string, unknown>) => {
      const response: FakeResponse = createFakeResponse();

      const handOff: { flowId: string | null } | null =
        await startMobileSsoHandOff({
          req: createFakeRequest({ query }),
          res: response.express,
          providerId: PROVIDER_ID,
          rememberInCookie: true,
        });

      expect(handOff).toBeNull();
      expect(response.cookiesSet).toEqual([]);
      expect(response.redirectedTo).toHaveLength(1);
      expect(paramsOf(response.redirectedTo[0]!).get("error")).toBe(
        MOBILE_SSO_HAND_OFF_FAILED_ERROR,
      );
      expect(mockRedis.client.entries.size).toBe(0);
    },
  );

  test("is refused on the deep link, saying why, while Redis cannot be reached", async () => {
    mockRedis.connected = false;

    const response: FakeResponse = createFakeResponse();
    const handOff: { flowId: string | null } | null =
      await startMobileSsoHandOff({
        req: createFakeRequest({ query: HAND_OFF_QUERY }),
        res: response.express,
        providerId: PROVIDER_ID,
        rememberInCookie: true,
      });

    expect(handOff).toBeNull();
    expect(paramsOf(response.redirectedTo[0]!).get("errorDescription")).toBe(
      "Signing in to the mobile app with single sign-on is unavailable right now. Try again in a minute.",
    );
  });
});

describe("an app from before the hand-off", () => {
  test("names none: no flow, the cookie and RelayState it always had, and nothing kept", async () => {
    const { flowId, response } = await start({ mobile: "true" });

    expect(flowId).toBeNull();
    expect(getMobileSsoRelayState(flowId)).toBe("mobile");
    expect(response.cookiesSet).toEqual([
      { name: getMobileSsoIntentCookieName(PROVIDER_ID), value: "true" },
    ]);
    expect(mockRedis.client.entries.size).toBe(0);
  });

  test("is handed the deep link it reads, as before", async () => {
    const acs: ExpressRequest = createFakeRequest({
      body: { RelayState: "mobile" },
      cookies: { [getMobileSsoIntentCookieName(PROVIDER_ID)]: "true" },
    });

    expect(isMobileSsoRequest({ req: acs, providerId: PROVIDER_ID })).toBe(
      true,
    );
    expect(
      readMobileSsoFlowId({ req: acs, providerId: PROVIDER_ID }),
    ).toBeNull();
    expect(await finish(null)).toBe(buildMobileSsoSuccessUrl(SIGN_IN));
  });

  test('is not told apart from a web sign-in by a cookie that is neither "true" nor a flow', () => {
    expect(
      isMobileSsoRequest({
        req: createFakeRequest({
          cookies: { [getMobileSsoIntentCookieName(PROVIDER_ID)]: "yes" },
        }),
        providerId: PROVIDER_ID,
      }),
    ).toBe(false);
  });
});

describe("POST /identity/mobile-sso-exchange", () => {
  test("is the one route of its file, behind a rate limit of its own", () => {
    expect(MOBILE_SSO_EXCHANGE_ROUTE).toBe("/mobile-sso-exchange");
    expect(
      mockRouter.routes.map((route: { method: string; uri: string }) => {
        return `${route.method} ${route.uri}`;
      }),
    ).toEqual(["POST /mobile-sso-exchange"]);

    const handlers: Array<unknown> = mockRouter.matchAll(
      "post",
      MOBILE_SSO_EXCHANGE_ROUTE,
    );

    expect(handlers).toHaveLength(2);
    expect(handlers[0]).toBe(
      IdentityRateLimit.getMiddleware(
        IdentityRateLimitBucket.MobileSsoExchange,
      ),
    );
    expect(IdentityRateLimitBucket.MobileSsoExchange).toBe(
      "mobile-sso-exchange",
    );
  });

  test("is never cached, refused or not", async () => {
    (Response.setNoCacheHeaders as jest.Mock).mockClear();

    await exchange({ code: "nope" });

    expect(Response.setNoCacheHeaders).toHaveBeenCalledTimes(1);
  });

  test("answers every refusal alike, and none with anything of a session", async () => {
    const { flowId } = await start(HAND_OFF_QUERY);
    const params: URLSearchParams = paramsOf(await finish(flowId));
    const messages: Set<string> = new Set<string>();

    for (const body of [
      undefined,
      {},
      { code: params.get("code"), codeVerifier: "y".repeat(43), state: STATE },
      {
        code: params.get("code"),
        codeVerifier: VERIFIER,
        state: "z".repeat(43),
      },
      { code: "q".repeat(43), codeVerifier: VERIFIER, state: STATE },
    ]) {
      const result: ExchangeResult = await exchange(body);

      expect(result.answer).toBeNull();
      messages.add((result.error as Error).message);
    }

    expect([...messages]).toEqual([MOBILE_SSO_HAND_OFF_EXPIRED_MESSAGE]);
  });
});
