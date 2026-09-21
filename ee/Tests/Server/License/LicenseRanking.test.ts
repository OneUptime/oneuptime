import LicenseRanking, {
  GuardedLicenseUpdate,
} from "../../../Server/License/LicenseRanking";
import LicenseInputsUtil, {
  LICENSE_TERM_COLUMNS,
  LicenseInputs,
} from "../../../Server/License/LicenseInputs";
import { setTrustedLicenseKeysForTests } from "../../../Server/License/TrustedLicenseKeys";
import {
  LICENSE_GRACE_PERIOD_IN_DAYS,
  LICENSE_TRIAL_PERIOD_IN_DAYS,
} from "../../../Server/License/LicenseSettings";
import {
  EnterpriseLicenseSnapshot,
  EnterpriseLicenseStatus,
  EnterpriseLicenseVerification,
} from "Common/Server/Enterprise/EnterpriseLicenseSnapshot";
import LicenseClient from "../../../Server/License/LicenseClient";
import GlobalConfig from "Common/Models/DatabaseModels/GlobalConfig";
import PartialEntity from "Common/Types/Database/PartialEntity";
import {
  DAY_IN_MS,
  generateEd25519,
  KeyPair,
  legacyToken,
  signLicense,
  trustedEntryFor,
} from "./Helpers/LicenseTestKit";
import { afterEach, beforeEach, describe, expect, it } from "@jest/globals";

/*
 * Never downgrade: a license the license server sends back replaces the stored
 * one only when it classifies at least as well. Status first
 * (valid > grace > expired > missing > invalid), then verification
 * (verified > unverified > none); equal ranks are accepted.
 *
 * The failure this prevents: one misconfigured license server (a signing key
 * paired with the wrong kid, a fallback to legacy signing, a token for another
 * instance) replacing a working license on every installation within a day,
 * through the daily report.
 */

const SIGNING_KEY: KeyPair = generateEd25519();
const UNTRUSTED_KEY: KeyPair = generateEd25519();
const INSTANCE_ID: string = "5f8b7c6d5e4f3a2b1c0d9e8f";

const makeInputs: (overrides?: Partial<LicenseInputs>) => LicenseInputs = (
  overrides?: Partial<LicenseInputs>,
): LicenseInputs => {
  return {
    hasConfigRow: true,
    licenseKey: "acme-license-key",
    token: null,
    storedColumns: {},
    instanceId: INSTANCE_ID,
    currentUserCount: 5,
    instances: [],
    ...(overrides || {}),
  };
};

const snapshot: (
  status: EnterpriseLicenseStatus,
  verification: EnterpriseLicenseVerification,
) => EnterpriseLicenseSnapshot = (
  status: EnterpriseLicenseStatus,
  verification: EnterpriseLicenseVerification,
): EnterpriseLicenseSnapshot => {
  return {
    status,
    verification,
    userLimit: null,
    isEvaluation: false,
    features: "all",
  };
};

const legacyColumns: (expiresInDays: number) => LicenseInputs["storedColumns"] =
  (expiresInDays: number): LicenseInputs["storedColumns"] => {
    return {
      expiresAt: new Date(Date.now() + expiresInDays * DAY_IN_MS),
      companyName: "Acme Inc",
      userLimit: 10,
    };
  };

beforeEach(() => {
  setTrustedLicenseKeysForTests([trustedEntryFor(SIGNING_KEY)]);
});

afterEach(() => {
  setTrustedLicenseKeysForTests(null);
});

/*
 * The periods the classifier actually uses, not a copy of them: a test that
 * declared its own 14 would keep passing (against the wrong window) the day
 * the trial changed. Pinned as well, the way LicenseToken.test.ts pins them,
 * so a change to either constant is a deliberate one.
 */
describe("the periods these cases are built on", () => {
  it("are the classifier's own", () => {
    expect(LICENSE_TRIAL_PERIOD_IN_DAYS).toBe(14);
    expect(LICENSE_GRACE_PERIOD_IN_DAYS).toBe(30);
  });
});

describe("LicenseRanking.compare", () => {
  const ORDER: Array<EnterpriseLicenseSnapshot> = [
    snapshot("valid", "verified"),
    snapshot("valid", "unverified"),
    snapshot("grace", "verified"),
    snapshot("grace", "unverified"),
    snapshot("grace", "none"),
    snapshot("expired", "verified"),
    snapshot("expired", "unverified"),
    snapshot("missing", "none"),
    snapshot("invalid", "verified"),
    snapshot("invalid", "none"),
  ];

  it("orders by status first, then by verification", () => {
    for (let better: number = 0; better < ORDER.length; better++) {
      for (let worse: number = better + 1; worse < ORDER.length; worse++) {
        const a: EnterpriseLicenseSnapshot = ORDER[better]!;
        const b: EnterpriseLicenseSnapshot = ORDER[worse]!;

        expect({
          a: LicenseRanking.describe(a),
          b: LicenseRanking.describe(b),
          better: LicenseRanking.compare(a, b) > 0,
          worse: LicenseRanking.compare(b, a) < 0,
        }).toEqual({
          a: LicenseRanking.describe(a),
          b: LicenseRanking.describe(b),
          better: true,
          worse: true,
        });
      }
    }
  });

  it("accepts an equal rank (a renewal lands this way)", () => {
    expect(
      LicenseRanking.isAtLeastAsGood(
        snapshot("valid", "verified"),
        snapshot("valid", "verified"),
      ),
    ).toBe(true);
  });

  it("a current legacy license beats a verified one that already expired", () => {
    expect(
      LicenseRanking.isAtLeastAsGood(
        snapshot("expired", "verified"),
        snapshot("valid", "unverified"),
      ),
    ).toBe(false);
  });

  it("a verified license beats a legacy one of the same status", () => {
    expect(
      LicenseRanking.isAtLeastAsGood(
        snapshot("valid", "verified"),
        snapshot("valid", "unverified"),
      ),
    ).toBe(true);
    expect(
      LicenseRanking.isAtLeastAsGood(
        snapshot("valid", "unverified"),
        snapshot("valid", "verified"),
      ),
    ).toBe(false);
  });
});

