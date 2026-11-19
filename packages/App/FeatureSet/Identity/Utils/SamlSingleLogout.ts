import SSOUtil from "./SSO";
import SamlServiceProviders from "./SamlServiceProvider";
import { ExpressRequest } from "Common/Server/Utils/Express";
import logger from "Common/Server/Utils/Logger";
import BadRequestException from "Common/Types/Exception/BadRequestException";
import {
  isUsableSamlSignOutValue,
  isUsableSingleLogoutUrl,
  SamlIdentityProviderSignOutRecord,
} from "Common/Types/SSO/IdentityProviderSignOut";
import SsoProviderType from "Common/Types/SSO/SsoProviderType";
import { Reference, SignedXml } from "xml-crypto";
import {
  Document as XmlDocument,
  Element as XmlElement,
  Node as XmlNode,
} from "@xmldom/xmldom";
import crypto from "crypto";
import zlib from "zlib";

/*
 * ---------------------------------------------------------------------------
 * SAML SINGLE LOGOUT: SIGNING A PERSON OUT OF THEIR SAML IDENTITY PROVIDER
 * TOO, AND TAKING THE IDENTITY PROVIDER'S OWN SIGN-OUT (#9603).
 *
 * With a SAML provider's "Sign out of the identity provider too" switch on,
 * a browser sign-in keeps what the assertion named the person and their
 * session by (Types/SSO/IdentityProviderSignOut). Once POST /identity/logout
 * has ended the OneUptime session, the browser goes to the identity
 * provider's Sign Out URL (its SingleLogoutService) with a <LogoutRequest>
 * (SAML 2.0 Core 3.7) naming them, on the HTTP-Redirect binding (SAML 2.0
 * Bindings 3.4): deflated, base64-encoded, and signed in the query -
 * SigAlg and Signature - with the installation's own key
 * (InstanceSamlSigningKeyService), whose certificate the identity provider
 * was given. Okta, AD FS and Keycloak with "Client signature required"
 * refuse one that is not signed.
 *
 * The identity provider answers at OneUptime's Single Logout URL
 * (/identity/idp-logout/..., /identity/global-idp-logout/...), on the
 * HTTP-Redirect or HTTP-POST binding, with a <LogoutResponse>. And when the
 * person signs out at the identity provider, or of another app that uses
 * it, the identity provider may send a <LogoutRequest> of its own there.
 * What arrives is read here, strictly:
 *
 *   - parsed by the same parser as a sign-in's response (SSOUtil.
 *     parseXmlStrict: no DOCTYPE, no entities, no processing instructions),
 *     after inflating at most MAX_SAML_MESSAGE_BYTES;
 *   - a signature is checked against the provider's own certificate, never
 *     one the message carries: the query's (HTTP-Redirect), over the
 *     parameters exactly as they were sent, or the message's enveloped XML
 *     signature (HTTP-POST), which must cover the message itself - and the
 *     values are then read from the bytes it covers, as a sign-in's are;
 *   - a signature that is there must verify. A LogoutResponse need not be
 *     signed - Microsoft Entra ID sends it unsigned - as long as it answers
 *     a LogoutRequest OneUptime sent for this provider and no other: its
 *     InResponseTo is one of OneUptime's own request IDs, which carry their
 *     provider and their end in a keyed hash (createRequestId). A
 *     LogoutRequest, which ends sessions, must be signed;
 *   - the Issuer must be the provider's (Microsoft Entra ID's by its
 *     tenant: isIdentityProviderIssuer), and a Destination, where there is
 *     one, OneUptime's Single Logout URL for this provider.
 *
 * Nothing here sends a browser to an address a message names: a
 * LogoutResponse leads to the sign-in page, and OneUptime's own
 * LogoutResponse goes to the provider's configured Sign Out URL. RelayState
 * is echoed back to the identity provider as data, never followed.
 * ---------------------------------------------------------------------------
 */

export const SAML_PROTOCOL_NAMESPACE: string =
  "urn:oasis:names:tc:SAML:2.0:protocol";

export const SAML_ASSERTION_NAMESPACE: string =
  "urn:oasis:names:tc:SAML:2.0:assertion";

const XMLDSIG_NAMESPACE: string = "http://www.w3.org/2000/09/xmldsig#";

export const SAML_STATUS_SUCCESS: string =
  "urn:oasis:names:tc:SAML:2.0:status:Success";

// What OneUptime answers a sign-out request it could not act on with.
export const SAML_STATUS_RESPONDER: string =
  "urn:oasis:names:tc:SAML:2.0:status:Responder";

// Why OneUptime asks the identity provider to sign the person out: they did.
export const SAML_LOGOUT_REASON_USER: string =
  "urn:oasis:names:tc:SAML:2.0:logout:user";

// How OneUptime signs its messages.
export const SAML_SIGNATURE_ALGORITHM_RSA_SHA256: string =
  "http://www.w3.org/2001/04/xmldsig-more#rsa-sha256";

/*
 * The signature algorithms an identity provider may sign its HTTP-Redirect
 * messages with, and the hash each takes.
 */
const REDIRECT_SIGNATURE_HASHES: ReadonlyMap<string, string> = new Map<
  string,
  string
>([
  ["http://www.w3.org/2000/09/xmldsig#rsa-sha1", "sha1"],
  [SAML_SIGNATURE_ALGORITHM_RSA_SHA256, "sha256"],
  ["http://www.w3.org/2001/04/xmldsig-more#rsa-sha384", "sha384"],
  ["http://www.w3.org/2001/04/xmldsig-more#rsa-sha512", "sha512"],
]);

/*
 * The most a sign-out message may take, encoded and as XML. One names a
 * person and a session or two: a few kilobytes at most. A message deflated
 * from more is no identity provider's, and is not inflated past this.
 */
export const MAX_SAML_MESSAGE_BYTES: number = 64 * 1024;

/*
 * The longest RelayState OneUptime echoes back. SAML 2.0 Bindings 3.4.3
 * allows 80 bytes; some identity providers send more.
 */
export const MAX_RELAY_STATE_LENGTH: number = 1024;

/*
 * How long a LogoutRequest is good for: how long OneUptime waits for its
 * answer, and how old an identity provider's own may be.
 */
export const LOGOUT_REQUEST_LIFETIME_IN_MS: number = 10 * 60 * 1000;

// How far apart the identity provider's clock and this server's may be.
export const LOGOUT_CLOCK_SKEW_IN_MS: number = 3 * 60 * 1000;

/*
 * The longest message ID OneUptime answers to. Identity providers write a
 * GUID or a few dozen characters; anything longer is not echoed back.
 */
