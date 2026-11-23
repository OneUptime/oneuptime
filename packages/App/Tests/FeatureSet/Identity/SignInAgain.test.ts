/*
 * SIGN IN AGAIN, THROUGH THE IDENTITY PROVIDER (#10217).
 *
 * An account that signs in only through single sign-on confirms it's its
 * person's before a change to how it signs in by signing in again. The
 * identity provider usually remembers its own session, and signs a browser
 * that still has one straight back in, asking nothing. So a sign-in Sign In
 * Again starts asks the provider to authenticate the person again, and
 * confirms the session only when the provider says it did, at or after the
 * moment Sign In Again sent them there (Utils/SignInAgain). Pinned here,
 * against what providers really send:
 *
 *   - SAML: the AuthnRequest carries ForceAuthn="true" and an ID only this
 *     server can make, which keeps when it was sent; the response names it
 *     back as its InResponseTo, in the signed assertion; its AuthnInstant
 *     says when the provider authenticated the person;
 *   - OpenID Connect: the authorization request carries prompt=login and
 *     max_age=0 (prompt=login alone to Microsoft Entra ID, #10529); the
 *     verified ID token's auth_time says when, read with a minute either
 *     way for the two clocks;
 *   - a provider that reused its session (Okta with Honor Force
 *     Authentication off, Google, which takes no prompt=login) is refused as
 *     one, and one that does not say (Microsoft Entra ID without the
 *     auth_time optional claim) is refused for not saying: never accepted
 *     silently;
 *   - any other sign-in asks as it always did, and confirms nothing.
 *
 * The routes that carry these (API/SSO.ts, API/GlobalSSO.ts, API/OIDC.ts,
 * API/GlobalOIDC.ts) are driven in SamlSignInAgainRoutes.test.ts; Google's
 * and Microsoft's in Common/Tests/App/Identity.
 */
import SignInAgain, {
  SIGN_IN_AGAIN_STATE_FIELD,
} from "../../../FeatureSet/Identity/Utils/SignInAgain";
import SSOUtil, {
  VerifiedSamlResponse,
} from "../../../FeatureSet/Identity/Utils/SSO";
import OIDCUtil, {
  ID_TOKEN_CLOCK_TOLERANCE_IN_SECONDS,
  MICROSOFT_IDENTITY_PLATFORM_HOSTNAMES,
  OidcCallbackResult,
} from "../../../FeatureSet/Identity/Utils/OIDC";
import { SamlServiceProvider } from "../../../FeatureSet/Identity/Utils/SamlServiceProvider";
import {
  SamlKeyPair,
  buildSamlResponse,
  generateRsaKeyPair,
  signElement,
} from "./SamlTestKit";
import { TestIdp, startTestIdp } from "./OidcTestIdp";
import URL from "Common/Types/API/URL";
import {
  REAUTHENTICATE_QUERY_PARAM,
  REAUTHENTICATION_WINDOW_IN_MINUTES,
  SIGN_IN_AGAIN_CLOCK_SKEW_IN_SECONDS,
  SignInAgainRefusal,
} from "Common/Types/Accounts/Reauthentication";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import { SessionSignInAgain } from "Common/Types/UserSession/SessionSignIn";
import { ExpressRequest } from "Common/Server/Utils/Express";
import logger from "Common/Server/Utils/Logger";
import { afterEach, beforeAll, describe, expect, test } from "@jest/globals";
import { Client, Issuer, custom } from "openid-client";
import dns from "dns";
import fs from "fs";
import path from "path";
import zlib from "zlib";

/*
 * Importing OIDCUtil installs an SSRF egress guard on every openid-client
 * request; this suite's provider is on a 127.0.0.1 socket, as OIDC.test.ts's
 * is, so it opts out of both halves (OidcEgressGuard.test.ts covers them).
 */
custom.setHttpOptionsDefaults({ lookup: dns.lookup });

function removeEgressGuardHook(target: unknown): void {
  delete (target as Record<symbol, unknown>)[custom.http_options];
}

removeEgressGuardHook(Issuer);

const SECOND_IN_MS: number = 1000;
const MINUTE_IN_MS: number = 60 * SECOND_IN_MS;
const HOUR_IN_MS: number = 60 * MINUTE_IN_MS;
const SKEW_IN_MS: number = SIGN_IN_AGAIN_CLOCK_SKEW_IN_SECONDS * SECOND_IN_MS;
const WINDOW_IN_MS: number = REAUTHENTICATION_WINDOW_IN_MINUTES * MINUTE_IN_MS;

const SERVER: string = "https://oneuptime.example.com";
const PROJECT_ID: string = "2abc0000-0000-4000-8000-0000000000a1";
const PROVIDER_ID: ObjectID = new ObjectID(
  "2abc0000-0000-4000-8000-0000000000b2",
);
const OTHER_PROVIDER_ID: ObjectID = new ObjectID(
  "4fab0000-0000-4000-8000-0000000000e1",
);

const PROVIDER: SamlServiceProvider = {
  entityId: `${SERVER}/${PROJECT_ID}/${PROVIDER_ID.toString()}`,
  replyUrl: `${SERVER}/identity/idp-login/${PROJECT_ID}/${PROVIDER_ID.toString()}`,
  serverAddress: SERVER,
};

const OKTA_ISSUER: string = "http://www.okta.com/exk1a2b3c4D5E6F7g8h9";
const EMAIL: string = "dana.scully@example.com";

// When this server answers the response, and when Sign In Again sent them.
const NOW: Date = new Date("2026-11-20T10:00:00.000Z");
const SENT_AT: Date = new Date(NOW.getTime() - 40 * SECOND_IN_MS);

// An xs:ID is an NCName: a letter or "_" first, then letters, digits, "_-.".
const XS_ID: RegExp = /^[A-Za-z_][A-Za-z0-9_.-]*$/;

let idpKeys: SamlKeyPair;

beforeAll(() => {
  idpKeys = generateRsaKeyPair();
});

// The AuthnRequest a sign-in's start sends the browser with, as XML.
function authnRequestOf(url: URL): string {
  const samlRequest: string = new globalThis.URL(
    url.toString(),
  ).searchParams.get("SAMLRequest")!;

  return zlib
    .inflateRawSync(Buffer.from(samlRequest, "base64"))
    .toString("utf8");
}