describe("LicenseRanking.guardUpdate - what gets through", () => {
  it("passes an update that does not touch the token untouched", () => {
    const update: PartialEntity<GlobalConfig> = {
      enterpriseLicenseUserLimit: 500,
      enterpriseLicenseCurrentUserCount: 7,
    };

    const guarded: GuardedLicenseUpdate = LicenseRanking.guardUpdate({
      inputs: makeInputs({
        token: legacyToken(),
        storedColumns: legacyColumns(30),
      }),
      update,
      now: new Date(),
    });

    expect(guarded.downgrade).toBeNull();
    expect(guarded.update).toBe(update);
  });

  it("passes an update that carries the same token again", () => {
    const token: string = signLicense(SIGNING_KEY);

    const guarded: GuardedLicenseUpdate = LicenseRanking.guardUpdate({
      inputs: makeInputs({ token }),
      update: { enterpriseLicenseToken: token, enterpriseLicenseUserLimit: 1 },
      now: new Date(),
    });

    expect(guarded.downgrade).toBeNull();
  });

  it("upgrades a legacy license to a verified one", () => {
    const verified: string = signLicense(SIGNING_KEY);

    const guarded: GuardedLicenseUpdate = LicenseRanking.guardUpdate({
      inputs: makeInputs({
        token: legacyToken(),
        storedColumns: legacyColumns(30),
      }),
      update: { enterpriseLicenseToken: verified },
      now: new Date(),
    });

    expect(guarded.downgrade).toBeNull();
    expect(guarded.update.enterpriseLicenseToken).toBe(verified);
  });

  it("accepts a renewal of a verified license with a later expiry", () => {
    const renewal: string = signLicense(SIGNING_KEY, { daysFromNow: 400 });

    const guarded: GuardedLicenseUpdate = LicenseRanking.guardUpdate({
      inputs: makeInputs({
        token: signLicense(SIGNING_KEY, { daysFromNow: 10 }),
      }),
      update: { enterpriseLicenseToken: renewal },
      now: new Date(),
    });

    expect(guarded.downgrade).toBeNull();
  });

  it("accepts a renewed legacy token, judged by the expiry that comes with it", () => {
    const guarded: GuardedLicenseUpdate = LicenseRanking.guardUpdate({
      inputs: makeInputs({
        token: legacyToken("old"),
        storedColumns: legacyColumns(-3),
      }),
      update: {
        enterpriseLicenseToken: legacyToken("renewed"),
        enterpriseLicenseExpiresAt: new Date(Date.now() + 365 * DAY_IN_MS),
      },
      now: new Date(),
    });

    expect(guarded.downgrade).toBeNull();
  });

  it("accepts a first license on an unlicensed installation", () => {
    const guarded: GuardedLicenseUpdate = LicenseRanking.guardUpdate({
      inputs: makeInputs(),
      update: {
        enterpriseLicenseToken: legacyToken(),
        enterpriseLicenseExpiresAt: new Date(Date.now() + 30 * DAY_IN_MS),
      },
      now: new Date(),
    });

    expect(guarded.downgrade).toBeNull();
  });
});

