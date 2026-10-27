import SSOUtil, {
  SAML_AUDIENCE_MISMATCH_MESSAGE,
  SAML_AUDIENCE_MISSING_MESSAGE,
  SAML_DESTINATION_MISMATCH_MESSAGE,
  SAML_RECIPIENT_MISMATCH_MESSAGE,
  SAML_RECIPIENT_MISSING_MESSAGE,
  SAML_RESPONSE_EXPIRED_MESSAGE,
  SAML_RESPONSE_NOT_YET_VALID_MESSAGE,
  VerifiedSamlResponse,
} from "../../../FeatureSet/Identity/Utils/SSO";
import { SamlServiceProvider } from "../../../FeatureSet/Identity/Utils/SamlServiceProvider";
import {
  SAML_BEARER_METHOD,
  SamlKeyPair,
  SamlResponseOptions,
  buildSamlResponse,
  generateRsaKeyPair,
  minutesAfter,
  signElement,
} from "./SamlTestKit";
import { beforeAll, describe, expect, test } from "@jest/globals";
import { FastestRun, fastestRun } from "Common/Tests/Helpers/FastestRun";

/*
 * ---------------------------------------------------------------------------
 * WHO A SAML RESPONSE IS FOR, AND WHEN IT MAY BE USED.
 *
 * SSO.test.ts holds the signature and the document's shape: who made the
 * assertion and who it names. This suite holds the rest of what a response
 * says - the rules SSOUtil.getSamlResponseFromXML adds on top (10-12 in its
 * comment):
 *
 *   - who it is for: every <AudienceRestriction> names this provider;
 *   - where it was sent: a bearer confirmation's Recipient, and the
 *     Response's Destination when it has one, is this provider's Reply URL;
 *   - when: inside every window it states, and issued no more than ten
 *     minutes ago, with three minutes of slack for clocks either way.
 *
 * Every document is signed with a generated identity provider key and read at
 * a fixed moment, NOW, so each test moves exactly one thing.
 * ---------------------------------------------------------------------------
 */

const SERVER: string = "https://oneuptime.example.com";
const PROJECT_ID: string = "11111111-1111-4111-8111-111111111111";
const PROVIDER_ID: string = "22222222-2222-4222-8222-222222222222";
const OTHER_PROVIDER_ID: string = "33333333-3333-4333-8333-333333333333";

const PROVIDER: SamlServiceProvider = {
  entityId: `${SERVER}/${PROJECT_ID}/${PROVIDER_ID}`,
  replyUrl: `${SERVER}/identity/idp-login/${PROJECT_ID}/${PROVIDER_ID}`,
  serverAddress: SERVER,
};

// Another provider of the same project, trusting the same identity provider.
const OTHER_PROVIDER: SamlServiceProvider = {
  entityId: `${SERVER}/${PROJECT_ID}/${OTHER_PROVIDER_ID}`,
  replyUrl: `${SERVER}/identity/idp-login/${PROJECT_ID}/${OTHER_PROVIDER_ID}`,
  serverAddress: SERVER,
};

const ISSUER: string = "https://idp.example.com/realms/acme";
const EMAIL: string = "fox.mulder@example.com";

// The moment every document is read at.
const NOW: Date = new Date("2026-03-01T12:00:00.000Z");

const SKEW_MINUTES: number = SSOUtil.CLOCK_SKEW_IN_MS / 60000;
const MAX_AGE_MINUTES: number = SSOUtil.MAX_ASSERTION_AGE_IN_MS / 60000;

let idpKeys: SamlKeyPair;

beforeAll(() => {
  idpKeys = generateRsaKeyPair();
});

/*
 * A response for PROVIDER, issued a minute before NOW, with the five-minute
 * windows identity providers use - and whatever `overrides` changes. Unsigned:
 * `signed` signs it as the identity provider would.
 */
function unsignedResponse(
  overrides: Partial<SamlResponseOptions> = {},
): string {
  return buildSamlResponse({
    issuer: ISSUER,
    email: EMAIL,
    issuedAt: minutesAfter(NOW, -1),
    audienceRestrictions: [[PROVIDER.entityId]],
    recipient: PROVIDER.replyUrl,
    destination: PROVIDER.replyUrl,
    ...overrides,
  });
}

