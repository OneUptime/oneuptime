import URL from "Common/Types/API/URL";
import OneUptimeDate from "Common/Types/Date";
import Email from "Common/Types/Email";
import BadRequestException from "Common/Types/Exception/BadRequestException";
import Text from "Common/Types/Text";
import logger from "Common/Server/Utils/Logger";
import xmlCrypto, { FileKeyInfo } from "xml-crypto";
import {
  DOMParser,
  Document as XmlDocument,
  Element as XmlElement,
  Node as XmlNode,
} from "@xmldom/xmldom";
import zlib from "zlib";
import Name from "Common/Types/Name";

/*
 * Result of successfully verifying and parsing a SAML Response.
 * Every field is sourced exclusively from the single, cryptographically
 * verified Assertion - never from an independently parsed tree.
 */
export interface VerifiedSamlResponse {
  issuerUrl: string;
  email: Email;
  name: Name | null;
}

export default class SSOUtil {
  // Namespaces used across the SAML documents we consume.
  private static readonly XMLDSIG_NAMESPACE: string =
    "http://www.w3.org/2000/09/xmldsig#";

  private static readonly SAML_PROTOCOL_NAMESPACE: string =
    "urn:oasis:names:tc:SAML:2.0:protocol";

  private static readonly SAML_ASSERTION_NAMESPACES: Array<string> = [
    "urn:oasis:names:tc:SAML:2.0:assertion",
    "urn:oasis:names:tc:SAML:1.0:assertion",
  ];

  /*
   * The only top-level <StatusCode> value that means "the user authenticated".
   * SAML 2.0 Core, section 3.2.2.2.
   */
  private static readonly SAML_STATUS_SUCCESS: string =
    "urn:oasis:names:tc:SAML:2.0:status:Success";

  // xml-crypto resolves same-document references against these attribute names.
  private static readonly ID_ATTRIBUTE_LOCAL_NAMES: Array<string> = [
    "ID",
    "Id",
    "id",
  ];

  // Microsoft display name claim - the only "full name" claim we read today.
  private static readonly MS_DISPLAY_NAME_CLAIM: string =
    "http://schemas.microsoft.com/identity/claims/displayname";

  /*
   * DOM node types we test for. xmldom exposes these as Node constants, but
   * spelling them out keeps the checks readable next to the nodeType they
   * compare against.
   */
  private static readonly ELEMENT_NODE: number = 1;
  private static readonly PROCESSING_INSTRUCTION_NODE: number = 7;
  private static readonly COMMENT_NODE: number = 8;
  private static readonly DOCUMENT_NODE: number = 9;

  public static createSAMLRequestUrl(data: {
    acsUrl: URL;
    signOnUrl: URL;
    issuerUrl: URL;
  }): URL {
    const { acsUrl, signOnUrl } = data;

    const samlRequest: string = `<samlp:AuthnRequest xmlns="urn:oasis:names:tc:SAML:2.0:metadata" ID="${Text.generateRandomText(
      10,
    ).toUpperCase()}" Version="2.0" IssueInstant="${OneUptimeDate.getCurrentDate().toISOString()}" IsPassive="false" AssertionConsumerServiceURL="${acsUrl.toString()}" xmlns:samlp="urn:oasis:names:tc:SAML:2.0:protocol" ForceAuthn="false"><Issuer xmlns="urn:oasis:names:tc:SAML:2.0:assertion">${data.issuerUrl.toString()}</Issuer></samlp:AuthnRequest>`;

    const deflated: Buffer = zlib.deflateRawSync(samlRequest);

    const base64Encoded: string = deflated.toString("base64");

    return URL.fromString(signOnUrl.toString()).addQueryParam(
      "SAMLRequest",
      base64Encoded,
      true,
    );
  }