describe("LicenseRanking.guardUpdate - what is refused", () => {
  const assertRefused: (
    guarded: GuardedLicenseUpdate,
    expectedCandidateStatus: EnterpriseLicenseStatus,
  ) => void = (
    guarded: GuardedLicenseUpdate,
    expectedCandidateStatus: EnterpriseLicenseStatus,
  ): void => {
    expect(guarded.downgrade).not.toBeNull();
    expect(guarded.downgrade?.candidate.status).toBe(expectedCandidateStatus);

    for (const column of LICENSE_TERM_COLUMNS) {
      expect(guarded.update).not.toHaveProperty(column as string);
    }
  };

  it("refuses a legacy token in place of a verified one", () => {
    const guarded: GuardedLicenseUpdate = LicenseRanking.guardUpdate({
      inputs: makeInputs({ token: signLicense(SIGNING_KEY) }),
      update: {
        enterpriseLicenseToken: legacyToken(),
        enterpriseLicenseExpiresAt: new Date(Date.now() + 30 * DAY_IN_MS),
        enterpriseLicenseUserLimit: 100_000,
      },
      now: new Date(),
    });

    assertRefused(guarded, "valid");
    expect(guarded.downgrade?.candidate.verification).toBe("unverified");
  });

  /*
   * The key-ceremony failure: the license server signs with a key whose kid
   * this build trusts but pairs it wrongly - a bad signature from a trusted
   * kid. Every installation would lose its license within a day.
   */
  it("refuses a token with a bad signature from a trusted key", () => {
    const good: string = signLicense(SIGNING_KEY);
    const forged: string = `${good.split(".").slice(0, 2).join(".")}.${signLicense(
      UNTRUSTED_KEY,
    ).split(".")[2]}`;

    const guarded: GuardedLicenseUpdate = LicenseRanking.guardUpdate({
      inputs: makeInputs({ token: good }),
      update: { enterpriseLicenseToken: forged },
      now: new Date(),
    });

    assertRefused(guarded, "invalid");
  });

  it("refuses a token bound to another instance", () => {
    const guarded: GuardedLicenseUpdate = LicenseRanking.guardUpdate({
      inputs: makeInputs({
        token: legacyToken(),
        storedColumns: legacyColumns(30),
      }),
      update: {
        enterpriseLicenseToken: signLicense(SIGNING_KEY, {
          instanceId: "another-instance",
        }),
      },
      now: new Date(),
    });

    assertRefused(guarded, "invalid");
    expect(guarded.downgrade?.candidate.reason).toBe("instance-mismatch");
  });

  it("refuses an expired token in place of a current one", () => {
    const guarded: GuardedLicenseUpdate = LicenseRanking.guardUpdate({
      inputs: makeInputs({ token: signLicense(SIGNING_KEY) }),
      update: {
        enterpriseLicenseToken: signLicense(SIGNING_KEY, { daysFromNow: -60 }),
      },
      now: new Date(),
    });

    assertRefused(guarded, "expired");
  });

  it("refuses garbage", () => {
    const guarded: GuardedLicenseUpdate = LicenseRanking.guardUpdate({
      inputs: makeInputs({ token: signLicense(SIGNING_KEY) }),
      update: { enterpriseLicenseToken: "signed.jwt.token" },
      now: new Date(),
    });

    assertRefused(guarded, "invalid");
  });

  /*
   * The server sending no token must not wipe a working license (activation
   * writes the token as null when the server sent none).
   */
  it("refuses to clear a working token", () => {
    const guarded: GuardedLicenseUpdate = LicenseRanking.guardUpdate({
      inputs: makeInputs({ token: signLicense(SIGNING_KEY) }),
      update: { enterpriseLicenseToken: null },
      now: new Date(),
    });

    assertRefused(guarded, "missing");
  });

  it("keeps the usage figures of a refused update", () => {
    const guarded: GuardedLicenseUpdate = LicenseRanking.guardUpdate({
      inputs: makeInputs({ token: signLicense(SIGNING_KEY) }),
      update: {
        enterpriseLicenseToken: "garbage.garbage.garbage",
        enterpriseLicenseExpiresAt: new Date("2099-01-01T00:00:00.000Z"),
        enterpriseLicenseUserLimit: 1_000_000,
        enterpriseLicenseIsEvaluation: false,
        enterpriseCompanyName: "Somebody Else",
        enterpriseLicenseCurrentUserCount: 12,
        enterpriseLicenseUserCountUpdatedAt: new Date(),
        enterpriseLicenseInstances: [],
      },
      now: new Date(),
    });

    expect(guarded.downgrade).not.toBeNull();
    expect(Object.keys(guarded.update).sort()).toEqual(
      [
        "enterpriseLicenseCurrentUserCount",
        "enterpriseLicenseInstances",
        "enterpriseLicenseUserCountUpdatedAt",
      ].sort(),
    );
  });

  it("does not modify the update it was given", () => {
    const update: PartialEntity<GlobalConfig> = {
      enterpriseLicenseToken: "garbage.garbage.garbage",
      enterpriseLicenseUserLimit: 1,
    };

    LicenseRanking.guardUpdate({
      inputs: makeInputs({ token: signLicense(SIGNING_KEY) }),
      update,
      now: new Date(),
    });

    expect(update.enterpriseLicenseToken).toBe("garbage.garbage.garbage");
    expect(update.enterpriseLicenseUserLimit).toBe(1);
  });

  /*
   * A current legacy license refused in favour of the verified one already
   * installed. The expiry is part of the candidate on purpose: without it the
   * returned license does not classify "valid" at all, and the two
   * descriptions below would not be what an administrator is shown.
   */
  it("explains a refusal in words an administrator can act on", () => {
    const guarded: GuardedLicenseUpdate = LicenseRanking.guardUpdate({
      inputs: makeInputs({ token: signLicense(SIGNING_KEY) }),
      update: {
        enterpriseLicenseToken: legacyToken(),
        enterpriseLicenseExpiresAt: new Date(Date.now() + 30 * DAY_IN_MS),
      },
      now: new Date(),
    });

    const message: string = LicenseRanking.describeDowngrade(
      guarded.downgrade!,
    );

    expect(message).toContain("valid (unverified)");
    expect(message).toContain("valid (verified)");
    expect(message).toContain("The installed license was kept.");
  });
});

