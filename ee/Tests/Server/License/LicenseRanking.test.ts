import LicenseRanking, {
  GuardedLicenseUpdate,
} from "../../../Server/License/LicenseRanking";
import LicenseInputsUtil, {
  LICENSE_TERM_COLUMNS,
  LicenseInputs,
} from "../../../Server/License/LicenseInputs";
import { setTrustedLicenseKeysForTests } from "../../../Server/License/TrustedLicenseKeys";
import {
  EnterpriseLicenseSnapshot,
  EnterpriseLicenseStatus,
  EnterpriseLicenseVerification,
} from "Common/Server/Enterprise/EnterpriseLicenseSnapshot";
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
  const TRIAL_DAYS: number = 14;

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

    const guarded: GuardedLicenseUpdate = LicenseRanking.guardUpdate({
      inputs: makeInputs({
        token: "garbage.garbage.garbage",
        storedColumns: { enterpriseEditionFirstSeenAt: firstSeen(2) },
      }),
      update: {
        enterpriseLicenseToken: returned,
        enterpriseLicenseExpiresAt: null,
      },
      now: new Date(),
    });

    expect(guarded.downgrade).toBeNull();
    expect(guarded.update.enterpriseLicenseToken).toBe(returned);
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
   * Pinned because it is the one case the coarse rank cannot see: an install
   * still inside its trial whose license expired days ago is grace/unverified
   * either way, and equal ranks are accepted (that is how a renewal lands).
   * The install stays fully entitled across the swap - only the date it would
   * lapse on moves, from expiry + graceDays to first run + trialDays. The
   * ranking has never compared dates (a verified renewal with an earlier
   * expiry is accepted too); if that is ever wanted it is a deliberate change
   * to LicenseRanking, not a side effect of this classification.
   */
  it("ties with a licensed grace period inside the trial window, and a tie is accepted", () => {
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
    const guarded: GuardedLicenseUpdate = LicenseRanking.guardUpdate({
      inputs,
      update,
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

    expect(LicenseRanking.compare(after, before)).toBe(0);
    // Both usable: the installation keeps every enterprise feature.
    expect([before.status, after.status]).toEqual(["grace", "grace"]);
  });
});