  /*
   * Verify the signature on a SAML Response and extract the identity from the
   * SAME assertion that the signature actually covers.
   *
   * This is the single, safe entry point that every SAML login flow must use.
   * It defends against XML Signature Wrapping (XSW) - the family of attacks
   * where a genuinely signed element and the element we actually read are not
   * the same element.
   *
   * Three reported bypasses shaped this code:
   *
   *   - GitHub issue #2949: the original implementation validated whichever
   *     <Signature> appeared first and then extracted the identity from an
   *     independently parsed tree, so a genuinely signed assertion could be
   *     hidden (e.g. inside <Extensions>) while a forged sibling assertion was
   *     consumed.
   *
   *   - GitHub issue #2981: counting assertions is not sufficient. The
   *     enveloped-signature transform removes the whole <Signature> subtree
   *     from the digest, so ANY element parked inside a <Signature> is
   *     unauthenticated even though the signature validates. An attacker who
   *     replays a genuinely signed *error* Response (which legitimately carries
   *     no assertion) can park a forged assertion inside a <Signature> and it
   *     becomes the document's one and only assertion. xml-crypto makes this
   *     easier still: its enveloped-signature transform strips every
   *     <Signature> whose <SignatureValue> text matches the one being verified,
   *     so a decoy <Signature> that merely repeats the genuine
   *     <SignatureValue> is removed from the digest too.
   *
   *   - GitHub issue #2988: even a signature that provably covers the element
   *     we read is not enough if the bytes that were digested and the bytes we
   *     read are not the same bytes. xml-crypto canonicalizes every node that
   *     exposes a `data` property by emitting that data as plain text, so a
   *     processing instruction `<?p not-an-?>` is digested as the characters
   *     `not-an-` rather than as `<?p not-an-?>`. The DOM, correctly, leaves
   *     processing instructions out of `textContent` entirely. So
   *     `<NameID><?p not-an-?>admin@example.com</NameID>` digests exactly like
   *     the genuine `<NameID>not-an-admin@example.com</NameID>` while we read
   *     it as `admin@example.com`.
   *
   * The defence is to stop reasoning about "is this signed?" in isolation and
   * instead pin the document to the shape SAML actually defines, so that the
   * element we read cannot be anywhere except inside the signed payload:
   *
   *   1. Well-formed XML with no DOCTYPE / entity declarations (blocks XXE,
   *      entity expansion and parser-differential tricks) and no processing
   *      instructions anywhere in the document apart from the XML declaration
   *      (blocks the canonicalization/`textContent` desynchronization above).
   *   2. The root MUST be <samlp:Response> (SAML 2.0 protocol namespace).
   *   3. No encrypted elements - we cannot decrypt them, and silently reading
   *      around them would mean reading unauthenticated data.
   *   4. EXACTLY ONE <Assertion> in the whole document, and it MUST be a direct
   *      child of the root <Response>. Per SAML 2.0 Core (ResponseType) that is
   *      the only place an assertion may legitimately appear, and it makes
   *      every "hide the real one / smuggle a fake one" placement impossible.
   *   5. Every <ds:Signature> MUST be a direct child of the root <Response> or
   *      of the Assertion (SAML 2.0 Core: StatusResponseType and AssertionType
   *      each allow at most one), no two signatures may share a parent, no two
   *      may share a <SignatureValue>, and no signature may carry a payload
   *      (<ds:Object> or SAML content) inside it.
   *   6. A <Signature> must validate against the configured certificate AND at
   *      least one of its verified references must resolve to exactly one
   *      element which is the Assertion itself or the root <Response>.
   *   7. The <Status> must be a top-level Success. SAML 2.0 Profiles 4.1.4.2:
   *      an identity provider returning an error "MUST NOT include any
   *      assertions in the <Response> message", so an assertion delivered
   *      alongside an error status is by definition not one the IdP issued.
   *   8. The identity-bearing nodes must hold plain text and nothing else - no
   *      comments (blocks the SAML comment-truncation class of attacks), no
   *      processing instructions, no child elements. Whatever we read is then
   *      exactly the character data the canonicalizer digested.
   *
   * Throws BadRequestException on any anomaly.
   */
  public static getSamlResponseFromXML(
    samlResponse: string,
    certificate: string,
  ): VerifiedSamlResponse {
    const assertion: XmlElement = SSOUtil.verifyAndGetAssertion(
      samlResponse,
      certificate,
    );

    return {
      issuerUrl: SSOUtil.getIssuerFromAssertion(assertion),
      email: SSOUtil.getEmailFromAssertion(assertion),
      name: SSOUtil.getNameFromAssertion(assertion),
    };
  }