export const MAX_SAML_ID_LENGTH: number = 256;

// What OneUptime answers a sign-out request it would not act on with.
export const SAML_STATUS_REQUESTER: string =
  "urn:oasis:names:tc:SAML:2.0:status:Requester";

export enum SamlLogoutMessageKind {
  Request = "LogoutRequest",
  Response = "LogoutResponse",
}

export enum SamlBinding {
  Redirect = "HTTP-Redirect",
  Post = "HTTP-POST",
}

// A SAML provider, as its sign-out needs it.
export interface SamlSignOutProvider {
  providerType: SsoProviderType.GlobalSSO | SsoProviderType.ProjectSSO;
  providerId: string;
  // OneUptime's Entity ID for it: the Issuer of what OneUptime sends.
  entityId: string;
  // OneUptime's Single Logout URL for it: where the identity provider answers.
  singleLogoutUrl: string;
  // The identity provider's Sign Out URL: where OneUptime sends people.
  identityProviderSignOutUrl: string;
  // The identity provider's issuer, and the certificate it signs with.
  issuerUrl: string;
  certificate: string;
}

// The key OneUptime signs its SAML messages with, and its certificate.
export interface SamlSigningKey {
  privateKey: string;
  certificate: string;
}

// A sign-out message as it arrived, before anything in it is trusted.
export interface ReceivedSamlLogoutMessage {
  kind: SamlLogoutMessageKind;
  binding: SamlBinding;
  // The message itself.
  xml: string;
  relayState: string | null;
  // The HTTP-Redirect binding's signature, as sent; null when it has none.
  redirectSignature: {
    signedOctets: string;
    signatureAlgorithm: string;
    signature: Buffer;
  } | null;
}

// A LogoutResponse, read from what its signature (if any) vouches for.
export interface ReadLogoutResponse {
  isSigned: boolean;
  id: string;
  inResponseTo: string | null;
  destination: string | null;
  issuer: string | null;
  statusCode: string | null;
}

// A LogoutRequest, read from what its signature vouches for.
export interface ReadLogoutRequest {
  isSigned: boolean;
  id: string;
  destination: string | null;
  issuer: string | null;
  issueInstant: number | null;
  notOnOrAfter: number | null;
  nameId: string;
  sessionIndexes: Array<string>;
}

// Why a sign-out message was not taken, for the log. Never shown to anyone.
export class SamlLogoutRefusal extends BadRequestException {}

/*
 * The parameters of a query as they were sent: each name decoded, each value
 * as it came, still encoded, so a signature over them can be checked over
 * exactly the octets that were signed (SAML 2.0 Bindings 3.4.4.1).
 */
interface RawQueryParameter {
  name: string;
  rawValue: string;
}

const LOGOUT_PARAMETERS: ReadonlyArray<string> = [
  "SAMLRequest",
  "SAMLResponse",
  "RelayState",
  "SigAlg",
  "Signature",
];

/*
 * A LogoutRequest ID OneUptime wrote: "_", then its issue time, its nonce
 * and its MAC, in hex (createRequestId).
 */
const OWN_REQUEST_ID_PATTERN: RegExp =
  /^_([0-9a-f]{24})([0-9a-f]{12})([0-9a-f]{32})$/;

/*
 * A Microsoft Entra ID issuer, in any of its clouds and under either of its
 * hosts: the tenant is the part that names who issued it.
 */
const ENTRA_ISSUER_PATTERN: RegExp =
  /^https:\/\/(?:sts\.windows\.net|login\.microsoftonline\.com|login\.microsoftonline\.us|sts\.chinacloudapi\.cn|login\.partner\.microsoftonline\.cn|login\.chinacloudapi\.cn)\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/?$/i;

// What a SAML status code looks like, to be written to a log.
const STATUS_CODE_PATTERN: RegExp = /^[A-Za-z0-9:._/-]{1,200}$/;

export default class SamlSingleLogout {
  /*
   * -------------------------------------------------------------------------
   * What OneUptime sends.
   * -------------------------------------------------------------------------
   */

  /*
   * Where the browser goes to be signed out of the identity provider too:
   * its Sign Out URL with a signed LogoutRequest naming the person and
   * their session as the assertion named them (HTTP-Redirect binding).
   */
  public static buildLogoutRequestUrl(data: {
    provider: SamlSignOutProvider;
    record: SamlIdentityProviderSignOutRecord;
    signingKey: SamlSigningKey;
    now: Date;
  }): string {
    const id: string = SamlSingleLogout.createRequestId({
      provider: data.provider,
      signingKey: data.signingKey,
      now: data.now,
    });

    const xml: string = SamlSingleLogout.buildLogoutRequestXml({
      id: id,
      issueInstant: data.now,
      notOnOrAfter: new Date(
        data.now.getTime() + LOGOUT_REQUEST_LIFETIME_IN_MS,
      ),
      destination: data.provider.identityProviderSignOutUrl,
      issuer: data.provider.entityId,
      record: data.record,
    });

    return SamlSingleLogout.buildRedirectUrl({
      endpoint: data.provider.identityProviderSignOutUrl,
      parameter: "SAMLRequest",
      xml: xml,
      relayState: null,
      signingKey: data.signingKey,
    });
  }

  /*
   * Where the browser goes back to the identity provider with OneUptime's
   * answer to its own sign-out request: the provider's Sign Out URL, with a
   * signed LogoutResponse (HTTP-Redirect binding), and the RelayState the
   * request came with.
   */
  public static buildLogoutResponseUrl(data: {
    provider: SamlSignOutProvider;
    inResponseTo: string;
    statusCode: string;
    relayState: string | null;
    signingKey: SamlSigningKey;
    now: Date;
  }): string {
    const xml: string = SamlSingleLogout.buildLogoutResponseXml({
      id: SamlSingleLogout.createMessageId(),
      issueInstant: data.now,
      destination: data.provider.identityProviderSignOutUrl,
      issuer: data.provider.entityId,
      inResponseTo: data.inResponseTo,
      statusCode: data.statusCode,
    });

    return SamlSingleLogout.buildRedirectUrl({
      endpoint: data.provider.identityProviderSignOutUrl,
      parameter: "SAMLResponse",
      xml: xml,
      relayState: data.relayState,
      signingKey: data.signingKey,
    });
  }

