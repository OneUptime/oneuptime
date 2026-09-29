import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import GlobalConfig from "Common/Models/DatabaseModels/GlobalConfig";
import EnterpriseEdition, {
  RUNTIME_ENTERPRISE_FEATURES,
} from "Common/Server/Enterprise/EnterpriseEdition";
import EnterpriseFeature from "Common/Server/Enterprise/EnterpriseFeature";
import {
  ENTERPRISE_LICENSE_TRIAL_PERIOD_IN_DAYS,
  EnterpriseLicenseSnapshot,
  EnterpriseLicenseSnapshotUtil,
} from "Common/Server/Enterprise/EnterpriseLicenseSnapshot";
import {
  installFakeEnterpriseModule,
  uninstallEnterpriseModule,
} from "Common/Tests/Server/Enterprise/FakeEnterpriseModule";
import { setTestBillingEnabled } from "Common/Tests/Server/Enterprise/TestBillingFlag";
import PartialEntity from "Common/Types/Database/PartialEntity";
import { JSONObject } from "Common/Types/JSON";
import EnterpriseLicenseSyncUtil, {
  EnterpriseLicenseSyncResult,
} from "../../../Server/License/EnterpriseLicenseSync";
import LicenseInputsUtil, {
  LicenseInputs,
} from "../../../Server/License/LicenseInputs";
import { LicenseTokenClassification } from "../../../Server/License/LicenseToken";
import { setTrustedLicenseKeysForTests } from "../../../Server/License/TrustedLicenseKeys";
import { DAY_IN_MS, legacyToken } from "./Helpers/LicenseTestKit";

/*
 * The bug this file ties together, end to end through the real pieces.
 *
 * A license-server response that carries a TOKEN but no EXPIRY leaves the
 * installation holding one without the other: EnterpriseLicenseSync writes
 * the two columns under independent presence checks (a null expiry is
 * deliberately treated as "the server said nothing", so a report can never
 * strip an installation of the expiry it has), and nothing reconciles the
 * pair afterwards.
 *
 * That state used to classify "invalid", which is not usable, so SSO, SCIM
 * and audit logging stopped at once on upgrade - no trial, no grace - for a
 * customer with a valid paid license. It is now the unlicensed trial: a
 * warning and a countdown, with two weeks to re-activate or re-sync.
 *
 * These tests drive the mapper, the inputs, the classifier and
 * EnterpriseEdition together, because each of them on its own looked
 * defensible; only the chain is wrong.
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

const TRIAL_DAYS: number = ENTERPRISE_LICENSE_TRIAL_PERIOD_IN_DAYS;
const NOW: Date = new Date("2026-09-18T12:00:00.000Z");
const FIRST_SEEN: Date = new Date(NOW.getTime() - 3 * DAY_IN_MS);

// A self-hosted installation that has been licensed for a while.
const storedInputs: (overrides?: Partial<LicenseInputs>) => LicenseInputs = (
  overrides?: Partial<LicenseInputs>,
): LicenseInputs => {
  return {
    hasConfigRow: true,
    licenseKey: "OU-ENT-0001",
    token: legacyToken("installed"),
    storedColumns: {
      // The column at the heart of this: nothing was ever recorded in it.
      expiresAt: null,
      companyName: "Acme Inc",
      userLimit: 25,
      isEvaluation: false,
      enterpriseEditionFirstSeenAt: FIRST_SEEN,
    },
    instanceId: "11111111-2222-3333-4444-555555555555",
    currentUserCount: 12,
    instances: [],
    ...(overrides || {}),
  };
};

/*
 * What a license server that does not speak about expiry sends back: a token,
 * the seat figures, and no expiresAt at all.
 */
const payloadWithoutExpiry: (overrides?: JSONObject) => JSONObject = (
  overrides?: JSONObject,
): JSONObject => {
  return {
    token: legacyToken("returned"),
    userLimit: 25,
    companyName: "Acme Inc",
    currentUserCount: 12,
    isEvaluationLicense: false,
    ...(overrides || {}),
  };
};

const classifyAfterSync: (data: {
  payload: JSONObject;
  inputs?: LicenseInputs;
  now?: Date;
}) => {
  update: PartialEntity<GlobalConfig>;
  classification: LicenseTokenClassification;
} = (data: {
  payload: JSONObject;
  inputs?: LicenseInputs;
  now?: Date;
}): {
  update: PartialEntity<GlobalConfig>;
  classification: LicenseTokenClassification;
} => {
  const inputs: LicenseInputs = data.inputs || storedInputs();
  const sync: EnterpriseLicenseSyncResult =
    EnterpriseLicenseSyncUtil.getGlobalConfigUpdateFromLicenseResponse({
      payload: data.payload,
      reportedAt: data.now || NOW,
    });

  return {
    update: sync.updateData,
    classification: LicenseInputsUtil.classify(
      LicenseInputsUtil.withUpdate(inputs, sync.updateData),
      data.now || NOW,
    ),
  };
};

