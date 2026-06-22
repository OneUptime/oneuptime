import URL from "Common/Types/API/URL";
import OneUptimeDate from "Common/Types/Date";
import Email from "Common/Types/Email";
import BadRequestException from "Common/Types/Exception/BadRequestException";
import { JSONArray, JSONObject } from "Common/Types/JSON";
import Text from "Common/Types/Text";
import logger from "Common/Server/Utils/Logger";
import xmlCrypto, { FileKeyInfo } from "xml-crypto";
import {
  DOMParser,
  Document as XmlDocument,
  Element as XmlElement,
} from "@xmldom/xmldom";
import zlib from "zlib";
import Name from "Common/Types/Name";

export interface AudienceValidationResult {
  // True when validation passed (match) or was skipped (no AudienceRestriction).
  isOk: boolean;
  // True only when an Audience was present and did not match the expected value.
  isMismatch: boolean;
  receivedAudiences: Array<string>;
  expectedAudience: string;
  // Human-readable detail, reused for both the warn log and the thrown error.
  message: string;
}

export default class SSOUtil {
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

  public static isPayloadValid(payload: JSONObject): void {
    if (
      !payload["saml2p:Response"] &&
      !payload["samlp:Response"] &&
      !payload["samlp:Response"]
    ) {
      throw new BadRequestException("SAML Response not found.");
    }

    payload =
      (payload["saml2p:Response"] as JSONObject) ||
      (payload["samlp:Response"] as JSONObject) ||
      (payload["samlp:Response"] as JSONObject) ||
      (payload["Response"] as JSONObject);

    const issuers: JSONArray =
      (payload["saml2:Issuer"] as JSONArray) ||
      (payload["saml:Issuer"] as JSONArray) ||
      (payload["Issuer"] as JSONArray);

    if (issuers.length === 0) {
      throw new BadRequestException("Issuers not found");
    }

    const issuer: JSONObject | string | undefined = issuers[0];

    if (typeof issuer === "string") {
      return issuer;
    }
    if (!issuer) {
      throw new BadRequestException("Issuer not found");
    }

    const issuerUrl: string = issuer["_"] as string;

    if (!issuerUrl) {
      throw new BadRequestException("Issuer URL not found in SAML response");
    }

    const samlAssertion: JSONArray =
      (payload["saml2:Assertion"] as JSONArray) ||
      (payload["saml:Assertion"] as JSONArray) ||
      (payload["Assertion"] as JSONArray);

    if (!samlAssertion || samlAssertion.length === 0) {
      throw new BadRequestException("SAML Assertion not found");
    }

    if (samlAssertion.length !== 1) {
      throw new BadRequestException(
        "Expected exactly one Assertion in SAML Response",
      );
    }

    const samlSubject: JSONArray =
      ((samlAssertion[0] as JSONObject)["saml2:Subject"] as JSONArray) ||
      ((samlAssertion[0] as JSONObject)["saml:Subject"] as JSONArray) ||
      ((samlAssertion[0] as JSONObject)["Subject"] as JSONArray);

    if (!samlSubject || samlSubject.length === 0) {
      throw new BadRequestException("SAML Subject not found");
    }

    const samlNameId: JSONArray =
      ((samlSubject[0] as JSONObject)["saml2:NameID"] as JSONArray) ||
      ((samlSubject[0] as JSONObject)["saml:NameID"] as JSONArray) ||
      ((samlSubject[0] as JSONObject)["NameID"] as JSONArray);

    if (!samlNameId || samlNameId.length === 0) {
      throw new BadRequestException("SAML NAME ID not found");
    }

    const emailString: string = (samlNameId[0] as JSONObject)["_"] as string;

    if (!emailString) {
      if (!samlNameId || samlNameId.length === 0) {
        throw new BadRequestException("SAML Email not found");
      }
    }
  }