  /*
   * A LogoutRequest (SAML 2.0 Core 3.7.1): who asks (OneUptime's Entity ID),
   * whom to sign out (the Name ID, exactly as the assertion had it), and
   * which session (its SessionIndex, when the assertion had one). Every
   * value is escaped, the Name ID included, though it is an address.
   */
  public static buildLogoutRequestXml(data: {
    id: string;
    issueInstant: Date;
    notOnOrAfter: Date;
    destination: string;
    issuer: string;
    record: SamlIdentityProviderSignOutRecord;
  }): string {
    const nameIdAttributes: string = [
      SamlSingleLogout.attribute("Format", data.record.nameIdFormat),
      SamlSingleLogout.attribute(
        "NameQualifier",
        data.record.nameIdNameQualifier,
      ),
      SamlSingleLogout.attribute(
        "SPNameQualifier",
        data.record.nameIdSpNameQualifier,
      ),
    ].join("");

    const sessionIndex: string = data.record.sessionIndex
      ? `<samlp:SessionIndex>${SamlSingleLogout.escapeXml(
          data.record.sessionIndex,
        )}</samlp:SessionIndex>`
      : "";

    return `<samlp:LogoutRequest xmlns:samlp="${SAML_PROTOCOL_NAMESPACE}" xmlns:saml="${SAML_ASSERTION_NAMESPACE}"${SamlSingleLogout.attribute(
      "ID",
      data.id,
    )} Version="2.0"${SamlSingleLogout.attribute(
      "IssueInstant",
      data.issueInstant.toISOString(),
    )}${SamlSingleLogout.attribute(
      "Destination",
      data.destination,
    )}${SamlSingleLogout.attribute(
      "NotOnOrAfter",
      data.notOnOrAfter.toISOString(),
    )}${SamlSingleLogout.attribute(
      "Reason",
      SAML_LOGOUT_REASON_USER,
    )}><saml:Issuer>${SamlSingleLogout.escapeXml(
      data.issuer,
    )}</saml:Issuer><saml:NameID${nameIdAttributes}>${SamlSingleLogout.escapeXml(
      data.record.nameId,
    )}</saml:NameID>${sessionIndex}</samlp:LogoutRequest>`;
  }

  // A LogoutResponse (SAML 2.0 Core 3.7.2): the answer, and to what.
  public static buildLogoutResponseXml(data: {
    id: string;
    issueInstant: Date;
    destination: string;
    issuer: string;
    inResponseTo: string;
    statusCode: string;
  }): string {
    return `<samlp:LogoutResponse xmlns:samlp="${SAML_PROTOCOL_NAMESPACE}" xmlns:saml="${SAML_ASSERTION_NAMESPACE}"${SamlSingleLogout.attribute(
      "ID",
      data.id,
    )} Version="2.0"${SamlSingleLogout.attribute(
      "IssueInstant",
      data.issueInstant.toISOString(),
    )}${SamlSingleLogout.attribute(
      "Destination",
      data.destination,
    )}${SamlSingleLogout.attribute(
      "InResponseTo",
      data.inResponseTo,
    )}><saml:Issuer>${SamlSingleLogout.escapeXml(
      data.issuer,
    )}</saml:Issuer><samlp:Status><samlp:StatusCode${SamlSingleLogout.attribute(
      "Value",
      data.statusCode,
    )}/></samlp:Status></samlp:LogoutResponse>`;
  }

  /*
   * The HTTP-Redirect binding (SAML 2.0 Bindings 3.4.4.1): the message
   * deflated and base64-encoded as `parameter`, then RelayState when there
   * is one, then SigAlg, each URL-encoded, signed in that order with
   * RSA-SHA256, and the Signature last. A query the endpoint already has is
   * kept, without parameters of these names.
   */
  public static buildRedirectUrl(data: {
    endpoint: string;
    parameter: "SAMLRequest" | "SAMLResponse";
    xml: string;
    relayState: string | null;
    signingKey: SamlSigningKey;
  }): string {
    if (!isUsableSingleLogoutUrl(data.endpoint)) {
      throw new BadRequestException(
        "The identity provider's Sign Out URL is not an address a browser can be sent to.",
      );
    }

    const encoded: string = zlib
      .deflateRawSync(Buffer.from(data.xml, "utf8"))
      .toString("base64");

    let signedQuery: string = `${data.parameter}=${encodeURIComponent(encoded)}`;

    if (data.relayState) {
      signedQuery += `&RelayState=${encodeURIComponent(data.relayState)}`;
    }

    signedQuery += `&SigAlg=${encodeURIComponent(
      SAML_SIGNATURE_ALGORITHM_RSA_SHA256,
    )}`;

    const signature: string = crypto
      .sign(
        "sha256",
        Buffer.from(signedQuery, "utf8"),
        crypto.createPrivateKey(data.signingKey.privateKey),
      )
      .toString("base64");

    const endpoint: globalThis.URL = new globalThis.URL(data.endpoint);

    for (const name of LOGOUT_PARAMETERS) {
      endpoint.searchParams.delete(name);
    }

    const base: string = endpoint.toString();

    return `${base}${endpoint.search ? "&" : "?"}${signedQuery}&Signature=${encodeURIComponent(signature)}`;
  }

  /*
   * -------------------------------------------------------------------------
   * The IDs of the LogoutRequests OneUptime sends.
   *
   * A LogoutResponse names the request it answers (InResponseTo). Every
   * server must recognise the requests any of them sent, and an unsigned
   * response - Microsoft Entra ID's - is let through only as the answer to
   * one, for its provider, while it is fresh. So a request's ID carries its
   * end, and a keyed hash over the provider and that end, with a key no one
   * but the servers holds (derived from the installation's SAML signing
   * key): "_", 24 random hex digits, the end as 12 hex digits of seconds,
   * and 32 hex digits of HMAC-SHA256. An ID starts with an underscore, as
   * an xs:ID must not start with a digit.
   * -------------------------------------------------------------------------
   */
  public static createRequestId(data: {
    provider: Pick<SamlSignOutProvider, "providerType" | "providerId">;
    signingKey: SamlSigningKey;
    now: Date;
  }): string {
    const nonce: string = crypto.randomBytes(12).toString("hex");

    const endsAt: string = Math.floor(
      (data.now.getTime() + LOGOUT_REQUEST_LIFETIME_IN_MS) / 1000,
    )
      .toString(16)
      .padStart(12, "0");

    return `_${nonce}${endsAt}${SamlSingleLogout.requestIdMac({
      provider: data.provider,
      signingKey: data.signingKey,
      nonce: nonce,
      endsAt: endsAt,
    })}`;
  }

