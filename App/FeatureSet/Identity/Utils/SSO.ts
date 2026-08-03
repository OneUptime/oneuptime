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

  private static readonly SAML_ASSERTION_NAMESPACES: Array<string> = [
    "urn:oasis:names:tc:SAML:2.0:assertion",
    "urn:oasis:names:tc:SAML:1.0:assertion",
  ];

  // Microsoft display name claim - the only "full name" claim we read today.
  private static readonly MS_DISPLAY_NAME_CLAIM: string =
    "http://schemas.microsoft.com/identity/claims/displayname";

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
   * It defends against XML Signature Wrapping (XSW): the historic implementation
   * validated whichever <Signature> element appeared first and then extracted the
   * identity from an independently parsed tree, so an attacker could hide a
   * genuinely signed assertion (e.g. inside <Extensions>) while presenting a
   * forged assertion for consumption. See GitHub issue #2949.
   *
   * The checks below make that impossible:
   *   1. The document must be well-formed XML with no DOCTYPE / entity
   *      declarations (blocks XXE and entity-expansion / parser-differential
   *      tricks).
   *   2. The document must contain EXACTLY ONE <Assertion> element anywhere in
   *      the tree (blocks decoy / wrapped assertions - every XSW variant needs a
   *      second assertion to hide behind).
   *   3. A <Signature> must validate against the configured certificate AND its
   *      reference must resolve to that one assertion (or an ancestor that
   *      contains it). This binds "what was signed" to "what we read".
   *   4. The identity-bearing nodes must not contain XML comments (blocks the
   *      SAML comment-truncation class of attacks).
   *
   * Throws BadRequestException on any anomaly.
   */
  public static getSamlResponseFromXML(
    samlResponse: string,
    certificate: string,
  ): VerifiedSamlResponse {
    if (!certificate) {
      throw new BadRequestException("Public Certificate not found");
    }

    const dom: XmlDocument = SSOUtil.parseXmlStrict(samlResponse);
    const assertion: XmlElement = SSOUtil.getSingleAssertion(dom);

    if (
      !SSOUtil.verifyAssertionSignature(
        samlResponse,
        certificate,
        dom,
        assertion,
      )
    ) {
      throw new BadRequestException(
        "Signature is not valid or Public Certificate configured with this SSO provider is not valid",
      );
    }

    return {
      issuerUrl: SSOUtil.getIssuerFromAssertion(assertion),
      email: SSOUtil.getEmailFromAssertion(assertion),
      name: SSOUtil.getNameFromAssertion(assertion),
    };
  }

  /*
   * Boolean form of the verification above. Kept for callers/tests that only
   * need to know whether the response carries a valid, wrapping-safe signature.
   * Uses exactly the same strict pipeline as getSamlResponseFromXML.
   */
  public static isSignatureValid(
    samlResponse: string,
    certificate: string,
  ): boolean {
    try {
      if (!certificate) {
        return false;
      }

      const dom: XmlDocument = SSOUtil.parseXmlStrict(samlResponse);
      const assertion: XmlElement = SSOUtil.getSingleAssertion(dom);

      return SSOUtil.verifyAssertionSignature(
        samlResponse,
        certificate,
        dom,
        assertion,
      );
    } catch (err) {
      logger.error(err);
      return false;
    }
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

    return dom;
  }

  /*
   * Return the single Assertion element in the document, or throw. Counting
   * assertions across the WHOLE document (any namespace, including a wrapped or
   * nested one) is what defeats signature-wrapping: the attack fundamentally
   * needs a second assertion to hide the genuine signature behind.
   */
  private static getSingleAssertion(dom: XmlDocument): XmlElement {
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

    return assertion;
  }

  /*
   * Verify that some <Signature> in the document:
   *   - validates cryptographically against the configured certificate, and
   *   - covers the given assertion (its reference resolves to the assertion or
   *     an ancestor element that contains it).
   *
   * Only if BOTH hold do we consider the assertion authentic.
   */
  private static verifyAssertionSignature(
    samlResponse: string,
    certificate: string,
    dom: XmlDocument,
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

        /*
         * Before trusting this signature, confirm it actually covers the
         * assertion we are going to read from. A signature over some unrelated
         * element must never authenticate a forged assertion.
         */
        const references: Array<{ uri?: string | undefined }> =
          (sig.references as Array<{ uri?: string | undefined }>) || [];

        const coversAssertion: boolean = references.some(
          (reference: { uri?: string | undefined }): boolean => {
            return SSOUtil.referenceCoversAssertion(
              dom,
              assertion,
              reference.uri,
            );
          },
        );

        if (!coversAssertion) {
          continue;
        }

        // Cryptographically validate digests + signature value.
        if (sig.checkSignature(samlResponse)) {
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
   * A URI of "" signs the whole document. Otherwise it points at an element by
   * ID; that element must be the assertion itself or an ancestor of it.
   */
  private static referenceCoversAssertion(
    dom: XmlDocument,
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

    return SSOUtil.isAncestorOrSelf(targets[0]!, assertion);
  }

  // Find every element carrying an ID / Id / id attribute equal to `id`.
  private static resolveElementsById(
    dom: XmlDocument,
    id: string,
  ): Array<XmlElement> {
    const all: Array<XmlElement> = SSOUtil.toElementArray(
      dom.getElementsByTagName("*"),
    );

    const matches: Array<XmlElement> = [];

    for (const element of all) {
      for (const attributeName of ["ID", "Id", "id"]) {
        if (
          element.getAttribute &&
          element.getAttribute(attributeName) === id
        ) {
          matches.push(element);
          break;
        }
      }
    }

    return matches;
  }

  private static isAncestorOrSelf(
    ancestor: XmlNode,
    node: XmlNode | null,
  ): boolean {
    let current: XmlNode | null = node;

    while (current) {
      if (current === ancestor) {
        return true;
      }
      current = current.parentNode;
    }

    return false;
  }

  private static getIssuerFromAssertion(assertion: XmlElement): string {
    const issuerElement: XmlElement | null = SSOUtil.getDirectChildByLocalName(
      assertion,
      "Issuer",
    );

    if (!issuerElement) {
      throw new BadRequestException("Issuer not found in SAML Assertion");
    }

    SSOUtil.assertNoComments(issuerElement);

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
     * Reject comments inside the NameID. Exclusive canonicalization strips
     * comments before hashing, so a naive extractor that stopped at a comment
     * could read a different value than the one that was signed
     * (e.g. "victim@corp.com<!---->.attacker.com"). We read the full text and
     * additionally refuse any comment here.
     */
    SSOUtil.assertNoComments(nameId);

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
          SSOUtil.assertNoComments(attributeValue);
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
    for (
      let child: XmlNode | null = parent.firstChild;
      child;
      child = child.nextSibling
    ) {
      if (
        child.nodeType === 1 &&
        (child as XmlElement).localName === localName
      ) {
        return child as XmlElement;
      }
    }

    return null;
  }

  private static getTrimmedText(element: XmlElement): string {
    return (element.textContent || "").trim();
  }

  // Throw if the element subtree contains any XML comment node.
  private static assertNoComments(element: XmlElement): void {
    const stack: Array<XmlNode> = [element];

    while (stack.length > 0) {
      const node: XmlNode = stack.pop()!;

      for (
        let child: XmlNode | null = node.firstChild;
        child;
        child = child.nextSibling
      ) {
        // nodeType 8 === COMMENT_NODE
        if (child.nodeType === 8) {
          throw new BadRequestException(
            "SAML Assertion must not contain XML comments",
          );
        }
        stack.push(child);
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
