import { beforeEach, describe, expect, test } from "@jest/globals";
import SSORouter from "../../../FeatureSet/Identity/API/SSO";
import OIDCRouter from "../../../FeatureSet/Identity/API/OIDC";
import {
  ExpressRequest,
  ExpressResponse,
  ExpressRouter,
  RequestHandler,
} from "Common/Server/Utils/Express";
import Email from "Common/Types/Email";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import PositiveNumber from "Common/Types/PositiveNumber";
import { setTestBillingEnabled } from "Common/Tests/Server/Enterprise/TestBillingFlag";

/*
 * ---------------------------------------------------------------------------
 * SIGNING IN STILL ADDS PEOPLE TO THE PROVIDER'S TEAMS.
 *
 * A project's SAML or OIDC provider may only be saved with teams the person
 * saving it could invite someone to (Common/Server/Utils
 * /SsoProviderTeamGrant). That is a check on SAVING. Signing in is the
 * provider doing what it was saved to do: someone who is not yet in the
 * project joins every one of its teams, accepted, as the server's own write.
 * Nobody is signed in to weigh at that point, and a provider saved before the
 * check keeps working.
 *
 * Each callback runs through its real route handler, with the provider side
 * stubbed at the utility boundary (the SAML signature check, the OIDC code
 * exchange), so what arrives is a verified identity. Every flow runs on a
 * self-hosted install and on the hosted service (billing on, where the
 * account's consent to the project's sign-in is given here), with billing
 * pinned: CI's config.env sets BILLING_ENABLED=true.
 * ---------------------------------------------------------------------------
 */

const USER_ID: string = "62000000-0000-4000-8000-000000000001";
const PROJECT_ID: string = "62000000-0000-4000-8000-000000000002";
const PROVIDER_ID: string = "62000000-0000-4000-8000-000000000003";
const MEMBERS_TEAM_ID: string = "62000000-0000-4000-8000-000000000004";
const ADMIN_TEAM_ID: string = "62000000-0000-4000-8000-000000000005";
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

// The ceiling a provider's teams meet when it is saved: never asked here.
const findTeamsCallerCannotGrant: jest.Mock = jest.fn();
const assertCanGrantTeamPermissions: jest.Mock = jest.fn();

jest.mock("Common/Server/Services/TeamPermissionService", () => {
  return {
    __esModule: true,
    default: {
      findTeamsCallerCannotGrant: (...args: Array<unknown>): unknown => {
        return findTeamsCallerCannotGrant(...args);
      },
      assertCanGrantTeamPermissions: (...args: Array<unknown>): unknown => {
        return assertCanGrantTeamPermissions(...args);
      },
    },
  };
});

jest.mock("Common/Server/Services/AccessTokenService", () => {
  return {
    __esModule: true,
    default: {
      refreshUserAllPermissions: jest.fn(),
    },
  };
});

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
        };
      },
      createSAMLRequestUrl: jest.fn(),
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
      setUserCookie: jest.fn(),
      setSSOCookie: (...args: Array<unknown>): unknown => {
        return setSSOCookie(...args);
      },
      setGlobalSSOCookie: jest.fn(),
      getSSOToken: (): string => {
        return "sso-token";
      },
      getGlobalSSOToken: (): string => {
        return "global-sso-token";
      },
    },
  };
});

