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
 * Two publicly reported bypasses are covered here:
 *
 *   - GitHub issue #2949: the original implementation validated the first
 *     <Signature> element it found and then extracted the identity from an
 *     independently parsed tree. An attacker could hide a genuinely signed
 *     assertion (e.g. inside <Extensions>) while presenting a forged assertion
 *     for consumption - a full authentication bypass.
 *
 *   - GitHub issue #2981: "exactly one <Assertion>" is not enough. The
 *     enveloped-signature transform strips the whole <Signature> subtree out of
 *     the digest, so an assertion parked inside a <Signature> is completely
 *     unauthenticated while still being the document's only assertion. Replay a
 *     genuinely signed *error* Response (which legitimately carries no
 *     assertion), park a forged assertion inside a signature, and you are
 *     logged in as anybody. xml-crypto widens this: its enveloped-signature
 *     transform removes EVERY <Signature> whose <SignatureValue> text matches
 *     the one being verified, so a decoy signature that simply repeats the
 *     genuine <SignatureValue> also disappears from the digest.
 *
 * These tests:
 *   1. Prove the genuine ("happy path") SAML flows still work.
 *   2. Prove every wrapping / smuggling / tampering variant is rejected.
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

const STATUS_SUCCESS: string = "urn:oasis:names:tc:SAML:2.0:status:Success";
const STATUS_REQUESTER: string = "urn:oasis:names:tc:SAML:2.0:status:Requester";
const STATUS_RESPONDER: string = "urn:oasis:names:tc:SAML:2.0:status:Responder";
const STATUS_AUTHN_FAILED: string =
  "urn:oasis:names:tc:SAML:2.0:status:AuthnFailed";

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

/*
 * ---------------------------------------------------------------------------
 * SAML document builders
 * ---------------------------------------------------------------------------
 */

interface AssertionOptions {
  assertionId?: string;
  email?: string;
  issuer?: string;
  displayName?: string | null;
  nameId?: string; // raw NameID inner XML override (for comment tests)
  extraInner?: string; // extra XML appended inside the assertion
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

  return `<saml:Assertion ID="${assertionId}" Version="2.0" IssueInstant="2024-01-01T00:00:00Z"><saml:Issuer>${issuer}</saml:Issuer><saml:Subject><saml:NameID>${nameIdInner}</saml:NameID></saml:Subject>${attributeStatement}${
    options.extraInner ?? ""
  }</saml:Assertion>`;
}

interface ResponseOptions {
  responseId?: string;
  statusCode?: string;
  statusXml?: string; // full <samlp:Status> override ("" removes it entirely)
  extensions?: string;
  beforeStatus?: string;
}

function buildStatus(statusCode: string = STATUS_SUCCESS): string {
  return `<samlp:Status><samlp:StatusCode Value="${statusCode}"/></samlp:Status>`;
}

function buildResponse(
  innerXml: string,
  options: ResponseOptions = {},
): string {
  const responseId: string = options.responseId ?? "_resp1";
  const status: string =
    options.statusXml ?? buildStatus(options.statusCode ?? STATUS_SUCCESS);

  return `<samlp:Response xmlns:samlp="urn:oasis:names:tc:SAML:2.0:protocol" xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion" xmlns:ds="http://www.w3.org/2000/09/xmldsig#" ID="${responseId}" Version="2.0" IssueInstant="2024-01-01T00:00:00Z"><saml:Issuer>${ISSUER}</saml:Issuer>${
    options.extensions ?? ""
  }${options.beforeStatus ?? ""}${status}${innerXml}</samlp:Response>`;
}

interface SignOptions {
  // XPath of the element whose content is digested.
  referenceXPath: string;
  privateKey?: string | undefined;
  // Where the <Signature> element itself is inserted. Defaults to the reference.
  location?: {
    reference: string;
    action: "append" | "prepend" | "before" | "after";
  };
  emptyUri?: boolean;
}

function signXml(xml: string, options: SignOptions): string {
  const sig: SignedXml = new SignedXml();

  sig.addReference(
    options.referenceXPath,
    [XMLDSIG_ENVELOPED, XMLDSIG_EXC_C14N],
    XMLENC_SHA256,
    undefined as unknown as string,
    undefined as unknown as string,
    undefined as unknown as string,
    options.emptyUri === true,
  );

  sig.signatureAlgorithm = RSA_SHA256;
  sig.signingKey = options.privateKey ?? idpKeys.privateKey;
  sig.keyInfoProvider = {
    getKeyInfo: (): string => {
      return "<X509Data></X509Data>";
    },
  } as unknown as SignedXml["keyInfoProvider"];

  sig.computeSignature(xml, {
    location: options.location ?? {
      reference: options.referenceXPath,
      action: "append",
    },
  });

  return sig.getSignedXml();
}