function requestUrl(options: {
  forceAuthn?: boolean;
  requestId?: string;
}): URL {
  return SSOUtil.createSAMLRequestUrl({
    acsUrl: URL.fromString(PROVIDER.replyUrl),
    signOnUrl: URL.fromString("https://acme.okta.com/app/oneuptime/sso/saml"),
    issuerUrl: URL.fromString(PROVIDER.entityId),
    ...(options.forceAuthn ? { forceAuthn: true } : {}),
    ...(options.requestId ? { requestId: options.requestId } : {}),
  });
}

function attributeOf(xml: string, name: string): string | null {
  const match: RegExpExecArray | null = new RegExp(
    `<samlp:AuthnRequest[^>]*\\s${name}="([^"]*)"`,
  ).exec(xml);

  return match ? match[1]! : null;
}

/*
 * A response Okta signed, answering `inResponseTo`, five seconds before
 * NOW, saying it authenticated the person at `authnInstant`.
 */
function oktaResponse(options: {
  inResponseTo: string | null;
  authnInstant?: Date | undefined;
  rawAuthnStatement?: string | undefined;
  subjectInResponseTo?: Array<string | null> | undefined;
}): string {
  const issuedAt: Date = new Date(NOW.getTime() - 5 * SECOND_IN_MS);

  return signElement(
    buildSamlResponse({
      issuer: OKTA_ISSUER,
      email: EMAIL,
      issuedAt: issuedAt,
      audienceRestrictions: [[PROVIDER.entityId]],
      recipient: PROVIDER.replyUrl,
      destination: PROVIDER.replyUrl,
      inResponseTo: options.inResponseTo,
      authnInstant: options.authnInstant,
      rawAuthnStatement: options.rawAuthnStatement,
      sessionIndex: "_a1b2c3d4e5f6",
      ...(options.subjectInResponseTo
        ? {
            subjectConfirmations: options.subjectInResponseTo.map(
              (inResponseTo: string | null) => {
                return {
                  data: {
                    recipient: PROVIDER.replyUrl,
                    notOnOrAfter: new Date(
                      issuedAt.getTime() + 5 * MINUTE_IN_MS,
                    ),
                    inResponseTo: inResponseTo,
                  },
                };
              },
            ),
          }
        : {}),
    }),
    "Assertion",
    idpKeys.privateKey,
  );
}

function verified(xml: string): VerifiedSamlResponse {
  return SSOUtil.getSamlResponseFromXML(xml, idpKeys.publicKey, PROVIDER, NOW);
}

// What the Reply URL keeps with the new session, as API/SSO.ts judges it.
function samlOutcome(xml: string): SessionSignInAgain | undefined {
  const response: VerifiedSamlResponse = verified(xml);

  return SignInAgain.judge({
    requestedAt: SignInAgain.readSamlRequestId({
      inResponseTo: response.inResponseTo,
      providerId: PROVIDER_ID,
      now: NOW,
    }),
    authenticatedAt: response.authnInstant,
    now: NOW,
  });
}

function signInAgainRequestId(
  options: { providerId?: ObjectID; requestedAt?: Date } = {},
): string {
  return SignInAgain.createSamlRequestId({
    providerId: options.providerId || PROVIDER_ID,
    requestedAt: options.requestedAt || SENT_AT,
  });
}

describe("which sign-ins Sign In Again started", () => {
  test(`the prompt opens the session's own sign-in with ?${REAUTHENTICATE_QUERY_PARAM}=true`, () => {
    const request: (query: JSONObject) => ExpressRequest = (
      query: JSONObject,
    ): ExpressRequest => {
      return { query: query } as unknown as ExpressRequest;
    };

    expect(
      SignInAgain.isRequested(
        request({ [REAUTHENTICATE_QUERY_PARAM]: "true" }),
      ),
    ).toBe(true);
    expect(SignInAgain.isRequested(request({}))).toBe(false);
    expect(
      SignInAgain.isRequested(
        request({ [REAUTHENTICATE_QUERY_PARAM]: "false" }),
      ),
    ).toBe(false);
    expect(
      SignInAgain.isRequested(request({ [REAUTHENTICATE_QUERY_PARAM]: "1" })),
    ).toBe(false);
  });

  test("a sign-in Sign In Again did not start keeps nothing with its session, and confirms nothing", () => {
    expect(
      SignInAgain.judge({
        requestedAt: null,
        authenticatedAt: new Date(NOW.getTime() - SECOND_IN_MS),
        now: NOW,
      }),
    ).toBeUndefined();
  });
});

describe("a SAML Sign In Again asks the identity provider to authenticate the person again", () => {
  test('its AuthnRequest says ForceAuthn="true", never IsPassive, under an ID that keeps when it was sent', () => {
    const requestId: string = signInAgainRequestId();
    const xml: string = authnRequestOf(
      requestUrl({ forceAuthn: true, requestId: requestId }),
    );

    expect(attributeOf(xml, "ForceAuthn")).toBe("true");
    expect(attributeOf(xml, "IsPassive")).toBe("false");
    expect(attributeOf(xml, "ID")).toBe(requestId);
    expect(attributeOf(xml, "AssertionConsumerServiceURL")).toBe(
      PROVIDER.replyUrl,
    );

    // A valid xs:ID, as SAML 2.0 Core 3.2.1 requires of a request's ID.
    expect(requestId).toMatch(XS_ID);
  });

  test("any other sign-in asks as it always did: ForceAuthn false, and an ID that is not Sign In Again's", () => {
    const xml: string = authnRequestOf(requestUrl({}));
    const requestId: string = attributeOf(xml, "ID")!;

    expect(attributeOf(xml, "ForceAuthn")).toBe("false");
    expect(attributeOf(xml, "IsPassive")).toBe("false");
    expect(requestId).toMatch(XS_ID);
    expect(
      SignInAgain.readSamlRequestId({
        inResponseTo: requestId,
        providerId: PROVIDER_ID,
        now: NOW,
      }),
    ).toBeNull();
  });

  test("each Sign In Again's ID is its own", () => {
    expect(signInAgainRequestId()).not.toBe(signInAgainRequestId());
  });
});