jest.mock("Common/Server/Utils/JsonWebToken", () => {
  return {
    __esModule: true,
    default: {
      decodeJsonPayload: (): JSONObject => {
        return {
          state: "state",
          nonce: "nonce",
          codeVerifier: "code-verifier",
          isMobile: false,
        };
      },
      signJsonPayload: (): string => {
        return "signed-state";
      },
      signUserLoginToken: (): string => {
        return "signed-user-token";
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

interface Flow {
  name: string;
  billing: boolean;
  router: ExpressRouter;
  method: string;
  path: string;
  params: Record<string, string>;
  body: JSONObject;
  query: JSONObject;
}

const CALLBACKS: Array<Omit<Flow, "billing">> = [
  {
    name: "project SAML (/idp-login)",
    router: SSORouter,
    method: "POST",
    path: "/idp-login/:projectId/:projectSsoId",
    params: { projectId: PROJECT_ID, projectSsoId: PROVIDER_ID },
    body: { SAMLResponse: Buffer.from("<Response/>").toString("base64") },
    query: {},
  },
  {
    name: "project OIDC (/oidc-callback)",
    router: OIDCRouter,
    method: "GET",
    path: "/oidc-callback/:projectId/:projectOidcId",
    params: { projectId: PROJECT_ID, projectOidcId: PROVIDER_ID },
    body: {},
    query: { code: "code", state: "state" },
  },
];

const FLOWS: Array<Flow> = [false, true].flatMap(
  (billing: boolean): Array<Flow> => {
    return CALLBACKS.map((callback: Omit<Flow, "billing">): Flow => {
      return {
        ...callback,
        name: `${callback.name}, billing=${billing}`,
        billing,
      };
    });
  },
);

async function runFlow(flow: Flow): Promise<unknown> {
  setTestBillingEnabled(flow.billing);

  const req: ExpressRequest = {
    params: flow.params,
    body: flow.body,
    query: flow.query,
    headers: {},
    cookies: {},
    socket: { remoteAddress: "127.0.0.1" },
    get: (): undefined => {
      return undefined;
    },
  } as unknown as ExpressRequest;

  const res: ExpressResponse = {
    redirect: jest.fn(),
    status: jest.fn().mockReturnThis(),
    send: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
    cookie: jest.fn().mockReturnThis(),
    clearCookie: jest.fn().mockReturnThis(),
  } as unknown as ExpressResponse;

  let nextError: unknown = undefined;

  await (handlerFor(flow.router, flow.method, flow.path)(
    req,
    res,
    (err?: unknown): void => {
      nextError = err;
    },
  ) as unknown as Promise<void>);

  return nextError;
}

function provider(teamIds: Array<string>): Record<string, unknown> {
  return {
    id: new ObjectID(PROVIDER_ID),
    signOnURL: "https://idp.example.com/sso",
    issuerURL: ISSUER,
    publicCertificate: "certificate",
    discoveryURL: "https://idp.example.com/.well-known/openid-configuration",
    clientId: "client-id",
    clientSecret: "client-secret",
    teams: teamIds.map((teamId: string): Record<string, unknown> => {
      return { id: new ObjectID(teamId) };
    }),
  };
}

interface CreatedMembership {
  projectId: string;
  userId: string;
  teamId: string;
  hasAcceptedInvitation: unknown;
  acceptedAtIsSet: boolean;
  props: unknown;
}

function createdMemberships(): Array<CreatedMembership> {
  return teamMemberCreate.mock.calls.map(
    (call: Array<unknown>): CreatedMembership => {
      const createBy: {
        data: Record<string, unknown>;
        props: unknown;
      } = call[0] as { data: Record<string, unknown>; props: unknown };

      return {
        projectId: String(createBy.data["projectId"]),
        userId: String(createBy.data["userId"]),
        teamId: String(createBy.data["teamId"]),
        hasAcceptedInvitation: createBy.data["hasAcceptedInvitation"],
        acceptedAtIsSet: createBy.data["invitationAcceptedAt"] instanceof Date,
        props: createBy.props,
      };
    },
  );
}

beforeEach(() => {
  jest.clearAllMocks();

  userFindOneBy.mockResolvedValue({
    _id: USER_ID,
    id: new ObjectID(USER_ID),
    email: new Email("new.person@example.com"),
    name: "New Person",
    isMasterAdmin: false,
    isEmailVerified: true,
    isBlocked: false,
    timezone: null,
  });

  providerFindOneBy.mockResolvedValue(
    provider([MEMBERS_TEAM_ID, ADMIN_TEAM_ID]),
  );

  // Not in the project yet.
  teamMemberCountBy.mockResolvedValue(new PositiveNumber(0));
  teamMemberCreate.mockResolvedValue({});

  createSession.mockResolvedValue({
    session: { id: ObjectID.generate() },
    refreshToken: "refresh-token",
    refreshTokenExpiresAt: new Date(),
  });
});

describe.each(FLOWS)("$name", (flow: Flow) => {
  test("someone new to the project joins every one of the provider's teams, accepted, and is signed in", async () => {
    const nextError: unknown = await runFlow(flow);

    expect(nextError).toBeUndefined();
    expect(sendErrorResponse).not.toHaveBeenCalled();

    expect(createdMemberships()).toEqual(
      [MEMBERS_TEAM_ID, ADMIN_TEAM_ID].map(
        (teamId: string): CreatedMembership => {
          return {
            projectId: PROJECT_ID,
            userId: USER_ID,
            teamId: teamId,
            hasAcceptedInvitation: true,
            acceptedAtIsSet: true,
            // The server's own write: nobody signed in is weighed here.
            props: { isRoot: true, ignoreHooks: true },
          };
        },
      ),
    );

    expect(createSession).toHaveBeenCalledTimes(1);
    expect(setSSOCookie).toHaveBeenCalledTimes(1);
  });

  test("the save-time ceiling is not asked at sign-in", async () => {
    await runFlow(flow);

    expect(findTeamsCallerCannotGrant).not.toHaveBeenCalled();
    expect(assertCanGrantTeamPermissions).not.toHaveBeenCalled();
  });

  test("someone already in the project joins no team", async () => {
    teamMemberCountBy.mockResolvedValue(new PositiveNumber(1));

    await runFlow(flow);

    expect(teamMemberCreate).not.toHaveBeenCalled();
    expect(createSession).toHaveBeenCalledTimes(1);
  });

  test("a provider with no teams stops someone new at 'No teams added', as before", async () => {
    providerFindOneBy.mockResolvedValue(provider([]));

    await runFlow(flow);

    expect(teamMemberCreate).not.toHaveBeenCalled();
    expect(createSession).not.toHaveBeenCalled();
    expect(render).toHaveBeenCalledTimes(1);
    expect((render.mock.calls[0]![3] as { title: string }).title).toBe(
      "No teams added.",
    );
  });
});