  /*
   * Boolean form of the verification above. Kept for callers/tests that only
   * need to know whether the response carries a valid, wrapping-safe signature.
   *
   * It runs getSamlResponseFromXML itself rather than a subset of it. Anything
   * less would let this return true for a document the real entry point
   * refuses - the rules that reject a NameID containing a comment, a processing
   * instruction or a child element live in the extraction step, and a caller
   * gating on "is this SAML response valid?" must not be told yes about a
   * document whose identity we would then refuse to read.
   */
  public static isSignatureValid(
    samlResponse: string,
    certificate: string,
  ): boolean {
    try {
      SSOUtil.getSamlResponseFromXML(samlResponse, certificate);
      return true;
    } catch (err) {
      logger.error(err);
      return false;
    }
  }

  /*
   * The single verification pipeline. Returns the one assertion that the
   * signature provably covers, or throws.
   */
  private static verifyAndGetAssertion(
    samlResponse: string,
    certificate: string,
  ): XmlElement {
    if (!certificate) {
      throw new BadRequestException("Public Certificate not found");
    }

    const dom: XmlDocument = SSOUtil.parseXmlStrict(samlResponse);
    const response: XmlElement = SSOUtil.getResponseElement(dom);

    SSOUtil.assertNoEncryptedElements(dom);

    const assertion: XmlElement = SSOUtil.getSingleAssertion(dom, response);

    SSOUtil.assertSignaturesAreWellPlaced(dom, response, assertion);

    if (
      !SSOUtil.verifyAssertionSignature(
        samlResponse,
        certificate,
        dom,
        response,
        assertion,
      )
    ) {
      throw new BadRequestException(
        "Signature is not valid or Public Certificate configured with this SSO provider is not valid",
      );
    }

    SSOUtil.assertStatusIsSuccess(dom, response);

    return assertion;
  }

  /*
   * Parse the SAML Response once, strictly. Rejects empty input, DOCTYPE / entity
   * declarations, and any XML that is not well-formed.
   */
  private static parseXmlStrict(samlResponse: string): XmlDocument {
    if (typeof samlResponse !== "string" || samlResponse.trim() === "") {
      throw new BadRequestException("SAML Response is empty");
    }

    /*
     * A SAML Response has no legitimate need for a DOCTYPE or entity
     * declarations. Rejecting them outright blocks XML External Entity (XXE)
     * attacks, billion-laughs style entity expansion, and parser-differential
     * tricks that rely on entity handling.
     */
    const doctypeOrEntity: RegExp = /<!DOCTYPE|<!ENTITY/i;
    if (doctypeOrEntity.test(samlResponse)) {
      throw new BadRequestException(
        "SAML Response must not contain a DOCTYPE or entity declarations",
      );
    }

    let dom: XmlDocument;

    try {
      dom = new DOMParser({
        onError: (level: "warning" | "error" | "fatalError"): void => {
          if (level === "error" || level === "fatalError") {
            throw new Error("Malformed XML in SAML Response");
          }
        },
      }).parseFromString(samlResponse, "text/xml");
    } catch {
      throw new BadRequestException("SAML Response is not valid XML");
    }

    if (!dom || !dom.documentElement) {
      throw new BadRequestException("SAML Response is not valid XML");
    }

    SSOUtil.assertNoProcessingInstructions(dom);

    return dom;
  }