describe("what a SAML response proves", () => {
  test("its InResponseTo is read from the signed assertion, and gives back when Sign In Again sent the person", () => {
    const requestId: string = signInAgainRequestId();
    const response: VerifiedSamlResponse = verified(
      oktaResponse({
        inResponseTo: requestId,
        authnInstant: new Date(NOW.getTime() - 12 * SECOND_IN_MS),
      }),
    );

    expect(response.inResponseTo).toBe(requestId);
    expect(response.authnInstant).toEqual(
      new Date(NOW.getTime() - 12 * SECOND_IN_MS),
    );
    expect(
      SignInAgain.readSamlRequestId({
        inResponseTo: response.inResponseTo,
        providerId: PROVIDER_ID,
        now: NOW,
      }),
    ).toEqual(SENT_AT);
  });

  test("the provider asked again - AuthnInstant after the request - so the session is confirmed from then", () => {
    const authenticatedAt: Date = new Date(NOW.getTime() - 12 * SECOND_IN_MS);

    expect(
      samlOutcome(
        oktaResponse({
          inResponseTo: signInAgainRequestId(),
          authnInstant: authenticatedAt,
        }),
      ),
    ).toEqual({ reauthenticatedAt: authenticatedAt });
  });

  test("a provider whose clock runs a little behind still counts, inside the skew", () => {
    const authenticatedAt: Date = new Date(
      SENT_AT.getTime() - SKEW_IN_MS + SECOND_IN_MS,
    );

    expect(
      samlOutcome(
        oktaResponse({
          inResponseTo: signInAgainRequestId(),
          authnInstant: authenticatedAt,
        }),
      ),
    ).toEqual({ reauthenticatedAt: authenticatedAt });
  });

  test("Okta with Honor Force Authentication off signs the person in with its session from this morning: refused as a reused session", () => {
    expect(
      samlOutcome(
        oktaResponse({
          inResponseTo: signInAgainRequestId(),
          authnInstant: new Date(NOW.getTime() - 3 * HOUR_IN_MS),
        }),
      ),
    ).toEqual({ refusal: SignInAgainRefusal.ReusedSession });
  });

  test("a session from just before the skew is a reused one too", () => {
    expect(
      samlOutcome(
        oktaResponse({
          inResponseTo: signInAgainRequestId(),
          authnInstant: new Date(SENT_AT.getTime() - SKEW_IN_MS - SECOND_IN_MS),
        }),
      ),
    ).toEqual({ refusal: SignInAgainRefusal.ReusedSession });
  });

  test("an assertion with no AuthnStatement does not say when the person signed in: refused for that", () => {
    const response: VerifiedSamlResponse = verified(
      oktaResponse({
        inResponseTo: signInAgainRequestId(),
        rawAuthnStatement: "",
      }),
    );

    expect(response.authnInstant).toBeNull();
    expect(
      samlOutcome(
        oktaResponse({
          inResponseTo: signInAgainRequestId(),
          rawAuthnStatement: "",
        }),
      ),
    ).toEqual({ refusal: SignInAgainRefusal.NoSignInTime });
  });

  test("two AuthnStatements, or an AuthnInstant that is no time, say nothing either", () => {
    const statement: (instant: string) => string = (
      instant: string,
    ): string => {
      return `<saml:AuthnStatement AuthnInstant="${instant}"><saml:AuthnContext><saml:AuthnContextClassRef>urn:oasis:names:tc:SAML:2.0:ac:classes:PasswordProtectedTransport</saml:AuthnContextClassRef></saml:AuthnContext></saml:AuthnStatement>`;
    };

    for (const rawAuthnStatement of [
      statement("2026-11-20T09:59:50.000Z") +
        statement("2026-11-20T06:00:00.000Z"),
      statement("yesterday"),
    ]) {
      expect(
        samlOutcome(
          oktaResponse({
            inResponseTo: signInAgainRequestId(),
            rawAuthnStatement: rawAuthnStatement,
          }),
        ),
      ).toEqual({ refusal: SignInAgainRefusal.NoSignInTime });
    }
  });

  test("an AuthnInstant ahead of this server's clock by more than the skew is no time it signed in", () => {
    expect(
      samlOutcome(
        oktaResponse({
          inResponseTo: signInAgainRequestId(),
          authnInstant: new Date(NOW.getTime() + SKEW_IN_MS + MINUTE_IN_MS),
        }),
      ),
    ).toEqual({ refusal: SignInAgainRefusal.NoSignInTime });
  });

  test("a response the identity provider started, or one to any other sign-in, confirms nothing and says nothing", () => {
    const otherRequestId: string = attributeOf(
      authnRequestOf(requestUrl({})),
      "ID",
    )!;

    for (const inResponseTo of [null, otherRequestId, "_a1b2c3d4e5f6"]) {
      expect(
        samlOutcome(
          oktaResponse({
            inResponseTo: inResponseTo,
            authnInstant: new Date(NOW.getTime() - SECOND_IN_MS),
          }),
        ),
      ).toBeUndefined();
    }
  });

  test("a Sign In Again made for another provider is not one here", () => {
    expect(
      samlOutcome(
        oktaResponse({
          inResponseTo: signInAgainRequestId({
            providerId: OTHER_PROVIDER_ID,
          }),
          authnInstant: new Date(NOW.getTime() - SECOND_IN_MS),
        }),
      ),
    ).toBeUndefined();
  });

  test("an ID whose time, nonce or signature was changed is not this server's", () => {
    const requestId: string = signInAgainRequestId();
    const parts: RegExp = /^(.*_)([0-9a-z]+)_([0-9a-f]{16})_([0-9a-f]{32})$/;
    const [prefix, sentAt, nonce, signature] = parts
      .exec(requestId)!
      .slice(1) as [string, string, string, string];

    // Twenty seconds later: still inside the window, so only the signature tells.
    const later: string = (parseInt(sentAt, 36) + 20 * SECOND_IN_MS).toString(
      36,
    );
    const flipped: (hex: string) => string = (hex: string): string => {
      return (hex[0] === "0" ? "1" : "0") + hex.slice(1);
    };

    for (const changed of [
      `${prefix}${later}_${nonce}_${signature}`,
      `${prefix}${sentAt}_${flipped(nonce)}_${signature}`,
      `${prefix}${sentAt}_${nonce}_${flipped(signature)}`,
      `${prefix}${sentAt}_${nonce}_${signature.slice(0, 31)}`,
    ]) {
      expect(
        SignInAgain.readSamlRequestId({
          inResponseTo: changed,
          providerId: PROVIDER_ID,
          now: NOW,
        }),
      ).toBeNull();
    }
  });

  test("a request sent longer ago than the window, or ahead of now, is no longer one", () => {
    expect(
      SignInAgain.readSamlRequestId({
        inResponseTo: signInAgainRequestId({
          requestedAt: new Date(NOW.getTime() - WINDOW_IN_MS - SECOND_IN_MS),
        }),
        providerId: PROVIDER_ID,
        now: NOW,
      }),
    ).toBeNull();
    expect(
      SignInAgain.readSamlRequestId({
        inResponseTo: signInAgainRequestId({
          requestedAt: new Date(NOW.getTime() + SKEW_IN_MS + SECOND_IN_MS),
        }),
        providerId: PROVIDER_ID,
        now: NOW,
      }),
    ).toBeNull();
  });

  test("the provider's id is read in any case: a provider spelled in upper case is the same provider", () => {
    expect(
      SignInAgain.readSamlRequestId({
        inResponseTo: signInAgainRequestId(),
        providerId: new ObjectID(PROVIDER_ID.toString().toUpperCase()),
        now: NOW,
      }),
    ).toEqual(SENT_AT);
  });

  test("an InResponseTo changed after the identity provider signed is refused with the response", () => {
    const signed: string = oktaResponse({
      inResponseTo: signInAgainRequestId({
        requestedAt: new Date(NOW.getTime() - 3 * HOUR_IN_MS),
      }),
      authnInstant: new Date(NOW.getTime() - 3 * HOUR_IN_MS),
    });
    const fresher: string = signInAgainRequestId();
    const changed: string = signed.replace(
      /InResponseTo="[^"]*"/g,
      `InResponseTo="${fresher}"`,
    );

    expect(changed).not.toBe(signed);
    expect(() => {
      verified(changed);
    }).toThrow();
  });

  test("bearer confirmations that name different requests name none", () => {
    const response: VerifiedSamlResponse = verified(
      oktaResponse({
        inResponseTo: null,
        authnInstant: new Date(NOW.getTime() - SECOND_IN_MS),
        subjectInResponseTo: [signInAgainRequestId(), "_another_request"],
      }),
    );

    expect(response.inResponseTo).toBeNull();
  });
});

