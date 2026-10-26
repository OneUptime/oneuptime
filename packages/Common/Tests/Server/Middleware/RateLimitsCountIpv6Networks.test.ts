import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * EVERY RATE LIMIT THAT COUNTS A CLIENT ADDRESS COUNTS ITS IPV6 /64 TOO.
 *
 * One IPv6 host is commonly given a whole /64, and can send every request
 * from another address of it, so every limit that counts a client address
 * counts the /64 as well, with room for ten addresses
 * (ClientRateLimitCounter).
 *
 * Each limit below is driven through its real middleware (or the call its
 * route makes), with requests that arrive the way they do through our
 * Nginx - X-Forwarded-For ends with the address the proxy saw - and a Redis
 * that counts the way Redis does (FakeCounterRedis). For each one:
 *
 *  - a host that sends every request from another address of one /64 is
 *    held to ten addresses' worth of the limit, then refused with the
 *    limit's usual answer;
 *  - so is one that rotates the account, dashboard, form or link as well;
 *  - another /64, and an IPv4 client, keep their own allowance;
 *  - one address over its own limit is refused there, as always, and the
 *    rest of its /64 keeps the rest of the /64's allowance;
 *  - an IPv4 client is held to exactly the limit it always had.
 */

jest.mock("../../../Server/Infrastructure/Redis", () => {
  return {
    __esModule: true,
    default: {
      getClient: jest.fn(),
      isConnected: jest.fn(),
    },
  };
});

jest.mock("../../../Server/Utils/Logger", () => {
  return {
    __esModule: true,
    default: {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    },
    getLogAttributesFromRequest: jest.fn().mockReturnValue({}),
  };
});

jest.mock("../../../Server/Utils/Response", () => {
  return {
    __esModule: true,
    default: {
      sendErrorResponse: jest.fn(),
    },
  };
});

import Redis from "../../../Server/Infrastructure/Redis";
import Response from "../../../Server/Utils/Response";
import logger from "../../../Server/Utils/Logger";
import FakeCounterRedis from "../TestingUtils/Redis/FakeCounterRedis";
import { getIpv6NetworkRateLimit } from "../../../Server/Utils/ClientIp";
import IdentityRateLimit, {
  IDENTITY_RATE_LIMITED_MESSAGE,
  IdentityRateLimitBucket,
  VERIFICATION_EMAIL_RESEND_RATE_LIMITED_MESSAGE,
} from "../../../Server/Middleware/IdentityRateLimit";
import VerificationCodeRateLimit, {
  VerificationCodeRateLimitBucket,
} from "../../../Server/Middleware/VerificationCodeRateLimit";
import PublicDashboardRateLimit, {
  PublicDashboardRateLimitBucket,
} from "../../../Server/Middleware/PublicDashboardRateLimit";
import FormRateLimit, {
  FORM_READ_RATE_LIMIT_MESSAGE,
  FORM_SUBMIT_RATE_LIMIT_MESSAGE,
  FormRateLimitBucket,
} from "../../../Server/Middleware/FormRateLimit";
import OnCallCalendarFeedRateLimit from "../../../Server/Middleware/OnCallCalendarFeedRateLimit";
import McpOAuthRateLimit, {
  McpOAuthRateLimitBucket,
} from "../../../Server/Middleware/McpOAuthRateLimit";
import RunbookWebhookRateLimit, {
  RunbookWebhookRateLimitDecision,
  RunbookWebhookRateLimitOutcome,
} from "../../../Server/Utils/Runbook/RunbookWebhookRateLimit";
import PublicMessageRateLimit, {
  PublicMessageKind,
  PublicMessageRateLimitException,
  PublicMessageRateLimitScope,
} from "../../../Server/Utils/RateLimit/PublicMessageRateLimit";
import { RUNBOOK_WEBHOOK_CALLS_PER_ADDRESS_PER_MINUTE } from "../../../Types/Runbook/RunbookWebhook";
import ClusterKeyAuthorization from "../../../Server/Middleware/ClusterKeyAuthorization";
import {
  WRONG_CLUSTER_KEYS_MESSAGE,
  WRONG_CLUSTER_KEYS_PER_ADDRESS,
} from "../../../Server/Utils/RateLimit/WrongClusterKeyLimit";
import WrongComponentKeyLimit, {
  ComponentKeyKind,
  WRONG_AGENT_KEYS_MESSAGE,
  WRONG_COMPONENT_KEYS_PER_ADDRESS,
  WRONG_PROBE_KEYS_MESSAGE,
  WRONG_PROBE_REGISTRATION_KEYS_MESSAGE,
} from "../../../Server/Utils/RateLimit/WrongComponentKeyLimit";
import { WrongKeyRefusal } from "../../../Server/Utils/RateLimit/WrongKeyLimit";
import Exception from "../../../Types/Exception/Exception";
import TooManyRequestsException from "../../../Types/Exception/TooManyRequestsException";
import ExceptionCode from "../../../Types/Exception/ExceptionCode";
import ObjectID from "../../../Types/ObjectID";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../../../Server/Utils/Express";