  /*
   * Reject XML processing instructions (issue #2988).
   *
   * xml-crypto's canonicalizer emits any node that exposes a `data` property as
   * plain text, so a processing instruction is digested as its data rather than
   * as `<?target data?>`. The DOM, per spec, omits processing instructions from
   * `textContent` entirely. The digest and the value we read therefore describe
   * different strings, and an attacker can wrap any leading part of a signed
   * value in a processing instruction to delete it from what we read while the
   * digest stays byte-for-byte identical:
   *
   *   <saml:NameID>not-an-admin@example.com</saml:NameID>       (signed)
   *   <saml:NameID><?p not-an-?>admin@example.com</saml:NameID> (forged)
   *
   * Both digest as "not-an-admin@example.com"; the second reads as
   * "admin@example.com".
   *
   * A SAML Response has no legitimate use for a processing instruction, so we
   * reject every one of them rather than trying to reason about which ones land
   * somewhere harmless. The XML declaration is the sole exception: xmldom
   * surfaces it as a processing instruction node with target "xml" parented on
   * the Document (never inside the document element), it is not part of any
   * canonicalized subtree, and real identity providers emit it.
   */
  private static assertNoProcessingInstructions(dom: XmlDocument): void {
    const stack: Array<XmlNode> = [dom as unknown as XmlNode];

    while (stack.length > 0) {
      const node: XmlNode = stack.pop()!;

      for (
        let child: XmlNode | null = node.firstChild;
        child;
        child = child.nextSibling
      ) {
        if (child.nodeType === SSOUtil.PROCESSING_INSTRUCTION_NODE) {
          const parentNodeType: number | undefined = child.parentNode?.nodeType;

          const isXmlDeclaration: boolean =
            parentNodeType === SSOUtil.DOCUMENT_NODE &&
            (child as unknown as { target?: string }).target === "xml";

          if (!isXmlDeclaration) {
            throw new BadRequestException(
              "SAML Response must not contain XML processing instructions",
            );
          }
        }

        stack.push(child);
      }
    }
  }

  /*
   * The document element must be a SAML 2.0 protocol <Response>. Anchoring on
   * the root - rather than searching the tree for something Response-shaped -
   * is what lets every later check talk about "direct child of the Response".
   */
  private static getResponseElement(dom: XmlDocument): XmlElement {
    const root: XmlElement | null = dom.documentElement;

    if (
      !root ||
      root.localName !== "Response" ||
      root.namespaceURI !== SSOUtil.SAML_PROTOCOL_NAMESPACE
    ) {
      throw new BadRequestException(
        "SAML Response must be a samlp:Response element in the urn:oasis:names:tc:SAML:2.0:protocol namespace",
      );
    }

    return root;
  }

  /*
   * We do not support encrypted assertions / identifiers / attributes. If one
   * is present we must fail loudly: quietly reading whatever plaintext sits
   * next to it would mean reading data the IdP never intended us to consume.
   */
  private static assertNoEncryptedElements(dom: XmlDocument): void {
    const encryptedLocalNames: Array<string> = [
      "EncryptedAssertion",
      "EncryptedID",
      "EncryptedAttribute",
    ];

    for (const localName of encryptedLocalNames) {
      const found: Array<XmlElement> = SSOUtil.toElementArray(
        dom.getElementsByTagNameNS("*", localName),
      );

      if (found.length > 0) {
        throw new BadRequestException(
          "Encrypted SAML Responses are not supported. Please configure this SSO provider to send an unencrypted, signed assertion.",
        );
      }
    }
  }

  /*
   * Return the single Assertion element in the document, or throw.
   *
   * Counting assertions across the WHOLE document (any namespace, including a
   * wrapped or nested one) removes the decoy every XSW variant needs. Requiring
   * that the assertion is a DIRECT CHILD of the root <Response> - the only
   * position SAML 2.0 Core's ResponseType allows - removes every hiding place,
   * including the <ds:Object> of a <Signature>, whose whole subtree is stripped
   * out of the digest by the enveloped-signature transform (issue #2981).
   */
  private static getSingleAssertion(
    dom: XmlDocument,
    response: XmlElement,
  ): XmlElement {
    const assertions: Array<XmlElement> = SSOUtil.toElementArray(
      dom.getElementsByTagNameNS("*", "Assertion"),
    );

    if (assertions.length === 0) {
      throw new BadRequestException("SAML Assertion not found");
    }

    if (assertions.length !== 1) {
      throw new BadRequestException(
        "Expected exactly one Assertion in SAML Response",
      );
    }

    const assertion: XmlElement = assertions[0]!;

    if (
      !SSOUtil.SAML_ASSERTION_NAMESPACES.includes(assertion.namespaceURI || "")
    ) {
      throw new BadRequestException("SAML Assertion has an invalid namespace");
    }

    if (assertion.parentNode !== response) {
      throw new BadRequestException(
        "SAML Assertion must be a direct child of the SAML Response",
      );
    }

    return assertion;
  }