function signed(xml: string): string {
  return signElement(xml, "Assertion", idpKeys.privateKey);
}

function response(overrides: Partial<SamlResponseOptions> = {}): string {
  return signed(unsignedResponse(overrides));
}

// Edits an unsigned document before it is signed; the text must be there.
function replaceOnce(
  text: string,
  search: string,
  replacement: string,
): string {
  const index: number = text.indexOf(search);

  if (index < 0) {
    throw new Error(`Test setup error: ${search} is not in the document`);
  }

  return (
    text.substring(0, index) +
    replacement +
    text.substring(index + search.length)
  );
}

function verify(
  xml: string,
  options: {
    provider?: SamlServiceProvider | undefined;
    now?: Date | undefined;
  } = {},
): VerifiedSamlResponse {
  return SSOUtil.getSamlResponseFromXML(
    xml,
    idpKeys.publicKey,
    options.provider || PROVIDER,
    options.now || NOW,
  );
}

function expectAccepted(
  xml: string,
  options: {
    provider?: SamlServiceProvider | undefined;
    now?: Date | undefined;
  } = {},
): VerifiedSamlResponse {
  const result: VerifiedSamlResponse = verify(xml, options);

  expect(result.email.toString()).toBe(EMAIL);
  expect(result.issuerUrl).toBe(ISSUER);
  expect(
    SSOUtil.isSignatureValid(
      xml,
      idpKeys.publicKey,
      options.provider || PROVIDER,
      options.now || NOW,
    ),
  ).toBe(true);

  return result;
}

function expectRefused(
  xml: string,
  message: string,
  options: {
    provider?: SamlServiceProvider | undefined;
    now?: Date | undefined;
  } = {},
): void {
  expect(() => {
    return verify(xml, options);
  }).toThrow(message);

  // The boolean form never says yes to what the entry point refuses.
  expect(
    SSOUtil.isSignatureValid(
      xml,
      idpKeys.publicKey,
      options.provider || PROVIDER,
      options.now || NOW,
    ),
  ).toBe(false);
}

describe("a response made for this provider", () => {
  test("is accepted, and says which assertion it was and until when it can be used", () => {
    const result: VerifiedSamlResponse = expectAccepted(
      response({ assertionId: "_the_assertion" }),
    );

    expect(result.assertionId).toBe("_the_assertion");

    /*
     * Issued a minute ago with five-minute windows: acceptable until those
     * windows close, plus the clock slack.
     */
    expect(result.acceptableUntil.toISOString()).toBe(
      minutesAfter(NOW, -1 + 5 + SKEW_MINUTES).toISOString(),
    );
  });

  test("is accepted when the whole Response is signed instead of the assertion", () => {
    expectAccepted(
      signElement(unsignedResponse(), "Response", idpKeys.privateKey),
    );
  });

  test("is refused for another application when the whole Response is signed too", () => {
    expectRefused(
      signElement(
        unsignedResponse({
          audienceRestrictions: [["https://acme.chat.example.net"]],
        }),
        "Response",
        idpKeys.privateKey,
      ),
      SAML_AUDIENCE_MISMATCH_MESSAGE,
    );
  });

  test("is refused at another provider of the same identity provider", () => {
    expectRefused(response(), SAML_AUDIENCE_MISMATCH_MESSAGE, {
      provider: OTHER_PROVIDER,
    });
  });
});