// Sign the single element with the given local name, appending the Signature into it.
function sign(xml: string, localName: string, privateKey?: string): string {
  const referenceXPath: string = `//*[local-name(.)='${localName}']`;
  return signXml(xml, { referenceXPath, privateKey });
}

// Extract `<tag ...>...</tag>` (first occurrence) from a document.
function extractElement(xml: string, tag: string): string {
  const start: number = xml.indexOf(`<${tag}`);
  const endMarker: string = `</${tag}>`;
  const end: number = xml.indexOf(endMarker) + endMarker.length;

  if (start < 0 || end < endMarker.length) {
    throw new Error(`Could not extract <${tag}> from document`);
  }

  return xml.substring(start, end);
}

function extractAssertion(signedXml: string): string {
  return extractElement(signedXml, "saml:Assertion");
}

// The <Signature> that `signXml` produced (it is emitted without a prefix).
function extractSignature(signedXml: string): string {
  return extractElement(signedXml, "Signature");
}

function extractSignatureValue(signatureXml: string): string {
  const match: RegExpMatchArray | null = signatureXml.match(
    /<SignatureValue>([\s\S]*?)<\/SignatureValue>/,
  );

  if (!match || !match[1]) {
    throw new Error("Could not extract <SignatureValue>");
  }

  return match[1];
}

function toBase64(xml: string): string {
  return Buffer.from(xml).toString("base64");
}

/*
 * Attack documents are built by surgery on genuine ones. If a search string
 * stops matching (xmldom re-serializes what xml-crypto produces, so e.g.
 * `<X509Data></X509Data>` comes back as `<X509Data/>`) the "attack" silently
 * becomes a copy of the genuine document and the test passes for the wrong
 * reason. Fail loudly instead.
 */
function replaceOnce(
  xml: string,
  search: string | RegExp,
  replacement: string,
): string {
  const replaced: string = xml.replace(search, replacement);

  if (replaced === xml) {
    throw new Error(
      `Test setup error: ${String(search)} did not match the document`,
    );
  }

  return replaced;
}

// A genuine, assertion-signed response for alice@example.com.
function genuineAssertionSignedResponse(): string {
  return sign(buildResponse(buildAssertion()), "Assertion");
}

// A genuine, response-signed (whole Response) response for alice@example.com.
function genuineResponseSignedResponse(): string {
  return sign(buildResponse(buildAssertion()), "Response");
}

/*
 * A GENUINE, IdP-signed error Response. Per SAML 2.0 Profiles 4.1.4.2 an error
 * response carries no assertion at all - which is precisely what makes it
 * useful to an attacker looking for a signature to graft onto.
 */
function genuineSignedErrorResponse(
  statusCode: string = STATUS_REQUESTER,
): string {
  return sign(buildResponse("", { statusCode }), "Response");
}

// Assert that both entry points reject a document.
function expectRejected(xml: string, messageFragment?: string): void {
  expect(SSOUtil.isSignatureValid(xml, idpKeys.publicKey)).toBe(false);

  if (messageFragment) {
    expect(() => {
      return SSOUtil.getSamlResponseFromXML(xml, idpKeys.publicKey);
    }).toThrow(messageFragment);
    return;
  }

  expect(() => {
    return SSOUtil.getSamlResponseFromXML(xml, idpKeys.publicKey);
  }).toThrow();
}

