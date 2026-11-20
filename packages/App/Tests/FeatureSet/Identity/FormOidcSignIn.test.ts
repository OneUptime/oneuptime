import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";
import FormOIDCRouter from "../../../FeatureSet/Identity/API/FormOIDC";
import OIDCUtil from "../../../FeatureSet/Identity/Utils/OIDC";
import {
  IdpKeyPair,
  TestIdp,
  generateIdpKeyPair,
  startTestIdp,
} from "./OidcTestIdp";
import {
  ExpressRequest,
  ExpressResponse,
  ExpressRouter,
  RequestHandler,
} from "Common/Server/Utils/Express";
import Form from "Common/Models/DatabaseModels/Form";
import {
  FORM_LOGIN_CODE_PARAMETER,
  FORM_SIGN_IN_NOT_ASKED_MESSAGE,
} from "Common/Types/Form/FormPrivateUserSignIn";
import Exception from "Common/Types/Exception/Exception";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import { SignInMethod } from "Common/Types/UserSession/SessionSignIn";
import { Client, Issuer, custom } from "openid-client";
import crypto from "crypto";
import dns from "dns";

/*
 * ---------------------------------------------------------------------------
 * A FORM'S OPENID CONNECT SIGN-IN (#10249), RUN END TO END against a
 * real OpenID Provider on a loopback socket (./OidcTestIdp): the start
 * route's authorization request and state cookie, the provider's token
 * endpoint and JWKS, and the callback route's checks - its state, nonce,
 * PKCE verifier, issuer, audience and signature, in openid-client - then
 * the private user and the one-time code that hand the visitor back to the
 * form's public link. Only the database and the response writers are
 * stand-ins; the public link's decision is the real one.
 *
 *   - a sign-in started here, answered by the provider, makes the person one
 *     of the form's private users and hands them back with a code;
 *   - an answer with no state cookie, another state, a token for another
 *     client, a token signed by a key the provider does not publish, or
 *     another nonce signs nobody in;
 *   - nor does any answer once the form stops asking its visitors to
 *     sign in, or for a provider that is off.
 * ---------------------------------------------------------------------------
 */

/*
 * Importing OIDCUtil installs an SSRF egress guard that refuses loopback;
 * this suite's provider is on 127.0.0.1, so it opts out, as OIDC.test.ts
 * does (the guard has OidcEgressGuard.test.ts). The clients the routes make
 * get the hook again, so they are unhooked as they are made (below).
 */
custom.setHttpOptionsDefaults({ lookup: dns.lookup });

function removeEgressGuardHook(target: unknown): void {
  delete (target as Record<symbol, unknown>)[custom.http_options];
}

removeEgressGuardHook(Issuer);

const CLIENT_ID: string = "0oa1b2c3d4E5F6G7h8i9";
const CLIENT_SECRET: string = "sUpErSeCrEtClientValue-0123456789";
const USER_EMAIL: string = "fox.mulder@example.com";

const PROJECT_ID: string = "2abc0000-0000-4000-8000-0000000000a1";
const FORM_ID: string = "6abc0000-0000-4000-8000-0000000000c1";
const FORM_OIDC_ID: string = "6abc0000-0000-4000-8000-0000000000d2";
const PRIVATE_USER_ID: string = "6abc0000-0000-4000-8000-0000000000e3";

const FORM_ADDRESS: string = "https://forms.acme.example.com";

const STATE_COOKIE_NAME: string = `form-oidc-state-${FORM_OIDC_ID}`;

jest.mock("Common/Server/EnvironmentConfig", () => {
  const environment: Record<string, unknown> = {
    ...(jest.requireActual("Common/Server/EnvironmentConfig") as Record<
      string,
      unknown
    >),
  };

  environment["Host"] = "oneuptime.example.com";
  environment["HttpProtocol"] = "https://";

  return environment;
});

const formOidcFindOneBy: jest.Mock = jest.fn();

jest.mock("Common/Server/Services/FormOidcService", () => {
  return {
    __esModule: true,
    default: {
      findOneBy: (...args: Array<unknown>): unknown => {
        return formOidcFindOneBy(...args);
      },
    },
  };
});

const privateUserFindOneBy: jest.Mock = jest.fn();
const privateUserCreate: jest.Mock = jest.fn();

jest.mock("Common/Server/Services/FormPrivateUserService", () => {
  return {
    __esModule: true,
    default: {
      findOneBy: (...args: Array<unknown>): unknown => {
        return privateUserFindOneBy(...args);
      },
      create: (...args: Array<unknown>): unknown => {
        return privateUserCreate(...args);
      },
    },
  };
});

