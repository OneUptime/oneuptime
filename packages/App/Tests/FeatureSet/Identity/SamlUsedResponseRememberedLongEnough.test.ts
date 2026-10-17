import SSOUtil, {
  VerifiedSamlResponse,
} from "../../../FeatureSet/Identity/Utils/SSO";
import SamlAssertionOneTimeUse, {
  SamlProviderKind,
} from "../../../FeatureSet/Identity/Utils/SamlAssertionOneTimeUse";
import { SamlServiceProvider } from "../../../FeatureSet/Identity/Utils/SamlServiceProvider";
import {
  SamlKeyPair,
  SamlResponseOptions,
  buildSamlResponse,
  generateRsaKeyPair,
  minutesAfter,
  signElement,
} from "./SamlTestKit";
import GlobalCache from "Common/Server/Infrastructure/GlobalCache";
import { beforeAll, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * ---------------------------------------------------------------------------
 * A USED SAML RESPONSE IS REMEMBERED FOR AS LONG AS ANY APP SERVER WOULD
 * TAKE IT.
 *
 * Once a response has signed someone in, two things keep it from signing
 * anyone in again: the record of its use (SamlAssertionOneTimeUse.claim) and
 * its time (rule 12 of SSOUtil.getSamlResponseFromXML). The cache drops the
 * record when its time there is up, so by then the time rules must already
 * refuse the response - on every app server, including one whose clock runs
 * up to three minutes behind the server that recorded the use. Otherwise
 * there is a stretch in which the response is neither remembered nor too
 * old, and it signs its holder in again.
 *
 * SamlAssertionOneTimeUse.test.ts pins how long a record is kept for a given
 * `acceptableUntil`, and SamlResponseConditions.test.ts when a response is
 * accepted. This suite holds the two together: the real verification says
 * when a response stops being acceptable, the real claim says how long it is
 * remembered, for the windows identity providers send and for a response
 * posted at any point of them.
 * ---------------------------------------------------------------------------
 */

jest.mock("Common/Server/Infrastructure/GlobalCache", () => {
  return {
    __esModule: true,
    default: {
      setStringIfNotExists: jest.fn(),
    },
  };
});

jest.mock("Common/Server/Utils/Logger", () => {
  return {
    __esModule: true,
    default: {
      error: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      debug: jest.fn(),
    },
  };
});

const setStringIfNotExists: jest.Mock =
  GlobalCache.setStringIfNotExists as unknown as jest.Mock;

const SERVER: string = "https://oneuptime.example.com";
const PROJECT_ID: string = "44444444-4444-4444-8444-444444444444";
const PROVIDER_ID: string = "55555555-5555-4555-8555-555555555555";

const PROVIDER: SamlServiceProvider = {
  entityId: `${SERVER}/${PROJECT_ID}/${PROVIDER_ID}`,
  replyUrl: `${SERVER}/identity/idp-login/${PROJECT_ID}/${PROVIDER_ID}`,
  serverAddress: SERVER,
};

const ISSUED_AT: Date = new Date("2026-04-01T09:00:00.000Z");

const MINUTE_IN_MS: number = 60 * 1000;

/*
 * How far behind the recording server another app server's clock may run,
 * written out rather than read from the class, so that shortening the margin
 * fails here.
 */
const CLOCKS_BEHIND_BY_MS: number = 3 * MINUTE_IN_MS;

let idpKeys: SamlKeyPair;

beforeAll(() => {
  idpKeys = generateRsaKeyPair();
});

beforeEach(() => {
  jest.clearAllMocks();
  setStringIfNotExists.mockResolvedValue(true);
});

interface ResponseShape {
  name: string;
  options: Partial<SamlResponseOptions>;
}

// The windows identity providers put on a response, issued at ISSUED_AT.
const SHAPES: Array<ResponseShape> = [
  {
    name: "five-minute windows (Okta, OneLogin, Shibboleth)",
    options: {},
  },
  {
    name: "an hour of Conditions and a five-minute confirmation (Entra ID, AD FS)",
    options: {
      conditionsNotOnOrAfter: minutesAfter(ISSUED_AT, 60),
      subjectNotOnOrAfter: minutesAfter(ISSUED_AT, 5),
    },
  },
  {
    name: "one-minute windows (a short Keycloak lifespan)",
    options: {
      conditionsNotOnOrAfter: minutesAfter(ISSUED_AT, 1),
      subjectNotOnOrAfter: minutesAfter(ISSUED_AT, 1),
    },
  },
  {
    name: "no window at all, only the moment it was issued",
    options: {
      conditionsNotBefore: null,
      conditionsNotOnOrAfter: null,
      subjectNotOnOrAfter: null,
    },
  },
  {
    name: "a confirmation good for a day",
    options: {
      conditionsNotOnOrAfter: null,
      subjectNotOnOrAfter: minutesAfter(ISSUED_AT, 24 * 60),
    },
  },
  {
    name: "two confirmations for this provider, closing two and eight minutes after issue",
    options: {
      subjectConfirmations: [
        {
          data: {
            recipient: PROVIDER.replyUrl,
            notOnOrAfter: minutesAfter(ISSUED_AT, 2),
          },
        },
        {
          data: {
            recipient: PROVIDER.replyUrl,
            notOnOrAfter: minutesAfter(ISSUED_AT, 8),
          },
        },
      ],
    },
  },
];

// When the response is posted, in minutes after ISSUED_AT.
const POSTED: Array<[string, number]> = [
  [
    "two minutes before it was issued, by an identity provider whose clock runs ahead",
    -2,
  ],
  ["as it is issued", 0],
  ["half a minute after it was issued", 0.5],
  ["a minute after it was issued", 1],
  ["four minutes after it was issued", 4],
  // Leaves part of a second over, which the record must round up, not down.
  ["four minutes and a quarter of a second after it was issued", 4 + 0.25 / 60],
  ["seven minutes after it was issued", 7],
  ["nine and a half minutes after it was issued", 9.5],
];

function signedResponse(shape: ResponseShape): string {
  return signElement(
    buildSamlResponse({
      issuer: "https://idp.example.com/realms/acme",
      email: "monica.reyes@example.com",
      issuedAt: ISSUED_AT,
      assertionId: "_assertion_remembered",
      audienceRestrictions: [[PROVIDER.entityId]],
      recipient: PROVIDER.replyUrl,
      destination: PROVIDER.replyUrl,
      ...shape.options,
    }),
    "Assertion",
    idpKeys.privateKey,
  );
}

function verifyAt(xml: string, now: number): VerifiedSamlResponse {
  return SSOUtil.getSamlResponseFromXML(
    xml,
    idpKeys.publicKey,
    PROVIDER,
    new Date(now),
  );
}

function isAcceptedAt(xml: string, now: number): boolean {
  try {
    verifyAt(xml, now);
    return true;
  } catch {
    return false;
  }
}

// How long, in ms, the claim made at `now` keeps the record.
async function rememberedForMs(
  assertion: VerifiedSamlResponse,
  now: number,
): Promise<number> {
  setStringIfNotExists.mockClear();

  await SamlAssertionOneTimeUse.claim({
    providerKind: SamlProviderKind.ProjectSso,
    providerId: PROVIDER_ID,
    assertion,
    now: new Date(now),
  });

  expect(setStringIfNotExists).toHaveBeenCalledTimes(1);

  const options: { expiresInSeconds: number } = setStringIfNotExists.mock
    .calls[0]![3] as { expiresInSeconds: number };

  return options.expiresInSeconds * 1000;
}

describe.each(SHAPES)("a response with $name", (shape: ResponseShape) => {
  const xml: () => string = (): string => {
    return signedResponse(shape);
  };

  test("is accepted when it is posted right away", () => {
    expect(isAcceptedAt(xml(), ISSUED_AT.getTime())).toBe(true);
  });

  test("says exactly when it stops being accepted: a millisecond before is still in, that moment is out", () => {
    const document: string = xml();
    const acceptableUntil: number = verifyAt(
      document,
      ISSUED_AT.getTime(),
    ).acceptableUntil.getTime();

    expect(isAcceptedAt(document, acceptableUntil - 1)).toBe(true);
    expect(isAcceptedAt(document, acceptableUntil)).toBe(false);
  });

  test.each(POSTED)(
    "posted %s, it is remembered until no app server would take it",
    async (_when: string, postedMinutesAfterIssue: number) => {
      const document: string = xml();
      const postedAt: number =
        ISSUED_AT.getTime() + postedMinutesAfterIssue * MINUTE_IN_MS;

      if (!isAcceptedAt(document, postedAt)) {
        // Refused when posted, so there is nothing to remember.
        expect(() => {
          return verifyAt(document, postedAt);
        }).toThrow();
        return;
      }

      const assertion: VerifiedSamlResponse = verifyAt(document, postedAt);
      const recordGoneAt: number =
        postedAt + (await rememberedForMs(assertion, postedAt));

      /*
       * When the cache drops the record, a server whose clock agrees with
       * the one that recorded the use refuses the response, and so does one
       * whose clock runs as far behind as the margin allows.
       */
      expect(isAcceptedAt(document, recordGoneAt)).toBe(false);
      expect(isAcceptedAt(document, recordGoneAt - CLOCKS_BEHIND_BY_MS)).toBe(
        false,
      );

      // And the record is dropped no later than the margin requires.
      expect(recordGoneAt).toBeLessThanOrEqual(
        assertion.acceptableUntil.getTime() + CLOCKS_BEHIND_BY_MS + 1000,
      );
    },
  );
});

describe("the windows above", () => {
  test("include responses that are refused when posted late, so both outcomes are exercised", () => {
    const late: number = ISSUED_AT.getTime() + 9.5 * MINUTE_IN_MS;

    const refusedLate: Array<string> = SHAPES.filter(
      (shape: ResponseShape): boolean => {
        return !isAcceptedAt(signedResponse(shape), late);
      },
    ).map((shape: ResponseShape): string => {
      return shape.name;
    });

    const acceptedLate: Array<string> = SHAPES.filter(
      (shape: ResponseShape): boolean => {
        return isAcceptedAt(signedResponse(shape), late);
      },
    ).map((shape: ResponseShape): string => {
      return shape.name;
    });

    expect(refusedLate.length).toBeGreaterThan(0);
    expect(acceptedLate.length).toBeGreaterThan(0);
  });
});