describe("an OpenID Connect Sign In Again asks the provider to authenticate the person again", () => {
  const CLIENT_ID: string = "0oa1b2c3d4E5F6G7h8i9";
  const REDIRECT_URI: string =
    "https://oneuptime.example.com/identity/oidc-callback/6570b1d3e2f4a5c6d7e8f901/6570b1d3e2f4a5c6d7e8f902";

  function offlineClient(): Client {
    const issuer: Issuer<Client> = new Issuer({
      issuer: "https://dev-12345678.okta.com/oauth2/default",
      authorization_endpoint:
        "https://dev-12345678.okta.com/oauth2/default/v1/authorize",
      token_endpoint: "https://dev-12345678.okta.com/oauth2/default/v1/token",
      jwks_uri: "https://dev-12345678.okta.com/oauth2/default/v1/keys",
    });

    return new issuer.Client({
      client_id: CLIENT_ID,
      client_secret: "a-client-secret",
      redirect_uris: [REDIRECT_URI],
      response_types: ["code"],
    });
  }

  function authorizationParams(isSignInAgain?: boolean): URLSearchParams {
    const url: URL = OIDCUtil.generateAuthorizationUrl({
      client: offlineClient(),
      scopes: "openid email profile",
      state: "state-abc",
      nonce: "nonce-xyz",
      codeChallenge: "challenge",
      ...(isSignInAgain === undefined ? {} : { isSignInAgain: isSignInAgain }),
    });

    return new URLSearchParams(url.toString().split("?")[1] || "");
  }

  test("prompt=login and max_age=0, beside everything a sign-in sends", () => {
    const params: URLSearchParams = authorizationParams(true);

    expect(params.get("prompt")).toBe("login");
    expect(params.get("max_age")).toBe("0");
    expect(params.get("state")).toBe("state-abc");
    expect(params.get("nonce")).toBe("nonce-xyz");
    expect(params.get("code_challenge_method")).toBe("S256");
  });

  test("any other sign-in sends neither", () => {
    for (const params of [authorizationParams(), authorizationParams(false)]) {
      expect(params.has("prompt")).toBe(false);
      expect(params.has("max_age")).toBe(false);
    }
  });

  test("a provider other than Google is not asked for auth_time with the claims parameter: max_age makes it send it", () => {
    expect(authorizationParams(true).has("claims")).toBe(false);
  });

  /*
   * Google as a project's or the server's OpenID Connect provider (Google
   * Workspace, #10332): it takes no prompt=login and documents no max_age,
   * and sends auth_time only when asked for it with the claims parameter,
   * once the OAuth client has Session age claims on - so Sign In Again asks
   * for it, as Continue with Google does, or it could never confirm anyone.
   */
  describe("through Google", () => {
    function googleClient(issuer: string): Client {
      const google: Issuer<Client> = new Issuer({
        issuer: issuer,
        authorization_endpoint: "https://accounts.google.com/o/oauth2/v2/auth",
        token_endpoint: "https://oauth2.googleapis.com/token",
        jwks_uri: "https://www.googleapis.com/oauth2/v3/certs",
      });

      return new google.Client({
        client_id: "1234567890-abc.apps.googleusercontent.com",
        client_secret: "a-client-secret",
        redirect_uris: [REDIRECT_URI],
        response_types: ["code"],
      });
    }

    function googleParams(
      issuer: string,
      isSignInAgain: boolean,
    ): URLSearchParams {
      const url: URL = OIDCUtil.generateAuthorizationUrl({
        client: googleClient(issuer),
        scopes: "openid email profile",
        state: "state-abc",
        nonce: "nonce-xyz",
        codeChallenge: "challenge",
        isSignInAgain: isSignInAgain,
      });

      return new URLSearchParams(url.toString().split("?")[1] || "");
    }

    test.each([
      ["https://accounts.google.com"],
      ["accounts.google.com"],
      ["https://ACCOUNTS.GOOGLE.COM"],
    ])(
      "Sign In Again asks Google (%s) for auth_time, as an essential claim of the ID token",
      (issuer: string) => {
        const params: URLSearchParams = googleParams(issuer, true);

        expect(JSON.parse(params.get("claims") || "null")).toEqual({
          id_token: { auth_time: { essential: true } },
        });
        // Still asked to ask again: a provider that honours it proves more.
        expect(params.get("prompt")).toBe("login");
        expect(params.get("max_age")).toBe("0");
      },
    );

    test("any other sign-in through Google asks for nothing more", () => {
      expect(
        googleParams("https://accounts.google.com", false).has("claims"),
      ).toBe(false);
    });

    test("a provider whose address only looks like Google's is not Google", () => {
      for (const issuer of [
        "https://accounts.google.com.evil.example",
        "https://evil.example/accounts.google.com",
        "https://notaccounts.google.com",
      ]) {
        expect({
          issuer,
          claims: googleParams(issuer, true).has("claims"),
        }).toEqual({
          issuer,
          claims: false,
        });
      }
    });
  });

  /*
   * Microsoft Entra ID as a project's or the server's OpenID Connect
   * provider (#10529): prompt=login alone. Microsoft documents prompt=login
   * and no max_age, and two reports on Microsoft Q&A found max_age=0
   * brought an ID token that had already expired; OneUptime judges
   * auth_time itself, so max_age adds nothing there. Fixed from
   * Microsoft's docs and those reports: no live tenant was asked.
   */
  describe("through Microsoft Entra ID", () => {
    const TENANT_ID: string = "72f988bf-86f1-41af-91ab-2d7cd011db47";

    function entraClient(
      issuer: string,
      authorizationEndpoint: string,
    ): Client {
      const entra: Issuer<Client> = new Issuer({
        issuer: issuer,
        authorization_endpoint: authorizationEndpoint,
        token_endpoint: authorizationEndpoint.replace(/authorize$/, "token"),
        jwks_uri:
          "https://login.microsoftonline.com/common/discovery/v2.0/keys",
      });

      return new entra.Client({
        client_id: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
        client_secret: "a-client-secret",
        redirect_uris: [REDIRECT_URI],
        response_types: ["code"],
      });
    }

    function entraParams(
      issuer: string,
      authorizationEndpoint: string,
      isSignInAgain?: boolean,
    ): URLSearchParams {
      const url: URL = OIDCUtil.generateAuthorizationUrl({
        client: entraClient(issuer, authorizationEndpoint),
        scopes: "openid email profile",
        state: "state-abc",
        nonce: "nonce-xyz",
        codeChallenge: "challenge",
        ...(isSignInAgain === undefined
          ? {}
          : { isSignInAgain: isSignInAgain }),
      });

      return new URLSearchParams(url.toString().split("?")[1] || "");
    }

    /*
     * Each cloud's issuer and authorization endpoint as its own discovery
     * documents name them, v2.0 and v1.0 (read from Microsoft on
     * 2026-11-22), with a tenant's id for {tenantid}.
     */
    const CLOUDS: Array<[string, string, string]> = [
      [
        "the global service's v2.0 endpoint",
        `https://login.microsoftonline.com/${TENANT_ID}/v2.0`,
        `https://login.microsoftonline.com/${TENANT_ID}/oauth2/v2.0/authorize`,
      ],
      [
        "the global service's multi-tenant endpoint",
        "https://login.microsoftonline.com/{tenantid}/v2.0",
        "https://login.microsoftonline.com/common/oauth2/v2.0/authorize",
      ],
      [
        "the global service's v1.0 endpoint",
        `https://sts.windows.net/${TENANT_ID}/`,
        `https://login.microsoftonline.com/${TENANT_ID}/oauth2/authorize`,
      ],
      [
        "Entra ID for US Government's v2.0 endpoint",
        `https://login.microsoftonline.us/${TENANT_ID}/v2.0`,
        `https://login.microsoftonline.us/${TENANT_ID}/oauth2/v2.0/authorize`,
      ],
      [
        "Entra ID for US Government's v1.0 endpoint",
        `https://sts.windows.net/${TENANT_ID}/`,
        `https://login.microsoftonline.us/${TENANT_ID}/oauth2/authorize`,
      ],
      [
        "Entra ID operated by 21Vianet's v2.0 endpoint",
        `https://login.partner.microsoftonline.cn/${TENANT_ID}/v2.0`,
        `https://login.partner.microsoftonline.cn/${TENANT_ID}/oauth2/v2.0/authorize`,
      ],
      [
        "Entra ID operated by 21Vianet's v1.0 endpoint",
        `https://sts.chinacloudapi.cn/${TENANT_ID}/`,
        `https://login.partner.microsoftonline.cn/${TENANT_ID}/oauth2/authorize`,
      ],
      [
        "Entra ID operated by 21Vianet's older host",
        `https://login.partner.microsoftonline.cn/${TENANT_ID}/v2.0`,
        `https://login.chinacloudapi.cn/${TENANT_ID}/oauth2/v2.0/authorize`,
      ],
    ];

    test.each(CLOUDS)(
      "Sign In Again sends %s prompt=login alone: no max_age",
      (_cloud: string, issuer: string, authorizationEndpoint: string) => {
        const params: URLSearchParams = entraParams(
          issuer,
          authorizationEndpoint,
          true,
        );

        expect(params.getAll("prompt")).toEqual(["login"]);
        expect(params.has("max_age")).toBe(false);
        // Nor Google's claims request: Entra ID adds auth_time as an optional claim.
        expect(params.has("claims")).toBe(false);
        expect(params.get("state")).toBe("state-abc");
        expect(params.get("nonce")).toBe("nonce-xyz");
        expect(params.get("code_challenge_method")).toBe("S256");
      },
    );

    test.each(CLOUDS)(
      "any other sign-in through %s asks as it always did",
      (_cloud: string, issuer: string, authorizationEndpoint: string) => {
        for (const params of [
          entraParams(issuer, authorizationEndpoint),
          entraParams(issuer, authorizationEndpoint, false),
        ]) {
          expect(params.has("prompt")).toBe(false);
          expect(params.has("max_age")).toBe(false);
        }
      },
    );

    test("every Microsoft identity platform host is Entra ID, as its issuer or as where the person is sent, in any case", () => {
      const notMicrosoft: string = "https://idp.example.com/oauth2/authorize";

      for (const hostname of MICROSOFT_IDENTITY_PLATFORM_HOSTNAMES) {
        for (const [issuer, authorizationEndpoint] of [
          [`https://${hostname}/${TENANT_ID}/v2.0`, notMicrosoft],
          [`https://${hostname.toUpperCase()}/${TENANT_ID}/`, notMicrosoft],
          [`${hostname}/${TENANT_ID}`, notMicrosoft],
          [
            "https://idp.example.com",
            `https://${hostname}/${TENANT_ID}/oauth2/v2.0/authorize`,
          ],
        ] as Array<[string, string]>) {
          expect({
            issuer,
            authorizationEndpoint,
            isEntraId: OIDCUtil.isMicrosoftEntraId(
              entraClient(issuer, authorizationEndpoint),
            ),
            maxAge: entraParams(issuer, authorizationEndpoint, true).get(
              "max_age",
            ),
          }).toEqual({
            issuer,
            authorizationEndpoint,
            isEntraId: true,
            maxAge: null,
          });
        }
      }
    });

    test("names every host of Microsoft's national clouds page and of its instance discovery, and nothing else", () => {
      expect([...MICROSOFT_IDENTITY_PLATFORM_HOSTNAMES].sort()).toEqual(
        [
          // "Microsoft Entra authentication & national clouds".
          "login.microsoftonline.com",
          "login.microsoftonline.us",
          "login.partner.microsoftonline.cn",
          // The aliases Microsoft's instance discovery gives each cloud.
          "login.windows.net",
          "login.microsoft.com",
          "sts.windows.net",
          "login.usgovcloudapi.net",
          "login-us.microsoftonline.com",
          "login.chinacloudapi.cn",
          "login.microsoftonline.de",
          // 21Vianet's v1.0 issuer.
          "sts.chinacloudapi.cn",
        ].sort(),
      );
    });

    test("a provider whose address only looks like Microsoft's is asked for max_age=0, as any other", () => {
      for (const [issuer, authorizationEndpoint] of [
        [
          "https://login.microsoftonline.com.evil.example/x/v2.0",
          "https://login.microsoftonline.com.evil.example/x/oauth2/v2.0/authorize",
        ],
        [
          "https://evil.example/login.microsoftonline.com/v2.0",
          "https://evil.example/authorize?host=login.microsoftonline.com",
        ],
        [
          "https://notlogin.microsoftonline.com/x/v2.0",
          "https://notlogin.microsoftonline.com/x/oauth2/v2.0/authorize",
        ],
        [
          "https://login.microsoftonline.community/x/v2.0",
          "https://login.microsoftonline.community/x/oauth2/v2.0/authorize",
        ],
        [
          "https://login-microsoftonline.com/x/v2.0",
          "https://login-microsoftonline.com/x/oauth2/v2.0/authorize",
        ],
        ["not a URL at all", "https://idp.example.com/authorize"],
      ] as Array<[string, string]>) {
        expect({
          issuer,
          maxAge: entraParams(issuer, authorizationEndpoint, true).get(
            "max_age",
          ),
          prompt: entraParams(issuer, authorizationEndpoint, true).get(
            "prompt",
          ),
        }).toEqual({ issuer, maxAge: "0", prompt: "login" });
      }
    });

    /*
     * Their hosts are a tenant's own (contoso.ciamlogin.com,
     * contoso.b2clogin.com) or a custom domain, and neither is reported to
     * answer max_age=0 so: they are asked as any other provider. A token
     * cut short anyway is still read inside the minute the two clocks are
     * allowed (ID_TOKEN_CLOCK_TOLERANCE_IN_SECONDS).
     */
    test("Entra External ID and Azure AD B2C, on a tenant's own host, keep max_age=0", () => {
      for (const [issuer, authorizationEndpoint] of [
        [
          `https://${TENANT_ID}.ciamlogin.com/${TENANT_ID}/v2.0`,
          "https://contoso.ciamlogin.com/contoso.onmicrosoft.com/oauth2/v2.0/authorize",
        ],
        [
          `https://contoso.b2clogin.com/${TENANT_ID}/v2.0/`,
          "https://contoso.b2clogin.com/contoso.onmicrosoft.com/b2c_1_signin/oauth2/v2.0/authorize",
        ],
      ] as Array<[string, string]>) {
        expect({
          issuer,
          maxAge: entraParams(issuer, authorizationEndpoint, true).get(
            "max_age",
          ),
        }).toEqual({ issuer, maxAge: "0" });
      }
    });

    test("Okta, Keycloak, Auth0 and Google are still asked for max_age=0", () => {
      for (const [issuer, authorizationEndpoint] of [
        [
          "https://dev-12345678.okta.com/oauth2/default",
          "https://dev-12345678.okta.com/oauth2/default/v1/authorize",
        ],
        [
          "https://keycloak.example.com/realms/acme",
          "https://keycloak.example.com/realms/acme/protocol/openid-connect/auth",
        ],
        ["https://acme.eu.auth0.com/", "https://acme.eu.auth0.com/authorize"],
        [
          "https://accounts.google.com",
          "https://accounts.google.com/o/oauth2/v2/auth",
        ],
      ] as Array<[string, string]>) {
        expect({
          issuer,
          maxAge: entraParams(issuer, authorizationEndpoint, true).get(
            "max_age",
          ),
          prompt: entraParams(issuer, authorizationEndpoint, true).get(
            "prompt",
          ),
        }).toEqual({ issuer, maxAge: "0", prompt: "login" });
      }
    });

    /*
     * The client the sign-in routes make (createClient), from a discovery
     * document that names Entra ID's issuer, as Entra ID's does: what the
     * project's and the server's OpenID Connect routes send.
     */
    test("a provider discovered as Entra ID is sent prompt=login alone", async () => {
      const idp: TestIdp = await startTestIdp({
        clientId: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
        issuerOverride: `https://login.microsoftonline.com/${TENANT_ID}/v2.0`,
      });

      try {
        const client: Client = await OIDCUtil.createClient({
          discoveryURL: URL.fromString(idp.issuerUrl),
          clientId: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
          clientSecret: "a-client-secret",
          redirectUri: URL.fromString(REDIRECT_URI),
          scopes: "openid email profile",
        });

        const params: URLSearchParams = new URLSearchParams(
          OIDCUtil.generateAuthorizationUrl({
            client: client,
            scopes: "openid email profile",
            state: "state-abc",
            nonce: "nonce-xyz",
            codeChallenge: "challenge",
            isSignInAgain: true,
          })
            .toString()
            .split("?")[1] || "",
        );

        expect(OIDCUtil.isMicrosoftEntraId(client)).toBe(true);
        expect(params.getAll("prompt")).toEqual(["login"]);
        expect(params.has("max_age")).toBe(false);
      } finally {
        await idp.close();
      }
    });
  });
});