describe("rule 10: every AudienceRestriction names this provider", () => {
  test.each([
    ["its Entity ID", PROVIDER.entityId],
    ["its Reply URL", PROVIDER.replyUrl],
    [
      "this server's address, the Entity ID shown before May 2024",
      PROVIDER.serverAddress,
    ],
    ["this server's address with a trailing slash", `${SERVER}/`],
    ["its Entity ID with a trailing slash", `${PROVIDER.entityId}/`],
    [
      "its Entity ID over http, as a server behind a TLS proxy may know itself",
      PROVIDER.entityId.replace("https://", "http://"),
    ],
    ["its Entity ID in upper case", PROVIDER.entityId.toUpperCase()],
    [
      "its Entity ID with the default https port written out",
      PROVIDER.entityId.replace(
        "oneuptime.example.com",
        "oneuptime.example.com:443",
      ),
    ],
    [
      "its Entity ID with surrounding whitespace, as pretty-printed XML has",
      `\n      ${PROVIDER.entityId}\n    `,
    ],
  ])("accepts an Audience that is %s", (_label: string, audience: string) => {
    expectAccepted(response({ audienceRestrictions: [[audience]] }));
  });

  test.each([
    [
      "another application at the same identity provider",
      "https://acme.chat.example.net",
    ],
    ["another provider of this server", OTHER_PROVIDER.entityId],
    ["another provider's Reply URL", OTHER_PROVIDER.replyUrl],
    [
      "this provider's path on another server",
      `https://oneuptime.other.example.org/${PROJECT_ID}/${PROVIDER_ID}`,
    ],
    [
      "a look-alike host that starts with this server's",
      `https://oneuptime.example.com.evil.example.net/${PROJECT_ID}/${PROVIDER_ID}`,
    ],
    ["this provider's Entity ID with more path", `${PROVIDER.entityId}/more`],
    ["this provider's Entity ID with a suffix", `${PROVIDER.entityId}0`],
    ["this provider's project alone", `${SERVER}/${PROJECT_ID}`],
    [
      "this server on another port",
      PROVIDER.entityId.replace(
        "oneuptime.example.com",
        "oneuptime.example.com:8443",
      ),
    ],
    ["a name that is not a URL", "oneuptime"],
    ["a URN", `urn:oneuptime:${PROJECT_ID}:${PROVIDER_ID}`],
    [
      "this provider's address under another scheme",
      PROVIDER.entityId.replace("https://", "ftp://"),
    ],
    ["nothing", ""],
  ])("refuses an Audience that is %s", (_label: string, audience: string) => {
    expectRefused(
      response({ audienceRestrictions: [[audience]] }),
      SAML_AUDIENCE_MISMATCH_MESSAGE,
    );
  });

  test("accepts a restriction listing several audiences when one of them is this provider", () => {
    expectAccepted(
      response({
        audienceRestrictions: [
          ["https://acme.chat.example.net", PROVIDER.entityId],
        ],
      }),
    );
  });

  test("accepts several restrictions when each of them names this provider", () => {
    expectAccepted(
      response({
        audienceRestrictions: [
          [PROVIDER.entityId],
          ["https://acme.chat.example.net", PROVIDER.replyUrl],
        ],
      }),
    );
  });

  /*
   * SAML 2.0 Core 2.5.1.4: restrictions are all to be met. A second
   * restriction that leaves this provider out says the assertion is not for
   * it, whatever the first one says.
   */
  test("refuses several restrictions when one of them leaves this provider out", () => {
    expectRefused(
      response({
        audienceRestrictions: [
          [PROVIDER.entityId],
          ["https://acme.chat.example.net"],
        ],
      }),
      SAML_AUDIENCE_MISMATCH_MESSAGE,
    );
  });

  test("refuses an assertion whose Conditions name no audience", () => {
    expectRefused(
      response({ audienceRestrictions: [] }),
      SAML_AUDIENCE_MISSING_MESSAGE,
    );
  });

  test("refuses an AudienceRestriction with no Audience in it", () => {
    expectRefused(
      response({ audienceRestrictions: [[]] }),
      SAML_AUDIENCE_MISMATCH_MESSAGE,
    );
  });

  test("refuses an assertion with no Conditions at all", () => {
    expectRefused(
      response({ rawConditions: "" }),
      SAML_AUDIENCE_MISSING_MESSAGE,
    );
  });

  test("refuses an assertion with two Conditions elements", () => {
    const conditions: string = `<saml:Conditions><saml:AudienceRestriction><saml:Audience>${PROVIDER.entityId}</saml:Audience></saml:AudienceRestriction></saml:Conditions>`;

    expectRefused(
      response({ rawConditions: conditions + conditions }),
      "SAML Assertion must not contain more than one Conditions element",
    );
  });

  test("does not count an Audience in another namespace", () => {
    expectRefused(
      response({
        rawConditions: `<saml:Conditions><saml:AudienceRestriction><x:Audience xmlns:x="urn:example:not-saml">${PROVIDER.entityId}</x:Audience></saml:AudienceRestriction></saml:Conditions>`,
      }),
      SAML_AUDIENCE_MISMATCH_MESSAGE,
    );
  });

  test("does not count an AudienceRestriction in another namespace", () => {
    expectRefused(
      response({
        rawConditions: `<saml:Conditions><x:AudienceRestriction xmlns:x="urn:example:not-saml"><saml:Audience>${PROVIDER.entityId}</saml:Audience></x:AudienceRestriction></saml:Conditions>`,
      }),
      SAML_AUDIENCE_MISSING_MESSAGE,
    );
  });

  test("does not count Conditions in another namespace", () => {
    expectRefused(
      response({
        rawConditions: `<x:Conditions xmlns:x="urn:example:not-saml"><saml:AudienceRestriction><saml:Audience>${PROVIDER.entityId}</saml:Audience></saml:AudienceRestriction></x:Conditions>`,
      }),
      SAML_AUDIENCE_MISSING_MESSAGE,
    );
  });

  test("leaves the other conditions an identity provider adds alone", () => {
    expectAccepted(
      response({
        rawConditions: `<saml:Conditions NotBefore="${minutesAfter(
          NOW,
          -6,
        ).toISOString()}" NotOnOrAfter="${minutesAfter(
          NOW,
          4,
        ).toISOString()}"><saml:AudienceRestriction><saml:Audience>${
          PROVIDER.entityId
        }</saml:Audience></saml:AudienceRestriction><saml:OneTimeUse/><saml:ProxyRestriction Count="0"/></saml:Conditions>`,
      }),
    );
  });
});

