import CustomChannelEdition, {
  CUSTOM_CHANNEL_NOT_ACTIVE_MESSAGE,
} from "../../../../Server/Utils/Notification/CustomChannelEdition";
import EnterpriseEdition, {
  RUNTIME_ENTERPRISE_FEATURES,
} from "../../../../Server/Enterprise/EnterpriseEdition";
import EnterpriseFeature, {
  ALL_ENTERPRISE_FEATURES,
  parseEnterpriseFeature,
} from "../../../../Server/Enterprise/EnterpriseFeature";
import { Service as CustomNotificationChannelServiceClass } from "../../../../Server/Services/CustomNotificationChannelService";
import logger from "../../../../Server/Utils/Logger";
import CustomNotificationChannel from "../../../../Models/DatabaseModels/CustomNotificationChannel";
import UserNotificationRule from "../../../../Models/DatabaseModels/UserNotificationRule";
import UserNotificationSetting from "../../../../Models/DatabaseModels/UserNotificationSetting";
import PaymentRequiredException from "../../../../Types/Exception/PaymentRequiredException";
import FakeEnterpriseModule, {
  createEditionStateCases,
  createLicenseSnapshot,
  createLicenseSnapshotWithStatus,
  EditionStateCase,
  installFakeEnterpriseModule,
  LICENSE_STATE_CASES,
  LicenseStateCase,
  uninstallEnterpriseModule,
} from "../../Enterprise/FakeEnterpriseModule";
import { setTestBillingEnabled } from "../../Enterprise/TestBillingFlag";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * CUSTOM CHANNELS ARE AN ENTERPRISE FEATURE: CustomChannelEdition, the one
 * question core asks before anything reaches a custom channel.
 *
 *   isActive()         the runtime question (EnterpriseEdition
 *                      isFeatureActive): never on the Community Edition;
 *                      with billing on whenever the Enterprise Edition is
 *                      loaded; self-hosted while a license that includes
 *                      custom channels is usable - valid, in its trial or
 *                      grace period - and, like every runtime feature, while
 *                      the license state is not known yet.
 *   assertAvailable()  the configuration question (isFeatureAvailable),
 *                      failing closed, with the edition's own words: on the
 *                      Community Edition that it is an Enterprise feature,
 *                      on the Enterprise Edition that it needs a license.
 *
 * And the maps EnterpriseEdition keeps for it: the model, the two columns
 * that point at a channel, the runtime list and the lapse log's name.
 *
 * Billing and the edition are pinned in every test (CI's config.env sets
 * BILLING_ENABLED=true).
 */

jest.mock("../../../../Server/EnvironmentConfig", () => {
  const billingFlag: typeof import("../../Enterprise/TestBillingFlag") =
    jest.requireActual(
      "../../Enterprise/TestBillingFlag",
    ) as typeof import("../../Enterprise/TestBillingFlag");

  return billingFlag.withLiveBillingFlag(
    jest.requireActual("../../../../Server/EnvironmentConfig") as Record<
      string,
      unknown
    >,
  );
});

const FEATURE: EnterpriseFeature = EnterpriseFeature.CustomNotificationChannels;

// Every feature but custom channels: a license that leaves them out.
const ALL_BUT_CUSTOM_CHANNELS: Array<EnterpriseFeature> =
  ALL_ENTERPRISE_FEATURES.filter((feature: EnterpriseFeature): boolean => {
    return feature !== FEATURE;
  });

type Refusal = "allowed" | "community" | "license" | string;

// How assertAvailable answered: allowed, or which of the edition's words.
async function refusalOf(): Promise<Refusal> {
  try {
    await CustomChannelEdition.assertAvailable();
    return "allowed";
  } catch (err) {
    if (err instanceof PaymentRequiredException) {
      if (err.message === EnterpriseEdition.COMMUNITY_EDITION_MESSAGE) {
        return "community";
      }

      if (err.message === EnterpriseEdition.LICENSE_REQUIRED_MESSAGE) {
        return "license";
      }

      return err.message;
    }

    throw err;
  }
}

let warn: jest.SpyInstance;
let info: jest.SpyInstance;

beforeEach(() => {
  setTestBillingEnabled(false);
  uninstallEnterpriseModule();
  warn = jest.spyOn(logger, "warn").mockImplementation((): void => {
    return undefined;
  });
  info = jest.spyOn(logger, "info").mockImplementation((): void => {
    return undefined;
  });
});

afterEach(() => {
  uninstallEnterpriseModule();
  setTestBillingEnabled(false);
  jest.restoreAllMocks();
});