describe("what an OpenID Connect ID token proves", () => {
  const CLIENT_ID: string = "0oa1b2c3d4E5F6G7h8i9";
  const REDIRECT_URI: string =
    "https://oneuptime.example.com/identity/oidc-callback/6570b1d3e2f4a5c6d7e8f901/6570b1d3e2f4a5c6d7e8f902";
  const NONCE: string = "n-0S6_WzA2Mj-nonce-value";

  let runningIdps: Array<TestIdp> = [];

  afterEach(async () => {
    const idps: Array<TestIdp> = runningIdps;
    runningIdps = [];

    for (const idp of idps) {
      await idp.close();
    }
  });

  /*
   * Signs the person in through a real provider on a loopback socket, whose
   * ID token carries `claims`, and judges it as the callback does: sent
   * there by Sign In Again thirty seconds ago. `withClient` sees the client
   * the routes make (createClient) before the callback uses it.
   */
  async function outcomeOf(
    claims: JSONObject,
    withClient?: (client: Client) => void,
  ): Promise<{
    outcome: SessionSignInAgain | undefined;
    result: OidcCallbackResult;
    now: Date;
  }> {
    const idp: TestIdp = await startTestIdp({
      clientId: CLIENT_ID,
      idTokenClaims: { nonce: NONCE, ...claims },
    });
    runningIdps.push(idp);

    const client: Client = await OIDCUtil.createClient({
      discoveryURL: URL.fromString(idp.issuerUrl),
      clientId: CLIENT_ID,
      clientSecret: "a-client-secret",
      redirectUri: URL.fromString(REDIRECT_URI),
      scopes: "openid email profile",
    });
    removeEgressGuardHook(client);
    removeEgressGuardHook(client.issuer);
    withClient?.(client);

    const state: string = OIDCUtil.generateState();
    const result: OidcCallbackResult = await OIDCUtil.exchangeCodeAndValidate({
      client: client,
      redirectUri: URL.fromString(REDIRECT_URI),
      expectedIssuer: idp.issuerUrl,
      expectedNonce: NONCE,
      expectedState: state,
      codeVerifier: OIDCUtil.generateCodeVerifier(),
      callbackParams: { code: "authorization-code-from-idp", state: state },
      emailClaimName: "email",
      nameClaimName: "name",
    });

    const now: Date = new Date();

    return {
      result: result,
      now: now,
      outcome: SignInAgain.judge({
        requestedAt: new Date(now.getTime() - 30 * SECOND_IN_MS),
        authenticatedAt: SignInAgain.readAuthTime(result.rawClaims),
        now: now,
      }),
    };
  }

  const secondsAgo: (seconds: number) => number = (seconds: number): number => {
    return Math.floor(Date.now() / 1000) - seconds;
  };

  test("Okta, asked again: auth_time after the request confirms the session from then", async () => {
    const authTime: number = secondsAgo(10);
    const { outcome } = await outcomeOf({
      ver: 1,
      amr: ["pwd", "mfa"],
      idp: "00o8fou7sRaGGwdn4696",
      auth_time: authTime,
      email: "isaac.brock@example.com",
      name: "Isaac Brock",
    });

    expect(outcome).toEqual({ reauthenticatedAt: new Date(authTime * 1000) });
  });

  test("a provider that ignored prompt=login and max_age, and used its session from an hour ago: refused as a reused session", async () => {
    const { outcome } = await outcomeOf({
      auth_time: secondsAgo(60 * 60),
      email: "isaac.brock@example.com",
      name: "Isaac Brock",
    });

    expect(outcome).toEqual({ refusal: SignInAgainRefusal.ReusedSession });
  });

  test("Microsoft Entra ID without the auth_time optional claim does not say when: refused for that, never taken as fresh", async () => {
    const { outcome, result } = await outcomeOf({
      oid: "00000000-0000-0000-66f3-3332eca7ea81",
      preferred_username: "abe.lincoln@contoso.onmicrosoft.com",
      tid: "9188040d-6c67-4c5b-b112-36a304b66dad",
      ver: "2.0",
      name: "Abe Lincoln",
      email: "abe.lincoln@contoso.com",
    });

    // Signed in all the same: the provider vouched for them.
    expect(result.email.toString()).toBe("abe.lincoln@contoso.com");
    expect(outcome).toEqual({ refusal: SignInAgainRefusal.NoSignInTime });
  });

  test("Microsoft Entra ID with the claim added, after the person signed in again", async () => {
    const authTime: number = secondsAgo(4);
    const { outcome } = await outcomeOf({
      oid: "00000000-0000-0000-66f3-3332eca7ea81",
      tid: "9188040d-6c67-4c5b-b112-36a304b66dad",
      ver: "2.0",
      auth_time: authTime,
      name: "Abe Lincoln",
      email: "abe.lincoln@contoso.com",
    });

    expect(outcome).toEqual({ reauthenticatedAt: new Date(authTime * 1000) });
  });

  /*
   * THE ID TOKEN max_age=0 WAS REPORTED TO BRING (#10529). Microsoft Q&A
   * quotes one: iat and nbf 297 seconds before auth_time, exp 3 seconds
   * after it, received a second after exp. Sign In Again sends Entra ID
   * no max_age now, so it should not send one; one that comes anyway - from
   * Entra ID, or a provider that cuts a token short the same way - is read
   * with the minute either way the two clocks are allowed, as Sign in with
   * Microsoft reads its own, and judged by its auth_time, never its iat.
   */
  describe("an ID token shaped like the one max_age=0 was reported to bring", () => {
    const ENTRA_CLAIMS: JSONObject = {
      oid: "00000000-0000-0000-66f3-3332eca7ea81",
      tid: "9188040d-6c67-4c5b-b112-36a304b66dad",
      ver: "2.0",
      name: "Abe Lincoln",
      email: "abe.lincoln@contoso.com",
    };

    // The report's shape, its auth_time `secondsBefore` the callback reads it.
    const reportedShape: (authTime: number) => JSONObject = (
      authTime: number,
    ): JSONObject => {
      return {
        ...ENTRA_CLAIMS,
        iat: authTime - 297,
        nbf: authTime - 297,
        exp: authTime + 3,
        auth_time: authTime,
      };
    };

    test("read a second after its exp, as the report read it, still signs the person in, and confirms them from auth_time", async () => {
      const authTime: number = secondsAgo(4);
      const { outcome, result } = await outcomeOf(reportedShape(authTime));

      expect(result.email.toString()).toBe("abe.lincoln@contoso.com");
      expect(result.rawClaims["exp"]).toBe(authTime + 3);
      expect(outcome).toEqual({ reauthenticatedAt: new Date(authTime * 1000) });
    });

    test("openid-client's own tolerance, no second, failed the whole sign-in with that token", async () => {
      await expect(
        outcomeOf(reportedShape(secondsAgo(4)), (client: Client) => {
          client[custom.clock_tolerance] = 0;
        }),
      ).rejects.toThrow(/JWT expired/);
    });

    test("the client the sign-in routes make allows the two clocks a minute, as Sign In Again allows them", async () => {
      let tolerance: number | null = null;

      await outcomeOf(reportedShape(secondsAgo(4)), (client: Client) => {
        tolerance = client[custom.clock_tolerance];
      });

      expect(tolerance).toBe(ID_TOKEN_CLOCK_TOLERANCE_IN_SECONDS);
      expect(ID_TOKEN_CLOCK_TOLERANCE_IN_SECONDS).toBe(
        SIGN_IN_AGAIN_CLOCK_SKEW_IN_SECONDS,
      );
    });

    test("read more than a minute after its exp, it is refused: an ID token that old is not this sign-in's", async () => {
      await expect(outcomeOf(reportedShape(secondsAgo(64)))).rejects.toThrow(
        /JWT expired/,
      );
    });

    test("a provider clock half a minute ahead still signs the person in, and confirms them from now, never from a time to come", async () => {
      const ahead: number = secondsAgo(-30);
      const { outcome, now } = await outcomeOf({
        ...ENTRA_CLAIMS,
        iat: ahead,
        nbf: ahead,
        exp: ahead + 3600,
        auth_time: ahead,
      });

      expect(outcome).toEqual({ reauthenticatedAt: now });
    });

    test("one not valid for another minute and a half is refused", async () => {
      const ahead: number = secondsAgo(-90);

      await expect(
        outcomeOf({
          ...ENTRA_CLAIMS,
          iat: ahead,
          nbf: ahead,
          exp: ahead + 3600,
          auth_time: ahead,
        }),
      ).rejects.toThrow(/JWT not active yet/);
    });

    /*
     * prompt=login alone holds Entra ID to nothing OneUptime trusts: an
     * auth_time from before Sign In Again sent the person is still a
     * session it reused, however freshly the token was issued.
     */
    test("Entra ID, sent prompt=login alone, answering with its session from ten minutes before: refused as a reused session", async () => {
      const { outcome, result } = await outcomeOf({
        ...ENTRA_CLAIMS,
        iat: secondsAgo(300),
        nbf: secondsAgo(300),
        exp: secondsAgo(-3600),
        auth_time: secondsAgo(600),
      });

      // Signed in all the same: Entra ID vouched for them.
      expect(result.email.toString()).toBe("abe.lincoln@contoso.com");
      expect(outcome).toEqual({ refusal: SignInAgainRefusal.ReusedSession });
    });

    test("nor does its iat stand in for an auth_time it leaves out", async () => {
      const { outcome } = await outcomeOf({
        ...ENTRA_CLAIMS,
        iat: secondsAgo(2),
        nbf: secondsAgo(2),
        exp: secondsAgo(-3600),
      });

      expect(outcome).toEqual({ refusal: SignInAgainRefusal.NoSignInTime });
    });
  });

  test("an auth_time of no second since the epoch is no time", async () => {
    const { outcome } = await outcomeOf({
      auth_time: 0,
      email: "isaac.brock@example.com",
      name: "Isaac Brock",
    });

    expect(outcome).toEqual({ refusal: SignInAgainRefusal.NoSignInTime });
  });

  test("auth_time is read only as a number of seconds", () => {
    expect(SignInAgain.readAuthTime({ auth_time: 1795168800 })).toEqual(
      new Date(1795168800 * 1000),
    );

    for (const claims of [
      {},
      { auth_time: "1795168800" },
      { auth_time: -5 },
      { auth_time: null },
      { auth_time: Number.POSITIVE_INFINITY },
      { auth_time: Number.NaN },
      null,
      undefined,
    ] as Array<JSONObject | null | undefined>) {
      expect(SignInAgain.readAuthTime(claims)).toBeNull();
    }
  });
});

