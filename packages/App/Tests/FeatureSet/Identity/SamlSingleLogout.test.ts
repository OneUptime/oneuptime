import { beforeAll, describe, expect, test } from "@jest/globals";
import SamlSingleLogout, {
  LOGOUT_CLOCK_SKEW_IN_MS,
  LOGOUT_REQUEST_LIFETIME_IN_MS,
  MAX_RELAY_STATE_LENGTH,
  MAX_SAML_ID_LENGTH,
  MAX_SAML_MESSAGE_BYTES,
  ReadLogoutRequest,
  ReadLogoutResponse,
  ReceivedSamlLogoutMessage,
  SAML_LOGOUT_REASON_USER,
  SAML_SIGNATURE_ALGORITHM_RSA_SHA256,
  SAML_STATUS_SUCCESS,
  SamlBinding,
  SamlLogoutMessageKind,
  SamlLogoutRefusal,
  SamlSignOutProvider,
  SamlSigningKey,
} from "../../../FeatureSet/Identity/Utils/SamlSingleLogout";
import {
  SamlKeyPair,
  generateRsaKeyPair,
  signXml,
  toBase64,
} from "./SamlTestKit";
import SelfSignedCertificate, {
  SelfSignedKeyPair,
} from "Common/Server/Utils/SelfSignedCertificate";
import { ExpressRequest } from "Common/Server/Utils/Express";
import { SamlIdentityProviderSignOutRecord } from "Common/Types/SSO/IdentityProviderSignOut";
import SsoProviderType from "Common/Types/SSO/SsoProviderType";
import { DOMParser, Element as XmlElement } from "@xmldom/xmldom";
import crypto from "crypto";
import zlib from "zlib";

/*
 * ---------------------------------------------------------------------------
 * SAML SINGLE LOGOUT, MESSAGE BY MESSAGE (#9603).
 *
 * What OneUptime sends an identity provider - a LogoutRequest naming the
 * person and their session, and its answer to the provider's own - built on
 * the HTTP-Redirect binding and signed with the installation's key; and
 * what it takes from one - a LogoutResponse, or a LogoutRequest of its own -
 * on either binding, checked against the provider's certificate and read
 * only from what the signature covers.
 *
 * Every key is made at run time: OneUptime's with SelfSignedCertificate, as
 * the server makes it; the identity provider's as a bare RSA key (whose
 * public key stands in for its certificate, as in every SAML suite here)
 * and as a certificate.
 * ---------------------------------------------------------------------------
 */

const NOW: Date = new Date("2026-11-19T12:00:00.000Z");

const PROJECT_ID: string = "6a6a0000-0000-4000-8000-0000000000a1";
const PROVIDER_ID: string = "6a6a0000-0000-4000-8000-0000000000b2";
const OTHER_PROVIDER_ID: string = "6a6a0000-0000-4000-8000-0000000000c3";

const IDP_ISSUER: string = "http://www.okta.com/exk1fcia6d6EMsf331d8";
const IDP_SIGN_OUT_URL: string =
  "https://acme.okta.com/app/acme_oneuptime_1/exk1fcia6d6EMsf331d8/slo/saml";
const SINGLE_LOGOUT_URL: string = `https://oneuptime.example.com/identity/idp-logout/${PROJECT_ID}/${PROVIDER_ID}`;
const ENTITY_ID: string = `https://oneuptime.example.com/${PROJECT_ID}/${PROVIDER_ID}`;

const RSA_SHA1: string = "http://www.w3.org/2000/09/xmldsig#rsa-sha1";
const RSA_SHA512: string = "http://www.w3.org/2001/04/xmldsig-more#rsa-sha512";

let oneUptimeKey: SelfSignedKeyPair;
let otherInstallationKey: SelfSignedKeyPair;
let idpKeys: SamlKeyPair;
let idpCertificateKey: SelfSignedKeyPair;
let strangerKeys: SamlKeyPair;

beforeAll(async () => {
  oneUptimeKey = await SelfSignedCertificate.create({
    commonName: "OneUptime SAML Service Provider",
    validForDays: 365,
  });
  otherInstallationKey = await SelfSignedCertificate.create({
    commonName: "Another OneUptime",
    validForDays: 365,
  });
  idpCertificateKey = await SelfSignedCertificate.create({
    commonName: "Okta",
    validForDays: 365,
  });
  idpKeys = generateRsaKeyPair();
  strangerKeys = generateRsaKeyPair();
});

function signingKey(): SamlSigningKey {
  return oneUptimeKey;
}

function provider(
  overrides: Partial<SamlSignOutProvider> = {},
): SamlSignOutProvider {
  return {
    providerType: SsoProviderType.ProjectSSO,
    providerId: PROVIDER_ID,
    entityId: ENTITY_ID,
    singleLogoutUrl: SINGLE_LOGOUT_URL,
    identityProviderSignOutUrl: IDP_SIGN_OUT_URL,
    issuerUrl: IDP_ISSUER,
    certificate: idpKeys.publicKey,
    ...overrides,
  };
}

function record(
  overrides: Partial<SamlIdentityProviderSignOutRecord> = {},
): SamlIdentityProviderSignOutRecord {
  return {
    providerType: SsoProviderType.ProjectSSO,
    providerId: PROVIDER_ID,
    nameId: "dana.scully@example.com",
    nameIdFormat: "urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress",
    sessionIndex: "_0c3b5d0f-1d2e-4f5a-9b8c-7d6e5f4a3b2c",
    ...overrides,
  };
}

// The parameters of a query, each value decoded.
function queryOf(url: string): URLSearchParams {
  return new globalThis.URL(url).searchParams;
}

// The raw query of an address, as a server receives it.
function rawQueryOf(url: string): string {
  return url.substring(url.indexOf("?") + 1);
}

function inflate(base64: string): string {
  return zlib.inflateRawSync(Buffer.from(base64, "base64")).toString("utf8");
}

function parseXml(xml: string): XmlElement {
  return new DOMParser().parseFromString(xml, "text/xml")
    .documentElement as unknown as XmlElement;
}

function child(element: XmlElement, localName: string): XmlElement | null {
  for (
    let node: unknown = element.firstChild;
    node;
    node = (node as { nextSibling: unknown }).nextSibling
  ) {
    const candidate: XmlElement = node as XmlElement;

    if (candidate.nodeType === 1 && candidate.localName === localName) {
      return candidate;
    }
  }

  return null;
}

/*
 * Whether `url`'s query is signed as SAML 2.0 Bindings 3.4.4.1 has it, by
 * the key of `certificate`: over the message, the RelayState when there is
 * one, and the SigAlg, exactly as the query has them.
 */
function isSignedBy(
  url: string,
  parameter: string,
  certificate: string,
): boolean {
  const parts: Array<string> = rawQueryOf(url).split("&");
  const raw: (name: string) => string | undefined = (
    name: string,
  ): string | undefined => {
    return parts
      .find((part: string): boolean => {
        return part.startsWith(`${name}=`);
      })
      ?.substring(name.length + 1);
  };

  const relayState: string | undefined = raw("RelayState");

  const octets: string = [
    `${parameter}=${raw(parameter)}`,
    ...(relayState !== undefined ? [`RelayState=${relayState}`] : []),
    `SigAlg=${raw("SigAlg")}`,
  ].join("&");

  return crypto.verify(
    "sha256",
    Buffer.from(octets, "utf8"),
    crypto.createPublicKey(certificate),
    Buffer.from(decodeURIComponent(raw("Signature")!), "base64"),
  );
}

