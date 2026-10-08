import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import {
  ENTERPRISE_LICENSE_GRACE_PERIOD_IN_DAYS,
  ENTERPRISE_LICENSE_TRIAL_PERIOD_IN_DAYS,
} from "Common/Server/Enterprise/EnterpriseLicenseSnapshot";
import { setTestBillingEnabled } from "Common/Tests/Server/Enterprise/TestBillingFlag";
import licenseProvider from "../../../Server/License/LicenseProvider";
import {
  classifyLicenseToken,
  LicenseTokenClassification,
} from "../../../Server/License/LicenseToken";
import { TrustedLicenseKey } from "../../../Server/License/TrustedLicenseKeys";
import {
  isWhiteLabelAllowed,
  isWhiteLabelAllowedFor,
} from "../../../Server/WhiteLabel/WhiteLabelEntitlement";
import {
  DAY_IN_MS,
  generateEd25519,
  KeyPair,
  legacyToken,
  signLicense,
  trustedEntryFor,
} from "../License/Helpers/LicenseTestKit";

/*
 * Whether an installation may white-label itself, in every license state an
 * installation can be in. Allowed only with a verified license that is
 * usable (valid, or expired inside its grace period) and carries the
 * canBeWhiteLabelled claim - and never on OneUptime Cloud. Everything else,
 * including every unknown state, is no.
 */

jest.mock("Common/Server/EnvironmentConfig", () => {
  const billingFlag: typeof import("Common/Tests/Server/Enterprise/TestBillingFlag") =
    jest.requireActual(
      "Common/Tests/Server/Enterprise/TestBillingFlag",
    ) as typeof import("Common/Tests/Server/Enterprise/TestBillingFlag");

  return billingFlag.withLiveBillingFlag(
    jest.requireActual("Common/Server/EnvironmentConfig") as Record<
      string,
      unknown
    >,
  );
});

const SIGNING_KEY: KeyPair = generateEd25519();
const UNKNOWN_KEY: KeyPair = generateEd25519();
const TRUSTED: ReadonlyArray<TrustedLicenseKey> = [trustedEntryFor(SIGNING_KEY)];
const INSTANCE_ID: string = "0b6d8f7e-1c2a-4e3b-9d4f-5a6b7c8d9e0f";

const classify: (
  token: string | null,
  options?: { firstSeenDaysAgo?: number; storedExpiryDays?: number | null },
) => LicenseTokenClassification = (
  token: string | null,
  options?: { firstSeenDaysAgo?: number; storedExpiryDays?: number | null },
): LicenseTokenClassification => {
  const storedExpiryDays: number | null =
    options?.storedExpiryDays === undefined ? 100 : options.storedExpiryDays;

  return classifyLicenseToken({
    token,
    storedColumns: {
      expiresAt:
        storedExpiryDays === null
          ? null
          : new Date(Date.now() + storedExpiryDays * DAY_IN_MS),
      companyName: "Acme Reseller Inc",
      userLimit: 50,
      isEvaluation: false,
      enterpriseEditionFirstSeenAt: new Date(
        Date.now() - (options?.firstSeenDaysAgo ?? 1) * DAY_IN_MS,
      ),
    },
    now: new Date(),
    trustedKeys: TRUSTED,
    localInstanceId: INSTANCE_ID,
    graceDays: ENTERPRISE_LICENSE_GRACE_PERIOD_IN_DAYS,
    trialDays: ENTERPRISE_LICENSE_TRIAL_PERIOD_IN_DAYS,
    acceptUnverified: true,
  });
};

interface LicenseStateCase {
  label: string;
  classification: () => LicenseTokenClassification | null;
  isAllowed: boolean;
}

