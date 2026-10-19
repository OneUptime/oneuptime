import { beforeEach, describe, expect, test } from "@jest/globals";
import SSORouter from "../../../FeatureSet/Identity/API/SSO";
import ProjectSsoSignInConfirmation from "../../../FeatureSet/Identity/Utils/ProjectSsoSignInConfirmation";
import {
  PROJECT_SSO_IDENTITY_MISMATCH_ERROR,
  PROJECT_SSO_IDENTITY_MISMATCH_MESSAGE,
  PROJECT_SSO_IDENTITY_MISMATCH_TITLE,
} from "../../../FeatureSet/Identity/Utils/ProjectSsoIdentityBinding";
import {
  ExpressRequest,
  ExpressResponse,
  ExpressRouter,
  RequestHandler,
} from "Common/Server/Utils/Express";
import User from "Common/Models/DatabaseModels/User";
import Email from "Common/Types/Email";
import ObjectID from "Common/Types/ObjectID";
import PositiveNumber from "Common/Types/PositiveNumber";
import { setTestBillingEnabled } from "Common/Tests/Server/Enterprise/TestBillingFlag";

/*
 * ---------------------------------------------------------------------------
 * A SIGN-IN THROUGH A PROJECT'S SAML PROVIDER IS BOUND TO THE PERSON.
 *
 * Microsoft Entra ID names the person by address and sends their immutable
 * object ID beside it. The first sign-in that signs an account in binds it to
 * that object ID (UserProjectSsoIdentity); a later one that asserts the
 * account's address with another object ID - whoever holds the address in
 * Entra ID now, renamed or edited - is refused before anything is emailed,
 * provisioned or signed in. A response with no object ID is matched by
 * address alone, as before.
 *
 * Run through the real /idp-login handler. The provider side is stubbed at
 * the utility boundary - the verified assertion is what the identity provider
 * signed - and the bindings live in memory.
 * ---------------------------------------------------------------------------
 */

const USER_EMAIL: string = "dana.scully@example.com";
const USER_ID: string = "6a000000-0000-4000-8000-000000000001";
const NEW_USER_ID: string = "6a000000-0000-4000-8000-000000000002";
const PROJECT_ID: string = "6a000000-0000-4000-8000-000000000003";
const PROVIDER_ID: string = "6a000000-0000-4000-8000-000000000004";
const OBJECT_ID: string = "8f3e8c2a-41d5-4c0b-9e8a-4a7d1c0f6b21";
const OTHER_OBJECT_ID: string = "1b2c3d4e-0000-4000-8000-0000000000aa";

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

let storedUser: Record<string, unknown> | null = null;
const userCreateByEmail: jest.Mock = jest.fn();