/*
 * ---------------------------------------------------------------------------
 * Happy path - the genuine flows must keep working.
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
    const xml: string = genuineResponseSignedResponse();

    expect(SSOUtil.isSignatureValid(xml, idpKeys.publicKey)).toBe(true);

    const result: VerifiedSamlResponse = SSOUtil.getSamlResponseFromXML(
      xml,
      idpKeys.publicKey,
    );

    expect(result.email.toString()).toBe("alice@example.com");
    expect(result.issuerUrl).toBe(ISSUER);
  });

  test("accepts a response signed at BOTH the Response and Assertion level", () => {
    const assertionSigned: string = sign(
      buildResponse(buildAssertion()),
      "Assertion",
    );
    const bothSigned: string = signXml(assertionSigned, {
      referenceXPath: "//*[local-name(.)='Response']",
      location: {
        reference: "//*[local-name(.)='Response']",
        action: "append",
      },
    });

    expect(SSOUtil.isSignatureValid(bothSigned, idpKeys.publicKey)).toBe(true);

    const result: VerifiedSamlResponse = SSOUtil.getSamlResponseFromXML(
      bothSigned,
      idpKeys.publicKey,
    );

    expect(result.email.toString()).toBe("alice@example.com");
  });

  test("accepts a Response signature placed right after <Issuer> (real IdP layout)", () => {
    const xml: string = signXml(buildResponse(buildAssertion()), {
      referenceXPath: "//*[local-name(.)='Response']",
      location: {
        reference: "//*[local-name(.)='Issuer']",
        action: "after",
      },
    });

    const result: VerifiedSamlResponse = SSOUtil.getSamlResponseFromXML(
      xml,
      idpKeys.publicKey,
    );

    expect(result.email.toString()).toBe("alice@example.com");
  });

  test('accepts a whole-document signature (Reference URI="")', () => {
    const xml: string = signXml(buildResponse(buildAssertion()), {
      referenceXPath: "//*[local-name(.)='Response']",
      emptyUri: true,
    });

    expect(xml).toContain('URI=""');

    const result: VerifiedSamlResponse = SSOUtil.getSamlResponseFromXML(
      xml,
      idpKeys.publicKey,
    );

    expect(result.email.toString()).toBe("alice@example.com");
  });

  test("accepts a Status carrying a second-level StatusCode, StatusMessage and StatusDetail", () => {
    const statusXml: string = `<samlp:Status><samlp:StatusCode Value="${STATUS_SUCCESS}"><samlp:StatusCode Value="urn:oasis:names:tc:SAML:2.0:status:PartialLogout"/></samlp:StatusCode><samlp:StatusMessage>All good</samlp:StatusMessage><samlp:StatusDetail/></samlp:Status>`;

    const xml: string = sign(
      buildResponse(buildAssertion(), { statusXml }),
      "Assertion",
    );

    const result: VerifiedSamlResponse = SSOUtil.getSamlResponseFromXML(
      xml,
      idpKeys.publicKey,
    );

    expect(result.email.toString()).toBe("alice@example.com");
  });

  test("accepts a Response carrying <samlp:Extensions>", () => {
    const xml: string = sign(
      buildResponse(buildAssertion(), {
        extensions: `<samlp:Extensions><vendor:Thing xmlns:vendor="https://vendor.example.com/ns">hello</vendor:Thing></samlp:Extensions>`,
      }),
      "Assertion",
    );

    const result: VerifiedSamlResponse = SSOUtil.getSamlResponseFromXML(
      xml,
      idpKeys.publicKey,
    );

    expect(result.email.toString()).toBe("alice@example.com");
  });

  test("returns null name when no display-name claim is present", () => {
    const xml: string = sign(
      buildResponse(buildAssertion({ displayName: null })),
      "Assertion",
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
 * Issue #2981 - a signed error Response must never become a login.
 * ---------------------------------------------------------------------------
 */

