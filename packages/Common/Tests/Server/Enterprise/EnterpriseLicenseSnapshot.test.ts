import { describe, expect, test } from "@jest/globals";
import EnterpriseFeature, {
  ALL_ENTERPRISE_FEATURES,
  ENTERPRISE_FEATURE_WILDCARD,
  RETIRED_ENTERPRISE_FEATURE_VALUES,
  parseEnterpriseFeature,
} from "../../../Server/Enterprise/EnterpriseFeature";
import {
  ENTERPRISE_LICENSE_GRACE_PERIOD_IN_DAYS,
  ENTERPRISE_LICENSE_TRIAL_PERIOD_IN_DAYS,
  EnterpriseLicenseSnapshot,
  EnterpriseLicenseSnapshotUtil,
  EnterpriseLicenseStatus,
} from "../../../Server/Enterprise/EnterpriseLicenseSnapshot";
import {
  createLicenseSnapshot,
  createLicenseSnapshotWithStatus,
} from "./FakeEnterpriseModule";

describe("EnterpriseFeature", () => {
  test("the license claim values are the documented strings", () => {
    /*
     * These strings are part of every issued license. Changing one silently
     * revokes that feature from licenses already in the field.
     */
    expect(EnterpriseFeature.SCIM).toBe("scim");
    expect(EnterpriseFeature.TeamCompliance).toBe("team-compliance");
    expect(EnterpriseFeature.AuditLogs).toBe("audit-logs");
    expect(EnterpriseFeature.InstanceHealth).toBe("instance-health");
    expect(ENTERPRISE_FEATURE_WILDCARD).toBe("*");
  });

  test("ALL_ENTERPRISE_FEATURES lists every feature exactly once", () => {
    expect([...ALL_ENTERPRISE_FEATURES].sort()).toEqual(
      [
        "audit-logs",
        "instance-health",
        "scim",
        "team-compliance",
        "telemetry-retention",
      ].sort(),
    );
    expect(new Set(ALL_ENTERPRISE_FEATURES).size).toBe(
      ALL_ENTERPRISE_FEATURES.length,
    );
  });

  /*
   * Single sign-on is part of the Community Edition. Its old claim value is
   * retired, never reused: licenses issued before the move still carry it, so
   * a new feature named "sso" would be granted to every one of them.
   */
  test('"sso" is a retired claim value, not a feature', () => {
    expect(RETIRED_ENTERPRISE_FEATURE_VALUES).toEqual(["sso"]);
    expect(Object.values(EnterpriseFeature) as Array<string>).not.toContain(
      "sso",
    );
    expect(Object.keys(EnterpriseFeature)).not.toContain("SSO");
    expect(parseEnterpriseFeature("sso")).toBeNull();
  });

  test("no feature ever reuses a retired claim value", () => {
    for (const retired of RETIRED_ENTERPRISE_FEATURE_VALUES) {
      expect(ALL_ENTERPRISE_FEATURES as ReadonlyArray<string>).not.toContain(
        retired,
      );
      expect(parseEnterpriseFeature(retired)).toBeNull();
    }
  });

  test.each(
    ALL_ENTERPRISE_FEATURES.map((feature: EnterpriseFeature) => {
      return [feature];
    }),
  )("parseEnterpriseFeature accepts %s", (feature: EnterpriseFeature) => {
    expect(parseEnterpriseFeature(feature)).toBe(feature);
  });

  test.each([
    "*",
    "sso",
    "SSO",
    " sso",
    "sso ",
    "SCIM",
    " scim",
    "future-feature",
    "",
    null,
    undefined,
    7,
    ["scim"],
    { feature: "scim" },
  ] as Array<unknown>)(
    "parseEnterpriseFeature rejects %p without throwing",
    (value: unknown) => {
      expect(parseEnterpriseFeature(value)).toBeNull();
    },
  );
});