/*
 * An update that keeps the token and changes only the TERMS beside it.
 *
 * The rule used to judge an update by its token alone: same token in, nothing
 * looked at. LicenseClient.mapValidationResponse always writes
 * enterpriseLicenseExpiresAt - as null when the response carried no expiresAt -
 * so a refresh that answered with the SAME token and no date nulled the stored
 * expiry, took the license from "valid" to "missing", and was written without
 * ever being ranked. That is the failure this rule exists to prevent, arriving
 * through the one door it was not watching.
 *
 * Every case here is a term change under an UNCHANGED token.
 */
describe("LicenseRanking.guardUpdate - the same token, different terms", () => {
  const now: Date = new Date();

  const installed: (
    storedColumns?: LicenseInputs["storedColumns"],
  ) => LicenseInputs = (
    storedColumns?: LicenseInputs["storedColumns"],
  ): LicenseInputs => {
    return makeInputs({
      token: legacyToken("installed"),
      storedColumns: storedColumns || {
        ...legacyColumns(200),
        enterpriseEditionFirstSeenAt: new Date(
          now.getTime() - 400 * DAY_IN_MS,
        ),
      },
    });
  };

  /*
   * The reviewer's scenario, end to end: a license-server answer with the
   * installed token and no expiresAt at all.
   */
  it("refuses an answer that repeats the token and drops the expiry", () => {
    const inputs: LicenseInputs = installed();
    const update: PartialEntity<GlobalConfig> =
      LicenseClient.mapValidationResponse({
        payload: { token: legacyToken("installed") },
        licenseKey: "acme-license-key",
        mode: "refresh",
      });

    // What the mapper really produces: the same token, and a null expiry.
    expect(update.enterpriseLicenseToken).toBe(inputs.token);
    expect(update.enterpriseLicenseExpiresAt).toBeNull();

    const guarded: GuardedLicenseUpdate = LicenseRanking.guardUpdate({
      inputs,
      update,
      now,
    });

    expect(guarded.downgrade).not.toBeNull();
    expect(guarded.downgrade?.current.status).toBe("valid");
    expect(guarded.downgrade?.candidate).toMatchObject({
      status: "missing",
      reason: "unverified-without-expiry-unlicensed",
    });

    for (const column of LICENSE_TERM_COLUMNS) {
      expect(guarded.update).not.toHaveProperty(column as string);
    }

    // The stored expiry survives: the installation is still licensed.
    expect(
      LicenseInputsUtil.classify(
        LicenseInputsUtil.withUpdate(inputs, guarded.update),
        now,
      ).status,
    ).toBe("valid");
  });

  it("refuses a bare null expiry, with no token in the update at all", () => {
    const guarded: GuardedLicenseUpdate = LicenseRanking.guardUpdate({
      inputs: installed(),
      update: { enterpriseLicenseExpiresAt: null },
      now,
    });

    expect(guarded.downgrade).not.toBeNull();
    expect(guarded.update).not.toHaveProperty("enterpriseLicenseExpiresAt");
  });

  it("refuses an expiry moved far enough back to lapse a working license", () => {
    const guarded: GuardedLicenseUpdate = LicenseRanking.guardUpdate({
      inputs: installed(),
      update: {
        enterpriseLicenseExpiresAt: new Date(
          now.getTime() -
            (LICENSE_GRACE_PERIOD_IN_DAYS + 5) * DAY_IN_MS,
        ),
      },
      now,
    });

    expect(guarded.downgrade?.current.status).toBe("valid");
    expect(guarded.downgrade?.candidate.status).toBe("expired");
  });

  /*
   * The renewal, which is the reason this rule accepts equal ranks and must
   * keep accepting them: the same license, the same token, a later date.
   */
  it("accepts the same token with a LATER expiry - a renewal", () => {
    const renewed: Date = new Date(now.getTime() + 500 * DAY_IN_MS);
    const inputs: LicenseInputs = installed();

    const guarded: GuardedLicenseUpdate = LicenseRanking.guardUpdate({
      inputs,
      update: {
        enterpriseLicenseToken: inputs.token,
        enterpriseLicenseExpiresAt: renewed,
      },
      now,
    });

    expect(guarded.downgrade).toBeNull();
    expect(guarded.update.enterpriseLicenseExpiresAt).toEqual(renewed);
    expect(
      LicenseInputsUtil.classify(
        LicenseInputsUtil.withUpdate(inputs, guarded.update),
        now,
      ).expiresAt,
    ).toEqual(renewed);
  });

  /*
   * A shorter term that is still current. The customer agreed to it, the
   * license still classifies "valid", and the date tie-break never runs
   * because the terms are only ranked once the status or verification ties -
   * which they do here, at "valid (unverified)" on both sides... so the date
   * DOES decide, and an earlier-but-still-valid date is a smaller
   * entitlement. It is refused, and that is the conservative half of this
   * rule: a shortening that is real reaches the installation the next time
   * the license server sends a token to go with it.
   */
  it("refuses an earlier expiry even while it would still be current", () => {
    const guarded: GuardedLicenseUpdate = LicenseRanking.guardUpdate({
      inputs: installed(),
      update: {
        enterpriseLicenseExpiresAt: new Date(now.getTime() + 10 * DAY_IN_MS),
      },
      now,
    });

    expect(guarded.downgrade).not.toBeNull();
    expect([
      guarded.downgrade?.current.status,
      guarded.downgrade?.candidate.status,
    ]).toEqual(["valid", "valid"]);
  });

  it("accepts a seat-limit increase, which does not touch the dates", () => {
    const guarded: GuardedLicenseUpdate = LicenseRanking.guardUpdate({
      inputs: installed(),
      update: { enterpriseLicenseUserLimit: 5000 },
      now,
    });

    expect(guarded.downgrade).toBeNull();
    expect(guarded.update.enterpriseLicenseUserLimit).toBe(5000);
  });

  it("accepts an evaluation license turning into a paid one", () => {
    const inputs: LicenseInputs = installed({
      ...legacyColumns(20),
      isEvaluation: true,
      enterpriseEditionFirstSeenAt: new Date(now.getTime() - 400 * DAY_IN_MS),
    });

    const guarded: GuardedLicenseUpdate = LicenseRanking.guardUpdate({
      inputs,
      update: {
        enterpriseLicenseToken: inputs.token,
        enterpriseLicenseExpiresAt: new Date(now.getTime() + 365 * DAY_IN_MS),
        enterpriseLicenseIsEvaluation: false,
        enterpriseLicenseUserLimit: 500,
        enterpriseCompanyName: "Acme Inc",
      },
      now,
    });

    expect(guarded.downgrade).toBeNull();
    expect(
      LicenseInputsUtil.classify(
        LicenseInputsUtil.withUpdate(inputs, guarded.update),
        now,
      ),
    ).toMatchObject({ status: "valid", isEvaluation: false, userLimit: 500 });
  });

  /*
   * Re-activating the license this installation already holds, unchanged. The
   * terms are identical, so there is nothing to rank at all - and it must not
   * be classified for nothing either.
   */
  it("passes an identical re-activation through without classifying it", () => {
    const inputs: LicenseInputs = installed();
    const update: PartialEntity<GlobalConfig> = {
      enterpriseLicenseToken: inputs.token,
      enterpriseLicenseExpiresAt: new Date(
        inputs.storedColumns.expiresAt!.getTime(),
      ),
      enterpriseLicenseUserLimit: inputs.storedColumns.userLimit ?? null,
      enterpriseLicenseIsEvaluation: false,
      enterpriseCompanyName: inputs.storedColumns.companyName ?? null,
      enterpriseLicenseCurrentUserCount: 99,
    };

    const guarded: GuardedLicenseUpdate = LicenseRanking.guardUpdate({
      inputs,
      update,
      now,
    });

    expect(guarded.downgrade).toBeNull();
    // Not merely accepted: returned untouched, so nothing was ranked.
    expect(guarded.update).toBe(update);
  });

  /*
   * An older license server, or one mid-deploy, answering with less than it
   * used to: the token and the expiry, but no seat limit and no company name.
   * The license still classifies "valid (unverified)" on the same date, so it
   * lands - dropping a seat limit under-enforces, which is the safe direction.
   */
  it("accepts an answer that carries less detail but the same dates", () => {
    const inputs: LicenseInputs = installed();

    const guarded: GuardedLicenseUpdate = LicenseRanking.guardUpdate({
      inputs,
      update: {
        enterpriseLicenseToken: inputs.token,
        enterpriseLicenseExpiresAt: inputs.storedColumns.expiresAt ?? null,
        enterpriseLicenseUserLimit: null,
        enterpriseCompanyName: null,
      },
      now,
    });

    expect(guarded.downgrade).toBeNull();
    expect(
      LicenseInputsUtil.classify(
        LicenseInputsUtil.withUpdate(inputs, guarded.update),
        now,
      ),
    ).toMatchObject({ status: "valid", userLimit: null });
  });

  it("does not classify an update that changes nothing but the usage figures", () => {
    const inputs: LicenseInputs = installed();
    const update: PartialEntity<GlobalConfig> = {
      enterpriseLicenseCurrentUserCount: 12,
      enterpriseLicenseInstances: [],
    };

    const guarded: GuardedLicenseUpdate = LicenseRanking.guardUpdate({
      inputs,
      update,
      now,
    });

    expect(guarded.downgrade).toBeNull();
    expect(guarded.update).toBe(update);
  });
});

