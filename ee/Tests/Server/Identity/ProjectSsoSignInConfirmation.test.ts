import { beforeEach, describe, expect, test } from "@jest/globals";
import fs from "fs";
import nodePath from "path";
import SSORouter from "../../../Server/Identity/API/SSO";
import OIDCRouter from "../../../Server/Identity/API/OIDC";
import ConfirmationRouter, {
  SSO_SIGN_IN_CONFIRMATION_VIEW,
} from "../../../Server/Identity/API/ProjectSsoSignInConfirmation";
import ProjectSsoSignInConfirmation, {
  PROJECT_SSO_CONFIRMATION_EXPIRY_HOURS,
  PROJECT_SSO_CONFIRMATION_REQUIRED_ERROR,
  PROJECT_SSO_CONFIRMATION_REQUIRED_MESSAGE,
  ProjectSsoConfirmationOutcome,
  ProjectSsoConfirmationResult,
  ProjectSsoKind,
} from "../../../Server/Identity/Utils/ProjectSsoSignInConfirmation";
import {
  ExpressRequest,
  ExpressResponse,
  ExpressRouter,
  RequestHandler,
} from "Common/Server/Utils/Express";
import User from "Common/Models/DatabaseModels/User";
import Email from "Common/Types/Email";
import EmailTemplateType from "Common/Types/Email/EmailTemplateType";
import ExceptionMessages from "Common/Types/Exception/ExceptionMessages";
import OneUptimeDate from "Common/Types/Date";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import PositiveNumber from "Common/Types/PositiveNumber";
import { setTestBillingEnabled } from "Common/Tests/Server/Enterprise/TestBillingFlag";

/*
 * ---------------------------------------------------------------------------
 * A PROJECT'S OWN IDENTITY PROVIDER CANNOT SIGN A STRANGER IN.
 *
 * Project SAML and OIDC providers are configured by that project's admins. The
 * two callbacks used to look the asserted address up, create the account if it
 * was new (marked "email verified" on the IdP's word), add it to the
 * provider's default teams, and mint a full, unscoped user session. On the
 * hosted service that let any customer who could configure SSO sign in as any
 * OneUptime account, with every other project that account belonged to.
 *
 * On the hosted service (billing on) the first project-SSO sign-in to an
 * account now stops, emails the account's own address, and hands out nothing.
 * The link in that email records the owner's consent; after it, the provider's
 * sign-ins go through as before. Self-hosted installs are unchanged.
 *
 * The providers are stubbed at the utility boundary (the SAML signature check
 * and the OIDC code exchange), so every assertion that arrives here is a
 * genuinely verified one. What a hostile admin controls is WHICH address it
 * asserts, and that is exactly what these tests vary.
 * ---------------------------------------------------------------------------
 */

const ASSERTED_EMAIL: string = "victim@example.com";
const USER_ID: string = "88888888-8888-4888-8888-888888888888";
const PROJECT_ID: string = "99999999-9999-4999-8999-999999999999";
const OTHER_PROJECT_ID: string = "77777777-7777-4777-8777-777777777777";
const PROVIDER_ID: string = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const TEAM_ID: string = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const SECOND_TEAM_ID: string = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const TOKEN: string = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const TOKEN_ROW_ID: string = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const ISSUER: string = "https://idp.example.com/metadata";
const MESSAGE_VIEW: string =
  "/usr/src/app/FeatureSet/Identity/Views/Message.ejs";

jest.mock("Common/Server/EnvironmentConfig", () => {
  const billingFlag: typeof import("Common/Tests/Server/Enterprise/TestBillingFlag") =
    jest.requireActual(
      "Common/Tests/Server/Enterprise/TestBillingFlag",
    ) as typeof import("Common/Tests/Server/Enterprise/TestBillingFlag");

  return billingFlag.withLiveBillingFlag(
    jest.requireActual("Common/Server/EnvironmentConfig") as Record<
      string,
      unknown
    >,
  );
});

let storedRow: Record<string, unknown> | null = null;

const userFindOneBy: jest.Mock = jest.fn();
const userFindOneById: jest.Mock = jest.fn();
const userCreateByEmail: jest.Mock = jest.fn();
const userUpdateOneById: jest.Mock = jest.fn();

jest.mock("Common/Server/Services/UserService", () => {
  return {
    __esModule: true,
    default: {
      findOneBy: (...args: Array<unknown>): unknown => {
        return userFindOneBy(...args);
      },
      findOneById: (...args: Array<unknown>): unknown => {
        return userFindOneById(...args);
      },
      createByEmail: (...args: Array<unknown>): unknown => {
        return userCreateByEmail(...args);
      },
      updateOneById: (...args: Array<unknown>): unknown => {
        return userUpdateOneById(...args);
      },
    },
  };
});

const createSession: jest.Mock = jest.fn();

jest.mock("Common/Server/Services/UserSessionService", () => {
  return {
    __esModule: true,
    default: {
      createSession: (...args: Array<unknown>): unknown => {
        return createSession(...args);
      },
    },
  };
});

const teamMemberCountBy: jest.Mock = jest.fn();
const teamMemberCreate: jest.Mock = jest.fn();
const teamMemberUpdateBy: jest.Mock = jest.fn();

jest.mock("Common/Server/Services/TeamMemberService", () => {
  return {
    __esModule: true,
    default: {
      countBy: (...args: Array<unknown>): unknown => {
        return teamMemberCountBy(...args);
      },
      create: (...args: Array<unknown>): unknown => {
        return teamMemberCreate(...args);
      },
      updateBy: (...args: Array<unknown>): unknown => {
        return teamMemberUpdateBy(...args);
      },
      findBy: jest.fn(),
    },
  };
});

const refreshUserAllPermissions: jest.Mock = jest.fn();

jest.mock("Common/Server/Services/AccessTokenService", () => {
  return {
    __esModule: true,
    default: {
      refreshUserAllPermissions: (...args: Array<unknown>): unknown => {
        return refreshUserAllPermissions(...args);
      },
    },
  };
});

const samlProviderFindOneBy: jest.Mock = jest.fn();
const oidcProviderFindOneBy: jest.Mock = jest.fn();

jest.mock("Common/Server/Services/ProjectSsoService", () => {
  return {
    __esModule: true,
    default: {
      findOneBy: (...args: Array<unknown>): unknown => {
        return samlProviderFindOneBy(...args);
      },
    },
  };
});

