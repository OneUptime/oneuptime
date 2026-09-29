import { FixTotpOtpUrlAlgorithm1787700000000 } from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1787700000000-FixTotpOtpUrlAlgorithm";
import SchemaMigrations from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/Index";
import TotpAuth from "../../../../Server/Utils/TotpAuth";
import Email from "../../../../Types/Email";
import * as OTPAuth from "otpauth";
import { MigrationInterface, QueryRunner } from "typeorm";
import fs from "fs";
import path from "path";
import { beforeEach, describe, expect, test } from "@jest/globals";

/*
 * The data repair behind the code fix.
 *
 * A row created before the fix still has `algorithm=SHA256` in the URL its QR
 * code is rendered from. That no longer locks anyone out — verification tries
 * SHA1 first, which is what those phones were emitting all along, and the tests
 * below prove both a phone and a conforming app get in either way. What the
 * rewrite buys is a stored URL that stops lying, which matters for the apps
 * that DO honour the parameter and have no SHA256.
 *
 * Two properties are load-bearing and both are asserted here:
 *
 *   1. the secret is untouched, so an app that already scanned the old QR code
 *      keeps working (verification accepts SHA1 and legacy SHA256 either way);
 *   2. verified rows are left alone. Their QR is never displayed again — the
 *      Verify action only exists for unverified entries — so the stored URL is
 *      a record of what the user's authenticator actually holds, and rewriting
 *      it would falsify that record for no benefit.
 *
 * The statements are inspected rather than executed: these tests must run
 * without a database, and what can go wrong here is the WHERE clause, not
 * Postgres' REPLACE().
 *
 * The ordering of this migration against the others is no longer asserted
 * here. It used to be — as a guard hand-carried from one migration's test to
 * the next, which broke the moment a migration was added without moving it.
 * It now lives in SchemaMigrationsOrdering.test.ts, written against the
 * registry as a whole so that it covers whichever migration is newest without
 * anybody having to remember it.
 */

const MIGRATION_TIMESTAMP: string = "1787700000000";

const MIGRATION_DIRECTORY: string = path.join(
  __dirname,
  "../../../../Server/Infrastructure/Postgres/SchemaMigrations",
);

type CapturedQueryRunner = {
  runner: QueryRunner;
  queries: Array<string>;
};

type MockQueryRunnerFunction = () => CapturedQueryRunner;

const mockQueryRunner: MockQueryRunnerFunction = (): CapturedQueryRunner => {
  const queries: Array<string> = [];

  return {
    queries: queries,
    runner: {
      query: async (sql: string): Promise<void> => {
        queries.push(sql);
      },
    } as unknown as QueryRunner,
  };
};

const migration: FixTotpOtpUrlAlgorithm1787700000000 =
  new FixTotpOtpUrlAlgorithm1787700000000();

let up: CapturedQueryRunner;
let down: CapturedQueryRunner;