describe("SSOUtil - signed error Response cannot smuggle an assertion (issue #2981)", () => {
  /*
   * The exact proof of concept from the report: a genuine signed error Response
   * plus a decoy <Signature> that repeats the genuine <SignatureValue>. Both
   * signature subtrees are stripped by the enveloped-signature transform, so
   * the digest still matches while the decoy's <Object> carries a forged
   * assertion that is the document's ONLY assertion.
   */
  test("rejects the reported PoC: decoy Signature repeating the genuine SignatureValue", () => {
    const genuineSigned: string = genuineSignedErrorResponse();
    const genuineSignature: string = extractSignature(genuineSigned);
    const signatureValue: string = extractSignatureValue(genuineSignature);

    const forgedAssertion: string = buildAssertion({
      assertionId: "_assertion_forged",
      email: "attacker@evil.com",
    });

    const decoy: string = `<Signature xmlns="http://www.w3.org/2000/09/xmldsig#"><SignatureValue>${signatureValue}</SignatureValue><Object>${forgedAssertion}</Object></Signature>`;

    const attack: string = replaceOnce(
      genuineSigned,
      "</samlp:Response>",
      `${decoy}</samlp:Response>`,
    );

    expectRejected(attack);

    // And under no circumstances may the attacker's identity come back.
    let extracted: string = "";
    try {
      extracted = SSOUtil.getSamlResponseFromXML(
        attack,
        idpKeys.publicKey,
      ).email.toString();
    } catch {
      extracted = "";
    }
    expect(extracted).not.toBe("attacker@evil.com");
  });

  /*
   * The same idea without any decoy at all: append the forged assertion inside
   * the GENUINE signature's own <Object>. The enveloped-signature transform
   * removes that whole subtree from the digest, so the signature still
   * validates - and there is exactly one <Signature> with a unique
   * <SignatureValue>, so "no duplicate signature values" alone would not help.
   */
  test("rejects a forged assertion appended inside the genuine Signature's <Object>", () => {
    const genuineSigned: string = genuineSignedErrorResponse();

    const forgedAssertion: string = buildAssertion({
      assertionId: "_assertion_forged",
      email: "attacker@evil.com",
    });

    const attack: string = replaceOnce(
      genuineSigned,
      "</Signature>",
      `<Object>${forgedAssertion}</Object></Signature>`,
    );

    expectRejected(
      attack,
      "SAML Assertion must be a direct child of the SAML Response",
    );
  });

  test("rejects a forged assertion hidden inside the genuine Signature's <KeyInfo>", () => {
    const genuineSigned: string = genuineSignedErrorResponse();

    const forgedAssertion: string = buildAssertion({
      assertionId: "_assertion_forged",
      email: "attacker@evil.com",
    });

    const attack: string = replaceOnce(
      genuineSigned,
      "<X509Data/>",
      `<X509Data/>${forgedAssertion}`,
    );

    expectRejected(
      attack,
      "SAML Assertion must be a direct child of the SAML Response",
    );
  });

  test("rejects a forged assertion simply appended to a signed error Response", () => {
    const genuineSigned: string = genuineSignedErrorResponse();

    const forgedAssertion: string = buildAssertion({
      assertionId: "_assertion_forged",
      email: "attacker@evil.com",
    });

    const attack: string = replaceOnce(
      genuineSigned,
      "</samlp:Response>",
      `${forgedAssertion}</samlp:Response>`,
    );

    // Digest mismatch: the assertion is inside the signed payload this time.
    expectRejected(attack);
  });

  test("rejects a decoy Signature bolted onto a genuine SUCCESS response", () => {
    const genuineSigned: string = genuineResponseSignedResponse();
    const genuineSignature: string = extractSignature(genuineSigned);
    const signatureValue: string = extractSignatureValue(genuineSignature);

    const decoy: string = `<Signature xmlns="http://www.w3.org/2000/09/xmldsig#"><SignatureValue>${signatureValue}</SignatureValue><Object>anything</Object></Signature>`;

    const attack: string = replaceOnce(
      genuineSigned,
      "</samlp:Response>",
      `${decoy}</samlp:Response>`,
    );

    expectRejected(attack);
  });

  test.each([STATUS_REQUESTER, STATUS_RESPONDER, STATUS_AUTHN_FAILED])(
    "rejects a genuinely signed assertion delivered with a non-Success status (%s)",
    (statusCode: string) => {
      const xml: string = sign(
        buildResponse(buildAssertion(), { statusCode }),
        "Assertion",
      );

      expectRejected(xml, "SAML Response was not successful");
    },
  );

  test("rejects a Response with no <Status> element at all", () => {
    const xml: string = sign(
      buildResponse(buildAssertion(), { statusXml: "" }),
      "Assertion",
    );

    expectRejected(xml, "Expected exactly one Status element in SAML Response");
  });

  test("rejects a Response carrying two <Status> elements", () => {
    const xml: string = sign(
      buildResponse(buildAssertion(), {
        beforeStatus: buildStatus(STATUS_REQUESTER),
      }),
      "Assertion",
    );

    expectRejected(xml, "Expected exactly one Status element in SAML Response");
  });

  test("rejects a <Status> that is not a direct child of the Response", () => {
    const xml: string = sign(
      buildResponse(buildAssertion(), {
        statusXml: `<samlp:Extensions>${buildStatus()}</samlp:Extensions>`,
      }),
      "Assertion",
    );

    expectRejected(
      xml,
      "SAML Status must be a direct child of the SAML Response",
    );
  });

  test("rejects a <Status> with two top-level <StatusCode> children", () => {
    const statusXml: string = `<samlp:Status><samlp:StatusCode Value="${STATUS_REQUESTER}"/><samlp:StatusCode Value="${STATUS_SUCCESS}"/></samlp:Status>`;

    const xml: string = sign(
      buildResponse(buildAssertion(), { statusXml }),
      "Assertion",
    );

    expectRejected(
      xml,
      "Expected exactly one StatusCode element in SAML Status",
    );
  });

  test("rejects a <Status> with no <StatusCode>", () => {
    const xml: string = sign(
      buildResponse(buildAssertion(), {
        statusXml: `<samlp:Status><samlp:StatusMessage>nope</samlp:StatusMessage></samlp:Status>`,
      }),
      "Assertion",
    );

    expectRejected(
      xml,
      "Expected exactly one StatusCode element in SAML Status",
    );
  });

  test("does not echo an unsafe status code back into the error message", () => {
    const statusXml: string = `<samlp:Status><samlp:StatusCode Value="&lt;script&gt;alert(1)&lt;/script&gt;"/></samlp:Status>`;

    const xml: string = sign(
      buildResponse(buildAssertion(), { statusXml }),
      "Assertion",
    );

    expect(() => {
      return SSOUtil.getSamlResponseFromXML(xml, idpKeys.publicKey);
    }).toThrow("SAML Response was not successful");

    try {
      SSOUtil.getSamlResponseFromXML(xml, idpKeys.publicKey);
    } catch (err) {
      expect((err as Error).message).not.toContain("script");
    }
  });
});

