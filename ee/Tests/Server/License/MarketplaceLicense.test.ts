import MarketplaceLicense, {
  MARKETPLACE_LICENSE_RENEWAL_IN_MS,
  getConfiguredMarketplace,
} from "../../../Server/License/MarketplaceLicense";
import LicenseInputsUtil, {
  LicenseInputs,
} from "../../../Server/License/LicenseInputs";
import { LicenseTokenClassification } from "../../../Server/License/LicenseToken";
import { setTrustedLicenseKeysForTests } from "../../../Server/License/TrustedLicenseKeys";
import {
  ENTERPRISE_LICENSE_GRACE_PERIOD_IN_DAYS,
  EnterpriseLicenseSnapshot,
} from "Common/Server/Enterprise/EnterpriseLicenseSnapshot";
import GlobalConfig from "Common/Models/DatabaseModels/GlobalConfig";
import EnterpriseMarketplaceBillingUtil, {
  EnterpriseMarketplaceBillingState,
} from "Common/Types/EnterpriseLicense/EnterpriseMarketplaceBilling";
import CloudMarketplace from "Common/Types/Marketplace/CloudMarketplace";
import {
  DAY_IN_MS,
  generateEd25519,
  KeyPair,
  signLicense,
  trustedEntryFor,
} from "./Helpers/LicenseTestKit";
import { afterEach, describe, expect, it } from "@jest/globals";

/*
 * A self-hosted installation bought on a cloud marketplace is licensed by
 * that marketplace accepting its hourly usage reports - never by its own
 * configuration. These pin when that license is valid, in grace or over, and
 * that it only ever adds to a license key.
 */

const NOW: Date = new Date("2026-10-17T12:00:00.000Z");
const HOUR_IN_MS: number = 60 * 60 * 1000;
const GRACE_DAYS: number = ENTERPRISE_LICENSE_GRACE_PERIOD_IN_DAYS;
const INSTANCE_ID: string = "5f8b7c6d5e4f3a2b1c0d9e8f";
const SIGNING_KEY: KeyPair = generateEd25519();

const billing: (
  overrides?: Partial<EnterpriseMarketplaceBillingState>,
) => EnterpriseMarketplaceBillingState = (
  overrides?: Partial<EnterpriseMarketplaceBillingState>,
): EnterpriseMarketplaceBillingState => {
  return {
    ...EnterpriseMarketplaceBillingUtil.createEmpty(CloudMarketplace.AWS),
    ...(overrides || {}),
  };
};

const hoursBefore: (hours: number) => string = (hours: number): string => {
  return new Date(NOW.getTime() - hours * HOUR_IN_MS).toISOString();
};

const classify: (
  state: EnterpriseMarketplaceBillingState | null,
  configured?: CloudMarketplace | null,
  now?: Date,
) => LicenseTokenClassification | null = (
  state: EnterpriseMarketplaceBillingState | null,
  configured?: CloudMarketplace | null,
  now?: Date,
): LicenseTokenClassification | null => {
  return MarketplaceLicense.classify({
    state,
    configuredMarketplace:
      configured === undefined ? CloudMarketplace.AWS : configured,
    now: now || NOW,
    graceDays: GRACE_DAYS,
  });
};

afterEach(() => {
  setTrustedLicenseKeysForTests(null);
});

