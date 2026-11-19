import { beforeAll, beforeEach, describe, expect, test } from "@jest/globals";
import SSORouter from "../../../FeatureSet/Identity/API/SSO";
import GlobalSSORouter from "../../../FeatureSet/Identity/API/GlobalSSO";
import SamlSingleLogout, {
  SAML_SIGNATURE_ALGORITHM_RSA_SHA256,
  SAML_STATUS_SUCCESS,
} from "../../../FeatureSet/Identity/Utils/SamlSingleLogout";
import {
  SAML_SIGN_OUT_NOT_CONFIRMED_MESSAGE,
  SAML_SIGN_OUT_NOT_CONFIRMED_TITLE,
  SAML_SIGN_OUT_NOT_SET_UP_MESSAGE,
  SAML_SIGN_OUT_NOT_SET_UP_TITLE,
} from "../../../FeatureSet/Identity/Utils/SamlSingleLogoutEndpoint";
import {
  SamlKeyPair,
  generateRsaKeyPair,
  signXml,
  toBase64,
} from "./SamlTestKit";
import SelfSignedCertificate, {
  SelfSignedKeyPair,
} from "Common/Server/Utils/SelfSignedCertificate";
import {
  ExpressRequest,
  ExpressResponse,
  ExpressRouter,
  RequestHandler,
} from "Common/Server/Utils/Express";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import { SamlIdentityProviderSignOutRecord } from "Common/Types/SSO/IdentityProviderSignOut";
import SsoProviderType from "Common/Types/SSO/SsoProviderType";
import { SessionEndCause } from "Common/Types/UserSession/SessionEndCause";
import { DOMParser, Element as XmlElement } from "@xmldom/xmldom";
import crypto from "crypto";
import zlib from "zlib";

/*
 * ---------------------------------------------------------------------------
 * ONEUPTIME'S SINGLE LOGOUT URL, THROUGH ITS REAL ROUTES (#9603).
 *
 * /identity/idp-logout/:projectId/:projectSsoId and
 * /identity/global-idp-logout/:globalSsoId, as a browser reaches them from
 * an identity provider, on either binding:
 *
 *   - the identity provider's answer to the sign-out OneUptime sent the
 *     browser with: the sign-in page when it confirms it, the page that
 *     says it did not otherwise - and never anywhere a message names;
 *   - the identity provider's own sign-out request: signed, it ends the
 *     sessions it names that a sign-in through this provider gave - and
 *     no other - and is answered, signed, at the provider's Sign Out URL;
 *     not signed, it ends nothing and is answered with Requester;
 *   - a provider that does not sign people out takes nothing.
 *
 * The handlers are the routers' own, with real keys and real signatures.
 * The providers, the accounts and the sessions are stand-ins.
 * ---------------------------------------------------------------------------
 */

jest.mock("Common/Server/EnvironmentConfig", () => {
  const actual: Record<string, unknown> = jest.requireActual(
    "Common/Server/EnvironmentConfig",
  ) as Record<string, unknown>;

  return {
    ...actual,
    Host: "oneuptime.example.com",
    HttpProtocol: "https://",
  };
});

const PROJECT_ID: string = "7b7b0000-0000-4000-8000-0000000000a1";
const PROJECT_SSO_ID: string = "7b7b0000-0000-4000-8000-0000000000b2";
const OTHER_PROJECT_ID: string = "7b7b0000-0000-4000-8000-0000000000a9";
const GLOBAL_SSO_ID: string = "7b7b0000-0000-4000-8000-0000000000c3";
const USER_ID: string = "7b7b0000-0000-4000-8000-0000000000d4";

const IDP_ISSUER: string = "https://idp.example.com/realms/acme";
const IDP_SIGN_OUT_URL: string =
  "https://idp.example.com/realms/acme/protocol/saml";

const PERSON: string = "fox.mulder@example.com";
const SESSION_INDEX: string = "_7c5d3e1f-0a2b-4c6d-8e9f-a1b2c3d4e5f6";

interface ProviderRow {
  isEnabled: boolean;
  signOutOfIdentityProvider: boolean;
  singleLogoutURL: string | null;
  projectId?: string | undefined;
}

