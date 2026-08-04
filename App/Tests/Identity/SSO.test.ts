import SSOUtil, {
  VerifiedSamlResponse,
} from "../../FeatureSet/Identity/Utils/SSO";
import Email from "Common/Types/Email";
import URL from "Common/Types/API/URL";
import { describe, expect, test, beforeAll } from "@jest/globals";
import crypto from "crypto";
import { SignedXml } from "xml-crypto";
import {
  DOMParser,
  Element as XmlElement,
  Node as XmlNode,
} from "@xmldom/xmldom";

/*
 * Security regression tests for SAML XML Signature Wrapping (XSW).
 *
 * Three publicly reported bypasses are covered here:
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
 *   - GitHub issue #2988: a signature that provably covers the element we read
 *     still is not enough, because the bytes that were digested and the bytes
 *     the DOM reports need not be the same bytes. xml-crypto canonicalizes any
 *     node exposing a `data` property by emitting that data as plain text, so a
 *     processing instruction `<?p not-an-?>` is digested as `not-an-` while
 *     `textContent` omits it entirely. An attacker can therefore hide any
 *     substring of a genuinely signed value inside a processing instruction and
 *     the digest does not move.
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
 * Minimal self-signed X.509 certificate builder.
 *
 * xml-crypto 6 can resolve its verification key from the <KeyInfo> carried in
 * the document under verification, which is a full authentication bypass if it
 * is left enabled. Testing that faithfully needs a REAL certificate whose key
 * actually signed the document - a garbage blob would be rejected by the crypto
 * layer and the test would pass for the wrong reason.
 *
 * Node cannot generate certificates and the repo has no certificate library, so
 * this emits a minimal X.509 v1 certificate directly. Nothing validates its
 * contents; it only has to parse and carry the public key.
 * ---------------------------------------------------------------------------
 */

function derLength(length: number): Buffer {
  if (length < 0x80) {
    return Buffer.from([length]);
  }

  const bytes: Array<number> = [];
  let remaining: number = length;

  while (remaining > 0) {
    bytes.unshift(remaining & 0xff);
    remaining = remaining >> 8;
  }

  return Buffer.from([0x80 | bytes.length, ...bytes]);
}

function der(tag: number, contents: Buffer): Buffer {
  return Buffer.concat([
    Buffer.from([tag]),
    derLength(contents.length),
    contents,
  ]);
}

function derSequence(...parts: Array<Buffer>): Buffer {
  return der(0x30, Buffer.concat(parts));
}

// sha256WithRSAEncryption (1.2.840.113549.1.1.11), with the required NULL params.
function sha256RsaAlgorithmIdentifier(): Buffer {
  return derSequence(
    der(
      0x06,
      Buffer.from([0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x0b]),
    ),
    der(0x05, Buffer.alloc(0)),
  );
}

// A Name holding a single commonName (2.5.4.3) attribute.
function derName(commonName: string): Buffer {
  return derSequence(
    der(
      0x31,
      derSequence(
        der(0x06, Buffer.from([0x55, 0x04, 0x03])),
        der(0x0c, Buffer.from(commonName, "utf8")),
      ),
    ),
  );
}

function selfSignedCertificateBase64(
  keys: KeyPair,
  commonName: string,
): string {
  const spki: Buffer = crypto
    .createPublicKey(keys.publicKey)
    .export({ type: "spki", format: "der" });

  const validity: Buffer = derSequence(
    der(0x17, Buffer.from("240101000000Z", "ascii")),
    der(0x17, Buffer.from("340101000000Z", "ascii")),
  );

  const tbsCertificate: Buffer = derSequence(
    der(0x02, Buffer.from([0x01])), // serialNumber
    sha256RsaAlgorithmIdentifier(),
    derName(commonName), // issuer == subject: self-signed
    validity,
    derName(commonName),
    spki,
  );

  const signature: Buffer = crypto.sign(
    "sha256",
    tbsCertificate,
    keys.privateKey,
  );

  const certificate: Buffer = derSequence(
    tbsCertificate,
    sha256RsaAlgorithmIdentifier(),
    der(0x03, Buffer.concat([Buffer.from([0x00]), signature])), // BIT STRING
  );

  return certificate.toString("base64");
}

