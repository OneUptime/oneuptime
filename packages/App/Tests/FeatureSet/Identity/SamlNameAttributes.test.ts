import SSOUtil, {
  SAML_DISPLAY_NAME_ATTRIBUTES,
  SAML_FAMILY_NAME_ATTRIBUTES,
  SAML_GIVEN_NAME_ATTRIBUTES,
  SAML_NAME_CLAIM,
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
import ColumnLength from "Common/Types/Database/ColumnLength";
import { beforeAll, describe, expect, test } from "@jest/globals";

/*
 * ---------------------------------------------------------------------------
 * WHERE A SAML ASSERTION'S NAME IS READ FROM.
 *
 * The email address always comes from the Name ID. The name is only for the
 * account OneUptime creates at someone's first sign-in, and identity
 * providers send it under different attributes: Okta's attribute statements
 * (firstName, lastName, as the Okta Integration Network app sends them),
 * the claims Microsoft Entra ID sends by default (givenname, surname - and
 * the displayname claim only when an admin adds it), OneLogin's User.*,
 * the LDAP object identifiers. This suite holds the order they are read in
 * (SAML_DISPLAY_NAME_ATTRIBUTES and the lists after it), and that every value
 * read is held to plain text like the Name ID is.
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

const MS_DISPLAY_NAME: string =
  "http://schemas.microsoft.com/identity/claims/displayname";
const XMLSOAP_GIVEN_NAME: string =
  "http://schemas.xmlsoap.org/ws/2005/05/identity/claims/givenname";
const XMLSOAP_SURNAME: string =
  "http://schemas.xmlsoap.org/ws/2005/05/identity/claims/surname";

let idpKeys: SamlKeyPair;

beforeAll(() => {
  idpKeys = generateRsaKeyPair();
});

type Attributes = Array<[name: string, value: string]>;

// A response for PROVIDER carrying `attributes`, signed as the IdP would.
function signedResponse(attributes: Attributes): string {
  return signElement(
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
  );
}

function readName(attributes: Attributes): string | null {
  const result: VerifiedSamlResponse = SSOUtil.getSamlResponseFromXML(
    signedResponse(attributes),
    idpKeys.publicKey,
    PROVIDER,
    NOW,
  );

  expect(result.email.toString()).toBe(EMAIL);

  return result.name ? result.name.toString() : null;
}

function readError(attributes: Attributes): string {
  try {
    SSOUtil.getSamlResponseFromXML(
      signedResponse(attributes),
      idpKeys.publicKey,
      PROVIDER,
      NOW,
    );
  } catch (err) {
    return (err as Error).message;
  }

  throw new Error("The response was accepted");
}

describe("SAML name attributes - what each identity provider sends", () => {
  test("Okta's attribute statements: firstName and lastName", () => {
    expect(
      readName([
        ["email", EMAIL],
        ["firstName", "Dana"],
        ["lastName", "Scully"],
      ]),
    ).toBe("Dana Scully");
  });

  test("Microsoft Entra ID's default claims: givenname and surname", () => {
    expect(
      readName([
        [XMLSOAP_GIVEN_NAME, "Dana"],
        [XMLSOAP_SURNAME, "Scully"],
        ["http://schemas.xmlsoap.org/ws/2005/05/identity/claims/name", EMAIL],
      ]),
    ).toBe("Dana Scully");
  });

  test("the Microsoft displayname claim is read first, as it always was", () => {
    expect(
      readName([
        [XMLSOAP_GIVEN_NAME, "Dana"],
        [XMLSOAP_SURNAME, "Scully"],
        [MS_DISPLAY_NAME, "Dr. Dana Katherine Scully"],
      ]),
    ).toBe("Dr. Dana Katherine Scully");
  });

  test("a displayName attribute is a whole name", () => {
    expect(readName([["displayName", "Dana Scully"]])).toBe("Dana Scully");
  });

  test("OneLogin's User.FirstName and User.LastName", () => {
    expect(
      readName([
        ["User.FirstName", "Dana"],
        ["User.LastName", "Scully"],
      ]),
    ).toBe("Dana Scully");
  });

  test("the LDAP object identifiers for given name and surname", () => {
    expect(
      readName([
        ["urn:oid:2.5.4.42", "Dana"],
        ["urn:oid:2.5.4.4", "Scully"],
      ]),
    ).toBe("Dana Scully");
  });

  test("a given name alone, or a family name alone, is the name", () => {
    expect(readName([["firstName", "Dana"]])).toBe("Dana");
    expect(readName([["surname", "Scully"]])).toBe("Scully");
  });

  test("the xmlsoap name claim is read when it is a name, as Auth0 sends it", () => {
    expect(readName([[SAML_NAME_CLAIM, "Dana Scully"]])).toBe("Dana Scully");
  });

  test("the xmlsoap name claim is not a name when it is an address, as Entra ID sends the user principal name", () => {
    expect(readName([[SAML_NAME_CLAIM, "dana.scully@example.com"]])).toBe(null);
  });

  test("an assertion with no name attribute gives no name", () => {
    expect(readName([])).toBe(null);
    expect(
      readName([
        ["email", EMAIL],
        ["groups", "Engineering"],
      ]),
    ).toBe(null);
  });
});

describe("SAML name attributes - how they are read", () => {
  test("attribute names are compared without regard to case", () => {
    expect(
      readName([
        ["FIRSTNAME", "Dana"],
        ["LastName", "Scully"],
      ]),
    ).toBe("Dana Scully");
    expect(readName([["DisplayName", "Dana Scully"]])).toBe("Dana Scully");
  });

  test("an attribute sent twice counts once, as first sent", () => {
    expect(
      readName([
        ["firstName", "Dana"],
        ["firstName", "Mallory"],
        ["lastName", "Scully"],
      ]),
    ).toBe("Dana Scully");
  });

  test("an empty display name falls through to the given and family names", () => {
    expect(
      readName([
        [MS_DISPLAY_NAME, "   "],
        ["firstName", "Dana"],
        ["lastName", "Scully"],
      ]),
    ).toBe("Dana Scully");
  });

  test("values are trimmed", () => {
    expect(
      readName([
        ["firstName", "  Dana "],
        ["lastName", " Scully  "],
      ]),
    ).toBe("Dana Scully");
  });

  test("a name longer than an account's name holds is cut to fit, and still signs its owner in", () => {
    const longName: string = "Dana " + "Katherine".repeat(20) + " Scully";

    const name: string | null = readName([[MS_DISPLAY_NAME, longName]]);

    expect(name).toBe(longName.substring(0, ColumnLength.Name).trim());
    expect((name || "").length).toBeLessThanOrEqual(ColumnLength.Name);
  });

  test("every list names attributes once, and no attribute is in two lists", () => {
    const all: Array<string> = [
      ...SAML_DISPLAY_NAME_ATTRIBUTES,
      ...SAML_GIVEN_NAME_ATTRIBUTES,
      ...SAML_FAMILY_NAME_ATTRIBUTES,
      SAML_NAME_CLAIM,
    ].map((name: string): string => {
      return name.toLowerCase();
    });

    expect(new Set<string>(all).size).toBe(all.length);
  });
});

describe("SAML name attributes - held to plain text like the Name ID", () => {
  const COMMENT_REJECTED: string =
    "SAML Assertion must not contain XML comments";
  const NESTED_REJECTED: string =
    "SAML Assertion identity values must not contain nested elements";

  test("a given name with an XML comment in it is refused", () => {
    expect(
      readError([
        ["firstName", "Da<!-- -->na"],
        ["lastName", "Scully"],
      ]),
    ).toBe(COMMENT_REJECTED);
  });

  test("a family name with a nested element in it is refused", () => {
    expect(
      readError([
        ["firstName", "Dana"],
        ["lastName", "Scully<saml:Wrap>Attacker</saml:Wrap>"],
      ]),
    ).toBe(NESTED_REJECTED);
  });

  test("a name attribute with markup is refused even when another attribute gives the name", () => {
    expect(
      readError([
        [MS_DISPLAY_NAME, "Dana Scully"],
        [XMLSOAP_SURNAME, "Scully<!-- -->Attacker"],
      ]),
    ).toBe(COMMENT_REJECTED);
  });

  test("markup in an attribute OneUptime does not read is left alone", () => {
    expect(
      readName([
        ["department", "X-Files<!-- basement -->"],
        ["firstName", "Dana"],
        ["lastName", "Scully"],
      ]),
    ).toBe("Dana Scully");
  });
});