type MockedFn = ReturnType<typeof jest.fn>;

const getClientMock: MockedFn = Redis.getClient as unknown as MockedFn;
const isConnectedMock: MockedFn = Redis.isConnected as unknown as MockedFn;
const sendErrorResponseMock: MockedFn =
  Response.sendErrorResponse as unknown as MockedFn;
const loggerWarnMock: MockedFn = logger.warn as unknown as MockedFn;

const NETWORK_PREFIX: string = "2001:db8:5:6";
const NETWORK: string = "2001:db8:5:6::/64";
const OTHER_NETWORK_PREFIX: string = "2001:db8:5:7";

// Host `index` of a /64: 2001:db8:5:6::<index>, spread over the low 64 bits.
function hostOf(index: number, prefix: string = NETWORK_PREFIX): string {
  return `${prefix}:${(index >> 16).toString(16)}:${(index & 0xffff).toString(16)}:a:b`;
}

// A real-looking id for resource `index`: a UUID v4.
function idOf(index: number): string {
  return `00000000-0000-4000-8000-${index.toString(16).padStart(12, "0")}`;
}

// A calendar feed token shape: 43 characters of base64url.
function tokenOf(index: number): string {
  return `t${index.toString(36)}`.padEnd(43, "x");
}

interface Answer {
  allowed: boolean;
  message: string | undefined;
  retryAfter: string | undefined;
}

interface Surface {
  name: string;

  /*
   * One request from `address` about resource `index` (an account, a
   * dashboard, a form, a link), through the limit's middleware.
   */
  send: (address: string, index: number) => Promise<Answer>;

  // What one address may send about one resource in the window.
  perResource: number;

  // What one address may send in the window, about every resource together.
  perClient: number;

  // The refusal the limit always answered with, unchanged.
  refusal: string;
}

// A request as it reaches the app through the bundled Nginx.
function requestFrom(
  address: string,
  extra: Record<string, unknown> = {},
): ExpressRequest {
  return {
    headers: { "x-forwarded-for": address },
    socket: { remoteAddress: "10.0.0.2" },
    params: {},
    body: {},
    ...extra,
  } as unknown as ExpressRequest;
}

type Middleware = (
  req: ExpressRequest,
  res: ExpressResponse,
  next: NextFunction,
) => Promise<void>;

async function through(
  middleware: Middleware,
  req: ExpressRequest,
): Promise<Answer> {
  const headers: Record<string, string> = {};
  const res: ExpressResponse = {
    setHeader: (name: string, value: string): void => {
      headers[name] = value;
    },
  } as unknown as ExpressResponse;

  let continued: boolean = false;
  const before: number = sendErrorResponseMock.mock.calls.length;

  await middleware(req, res, ((): void => {
    continued = true;
  }) as NextFunction);

  const error: Exception | undefined =
    sendErrorResponseMock.mock.calls.length > before
      ? (sendErrorResponseMock.mock.calls[
          sendErrorResponseMock.mock.calls.length - 1
        ]![2] as Exception)
      : undefined;

  if (error) {
    expect(error.code).toBe(ExceptionCode.TooManyRequestsException);
  }

  return {
    allowed: continued,
    message: error?.message,
    retryAfter: headers["Retry-After"],
  };
}

