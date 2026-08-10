import OneUptimeDate from "../../../Types/Date";
import EnterpriseLicenseUsageUtil, {
  EnterpriseLicenseInstanceUsage,
} from "../../../Utils/EnterpriseLicense/EnterpriseLicenseUsage";

// A 64-char lowercase hex digest, parameterized so tests can make distinct ones.
function hash(seed: string): string {
  const base: string = seed.toLowerCase().replace(/[^a-f0-9]/g, "0");
  return (base + "0".repeat(64)).substring(0, 64);
}

describe("EnterpriseLicenseUsageUtil", () => {
  const now: Date = OneUptimeDate.getCurrentDate();

  describe("maskLicenseKey", () => {
    test("fully masks short keys", () => {
      expect(EnterpriseLicenseUsageUtil.maskLicenseKey("")).toBe("••••••••");
      expect(EnterpriseLicenseUsageUtil.maskLicenseKey("12345678")).toBe(
        "••••••••",
      );
    });

    test("keeps the first and last four characters of a long key", () => {
      expect(
        EnterpriseLicenseUsageUtil.maskLicenseKey("ABCD12345678WXYZ"),
      ).toBe("ABCD••••WXYZ");
    });

    test("masks a nine-character key (just over the threshold)", () => {
      // length 9 > 8, so first 4 + mask + last 4, overlapping middle dropped.
      expect(EnterpriseLicenseUsageUtil.maskLicenseKey("123456789")).toBe(
        "1234••••6789",
      );
    });
  });

  describe("sanitizeMasterAdminEmails", () => {
    test("returns an empty array for non-array input", () => {
      expect(
        EnterpriseLicenseUsageUtil.sanitizeMasterAdminEmails(null),
      ).toEqual([]);
      expect(
        EnterpriseLicenseUsageUtil.sanitizeMasterAdminEmails("a@b.com"),
      ).toEqual([]);
      expect(
        EnterpriseLicenseUsageUtil.sanitizeMasterAdminEmails(undefined),
      ).toEqual([]);
    });

    test("lowercases and trims email-shaped strings", () => {
      expect(
        EnterpriseLicenseUsageUtil.sanitizeMasterAdminEmails([
          "  Admin@Example.COM ",
        ]),
      ).toEqual(["admin@example.com"]);
    });

    test("deduplicates after normalization", () => {
      expect(
        EnterpriseLicenseUsageUtil.sanitizeMasterAdminEmails([
          "a@b.com",
          "A@B.com",
          "a@b.com",
        ]),
      ).toEqual(["a@b.com"]);
    });

    test("drops non-strings and non-email-shaped values", () => {
      expect(
        EnterpriseLicenseUsageUtil.sanitizeMasterAdminEmails([
          "valid@x.io",
          123,
          "not-an-email",
          "no@dot",
          "",
          "   ",
          null,
          { email: "x@y.com" },
        ]),
      ).toEqual(["valid@x.io"]);
    });

    test("rejects an over-long address", () => {
      const longLocal: string = "a".repeat(320);
      expect(
        EnterpriseLicenseUsageUtil.sanitizeMasterAdminEmails([
          `${longLocal}@x.com`,
        ]),
      ).toEqual([]);
    });

    test("caps the list at maxMasterAdminEmailsPerInstance", () => {
      const many: Array<string> = [];
      for (let i: number = 0; i < 120; i++) {
        many.push(`user${i}@example.com`);
      }
      const result: Array<string> =
        EnterpriseLicenseUsageUtil.sanitizeMasterAdminEmails(many);
      expect(result).toHaveLength(
        EnterpriseLicenseUsageUtil.maxMasterAdminEmailsPerInstance,
      );
    });
  });

  describe("sanitizeUserEmailHashes", () => {
    test("returns an empty array for non-array input", () => {
      expect(EnterpriseLicenseUsageUtil.sanitizeUserEmailHashes({})).toEqual(
        [],
      );
    });

    test("keeps valid 64-char hex digests and lowercases them", () => {
      const upper: string = hash("abc").toUpperCase();
      expect(
        EnterpriseLicenseUsageUtil.sanitizeUserEmailHashes([upper]),
      ).toEqual([upper.toLowerCase()]);
    });

    test("rejects strings that are not 64-char hex", () => {
      expect(
        EnterpriseLicenseUsageUtil.sanitizeUserEmailHashes([
          "tooshort",
          "g".repeat(64), // non-hex character
          hash("valid"),
          "0".repeat(63), // one char short
          "0".repeat(65), // one char long
          42,
        ]),
      ).toEqual([hash("valid")]);
    });

    test("deduplicates hashes", () => {
      const h: string = hash("dup");
      expect(
        EnterpriseLicenseUsageUtil.sanitizeUserEmailHashes([h, h, h]),
      ).toEqual([h]);
    });
  });

  describe("isInstanceCountedTowardsUsage", () => {
    test("excludes instances that never reported", () => {
      expect(
        EnterpriseLicenseUsageUtil.isInstanceCountedTowardsUsage({}, now),
      ).toBe(false);
    });

    test("includes a recently reporting instance", () => {
      const instance: EnterpriseLicenseInstanceUsage = {
        lastReportedAt: OneUptimeDate.addRemoveDays(now, -5),
      };
      expect(
        EnterpriseLicenseUsageUtil.isInstanceCountedTowardsUsage(instance, now),
      ).toBe(true);
    });

    test("excludes a stale instance", () => {
      const instance: EnterpriseLicenseInstanceUsage = {
        lastReportedAt: OneUptimeDate.addRemoveDays(now, -40),
      };
      expect(
        EnterpriseLicenseUsageUtil.isInstanceCountedTowardsUsage(instance, now),
      ).toBe(false);
    });

    test("treats the freshness boundary as inclusive", () => {
      // staleBefore == now - InstanceUsageFreshnessInDays; equal timestamps count.
      const boundary: Date = OneUptimeDate.addRemoveDays(
        now,
        -EnterpriseLicenseUsageUtil.InstanceUsageFreshnessInDays,
      );
      expect(
        EnterpriseLicenseUsageUtil.isInstanceCountedTowardsUsage(
          { lastReportedAt: boundary },
          now,
        ),
      ).toBe(true);

      // One second past the boundary drops out.
      const justStale: Date = OneUptimeDate.addRemoveSeconds(boundary, -1);
      expect(
        EnterpriseLicenseUsageUtil.isInstanceCountedTowardsUsage(
          { lastReportedAt: justStale },
          now,
        ),
      ).toBe(false);
    });
  });

  describe("getUniqueUserCount", () => {
    const fresh: (
      partial: Partial<EnterpriseLicenseInstanceUsage>,
    ) => EnterpriseLicenseInstanceUsage = (
      partial: Partial<EnterpriseLicenseInstanceUsage>,
    ): EnterpriseLicenseInstanceUsage => {
      return {
        lastReportedAt: OneUptimeDate.addRemoveDays(now, -1),
        ...partial,
      };
    };

    test("returns 0 when there are no instances", () => {
      expect(EnterpriseLicenseUsageUtil.getUniqueUserCount([], now)).toBe(0);
    });

    test("counts the union of hashes across instances (dedup)", () => {
      const a: string = hash("aaa");
      const b: string = hash("bbb");
      const c: string = hash("ccc");
      const instances: Array<EnterpriseLicenseInstanceUsage> = [
        fresh({ userEmailHashes: [a, b] }),
        fresh({ userEmailHashes: [b, c] }),
      ];
      // a, b, c -> 3 unique
      expect(
        EnterpriseLicenseUsageUtil.getUniqueUserCount(instances, now),
      ).toBe(3);
    });

    test("ignores stale instances", () => {
      const a: string = hash("aaa");
      const instances: Array<EnterpriseLicenseInstanceUsage> = [
        fresh({ userEmailHashes: [a] }),
        {
          lastReportedAt: OneUptimeDate.addRemoveDays(now, -60),
          userEmailHashes: [hash("stale1"), hash("stale2")],
        },
      ];
      expect(
        EnterpriseLicenseUsageUtil.getUniqueUserCount(instances, now),
      ).toBe(1);
    });

    test("adds plain user counts from instances without hashes", () => {
      const instances: Array<EnterpriseLicenseInstanceUsage> = [
        fresh({ userEmailHashes: [hash("x")] }),
        fresh({ userCount: 7 }),
      ];
      // 1 hashed + 7 uncounted-by-hash = 8
      expect(
        EnterpriseLicenseUsageUtil.getUniqueUserCount(instances, now),
      ).toBe(8);
    });

    test("counts hash overflow when userCount exceeds the hash list length", () => {
      const instances: Array<EnterpriseLicenseInstanceUsage> = [
        fresh({ userEmailHashes: [hash("a"), hash("b")], userCount: 10 }),
      ];
      // 2 unique hashes + (10 - 2) overflow = 10
      expect(
        EnterpriseLicenseUsageUtil.getUniqueUserCount(instances, now),
      ).toBe(10);
    });

    test("does not subtract when userCount is below the hash count", () => {
      const instances: Array<EnterpriseLicenseInstanceUsage> = [
        fresh({
          userEmailHashes: [hash("a"), hash("b"), hash("c")],
          userCount: 1,
        }),
      ];
      // userCount < hashes: overflow branch not taken, 3 unique hashes stand.
      expect(
        EnterpriseLicenseUsageUtil.getUniqueUserCount(instances, now),
      ).toBe(3);
    });

    test("ignores userCount of zero or missing on hashless instances", () => {
      const instances: Array<EnterpriseLicenseInstanceUsage> = [
        fresh({ userCount: 0 }),
        fresh({}),
      ];
      expect(
        EnterpriseLicenseUsageUtil.getUniqueUserCount(instances, now),
      ).toBe(0);
    });

    test("combines hashed, hashless and overflow across a realistic mix", () => {
      const shared: string = hash("shared");
      const instances: Array<EnterpriseLicenseInstanceUsage> = [
        fresh({ userEmailHashes: [shared, hash("p1")], userCount: 2 }),
        fresh({ userEmailHashes: [shared, hash("p2")], userCount: 5 }), // 2 hashes, 3 overflow
        fresh({ userCount: 4 }), // hashless, +4
        { lastReportedAt: undefined, userCount: 1000 }, // never reported, ignored
      ];
      /*
       * unique hashes: shared, p1, p2 = 3
       * overflow from second instance: 5 - 2 = 3
       * hashless: 4
       * total = 3 + 3 + 4 = 10
       */
      expect(
        EnterpriseLicenseUsageUtil.getUniqueUserCount(instances, now),
      ).toBe(10);
    });
  });
});