/*
 * ---------------------------------------------------------------------------
 * Issue #2949 - classic signature wrapping must stay rejected.
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

    const attack: string = buildResponse(forgedAssertion, {
      extensions: `<samlp:Extensions>${genuineAssertion}</samlp:Extensions>`,
    });

    expectRejected(attack);
  });

  test("rejects a forged assertion that nests the genuine signed assertion inside it", () => {
    const genuineSigned: string = genuineAssertionSignedResponse();
    const genuineAssertion: string = extractAssertion(genuineSigned);

    const attack: string = buildResponse(
      buildAssertion({
        assertionId: "_assertion_forged",
        email: "attacker@evil.com",
        extraInner: genuineAssertion,
      }),
    );

    expectRejected(attack);
  });

  test("rejects a genuine signed assertion hidden inside a forged assertion's <Advice>", () => {
    const genuineSigned: string = genuineAssertionSignedResponse();
    const genuineAssertion: string = extractAssertion(genuineSigned);

    const attack: string = buildResponse(
      buildAssertion({
        assertionId: "_assertion_forged",
        email: "attacker@evil.com",
        extraInner: `<saml:Advice>${genuineAssertion}</saml:Advice>`,
      }),
    );

    expectRejected(attack, "Expected exactly one Assertion in SAML Response");
  });

  test("rejects a forged lone assertion with a valid signature over an unrelated element", () => {
    /*
     * The signature lives exactly where SAML allows it (a direct child of the
     * Response) and validates cryptographically - but its Reference digests an
     * unrelated <Dummy> element, not the assertion. Only the reference-coverage
     * check stands between this document and an authentication bypass.
     */
    const signedDummyDoc: string = signXml(
      buildResponse(`<Dummy ID="_dummy1">trusted-but-irrelevant</Dummy>`),
      {
        referenceXPath: "//*[local-name(.)='Dummy']",
        location: {
          reference: "//*[local-name(.)='Response']",
          action: "append",
        },
      },
    );

    const signedDummy: string = extractElement(signedDummyDoc, "Dummy");
    const genuineSignature: string = extractSignature(signedDummyDoc);

    const forgedAssertion: string = buildAssertion({
      assertionId: "_assertion_forged",
      email: "attacker@evil.com",
    });

    const attack: string = buildResponse(
      `${signedDummy}${forgedAssertion}${genuineSignature}`,
    );

    expectRejected(attack);
  });

  test("rejects two assertions sharing the same ID (issue PoC shape)", () => {
    const genuineSigned: string = sign(
      buildResponse(buildAssertion({ assertionId: "_dup" })),
      "Assertion",
    );
    const genuineAssertion: string = extractAssertion(genuineSigned);

    const forgedAssertion: string = buildAssertion({
      assertionId: "_dup",
      email: "attacker@evil.com",
    });

    const attack: string = buildResponse(forgedAssertion, {
      extensions: `<samlp:Extensions>${genuineAssertion}</samlp:Extensions>`,
    });

    expectRejected(attack);
  });

  test("rejects a forged assertion whose ID collides with the signed Response ID", () => {
    const genuineSigned: string = genuineResponseSignedResponse();

    const attack: string = replaceOnce(
      genuineSigned,
      'ID="_assertion_genuine"',
      'ID="_resp1"',
    );

    expectRejected(attack);
  });
});