  /*
   * Whether `requestId` is the ID of a LogoutRequest OneUptime sent for this
   * provider, and still waiting for its answer.
   */
  public static isOwnRequestId(data: {
    requestId: string | null;
    provider: Pick<SamlSignOutProvider, "providerType" | "providerId">;
    signingKey: SamlSigningKey;
    now: Date;
  }): boolean {
    const match: RegExpExecArray | null = OWN_REQUEST_ID_PATTERN.exec(
      data.requestId || "",
    );

    if (!match) {
      return false;
    }

    const nonce: string = match[1]!;
    const endsAt: string = match[2]!;

    const expected: Buffer = Buffer.from(
      SamlSingleLogout.requestIdMac({
        provider: data.provider,
        signingKey: data.signingKey,
        nonce: nonce,
        endsAt: endsAt,
      }),
      "hex",
    );

    if (!crypto.timingSafeEqual(expected, Buffer.from(match[3]!, "hex"))) {
      return false;
    }

    return (
      data.now.getTime() < parseInt(endsAt, 16) * 1000 + LOGOUT_CLOCK_SKEW_IN_MS
    );
  }

  // A message ID of OneUptime's own: an underscore, then 40 random hex digits.
  public static createMessageId(): string {
    return `_${crypto.randomBytes(20).toString("hex")}`;
  }

  /*
   * -------------------------------------------------------------------------
   * What an identity provider sends.
   * -------------------------------------------------------------------------
   */

  /*
   * The sign-out message a request to the Single Logout URL carries: in
   * the query (HTTP-Redirect), or in the form posted (HTTP-POST). Throws
   * SamlLogoutRefusal when it carries none, or not exactly one.
   */
  public static readMessage(req: ExpressRequest): ReceivedSamlLogoutMessage {
    const body: Record<string, unknown> =
      req.body && typeof req.body === "object" && !Array.isArray(req.body)
        ? (req.body as Record<string, unknown>)
        : {};

    const posted: Array<string> = ["SAMLRequest", "SAMLResponse"].filter(
      (name: string): boolean => {
        return body[name] !== undefined;
      },
    );

    if (req.method === "POST" && posted.length > 0) {
      return SamlSingleLogout.readPostMessage(body, posted);
    }

    return SamlSingleLogout.readRedirectMessage(
      SamlSingleLogout.getRawQuery(req),
    );
  }

  /*
   * The query of a request as it was sent. Express keeps the address the
   * request named in originalUrl; nothing after a "?" in it is decoded.
   */
  public static getRawQuery(req: ExpressRequest): string {
    const address: string =
      (req as unknown as { originalUrl?: string }).originalUrl ||
      (req as unknown as { url?: string }).url ||
      "";

    const at: number = address.indexOf("?");

    return at < 0 ? "" : address.substring(at + 1);
  }

  /*
   * The HTTP-Redirect binding: the message deflated in SAMLRequest or
   * SAMLResponse, and SigAlg and Signature when it is signed. Every one of
   * them at most once.
   */
  public static readRedirectMessage(
    rawQuery: string,
  ): ReceivedSamlLogoutMessage {
    if (rawQuery.length > MAX_SAML_MESSAGE_BYTES * 2) {
      throw new SamlLogoutRefusal("The SAML sign-out message is too long.");
    }

    const parameters: Array<RawQueryParameter> =
      SamlSingleLogout.parseRawQuery(rawQuery);

    const find: (name: string) => RawQueryParameter | null = (
      name: string,
    ): RawQueryParameter | null => {
      const found: Array<RawQueryParameter> = parameters.filter(
        (parameter: RawQueryParameter): boolean => {
          return parameter.name === name;
        },
      );

      if (found.length > 1) {
        throw new SamlLogoutRefusal(
          `The SAML sign-out message names ${name} more than once.`,
        );
      }

      return found[0] || null;
    };

    const request: RawQueryParameter | null = find("SAMLRequest");
    const response: RawQueryParameter | null = find("SAMLResponse");
    const relayState: RawQueryParameter | null = find("RelayState");
    const sigAlg: RawQueryParameter | null = find("SigAlg");
    const signature: RawQueryParameter | null = find("Signature");

    if (Boolean(request) === Boolean(response)) {
      throw new SamlLogoutRefusal(
        "A SAML sign-out message carries exactly one of SAMLRequest and SAMLResponse.",
      );
    }

    const message: RawQueryParameter = (request || response)!;

    if (Boolean(sigAlg) !== Boolean(signature)) {
      throw new SamlLogoutRefusal(
        "A signed SAML sign-out message carries both SigAlg and Signature.",
      );
    }

    let redirectSignature: ReceivedSamlLogoutMessage["redirectSignature"] =
      null;

    if (sigAlg && signature) {
      // The octets signed: exactly as sent, in the order the binding names.
      const signedOctets: string = [
        `${message.name}=${message.rawValue}`,
        ...(relayState ? [`RelayState=${relayState.rawValue}`] : []),
        `SigAlg=${sigAlg.rawValue}`,
      ].join("&");

      redirectSignature = {
        signedOctets: signedOctets,
        signatureAlgorithm: SamlSingleLogout.decodeQueryValue(sigAlg.rawValue),
        signature: Buffer.from(
          SamlSingleLogout.decodeBase64Value(signature.rawValue),
          "base64",
        ),
      };
    }

    const deflated: Buffer = Buffer.from(
      SamlSingleLogout.decodeBase64Value(message.rawValue),
      "base64",
    );

    let xml: string;

    try {
      xml = zlib
        .inflateRawSync(deflated, { maxOutputLength: MAX_SAML_MESSAGE_BYTES })
        .toString("utf8");
    } catch {
      throw new SamlLogoutRefusal(
        "The SAML sign-out message does not inflate to a message of a sane size.",
      );
    }

    return {
      kind: request
        ? SamlLogoutMessageKind.Request
        : SamlLogoutMessageKind.Response,
      binding: SamlBinding.Redirect,
      xml: xml,
      relayState: relayState
        ? SamlSingleLogout.decodeQueryValue(relayState.rawValue)
        : null,
      redirectSignature: redirectSignature,
    };
  }