describe("EnterpriseLicenseSnapshotUtil", () => {
  /*
   * Two periods, two lengths (the owner's decision): 30 days of grace after a
   * license expires, and a 14-day trial for an Enterprise install that never
   * had a license.
   */
  test("the grace period after a license expires is thirty days", () => {
    expect(ENTERPRISE_LICENSE_GRACE_PERIOD_IN_DAYS).toBe(30);
  });

  test("the trial of an install with no license is fourteen days", () => {
    expect(ENTERPRISE_LICENSE_TRIAL_PERIOD_IN_DAYS).toBe(14);
  });

  test("the server reads the same constants the browser copy derives from", () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
    const periods: typeof import("../../../Types/EnterpriseLicense/EnterpriseLicensePeriods") = require("../../../Types/EnterpriseLicense/EnterpriseLicensePeriods");

    expect(ENTERPRISE_LICENSE_GRACE_PERIOD_IN_DAYS).toBe(
      periods.ENTERPRISE_LICENSE_GRACE_PERIOD_IN_DAYS,
    );
    expect(ENTERPRISE_LICENSE_TRIAL_PERIOD_IN_DAYS).toBe(
      periods.ENTERPRISE_LICENSE_TRIAL_PERIOD_IN_DAYS,
    );
  });

  test.each([
    ["valid", true],
    ["grace", true],
    ["missing", false],
    ["expired", false],
    ["invalid", false],
  ] as Array<[EnterpriseLicenseStatus, boolean]>)(
    "a %s license is usable: %s",
    (status: EnterpriseLicenseStatus, usable: boolean) => {
      expect(
        EnterpriseLicenseSnapshotUtil.isUsable(
          createLicenseSnapshotWithStatus(status),
        ),
      ).toBe(usable);
    },
  );

  test("no snapshot is not usable and includes nothing", () => {
    expect(EnterpriseLicenseSnapshotUtil.isUsable(null)).toBe(false);
    expect(
      EnterpriseLicenseSnapshotUtil.includesFeature(
        null,
        EnterpriseFeature.SCIM,
      ),
    ).toBe(false);
    expect(
      EnterpriseLicenseSnapshotUtil.entitles(null, EnterpriseFeature.SCIM),
    ).toBe(false);
  });

  test("an 'all' license includes every feature", () => {
    const snapshot: EnterpriseLicenseSnapshot = createLicenseSnapshot({
      features: "all",
    });

    for (const feature of ALL_ENTERPRISE_FEATURES) {
      expect(
        EnterpriseLicenseSnapshotUtil.includesFeature(snapshot, feature),
      ).toBe(true);
    }
  });

  test("a subset license includes only its features", () => {
    const snapshot: EnterpriseLicenseSnapshot = createLicenseSnapshot({
      features: [EnterpriseFeature.TeamCompliance, EnterpriseFeature.AuditLogs],
    });

    expect(
      EnterpriseLicenseSnapshotUtil.includesFeature(
        snapshot,
        EnterpriseFeature.TeamCompliance,
      ),
    ).toBe(true);
    expect(
      EnterpriseLicenseSnapshotUtil.includesFeature(
        snapshot,
        EnterpriseFeature.AuditLogs,
      ),
    ).toBe(true);
    expect(
      EnterpriseLicenseSnapshotUtil.includesFeature(
        snapshot,
        EnterpriseFeature.SCIM,
      ),
    ).toBe(false);
  });

  test("an empty or malformed features value includes nothing", () => {
    for (const features of [
      [],
      "everything",
      undefined,
      null,
    ] as Array<unknown>) {
      const snapshot: EnterpriseLicenseSnapshot = createLicenseSnapshot({
        features: features as EnterpriseLicenseSnapshot["features"],
      });

      expect(
        EnterpriseLicenseSnapshotUtil.includesFeature(
          snapshot,
          EnterpriseFeature.SCIM,
        ),
      ).toBe(false);
    }
  });

  test("entitles needs both a usable status and the feature", () => {
    expect(
      EnterpriseLicenseSnapshotUtil.entitles(
        createLicenseSnapshotWithStatus("grace", {
          features: [EnterpriseFeature.SCIM],
        }),
        EnterpriseFeature.SCIM,
      ),
    ).toBe(true);
    expect(
      EnterpriseLicenseSnapshotUtil.entitles(
        createLicenseSnapshotWithStatus("expired", { features: "all" }),
        EnterpriseFeature.SCIM,
      ),
    ).toBe(false);
    expect(
      EnterpriseLicenseSnapshotUtil.entitles(
        createLicenseSnapshotWithStatus("valid", {
          features: [EnterpriseFeature.AuditLogs],
        }),
        EnterpriseFeature.SCIM,
      ),
    ).toBe(false);
  });

  test("createMissing is an unverified-nothing snapshot with a message", () => {
    const snapshot: EnterpriseLicenseSnapshot =
      EnterpriseLicenseSnapshotUtil.createMissing();

    expect(snapshot).toEqual({
      status: "missing",
      verification: "none",
      userLimit: null,
      isEvaluation: false,
      features: [],
      message: "No OneUptime Enterprise license is installed.",
    });
    expect(EnterpriseLicenseSnapshotUtil.isUsable(snapshot)).toBe(false);
    expect(EnterpriseLicenseSnapshotUtil.createMissing("custom").message).toBe(
      "custom",
    );
  });

  describe("isTrialStartUnknown", () => {
    test("is true only for 'missing' with no graceEndsAt", () => {
      expect(
        EnterpriseLicenseSnapshotUtil.isTrialStartUnknown(
          createLicenseSnapshotWithStatus("missing", {
            graceEndsAt: undefined,
          }),
        ),
      ).toBe(true);
      // What the provider answers when nothing could be read at all.
      expect(
        EnterpriseLicenseSnapshotUtil.isTrialStartUnknown(
          EnterpriseLicenseSnapshotUtil.createMissing(),
        ),
      ).toBe(true);
    });

    test("a trial that is known to be over is not unknown", () => {
      expect(
        EnterpriseLicenseSnapshotUtil.isTrialStartUnknown(
          createLicenseSnapshotWithStatus("missing", {
            graceEndsAt: new Date(Date.now() - 1000),
          }),
        ),
      ).toBe(false);
      // The test kit's "missing" is the known lapse.
      expect(
        EnterpriseLicenseSnapshotUtil.isTrialStartUnknown(
          createLicenseSnapshotWithStatus("missing"),
        ),
      ).toBe(false);
    });

    test("every other status, and no snapshot, is not about the trial start", () => {
      for (const status of [
        "valid",
        "grace",
        "expired",
        "invalid",
      ] as Array<EnterpriseLicenseStatus>) {
        expect(
          EnterpriseLicenseSnapshotUtil.isTrialStartUnknown(
            createLicenseSnapshotWithStatus(status, { graceEndsAt: undefined }),
          ),
        ).toBe(false);
      }

      expect(EnterpriseLicenseSnapshotUtil.isTrialStartUnknown(null)).toBe(
        false,
      );
    });
  });

  test("createMissing returns a fresh object each time", () => {
    const first: EnterpriseLicenseSnapshot =
      EnterpriseLicenseSnapshotUtil.createMissing();
    const second: EnterpriseLicenseSnapshot =
      EnterpriseLicenseSnapshotUtil.createMissing();

    expect(first).not.toBe(second);
    expect(first.features).not.toBe(second.features);
  });
});
