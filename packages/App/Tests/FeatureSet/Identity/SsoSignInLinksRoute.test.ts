import {
  buildRequest,
  buildResponse,
  createMockIdentityRouter,
  MockIdentityRouter,
  RouteHandler,
} from "./IdentityRouterTestUtil";
import FakeCounterRedis from "Common/Tests/Server/TestingUtils/Redis/FakeCounterRedis";
import {
  SEND_SSO_SIGN_IN_LINKS_ROUTE,
  SSO_SIGN_IN_LINKS_CANNOT_BE_EMAILED_MESSAGE,
} from "Common/Types/Accounts/SsoSignInLinks";
import EmailTemplateType from "Common/Types/Email/EmailTemplateType";
import Exception from "Common/Types/Exception/Exception";
import ExceptionCode from "Common/Types/Exception/ExceptionCode";
import ObjectID from "Common/Types/ObjectID";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "Common/Server/Utils/Express";
import SsoSignInLinksEmail from "../../../FeatureSet/Identity/Utils/SsoSignInLinksEmail";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * ---------------------------------------------------------------------------
 * "SIGN IN WITH SSO" EMAILS AN ADDRESS ITS ORGANIZATIONS' SSO SIGN-IN LINKS,
 * ANSWERING EVERY ADDRESS ALIKE (#9987).
 *
 * POST /identity/send-sso-sign-in-links names an address. Whoever calls it
 * must learn nothing from the answer: not whether the address has an
 * account, not whether that account is blocked or an administrator's, not
 * whether it is in an organization that signs in with SSO, not which. This
 * drives the real route, the real rate limiter on a counter store that
 * counts the way Redis does, and the real background sender, with the
 * account's reads made slow on purpose - as a large table would - and holds:
 *
 *   - the same answer, status and headers for an unknown address, a blocked
 *     account, an administrator's, an account in no SSO project and one in
 *     several;
 *   - comparable timing: the answer is sent before the account is even
 *     looked up, so the slow reads never reach it, whatever the address;
 *   - the email goes only to an account in a project whose SSO is on, and to
 *     no other;
 *   - five requests to one address in an hour, from every caller together,
 *     and thirty from one caller in a quarter of an hour - counted alike for
 *     every address, so the sixth refusal says nothing either;
 *   - the captcha is asked first, an address is required, and a server that
 *     cannot send email says so to anyone.
 * ---------------------------------------------------------------------------
 */

const mockRouter: MockIdentityRouter = createMockIdentityRouter();

const redisClient: FakeCounterRedis = new FakeCounterRedis();

jest.mock("Common/Server/Infrastructure/Redis", () => {
  return {
    __esModule: true,
    default: {
      getClient: (): unknown => {
        return redisClient;
      },
      isConnected: (): boolean => {
        return true;
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
    getClientIp: (): string => {
      return "127.0.0.1";
    },
  };
});

let mockCaptchaRefusal: Error | null = null;

jest.mock("Common/Server/Utils/Captcha", () => {
  return {
    __esModule: true,
    default: {
      verifyCaptcha: (): Promise<void> => {
        return mockCaptchaRefusal
          ? Promise.reject(mockCaptchaRefusal)
          : Promise.resolve();
      },
    },
  };
});

let mockEmailNotSetUp: boolean = false;

jest.mock("Common/Server/Utils/ServerSending/ServerSendingStatus", () => {
  return {
    __esModule: true,
    default: {
      isEmailKnownNotSetUp: (): Promise<boolean> => {
        return Promise.resolve(mockEmailNotSetUp);
      },
    },
  };
});

/*
 * Every step the route and its background work take, in order: what the
 * answer is, and when each read happens, relative to it.
 */
const steps: Array<string> = [];

// How long each read of an account's data takes: a large table's.
const SLOW_READ_MS: number = 120;

const slow: <T>(value: T) => Promise<T> = <T>(value: T): Promise<T> => {
  return new Promise((resolve: (value: T) => void): void => {
    setTimeout((): void => {
      resolve(value);
    }, SLOW_READ_MS);
  });
};

const ACME: ObjectID = new ObjectID("9e000000-0000-4000-8000-0000000000a1");
const GLOBEX: ObjectID = new ObjectID("9e000000-0000-4000-8000-0000000000a2");
const NO_SSO: ObjectID = new ObjectID("9e000000-0000-4000-8000-0000000000a3");

interface AccountRow {
  id: ObjectID;
  email: string;
  isBlocked?: boolean;
  isMasterAdmin?: boolean;
  projects: Array<ObjectID>;
}

const ACCOUNTS: Array<AccountRow> = [
  {
    id: new ObjectID("9e000000-0000-4000-8000-000000000001"),
    email: "contractor@gmail.example",
    projects: [ACME, GLOBEX],
  },
  {
    id: new ObjectID("9e000000-0000-4000-8000-000000000002"),
    email: "blocked@gmail.example",
    isBlocked: true,
    projects: [ACME],
  },
  {
    id: new ObjectID("9e000000-0000-4000-8000-000000000003"),
    email: "admin@gmail.example",
    isMasterAdmin: true,
    projects: [ACME],
  },
  {
    id: new ObjectID("9e000000-0000-4000-8000-000000000004"),
    email: "no-sso@gmail.example",
    projects: [NO_SSO],
  },
];

const ADDRESSES: Record<string, string> = {
  "an address with no account": "nobody@gmail.example",
  "a blocked account": "blocked@gmail.example",
  "an administrator's account": "admin@gmail.example",
  "an account in no SSO project": "no-sso@gmail.example",
  "an account in two SSO projects": "contractor@gmail.example",
};

jest.mock("Common/Server/Services/UserService", () => {
  return {
    __esModule: true,
    default: {
      findOneBy: (data: { query: { email?: unknown } }): Promise<unknown> => {
        const email: string = String(data.query.email ?? "");
        steps.push(`read account ${email}`);

        const row: AccountRow | undefined = ACCOUNTS.find(
          (account: AccountRow): boolean => {
            return account.email === email;
          },
        );

        return slow(
          row
            ? {
                id: row.id,
                _id: row.id.toString(),
                email: {
                  toString: (): string => {
                    return row.email;
                  },
                },
                isBlocked: row.isBlocked === true,
                isMasterAdmin: row.isMasterAdmin === true,
                timezone: null,
                language: null,
              }
            : null,
        );
      },
    },
  };
});

jest.mock("Common/Server/Services/TeamMemberService", () => {
  return {
    __esModule: true,
    default: {
      findBy: (data: {
        query: { userId: ObjectID; hasAcceptedInvitation?: unknown };
      }): Promise<unknown> => {
        steps.push("read memberships");

        // Only the projects the account joined: never an invitation pending.
        expect(data.query.hasAcceptedInvitation).toBe(true);

        const row: AccountRow | undefined = ACCOUNTS.find(
          (account: AccountRow): boolean => {
            return account.id.toString() === data.query.userId.toString();
          },
        );

        return slow(
          (row?.projects || []).map((projectId: ObjectID) => {
            return { projectId: projectId };
          }),
        );
      },
    },
  };
});

/*
 * The ids an IN filter names (QueryHelper.any writes one as a Raw operator
 * with its ids as its parameter), so each stand-in answers only for the
 * projects it is asked about, as the table would.
 */
const idsOf: (operator: unknown) => Array<string> = (
  operator: unknown,
): Array<string> => {
  const parameters: Record<string, unknown> =
    (
      operator as
        | { objectLiteralParameters?: Record<string, unknown> }
        | undefined
    )?.objectLiteralParameters || {};
  const values: unknown = Object.values(parameters)[0];

  return (Array.isArray(values) ? values : []).map((value: unknown) => {
    return String(value).toLowerCase();
  });
};

interface ProviderRow {
  name: string;
  projectId: ObjectID;
  kind: "saml" | "oidc";
}

// The providers that are on: Acme has two, Globex one, the third project none.
const PROVIDERS: Array<ProviderRow> = [
  { name: "Acme Okta", projectId: ACME, kind: "saml" },
  { name: "Globex Okta", projectId: GLOBEX, kind: "saml" },
  { name: "Acme Entra ID", projectId: ACME, kind: "oidc" },
];

const PROJECTS: Array<{ id: ObjectID; name: string }> = [
  { id: ACME, name: "Acme" },
  { id: GLOBEX, name: "Globex" },
  { id: NO_SSO, name: "No SSO Yet" },
];

const providersFor: (
  kind: ProviderRow["kind"],
  query: { projectId?: unknown; isEnabled?: unknown },
) => Array<unknown> = (
  kind: ProviderRow["kind"],
  query: { projectId?: unknown; isEnabled?: unknown },
): Array<unknown> => {
  // Only providers that are on are ever asked for.
  expect(query.isEnabled).toBe(true);

  const wanted: Array<string> = idsOf(query.projectId);

  return PROVIDERS.filter((provider: ProviderRow): boolean => {
    return (
      provider.kind === kind &&
      wanted.includes(provider.projectId.toString().toLowerCase())
    );
  }).map((provider: ProviderRow) => {
    return { name: provider.name, projectId: provider.projectId };
  });
};

jest.mock("Common/Server/Services/ProjectSsoService", () => {
  return {
    __esModule: true,
    default: {
      findBy: (data: {
        query: { projectId?: unknown; isEnabled?: unknown };
      }): Promise<unknown> => {
        steps.push("read SAML providers");
        return slow(providersFor("saml", data.query));
      },
    },
  };
});

jest.mock("Common/Server/Services/ProjectOidcService", () => {
  return {
    __esModule: true,
    default: {
      findBy: (data: {
        query: { projectId?: unknown; isEnabled?: unknown };
      }): Promise<unknown> => {
        steps.push("read OIDC providers");
        return slow(providersFor("oidc", data.query));
      },
    },
  };
});

jest.mock("Common/Server/Services/ProjectService", () => {
  return {
    __esModule: true,
    default: {
      findBy: (data: { query: { _id?: unknown } }): Promise<unknown> => {
        steps.push("read projects");

        const wanted: Array<string> = idsOf(data.query._id);

        return slow(
          PROJECTS.filter((project: { id: ObjectID }): boolean => {
            return wanted.includes(project.id.toString().toLowerCase());
          }).map((project: { id: ObjectID; name: string }) => {
            return {
              id: project.id,
              _id: project.id.toString(),
              name: project.name,
            };
          }),
        );
      },
    },
  };
});

const sendMail: jest.Mock = jest.fn();

jest.mock("Common/Server/Services/MailService", () => {
  return {
    __esModule: true,
    default: {
      sendMail: (...args: Array<unknown>): Promise<unknown> => {
        steps.push("send email");
        sendMail(...args);
        return Promise.resolve({});
      },
    },
  };
});

jest.mock("Common/Server/DatabaseConfig", () => {
  return {
    __esModule: true,
    default: {
      getHost: (): Promise<unknown> => {
        const hostname: typeof import("Common/Types/API/Hostname") =
          jest.requireActual("Common/Types/API/Hostname");

        return Promise.resolve(new hostname.default("oneuptime.example.com"));
      },
      getHttpProtocol: (): Promise<unknown> => {
        const protocol: typeof import("Common/Types/API/Protocol") =
          jest.requireActual("Common/Types/API/Protocol");

        return Promise.resolve(protocol.default.HTTPS);
      },
    },
  };
});

jest.mock("Common/Server/Utils/Logger", () => {
  return {
    __esModule: true,
    default: {
      info: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
      debug: jest.fn(),
    },
    getLogAttributesFromRequest: (): Record<string, unknown> => {
      return {};
    },
  };
});

const sendEmptySuccessResponse: jest.Mock = jest.fn(
  (_req: unknown, res: ExpressResponse): void => {
    steps.push("answer");
    res.status(200);
    res.send({});
  },
);

jest.mock("Common/Server/Utils/Response", () => {
  return {
    __esModule: true,
    default: {
      sendEmptySuccessResponse: (...args: Array<unknown>): unknown => {
        return sendEmptySuccessResponse(...args);
      },
    },
  };
});

// Importing the router registers its handler on the mock router above.
import "../../../FeatureSet/Identity/API/SsoSignInLinks";

interface Answer {
  error: Exception | null;
  status: unknown;
  body: unknown;
  headers: Record<string, string>;
  // From the request to its answer.
  answeredInMs: number;
}

let callerCount: number = 0;

// A new caller each time unless one is named, behind the bundled Nginx.
async function ask(email: string, from?: string): Promise<Answer> {
  const handler: RouteHandler = mockRouter.match(
    "post",
    SEND_SSO_SIGN_IN_LINKS_ROUTE,
  );

  callerCount += 1;

  const req: ExpressRequest = buildRequest(
    { data: { email: email } },
    {
      headers: {
        "x-forwarded-for": from || `198.51.100.${(callerCount % 250) + 1}`,
      },
      socketAddress: "10.0.0.2",
    },
  );
  const headers: Record<string, string> = {};
  const res: ExpressResponse = buildResponse();
  (res as unknown as { setHeader: unknown }).setHeader = (
    name: string,
    value: string,
  ): void => {
    headers[name] = value;
  };

  let error: Exception | null = null;
  const startedAt: number = performance.now();

  await handler(req, res, ((err?: Exception): void => {
    if (err) {
      error = err;
    }
  }) as unknown as NextFunction);

  const answeredInMs: number = performance.now() - startedAt;

  const status: jest.Mock = res.status as unknown as jest.Mock;
  const send: jest.Mock = res.send as unknown as jest.Mock;

  return {
    error: error,
    status: status.mock.calls[0]?.[0],
    body: send.mock.calls[0]?.[0],
    headers: headers,
    answeredInMs: answeredInMs,
  };
}

// Lets the background work that is waiting run to its end.
async function settleBackground(): Promise<void> {
  await SsoSignInLinksEmail.waitForQueueForTests();
}

const median: (values: Array<number>) => number = (
  values: Array<number>,
): number => {
  const sorted: Array<number> = [...values].sort((a: number, b: number) => {
    return a - b;
  });

  return sorted[Math.floor(sorted.length / 2)]!;
};

beforeEach(() => {
  redisClient.reset();
  steps.length = 0;
  sendMail.mockClear();
  sendEmptySuccessResponse.mockClear();
  mockCaptchaRefusal = null;
  mockEmailNotSetUp = false;
  SsoSignInLinksEmail.resetForTests();
});

afterEach(async () => {
  await settleBackground();
});

describe("every address is answered alike", () => {
  test.each(Object.entries(ADDRESSES))(
    "%s: an empty success, the answer sent before the address is even looked up",
    async (_case: string, email: string) => {
      const answer: Answer = await ask(email);

      expect(answer.error).toBeNull();
      expect(answer.status).toBe(200);
      expect(answer.body).toEqual({});
      expect(answer.headers).toEqual({});

      await settleBackground();

      // Nothing about the address was read before the answer went.
      expect(steps[0]).toBe("answer");
      expect(steps[1]).toBe(`read account ${email}`);
    },
  );

  test("the answers for every kind of address are the same answer", async () => {
    const answers: Array<Omit<Answer, "answeredInMs">> = [];

    for (const email of Object.values(ADDRESSES)) {
      const answer: Answer = await ask(email);

      // Everything but how long it took, which the next test compares.
      answers.push({
        error: answer.error,
        status: answer.status,
        body: answer.body,
        headers: answer.headers,
      });
    }

    for (const answer of answers) {
      expect(answer).toEqual(answers[0]);
    }
  });

  /*
   * The reads of an account, its memberships and its projects' providers
   * each take SLOW_READ_MS here. Had the route waited for any of them, the
   * answer for an account in SSO projects would take several times that;
   * it takes what the answer for an address with no account takes.
   */
  test("comparable timing: no answer waits on the slow reads, whatever the address", async () => {
    const timings: Record<string, Array<number>> = {};

    for (let round: number = 0; round < 3; round++) {
      for (const [kind, email] of Object.entries(ADDRESSES)) {
        // Each round from callers of its own, and the counters fresh.
        redisClient.reset();
        const answer: Answer = await ask(email);

        expect(answer.error).toBeNull();
        timings[kind] = [...(timings[kind] || []), answer.answeredInMs];
      }
    }

    const medians: Array<number> = Object.values(timings).map(median);

    for (const value of medians) {
      expect(value).toBeLessThan(SLOW_READ_MS / 2);
    }

    expect(Math.max(...medians) - Math.min(...medians)).toBeLessThan(
      SLOW_READ_MS / 3,
    );
  });
});

describe("what is emailed, and to whom", () => {
  test("an account in projects whose SSO is on is emailed their links, and only that address", async () => {
    await ask("contractor@gmail.example");
    await settleBackground();

    expect(sendMail).toHaveBeenCalledTimes(1);

    const mail: Record<string, any> = sendMail.mock.calls[0]![0] as Record<
      string,
      any
    >;

    expect(mail["toEmail"].toString()).toBe("contractor@gmail.example");
    expect(mail["templateType"]).toBe(EmailTemplateType.SsoSignInLinks);
    expect(
      (mail["vars"]["projects"] as Array<Record<string, string>>).map(
        (project: Record<string, string>) => {
          return [project["projectName"], project["signInUrl"]];
        },
      ),
    ).toEqual([
      ["Acme", `https://oneuptime.example.com/accounts/sso/${ACME}`],
      ["Globex", `https://oneuptime.example.com/accounts/sso/${GLOBEX}`],
    ]);
  });

  test.each([
    "nobody@gmail.example",
    "blocked@gmail.example",
    "admin@gmail.example",
    "no-sso@gmail.example",
  ])("%s is emailed nothing", async (email: string) => {
    await ask(email);
    await settleBackground();

    expect(sendMail).not.toHaveBeenCalled();
  });
});

describe("the limits, per address and per caller, alike for every address", () => {
  test.each([
    ["an address with no account", "nobody@gmail.example"],
    ["an account in SSO projects", "contractor@gmail.example"],
  ])(
    "%s: five requests in the hour from every caller together, then the same refusal",
    async (_case: string, email: string) => {
      for (let index: number = 0; index < 5; index++) {
        expect((await ask(email)).error).toBeNull();
      }

      const refused: Answer = await ask(email);

      expect(refused.error?.code).toBe(ExceptionCode.TooManyRequestsException);
      expect(refused.error?.message).toBe(
        "Too many sign-in links asked for this email address in the last hour. Please use the links in the latest email, or try again later.",
      );
      expect(Number(refused.headers["Retry-After"])).toBeGreaterThan(0);
    },
  );

  test("one caller: thirty requests in a quarter of an hour, for any addresses, then refused", async () => {
    const caller: string = "203.0.113.9";

    for (let index: number = 0; index < 30; index++) {
      expect(
        (await ask(`person-${index}@gmail.example`, caller)).error,
      ).toBeNull();
    }

    const refused: Answer = await ask("contractor@gmail.example", caller);

    expect(refused.error?.code).toBe(ExceptionCode.TooManyRequestsException);
    expect(refused.error?.message).toBe(
      "Too many sign-in links asked for from your network. Please wait a few minutes and try again.",
    );

    // Another caller still gets through.
    expect(
      (await ask("contractor@gmail.example", "203.0.113.10")).error,
    ).toBeNull();
  });

  test("a refused request does nothing in the background", async () => {
    for (let index: number = 0; index < 5; index++) {
      await ask("contractor@gmail.example");
    }

    await settleBackground();
    sendMail.mockClear();

    await ask("contractor@gmail.example");
    await settleBackground();

    expect(sendMail).not.toHaveBeenCalled();
  });
});

describe("what is asked before anything", () => {
  test("the captcha, where it is on: a refusal there reads and counts nothing", async () => {
    mockCaptchaRefusal = new Error("Captcha verification failed.");

    const answer: Answer = await ask("contractor@gmail.example");

    expect(answer.error?.message).toBe("Captcha verification failed.");
    await settleBackground();
    expect(steps).toEqual([]);
  });

  test("an address is required", async () => {
    const handler: RouteHandler = mockRouter.match(
      "post",
      SEND_SSO_SIGN_IN_LINKS_ROUTE,
    );
    let error: Exception | null = null;

    await handler(buildRequest({ data: {} }), buildResponse(), ((
      err?: Exception,
    ): void => {
      error = err || null;
    }) as unknown as NextFunction);

    expect(error).not.toBeNull();
    expect(sendEmptySuccessResponse).not.toHaveBeenCalled();
  });

  test("a server that cannot send email says so to anyone, before any address is looked at", async () => {
    mockEmailNotSetUp = true;

    for (const email of Object.values(ADDRESSES)) {
      const answer: Answer = await ask(email);

      expect(answer.error?.message).toBe(
        SSO_SIGN_IN_LINKS_CANNOT_BE_EMAILED_MESSAGE,
      );
    }

    await settleBackground();
    expect(steps).toEqual([]);
  });
});