describe("LicenseInputsUtil - the inputs behind the ranking", () => {
  it("overlays an update on the stored inputs, leaving absent keys alone", () => {
    const inputs: LicenseInputs = makeInputs({
      token: "old.token.value",
      storedColumns: legacyColumns(30),
    });

    const merged: LicenseInputs = LicenseInputsUtil.withUpdate(inputs, {
      enterpriseLicenseUserLimit: null,
      enterpriseCompanyName: "New Name",
    });

    expect(merged.token).toBe("old.token.value");
    expect(merged.storedColumns.userLimit).toBeNull();
    expect(merged.storedColumns.companyName).toBe("New Name");
    expect(merged.storedColumns.expiresAt).toEqual(
      inputs.storedColumns.expiresAt,
    );
    expect(merged.currentUserCount).toBe(5);
  });

  it("recognises an offline-activated installation: a token and no key", () => {
    expect(
      LicenseInputsUtil.isOfflineActivated(
        makeInputs({ token: "t.t.t", licenseKey: null }),
      ),
    ).toBe(true);
    expect(
      LicenseInputsUtil.isOfflineActivated(makeInputs({ token: "t.t.t" })),
    ).toBe(false);
    expect(
      LicenseInputsUtil.isOfflineActivated(makeInputs({ licenseKey: null })),
    ).toBe(false);
  });

  it("reads the stored row defensively", () => {
    const config: GlobalConfig = new GlobalConfig();
    config.enterpriseLicenseKey = "   ";
    config.enterpriseLicenseToken = "";
    (config as unknown as Record<string, unknown>)[
      "enterpriseLicenseExpiresAt"
    ] = "not a date";
    (config as unknown as Record<string, unknown>)[
      "enterpriseLicenseInstances"
    ] = "not-an-array";
    config.enterpriseLicenseUserLimit = Number.NaN;

    const inputs: LicenseInputs = LicenseInputsUtil.fromGlobalConfig(config);

    expect(inputs.hasConfigRow).toBe(true);
    expect(inputs.licenseKey).toBeNull();
    expect(inputs.token).toBeNull();
    expect(inputs.storedColumns.expiresAt).toBeNull();
    expect(inputs.storedColumns.userLimit).toBeNull();
    expect(inputs.instances).toEqual([]);
  });

  it("reads a missing row as no license at all", () => {
    const inputs: LicenseInputs = LicenseInputsUtil.fromGlobalConfig(null);

    expect(inputs.hasConfigRow).toBe(false);
    expect(LicenseInputsUtil.classify(inputs, new Date()).status).toBe(
      "missing",
    );
  });
});