  // The HTTP-POST binding: the message base64-encoded in a form field.
  public static readPostMessage(
    body: Record<string, unknown>,
    posted: Array<string>,
  ): ReceivedSamlLogoutMessage {
    if (posted.length !== 1) {
      throw new SamlLogoutRefusal(
        "A SAML sign-out message carries exactly one of SAMLRequest and SAMLResponse.",
      );
    }

    const name: string = posted[0]!;
    const value: unknown = body[name];
    const relayState: unknown = body["RelayState"];

    if (
      typeof value !== "string" ||
      !value ||
      value.length > MAX_SAML_MESSAGE_BYTES * 2 ||
      (relayState !== undefined && typeof relayState !== "string")
    ) {
      throw new SamlLogoutRefusal(
        "The SAML sign-out message is not a single base64 text of a sane size.",
      );
    }

    const xml: string = Buffer.from(value, "base64").toString("utf8");

    if (Buffer.byteLength(xml, "utf8") > MAX_SAML_MESSAGE_BYTES) {
      throw new SamlLogoutRefusal("The SAML sign-out message is too long.");
    }

    return {
      kind:
        name === "SAMLRequest"
          ? SamlLogoutMessageKind.Request
          : SamlLogoutMessageKind.Response,
      binding: SamlBinding.Post,
      xml: xml,
      relayState: typeof relayState === "string" ? relayState : null,
      redirectSignature: null,
    };
  }

  /*
   * A LogoutResponse, checked against the provider's certificate when it is
   * signed, and read from what the signature covers. Throws
   * SamlLogoutRefusal for a signature that does not verify, or a message
   * that is not a LogoutResponse.
   */
  public static readLogoutResponse(data: {
    message: ReceivedSamlLogoutMessage;
    certificate: string;
  }): ReadLogoutResponse {
    const { root, isSigned } = SamlSingleLogout.verifyMessage({
      message: data.message,
      certificate: data.certificate,
      expectedRoot: SamlLogoutMessageKind.Response,
    });

    return {
      isSigned: isSigned,
      id: SamlSingleLogout.getOptionalAttribute(root, "ID") || "",
      inResponseTo: SamlSingleLogout.getOptionalAttribute(root, "InResponseTo"),
      destination: SamlSingleLogout.getOptionalAttribute(root, "Destination"),
      issuer: SamlSingleLogout.getIssuer(root),
      statusCode: SamlSingleLogout.getStatusCode(root),
    };
  }

  /*
   * A LogoutRequest, checked against the provider's certificate, and read
   * from what the signature covers. One that is not signed, or whose
   * signature does not verify, is refused: it ends sessions.
   */
  public static readLogoutRequest(data: {
    message: ReceivedSamlLogoutMessage;
    certificate: string;
  }): ReadLogoutRequest {
    const { root, isSigned } = SamlSingleLogout.verifyMessage({
      message: data.message,
      certificate: data.certificate,
      expectedRoot: SamlLogoutMessageKind.Request,
    });

    if (!isSigned) {
      throw new SamlLogoutRefusal(
        "The identity provider's sign-out request is not signed.",
      );
    }

    for (const refused of ["EncryptedID", "BaseID"]) {
      if (SamlSingleLogout.getChildren(root, refused).length > 0) {
        throw new SamlLogoutRefusal(
          `A sign-out request that names the person by ${refused} is not supported.`,
        );
      }
    }

    const nameIds: Array<XmlElement> = SamlSingleLogout.getChildren(
      root,
      "NameID",
      SAML_ASSERTION_NAMESPACE,
    );

    if (nameIds.length !== 1) {
      throw new SamlLogoutRefusal(
        "The identity provider's sign-out request names no one person.",
      );
    }

    const nameId: string = SamlSingleLogout.getPlainText(nameIds[0]!);

    if (!isUsableSamlSignOutValue(nameId)) {
      throw new SamlLogoutRefusal(
        "The identity provider's sign-out request names no one person.",
      );
    }

    const sessionIndexes: Array<string> = SamlSingleLogout.getChildren(
      root,
      "SessionIndex",
      SAML_PROTOCOL_NAMESPACE,
    ).map((element: XmlElement): string => {
      return SamlSingleLogout.getPlainText(element);
    });

    return {
      isSigned: isSigned,
      id: SamlSingleLogout.getOptionalAttribute(root, "ID") || "",
      destination: SamlSingleLogout.getOptionalAttribute(root, "Destination"),
      issuer: SamlSingleLogout.getIssuer(root),
      issueInstant: SamlSingleLogout.readTime(root, "IssueInstant"),
      notOnOrAfter: SamlSingleLogout.readTime(root, "NotOnOrAfter"),
      nameId: nameId,
      sessionIndexes: sessionIndexes.filter((value: string): boolean => {
        return Boolean(value);
      }),
    };
  }

  /*
   * Whether a LogoutResponse confirms that the identity provider signed the
   * person out: from this provider, to this Single Logout URL, answering a
   * LogoutRequest OneUptime sent for this provider while it waits, with
   * Success. Throws SamlLogoutRefusal, naming what is wrong, otherwise.
   */
  public static assertConfirmsSignOut(data: {
    response: ReadLogoutResponse;
    provider: SamlSignOutProvider;
    signingKey: SamlSigningKey;
    now: Date;
  }): void {
    SamlSingleLogout.assertFromProviderToUs({
      issuer: data.response.issuer,
      destination: data.response.destination,
      isSigned: data.response.isSigned,
      provider: data.provider,
    });

    if (
      !SamlSingleLogout.isOwnRequestId({
        requestId: data.response.inResponseTo,
        provider: data.provider,
        signingKey: data.signingKey,
        now: data.now,
      })
    ) {
      throw new SamlLogoutRefusal(
        "The sign-out response answers no sign-out request OneUptime sent for this provider, or came too late.",
      );
    }

    if (data.response.statusCode !== SAML_STATUS_SUCCESS) {
      throw new SamlLogoutRefusal(
        `The identity provider did not sign the person out: ${SamlSingleLogout.describeStatusCode(
          data.response.statusCode,
        )}.`,
      );
    }
  }

  /*
   * Whether an identity provider's own LogoutRequest may be acted on: from
   * this provider, to this Single Logout URL, and in its time. Its
   * signature was checked when it was read.
   */
  public static assertRequestIsForUs(data: {
    request: ReadLogoutRequest;
    provider: SamlSignOutProvider;
    now: Date;
  }): void {
    SamlSingleLogout.assertFromProviderToUs({
      issuer: data.request.issuer,
      destination: data.request.destination,
      isSigned: data.request.isSigned,
      provider: data.provider,
    });

    if (!data.request.id || data.request.id.length > MAX_SAML_ID_LENGTH) {
      throw new SamlLogoutRefusal(
        "The sign-out request has no ID OneUptime can answer to.",
      );
    }

    const now: number = data.now.getTime();

    if (
      data.request.notOnOrAfter !== null &&
      now >= data.request.notOnOrAfter + LOGOUT_CLOCK_SKEW_IN_MS
    ) {
      throw new SamlLogoutRefusal("The sign-out request has expired.");
    }

    if (
      data.request.issueInstant === null ||
      now < data.request.issueInstant - LOGOUT_CLOCK_SKEW_IN_MS ||
      now >=
        data.request.issueInstant +
          LOGOUT_REQUEST_LIFETIME_IN_MS +
          LOGOUT_CLOCK_SKEW_IN_MS
    ) {
      throw new SamlLogoutRefusal(
        "The sign-out request was not issued in the last few minutes.",
      );
    }
  }