describe("MarketplaceLicense.classify", () => {
  it("is valid for 72 hours after the marketplace last accepted a report, with every feature and no seat limit", () => {
    const verifiedAt: string = hoursBefore(1);
    const license: LicenseTokenClassification = classify(
      billing({ verifiedAt }),
    )!;

    expect(license.status).toBe("valid");
    expect(license.features).toBe("all");
    expect(license.userLimit).toBeNull();
    expect(license.isEvaluation).toBe(false);
    expect(license.verification).toBe("none");
    expect(license.marketplace).toBe(CloudMarketplace.AWS);
    expect(license.reason).toBe("marketplace");
    expect(license.expiresAt).toEqual(
      new Date(new Date(verifiedAt).getTime() + MARKETPLACE_LICENSE_RENEWAL_IN_MS),
    );
    expect(license.message).toContain("Licensed through AWS Marketplace");
  });

  it("goes into the usual grace period when reports stop being accepted, and names when it ends", () => {
    const verifiedAt: string = hoursBefore(73);
    const license: LicenseTokenClassification = classify(
      billing({ verifiedAt }),
    )!;

    expect(license.status).toBe("grace");
    expect(license.graceReason).toBe("expired");
    expect(license.features).toBe("all");
    expect(license.graceEndsAt).toEqual(
      new Date(
        new Date(verifiedAt).getTime() +
          MARKETPLACE_LICENSE_RENEWAL_IN_MS +
          GRACE_DAYS * DAY_IN_MS,
      ),
    );
    expect(license.message).toContain("has not accepted");
  });

  it("is over once the grace period is", () => {
    const verifiedAt: string = new Date(
      NOW.getTime() -
        MARKETPLACE_LICENSE_RENEWAL_IN_MS -
        GRACE_DAYS * DAY_IN_MS -
        1,
    ).toISOString();
    const license: LicenseTokenClassification = classify(
      billing({ verifiedAt }),
    )!;

    expect(license.status).toBe("expired");
    expect(license.features).toEqual([]);
  });

  it("puts the boundaries exactly where they belong", () => {
    const verifiedAt: Date = new Date("2026-10-10T00:00:00.000Z");
    const expiresAt: Date = new Date(
      verifiedAt.getTime() + MARKETPLACE_LICENSE_RENEWAL_IN_MS,
    );
    const graceEndsAt: Date = new Date(expiresAt.getTime() + GRACE_DAYS * DAY_IN_MS);
    const state: EnterpriseMarketplaceBillingState = billing({
      verifiedAt: verifiedAt.toISOString(),
    });

    expect(
      classify(state, CloudMarketplace.AWS, new Date(expiresAt.getTime() - 1))!
        .status,
    ).toBe("valid");
    expect(classify(state, CloudMarketplace.AWS, expiresAt)!.status).toBe(
      "grace",
    );
    expect(classify(state, CloudMarketplace.AWS, graceEndsAt)!.status).toBe(
      "grace",
    );
    expect(
      classify(state, CloudMarketplace.AWS, new Date(graceEndsAt.getTime() + 1))!
        .status,
    ).toBe("expired");
  });

  it("ends at once when the marketplace's latest word is that the buyer is not subscribed", () => {
    const license: LicenseTokenClassification = classify(
      billing({
        verifiedAt: hoursBefore(2),
        refusedAt: hoursBefore(1),
        refusal: "CustomerNotEntitledException",
      }),
    )!;

    expect(license.status).toBe("expired");
    expect(license.reason).toBe("marketplace-refused");
    expect(license.features).toEqual([]);
    expect(license.message).toContain("not subscribed");
    expect(license.message).toContain("CustomerNotEntitledException");
  });

  it("comes back when the marketplace accepts a report after refusing", () => {
    expect(
      classify(
        billing({ refusedAt: hoursBefore(2), verifiedAt: hoursBefore(1) }),
      )!.status,
    ).toBe("valid");
  });

  it("is refused outright when the marketplace never accepted anything and said no", () => {
    expect(classify(billing({ refusedAt: hoursBefore(1) }))!.status).toBe(
      "expired",
    );
  });

  it("is nothing at all until the marketplace has answered", () => {
    expect(classify(billing())).toBeNull();
  });

  it("is nothing on an installation that names no marketplace, whatever an earlier run recorded", () => {
    expect(classify(billing({ verifiedAt: hoursBefore(1) }), null)).toBeNull();
  });

  it("is nothing when the record is another marketplace's", () => {
    expect(
      classify(
        billing({ verifiedAt: hoursBefore(1) }),
        CloudMarketplace.GoogleCloud,
      ),
    ).toBeNull();
  });

  it("is nothing without a record", () => {
    expect(classify(null)).toBeNull();
  });

  it("names each marketplace by its own name", () => {
    for (const [marketplace, name] of [
      [CloudMarketplace.AWS, "AWS Marketplace"],
      [CloudMarketplace.Azure, "Microsoft Marketplace"],
      [CloudMarketplace.GoogleCloud, "Google Cloud Marketplace"],
    ] as Array<[CloudMarketplace, string]>) {
      const license: LicenseTokenClassification = classify(
        {
          ...EnterpriseMarketplaceBillingUtil.createEmpty(marketplace),
          verifiedAt: hoursBefore(1),
        },
        marketplace,
      )!;

      expect(license.message).toContain(name);
    }
  });
});