describe("the feature", () => {
  test("is named custom-notification-channels in a license, and parses as itself", () => {
    expect(FEATURE).toBe("custom-notification-channels");
    expect(ALL_ENTERPRISE_FEATURES).toContain(FEATURE);
    expect(parseEnterpriseFeature("custom-notification-channels")).toBe(
      FEATURE,
    );
  });

  test("is a runtime feature: what goes to a channel stops when the license lapses", () => {
    expect(RUNTIME_ENTERPRISE_FEATURES).toContain(FEATURE);
  });

  test("the lapse log calls it custom notification channels", () => {
    expect(EnterpriseEdition.getFeatureName(FEATURE)).toBe(
      "custom notification channels",
    );
  });

  test("the not-active message says it was not sent, and why, without naming a channel", () => {
    expect(CUSTOM_CHANNEL_NOT_ACTIVE_MESSAGE).toBe(
      "Not sent: custom channels are a OneUptime Enterprise feature, and this server has no Enterprise license that includes them.",
    );
  });
});

describe("the maps EnterpriseEdition keeps for it", () => {
  test("the CustomNotificationChannel model is enterprise configuration of this feature", () => {
    expect(new CustomNotificationChannel().requiresEnterprise).toBe(true);
    expect(EnterpriseEdition.getModelFeature(CustomNotificationChannel)).toBe(
      FEATURE,
    );
    expect(
      EnterpriseEdition.getFeatureForTableName("CustomNotificationChannel"),
    ).toBe(FEATURE);
  });

  test("an on-call rule's custom channel is its one enterprise column", () => {
    expect(
      EnterpriseEdition.getEnterpriseColumnsForTableName(
        new UserNotificationRule().tableName,
      ),
    ).toEqual({ customNotificationChannelId: FEATURE });
  });

  test("a person's notifications through the custom channels is their notification setting's one enterprise column", () => {
    expect(
      EnterpriseEdition.getEnterpriseColumnsForTableName(
        new UserNotificationSetting().tableName,
      ),
    ).toEqual({ alertByCustomChannel: FEATURE });
  });

  test("the rule and the setting themselves are not enterprise models: only these columns are gated", () => {
    expect(new UserNotificationRule().requiresEnterprise).toBeFalsy();
    expect(new UserNotificationSetting().requiresEnterprise).toBeFalsy();
    expect(EnterpriseEdition.getModelFeature(UserNotificationRule)).toBeNull();
    expect(
      EnterpriseEdition.getModelFeature(UserNotificationSetting),
    ).toBeNull();
  });
});

describe("isActive", () => {
  test("the Community Edition: never, with billing on or off, and nothing is read or logged", () => {
    for (const billing of [false, true]) {
      setTestBillingEnabled(billing);
      expect(CustomChannelEdition.isActive()).toBe(false);
    }

    expect(warn).not.toHaveBeenCalled();
  });

  test.each(
    createEditionStateCases().map(
      (state: EditionStateCase): [string, EditionStateCase] => {
        return [state.label, state];
      },
    ),
  )("%s", (_label: string, state: EditionStateCase) => {
    state.apply();

    expect(CustomChannelEdition.isActive()).toBe(state.isActive);
    expect(CustomChannelEdition.isActive()).toBe(
      EnterpriseEdition.isFeatureActive(FEATURE),
    );
    // The service's own question is the same one.
    expect(CustomNotificationChannelServiceClass.isFeatureActive()).toBe(
      state.isActive,
    );
  });

  test("a license that leaves custom channels out: not active, while everything else is", () => {
    installFakeEnterpriseModule({
      snapshot: createLicenseSnapshot({ features: ALL_BUT_CUSTOM_CHANNELS }),
    });

    expect(CustomChannelEdition.isActive()).toBe(false);
    expect(EnterpriseEdition.isFeatureActive(EnterpriseFeature.SCIM)).toBe(
      true,
    );
  });

  test("a license that names custom channels alone: active", () => {
    installFakeEnterpriseModule({
      snapshot: createLicenseSnapshot({ features: [FEATURE] }),
    });

    expect(CustomChannelEdition.isActive()).toBe(true);
  });

  test("the answer follows the license at call time: a lapse stops it and a renewal resumes it, without a restart, each logged once", () => {
    const fake: FakeEnterpriseModule = installFakeEnterpriseModule();

    expect(CustomChannelEdition.isActive()).toBe(true);

    fake.setSnapshot(createLicenseSnapshotWithStatus("expired"));

    expect(CustomChannelEdition.isActive()).toBe(false);
    expect(CustomChannelEdition.isActive()).toBe(false);

    const stopped: Array<string> = warn.mock.calls
      .map((call: Array<unknown>): string => {
        return String(call[0]);
      })
      .filter((message: string): boolean => {
        return message.includes("custom notification channels");
      });

    expect(stopped).toHaveLength(1);
    expect(stopped[0]).toContain("has lapsed (status: expired)");

    fake.setSnapshot(createLicenseSnapshotWithStatus("valid"));

    expect(CustomChannelEdition.isActive()).toBe(true);
    expect(
      info.mock.calls.filter((call: Array<unknown>): boolean => {
        return String(call[0]).includes("custom notification channels");
      }),
    ).toHaveLength(1);
  });

  test("a license without custom channels alone names only them, as not included", () => {
    installFakeEnterpriseModule({
      snapshot: createLicenseSnapshot({ features: ALL_BUT_CUSTOM_CHANNELS }),
    });

    CustomChannelEdition.isActive();
    CustomChannelEdition.isActive();

    expect(
      warn.mock.calls.map((call: Array<unknown>): string => {
        return String(call[0]);
      }),
    ).toEqual([
      "The OneUptime Enterprise license does not include custom notification channels: it has stopped until a license that includes it is activated. A master admin can activate or renew the license from the edition label in the Admin Dashboard header.",
    ]);
  });
});