  /*
   * Whether a session's record is one an identity provider's LogoutRequest
   * names: the same person, by the very Name ID the assertion had, and -
   * when the request names sessions - one of them. A session that kept no
   * SessionIndex is named by the person alone.
   */
  public static isNamedBy(data: {
    request: ReadLogoutRequest;
    record: SamlIdentityProviderSignOutRecord;
  }): boolean {
    if (data.record.nameId !== data.request.nameId) {
      return false;
    }

    if (data.request.sessionIndexes.length === 0 || !data.record.sessionIndex) {
      return true;
    }

    return data.request.sessionIndexes.includes(data.record.sessionIndex);
  }

  // A RelayState to echo back: as sent, unless it is longer than any should be.
  public static relayStateToEcho(relayState: string | null): string | null {
    if (!relayState || relayState.length > MAX_RELAY_STATE_LENGTH) {
      return null;
    }

    return relayState;
  }

  /*
   * -------------------------------------------------------------------------
   * Checking a message.
   * -------------------------------------------------------------------------
   */

  /*
   * The message's root element, from what its signature covers, and whether
   * it was signed. A signature that is there must verify against the
   * provider's certificate.
   */
  private static verifyMessage(data: {
    message: ReceivedSamlLogoutMessage;
    certificate: string;
    expectedRoot: SamlLogoutMessageKind;
  }): { root: XmlElement; isSigned: boolean } {
    if (data.message.kind !== data.expectedRoot) {
      throw new SamlLogoutRefusal(
        `The SAML sign-out message is not a ${data.expectedRoot}.`,
      );
    }

    const dom: XmlDocument = SamlSingleLogout.parse(data.message.xml);
    const root: XmlElement = SamlSingleLogout.getRoot(dom, data.expectedRoot);

    if (data.message.binding === SamlBinding.Redirect) {
      if (!data.message.redirectSignature) {
        return { root, isSigned: false };
      }

      /*
       * The query's signature covers the whole message, as sent: nothing
       * inside it can be moved out from under it.
       */
      SamlSingleLogout.assertRedirectSignature({
        redirectSignature: data.message.redirectSignature,
        certificate: data.certificate,
      });

      return { root, isSigned: true };
    }

    const signedRoot: XmlElement | null = SamlSingleLogout.verifyPostSignature({
      xml: data.message.xml,
      dom: dom,
      root: root,
      certificate: data.certificate,
      expectedRoot: data.expectedRoot,
    });

    return signedRoot
      ? { root: signedRoot, isSigned: true }
      : { root, isSigned: false };
  }

  /*
   * The HTTP-Redirect binding's signature: over the parameters exactly as
   * sent, with an RSA algorithm this knows, against the provider's
   * certificate.
   */
  private static assertRedirectSignature(data: {
    redirectSignature: NonNullable<
      ReceivedSamlLogoutMessage["redirectSignature"]
    >;
    certificate: string;
  }): void {
    const hash: string | undefined = REDIRECT_SIGNATURE_HASHES.get(
      data.redirectSignature.signatureAlgorithm,
    );

    if (!hash) {
      throw new SamlLogoutRefusal(
        "The SAML sign-out message is signed with an algorithm OneUptime does not check.",
      );
    }

    let isValid: boolean = false;

    try {
      isValid = crypto.verify(
        hash,
        Buffer.from(data.redirectSignature.signedOctets, "utf8"),
        SamlSingleLogout.getPublicKey(data.certificate),
        data.redirectSignature.signature,
      );
    } catch (err) {
      logger.warn(err);
      isValid = false;
    }

    if (!isValid) {
      throw new SamlLogoutRefusal(
        "The SAML sign-out message's signature does not verify against the provider's certificate.",
      );
    }
  }

  /*
   * The HTTP-POST binding's enveloped XML signature, held to the same rules
   * as a sign-in's (SSOUtil.getSamlResponseFromXML): at most one
   * <Signature>, a direct child of the message, with nothing to read inside
   * it; it verifies against the provider's certificate - never a key the
   * message carries - and a reference it verifies resolves to the message
   * itself. The message is then read again from the canonical bytes the
   * signature covers, so what is read is what was signed.
   *
   * Null when the message carries no signature; throws when it carries one
   * that does not verify, or not over the message.
   */
  private static verifyPostSignature(data: {
    xml: string;
    dom: XmlDocument;
    root: XmlElement;
    certificate: string;
    expectedRoot: SamlLogoutMessageKind;
  }): XmlElement | null {
    const signatures: Array<XmlElement> = SamlSingleLogout.toElementArray(
      data.dom.getElementsByTagNameNS(XMLDSIG_NAMESPACE, "Signature"),
    );

    if (signatures.length === 0) {
      return null;
    }

    if (signatures.length > 1 || signatures[0]!.parentNode !== data.root) {
      throw new SamlLogoutRefusal(
        "A SAML sign-out message carries one signature, as a direct child of the message.",
      );
    }

    const signature: XmlElement = signatures[0]!;

    for (const element of SamlSingleLogout.toElementArray(
      signature.getElementsByTagName("*"),
    )) {
      if (
        (element.namespaceURI === XMLDSIG_NAMESPACE &&
          element.localName === "Object") ||
        element.namespaceURI === SAML_PROTOCOL_NAMESPACE ||
        element.namespaceURI === SAML_ASSERTION_NAMESPACE
      ) {
        throw new SamlLogoutRefusal(
          "A SAML sign-out message's signature carries no content of its own.",
        );
      }
    }

    let signedXml: string | null = null;

    try {
      const sig: SignedXml = new SignedXml({
        publicCert: SamlSingleLogout.toPem(data.certificate),
        // The provider's own certificate, never one the message staples on.
        getCertFromKeyInfo: (): null => {
          return null;
        },
      });

      sig.loadSignature(signature.toString());

      if (sig.checkSignature(data.xml)) {
        for (const reference of sig.getReferences()) {
          if (
            SamlSingleLogout.referenceCoversRoot(
              data.dom,
              data.root,
              reference.uri,
            )
          ) {
            signedXml = SamlSingleLogout.getSignedReferenceXml(reference);

            if (signedXml) {
              break;
            }
          }
        }
      }
    } catch (err) {
      logger.warn(err);
      signedXml = null;
    }

    if (!signedXml) {
      throw new SamlLogoutRefusal(
        "The SAML sign-out message's signature does not verify against the provider's certificate.",
      );
    }

    const signedRoot: XmlElement = SamlSingleLogout.getRoot(
      SamlSingleLogout.parse(signedXml),
      data.expectedRoot,
    );

    if (
      SamlSingleLogout.getOptionalAttribute(signedRoot, "ID") !==
      SamlSingleLogout.getOptionalAttribute(data.root, "ID")
    ) {
      throw new SamlLogoutRefusal(
        "The signed SAML sign-out message is not the message sent.",
      );
    }

    return signedRoot;
  }

