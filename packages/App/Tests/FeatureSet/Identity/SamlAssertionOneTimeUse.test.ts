import SamlAssertionOneTimeUse, {
  SAML_RESPONSE_ALREADY_USED_MESSAGE,
  SAML_SIGN_IN_UNAVAILABLE_MESSAGE,
  SamlProviderKind,
} from "../../../FeatureSet/Identity/Utils/SamlAssertionOneTimeUse";
import { VerifiedSamlResponse } from "../../../FeatureSet/Identity/Utils/SSO";
import GlobalCache from "Common/Server/Infrastructure/GlobalCache";
import Email from "Common/Types/Email";
import BadRequestException from "Common/Types/Exception/BadRequestException";
import ServiceUnavailableException from "Common/Types/Exception/ServiceUnavailableException";
import ObjectID from "Common/Types/ObjectID";
import { beforeEach, describe, expect, test } from "@jest/globals";
import crypto from "crypto";

/*
 * The step that makes a SAML response good for one sign-in: the assertion's
 * ID is claimed in the cache shared by every app server (Redis SET NX), for
 * as long as the assertion could still be accepted, and a second claim is
 * refused. The real Redis command is exercised in
 * SamlAssertionOneTimeUseValkey.test.ts; here the cache is a stand-in, so
 * what is asked of it can be read exactly.
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

const PROVIDER_ID: string = "22222222-2222-4222-8222-222222222222";
const NOW: Date = new Date("2026-03-01T12:00:00.000Z");

function assertion(
  overrides: Partial<VerifiedSamlResponse> = {},
): VerifiedSamlResponse {
  return {
    issuerUrl: "https://idp.example.com",
    email: new Email("walter.skinner@example.com"),
    name: null,
    assertionId: "_assertion_1",
    acceptableUntil: new Date(NOW.getTime() + 7 * 60 * 1000),
    ...overrides,
  };
}

function sha256(value: string): string {
  return crypto.createHash("sha256").update(value, "utf8").digest("hex");
}

beforeEach(() => {
  jest.clearAllMocks();
  setStringIfNotExists.mockResolvedValue(true);
});

describe("claiming an assertion", () => {
  test("its first use goes through", async () => {
    await expect(
      SamlAssertionOneTimeUse.claim({
        providerKind: SamlProviderKind.ProjectSso,
        providerId: PROVIDER_ID,
        assertion: assertion(),
        now: NOW,
      }),
    ).resolves.toBeUndefined();
  });

  test("records it under this provider, by a hash of its ID, until it could no longer be accepted - plus a margin for clocks", async () => {
    await SamlAssertionOneTimeUse.claim({
      providerKind: SamlProviderKind.ProjectSso,
      providerId: PROVIDER_ID,
      assertion: assertion(),
      now: NOW,
    });

    expect(setStringIfNotExists).toHaveBeenCalledTimes(1);
    expect(setStringIfNotExists).toHaveBeenCalledWith(
      "saml-assertion-used",
      `project-sso:${PROVIDER_ID}:${sha256("_assertion_1")}`,
      NOW.toISOString(),
      {
        expiresInSeconds:
          7 * 60 + SamlAssertionOneTimeUse.CLOCK_MARGIN_IN_SECONDS,
      },
    );
  });

  test("rounds a part of a second up, so the record never ends before the assertion does", async () => {
    await SamlAssertionOneTimeUse.claim({
      providerKind: SamlProviderKind.GlobalSso,
      providerId: PROVIDER_ID,
      assertion: assertion({
        acceptableUntil: new Date(NOW.getTime() + 1001),
      }),
      now: NOW,
    });

    expect(
      (setStringIfNotExists.mock.calls[0]![3] as { expiresInSeconds: number })
        .expiresInSeconds,
    ).toBe(2 + SamlAssertionOneTimeUse.CLOCK_MARGIN_IN_SECONDS);
  });

  test("keeps a record of an assertion whose time is already up for the margin, never for no time at all", async () => {
    await SamlAssertionOneTimeUse.claim({
      providerKind: SamlProviderKind.StatusPageSso,
      providerId: PROVIDER_ID,
      assertion: assertion({
        acceptableUntil: new Date(NOW.getTime() - 60 * 60 * 1000),
      }),
      now: NOW,
    });

    expect(
      (setStringIfNotExists.mock.calls[0]![3] as { expiresInSeconds: number })
        .expiresInSeconds,
    ).toBe(SamlAssertionOneTimeUse.CLOCK_MARGIN_IN_SECONDS);
  });

  test("uses the current time when none is given", async () => {
    const before: number = Date.now();

    await SamlAssertionOneTimeUse.claim({
      providerKind: SamlProviderKind.ProjectSso,
      providerId: PROVIDER_ID,
      assertion: assertion({
        acceptableUntil: new Date(Date.now() + 60 * 1000),
      }),
    });

    const recordedAt: number = Date.parse(
      setStringIfNotExists.mock.calls[0]![2] as string,
    );

    expect(recordedAt).toBeGreaterThanOrEqual(before);
    expect(recordedAt).toBeLessThanOrEqual(Date.now());
  });

  test("a second use is refused, as a bad request that says what to do", async () => {
    setStringIfNotExists.mockResolvedValue(false);

    let refusal: unknown = null;

    try {
      await SamlAssertionOneTimeUse.claim({
        providerKind: SamlProviderKind.ProjectSso,
        providerId: PROVIDER_ID,
        assertion: assertion(),
        now: NOW,
      });
    } catch (err) {
      refusal = err;
    }

    expect(refusal).toBeInstanceOf(BadRequestException);
    expect((refusal as BadRequestException).message).toBe(
      SAML_RESPONSE_ALREADY_USED_MESSAGE,
    );
    expect((refusal as BadRequestException).code).toBe(400);
  });

  /*
   * Letting a response through because its use could not be recorded would
   * turn the check off whenever the cache is down.
   */
  test("when the cache cannot be reached, nobody is signed in: 503", async () => {
    setStringIfNotExists.mockRejectedValue(new Error("Cache is not connected"));

    let refusal: unknown = null;

    try {
      await SamlAssertionOneTimeUse.claim({
        providerKind: SamlProviderKind.ProjectSso,
        providerId: PROVIDER_ID,
        assertion: assertion(),
        now: NOW,
      });
    } catch (err) {
      refusal = err;
    }

    expect(refusal).toBeInstanceOf(ServiceUnavailableException);
    expect((refusal as ServiceUnavailableException).message).toBe(
      SAML_SIGN_IN_UNAVAILABLE_MESSAGE,
    );
    expect((refusal as ServiceUnavailableException).code).toBe(503);
  });
});