beforeEach(() => {
  setTestBillingEnabled(false);
  // No trusted keys: every license in the field today is unverified.
  setTrustedLicenseKeysForTests([]);
});

afterEach(() => {
  setTrustedLicenseKeysForTests(null);
  uninstallEnterpriseModule();
  setTestBillingEnabled(false);
});

describe("a license-server response with a token and no expiry, end to end", () => {
  /*
   * The reachability itself. If this ever stops holding - because the sync
   * learns to reconcile the pair - the behaviour tests below become belt and
   * braces rather than the load-bearing ones, but they must still pass.
   */
  test("the sync stores the token and says nothing about the expiry", () => {
    const sync: EnterpriseLicenseSyncResult =
      EnterpriseLicenseSyncUtil.getGlobalConfigUpdateFromLicenseResponse({
        payload: payloadWithoutExpiry(),
        reportedAt: NOW,
      });

    expect(sync.updateData.enterpriseLicenseToken).toBe(
      legacyToken("returned"),
    );
    expect(sync.updateData).not.toHaveProperty("enterpriseLicenseExpiresAt");
  });

  /*
   * THE test. Before the fix this classified "invalid", which is not usable,
   * so single sign-on, SCIM provisioning and audit logging stopped the moment
   * the installation upgraded.
   */
  test("the installation is put on the trial, not stopped", () => {
    const result: LicenseTokenClassification = classifyAfterSync({
      payload: payloadWithoutExpiry(),
    }).classification;

    expect(result).toMatchObject({
      status: "grace",
      verification: "unverified",
      graceReason: "unlicensed",
      features: "all",
      reason: "unverified-without-expiry-unlicensed",
    });
    expect(result.graceEndsAt).toEqual(
      new Date(FIRST_SEEN.getTime() + TRIAL_DAYS * DAY_IN_MS),
    );
    expect(EnterpriseLicenseSnapshotUtil.isUsable(result)).toBe(true);
    expect(result.message).toContain("no expiry is recorded for it");
  });

  test("an explicit null expiry from the server reaches the same place", () => {
    const { update, classification } = classifyAfterSync({
      payload: payloadWithoutExpiry({ expiresAt: null }),
    });

    // Null is treated as silence on purpose: a report never clears an expiry.
    expect(update).not.toHaveProperty("enterpriseLicenseExpiresAt");
    expect(classification.status).toBe("grace");
    expect(classification.reason).toBe("unverified-without-expiry-unlicensed");
  });

  test("an unusable expiry from the server is ignored and warned about, and still not a lock-out", () => {
    const sync: EnterpriseLicenseSyncResult =
      EnterpriseLicenseSyncUtil.getGlobalConfigUpdateFromLicenseResponse({
        payload: payloadWithoutExpiry({ expiresAt: "the first of never" }),
        reportedAt: NOW,
      });

    expect(sync.warnings.join(" ")).toContain("expiresAt");
    expect(
      LicenseInputsUtil.classify(
        LicenseInputsUtil.withUpdate(storedInputs(), sync.updateData),
        NOW,
      ).status,
    ).toBe("grace");
  });

  test("the trial ends where the constant says, and then the install lapses", () => {
    const at: (offsetFromFirstSeenInMs: number) => LicenseTokenClassification =
      (offsetFromFirstSeenInMs: number): LicenseTokenClassification => {
        return classifyAfterSync({
          payload: payloadWithoutExpiry(),
          now: new Date(FIRST_SEEN.getTime() + offsetFromFirstSeenInMs),
        }).classification;
      };

    expect(at(TRIAL_DAYS * DAY_IN_MS).status).toBe("grace");
    expect(at(TRIAL_DAYS * DAY_IN_MS + 1)).toMatchObject({
      status: "missing",
      features: [],
      reason: "unverified-without-expiry-unlicensed",
    });
  });

  /*
   * A real expiry in the response is the healthy case, and it must not have
   * been dragged into the trial by any of this.
   */
  test("a response that does carry an expiry is a plain licensed install", () => {
    const { update, classification } = classifyAfterSync({
      payload: payloadWithoutExpiry({
        expiresAt: new Date(NOW.getTime() + 200 * DAY_IN_MS).toISOString(),
      }),
    });

    expect(update.enterpriseLicenseExpiresAt).toBeInstanceOf(Date);
    expect(classification).toMatchObject({
      status: "valid",
      verification: "unverified",
      reason: "unverified",
      userLimit: 25,
    });
  });
});