/*
 * ---------------------------------------------------------------------------
 * Structural rules: where assertions and signatures may live.
 * ---------------------------------------------------------------------------
 */

describe("SSOUtil - assertion placement rules", () => {
  test("rejects an assertion that is not a direct child of the Response", () => {
    const xml: string = sign(
      buildResponse("", {
        extensions: `<samlp:Extensions>${buildAssertion()}</samlp:Extensions>`,
      }),
      "Assertion",
    );

    expectRejected(
      xml,
      "SAML Assertion must be a direct child of the SAML Response",
    );
  });

  test("rejects a document with two assertions", () => {
    const xml: string = buildResponse(
      `${buildAssertion()}${buildAssertion({ assertionId: "_second" })}`,
    );

    expectRejected(xml, "Expected exactly one Assertion in SAML Response");
  });

  test("rejects an assertion in an unexpected namespace", () => {
    const xml: string = buildResponse(
      `<Assertion xmlns="https://evil.example.com/ns" ID="_a" Version="2.0" IssueInstant="2024-01-01T00:00:00Z"><Issuer>${ISSUER}</Issuer><Subject><NameID>attacker@evil.com</NameID></Subject></Assertion>`,
    );

    expectRejected(xml, "SAML Assertion has an invalid namespace");
  });

  test("rejects an <EncryptedAssertion> we cannot decrypt", () => {
    const xml: string = buildResponse(
      `<saml:EncryptedAssertion><xenc:EncryptedData xmlns:xenc="http://www.w3.org/2001/04/xmlenc#">ciphertext</xenc:EncryptedData></saml:EncryptedAssertion>${buildAssertion(
        { email: "attacker@evil.com" },
      )}`,
    );

    expectRejected(xml, "Encrypted SAML Responses are not supported");
  });

  test("rejects an <EncryptedID> inside the Subject", () => {
    const xml: string = sign(
      buildResponse(
        buildAssertion({
          extraInner: `<saml:EncryptedID>ciphertext</saml:EncryptedID>`,
        }),
      ),
      "Assertion",
    );

    expectRejected(xml, "Encrypted SAML Responses are not supported");
  });
});

describe("SSOUtil - signature placement rules", () => {
  test("rejects a Signature that is not a direct child of the Response or Assertion", () => {
    const genuineSigned: string = genuineAssertionSignedResponse();
    const genuineSignature: string = extractSignature(genuineSigned);

    const attack: string = buildResponse(buildAssertion(), {
      extensions: `<samlp:Extensions>${genuineSignature}</samlp:Extensions>`,
    });

    expectRejected(
      attack,
      "must be a direct child of the Response or of the Assertion",
    );
  });

  test("rejects two Signatures under the same Response", () => {
    const genuineSigned: string = genuineResponseSignedResponse();
    const genuineSignature: string = extractSignature(genuineSigned);

    // Second signature carries a DIFFERENT value, so only the placement rule bites.
    const otherSignature: string = replaceOnce(
      genuineSignature,
      /<SignatureValue>[\s\S]*?<\/SignatureValue>/,
      "<SignatureValue>ZGlmZmVyZW50</SignatureValue>",
    );

    const attack: string = replaceOnce(
      genuineSigned,
      "</samlp:Response>",
      `${otherSignature}</samlp:Response>`,
    );

    expectRejected(
      attack,
      "SAML Response must not contain more than one Signature",
    );
  });

  test("rejects two Signatures under the same Assertion", () => {
    const genuineSigned: string = genuineAssertionSignedResponse();
    const genuineSignature: string = extractSignature(genuineSigned);

    const otherSignature: string = replaceOnce(
      genuineSignature,
      /<SignatureValue>[\s\S]*?<\/SignatureValue>/,
      "<SignatureValue>ZGlmZmVyZW50</SignatureValue>",
    );

    const attack: string = replaceOnce(
      genuineSigned,
      "</saml:Assertion>",
      `${otherSignature}</saml:Assertion>`,
    );

    expectRejected(
      attack,
      "SAML Assertion must not contain more than one Signature",
    );
  });

  test("rejects two Signatures sharing one SignatureValue", () => {
    const genuineSigned: string = genuineResponseSignedResponse();
    const genuineSignature: string = extractSignature(genuineSigned);
    const signatureValue: string = extractSignatureValue(genuineSignature);

    /*
     * One under the Assertion, one under the Response - placement is fine,
     * but they repeat the same SignatureValue.
     */
    const twin: string = `<Signature xmlns="http://www.w3.org/2000/09/xmldsig#"><SignatureValue>${signatureValue}</SignatureValue></Signature>`;

    const attack: string = replaceOnce(
      genuineSigned,
      "</saml:Assertion>",
      `${twin}</saml:Assertion>`,
    );

    expectRejected(
      attack,
      "must not contain two Signatures with the same SignatureValue",
    );
  });

  test("rejects a <ds:Object> inside a Signature even with harmless content", () => {
    const genuineSigned: string = genuineResponseSignedResponse();

    const attack: string = replaceOnce(
      genuineSigned,
      "</Signature>",
      "<Object>harmless</Object></Signature>",
    );

    expectRejected(attack, "Object elements are not allowed");
  });

  test("rejects SAML elements smuggled inside a Signature", () => {
    const genuineSigned: string = genuineResponseSignedResponse();

    const attack: string = replaceOnce(
      genuineSigned,
      "<X509Data/>",
      `<X509Data/>${buildStatus(STATUS_REQUESTER)}`,
    );

    expectRejected(
      attack,
      "SAML elements are not allowed inside an XML Signature",
    );
  });
});