describe("rule 11: it was sent to this provider's Reply URL", () => {
  test.each([
    ["its Reply URL", PROVIDER.replyUrl],
    ["its Reply URL with a trailing slash", `${PROVIDER.replyUrl}/`],
    [
      "its Reply URL over http",
      PROVIDER.replyUrl.replace("https://", "http://"),
    ],
    ["its Reply URL in upper case", PROVIDER.replyUrl.toUpperCase()],
    [
      "its Reply URL with a query string",
      `${PROVIDER.replyUrl}?from=idp-dashboard`,
    ],
  ])("accepts a Recipient that is %s", (_label: string, recipient: string) => {
    expectAccepted(response({ recipient, destination: recipient }));
  });

  test.each([
    ["another provider's Reply URL", OTHER_PROVIDER.replyUrl],
    [
      "another application's Reply URL",
      "https://acme.chat.example.net/sso/saml",
    ],
    ["this provider's Entity ID", PROVIDER.entityId],
    ["this server's address alone", SERVER],
    [
      "this provider's Reply URL on another server",
      PROVIDER.replyUrl.replace(
        "oneuptime.example.com",
        "oneuptime.other.example.org",
      ),
    ],
    [
      "the status page Reply URL of the same ids",
      `${SERVER}/identity/status-page-idp-login/${PROJECT_ID}/${PROVIDER_ID}`,
    ],
    ["a name that is not a URL", "idp-login"],
  ])("refuses a Recipient that is %s", (_label: string, recipient: string) => {
    expectRefused(
      response({ recipient, destination: null }),
      SAML_RECIPIENT_MISMATCH_MESSAGE,
    );
  });

  test("refuses a bearer confirmation with no Recipient", () => {
    expectRefused(
      response({ recipient: null, destination: null }),
      SAML_RECIPIENT_MISSING_MESSAGE,
    );
  });

  test("refuses a bearer confirmation with no SubjectConfirmationData", () => {
    expectRefused(
      response({ subjectConfirmations: [{ data: null }] }),
      SAML_RECIPIENT_MISSING_MESSAGE,
    );
  });

  test("refuses an assertion with no SubjectConfirmation", () => {
    expectRefused(
      response({ subjectConfirmations: [] }),
      "SAML Assertion has no bearer SubjectConfirmation",
    );
  });

  test("refuses an assertion whose only confirmation is not a bearer one", () => {
    expectRefused(
      response({
        subjectConfirmations: [
          {
            method: "urn:oasis:names:tc:SAML:2.0:cm:holder-of-key",
            data: {
              recipient: PROVIDER.replyUrl,
              notOnOrAfter: minutesAfter(NOW, 4),
            },
          },
        ],
      }),
      "SAML Assertion has no bearer SubjectConfirmation",
    );
  });

  test("refuses a confirmation carrying two SubjectConfirmationData", () => {
    const data: string = `<saml:SubjectConfirmationData NotOnOrAfter="${minutesAfter(
      NOW,
      4,
    ).toISOString()}" Recipient="${PROVIDER.replyUrl}"/>`;

    const xml: string = signed(
      replaceOnce(
        unsignedResponse({
          subjectConfirmations: [
            {
              data: {
                recipient: PROVIDER.replyUrl,
                notOnOrAfter: minutesAfter(NOW, 4),
              },
            },
          ],
        }),
        `<saml:SubjectConfirmation Method="${SAML_BEARER_METHOD}">${data}`,
        `<saml:SubjectConfirmation Method="${SAML_BEARER_METHOD}">${data}${data}`,
      ),
    );

    expectRefused(
      xml,
      "SAML SubjectConfirmation must not contain more than one SubjectConfirmationData",
    );
  });

  test("accepts an assertion with a bearer confirmation for another provider as well as one for this provider", () => {
    expectAccepted(
      response({
        subjectConfirmations: [
          {
            data: {
              recipient: OTHER_PROVIDER.replyUrl,
              notOnOrAfter: minutesAfter(NOW, 4),
            },
          },
          {
            data: {
              recipient: PROVIDER.replyUrl,
              notOnOrAfter: minutesAfter(NOW, 4),
            },
          },
        ],
      }),
    );
  });

  /*
   * Only a confirmation for this Reply URL can make a response good here, so
   * one that is still open for another provider does not keep an expired one
   * for this provider alive.
   */
  test("refuses when the confirmation for this provider has closed, though one for another provider is still open", () => {
    expectRefused(
      response({
        destination: null,
        conditionsNotOnOrAfter: minutesAfter(NOW, 30),
        subjectConfirmations: [
          {
            data: {
              recipient: PROVIDER.replyUrl,
              notOnOrAfter: minutesAfter(NOW, -SKEW_MINUTES - 1),
            },
          },
          {
            data: {
              recipient: OTHER_PROVIDER.replyUrl,
              notOnOrAfter: minutesAfter(NOW, 30),
            },
          },
        ],
      }),
      SAML_RESPONSE_EXPIRED_MESSAGE,
    );
  });

  test("ignores a holder-of-key confirmation naming this Reply URL when the bearer one names another", () => {
    expectRefused(
      response({
        destination: null,
        subjectConfirmations: [
          {
            method: "urn:oasis:names:tc:SAML:2.0:cm:holder-of-key",
            data: {
              recipient: PROVIDER.replyUrl,
              notOnOrAfter: minutesAfter(NOW, 4),
            },
          },
          {
            data: {
              recipient: OTHER_PROVIDER.replyUrl,
              notOnOrAfter: minutesAfter(NOW, 4),
            },
          },
        ],
      }),
      SAML_RECIPIENT_MISMATCH_MESSAGE,
    );
  });

  test("accepts a Response with no Destination: the signed Recipient holds it to this provider", () => {
    expectAccepted(response({ destination: null }));
  });

  test("accepts a Response with an empty Destination", () => {
    expectAccepted(response({ destination: "" }));
  });

  test.each([
    ["another provider's Reply URL", OTHER_PROVIDER.replyUrl],
    [
      "another application's Reply URL",
      "https://acme.chat.example.net/sso/saml",
    ],
    ["this provider's Entity ID", PROVIDER.entityId],
  ])(
    "refuses a Response whose Destination is %s",
    (_label: string, destination: string) => {
      expectRefused(
        response({ destination }),
        SAML_DESTINATION_MISMATCH_MESSAGE,
      );
    },
  );
});