  public static isSignatureValid(
    samlPayload: string,
    certificate: string,
  ): boolean {
    try {
      const dom: XmlDocument = new DOMParser().parseFromString(
        samlPayload,
        "text/xml",
      );
      const signature: XmlElement | undefined = dom.getElementsByTagNameNS(
        "http://www.w3.org/2000/09/xmldsig#",
        "Signature",
      )[0];
      const sig: xmlCrypto.SignedXml = new xmlCrypto.SignedXml();

      sig.keyInfoProvider = {
        getKeyInfo: function (_key: any) {
          return `<X509Data><X509Certificate>${certificate}</X509Certificate></X509Data>`;
        },
        getKey: function () {
          return certificate;
        } as any,
      } as FileKeyInfo;

      sig.loadSignature(signature!.toString());
      const res: boolean = sig.checkSignature(samlPayload);

      return res;
    } catch (err) {
      logger.error(err);
      return false;
    }
  }

  public static getUserFullName(payload: JSONObject): Name | null {
    if (!payload["saml2p:Response"] && !payload["samlp:Response"]) {
      return null;
    }

    payload =
      (payload["saml2p:Response"] as JSONObject) ||
      (payload["samlp:Response"] as JSONObject) ||
      (payload["Response"] as JSONObject);

    const samlAssertion: JSONArray =
      (payload["saml2:Assertion"] as JSONArray) ||
      (payload["saml:Assertion"] as JSONArray) ||
      (payload["Assertion"] as JSONArray);

    if (!samlAssertion || samlAssertion.length === 0) {
      return null;
    }

    if (samlAssertion.length !== 1) {
      return null;
    }

    const samlAttributeStatement: JSONArray =
      ((samlAssertion[0] as JSONObject)[
        "saml2:AttributeStatement"
      ] as JSONArray) ||
      ((samlAssertion[0] as JSONObject)[
        "saml:AttributeStatement"
      ] as JSONArray) ||
      ((samlAssertion[0] as JSONObject)["AttributeStatement"] as JSONArray);

    if (!samlAttributeStatement || samlAttributeStatement.length === 0) {
      return null;
    }

    const samlAttribute: JSONArray =
      ((samlAttributeStatement[0] as JSONObject)[
        "saml2:Attribute"
      ] as JSONArray) ||
      ((samlAttributeStatement[0] as JSONObject)[
        "saml:Attribute"
      ] as JSONArray) ||
      ((samlAttributeStatement[0] as JSONObject)["Attribute"] as JSONArray);

    if (!samlAttribute || samlAttribute.length === 0) {
      return null;
    }

    /*
     * get displayName attribute.
     *   {
     *     "$": {
     *         "Name": "http://schemas.microsoft.com/identity/claims/displayname"
     *     },
     *     "AttributeValue": [
     *         "Nawaz Dhandala"
     *     ]
     * },
     */

    for (let i: number = 0; i < samlAttribute.length; i++) {
      const attribute: JSONObject = samlAttribute[i] as JSONObject;
      if (
        attribute["$"] &&
        (attribute["$"] as JSONObject)["Name"]?.toString()
      ) {
        const name: string | undefined = (attribute["$"] as JSONObject)[
          "Name"
        ]?.toString();
        if (
          name &&
          name === "http://schemas.microsoft.com/identity/claims/displayname" &&
          attribute["AttributeValue"] &&
          Array.isArray(attribute["AttributeValue"]) &&
          attribute["AttributeValue"].length > 0
        ) {
          const fullName: Name = new Name(
            attribute["AttributeValue"][0]!.toString() as string,
          );
          return fullName;
        }
      }
    }

    return null;
  }

