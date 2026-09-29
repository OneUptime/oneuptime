import EnterpriseLicenseUsageUtil from "../../Utils/EnterpriseLicense/EnterpriseLicenseUsage";
import OneUptimeDate from "../../Types/Date";
import EnterpriseLicenseUserCountSource from "../../Types/EnterpriseLicense/EnterpriseLicenseUserCountSource";
import { describe, expect, it } from "@jest/globals";

type HashFunction = (seed: string) => string;

// Deterministic fake SHA-256-shaped hex string for tests.
const fakeHash: HashFunction = (seed: string): string => {
  return seed
    .repeat(64)
    .replace(/[^a-f0-9]/g, "a")
    .substring(0, 64);
};

describe("EnterpriseLicenseUsageUtil.sanitizeUserEmailHashes", () => {
  it("returns empty array for non-array input", () => {
    expect(EnterpriseLicenseUsageUtil.sanitizeUserEmailHashes(null)).toEqual(
      [],
    );
    expect(
      EnterpriseLicenseUsageUtil.sanitizeUserEmailHashes("not-an-array"),
    ).toEqual([]);
    expect(EnterpriseLicenseUsageUtil.sanitizeUserEmailHashes({})).toEqual([]);
  });

  it("keeps only valid sha256 hex strings and normalizes case", () => {
    const valid: string = fakeHash("1");

    const result: Array<string> =
      EnterpriseLicenseUsageUtil.sanitizeUserEmailHashes([
        valid.toUpperCase(),
        ` ${valid} `,
        "short",
        12345,
        "z".repeat(64), // not hex
        null,
      ]);

    expect(result).toEqual([valid]);
  });

  it("removes duplicates", () => {
    const a: string = fakeHash("a");
    const b: string = fakeHash("b");

    const result: Array<string> =
      EnterpriseLicenseUsageUtil.sanitizeUserEmailHashes([a, b, a, b, a]);

    expect(result.sort()).toEqual([a, b].sort());
  });
});

describe("EnterpriseLicenseUsageUtil.isInstanceCountedTowardsUsage", () => {
  const now: Date = new Date("2026-09-02T12:00:00.000Z");
  const inactiveAt: Date = new Date(
    now.getTime() -
      EnterpriseLicenseUsageUtil.InstanceUsageFreshnessInDays *
        24 *
        60 *
        60 *
        1000,
  );

  it("uses a seven-day inactivity window", () => {
    expect(EnterpriseLicenseUsageUtil.InstanceUsageFreshnessInDays).toBe(7);
  });

  it("keeps an instance active until the full week has elapsed", () => {
    expect(
      EnterpriseLicenseUsageUtil.isInstanceCountedTowardsUsage(
        {
          lastReportedAt: new Date(inactiveAt.getTime() + 1),
        },
        now,
      ),
    ).toBe(true);
  });

  it("marks an instance inactive at exactly seven days without communication", () => {
    expect(
      EnterpriseLicenseUsageUtil.isInstanceCountedTowardsUsage(
        {
          lastReportedAt: inactiveAt,
        },
        now,
      ),
    ).toBe(false);
  });

  it("keeps an instance inactive after more than seven days", () => {
    expect(
      EnterpriseLicenseUsageUtil.isInstanceCountedTowardsUsage(
        {
          lastReportedAt: new Date(inactiveAt.getTime() - 1),
        },
        now,
      ),
    ).toBe(false);
  });

  it("keeps a newly registered instance active before its first usage report", () => {
    expect(
      EnterpriseLicenseUsageUtil.isInstanceCountedTowardsUsage(
        {
          createdAt: new Date(inactiveAt.getTime() + 1),
        },
        now,
      ),
    ).toBe(true);
  });

  it("marks an unreported registration inactive at its exact one-week boundary", () => {
    expect(
      EnterpriseLicenseUsageUtil.isInstanceCountedTowardsUsage(
        {
          createdAt: inactiveAt,
        },
        now,
      ),
    ).toBe(false);
  });

  it("treats an instance with no known communication timestamp as inactive", () => {
    expect(
      EnterpriseLicenseUsageUtil.isInstanceCountedTowardsUsage({}, now),
    ).toBe(false);
  });

  it("accepts a current or future report as active", () => {
    expect(
      EnterpriseLicenseUsageUtil.isInstanceCountedTowardsUsage(
        { lastReportedAt: now },
        now,
      ),
    ).toBe(true);
    expect(
      EnterpriseLicenseUsageUtil.isInstanceCountedTowardsUsage(
        {
          lastReportedAt: OneUptimeDate.addRemoveDays(now, 1),
        },
        now,
      ),
    ).toBe(true);
  });

  it("fails closed for an invalid report timestamp", () => {
    expect(
      EnterpriseLicenseUsageUtil.isInstanceCountedTowardsUsage(
        { lastReportedAt: new Date("not-a-date") },
        now,
      ),
    ).toBe(false);
  });

  it("uses a real usage report in preference to the registration time", () => {
    const reportedAt: Date = OneUptimeDate.addRemoveDays(now, -1);

    expect(
      EnterpriseLicenseUsageUtil.getInstanceLastCommunicatedAt({
        createdAt: OneUptimeDate.addRemoveDays(now, -3),
        lastReportedAt: reportedAt,
      }),
    ).toBe(reportedAt);
  });
});