describe("rule 12: it is used inside its time", () => {
  test("accepts a response issued just now", () => {
    expectAccepted(response({ issuedAt: NOW }));
  });

  test("accepts a response issued slightly in the future, within the clock slack", () => {
    expectAccepted(
      response({
        issuedAt: minutesAfter(NOW, SKEW_MINUTES - 0.5),
        conditionsNotBefore: null,
      }),
    );
  });

  test("refuses a response issued further in the future than the clock slack", () => {
    expectRefused(
      response({
        issuedAt: minutesAfter(NOW, SKEW_MINUTES + 0.5),
        conditionsNotBefore: null,
      }),
      SAML_RESPONSE_NOT_YET_VALID_MESSAGE,
    );
  });

  /*
   * However long the identity provider says it is good for, an assertion is
   * accepted only so long after it was issued.
   */
  test("accepts a response a little under ten minutes old whose windows are still open", () => {
    expectAccepted(
      response({
        issuedAt: minutesAfter(NOW, -(MAX_AGE_MINUTES + SKEW_MINUTES - 0.5)),
        conditionsNotOnOrAfter: minutesAfter(NOW, 60),
        subjectNotOnOrAfter: minutesAfter(NOW, 60),
      }),
    );
  });

  test("refuses a response older than that, even when it says it is good for an hour", () => {
    expectRefused(
      response({
        issuedAt: minutesAfter(NOW, -(MAX_AGE_MINUTES + SKEW_MINUTES + 0.5)),
        conditionsNotOnOrAfter: minutesAfter(NOW, 60),
        subjectNotOnOrAfter: minutesAfter(NOW, 60),
      }),
      SAML_RESPONSE_EXPIRED_MESSAGE,
    );
  });

  test("refuses a response kept for two hours", () => {
    expectRefused(
      response({ issuedAt: minutesAfter(NOW, -120) }),
      SAML_RESPONSE_EXPIRED_MESSAGE,
    );
  });

  test("refuses an assertion whose Conditions closed longer ago than the clock slack", () => {
    expectRefused(
      response({
        conditionsNotOnOrAfter: minutesAfter(NOW, -SKEW_MINUTES - 0.5),
      }),
      SAML_RESPONSE_EXPIRED_MESSAGE,
    );
  });

  test("accepts an assertion whose Conditions closed within the clock slack", () => {
    expectAccepted(
      response({
        conditionsNotOnOrAfter: minutesAfter(NOW, -SKEW_MINUTES + 0.5),
      }),
    );
  });

  test("refuses at the very moment the Conditions' slack runs out, and accepts a millisecond before", () => {
    const notOnOrAfter: Date = minutesAfter(NOW, -1);
    const xml: string = response({ conditionsNotOnOrAfter: notOnOrAfter });
    const lastMoment: Date = new Date(
      notOnOrAfter.getTime() + SSOUtil.CLOCK_SKEW_IN_MS,
    );

    expectRefused(xml, SAML_RESPONSE_EXPIRED_MESSAGE, { now: lastMoment });
    expectAccepted(xml, { now: new Date(lastMoment.getTime() - 1) });
  });

  test("refuses an assertion whose Conditions open later than the clock slack", () => {
    expectRefused(
      response({ conditionsNotBefore: minutesAfter(NOW, SKEW_MINUTES + 0.5) }),
      SAML_RESPONSE_NOT_YET_VALID_MESSAGE,
    );
  });

  test("accepts an assertion whose Conditions open within the clock slack", () => {
    expectAccepted(
      response({ conditionsNotBefore: minutesAfter(NOW, SKEW_MINUTES - 0.5) }),
    );
  });

  test("accepts Conditions that state no window", () => {
    expectAccepted(
      response({ conditionsNotBefore: null, conditionsNotOnOrAfter: null }),
    );
  });

  test("refuses an assertion whose bearer confirmation closed longer ago than the clock slack", () => {
    expectRefused(
      response({ subjectNotOnOrAfter: minutesAfter(NOW, -SKEW_MINUTES - 0.5) }),
      SAML_RESPONSE_EXPIRED_MESSAGE,
    );
  });

  test("refuses an assertion whose bearer confirmation opens later than the clock slack", () => {
    expectRefused(
      response({
        subjectConfirmations: [
          {
            data: {
              recipient: PROVIDER.replyUrl,
              notBefore: minutesAfter(NOW, SKEW_MINUTES + 0.5),
              notOnOrAfter: minutesAfter(NOW, 10),
            },
          },
        ],
      }),
      SAML_RESPONSE_NOT_YET_VALID_MESSAGE,
    );
  });

  test("accepts a bearer confirmation that states no window: the ten minutes still bound it", () => {
    const result: VerifiedSamlResponse = expectAccepted(
      response({
        subjectNotOnOrAfter: null,
        conditionsNotOnOrAfter: null,
      }),
    );

    expect(result.acceptableUntil.toISOString()).toBe(
      minutesAfter(NOW, -1 + MAX_AGE_MINUTES + SKEW_MINUTES).toISOString(),
    );
  });

  test("accepts when one of two bearer confirmations for this provider is still open, until the later one closes", () => {
    const result: VerifiedSamlResponse = expectAccepted(
      response({
        conditionsNotOnOrAfter: minutesAfter(NOW, 30),
        subjectConfirmations: [
          {
            data: {
              recipient: PROVIDER.replyUrl,
              notOnOrAfter: minutesAfter(NOW, -30),
            },
          },
          {
            data: {
              recipient: PROVIDER.replyUrl,
              notOnOrAfter: minutesAfter(NOW, 2),
            },
          },
        ],
      }),
    );

    expect(result.acceptableUntil.toISOString()).toBe(
      minutesAfter(NOW, 2 + SKEW_MINUTES).toISOString(),
    );
  });

  test("is acceptable until the earliest window closes", () => {
    const result: VerifiedSamlResponse = expectAccepted(
      response({
        conditionsNotOnOrAfter: minutesAfter(NOW, 1),
        subjectNotOnOrAfter: minutesAfter(NOW, 3),
      }),
    );

    expect(result.acceptableUntil.toISOString()).toBe(
      minutesAfter(NOW, 1 + SKEW_MINUTES).toISOString(),
    );
  });

  test("a confirmation's window is not stretched by a later Conditions window", () => {
    expectRefused(
      response({
        conditionsNotOnOrAfter: minutesAfter(NOW, 30),
        subjectNotOnOrAfter: minutesAfter(NOW, -SKEW_MINUTES - 1),
      }),
      SAML_RESPONSE_EXPIRED_MESSAGE,
    );
  });
});

