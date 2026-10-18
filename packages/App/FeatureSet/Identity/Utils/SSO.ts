import URL from "Common/Types/API/URL";
import OneUptimeDate from "Common/Types/Date";
import Email from "Common/Types/Email";
import BadRequestException from "Common/Types/Exception/BadRequestException";
import Text from "Common/Types/Text";
import logger from "Common/Server/Utils/Logger";
import { Reference, SignedXml } from "xml-crypto";
import {
  DOMParser,
  Document as XmlDocument,
  Element as XmlElement,
  Node as XmlNode,
} from "@xmldom/xmldom";
import zlib from "zlib";
import Name from "Common/Types/Name";
import ColumnLength from "Common/Types/Database/ColumnLength";
import SamlServiceProviders, {
  SamlServiceProvider,
} from "./SamlServiceProvider";

/*
 * Result of successfully verifying and parsing a SAML Response.
 * Every field is sourced exclusively from the single, cryptographically
 * verified Assertion - never from an independently parsed tree.
 */
export interface VerifiedSamlResponse {
  issuerUrl: string;
  email: Email;
  name: Name | null;

  /*
   * The assertion's ID, which the identity provider makes unique to each
   * assertion: what a second use of the same response is recognised by
   * (SamlAssertionOneTimeUse).
   */
  assertionId: string;

  /*
   * The last moment this assertion could still be accepted. After it the
   * time rules refuse it anyway, so its use need not be remembered longer.
   */
  acceptableUntil: Date;
}

/*
 * What a SAML sign-in answers when a response is not for this provider, or
 * not for now. Each says what to fix: an admin setting up a provider reads
 * them while testing it, and the SSO docs page quotes them.
 */
export const SAML_AUDIENCE_MISMATCH_MESSAGE: string =
  "SAML Audience does not match. In your identity provider, set the Entity ID (Audience URI) of this application to the Entity ID shown for this provider.";

export const SAML_AUDIENCE_MISSING_MESSAGE: string =
  "SAML Audience is missing. In your identity provider, set the Entity ID (Audience URI) of this application to the Entity ID shown for this provider.";

export const SAML_RECIPIENT_MISMATCH_MESSAGE: string =
  "SAML Recipient does not match. In your identity provider, set the Reply URL (Assertion Consumer Service URL) of this application to the Reply URL shown for this provider.";

export const SAML_RECIPIENT_MISSING_MESSAGE: string =
  "SAML Recipient is missing. In your identity provider, set the Reply URL (Assertion Consumer Service URL) of this application to the Reply URL shown for this provider.";

export const SAML_DESTINATION_MISMATCH_MESSAGE: string =
  "SAML Destination does not match. In your identity provider, set the Reply URL (Assertion Consumer Service URL) of this application to the Reply URL shown for this provider.";

export const SAML_RESPONSE_EXPIRED_MESSAGE: string =
  "SAML response has expired. Sign in again. If this keeps happening, check that the clocks of your identity provider and of this server are right.";

export const SAML_RESPONSE_NOT_YET_VALID_MESSAGE: string =
  "SAML response is not valid yet. Check that the clocks of your identity provider and of this server are right, then sign in again.";

/*
 * Where an assertion carries the person's name. OneUptime reads it only to
 * name the account it creates at someone's first sign-in; the email address
 * always comes from the Name ID. Tried in this order, and the first that
 * gives a name wins:
 *
 *   1. A display name: the Microsoft claim, which Microsoft Entra ID and
 *      AD FS send when asked, or a displayName attribute.
 *   2. A given name and a family name, joined: Okta's attribute statements
 *      (firstName, lastName), the claims Microsoft Entra ID sends by default
 *      (givenname, surname), OneLogin's, and the LDAP object identifiers
 *      Shibboleth and others use.
 *   3. The xmlsoap name claim, unless it is an address: Auth0 sends the
 *      person's name there, Microsoft Entra ID the user principal name.
 *
 * Attribute names are compared without regard to case, as identity provider
 * admins type them by hand.
 */
export const SAML_DISPLAY_NAME_ATTRIBUTES: ReadonlyArray<string> = [
  "http://schemas.microsoft.com/identity/claims/displayname",
  "displayName",
  "urn:oid:2.16.840.1.113730.3.1.241",
];

export const SAML_GIVEN_NAME_ATTRIBUTES: ReadonlyArray<string> = [
  "firstName",
  "givenName",
  "http://schemas.xmlsoap.org/ws/2005/05/identity/claims/givenname",
  "User.FirstName",
  "urn:oid:2.5.4.42",
];

export const SAML_FAMILY_NAME_ATTRIBUTES: ReadonlyArray<string> = [
  "lastName",
  "familyName",
  "surname",
  "http://schemas.xmlsoap.org/ws/2005/05/identity/claims/surname",
  "User.LastName",
  "urn:oid:2.5.4.4",
];

export const SAML_NAME_CLAIM: string =
  "http://schemas.xmlsoap.org/ws/2005/05/identity/claims/name";

