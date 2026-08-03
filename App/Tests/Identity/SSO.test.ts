import SSOUtil, {
  VerifiedSamlResponse,
} from "../../FeatureSet/Identity/Utils/SSO";
import Email from "Common/Types/Email";
import URL from "Common/Types/API/URL";
import { describe, expect, test, beforeAll } from "@jest/globals";
import crypto from "crypto";
import { SignedXml } from "xml-crypto";

/*
 * Security regression tests for SAML XML Signature Wrapping (XSW).
 *
 * Background (GitHub issue #2949): the historic implementation validated the
 * first <Signature> element it found and then extracted the identity from an
 * independently parsed tree. An attacker could therefore hide a genuinely
 * signed assertion (e.g. inside <Extensions>) while presenting a forged
 * assertion for consumption - a full authentication bypass.
 *
 * These tests:
 *   1. Prove the genuine ("happy path") SAML flow still works.
 *   2. Prove every wrapping / tampering variant is rejected.
 *
 * Keys are generated at runtime (no secrets committed). xml-crypto verifies
 * against a raw public key just as well as against an X.509 certificate, so the
 * generated public key PEM stands in for the provider's `publicCertificate`.
 */

const XMLDSIG_ENVELOPED: string =
  "http://www.w3.org/2000/09/xmldsig#enveloped-signature";
const XMLDSIG_EXC_C14N: string = "http://www.w3.org/2001/10/xml-exc-c14n#";
const XMLENC_SHA256: string = "http://www.w3.org/2001/04/xmlenc#sha256";
const RSA_SHA256: string = "http://www.w3.org/2001/04/xmldsig-more#rsa-sha256";

const ISSUER: string = "https://idp.example.com/metadata";
const DISPLAY_NAME_CLAIM: string =
  "http://schemas.microsoft.com/identity/claims/displayname";

interface KeyPair {
  privateKey: string;
  publicKey: string;
}

let idpKeys: KeyPair;
let attackerKeys: KeyPair;

function generateRsaKeyPair(): KeyPair {
  const { privateKey, publicKey } = crypto.generateKeyPairSync("rsa", {
    modulusLength: 2048,
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  });
  return { privateKey, publicKey };
}

beforeAll(() => {
  idpKeys = generateRsaKeyPair();
  attackerKeys = generateRsaKeyPair();
});

// ---- SAML document builders ------------------------------------------------

interface AssertionOptions {
  assertionId?: string;
  email?: string;
  issuer?: string;
  displayName?: string | null;
  nameId?: string; // raw NameID inner XML override (for comment tests)
}

function buildAssertion(options: AssertionOptions = {}): string {
  const assertionId: string = options.assertionId ?? "_assertion_genuine";
  const issuer: string = options.issuer ?? ISSUER;
  const nameIdInner: string =
    options.nameId ?? options.email ?? "alice@example.com";

  const attributeStatement: string =
    options.displayName === null
      ? ""
      : `<saml:AttributeStatement><saml:Attribute Name="${DISPLAY_NAME_CLAIM}"><saml:AttributeValue>${
          options.displayName ?? "Alice Example"
        }</saml:AttributeValue></saml:Attribute></saml:AttributeStatement>`;

  return `<saml:Assertion ID="${assertionId}" Version="2.0" IssueInstant="2024-01-01T00:00:00Z"><saml:Issuer>${issuer}</saml:Issuer><saml:Subject><saml:NameID>${nameIdInner}</saml:NameID></saml:Subject>${attributeStatement}</saml:Assertion>`;
}

function buildResponse(
  innerXml: string,
  responseId: string = "_resp1",
): string {
  return `<samlp:Response xmlns:samlp="urn:oasis:names:tc:SAML:2.0:protocol" xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion" ID="${responseId}" Version="2.0" IssueInstant="2024-01-01T00:00:00Z"><saml:Issuer>${ISSUER}</saml:Issuer>${innerXml}</samlp:Response>`;
}

// Sign the single element with the given local name, appending the Signature into it.
function sign(xml: string, localName: string, privateKey: string): string {
  const xpath: string = `//*[local-name(.)='${localName}']`;
  const sig: SignedXml = new SignedXml();
  sig.addReference(xpath, [XMLDSIG_ENVELOPED, XMLDSIG_EXC_C14N], XMLENC_SHA256);
  sig.signatureAlgorithm = RSA_SHA256;
  sig.signingKey = privateKey;
  sig.keyInfoProvider = {
    getKeyInfo: (): string => {
      return "<X509Data></X509Data>";
    },
  } as unknown as SignedXml["keyInfoProvider"];
  sig.computeSignature(xml, {
    location: { reference: xpath, action: "append" },
  });
  return sig.getSignedXml();
}