/*
 * ---------------------------------------------------------------------------
 * Root element rules.
 * ---------------------------------------------------------------------------
 */

describe("SSOUtil - the document root must be a samlp:Response", () => {
  test("rejects a bare signed <Assertion> as the document root", () => {
    const signedResponse: string = genuineAssertionSignedResponse();
    const bareAssertion: string = replaceOnce(
      extractAssertion(signedResponse),
      "<saml:Assertion ",
      '<saml:Assertion xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion" ',
    );

    expectRejected(bareAssertion, "must be a samlp:Response element");
  });

  test("rejects a Response in the wrong namespace", () => {
    const xml: string = replaceOnce(
      genuineAssertionSignedResponse(),
      "urn:oasis:names:tc:SAML:2.0:protocol",
      "urn:oasis:names:tc:SAML:1.0:protocol",
    );

    expectRejected(xml, "must be a samlp:Response element");
  });

  test("rejects a non-SAML root element wrapping a genuine Response", () => {
    const genuineSigned: string = genuineAssertionSignedResponse();

    const xml: string = `<Wrapper>${genuineSigned}</Wrapper>`;

    expectRejected(xml, "must be a samlp:Response element");
  });
});

/*
 * ---------------------------------------------------------------------------
 * Tampering and forgery.
 * ---------------------------------------------------------------------------
 */

describe("SSOUtil - signature tampering and forgery is rejected", () => {
  test("rejects a tampered NameID (digest mismatch)", () => {
    const genuine: string = genuineAssertionSignedResponse();
    const tampered: string = replaceOnce(
      genuine,
      "alice@example.com",
      "attacker@evil.com",
    );

    expectRejected(tampered);
  });

  test("rejects a tampered display name (digest mismatch)", () => {
    const genuine: string = genuineAssertionSignedResponse();
    const tampered: string = replaceOnce(genuine, "Alice Example", "Attacker");

    expectRejected(tampered);
  });

  test("rejects a response signed by a different (attacker) key", () => {
    const attackerSigned: string = sign(
      buildResponse(buildAssertion({ email: "attacker@evil.com" })),
      "Assertion",
      attackerKeys.privateKey,
    );

    expectRejected(attackerSigned);
  });

  test("rejects a response where the attacker re-signed a forged assertion but kept the genuine Response signature", () => {
    const genuineResponseSigned: string = genuineResponseSignedResponse();
    const genuineSignature: string = extractSignature(genuineResponseSigned);

    const attackerSignedAssertion: string = extractAssertion(
      sign(
        buildResponse(buildAssertion({ email: "attacker@evil.com" })),
        "Assertion",
        attackerKeys.privateKey,
      ),
    );

    const attack: string = buildResponse(
      `${attackerSignedAssertion}${genuineSignature}`,
    );

    expectRejected(attack);
  });

  test("rejects an unsigned response", () => {
    expectRejected(buildResponse(buildAssertion()));
  });

  test("rejects a stripped signature (SignatureValue emptied)", () => {
    const genuine: string = genuineAssertionSignedResponse();
    const stripped: string = replaceOnce(
      genuine,
      /<SignatureValue>[\s\S]*?<\/SignatureValue>/,
      "<SignatureValue></SignatureValue>",
    );

    expectRejected(stripped);
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
    );

    expect(SSOUtil.isSignatureValid(xml, idpKeys.publicKey)).toBe(true);
    expect(() => {
      return SSOUtil.getSamlResponseFromXML(xml, idpKeys.publicKey);
    }).toThrow("SAML Assertion must not contain XML comments");
  });

  test("rejects an Issuer containing an XML comment", () => {
    const xml: string = sign(
      buildResponse(
        buildAssertion({
          issuer: "https://idp.example.com<!-- -->.attacker.com/metadata",
        }),
      ),
      "Assertion",
    );

    expect(() => {
      return SSOUtil.getSamlResponseFromXML(xml, idpKeys.publicKey);
    }).toThrow("SAML Assertion must not contain XML comments");
  });

  test("rejects a display name containing an XML comment", () => {
    const xml: string = sign(
      buildResponse(buildAssertion({ displayName: "Alice<!-- -->Attacker" })),
      "Assertion",
    );

    expect(() => {
      return SSOUtil.getSamlResponseFromXML(xml, idpKeys.publicKey);
    }).toThrow("SAML Assertion must not contain XML comments");
  });
});

