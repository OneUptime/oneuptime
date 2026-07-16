import EnterpriseLicenseUsageUtil from "../../Utils/EnterpriseLicense/EnterpriseLicenseUsage";
import OneUptimeDate from "../../Types/Date";
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

describe("EnterpriseLicenseUsageUtil.getUniqueUserCount", () => {
  const now: Date = OneUptimeDate.getCurrentDate();
  const fresh: Date = OneUptimeDate.addRemoveDays(now, -1);
  const stale: Date = OneUptimeDate.addRemoveDays(now, -60);

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

  it("ignores instances that stopped reporting", () => {
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