/*
 * Verify a document using the certificate the document itself carries, by
 * opting in to xml-crypto's own SignedXml.getCertFromKeyInfo.
 *
 * This is the negative control for the KeyInfo tests: it proves the attack
 * document is internally self-consistent, so the rejection that follows is
 * attributable to SSOUtil insisting on the configured certificate rather than
 * to a malformed one. It also documents the footgun - this is a supported
 * xml-crypto configuration, one constructor option away.
 */
function signatureVerifiesAgainstEmbeddedCertificate(xml: string): boolean {
  try {
    const sig: SignedXml = new SignedXml({
      getCertFromKeyInfo: SignedXml.getCertFromKeyInfo,
    });
    sig.loadSignature(extractSignature(xml));
    return sig.checkSignature(xml);
  } catch {
    return false;
  }
}

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
  // Raw <KeyInfo> content override (for the embedded-certificate tests).
  keyInfoContent?: string;
}

function signXml(xml: string, options: SignOptions): string {
  const sig: SignedXml = new SignedXml({
    privateKey: options.privateKey ?? idpKeys.privateKey,
    signatureAlgorithm: RSA_SHA256,
    canonicalizationAlgorithm: XMLDSIG_EXC_C14N,
    getKeyInfoContent: (): string => {
      return options.keyInfoContent ?? "<X509Data></X509Data>";
    },
  });

  sig.addReference({
    xpath: options.referenceXPath,
    transforms: [XMLDSIG_ENVELOPED, XMLDSIG_EXC_C14N],
    digestAlgorithm: XMLENC_SHA256,
    isEmptyUri: options.emptyUri === true,
  });

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

/*
 * Verify a document's <Signature> with xml-crypto alone, bypassing every
 * structural rule SSOUtil layers on top of it.
 *
 * The #2988 attack documents are built so that this returns TRUE: the digest is
 * byte-for-byte the digest of the genuine response. Asserting it in the tests
 * is what makes them meaningful - it proves the document is rejected because
 * SSOUtil refuses to read a value whose canonical form differs from what the
 * DOM reports, and not merely because the signature happened to break.
 */
function signatureIsCryptographicallyValid(xml: string): boolean {
  const sig: SignedXml = new SignedXml({
    publicCert: idpKeys.publicKey,
    // Same rule SSOUtil enforces: the document's own KeyInfo yields no key.
    getCertFromKeyInfo: (): null => {
      return null;
    },
  });

  try {
    sig.loadSignature(extractSignature(xml));

    /*
     * xml-crypto 6 throws (rather than returning false) when the signature
     * value itself does not verify, and returns false when a digest does not.
     * Both mean the same thing here.
     */
    return sig.checkSignature(xml);
  } catch {
    return false;
  }
}

/*
 * The value a textContent-based extractor (i.e. SSOUtil) sees for the first
 * element with this local name. Used to show, in the test itself, that the DOM
 * and the digest disagree.
 */
function domTextOf(xml: string, localName: string): string {
  const element: XmlNode | null = new DOMParser()
    .parseFromString(xml, "text/xml")
    .getElementsByTagNameNS("*", localName)
    .item(0);

  return ((element as XmlElement | null)?.textContent || "").trim();
}

/*
 * Hide `text` inside a processing instruction.
 *
 * xml-crypto digests the instruction's data as if it were character data, so
 * `hidden("not-an-") + "admin@example.com"` canonicalizes exactly like
 * "not-an-admin@example.com" while the DOM reports only "admin@example.com".
 */
function hidden(text: string): string {
  return `<?p ${text}?>`;
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

  /*
   * xmldom surfaces the XML declaration as a processing instruction node, and
   * essentially every identity provider emits one. It is the single processing
   * instruction the parser is allowed to keep (issue #2988), so each spelling
   * has to keep working.
   */
  test.each([
    ['<?xml version="1.0" encoding="UTF-8"?>', "double-quoted, with encoding"],
    ['<?xml version="1.0"?>', "no encoding"],
    [
      "<?xml version='1.0' encoding='utf-8' standalone='no'?>",
      "single-quoted, standalone",
    ],
  ])(
    "accepts a response introduced by an XML declaration (%s)",
    (declaration: string) => {
      const xml: string = declaration + genuineAssertionSignedResponse();

      expect(SSOUtil.isSignatureValid(xml, idpKeys.publicKey)).toBe(true);
      expect(
        SSOUtil.getSamlResponseFromXML(xml, idpKeys.publicKey).email.toString(),
      ).toBe("alice@example.com");
    },
  );

  test("accepts an XML declaration that was present when the document was signed", () => {
    const xml: string = sign(
      `<?xml version="1.0" encoding="UTF-8"?>${buildResponse(buildAssertion())}`,
      "Assertion",
    );

    expect(xml.startsWith("<?xml ")).toBe(true);
    expect(SSOUtil.isSignatureValid(xml, idpKeys.publicKey)).toBe(true);
  });

  test("accepts a Response-signed document introduced by an XML declaration", () => {
    const xml: string =
      '<?xml version="1.0" encoding="UTF-8"?>' +
      genuineResponseSignedResponse();

    expect(SSOUtil.isSignatureValid(xml, idpKeys.publicKey)).toBe(true);
  });

  test("accepts a display-name AttributeValue carrying xsi:type", () => {
    /*
     * Identity values must be plain text (issue #2988), but an xsi:type is an
     * ATTRIBUTE, not a child element - Okta, Entra and ADFS all send it.
     */
    const attributeStatement: string = `<saml:AttributeStatement><saml:Attribute Name="${DISPLAY_NAME_CLAIM}"><saml:AttributeValue xmlns:xs="http://www.w3.org/2001/XMLSchema" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:type="xs:string">Alice Example</saml:AttributeValue></saml:Attribute></saml:AttributeStatement>`;

    const assertion: string = `<saml:Assertion ID="_a" Version="2.0" IssueInstant="2024-01-01T00:00:00Z"><saml:Issuer>${ISSUER}</saml:Issuer><saml:Subject><saml:NameID>alice@example.com</saml:NameID></saml:Subject>${attributeStatement}</saml:Assertion>`;

    const result: VerifiedSamlResponse = SSOUtil.getSamlResponseFromXML(
      sign(buildResponse(assertion), "Assertion"),
      idpKeys.publicKey,
    );

    expect(result.name?.toString()).toBe("Alice Example");
    expect(result.email.toString()).toBe("alice@example.com");
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
 * Issue #2988 - a processing instruction must not be able to rewrite a signed
 * value.
 *
 * Every attack below starts from a GENUINE, correctly signed IdP response and
 * edits it. Each one asserts three things in order:
 *
 *   1. the edited document's signature still verifies under xml-crypto, i.e.
 *      the attacker did not have to touch the digest at all;
 *   2. a textContent-based read of the edited document now yields a different
 *      identity than the one that was signed;
 *   3. SSOUtil rejects it.
 *
 * Drop the fix and (1) and (2) still hold - only (3) fails, and the result is a
 * full authentication bypass.
 * ---------------------------------------------------------------------------
 */

const PI_REJECTED: string =
  "SAML Response must not contain XML processing instructions";

describe("SSOUtil - processing instructions cannot rewrite signed values (issue #2988)", () => {
  test("rejects the reported PoC: a processing instruction hiding part of the NameID", () => {
    // A genuine response for an ordinary, unprivileged user.
    const genuine: string = sign(
      buildResponse(buildAssertion({ nameId: "not-an-admin@example.com" })),
      "Assertion",
    );

    expect(
      SSOUtil.getSamlResponseFromXML(
        genuine,
        idpKeys.publicKey,
      ).email.toString(),
    ).toBe("not-an-admin@example.com");

    // The attacker hides the "not-an-" prefix inside a processing instruction.
    const attack: string = replaceOnce(
      genuine,
      ">not-an-admin@example.com<",
      `>${hidden("not-an-")}admin@example.com<`,
    );

    // The digest never moved: xml-crypto still accepts the signature.
    expect(signatureIsCryptographicallyValid(attack)).toBe(true);

    // But the DOM now reports a completely different user.
    expect(domTextOf(attack, "NameID")).toBe("admin@example.com");

    expectRejected(attack, PI_REJECTED);
  });

  test("rejects the same rewrite under a Response-level signature", () => {
    const genuine: string = sign(
      buildResponse(buildAssertion({ nameId: "not-an-admin@example.com" })),
      "Response",
    );

    const attack: string = replaceOnce(
      genuine,
      ">not-an-admin@example.com<",
      `>${hidden("not-an-")}admin@example.com<`,
    );

    expect(signatureIsCryptographicallyValid(attack)).toBe(true);
    expect(domTextOf(attack, "NameID")).toBe("admin@example.com");

    expectRejected(attack, PI_REJECTED);
  });

  test("rejects a processing instruction that truncates the tail of the NameID", () => {
    /*
     * The mirror image of the reported shape: the signed value carries a suffix
     * the attacker wants gone, so the domain the email appears to belong to
     * changes instead of the local part.
     */
    const genuine: string = sign(
      buildResponse(
        buildAssertion({ nameId: "admin@example.com.attacker.net" }),
      ),
      "Assertion",
    );

    const attack: string = replaceOnce(
      genuine,
      ">admin@example.com.attacker.net<",
      `>admin@example.com${hidden(".attacker.net")}<`,
    );

    expect(signatureIsCryptographicallyValid(attack)).toBe(true);
    expect(domTextOf(attack, "NameID")).toBe("admin@example.com");

    expectRejected(attack, PI_REJECTED);
  });

  test("rejects a processing instruction that rewrites the Issuer", () => {
    /*
     * On a multi-tenant IdP the attacker legitimately holds a signed response
     * for their own tenant path and deletes the tenant segment from what we
     * read, so the assertion appears to come from the tenant-less issuer.
     */
    const genuine: string = sign(
      buildResponse(
        buildAssertion({
          issuer: "https://idp.example.com/attacker/metadata",
        }),
      ),
      "Assertion",
    );

    const attack: string = replaceOnce(
      genuine,
      ">https://idp.example.com/attacker/metadata<",
      `>https://idp.example.com/${hidden("attacker/")}metadata<`,
    );

    expect(signatureIsCryptographicallyValid(attack)).toBe(true);
    expect(domTextOf(attack, "Issuer")).toBe(
      "https://idp.example.com/metadata",
    );

    expectRejected(attack, PI_REJECTED);
  });

  test("rejects a processing instruction that rewrites the display name", () => {
    const genuine: string = sign(
      buildResponse(buildAssertion({ displayName: "Mallory Alice Example" })),
      "Assertion",
    );

    const attack: string = replaceOnce(
      genuine,
      ">Mallory Alice Example<",
      `>${hidden("Mallory ")}Alice Example<`,
    );

    expect(signatureIsCryptographicallyValid(attack)).toBe(true);
    expect(domTextOf(attack, "AttributeValue")).toBe("Alice Example");

    expectRejected(attack, PI_REJECTED);
  });

  test("rejects a processing instruction between two text runs of the NameID", () => {
    const genuine: string = sign(
      buildResponse(buildAssertion({ nameId: "ad-DROP-min@example.com" })),
      "Assertion",
    );

    const attack: string = replaceOnce(
      genuine,
      ">ad-DROP-min@example.com<",
      `>ad${hidden("-DROP-")}min@example.com<`,
    );

    expect(signatureIsCryptographicallyValid(attack)).toBe(true);
    expect(domTextOf(attack, "NameID")).toBe("admin@example.com");

    expectRejected(attack, PI_REJECTED);
  });
});

/*
 * ---------------------------------------------------------------------------
 * Issue #2988 - processing instructions are refused wherever they sit.
 *
 * The rewrite above only needs a processing instruction inside an identity
 * value, but there is no position in a SAML Response where one is legitimate,
 * and leaving any of them parseable leaves the next variant of the trick
 * available. These documents are SIGNED WITH the instruction already in place,
 * so the signature is genuinely valid and only the structural rule rejects them.
 * ---------------------------------------------------------------------------
 */

describe("SSOUtil - processing instructions are rejected anywhere in the document (issue #2988)", () => {
  test("rejects a processing instruction that is a direct child of the Response", () => {
    const xml: string = sign(
      buildResponse(buildAssertion(), { beforeStatus: hidden("junk") }),
      "Response",
    );

    expect(signatureIsCryptographicallyValid(xml)).toBe(true);
    expectRejected(xml, PI_REJECTED);
  });

  test("rejects a processing instruction inside <samlp:Extensions>", () => {
    const xml: string = sign(
      buildResponse(buildAssertion(), {
        extensions: `<samlp:Extensions>${hidden("junk")}</samlp:Extensions>`,
      }),
      "Response",
    );

    expect(signatureIsCryptographicallyValid(xml)).toBe(true);
    expectRejected(xml, PI_REJECTED);
  });

  test("rejects a processing instruction inside <samlp:Status>", () => {
    const xml: string = sign(
      buildResponse(buildAssertion(), {
        statusXml: `<samlp:Status>${hidden(
          "junk",
        )}<samlp:StatusCode Value="${STATUS_SUCCESS}"/></samlp:Status>`,
      }),
      "Response",
    );

    expect(signatureIsCryptographicallyValid(xml)).toBe(true);
    expectRejected(xml, PI_REJECTED);
  });

  test("rejects a processing instruction inside the Assertion but outside any identity value", () => {
    const xml: string = sign(
      buildResponse(buildAssertion({ extraInner: hidden("junk") })),
      "Assertion",
    );

    expect(signatureIsCryptographicallyValid(xml)).toBe(true);
    expectRejected(xml, PI_REJECTED);
  });

  test("rejects a processing instruction inside the <Subject>", () => {
    const assertion: string = `<saml:Assertion ID="_a" Version="2.0" IssueInstant="2024-01-01T00:00:00Z"><saml:Issuer>${ISSUER}</saml:Issuer><saml:Subject>${hidden(
      "junk",
    )}<saml:NameID>alice@example.com</saml:NameID></saml:Subject></saml:Assertion>`;

    const xml: string = sign(buildResponse(assertion), "Assertion");

    expect(signatureIsCryptographicallyValid(xml)).toBe(true);
    expectRejected(xml, PI_REJECTED);
  });

  test("rejects a processing instruction smuggled inside the <Signature> subtree", () => {
    /*
     * The enveloped-signature transform strips the whole <Signature> out of the
     * digest, so this instruction is free: the signature stays valid no matter
     * what is parked here.
     */
    const xml: string = replaceOnce(
      genuineAssertionSignedResponse(),
      "<X509Data/>",
      `<X509Data>${hidden("junk")}</X509Data>`,
    );

    expect(signatureIsCryptographicallyValid(xml)).toBe(true);
    expectRejected(xml, PI_REJECTED);
  });

  test("rejects a processing instruction in the prolog", () => {
    const xml: string = `<?xml-stylesheet href="evil.xsl"?>${genuineAssertionSignedResponse()}`;

    expect(signatureIsCryptographicallyValid(xml)).toBe(true);
    expectRejected(xml, PI_REJECTED);
  });

  test("rejects a processing instruction after the root element", () => {
    const xml: string = `${genuineAssertionSignedResponse()}${hidden("junk")}`;

    expect(signatureIsCryptographicallyValid(xml)).toBe(true);
    expectRejected(xml, PI_REJECTED);
  });

  test("rejects a prolog processing instruction that follows a valid XML declaration", () => {
    const xml: string = `<?xml version="1.0" encoding="UTF-8"?>${hidden(
      "junk",
    )}${genuineAssertionSignedResponse()}`;

    expectRejected(xml, PI_REJECTED);
  });

  test("rejects a processing instruction carrying no data at all", () => {
    const xml: string = replaceOnce(
      genuineAssertionSignedResponse(),
      ">alice@example.com<",
      "><?p?>alice@example.com<",
    );

    expectRejected(xml, PI_REJECTED);
  });

  test("rejects a processing instruction whose data is only whitespace", () => {
    const xml: string = replaceOnce(
      genuineAssertionSignedResponse(),
      ">alice@example.com<",
      "><?p ?>alice@example.com<",
    );

    expectRejected(xml, PI_REJECTED);
  });

  test("rejects the reserved 'xml' target used inside the document element", () => {
    /*
     * The XML declaration is allowed through as the one legitimate processing
     * instruction, so make sure its target cannot be reused inside the tree to
     * borrow that exemption. "xml" is a reserved target, so this does not even
     * parse - which is a fine way to be rejected, as long as it is rejected.
     */
    for (const target of ["xml", "XML", "xMl"]) {
      const xml: string = replaceOnce(
        genuineAssertionSignedResponse(),
        ">alice@example.com<",
        `><?${target} junk?>alice@example.com<`,
      );

      expectRejected(xml);
    }
  });
});

/*
 * ---------------------------------------------------------------------------
 * Identity is read from the canonical bytes that were signed.
 *
 * SSOUtil no longer extracts identity from a second, independent parse of the
 * original document. It takes xml-crypto's `signedReference` - the exact
 * canonical string the digest was computed over and the signature verified
 * against - and reads from that. This is what stops a disagreement between our
 * parse and xml-crypto's canonicalizer from being an authentication bug in the
 * first place, rather than patching one instance of it (#2988).
 *
 * That makes the canonical fragment a new failure surface: it is a standalone
 * document, so it has to carry the namespace declarations the assertion
 * inherited from its ancestors, whatever prefixes the identity provider chose.
 * These tests exercise the shapes real providers actually send.
 * ---------------------------------------------------------------------------
 */

describe("SSOUtil - identity comes from the signed canonical bytes", () => {
  function expectIdentity(xml: string): void {
    const result: VerifiedSamlResponse = SSOUtil.getSamlResponseFromXML(
      xml,
      idpKeys.publicKey,
    );

    expect(result.email.toString()).toBe("alice@example.com");
    expect(result.issuerUrl).toBe(ISSUER);
  }

  test("namespaces inherited from the Response survive canonicalization", () => {
    /*
     * The default shape: xmlns:saml is declared on the Response, used on the
     * Assertion, and must be rendered into the canonical Assertion fragment.
     */
    expectIdentity(genuineAssertionSignedResponse());
  });

  test("works when SAML uses a default namespace instead of a prefix", () => {
    const assertion: string = `<Assertion xmlns="urn:oasis:names:tc:SAML:2.0:assertion" ID="_a" Version="2.0" IssueInstant="2024-01-01T00:00:00Z"><Issuer>${ISSUER}</Issuer><Subject><NameID>alice@example.com</NameID></Subject></Assertion>`;

    expectIdentity(sign(buildResponse(assertion), "Assertion"));
  });

  test("works with an unusual namespace prefix", () => {
    const assertion: string = `<a:Assertion xmlns:a="urn:oasis:names:tc:SAML:2.0:assertion" ID="_a" Version="2.0" IssueInstant="2024-01-01T00:00:00Z"><a:Issuer>${ISSUER}</a:Issuer><a:Subject><a:NameID>alice@example.com</a:NameID></a:Subject></a:Assertion>`;

    expectIdentity(sign(buildResponse(assertion), "Assertion"));
  });

  test("works when the signature covers the whole Response", () => {
    /*
     * Here the canonical bytes are the entire Response and the assertion has to
     * be found inside them.
     */
    expectIdentity(genuineResponseSignedResponse());
  });

  test('works for a whole-document signature (Reference URI="")', () => {
    expectIdentity(
      signXml(buildResponse(buildAssertion()), {
        referenceXPath: "//*[local-name(.)='Response']",
        emptyUri: true,
      }),
    );
  });

  test("reads a NameID delivered as CDATA", () => {
    expectIdentity(
      sign(
        buildResponse(
          buildAssertion({ nameId: "<![CDATA[alice@example.com]]>" }),
        ),
        "Assertion",
      ),
    );
  });

  test("reads a NameID written with character references", () => {
    expectIdentity(
      sign(
        buildResponse(buildAssertion({ nameId: "&#97;lice@example.com" })),
        "Assertion",
      ),
    );
  });

  test("trims the XML whitespace a pretty-printing provider adds", () => {
    expectIdentity(
      sign(
        buildResponse(
          buildAssertion({ nameId: "\n        alice@example.com\n      " }),
        ),
        "Assertion",
      ),
    );
  });

  test("still extracts the display name through the canonical bytes", () => {
    const result: VerifiedSamlResponse = SSOUtil.getSamlResponseFromXML(
      genuineAssertionSignedResponse(),
      idpKeys.publicKey,
    );

    expect(result.name?.toString()).toBe("Alice Example");
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

  const COMMENT_REJECTED: string =
    "SAML Assertion must not contain XML comments";

  test("rejects a NameID containing an XML comment (comment-truncation defense)", () => {
    /*
     * Signed WITH the comment present. Exclusive c14n excludes comments, so the
     * signature is genuinely valid, but our extractor must refuse them outright.
     */
    const xml: string = sign(
      buildResponse(
        buildAssertion({ nameId: "admin@corp.com<!-- -->.attacker.com" }),
      ),
      "Assertion",
    );

    expect(signatureIsCryptographicallyValid(xml)).toBe(true);
    expectRejected(xml, COMMENT_REJECTED);
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

    expect(signatureIsCryptographicallyValid(xml)).toBe(true);
    expectRejected(xml, COMMENT_REJECTED);
  });

  test("rejects a display name containing an XML comment", () => {
    const xml: string = sign(
      buildResponse(buildAssertion({ displayName: "Alice<!-- -->Attacker" })),
      "Assertion",
    );

    expect(signatureIsCryptographicallyValid(xml)).toBe(true);
    expectRejected(xml, COMMENT_REJECTED);
  });

  /*
   * Child elements are the third way the digested bytes and `textContent` can
   * describe different strings: canonicalization digests the markup,
   * `textContent` flattens it away. The signature over these documents is
   * genuine - only the plain-text rule rejects them.
   */
  const NESTED_REJECTED: string =
    "SAML Assertion identity values must not contain nested elements";

  test("rejects a NameID containing a nested element", () => {
    const xml: string = sign(
      buildResponse(
        buildAssertion({
          nameId: "admin@corp.com<saml:Wrap>.attacker.com</saml:Wrap>",
        }),
      ),
      "Assertion",
    );

    expect(signatureIsCryptographicallyValid(xml)).toBe(true);
    expectRejected(xml, NESTED_REJECTED);
  });

  test("rejects an Issuer containing a nested element", () => {
    const xml: string = sign(
      buildResponse(
        buildAssertion({
          issuer: `${ISSUER}<saml:Wrap>.attacker.com</saml:Wrap>`,
        }),
      ),
      "Assertion",
    );

    expect(signatureIsCryptographicallyValid(xml)).toBe(true);
    expectRejected(xml, NESTED_REJECTED);
  });

  test("rejects a display name containing a nested element", () => {
    const xml: string = sign(
      buildResponse(
        buildAssertion({
          displayName: "Alice<saml:Wrap>Attacker</saml:Wrap>",
        }),
      ),
      "Assertion",
    );

    expect(signatureIsCryptographicallyValid(xml)).toBe(true);
    expectRejected(xml, NESTED_REJECTED);
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
 * The verification key must come from configuration, never from the document.
 *
 * xml-crypto 6 resolves its key as
 *   getCertFromKeyInfo(this.keyInfo) || this.publicCert || this.privateKey
 * where `keyInfo` is the <KeyInfo> of the document being verified - written by
 * whoever sent it. xml-crypto ships SignedXml.getCertFromKeyInfo, which reads
 * the certificate straight out of that element. Turn it on and anyone can sign
 * a response with a key they generated, staple the matching certificate to it,
 * and be logged in as anybody.
 *
 * The constructor defaults this to a no-op, so this is a footgun rather than a
 * live bug - but it is one constructor option away, and SSOUtil pins it shut
 * explicitly instead of relying on that default. These tests lock that in.
 *
 * Each test carries a negative control: it first proves the attack document
 * really is self-consistent (xml-crypto accepts it when told to trust the
 * embedded certificate), so the rejection that follows is attributable to
 * SSOUtil refusing the document's own key, not to a malformed certificate.
 * ---------------------------------------------------------------------------
 */

describe("SSOUtil - the verification key never comes from the document", () => {
  function attackerSignedWithEmbeddedCert(assertionXml?: string): string {
    return signXml(
      buildResponse(
        assertionXml ?? buildAssertion({ email: "admin@example.com" }),
      ),
      {
        referenceXPath: "//*[local-name(.)='Assertion']",
        privateKey: attackerKeys.privateKey,
        keyInfoContent: `<X509Data><X509Certificate>${selfSignedCertificateBase64(
          attackerKeys,
          "attacker.example.net",
        )}</X509Certificate></X509Data>`,
      },
    );
  }

  test("the attack document is genuinely self-consistent (negative control)", () => {
    /*
     * If this ever stops holding, every test below would pass vacuously - the
     * document would be rejected for being malformed rather than for carrying
     * its own key.
     */
    expect(
      signatureVerifiesAgainstEmbeddedCertificate(
        attackerSignedWithEmbeddedCert(),
      ),
    ).toBe(true);
  });

  test("rejects a response signed by the attacker with their certificate in KeyInfo", () => {
    expectRejected(attackerSignedWithEmbeddedCert());
  });

  test("rejects it at the Response level too", () => {
    const xml: string = signXml(buildResponse(buildAssertion()), {
      referenceXPath: "//*[local-name(.)='Response']",
      privateKey: attackerKeys.privateKey,
      keyInfoContent: `<X509Data><X509Certificate>${selfSignedCertificateBase64(
        attackerKeys,
        "attacker.example.net",
      )}</X509Certificate></X509Data>`,
    });

    expect(signatureVerifiesAgainstEmbeddedCertificate(xml)).toBe(true);
    expectRejected(xml);
  });

  test("still rejects when the attacker also names the real issuer", () => {
    const xml: string = attackerSignedWithEmbeddedCert(
      buildAssertion({ email: "admin@example.com", issuer: ISSUER }),
    );

    expect(signatureVerifiesAgainstEmbeddedCertificate(xml)).toBe(true);
    expectRejected(xml);
  });

  test("a genuine response is still accepted when KeyInfo carries a certificate", () => {
    /*
     * Real identity providers do send their certificate in KeyInfo. Ignoring it
     * must not mean rejecting it.
     */
    const xml: string = signXml(buildResponse(buildAssertion()), {
      referenceXPath: "//*[local-name(.)='Assertion']",
      keyInfoContent: `<X509Data><X509Certificate>${selfSignedCertificateBase64(
        idpKeys,
        "idp.example.com",
      )}</X509Certificate></X509Data>`,
    });

    expect(
      SSOUtil.getSamlResponseFromXML(xml, idpKeys.publicKey).email.toString(),
    ).toBe("alice@example.com");
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

  /*
   * The two public entry points must never disagree. isSignatureValid()
   * returning true for a document getSamlResponseFromXML() refuses would hand
   * any caller that gates on it exactly the bypass this file exists to prevent.
   */
  test("isSignatureValid agrees with getSamlResponseFromXML on every document above", () => {
    const documents: Array<string> = [
      genuineAssertionSignedResponse(),
      genuineResponseSignedResponse(),
      '<?xml version="1.0" encoding="UTF-8"?>' +
        genuineAssertionSignedResponse(),
      genuineSignedErrorResponse(),
      sign(
        buildResponse(
          buildAssertion({ nameId: "admin@corp.com<!-- -->.attacker.com" }),
        ),
        "Assertion",
      ),
      sign(
        buildResponse(
          buildAssertion({
            nameId: "admin@corp.com<saml:Wrap>.attacker.com</saml:Wrap>",
          }),
        ),
        "Assertion",
      ),
      replaceOnce(
        genuineAssertionSignedResponse(),
        ">alice@example.com<",
        `>${hidden("alice@")}example.com<`,
      ),
      "",
      "<not-xml",
    ];

    for (const xml of documents) {
      let extracted: boolean = true;

      try {
        SSOUtil.getSamlResponseFromXML(xml, idpKeys.publicKey);
      } catch {
        extracted = false;
      }

      expect(SSOUtil.isSignatureValid(xml, idpKeys.publicKey)).toBe(extracted);
    }
  });
});