/*
 * ---------------------------------------------------------------------------
 * What an identity provider sends.
 * ---------------------------------------------------------------------------
 */

function logoutResponseXml(
  overrides: {
    id?: string;
    inResponseTo?: string | null;
    destination?: string | null;
    issuer?: string | null;
    statusCode?: string;
    issuerElement?: string;
  } = {},
): string {
  const attribute: (
    name: string,
    value: string | null | undefined,
  ) => string = (name: string, value: string | null | undefined): string => {
    return value === null || value === undefined ? "" : ` ${name}="${value}"`;
  };

  const issuer: string | null =
    overrides.issuer === undefined ? IDP_ISSUER : overrides.issuer;

  return `<samlp:LogoutResponse xmlns:samlp="urn:oasis:names:tc:SAML:2.0:protocol" xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion" ID="${
    overrides.id || "_idp_response_1"
  }" Version="2.0" IssueInstant="${NOW.toISOString()}"${attribute(
    "Destination",
    overrides.destination === undefined
      ? SINGLE_LOGOUT_URL
      : overrides.destination,
  )}${attribute(
    "InResponseTo",
    overrides.inResponseTo === undefined
      ? ownRequestId()
      : overrides.inResponseTo,
  )}>${
    overrides.issuerElement ??
    (issuer === null ? "" : `<saml:Issuer>${issuer}</saml:Issuer>`)
  }<samlp:Status><samlp:StatusCode Value="${
    overrides.statusCode || SAML_STATUS_SUCCESS
  }"/></samlp:Status></samlp:LogoutResponse>`;
}

function logoutRequestXml(
  overrides: {
    id?: string;
    issueInstant?: Date | null;
    notOnOrAfter?: Date | null;
    destination?: string | null;
    issuer?: string | null;
    nameIdElement?: string;
    sessionIndexes?: Array<string>;
  } = {},
): string {
  const attribute: (
    name: string,
    value: string | null | undefined,
  ) => string = (name: string, value: string | null | undefined): string => {
    return value === null || value === undefined ? "" : ` ${name}="${value}"`;
  };

  const issueInstant: Date | null =
    overrides.issueInstant === undefined ? NOW : overrides.issueInstant;
  const issuer: string | null =
    overrides.issuer === undefined ? IDP_ISSUER : overrides.issuer;

  return `<samlp:LogoutRequest xmlns:samlp="urn:oasis:names:tc:SAML:2.0:protocol" xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion" ID="${
    overrides.id || "_idp_request_1"
  }" Version="2.0"${attribute(
    "IssueInstant",
    issueInstant ? issueInstant.toISOString() : null,
  )}${attribute(
    "NotOnOrAfter",
    overrides.notOnOrAfter ? overrides.notOnOrAfter.toISOString() : null,
  )}${attribute(
    "Destination",
    overrides.destination === undefined
      ? SINGLE_LOGOUT_URL
      : overrides.destination,
  )}>${issuer === null ? "" : `<saml:Issuer>${issuer}</saml:Issuer>`}${
    overrides.nameIdElement ??
    '<saml:NameID Format="urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress">dana.scully@example.com</saml:NameID>'
  }${(overrides.sessionIndexes || ["_0c3b5d0f-1d2e-4f5a-9b8c-7d6e5f4a3b2c"])
    .map((sessionIndex: string): string => {
      return `<samlp:SessionIndex>${sessionIndex}</samlp:SessionIndex>`;
    })
    .join("")}</samlp:LogoutRequest>`;
}

function ownRequestId(at: Date = NOW): string {
  return SamlSingleLogout.createRequestId({
    provider: provider(),
    signingKey: signingKey(),
    now: at,
  });
}

/*
 * The query an identity provider sends a message in on the HTTP-Redirect
 * binding, signed with `privateKey` unless it is null.
 */
