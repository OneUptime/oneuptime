/*
 * Signing helpers for the SAML tests.
 *
 * Keys are generated at runtime — nothing secret is committed — and xml-crypto
 * verifies against a raw public key just as well as against an X.509
 * certificate, so the generated public key PEM stands in for the provider's
 * configured `publicCertificate`.
 */
import crypto from "crypto";
import { SignedXml } from "xml-crypto";

export const XMLDSIG_ENVELOPED: string =
  "http://www.w3.org/2000/09/xmldsig#enveloped-signature";
export const XMLDSIG_EXC_C14N: string =
  "http://www.w3.org/2001/10/xml-exc-c14n#";
export const XMLENC_SHA256: string = "http://www.w3.org/2001/04/xmlenc#sha256";
export const RSA_SHA256: string =
  "http://www.w3.org/2001/04/xmldsig-more#rsa-sha256";

export const SAML_STATUS_SUCCESS: string =
  "urn:oasis:names:tc:SAML:2.0:status:Success";

export interface SamlKeyPair {
  privateKey: string;
  publicKey: string;
}

export function generateRsaKeyPair(): SamlKeyPair {
  const { privateKey, publicKey } = crypto.generateKeyPairSync("rsa", {
    modulusLength: 2048,
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  });

  return { privateKey, publicKey };
}

export interface SignOptions {
  // XPath of the element whose content is digested.
  referenceXPath: string;
  privateKey: string;
  /*
   * Where the <Signature> element is inserted. Defaults to appending it into
   * the referenced element, which is where most providers put it.
   */
  location?:
    | {
        reference: string;
        action: "append" | "prepend" | "before" | "after";
      }
    | undefined;
}

export function signXml(xml: string, options: SignOptions): string {
  const sig: SignedXml = new SignedXml({
    privateKey: options.privateKey,
    signatureAlgorithm: RSA_SHA256,
    canonicalizationAlgorithm: XMLDSIG_EXC_C14N,
    getKeyInfoContent: (): string => {
      return "<X509Data></X509Data>";
    },
  });

  sig.addReference({
    xpath: options.referenceXPath,
    transforms: [XMLDSIG_ENVELOPED, XMLDSIG_EXC_C14N],
    digestAlgorithm: XMLENC_SHA256,
  });

  sig.computeSignature(xml, {
    location: options.location ?? {
      reference: options.referenceXPath,
      action: "append",
    },
  });

  return sig.getSignedXml();
}

/*
 * Sign the single element with this local name. Providers sign either the
 * Assertion or the whole Response; both are exercised.
 */
export function signElement(
  xml: string,
  localName: string,
  privateKey: string,
): string {
  return signXml(xml, {
    referenceXPath: `//*[local-name(.)='${localName}']`,
    privateKey,
  });
}

/*
 * Sign an element but place the <Signature> immediately after the assertion's
 * <Issuer>, which is where Okta, Entra ID, ADFS and Shibboleth actually put it.
 */
export function signElementAfterIssuer(
  xml: string,
  localName: string,
  privateKey: string,
): string {
  return signXml(xml, {
    referenceXPath: `//*[local-name(.)='${localName}']`,
    privateKey,
    location: {
      reference: `//*[local-name(.)='${localName}']/*[local-name(.)='Issuer']`,
      action: "after",
    },
  });
}

export function toBase64(xml: string): string {
  return Buffer.from(xml).toString("base64");
}

/*
 * ---------------------------------------------------------------------------
 * A whole SAML Response, shaped like the ones identity providers send.
 *
 * Besides who signed it and who it names, a response says who it is for (the
 * Audience, the Recipient and the Destination) and when it may be used
 * (IssueInstant, NotBefore, NotOnOrAfter). Every one of those is an option
 * here, so a test can move exactly one of them. `null` leaves a part out.
 * ---------------------------------------------------------------------------
 */

export const SAML_BEARER_METHOD: string =
  "urn:oasis:names:tc:SAML:2.0:cm:bearer";

export const MS_DISPLAY_NAME_CLAIM: string =
  "http://schemas.microsoft.com/identity/claims/displayname";

const MINUTE_IN_MS: number = 60 * 1000;

export function samlTime(date: Date): string {
  return date.toISOString();
}

export function minutesAfter(date: Date, minutes: number): Date {
  return new Date(date.getTime() + minutes * MINUTE_IN_MS);
}

export interface SamlSubjectConfirmationOptions {
  method?: string | undefined;
  // null: a SubjectConfirmation with no SubjectConfirmationData.
  data?:
    | {
        recipient?: string | null | undefined;
        notBefore?: Date | null | undefined;
        notOnOrAfter?: Date | null | undefined;
        inResponseTo?: string | null | undefined;
      }
    | null
    | undefined;
}

export interface SamlResponseOptions {
  issuer: string;
  email: string;
  // When the identity provider made the assertion.
  issuedAt: Date;
  /*
   * Who the assertion is for: each inner list is one <AudienceRestriction>.
   * [] sends a <Conditions> with no audience at all.
   */
  audienceRestrictions: Array<Array<string>>;
  // The Reply URL the response was sent to (null leaves the Recipient out).
  recipient: string | null;
  destination?: string | null | undefined;
  inResponseTo?: string | null | undefined;
  responseId?: string | undefined;
  assertionId?: string | null | undefined;
  // An IssueInstant other than `issuedAt`, written as is (null leaves it out).
  rawIssueInstant?: string | null | undefined;
  conditionsNotBefore?: Date | null | undefined;
  conditionsNotOnOrAfter?: Date | null | undefined;
  subjectNotOnOrAfter?: Date | null | undefined;
  // Replaces the default single bearer SubjectConfirmation.
  subjectConfirmations?: Array<SamlSubjectConfirmationOptions> | undefined;
  // Replaces the whole <Conditions> element ("" leaves it out).
  rawConditions?: string | undefined;
  displayName?: string | null | undefined;
  /*
   * The assertion's attributes, as [Name, value] pairs written as they are:
   * an <AttributeStatement> of them, in place of the displayName claim.
   */
  attributes?: Array<[name: string, value: string]> | undefined;
}