  /*
   * Constrain where signatures may live and what they may carry.
   *
   * SAML 2.0 Core allows at most one <ds:Signature>, as a direct child, on
   * StatusResponseType (the <Response>) and on AssertionType (the
   * <Assertion>). Anything else is either an attack or a document we have no
   * business trusting. Two extra rules close the specific tricks from #2981:
   *
   *   - No two signatures may repeat the same <SignatureValue>. xml-crypto's
   *     enveloped-signature transform deletes EVERY signature whose
   *     <SignatureValue> matches the one under verification, so a decoy that
   *     copies the genuine value is silently removed from the digest.
   *
   *   - A <Signature> may not carry a payload. Its subtree is excluded from
   *     the digest of the reference that envelopes it, so a <ds:Object> (or any
   *     smuggled SAML element) inside it is unauthenticated by construction.
   */
  private static assertSignaturesAreWellPlaced(
    dom: XmlDocument,
    response: XmlElement,
    assertion: XmlElement,
  ): void {
    const signatures: Array<XmlElement> = SSOUtil.toElementArray(
      dom.getElementsByTagNameNS(SSOUtil.XMLDSIG_NAMESPACE, "Signature"),
    );

    let responseSignatureSeen: boolean = false;
    let assertionSignatureSeen: boolean = false;
    const signatureValuesSeen: Set<string> = new Set<string>();

    for (const signature of signatures) {
      const parent: XmlNode | null = signature.parentNode;

      if (parent === response) {
        if (responseSignatureSeen) {
          throw new BadRequestException(
            "SAML Response must not contain more than one Signature",
          );
        }
        responseSignatureSeen = true;
      } else if (parent === assertion) {
        if (assertionSignatureSeen) {
          throw new BadRequestException(
            "SAML Assertion must not contain more than one Signature",
          );
        }
        assertionSignatureSeen = true;
      } else {
        throw new BadRequestException(
          "An XML Signature in a SAML Response must be a direct child of the Response or of the Assertion",
        );
      }

      SSOUtil.assertSignatureCarriesNoPayload(signature);

      const signatureValue: string = SSOUtil.getSignatureValueText(signature);

      if (signatureValuesSeen.has(signatureValue)) {
        throw new BadRequestException(
          "SAML Response must not contain two Signatures with the same SignatureValue",
        );
      }

      signatureValuesSeen.add(signatureValue);
    }
  }

  /*
   * Nothing that we (or anyone) would read may live inside a <Signature>: the
   * enveloped-signature transform removes the entire <Signature> subtree before
   * the digest is computed, so its contents are never authenticated.
   */
  private static assertSignatureCarriesNoPayload(signature: XmlElement): void {
    const descendants: Array<XmlElement> = SSOUtil.toElementArray(
      signature.getElementsByTagName("*"),
    );

    for (const element of descendants) {
      const namespaceUri: string = element.namespaceURI || "";

      if (
        namespaceUri === SSOUtil.XMLDSIG_NAMESPACE &&
        element.localName === "Object"
      ) {
        throw new BadRequestException(
          "XML Signature Object elements are not allowed in a SAML Response",
        );
      }

      if (
        namespaceUri === SSOUtil.SAML_PROTOCOL_NAMESPACE ||
        SSOUtil.SAML_ASSERTION_NAMESPACES.includes(namespaceUri) ||
        element.localName === "Assertion"
      ) {
        throw new BadRequestException(
          "SAML elements are not allowed inside an XML Signature",
        );
      }
    }
  }