// Extract the (signed) <saml:Assertion>...</saml:Assertion> block from a document.
function extractAssertion(signedXml: string): string {
  const start: number = signedXml.indexOf("<saml:Assertion");
  const endMarker: string = "</saml:Assertion>";
  const end: number = signedXml.indexOf(endMarker) + endMarker.length;
  return signedXml.substring(start, end);
}

function toBase64(xml: string): string {
  return Buffer.from(xml).toString("base64");
}

// A genuine, assertion-signed response for alice@example.com.
function genuineAssertionSignedResponse(): string {
  return sign(buildResponse(buildAssertion()), "Assertion", idpKeys.privateKey);
}

/*
 * ---------------------------------------------------------------------------
 * Happy path - the genuine flow must keep working.
 * ---------------------------------------------------------------------------
 */

describe("SSOUtil - genuine SAML flow (must not break)", () => {
  test("accepts a genuinely assertion-signed response and extracts identity", () => {
    const xml: string = genuineAssertionSignedResponse();

    expect(SSOUtil.isSignatureValid(xml, idpKeys.publicKey)).toBe(true);

    const result: VerifiedSamlResponse = SSOUtil.getSamlResponseFromXML(
      xml,
      idpKeys.publicKey,
    );

    expect(result.email.toString()).toBe("alice@example.com");
    expect(result.issuerUrl).toBe(ISSUER);
    expect(result.name?.toString()).toBe("Alice Example");
  });

  test("accepts a genuinely response-signed (whole Response) response", () => {
    const xml: string = sign(
      buildResponse(buildAssertion()),
      "Response",
      idpKeys.privateKey,
    );

    expect(SSOUtil.isSignatureValid(xml, idpKeys.publicKey)).toBe(true);

    const result: VerifiedSamlResponse = SSOUtil.getSamlResponseFromXML(
      xml,
      idpKeys.publicKey,
    );

    expect(result.email.toString()).toBe("alice@example.com");
    expect(result.issuerUrl).toBe(ISSUER);
  });

  test("returns null name when no display-name claim is present", () => {
    const xml: string = sign(
      buildResponse(buildAssertion({ displayName: null })),
      "Assertion",
      idpKeys.privateKey,
    );

    const result: VerifiedSamlResponse = SSOUtil.getSamlResponseFromXML(
      xml,
      idpKeys.publicKey,
    );

    expect(result.email.toString()).toBe("alice@example.com");
    expect(result.name).toBeNull();
  });

  test("works when the base64 SAMLResponse is decoded first (end-to-end shape)", () => {
    const xml: string = Buffer.from(
      toBase64(genuineAssertionSignedResponse()),
      "base64",
    ).toString();

    const result: VerifiedSamlResponse = SSOUtil.getSamlResponseFromXML(
      xml,
      idpKeys.publicKey,
    );
    expect(result.email.toString()).toBe("alice@example.com");
  });
});

/*
 * ---------------------------------------------------------------------------
 * Attack path - signature wrapping and tampering must be rejected.
 * ---------------------------------------------------------------------------
 */