  public static getEmail(payload: JSONObject): Email {
    if (!payload["saml2p:Response"] && !payload["samlp:Response"]) {
      throw new BadRequestException("SAML Response not found.");
    }

    payload =
      (payload["saml2p:Response"] as JSONObject) ||
      (payload["samlp:Response"] as JSONObject) ||
      (payload["Response"] as JSONObject);

    const samlAssertion: JSONArray =
      (payload["saml2:Assertion"] as JSONArray) ||
      (payload["saml:Assertion"] as JSONArray) ||
      (payload["Assertion"] as JSONArray);

    if (!samlAssertion || samlAssertion.length === 0) {
      throw new BadRequestException("SAML Assertion not found");
    }

    if (samlAssertion.length !== 1) {
      throw new BadRequestException(
        "Expected exactly one Assertion in SAML Response",
      );
    }

    const samlSubject: JSONArray =
      ((samlAssertion[0] as JSONObject)["saml2:Subject"] as JSONArray) ||
      ((samlAssertion[0] as JSONObject)["saml:Subject"] as JSONArray) ||
      ((samlAssertion[0] as JSONObject)["Subject"] as JSONArray);

    if (!samlSubject || samlSubject.length === 0) {
      throw new BadRequestException("SAML Subject not found");
    }

    const samlNameId: JSONArray =
      ((samlSubject[0] as JSONObject)["saml2:NameID"] as JSONArray) ||
      ((samlSubject[0] as JSONObject)["saml:NameID"] as JSONArray) ||
      ((samlSubject[0] as JSONObject)["NameID"] as JSONArray);

    if (!samlNameId || samlNameId.length === 0) {
      throw new BadRequestException("SAML NAME ID not found");
    }

    const emailString: string = (samlNameId[0] as JSONObject)["_"] as string;

    return new Email(emailString.trim());
  }

  public static getIssuer(payload: JSONObject): string {
    if (!payload["saml2p:Response"] && !payload["samlp:Response"]) {
      throw new BadRequestException("SAML Response not found.");
    }

    payload =
      (payload["saml2p:Response"] as JSONObject) ||
      (payload["samlp:Response"] as JSONObject) ||
      (payload["Response"] as JSONObject);

    const issuers: JSONArray =
      (payload["saml2:Issuer"] as JSONArray) ||
      (payload["saml:Issuer"] as JSONArray) ||
      (payload["Issuer"] as JSONArray);

    if (issuers.length === 0) {
      throw new BadRequestException("Issuers not found");
    }

    const issuer: JSONObject | string | undefined = issuers[0];

    if (typeof issuer === "string") {
      return issuer;
    }

    if (!issuer) {
      throw new BadRequestException("Issuer not found");
    }

    const issuerUrl: string = issuer["_"] as string;

    if (!issuerUrl) {
      throw new BadRequestException("Issuer URL not found in SAML response");
    }

    return issuerUrl.trim();
  }

