import { beforeAll, beforeEach, describe, expect, test } from "@jest/globals";
import FormSSORouter from "../../../FeatureSet/Identity/API/FormSSO";
import {
  SAML_AUDIENCE_MISMATCH_MESSAGE,
  SAML_RECIPIENT_MISMATCH_MESSAGE,
  SAML_RESPONSE_EXPIRED_MESSAGE,
} from "../../../FeatureSet/Identity/Utils/SSO";
import {
  SAML_RESPONSE_ALREADY_USED_MESSAGE,
  SAML_SIGN_IN_UNAVAILABLE_MESSAGE,
} from "../../../FeatureSet/Identity/Utils/SamlAssertionOneTimeUse";
import {
  SamlKeyPair,
  buildSamlResponse,
  generateRsaKeyPair,
  minutesAfter,
  signElement,
  toBase64,
} from "./SamlTestKit";
import {
  ExpressRequest,
  ExpressResponse,
  ExpressRouter,
  RequestHandler,
} from "Common/Server/Utils/Express";
import {
  FORM_NETWORK_NOT_ALLOWED_MESSAGE,
  FORM_NOT_AVAILABLE_MESSAGE,
} from "Common/Server/Services/FormService";
import Form from "Common/Models/DatabaseModels/Form";
import {
  FORM_LOGIN_CODE_PARAMETER,
  FORM_SIGN_IN_NOT_ASKED_MESSAGE,
} from "Common/Types/Form/FormPrivateUserSignIn";
import Exception from "Common/Types/Exception/Exception";
import ObjectID from "Common/Types/ObjectID";
import { SignInMethod } from "Common/Types/UserSession/SessionSignIn";
import { setTestBillingEnabled } from "Common/Tests/Server/Enterprise/TestBillingFlag";
import zlib from "zlib";

/*
 * ---------------------------------------------------------------------------
 * A FORM'S SAML SIGN-IN (#10249) SIGNS SOMEONE IN TO THAT FORM
 * ONCE, THROUGH THE PROVIDER IT WAS MADE FOR, WHILE IT IS FRESH - AND ONLY
 * WHILE THE FORM ASKS ITS VISITORS TO SIGN IN.
 *
 * The Reply URL (/form-idp-login) is run through its real route
 * handler with a response signed at run time by a generated identity
 * provider key, and the real SSOUtil verifying it, as SamlSignInRoutes runs
 * the other three. The public link's decision is the real one
 * (FormService.getFormForSignIn); only the database, the cache and the
 * response writers are stand-ins.
 *
 *   - a fresh response for this form's provider makes the person one
 *     of its private users the first time, and hands them back to the
 *     form's public link - its custom domain - with a one-time code;
 *   - the same response posted again, one whose time ran out, one made for
 *     another application or for a status page trusting the same identity
 *     provider, one sent to another Reply URL, one from another issuer, and
 *     one naming no address sign nobody in;
 *   - nor does any response once the form stops asking its visitors to
 *     sign in, or from an address its IP allowlist does not name;
 *   - the sign-in it starts names this provider's Entity ID and Reply URL.
 *
 * "Signs nobody in" means: no private user is made, no session or code is
 * handed out, nobody is sent back to the form.
 * ---------------------------------------------------------------------------
 */

const HOST: string = "oneuptime.example.com";
const SERVER: string = `https://${HOST}`;

const ISSUER: string = "https://idp.example.com/realms/acme";
const USER_EMAIL: string = "dana.scully@example.com";

const PROJECT_ID: string = "2abc0000-0000-4000-8000-0000000000a1";
const FORM_ID: string = "5abc0000-0000-4000-8000-0000000000c1";
const FORM_SSO_ID: string = "5abc0000-0000-4000-8000-0000000000d2";
const PRIVATE_USER_ID: string = "5abc0000-0000-4000-8000-0000000000e3";

const STATUS_PAGE_ID: string = "3def0000-0000-4000-8000-0000000000c1";
const STATUS_PAGE_SSO_ID: string = "3def0000-0000-4000-8000-0000000000d2";