describe("SSOUtil - XML Signature Wrapping is rejected (issue #2949)", () => {
  test("rejects a genuine assertion hidden in <Extensions> with a forged sibling assertion", () => {
    const genuineSigned: string = genuineAssertionSignedResponse();
    const genuineAssertion: string = extractAssertion(genuineSigned);

    const forgedAssertion: string = buildAssertion({
      assertionId: "_assertion_forged",
      email: "attacker@evil.com",
      displayName: "Attacker",
    });

    const attack: string = buildResponse(
      `<samlp:Extensions>${genuineAssertion}</samlp:Extensions>${forgedAssertion}`,
    );

    // The signature over the hidden genuine assertion must NOT be accepted.
    expect(SSOUtil.isSignatureValid(attack, idpKeys.publicKey)).toBe(false);

    // And the identity must never be extracted (it must throw, not return attacker@evil.com).
    expect(() => {
      return SSOUtil.getSamlResponseFromXML(attack, idpKeys.publicKey);
    }).toThrow();
  });

  test("rejects a forged assertion that nests the genuine signed assertion inside it", () => {
    const genuineSigned: string = genuineAssertionSignedResponse();
    const genuineAssertion: string = extractAssertion(genuineSigned);

    // Forged outer assertion whose Subject wraps the genuine signed assertion.
    const attack: string = buildResponse(
      `<saml:Assertion ID="_assertion_forged" Version="2.0" IssueInstant="2024-01-01T00:00:00Z"><saml:Issuer>${ISSUER}</saml:Issuer><saml:Subject><saml:NameID>attacker@evil.com</saml:NameID></saml:Subject>${genuineAssertion}</saml:Assertion>`,
    );

    expect(SSOUtil.isSignatureValid(attack, idpKeys.publicKey)).toBe(false);
    expect(() => {
      return SSOUtil.getSamlResponseFromXML(attack, idpKeys.publicKey);
    }).toThrow();
  });

  test("rejects a forged lone assertion with a valid signature over an unrelated element", () => {
    /*
     * The attacker holds a genuine signature over a non-assertion element (a
     * signed <Dummy>), and pairs it with a single forged assertion.
     */
    const signedDummyDoc: string = sign(
      buildResponse(
        `<samlp:Extensions><Dummy ID="_dummy1">trusted-but-irrelevant</Dummy></samlp:Extensions><saml:Assertion ID="_placeholder" Version="2.0" IssueInstant="2024-01-01T00:00:00Z"><saml:Issuer>${ISSUER}</saml:Issuer><saml:Subject><saml:NameID>alice@example.com</saml:NameID></saml:Subject></saml:Assertion>`,
      ),
      "Dummy",
      idpKeys.privateKey,
    );

    // Grab the genuinely signed <Dummy> element.
    const dummyStart: number = signedDummyDoc.indexOf("<Dummy");
    const dummyEnd: number =
      signedDummyDoc.indexOf("</Dummy>") + "</Dummy>".length;
    const signedDummy: string = signedDummyDoc.substring(dummyStart, dummyEnd);

    const forgedAssertion: string = buildAssertion({
      assertionId: "_assertion_forged",
      email: "attacker@evil.com",
    });

    const attack: string = buildResponse(
      `<samlp:Extensions>${signedDummy}</samlp:Extensions>${forgedAssertion}`,
    );

    // The signature over <Dummy> validates, but it does not cover the assertion.
    expect(SSOUtil.isSignatureValid(attack, idpKeys.publicKey)).toBe(false);
    expect(() => {
      return SSOUtil.getSamlResponseFromXML(attack, idpKeys.publicKey);
    }).toThrow();
  });

  test("rejects two assertions sharing the same ID (issue PoC shape)", () => {
    const genuineSigned: string = sign(
      buildResponse(buildAssertion({ assertionId: "_dup" })),
      "Assertion",
      idpKeys.privateKey,
    );
    const genuineAssertion: string = extractAssertion(genuineSigned);

    const forgedAssertion: string = buildAssertion({
      assertionId: "_dup",
      email: "attacker@evil.com",
    });

    const attack: string = buildResponse(
      `<samlp:Extensions>${genuineAssertion}</samlp:Extensions>${forgedAssertion}`,
    );

    expect(SSOUtil.isSignatureValid(attack, idpKeys.publicKey)).toBe(false);
    expect(() => {
      return SSOUtil.getSamlResponseFromXML(attack, idpKeys.publicKey);
    }).toThrow();
  });
});