  private static getSignatureValueText(signature: XmlElement): string {
    const signatureValues: Array<XmlElement> = SSOUtil.toElementArray(
      signature.getElementsByTagNameNS(
        SSOUtil.XMLDSIG_NAMESPACE,
        "SignatureValue",
      ),
    );

    if (signatureValues.length === 0) {
      return "";
    }

    return SSOUtil.getTrimmedText(signatureValues[0]!);
  }

  /*
   * Verify that some <Signature> in the document:
   *   - validates cryptographically against the configured certificate, and
   *   - has a verified reference that resolves to exactly one element, and that
   *     element is the Assertion itself or the root <Response>.
   *
   * The references are read back AFTER checkSignature() because xml-crypto
   * rebuilds them from the canonicalized <SignedInfo> it just verified - the
   * ones parsed by loadSignature() are still unauthenticated at that point.
   *
   * Only if BOTH hold do we consider the assertion authentic.
   */
  private static verifyAssertionSignature(
    samlResponse: string,
    certificate: string,
    dom: XmlDocument,
    response: XmlElement,
    assertion: XmlElement,
  ): boolean {
    const signatures: Array<XmlElement> = SSOUtil.toElementArray(
      dom.getElementsByTagNameNS(SSOUtil.XMLDSIG_NAMESPACE, "Signature"),
    );

    if (signatures.length === 0) {
      return false;
    }

    for (const signature of signatures) {
      try {
        const sig: xmlCrypto.SignedXml = new xmlCrypto.SignedXml();

        sig.keyInfoProvider = {
          getKeyInfo: function (_key: unknown): string {
            return `<X509Data><X509Certificate>${certificate}</X509Certificate></X509Data>`;
          },
          getKey: function (): string {
            return certificate;
          } as unknown as () => Buffer,
        } as FileKeyInfo;

        sig.loadSignature(signature.toString());

        // Cryptographically validate digests + signature value.
        if (!sig.checkSignature(samlResponse)) {
          continue;
        }

        /*
         * The signature is genuine. Now confirm it actually covers the
         * assertion we are going to read from - a signature over some unrelated
         * element must never authenticate a forged assertion.
         */
        const references: Array<{ uri?: string | undefined }> =
          (sig.references as Array<{ uri?: string | undefined }>) || [];

        const coversAssertion: boolean = references.some(
          (reference: { uri?: string | undefined }): boolean => {
            return SSOUtil.referenceCoversAssertion(
              dom,
              response,
              assertion,
              reference.uri,
            );
          },
        );

        if (coversAssertion) {
          return true;
        }
      } catch (err) {
        logger.error(err);
        continue;
      }
    }

    return false;
  }

  /*
   * Does a signed Reference (identified by its URI) cover the assertion?
   *
   * A URI of "" signs the whole document, whose root is the <Response> that the
   * assertion is a direct child of. Otherwise it points at an element by ID and
   * that element must be the Assertion itself or the root <Response>; those are
   * the only two elements SAML lets a signature apply to, and both contain the
   * assertion in the digested payload.
   */
  private static referenceCoversAssertion(
    dom: XmlDocument,
    response: XmlElement,
    assertion: XmlElement,
    uri: string | undefined,
  ): boolean {
    if (!uri || uri === "") {
      // Whole-document signature: the single assertion is necessarily covered.
      return true;
    }

    const id: string = uri.charAt(0) === "#" ? uri.substring(1) : uri;

    const targets: Array<XmlElement> = SSOUtil.resolveElementsById(dom, id);

    // Ambiguous (>1) or dangling (0) references do not count as coverage.
    if (targets.length !== 1) {
      return false;
    }

    const target: XmlElement = targets[0]!;

    return target === assertion || target === response;
  }