const providers: Map<string, ProviderRow> = new Map();
const providerQueries: Array<JSONObject> = [];

function providerLookup(data: { query: JSONObject }): Promise<unknown> {
  providerQueries.push(data.query);

  const row: ProviderRow | undefined = providers.get(String(data.query["_id"]));

  if (
    !row ||
    row.isEnabled !== data.query["isEnabled"] ||
    (data.query["projectId"] !== undefined &&
      String(data.query["projectId"]) !== row.projectId)
  ) {
    return Promise.resolve(null);
  }

  const { default: ObjectIDType } = jest.requireActual(
    "Common/Types/ObjectID",
  ) as { default: typeof ObjectID };

  return Promise.resolve({
    _id: data.query["_id"],
    id: new ObjectIDType(String(data.query["_id"])),
    projectId: row.projectId ? new ObjectIDType(row.projectId) : undefined,
    issuerURL: IDP_ISSUER,
    publicCertificate: keys.idp.publicKey,
    /*
     * As a URL column hands it over: something that reads as its text,
     * here whatever text the row holds, so the routes' own check of it is
     * what is tested.
     */
    singleLogoutURL: row.singleLogoutURL
      ? {
          toString: (): string => {
            return row.singleLogoutURL!;
          },
        }
      : undefined,
    signOutOfIdentityProvider: row.signOutOfIdentityProvider,
  });
}

jest.mock("Common/Server/Services/ProjectSsoService", () => {
  return {
    __esModule: true,
    default: {
      findOneBy: (data: { query: JSONObject }): Promise<unknown> => {
        return providerLookup(data);
      },
    },
  };
});

jest.mock("Common/Server/Services/GlobalSsoService", () => {
  return {
    __esModule: true,
    default: {
      findOneBy: (data: { query: JSONObject }): Promise<unknown> => {
        return providerLookup(data);
      },
      findBy: jest.fn(),
    },
  };
});

// The installation's key, made for this suite.
const keys: {
  oneUptime: SelfSignedKeyPair;
  idp: SamlKeyPair;
  stranger: SamlKeyPair;
} = {} as never;

jest.mock("Common/Server/Services/InstanceSamlSigningKeyService", () => {
  return {
    __esModule: true,
    default: {
      getKeyPair: (): Promise<unknown> => {
        return Promise.resolve(keys.oneUptime);
      },
      getCertificate: (): Promise<string> => {
        return Promise.resolve(keys.oneUptime.certificate);
      },
    },
  };
});

const accounts: Map<string, string> = new Map();

jest.mock("Common/Server/Services/UserService", () => {
  return {
    __esModule: true,
    default: {
      findByEmail: (email: { toString: () => string }): Promise<unknown> => {
        const id: string | undefined = accounts.get(email.toString());

        if (!id) {
          return Promise.resolve(null);
        }

        const { default: ObjectIDType } = jest.requireActual(
          "Common/Types/ObjectID",
        ) as { default: typeof ObjectID };

        return Promise.resolve({ id: new ObjectIDType(id) });
      },
      findOneBy: jest.fn(),
    },
  };
});

// The person's live sessions, with what each kept of its sign-in.
interface SessionRow {
  id: string;
  userId: string;
  isRevoked: boolean;
  cause: unknown;
  record: SamlIdentityProviderSignOutRecord | null;
}

const sessions: Array<SessionRow> = [];
const failures: { endingSessions: boolean } = { endingSessions: false };

