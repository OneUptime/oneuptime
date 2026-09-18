import { describe, expect, test } from "@jest/globals";
import EnterpriseFeature, {
  ALL_ENTERPRISE_FEATURES,
  ENTERPRISE_FEATURE_WILDCARD,
  parseEnterpriseFeature,
} from "../../../Server/Enterprise/EnterpriseFeature";
import {
  ENTERPRISE_LICENSE_GRACE_PERIOD_IN_DAYS,
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
    expect(EnterpriseFeature.SSO).toBe("sso");
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
        "sso",
        "team-compliance",
      ].sort(),
    );
    expect(new Set(ALL_ENTERPRISE_FEATURES).size).toBe(
      ALL_ENTERPRISE_FEATURES.length,
    );
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
    "SSO",
    " sso",
    "sso ",
    "future-feature",
    "",
    null,
    undefined,
    7,
    ["sso"],
    { feature: "sso" },
  ] as Array<unknown>)(
    "parseEnterpriseFeature rejects %p without throwing",
    (value: unknown) => {
      expect(parseEnterpriseFeature(value)).toBeNull();
    },
  );
});

describe("EnterpriseLicenseSnapshotUtil", () => {
  test("the grace period is fourteen days", () => {
    expect(ENTERPRISE_LICENSE_GRACE_PERIOD_IN_DAYS).toBe(14);
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
        EnterpriseFeature.SSO,
      ),
    ).toBe(false);
    expect(
      EnterpriseLicenseSnapshotUtil.entitles(null, EnterpriseFeature.SSO),
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
      features: [EnterpriseFeature.SSO, EnterpriseFeature.AuditLogs],
    });

    expect(
      EnterpriseLicenseSnapshotUtil.includesFeature(
        snapshot,
        EnterpriseFeature.SSO,
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
          EnterpriseFeature.SSO,
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
          features: [EnterpriseFeature.SSO],
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

  test("createMissing returns a fresh object each time", () => {
    const first: EnterpriseLicenseSnapshot =
      EnterpriseLicenseSnapshotUtil.createMissing();
    const second: EnterpriseLicenseSnapshot =
      EnterpriseLicenseSnapshotUtil.createMissing();

    expect(first).not.toBe(second);
    expect(first.features).not.toBe(second.features);
  });
});