/*
 * The never-downgrade rule meeting a license the server sent with a token but
 * no expiry (activation and refresh write enterpriseLicenseExpiresAt as null
 * when the response carries no expiresAt - LicenseClient.mapValidationResponse).
 *
 * That candidate now classifies as the unlicensed trial rather than "invalid",
 * so its rank moved from the bottom (invalid, 0) to the trial's (grace, 3, or
 * missing, 1, once the trial is over). What must hold either way: it cannot
 * displace a stored license that classifies better, and it can still replace
 * one that classifies worse. If this regresses, one license-server response
 * without an expiresAt could take a working license off every installation.
 */
describe("LicenseRanking.guardUpdate - a candidate with a token and no expiry", () => {
  const TRIAL_DAYS: number = LICENSE_TRIAL_PERIOD_IN_DAYS;

  const firstSeen: (daysAgo: number) => Date = (daysAgo: number): Date => {
    return new Date(Date.now() - daysAgo * DAY_IN_MS);
  };

  it("cannot displace a current license: the stored terms are kept", () => {
    const guarded: GuardedLicenseUpdate = LicenseRanking.guardUpdate({
      inputs: makeInputs({
        token: legacyToken("installed"),
        storedColumns: {
          ...legacyColumns(30),
          enterpriseEditionFirstSeenAt: firstSeen(2),
        },
      }),
      update: {
        enterpriseLicenseToken: legacyToken("returned"),
        enterpriseLicenseExpiresAt: null,
      },
      now: new Date(),
    });

    expect(guarded.downgrade).not.toBeNull();
    expect(guarded.downgrade?.current.status).toBe("valid");
    expect(guarded.downgrade?.candidate).toMatchObject({
      status: "grace",
      verification: "unverified",
      reason: "unverified-without-expiry-unlicensed",
    });

    for (const column of LICENSE_TERM_COLUMNS) {
      expect(guarded.update).not.toHaveProperty(column as string);
    }
  });

  /*
   * The ordinary installation: it has been running far longer than the trial,
   * so a response without an expiry classifies "missing" and is refused - a
   * license in its 30-day grace period is not swapped for a lapsed trial.
   */
  it("cannot displace a licensed grace period on an install older than the trial", () => {
    const guarded: GuardedLicenseUpdate = LicenseRanking.guardUpdate({
      inputs: makeInputs({
        token: legacyToken("installed"),
        storedColumns: {
          ...legacyColumns(-3),
          enterpriseEditionFirstSeenAt: firstSeen(400),
        },
      }),
      update: {
        enterpriseLicenseToken: legacyToken("returned"),
        enterpriseLicenseExpiresAt: null,
      },
      now: new Date(),
    });

    expect(guarded.downgrade).not.toBeNull();
    expect(guarded.downgrade?.current.status).toBe("grace");
    expect(guarded.downgrade?.candidate.status).toBe("missing");
  });

  it("cannot displace a verified license", () => {
    const guarded: GuardedLicenseUpdate = LicenseRanking.guardUpdate({
      inputs: makeInputs({
        token: signLicense(SIGNING_KEY),
        storedColumns: { enterpriseEditionFirstSeenAt: firstSeen(2) },
      }),
      update: {
        enterpriseLicenseToken: legacyToken("returned"),
        enterpriseLicenseExpiresAt: null,
      },
      now: new Date(),
    });

    expect(guarded.downgrade).not.toBeNull();
    expect(guarded.downgrade?.current.verification).toBe("verified");
  });

  /*
   * The other direction: it outranks what it should outrank. A stored token
   * that classifies invalid (garbage, or another instance's license) is worse
   * than a trial, so the returned license is stored - which is the only way
   * an installation in that state ever recovers through the daily sync.
   */
  it("replaces a stored token that classifies invalid", () => {
    const returned: string = legacyToken("returned");
    const inputs: LicenseInputs = makeInputs({
      token: "garbage.garbage.garbage",
      storedColumns: { enterpriseEditionFirstSeenAt: firstSeen(2) },
    });

    const guarded: GuardedLicenseUpdate = LicenseRanking.guardUpdate({
      inputs,
      update: {
        enterpriseLicenseToken: returned,
        enterpriseLicenseExpiresAt: null,
      },
      now: new Date(),
    });

    expect(guarded.downgrade).toBeNull();
    expect(guarded.update.enterpriseLicenseToken).toBe(returned);

    /*
     * The write alone proves nothing here: before the no-expiry candidate was
     * classified as the trial it classified "invalid" too, and invalid against
     * invalid is an equal rank, which is accepted. What this case is for is
     * that the candidate OUTRANKS the garbage it replaces - so assert what it
     * actually classifies as, and that the install is usable afterwards.
     */
    expect(
      LicenseInputsUtil.classify(inputs, new Date()),
    ).toMatchObject({ status: "invalid" });
    expect(
      LicenseInputsUtil.classify(
        LicenseInputsUtil.withUpdate(inputs, guarded.update),
        new Date(),
      ),
    ).toMatchObject({
      status: "grace",
      verification: "unverified",
      graceReason: "unlicensed",
      reason: "unverified-without-expiry-unlicensed",
    });
  });

  it("is accepted onto an unlicensed installation, inside or outside its trial", () => {
    for (const daysSinceFirstRun of [2, 400]) {
      const guarded: GuardedLicenseUpdate = LicenseRanking.guardUpdate({
        inputs: makeInputs({
          token: null,
          storedColumns: {
            enterpriseEditionFirstSeenAt: firstSeen(daysSinceFirstRun),
          },
        }),
        update: {
          enterpriseLicenseToken: legacyToken("returned"),
          enterpriseLicenseExpiresAt: null,
        },
        now: new Date(),
      });

      // Equal status, better verification: a token IS installed now.
      expect(guarded.downgrade).toBeNull();
    }
  });

  it("is outranked by a real license the server sends later", () => {
    const guarded: GuardedLicenseUpdate = LicenseRanking.guardUpdate({
      inputs: makeInputs({
        token: legacyToken("installed"),
        storedColumns: { enterpriseEditionFirstSeenAt: firstSeen(2) },
      }),
      update: {
        enterpriseLicenseToken: legacyToken("returned"),
        enterpriseLicenseExpiresAt: new Date(Date.now() + 365 * DAY_IN_MS),
      },
      now: new Date(),
    });

    expect(guarded.downgrade).toBeNull();
    expect(
      LicenseInputsUtil.classify(
        LicenseInputsUtil.withUpdate(
          makeInputs({
            token: legacyToken("installed"),
            storedColumns: { enterpriseEditionFirstSeenAt: firstSeen(2) },
          }),
          guarded.update,
        ),
        new Date(),
      ),
    ).toMatchObject({ status: "valid", reason: "unverified" });
  });

  /*
   * The case the coarse rank could not see, and got wrong.
   *
   * An install still inside its trial whose license expired days ago is
   * grace/unverified either way, so status and verification tie - and a tie is
   * accepted, because that is how a renewal lands. But the two grace periods
   * end on completely different days: the stored license runs to
   * expiry + graceDays, the no-expiry candidate only to first run + trialDays.
   * Here that is 27 days against 2. Accepting the tie left the installation
   * "fully entitled" for a fortnight less than it had paid for, and nothing in
   * the rank could tell.
   *
   * So the tie is now broken on the date entitlement actually ends, and a
   * candidate that would shorten it is refused with every other license term.
   */
  it("refuses a no-expiry token that would end a licensed grace period sooner", () => {
    const inputs: LicenseInputs = makeInputs({
      token: legacyToken("installed"),
      storedColumns: {
        ...legacyColumns(-3),
        enterpriseEditionFirstSeenAt: firstSeen(TRIAL_DAYS - 2),
      },
    });
    const update: PartialEntity<GlobalConfig> = {
      enterpriseLicenseToken: legacyToken("returned"),
      enterpriseLicenseExpiresAt: null,
    };
    const now: Date = new Date();
    const guarded: GuardedLicenseUpdate = LicenseRanking.guardUpdate({
      inputs,
      update,
      now,
    });

    expect(guarded.downgrade).not.toBeNull();
    // Same status and same verification on both sides: only the date decides.
    expect(guarded.downgrade?.current).toMatchObject({
      status: "grace",
      verification: "unverified",
      graceReason: "expired",
    });
    expect(guarded.downgrade?.candidate).toMatchObject({
      status: "grace",
      verification: "unverified",
      graceReason: "unlicensed",
    });

    for (const column of LICENSE_TERM_COLUMNS) {
      expect(guarded.update).not.toHaveProperty(column as string);
    }

    /*
     * What the refusal protects, in days. The stored license expired 3 days
     * ago, so its grace runs to LICENSE_GRACE_PERIOD_IN_DAYS - 3 days from
     * now (27). The install first ran TRIAL_DAYS - 2 days ago, so the trial
     * the candidate would put it on runs 2 more days. 25 days of entitlement.
     */
    const daysFromNow: (at: Date) => number = (at: Date): number => {
      return Math.round((at.getTime() - now.getTime()) / DAY_IN_MS);
    };

    expect(daysFromNow(guarded.downgrade!.current.graceEndsAt!)).toBe(
      LICENSE_GRACE_PERIOD_IN_DAYS - 3,
    );
    expect(daysFromNow(guarded.downgrade!.candidate.graceEndsAt!)).toBe(2);
  });

  /*
   * The reverse: the no-expiry candidate would END LATER than what is stored,
   * so the tie-break accepts it. An install two days old whose license expired
   * a month ago is in the last days of its licensed grace; the trial runs
   * longer. Nothing is taken away, so nothing is refused.
   */
  it("is accepted when it would end the entitlement later, not sooner", () => {
    const inputs: LicenseInputs = makeInputs({
      token: legacyToken("installed"),
      storedColumns: {
        ...legacyColumns(-(LICENSE_GRACE_PERIOD_IN_DAYS - 1)),
        enterpriseEditionFirstSeenAt: firstSeen(1),
      },
    });

    const guarded: GuardedLicenseUpdate = LicenseRanking.guardUpdate({
      inputs,
      update: {
        enterpriseLicenseToken: legacyToken("returned"),
        enterpriseLicenseExpiresAt: null,
      },
      now: new Date(),
    });

    expect(guarded.downgrade).toBeNull();

    const before: EnterpriseLicenseSnapshot = LicenseInputsUtil.classify(
      inputs,
      new Date(),
    );
    const after: EnterpriseLicenseSnapshot = LicenseInputsUtil.classify(
      LicenseInputsUtil.withUpdate(inputs, guarded.update),
      new Date(),
    );

    expect([before.status, after.status]).toEqual(["grace", "grace"]);
    expect(after.graceEndsAt!.getTime()).toBeGreaterThan(
      before.graceEndsAt!.getTime(),
    );
  });

  /*
   * A stored license that is VERIFIED but long expired - its grace is over, so
   * the installation has nothing - against a no-expiry candidate on an install
   * still inside its trial. grace (3) outranks expired (2), so this is
   * accepted on status, before verification or the date is reached, and the
   * install gets the rest of its trial back.
   *
   * Deliberate, and worth stating: a verified license is more trustworthy but
   * a dead one entitles nothing, which is the same reason a current legacy
   * license beats an expired verified one at the top of this file. The date
   * tie-break cannot reach here (the statuses differ), and it would say the
   * same thing if it could: the stored grace ended a month ago, the trial has
   * days left.
   */
  it("replaces a verified license whose grace is over, on an install still in its trial", () => {
    const inputs: LicenseInputs = makeInputs({
      token: signLicense(SIGNING_KEY, { daysFromNow: -60 }),
      storedColumns: { enterpriseEditionFirstSeenAt: firstSeen(2) },
    });

    const guarded: GuardedLicenseUpdate = LicenseRanking.guardUpdate({
      inputs,
      update: {
        enterpriseLicenseToken: legacyToken("returned"),
        enterpriseLicenseExpiresAt: null,
      },
      now: new Date(),
    });

    expect(LicenseInputsUtil.classify(inputs, new Date())).toMatchObject({
      status: "expired",
      verification: "verified",
    });
    expect(guarded.downgrade).toBeNull();
    expect(
      LicenseInputsUtil.classify(
        LicenseInputsUtil.withUpdate(inputs, guarded.update),
        new Date(),
      ),
    ).toMatchObject({
      status: "grace",
      verification: "unverified",
      graceReason: "unlicensed",
    });
  });

  /*
   * The same stored verified-but-expired license on an install whose trial is
   * long over. Now both sides are unusable, the candidate is "missing" (1)
   * against "expired" (2), and it is refused - a fresher token buys nothing
   * when neither entitles anything.
   */
  it("does not replace a verified expired license once the trial is over too", () => {
    const guarded: GuardedLicenseUpdate = LicenseRanking.guardUpdate({
      inputs: makeInputs({
        token: signLicense(SIGNING_KEY, { daysFromNow: -60 }),
        storedColumns: { enterpriseEditionFirstSeenAt: firstSeen(400) },
      }),
      update: {
        enterpriseLicenseToken: legacyToken("returned"),
        enterpriseLicenseExpiresAt: null,
      },
      now: new Date(),
    });

    expect(guarded.downgrade).not.toBeNull();
    expect(guarded.downgrade?.current.status).toBe("expired");
    expect(guarded.downgrade?.candidate.status).toBe("missing");
  });
});
