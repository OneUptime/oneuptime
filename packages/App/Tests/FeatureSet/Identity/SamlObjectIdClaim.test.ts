import SSOUtil, {
  SAML_OBJECT_ID_CLAIM,
  SAML_OBJECT_ID_TOO_LONG_MESSAGE,
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
 * THE PERSON'S OBJECT ID, AS MICROSOFT ENTRA ID SENDS IT.
 *
 * Entra ID sends the immutable object ID of the person it signs in under
 * the objectidentifier claim, by default. A sign-in through a project's
 * provider is bound to it (ProjectSsoIdentityBinding), so it is read from
 * the verified assertion only, held to plain text like the Name ID, and
 * read the same whichever case the GUID is written in.
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

const ISSUER: string =
  "https://sts.windows.net/5a1c0000-0000-4000-8000-000000000001/";
const EMAIL: string = "dana.scully@example.com";
const NOW: Date = new Date("2026-03-01T12:00:00.000Z");
const OBJECT_ID: string = "8f3e8c2a-41d5-4c0b-9e8a-4a7d1c0f6b21";

const ENTRA_DEFAULT_CLAIMS: Array<[name: string, value: string]> = [
  [
    "http://schemas.microsoft.com/identity/claims/tenantid",
    "5a1c0000-0000-4000-8000-000000000001",
  ],
  [SAML_OBJECT_ID_CLAIM, OBJECT_ID],
  [
    "http://schemas.microsoft.com/identity/claims/identityprovider",
    "https://sts.windows.net/5a1c0000-0000-4000-8000-000000000001/",
  ],
  ["http://schemas.xmlsoap.org/ws/2005/05/identity/claims/givenname", "Dana"],
  ["http://schemas.xmlsoap.org/ws/2005/05/identity/claims/surname", "Scully"],
  ["http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress", EMAIL],
  ["http://schemas.xmlsoap.org/ws/2005/05/identity/claims/name", EMAIL],
];

let idpKeys: SamlKeyPair;

beforeAll(() => {
  idpKeys = generateRsaKeyPair();
});

type Attributes = Array<[name: string, value: string]>;

function verify(attributes: Attributes | undefined): VerifiedSamlResponse {
  return SSOUtil.getSamlResponseFromXML(
    signElement(
      buildSamlResponse({
        issuer: ISSUER,
        email: EMAIL,
        issuedAt: minutesAfter(NOW, -1),
        audienceRestrictions: [[PROVIDER.entityId]],
        recipient: PROVIDER.replyUrl,
        destination: PROVIDER.replyUrl,
        attributes: attributes,
      }),
      "Assertion",
      idpKeys.privateKey,
    ),
    idpKeys.publicKey,
    PROVIDER,
    NOW,
  );
}

function readError(attributes: Attributes): string {
  try {
    verify(attributes);
  } catch (err) {
    return (err as Error).message;
  }

  throw new Error("The response was accepted");
}

describe("the object ID Microsoft Entra ID sends", () => {
  test("is read from its default claims, beside the address", () => {
    const result: VerifiedSamlResponse = verify(ENTRA_DEFAULT_CLAIMS);

    expect(result.objectId).toBe(OBJECT_ID);
    expect(result.email.toString()).toBe(EMAIL);
  });

  test("is read in lower case: the same GUID in either case is the same person", () => {
    expect(
      verify([[SAML_OBJECT_ID_CLAIM, OBJECT_ID.toUpperCase()]]).objectId,
    ).toBe(OBJECT_ID);
  });

  test("whatever the case of the claim's name, and only as first sent", () => {
    expect(
      verify([
        [SAML_OBJECT_ID_CLAIM.toUpperCase(), OBJECT_ID],
        [SAML_OBJECT_ID_CLAIM, "00000000-0000-4000-8000-000000000000"],
      ]).objectId,
    ).toBe(OBJECT_ID);
  });

  test("an ID that is not a GUID is kept as sent", () => {
    expect(
      verify([[SAML_OBJECT_ID_CLAIM, "  AbCdEf0123456789==  "]]).objectId,
    ).toBe("AbCdEf0123456789==");
  });
});

describe("no object ID", () => {
  test("from an identity provider that sends none - Okta's statements, say", () => {
    expect(
      verify([
        ["email", EMAIL],
        ["firstName", "Dana"],
        ["lastName", "Scully"],
      ]).objectId,
    ).toBe(null);
  });

  test("from an assertion with no attributes at all", () => {
    expect(verify(undefined).objectId).toBe(null);
  });

  test("from an empty claim", () => {
    expect(verify([[SAML_OBJECT_ID_CLAIM, "   "]]).objectId).toBe(null);
  });
});

describe("an object ID the sign-in cannot be decided on is refused", () => {
  test("one with an XML comment in it", () => {
    expect(readError([[SAML_OBJECT_ID_CLAIM, `${OBJECT_ID}<!-- -->`]])).toBe(
      "SAML Assertion must not contain XML comments",
    );
  });

  test("one too long to be an object ID", () => {
    expect(readError([[SAML_OBJECT_ID_CLAIM, "a".repeat(101)]])).toBe(
      SAML_OBJECT_ID_TOO_LONG_MESSAGE,
    );
  });
});