// The form's custom domain: where its visitors open it.
const FORM_ADDRESS: string = "https://forms.acme.example.com";

// Where the visitor's request comes from.
const VISITOR_IP: string = "203.0.113.7";

// What a provider that is off, deleted or another form's answers.
const SAML_PROVIDER_NOT_SET_UP: string =
  "This single sign-on provider is not set up for this form, or is turned off. Ask the form's team to check its Single Sign-On settings.";

// Another application the same identity provider signs people in to.
const OTHER_APPLICATION: { entityId: string; replyUrl: string } = {
  entityId: "https://acme.chat.example.net",
  replyUrl: "https://acme.chat.example.net/sso/saml",
};

jest.mock("Common/Server/EnvironmentConfig", () => {
  const billingFlag: typeof import("Common/Tests/Server/Enterprise/TestBillingFlag") =
    jest.requireActual(
      "Common/Tests/Server/Enterprise/TestBillingFlag",
    ) as typeof import("Common/Tests/Server/Enterprise/TestBillingFlag");

  const environment: Record<string, unknown> = billingFlag.withLiveBillingFlag(
    jest.requireActual("Common/Server/EnvironmentConfig") as Record<
      string,
      unknown
    >,
  );

  environment["Host"] = "oneuptime.example.com";
  environment["HttpProtocol"] = "https://";

  return environment;
});

// The cache that remembers which responses were used, in memory.
const cacheEntries: Map<string, { value: string; expiresAt: number }> =
  new Map();
let cacheIsDown: boolean = false;

jest.mock("Common/Server/Infrastructure/GlobalCache", () => {
  return {
    __esModule: true,
    default: {
      setStringIfNotExists: (
        namespace: string,
        key: string,
        value: string,
        options: { expiresInSeconds: number },
      ): Promise<boolean> => {
        if (cacheIsDown) {
          return Promise.reject(new Error("Cache is not connected"));
        }

        const fullKey: string = `${namespace}-${key}`;
        const existing: { value: string; expiresAt: number } | undefined =
          cacheEntries.get(fullKey);

        if (existing && existing.expiresAt > Date.now()) {
          return Promise.resolve(false);
        }

        cacheEntries.set(fullKey, {
          value,
          expiresAt: Date.now() + options.expiresInSeconds * 1000,
        });

        return Promise.resolve(true);
      },
    },
  };
});

const formSsoFindOneBy: jest.Mock = jest.fn();