  /*
   * Whether a verified reference's URI names the message itself: "" (the
   * whole document, whose root is the message), or "#" and the message's
   * ID, which no other element of the document carries.
   */
  private static referenceCoversRoot(
    dom: XmlDocument,
    root: XmlElement,
    uri: string | undefined,
  ): boolean {
    if (!uri) {
      return true;
    }

    const id: string = uri.charAt(0) === "#" ? uri.substring(1) : uri;

    const carriers: Array<XmlElement> = SamlSingleLogout.toElementArray(
      dom.getElementsByTagName("*"),
    ).filter((element: XmlElement): boolean => {
      return ["ID", "Id", "id"].some((name: string): boolean => {
        return element.getAttribute(name) === id;
      });
    });

    return carriers.length === 1 && carriers[0] === root;
  }

  // The canonical bytes a verified reference covers, or null.
  private static getSignedReferenceXml(reference: Reference): string | null {
    const signedReference: unknown = reference.signedReference;

    return typeof signedReference === "string" && signedReference
      ? signedReference
      : null;
  }

  /*
   * Whether the Issuer a sign-out message names is the provider's identity
   * provider: the provider's Issuer exactly - or, for Microsoft Entra ID,
   * the same tenant. Entra issues assertions as
   * https://sts.windows.net/<tenant>/, the Microsoft Entra Identifier
   * admins enter as the Issuer, and its sign-out messages as
   * https://login.microsoftonline.com/<tenant>/ (Microsoft's Single
   * Sign-Out SAML Protocol), in its national clouds by their own hosts.
   */
  public static isIdentityProviderIssuer(
    candidate: string,
    configured: string,
  ): boolean {
    const issuer: string = candidate.trim();
    const expected: string = configured.trim();

    if (!issuer || !expected) {
      return false;
    }

    if (issuer === expected) {
      return true;
    }

    const entraTenantOf: (value: string) => string | null = (
      value: string,
    ): string | null => {
      const match: RegExpExecArray | null = ENTRA_ISSUER_PATTERN.exec(value);

      return match ? match[1]!.toLowerCase() : null;
    };

    const tenant: string | null = entraTenantOf(issuer);

    return Boolean(tenant && tenant === entraTenantOf(expected));
  }

  /*
   * The ID of a LogoutRequest that was not taken, to answer it with: read
   * from a well-formed LogoutRequest, trusted for nothing else, and only
   * when it is short enough to be an ID. Null otherwise.
   */
  public static peekRequestId(
    message: ReceivedSamlLogoutMessage,
  ): string | null {
    if (message.kind !== SamlLogoutMessageKind.Request) {
      return null;
    }

    try {
      const id: string | null = SamlSingleLogout.getOptionalAttribute(
        SamlSingleLogout.getRoot(
          SamlSingleLogout.parse(message.xml),
          SamlLogoutMessageKind.Request,
        ),
        "ID",
      );

      return id && id.length <= MAX_SAML_ID_LENGTH ? id : null;
    } catch {
      return null;
    }
  }

  /*
   * Issuer and Destination, held to this provider and to OneUptime's address
   * for it. A signed message must name the address it was sent to (SAML 2.0
   * Bindings 3.4.5.2 and 3.5.5.2), so the signature covers where it was
   * meant to go; an unsigned one may leave it out.
   */
  private static assertFromProviderToUs(data: {
    issuer: string | null;
    destination: string | null;
    isSigned: boolean;
    provider: SamlSignOutProvider;
  }): void {
    if (
      !data.issuer ||
      !SamlSingleLogout.isIdentityProviderIssuer(
        data.issuer,
        data.provider.issuerUrl,
      )
    ) {
      throw new SamlLogoutRefusal(
        "The SAML sign-out message is not from this provider's identity provider: its Issuer does not match.",
      );
    }

    if (data.isSigned && !data.destination) {
      throw new SamlLogoutRefusal(
        "The signed SAML sign-out message names no Destination, which a signed message must.",
      );
    }

    if (
      data.destination &&
      !SamlServiceProviders.isSameAddress(
        data.destination,
        data.provider.singleLogoutUrl,
      )
    ) {
      throw new SamlLogoutRefusal(
        "The SAML sign-out message was sent to another address: its Destination is not this provider's Single Logout URL.",
      );
    }
  }

  /*
   * -------------------------------------------------------------------------
   * Small helpers.
   * -------------------------------------------------------------------------
   */

  private static parse(xml: string): XmlDocument {
    try {
      return SSOUtil.parseXmlStrict(xml);
    } catch {
      throw new SamlLogoutRefusal(
        "The SAML sign-out message is not well-formed XML that OneUptime reads.",
      );
    }
  }

  // The document's root: a protocol message of the kind expected.
  private static getRoot(
    dom: XmlDocument,
    kind: SamlLogoutMessageKind,
  ): XmlElement {
    const root: XmlElement | null = dom.documentElement;

    if (
      !root ||
      root.localName !== kind ||
      root.namespaceURI !== SAML_PROTOCOL_NAMESPACE
    ) {
      throw new SamlLogoutRefusal(
        `The SAML sign-out message is not a ${kind}.`,
      );
    }

    return root;
  }

  // The message's own Issuer: its one direct child of that name, as plain text.
  private static getIssuer(root: XmlElement): string | null {
    const issuers: Array<XmlElement> = SamlSingleLogout.getChildren(
      root,
      "Issuer",
      SAML_ASSERTION_NAMESPACE,
    );

    if (issuers.length > 1) {
      throw new SamlLogoutRefusal(
        "The SAML sign-out message names more than one Issuer.",
      );
    }

    return issuers[0]
      ? SamlSingleLogout.getPlainText(issuers[0]) || null
      : null;
  }