// Every attribute the name is read from, as compared: in lower case.
const SAML_NAME_ATTRIBUTES_LOWER_CASE: ReadonlySet<string> = new Set<string>(
  [
    ...SAML_DISPLAY_NAME_ATTRIBUTES,
    ...SAML_GIVEN_NAME_ATTRIBUTES,
    ...SAML_FAMILY_NAME_ATTRIBUTES,
    SAML_NAME_CLAIM,
  ].map((attributeName: string): string => {
    return attributeName.toLowerCase();
  }),
);

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

  // Where <Conditions>, <Audience> and <SubjectConfirmation> live.
  private static readonly SAML2_ASSERTION_NAMESPACE: string =
    "urn:oasis:names:tc:SAML:2.0:assertion";

  /*
   * The confirmation method of a browser sign-in: whoever presents the
   * assertion is its subject (SAML 2.0 Profiles 4.1.4.2).
   */
  private static readonly SAML_BEARER_METHOD: string =
    "urn:oasis:names:tc:SAML:2.0:cm:bearer";

  /*
   * How far apart the identity provider's clock and this server's may be.
   * Every time rule below gives this much either way.
   */
  public static readonly CLOCK_SKEW_IN_MS: number = 3 * 60 * 1000;

  /*
   * However long an identity provider says an assertion is good for, it is
   * accepted only this soon after it was issued. A browser posts a response
   * within seconds of getting it; what this bounds is a response that is
   * kept back and posted later.
   */
  public static readonly MAX_ASSERTION_AGE_IN_MS: number = 10 * 60 * 1000;

  /*
   * An xs:dateTime as SAML writes them (SAML 2.0 Core 1.3.3): UTC, usually
   * with milliseconds. Anchored, with every repeat bounded, so it runs in
   * time proportional to its input.
   */
  private static readonly SAML_TIME: RegExp =
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?(Z|[+-]\d{2}:\d{2})?$/;

  private static readonly SAML_TIME_ZONE_OFFSET: RegExp =
    /^([+-])(\d{2}):(\d{2})$/;

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

  /*
   * DOM node types we test for. xmldom exposes these as Node constants, but
   * spelling them out keeps the checks readable next to the nodeType they
   * compare against.
   */
  private static readonly ELEMENT_NODE: number = 1;
  private static readonly TEXT_NODE: number = 3;
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
   *   9. The identity itself is read from the CANONICAL BYTES the signature was
   *      verified over (xml-crypto's `signedReference`), not from a second
   *      independent parse of the original document. Rules 1-8 establish that
   *      there is exactly one assertion, in the one position SAML allows, under
   *      a signature that covers it; rule 9 decides where the characters come
   *      from. That is what makes a disagreement between our parse and
   *      xml-crypto's canonicalizer stop being an authentication bug: the
   *      processing-instruction trick of #2988 is one instance of that
   *      disagreement, and xml-crypto still renders any node carrying a `data`
   *      property as plain text in 6.x.
   *
   * Rules 1-9 establish WHO made the assertion and WHO it names. A genuine
   * assertion is still not a sign-in for whoever holds it: it is made for one
   * application, to be used once, soon. Without the rules below, a response
   * the identity provider made for some other application it signs people in
   * to - one that shares its issuer and signing certificate, as every
   * application of a Keycloak realm, an AD FS farm or a Google Workspace
   * does - signs its holder in here, and so does any response kept from an
   * earlier sign-in, for as long as anyone likes, however the identity
   * provider has changed its mind about the person since:
   *
   *  10. Who it is for. Every <AudienceRestriction> must name this provider:
   *      its Entity ID, its Reply URL, or - for identity providers set up
   *      before May 2024 - this server's address (see SamlServiceProvider).
   *      At least one is required (SAML 2.0 Profiles 4.1.4.2).
   *  11. Where it was sent. A bearer <SubjectConfirmation> must carry this
   *      provider's Reply URL as its Recipient, and the Response's
   *      Destination, when it has one, must be that Reply URL too.
   *  12. When. The assertion must be inside every window it states -
   *      <Conditions> NotBefore / NotOnOrAfter and its bearer confirmation's
   *      - and issued no more than MAX_ASSERTION_AGE_IN_MS ago, each with
   *      CLOCK_SKEW_IN_MS of slack for clocks that disagree.
   *  13. Once. That is the caller's half, because it needs the cache:
   *      SamlAssertionOneTimeUse.claim with the `assertionId` and
   *      `acceptableUntil` returned here, before anything is created or
   *      signed in.
   *
   * InResponseTo is not required to name a request OneUptime made. Sign-ins
   * started at the identity provider (its app dashboard, a bookmark) carry
   * none and are supported, and rules 10-13 already hold each assertion to
   * this provider, a short window and a single sign-in.
   *
   * Throws BadRequestException on any anomaly.
   */
  public static getSamlResponseFromXML(
    samlResponse: string,
    certificate: string,
    serviceProvider: SamlServiceProvider,
    now: Date = OneUptimeDate.getCurrentDate(),
  ): VerifiedSamlResponse {
    const { response, assertion } = SSOUtil.verifyAndGetAssertion(
      samlResponse,
      certificate,
    );

    const issuerUrl: string = SSOUtil.getIssuerFromAssertion(assertion);
    const email: Email = SSOUtil.getEmailFromAssertion(assertion);
    const name: Name | null = SSOUtil.getNameFromAssertion(assertion);

    const assertionId: string = SSOUtil.getIdAttribute(assertion).trim();

    if (!assertionId) {
      throw new BadRequestException("SAML Assertion has no ID");
    }

    const acceptableUntil: Date = SSOUtil.assertForThisProviderAndInTime({
      response,
      assertion,
      serviceProvider,
      now,
    });

    return {
      issuerUrl,
      email,
      name,
      assertionId,
      acceptableUntil,
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
   * document whose identity we would then refuse to read. For the same reason
   * it takes the provider and the time: a response for another provider, or
   * one whose time is up, is not valid either.
   */
  public static isSignatureValid(
    samlResponse: string,
    certificate: string,
    serviceProvider: SamlServiceProvider,
    now: Date = OneUptimeDate.getCurrentDate(),
  ): boolean {
    try {
      SSOUtil.getSamlResponseFromXML(
        samlResponse,
        certificate,
        serviceProvider,
        now,
      );
      return true;
    } catch (err) {
      logger.error(err);
      return false;
    }
  }

  /*
   * The single verification pipeline. Returns the assertion that the signature
   * provably covers - parsed out of the canonical bytes the signature was
   * actually verified over - and the document's root <Response>, or throws.
   */
  private static verifyAndGetAssertion(
    samlResponse: string,
    certificate: string,
  ): { response: XmlElement; assertion: XmlElement } {
    if (!certificate) {
      throw new BadRequestException("Public Certificate not found");
    }

    const dom: XmlDocument = SSOUtil.parseXmlStrict(samlResponse);
    const response: XmlElement = SSOUtil.getResponseElement(dom);

    SSOUtil.assertNoEncryptedElements(dom);

    const assertion: XmlElement = SSOUtil.getSingleAssertion(dom, response);

    SSOUtil.assertSignaturesAreWellPlaced(dom, response, assertion);

    SSOUtil.assertIdentityValuesArePlainText(assertion);

    const signedReferenceXml: string | null = SSOUtil.verifyAssertionSignature(
      samlResponse,
      certificate,
      dom,
      response,
      assertion,
    );

    if (signedReferenceXml === null) {
      throw new BadRequestException(
        "Signature is not valid or Public Certificate configured with this SSO provider is not valid",
      );
    }

    SSOUtil.assertStatusIsSuccess(dom, response);

    return {
      response,
      assertion: SSOUtil.getAssertionFromSignedBytes(
        signedReferenceXml,
        assertion,
      ),
    };
  }

  /*
   * Rules 10-12: the assertion is for this provider, was sent to it, and is
   * inside its time. Returns the last moment it could still be accepted.
   *
   * `assertion` is the one read back out of the signed bytes, so everything
   * read from it is what the identity provider signed. `response` is the
   * document's root: its Destination is signed only when the whole Response
   * is, so it is checked when present but never relied on alone - the signed
   * Recipient is what holds the assertion to this provider's Reply URL.
   *
   * Who it is for is checked before when, so an admin testing a provider
   * whose identity provider has the wrong Entity ID or Reply URL is told
   * that, rather than about a clock.
   */
  private static assertForThisProviderAndInTime(data: {
    response: XmlElement;
    assertion: XmlElement;
    serviceProvider: SamlServiceProvider;
    now: Date;
  }): Date {
    const conditions: XmlElement = SSOUtil.getConditions(data.assertion);

    SSOUtil.assertAudienceIsThisProvider(conditions, data.serviceProvider);

    const confirmations: Array<XmlElement> =
      SSOUtil.getBearerConfirmationsForThisProvider(
        data.assertion,
        data.serviceProvider,
      );

    SSOUtil.assertDestinationIsThisProvider(
      data.response,
      data.serviceProvider,
    );

    const now: number = data.now.getTime();

    // Issued: not in the future, and not long ago.
    const issuedAt: number = SSOUtil.readTime(data.assertion, "IssueInstant", {
      isRequired: true,
    })!;

    SSOUtil.assertWithinWindow({
      now,
      notBefore: issuedAt,
      notOnOrAfter: issuedAt + SSOUtil.MAX_ASSERTION_AGE_IN_MS,
    });

    let acceptableUntil: number =
      issuedAt + SSOUtil.MAX_ASSERTION_AGE_IN_MS + SSOUtil.CLOCK_SKEW_IN_MS;

    // The window the assertion as a whole states.
    const conditionsNotOnOrAfter: number | null = SSOUtil.readTime(
      conditions,
      "NotOnOrAfter",
    );

    SSOUtil.assertWithinWindow({
      now,
      notBefore: SSOUtil.readTime(conditions, "NotBefore"),
      notOnOrAfter: conditionsNotOnOrAfter,
    });

    if (conditionsNotOnOrAfter !== null) {
      acceptableUntil = Math.min(
        acceptableUntil,
        conditionsNotOnOrAfter + SSOUtil.CLOCK_SKEW_IN_MS,
      );
    }

    /*
     * The window of the bearer confirmation(s) naming this Reply URL: one of
     * them has to be open now. The assertion stays acceptable for as long as
     * the latest of those is.
     */
    let confirmationOpenUntil: number | null = null;
    let firstRefusal: unknown = null;

    for (const confirmationData of confirmations) {
      const notBefore: number | null = SSOUtil.readTime(
        confirmationData,
        "NotBefore",
      );
      const notOnOrAfter: number | null = SSOUtil.readTime(
        confirmationData,
        "NotOnOrAfter",
      );

      try {
        SSOUtil.assertWithinWindow({ now, notBefore, notOnOrAfter });
      } catch (err) {
        firstRefusal = firstRefusal || err;
        continue;
      }

      const openUntil: number =
        notOnOrAfter === null
          ? Number.POSITIVE_INFINITY
          : notOnOrAfter + SSOUtil.CLOCK_SKEW_IN_MS;

      confirmationOpenUntil =
        confirmationOpenUntil === null
          ? openUntil
          : Math.max(confirmationOpenUntil, openUntil);
    }

    if (confirmationOpenUntil === null) {
      throw (
        firstRefusal || new BadRequestException(SAML_RESPONSE_EXPIRED_MESSAGE)
      );
    }

    acceptableUntil = Math.min(acceptableUntil, confirmationOpenUntil);

    return new Date(acceptableUntil);
  }

  /*
   * The assertion's one <Conditions>. It is required: the <AudienceRestriction>
   * that says who the assertion is for lives inside it.
   */
  private static getConditions(assertion: XmlElement): XmlElement {
    const conditions: Array<XmlElement> = SSOUtil.getSamlChildren(
      assertion,
      "Conditions",
    );

    if (conditions.length === 0) {
      throw new BadRequestException(SAML_AUDIENCE_MISSING_MESSAGE);
    }

    if (conditions.length > 1) {
      throw new BadRequestException(
        "SAML Assertion must not contain more than one Conditions element",
      );
    }

    return conditions[0]!;
  }

  /*
   * Rule 10. SAML 2.0 Core 2.5.1.4: the audiences of one restriction are
   * alternatives, and every restriction must be met, so each one has to name
   * this provider.
   */
  private static assertAudienceIsThisProvider(
    conditions: XmlElement,
    serviceProvider: SamlServiceProvider,
  ): void {
    const restrictions: Array<XmlElement> = SSOUtil.getSamlChildren(
      conditions,
      "AudienceRestriction",
    );

    if (restrictions.length === 0) {
      throw new BadRequestException(SAML_AUDIENCE_MISSING_MESSAGE);
    }

    const namesThisProvider: (audience: XmlElement) => boolean = (
      audience: XmlElement,
    ): boolean => {
      const value: string = SSOUtil.getTrimmedText(audience);

      return [
        serviceProvider.entityId,
        serviceProvider.replyUrl,
        serviceProvider.serverAddress,
      ].some((expected: string): boolean => {
        return SamlServiceProviders.isSameAddress(value, expected);
      });
    };

    for (const restriction of restrictions) {
      if (
        !SSOUtil.getSamlChildren(restriction, "Audience").some(
          namesThisProvider,
        )
      ) {
        throw new BadRequestException(SAML_AUDIENCE_MISMATCH_MESSAGE);
      }
    }
  }

  /*
   * Rule 11, its signed half. The <SubjectConfirmationData> of each bearer
   * <SubjectConfirmation> whose Recipient is this provider's Reply URL; at
   * least one is required. Confirmations of other methods (holder-of-key,
   * sender-vouches) cannot be met by a browser sign-in and are not counted.
   */
  private static getBearerConfirmationsForThisProvider(
    assertion: XmlElement,
    serviceProvider: SamlServiceProvider,
  ): Array<XmlElement> {
    const subject: XmlElement | null = SSOUtil.getDirectChildByLocalName(
      assertion,
      "Subject",
    );

    const bearerConfirmations: Array<XmlElement> = subject
      ? SSOUtil.getSamlChildren(subject, "SubjectConfirmation").filter(
          (confirmation: XmlElement): boolean => {
            return (
              (confirmation.getAttribute("Method") || "").trim() ===
              SSOUtil.SAML_BEARER_METHOD
            );
          },
        )
      : [];

    if (bearerConfirmations.length === 0) {
      throw new BadRequestException(
        "SAML Assertion has no bearer SubjectConfirmation",
      );
    }

    let recipientSeen: boolean = false;
    const forThisProvider: Array<XmlElement> = [];

    for (const confirmation of bearerConfirmations) {
      const confirmationData: Array<XmlElement> = SSOUtil.getSamlChildren(
        confirmation,
        "SubjectConfirmationData",
      );

      if (confirmationData.length > 1) {
        throw new BadRequestException(
          "SAML SubjectConfirmation must not contain more than one SubjectConfirmationData",
        );
      }

      const data: XmlElement | undefined = confirmationData[0];

      if (!data || !data.hasAttribute("Recipient")) {
        continue;
      }

      recipientSeen = true;

      if (
        SamlServiceProviders.isSameAddress(
          data.getAttribute("Recipient") || "",
          serviceProvider.replyUrl,
        )
      ) {
        forThisProvider.push(data);
      }
    }

    if (forThisProvider.length > 0) {
      return forThisProvider;
    }

    throw new BadRequestException(
      recipientSeen
        ? SAML_RECIPIENT_MISMATCH_MESSAGE
        : SAML_RECIPIENT_MISSING_MESSAGE,
    );
  }

  /*
   * Rule 11, the Response's half. SAML 2.0 Bindings 3.5.5.2: a Destination
   * names the URL the response was sent to, and the receiver checks it is
   * where the response arrived. Identity providers send it, so one naming
   * somewhere else is refused; a response without one is held to this
   * provider by its Recipient alone.
   */
  private static assertDestinationIsThisProvider(
    response: XmlElement,
    serviceProvider: SamlServiceProvider,
  ): void {
    const destination: string = (
      response.getAttribute("Destination") || ""
    ).trim();

    if (!destination) {
      return;
    }

    if (
      !SamlServiceProviders.isSameAddress(destination, serviceProvider.replyUrl)
    ) {
      throw new BadRequestException(SAML_DESTINATION_MISMATCH_MESSAGE);
    }
  }

  /*
   * Rule 12 for one window: `now` must not be before `notBefore` or at or
   * after `notOnOrAfter` (either may be absent), give or take the clock skew.
   */
  private static assertWithinWindow(data: {
    now: number;
    notBefore: number | null;
    notOnOrAfter: number | null;
  }): void {
    if (
      data.notBefore !== null &&
      data.now < data.notBefore - SSOUtil.CLOCK_SKEW_IN_MS
    ) {
      throw new BadRequestException(SAML_RESPONSE_NOT_YET_VALID_MESSAGE);
    }

    if (
      data.notOnOrAfter !== null &&
      data.now >= data.notOnOrAfter + SSOUtil.CLOCK_SKEW_IN_MS
    ) {
      throw new BadRequestException(SAML_RESPONSE_EXPIRED_MESSAGE);
    }
  }

  /*
   * A time attribute of a SAML element, in milliseconds since the epoch; null
   * when it is absent. A value that is present but not a time is refused
   * rather than read as absent: an unreadable NotOnOrAfter must not become no
   * limit at all.
   */
  private static readTime(
    element: XmlElement,
    attributeName: string,
    options?: { isRequired: boolean },
  ): number | null {
    if (!element.hasAttribute(attributeName)) {
      if (options?.isRequired) {
        throw new BadRequestException(
          `SAML ${element.localName} has no ${attributeName}`,
        );
      }

      return null;
    }

    const time: number | null = SSOUtil.parseSamlTime(
      element.getAttribute(attributeName) || "",
    );

    if (time === null) {
      throw new BadRequestException(
        `SAML ${element.localName} has an invalid ${attributeName}`,
      );
    }

    return time;
  }

  /*
   * An xs:dateTime in milliseconds since the epoch, or null. SAML times are
   * UTC (SAML 2.0 Core 1.3.3); one written with an offset is read with it,
   * and one written with no zone at all is read as UTC. Fractions of a second
   * beyond milliseconds are dropped. A date that does not exist (the 30th of
   * February, hour 24) is not a time.
   */
  private static parseSamlTime(value: string): number | null {
    const text: string = value.trim();

    if (text.length === 0 || text.length > 64) {
      return null;
    }

    const match: RegExpExecArray | null = SSOUtil.SAML_TIME.exec(text);

    if (!match) {
      return null;
    }

    const year: number = Number(match[1]);
    const month: number = Number(match[2]);
    const day: number = Number(match[3]);
    const hour: number = Number(match[4]);
    const minute: number = Number(match[5]);
    const second: number = Number(match[6]);
    const milliseconds: number = match[7]
      ? Number(match[7].substring(0, 3).padEnd(3, "0"))
      : 0;

    const time: Date = new Date(
      Date.UTC(year, month - 1, day, hour, minute, second, milliseconds),
    );

    // Date.UTC rolls an impossible date over, and reads years below 100 as 19xx.
    if (
      time.getUTCFullYear() !== year ||
      time.getUTCMonth() !== month - 1 ||
      time.getUTCDate() !== day ||
      time.getUTCHours() !== hour ||
      time.getUTCMinutes() !== minute ||
      time.getUTCSeconds() !== second
    ) {
      return null;
    }

    const zone: string | undefined = match[8];

    if (!zone || zone === "Z") {
      return time.getTime();
    }

    const offset: RegExpExecArray | null =
      SSOUtil.SAML_TIME_ZONE_OFFSET.exec(zone);

    if (!offset) {
      return null;
    }

    const offsetHours: number = Number(offset[2]);
    const offsetMinutes: number = Number(offset[3]);

    if (offsetHours > 14 || offsetMinutes > 59) {
      return null;
    }

    const offsetInMs: number =
      (offsetHours * 60 + offsetMinutes) *
      60 *
      1000 *
      (offset[1] === "-" ? -1 : 1);

    // 10:00+02:00 is 08:00 UTC.
    return time.getTime() - offsetInMs;
  }

  // Direct children with this local name in the SAML 2.0 assertion namespace.
  private static getSamlChildren(
    parent: XmlElement,
    localName: string,
  ): Array<XmlElement> {
    return SSOUtil.getDirectChildrenByLocalName(parent, localName).filter(
      (element: XmlElement): boolean => {
        return element.namespaceURI === SSOUtil.SAML2_ASSERTION_NAMESPACE;
      },
    );
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

  /*
   * The <SignatureValue> text used for the duplicate check above.
   *
   * This has to agree with how xml-crypto reads the same element, or the check
   * compares a different string than the one that decides which signatures get
   * stripped from the digest. xml-crypto selects it with
   *
   *   xpath.select1(".//*[local-name(.)='SignatureValue']/text()", signature)
   *
   * (enveloped-signature.js, signed-xml.js), which differs from a namespaced
   * `textContent` read in two ways an attacker can use:
   *
   *   - The selection is namespace-AGNOSTIC. A decoy that puts a foreign
   *     <foo:SignatureValue xmlns:foo="urn:x"> first is what xml-crypto reads
   *     and strips on, while a namespaced lookup never sees it.
   *
   *   - select1 returns the FIRST TEXT NODE, not the concatenated text. A
   *     comment or CDATA section splits the value, so xml-crypto reads
   *     "ABC" where `textContent` reads "ABCZ".
   *
   * Either way a decoy signature can repeat the genuine <SignatureValue> as far
   * as xml-crypto is concerned - and so be deleted from the digest, taking
   * whatever it carries out of the signed bytes with it - while looking
   * distinct to us. Rather than reimplement xml-crypto's selection and have to
   * track it, refuse anything ambiguous.
   */
  private static getSignatureValueText(signature: XmlElement): string {
    const signatureValues: Array<XmlElement> = SSOUtil.toElementArray(
      signature.getElementsByTagNameNS("*", "SignatureValue"),
    );

    if (signatureValues.length === 0) {
      return "";
    }

    if (signatureValues.length > 1) {
      throw new BadRequestException(
        "An XML Signature must not contain more than one SignatureValue",
      );
    }

    const signatureValue: XmlElement = signatureValues[0]!;

    if (signatureValue.namespaceURI !== SSOUtil.XMLDSIG_NAMESPACE) {
      throw new BadRequestException(
        "SignatureValue must be in the XML Signature namespace",
      );
    }

    /*
     * A single run of character data, or nothing. Base64 wrapped across lines
     * is still one text node, so the identity providers that pretty-print their
     * signatures are unaffected.
     */
    const firstChild: XmlNode | null = signatureValue.firstChild;

    if (
      firstChild &&
      (firstChild.nodeType !== SSOUtil.TEXT_NODE || firstChild.nextSibling)
    ) {
      throw new BadRequestException(
        "SignatureValue must contain a single run of text",
      );
    }

    return SSOUtil.getTrimmedText(signatureValue);
  }

  /*
   * Verify that some <Signature> in the document:
   *   - validates cryptographically against the configured certificate, and
   *   - has a verified reference that resolves to exactly one element, and that
   *     element is the Assertion itself or the root <Response>.
   *
   * Returns the CANONICAL BYTES of that reference - the exact string xml-crypto
   * digested and the signature was verified over - or null.
   *
   * The references are read back AFTER checkSignature() because xml-crypto
   * rebuilds them from the canonicalized <SignedInfo> it just verified; the
   * ones parsed by loadSignature() are still unauthenticated at that point. For
   * the same reason `signedReference` is only populated once every digest AND
   * the signature value have checked out - xml-crypto clears it otherwise.
   */
  private static verifyAssertionSignature(
    samlResponse: string,
    certificate: string,
    dom: XmlDocument,
    response: XmlElement,
    assertion: XmlElement,
  ): string | null {
    const signatures: Array<XmlElement> = SSOUtil.toElementArray(
      dom.getElementsByTagNameNS(SSOUtil.XMLDSIG_NAMESPACE, "Signature"),
    );

    if (signatures.length === 0) {
      return null;
    }

    for (const signature of signatures) {
      try {
        const sig: SignedXml = new SignedXml({
          publicCert: certificate,

          /*
           * Pin the verification key to the certificate configured on this SSO
           * provider.
           *
           * xml-crypto resolves its key as
           *   getCertFromKeyInfo(keyInfo) || publicCert || privateKey
           * where `keyInfo` is the <KeyInfo> carried INSIDE the document being
           * verified - i.e. supplied by whoever sent it. xml-crypto ships
           * SignedXml.getCertFromKeyInfo, which reads the certificate straight
           * out of that element; enabling it would mean accepting a response
           * signed by any key whose certificate the sender chose to staple on.
           *
           * The constructor currently defaults this to a no-op, so we are not
           * fixing a live bug here. But that is a library default silently
           * deciding an authentication question, so say it explicitly rather
           * than inherit it.
           */
          getCertFromKeyInfo: (): null => {
            return null;
          },
        });

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
        for (const reference of sig.getReferences()) {
          if (
            !SSOUtil.referenceCoversAssertion(
              dom,
              response,
              assertion,
              reference.uri,
            )
          ) {
            continue;
          }

          const signedReferenceXml: string | undefined =
            SSOUtil.getSignedReferenceXml(reference);

          if (signedReferenceXml) {
            return signedReferenceXml;
          }
        }
      } catch (err) {
        logger.error(err);
        continue;
      }
    }

    return null;
  }

  /*
   * The canonical bytes xml-crypto digested for this reference, or undefined.
   *
   * xml-crypto populates `signedReference` only after every reference digest
   * and the signature value have been verified, and clears it on any failure,
   * so a non-empty value here is exactly "the bytes this signature vouches
   * for".
   */
  private static getSignedReferenceXml(
    reference: Reference,
  ): string | undefined {
    const signedReferenceXml: string | undefined = reference.signedReference;

    if (typeof signedReferenceXml !== "string" || signedReferenceXml === "") {
      return undefined;
    }

    return signedReferenceXml;
  }

  /*
   * Re-read the assertion out of the canonical bytes that were signed.
   *
   * This is the structural answer to issue #2988 rather than a patch for one
   * instance of it. Reading identity from a second, independent parse of the
   * ORIGINAL document means every disagreement between that parse and
   * xml-crypto's canonicalizer becomes an authentication bug - the processing
   * instruction trick being one example, and xml-crypto's canonicalizer still
   * renders any node with a `data` property as plain text in 6.x. Reading it
   * from the canonical bytes instead means the string we act on is by
   * construction the string that was digested and signed.
   *
   * The document-level rules still run on the original document: they are what
   * establish that there is exactly one assertion, in the one position SAML
   * allows, under a signature that covers it. This step only decides WHERE the
   * characters come from.
   *
   * `expected` is the assertion located in the original document; the canonical
   * copy must be the same assertion, not a different one that happened to be
   * inside the signed subtree.
   */
  private static getAssertionFromSignedBytes(
    signedReferenceXml: string,
    expected: XmlElement,
  ): XmlElement {
    const signedDom: XmlDocument = SSOUtil.parseXmlStrict(signedReferenceXml);

    /*
     * A reference covers either the Assertion itself or the whole Response, so
     * the canonical bytes are rooted at one or the other. Either way there must
     * be exactly one assertion in them.
     */
    const assertions: Array<XmlElement> = SSOUtil.toElementArray(
      signedDom.getElementsByTagNameNS("*", "Assertion"),
    );

    if (assertions.length !== 1) {
      throw new BadRequestException(
        "Expected exactly one Assertion in the signed SAML content",
      );
    }

    const assertion: XmlElement = assertions[0]!;

    if (
      !SSOUtil.SAML_ASSERTION_NAMESPACES.includes(assertion.namespaceURI || "")
    ) {
      throw new BadRequestException("SAML Assertion has an invalid namespace");
    }

    /*
     * When the signature covers the Response, the assertion must still sit
     * directly under it - the same rule the original document had to satisfy.
     */
    const signedRoot: XmlElement | null = signedDom.documentElement;

    if (assertion !== signedRoot && assertion.parentNode !== signedRoot) {
      throw new BadRequestException(
        "SAML Assertion must be a direct child of the SAML Response",
      );
    }

    /*
     * Pin the canonical assertion to the one the document-level checks were
     * made about. Without this, a signature covering a Response that contained
     * some other assertion could hand us an identity those checks never saw.
     */
    const expectedId: string = SSOUtil.getIdAttribute(expected);
    const signedId: string = SSOUtil.getIdAttribute(assertion);

    if (expectedId !== signedId) {
      throw new BadRequestException(
        "The signed SAML Assertion is not the Assertion in the SAML Response",
      );
    }

    return assertion;
  }

  /*
   * Apply the plain-text rule to the identity values in the ORIGINAL document,
   * not only to the signed copy we read from.
   *
   * Since identity now comes from the canonical signed bytes, markup in the
   * original can no longer change what we act on: exclusive canonicalization
   * has already dropped comments and collapsed processing instructions into
   * text by the time we read. We refuse the document anyway. No identity
   * provider puts markup inside a NameID; every instance of it in the wild has
   * been an attempt to make two readers of the same document disagree, and
   * failing closed keeps the guarantee even if the extraction point moves
   * again.
   *
   * Only the values we may consume are checked - the Issuer, the Name ID and
   * the attributes the name may be read from - so this adds no rejection
   * surface beyond what getIssuerFromAssertion / getEmailFromAssertion /
   * getNameFromAssertion read.
   */
  private static assertIdentityValuesArePlainText(assertion: XmlElement): void {
    const issuer: XmlElement | null = SSOUtil.getDirectChildByLocalName(
      assertion,
      "Issuer",
    );

    if (issuer) {
      SSOUtil.assertPlainTextOnly(issuer);
    }

    const subject: XmlElement | null = SSOUtil.getDirectChildByLocalName(
      assertion,
      "Subject",
    );

    if (subject) {
      const nameId: XmlElement | null = SSOUtil.getDirectChildByLocalName(
        subject,
        "NameID",
      );

      if (nameId) {
        SSOUtil.assertPlainTextOnly(nameId);
      }
    }

    for (const attributeValue of SSOUtil.getNameAttributeValueElements(
      assertion,
    ).values()) {
      SSOUtil.assertPlainTextOnly(attributeValue);
    }
  }

  /*
   * The first <AttributeValue> of each attribute the name is read from
   * (SAML_NAME_ATTRIBUTES_LOWER_CASE), keyed by its attribute name in lower
   * case. An attribute sent twice counts once, as first sent.
   */
  private static getNameAttributeValueElements(
    assertion: XmlElement,
  ): Map<string, XmlElement> {
    const values: Map<string, XmlElement> = new Map<string, XmlElement>();

    const attributeStatement: XmlElement | null =
      SSOUtil.getDirectChildByLocalName(assertion, "AttributeStatement");

    if (!attributeStatement) {
      return values;
    }

    const attributes: Array<XmlElement> = SSOUtil.toElementArray(
      attributeStatement.getElementsByTagNameNS("*", "Attribute"),
    );

    for (const attribute of attributes) {
      const attributeName: string = (attribute.getAttribute("Name") || "")
        .trim()
        .toLowerCase();

      if (
        !SAML_NAME_ATTRIBUTES_LOWER_CASE.has(attributeName) ||
        values.has(attributeName)
      ) {
        continue;
      }

      const attributeValue: XmlElement | null =
        SSOUtil.getDirectChildByLocalName(attribute, "AttributeValue");

      if (attributeValue) {
        values.set(attributeName, attributeValue);
      }
    }

    return values;
  }

  // The value of this element's ID / Id / id attribute, or "".
  private static getIdAttribute(element: XmlElement): string {
    for (const localName of SSOUtil.ID_ATTRIBUTE_LOCAL_NAMES) {
      const value: string | null = element.getAttribute(localName);

      if (value) {
        return value;
      }
    }

    return "";
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

    /*
     * Errors are logged when the callback sends its response. Do not let
     * the Email constructor echo a provider-supplied NameID into those logs.
     */
    if (!Email.isValid(emailString)) {
      throw new BadRequestException(
        "SAML response did not include a valid email address",
      );
    }

    return new Email(emailString);
  }

  /*
   * The person's name, read as SAML_DISPLAY_NAME_ATTRIBUTES and the lists
   * after it say, or null when the assertion carries none. Cut to what an
   * account's name holds (ColumnLength.Name), so a long name still signs
   * its owner in.
   */
  private static getNameFromAssertion(assertion: XmlElement): Name | null {
    const values: Map<string, XmlElement> =
      SSOUtil.getNameAttributeValueElements(assertion);

    const read: (attributeNames: ReadonlyArray<string>) => string = (
      attributeNames: ReadonlyArray<string>,
    ): string => {
      for (const attributeName of attributeNames) {
        const attributeValue: XmlElement | undefined = values.get(
          attributeName.toLowerCase(),
        );

        if (!attributeValue) {
          continue;
        }

        SSOUtil.assertPlainTextOnly(attributeValue);

        const value: string = SSOUtil.getTrimmedText(attributeValue);

        if (value) {
          return value;
        }
      }

      return "";
    };

    const givenAndFamilyName: string = [
      read(SAML_GIVEN_NAME_ATTRIBUTES),
      read(SAML_FAMILY_NAME_ATTRIBUTES),
    ]
      .filter(Boolean)
      .join(" ");

    const nameClaim: string = read([SAML_NAME_CLAIM]);

    const fullName: string =
      read(SAML_DISPLAY_NAME_ATTRIBUTES) ||
      givenAndFamilyName ||
      (nameClaim.includes("@") ? "" : nameClaim);

    const name: string = fullName.substring(0, ColumnLength.Name).trim();

    return name ? new Name(name) : null;
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