describe("the sign-in's state cookie keeps when Sign In Again sent the person", () => {
  test("read back as it was written, for the window", () => {
    expect(
      SignInAgain.readStateRequestedAt(
        { [SIGN_IN_AGAIN_STATE_FIELD]: SENT_AT.getTime() },
        NOW,
      ),
    ).toEqual(SENT_AT);
  });

  test("nothing for any other sign-in, and nothing once the window is over or for a time ahead of now", () => {
    for (const stored of [
      {},
      { [SIGN_IN_AGAIN_STATE_FIELD]: null },
      { [SIGN_IN_AGAIN_STATE_FIELD]: String(SENT_AT.getTime()) },
      { [SIGN_IN_AGAIN_STATE_FIELD]: NOW.getTime() - WINDOW_IN_MS - 1 },
      { [SIGN_IN_AGAIN_STATE_FIELD]: NOW.getTime() + SKEW_IN_MS + 1 },
    ] as Array<JSONObject>) {
      expect(SignInAgain.readStateRequestedAt(stored, NOW)).toBeNull();
    }
  });

  test("every sign-in that signs one writes the field it is read from", () => {
    const identity: string = path.resolve(
      __dirname,
      "../../../FeatureSet/Identity",
    );

    expect(SIGN_IN_AGAIN_STATE_FIELD).toBe("signInAgainRequestedAt");

    for (const file of [
      "API/OIDC.ts",
      "API/GlobalOIDC.ts",
      // Google's and Microsoft's sign-ins.
      "Utils/ProviderSignIn.ts",
    ]) {
      expect({
        file: file,
        writes: fs
          .readFileSync(path.join(identity, file), "utf8")
          .includes(`${SIGN_IN_AGAIN_STATE_FIELD}: isSignInAgain`),
      }).toEqual({ file: file, writes: true });
    }
  });
});