  /*
   * Returns every <Audience> string declared under the assertion's
   * <Conditions><AudienceRestriction>. Mirrors the defensive, namespace-prefix
   * tolerant navigation used by getIssuer/getEmail. Never throws: returns an
   * empty array when there are no Conditions/AudienceRestriction (some IdPs omit
   * them), so callers can treat "absent" as "skip" rather than "fail".
   */
  public static getAudiences(payload: JSONObject): Array<string> {
    const response: JSONObject =
      (payload["saml2p:Response"] as JSONObject) ||
      (payload["samlp:Response"] as JSONObject) ||
      (payload["Response"] as JSONObject);

    if (!response) {
      return [];
    }

    const samlAssertion: JSONArray =
      (response["saml2:Assertion"] as JSONArray) ||
      (response["saml:Assertion"] as JSONArray) ||
      (response["Assertion"] as JSONArray);

    if (!samlAssertion || samlAssertion.length === 0) {
      return [];
    }

    const assertion: JSONObject = samlAssertion[0] as JSONObject;

    const conditions: JSONArray =
      (assertion["saml2:Conditions"] as JSONArray) ||
      (assertion["saml:Conditions"] as JSONArray) ||
      (assertion["Conditions"] as JSONArray);

    if (!conditions || conditions.length === 0) {
      return [];
    }

    const audiences: Array<string> = [];

    for (const condition of conditions) {
      const conditionObject: JSONObject = condition as JSONObject;

      // The spec allows multiple <AudienceRestriction> under <Conditions>.
      const audienceRestrictions: JSONArray =
        (conditionObject["saml2:AudienceRestriction"] as JSONArray) ||
        (conditionObject["saml:AudienceRestriction"] as JSONArray) ||
        (conditionObject["AudienceRestriction"] as JSONArray);

      if (!audienceRestrictions || audienceRestrictions.length === 0) {
        continue;
      }

      for (const restriction of audienceRestrictions) {
        const restrictionObject: JSONObject = restriction as JSONObject;

        // And multiple <Audience> under a single <AudienceRestriction>.
        const audienceList: JSONArray =
          (restrictionObject["saml2:Audience"] as JSONArray) ||
          (restrictionObject["saml:Audience"] as JSONArray) ||
          (restrictionObject["Audience"] as JSONArray);

        if (!audienceList || audienceList.length === 0) {
          continue;
        }

        for (const audience of audienceList) {
          let audienceValue: string | undefined = undefined;

          if (typeof audience === "string") {
            audienceValue = audience;
          } else if (audience && typeof audience === "object") {
            audienceValue = (audience as JSONObject)["_"] as string;
          }

          if (audienceValue && audienceValue.trim()) {
            audiences.push(audienceValue.trim());
          }
        }
      }
    }

    return audiences;
  }

  /*
   * Validates that the SP Entity ID OneUptime advertises (the same value it
   * stamps into the outbound AuthnRequest Issuer) appears among the assertion's
   * audiences. Absent audiences => skip (isOk:true). Present-but-no-match =>
   * isMismatch:true. The caller decides whether a mismatch is a hard error
   * (enforce) or just a warning, but the message names both values either way.
   */
  public static validateAudience(data: {
    payload: JSONObject;
    expectedAudience: string;
  }): AudienceValidationResult {
    const receivedAudiences: Array<string> = SSOUtil.getAudiences(data.payload);

    if (receivedAudiences.length === 0) {
      return {
        isOk: true,
        isMismatch: false,
        receivedAudiences,
        expectedAudience: data.expectedAudience,
        message:
          "SAML assertion contained no AudienceRestriction; audience validation skipped.",
      };
    }

    const isMatch: boolean = receivedAudiences.some((audience: string) => {
      return SSOUtil.audienceEquals(audience, data.expectedAudience);
    });

    if (isMatch) {
      return {
        isOk: true,
        isMismatch: false,
        receivedAudiences,
        expectedAudience: data.expectedAudience,
        message: "",
      };
    }

    const message: string =
      `SAML assertion Audience does not match this OneUptime SSO endpoint. ` +
      `Received Audience(s): [${receivedAudiences.join(", ")}]. ` +
      `Expected (Service Provider Entity ID / Identifier): "${data.expectedAudience}". ` +
      `Fix: in your Identity Provider, set the application Identifier / Audience / Entity ID to exactly "${data.expectedAudience}". ` +
      `(If you intentionally use the Azure AD GUID Sign-On-URL override, leave this provider's "Enforce Audience Validation" setting OFF.)`;

    return {
      isOk: false,
      isMismatch: true,
      receivedAudiences,
      expectedAudience: data.expectedAudience,
      message,
    };
  }

  /*
   * Entity IDs are case-sensitive URIs, so we do NOT lowercase. The only
   * tolerated divergence is a trailing slash, because OneUptime builds its
   * AuthnRequest Issuer without one while some IdPs append it.
   */
  private static audienceEquals(a: string, b: string): boolean {
    if (a === b) {
      return true;
    }

    const stripTrailingSlash: (value: string) => string = (
      value: string,
    ): string => {
      return value.replace(/\/+$/, "");
    };

    return stripTrailingSlash(a) === stripTrailingSlash(b);
  }
}
