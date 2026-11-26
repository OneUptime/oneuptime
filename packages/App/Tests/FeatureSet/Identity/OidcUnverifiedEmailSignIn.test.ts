import { beforeEach, describe, expect, test } from "@jest/globals";
import OIDCRouter from "../../../FeatureSet/Identity/API/OIDC";
import GlobalOIDCRouter from "../../../FeatureSet/Identity/API/GlobalOIDC";
import {
  PROVIDER_EMAIL_NOT_VERIFIED_ERROR,
  PROVIDER_EMAIL_NOT_VERIFIED_MESSAGE,
  PROVIDER_EMAIL_NOT_VERIFIED_TITLE,
  ProviderEmailVerification,
} from "../../../FeatureSet/Identity/Utils/OidcEmailVerification";
import ProjectSsoSignInConfirmation, {
  PROJECT_SSO_CONFIRMATION_REQUIRED_MESSAGE,
  PROJECT_SSO_CONFIRMATION_REQUIRED_TITLE,
} from "../../../FeatureSet/Identity/Utils/ProjectSsoSignInConfirmation";
import ProjectSsoSignInGate from "../../../FeatureSet/Identity/Utils/ProjectSsoSignInGate";
import SsoTeamMembership, {
  SsoTeamMembershipOutcome,
} from "../../../FeatureSet/Identity/Utils/SsoTeamMembership";
import {
  ExpressRequest,
  ExpressResponse,
  ExpressRouter,
  RequestHandler,
} from "Common/Server/Utils/Express";
import User from "Common/Models/DatabaseModels/User";
import { SignInFailureReason } from "Common/Types/AuditLog/AuditLogSignInFailure";
import Email from "Common/Types/Email";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import PositiveNumber from "Common/Types/PositiveNumber";
import { SignInMethod } from "Common/Types/UserSession/SessionSignIn";
import { setTestBillingEnabled } from "Common/Tests/Server/Enterprise/TestBillingFlag";

/*
 * ---------------------------------------------------------------------------
 * AN OPENID CONNECT SIGN-IN NEVER USES AN ADDRESS ITS PROVIDER SAYS IT HAS
 * NOT VERIFIED (GHSA-8gwc-w386-fh6w), THROUGH THE CALLBACKS THEMSELVES.
 *
 * The two callbacks that find or make a OneUptime account by the address an
 * OpenID Connect provider sends - the server's own providers' (Global OIDC)
 * and a project's - are run through their real route handlers, on the web
 * and from the mobile app, on a self-hosted server and on the hosted
 * service. The provider is stubbed where its answer has been verified (the
 * code exchange, Utils/OIDC), so what arrives is a signed identity, with
 * what the provider said of its address. UserService honours `select`.
 *
 * Before the fix, an ID token with email_verified: false signed its holder
 * in to the account at the address - a master admin's through Global OIDC
 * - or made an account with it, marked verified. Now it signs nobody in:
 * no session, no cookie, no account made, no team joined, no invitation
 * accepted, no address marked verified, nothing emailed - and the account
 * at the address has the attempt in its audit logs. A provider that
 * verified the address, or says nothing of it (Microsoft Entra ID), signs
 * in as before. OidcEmailVerifiedEndToEnd.test.ts does the same against a
 * real provider.
 * ---------------------------------------------------------------------------
 */

const ADDRESS: string = "victim@example.com";
const USER_ID: string = "88888888-8888-4888-8888-888888888888";
const NEW_USER_ID: string = "77777777-7777-4777-8777-777777777777";
const PROJECT_ID: string = "99999999-9999-4999-8999-999999999999";
const PROVIDER_ID: string = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const TEAM_ID: string = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const PROVIDER_NAME: string = "Acme Keycloak";

// The account at the address, as the database holds it, or none.
let storedRow: Record<string, unknown> | null = null;

const recordFailedSignIn: jest.Mock = jest.fn();

jest.mock("Common/Server/Utils/AuditLog/FailedSignInAuditLog", () => {
  return {
    __esModule: true,
    default: {
      record: (...args: Array<unknown>): unknown => {
        return recordFailedSignIn(...args);
      },
    },
  };
});

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

const userFindOneBy: jest.Mock = jest.fn();
const userCreateByEmail: jest.Mock = jest.fn();
const userUpdateOneById: jest.Mock = jest.fn();