  /*
   * Find every element carrying an ID / Id / id attribute equal to `id`.
   * Matching on the attribute's LOCAL name mirrors how xml-crypto resolves
   * same-document references, so we can never disagree with it about which
   * element a reference points at.
   */
  private static resolveElementsById(
    dom: XmlDocument,
    id: string,
  ): Array<XmlElement> {
    const all: Array<XmlElement> = SSOUtil.toElementArray(
      dom.getElementsByTagName("*"),
    );

    const matches: Array<XmlElement> = [];

    for (const element of all) {
      const attributes: XmlElement["attributes"] | null = element.attributes;

      if (!attributes) {
        continue;
      }

      for (let index: number = 0; index < attributes.length; index++) {
        const attribute: { localName?: string; name?: string; value?: string } =
          attributes[index] as unknown as {
            localName?: string;
            name?: string;
            value?: string;
          };

        if (!attribute) {
          continue;
        }

        const attributeLocalName: string =
          attribute.localName || attribute.name || "";

        if (
          SSOUtil.ID_ATTRIBUTE_LOCAL_NAMES.includes(attributeLocalName) &&
          attribute.value === id
        ) {
          matches.push(element);
          break;
        }
      }
    }

    return matches;
  }

  /*
   * SAML 2.0 Profiles 4.1.4.2: an identity provider that wants to return an
   * error "MUST NOT include any assertions in the <Response> message". So a
   * non-Success status can never legitimately accompany an assertion, and a
   * replayed error Response can never be turned into a login.
   */
  private static assertStatusIsSuccess(
    dom: XmlDocument,
    response: XmlElement,
  ): void {
    const statuses: Array<XmlElement> = SSOUtil.toElementArray(
      dom.getElementsByTagNameNS(SSOUtil.SAML_PROTOCOL_NAMESPACE, "Status"),
    );

    if (statuses.length !== 1) {
      throw new BadRequestException(
        "Expected exactly one Status element in SAML Response",
      );
    }

    const status: XmlElement = statuses[0]!;

    if (status.parentNode !== response) {
      throw new BadRequestException(
        "SAML Status must be a direct child of the SAML Response",
      );
    }

    const statusCodes: Array<XmlElement> = SSOUtil.getDirectChildrenByLocalName(
      status,
      "StatusCode",
    ).filter((element: XmlElement): boolean => {
      return element.namespaceURI === SSOUtil.SAML_PROTOCOL_NAMESPACE;
    });

    if (statusCodes.length !== 1) {
      throw new BadRequestException(
        "Expected exactly one StatusCode element in SAML Status",
      );
    }

    const statusCode: string = statusCodes[0]!.getAttribute("Value") || "";

    if (statusCode !== SSOUtil.SAML_STATUS_SUCCESS) {
      throw new BadRequestException(
        `SAML Response was not successful${SSOUtil.describeStatusCode(
          statusCode,
        )}`,
      );
    }
  }

  /*
   * The status code is attacker-controllable (we have verified a signature, but
   * not that the signer intended this document). Only echo it back when it
   * looks like a SAML status URI so it cannot be used to inject junk into
   * error pages or logs.
   */
  private static describeStatusCode(statusCode: string): string {
    const safeStatusCode: RegExp = /^[A-Za-z0-9:._/-]{1,200}$/;

    if (!statusCode || !safeStatusCode.test(statusCode)) {
      return "";
    }

    return `. Status: ${statusCode}`;
  }

  private static getIssuerFromAssertion(assertion: XmlElement): string {
    const issuerElement: XmlElement | null = SSOUtil.getDirectChildByLocalName(
      assertion,
      "Issuer",
    );

    if (!issuerElement) {
      throw new BadRequestException("Issuer not found in SAML Assertion");
    }

    SSOUtil.assertPlainTextOnly(issuerElement);

    const issuerUrl: string = SSOUtil.getTrimmedText(issuerElement);

    if (!issuerUrl) {
      throw new BadRequestException("Issuer URL not found in SAML response");
    }

    return issuerUrl;
  }

