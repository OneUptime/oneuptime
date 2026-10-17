import { beforeEach, describe, expect, test } from "@jest/globals";
import SSORouter from "../../../FeatureSet/Identity/API/SSO";
import OIDCRouter from "../../../FeatureSet/Identity/API/OIDC";
import GlobalSSORouter from "../../../FeatureSet/Identity/API/GlobalSSO";
import GlobalOIDCRouter from "../../../FeatureSet/Identity/API/GlobalOIDC";
import {
  SSO_NO_ROOM_ERROR,
  SSO_NO_ROOM_MESSAGE,
  SSO_NO_ROOM_TITLE,
} from "../../../FeatureSet/Identity/Utils/SsoTeamMembership";
import {
  ExpressRequest,
  ExpressResponse,
  ExpressRouter,
  RequestHandler,
} from "Common/Server/Utils/Express";
import Errors from "Common/Server/Utils/Errors";
import logger from "Common/Server/Utils/Logger";
import User from "Common/Models/DatabaseModels/User";
import Email from "Common/Types/Email";
import BadDataException from "Common/Types/Exception/BadDataException";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import PositiveNumber from "Common/Types/PositiveNumber";
import { setTestBillingEnabled } from "Common/Tests/Server/Enterprise/TestBillingFlag";

/*
 * ---------------------------------------------------------------------------
 * A PROJECT WITH NO ROOM FOR SOMEONE SIGNING IN THROUGH SINGLE SIGN-ON.
 *
 * The first time someone signs in through a project's SAML or OIDC provider,
 * or an instance-wide one attached to projects, they join the provider's
 * teams - and take a seat in each project like anyone invited. A project
 * with no room for one more person (its plan's seats all taken, or the Free
 * plan's one person there already) refuses them, in words written for
 * whoever invites (Errors.TeamMemberService).
 *
 *  - Through a project's own provider, that person is told the project has
 *    no room, on a page of their own (or on the mobile app's deep link),
 *    and is given no session - never the inviter's sentence as a raw error.
 *  - Through an instance-wide provider, that project is left out: they are
 *    signed in to every other project, so one full project never locks
 *    anyone out of the rest.
 *
 * Anything else that goes wrong adding them fails the sign-in, as before.
 *
 * Each callback runs through its real route handler, with the provider
 * side stubbed at the utility boundary (the SAML signature check, the OIDC
 * code exchange), so what arrives is a verified identity. The memberships
 * live in a small table behind TeamMemberService, which refuses a project
 * it is told is full exactly as the service does. Every flow runs on a
 * self-hosted install and on the hosted service (billing on, where a
 * project's SSO also needs the account's consent - given here), with
 * billing pinned: CI's config.env sets BILLING_ENABLED=true.
 * ---------------------------------------------------------------------------
 */

const USER_EMAIL: string = "new.person@example.com";
const USER_ID: string = "71000000-0000-4000-8000-000000000001";
const PROJECT_ID: string = "71000000-0000-4000-8000-000000000002";
const OTHER_PROJECT_ID: string = "71000000-0000-4000-8000-000000000003";
const THIRD_PROJECT_ID: string = "71000000-0000-4000-8000-000000000004";
const PROVIDER_ID: string = "71000000-0000-4000-8000-000000000005";
const TEAM_ID: string = "71000000-0000-4000-8000-000000000006";
const SECOND_TEAM_ID: string = "71000000-0000-4000-8000-000000000007";
const OTHER_TEAM_ID: string = "71000000-0000-4000-8000-000000000008";
const THIRD_TEAM_ID: string = "71000000-0000-4000-8000-000000000009";
const ISSUER: string = "https://idp.example.com/metadata";

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

let storedRow: Record<string, unknown> = {};

const userFindOneBy: jest.Mock = jest.fn();