describe("EnterpriseLicenseUsageUtil.hasActiveReportedInstanceUsage", () => {
  const now: Date = new Date("2026-09-02T12:00:00.000Z");

  it("does not treat registration alone as authoritative seat data", () => {
    expect(
      EnterpriseLicenseUsageUtil.hasActiveReportedInstanceUsage(
        [{ createdAt: now }],
        now,
      ),
    ).toBe(false);
  });

  it("is authoritative while an instance usage report remains active", () => {
    expect(
      EnterpriseLicenseUsageUtil.hasActiveReportedInstanceUsage(
        [
          { createdAt: now },
          { lastReportedAt: new Date("2026-09-01T12:00:00.000Z") },
        ],
        now,
      ),
    ).toBe(true);
  });

  it("stops suppressing legacy reports once every modern report is inactive", () => {
    expect(
      EnterpriseLicenseUsageUtil.hasActiveReportedInstanceUsage(
        [{ lastReportedAt: new Date("2026-08-26T12:00:00.000Z") }],
        now,
      ),
    ).toBe(false);
  });
});

describe("EnterpriseLicenseUsageUtil.getEffectiveUserCount", () => {
  const now: Date = new Date("2026-09-02T12:00:00.000Z");
  const oneMillisecondBeforeInactive: Date = new Date(
    now.getTime() -
      EnterpriseLicenseUsageUtil.InstanceUsageFreshnessInDays *
        24 *
        60 *
        60 *
        1000 +
      1,
  );
  const inactiveAt: Date = new Date(oneMillisecondBeforeInactive.getTime() - 1);

  it("uses modern per-instance reports instead of the stored legacy count", () => {
    expect(
      EnterpriseLicenseUsageUtil.getEffectiveUserCount({
        instances: [
          {
            lastReportedAt: oneMillisecondBeforeInactive,
            userCount: 3,
          },
        ],
        storedUserCount: 99,
        storedUserCountUpdatedAt: now,
        now,
      }),
    ).toBe(3);
  });

  it("preserves a recently reported legacy count without instance rows", () => {
    expect(
      EnterpriseLicenseUsageUtil.getEffectiveUserCount({
        instances: [],
        storedUserCount: 17,
        storedUserCountUpdatedAt: oneMillisecondBeforeInactive,
        now,
      }),
    ).toBe(17);
  });

  it("uses a separately tracked legacy heartbeat after every modern instance becomes stale", () => {
    expect(
      EnterpriseLicenseUsageUtil.getEffectiveUserCount({
        instances: [
          {
            lastReportedAt: inactiveAt,
            userCount: 99,
          },
        ],
        storedUserCount: 99,
        storedUserCountUpdatedAt: inactiveAt,
        legacyUserCount: 17,
        legacyUserCountUpdatedAt: oneMillisecondBeforeInactive,
        now,
      }),
    ).toBe(17);
  });

  it("keeps active modern usage authoritative over a fresh legacy heartbeat", () => {
    expect(
      EnterpriseLicenseUsageUtil.getEffectiveUserCount({
        instances: [
          {
            lastReportedAt: oneMillisecondBeforeInactive,
            userCount: 3,
          },
        ],
        storedUserCount: 3,
        storedUserCountUpdatedAt: oneMillisecondBeforeInactive,
        legacyUserCount: 17,
        legacyUserCountUpdatedAt: now,
        now,
      }),
    ).toBe(3);
  });

  it("does not let a newer registration preserve an inactive modern aggregate", () => {
    expect(
      EnterpriseLicenseUsageUtil.getEffectiveUserCount({
        instances: [
          {
            lastReportedAt: inactiveAt,
            userCount: 99,
          },
          {
            createdAt: now,
          },
        ],
        storedUserCount: 99,
        storedUserCountUpdatedAt: inactiveAt,
        now,
      }),
    ).toBe(0);
  });

  it("uses a retained legacy heartbeat as soon as modern usage expires", () => {
    expect(
      EnterpriseLicenseUsageUtil.getEffectiveUserCount({
        instances: [
          {
            lastReportedAt: inactiveAt,
            userCount: 99,
          },
        ],
        storedUserCount: 99,
        storedUserCountUpdatedAt: inactiveAt,
        legacyUserCount: 17,
        legacyUserCountUpdatedAt: oneMillisecondBeforeInactive,
        now,
      }),
    ).toBe(17);
  });

  it("gives a newly registered instance a week to submit its first usage report", () => {
    expect(
      EnterpriseLicenseUsageUtil.getEffectiveUserCount({
        instances: [{ createdAt: oneMillisecondBeforeInactive }],
        storedUserCount: 17,
        storedUserCountUpdatedAt: inactiveAt,
        now,
      }),
    ).toBe(17);
  });

  it("drops an abandoned legacy count at the exact one-week boundary", () => {
    expect(
      EnterpriseLicenseUsageUtil.getEffectiveUserCount({
        instances: [{ createdAt: inactiveAt }],
        storedUserCount: 17,
        storedUserCountUpdatedAt: inactiveAt,
        now,
      }),
    ).toBe(0);
  });

  it("drops a dedicated legacy heartbeat at the exact one-week boundary", () => {
    expect(
      EnterpriseLicenseUsageUtil.getEffectiveUserCount({
        instances: [],
        legacyUserCount: 17,
        legacyUserCountUpdatedAt: inactiveAt,
        now,
      }),
    ).toBe(0);
  });

  it("can suppress the pre-migration fallback when a caller knows the stored count was modern", () => {
    expect(
      EnterpriseLicenseUsageUtil.getEffectiveUserCount({
        instances: [{ createdAt: oneMillisecondBeforeInactive }],
        storedUserCount: 17,
        storedUserCountUpdatedAt: now,
        allowStoredUserCountAsLegacyFallback: false,
        now,
      }),
    ).toBe(0);
  });

  it("never treats an explicitly modern stored aggregate as legacy", () => {
    expect(
      EnterpriseLicenseUsageUtil.getEffectiveUserCount({
        instances: [{ createdAt: now }],
        storedUserCount: 17,
        storedUserCountUpdatedAt: now,
        storedUserCountSource: EnterpriseLicenseUserCountSource.Instance,
        now,
      }),
    ).toBe(0);
  });

  it("retains an explicitly legacy stored aggregate during migration", () => {
    expect(
      EnterpriseLicenseUsageUtil.getEffectiveUserCount({
        instances: [],
        storedUserCount: 17,
        storedUserCountUpdatedAt: oneMillisecondBeforeInactive,
        storedUserCountSource: EnterpriseLicenseUserCountSource.Legacy,
        now,
      }),
    ).toBe(17);
  });

  it("reports the provenance of the effective count", () => {
    expect(
      EnterpriseLicenseUsageUtil.getEffectiveUserCountAndSource({
        instances: [
          {
            lastReportedAt: oneMillisecondBeforeInactive,
            userCount: 3,
          },
        ],
        legacyUserCount: 17,
        legacyUserCountUpdatedAt: now,
        now,
      }),
    ).toEqual({
      userCount: 3,
      source: EnterpriseLicenseUserCountSource.Instance,
    });
  });

  it("does not resurrect an expired dedicated legacy count during a new registration grace period", () => {
    expect(
      EnterpriseLicenseUsageUtil.getEffectiveUserCount({
        instances: [{ createdAt: now }],
        storedUserCount: 17,
        storedUserCountUpdatedAt: oneMillisecondBeforeInactive,
        legacyUserCount: 17,
        legacyUserCountUpdatedAt: inactiveAt,
        now,
      }),
    ).toBe(0);
  });

  it("does not extend dedicated legacy usage with a newer modern aggregate timestamp", () => {
    expect(
      EnterpriseLicenseUsageUtil.getEffectiveUserCount({
        instances: [],
        storedUserCount: 17,
        storedUserCountUpdatedAt: now,
        storedUserCountSource: EnterpriseLicenseUserCountSource.Legacy,
        legacyUserCount: 17,
        legacyUserCountUpdatedAt: inactiveAt,
        now,
      }),
    ).toBe(0);
  });

  it("returns zero for an undated stored count because no communication can be proven", () => {
    expect(
      EnterpriseLicenseUsageUtil.getEffectiveUserCount({
        instances: [],
        storedUserCount: 17,
        now,
      }),
    ).toBe(0);
  });

  it("keeps never-reported usage distinguishable from an inactive count", () => {
    expect(
      EnterpriseLicenseUsageUtil.getEffectiveUserCount({
        instances: [],
        now,
      }),
    ).toBeNull();
  });
});