describe("where a use is recorded", () => {
  function keyFor(data: {
    providerKind: SamlProviderKind;
    providerId: ObjectID | string;
    assertionId: string;
  }): string {
    return SamlAssertionOneTimeUse.getCacheKey(data);
  }

  test("each provider keeps its own record, so one provider's identity provider cannot use up IDs another's will send", () => {
    const keys: Set<string> = new Set([
      keyFor({
        providerKind: SamlProviderKind.ProjectSso,
        providerId: PROVIDER_ID,
        assertionId: "_same",
      }),
      keyFor({
        providerKind: SamlProviderKind.ProjectSso,
        providerId: "33333333-3333-4333-8333-333333333333",
        assertionId: "_same",
      }),
      keyFor({
        providerKind: SamlProviderKind.StatusPageSso,
        providerId: PROVIDER_ID,
        assertionId: "_same",
      }),
      keyFor({
        providerKind: SamlProviderKind.GlobalSso,
        providerId: PROVIDER_ID,
        assertionId: "_same",
      }),
    ]);

    expect(keys.size).toBe(4);
  });

  test("the provider's id is the same however it is written", () => {
    expect(
      keyFor({
        providerKind: SamlProviderKind.ProjectSso,
        providerId: PROVIDER_ID.toUpperCase(),
        assertionId: "_a",
      }),
    ).toBe(
      keyFor({
        providerKind: SamlProviderKind.ProjectSso,
        providerId: new ObjectID(PROVIDER_ID),
        assertionId: "_a",
      }),
    );
  });

  test("the assertion's ID is kept only as a hash, whatever its length or characters", () => {
    const assertionId: string = `_${"x".repeat(10000)}:with:colons\n`;
    const key: string = keyFor({
      providerKind: SamlProviderKind.ProjectSso,
      providerId: PROVIDER_ID,
      assertionId,
    });

    expect(key).toBe(`project-sso:${PROVIDER_ID}:${sha256(assertionId)}`);
    expect(key).not.toContain("xxxx");
    expect(key.length).toBeLessThan(150);
  });

  test("assertion IDs that differ only in case are different assertions", () => {
    expect(
      keyFor({
        providerKind: SamlProviderKind.ProjectSso,
        providerId: PROVIDER_ID,
        assertionId: "_ABC",
      }),
    ).not.toBe(
      keyFor({
        providerKind: SamlProviderKind.ProjectSso,
        providerId: PROVIDER_ID,
        assertionId: "_abc",
      }),
    );
  });
});