jest.mock("Common/Server/Services/ProjectOidcService", () => {
  return {
    __esModule: true,
    default: {
      findOneBy: (...args: Array<unknown>): unknown => {
        return oidcProviderFindOneBy(...args);
      },
    },
  };
});

jest.mock("Common/Server/Services/ProjectService", () => {
  return {
    __esModule: true,
    default: {
      findOneById: (): Promise<unknown> => {
        return Promise.resolve({ name: "Acme <Production>" });
      },
    },
  };
});

const tokenCreate: jest.Mock = jest.fn();
const tokenFindOneBy: jest.Mock = jest.fn();
const tokenDeleteOneBy: jest.Mock = jest.fn();

jest.mock("Common/Server/Services/EmailVerificationTokenService", () => {
  return {
    __esModule: true,
    default: {
      create: (...args: Array<unknown>): unknown => {
        return tokenCreate(...args);
      },
      findOneBy: (...args: Array<unknown>): unknown => {
        return tokenFindOneBy(...args);
      },
      deleteOneBy: (...args: Array<unknown>): unknown => {
        return tokenDeleteOneBy(...args);
      },
    },
  };
});

const sendMail: jest.Mock = jest.fn();

jest.mock("Common/Server/Services/MailService", () => {
  return {
    __esModule: true,
    default: {
      sendMail: (...args: Array<unknown>): unknown => {
        return sendMail(...args);
      },
    },
  };
});

const hasConsent: jest.Mock = jest.fn();
const recordConsent: jest.Mock = jest.fn();

jest.mock("Common/Server/Services/UserProjectSsoConsentService", () => {
  return {
    __esModule: true,
    default: {
      hasConsent: (...args: Array<unknown>): unknown => {
        return hasConsent(...args);
      },
      recordConsent: (...args: Array<unknown>): unknown => {
        return recordConsent(...args);
      },
    },
  };
});

// A signature that verified: the identity below is what the IdP asserted.
jest.mock("../../../Server/Identity/Utils/SSO", () => {
  return {
    __esModule: true,
    default: {
      getSamlResponseFromXML: (): unknown => {
        const identity: typeof import("Common/Types/Email") =
          jest.requireActual("Common/Types/Email");

        return {
          issuerUrl: "https://idp.example.com/metadata",
          email: new identity.default("victim@example.com"),
          name: null,
        };
      },
      createSAMLRequestUrl: jest.fn(),
    },
  };
});

// A code exchange that succeeded, with an ID token that validated.
jest.mock("../../../Server/Identity/Utils/OIDC", () => {
  return {
    __esModule: true,
    default: {
      createClient: (): Promise<unknown> => {
        return Promise.resolve({});
      },
      exchangeCodeAndValidate: (): Promise<unknown> => {
        const identity: typeof import("Common/Types/Email") =
          jest.requireActual("Common/Types/Email");

        return Promise.resolve({
          email: new identity.default("victim@example.com"),
          name: null,
        });
      },
    },
  };
});

const sendVerificationEmail: jest.Mock = jest.fn();

jest.mock("App/FeatureSet/Identity/Utils/AuthenticationEmail", () => {
  return {
    __esModule: true,
    default: {
      sendVerificationEmail: (...args: Array<unknown>): unknown => {
        return sendVerificationEmail(...args);
      },
    },
  };
});

const setUserCookie: jest.Mock = jest.fn();
const setSSOCookie: jest.Mock = jest.fn();

jest.mock("Common/Server/Utils/Cookie", () => {
  return {
    __esModule: true,
    default: {
      getCookieFromExpressRequest: (
        _req: unknown,
        name: string,
      ): string | undefined => {
        return name.includes("oidc-state-") ? "signed-state" : undefined;
      },
      removeCookie: jest.fn(),
      setCookie: jest.fn(),
      setUserCookie: (...args: Array<unknown>): unknown => {
        return setUserCookie(...args);
      },
      setSSOCookie: (...args: Array<unknown>): unknown => {
        return setSSOCookie(...args);
      },
      getSSOToken: (): string => {
        return "sso-token";
      },
    },
  };
});

let oidcStateIsMobile: boolean = false;
const signUserLoginToken: jest.Mock = jest.fn();