describe("FixTotpOtpUrlAlgorithm migration", () => {
  beforeEach(async () => {
    up = mockQueryRunner();
    down = mockQueryRunner();

    await migration.up(up.runner);
    await migration.down(down.runner);
  });

  /*
   * TypeORM matches migrations by this name. A mismatch between the class name
   * and the `name` property makes the migration run again on every boot.
   */
  test("names itself consistently so it is recorded as run", () => {
    expect(migration.name).toBe("FixTotpOtpUrlAlgorithm1787700000000");
  });

  test("is registered in SchemaMigrations/Index.ts, or it never runs", () => {
    expect(SchemaMigrations).toContain(FixTotpOtpUrlAlgorithm1787700000000);
  });

  describe("registration", () => {
    test("it is registered exactly once", () => {
      const occurrences: number = SchemaMigrations.filter(
        (migration: new () => MigrationInterface): boolean => {
          return migration.name === "FixTotpOtpUrlAlgorithm1787700000000";
        },
      ).length;

      expect(occurrences).toBe(1);
    });

    /*
     * ...and the timestamp in the class name is the one on disk. A class
     * renamed without renaming its file (or two migrations landing on the
     * same timestamp) leaves the registry pointing at a different file from
     * the one this test read.
     */
    test("exactly one file on disk carries its timestamp, and it is this one", () => {
      const matching: Array<string> = fs
        .readdirSync(MIGRATION_DIRECTORY)
        .filter((file: string): boolean => {
          return file.startsWith(`${MIGRATION_TIMESTAMP}-`);
        });

      expect(matching).toEqual([
        `${MIGRATION_TIMESTAMP}-FixTotpOtpUrlAlgorithm.ts`,
      ]);
    });
  });

  describe("up", () => {
    test("rewrites the algorithm in the stored otpauth URL", () => {
      expect(up.queries).toHaveLength(1);
      expect(up.queries[0]).toContain(`UPDATE "UserTotpAuth"`);
      expect(up.queries[0]).toContain(
        `REPLACE("twoFactorOtpUrl", 'algorithm=SHA256', 'algorithm=SHA1')`,
      );
    });

    /*
     * The secret is the only irreplaceable thing on the row. A migration that
     * regenerated it would invalidate every authenticator entry in existence.
     */
    test("never touches the secret", () => {
      expect(up.queries[0]).not.toContain("twoFactorSecret");
    });

    test("only touches enrolments that are still pending", () => {
      expect(up.queries[0]).toContain(`"isVerified" = false`);
    });

    test("only touches rows that actually carry the broken algorithm", () => {
      expect(up.queries[0]).toContain(
        `"twoFactorOtpUrl" LIKE '%algorithm=SHA256%'`,
      );
    });

    test("does not delete anything", () => {
      expect(up.queries[0]).not.toMatch(/\bDELETE\b|\bDROP\b|\bTRUNCATE\b/i);
    });
  });

  describe("down", () => {
    test("is the exact inverse of up", () => {
      expect(down.queries).toHaveLength(1);
      expect(down.queries[0]).toContain(
        `REPLACE("twoFactorOtpUrl", 'algorithm=SHA1', 'algorithm=SHA256')`,
      );
      expect(down.queries[0]).toContain(`"isVerified" = false`);
    });

    test("never touches the secret either", () => {
      expect(down.queries[0]).not.toContain("twoFactorSecret");
    });
  });

  /*
   * What the SQL means, applied to a real URL. Postgres' REPLACE is a plain
   * substring substitution, so doing it here in JavaScript is a faithful model
   * of the statement above — and it lets the result be handed to the real
   * parser and the real verifier.
   */
  describe("the effect on a row written before the fix", () => {
    const EMAIL: Email = new Email("stuck.user@example.com");

    type ApplyUpFunction = (url: string) => string;

    const applyUp: ApplyUpFunction = (url: string): string => {
      return url.split("algorithm=SHA256").join("algorithm=SHA1");
    };

    type LegacyUrlFunction = (secret: string) => string;

    /*
     * What the old code wrote: everything as today, but SHA256.
     */
    const legacyUrl: LegacyUrlFunction = (secret: string): string => {
      return new OTPAuth.TOTP({
        issuer: "OneUptime",
        label: EMAIL.toString(),
        algorithm: "SHA256",
        digits: 6,
        period: 30,
        secret: secret,
      }).toString();
    };

    test("the repaired QR code produces codes the server accepts", () => {
      const secret: string = TotpAuth.generateSecret();

      const repaired: OTPAuth.TOTP = OTPAuth.URI.parse(
        applyUp(legacyUrl(secret)),
      ) as OTPAuth.TOTP;

      expect(repaired.algorithm).toBe("SHA1");

      expect(
        TotpAuth.verifyToken({
          secret: secret,
          token: repaired.generate(),
          email: EMAIL,
        }),
      ).toBe(true);
    });

    test("the secret survives the rewrite unchanged", () => {
      const secret: string = TotpAuth.generateSecret();

      const repaired: OTPAuth.TOTP = OTPAuth.URI.parse(
        applyUp(legacyUrl(secret)),
      ) as OTPAuth.TOTP;

      expect(repaired.secret.base32).toBe(secret);
    });

    /*
     * Somebody mid-enrolment may already have scanned the old SHA256 QR with
     * an app that honours the parameter. Rewriting the URL must not strand
     * them: their app still emits SHA256 codes, and those still verify.
     */
    test("an app that already scanned the old SHA256 QR still verifies", () => {
      const secret: string = TotpAuth.generateSecret();

      const alreadyScanned: OTPAuth.TOTP = OTPAuth.URI.parse(
        legacyUrl(secret),
      ) as OTPAuth.TOTP;

      expect(alreadyScanned.algorithm).toBe("SHA256");

      expect(
        TotpAuth.verifyToken({
          secret: secret,
          token: alreadyScanned.generate(),
          email: EMAIL,
        }),
      ).toBe(true);
    });

    test("a URL that is already SHA1 is left exactly as it was", () => {
      const secret: string = TotpAuth.generateSecret();

      const current: string = TotpAuth.generateUri({
        secret: secret,
        userEmail: EMAIL,
      });

      expect(applyUp(current)).toBe(current);
    });
  });
});