function identitySurface(
  bucket: IdentityRateLimitBucket,
  data: {
    perResource: number;
    perClient: number;
    refusal: string;
    // Whether the request names an account: passkeys and resends do not.
    namesAccount: boolean;
  },
): Surface {
  const middleware: Middleware = IdentityRateLimit.getMiddleware(bucket);

  return {
    name: `sign-in: ${bucket}`,
    send: (address: string, index: number): Promise<Answer> => {
      return through(
        middleware,
        requestFrom(address, {
          body: data.namesAccount
            ? { data: { email: `person-${index}@example.com` } }
            : {},
        }),
      );
    },
    perResource: data.perResource,
    perClient: data.perClient,
    refusal: data.refusal,
  };
}

function verificationSurface(bucket: VerificationCodeRateLimitBucket): Surface {
  const middleware: Middleware =
    VerificationCodeRateLimit.getMiddleware(bucket);
  const perIp: number =
    VerificationCodeRateLimit.getBucketConfig(bucket).perIpLimit;
  let sent: number = 0;

  return {
    name: `verification codes: ${bucket}`,
    /*
     * A different person and channel row every time: their counters are not
     * keyed on the address, so only the address counter is in play.
     */
    send: (address: string): Promise<Answer> => {
      sent++;

      return through(
        middleware,
        requestFrom(address, {
          body: { itemId: idOf(sent) },
          userAuthorization: { userId: new ObjectID(idOf(100000 + sent)) },
        }),
      );
    },
    perResource: perIp,
    perClient: perIp,
    refusal:
      bucket === VerificationCodeRateLimitBucket.Resend
        ? "Too many verification codes requested. Please try again later."
        : "Too many verification attempts. Please try again later.",
  };
}

function publicDashboardSurface(
  bucket: PublicDashboardRateLimitBucket,
  data: { perResource: number; perClient: number; refusal: string },
): Surface {
  const middleware: Middleware = PublicDashboardRateLimit.getMiddleware(bucket);

  return {
    name: `public pages: ${bucket}`,
    send: (address: string, index: number): Promise<Answer> => {
      return through(
        middleware,
        requestFrom(address, {
          params:
            bucket === PublicDashboardRateLimitBucket.StatusPageMasterPassword
              ? { statusPageId: idOf(index) }
              : { dashboardId: idOf(index) },
        }),
      );
    },
    ...data,
  };
}

function formSurface(bucket: FormRateLimitBucket): Surface {
  const middleware: Middleware = FormRateLimit.getMiddleware(bucket);
  const config: { perFormAndIpLimit: number; perIpLimit: number } =
    FormRateLimit.getBucketConfig(bucket);

  return {
    name: `forms: ${bucket}`,
    send: (address: string, index: number): Promise<Answer> => {
      return through(
        middleware,
        requestFrom(address, { params: { shareKey: idOf(index) } }),
      );
    },
    perResource: config.perFormAndIpLimit,
    perClient: config.perIpLimit,
    refusal:
      bucket === FormRateLimitBucket.Submit
        ? FORM_SUBMIT_RATE_LIMIT_MESSAGE
        : FORM_READ_RATE_LIMIT_MESSAGE,
  };
}

function calendarFeedSurface(): Surface {
  const middleware: Middleware = OnCallCalendarFeedRateLimit.getMiddleware();

  return {
    name: "calendar feeds",
    send: (address: string, index: number): Promise<Answer> => {
      return through(
        middleware,
        requestFrom(address, { params: { token: tokenOf(index) } }),
      );
    },
    perResource: OnCallCalendarFeedRateLimit.getConfig().perTokenLimit,
    perClient: OnCallCalendarFeedRateLimit.getConfig().perIpLimit,
    refusal: "Too many requests. Please try again later.",
  };
}