function attribute(name: string, value: string | null | undefined): string {
  if (value === null || value === undefined) {
    return "";
  }

  return ` ${name}="${value}"`;
}

function timeAttribute(name: string, value: Date | null | undefined): string {
  if (value === null || value === undefined) {
    return "";
  }

  return attribute(name, samlTime(value));
}

function subjectConfirmationXml(
  confirmation: SamlSubjectConfirmationOptions,
): string {
  const method: string = confirmation.method ?? SAML_BEARER_METHOD;

  if (confirmation.data === null) {
    return `<saml:SubjectConfirmation Method="${method}"/>`;
  }

  const data: NonNullable<SamlSubjectConfirmationOptions["data"]> =
    confirmation.data ?? {};

  return `<saml:SubjectConfirmation Method="${method}"><saml:SubjectConfirmationData${attribute(
    "InResponseTo",
    data.inResponseTo,
  )}${timeAttribute("NotBefore", data.notBefore)}${timeAttribute(
    "NotOnOrAfter",
    data.notOnOrAfter,
  )}${attribute("Recipient", data.recipient)}/></saml:SubjectConfirmation>`;
}

export function buildSamlResponse(options: SamlResponseOptions): string {
  const issuedAt: Date = options.issuedAt;
  const issueInstant: string | null =
    options.rawIssueInstant === undefined
      ? samlTime(issuedAt)
      : options.rawIssueInstant;

  const assertionId: string | null =
    options.assertionId === undefined
      ? `_assertion_${issuedAt.getTime()}`
      : options.assertionId;

  const inResponseTo: string | null | undefined = options.inResponseTo;

  const subjectConfirmations: Array<SamlSubjectConfirmationOptions> =
    options.subjectConfirmations ?? [
      {
        data: {
          recipient: options.recipient,
          notOnOrAfter:
            options.subjectNotOnOrAfter === undefined
              ? minutesAfter(issuedAt, 5)
              : options.subjectNotOnOrAfter,
          inResponseTo: inResponseTo,
        },
      },
    ];

  const conditions: string =
    options.rawConditions !== undefined
      ? options.rawConditions
      : `<saml:Conditions${timeAttribute(
          "NotBefore",
          options.conditionsNotBefore === undefined
            ? minutesAfter(issuedAt, -5)
            : options.conditionsNotBefore,
        )}${timeAttribute(
          "NotOnOrAfter",
          options.conditionsNotOnOrAfter === undefined
            ? minutesAfter(issuedAt, 5)
            : options.conditionsNotOnOrAfter,
        )}>${options.audienceRestrictions
          .map((audiences: Array<string>): string => {
            return `<saml:AudienceRestriction>${audiences
              .map((audience: string): string => {
                return `<saml:Audience>${audience}</saml:Audience>`;
              })
              .join("")}</saml:AudienceRestriction>`;
          })
          .join("")}</saml:Conditions>`;

  const attributeStatement: string = options.attributes
    ? `<saml:AttributeStatement>${options.attributes
        .map(([name, value]: [string, string]): string => {
          return `<saml:Attribute Name="${name}"><saml:AttributeValue>${value}</saml:AttributeValue></saml:Attribute>`;
        })
        .join("")}</saml:AttributeStatement>`
    : options.displayName === null || options.displayName === undefined
      ? ""
      : `<saml:AttributeStatement><saml:Attribute Name="${MS_DISPLAY_NAME_CLAIM}"><saml:AttributeValue>${options.displayName}</saml:AttributeValue></saml:Attribute></saml:AttributeStatement>`;

  return `<samlp:Response xmlns:samlp="urn:oasis:names:tc:SAML:2.0:protocol" xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion" ID="${
    options.responseId ?? `_response_${issuedAt.getTime()}`
  }" Version="2.0" IssueInstant="${samlTime(issuedAt)}"${attribute(
    "Destination",
    options.destination,
  )}${attribute(
    "InResponseTo",
    inResponseTo,
  )}><saml:Issuer>${options.issuer}</saml:Issuer><samlp:Status><samlp:StatusCode Value="${SAML_STATUS_SUCCESS}"/></samlp:Status><saml:Assertion${attribute(
    "ID",
    assertionId,
  )} Version="2.0"${attribute(
    "IssueInstant",
    issueInstant,
  )}><saml:Issuer>${options.issuer}</saml:Issuer><saml:Subject><saml:NameID Format="urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress">${
    options.email
  }</saml:NameID>${subjectConfirmations
    .map(subjectConfirmationXml)
    .join(
      "",
    )}</saml:Subject>${conditions}<saml:AuthnStatement AuthnInstant="${samlTime(
    issuedAt,
  )}"><saml:AuthnContext><saml:AuthnContextClassRef>urn:oasis:names:tc:SAML:2.0:ac:classes:PasswordProtectedTransport</saml:AuthnContextClassRef></saml:AuthnContext></saml:AuthnStatement>${attributeStatement}</saml:Assertion></samlp:Response>`;
}