describe("rule 12: SAML times are read strictly", () => {
  test.each([
    ["with milliseconds", "2026-03-01T11:59:00.000Z"],
    ["without fractions", "2026-03-01T11:59:00Z"],
    [
      "with the seven fraction digits .NET writes",
      "2026-03-01T11:59:00.1234567Z",
    ],
    ["with no zone, read as UTC", "2026-03-01T11:59:00"],
    ["with an offset east of UTC", "2026-03-01T13:59:00+02:00"],
    ["with an offset west of UTC", "2026-03-01T06:59:00-05:00"],
  ])("reads an IssueInstant %s", (_label: string, issueInstant: string) => {
    expectAccepted(response({ rawIssueInstant: issueInstant }));
  });

  test("reads an offset, rather than ignoring it", () => {
    // 11:59 at +02:00 is 09:59 UTC: two hours old, so refused.
    expectRefused(
      response({ rawIssueInstant: "2026-03-01T11:59:00+02:00" }),
      SAML_RESPONSE_EXPIRED_MESSAGE,
    );
  });

  test.each([
    ["a word", "yesterday"],
    ["a date alone", "2026-03-01"],
    ["a space for the T", "2026-03-01 11:59:00Z"],
    ["the 30th of February", "2026-02-30T11:59:00Z"],
    ["hour 24", "2026-03-01T24:00:00Z"],
    ["minute 60", "2026-03-01T11:60:00Z"],
    ["a leap second", "2026-03-01T11:59:60Z"],
    ["a two-digit year", "26-03-01T11:59:00Z"],
    ["an offset beyond fourteen hours", "2026-03-01T11:59:00+15:00"],
    ["an offset without a colon", "2026-03-01T11:59:00+0200"],
    ["a trailing word", "2026-03-01T11:59:00Z later"],
    ["ten fraction digits", "2026-03-01T11:59:00.1234567890Z"],
    ["epoch milliseconds", "1772366340000"],
    ["nothing", ""],
  ])(
    "refuses an IssueInstant that is %s",
    (_label: string, issueInstant: string) => {
      expectRefused(
        response({ rawIssueInstant: issueInstant }),
        "SAML Assertion has an invalid IssueInstant",
      );
    },
  );

  test("refuses an assertion with no IssueInstant", () => {
    expectRefused(
      response({ rawIssueInstant: null }),
      "SAML Assertion has no IssueInstant",
    );
  });

  test("refuses an unreadable NotOnOrAfter rather than reading it as no limit", () => {
    expectRefused(
      response({
        rawConditions: `<saml:Conditions NotOnOrAfter="forever"><saml:AudienceRestriction><saml:Audience>${PROVIDER.entityId}</saml:Audience></saml:AudienceRestriction></saml:Conditions>`,
      }),
      "SAML Conditions has an invalid NotOnOrAfter",
    );
  });

  test("refuses an unreadable NotBefore", () => {
    expectRefused(
      response({
        rawConditions: `<saml:Conditions NotBefore="soon"><saml:AudienceRestriction><saml:Audience>${PROVIDER.entityId}</saml:Audience></saml:AudienceRestriction></saml:Conditions>`,
      }),
      "SAML Conditions has an invalid NotBefore",
    );
  });

  test("refuses an unreadable bearer confirmation NotOnOrAfter", () => {
    const closes: Date = minutesAfter(NOW, 4.5);

    const xml: string = signed(
      replaceOnce(
        unsignedResponse({ subjectNotOnOrAfter: closes }),
        `NotOnOrAfter="${closes.toISOString()}"`,
        'NotOnOrAfter="never"',
      ),
    );

    expectRefused(
      xml,
      "SAML SubjectConfirmationData has an invalid NotOnOrAfter",
    );
  });

  /*
   * The IssueInstant is read with a regular expression. The value is the
   * identity provider's, but the pattern must take time in line with its
   * input whatever the input is.
   */
  test("reads a 400,000-character time in well under two seconds", () => {
    const longValue: string = `2026-03-01T11:59:00.${"1".repeat(400000)}Z`;
    const timed: FastestRun<void> = fastestRun({
      run: (): void => {
        expectRefused(
          response({ rawIssueInstant: longValue }),
          "SAML Assertion has an invalid IssueInstant",
        );
      },
      limitInMs: 2000,
    });

    expect(timed.inMs).toBeLessThan(2000);
  });
});