  // The top-level StatusCode of a LogoutResponse, or null when it has none.
  private static getStatusCode(root: XmlElement): string | null {
    const statuses: Array<XmlElement> = SamlSingleLogout.getChildren(
      root,
      "Status",
      SAML_PROTOCOL_NAMESPACE,
    );

    if (statuses.length !== 1) {
      return null;
    }

    const codes: Array<XmlElement> = SamlSingleLogout.getChildren(
      statuses[0]!,
      "StatusCode",
      SAML_PROTOCOL_NAMESPACE,
    );

    return codes.length === 1
      ? SamlSingleLogout.getOptionalAttribute(codes[0]!, "Value")
      : null;
  }

  // A status code for the log: only when it looks like one.
  private static describeStatusCode(statusCode: string | null): string {
    return statusCode && STATUS_CODE_PATTERN.test(statusCode)
      ? statusCode
      : "no status";
  }

  // A time attribute in milliseconds, or null when absent. One that is not a time is refused.
  private static readTime(
    element: XmlElement,
    attributeName: string,
  ): number | null {
    const value: string | null = SamlSingleLogout.getOptionalAttribute(
      element,
      attributeName,
    );

    if (value === null) {
      return null;
    }

    const time: number | null = SSOUtil.parseSamlTime(value);

    if (time === null) {
      throw new SamlLogoutRefusal(
        `The SAML sign-out message has an invalid ${attributeName}.`,
      );
    }

    return time;
  }

  // Direct children by local name, in a namespace when one is given.
  private static getChildren(
    parent: XmlElement,
    localName: string,
    namespace?: string,
  ): Array<XmlElement> {
    const children: Array<XmlElement> = [];

    for (
      let child: XmlNode | null = parent.firstChild;
      child;
      child = child.nextSibling
    ) {
      if (
        child.nodeType === 1 &&
        (child as XmlElement).localName === localName &&
        (!namespace || (child as XmlElement).namespaceURI === namespace)
      ) {
        children.push(child as XmlElement);
      }
    }

    return children;
  }

  /*
   * An element's text, which must be text and nothing else: a comment, a
   * processing instruction or an element inside a value would make two
   * readers of it disagree (SSOUtil.assertPlainTextOnly).
   */
  private static getPlainText(element: XmlElement): string {
    for (
      let child: XmlNode | null = element.firstChild;
      child;
      child = child.nextSibling
    ) {
      if (child.nodeType !== 3 && child.nodeType !== 4) {
        throw new SamlLogoutRefusal(
          "A value of the SAML sign-out message is not plain text.",
        );
      }
    }

    return (element.textContent || "").trim();
  }

  private static getOptionalAttribute(
    element: XmlElement,
    attributeName: string,
  ): string | null {
    if (!element.hasAttribute(attributeName)) {
      return null;
    }

    const value: string = (element.getAttribute(attributeName) || "").trim();

    return value || null;
  }

  private static toElementArray(collection: {
    length: number;
    item?: (index: number) => XmlNode | null;
  }): Array<XmlElement> {
    const elements: Array<XmlElement> = [];

    for (let index: number = 0; index < collection.length; index++) {
      const node: XmlNode | null = collection.item
        ? collection.item(index)
        : (collection as unknown as Array<XmlNode>)[index] || null;

      if (node && node.nodeType === 1) {
        elements.push(node as XmlElement);
      }
    }

    return elements;
  }

  /*
   * The provider's certificate as PEM: as pasted, or the bare base64 of one
   * wrapped in its BEGIN and END lines.
   */
  private static toPem(certificate: string): string {
    const text: string = certificate.trim();

    if (text.includes("-----BEGIN")) {
      return text;
    }

    const base64: string = text.replace(/\s+/g, "");
    const lines: Array<string> = [];

    for (let index: number = 0; index < base64.length; index += 64) {
      lines.push(base64.substring(index, index + 64));
    }

    return `-----BEGIN CERTIFICATE-----\n${lines.join("\n")}\n-----END CERTIFICATE-----\n`;
  }

  private static getPublicKey(certificate: string): crypto.KeyObject {
    return crypto.createPublicKey(SamlSingleLogout.toPem(certificate));
  }

  /*
   * A query's parameters, each name decoded and each value as sent. A
   * parameter OneUptime does not read is kept too: it is not signed over,
   * and nothing reads it.
   */
  private static parseRawQuery(rawQuery: string): Array<RawQueryParameter> {
    return rawQuery
      .split("&")
      .filter((part: string): boolean => {
        return part.length > 0;
      })
      .map((part: string): RawQueryParameter => {
        const at: number = part.indexOf("=");
        const rawName: string = at < 0 ? part : part.substring(0, at);

        return {
          name: SamlSingleLogout.decodeQueryValue(rawName),
          rawValue: at < 0 ? "" : part.substring(at + 1),
        };
      });
  }

  // A query value as text: "+" is a space, as forms write one.
  private static decodeQueryValue(rawValue: string): string {
    try {
      return decodeURIComponent(rawValue.replace(/\+/g, "%20"));
    } catch {
      throw new SamlLogoutRefusal(
        "The SAML sign-out message's query is not encoded as a URL's.",
      );
    }
  }

  /*
   * A query value that is base64: "+" stays "+". Base64 holds no spaces, so
   * an identity provider that left a "+" unencoded meant a "+".
   */
  private static decodeBase64Value(rawValue: string): string {
    try {
      return decodeURIComponent(rawValue);
    } catch {
      throw new SamlLogoutRefusal(
        "The SAML sign-out message's query is not encoded as a URL's.",
      );
    }
  }

  // The HMAC of a request ID, keyed by a key derived from the signing key.
  private static requestIdMac(data: {
    provider: Pick<SamlSignOutProvider, "providerType" | "providerId">;
    signingKey: SamlSigningKey;
    nonce: string;
    endsAt: string;
  }): string {
    const key: Buffer = crypto
      .createHash("sha256")
      .update("oneuptime-saml-logout-request-id\n", "utf8")
      .update(data.signingKey.privateKey, "utf8")
      .digest();

    return crypto
      .createHmac("sha256", key)
      .update(
        `${data.provider.providerType}\n${data.provider.providerId.toLowerCase()}\n${data.nonce}\n${data.endsAt}`,
        "utf8",
      )
      .digest("hex")
      .substring(0, 32);
  }

  // ` name="value"`, escaped, or nothing when there is no value.
  private static attribute(
    name: string,
    value: string | null | undefined,
  ): string {
    if (value === null || value === undefined || value === "") {
      return "";
    }

    return ` ${name}="${SamlSingleLogout.escapeXml(value)}"`;
  }

  public static escapeXml(value: string): string {
    return value
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&apos;");
  }
}