describe("EnterpriseLicenseUsageUtil.getUniqueUserCount", () => {
  const now: Date = OneUptimeDate.getCurrentDate();
  const fresh: Date = OneUptimeDate.addRemoveDays(now, -1);
  const stale: Date = new Date(
    now.getTime() -
      EnterpriseLicenseUsageUtil.InstanceUsageFreshnessInDays *
        24 *
        60 *
        60 *
        1000,
  );

  it("counts the same user on multiple instances once", () => {
    const sharedUser: string = fakeHash("shared");
    const stagingOnlyUser: string = fakeHash("staging");
    const prodOnlyUser: string = fakeHash("prod");

    const count: number = EnterpriseLicenseUsageUtil.getUniqueUserCount(
      [
        {
          userCount: 2,
          userEmailHashes: [sharedUser, stagingOnlyUser],
          lastReportedAt: fresh,
        },
        {
          userCount: 2,
          userEmailHashes: [sharedUser, prodOnlyUser],
          lastReportedAt: fresh,
        },
      ],
      now,
    );

    expect(count).toBe(3);
  });

  it("adds plain user counts for instances without hashes", () => {
    const count: number = EnterpriseLicenseUsageUtil.getUniqueUserCount(
      [
        {
          userCount: 2,
          userEmailHashes: [fakeHash("a"), fakeHash("b")],
          lastReportedAt: fresh,
        },
        {
          // Older installation that reports a count but no hashes.
          userCount: 7,
          userEmailHashes: undefined,
          lastReportedAt: fresh,
        },
      ],
      now,
    );

    expect(count).toBe(9);
  });

  it("counts overflow users when the hash list was capped", () => {
    /*
     * An instance with more users than the hash cap: userCount is larger
     * than the number of hashes stored. The overflow must still count.
     */
    const count: number = EnterpriseLicenseUsageUtil.getUniqueUserCount(
      [
        {
          userCount: 250_000,
          userEmailHashes: [fakeHash("a"), fakeHash("b")], // capped list
          lastReportedAt: fresh,
        },
      ],
      now,
    );

    expect(count).toBe(250_000);
  });

  it("ignores an instance at the seven-day inactivity boundary", () => {
    const count: number = EnterpriseLicenseUsageUtil.getUniqueUserCount(
      [
        {
          userCount: 4,
          userEmailHashes: [
            fakeHash("a"),
            fakeHash("b"),
            fakeHash("c"),
            fakeHash("d"),
          ],
          lastReportedAt: fresh,
        },
        {
          userCount: 100,
          userEmailHashes: [fakeHash("e")],
          lastReportedAt: stale,
        },
      ],
      now,
    );

    expect(count).toBe(4);
  });

  it("deduplicates active users without letting an inactive overlap add seats", () => {
    const shared: string = fakeHash("shared");
    const activeOnly: string = fakeHash("active");

    const count: number = EnterpriseLicenseUsageUtil.getUniqueUserCount(
      [
        {
          userCount: 2,
          userEmailHashes: [shared, activeOnly],
          lastReportedAt: fresh,
        },
        {
          /*
           * Neither the shared hash, the inactive-only hash, nor the large
           * unhashed overflow may leak into the active seat total.
           */
          userCount: 100,
          userEmailHashes: [shared, fakeHash("inactive")],
          lastReportedAt: stale,
        },
      ],
      now,
    );

    expect(count).toBe(2);
  });

  it("ignores instances that never reported", () => {
    const count: number = EnterpriseLicenseUsageUtil.getUniqueUserCount(
      [
        {
          userCount: undefined,
          userEmailHashes: undefined,
          lastReportedAt: undefined,
        },
      ],
      now,
    );

    expect(count).toBe(0);
  });

  it("returns 0 for no instances", () => {
    expect(EnterpriseLicenseUsageUtil.getUniqueUserCount([], now)).toBe(0);
  });
});