function statusPageCalendarSurface(): Surface {
  // A status page's maintenance calendar is named by the page, not a token.
  const middleware: Middleware = OnCallCalendarFeedRateLimit.getMiddleware({
    resolveTokenKey: (req: ExpressRequest): string => {
      return `page:${(req.params as Record<string, string>)["page"]}`;
    },
  });

  return {
    name: "status page maintenance calendars",
    send: (address: string, index: number): Promise<Answer> => {
      return through(
        middleware,
        requestFrom(address, { params: { page: idOf(index) } }),
      );
    },
    perResource: OnCallCalendarFeedRateLimit.getConfig().perTokenLimit,
    perClient: OnCallCalendarFeedRateLimit.getConfig().perIpLimit,
    refusal: "Too many requests. Please try again later.",
  };
}

const MCP_REFUSAL: string = "Too many MCP OAuth requests.";

function mcpOAuthSurface(bucket: McpOAuthRateLimitBucket): Surface {
  const middleware: Middleware = McpOAuthRateLimit.getMiddleware(
    bucket,
    (data: {
      req: ExpressRequest;
      res: ExpressResponse;
      statusCode: number;
    }): void => {
      expect(data.statusCode).toBe(429);
      Response.sendErrorResponse(
        data.req,
        data.res,
        new TooManyRequestsException(MCP_REFUSAL),
      );
    },
  );

  return {
    name: `MCP OAuth: ${bucket}`,
    send: (address: string): Promise<Answer> => {
      return through(middleware, requestFrom(address));
    },
    perResource: McpOAuthRateLimit.getLimit(bucket),
    perClient: McpOAuthRateLimit.getLimit(bucket),
    refusal: MCP_REFUSAL,
  };
}

const RUNBOOK_REFUSAL: string = "Too many runbook webhook calls.";

/*
 * A public route about to send a message to an address its caller names:
 * the call each route makes (PublicMessageRateLimit.assertMaySend), by
 * email, or by text message for the text allowance every kind shares.
 */
function publicMessageSurface(
  kind: PublicMessageKind,
  byText: boolean = false,
): Surface {
  const perClient: number = byText
    ? PublicMessageRateLimit.getConfig().perClientTextMessageLimit
    : PublicMessageRateLimit.getConfig().kinds[kind].perClientLimit;
  let sent: number = 0;

  return {
    name: `public messages: ${kind}${byText ? " by text message" : ""}`,
    /*
     * A different contact every time: a contact's counter is not keyed on
     * the address, so only the caller's counters are in play.
     */
    send: async (address: string): Promise<Answer> => {
      sent++;

      try {
        await PublicMessageRateLimit.assertMaySend({
          req: requestFrom(address),
          kind: kind,
          contacts: [
            byText
              ? PublicMessageRateLimit.forPhone(
                  `+1415${String(sent).padStart(7, "0")}`,
                )
              : PublicMessageRateLimit.forEmail(`person-${sent}@example.com`),
          ],
        });

        return { allowed: true, message: undefined, retryAfter: undefined };
      } catch (error) {
        expect(error).toBeInstanceOf(PublicMessageRateLimitException);

        return {
          allowed: false,
          message: (error as PublicMessageRateLimitException).message,
          retryAfter: String(
            (error as PublicMessageRateLimitException).retryAfterSeconds,
          ),
        };
      }
    },
    perResource: perClient,
    perClient: perClient,
    refusal: PublicMessageRateLimit.getRefusalMessage({
      kind: kind,
      scope: byText
        ? PublicMessageRateLimitScope.ClientTextMessages
        : PublicMessageRateLimitScope.Client,
    }),
  };
}

