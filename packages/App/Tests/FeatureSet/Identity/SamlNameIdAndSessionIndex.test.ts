import SSOUtil, {
  VerifiedSamlResponse,
} from "../../../FeatureSet/Identity/Utils/SSO";
import { SamlServiceProvider } from "../../../FeatureSet/Identity/Utils/SamlServiceProvider";
import {
  SamlKeyPair,
  buildSamlResponse,
  generateRsaKeyPair,
  minutesAfter,
  signElement,
} from "./SamlTestKit";
import { beforeAll, describe, expect, test } from "@jest/globals";

/*
 * ---------------------------------------------------------------------------
 * WHAT A LOGOUTREQUEST NAMES THE PERSON AND THEIR SESSION BY (#9603).
 *
 * To sign someone out of their SAML identity provider too, OneUptime names
 * them in a LogoutRequest exactly as the assertion that signed them in did
 * (SAML 2.0 Core 3.7.1): the <NameID>'s text, its Format, NameQualifier
 * and SPNameQualifier, and the <AuthnStatement>'s SessionIndex. Each is read
 * from the verified assertion - what the identity provider signed - by the
 * one entry point every sign-in uses.
 * ---------------------------------------------------------------------------
 */

const SERVER: string = "https://oneuptime.example.com";
const PROJECT_ID: string = "11111111-1111-4111-8111-111111111111";
const PROVIDER_ID: string = "22222222-2222-4222-8222-222222222222";

const PROVIDER: SamlServiceProvider = {
  entityId: `${SERVER}/${PROJECT_ID}/${PROVIDER_ID}`,
  replyUrl: `${SERVER}/identity/idp-login/${PROJECT_ID}/${PROVIDER_ID}`,
  serverAddress: SERVER,
};

const ISSUER: string = "https://idp.example.com/realms/acme";
const EMAIL: string = "dana.scully@example.com";
const NOW: Date = new Date("2026-03-01T12:00:00.000Z");

let idpKeys: SamlKeyPair;

beforeAll(() => {
  idpKeys = generateRsaKeyPair();
});

function verify(options: {
  sessionIndex?: string | null | undefined;
  rawNameIdAttributes?: string | undefined;
  signed?: (xml: string) => string;
}): VerifiedSamlResponse {
  const xml: string = buildSamlResponse({
    issuer: ISSUER,
    email: EMAIL,
    issuedAt: minutesAfter(NOW, -1),
    audienceRestrictions: [[PROVIDER.entityId]],
    recipient: PROVIDER.replyUrl,
    destination: PROVIDER.replyUrl,
    sessionIndex: options.sessionIndex,
    rawNameIdAttributes: options.rawNameIdAttributes,
  });

  return SSOUtil.getSamlResponseFromXML(
    (options.signed || ((unsigned: string): string => {
      return signElement(unsigned, "Assertion", idpKeys.privateKey);
    }))(xml),
    idpKeys.publicKey,
    PROVIDER,
    NOW,
  );
}

describe("the Name ID a LogoutRequest names the person by", () => {
  test("is the assertion's Name ID, with the Format it was sent with", () => {
    expect(verify({}).nameId).toEqual({
      value: EMAIL,
      format: "urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress",
      nameQualifier: null,
      spNameQualifier: null,
    });
  });

  test("keeps its NameQualifier and SPNameQualifier", () => {
    expect(
      verify({
        rawNameIdAttributes:
          ' Format="urn:oasis:names:tc:SAML:2.0:nameid-format:persistent" NameQualifier="https://idp.example.com/realms/acme" SPNameQualifier="https://oneuptime.example.com/sp"',
      }).nameId,
    ).toEqual({
      value: EMAIL,
      format: "urn:oasis:names:tc:SAML:2.0:nameid-format:persistent",
      nameQualifier: "https://idp.example.com/realms/acme",
      spNameQualifier: "https://oneuptime.example.com/sp",
    });
  });

  test("an attribute that is there but empty is no attribute", () => {
    expect(verify({ rawNameIdAttributes: ' Format=""' }).nameId).toEqual({
      value: EMAIL,
      format: null,
      nameQualifier: null,
      spNameQualifier: null,
    });
  });

  test("a Name ID with no attributes is named by its text alone", () => {
    expect(verify({ rawNameIdAttributes: "" }).nameId).toEqual({
      value: EMAIL,
      format: null,
      nameQualifier: null,
      spNameQualifier: null,
    });
  });

  test("is still the email address the account is found by", () => {
    expect(verify({}).email.toString()).toBe(EMAIL);
  });
});

describe("the SessionIndex a LogoutRequest names the session by", () => {
  test("is the AuthnStatement's", () => {
    expect(
      verify({ sessionIndex: "_be9967abd904ddcae3c0eb4189adbe3f71e327cf93" })
        .sessionIndex,
    ).toBe("_be9967abd904ddcae3c0eb4189adbe3f71e327cf93");
  });

  test("is null when the assertion has none", () => {
    expect(verify({ sessionIndex: null }).sessionIndex).toBeNull();
  });

  test("is null when it is there but empty", () => {
    expect(verify({ sessionIndex: "" }).sessionIndex).toBeNull();
  });

  test("is what the identity provider signed: changed after signing, the response is refused", () => {
    expect(() => {
      return verify({
        sessionIndex: "_signed",
        signed: (xml: string): string => {
          return signElement(xml, "Assertion", idpKeys.privateKey).replace(
            'SessionIndex="_signed"',
            'SessionIndex="_someone_else"',
          );
        },
      });
    }).toThrow(/Signature is not valid/);
  });

  test("is read from a whole Response the identity provider signed", () => {
    expect(
      verify({
        sessionIndex: "_response_signed",
        signed: (xml: string): string => {
          return signElement(xml, "Response", idpKeys.privateKey);
        },
      }).sessionIndex,
    ).toBe("_response_signed");
  });
});