describe("getConfiguredMarketplace", () => {
  it("reads ENTERPRISE_MARKETPLACE", () => {
    expect(getConfiguredMarketplace({ ENTERPRISE_MARKETPLACE: "aws" })).toBe(
      CloudMarketplace.AWS,
    );
    expect(
      getConfiguredMarketplace({ ENTERPRISE_MARKETPLACE: "google-cloud" }),
    ).toBe(CloudMarketplace.GoogleCloud);
    expect(getConfiguredMarketplace({ ENTERPRISE_MARKETPLACE: "" })).toBeNull();
    expect(getConfiguredMarketplace({})).toBeNull();
    expect(
      getConfiguredMarketplace({ ENTERPRISE_MARKETPLACE: "oracle" }),
    ).toBeNull();
  });
});

describe("the license the installation runs on", () => {
  const inputsWith: (
    overrides: Partial<LicenseInputs>,
  ) => LicenseInputs = (overrides: Partial<LicenseInputs>): LicenseInputs => {
    return {
      hasConfigRow: true,
      licenseKey: null,
      token: null,
      storedColumns: {
        expiresAt: null,
        companyName: null,
        userLimit: null,
        isEvaluation: false,
        // The unlicensed trial ended long ago.
        enterpriseEditionFirstSeenAt: new Date(NOW.getTime() - 90 * DAY_IN_MS),
      },
      instanceId: INSTANCE_ID,
      currentUserCount: null,
      instances: [],
      marketplaceBilling: null,
      ...overrides,
    };
  };

  const AWS_ENV: Record<string, string> = { ENTERPRISE_MARKETPLACE: "aws" };

  it("is the marketplace's when there is no license key", () => {
    const license: LicenseTokenClassification =
      LicenseInputsUtil.classifyWithMarketplace(
        inputsWith({ marketplaceBilling: billing({ verifiedAt: hoursBefore(1) }) }),
        NOW,
        AWS_ENV,
      );

    expect(license.status).toBe("valid");
    expect(license.marketplace).toBe(CloudMarketplace.AWS);

    const snapshot: EnterpriseLicenseSnapshot =
      LicenseInputsUtil.toSnapshot(license);
    expect(snapshot.marketplace).toBe(CloudMarketplace.AWS);
    expect(snapshot.userLimit).toBeNull();
  });

  it("beats the unlicensed trial", () => {
    const license: LicenseTokenClassification =
      LicenseInputsUtil.classifyWithMarketplace(
        inputsWith({
          storedColumns: {
            expiresAt: null,
            companyName: null,
            userLimit: null,
            isEvaluation: false,
            enterpriseEditionFirstSeenAt: new Date(NOW.getTime() - DAY_IN_MS),
          },
          marketplaceBilling: billing({ verifiedAt: hoursBefore(1) }),
        }),
        NOW,
        AWS_ENV,
      );

    expect(license.status).toBe("valid");
    expect(license.reason).toBe("marketplace");
  });

  it("never takes the trial away when the marketplace refuses", () => {
    const license: LicenseTokenClassification =
      LicenseInputsUtil.classifyWithMarketplace(
        inputsWith({
          storedColumns: {
            expiresAt: null,
            companyName: null,
            userLimit: null,
            isEvaluation: false,
            enterpriseEditionFirstSeenAt: new Date(NOW.getTime() - DAY_IN_MS),
          },
          marketplaceBilling: billing({ refusedAt: hoursBefore(1) }),
        }),
        NOW,
        AWS_ENV,
      );

    expect(license.status).toBe("grace");
    expect(license.graceReason).toBe("unlicensed");
  });

  it("never takes a valid license key away, and keeps the key's terms when both are valid", () => {
    setTrustedLicenseKeysForTests([trustedEntryFor(SIGNING_KEY)]);

    const token: string = signLicense(SIGNING_KEY, {
      exp: Math.floor((NOW.getTime() + 300 * DAY_IN_MS) / 1000),
      userLimit: 25,
      companyName: "Acme",
    });

    for (const marketplaceBilling of [
      billing({ refusedAt: hoursBefore(1) }),
      billing({ verifiedAt: hoursBefore(1) }),
    ]) {
      const license: LicenseTokenClassification =
        LicenseInputsUtil.classifyWithMarketplace(
          inputsWith({ token, marketplaceBilling }),
          NOW,
          AWS_ENV,
        );

      expect(license.status).toBe("valid");
      expect(license.verification).toBe("verified");
      expect(license.marketplace).toBeUndefined();
    }
  });

  it("is the marketplace's when the license key has lapsed", () => {
    setTrustedLicenseKeysForTests([trustedEntryFor(SIGNING_KEY)]);

    const token: string = signLicense(SIGNING_KEY, {
      exp: Math.floor((NOW.getTime() - 60 * DAY_IN_MS) / 1000),
    });

    const license: LicenseTokenClassification =
      LicenseInputsUtil.classifyWithMarketplace(
        inputsWith({
          token,
          marketplaceBilling: billing({ verifiedAt: hoursBefore(1) }),
        }),
        NOW,
        AWS_ENV,
      );

    expect(license.status).toBe("valid");
    expect(license.marketplace).toBe(CloudMarketplace.AWS);
  });

  it("ignores a recorded marketplace license when the installation names no marketplace", () => {
    const license: LicenseTokenClassification =
      LicenseInputsUtil.classifyWithMarketplace(
        inputsWith({
          marketplaceBilling: billing({ verifiedAt: hoursBefore(1) }),
        }),
        NOW,
        {},
      );

    expect(license.status).toBe("missing");
    expect(license.marketplace).toBeUndefined();
  });

  it("leaves the token-only classification the license client's guards use alone", () => {
    const license: LicenseTokenClassification = LicenseInputsUtil.classify(
      inputsWith({
        marketplaceBilling: billing({ verifiedAt: hoursBefore(1) }),
      }),
      NOW,
    );

    expect(license.status).toBe("missing");
  });

  it("reads the record from the GlobalConfig row, and refuses one that is not a record", () => {
    const config: GlobalConfig = new GlobalConfig();
    config.enterpriseMarketplaceBilling = EnterpriseMarketplaceBillingUtil.toJSON(
      billing({ verifiedAt: hoursBefore(1) }),
    );

    expect(
      LicenseInputsUtil.fromGlobalConfig(config).marketplaceBilling!.verifiedAt,
    ).toBe(hoursBefore(1));

    config.enterpriseMarketplaceBilling = { version: 1, marketplace: "Nope" };
    expect(
      LicenseInputsUtil.fromGlobalConfig(config).marketplaceBilling,
    ).toBeNull();
    expect(LicenseInputsUtil.fromGlobalConfig(null).marketplaceBilling).toBeNull();
  });

  it("follows a write of the record in withUpdate, and keeps it otherwise", () => {
    const before: LicenseInputs = inputsWith({
      marketplaceBilling: billing({ verifiedAt: hoursBefore(5) }),
    });

    expect(
      LicenseInputsUtil.withUpdate(before, { enterpriseLicenseKey: "key" })
        .marketplaceBilling,
    ).toEqual(before.marketplaceBilling);

    const update: Record<string, unknown> = {
      enterpriseMarketplaceBilling: EnterpriseMarketplaceBillingUtil.toJSON(
        billing({ verifiedAt: hoursBefore(1) }),
      ),
    };

    expect(
      LicenseInputsUtil.withUpdate(before, update)!.marketplaceBilling!.verifiedAt,
    ).toBe(hoursBefore(1));
  });
});