describe("the assertion's ID", () => {
  test("is what the response is remembered by", () => {
    expect(verify(response({ assertionId: "_abc123" })).assertionId).toBe(
      "_abc123",
    );
  });

  test("is required", () => {
    // Signed over the Response, so the assertion keeps having no ID.
    const xml: string = signElement(
      unsignedResponse({ assertionId: null }),
      "Response",
      idpKeys.privateKey,
    );

    expectRefused(xml, "SAML Assertion has no ID");
  });
});

describe("which answer comes first", () => {
  /*
   * An admin testing a provider whose identity provider has the wrong
   * Entity ID hears about the Entity ID, not about a clock.
   */
  test("a response for another application that has also expired is refused as being for another application", () => {
    expectRefused(
      response({
        issuedAt: minutesAfter(NOW, -120),
        audienceRestrictions: [["https://acme.chat.example.net"]],
      }),
      SAML_AUDIENCE_MISMATCH_MESSAGE,
    );
  });

  test("the audience is checked before the recipient", () => {
    expectRefused(
      response({
        audienceRestrictions: [[OTHER_PROVIDER.entityId]],
        recipient: OTHER_PROVIDER.replyUrl,
      }),
      SAML_AUDIENCE_MISMATCH_MESSAGE,
    );
  });

  test("a signature that does not verify is refused for its signature before anything it says is read", () => {
    const other: SamlKeyPair = generateRsaKeyPair();
    const xml: string = signElement(
      buildSamlResponse({
        issuer: ISSUER,
        email: EMAIL,
        issuedAt: minutesAfter(NOW, -120),
        audienceRestrictions: [["https://acme.chat.example.net"]],
        recipient: "https://acme.chat.example.net/sso/saml",
      }),
      "Assertion",
      other.privateKey,
    );

    expectRefused(
      xml,
      "Signature is not valid or Public Certificate configured with this SSO provider is not valid",
    );
  });
});