describe("assertAvailable", () => {
  test("the Community Edition: refused, saying it is an Enterprise Edition feature", async () => {
    await expect(CustomChannelEdition.assertAvailable()).rejects.toThrow(
      new PaymentRequiredException(EnterpriseEdition.COMMUNITY_EDITION_MESSAGE),
    );
  });

  test("the Community Edition with billing on: still refused, there is no Enterprise Edition to send", async () => {
    setTestBillingEnabled(true);

    expect(await refusalOf()).toBe("community");
  });

  test("OneUptime Cloud, the Enterprise Edition with billing on: allowed, whatever the license", async () => {
    setTestBillingEnabled(true);
    installFakeEnterpriseModule({
      snapshot: createLicenseSnapshotWithStatus("expired"),
    });

    expect(await refusalOf()).toBe("allowed");
  });

  /*
   * Self-hosted, by license state. The configuration question fails closed:
   * a license state that is not known is refused here, though the runtime
   * keeps running in it - except where a fresh read of the license answers
   * (the cached snapshot could not be read, the license itself can).
   */
  const AVAILABILITY_BY_LICENSE_STATE: Record<string, Refusal> = {
    "valid license": "allowed",
    "license expired less than 30 days ago (grace)": "allowed",
    "no license, inside the 14-day trial": "allowed",
    "unverified legacy license, accepted": "allowed",
    "license expired more than 30 days ago": "license",
    "no license after the trial": "license",
    "invalid license": "license",
    // FEATURES_WITHOUT_RUNTIME_FEATURES: custom channels are a runtime feature.
    "valid license without SCIM or audit logs": "license",
    "license not read yet (unknown)": "license",
    "no license, trial start not recorded yet (unknown)": "license",
    "license snapshot unreadable (unknown)": "allowed",
  };

  test("every license state the kit knows has an expected answer here", () => {
    expect(
      LICENSE_STATE_CASES.map((state: LicenseStateCase): string => {
        return state.label;
      }).sort(),
    ).toEqual(Object.keys(AVAILABILITY_BY_LICENSE_STATE).sort());
  });

  test.each(
    LICENSE_STATE_CASES.map(
      (state: LicenseStateCase): [string, LicenseStateCase] => {
        return [state.label, state];
      },
    ),
  )("self-hosted, %s", async (label: string, state: LicenseStateCase) => {
    state.install();

    expect(await refusalOf()).toBe(AVAILABILITY_BY_LICENSE_STATE[label]);
  });

  test("a license that leaves custom channels out: refused, saying a license that includes it is needed", async () => {
    installFakeEnterpriseModule({
      snapshot: createLicenseSnapshot({ features: ALL_BUT_CUSTOM_CHANNELS }),
    });

    expect(await refusalOf()).toBe("license");
  });

  test("a license that names custom channels alone: allowed", async () => {
    installFakeEnterpriseModule({
      snapshot: createLicenseSnapshot({ features: [FEATURE] }),
    });

    expect(await refusalOf()).toBe("allowed");
  });

  test("reads the license fresh, not only the cached snapshot", async () => {
    const fake: FakeEnterpriseModule = installFakeEnterpriseModule();
    fake.licensing.cachedSnapshot = createLicenseSnapshotWithStatus("expired");
    fake.licensing.asyncSnapshot = createLicenseSnapshotWithStatus("valid");

    expect(await refusalOf()).toBe("allowed");

    fake.licensing.cachedSnapshot = createLicenseSnapshotWithStatus("valid");
    fake.licensing.asyncSnapshot = createLicenseSnapshotWithStatus("expired");

    expect(await refusalOf()).toBe("license");
  });

  test("a 402, which every client reads as a payment or license refusal", async () => {
    let caught: unknown = null;

    try {
      await CustomChannelEdition.assertAvailable();
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(PaymentRequiredException);
    expect((caught as PaymentRequiredException).code).toBe(402);
  });
});