/*
 * ---------------------------------------------------------------------------
 * Malformed and abusive input.
 * ---------------------------------------------------------------------------
 */

describe("SSOUtil - malformed and abusive input is rejected", () => {
  test("rejects a DOCTYPE / entity declaration (XXE guard)", () => {
    const xml: string =
      `<?xml version="1.0"?><!DOCTYPE foo [<!ENTITY xxe "bar">]>` +
      genuineAssertionSignedResponse();

    expectRejected(
      xml,
      "SAML Response must not contain a DOCTYPE or entity declarations",
    );
  });

  test("rejects malformed XML", () => {
    expectRejected("<samlp:Response><saml:Assertion></samlp:Response>");
  });

  test("rejects an empty SAML response", () => {
    expect(SSOUtil.isSignatureValid("", idpKeys.publicKey)).toBe(false);
    expect(() => {
      return SSOUtil.getSamlResponseFromXML("", idpKeys.publicKey);
    }).toThrow("SAML Response is empty");
  });

  test("rejects a whitespace-only SAML response", () => {
    expect(SSOUtil.isSignatureValid("   \n  ", idpKeys.publicKey)).toBe(false);
  });

  test("rejects a signed Response with no assertion at all", () => {
    expectRejected(genuineSignedErrorResponse(), "SAML Assertion not found");
  });

  test("rejects a signed success Response with no assertion", () => {
    expectRejected(
      sign(buildResponse(""), "Response"),
      "SAML Assertion not found",
    );
  });

  test("rejects an assertion with no Subject/NameID", () => {
    const xml: string = sign(
      buildResponse(
        `<saml:Assertion ID="_a" Version="2.0" IssueInstant="2024-01-01T00:00:00Z"><saml:Issuer>${ISSUER}</saml:Issuer></saml:Assertion>`,
      ),
      "Assertion",
    );

    expect(() => {
      return SSOUtil.getSamlResponseFromXML(xml, idpKeys.publicKey);
    }).toThrow("SAML Subject not found");
  });

  test("rejects an assertion with an empty NameID", () => {
    const xml: string = sign(
      buildResponse(buildAssertion({ nameId: "" })),
      "Assertion",
    );

    expect(() => {
      return SSOUtil.getSamlResponseFromXML(xml, idpKeys.publicKey);
    }).toThrow("SAML Email not found");
  });

  test("rejects an assertion with no Issuer", () => {
    const xml: string = sign(
      buildResponse(
        `<saml:Assertion ID="_a" Version="2.0" IssueInstant="2024-01-01T00:00:00Z"><saml:Subject><saml:NameID>alice@example.com</saml:NameID></saml:Subject></saml:Assertion>`,
      ),
      "Assertion",
    );

    expect(() => {
      return SSOUtil.getSamlResponseFromXML(xml, idpKeys.publicKey);
    }).toThrow("Issuer not found in SAML Assertion");
  });

  test("rejects when the certificate is missing", () => {
    const xml: string = genuineAssertionSignedResponse();

    expect(SSOUtil.isSignatureValid(xml, "")).toBe(false);
    expect(() => {
      return SSOUtil.getSamlResponseFromXML(xml, "");
    }).toThrow("Public Certificate not found");
  });

  test("rejects a response verified against a different certificate", () => {
    const xml: string = genuineAssertionSignedResponse();

    expect(SSOUtil.isSignatureValid(xml, attackerKeys.publicKey)).toBe(false);
  });
});

/*
 * ---------------------------------------------------------------------------
 * Request generation.
 * ---------------------------------------------------------------------------
 */

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