jest.mock("Common/Server/Utils/JsonWebToken", () => {
  return {
    __esModule: true,
    default: {
      decodeJsonPayload: (): JSONObject => {
        return {
          state: "state",
          nonce: "nonce",
          codeVerifier: "code-verifier",
          isMobile: oidcStateIsMobile,
        };
      },
      signJsonPayload: (): string => {
        return "signed-state";
      },
      signUserLoginToken: (...args: Array<unknown>): unknown => {
        return signUserLoginToken(...args);
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

        return Promise.resolve(new hostname.default("oneuptime.test"));
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

const render: jest.Mock = jest.fn();
const sendErrorResponse: jest.Mock = jest.fn();
const responseRedirect: jest.Mock = jest.fn();

jest.mock("Common/Server/Utils/Response", () => {
  return {
    __esModule: true,
    default: {
      render: (...args: Array<unknown>): unknown => {
        return render(...args);
      },
      sendErrorResponse: (...args: Array<unknown>): unknown => {
        return sendErrorResponse(...args);
      },
      redirect: (...args: Array<unknown>): unknown => {
        return responseRedirect(...args);
      },
    },
  };
});

// Express 4 keeps these on each stack layer; its typings leave them out.
interface RouteLayer {
  route?:
    | {
        path: string;
        methods: Record<string, boolean>;
        stack: Array<{ handle: RequestHandler }>;
      }
    | undefined;
}

// The route's own handler: the last one, after the license gate.
function handlerFor(
  router: ExpressRouter,
  method: string,
  path: string,
): RequestHandler {
  const layers: Array<RouteLayer> = (
    router as unknown as { stack: Array<RouteLayer> }
  ).stack;

  const layer: RouteLayer | undefined = layers.find((candidate: RouteLayer) => {
    return (
      candidate.route?.path === path &&
      Boolean(candidate.route.methods[method.toLowerCase()])
    );
  });

  if (!layer?.route) {
    throw new Error(`${method} ${path} is not registered`);
  }

  return layer.route.stack[layer.route.stack.length - 1]!.handle;
}

type RunResult = { nextError: unknown };

// res.redirect: where the mobile flows send the app its deep link.
const resRedirect: jest.Mock = jest.fn();

async function invoke(data: {
  router: ExpressRouter;
  method: string;
  path: string;
  params: Record<string, string>;
  body?: JSONObject | undefined;
  query?: JSONObject | undefined;
}): Promise<RunResult> {
  const req: ExpressRequest = {
    params: data.params,
    body: data.body || {},
    query: data.query || {},
    headers: {},
    cookies: {},
    socket: { remoteAddress: "127.0.0.1" },
    get: (): undefined => {
      return undefined;
    },
  } as unknown as ExpressRequest;

  const res: ExpressResponse = {
    redirect: resRedirect,
    status: jest.fn().mockReturnThis(),
    send: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
    cookie: jest.fn().mockReturnThis(),
    clearCookie: jest.fn().mockReturnThis(),
  } as unknown as ExpressResponse;

  let nextError: unknown = undefined;

  const handler: RequestHandler = handlerFor(
    data.router,
    data.method,
    data.path,
  );

  await (handler(req, res, (err?: unknown): void => {
    nextError = err;
  }) as unknown as Promise<void>);

  return { nextError };
}

type Flow = {
  name: string;
  kind: ProjectSsoKind;
  run: (data: { isMobile: boolean }) => Promise<RunResult>;
};

const FLOWS: Array<Flow> = [
  {
    name: "project SAML (/idp-login)",
    kind: ProjectSsoKind.SAML,
    run: (data: { isMobile: boolean }): Promise<RunResult> => {
      return invoke({
        router: SSORouter,
        method: "POST",
        path: "/idp-login/:projectId/:projectSsoId",
        params: { projectId: PROJECT_ID, projectSsoId: PROVIDER_ID },
        body: {
          SAMLResponse: Buffer.from("<Response/>").toString("base64"),
          ...(data.isMobile ? { RelayState: "mobile" } : {}),
        },
      });
    },
  },
  {
    name: "project OIDC (/oidc-callback)",
    kind: ProjectSsoKind.OIDC,
    run: (data: { isMobile: boolean }): Promise<RunResult> => {
      // The OIDC flow carries "mobile" in its signed state cookie.
      oidcStateIsMobile = data.isMobile;

      return invoke({
        router: OIDCRouter,
        method: "GET",
        path: "/oidc-callback/:projectId/:projectOidcId",
        params: { projectId: PROJECT_ID, projectOidcId: PROVIDER_ID },
        query: { code: "code", state: "state" },
      });
    },
  },
];

function storeUser(overrides?: Record<string, unknown>): void {
  storedRow = {
    _id: USER_ID,
    email: new Email(ASSERTED_EMAIL),
    name: "Victim",
    isMasterAdmin: false,
    isEmailVerified: true,
    isBlocked: false,
    timezone: null,
    ...(overrides || {}),
  };
}

// UserService lookups honour `select`, like the real one.
function projectOntoSelect(select: Record<string, unknown>): User | null {
  if (!storedRow) {
    return null;
  }

  const user: Record<string, unknown> = new User() as unknown as Record<
    string,
    unknown
  >;

  for (const column of Object.keys(select)) {
    if (select[column] && storedRow[column] !== undefined) {
      user[column] = storedRow[column];
    }
  }

  return user as unknown as User;
}

// Nothing a sign-in hands out, and nothing provisioned on the way to it.
function expectNoSessionAndNothingProvisioned(): void {
  expect(createSession).not.toHaveBeenCalled();
  expect(signUserLoginToken).not.toHaveBeenCalled();
  expect(setUserCookie).not.toHaveBeenCalled();
  expect(setSSOCookie).not.toHaveBeenCalled();
  expect(teamMemberCreate).not.toHaveBeenCalled();
  expect(teamMemberUpdateBy).not.toHaveBeenCalled();
  expect(refreshUserAllPermissions).not.toHaveBeenCalled();
  expect(recordConsent).not.toHaveBeenCalled();
}

function expectSignedIn(): void {
  expect(createSession).toHaveBeenCalledTimes(1);
  expect(setUserCookie).toHaveBeenCalledTimes(1);
}

type ConfirmationMailFunction = () => {
  toEmail: string;
  vars: Record<string, string>;
  templateType: unknown;
};

const confirmationMail: ConfirmationMailFunction = (): {
  toEmail: string;
  vars: Record<string, string>;
  templateType: unknown;
} => {
  expect(sendMail).toHaveBeenCalledTimes(1);

  const call: Record<string, any> = sendMail.mock.calls[0]![0] as Record<
    string,
    any
  >;

  return {
    toEmail: call["toEmail"].toString(),
    vars: call["vars"] as Record<string, string>,
    templateType: call["templateType"],
  };
};

beforeEach(() => {
  jest.clearAllMocks();

  setTestBillingEnabled(true);
  ProjectSsoSignInConfirmation.resetThrottleForTests();
  oidcStateIsMobile = false;

  storeUser();

  userFindOneBy.mockImplementation((data: { select: JSONObject }) => {
    return Promise.resolve(projectOntoSelect(data.select));
  });

  userFindOneById.mockImplementation((data: { select: JSONObject }) => {
    return Promise.resolve(projectOntoSelect(data.select));
  });

  userCreateByEmail.mockImplementation(
    (data: { email: Email; isEmailVerified: boolean }): Promise<User> => {
      storeUser({
        email: data.email,
        isEmailVerified: data.isEmailVerified,
      });

      return Promise.resolve(
        projectOntoSelect({
          _id: true,
          email: true,
          name: true,
          isMasterAdmin: true,
          isEmailVerified: true,
          isBlocked: true,
          timezone: true,
        })!,
      );
    },
  );

  const provider: JSONObject = {
    id: new ObjectID(PROVIDER_ID),
    signOnURL: "https://idp.example.com/sso",
    issuerURL: ISSUER,
    publicCertificate: "certificate",
    discoveryURL: "https://idp.example.com/.well-known/openid-configuration",
    clientId: "client-id",
    clientSecret: "client-secret",
    teams: [
      { id: new ObjectID(TEAM_ID) },
      { id: new ObjectID(SECOND_TEAM_ID) },
    ],
  };

  samlProviderFindOneBy.mockResolvedValue(provider);
  oidcProviderFindOneBy.mockResolvedValue(provider);

  teamMemberCountBy.mockResolvedValue(new PositiveNumber(0));
  teamMemberCreate.mockResolvedValue({});
  teamMemberUpdateBy.mockResolvedValue(1);

  hasConsent.mockResolvedValue(false);
  recordConsent.mockResolvedValue(undefined);

  tokenCreate.mockResolvedValue({});
  tokenDeleteOneBy.mockResolvedValue(1);
  sendMail.mockResolvedValue(undefined);

  createSession.mockResolvedValue({
    session: { id: ObjectID.generate() },
    refreshToken: "refresh-token",
    refreshTokenExpiresAt: new Date(),
  });
  signUserLoginToken.mockReturnValue("signed-user-token");
});

/*
 * ===========================================================================
 * The callbacks, on the hosted service.
 * ===========================================================================
 */

describe.each(FLOWS)(
  "$name on the hosted service -- an existing account the project's SSO has never been confirmed for",
  (flow: Flow) => {
    test("is not signed in, and nothing is provisioned", async () => {
      /*
       * The account takeover this change closes: a customer's IdP asserts the
       * address of an account that has never agreed to it.
       */
      const result: RunResult = await flow.run({ isMobile: false });

      expect(result.nextError).toBeUndefined();
      expect(sendErrorResponse).not.toHaveBeenCalled();
      expectNoSessionAndNothingProvisioned();
      expect(responseRedirect).not.toHaveBeenCalled();
    });

    test("asks whether THIS project has consent, for THIS account", async () => {
      await flow.run({ isMobile: false });

      expect(hasConsent).toHaveBeenCalledTimes(1);

      const query: Record<string, ObjectID> = hasConsent.mock
        .calls[0]![0] as Record<string, ObjectID>;

      expect(query["userId"]!.toString()).toBe(USER_ID);
      expect(query["projectId"]!.toString()).toBe(PROJECT_ID);
    });

    test("emails a confirmation link to the account's own address", async () => {
      await flow.run({ isMobile: false });

      const mail: ReturnType<ConfirmationMailFunction> = confirmationMail();

      expect(mail.toEmail).toBe(ASSERTED_EMAIL);
      expect(mail.templateType).toBe(EmailTemplateType.ConfirmProjectSsoSignIn);
    });

    test("binds the link to this project, this provider and this kind of SSO", async () => {
      await flow.run({ isMobile: false });

      const url: globalThis.URL = new globalThis.URL(
        confirmationMail().vars["confirmationUrl"]!,
      );
      const token: string = url.searchParams.get("token")!;

      expect(url.origin).toBe("https://oneuptime.test");
      expect(url.pathname).toBe(
        `/identity/sso-sign-in-confirmation/${flow.kind}/${PROJECT_ID}/${PROVIDER_ID}`,
      );
      expect(
        ProjectSsoSignInConfirmation.isSignatureValid({
          token,
          signature: url.searchParams.get("signature")!,
          kind: flow.kind,
          projectId: PROJECT_ID,
          providerId: PROVIDER_ID,
        }),
      ).toBe(true);
    });

    test("stores the link's token against the account and its address, for a day", async () => {
      const before: number = Date.now();

      await flow.run({ isMobile: false });

      expect(tokenCreate).toHaveBeenCalledTimes(1);

      const row: Record<string, any> = (
        tokenCreate.mock.calls[0]![0] as Record<string, any>
      )["data"] as Record<string, any>;
      const url: globalThis.URL = new globalThis.URL(
        confirmationMail().vars["confirmationUrl"]!,
      );

      expect(row["userId"].toString()).toBe(USER_ID);
      expect(row["email"].toString()).toBe(ASSERTED_EMAIL);
      expect(row["token"].toString()).toBe(url.searchParams.get("token"));

      const hours: number =
        ((row["expires"] as Date).getTime() - before) / (60 * 60 * 1000);

      expect(hours).toBeGreaterThan(PROJECT_SSO_CONFIRMATION_EXPIRY_HOURS - 1);
      expect(hours).toBeLessThanOrEqual(
        PROJECT_SSO_CONFIRMATION_EXPIRY_HOURS + 0.1,
      );
    });

    test("names the project in the email as escaped text, never as HTML", async () => {
      /*
       * The project name is chosen by that project's admins. It reaches the
       * mail only inside signInSummary, which the template prints through
       * InfoBlock's escaped plainInfo.
       */
      await flow.run({ isMobile: false });

      const vars: Record<string, string> = confirmationMail().vars;

      expect(vars["signInSummary"]).toContain('"Acme <Production>"');
      expect(vars["signInSummary"]).toContain(ASSERTED_EMAIL);
      expect(vars["info"]).toBeUndefined();
    });

    test("tells the person to check their email", async () => {
      await flow.run({ isMobile: false });

      expect(render).toHaveBeenCalledTimes(1);
      expect(render.mock.calls[0]![2]).toBe(MESSAGE_VIEW);
      expect(render.mock.calls[0]![3]).toEqual({
        title: "Check your email.",
        message: PROJECT_SSO_CONFIRMATION_REQUIRED_MESSAGE,
      });
    });

    test("never uses the ordinary verify-your-email mail instead", async () => {
      await flow.run({ isMobile: false });

      expect(sendVerificationEmail).not.toHaveBeenCalled();
    });

    test("sends one email per window, however many times the IdP is replayed", async () => {
      /*
       * The callback answers anyone who can complete a round trip through the
       * project's IdP -- including the admin of a hostile one.
       */
      await flow.run({ isMobile: false });
      await flow.run({ isMobile: false });
      await flow.run({ isMobile: false });

      expect(sendMail).toHaveBeenCalledTimes(1);
      expect(render).toHaveBeenCalledTimes(3);
      expectNoSessionAndNothingProvisioned();
    });

    test("still answers 'check your email' when the mail server is down", async () => {
      sendMail.mockRejectedValue(new Error("SMTP unreachable"));

      const result: RunResult = await flow.run({ isMobile: false });

      expect(result.nextError).toBeUndefined();
      expect(render.mock.calls[0]![3]).toEqual({
        title: "Check your email.",
        message: PROJECT_SSO_CONFIRMATION_REQUIRED_MESSAGE,
      });
      expectNoSessionAndNothingProvisioned();
    });

    test("tells the mobile app why on its deep link, with no tokens", async () => {
      await flow.run({ isMobile: true });

      expect(resRedirect).toHaveBeenCalledTimes(1);

      const deepLink: string = resRedirect.mock.calls[0]![0] as string;
      const params: URLSearchParams = new URLSearchParams(
        deepLink.split("?")[1] || "",
      );

      expect(deepLink.startsWith("oneuptime://sso-callback?")).toBe(true);
      expect(params.get("error")).toBe(PROJECT_SSO_CONFIRMATION_REQUIRED_ERROR);
      expect(params.get("errorDescription")).toBe(
        PROJECT_SSO_CONFIRMATION_REQUIRED_MESSAGE,
      );
      expect(params.get("accessToken")).toBeNull();
      expect(params.get("refreshToken")).toBeNull();
      expect(params.get("ssoToken")).toBeNull();
      expect(render).not.toHaveBeenCalled();
      expectNoSessionAndNothingProvisioned();
    });

    test("is not let through by consent another project was given", async () => {
      hasConsent.mockImplementation(
        (query: { projectId: ObjectID }): Promise<boolean> => {
          return Promise.resolve(
            query.projectId.toString() === OTHER_PROJECT_ID,
          );
        },
      );

      await flow.run({ isMobile: false });

      expectNoSessionAndNothingProvisioned();
      expect(sendMail).toHaveBeenCalledTimes(1);
    });

    test("is not let through by already being a member of the project", async () => {
      /*
       * Membership is not consent: SCIM and admin-driven flows can put an
       * existing account into a project's teams without its owner doing
       * anything.
       */
      teamMemberCountBy.mockResolvedValue(new PositiveNumber(1));

      await flow.run({ isMobile: false });

      expectNoSessionAndNothingProvisioned();
      expect(sendMail).toHaveBeenCalledTimes(1);
    });
  },
);

describe.each(FLOWS)(
  "$name on the hosted service -- an address the IdP provisions for the first time",
  (flow: Flow) => {
    beforeEach(() => {
      storedRow = null;
    });

    test("creates the account unverified", async () => {
      await flow.run({ isMobile: false });

      expect(userCreateByEmail).toHaveBeenCalledTimes(1);

      const call: Record<string, any> = userCreateByEmail.mock
        .calls[0]![0] as Record<string, any>;

      expect(call["email"].toString()).toBe(ASSERTED_EMAIL);
      expect(call["isEmailVerified"]).toBe(false);
    });

    test("signs nobody in and adds the account to no team", async () => {
      await flow.run({ isMobile: false });

      expectNoSessionAndNothingProvisioned();
    });

    test("emails the new address its confirmation link", async () => {
      await flow.run({ isMobile: false });

      expect(confirmationMail().toEmail).toBe(ASSERTED_EMAIL);
      expect(render.mock.calls[0]![3]).toEqual({
        title: "Check your email.",
        message: PROJECT_SSO_CONFIRMATION_REQUIRED_MESSAGE,
      });
    });
  },
);

describe.each(FLOWS)(
  "$name on the hosted service -- an account that has confirmed this project",
  (flow: Flow) => {
    beforeEach(() => {
      hasConsent.mockResolvedValue(true);
    });

    test("signs in exactly as before", async () => {
      const result: RunResult = await flow.run({ isMobile: false });

      expect(result.nextError).toBeUndefined();
      expect(render).not.toHaveBeenCalled();
      expectSignedIn();
      expect(sendMail).not.toHaveBeenCalled();
      expect(responseRedirect).toHaveBeenCalledTimes(1);
    });

    test("is still stopped while its address is unverified", async () => {
      /*
       * Consent was given from a mailbox the account no longer has proven --
       * the address has been changed since. The fresh link re-proves it.
       */
      storeUser({ isEmailVerified: false });

      await flow.run({ isMobile: false });

      expectNoSessionAndNothingProvisioned();
      expect(sendMail).toHaveBeenCalledTimes(1);
      expect(sendVerificationEmail).not.toHaveBeenCalled();
    });

    test("is still refused while blocked, and mailed nothing", async () => {
      storeUser({ isBlocked: true });

      await flow.run({ isMobile: false });

      expect(render.mock.calls[0]![3]).toEqual({
        title: "Account blocked.",
        message: ExceptionMessages.UserBlocked,
      });
      expect(sendMail).not.toHaveBeenCalled();
      expectNoSessionAndNothingProvisioned();
    });
  },
);

describe.each(FLOWS)("$name on a self-hosted install", (flow: Flow) => {
  beforeEach(() => {
    setTestBillingEnabled(false);
  });

  test("signs an existing verified account in without asking", async () => {
    await flow.run({ isMobile: false });

    expectSignedIn();
    expect(hasConsent).not.toHaveBeenCalled();
    expect(sendMail).not.toHaveBeenCalled();
  });

  test("provisions a new address verified and signs it in, as before", async () => {
    storedRow = null;

    await flow.run({ isMobile: false });

    const call: Record<string, any> = userCreateByEmail.mock
      .calls[0]![0] as Record<string, any>;

    expect(call["isEmailVerified"]).toBe(true);
    expectSignedIn();
    expect(teamMemberCreate).toHaveBeenCalledTimes(2);
    expect(sendMail).not.toHaveBeenCalled();
  });

  test("still sends an unverified existing account the ordinary verification mail", async () => {
    storeUser({ isEmailVerified: false });

    await flow.run({ isMobile: false });

    expect(sendVerificationEmail).toHaveBeenCalledTimes(1);
    expect(sendMail).not.toHaveBeenCalled();
    expectNoSessionAndNothingProvisioned();
  });
});

/*
 * ===========================================================================
 * The link.
 * ===========================================================================
 */

const CONFIRMATION_PATH: string =
  "/sso-sign-in-confirmation/:kind/:projectId/:providerId";

type LinkParams = {
  kind: string;
  projectId: string;
  providerId: string;
};

const linkParams: (overrides?: Partial<LinkParams>) => LinkParams = (
  overrides?: Partial<LinkParams>,
): LinkParams => {
  return {
    kind: ProjectSsoKind.SAML,
    projectId: PROJECT_ID,
    providerId: PROVIDER_ID,
    ...(overrides || {}),
  };
};

const signatureFor: (params: LinkParams, token?: string) => string = (
  params: LinkParams,
  token?: string,
): string => {
  return ProjectSsoSignInConfirmation.getSignature({
    token: token || TOKEN,
    kind: params.kind as ProjectSsoKind,
    projectId: params.projectId,
    providerId: params.providerId,
  });
};

async function openLink(data: {
  params: LinkParams;
  token?: string | undefined;
  signature?: string | undefined;
}): Promise<RunResult> {
  return invoke({
    router: ConfirmationRouter,
    method: "GET",
    path: CONFIRMATION_PATH,
    params: data.params,
    query: {
      token: data.token === undefined ? TOKEN : data.token,
      signature:
        data.signature === undefined
          ? signatureFor(data.params, data.token)
          : data.signature,
    },
  });
}

async function pressConfirm(data: {
  params: LinkParams;
  token?: string | undefined;
  signature?: string | undefined;
}): Promise<RunResult> {
  return invoke({
    router: ConfirmationRouter,
    method: "POST",
    path: CONFIRMATION_PATH,
    params: data.params,
    body: {
      token: data.token === undefined ? TOKEN : data.token,
      signature:
        data.signature === undefined
          ? signatureFor(data.params, data.token)
          : data.signature,
    },
  });
}

type RenderedPageFunction = () => { view: string; vars: Record<string, any> };

const renderedPage: RenderedPageFunction = (): {
  view: string;
  vars: Record<string, any>;
} => {
  expect(render).toHaveBeenCalledTimes(1);

  return {
    view: render.mock.calls[0]![2] as string,
    vars: render.mock.calls[0]![3] as Record<string, any>,
  };
};

function liveToken(
  overrides?: Record<string, unknown>,
): Record<string, unknown> {
  return {
    _id: new ObjectID(TOKEN_ROW_ID),
    userId: new ObjectID(USER_ID),
    email: new Email(ASSERTED_EMAIL),
    expires: OneUptimeDate.getOneDayAfter(),
    ...(overrides || {}),
  };
}

// Nothing the link can write.
function expectNothingWritten(): void {
  expect(tokenDeleteOneBy).not.toHaveBeenCalled();
  expect(recordConsent).not.toHaveBeenCalled();
  expect(userUpdateOneById).not.toHaveBeenCalled();
  expect(teamMemberCreate).not.toHaveBeenCalled();
  expect(teamMemberUpdateBy).not.toHaveBeenCalled();
}

const INVALID_LINK_TITLE: string = "This link is not valid.";

describe("GET the confirmation link", () => {
  beforeEach(() => {
    tokenFindOneBy.mockResolvedValue(liveToken());
  });

  test("shows a button that posts the token back, and writes nothing", async () => {
    /*
     * Mail scanners open links before people do. Were this GET to act, the
     * scanner would be the one agreeing.
     */
    await openLink({ params: linkParams() });

    const { view, vars } = renderedPage();

    expect(view).toBe(SSO_SIGN_IN_CONFIRMATION_VIEW);
    expect(vars["formAction"]).toBe(
      `/identity/sso-sign-in-confirmation/saml/${PROJECT_ID}/${PROVIDER_ID}`,
    );
    expect(vars["token"]).toBe(TOKEN);
    expect(vars["signature"]).toBe(signatureFor(linkParams()));
    expect(vars["buttonText"]).toBe("Confirm Sign-In");
    expect(vars["message"]).toContain('"Acme <Production>"');

    expect(tokenFindOneBy).not.toHaveBeenCalled();
    expectNothingWritten();
  });

  test("keeps the token out of the form's action URL", async () => {
    await openLink({ params: linkParams() });

    expect(renderedPage().vars["formAction"]).not.toContain(TOKEN);
  });

  test("never loads third-party tags on a page whose URL carries a token", async () => {
    await openLink({ params: linkParams() });

    expect(renderedPage().vars["enableGoogleTagManager"]).toBe(false);
  });

  test.each([
    ["a tampered signature", {}, { signature: "0".repeat(64) }],
    ["no signature", {}, { signature: "" }],
    ["another project's id", { projectId: OTHER_PROJECT_ID }, {}],
    ["another kind of SSO", { kind: ProjectSsoKind.OIDC }, {}],
    ["an unknown kind of SSO", { kind: "ldap" }, {}],
    ["a malformed token", {}, { token: "not-a-token" }],
    ["a malformed project id", { projectId: "not-a-project" }, {}],
  ] as Array<
    [string, Partial<LinkParams>, { token?: string; signature?: string }]
  >)(
    "refuses %s without offering a button",
    async (
      _label: string,
      paramOverrides: Partial<LinkParams>,
      linkOverrides: { token?: string; signature?: string },
    ) => {
      const signedFor: LinkParams = linkParams();

      await openLink({
        params: linkParams(paramOverrides),
        token: linkOverrides.token,
        signature:
          linkOverrides.signature === undefined
            ? signatureFor(signedFor, linkOverrides.token)
            : linkOverrides.signature,
      });

      const { vars } = renderedPage();

      expect(vars["title"]).toBe(INVALID_LINK_TITLE);
      expect(vars["formAction"]).toBeUndefined();
      expect(vars["enableGoogleTagManager"]).toBe(false);
      expectNothingWritten();
    },
  );
});

describe("POST the confirmation -- a good link", () => {
  beforeEach(() => {
    tokenFindOneBy.mockResolvedValue(liveToken());
    storeUser({ isEmailVerified: false });
  });

  test("records this account's consent for this project", async () => {
    await pressConfirm({ params: linkParams() });

    expect(recordConsent).toHaveBeenCalledTimes(1);

    const call: Record<string, ObjectID> = recordConsent.mock
      .calls[0]![0] as Record<string, ObjectID>;

    expect(call["userId"]!.toString()).toBe(USER_ID);
    expect(call["projectId"]!.toString()).toBe(PROJECT_ID);
  });

  test("spends the token, so the link works once", async () => {
    await pressConfirm({ params: linkParams() });

    expect(tokenDeleteOneBy).toHaveBeenCalledTimes(1);
    expect(
      (tokenDeleteOneBy.mock.calls[0]![0] as Record<string, any>)["query"][
        "_id"
      ].toString(),
    ).toBe(TOKEN_ROW_ID);
  });

  test("verifies the address, because the link proved the mailbox", async () => {
    await pressConfirm({ params: linkParams() });

    expect(userUpdateOneById).toHaveBeenCalledTimes(1);

    const call: Record<string, any> = userUpdateOneById.mock
      .calls[0]![0] as Record<string, any>;

    expect(call["id"].toString()).toBe(USER_ID);
    expect(call["data"]).toEqual({ isEmailVerified: true });
  });

  test("leaves an already verified address alone", async () => {
    storeUser({ isEmailVerified: true });

    await pressConfirm({ params: linkParams() });

    expect(userUpdateOneById).not.toHaveBeenCalled();
    expect(recordConsent).toHaveBeenCalledTimes(1);
  });

  test("adds a newcomer to the provider's default teams, accepted", async () => {
    await pressConfirm({ params: linkParams() });

    expect(teamMemberCreate).toHaveBeenCalledTimes(2);

    const teamIds: Array<string> = teamMemberCreate.mock.calls.map(
      (call: Array<unknown>): string => {
        const member: Record<string, any> = (call[0] as Record<string, any>)[
          "data"
        ];

        expect(member["projectId"].toString()).toBe(PROJECT_ID);
        expect(member["userId"].toString()).toBe(USER_ID);
        expect(member["hasAcceptedInvitation"]).toBe(true);

        return member["teamId"].toString();
      },
    );

    expect(teamIds.sort()).toEqual([TEAM_ID, SECOND_TEAM_ID].sort());
    expect(teamMemberUpdateBy).not.toHaveBeenCalled();
  });

  test("accepts a pending invitation into the project instead of adding teams", async () => {
    teamMemberCountBy.mockResolvedValue(new PositiveNumber(1));

    await pressConfirm({ params: linkParams() });

    expect(teamMemberCreate).not.toHaveBeenCalled();
    expect(teamMemberUpdateBy).toHaveBeenCalledTimes(1);

    const call: Record<string, any> = teamMemberUpdateBy.mock
      .calls[0]![0] as Record<string, any>;

    expect(call["query"]["projectId"].toString()).toBe(PROJECT_ID);
    expect(call["query"]["userId"].toString()).toBe(USER_ID);
    expect(call["query"]["hasAcceptedInvitation"]).toBe(false);
    expect(call["data"]["hasAcceptedInvitation"]).toBe(true);
  });

  test("still signs nobody in -- it sends them back through the provider", async () => {
    await pressConfirm({ params: linkParams() });

    const { vars } = renderedPage();

    expect(vars["title"]).toBe("Single sign-on confirmed.");
    expect(vars["linkUrl"]).toBe(`/identity/sso/${PROJECT_ID}/${PROVIDER_ID}`);
    expect(vars["enableGoogleTagManager"]).toBe(false);
    expect(createSession).not.toHaveBeenCalled();
    expect(setUserCookie).not.toHaveBeenCalled();
    expect(signUserLoginToken).not.toHaveBeenCalled();
  });

  test("sends an OIDC confirmation back to the OIDC sign-in", async () => {
    const params: LinkParams = linkParams({ kind: ProjectSsoKind.OIDC });

    await pressConfirm({ params });

    expect(renderedPage().vars["linkUrl"]).toBe(
      `/identity/oidc/${PROJECT_ID}/${PROVIDER_ID}`,
    );
    expect(oidcProviderFindOneBy).toHaveBeenCalledTimes(1);
    expect(samlProviderFindOneBy).not.toHaveBeenCalled();
  });

  test("refreshes the account's permissions for its new membership", async () => {
    await pressConfirm({ params: linkParams() });

    expect(refreshUserAllPermissions).toHaveBeenCalledTimes(1);
  });

  test("writes the memberships before verifying, so their defaults are created", async () => {
    await pressConfirm({ params: linkParams() });

    const membershipOrder: number =
      teamMemberCreate.mock.invocationCallOrder[0]!;
    const verifyOrder: number = userUpdateOneById.mock.invocationCallOrder[0]!;
    const spendOrder: number = tokenDeleteOneBy.mock.invocationCallOrder[0]!;

    expect(spendOrder).toBeLessThan(membershipOrder);
    expect(membershipOrder).toBeLessThan(verifyOrder);
  });
});

describe("POST the confirmation -- links that must do nothing", () => {
  beforeEach(() => {
    tokenFindOneBy.mockResolvedValue(liveToken());
  });

  test.each([
    ["a tampered signature", {}, { signature: "f".repeat(64) }],
    ["no signature", {}, { signature: "" }],
    ["another project's id", { projectId: OTHER_PROJECT_ID }, {}],
    ["another provider's id", { providerId: TOKEN_ROW_ID }, {}],
    ["another kind of SSO", { kind: ProjectSsoKind.OIDC }, {}],
    ["an unknown kind of SSO", { kind: "ldap" }, {}],
    ["a malformed token", {}, { token: "not-a-token" }],
  ] as Array<
    [string, Partial<LinkParams>, { token?: string; signature?: string }]
  >)(
    "refuses %s",
    async (
      _label: string,
      paramOverrides: Partial<LinkParams>,
      linkOverrides: { token?: string; signature?: string },
    ) => {
      await pressConfirm({
        params: linkParams(paramOverrides),
        token: linkOverrides.token,
        signature:
          linkOverrides.signature === undefined
            ? signatureFor(linkParams(), linkOverrides.token)
            : linkOverrides.signature,
      });

      expect(renderedPage().vars["title"]).toBe(INVALID_LINK_TITLE);
      expectNothingWritten();
    },
  );

  test("refuses a welcome-email token, which was never signed for any project", async () => {
    /*
     * Every EmailVerificationToken proves the same thing -- "controls this
     * mailbox" -- so the signature is what makes one a consent to SSO.
     */
    await pressConfirm({ params: linkParams(), signature: "" });

    expect(renderedPage().vars["title"]).toBe(INVALID_LINK_TITLE);
    expectNothingWritten();
  });

  test("refuses a token nobody minted", async () => {
    tokenFindOneBy.mockResolvedValue(null);

    await pressConfirm({ params: linkParams() });

    expect(renderedPage().vars["title"]).toBe(INVALID_LINK_TITLE);
    expectNothingWritten();
  });

  test("refuses an expired link, and does not spend it", async () => {
    tokenFindOneBy.mockResolvedValue(
      liveToken({ expires: OneUptimeDate.getSomeDaysAgo(1) }),
    );

    await pressConfirm({ params: linkParams() });

    expect(renderedPage().vars["title"]).toBe("This link has expired.");
    expectNothingWritten();
  });

  test("refuses a link once the account has moved to another address", async () => {
    storeUser({ email: new Email("someone-else@example.com") });

    await pressConfirm({ params: linkParams() });

    expect(renderedPage().vars["title"]).toBe(INVALID_LINK_TITLE);
    expectNothingWritten();
  });

  test("refuses a link whose account no longer exists", async () => {
    storedRow = null;

    await pressConfirm({ params: linkParams() });

    expect(renderedPage().vars["title"]).toBe(INVALID_LINK_TITLE);
    expectNothingWritten();
  });

  test("refuses a blocked account", async () => {
    storeUser({ isBlocked: true });

    await pressConfirm({ params: linkParams() });

    expect(renderedPage().vars).toEqual(
      expect.objectContaining({
        title: "Account blocked.",
        message: ExceptionMessages.UserBlocked,
      }),
    );
    expectNothingWritten();
  });

  test("refuses when the provider has been turned off since, and keeps the link", async () => {
    samlProviderFindOneBy.mockResolvedValue(null);

    await pressConfirm({ params: linkParams() });

    expect(renderedPage().vars["title"]).toBe(
      "Single sign-on is not available.",
    );
    expectNothingWritten();

    const query: Record<string, unknown> = (
      samlProviderFindOneBy.mock.calls[0]![0] as Record<string, any>
    )["query"];

    expect(query["isEnabled"]).toBe(true);
    expect((query["projectId"] as ObjectID).toString()).toBe(PROJECT_ID);
  });

  test("refuses a newcomer when the provider has no default teams", async () => {
    samlProviderFindOneBy.mockResolvedValue({ teams: [] });

    await pressConfirm({ params: linkParams() });

    expect(renderedPage().vars["title"]).toBe("No teams added.");
    expectNothingWritten();
  });

  test("lets only one of two racing clicks act", async () => {
    // The other click deleted the row between our read and our delete.
    tokenDeleteOneBy.mockResolvedValue(0);

    await pressConfirm({ params: linkParams() });

    expect(renderedPage().vars["title"]).toBe(INVALID_LINK_TITLE);
    expect(recordConsent).not.toHaveBeenCalled();
    expect(userUpdateOneById).not.toHaveBeenCalled();
    expect(teamMemberCreate).not.toHaveBeenCalled();
  });
});

/*
 * ===========================================================================
 * The pieces, directly.
 * ===========================================================================
 */

describe("ProjectSsoSignInConfirmation", () => {
  test("is required only on the hosted service", () => {
    setTestBillingEnabled(true);
    expect(ProjectSsoSignInConfirmation.isRequired()).toBe(true);

    setTestBillingEnabled(false);
    expect(ProjectSsoSignInConfirmation.isRequired()).toBe(false);
  });

  test("a signature changes with every field it binds", () => {
    const base: {
      token: string;
      kind: ProjectSsoKind;
      projectId: string;
      providerId: string;
    } = {
      token: TOKEN,
      kind: ProjectSsoKind.SAML,
      projectId: PROJECT_ID,
      providerId: PROVIDER_ID,
    };

    const signature: string = ProjectSsoSignInConfirmation.getSignature(base);

    expect(signature).toMatch(/^[0-9a-f]{64}$/);
    expect(ProjectSsoSignInConfirmation.getSignature(base)).toBe(signature);

    for (const changed of [
      { token: TOKEN_ROW_ID },
      { kind: ProjectSsoKind.OIDC },
      { projectId: OTHER_PROJECT_ID },
      { providerId: TOKEN_ROW_ID },
    ]) {
      expect(
        ProjectSsoSignInConfirmation.getSignature({ ...base, ...changed }),
      ).not.toBe(signature);
    }
  });

  test.each(["", "short", "g".repeat(64), "0".repeat(65)])(
    "rejects the signature %p without throwing",
    (signature: string) => {
      expect(
        ProjectSsoSignInConfirmation.isSignatureValid({
          token: TOKEN,
          signature,
          kind: ProjectSsoKind.SAML,
          projectId: PROJECT_ID,
          providerId: PROVIDER_ID,
        }),
      ).toBe(false);
    },
  );

  test("an unverified account is never confirmed, whatever the consent table says", async () => {
    hasConsent.mockResolvedValue(true);

    const user: User = new User();
    user.id = new ObjectID(USER_ID);
    user.isEmailVerified = false;

    await expect(
      ProjectSsoSignInConfirmation.isSignInConfirmed({
        user,
        projectId: new ObjectID(PROJECT_ID),
      }),
    ).resolves.toBe(false);
    expect(hasConsent).not.toHaveBeenCalled();
  });

  test("the confirm result names every outcome the page renders", async () => {
    tokenFindOneBy.mockResolvedValue(liveToken());

    const result: ProjectSsoConfirmationResult =
      await ProjectSsoSignInConfirmation.confirm({
        token: TOKEN,
        signature: signatureFor(linkParams()),
        kind: ProjectSsoKind.SAML,
        projectId: PROJECT_ID,
        providerId: PROVIDER_ID,
      });

    expect(result.outcome).toBe(ProjectSsoConfirmationOutcome.Confirmed);
  });
});

describe("the confirmation email template", () => {
  /*
   * The template lives in the App (core) package, which is what renders every
   * email, and the variables are set here. A rename on either side renders a
   * button that points nowhere.
   */
  const templateSource: string = fs.readFileSync(
    nodePath.join(
      __dirname,
      "..",
      "..",
      "..",
      "..",
      "packages",
      "App",
      "FeatureSet",
      "Notification",
      "Templates",
      "ConfirmProjectSsoSignIn.hbs",
    ),
    "utf8",
  );

  test("uses the variables the confirmation email sets", async () => {
    await FLOWS[0]!.run({ isMobile: false });

    const vars: Record<string, string> = confirmationMail().vars;

    for (const variable of ["confirmationUrl", "signInSummary", "expiryNote"]) {
      expect(vars[variable]).toBeTruthy();
      expect(templateSource).toContain(variable);
    }
  });

  test("prints the admin-chosen project name only through escaped plainInfo", () => {
    expect(templateSource).toContain("plainInfo=signInSummary");
    expect(templateSource).not.toMatch(/info=signInSummary/);
    expect(templateSource).not.toContain("{{{signInSummary}}}");
  });
});