const LICENSE_STATES: Array<LicenseStateCase> = [
  {
    label: "a valid signed license with the switch",
    classification: () => {
      return classify(signLicense(SIGNING_KEY, { canBeWhiteLabelled: true }));
    },
    isAllowed: true,
  },
  {
    label: "a signed license with the switch, expired 5 days ago (grace)",
    classification: () => {
      return classify(
        signLicense(SIGNING_KEY, {
          canBeWhiteLabelled: true,
          daysFromNow: -5,
        }),
      );
    },
    isAllowed: true,
  },
  {
    label: "an evaluation license with the switch",
    classification: () => {
      return classify(
        signLicense(SIGNING_KEY, {
          canBeWhiteLabelled: true,
          isEvaluation: true,
        }),
      );
    },
    isAllowed: true,
  },
  {
    label: "an offline token with the switch, bound to this instance",
    classification: () => {
      return classify(
        signLicense(SIGNING_KEY, {
          canBeWhiteLabelled: true,
          instanceId: INSTANCE_ID,
        }),
      );
    },
    isAllowed: true,
  },
  {
    label: "a valid signed license without the switch",
    classification: () => {
      return classify(signLicense(SIGNING_KEY));
    },
    isAllowed: false,
  },
  {
    label: "a signed license with the switch, expired past its grace period",
    classification: () => {
      return classify(
        signLicense(SIGNING_KEY, {
          canBeWhiteLabelled: true,
          daysFromNow: -(ENTERPRISE_LICENSE_GRACE_PERIOD_IN_DAYS + 5),
        }),
      );
    },
    isAllowed: false,
  },
  {
    label: "a token with the switch bound to another instance",
    classification: () => {
      return classify(
        signLicense(SIGNING_KEY, {
          canBeWhiteLabelled: true,
          instanceId: "11111111-2222-4333-8444-555555555555",
        }),
      );
    },
    isAllowed: false,
  },
  {
    label: "a token with the switch signed by a key this build does not trust",
    classification: () => {
      return classify(signLicense(UNKNOWN_KEY, { canBeWhiteLabelled: true }));
    },
    isAllowed: false,
  },
  {
    label: "an unverified legacy license",
    classification: () => {
      return classify(legacyToken());
    },
    isAllowed: false,
  },
  {
    label: "no license, inside the trial",
    classification: () => {
      return classify(null);
    },
    isAllowed: false,
  },
  {
    label: "no license, after the trial",
    classification: () => {
      return classify(null, {
        firstSeenDaysAgo: ENTERPRISE_LICENSE_TRIAL_PERIOD_IN_DAYS + 5,
      });
    },
    isAllowed: false,
  },
  {
    label: "a malformed token",
    classification: () => {
      return classify("not-a-license");
    },
    isAllowed: false,
  },
  {
    label: "a license not read yet",
    classification: () => {
      return null;
    },
    isAllowed: false,
  },
];

afterEach(() => {
  setTestBillingEnabled(false);
  jest.restoreAllMocks();
});

describe("isWhiteLabelAllowedFor, self-hosted (billing off)", () => {
  test.each(LICENSE_STATES.map((state: LicenseStateCase) => [state.label, state]))(
    "%s",
    (_label: string, state: LicenseStateCase) => {
      expect(
        isWhiteLabelAllowedFor({
          classification: state.classification(),
          isBillingEnabled: false,
        }),
      ).toBe(state.isAllowed);
    },
  );
});

describe("isWhiteLabelAllowedFor on OneUptime Cloud (billing on)", () => {
  test.each(LICENSE_STATES.map((state: LicenseStateCase) => [state.label, state]))(
    "%s: never",
    (_label: string, state: LicenseStateCase) => {
      expect(
        isWhiteLabelAllowedFor({
          classification: state.classification(),
          isBillingEnabled: true,
        }),
      ).toBe(false);
    },
  );
});

describe("isWhiteLabelAllowed: this process's license", () => {
  beforeEach(() => {
    setTestBillingEnabled(false);
  });

  test("asks the license provider's cached classification", () => {
    const spy: ReturnType<typeof jest.spyOn> = jest
      .spyOn(licenseProvider, "getCachedClassification")
      .mockReturnValue(
        classify(signLicense(SIGNING_KEY, { canBeWhiteLabelled: true })),
      );

    expect(isWhiteLabelAllowed()).toBe(true);
    expect(spy).toHaveBeenCalled();
  });

  test("follows the license the moment it changes: the switch removed", () => {
    const spy: ReturnType<typeof jest.spyOn> = jest
      .spyOn(licenseProvider, "getCachedClassification")
      .mockReturnValue(
        classify(signLicense(SIGNING_KEY, { canBeWhiteLabelled: true })),
      );

    expect(isWhiteLabelAllowed()).toBe(true);

    spy.mockReturnValue(classify(signLicense(SIGNING_KEY)));

    expect(isWhiteLabelAllowed()).toBe(false);
  });

  test("is no on OneUptime Cloud whatever the license says", () => {
    setTestBillingEnabled(true);

    jest
      .spyOn(licenseProvider, "getCachedClassification")
      .mockReturnValue(
        classify(signLicense(SIGNING_KEY, { canBeWhiteLabelled: true })),
      );

    expect(isWhiteLabelAllowed()).toBe(false);
  });

  test("is no, never an error, when the license cannot be read", () => {
    jest
      .spyOn(licenseProvider, "getCachedClassification")
      .mockImplementation(() => {
        throw new Error("the license cannot be read");
      });

    expect(isWhiteLabelAllowed()).toBe(false);
  });
});