function runbookWebhookSurface(): Surface {
  return {
    name: "runbook webhooks",
    send: async (address: string): Promise<Answer> => {
      const decision: RunbookWebhookRateLimitDecision =
        await RunbookWebhookRateLimit.consumeForAddress(requestFrom(address));

      expect(decision.outcome).not.toBe(
        RunbookWebhookRateLimitOutcome.CounterUnavailable,
      );

      const allowed: boolean =
        decision.outcome === RunbookWebhookRateLimitOutcome.Allowed;

      return {
        allowed: allowed,
        message: allowed ? undefined : RUNBOOK_REFUSAL,
        retryAfter: decision.retryAfterSeconds
          ? String(decision.retryAfterSeconds)
          : undefined,
      };
    },
    perResource: RUNBOOK_WEBHOOK_CALLS_PER_ADDRESS_PER_MINUTE,
    perClient: RUNBOOK_WEBHOOK_CALLS_PER_ADDRESS_PER_MINUTE,
    refusal: RUNBOOK_REFUSAL,
  };
}

/*
 * The routes that take OneUptime's cluster key: a different wrong key every
 * time, so every request is a new guess. One the limit lets through is
 * answered as the wrong key it is (400), never let through; one it refuses
 * is answered 429, with Retry-After.
 */
function wrongClusterKeySurface(): Surface {
  let sent: number = 0;

  return {
    name: "wrong cluster keys",
    send: async (address: string): Promise<Answer> => {
      sent++;

      const headers: Record<string, string> = {};
      const res: ExpressResponse = {
        setHeader: (name: string, value: string): void => {
          headers[name] = value;
        },
      } as unknown as ExpressResponse;

      let continued: boolean = false;
      const before: number = sendErrorResponseMock.mock.calls.length;

      await ClusterKeyAuthorization.isAuthorizedServiceMiddleware(
        requestFrom(address, {
          headers: {
            "x-forwarded-for": address,
            clusterkey: `wrong-cluster-key-${sent}`,
          },
        }),
        res,
        ((): void => {
          continued = true;
        }) as NextFunction,
      );

      expect(continued).toBe(false);

      const error: Exception = sendErrorResponseMock.mock.calls[
        before
      ]![2] as Exception;

      if (error.code === ExceptionCode.BadDataException) {
        expect(error.message).toBe("Invalid cluster key provided");

        return { allowed: true, message: undefined, retryAfter: undefined };
      }

      expect(error.code).toBe(ExceptionCode.TooManyRequestsException);

      return {
        allowed: false,
        message: error.message,
        retryAfter: headers["Retry-After"],
      };
    },
    perResource: WRONG_CLUSTER_KEYS_PER_ADDRESS,
    perClient: WRONG_CLUSTER_KEYS_PER_ADDRESS,
    refusal: WRONG_CLUSTER_KEYS_MESSAGE,
  };
}

/*
 * Wrong probe, Runner and AI agent keys (WrongComponentKeyLimit): every
 * request presents another wrong key. A probe's or an agent's key is counted
 * for that one component, so every request here is about one probe or one
 * Runner, whichever resource it names; REGISTER_PROBE_KEY is counted for the
 * client alone. Each answers a refused client 429 with Retry-After.
 */