jest.mock("Common/Server/Services/UserService", () => {
  return {
    __esModule: true,
    default: {
      findOneBy: (...args: Array<unknown>): unknown => {
        return userFindOneBy(...args);
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
const teamMemberUpdateBy: jest.Mock = jest.fn();

jest.mock("Common/Server/Services/TeamMemberService", () => {
  return {
    __esModule: true,
    default: {
      countBy: (...args: Array<unknown>): unknown => {
        return teamMemberCountBy(...args);
      },
      findBy: jest.fn(),
      // Signing in through a project's provider accepts its pending invitations (#9819).
      updateBy: (...args: Array<unknown>): unknown => {
        return teamMemberUpdateBy(...args);
      },
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

// On the hosted service a project's provider needs the account's consent.
const hasConsent: jest.Mock = jest.fn();

jest.mock("Common/Server/Services/UserProjectSsoConsentService", () => {
  return {
    __esModule: true,
    default: {
      hasConsent: (...args: Array<unknown>): unknown => {
        return hasConsent(...args);
      },
      recordConsent: jest.fn(),
    },
  };
});

const providerFindOneBy: jest.Mock = jest.fn();
const attachmentsFindBy: jest.Mock = jest.fn();

jest.mock("Common/Server/Services/ProjectOidcService", () => {
  return {
    __esModule: true,
    default: {
      findOneBy: (...args: Array<unknown>): unknown => {
        return providerFindOneBy(...args);
      },
    },
  };
});

jest.mock("Common/Server/Services/GlobalOidcService", () => {
  return {
    __esModule: true,
    default: {
      findOneBy: (...args: Array<unknown>): unknown => {
        return providerFindOneBy(...args);
      },
      findBy: jest.fn(),
    },
  };
});

jest.mock("Common/Server/Services/GlobalOidcProjectService", () => {
  return {
    __esModule: true,
    default: {
      findBy: (...args: Array<unknown>): unknown => {
        return attachmentsFindBy(...args);
      },
    },
  };
});

/*
 * A code exchange that succeeded, with an ID token that validated: the
 * identity below is what the provider signed, with what it said of the
 * address (Utils/OIDC reads it; OIDC.test.ts holds that reading).
 */
let providerVerification: ProviderEmailVerification | undefined =
  ProviderEmailVerification.Verified;

jest.mock("../../../FeatureSet/Identity/Utils/OIDC", () => {
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
          emailVerification: providerVerification,
          name: null,
          issuer: "https://idp.example.com/realms/acme",
          rawClaims: {},
          idToken: null,
        });
      },
      getEndSessionEndpoint: (): null => {
        return null;
      },
    },
  };
});

const sendVerificationEmail: jest.Mock = jest.fn();

jest.mock("../../../FeatureSet/Identity/Utils/AuthenticationEmail", () => {
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
const setGlobalSSOCookie: jest.Mock = jest.fn();

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
      setGlobalSSOCookie: (...args: Array<unknown>): unknown => {
        return setGlobalSSOCookie(...args);
      },
      getSSOToken: (): string => {
        return "sso-token";
      },
      getGlobalSSOToken: (): string => {
        return "global-sso-token";
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
        return Promise.resolve({
          toString: (): string => {
            return "localhost";
          },
        });
      },
      getHttpProtocol: (): Promise<unknown> => {
        return Promise.resolve({
          toString: (): string => {
            return "http://";
          },
        });
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

// The route's own handler: the last one in its stack.
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

interface Callback {
  name: string;
  router: ExpressRouter;
  path: string;
  params: Record<string, string>;
  isGlobal: boolean;
}

const GLOBAL_OIDC: Callback = {
  name: "Global OIDC (/global-oidc-callback)",
  router: GlobalOIDCRouter,
  path: "/global-oidc-callback/:globalOidcId",
  params: { globalOidcId: PROVIDER_ID },
  isGlobal: true,
};

const PROJECT_OIDC: Callback = {
  name: "project OIDC (/oidc-callback)",
  router: OIDCRouter,
  path: "/oidc-callback/:projectId/:projectOidcId",
  params: { projectId: PROJECT_ID, projectOidcId: PROVIDER_ID },
  isGlobal: false,
};

interface Flow extends Callback {
  billing: boolean;
  isMobile: boolean;
}

// Each callback, on a self-hosted server and the hosted service, web and mobile.
const FLOWS: Array<Flow> = [GLOBAL_OIDC, PROJECT_OIDC].flatMap(
  (callback: Callback): Array<Flow> => {
    return [false, true].flatMap((billing: boolean): Array<Flow> => {
      return [false, true].map((isMobile: boolean): Flow => {
        return {
          ...callback,
          name: `${callback.name}, ${billing ? "hosted service" : "self-hosted"}, ${isMobile ? "mobile app" : "web"}`,
          billing,
          isMobile,
        };
      });
    });
  },
);

// res.redirect: where the mobile flows send the app its deep link.
const resRedirect: jest.Mock = jest.fn();

async function runFlow(flow: {
  router: ExpressRouter;
  path: string;
  params: Record<string, string>;
  billing: boolean;
  isMobile: boolean;
}): Promise<{ nextError: unknown }> {
  setTestBillingEnabled(flow.billing);

  // The OIDC flows carry "mobile" in their signed state cookie.
  oidcStateIsMobile = flow.isMobile;

  const req: ExpressRequest = {
    params: flow.params,
    body: {},
    query: { code: "code", state: "state" },
    headers: {},
    cookies: {},
    socket: { remoteAddress: "203.0.113.7" },
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

  await (handlerFor(flow.router, "GET", flow.path)(
    req,
    res,
    (err?: unknown): void => {
      nextError = err;
    },
  ) as unknown as Promise<void>);

  /*
   * What the hosted service's gate mails in the background, waited for, so
   * a confirmation email it sent would be seen.
   */
  await ProjectSsoSignInGate.waitForBackgroundWork();

  return { nextError };
}

type AccountKind = "ordinary" | "master admin" | "none";

function storeAccount(
  kind: AccountKind,
  overrides: Record<string, unknown> = {},
): void {
  storedRow =
    kind === "none"
      ? null
      : {
          _id: USER_ID,
          email: new Email(ADDRESS),
          name: "Victim",
          isMasterAdmin: kind === "master admin",
          isEmailVerified: true,
          isBlocked: false,
          timezone: null,
          ...overrides,
        };
}

function projectOntoSelect(
  row: Record<string, unknown>,
  select: Record<string, unknown>,
): User {
  const user: Record<string, unknown> = new User() as unknown as Record<
    string,
    unknown
  >;

  for (const column of Object.keys(select)) {
    if (select[column] && row[column] !== undefined) {
      user[column] = row[column];
    }
  }

  return user as unknown as User;
}

// Nothing a sign-in hands out, and nothing made, joined or written on the way.
function expectNobodySignedInAndNothingWritten(): void {
  expect(createSession).not.toHaveBeenCalled();
  expect(signUserLoginToken).not.toHaveBeenCalled();
  expect(setUserCookie).not.toHaveBeenCalled();
  expect(setSSOCookie).not.toHaveBeenCalled();
  expect(setGlobalSSOCookie).not.toHaveBeenCalled();
  expect(userCreateByEmail).not.toHaveBeenCalled();
  expect(userUpdateOneById).not.toHaveBeenCalled();
  expect(addToTeams).not.toHaveBeenCalled();
  expect(teamMemberUpdateBy).not.toHaveBeenCalled();
  expect(refreshUserAllPermissions).not.toHaveBeenCalled();
  expect(responseRedirect).not.toHaveBeenCalled();
}

// Nothing mailed: no verification link, no project confirmation.
function expectNothingEmailed(): void {
  expect(sendVerificationEmail).not.toHaveBeenCalled();
  expect(requestConfirmation).not.toHaveBeenCalled();
  expect(requestConfirmationForNewAccount).not.toHaveBeenCalled();
}

// The answer a refused sign-in gets: the page, or the app's deep link.
function expectToldToVerifyTheAddress(flow: { isMobile: boolean }): void {
  if (flow.isMobile) {
    expect(render).not.toHaveBeenCalled();
    expect(resRedirect).toHaveBeenCalledTimes(1);

    const deepLink: string = resRedirect.mock.calls[0]![0] as string;
    const params: URLSearchParams = new URLSearchParams(
      deepLink.split("?")[1] || "",
    );

    expect(deepLink.startsWith("oneuptime://sso-callback?")).toBe(true);
    expect(params.get("error")).toBe(PROVIDER_EMAIL_NOT_VERIFIED_ERROR);
    expect(params.get("errorDescription")).toBe(
      PROVIDER_EMAIL_NOT_VERIFIED_MESSAGE,
    );
    expect(params.get("accessToken")).toBeNull();
    expect(params.get("refreshToken")).toBeNull();
    expect(params.get("code")).toBeNull();
    return;
  }

  expect(resRedirect).not.toHaveBeenCalled();
  expect(sendErrorResponse).not.toHaveBeenCalled();
  expect(render).toHaveBeenCalledTimes(1);
  expect(render.mock.calls[0]![3]).toEqual({
    title: PROVIDER_EMAIL_NOT_VERIFIED_TITLE,
    message: PROVIDER_EMAIL_NOT_VERIFIED_MESSAGE,
  });
}

let addToTeams: jest.SpiedFunction<typeof SsoTeamMembership.addToTeams>;
let requestConfirmation: jest.SpiedFunction<
  typeof ProjectSsoSignInConfirmation.requestConfirmation
>;
let requestConfirmationForNewAccount: jest.SpiedFunction<
  typeof ProjectSsoSignInConfirmation.requestConfirmationForNewAccount
>;

beforeEach(() => {
  jest.restoreAllMocks();
  jest.clearAllMocks();

  oidcStateIsMobile = false;
  providerVerification = ProviderEmailVerification.Verified;

  storeAccount("ordinary");

  userFindOneBy.mockImplementation((data: { select: JSONObject }) => {
    return Promise.resolve(
      storedRow ? projectOntoSelect(storedRow, data.select) : null,
    );
  });

  userCreateByEmail.mockImplementation(
    (data: { email: Email; isEmailVerified: boolean }) => {
      const created: User = new User();
      created._id = NEW_USER_ID;
      created.email = data.email;
      created.isEmailVerified = data.isEmailVerified;
      created.isMasterAdmin = false;
      created.isBlocked = false;
      return Promise.resolve(created);
    },
  );

  userUpdateOneById.mockResolvedValue(undefined);

  providerFindOneBy.mockResolvedValue({
    id: new ObjectID(PROVIDER_ID),
    name: PROVIDER_NAME,
    issuerURL: "https://idp.example.com/realms/acme",
    discoveryURL:
      "https://idp.example.com/realms/acme/.well-known/openid-configuration",
    clientId: "client-id",
    clientSecret: "client-secret",
    teams: [{ id: new ObjectID(TEAM_ID) }],
    disableSignUpWithSso: false,
    restrictToAttachedProjects: false,
  });

  // An attached project with a default team: Global OIDC makes accounts.
  attachmentsFindBy.mockResolvedValue([
    {
      projectId: new ObjectID(PROJECT_ID),
      teams: [{ id: new ObjectID(TEAM_ID) }],
    },
  ]);

  // Already a member, so every flow has a project to sign in to.
  teamMemberCountBy.mockResolvedValue(new PositiveNumber(1));
  teamMemberUpdateBy.mockResolvedValue(0);

  hasConsent.mockResolvedValue(true);

  createSession.mockResolvedValue({
    session: { id: ObjectID.generate() },
    refreshToken: "refresh-token",
    refreshTokenExpiresAt: new Date(),
    accessTokenExpiresInSeconds: 900,
    ssoSignInExpiresInSeconds: 3600,
  });
  signUserLoginToken.mockReturnValue("signed-user-token");

  addToTeams = jest
    .spyOn(SsoTeamMembership, "addToTeams")
    .mockResolvedValue(SsoTeamMembershipOutcome.Added);
  requestConfirmation = jest
    .spyOn(ProjectSsoSignInConfirmation, "requestConfirmation")
    .mockResolvedValue(undefined);
  requestConfirmationForNewAccount = jest
    .spyOn(ProjectSsoSignInConfirmation, "requestConfirmationForNewAccount")
    .mockResolvedValue(undefined);
});

const REFUSED: Array<ProviderEmailVerification> = [
  ProviderEmailVerification.Unverified,
  ProviderEmailVerification.Unreadable,
];

describe.each(FLOWS)("$name", (flow: Flow) => {
  describe.each(REFUSED)(
    "when the provider's email_verified is %s",
    (verification: ProviderEmailVerification) => {
      beforeEach(() => {
        providerVerification = verification;
      });

      test("signs nobody in to an ordinary account at the address", async () => {
        storeAccount("ordinary");

        const result: { nextError: unknown } = await runFlow(flow);

        expect(result.nextError).toBeUndefined();
        expectToldToVerifyTheAddress(flow);
        expectNobodySignedInAndNothingWritten();
        expectNothingEmailed();
      });

      /*
       * The report's headline: a master admin's account, reached through
       * the server's own provider, which is trusted with administrators -
       * but not with an address it says it has not verified.
       */
      test("signs nobody in to a master admin's account at the address", async () => {
        storeAccount("master admin");

        await runFlow(flow);

        expectToldToVerifyTheAddress(flow);
        expectNobodySignedInAndNothingWritten();
        expectNothingEmailed();
      });

      // An address no account has yet: no account is made with it.
      test("makes no account with the address, where sign-up is open", async () => {
        storeAccount("none");

        await runFlow(flow);

        expectToldToVerifyTheAddress(flow);
        expectNobodySignedInAndNothingWritten();
        expectNothingEmailed();
      });

      /*
       * An account OneUptime has not verified yet is sent no verification
       * link, and is not marked verified: the provider vouched for nothing.
       */
      test("neither verifies nor emails an account OneUptime has not verified yet", async () => {
        storeAccount("ordinary", { isEmailVerified: false });

        await runFlow(flow);

        expectToldToVerifyTheAddress(flow);
        expectNobodySignedInAndNothingWritten();
        expectNothingEmailed();
      });

      // Pending invitations into the project stay pending (#9819).
      test("accepts no invitation the account has waiting", async () => {
        storeAccount("ordinary");
        teamMemberCountBy.mockResolvedValue(new PositiveNumber(0));

        await runFlow(flow);

        expect(teamMemberUpdateBy).not.toHaveBeenCalled();
        expect(addToTeams).not.toHaveBeenCalled();
      });

      test("asks nothing of the hosted service's consent, and reads the account by its id alone", async () => {
        storeAccount("ordinary");

        await runFlow(flow);

        expect(hasConsent).not.toHaveBeenCalled();
        expect(userFindOneBy).toHaveBeenCalledTimes(1);
        expect(
          (userFindOneBy.mock.calls[0]![0] as { select: JSONObject }).select,
        ).toEqual({ _id: true });
      });

      test("records the attempt in the account's audit logs: an unverified address, through this provider", async () => {
        storeAccount("ordinary");

        await runFlow(flow);

        expect(recordFailedSignIn).toHaveBeenCalledTimes(1);

        const attempt: {
          userId: ObjectID;
          reason: SignInFailureReason;
          signIn: {
            method: SignInMethod;
            ssoProviderName?: string | undefined;
            ssoProjectId?: ObjectID | undefined;
          };
        } = recordFailedSignIn.mock.calls[0]![0] as never;

        expect(attempt.userId.toString()).toBe(USER_ID);
        expect(attempt.reason).toBe(SignInFailureReason.EmailNotVerified);
        expect(attempt.signIn.method).toBe(SignInMethod.OpenIdConnect);
        expect(attempt.signIn.ssoProviderName).toBe(PROVIDER_NAME);

        /*
         * A project's provider is named only in that project's entry; the
         * server's own provider in every project's.
         */
        if (flow.isGlobal) {
          expect(attempt.signIn.ssoProjectId).toBeUndefined();
        } else {
          expect(attempt.signIn.ssoProjectId?.toString()).toBe(PROJECT_ID);
        }
      });

      test("records nothing for an address no account has, and answers it the same", async () => {
        storeAccount("none");

        await runFlow(flow);

        expect(recordFailedSignIn).not.toHaveBeenCalled();
        expectToldToVerifyTheAddress(flow);
      });
    },
  );

  /*
   * The controls: the same request, with a provider that verified the
   * address or says nothing of it, signs in as it always did.
   */
  describe.each([
    ProviderEmailVerification.Verified,
    ProviderEmailVerification.NotStated,
    // A stub from before the field existed: the callbacks go on.
    undefined,
  ])(
    "when the provider's email_verified is %s",
    (verification: ProviderEmailVerification | undefined) => {
      beforeEach(() => {
        providerVerification = verification;
      });

      test("still signs in the ordinary account at the address", async () => {
        storeAccount("ordinary");

        const result: { nextError: unknown } = await runFlow(flow);

        expect(result.nextError).toBeUndefined();
        expect(sendErrorResponse).not.toHaveBeenCalled();
        expect(createSession).toHaveBeenCalledTimes(1);
        expect(
          (
            createSession.mock.calls[0]![0] as { userId: ObjectID }
          ).userId.toString(),
        ).toBe(USER_ID);
        expect(recordFailedSignIn).not.toHaveBeenCalled();

        if (flow.isMobile) {
          expect(render).not.toHaveBeenCalled();
          expect(resRedirect).toHaveBeenCalledTimes(1);
          expect(
            new URLSearchParams(
              (resRedirect.mock.calls[0]![0] as string).split("?")[1] || "",
            ).get("error"),
          ).toBeNull();
        } else {
          expect(render).not.toHaveBeenCalled();
          expect(setUserCookie).toHaveBeenCalledTimes(1);
          expect(responseRedirect).toHaveBeenCalledTimes(1);
        }
      });
    },
  );
});

/*
 * Who the server's own provider still signs in when it vouches for the
 * address, or says nothing of it: a master admin (GHSA-358p-w79v-cc3r keeps
 * the server's own providers trusted with administrators), and someone new,
 * where projects are attached and sign-up is open.
 */
describe.each([
  ProviderEmailVerification.Verified,
  ProviderEmailVerification.NotStated,
])(
  "Global OIDC, when the provider's email_verified is %s",
  (verification: ProviderEmailVerification) => {
    beforeEach(() => {
      providerVerification = verification;
    });

    test("signs in a master admin, as an administrator", async () => {
      storeAccount("master admin");

      await runFlow({ ...GLOBAL_OIDC, billing: false, isMobile: false });

      expect(render).not.toHaveBeenCalled();
      expect(createSession).toHaveBeenCalledTimes(1);
      expect(setUserCookie).toHaveBeenCalledTimes(1);
      expect(
        (setUserCookie.mock.calls[0]![0] as { user: User }).user.isMasterAdmin,
      ).toBe(true);
    });

    test("makes an account for someone new, verified, and adds them to the attached project", async () => {
      storeAccount("none");
      /*
       * Not in the attached project yet - then, once added to it, a member
       * of one project, which is what a Global OIDC session needs.
       */
      teamMemberCountBy.mockResolvedValueOnce(new PositiveNumber(0));

      await runFlow({ ...GLOBAL_OIDC, billing: false, isMobile: false });

      expect(userCreateByEmail).toHaveBeenCalledTimes(1);

      const made: { email: Email; isEmailVerified: boolean } = userCreateByEmail
        .mock.calls[0]![0] as never;

      expect(made.email.toString()).toBe(ADDRESS);
      expect(made.isEmailVerified).toBe(true);
      expect(addToTeams).toHaveBeenCalledTimes(1);
      expect(createSession).toHaveBeenCalledTimes(1);
    });
  },
);

/*
 * The same for a project's provider: someone new is made an account on a
 * self-hosted server, and asked to confirm from their mailbox on the hosted
 * service, as before.
 */
describe.each([
  ProviderEmailVerification.Verified,
  ProviderEmailVerification.NotStated,
])(
  "project OIDC, when the provider's email_verified is %s",
  (verification: ProviderEmailVerification) => {
    beforeEach(() => {
      providerVerification = verification;
    });

    test("makes an account for someone new on a self-hosted server", async () => {
      storeAccount("none");
      teamMemberCountBy.mockResolvedValue(new PositiveNumber(0));

      await runFlow({ ...PROJECT_OIDC, billing: false, isMobile: false });

      expect(userCreateByEmail).toHaveBeenCalledTimes(1);
      expect(addToTeams).toHaveBeenCalledTimes(1);
      expect(createSession).toHaveBeenCalledTimes(1);
    });

    test("asks someone new to confirm from their mailbox on the hosted service", async () => {
      storeAccount("none");

      await runFlow({ ...PROJECT_OIDC, billing: true, isMobile: false });

      expect(userCreateByEmail).not.toHaveBeenCalled();
      expect(requestConfirmationForNewAccount).toHaveBeenCalledTimes(1);
      expect(render.mock.calls[0]![3]).toEqual({
        title: PROJECT_SSO_CONFIRMATION_REQUIRED_TITLE,
        message: PROJECT_SSO_CONFIRMATION_REQUIRED_MESSAGE,
      });
      expect(createSession).not.toHaveBeenCalled();
    });
  },
);