function redirectQuery(data: {
  parameter: "SAMLRequest" | "SAMLResponse";
  xml: string;
  relayState?: string | undefined;
  privateKey: string | null;
  sigAlg?: string | undefined;
  hash?: string | undefined;
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

  query += `&SigAlg=${encodeURIComponent(
    data.sigAlg || SAML_SIGNATURE_ALGORITHM_RSA_SHA256,
  )}`;

  const signature: string = crypto
    .sign(data.hash || "sha256", Buffer.from(query, "utf8"), data.privateKey)
    .toString("base64");

  return `${query}&Signature=${encodeURIComponent(signature)}`;
}

function getRequest(rawQuery: string): ExpressRequest {
  return {
    method: "GET",
    originalUrl: `/identity/idp-logout/${PROJECT_ID}/${PROVIDER_ID}?${rawQuery}`,
    body: {},
    query: {},
  } as unknown as ExpressRequest;
}

function postRequest(body: Record<string, unknown>): ExpressRequest {
  return {
    method: "POST",
    originalUrl: `/identity/idp-logout/${PROJECT_ID}/${PROVIDER_ID}`,
    body: body,
    query: {},
  } as unknown as ExpressRequest;
}

// A message signed the way identity providers sign on the HTTP-POST binding.
function signEnveloped(
  xml: string,
  rootLocalName: string,
  privateKey: string,
): string {
  return signXml(xml, {
    referenceXPath: `//*[local-name(.)='${rootLocalName}']`,
    privateKey: privateKey,
    location: {
      reference: `/*/*[local-name(.)='Issuer']`,
      action: "after",
    },
  });
}

function expectRefused(action: () => unknown, words?: RegExp): void {
  let thrown: unknown = null;

  try {
    action();
  } catch (err) {
    thrown = err;
  }

  expect(thrown).toBeInstanceOf(SamlLogoutRefusal);

  if (words) {
    expect((thrown as Error).message).toMatch(words);
  }
}

function readResponse(
  req: ExpressRequest,
  certificate: string = idpKeys.publicKey,
): ReadLogoutResponse {
  return SamlSingleLogout.readLogoutResponse({
    message: SamlSingleLogout.readMessage(req),
    certificate: certificate,
  });
}

function readRequest(
  req: ExpressRequest,
  certificate: string = idpKeys.publicKey,
): ReadLogoutRequest {
  return SamlSingleLogout.readLogoutRequest({
    message: SamlSingleLogout.readMessage(req),
    certificate: certificate,
  });
}

describe("the LogoutRequest OneUptime sends the browser with", () => {
  function build(
    overrides: {
      record?: SamlIdentityProviderSignOutRecord;
      provider?: SamlSignOutProvider;
    } = {},
  ): string {
    return SamlSingleLogout.buildLogoutRequestUrl({
      provider: overrides.provider || provider(),
      record: overrides.record || record(),
      signingKey: signingKey(),
      now: NOW,
    });
  }

  function requestOf(url: string): XmlElement {
    return parseXml(inflate(queryOf(url).get("SAMLRequest")!));
  }

  test("goes to the identity provider's Sign Out URL", () => {
    const url: globalThis.URL = new globalThis.URL(build());

    expect(`${url.origin}${url.pathname}`).toBe(IDP_SIGN_OUT_URL);
  });

  test("names the person by the Name ID the assertion had, with its Format and qualifiers, and their session", () => {
    const request: XmlElement = requestOf(
      build({
        record: record({
          nameIdNameQualifier: "https://acme.example.com/idp",
          nameIdSpNameQualifier: ENTITY_ID,
        }),
      }),
    );

    const nameId: XmlElement = child(request, "NameID")!;

    expect(nameId.textContent).toBe("dana.scully@example.com");
    expect(nameId.namespaceURI).toBe("urn:oasis:names:tc:SAML:2.0:assertion");
    expect(nameId.getAttribute("Format")).toBe(
      "urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress",
    );
    expect(nameId.getAttribute("NameQualifier")).toBe(
      "https://acme.example.com/idp",
    );
    expect(nameId.getAttribute("SPNameQualifier")).toBe(ENTITY_ID);

    const sessionIndex: XmlElement = child(request, "SessionIndex")!;

    expect(sessionIndex.textContent).toBe(
      "_0c3b5d0f-1d2e-4f5a-9b8c-7d6e5f4a3b2c",
    );
    expect(sessionIndex.namespaceURI).toBe(
      "urn:oasis:names:tc:SAML:2.0:protocol",
    );
  });

  test("is a LogoutRequest from OneUptime's Entity ID, to the Sign Out URL, for ten minutes, because the person signed out", () => {
    const request: XmlElement = requestOf(build());

    expect(request.localName).toBe("LogoutRequest");
    expect(request.namespaceURI).toBe("urn:oasis:names:tc:SAML:2.0:protocol");
    expect(request.getAttribute("Version")).toBe("2.0");
    expect(request.getAttribute("IssueInstant")).toBe(NOW.toISOString());
    expect(request.getAttribute("Destination")).toBe(IDP_SIGN_OUT_URL);
    expect(request.getAttribute("NotOnOrAfter")).toBe(
      new Date(NOW.getTime() + LOGOUT_REQUEST_LIFETIME_IN_MS).toISOString(),
    );
    expect(request.getAttribute("Reason")).toBe(SAML_LOGOUT_REASON_USER);
    expect(child(request, "Issuer")!.textContent).toBe(ENTITY_ID);
  });

  test("its ID is one of OneUptime's own, for this provider, which an xs:ID may be", () => {
    const id: string = requestOf(build()).getAttribute("ID")!;

    expect(id).toMatch(/^_[0-9a-f]{68}$/);
    expect(
      SamlSingleLogout.isOwnRequestId({
        requestId: id,
        provider: provider(),
        signingKey: signingKey(),
        now: NOW,
      }),
    ).toBe(true);
  });

  test("leaves out what the assertion did not have", () => {
    const request: XmlElement = requestOf(
      build({
        record: {
          providerType: SsoProviderType.ProjectSSO,
          providerId: PROVIDER_ID,
          nameId: "dana.scully@example.com",
        },
      }),
    );

    const nameId: XmlElement = child(request, "NameID")!;

    expect(nameId.hasAttribute("Format")).toBe(false);
    expect(nameId.hasAttribute("NameQualifier")).toBe(false);
    expect(nameId.hasAttribute("SPNameQualifier")).toBe(false);
    expect(child(request, "SessionIndex")).toBeNull();
  });

  test("escapes what it carries: no value can add markup to the request", () => {
    const hostile: string = `a&b<c>"d'@example.com</saml:NameID><saml:NameID>admin@example.com`;

    const request: XmlElement = requestOf(
      build({
        record: record({
          nameId: hostile,
          sessionIndex: `"/><samlp:SessionIndex>other`,
          nameIdNameQualifier: `x" Injected="1`,
        }),
      }),
    );

    expect(child(request, "NameID")!.textContent).toBe(hostile);
    expect(child(request, "NameID")!.getAttribute("NameQualifier")).toBe(
      `x" Injected="1`,
    );
    expect(child(request, "NameID")!.hasAttribute("Injected")).toBe(false);
    expect(child(request, "SessionIndex")!.textContent).toBe(
      `"/><samlp:SessionIndex>other`,
    );

    // One NameID and one SessionIndex, whatever the values said.
    expect(
      request.getElementsByTagNameNS(
        "urn:oasis:names:tc:SAML:2.0:assertion",
        "NameID",
      ).length,
    ).toBe(1);
    expect(
      request.getElementsByTagNameNS(
        "urn:oasis:names:tc:SAML:2.0:protocol",
        "SessionIndex",
      ).length,
    ).toBe(1);
  });

  test("is signed with RSA-SHA256 in the query, by the key whose certificate OneUptime hands out", () => {
    const url: string = build();

    expect(queryOf(url).get("SigAlg")).toBe(
      SAML_SIGNATURE_ALGORITHM_RSA_SHA256,
    );
    expect(isSignedBy(url, "SAMLRequest", oneUptimeKey.certificate)).toBe(true);
    expect(
      isSignedBy(url, "SAMLRequest", otherInstallationKey.certificate),
    ).toBe(false);
  });

  test("puts SAMLRequest, SigAlg and Signature in the order the binding signs them, with no RelayState", () => {
    const names: Array<string> = rawQueryOf(build())
      .split("&")
      .map((part: string): string => {
        return part.split("=")[0]!;
      });

    expect(names).toEqual(["SAMLRequest", "SigAlg", "Signature"]);
  });

  test("a request changed on the way no longer verifies", () => {
    const url: string = build();
    const tampered: string = url.replace(
      /SAMLRequest=[^&]+/,
      `SAMLRequest=${encodeURIComponent(
        zlib
          .deflateRawSync(
            Buffer.from(
              inflate(queryOf(url).get("SAMLRequest")!).replace(
                "dana.scully",
                "walter.skinner",
              ),
            ),
          )
          .toString("base64"),
      )}`,
    );

    expect(isSignedBy(tampered, "SAMLRequest", oneUptimeKey.certificate)).toBe(
      false,
    );
  });

  test("keeps a query the Sign Out URL has, and drops parameters of the binding's names from it", () => {
    const url: string = build({
      provider: provider({
        identityProviderSignOutUrl: `${IDP_SIGN_OUT_URL}?tenant=acme&SAMLRequest=planted&Signature=planted`,
      }),
    });

    const query: URLSearchParams = queryOf(url);

    expect(query.get("tenant")).toBe("acme");
    expect(query.getAll("SAMLRequest")).toHaveLength(1);
    expect(query.get("SAMLRequest")).not.toBe("planted");
    expect(query.getAll("Signature")).toHaveLength(1);
    expect(isSignedBy(url, "SAMLRequest", oneUptimeKey.certificate)).toBe(true);
  });

  test("an identity provider reading it with the same rules finds it signed by OneUptime's certificate", () => {
    const url: string = build();

    const message: ReceivedSamlLogoutMessage =
      SamlSingleLogout.readRedirectMessage(rawQueryOf(url));

    expect(message.kind).toBe(SamlLogoutMessageKind.Request);

    const read: ReadLogoutRequest = SamlSingleLogout.readLogoutRequest({
      message: message,
      certificate: oneUptimeKey.certificate,
    });

    expect(read.isSigned).toBe(true);
    expect(read.nameId).toBe("dana.scully@example.com");
    expect(read.sessionIndexes).toEqual([
      "_0c3b5d0f-1d2e-4f5a-9b8c-7d6e5f4a3b2c",
    ]);
    expect(read.issuer).toBe(ENTITY_ID);
  });

  test.each([
    ["a javascript: address", "javascript:alert(document.cookie)"],
    ["a relative path", "/slo"],
    ["an address with a fragment", `${IDP_SIGN_OUT_URL}#x`],
  ])("is never built for %s", (_: string, address: string) => {
    expect(() => {
      return build({
        provider: provider({ identityProviderSignOutUrl: address }),
      });
    }).toThrow();
  });
});

describe("OneUptime's answer to an identity provider's own sign-out", () => {
  function build(relayState: string | null): string {
    return SamlSingleLogout.buildLogoutResponseUrl({
      provider: provider(),
      inResponseTo: `_idp"request<1>`,
      statusCode: SAML_STATUS_SUCCESS,
      relayState: relayState,
      signingKey: signingKey(),
      now: NOW,
    });
  }

  test("goes back to the Sign Out URL, answering the request, signed with the RelayState it came with", () => {
    const url: string = build("state with spaces & symbols/?=");
    const response: XmlElement = parseXml(
      inflate(queryOf(url).get("SAMLResponse")!),
    );

    expect(
      `${new globalThis.URL(url).origin}${new globalThis.URL(url).pathname}`,
    ).toBe(IDP_SIGN_OUT_URL);
    expect(response.localName).toBe("LogoutResponse");
    expect(response.getAttribute("InResponseTo")).toBe(`_idp"request<1>`);
    expect(response.getAttribute("Destination")).toBe(IDP_SIGN_OUT_URL);
    expect(response.getAttribute("ID")).toMatch(/^_[0-9a-f]{40}$/);
    expect(child(response, "Issuer")!.textContent).toBe(ENTITY_ID);
    expect(
      child(child(response, "Status")!, "StatusCode")!.getAttribute("Value"),
    ).toBe(SAML_STATUS_SUCCESS);
    expect(queryOf(url).get("RelayState")).toBe(
      "state with spaces & symbols/?=",
    );
    expect(isSignedBy(url, "SAMLResponse", oneUptimeKey.certificate)).toBe(
      true,
    );
  });

  test("without a RelayState, signs the response and the algorithm alone", () => {
    const url: string = build(null);

    expect(queryOf(url).has("RelayState")).toBe(false);
    expect(isSignedBy(url, "SAMLResponse", oneUptimeKey.certificate)).toBe(
      true,
    );
  });

  test("echoes a RelayState only while it is of a sane length", () => {
    expect(SamlSingleLogout.relayStateToEcho("abc")).toBe("abc");
    expect(SamlSingleLogout.relayStateToEcho(null)).toBeNull();
    expect(SamlSingleLogout.relayStateToEcho("")).toBeNull();
    expect(
      SamlSingleLogout.relayStateToEcho("a".repeat(MAX_RELAY_STATE_LENGTH + 1)),
    ).toBeNull();
  });
});

describe("the IDs of OneUptime's LogoutRequests", () => {
  test("are recognised for their provider while they wait", () => {
    expect(
      SamlSingleLogout.isOwnRequestId({
        requestId: ownRequestId(),
        provider: provider(),
        signingKey: signingKey(),
        now: new Date(NOW.getTime() + LOGOUT_REQUEST_LIFETIME_IN_MS - 1000),
      }),
    ).toBe(true);
  });

  test("are unique", () => {
    expect(ownRequestId()).not.toBe(ownRequestId());
  });

  test("a provider's id in another case is the same provider", () => {
    expect(
      SamlSingleLogout.isOwnRequestId({
        requestId: ownRequestId(),
        provider: provider({ providerId: PROVIDER_ID.toUpperCase() }),
        signingKey: signingKey(),
        now: NOW,
      }),
    ).toBe(true);
  });

  test.each([
    [
      "another provider's",
      {
        provider: { providerId: OTHER_PROVIDER_ID },
        otherInstallation: false,
        now: NOW,
      },
    ],
    [
      "the same id under the Global provider type",
      {
        provider: { providerType: SsoProviderType.GlobalSSO },
        otherInstallation: false,
        now: NOW,
      },
    ],
    [
      "one past its time and the clock's leeway",
      {
        provider: {},
        otherInstallation: false,
        now: new Date(
          NOW.getTime() +
            LOGOUT_REQUEST_LIFETIME_IN_MS +
            LOGOUT_CLOCK_SKEW_IN_MS +
            1000,
        ),
      },
    ],
    [
      "one another installation made",
      { provider: {}, otherInstallation: true, now: NOW },
    ],
  ])(
    "refuse %s",
    (
      _: string,
      data: {
        provider: Partial<SamlSignOutProvider>;
        otherInstallation: boolean;
        now: Date;
      },
    ) => {
      expect(
        SamlSingleLogout.isOwnRequestId({
          requestId: ownRequestId(),
          provider: provider(data.provider),
          signingKey: data.otherInstallation
            ? otherInstallationKey
            : signingKey(),
          now: data.now,
        }),
      ).toBe(false);
    },
  );

  test("an ID whose keyed hash was changed, or that only looks like one, is not one", () => {
    const id: string = ownRequestId();
    const flipped: string = `${id.slice(0, -1)}${id.endsWith("0") ? "1" : "0"}`;

    for (const candidate of [
      flipped,
      // A later end, with the same hash.
      `${id.substring(0, 25)}ffffffffffff${id.substring(37)}`,
      `_${"0".repeat(68)}`,
      "_idp_request_1",
      "",
      null,
    ]) {
      expect(
        SamlSingleLogout.isOwnRequestId({
          requestId: candidate,
          provider: provider(),
          signingKey: signingKey(),
          now: NOW,
        }),
      ).toBe(false);
    }
  });
});

describe("a sign-out message on the HTTP-Redirect binding", () => {
  test("is read from the query, its RelayState decoded as a form writes it", () => {
    const xml: string = logoutResponseXml();

    const message: ReceivedSamlLogoutMessage = SamlSingleLogout.readMessage(
      getRequest(
        `${redirectQuery({
          parameter: "SAMLResponse",
          xml: xml,
          privateKey: null,
        })}&RelayState=back+to%20work`,
      ),
    );

    expect(message.kind).toBe(SamlLogoutMessageKind.Response);
    expect(message.binding).toBe(SamlBinding.Redirect);
    expect(message.redirectSignature).toBeNull();
    expect(message.relayState).toBe("back to work");
    expect(message.xml).toBe(xml);
  });

  test("a request in the query is read as one", () => {
    expect(
      SamlSingleLogout.readMessage(
        getRequest(
          redirectQuery({
            parameter: "SAMLRequest",
            xml: logoutRequestXml(),
            privateKey: null,
          }),
        ),
      ).kind,
    ).toBe(SamlLogoutMessageKind.Request);
  });

  test('a base64 "+" an identity provider left unencoded stays a "+"', () => {
    const xml: string = logoutResponseXml();
    const encoded: string = zlib
      .deflateRawSync(Buffer.from(xml, "utf8"))
      .toString("base64");

    expect(
      SamlSingleLogout.readMessage(
        getRequest(`SAMLResponse=${encoded.replace(/\//g, "%2F")}`),
      ).xml,
    ).toBe(xml);
  });

  test("keeps the signed octets exactly as sent, whatever their encoding's case", () => {
    const query: string = redirectQuery({
      parameter: "SAMLResponse",
      xml: logoutResponseXml(),
      relayState: "a/b",
      privateKey: idpKeys.privateKey,
    }).replace("%2F", "%2f");

    const message: ReceivedSamlLogoutMessage = SamlSingleLogout.readMessage(
      getRequest(query),
    );

    expect(message.redirectSignature!.signedOctets).toBe(
      query.substring(0, query.indexOf("&Signature=")),
    );
    expect(message.redirectSignature!.signatureAlgorithm).toBe(
      SAML_SIGNATURE_ALGORITHM_RSA_SHA256,
    );
  });

  const unsignedResponse: () => string = (): string => {
    return redirectQuery({
      parameter: "SAMLResponse",
      xml: logoutResponseXml(),
      privateKey: null,
    });
  };

  test.each([
    [
      "both a request and a response",
      (): string => {
        return `${unsignedResponse()}&SAMLRequest=abc`;
      },
    ],
    [
      "neither",
      (): string => {
        return "RelayState=x";
      },
    ],
    [
      "the response twice",
      (): string => {
        return `${unsignedResponse()}&SAMLResponse=abc`;
      },
    ],
    [
      "the signature twice",
      (): string => {
        return `${redirectQuery({
          parameter: "SAMLResponse",
          xml: logoutResponseXml(),
          privateKey: idpKeys.privateKey,
        })}&Signature=abc`;
      },
    ],
    [
      "the RelayState twice",
      (): string => {
        return `${unsignedResponse()}&RelayState=a&RelayState=b`;
      },
    ],
    [
      "an algorithm with no signature",
      (): string => {
        return `${unsignedResponse()}&SigAlg=${encodeURIComponent(
          SAML_SIGNATURE_ALGORITHM_RSA_SHA256,
        )}`;
      },
    ],
    [
      "a signature with no algorithm",
      (): string => {
        return `${unsignedResponse()}&Signature=abc`;
      },
    ],
    [
      "a message that does not inflate",
      (): string => {
        return "SAMLResponse=bm90IGRlZmxhdGVk";
      },
    ],
    [
      "a query that is not encoded as a URL's",
      (): string => {
        return "SAMLResponse=%E0%A4%A";
      },
    ],
  ])("is refused when it carries %s", (_: string, query: () => string) => {
    expectRefused(() => {
      return SamlSingleLogout.readMessage(getRequest(query()));
    });
  });

  test("is not inflated past the size of a sign-out message", () => {
    const bomb: string = zlib
      .deflateRawSync(Buffer.alloc(MAX_SAML_MESSAGE_BYTES * 16, 0x20))
      .toString("base64");

    expectRefused(() => {
      return SamlSingleLogout.readMessage(
        getRequest(`SAMLResponse=${encodeURIComponent(bomb)}`),
      );
    }, /sane size/);
  });

  test("is refused when the query is longer than any sign-out message's", () => {
    expectRefused(() => {
      return SamlSingleLogout.readMessage(
        getRequest(
          `SAMLResponse=${"A".repeat(MAX_SAML_MESSAGE_BYTES * 2 + 1)}`,
        ),
      );
    }, /too long/);
  });
});

describe("a sign-out message on the HTTP-POST binding", () => {
  test("is read from the form, with its RelayState", () => {
    const message: ReceivedSamlLogoutMessage = SamlSingleLogout.readMessage(
      postRequest({
        SAMLResponse: toBase64(logoutResponseXml()),
        RelayState: "state",
      }),
    );

    expect(message.kind).toBe(SamlLogoutMessageKind.Response);
    expect(message.binding).toBe(SamlBinding.Post);
    expect(message.relayState).toBe("state");
    expect(message.redirectSignature).toBeNull();
  });

  test.each([
    [
      "both a request and a response",
      { SAMLResponse: toBase64("x"), SAMLRequest: toBase64("y") },
    ],
    ["a response that is not text", { SAMLResponse: ["a", "b"] }],
    ["an empty response", { SAMLResponse: "" }],
    [
      "a RelayState that is not text",
      { SAMLResponse: toBase64("x"), RelayState: { a: 1 } },
    ],
    [
      "a response longer than any sign-out message",
      { SAMLResponse: "A".repeat(MAX_SAML_MESSAGE_BYTES * 2 + 1) },
    ],
  ])(
    "is refused when it carries %s",
    (_: string, body: Record<string, unknown>) => {
      expectRefused(() => {
        return SamlSingleLogout.readMessage(postRequest(body));
      });
    },
  );
});

describe("a LogoutResponse is read only from what its signature covers", () => {
  test("signed in the query by the provider's key: read, and signed", () => {
    const read: ReadLogoutResponse = readResponse(
      getRequest(
        redirectQuery({
          parameter: "SAMLResponse",
          xml: logoutResponseXml({ inResponseTo: "_ours" }),
          relayState: "state",
          privateKey: idpKeys.privateKey,
        }),
      ),
    );

    expect(read).toEqual({
      isSigned: true,
      id: "_idp_response_1",
      inResponseTo: "_ours",
      destination: SINGLE_LOGOUT_URL,
      issuer: IDP_ISSUER,
      statusCode: SAML_STATUS_SUCCESS,
    });
  });

  test("checks the query against an X.509 certificate as identity providers give it, with or without its BEGIN and END lines", () => {
    const query: string = redirectQuery({
      parameter: "SAMLResponse",
      xml: logoutResponseXml(),
      privateKey: idpCertificateKey.privateKey,
    });

    expect(
      readResponse(getRequest(query), idpCertificateKey.certificate).isSigned,
    ).toBe(true);

    const bare: string = idpCertificateKey.certificate
      .replace("-----BEGIN CERTIFICATE-----", "")
      .replace("-----END CERTIFICATE-----", "");

    expect(readResponse(getRequest(query), bare).isSigned).toBe(true);
  });

  test.each([
    ["RSA-SHA1", RSA_SHA1, "sha1"],
    ["RSA-SHA512", RSA_SHA512, "sha512"],
  ])(
    "takes a query signed with %s",
    (_: string, sigAlg: string, hash: string) => {
      expect(
        readResponse(
          getRequest(
            redirectQuery({
              parameter: "SAMLResponse",
              xml: logoutResponseXml(),
              privateKey: idpKeys.privateKey,
              sigAlg: sigAlg,
              hash: hash,
            }),
          ),
        ).isSigned,
      ).toBe(true);
    },
  );

  test("unsigned on the HTTP-Redirect binding: read, and not signed", () => {
    expect(
      readResponse(
        getRequest(
          redirectQuery({
            parameter: "SAMLResponse",
            xml: logoutResponseXml(),
            privateKey: null,
          }),
        ),
      ).isSigned,
    ).toBe(false);
  });

  test("signed in the query by another key: refused", () => {
    expectRefused(() => {
      return readResponse(
        getRequest(
          redirectQuery({
            parameter: "SAMLResponse",
            xml: logoutResponseXml(),
            privateKey: strangerKeys.privateKey,
          }),
        ),
      );
    }, /does not verify/);
  });

  test("a signed query whose message was swapped after signing: refused", () => {
    const signed: string = redirectQuery({
      parameter: "SAMLResponse",
      xml: logoutResponseXml({
        statusCode: "urn:oasis:names:tc:SAML:2.0:status:Responder",
      }),
      privateKey: idpKeys.privateKey,
    });

    const swapped: string = signed.replace(
      /SAMLResponse=[^&]+/,
      redirectQuery({
        parameter: "SAMLResponse",
        xml: logoutResponseXml(),
        privateKey: null,
      }),
    );

    expectRefused(() => {
      return readResponse(getRequest(swapped));
    }, /does not verify/);
  });

  test("a RelayState added to a signed query: refused", () => {
    const signed: string = redirectQuery({
      parameter: "SAMLResponse",
      xml: logoutResponseXml(),
      privateKey: idpKeys.privateKey,
    });

    expectRefused(() => {
      return readResponse(
        getRequest(signed.replace("&SigAlg=", "&RelayState=added&SigAlg=")),
      );
    }, /does not verify/);
  });

  test("signed with an algorithm OneUptime does not check: refused", () => {
    expectRefused(() => {
      return readResponse(
        getRequest(
          redirectQuery({
            parameter: "SAMLResponse",
            xml: logoutResponseXml(),
            privateKey: idpKeys.privateKey,
            sigAlg: "http://www.w3.org/2001/04/xmldsig-more#hmac-sha256",
          }),
        ),
      );
    }, /algorithm/);
  });

  test("signed in the message on the HTTP-POST binding by the provider's key: read from the signed bytes", () => {
    const read: ReadLogoutResponse = readResponse(
      postRequest({
        SAMLResponse: toBase64(
          signEnveloped(
            logoutResponseXml({ inResponseTo: "_ours" }),
            "LogoutResponse",
            idpKeys.privateKey,
          ),
        ),
      }),
    );

    expect(read.isSigned).toBe(true);
    expect(read.inResponseTo).toBe("_ours");
    expect(read.issuer).toBe(IDP_ISSUER);
    expect(read.statusCode).toBe(SAML_STATUS_SUCCESS);
  });

  test("unsigned on the HTTP-POST binding: read, and not signed", () => {
    expect(
      readResponse(postRequest({ SAMLResponse: toBase64(logoutResponseXml()) }))
        .isSigned,
    ).toBe(false);
  });

  test("signed in the message by another key: refused", () => {
    expectRefused(() => {
      return readResponse(
        postRequest({
          SAMLResponse: toBase64(
            signEnveloped(
              logoutResponseXml(),
              "LogoutResponse",
              strangerKeys.privateKey,
            ),
          ),
        }),
      );
    }, /does not verify/);
  });

  test("a signed message changed after signing: refused", () => {
    const signed: string = signEnveloped(
      logoutResponseXml({
        statusCode: "urn:oasis:names:tc:SAML:2.0:status:Responder",
      }),
      "LogoutResponse",
      idpKeys.privateKey,
    );

    expectRefused(() => {
      return readResponse(
        postRequest({
          SAMLResponse: toBase64(
            signed.replace(
              "urn:oasis:names:tc:SAML:2.0:status:Responder",
              SAML_STATUS_SUCCESS,
            ),
          ),
        }),
      );
    }, /does not verify/);
  });

  test("a signature over something else in the message does not cover it: refused", () => {
    // The provider signed only the Status, given an ID of its own.
    const xml: string = logoutResponseXml().replace(
      "<samlp:Status>",
      '<samlp:Status ID="_status">',
    );

    const signed: string = signXml(xml, {
      referenceXPath: "//*[local-name(.)='Status']",
      privateKey: idpKeys.privateKey,
      location: {
        reference: "/*/*[local-name(.)='Issuer']",
        action: "after",
      },
    });

    expectRefused(() => {
      return readResponse(postRequest({ SAMLResponse: toBase64(signed) }));
    }, /does not verify/);
  });

  test("a signature anywhere but directly under the message: refused", () => {
    const signed: string = signXml(logoutResponseXml(), {
      referenceXPath: "//*[local-name(.)='LogoutResponse']",
      privateKey: idpKeys.privateKey,
      location: {
        reference: "//*[local-name(.)='Status']",
        action: "append",
      },
    });

    expectRefused(() => {
      return readResponse(postRequest({ SAMLResponse: toBase64(signed) }));
    }, /one signature/);
  });

  test("two signatures: refused", () => {
    const once: string = signEnveloped(
      logoutResponseXml(),
      "LogoutResponse",
      idpKeys.privateKey,
    );

    const signature: string = once.substring(
      once.indexOf("<Signature"),
      once.indexOf("</Signature>") + "</Signature>".length,
    );

    expectRefused(() => {
      return readResponse(
        postRequest({
          SAMLResponse: toBase64(
            once.replace("<samlp:Status>", `${signature}<samlp:Status>`),
          ),
        }),
      );
    }, /one signature/);
  });

  test("a signature that carries content of its own: refused", () => {
    const signed: string = signEnveloped(
      logoutResponseXml(),
      "LogoutResponse",
      idpKeys.privateKey,
    ).replace(
      "</Signature>",
      '<Object xmlns="http://www.w3.org/2000/09/xmldsig#"><samlp:Status xmlns:samlp="urn:oasis:names:tc:SAML:2.0:protocol"/></Object></Signature>',
    );

    expectRefused(() => {
      return readResponse(postRequest({ SAMLResponse: toBase64(signed) }));
    }, /content of its own/);
  });

  test.each([
    [
      "a LogoutRequest in its place",
      () => {
        return logoutRequestXml();
      },
    ],
    [
      "a sign-in's Response",
      () => {
        return '<samlp:Response xmlns:samlp="urn:oasis:names:tc:SAML:2.0:protocol" ID="_r"/>';
      },
    ],
    [
      "a LogoutResponse in another namespace",
      () => {
        return '<LogoutResponse xmlns="urn:example" ID="_r"/>';
      },
    ],
    [
      "a DOCTYPE",
      () => {
        return `<!DOCTYPE x [<!ENTITY e "x">]>${logoutResponseXml()}`;
      },
    ],
    [
      "a processing instruction",
      () => {
        return logoutResponseXml().replace(
          "<samlp:Status>",
          "<?p x?><samlp:Status>",
        );
      },
    ],
    [
      "XML that is not well-formed",
      () => {
        return "<samlp:LogoutResponse";
      },
    ],
  ])("refuses %s", (_: string, xml: () => string) => {
    expectRefused(() => {
      return SamlSingleLogout.readLogoutResponse({
        message: {
          kind: SamlLogoutMessageKind.Response,
          binding: SamlBinding.Post,
          xml: xml(),
          relayState: null,
          redirectSignature: null,
        },
        certificate: idpKeys.publicKey,
      });
    });
  });

  test("refuses an Issuer that is not plain text", () => {
    expectRefused(() => {
      return readResponse(
        postRequest({
          SAMLResponse: toBase64(
            logoutResponseXml({
              issuerElement: `<saml:Issuer>${IDP_ISSUER}<!-- -->.evil</saml:Issuer>`,
            }),
          ),
        }),
      );
    }, /plain text/);
  });

  test("refuses two Issuers", () => {
    expectRefused(() => {
      return readResponse(
        postRequest({
          SAMLResponse: toBase64(
            logoutResponseXml({
              issuerElement: `<saml:Issuer>${IDP_ISSUER}</saml:Issuer><saml:Issuer>https://evil.example.com</saml:Issuer>`,
            }),
          ),
        }),
      );
    }, /more than one Issuer/);
  });
});

describe("a LogoutResponse confirms the sign-out only when it answers OneUptime's request, from the provider, with Success", () => {
  function confirm(response: Partial<ReadLogoutResponse>): void {
    SamlSingleLogout.assertConfirmsSignOut({
      response: {
        isSigned: false,
        id: "_idp_response_1",
        inResponseTo: ownRequestId(),
        destination: SINGLE_LOGOUT_URL,
        issuer: IDP_ISSUER,
        statusCode: SAML_STATUS_SUCCESS,
        ...response,
      },
      provider: provider(),
      signingKey: signingKey(),
      now: NOW,
    });
  }

  test("an unsigned answer to OneUptime's own request, with Success: confirmed", () => {
    expect(() => {
      return confirm({});
    }).not.toThrow();
  });

  test("a Destination written another way to the same address: confirmed", () => {
    expect(() => {
      return confirm({ destination: `${SINGLE_LOGOUT_URL.toUpperCase()}/` });
    }).not.toThrow();
  });

  test("no Destination: confirmed, as the binding allows", () => {
    expect(() => {
      return confirm({ destination: null });
    }).not.toThrow();
  });

  test("Microsoft Entra ID's answer, issued by its sign-in host for the same tenant as its assertions: confirmed", () => {
    SamlSingleLogout.assertConfirmsSignOut({
      response: {
        isSigned: true,
        id: "_entra",
        inResponseTo: SamlSingleLogout.createRequestId({
          provider: provider(),
          signingKey: signingKey(),
          now: NOW,
        }),
        destination: SINGLE_LOGOUT_URL,
        issuer:
          "https://login.microsoftonline.com/aaaabbbb-0000-cccc-1111-dddd2222eeee/",
        statusCode: SAML_STATUS_SUCCESS,
      },
      provider: provider({
        issuerUrl:
          "https://sts.windows.net/aaaabbbb-0000-cccc-1111-dddd2222eeee/",
      }),
      signingKey: signingKey(),
      now: NOW,
    });
  });

  test.each([
    [
      "no Issuer",
      (): Partial<ReadLogoutResponse> => {
        return { issuer: null };
      },
      /Issuer/,
    ],
    [
      "another identity provider's Issuer",
      (): Partial<ReadLogoutResponse> => {
        return { issuer: "https://evil.example.com" };
      },
      /Issuer/,
    ],
    [
      "another Microsoft Entra tenant",
      (): Partial<ReadLogoutResponse> => {
        return {
          issuer:
            "https://login.microsoftonline.com/99999999-0000-cccc-1111-dddd2222eeee/",
        };
      },
      /Issuer/,
    ],
    [
      "another address as its Destination",
      (): Partial<ReadLogoutResponse> => {
        return {
          destination: "https://evil.example.com/identity/idp-logout/x/y",
        };
      },
      /Destination/,
    ],
    [
      "another provider's Single Logout URL as its Destination",
      (): Partial<ReadLogoutResponse> => {
        return {
          destination: `https://oneuptime.example.com/identity/idp-logout/${PROJECT_ID}/${OTHER_PROVIDER_ID}`,
        };
      },
      /Destination/,
    ],
    [
      "no InResponseTo",
      (): Partial<ReadLogoutResponse> => {
        return { inResponseTo: null };
      },
      /answers no sign-out request/,
    ],
    [
      "an InResponseTo OneUptime never sent",
      (): Partial<ReadLogoutResponse> => {
        return { inResponseTo: "_idp_made_this_up" };
      },
      /answers no sign-out request/,
    ],
    [
      "an answer to a request OneUptime sent for another provider",
      (): Partial<ReadLogoutResponse> => {
        return {
          inResponseTo: SamlSingleLogout.createRequestId({
            provider: provider({ providerId: OTHER_PROVIDER_ID }),
            signingKey: signingKey(),
            now: NOW,
          }),
        };
      },
      /answers no sign-out request/,
    ],
    [
      "PartialLogout",
      (): Partial<ReadLogoutResponse> => {
        return {
          statusCode: "urn:oasis:names:tc:SAML:2.0:status:PartialLogout",
        };
      },
      /did not sign the person out: urn:oasis:names:tc:SAML:2.0:status:PartialLogout/,
    ],
    [
      "Requester",
      (): Partial<ReadLogoutResponse> => {
        return { statusCode: "urn:oasis:names:tc:SAML:2.0:status:Requester" };
      },
      /did not sign the person out/,
    ],
    [
      "no status",
      (): Partial<ReadLogoutResponse> => {
        return { statusCode: null };
      },
      /no status/,
    ],
    [
      "a status that is no status code, which is not repeated",
      (): Partial<ReadLogoutResponse> => {
        return { statusCode: "<script>alert(1)</script>" };
      },
      /no status/,
    ],
  ])(
    "refuses %s",
    (_: string, response: () => Partial<ReadLogoutResponse>, words: RegExp) => {
      expectRefused(() => {
        return confirm(response());
      }, words);
    },
  );

  test("refuses an answer to OneUptime's own request once its time is up", () => {
    expectRefused(() => {
      SamlSingleLogout.assertConfirmsSignOut({
        response: {
          isSigned: true,
          id: "_late",
          inResponseTo: ownRequestId(),
          destination: SINGLE_LOGOUT_URL,
          issuer: IDP_ISSUER,
          statusCode: SAML_STATUS_SUCCESS,
        },
        provider: provider(),
        signingKey: signingKey(),
        now: new Date(
          NOW.getTime() +
            LOGOUT_REQUEST_LIFETIME_IN_MS +
            LOGOUT_CLOCK_SKEW_IN_MS +
            1000,
        ),
      });
    }, /too late/);
  });
});

describe("an identity provider's own LogoutRequest", () => {
  test("signed in the query: read, naming the person and their sessions", () => {
    const read: ReadLogoutRequest = readRequest(
      getRequest(
        redirectQuery({
          parameter: "SAMLRequest",
          xml: logoutRequestXml({
            notOnOrAfter: new Date(NOW.getTime() + 60_000),
            sessionIndexes: ["_one", "_two"],
          }),
          relayState: "state",
          privateKey: idpKeys.privateKey,
        }),
      ),
    );

    expect(read).toEqual({
      isSigned: true,
      id: "_idp_request_1",
      destination: SINGLE_LOGOUT_URL,
      issuer: IDP_ISSUER,
      issueInstant: NOW.getTime(),
      notOnOrAfter: NOW.getTime() + 60_000,
      nameId: "dana.scully@example.com",
      sessionIndexes: ["_one", "_two"],
    });
  });

  test("signed in the message on the HTTP-POST binding: read", () => {
    expect(
      readRequest(
        postRequest({
          SAMLRequest: toBase64(
            signEnveloped(
              logoutRequestXml(),
              "LogoutRequest",
              idpKeys.privateKey,
            ),
          ),
        }),
      ).nameId,
    ).toBe("dana.scully@example.com");
  });

  test("not signed: refused, as it ends sessions", () => {
    expectRefused(() => {
      return readRequest(
        getRequest(
          redirectQuery({
            parameter: "SAMLRequest",
            xml: logoutRequestXml(),
            privateKey: null,
          }),
        ),
      );
    }, /not signed/);

    expectRefused(() => {
      return readRequest(
        postRequest({ SAMLRequest: toBase64(logoutRequestXml()) }),
      );
    }, /not signed/);
  });

  test("signed by another key: refused", () => {
    expectRefused(() => {
      return readRequest(
        getRequest(
          redirectQuery({
            parameter: "SAMLRequest",
            xml: logoutRequestXml(),
            privateKey: strangerKeys.privateKey,
          }),
        ),
      );
    }, /does not verify/);
  });

  test.each([
    [
      "an encrypted Name ID",
      '<saml:EncryptedID><xenc:EncryptedData xmlns:xenc="http://www.w3.org/2001/04/xmlenc#"/></saml:EncryptedID>',
      /EncryptedID/,
    ],
    ["no Name ID", "", /no one person/],
    [
      "two Name IDs",
      "<saml:NameID>dana.scully@example.com</saml:NameID><saml:NameID>walter.skinner@example.com</saml:NameID>",
      /no one person/,
    ],
    [
      "a Name ID with an element inside",
      "<saml:NameID>dana<b/>.scully@example.com</saml:NameID>",
      /plain text/,
    ],
    ["an empty Name ID", "<saml:NameID></saml:NameID>", /no one person/],
  ])(
    "naming the person by %s: refused",
    (_: string, nameIdElement: string, words: RegExp) => {
      expectRefused(() => {
        return readRequest(
          getRequest(
            redirectQuery({
              parameter: "SAMLRequest",
              xml: logoutRequestXml({ nameIdElement }),
              privateKey: idpKeys.privateKey,
            }),
          ),
        );
      }, words);
    },
  );

  function assertForUs(request: Partial<ReadLogoutRequest>): void {
    SamlSingleLogout.assertRequestIsForUs({
      request: {
        isSigned: true,
        id: "_idp_request_1",
        destination: SINGLE_LOGOUT_URL,
        issuer: IDP_ISSUER,
        issueInstant: NOW.getTime(),
        notOnOrAfter: null,
        nameId: "dana.scully@example.com",
        sessionIndexes: [],
        ...request,
      },
      provider: provider(),
      now: NOW,
    });
  }

  test("from the provider, to OneUptime's Single Logout URL, issued just now: taken", () => {
    expect(() => {
      return assertForUs({});
    }).not.toThrow();

    expect(() => {
      return assertForUs({
        issueInstant: NOW.getTime() + LOGOUT_CLOCK_SKEW_IN_MS - 1000,
        notOnOrAfter: NOW.getTime() + 1000,
      });
    }).not.toThrow();
  });

  test.each([
    ["no Issuer", { issuer: null }, /Issuer/],
    [
      "another identity provider's",
      { issuer: "https://evil.example.com" },
      /Issuer/,
    ],
    [
      "sent to another address",
      { destination: "https://evil.example.com/slo" },
      /Destination/,
    ],
    ["with no ID", { id: "" }, /no ID/],
    [
      "with an ID longer than any",
      { id: `_${"a".repeat(MAX_SAML_ID_LENGTH)}` },
      /no ID/,
    ],
    [
      "past its NotOnOrAfter",
      { notOnOrAfter: NOW.getTime() - LOGOUT_CLOCK_SKEW_IN_MS - 1000 },
      /expired/,
    ],
    ["with no IssueInstant", { issueInstant: null }, /issued/],
    [
      "issued too long ago",
      {
        issueInstant:
          NOW.getTime() -
          LOGOUT_REQUEST_LIFETIME_IN_MS -
          LOGOUT_CLOCK_SKEW_IN_MS -
          1000,
      },
      /issued/,
    ],
    [
      "issued in the future",
      { issueInstant: NOW.getTime() + LOGOUT_CLOCK_SKEW_IN_MS + 1000 },
      /issued/,
    ],
  ])(
    "%s: refused",
    (_: string, request: Partial<ReadLogoutRequest>, words: RegExp) => {
      expectRefused(() => {
        return assertForUs(request);
      }, words);
    },
  );

  test("names a session by the very Name ID, and by one of its session indexes when it names any", () => {
    const request: (
      overrides: Partial<ReadLogoutRequest>,
    ) => ReadLogoutRequest = (
      overrides: Partial<ReadLogoutRequest>,
    ): ReadLogoutRequest => {
      return {
        isSigned: true,
        id: "_r",
        destination: null,
        issuer: IDP_ISSUER,
        issueInstant: NOW.getTime(),
        notOnOrAfter: null,
        nameId: "dana.scully@example.com",
        sessionIndexes: [],
        ...overrides,
      };
    };

    const named: (
      overrides: Partial<ReadLogoutRequest>,
      kept?: Partial<SamlIdentityProviderSignOutRecord>,
    ) => boolean = (
      overrides: Partial<ReadLogoutRequest>,
      kept: Partial<SamlIdentityProviderSignOutRecord> = {},
    ): boolean => {
      return SamlSingleLogout.isNamedBy({
        request: request(overrides),
        record: record(kept),
      });
    };

    expect(named({})).toBe(true);
    expect(
      named({ sessionIndexes: ["_0c3b5d0f-1d2e-4f5a-9b8c-7d6e5f4a3b2c"] }),
    ).toBe(true);
    expect(named({ sessionIndexes: ["_another_session"] })).toBe(false);
    expect(named({ nameId: "walter.skinner@example.com" })).toBe(false);
    // The Name ID exactly: another spelling of the address is another Name ID.
    expect(named({ nameId: "Dana.Scully@example.com" })).toBe(false);
    // A session that kept no index is the person's, whichever they name.
    expect(
      named(
        { sessionIndexes: ["_another_session"] },
        { sessionIndex: undefined },
      ),
    ).toBe(true);
  });

  test("a request that was not taken can still be answered, by its ID alone", () => {
    const message: ReceivedSamlLogoutMessage = SamlSingleLogout.readMessage(
      getRequest(
        redirectQuery({
          parameter: "SAMLRequest",
          xml: logoutRequestXml({ id: "_unsigned_request" }),
          privateKey: null,
        }),
      ),
    );

    expect(SamlSingleLogout.peekRequestId(message)).toBe("_unsigned_request");

    expect(
      SamlSingleLogout.peekRequestId({
        ...message,
        xml: logoutRequestXml({ id: `_${"a".repeat(MAX_SAML_ID_LENGTH)}` }),
      }),
    ).toBeNull();
    expect(
      SamlSingleLogout.peekRequestId({ ...message, xml: "<not-xml" }),
    ).toBeNull();
    expect(
      SamlSingleLogout.peekRequestId({
        ...message,
        kind: SamlLogoutMessageKind.Response,
        xml: logoutResponseXml(),
      }),
    ).toBeNull();
  });
});

describe("whose Issuer a sign-out message names", () => {
  test.each([
    [IDP_ISSUER, IDP_ISSUER, true],
    [` ${IDP_ISSUER} `, IDP_ISSUER, true],
    ["https://evil.example.com", IDP_ISSUER, false],
    ["", IDP_ISSUER, false],
    [
      "https://login.microsoftonline.com/aaaabbbb-0000-cccc-1111-dddd2222eeee/",
      "https://sts.windows.net/aaaabbbb-0000-cccc-1111-dddd2222eeee/",
      true,
    ],
    [
      "https://login.microsoftonline.com/AAAABBBB-0000-CCCC-1111-DDDD2222EEEE",
      "https://sts.windows.net/aaaabbbb-0000-cccc-1111-dddd2222eeee/",
      true,
    ],
    [
      "https://login.microsoftonline.com/aaaabbbb-0000-cccc-1111-dddd2222eeee/",
      "https://sts.windows.net/99999999-0000-cccc-1111-dddd2222eeee/",
      false,
    ],
    [
      "https://login.microsoftonline.com.evil.example.com/aaaabbbb-0000-cccc-1111-dddd2222eeee/",
      "https://sts.windows.net/aaaabbbb-0000-cccc-1111-dddd2222eeee/",
      false,
    ],
    [
      "http://login.microsoftonline.com/aaaabbbb-0000-cccc-1111-dddd2222eeee/",
      "https://sts.windows.net/aaaabbbb-0000-cccc-1111-dddd2222eeee/",
      false,
    ],
  ])(
    "%s for a provider whose Issuer is %s: %s",
    (candidate: string, configured: string, expected: boolean) => {
      expect(
        SamlSingleLogout.isIdentityProviderIssuer(candidate, configured),
      ).toBe(expected);
    },
  );
});