jest.mock("Common/Server/Services/UserService", () => {
  return {
    __esModule: true,
    default: {
      findOneBy: (...args: Array<unknown>): unknown => {
        return userFindOneBy(...args);
      },
      createByEmail: jest.fn(),
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

// The account's consent to the project's sign-in, on the hosted service.
jest.mock("Common/Server/Services/UserProjectSsoConsentService", () => {
  return {
    __esModule: true,
    default: {
      hasConsent: (): Promise<boolean> => {
        return Promise.resolve(true);
      },
      recordConsent: jest.fn(),
    },
  };
});

const providerFindOneBy: jest.Mock = jest.fn();
const attachmentsFindBy: jest.Mock = jest.fn();

jest.mock("Common/Server/Services/ProjectSsoService", () => {
  return {
    __esModule: true,
    default: {
      findOneBy: (...args: Array<unknown>): unknown => {
        return providerFindOneBy(...args);
      },
    },
  };
});

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

jest.mock("Common/Server/Services/GlobalSsoService", () => {
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

jest.mock("Common/Server/Services/GlobalSsoProjectService", () => {
  return {
    __esModule: true,
    default: {
      findBy: (...args: Array<unknown>): unknown => {
        return attachmentsFindBy(...args);
      },
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

// A signature that verified: the identity below is what the IdP asserted.
jest.mock("../../../FeatureSet/Identity/Utils/SSO", () => {
  return {
    __esModule: true,
    default: {
      getSamlResponseFromXML: (): unknown => {
        const identity: typeof import("Common/Types/Email") =
          jest.requireActual("Common/Types/Email");

        return {
          issuerUrl: "https://idp.example.com/metadata",
          email: new identity.default("new.person@example.com"),
          name: null,
          assertionId: "_assertion",
          acceptableUntil: new Date(Date.now() + 5 * 60 * 1000),
        };
      },
      createSAMLRequestUrl: jest.fn(),
    },
  };
});

/*
 * Every response is taken as used for the first time. A response posted
 * twice is SamlSignInRoutes.test.ts's subject, not this suite's.
 */
jest.mock("../../../FeatureSet/Identity/Utils/SamlAssertionOneTimeUse", () => {
  const actual: typeof import("../../../FeatureSet/Identity/Utils/SamlAssertionOneTimeUse") =
    jest.requireActual(
      "../../../FeatureSet/Identity/Utils/SamlAssertionOneTimeUse",
    ) as typeof import("../../../FeatureSet/Identity/Utils/SamlAssertionOneTimeUse");

  return {
    ...actual,
    __esModule: true,
    default: {
      claim: (): Promise<void> => {
        return Promise.resolve();
      },
    },
  };
});

// A code exchange that succeeded, with an ID token that validated.
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
          email: new identity.default("new.person@example.com"),
          name: null,
        });
      },
    },
  };
});

jest.mock("../../../FeatureSet/Identity/Utils/AuthenticationEmail", () => {
  return {
    __esModule: true,
    default: { sendVerificationEmail: jest.fn() },
  };
});

const setUserCookie: jest.Mock = jest.fn();
const setSSOCookie: jest.Mock = jest.fn();
const setGlobalSSOCookie: jest.Mock = jest.fn();

// Any OIDC state cookie is present; the mobile-intent cookie is not.
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

type Flow = {
  name: string;
  billing: boolean;
  router: ExpressRouter;
  method: string;
  path: string;
  params: Record<string, string>;
  request: (data: { isMobile: boolean }) => {
    body: JSONObject;
    query: JSONObject;
  };
};

const SAML_BODY: (isMobile: boolean) => JSONObject = (
  isMobile: boolean,
): JSONObject => {
  return {
    SAMLResponse: Buffer.from("<Response/>").toString("base64"),
    ...(isMobile ? { RelayState: "mobile" } : {}),
  };
};

const PROJECT_CALLBACKS: Array<Omit<Flow, "billing">> = [
  {
    name: "project SAML (/idp-login)",
    router: SSORouter,
    method: "POST",
    path: "/idp-login/:projectId/:projectSsoId",
    params: { projectId: PROJECT_ID, projectSsoId: PROVIDER_ID },
    request: (data: { isMobile: boolean }) => {
      return { body: SAML_BODY(data.isMobile), query: {} };
    },
  },
  {
    name: "project OIDC (/oidc-callback)",
    router: OIDCRouter,
    method: "GET",
    path: "/oidc-callback/:projectId/:projectOidcId",
    params: { projectId: PROJECT_ID, projectOidcId: PROVIDER_ID },
    request: () => {
      return { body: {}, query: { code: "code", state: "state" } };
    },
  },
];

const GLOBAL_CALLBACKS: Array<Omit<Flow, "billing">> = [
  {
    name: "Global SAML (/global-idp-login)",
    router: GlobalSSORouter,
    method: "POST",
    path: "/global-idp-login/:globalSsoId",
    params: { globalSsoId: PROVIDER_ID },
    request: (data: { isMobile: boolean }) => {
      return { body: SAML_BODY(data.isMobile), query: {} };
    },
  },
  {
    name: "Global OIDC (/global-oidc-callback)",
    router: GlobalOIDCRouter,
    method: "GET",
    path: "/global-oidc-callback/:globalOidcId",
    params: { globalOidcId: PROVIDER_ID },
    request: () => {
      return { body: {}, query: { code: "code", state: "state" } };
    },
  },
];

// Each callback, self-hosted (billing off) and on the hosted service.
function onEveryEdition(callbacks: Array<Omit<Flow, "billing">>): Array<Flow> {
  return [false, true].flatMap((billing: boolean): Array<Flow> => {
    return callbacks.map((callback: Omit<Flow, "billing">): Flow => {
      return {
        ...callback,
        name: `${callback.name}, billing=${billing}`,
        billing,
      };
    });
  });
}

const PROJECT_FLOWS: Array<Flow> = onEveryEdition(PROJECT_CALLBACKS);
const GLOBAL_FLOWS: Array<Flow> = onEveryEdition(GLOBAL_CALLBACKS);

type RunResult = { nextError: unknown };

// res.redirect: where the mobile flows send the app its deep link.
const resRedirect: jest.Mock = jest.fn();

async function runFlow(
  flow: Flow,
  data: { isMobile: boolean },
): Promise<RunResult> {
  const { body, query } = flow.request(data);

  setTestBillingEnabled(flow.billing);

  // The OIDC flows carry "mobile" in their signed state cookie.
  oidcStateIsMobile = data.isMobile;

  const req: ExpressRequest = {
    params: flow.params,
    body,
    query,
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
    flow.router,
    flow.method,
    flow.path,
  );

  await (handler(req, res, (err?: unknown): void => {
    nextError = err;
  }) as unknown as Promise<void>);

  return { nextError };
}

function projectOntoSelect(select: Record<string, unknown>): User {
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

/*
 * THE MEMBERSHIPS, as TeamMemberService keeps them here: each project the
 * person is in, by team. A project in `fullProjects` has no room for one
 * more person and refuses a newcomer with `refusal`, as the service's
 * limits on people do; `failure`, when set, is any other error.
 */
interface Membership {
  projectId: string;
  teamId: string;
}

let memberships: Array<Membership> = [];
let fullProjects: Set<string> = new Set<string>();
let refusal: string = Errors.TeamMemberService.LIMIT_REACHED;
let failure: Error | null = null;

// The project ids a countBy query names: one id, or QueryHelper.any's list.
function projectIdsOf(filter: unknown): Array<string> | null {
  if (filter === undefined) {
    return null;
  }

  if (filter instanceof ObjectID || typeof filter === "string") {
    return [filter.toString()];
  }

  const parameters: Record<string, Array<unknown>> = (
    filter as { objectLiteralParameters?: Record<string, Array<unknown>> }
  ).objectLiteralParameters || {};

  return Object.values(parameters)
    .flat()
    .map((value: unknown): string => {
      return String(value);
    });
}

function teamsOf(projectId: string): Array<string> {
  return memberships
    .filter((membership: Membership): boolean => {
      return membership.projectId === projectId;
    })
    .map((membership: Membership): string => {
      return membership.teamId;
    });
}

// Every membership create, as [project, team], in order.
function createsMade(): Array<[string, string]> {
  return teamMemberCreate.mock.calls.map(
    (call: Array<unknown>): [string, string] => {
      const data: Record<string, ObjectID> = (
        call[0] as { data: Record<string, ObjectID> }
      ).data;

      return [data["projectId"]!.toString(), data["teamId"]!.toString()];
    },
  );
}

// No session, no token and no cookie: nobody is signed in.
function expectNoSession(): void {
  expect(createSession).not.toHaveBeenCalled();
  expect(signUserLoginToken).not.toHaveBeenCalled();
  expect(setUserCookie).not.toHaveBeenCalled();
  expect(setSSOCookie).not.toHaveBeenCalled();
  expect(setGlobalSSOCookie).not.toHaveBeenCalled();
}

// And a project's own provider stops before it refreshes any permissions.
function expectNoSignIn(): void {
  expectNoSession();
  expect(refreshUserAllPermissions).not.toHaveBeenCalled();
}

function expectSignedIn(): void {
  expect(createSession).toHaveBeenCalledTimes(1);
  expect(setUserCookie).toHaveBeenCalledTimes(1);
  expect(responseRedirect).toHaveBeenCalledTimes(1);
  expect(render).not.toHaveBeenCalled();
  expect(sendErrorResponse).not.toHaveBeenCalled();
}

beforeEach(() => {
  jest.clearAllMocks();
  oidcStateIsMobile = false;
  memberships = [];
  fullProjects = new Set<string>();
  refusal = Errors.TeamMemberService.LIMIT_REACHED;
  failure = null;

  storedRow = {
    _id: USER_ID,
    email: new Email(USER_EMAIL),
    name: "New Person",
    isMasterAdmin: false,
    isEmailVerified: true,
    isBlocked: false,
    timezone: null,
  };

  userFindOneBy.mockImplementation((data: { select: JSONObject }) => {
    return Promise.resolve(projectOntoSelect(data.select));
  });

  providerFindOneBy.mockResolvedValue({
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
    disableSignUpWithSso: false,
    restrictToAttachedProjects: false,
  });

  // Three projects the instance-wide provider is attached to, in order.
  attachmentsFindBy.mockResolvedValue([
    {
      projectId: new ObjectID(PROJECT_ID),
      teams: [
        { id: new ObjectID(TEAM_ID) },
        { id: new ObjectID(SECOND_TEAM_ID) },
      ],
    },
    {
      projectId: new ObjectID(OTHER_PROJECT_ID),
      teams: [{ id: new ObjectID(OTHER_TEAM_ID) }],
    },
    {
      projectId: new ObjectID(THIRD_PROJECT_ID),
      teams: [{ id: new ObjectID(THIRD_TEAM_ID) }],
    },
  ]);

  teamMemberCountBy.mockImplementation(
    (countBy: { query: Record<string, unknown> }) => {
      const projectIds: Array<string> | null = projectIdsOf(
        countBy.query["projectId"],
      );

      return Promise.resolve(
        new PositiveNumber(
          memberships.filter((membership: Membership): boolean => {
            return !projectIds || projectIds.includes(membership.projectId);
          }).length,
        ),
      );
    },
  );

  teamMemberCreate.mockImplementation(
    (createBy: { data: Record<string, ObjectID> }) => {
      const projectId: string = createBy.data["projectId"]!.toString();
      const teamId: string = createBy.data["teamId"]!.toString();

      if (failure) {
        return Promise.reject(failure);
      }

      // Someone new to a full project is refused; someone in it is not.
      if (fullProjects.has(projectId) && teamsOf(projectId).length === 0) {
        return Promise.reject(new BadDataException(refusal));
      }

      memberships.push({ projectId: projectId, teamId: teamId });

      return Promise.resolve({});
    },
  );

  createSession.mockResolvedValue({
    session: { id: ObjectID.generate() },
    refreshToken: "refresh-token",
    refreshTokenExpiresAt: new Date(),
  });
  signUserLoginToken.mockReturnValue("signed-user-token");
});

const REFUSALS: Array<[string, string]> = [
  ["every seat of its plan taken", Errors.TeamMemberService.LIMIT_REACHED],
  [
    "the Free plan's one person there already",
    Errors.TeamMemberService.LIMIT_REACHED_FOR_FREE_PLAN,
  ],
];

describe.each(PROJECT_FLOWS)(
  "$name - a project's own provider, and a project with no room",
  (flow: Flow) => {
    test.each(REFUSALS)(
      "%s: the newcomer is told so on a page of their own, added to no team, and given no session",
      async (_label: string, refusedWith: string) => {
        fullProjects.add(PROJECT_ID);
        refusal = refusedWith;

        const result: RunResult = await runFlow(flow, { isMobile: false });

        expect(result.nextError).toBeUndefined();
        expect(sendErrorResponse).not.toHaveBeenCalled();
        expect(render).toHaveBeenCalledTimes(1);
        expect(render.mock.calls[0]![2]).toBe(
          "/usr/src/app/FeatureSet/Identity/Views/Message.ejs",
        );
        expect(render.mock.calls[0]![3]).toEqual({
          title: SSO_NO_ROOM_TITLE,
          message: SSO_NO_ROOM_MESSAGE,
        });

        // The first team refused them: the second is never asked.
        expect(createsMade()).toEqual([[PROJECT_ID, TEAM_ID]]);
        expect(memberships).toEqual([]);
        expectNoSignIn();
        expect(responseRedirect).not.toHaveBeenCalled();
        expect(resRedirect).not.toHaveBeenCalled();
      },
    );

    test("from the mobile app: sent back to the app with the reason, and no tokens", async () => {
      fullProjects.add(PROJECT_ID);

      await runFlow(flow, { isMobile: true });

      expect(resRedirect).toHaveBeenCalledTimes(1);

      const deepLink: string = resRedirect.mock.calls[0]![0] as string;
      const params: URLSearchParams = new URLSearchParams(
        deepLink.split("?")[1] || "",
      );

      expect(deepLink.startsWith("oneuptime://sso-callback?")).toBe(true);
      expect(params.get("error")).toBe(SSO_NO_ROOM_ERROR);
      expect(params.get("errorDescription")).toBe(SSO_NO_ROOM_MESSAGE);
      expect(params.get("accessToken")).toBeNull();
      expect(params.get("refreshToken")).toBeNull();

      expect(render).not.toHaveBeenCalled();
      expect(memberships).toEqual([]);
      expectNoSignIn();
    });

    test("the page is for the person signing in, not the inviter's sentence", () => {
      for (const [, refusedWith] of REFUSALS) {
        expect(SSO_NO_ROOM_MESSAGE).not.toBe(refusedWith);
      }

      expect(SSO_NO_ROOM_MESSAGE).not.toContain("invite");
      expect(SSO_NO_ROOM_MESSAGE).not.toContain("billing@");
    });

    test("with room, the newcomer joins every team of the provider and is signed in", async () => {
      await runFlow(flow, { isMobile: false });

      expect(createsMade()).toEqual([
        [PROJECT_ID, TEAM_ID],
        [PROJECT_ID, SECOND_TEAM_ID],
      ]);
      expect(teamsOf(PROJECT_ID)).toEqual([TEAM_ID, SECOND_TEAM_ID]);
      expectSignedIn();
    });

    test("someone already in a full project signs in, joining nothing new", async () => {
      fullProjects.add(PROJECT_ID);
      memberships.push({ projectId: PROJECT_ID, teamId: OTHER_TEAM_ID });

      await runFlow(flow, { isMobile: false });

      expect(teamMemberCreate).not.toHaveBeenCalled();
      expectSignedIn();
    });

    test("anything else that goes wrong adding them is still an error, never the page", async () => {
      failure = new BadDataException("Invalid Team ID");

      const result: RunResult = await runFlow(flow, { isMobile: false });

      const surfaced: unknown =
        result.nextError ?? sendErrorResponse.mock.calls[0]?.[2];

      expect(surfaced).toBe(failure);
      expect(render).not.toHaveBeenCalled();
      expectNoSignIn();
    });
  },
);

describe.each(GLOBAL_FLOWS)(
  "$name - an instance-wide provider, and an attached project with no room",
  (flow: Flow) => {
    test.each(REFUSALS)(
      "%s: that project is left out, and the person joins the others and is signed in",
      async (_label: string, refusedWith: string) => {
        fullProjects.add(PROJECT_ID);
        refusal = refusedWith;

        const result: RunResult = await runFlow(flow, { isMobile: false });

        expect(result.nextError).toBeUndefined();

        // The full project's first team refused them; nothing more is asked of it.
        expect(createsMade()).toEqual([
          [PROJECT_ID, TEAM_ID],
          [OTHER_PROJECT_ID, OTHER_TEAM_ID],
          [THIRD_PROJECT_ID, THIRD_TEAM_ID],
        ]);
        expect(teamsOf(PROJECT_ID)).toEqual([]);
        expect(teamsOf(OTHER_PROJECT_ID)).toEqual([OTHER_TEAM_ID]);
        expect(teamsOf(THIRD_PROJECT_ID)).toEqual([THIRD_TEAM_ID]);

        expectSignedIn();
        expect(setGlobalSSOCookie).toHaveBeenCalledTimes(1);

        // The operator can see why.
        const logged: Array<string> = (
          logger.info as unknown as jest.Mock
        ).mock.calls.map((call: Array<unknown>): string => {
          return String(call[0]);
        });

        expect(
          logged.some((line: string): boolean => {
            return (
              line.includes(PROJECT_ID) && line.includes("no room for another")
            );
          }),
        ).toBe(true);
      },
    );

    test("from the mobile app, the person is handed their session for the other projects", async () => {
      fullProjects.add(OTHER_PROJECT_ID);

      await runFlow(flow, { isMobile: true });

      expect(resRedirect).toHaveBeenCalledTimes(1);

      const params: URLSearchParams = new URLSearchParams(
        (resRedirect.mock.calls[0]![0] as string).split("?")[1] || "",
      );

      expect(params.get("error")).toBeNull();
      expect(params.get("accessToken")).toBe("signed-user-token");
      expect(teamsOf(OTHER_PROJECT_ID)).toEqual([]);
      expect(teamsOf(PROJECT_ID)).toEqual([TEAM_ID, SECOND_TEAM_ID]);
      expect(teamsOf(THIRD_PROJECT_ID)).toEqual([THIRD_TEAM_ID]);
    });

    test("joins the full project on a later sign-in, once it has room", async () => {
      fullProjects.add(PROJECT_ID);
      await runFlow(flow, { isMobile: false });
      expect(teamsOf(PROJECT_ID)).toEqual([]);

      jest.clearAllMocks();
      fullProjects.delete(PROJECT_ID);
      await runFlow(flow, { isMobile: false });

      // Only the project they were left out of is asked again.
      expect(createsMade()).toEqual([
        [PROJECT_ID, TEAM_ID],
        [PROJECT_ID, SECOND_TEAM_ID],
      ]);
      expect(teamsOf(PROJECT_ID)).toEqual([TEAM_ID, SECOND_TEAM_ID]);
      expectSignedIn();
    });

    test("every attached project full, and the provider restricted to them: no session, and the page saying so", async () => {
      fullProjects = new Set<string>([
        PROJECT_ID,
        OTHER_PROJECT_ID,
        THIRD_PROJECT_ID,
      ]);
      providerFindOneBy.mockResolvedValue({
        id: new ObjectID(PROVIDER_ID),
        signOnURL: "https://idp.example.com/sso",
        issuerURL: ISSUER,
        publicCertificate: "certificate",
        discoveryURL:
          "https://idp.example.com/.well-known/openid-configuration",
        clientId: "client-id",
        clientSecret: "client-secret",
        disableSignUpWithSso: false,
        restrictToAttachedProjects: true,
      });

      const result: RunResult = await runFlow(flow, { isMobile: false });

      expect(result.nextError).toBeUndefined();
      expect(memberships).toEqual([]);
      expect(render).toHaveBeenCalledTimes(1);
      expect((render.mock.calls[0]![3] as JSONObject)["title"]).toBe(
        "No project access.",
      );
      expect(sendErrorResponse).not.toHaveBeenCalled();
      expectNoSession();
    });

    test("anything else that goes wrong adding them still fails the sign-in", async () => {
      failure = new BadDataException("Invalid Team ID");

      const result: RunResult = await runFlow(flow, { isMobile: false });

      const surfaced: unknown =
        result.nextError ?? sendErrorResponse.mock.calls[0]?.[2];

      expect(surfaced).toBe(failure);
      expectNoSession();
    });
  },
);