function wrongComponentKeySurface(
  name: string,
  kind: ComponentKeyKind,
  refusal: string,
): Surface {
  let sent: number = 0;

  return {
    name: name,
    send: async (address: string): Promise<Answer> => {
      sent++;

      const presentedKey: string = `wrong-${kind}-key-${sent}`;
      const refused: WrongKeyRefusal | null =
        kind === ComponentKeyKind.Probe || kind === ComponentKeyKind.Agent
          ? await WrongComponentKeyLimit.checkComponentKey({
              req: requestFrom(address),
              kind: kind,
              componentId: idOf(1),
              presentedKey: presentedKey,
              isKeyRight: false,
              componentExists: async (): Promise<boolean> => {
                return true;
              },
            })
          : await WrongComponentKeyLimit.checkRegistrationKey({
              req: requestFrom(address),
              kind: kind,
              presentedKey: presentedKey,
              isKeyRight: false,
            });

      if (!refused) {
        return { allowed: true, message: undefined, retryAfter: undefined };
      }

      const headers: Record<string, string> = {};

      WrongComponentKeyLimit.answerRefusal(
        requestFrom(address),
        {
          setHeader: (headerName: string, value: string): void => {
            headers[headerName] = value;
          },
        } as unknown as ExpressResponse,
        kind,
        refused,
      );

      const error: Exception = sendErrorResponseMock.mock.calls[
        sendErrorResponseMock.mock.calls.length - 1
      ]![2] as Exception;

      expect(error.code).toBe(ExceptionCode.TooManyRequestsException);

      return {
        allowed: false,
        message: error.message,
        retryAfter: headers["Retry-After"],
      };
    },
    perResource: WRONG_COMPONENT_KEYS_PER_ADDRESS,
    perClient: WRONG_COMPONENT_KEYS_PER_ADDRESS,
    refusal: refusal,
  };
}

/*
 * Every limit that counts a client address. The shipped per-address numbers
 * are restated where the limiter does not expose them, so a change to one
 * has to be made on purpose.
 */
function everySurface(): Array<Surface> {
  return [
    identitySurface(IdentityRateLimitBucket.Login, {
      perResource: 10,
      perClient: 150,
      refusal: IDENTITY_RATE_LIMITED_MESSAGE,
      namesAccount: true,
    }),
    identitySurface(IdentityRateLimitBucket.StatusPageLogin, {
      perResource: 10,
      perClient: 150,
      refusal: IDENTITY_RATE_LIMITED_MESSAGE,
      namesAccount: true,
    }),
    identitySurface(IdentityRateLimitBucket.TwoFactor, {
      perResource: 10,
      perClient: 150,
      refusal: IDENTITY_RATE_LIMITED_MESSAGE,
      namesAccount: true,
    }),
    identitySurface(IdentityRateLimitBucket.BackupCode, {
      perResource: 10,
      perClient: 150,
      refusal: IDENTITY_RATE_LIMITED_MESSAGE,
      namesAccount: true,
    }),
    identitySurface(IdentityRateLimitBucket.WebAuthnChallenge, {
      perResource: 30,
      perClient: 150,
      refusal: IDENTITY_RATE_LIMITED_MESSAGE,
      namesAccount: true,
    }),
    identitySurface(IdentityRateLimitBucket.Passkey, {
      perResource: 300,
      perClient: 300,
      refusal: IDENTITY_RATE_LIMITED_MESSAGE,
      namesAccount: false,
    }),
    identitySurface(IdentityRateLimitBucket.VerificationEmailResend, {
      perResource: 20,
      perClient: 20,
      refusal: VERIFICATION_EMAIL_RESEND_RATE_LIMITED_MESSAGE,
      namesAccount: false,
    }),
    verificationSurface(VerificationCodeRateLimitBucket.Verify),
    verificationSurface(VerificationCodeRateLimitBucket.Resend),
    publicDashboardSurface(PublicDashboardRateLimitBucket.Read, {
      perResource: 600,
      perClient: 1800,
      refusal: "Too many requests. Please try again later.",
    }),
    publicDashboardSurface(PublicDashboardRateLimitBucket.MasterPassword, {
      perResource: 15,
      perClient: 45,
      refusal: "Too many password attempts. Please try again later.",
    }),
    publicDashboardSurface(
      PublicDashboardRateLimitBucket.StatusPageMasterPassword,
      {
        perResource: 15,
        perClient: 45,
        refusal: "Too many password attempts. Please try again later.",
      },
    ),
    formSurface(FormRateLimitBucket.Read),
    formSurface(FormRateLimitBucket.Submit),
    calendarFeedSurface(),
    statusPageCalendarSurface(),
    mcpOAuthSurface(McpOAuthRateLimitBucket.Authorize),
    mcpOAuthSurface(McpOAuthRateLimitBucket.Token),
    mcpOAuthSurface(McpOAuthRateLimitBucket.Register),
    mcpOAuthSurface(McpOAuthRateLimitBucket.Revoke),
    mcpOAuthSurface(McpOAuthRateLimitBucket.Consent),
    runbookWebhookSurface(),
    publicMessageSurface(PublicMessageKind.StatusPageSignUp),
    publicMessageSurface(PublicMessageKind.StatusPageSignUp, true),
    publicMessageSurface(PublicMessageKind.StatusPageManageLink),
    publicMessageSurface(PublicMessageKind.StatusPageManageLink, true),
    publicMessageSurface(PublicMessageKind.StatusPagePasswordReset),
    publicMessageSurface(PublicMessageKind.PasswordReset),
    publicMessageSurface(PublicMessageKind.SignUpEmail),
    wrongClusterKeySurface(),
    wrongComponentKeySurface(
      "wrong keys for one probe",
      ComponentKeyKind.Probe,
      WRONG_PROBE_KEYS_MESSAGE,
    ),
    wrongComponentKeySurface(
      "wrong keys for one Runner or AI agent",
      ComponentKeyKind.Agent,
      WRONG_AGENT_KEYS_MESSAGE,
    ),
    wrongComponentKeySurface(
      "wrong probe registration keys",
      ComponentKeyKind.ProbeRegistration,
      WRONG_PROBE_REGISTRATION_KEYS_MESSAGE,
    ),
  ];
}