describe("SSOUtil - signature tampering and forgery is rejected", () => {
  test("rejects a tampered NameID (digest mismatch)", () => {
    const genuine: string = genuineAssertionSignedResponse();
    const tampered: string = genuine.replace(
      "alice@example.com",
      "attacker@evil.com",
    );

    expect(SSOUtil.isSignatureValid(tampered, idpKeys.publicKey)).toBe(false);
    expect(() => {
      return SSOUtil.getSamlResponseFromXML(tampered, idpKeys.publicKey);
    }).toThrow();
  });

  test("rejects a response signed by a different (attacker) key", () => {
    const attackerSigned: string = sign(
      buildResponse(buildAssertion({ email: "attacker@evil.com" })),
      "Assertion",
      attackerKeys.privateKey,
    );

    // Verified against the genuine IdP certificate -> must fail.
    expect(SSOUtil.isSignatureValid(attackerSigned, idpKeys.publicKey)).toBe(
      false,
    );
    expect(() => {
      return SSOUtil.getSamlResponseFromXML(attackerSigned, idpKeys.publicKey);
    }).toThrow();
  });

  test("rejects an unsigned response", () => {
    const unsigned: string = buildResponse(buildAssertion());

    expect(SSOUtil.isSignatureValid(unsigned, idpKeys.publicKey)).toBe(false);
    expect(() => {
      return SSOUtil.getSamlResponseFromXML(unsigned, idpKeys.publicKey);
    }).toThrow();
  });

  test("rejects a NameID containing an XML comment (comment-truncation defense)", () => {
    /*
     * Signed WITH the comment present. Exclusive c14n excludes comments, so the
     * signature is valid, but our extractor must refuse comments outright.
     */
    const xml: string = sign(
      buildResponse(
        buildAssertion({ nameId: "admin@corp.com<!-- -->.attacker.com" }),
      ),
      "Assertion",
      idpKeys.privateKey,
    );

    expect(SSOUtil.isSignatureValid(xml, idpKeys.publicKey)).toBe(true);
    expect(() => {
      return SSOUtil.getSamlResponseFromXML(xml, idpKeys.publicKey);
    }).toThrow("SAML Assertion must not contain XML comments");
  });
});

describe("SSOUtil - malformed and abusive input is rejected", () => {
  test("rejects a DOCTYPE / entity declaration (XXE guard)", () => {
    const xml: string =
      `<?xml version="1.0"?><!DOCTYPE foo [<!ENTITY xxe "bar">]>` +
      genuineAssertionSignedResponse();

    expect(SSOUtil.isSignatureValid(xml, idpKeys.publicKey)).toBe(false);
    expect(() => {
      return SSOUtil.getSamlResponseFromXML(xml, idpKeys.publicKey);
    }).toThrow();
  });

  test("rejects malformed XML", () => {
    const xml: string = "<samlp:Response><saml:Assertion></samlp:Response>";

    expect(SSOUtil.isSignatureValid(xml, idpKeys.publicKey)).toBe(false);
    expect(() => {
      return SSOUtil.getSamlResponseFromXML(xml, idpKeys.publicKey);
    }).toThrow();
  });

  test("rejects an empty SAML response", () => {
    expect(SSOUtil.isSignatureValid("", idpKeys.publicKey)).toBe(false);
    expect(() => {
      return SSOUtil.getSamlResponseFromXML("", idpKeys.publicKey);
    }).toThrow();
  });

  test("rejects a response with no assertion", () => {
    const xml: string = sign(
      `<samlp:Response xmlns:samlp="urn:oasis:names:tc:SAML:2.0:protocol" xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion" ID="_r" Version="2.0" IssueInstant="2024-01-01T00:00:00Z"><saml:Issuer>${ISSUER}</saml:Issuer></samlp:Response>`,
      "Response",
      idpKeys.privateKey,
    );

    expect(SSOUtil.isSignatureValid(xml, idpKeys.publicKey)).toBe(false);
    expect(() => {
      return SSOUtil.getSamlResponseFromXML(xml, idpKeys.publicKey);
    }).toThrow();
  });

  test("rejects when the certificate is missing", () => {
    const xml: string = genuineAssertionSignedResponse();

    expect(SSOUtil.isSignatureValid(xml, "")).toBe(false);
    expect(() => {
      return SSOUtil.getSamlResponseFromXML(xml, "");
    }).toThrow("Public Certificate not found");
  });
});

describe("SSOUtil - createSAMLRequestUrl", () => {
  test("produces a SAMLRequest query parameter", () => {
    const url: string = SSOUtil.createSAMLRequestUrl({
      acsUrl: URL.fromString("https://app.example.com/acs"),
      signOnUrl: URL.fromString("https://idp.example.com/sso"),
      issuerUrl: URL.fromString("https://app.example.com/issuer"),
    }).toString();

    expect(url).toContain("SAMLRequest=");
    expect(url).toContain("https://idp.example.com/sso");
  });
});

// Sanity check that the Email type is what we assert against above.
describe("SSOUtil - sanity", () => {
  test("extracted email is a Common Email instance", () => {
    const result: VerifiedSamlResponse = SSOUtil.getSamlResponseFromXML(
      genuineAssertionSignedResponse(),
      idpKeys.publicKey,
    );
    expect(result.email).toBeInstanceOf(Email);
  });
});