/*
 * What the runtime does with that snapshot. The rules themselves are not
 * changed here, only pinned: features run while the license is usable
 * (isFeatureActive), enterprise configuration writes follow the same
 * entitlement synchronously (isFeatureAvailableSync), and an UNKNOWN license
 * state fails open for the runtime and closed for configuration.
 */
describe("EnterpriseEdition with a token that has no recorded expiry", () => {
  const snapshotAt: (offsetFromFirstSeenInMs: number) => EnterpriseLicenseSnapshot =
    (offsetFromFirstSeenInMs: number): EnterpriseLicenseSnapshot => {
      return LicenseInputsUtil.toSnapshot(
        classifyAfterSync({
          payload: payloadWithoutExpiry(),
          now: new Date(FIRST_SEEN.getTime() + offsetFromFirstSeenInMs),
        }).classification,
      );
    };

  const runtimeAnswers: (
    snapshot: EnterpriseLicenseSnapshot,
  ) => Array<boolean> = (
    snapshot: EnterpriseLicenseSnapshot,
  ): Array<boolean> => {
    installFakeEnterpriseModule({ snapshot });

    return RUNTIME_ENTERPRISE_FEATURES.map(
      (feature: EnterpriseFeature): boolean => {
        return EnterpriseEdition.isFeatureActive(feature);
      },
    );
  };

  test("SSO, SCIM and audit logging keep running through the trial", () => {
    expect(runtimeAnswers(snapshotAt(DAY_IN_MS))).toEqual([true, true, true]);
    expect(
      runtimeAnswers(snapshotAt(TRIAL_DAYS * DAY_IN_MS)),
    ).toEqual([true, true, true]);
  });

  test("they stop once the trial has ended, exactly as for an unlicensed install", () => {
    expect(
      runtimeAnswers(snapshotAt(TRIAL_DAYS * DAY_IN_MS + 1)),
    ).toEqual([false, false, false]);
  });

  test("enterprise configuration writes are allowed through the trial and refused after it", () => {
    installFakeEnterpriseModule({ snapshot: snapshotAt(DAY_IN_MS) });
    expect(EnterpriseEdition.isFeatureAvailableSync(EnterpriseFeature.SSO)).toBe(
      true,
    );

    installFakeEnterpriseModule({
      snapshot: snapshotAt(TRIAL_DAYS * DAY_IN_MS + 1),
    });
    expect(EnterpriseEdition.isFeatureAvailableSync(EnterpriseFeature.SSO)).toBe(
      false,
    );
  });

  /*
   * The state that must stay distinct: the first-run stamp was never written,
   * so whether the trial is over is UNKNOWN. The runtime fails open on it and
   * configuration fails closed - the same as for an install with no token at
   * all. If the fallback ever collapsed the two states into one, an install
   * that cannot record its stamp would lose SSO instead of keeping it.
   */
  test("with no first-run stamp the runtime still fails open and configuration still fails closed", () => {
    const snapshot: EnterpriseLicenseSnapshot = LicenseInputsUtil.toSnapshot(
      classifyAfterSync({
        payload: payloadWithoutExpiry(),
        inputs: storedInputs({
          storedColumns: {
            expiresAt: null,
            enterpriseEditionFirstSeenAt: null,
          },
        }),
      }).classification,
    );

    expect(snapshot.status).toBe("missing");
    expect(EnterpriseLicenseSnapshotUtil.isTrialStartUnknown(snapshot)).toBe(
      true,
    );
    expect(runtimeAnswers(snapshot)).toEqual([true, true, true]);
    expect(EnterpriseEdition.isFeatureAvailableSync(EnterpriseFeature.SSO)).toBe(
      false,
    );
  });

  test("the lapsed state is a known lapse, not the unknown one", () => {
    const lapsed: EnterpriseLicenseSnapshot = snapshotAt(
      TRIAL_DAYS * DAY_IN_MS + 1,
    );

    expect(lapsed.graceEndsAt).toBeDefined();
    expect(EnterpriseLicenseSnapshotUtil.isTrialStartUnknown(lapsed)).toBe(
      false,
    );
  });

  /*
   * The snapshot core reads must still explain itself: the lapse log quotes
   * snapshot.message, and this is the one state where the message is the only
   * thing telling an admin that a license IS installed and merely incomplete.
   */
  test("the lapse log tells an admin what is actually wrong", () => {
    const stopped: string | null = EnterpriseEdition.describeStoppedFeatures(
      [...RUNTIME_ENTERPRISE_FEATURES],
      snapshotAt(TRIAL_DAYS * DAY_IN_MS + 1),
    );

    expect(stopped).toContain("no expiry is recorded for it");
    expect(stopped).toContain("re-activate the license");
  });
});