let redis: FakeCounterRedis;
let currentTime: number;
let testIndex: number = 0;

beforeEach(() => {
  jest.clearAllMocks();

  redis = new FakeCounterRedis();
  getClientMock.mockReturnValue(redis);
  isConnectedMock.mockReturnValue(true);

  /*
   * The start of an hour (every window here divides one), a day further on
   * for each test, so no window - and no log throttle - carries over.
   */
  testIndex++;
  currentTime = Date.UTC(2031, 0, 1) + testIndex * 24 * 60 * 60 * 1000;
  jest.spyOn(Date, "now").mockImplementation((): number => {
    return currentTime;
  });
});

afterEach(() => {
  jest.restoreAllMocks();
});

// How many of `count` requests are let through, sent one after another.
async function allowedOf(
  count: number,
  request: (index: number) => Promise<Answer>,
): Promise<{ allowed: number; last: Answer | undefined }> {
  let allowed: number = 0;
  let last: Answer | undefined = undefined;

  for (let index: number = 0; index < count; index++) {
    last = await request(index);

    if (last.allowed) {
      allowed++;
    }
  }

  return { allowed: allowed, last: last };
}

describe.each(
  everySurface().map((surface: Surface): [string, Surface] => {
    return [surface.name, surface];
  }),
)("%s", (_name: string, surface: Surface) => {
  test("a host that sends from address after address of one /64, about one resource, is held to ten addresses' worth", async () => {
    const networkLimit: number = getIpv6NetworkRateLimit(surface.perResource);

    const { allowed, last } = await allowedOf(
      networkLimit + 25,
      (index: number): Promise<Answer> => {
        return surface.send(hostOf(index + 1), 1);
      },
    );

    expect(allowed).toBe(networkLimit);
    expect(last).toEqual({
      allowed: false,
      message: surface.refusal,
      retryAfter: expect.stringMatching(/^[1-9][0-9]*$/),
    });
  });

  test("rotating the resource as well buys nothing past the /64's ten addresses' worth", async () => {
    const networkLimit: number = getIpv6NetworkRateLimit(surface.perClient);

    const { allowed, last } = await allowedOf(
      networkLimit + 25,
      (index: number): Promise<Answer> => {
        return surface.send(hostOf(index + 1), index + 1);
      },
    );

    expect(allowed).toBe(networkLimit);
    expect(last?.allowed).toBe(false);
    expect(last?.message).toBe(surface.refusal);
  });

  test("a full /64 refuses only itself: another /64 and an IPv4 client are let through", async () => {
    const networkLimit: number = getIpv6NetworkRateLimit(surface.perClient);

    await allowedOf(networkLimit + 1, (index: number): Promise<Answer> => {
      return surface.send(hostOf(index + 1), index + 1);
    });

    expect((await surface.send(hostOf(999999), 1)).allowed).toBe(false);
    expect(
      (await surface.send(hostOf(1, OTHER_NETWORK_PREFIX), 1)).allowed,
    ).toBe(true);
    expect((await surface.send("203.0.113.7", 1)).allowed).toBe(true);
  });

  test("one address over its own limit is refused there, and the rest of its /64 keeps the rest of the /64's allowance", async () => {
    const networkLimit: number = getIpv6NetworkRateLimit(surface.perResource);

    const noisy: { allowed: number } = await allowedOf(
      surface.perResource + 40,
      (): Promise<Answer> => {
        return surface.send(hostOf(1), 1);
      },
    );

    expect(noisy.allowed).toBe(surface.perResource);

    const neighbours: { allowed: number } = await allowedOf(
      networkLimit,
      (index: number): Promise<Answer> => {
        return surface.send(hostOf(index + 2), 1);
      },
    );

    expect(neighbours.allowed).toBe(networkLimit - surface.perResource);
  });

  test("an IPv4 client is held to exactly the limit it always had", async () => {
    const { allowed, last } = await allowedOf(
      surface.perResource + 5,
      (): Promise<Answer> => {
        return surface.send("203.0.113.7", 1);
      },
    );

    expect(allowed).toBe(surface.perResource);
    expect(last?.message).toBe(surface.refusal);
    expect(redis.keysHolding("/64")).toEqual([]);
  });

  test("the first refusal for a /64 names it in the log, once", async () => {
    const networkLimit: number = getIpv6NetworkRateLimit(surface.perResource);

    await allowedOf(networkLimit + 30, (index: number): Promise<Answer> => {
      return surface.send(hostOf(index + 1), 1);
    });

    const naming: Array<string> = loggerWarnMock.mock.calls
      .map((call: Array<unknown>): string => {
        return String(call[0]);
      })
      .filter((line: string): boolean => {
        return line.includes(`limit of ${NETWORK}`);
      });

    // The runbook route logs refusals itself; its counter says only why.
    if (surface.name === "runbook webhooks") {
      expect(naming).toEqual([]);
      return;
    }

    expect(naming).toHaveLength(1);
  });
});