jest.mock("Common/Server/Services/FormSsoService", () => {
  return {
    __esModule: true,
    default: {
      findOneBy: (...args: Array<unknown>): unknown => {
        return formSsoFindOneBy(...args);
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

/*
 * The form as stored, and the public link's real decision about it
 * for this visitor (no unlock cookie, no session: they are signing in).
 */
let storedForm: Form | null = null;
let storedFormOnPlan: boolean = true;

jest.mock("Common/Server/Services/FormService", () => {
  type Actual = {
    default: Record<string, unknown>;
    FORM_NOT_AVAILABLE_MESSAGE: string;
    FORM_NETWORK_NOT_ALLOWED_MESSAGE: string;
  };

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
    get FORM_NETWORK_NOT_ALLOWED_MESSAGE(): string {
      return actual().FORM_NETWORK_NOT_ALLOWED_MESSAGE;
    },
    default: {
      getFormForSignIn: (data: unknown): Promise<Form> => {
        const stub: Record<string, unknown> = service();

        return (
          stub["getFormForSignIn"] as (data: unknown) => Promise<Form>
        ).call(stub, data);
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

const REPLY_PATH: string = "/form-idp-login/:formId/:formSsoId";
const START_PATH: string = "/form-sso/:formId/:formSsoId";

const PARAMS: Record<string, string> = {
  formId: FORM_ID,
  formSsoId: FORM_SSO_ID,
};

// What the identity provider was told about this form's provider.
const FORM_PROVIDER: { entityId: string; replyUrl: string } = {
  entityId: `${SERVER}/form-sso/${FORM_ID}/${FORM_SSO_ID}`,
  replyUrl: `${SERVER}/identity/form-idp-login/${FORM_ID}/${FORM_SSO_ID}`,
};

// A status page's provider that trusts the same identity provider.
const STATUS_PAGE_PROVIDER: { entityId: string; replyUrl: string } = {
  entityId: `${SERVER}/${STATUS_PAGE_ID}/${STATUS_PAGE_SSO_ID}`,
  replyUrl: `${SERVER}/identity/status-page-idp-login/${STATUS_PAGE_ID}/${STATUS_PAGE_SSO_ID}`,
};

let idpKeys: SamlKeyPair;

beforeAll(() => {
  idpKeys = generateRsaKeyPair();
});

let responseCounter: number = 0;

function signedResponse(data: {
  audience: string;
  replyUrl: string;
  issuedMinutesAgo?: number | undefined;
  issuer?: string | undefined;
  email?: string | undefined;
}): string {
  responseCounter++;

  return toBase64(
    signElement(
      buildSamlResponse({
        issuer: data.issuer ?? ISSUER,
        email: data.email ?? USER_EMAIL,
        issuedAt: minutesAfter(new Date(), -(data.issuedMinutesAgo ?? 0)),
        responseId: `_form_response_${responseCounter}`,
        assertionId: `_form_assertion_${responseCounter}`,
        audienceRestrictions: [[data.audience]],
        recipient: data.replyUrl,
        destination: data.replyUrl,
        inResponseTo: "_request_1",
      }),
      "Assertion",
      idpKeys.privateKey,
    ),
  );
}

function fakeRequest(body: Record<string, unknown>): ExpressRequest {
  return {
    params: PARAMS,
    body,
    query: {},
    headers: { "user-agent": "Mozilla/5.0 (X11; Linux x86_64)" },
    cookies: {},
    socket: { remoteAddress: VISITOR_IP },
    get: (): undefined => {
      return undefined;
    },
  } as unknown as ExpressRequest;
}

function fakeResponse(): ExpressResponse {
  const res: ExpressResponse = {
    redirect: jest.fn(),
    status: jest.fn().mockReturnThis(),
    send: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
    cookie: jest.fn().mockReturnThis(),
    clearCookie: jest.fn().mockReturnThis(),
    setHeader: jest.fn().mockReturnThis(),
  } as unknown as ExpressResponse;

  return res;
}

// What the Reply URL did with a posted response: the error it passed on.
async function post(samlResponse: string): Promise<unknown> {
  let nextError: unknown = undefined;

  await (handlerFor(FormSSORouter, "POST", REPLY_PATH)(
    fakeRequest({ SAMLResponse: samlResponse }),
    fakeResponse(),
    (err?: unknown): void => {
      nextError = err;
    },
  ) as unknown as Promise<void>);

  return nextError;
}

function refusalMessage(): string | null {
  const call: Array<unknown> | undefined = sendErrorResponse.mock.calls[0];

  return call ? (call[2] as Exception).message : null;
}

function refusalStatus(): number | null {
  const call: Array<unknown> | undefined = sendErrorResponse.mock.calls[0];

  return call ? (call[2] as Exception).code : null;
}

function expectNobodySignedIn(): void {
  expect(privateUserCreate).not.toHaveBeenCalled();
  expect(createLoginCodeSession).not.toHaveBeenCalled();
  expect(responseRedirect).not.toHaveBeenCalled();
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

const FRESH: () => string = (): string => {
  return signedResponse({
    audience: FORM_PROVIDER.entityId,
    replyUrl: FORM_PROVIDER.replyUrl,
  });
};

beforeEach(() => {
  jest.clearAllMocks();
  cacheEntries.clear();
  cacheIsDown = false;
  setTestBillingEnabled(false);

  storedForm = formThatAsksVisitorsToSignIn();
  storedFormOnPlan = true;

  formSsoFindOneBy.mockImplementation((): Promise<unknown> => {
    return Promise.resolve({
      id: new ObjectID(FORM_SSO_ID),
      name: "Acme Okta",
      formId: new ObjectID(FORM_ID),
      projectId: new ObjectID(PROJECT_ID),
      signOnURL: "https://idp.example.com/sso",
      issuerURL: ISSUER,
      publicCertificate: idpKeys.publicKey,
    });
  });

  // A newcomer: the identity provider vouches for them.
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

describe.each([
  ["billing off (self-hosted)", false],
  ["billing on (OneUptime Cloud)", true],
])("a form's SAML Reply URL, %s", (_billing: string, billing: boolean) => {
  beforeEach(() => {
    setTestBillingEnabled(billing);
  });

  test("a fresh response for this form's provider makes the person a private user and hands them back to the form with a one-time code", async () => {
    const nextError: unknown = await post(FRESH());

    expect(nextError).toBeUndefined();
    expect(refusalMessage()).toBeNull();

    // Made one of the form's private users, by the identity provider.
    expect(privateUserCreate).toHaveBeenCalledTimes(1);

    const created: Record<string, unknown> = (
      privateUserCreate.mock.calls[0]![0] as { data: Record<string, unknown> }
    ).data;

    expect(created["formId"]?.toString()).toBe(FORM_ID);
    expect(created["projectId"]?.toString()).toBe(PROJECT_ID);
    expect(created["email"]?.toString()).toBe(USER_EMAIL);
    expect(created["isSsoUser"]).toBe(true);

    // A session for this form, held to the provider that vouched.
    expect(createLoginCodeSession).toHaveBeenCalledTimes(1);

    const session: Record<string, unknown> = createLoginCodeSession.mock
      .calls[0]![0] as Record<string, unknown>;

    expect(session["resourceId"]?.toString()).toBe(FORM_ID);
    expect(session["privateUserId"]?.toString()).toBe(PRIVATE_USER_ID);
    expect(session["ssoProviderId"]?.toString()).toBe(FORM_SSO_ID);
    expect(session["signIn"]).toEqual({
      method: SignInMethod.Saml,
      ssoProviderName: "Acme Okta",
    });

    // Back to the form's own address, with the code alone.
    expect(responseRedirect).toHaveBeenCalledTimes(1);
    expect(String(responseRedirect.mock.calls[0]![2])).toBe(
      `${FORM_ADDRESS}/?${FORM_LOGIN_CODE_PARAMETER}=one-time-login-code`,
    );
  });

  test("a private user already invited is signed in as themselves, not made again", async () => {
    privateUserFindOneBy.mockResolvedValue({
      id: new ObjectID(PRIVATE_USER_ID),
      projectId: new ObjectID(PROJECT_ID),
      formId: new ObjectID(FORM_ID),
    });

    await post(FRESH());

    expect(refusalMessage()).toBeNull();
    expect(privateUserCreate).not.toHaveBeenCalled();
    expect(
      (createLoginCodeSession.mock.calls[0]![0] as Record<string, unknown>)[
        "privateUserId"
      ]?.toString(),
    ).toBe(PRIVATE_USER_ID);

    // Looked up on this form alone.
    const lookup: { query: Record<string, unknown> } = privateUserFindOneBy.mock
      .calls[0]![0] as { query: Record<string, unknown> };

    expect(lookup.query["formId"]?.toString()).toBe(FORM_ID);
    expect(lookup.query["email"]?.toString()).toBe(USER_EMAIL);
  });

  test("the same response, posted a second time, signs nobody in", async () => {
    const response: string = FRESH();

    await post(response);

    expect(createLoginCodeSession).toHaveBeenCalledTimes(1);

    jest.clearAllMocks();

    await post(response);

    expectNobodySignedIn();
    expect(refusalMessage()).toBe(SAML_RESPONSE_ALREADY_USED_MESSAGE);
    expect(refusalStatus()).toBe(400);
  });

  test("a response whose time ran out signs nobody in", async () => {
    await post(
      signedResponse({
        audience: FORM_PROVIDER.entityId,
        replyUrl: FORM_PROVIDER.replyUrl,
        issuedMinutesAgo: 120,
      }),
    );

    expectNobodySignedIn();
    expect(refusalMessage()).toBe(SAML_RESPONSE_EXPIRED_MESSAGE);
  });

  test("a response the identity provider made for another application signs nobody in", async () => {
    await post(
      signedResponse({
        audience: OTHER_APPLICATION.entityId,
        replyUrl: OTHER_APPLICATION.replyUrl,
      }),
    );

    expectNobodySignedIn();
    expect(refusalMessage()).toBe(SAML_AUDIENCE_MISMATCH_MESSAGE);
  });

  test("a response made for a status page trusting the same identity provider signs nobody in here", async () => {
    await post(
      signedResponse({
        audience: STATUS_PAGE_PROVIDER.entityId,
        replyUrl: STATUS_PAGE_PROVIDER.replyUrl,
      }),
    );

    expectNobodySignedIn();
    expect(refusalMessage()).toBe(SAML_AUDIENCE_MISMATCH_MESSAGE);
  });

  test("a response for this provider's Entity ID but sent to another Reply URL signs nobody in", async () => {
    await post(
      signedResponse({
        audience: FORM_PROVIDER.entityId,
        replyUrl: STATUS_PAGE_PROVIDER.replyUrl,
      }),
    );

    expectNobodySignedIn();
    expect(refusalMessage()).toBe(SAML_RECIPIENT_MISMATCH_MESSAGE);
  });

  test("a response from another issuer signs nobody in", async () => {
    await post(
      signedResponse({
        audience: FORM_PROVIDER.entityId,
        replyUrl: FORM_PROVIDER.replyUrl,
        issuer: "https://idp.example.com/realms/someone-else",
      }),
    );

    expectNobodySignedIn();
    expect(refusalMessage()).toBe(
      "The identity provider that signed this response is not the one this form trusts. Ask the form's team to check the provider's Issuer URL.",
    );
  });

  test("a response signed by another key signs nobody in", async () => {
    const otherKeys: SamlKeyPair = generateRsaKeyPair();

    await post(
      toBase64(
        signElement(
          buildSamlResponse({
            issuer: ISSUER,
            email: USER_EMAIL,
            issuedAt: new Date(),
            responseId: "_forged_response",
            assertionId: "_forged_assertion",
            audienceRestrictions: [[FORM_PROVIDER.entityId]],
            recipient: FORM_PROVIDER.replyUrl,
            destination: FORM_PROVIDER.replyUrl,
            inResponseTo: "_request_1",
          }),
          "Assertion",
          otherKeys.privateKey,
        ),
      ),
    );

    expectNobodySignedIn();
    expect(refusalMessage()).not.toBeNull();
  });

  test("when used responses cannot be remembered, nobody is signed in", async () => {
    cacheIsDown = true;

    await post(FRESH());

    expectNobodySignedIn();
    expect(refusalStatus()).toBe(503);
    expect(refusalMessage()).toBe(SAML_SIGN_IN_UNAVAILABLE_MESSAGE);
  });

  test("a provider that is off, deleted, or another form's signs nobody in", async () => {
    formSsoFindOneBy.mockResolvedValue(null);

    await post(FRESH());

    expectNobodySignedIn();
    expect(refusalMessage()).toBe(SAML_PROVIDER_NOT_SET_UP);

    // It was looked for on this form, enabled.
    const lookup: { query: Record<string, unknown> } = formSsoFindOneBy.mock
      .calls[0]![0] as { query: Record<string, unknown> };

    expect(lookup.query["formId"]?.toString()).toBe(FORM_ID);
    expect(lookup.query["isEnabled"]).toBe(true);
  });

  test("once the form stops asking its visitors to sign in, a fresh response signs nobody in", async () => {
    storedForm!.requireSignIn = false;

    const nextError: unknown = await post(FRESH());

    expectNobodySignedIn();
    expect((nextError as Exception).message).toBe(
      FORM_SIGN_IN_NOT_ASKED_MESSAGE,
    );
  });

  test.each([
    [
      "turned off",
      (form: Form): void => {
        form.isEnabled = false;
      },
    ],
    [
      "in a project whose plan has no forms",
      (): void => {
        storedFormOnPlan = false;
      },
    ],
  ])(
    "a form now %s signs nobody in, and reads as not found",
    async (_label: string, change: (form: Form) => void) => {
      change(storedForm!);

      const nextError: unknown = await post(FRESH());

      expectNobodySignedIn();
      expect((nextError as Exception).message).toBe(FORM_NOT_AVAILABLE_MESSAGE);
    },
  );

  test("a visitor whose address the form's IP allowlist does not name is signed in nowhere", async () => {
    storedForm!.ipWhitelist = "198.51.100.0/24";

    const nextError: unknown = await post(FRESH());

    expectNobodySignedIn();
    // A form's own answer to a network its allowlist does not name.
    expect((nextError as Exception).message).toBe(
      FORM_NETWORK_NOT_ALLOWED_MESSAGE,
    );
  });

  test("a response that names no address signs nobody in", async () => {
    await post(
      signedResponse({
        audience: FORM_PROVIDER.entityId,
        replyUrl: FORM_PROVIDER.replyUrl,
        email: "not-an-email",
      }),
    );

    expectNobodySignedIn();
    expect(refusalMessage()).not.toBeNull();
  });
});

describe("the sign-in a form's SAML provider starts", () => {
  // The AuthnRequest the start route redirected the browser with.
  async function startSignIn(): Promise<{
    authnRequest: string | null;
    nextError: unknown;
  }> {
    let nextError: unknown = undefined;

    await (handlerFor(FormSSORouter, "GET", START_PATH)(
      fakeRequest({}),
      fakeResponse(),
      (err?: unknown): void => {
        nextError = err;
      },
    ) as unknown as Promise<void>);

    const call: Array<unknown> | undefined = responseRedirect.mock.calls[0];

    if (!call) {
      return { authnRequest: null, nextError };
    }

    const redirectedTo: globalThis.URL = new globalThis.URL(String(call[2]));

    return {
      nextError,
      authnRequest: zlib
        .inflateRawSync(
          Buffer.from(
            redirectedTo.searchParams.get("SAMLRequest") || "",
            "base64",
          ),
        )
        .toString("utf8"),
    };
  }

  test("asks the identity provider for a response to this form's Reply URL, naming its Entity ID", async () => {
    const started: { authnRequest: string | null } = await startSignIn();

    expect(started.authnRequest).toContain(
      `AssertionConsumerServiceURL="${FORM_PROVIDER.replyUrl}"`,
    );
    expect(started.authnRequest).toContain(
      `<Issuer xmlns="urn:oasis:names:tc:SAML:2.0:assertion">${FORM_PROVIDER.entityId}</Issuer>`,
    );
  });

  test("the response to it signs in", async () => {
    await startSignIn();
    jest.clearAllMocks();

    await post(FRESH());

    expect(refusalMessage()).toBeNull();
    expect(createLoginCodeSession).toHaveBeenCalledTimes(1);
  });

  test("a form that does not ask its visitors to sign in starts no sign-in", async () => {
    storedForm!.requireSignIn = false;

    const started: { authnRequest: string | null; nextError: unknown } =
      await startSignIn();

    expect(started.authnRequest).toBeNull();
    expect((started.nextError as Exception).message).toBe(
      FORM_SIGN_IN_NOT_ASKED_MESSAGE,
    );
  });

  test("a provider that is off starts no sign-in", async () => {
    formSsoFindOneBy.mockResolvedValue(null);

    const started: { authnRequest: string | null } = await startSignIn();

    expect(started.authnRequest).toBeNull();
    expect(refusalMessage()).toBe(SAML_PROVIDER_NOT_SET_UP);
  });
});