jest.mock("Common/Server/Services/UserService", () => {
  return {
    __esModule: true,
    default: {
      findOneBy: (data: { select: Record<string, unknown> }): unknown => {
        if (!storedUser) {
          return Promise.resolve(null);
        }

        const user: Record<string, unknown> = new User() as unknown as Record<
          string,
          unknown
        >;

        for (const column of Object.keys(data.select)) {
          if (data.select[column] && storedUser[column] !== undefined) {
            user[column] = storedUser[column];
          }
        }

        return Promise.resolve(user);
      },
      createByEmail: (...args: Array<unknown>): unknown => {
        return userCreateByEmail(...args);
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

jest.mock("Common/Server/Services/TeamMemberService", () => {
  return {
    __esModule: true,
    default: {
      countBy: (...args: Array<unknown>): unknown => {
        return teamMemberCountBy(...args);
      },
      findBy: jest.fn(),
    },
  };
});

const addToTeams: jest.Mock = jest.fn();

jest.mock("../../../FeatureSet/Identity/Utils/SsoTeamMembership", () => {
  const actual: Record<string, unknown> = jest.requireActual(
    "../../../FeatureSet/Identity/Utils/SsoTeamMembership",
  ) as Record<string, unknown>;

  return {
    ...actual,
    __esModule: true,
    default: {
      addToTeams: (...args: Array<unknown>): unknown => {
        return addToTeams(...args);
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

let hasConsent: boolean = true;

jest.mock("Common/Server/Services/UserProjectSsoConsentService", () => {
  return {
    __esModule: true,
    default: {
      hasConsent: (): Promise<boolean> => {
        return Promise.resolve(hasConsent);
      },
      recordConsent: jest.fn(),
    },
  };
});

jest.mock("Common/Server/Services/ProjectSsoService", () => {
  return {
    __esModule: true,
    default: {
      findOneBy: (): Promise<unknown> => {
        const objectId: typeof import("Common/Types/ObjectID") =
          jest.requireActual("Common/Types/ObjectID");

        return Promise.resolve({
          id: new objectId.default("6a000000-0000-4000-8000-000000000004"),
          signOnURL: "https://login.microsoftonline.com/saml2",
          issuerURL:
            "https://sts.windows.net/6a000000-0000-4000-8000-000000000006/",
          publicCertificate: "certificate",
          teams: [
            {
              id: new objectId.default("6a000000-0000-4000-8000-000000000005"),
            },
          ],
        });
      },
    },
  };
});

// The bindings, in memory: "<providerId>:<userId>" -> object ID.
const bindings: Map<string, string> = new Map<string, string>();
let concurrentBinding: string | null = null;

jest.mock("Common/Server/Services/UserProjectSsoIdentityService", () => {
  const key: (data: {
    projectSsoId: unknown;
    userId: unknown;
  }) => string = (data: { projectSsoId: unknown; userId: unknown }): string => {
    return `${String(data.projectSsoId)}:${String(data.userId)}`;
  };

  return {
    __esModule: true,
    default: {
      getBoundObjectId: (data: {
        projectSsoId: unknown;
        userId: unknown;
      }): Promise<string | null> => {
        return Promise.resolve(bindings.get(key(data)) || null);
      },
      bind: (data: {
        projectSsoId: unknown;
        userId: unknown;
        objectId: string;
      }): Promise<string> => {
        // A first sign-in that raced this one, and bound someone else first.
        if (concurrentBinding && !bindings.has(key(data))) {
          bindings.set(key(data), concurrentBinding);
        }

        if (!bindings.has(key(data))) {
          bindings.set(key(data), data.objectId);
        }

        return Promise.resolve(bindings.get(key(data))!);
      },
    },
  };
});

// What the identity provider signed: the address, and the object ID if any.
let assertedObjectId: string | null = OBJECT_ID;

jest.mock("../../../FeatureSet/Identity/Utils/SSO", () => {
  return {
    __esModule: true,
    default: {
      getSamlResponseFromXML: (): unknown => {
        const email: typeof import("Common/Types/Email") =
          jest.requireActual("Common/Types/Email");

        return {
          issuerUrl:
            "https://sts.windows.net/6a000000-0000-4000-8000-000000000006/",
          email: new email.default("dana.scully@example.com"),
          name: null,
          objectId: assertedObjectId,
          assertionId: "_assertion",
          acceptableUntil: new Date(Date.now() + 5 * 60 * 1000),
        };
      },
      createSAMLRequestUrl: jest.fn(),
    },
  };
});

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

jest.mock("../../../FeatureSet/Identity/Utils/AuthenticationEmail", () => {
  return {
    __esModule: true,
    default: { sendVerificationEmail: jest.fn() },
  };
});

const setUserCookie: jest.Mock = jest.fn();
const setSSOCookie: jest.Mock = jest.fn();

jest.mock("Common/Server/Utils/Cookie", () => {
  return {
    __esModule: true,
    default: {
      getCookieFromExpressRequest: (): undefined => {
        return undefined;
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

jest.mock("Common/Server/Utils/JsonWebToken", () => {
  return {
    __esModule: true,
    default: {
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

const warn: jest.Mock = jest.fn();

jest.mock("Common/Server/Utils/Logger", () => {
  return {
    __esModule: true,
    default: {
      info: jest.fn(),
      error: jest.fn(),
      warn: (...args: Array<unknown>): unknown => {
        return warn(...args);
      },
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

interface RouteLayer {
  route?:
    | {
        path: string;
        methods: Record<string, boolean>;
        stack: Array<{ handle: RequestHandler }>;
      }
    | undefined;
}

function idpLoginHandler(router: ExpressRouter): RequestHandler {
  const layer: RouteLayer | undefined = (
    router as unknown as { stack: Array<RouteLayer> }
  ).stack.find((candidate: RouteLayer) => {
    return (
      candidate.route?.path === "/idp-login/:projectId/:projectSsoId" &&
      Boolean(candidate.route.methods["post"])
    );
  });

  return layer!.route!.stack[layer!.route!.stack.length - 1]!.handle;
}

const resRedirect: jest.Mock = jest.fn();

async function signIn(
  data: { isMobile?: boolean; billing?: boolean } = {},
): Promise<{ nextError: unknown }> {
  setTestBillingEnabled(Boolean(data.billing));

  const req: ExpressRequest = {
    params: { projectId: PROJECT_ID, projectSsoId: PROVIDER_ID },
    body: {
      SAMLResponse: Buffer.from("<Response/>").toString("base64"),
      ...(data.isMobile ? { RelayState: "mobile" } : {}),
    },
    query: {},
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

  await (idpLoginHandler(SSORouter)(req, res, (err?: unknown): void => {
    nextError = err;
  }) as unknown as Promise<void>);

  return { nextError };
}

function bindingOf(userId: string): string | undefined {
  return bindings.get(`${PROVIDER_ID}:${userId}`);
}

function expectSignedIn(): void {
  expect(sendErrorResponse).not.toHaveBeenCalled();
  expect(render).not.toHaveBeenCalled();
  expect(createSession).toHaveBeenCalledTimes(1);
  expect(setUserCookie).toHaveBeenCalledTimes(1);
}

function expectRefusedAsAnotherPerson(): void {
  expect(render).toHaveBeenCalledTimes(1);
  expect(render.mock.calls[0]![3]).toEqual({
    title: PROJECT_SSO_IDENTITY_MISMATCH_TITLE,
    message: PROJECT_SSO_IDENTITY_MISMATCH_MESSAGE,
  });
  expect(createSession).not.toHaveBeenCalled();
  expect(setUserCookie).not.toHaveBeenCalled();
  expect(setSSOCookie).not.toHaveBeenCalled();
  expect(refreshUserAllPermissions).not.toHaveBeenCalled();
  expect(warn).toHaveBeenCalledTimes(1);
  expect(String(warn.mock.calls[0]![0])).not.toContain(OBJECT_ID);
  expect(String(warn.mock.calls[0]![0])).not.toContain(OTHER_OBJECT_ID);
}

beforeEach(() => {
  jest.clearAllMocks();
  bindings.clear();
  concurrentBinding = null;
  assertedObjectId = OBJECT_ID;
  hasConsent = true;

  storedUser = {
    _id: USER_ID,
    email: new Email(USER_EMAIL),
    name: "Dana Scully",
    isMasterAdmin: false,
    isEmailVerified: true,
    isBlocked: false,
    timezone: null,
  };

  // Already in the project.
  teamMemberCountBy.mockResolvedValue(new PositiveNumber(1));
  addToTeams.mockResolvedValue("added");

  createSession.mockResolvedValue({
    session: { id: ObjectID.generate() },
    refreshToken: "refresh-token",
    refreshTokenExpiresAt: new Date(),
  });
});

describe("the first sign-in through the provider", () => {
  test("signs the account in and binds it to the person's object ID", async () => {
    await signIn();

    expectSignedIn();
    expect(bindingOf(USER_ID)).toBe(OBJECT_ID);
  });

  test("of an account made at that sign-in binds it too", async () => {
    storedUser = null;
    teamMemberCountBy.mockResolvedValue(new PositiveNumber(0));
    userCreateByEmail.mockImplementation(async (): Promise<User> => {
      const user: User = new User(new ObjectID(NEW_USER_ID));
      user.email = new Email(USER_EMAIL);
      user.isEmailVerified = true;
      return user;
    });

    await signIn();

    expectSignedIn();
    expect(addToTeams).toHaveBeenCalledTimes(1);
    expect(bindingOf(NEW_USER_ID)).toBe(OBJECT_ID);
  });

  test("on the hosted service, binds nothing until the mailbox has agreed", async () => {
    hasConsent = false;
    const requestConfirmation: jest.SpyInstance = jest
      .spyOn(ProjectSsoSignInConfirmation, "requestConfirmation")
      .mockResolvedValue(undefined as never);

    await signIn({ billing: true });

    expect(requestConfirmation).toHaveBeenCalledTimes(1);
    expect(createSession).not.toHaveBeenCalled();
    expect(bindingOf(USER_ID)).toBeUndefined();

    requestConfirmation.mockRestore();
  });
});

describe("a later sign-in", () => {
  test("as the same person signs in", async () => {
    bindings.set(`${PROVIDER_ID}:${USER_ID}`, OBJECT_ID);

    await signIn();

    expectSignedIn();
    expect(bindingOf(USER_ID)).toBe(OBJECT_ID);
  });

  test("as someone else who now holds the address is refused, and nothing is provisioned", async () => {
    bindings.set(`${PROVIDER_ID}:${USER_ID}`, OTHER_OBJECT_ID);
    teamMemberCountBy.mockResolvedValue(new PositiveNumber(0));

    await signIn();

    expectRefusedAsAnotherPerson();
    expect(addToTeams).not.toHaveBeenCalled();
    expect(bindingOf(USER_ID)).toBe(OTHER_OBJECT_ID);
  });

  test("as someone else, on the hosted service, is refused before any confirmation email", async () => {
    bindings.set(`${PROVIDER_ID}:${USER_ID}`, OTHER_OBJECT_ID);
    hasConsent = false;
    const requestConfirmation: jest.SpyInstance = jest
      .spyOn(ProjectSsoSignInConfirmation, "requestConfirmation")
      .mockResolvedValue(undefined as never);

    await signIn({ billing: true });

    expectRefusedAsAnotherPerson();
    expect(requestConfirmation).not.toHaveBeenCalled();

    requestConfirmation.mockRestore();
  });

  test("as someone else, from the mobile app, is sent back to the app with the reason", async () => {
    bindings.set(`${PROVIDER_ID}:${USER_ID}`, OTHER_OBJECT_ID);

    await signIn({ isMobile: true });

    expect(resRedirect).toHaveBeenCalledTimes(1);

    const deepLink: string = resRedirect.mock.calls[0]![0] as string;
    const params: URLSearchParams = new URLSearchParams(
      deepLink.split("?")[1] || "",
    );

    expect(params.get("error")).toBe(PROJECT_SSO_IDENTITY_MISMATCH_ERROR);
    expect(params.get("errorDescription")).toBe(
      PROJECT_SSO_IDENTITY_MISMATCH_MESSAGE,
    );
    expect(params.get("accessToken")).toBeNull();
    expect(render).not.toHaveBeenCalled();
    expect(createSession).not.toHaveBeenCalled();
  });

  test("bound through another provider of the project is no binding through this one", async () => {
    bindings.set(
      `6a000000-0000-4000-8000-0000000000ff:${USER_ID}`,
      OTHER_OBJECT_ID,
    );

    await signIn();

    expectSignedIn();
    expect(bindingOf(USER_ID)).toBe(OBJECT_ID);
  });
});

describe("a response with no object ID - any identity provider but Entra ID", () => {
  test("is matched by address alone, and binds nothing", async () => {
    assertedObjectId = null;

    await signIn();

    expectSignedIn();
    expect(bindings.size).toBe(0);
  });

  test("signs in an account that is bound, as it always did", async () => {
    assertedObjectId = null;
    bindings.set(`${PROVIDER_ID}:${USER_ID}`, OTHER_OBJECT_ID);

    await signIn();

    expectSignedIn();
  });
});

describe("two first sign-ins at once", () => {
  test("the one that lost the race to bind another person is refused", async () => {
    concurrentBinding = OTHER_OBJECT_ID;

    await signIn();

    expectRefusedAsAnotherPerson();
    expect(bindingOf(USER_ID)).toBe(OTHER_OBJECT_ID);
  });
});