jest.mock("Common/Server/Services/UserSessionService", () => {
  const { default: ObjectIDType } = jest.requireActual(
    "Common/Types/ObjectID",
  ) as { default: typeof ObjectID };

  return {
    __esModule: true,
    default: {
      findLiveSessionsSignedInThroughSamlProvider: (data: {
        userId: ObjectID;
        providerType: SsoProviderType;
        providerId: ObjectID;
      }): Promise<unknown> => {
        return Promise.resolve(
          sessions
            .filter((row: SessionRow): boolean => {
              return (
                !row.isRevoked &&
                row.userId === data.userId.toString() &&
                Boolean(row.record) &&
                row.record!.providerType === data.providerType &&
                row.record!.providerId === data.providerId.toString()
              );
            })
            .map((row: SessionRow) => {
              return {
                sessionId: new ObjectIDType(row.id),
                record: row.record,
              };
            }),
        );
      },
      revokeSessionById: (
        sessionId: ObjectID,
        options: { cause: unknown },
      ): Promise<void> => {
        if (failures.endingSessions) {
          return Promise.reject(
            new Error("connect ECONNREFUSED 10.0.0.5:5432"),
          );
        }

        const row: SessionRow | undefined = sessions.find(
          (candidate: SessionRow): boolean => {
            return candidate.id === sessionId.toString();
          },
        );

        if (row) {
          row.isRevoked = true;
          row.cause = options.cause;
        }

        return Promise.resolve();
      },
      createSession: jest.fn(),
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
const responseRedirect: jest.Mock = jest.fn();
const sendTextResponse: jest.Mock = jest.fn();

jest.mock("Common/Server/Utils/Response", () => {
  return {
    __esModule: true,
    default: {
      render: (...args: Array<unknown>): unknown => {
        return render(...args);
      },
      redirect: (...args: Array<unknown>): unknown => {
        return responseRedirect(...args);
      },
      sendTextResponse: (...args: Array<unknown>): unknown => {
        return sendTextResponse(...args);
      },
      sendErrorResponse: jest.fn(),
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
  method: "get" | "post",
  path: string,
): RequestHandler {
  const layer: RouteLayer | undefined = (
    router as unknown as { stack: Array<RouteLayer> }
  ).stack.find((candidate: RouteLayer) => {
    return (
      candidate.route?.path === path && Boolean(candidate.route.methods[method])
    );
  });

  if (!layer?.route) {
    throw new Error(`${method.toUpperCase()} ${path} is not registered`);
  }

  return layer.route.stack[layer.route.stack.length - 1]!.handle;
}

interface Route {
  name: string;
  router: ExpressRouter;
  path: string;
  params: Record<string, string>;
  providerType: SsoProviderType.ProjectSSO | SsoProviderType.GlobalSSO;
  providerId: string;
  singleLogoutUrl: string;
  entityId: string;
}

const ROUTES: Array<Route> = [
  {
    name: "a project's provider",
    router: SSORouter,
    path: "/idp-logout/:projectId/:projectSsoId",
    params: { projectId: PROJECT_ID, projectSsoId: PROJECT_SSO_ID },
    providerType: SsoProviderType.ProjectSSO,
    providerId: PROJECT_SSO_ID,
    singleLogoutUrl: `https://oneuptime.example.com/identity/idp-logout/${PROJECT_ID}/${PROJECT_SSO_ID}`,
    entityId: `https://oneuptime.example.com/${PROJECT_ID}/${PROJECT_SSO_ID}`,
  },
  {
    name: "the instance's provider",
    router: GlobalSSORouter,
    path: "/global-idp-logout/:globalSsoId",
    params: { globalSsoId: GLOBAL_SSO_ID },
    providerType: SsoProviderType.GlobalSSO,
    providerId: GLOBAL_SSO_ID,
    singleLogoutUrl: `https://oneuptime.example.com/identity/global-idp-logout/${GLOBAL_SSO_ID}`,
    entityId: `https://oneuptime.example.com/global-sso/${GLOBAL_SSO_ID}`,
  },
];

beforeAll(async () => {
  keys.oneUptime = await SelfSignedCertificate.create({
    commonName: "OneUptime SAML Service Provider",
    validForDays: 365,
  });
  keys.idp = generateRsaKeyPair();
  keys.stranger = generateRsaKeyPair();
});

beforeEach(() => {
  jest.clearAllMocks();
  providers.clear();
  providerQueries.length = 0;
  accounts.clear();
  sessions.length = 0;
  failures.endingSessions = false;

  for (const route of ROUTES) {
    providers.set(route.providerId, {
      isEnabled: true,
      signOutOfIdentityProvider: true,
      singleLogoutURL: IDP_SIGN_OUT_URL,
      projectId:
        route.providerType === SsoProviderType.ProjectSSO
          ? PROJECT_ID
          : undefined,
    });
  }

  accounts.set(PERSON, USER_ID);
});

/*
 * ---------------------------------------------------------------------------
 * What the identity provider sends.
 * ---------------------------------------------------------------------------
 */

function ourRequestId(route: Route): string {
  return SamlSingleLogout.createRequestId({
    provider: {
      providerType: route.providerType,
      providerId: route.providerId,
    },
    signingKey: keys.oneUptime,
    now: new Date(),
  });
}

function logoutResponse(
  route: Route,
  overrides: { inResponseTo?: string; statusCode?: string } = {},
): string {
  return `<samlp:LogoutResponse xmlns:samlp="urn:oasis:names:tc:SAML:2.0:protocol" xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion" ID="_idp_response" Version="2.0" IssueInstant="${new Date().toISOString()}" Destination="${route.singleLogoutUrl}" InResponseTo="${
    overrides.inResponseTo || ourRequestId(route)
  }"><saml:Issuer>${IDP_ISSUER}</saml:Issuer><samlp:Status><samlp:StatusCode Value="${
    overrides.statusCode || SAML_STATUS_SUCCESS
  }"/></samlp:Status></samlp:LogoutResponse>`;
}

function logoutRequest(
  route: Route,
  overrides: { nameId?: string; sessionIndexes?: Array<string> } = {},
): string {
  return `<samlp:LogoutRequest xmlns:samlp="urn:oasis:names:tc:SAML:2.0:protocol" xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion" ID="_idp_request_42" Version="2.0" IssueInstant="${new Date().toISOString()}" Destination="${route.singleLogoutUrl}"><saml:Issuer>${IDP_ISSUER}</saml:Issuer><saml:NameID Format="urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress">${
    overrides.nameId || PERSON
  }</saml:NameID>${(overrides.sessionIndexes || [SESSION_INDEX])
    .map((sessionIndex: string): string => {
      return `<samlp:SessionIndex>${sessionIndex}</samlp:SessionIndex>`;
    })
    .join("")}</samlp:LogoutRequest>`;
}

function redirectQuery(data: {
  parameter: "SAMLRequest" | "SAMLResponse";
  xml: string;
  relayState?: string | undefined;
  privateKey: string | null;
}): string {
  let query: string = `${data.parameter}=${encodeURIComponent(
    zlib.deflateRawSync(Buffer.from(data.xml, "utf8")).toString("base64"),
  )}`;

  if (data.relayState !== undefined) {
    query += `&RelayState=${encodeURIComponent(data.relayState)}`;
  }

  if (!data.privateKey) {
    return query;
  }

  query += `&SigAlg=${encodeURIComponent(SAML_SIGNATURE_ALGORITHM_RSA_SHA256)}`;

  return `${query}&Signature=${encodeURIComponent(
    crypto
      .sign("sha256", Buffer.from(query, "utf8"), data.privateKey)
      .toString("base64"),
  )}`;
}

interface Answer {
  // Where the browser was sent, by the handler itself.
  redirectedTo: string | null;
  // Where it was sent through Response.redirect.
  sentTo: string | null;
  // The page it was shown, if any.
  page: JSONObject | null;
  nextError: unknown;
}

async function arrive(
  route: Route,
  data: {
    method: "get" | "post";
    query?: string;
    body?: JSONObject;
    params?: Record<string, string>;
  },
): Promise<Answer> {
  const resRedirect: jest.Mock = jest.fn();

  const req: ExpressRequest = {
    method: data.method.toUpperCase(),
    params: data.params || route.params,
    query: {},
    body: data.body || {},
    originalUrl: `/identity${route.path}${data.query ? `?${data.query}` : ""}`,
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
    setHeader: jest.fn().mockReturnThis(),
  } as unknown as ExpressResponse;

  let nextError: unknown = undefined;

  await (handlerFor(route.router, data.method, route.path)(
    req,
    res,
    (err?: unknown): void => {
      nextError = err;
    },
  ) as unknown as Promise<void>);

  const page: Array<unknown> | undefined = render.mock.calls[0];
  const sent: Array<unknown> | undefined = responseRedirect.mock.calls[0];

  return {
    redirectedTo:
      (resRedirect.mock.calls[0]?.[0] as string | undefined) || null,
    sentTo: sent ? String(sent[2]) : null,
    page: page ? (page[3] as JSONObject) : null,
    nextError,
  };
}

function signedIn(
  route: Route,
  overrides: Omit<Partial<SessionRow>, "record"> & {
    record?: Partial<SamlIdentityProviderSignOutRecord> | null;
  } = {},
): SessionRow {
  const row: SessionRow = {
    id: new ObjectID(crypto.randomUUID()).toString(),
    userId: USER_ID,
    isRevoked: false,
    cause: null,
    ...overrides,
    record:
      overrides.record === null
        ? null
        : {
            providerType: route.providerType,
            providerId: route.providerId,
            nameId: PERSON,
            nameIdFormat:
              "urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress",
            sessionIndex: SESSION_INDEX,
            ...(overrides.record || {}),
          },
  };

  sessions.push(row);

  return row;
}

// The LogoutResponse OneUptime sent the browser back to the identity provider with.
function answerIn(url: string): {
  response: XmlElement;
  query: URLSearchParams;
} {
  const query: URLSearchParams = new globalThis.URL(url).searchParams;

  return {
    query: query,
    response: new DOMParser().parseFromString(
      zlib
        .inflateRawSync(Buffer.from(query.get("SAMLResponse")!, "base64"))
        .toString("utf8"),
      "text/xml",
    ).documentElement as unknown as XmlElement,
  };
}

function statusOf(response: XmlElement): string | null {
  return (
    response
      .getElementsByTagNameNS(
        "urn:oasis:names:tc:SAML:2.0:protocol",
        "StatusCode",
      )
      .item(0)
      ?.getAttribute("Value") || null
  );
}

function isSignedByOneUptime(url: string): boolean {
  const raw: string = url.substring(url.indexOf("?") + 1);
  const signedOctets: string = raw.substring(0, raw.indexOf("&Signature="));
  const signature: string = decodeURIComponent(
    raw.substring(raw.indexOf("&Signature=") + "&Signature=".length),
  );

  return crypto.verify(
    "sha256",
    Buffer.from(signedOctets, "utf8"),
    crypto.createPublicKey(keys.oneUptime.certificate),
    Buffer.from(signature, "base64"),
  );
}

describe.each(ROUTES)("the Single Logout URL of $name", (route: Route) => {
  describe("the identity provider's answer to OneUptime's sign-out", () => {
    test("signed in the query and confirming it: the sign-in page", async () => {
      const answer: Answer = await arrive(route, {
        method: "get",
        query: redirectQuery({
          parameter: "SAMLResponse",
          xml: logoutResponse(route),
          privateKey: keys.idp.privateKey,
        }),
      });

      expect(answer.sentTo).toBe("https://oneuptime.example.com/accounts");
      expect(answer.page).toBeNull();
      expect(answer.redirectedTo).toBeNull();
      expect(answer.nextError).toBeUndefined();
    });

    test("unsigned, answering OneUptime's own request: the sign-in page", async () => {
      const answer: Answer = await arrive(route, {
        method: "get",
        query: redirectQuery({
          parameter: "SAMLResponse",
          xml: logoutResponse(route),
          privateKey: null,
        }),
      });

      expect(answer.sentTo).toBe("https://oneuptime.example.com/accounts");
    });

    test("posted, signed in the message: the sign-in page", async () => {
      const answer: Answer = await arrive(route, {
        method: "post",
        body: {
          SAMLResponse: toBase64(
            signXml(logoutResponse(route), {
              referenceXPath: "//*[local-name(.)='LogoutResponse']",
              privateKey: keys.idp.privateKey,
              location: {
                reference: "/*/*[local-name(.)='Issuer']",
                action: "after",
              },
            }),
          ),
        },
      });

      expect(answer.sentTo).toBe("https://oneuptime.example.com/accounts");
    });

    test("never goes where the RelayState says", async () => {
      const answer: Answer = await arrive(route, {
        method: "get",
        query: redirectQuery({
          parameter: "SAMLResponse",
          xml: logoutResponse(route),
          relayState: "https://evil.example.com/phish",
          privateKey: keys.idp.privateKey,
        }),
      });

      expect(answer.sentTo).toBe("https://oneuptime.example.com/accounts");
      expect(JSON.stringify(answer)).not.toContain("evil.example.com");
    });

    test.each([
      [
        "signed by another key",
        (): string => {
          return redirectQuery({
            parameter: "SAMLResponse",
            xml: logoutResponse(route),
            privateKey: keys.stranger.privateKey,
          });
        },
      ],
      [
        "saying the identity provider did not sign the person out",
        (): string => {
          return redirectQuery({
            parameter: "SAMLResponse",
            xml: logoutResponse(route, {
              statusCode: "urn:oasis:names:tc:SAML:2.0:status:Responder",
            }),
            privateKey: keys.idp.privateKey,
          });
        },
      ],
      [
        "answering no request OneUptime sent",
        (): string => {
          return redirectQuery({
            parameter: "SAMLResponse",
            xml: logoutResponse(route, { inResponseTo: "_made_up" }),
            privateKey: null,
          });
        },
      ],
      [
        "answering a request OneUptime sent for another provider",
        (): string => {
          return redirectQuery({
            parameter: "SAMLResponse",
            xml: logoutResponse(route, {
              inResponseTo: SamlSingleLogout.createRequestId({
                provider: {
                  providerType: route.providerType,
                  providerId: "7b7b0000-0000-4000-8000-0000000000ff",
                },
                signingKey: keys.oneUptime,
                now: new Date(),
              }),
            }),
            privateKey: null,
          });
        },
      ],
      [
        "that is no sign-out message at all",
        (): string => {
          return "SAMLResponse=bm90IGEgbWVzc2FnZQ";
        },
      ],
    ])(
      "%s: the page that says the identity provider did not confirm it",
      async (_: string, query: () => string) => {
        const answer: Answer = await arrive(route, {
          method: "get",
          query: query(),
        });

        expect(answer.page).toEqual({
          title: SAML_SIGN_OUT_NOT_CONFIRMED_TITLE,
          message: SAML_SIGN_OUT_NOT_CONFIRMED_MESSAGE,
        });
        expect(answer.sentTo).toBeNull();
        expect(answer.redirectedTo).toBeNull();
      },
    );
  });

  describe("the identity provider's own sign-out request", () => {
    test("signed: ends the person's sessions it names that this provider gave, and answers Success, signed, at the provider's Sign Out URL", async () => {
      const named: SessionRow = signedIn(route);
      const sameProviderOtherSession: SessionRow = signedIn(route, {
        record: { sessionIndex: "_another_session" },
      });
      const otherProvider: SessionRow = signedIn(route, {
        record: { providerId: "7b7b0000-0000-4000-8000-0000000000ee" },
      });
      const notSso: SessionRow = signedIn(route, { record: null });
      const otherPerson: SessionRow = signedIn(route, {
        userId: "7b7b0000-0000-4000-8000-0000000000d9",
      });

      const answer: Answer = await arrive(route, {
        method: "get",
        query: redirectQuery({
          parameter: "SAMLRequest",
          xml: logoutRequest(route),
          relayState: "idp-state",
          privateKey: keys.idp.privateKey,
        }),
      });

      expect(named.isRevoked).toBe(true);
      expect(named.cause).toBe(SessionEndCause.SignedOut);
      expect(sameProviderOtherSession.isRevoked).toBe(false);
      expect(otherProvider.isRevoked).toBe(false);
      expect(notSso.isRevoked).toBe(false);
      expect(otherPerson.isRevoked).toBe(false);

      expect(answer.redirectedTo).not.toBeNull();
      expect(answer.redirectedTo!.startsWith(`${IDP_SIGN_OUT_URL}?`)).toBe(
        true,
      );

      const { response, query } = answerIn(answer.redirectedTo!);

      expect(response.localName).toBe("LogoutResponse");
      expect(response.getAttribute("InResponseTo")).toBe("_idp_request_42");
      expect(response.getAttribute("Destination")).toBe(IDP_SIGN_OUT_URL);
      expect(
        response
          .getElementsByTagNameNS(
            "urn:oasis:names:tc:SAML:2.0:assertion",
            "Issuer",
          )
          .item(0)?.textContent,
      ).toBe(route.entityId);
      expect(statusOf(response)).toBe(SAML_STATUS_SUCCESS);
      expect(query.get("RelayState")).toBe("idp-state");
      expect(isSignedByOneUptime(answer.redirectedTo!)).toBe(true);
    });

    test("naming no session: ends every session this provider gave the person", async () => {
      const first: SessionRow = signedIn(route);
      const second: SessionRow = signedIn(route, {
        record: { sessionIndex: "_another_session" },
      });

      await arrive(route, {
        method: "get",
        query: redirectQuery({
          parameter: "SAMLRequest",
          xml: logoutRequest(route, { sessionIndexes: [] }),
          privateKey: keys.idp.privateKey,
        }),
      });

      expect(first.isRevoked).toBe(true);
      expect(second.isRevoked).toBe(true);
    });

    test("posted, signed in the message: ends the session it names", async () => {
      const named: SessionRow = signedIn(route);

      const answer: Answer = await arrive(route, {
        method: "post",
        body: {
          SAMLRequest: toBase64(
            signXml(logoutRequest(route), {
              referenceXPath: "//*[local-name(.)='LogoutRequest']",
              privateKey: keys.idp.privateKey,
              location: {
                reference: "/*/*[local-name(.)='Issuer']",
                action: "after",
              },
            }),
          ),
          RelayState: "idp-state",
        },
      });

      expect(named.isRevoked).toBe(true);
      expect(statusOf(answerIn(answer.redirectedTo!).response)).toBe(
        SAML_STATUS_SUCCESS,
      );
    });

    test("not signed: ends nothing, and answers Requester", async () => {
      const named: SessionRow = signedIn(route);

      const answer: Answer = await arrive(route, {
        method: "get",
        query: redirectQuery({
          parameter: "SAMLRequest",
          xml: logoutRequest(route),
          privateKey: null,
        }),
      });

      expect(named.isRevoked).toBe(false);

      const { response } = answerIn(answer.redirectedTo!);

      expect(statusOf(response)).toBe(
        "urn:oasis:names:tc:SAML:2.0:status:Requester",
      );
      expect(response.getAttribute("InResponseTo")).toBe("_idp_request_42");
      expect(isSignedByOneUptime(answer.redirectedTo!)).toBe(true);
    });

    test("signed by another key: ends nothing, and answers Requester", async () => {
      const named: SessionRow = signedIn(route);

      const answer: Answer = await arrive(route, {
        method: "get",
        query: redirectQuery({
          parameter: "SAMLRequest",
          xml: logoutRequest(route),
          privateKey: keys.stranger.privateKey,
        }),
      });

      expect(named.isRevoked).toBe(false);
      expect(statusOf(answerIn(answer.redirectedTo!).response)).toBe(
        "urn:oasis:names:tc:SAML:2.0:status:Requester",
      );
    });

    test("naming someone with no account: ends nothing, and answers Success", async () => {
      const named: SessionRow = signedIn(route);

      const answer: Answer = await arrive(route, {
        method: "get",
        query: redirectQuery({
          parameter: "SAMLRequest",
          xml: logoutRequest(route, { nameId: "nobody@example.com" }),
          privateKey: keys.idp.privateKey,
        }),
      });

      expect(named.isRevoked).toBe(false);
      expect(statusOf(answerIn(answer.redirectedTo!).response)).toBe(
        SAML_STATUS_SUCCESS,
      );
    });

    test("whose sessions cannot be ended: answers Responder", async () => {
      signedIn(route);
      failures.endingSessions = true;

      const answer: Answer = await arrive(route, {
        method: "get",
        query: redirectQuery({
          parameter: "SAMLRequest",
          xml: logoutRequest(route),
          privateKey: keys.idp.privateKey,
        }),
      });

      expect(statusOf(answerIn(answer.redirectedTo!).response)).toBe(
        "urn:oasis:names:tc:SAML:2.0:status:Responder",
      );
    });
  });

  describe("a provider that does not sign people out takes nothing", () => {
    test.each([
      ["turned off", { isEnabled: false }],
      ["with the switch off", { signOutOfIdentityProvider: false }],
      ["with no Sign Out URL", { singleLogoutURL: null }],
      [
        "with a Sign Out URL no browser may be sent to",
        { singleLogoutURL: "javascript:alert(1)" },
      ],
    ])(
      "%s: the page that says so, and nothing ends",
      async (_: string, change: Partial<ProviderRow>) => {
        const named: SessionRow = signedIn(route);

        providers.set(route.providerId, {
          ...providers.get(route.providerId)!,
          ...change,
        });

        const answer: Answer = await arrive(route, {
          method: "get",
          query: redirectQuery({
            parameter: "SAMLRequest",
            xml: logoutRequest(route),
            privateKey: keys.idp.privateKey,
          }),
        });

        expect(answer.page).toEqual({
          title: SAML_SIGN_OUT_NOT_SET_UP_TITLE,
          message: SAML_SIGN_OUT_NOT_SET_UP_MESSAGE,
        });
        expect(answer.redirectedTo).toBeNull();
        expect(named.isRevoked).toBe(false);
      },
    );

    test("a provider id that is no id: nothing is looked up", async () => {
      const answer: Answer = await arrive(route, {
        method: "get",
        query: "SAMLResponse=abc",
        params: Object.fromEntries(
          Object.keys(route.params).map((key: string): [string, string] => {
            return [key, "not-an-id"];
          }),
        ),
      });

      expect(answer.page).toEqual({
        title: SAML_SIGN_OUT_NOT_SET_UP_TITLE,
        message: SAML_SIGN_OUT_NOT_SET_UP_MESSAGE,
      });
      expect(providerQueries).toEqual([]);
    });
  });
});

describe("a project's Single Logout URL", () => {
  test("is the provider's in its own project only", async () => {
    const answer: Answer = await arrive(ROUTES[0]!, {
      method: "get",
      query: redirectQuery({
        parameter: "SAMLResponse",
        xml: logoutResponse(ROUTES[0]!),
        privateKey: keys.idp.privateKey,
      }),
      params: { projectId: OTHER_PROJECT_ID, projectSsoId: PROJECT_SSO_ID },
    });

    expect(providerQueries[0]!["projectId"]?.toString()).toBe(OTHER_PROJECT_ID);
    expect(answer.page).toEqual({
      title: SAML_SIGN_OUT_NOT_SET_UP_TITLE,
      message: SAML_SIGN_OUT_NOT_SET_UP_MESSAGE,
    });
  });
});

describe("the signing certificate", () => {
  test("is served to anyone as a certificate file to download", async () => {
    const setHeader: jest.Mock = jest.fn();

    await (handlerFor(SSORouter, "get", "/saml-signing-certificate")(
      { params: {}, query: {}, headers: {} } as unknown as ExpressRequest,
      {
        setHeader,
        status: jest.fn().mockReturnThis(),
        send: jest.fn(),
      } as unknown as ExpressResponse,
      jest.fn(),
    ) as unknown as Promise<void>);

    expect(setHeader).toHaveBeenCalledWith(
      "Content-Type",
      "application/x-pem-file",
    );
    expect(setHeader).toHaveBeenCalledWith(
      "Content-Disposition",
      'attachment; filename="oneuptime-saml-signing.crt"',
    );
    expect(sendTextResponse.mock.calls[0]![2]).toBe(keys.oneUptime.certificate);
    expect(
      new crypto.X509Certificate(sendTextResponse.mock.calls[0]![2] as string)
        .subject,
    ).toBe("CN=OneUptime SAML Service Provider");
  });
});