  private static getEmailFromAssertion(assertion: XmlElement): Email {
    const subject: XmlElement | null = SSOUtil.getDirectChildByLocalName(
      assertion,
      "Subject",
    );

    if (!subject) {
      throw new BadRequestException("SAML Subject not found");
    }

    const nameId: XmlElement | null = SSOUtil.getDirectChildByLocalName(
      subject,
      "NameID",
    );

    if (!nameId) {
      throw new BadRequestException("SAML NAME ID not found");
    }

    /*
     * The NameID is the identity itself, so it is the value an attacker most
     * wants to desynchronize from the digest. See assertPlainTextOnly.
     */
    SSOUtil.assertPlainTextOnly(nameId);

    const emailString: string = SSOUtil.getTrimmedText(nameId);

    if (!emailString) {
      throw new BadRequestException("SAML Email not found");
    }

    return new Email(emailString);
  }

  private static getNameFromAssertion(assertion: XmlElement): Name | null {
    const attributeStatement: XmlElement | null =
      SSOUtil.getDirectChildByLocalName(assertion, "AttributeStatement");

    if (!attributeStatement) {
      return null;
    }

    const attributes: Array<XmlElement> = SSOUtil.toElementArray(
      attributeStatement.getElementsByTagNameNS("*", "Attribute"),
    );

    for (const attribute of attributes) {
      const name: string | null = attribute.getAttribute("Name");

      if (name === SSOUtil.MS_DISPLAY_NAME_CLAIM) {
        const attributeValue: XmlElement | null =
          SSOUtil.getDirectChildByLocalName(attribute, "AttributeValue");

        if (attributeValue) {
          SSOUtil.assertPlainTextOnly(attributeValue);
          const fullName: string = SSOUtil.getTrimmedText(attributeValue);
          if (fullName) {
            return new Name(fullName);
          }
        }
      }
    }

    return null;
  }

  // ---- Small DOM helpers -------------------------------------------------

  private static getDirectChildByLocalName(
    parent: XmlElement,
    localName: string,
  ): XmlElement | null {
    return SSOUtil.getDirectChildrenByLocalName(parent, localName)[0] || null;
  }

  private static getDirectChildrenByLocalName(
    parent: XmlElement,
    localName: string,
  ): Array<XmlElement> {
    const children: Array<XmlElement> = [];

    for (
      let child: XmlNode | null = parent.firstChild;
      child;
      child = child.nextSibling
    ) {
      if (
        child.nodeType === 1 &&
        (child as XmlElement).localName === localName
      ) {
        children.push(child as XmlElement);
      }
    }

    return children;
  }

  private static getTrimmedText(element: XmlElement): string {
    return (element.textContent || "").trim();
  }

  /*
   * An identity-bearing element must hold character data and nothing else.
   *
   * This keeps the string we read identical to the string the canonicalizer
   * digested. Three node kinds would break that equality:
   *
   *   - Comments. Exclusive canonicalization strips them before hashing, so an
   *     extractor that stopped at one could read a different value than was
   *     signed (e.g. "victim@corp.com<!---->.attacker.com").
   *
   *   - Processing instructions. xml-crypto digests their data as plain text
   *     while the DOM leaves them out of `textContent` (issue #2988). The
   *     parser already refuses these across the whole document; refusing them
   *     here too keeps the guarantee attached to the values we consume rather
   *     than to a check somewhere upstream.
   *
   *   - Child elements. `textContent` flattens their markup away while
   *     canonicalization digests it, so the two views of the value diverge.
   *     No SAML element we read from is allowed mixed content anyway: NameID
   *     and Issuer are both NameIDType, whose content model is a plain string.
   */
  private static assertPlainTextOnly(element: XmlElement): void {
    for (
      let child: XmlNode | null = element.firstChild;
      child;
      child = child.nextSibling
    ) {
      if (child.nodeType === SSOUtil.COMMENT_NODE) {
        throw new BadRequestException(
          "SAML Assertion must not contain XML comments",
        );
      }

      if (child.nodeType === SSOUtil.PROCESSING_INSTRUCTION_NODE) {
        throw new BadRequestException(
          "SAML Response must not contain XML processing instructions",
        );
      }

      if (child.nodeType === SSOUtil.ELEMENT_NODE) {
        throw new BadRequestException(
          "SAML Assertion identity values must not contain nested elements",
        );
      }
    }
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
}