describe("what whoever runs the server is told", () => {
  test("a Sign In Again that confirmed nothing is logged with why, naming the provider, never the person", () => {
    const warn: jest.SpiedFunction<typeof logger.warn> = jest
      .spyOn(logger, "warn")
      .mockImplementation(() => {
        return undefined as never;
      });

    SignInAgain.logOutcome({
      outcome: { refusal: SignInAgainRefusal.ReusedSession },
      providerKind: "project SSO",
      providerId: PROVIDER_ID,
    });
    SignInAgain.logOutcome({
      outcome: { refusal: SignInAgainRefusal.NoSignInTime },
      providerKind: "project OpenID Connect provider",
      providerId: OTHER_PROVIDER_ID,
    });
    SignInAgain.logOutcome({
      outcome: { reauthenticatedAt: NOW },
      providerKind: "project SSO",
      providerId: PROVIDER_ID,
    });
    SignInAgain.logOutcome({
      outcome: undefined,
      providerKind: "project SSO",
      providerId: PROVIDER_ID,
    });

    expect(warn).toHaveBeenCalledTimes(2);

    const [reused, unsaid] = warn.mock.calls.map(
      (call: Array<unknown>): string => {
        return String(call[0]);
      },
    ) as [string, string];

    expect(reused).toContain(PROVIDER_ID.toString());
    expect(reused).toContain("ForceAuthn");
    expect(unsaid).toContain(OTHER_PROVIDER_ID.toString());
    expect(unsaid).toContain("auth_time");
    expect(`${reused} ${unsaid}`).not.toContain(EMAIL);

    warn.mockRestore();
  });
});