describe("EnterpriseLicenseUsageUtil.sanitizeMasterAdminEmails", () => {
  it("returns empty array for non-array input", () => {
    expect(EnterpriseLicenseUsageUtil.sanitizeMasterAdminEmails(null)).toEqual(
      [],
    );
    expect(
      EnterpriseLicenseUsageUtil.sanitizeMasterAdminEmails("admin@acme.com"),
    ).toEqual([]);
    expect(EnterpriseLicenseUsageUtil.sanitizeMasterAdminEmails({})).toEqual(
      [],
    );
  });

  it("keeps only email-shaped strings, normalizes case and trims", () => {
    const result: Array<string> =
      EnterpriseLicenseUsageUtil.sanitizeMasterAdminEmails([
        " Admin@Acme.COM ",
        "not-an-email",
        "missing@tld",
        "spaces in@acme.com",
        12345,
        null,
        "second.admin@acme.com",
      ]);

    expect(result).toEqual(["admin@acme.com", "second.admin@acme.com"]);
  });

  it("removes duplicates", () => {
    const result: Array<string> =
      EnterpriseLicenseUsageUtil.sanitizeMasterAdminEmails([
        "admin@acme.com",
        "ADMIN@ACME.COM",
        "admin@acme.com",
      ]);

    expect(result).toEqual(["admin@acme.com"]);
  });

  it("caps the list size", () => {
    const tooMany: Array<string> = [];

    for (
      let i: number = 0;
      i < EnterpriseLicenseUsageUtil.maxMasterAdminEmailsPerInstance + 10;
      i++
    ) {
      tooMany.push(`admin${i}@acme.com`);
    }

    const result: Array<string> =
      EnterpriseLicenseUsageUtil.sanitizeMasterAdminEmails(tooMany);

    expect(result.length).toBe(
      EnterpriseLicenseUsageUtil.maxMasterAdminEmailsPerInstance,
    );
  });
});

describe("EnterpriseLicenseUsageUtil.maskLicenseKey", () => {
  it("fully masks short keys", () => {
    expect(EnterpriseLicenseUsageUtil.maskLicenseKey("")).toBe("••••••••");
    expect(EnterpriseLicenseUsageUtil.maskLicenseKey("abcd1234")).toBe(
      "••••••••",
    );
  });

  it("keeps only the first and last four characters of longer keys", () => {
    expect(
      EnterpriseLicenseUsageUtil.maskLicenseKey(
        "abcd-1234-efgh-5678-ijkl-9012",
      ),
    ).toBe("abcd••••9012");
  });
});