const createLoginCodeSession: jest.Mock = jest.fn();

jest.mock("Common/Server/Services/FormPrivateUserSessionService", () => {
  return {
    __esModule: true,
    default: {
      createLoginCodeSession: (...args: Array<unknown>): unknown => {
        return createLoginCodeSession(...args);
      },
    },
  };
});

let storedForm: Form | null = null;
let storedFormOnPlan: boolean = true;

jest.mock("Common/Server/Services/FormService", () => {
  type Actual = { default: object; FORM_NOT_AVAILABLE_MESSAGE: string };

  // Read when called: the real module is still loading when this runs.
  const actual: () => Actual = (): Actual => {
    return jest.requireActual<Actual>("Common/Server/Services/FormService");
  };

  // The real service, reading the stored form and its plan.
  const service: () => Record<string, unknown> = (): Record<
    string,
    unknown
  > => {
    const stub: Record<string, unknown> = Object.create(actual().default);

    stub["findOneById"] = (): Promise<Form | null> => {
      return Promise.resolve(storedForm);
    };
    stub["isProjectOnPlan"] = (): Promise<boolean> => {
      return Promise.resolve(storedFormOnPlan);
    };

    return stub;
  };

  return {
    __esModule: true,
    get FORM_NOT_AVAILABLE_MESSAGE(): string {
      return actual().FORM_NOT_AVAILABLE_MESSAGE;
    },
    default: {
      getFormForSignIn: (data: unknown): Promise<Form> => {
        const stub: Record<string, unknown> = service();

        return (stub["getFormForSignIn"] as (data: unknown) => Promise<Form>).call(
          stub,
          data,
        );
      },
      getPublicFormUrl: (): Promise<string> => {
        return Promise.resolve("https://forms.acme.example.com");
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

const sendErrorResponse: jest.Mock = jest.fn();
const responseRedirect: jest.Mock = jest.fn();

jest.mock("Common/Server/Utils/Response", () => {
  return {
    __esModule: true,
    default: {
      sendErrorResponse: (...args: Array<unknown>): unknown => {
        return sendErrorResponse(...args);
      },
      redirect: (...args: Array<unknown>): unknown => {
        return responseRedirect(...args);
      },
      setNoCacheHeaders: jest.fn(),
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

const START_PATH: string = "/form-oidc/:formId/:formOidcId";
const CALLBACK_PATH: string =
  "/form-oidc-callback/:formId/:formOidcId";

const PARAMS: Record<string, string> = {
  formId: FORM_ID,
  formOidcId: FORM_OIDC_ID,
};

const REDIRECT_URI: string = `https://oneuptime.example.com/identity/form-oidc-callback/${FORM_ID}/${FORM_OIDC_ID}`;

interface RouteResult {
  nextError: unknown;
  cookies: Record<string, string>;
  clearedCookies: Array<string>;
}

async function run(
  method: "GET",
  path: string,
  request: {
    query?: Record<string, string> | undefined;
    cookies?: Record<string, string> | undefined;
  },
): Promise<RouteResult> {
  const cookies: Record<string, string> = {};
  const clearedCookies: Array<string> = [];

  const req: ExpressRequest = {
    params: PARAMS,
    body: {},
    query: request.query || {},
    headers: { "user-agent": "Mozilla/5.0 (X11; Linux x86_64)" },
    cookies: request.cookies || {},
    socket: { remoteAddress: "203.0.113.7" },
    get: (): undefined => {
      return undefined;
    },
  } as unknown as ExpressRequest;

  const res: ExpressResponse = {
    req,
    redirect: jest.fn(),
    status: jest.fn().mockReturnThis(),
    send: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
    setHeader: jest.fn().mockReturnThis(),
    cookie: jest.fn((name: string, value: string) => {
      cookies[name] = value;
      return res;
    }),
    clearCookie: jest.fn((name: string) => {
      clearedCookies.push(name);
      return res;
    }),
  } as unknown as ExpressResponse;

  let nextError: unknown = undefined;

  await (handlerFor(FormOIDCRouter, method, path)(
    req,
    res,
    (err?: unknown): void => {
      nextError = err;
    },
  ) as unknown as Promise<void>);

  return { nextError, cookies, clearedCookies };
}

function refusalMessage(): string | null {
  const call: Array<unknown> | undefined = sendErrorResponse.mock.calls[0];

  return call ? (call[2] as Exception).message : null;
}

function expectNobodySignedIn(): void {
  expect(privateUserCreate).not.toHaveBeenCalled();
  expect(createLoginCodeSession).not.toHaveBeenCalled();

  const redirectedToForm: boolean = responseRedirect.mock.calls.some(
    (call: Array<unknown>): boolean => {
      return String(call[2]).startsWith(FORM_ADDRESS);
    },
  );

  expect(redirectedToForm).toBe(false);
}

let idp: TestIdp;

// The ID token's claims, read when the provider's token endpoint answers.
let idTokenClaims: JSONObject = {};

async function startProvider(options: {
  clientId?: string | undefined;
  signingKeyOverride?: IdpKeyPair | undefined;
}): Promise<void> {
  idTokenClaims = { email: USER_EMAIL, name: "Fox Mulder" };

  idp = await startTestIdp({
    clientId: options.clientId ?? CLIENT_ID,
    signingKeyOverride: options.signingKeyOverride,
    idTokenClaims: new Proxy<Record<string, unknown>>(
      {},
      {
        ownKeys: (): Array<string> => {
          return Reflect.ownKeys(idTokenClaims) as Array<string>;
        },
        getOwnPropertyDescriptor: (
          _target: Record<string, unknown>,
          key: string | symbol,
        ): PropertyDescriptor | undefined => {
          return Reflect.getOwnPropertyDescriptor(idTokenClaims, key);
        },
        get: (
          _target: Record<string, unknown>,
          key: string | symbol,
        ): unknown => {
          return Reflect.get(idTokenClaims, key);
        },
      },
    ) as JSONObject,
  });

  formOidcFindOneBy.mockImplementation((): Promise<unknown> => {
    return Promise.resolve({
      id: new ObjectID(FORM_OIDC_ID),
      name: "Acme Google",
      formId: new ObjectID(FORM_ID),
      projectId: new ObjectID(PROJECT_ID),
      discoveryURL: idp.issuerUrl,
      issuerURL: idp.issuerUrl,
      clientId: CLIENT_ID,
      clientSecret: CLIENT_SECRET,
      scopes: "openid email profile",
      emailClaimName: "email",
      nameClaimName: "name",
    });
  });
}

function formThatAsksVisitorsToSignIn(): Form {
  const form: Form = new Form();
  form.id = new ObjectID(FORM_ID);
  form.projectId = new ObjectID(PROJECT_ID);
  form.name = "Checkout";
  form.isEnabled = true;
  form.requireSignIn = true;
  form.requireSsoForLogin = false;
  return form;
}

/*
 * The sign-in, started at OneUptime: the state cookie it set, and the
 * authorization request it sent the browser to the provider with.
 */
async function startSignIn(): Promise<{
  stateCookie: string;
  authorization: globalThis.URL;
}> {
  const started: RouteResult = await run("GET", START_PATH, {});

  expect(started.nextError).toBeUndefined();
  expect(responseRedirect).toHaveBeenCalledTimes(1);

  const authorization: globalThis.URL = new globalThis.URL(
    String(responseRedirect.mock.calls[0]![2]),
  );

  responseRedirect.mockClear();

  return {
    stateCookie: started.cookies[STATE_COOKIE_NAME]!,
    authorization,
  };
}

// The provider answering the browser: the callback, with its code and state.
async function answer(data: {
  stateCookie: string | undefined;
  state: string | null;
}): Promise<RouteResult> {
  return await run("GET", CALLBACK_PATH, {
    query: {
      code: "authorization-code-from-idp",
      ...(data.state ? { state: data.state } : {}),
    },
    cookies: data.stateCookie ? { [STATE_COOKIE_NAME]: data.stateCookie } : {},
  });
}

beforeEach(() => {
  jest.clearAllMocks();

  storedForm = formThatAsksVisitorsToSignIn();
  storedFormOnPlan = true;

  // The clients the routes make are on loopback too: unhook them.
  const createClient: typeof OIDCUtil.createClient = jest.requireActual<{
    default: typeof OIDCUtil;
  }>("../../../FeatureSet/Identity/Utils/OIDC").default.createClient;

  jest
    .spyOn(OIDCUtil, "createClient")
    .mockImplementation(
      async (
        config: Parameters<typeof OIDCUtil.createClient>[0],
      ): Promise<Client> => {
        const client: Client = await createClient.call(OIDCUtil, config);
        removeEgressGuardHook(client);
        removeEgressGuardHook(client.issuer);
        return client;
      },
    );

  privateUserFindOneBy.mockResolvedValue(null);
  privateUserCreate.mockImplementation(
    (data: { data: Record<string, unknown> }): Promise<unknown> => {
      return Promise.resolve({
        ...data.data,
        id: new ObjectID(PRIVATE_USER_ID),
      });
    },
  );

  createLoginCodeSession.mockResolvedValue({
    session: { id: ObjectID.generate() },
    refreshToken: "one-time-login-code",
    refreshTokenExpiresAt: new Date(),
  });
});

afterEach(async () => {
  jest.restoreAllMocks();

  if (idp) {
    await idp.close();
  }
});

describe("a form's OIDC sign-in, against a real provider", () => {
  test("starts with an authorization request for this form's redirect URI, with state, nonce and PKCE, and a signed state cookie", async () => {
    await startProvider({});

    const started: { stateCookie: string; authorization: globalThis.URL } =
      await startSignIn();

    const params: URLSearchParams = started.authorization.searchParams;

    expect(started.authorization.toString()).toContain(idp.issuerUrl);
    expect(params.get("client_id")).toBe(CLIENT_ID);
    expect(params.get("redirect_uri")).toBe(REDIRECT_URI);
    expect(params.get("response_type")).toBe("code");
    expect(params.get("state")).toBeTruthy();
    expect(params.get("nonce")).toBeTruthy();
    expect(params.get("code_challenge_method")).toBe("S256");
    expect(params.get("code_challenge")).toBeTruthy();

    // The state, nonce and verifier are kept signed, never in plain view.
    expect(started.stateCookie).toBeTruthy();
    expect(started.stateCookie).not.toContain(params.get("state")!);
  });

  test("the provider's answer makes the person a private user and hands them back to the form with a one-time code", async () => {
    await startProvider({});

    const started: { stateCookie: string; authorization: globalThis.URL } =
      await startSignIn();

    idTokenClaims["nonce"] = started.authorization.searchParams.get("nonce")!;

    const answered: RouteResult = await answer({
      stateCookie: started.stateCookie,
      state: started.authorization.searchParams.get("state"),
    });

    expect(answered.nextError).toBeUndefined();
    expect(refusalMessage()).toBeNull();

    // The state cookie is used once.
    expect(answered.clearedCookies).toContain(STATE_COOKIE_NAME);

    // The token request carried the verifier behind the challenge, and the redirect URI.
    expect(idp.tokenRequests).toHaveLength(1);

    const verifier: string = idp.tokenRequests[0]!.codeVerifier!;
    const challenge: string = crypto
      .createHash("sha256")
      .update(verifier)
      .digest("base64url");

    expect(challenge).toBe(
      started.authorization.searchParams.get("code_challenge"),
    );
    expect(idp.tokenRequests[0]!.redirectUri).toBe(REDIRECT_URI);

    // Made one of the form's private users, by the provider.
    const created: Record<string, unknown> = (
      privateUserCreate.mock.calls[0]![0] as { data: Record<string, unknown> }
    ).data;

    expect(created["formId"]?.toString()).toBe(FORM_ID);
    expect(created["email"]?.toString()).toBe(USER_EMAIL);
    expect(created["isSsoUser"]).toBe(true);

    const session: Record<string, unknown> = createLoginCodeSession.mock
      .calls[0]![0] as Record<string, unknown>;

    expect(session["resourceId"]?.toString()).toBe(FORM_ID);
    expect(session["oidcProviderId"]?.toString()).toBe(FORM_OIDC_ID);
    expect(session["signIn"]).toEqual({
      method: SignInMethod.OpenIdConnect,
      ssoProviderName: "Acme Google",
    });

    expect(String(responseRedirect.mock.calls[0]![2])).toBe(
      `${FORM_ADDRESS}/?${FORM_LOGIN_CODE_PARAMETER}=one-time-login-code`,
    );
  });

  test("an answer with no state cookie signs nobody in", async () => {
    await startProvider({});

    const started: { stateCookie: string; authorization: globalThis.URL } =
      await startSignIn();

    await answer({
      stateCookie: undefined,
      state: started.authorization.searchParams.get("state"),
    });

    expectNobodySignedIn();
    expect(refusalMessage()).toBe(
      "OIDC sign-in session expired. Please try signing in again.",
    );
    expect(idp.tokenRequests).toHaveLength(0);
  });

  test("an answer carrying a state cookie OneUptime did not sign signs nobody in", async () => {
    await startProvider({});

    const started: { stateCookie: string; authorization: globalThis.URL } =
      await startSignIn();

    await answer({
      stateCookie: "forged-state-cookie",
      state: started.authorization.searchParams.get("state"),
    });

    expectNobodySignedIn();
    expect(refusalMessage()).toBe(
      "OIDC sign-in session is invalid. Please try signing in again.",
    );
  });

  test("an answer for another sign-in's state signs nobody in", async () => {
    await startProvider({});

    const started: { stateCookie: string; authorization: globalThis.URL } =
      await startSignIn();

    idTokenClaims["nonce"] = started.authorization.searchParams.get("nonce")!;

    await answer({
      stateCookie: started.stateCookie,
      state: "a-state-this-browser-never-started",
    });

    expectNobodySignedIn();
    expect(refusalMessage()).not.toBeNull();
  });

  test("an ID token carrying another sign-in's nonce signs nobody in", async () => {
    await startProvider({});

    const started: { stateCookie: string; authorization: globalThis.URL } =
      await startSignIn();

    idTokenClaims["nonce"] = "nonce-from-a-different-sign-in";

    await answer({
      stateCookie: started.stateCookie,
      state: started.authorization.searchParams.get("state"),
    });

    expectNobodySignedIn();
    expect(refusalMessage()).not.toBeNull();
  });

  test("an ID token made for another client signs nobody in", async () => {
    await startProvider({ clientId: "another-application" });

    const started: { stateCookie: string; authorization: globalThis.URL } =
      await startSignIn();

    idTokenClaims["nonce"] = started.authorization.searchParams.get("nonce")!;

    await answer({
      stateCookie: started.stateCookie,
      state: started.authorization.searchParams.get("state"),
    });

    expectNobodySignedIn();
    expect(refusalMessage()).not.toBeNull();
  });

  test("an ID token signed by a key the provider does not publish signs nobody in", async () => {
    await startProvider({
      signingKeyOverride: generateIdpKeyPair("not-published"),
    });

    const started: { stateCookie: string; authorization: globalThis.URL } =
      await startSignIn();

    idTokenClaims["nonce"] = started.authorization.searchParams.get("nonce")!;

    await answer({
      stateCookie: started.stateCookie,
      state: started.authorization.searchParams.get("state"),
    });

    expectNobodySignedIn();
    expect(refusalMessage()).not.toBeNull();
  });

  test("once the form stops asking its visitors to sign in, the provider's answer signs nobody in", async () => {
    await startProvider({});

    const started: { stateCookie: string; authorization: globalThis.URL } =
      await startSignIn();

    idTokenClaims["nonce"] = started.authorization.searchParams.get("nonce")!;

    // Switched back to Anyone with the link while the visitor was away.
    storedForm!.requireSignIn = false;

    const answered: RouteResult = await answer({
      stateCookie: started.stateCookie,
      state: started.authorization.searchParams.get("state"),
    });

    expectNobodySignedIn();
    expect((answered.nextError as Exception).message).toBe(
      FORM_SIGN_IN_NOT_ASKED_MESSAGE,
    );
  });

  test("a form that does not ask its visitors to sign in starts no sign-in", async () => {
    await startProvider({});

    storedForm!.requireSignIn = false;

    const started: RouteResult = await run("GET", START_PATH, {});

    expect(responseRedirect).not.toHaveBeenCalled();
    expect(started.cookies[STATE_COOKIE_NAME]).toBeUndefined();
    expect((started.nextError as Exception).message).toBe(
      FORM_SIGN_IN_NOT_ASKED_MESSAGE,
    );
  });

  test("a provider that is off starts no sign-in and takes no answer", async () => {
    await startProvider({});

    formOidcFindOneBy.mockResolvedValue(null);

    await run("GET", START_PATH, {});

    expect(responseRedirect).not.toHaveBeenCalled();
    expect(refusalMessage()).toBe(
      "This OpenID Connect provider is not set up for this form, or is turned off. Ask the form's team to check its Single Sign-On settings.",
    );

    const lookup: { query: Record<string, unknown> } = formOidcFindOneBy
      .mock.calls[0]![0] as { query: Record<string, unknown> };

    expect(lookup.query["formId"]?.toString()).toBe(FORM_ID);
    expect(lookup.query["isEnabled"]).toBe(true);
  });
});