describe("adding a notification method", () => {
  const PROJECT: string = idOf(424242);

  async function add(address: string, index: number): Promise<boolean> {
    const req: ExpressRequest = requestFrom(address, {
      userAuthorization: { userId: new ObjectID(idOf(200000 + index)) },
    });

    (req as unknown as { tenantId: ObjectID }).tenantId = new ObjectID(PROJECT);

    try {
      await VerificationCodeRateLimit.checkAddAllowed({
        req: req,
        res: { setHeader: (): void => {} } as unknown as ExpressResponse,
        channel: "/user-sms",
      });

      return true;
    } catch (error) {
      expect((error as Exception).code).toBe(
        ExceptionCode.TooManyRequestsException,
      );

      return false;
    }
  }

  test("people adding numbers from address after address of one /64 are held to ten addresses' worth", async () => {
    const perIp: number = VerificationCodeRateLimit.getBucketConfig(
      VerificationCodeRateLimitBucket.Add,
    ).perIpLimit;

    let allowed: number = 0;

    for (
      let index: number = 0;
      index < getIpv6NetworkRateLimit(perIp) + 20;
      index++
    ) {
      if (await add(hostOf(index + 1), index)) {
        allowed++;
      }
    }

    expect(allowed).toBe(getIpv6NetworkRateLimit(perIp));
    expect(await add(hostOf(1, OTHER_NETWORK_PREFIX), 999999)).toBe(true);
  });
});
