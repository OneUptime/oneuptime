import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Single-use two factor backup codes, so losing an authenticator app or a
 * security key stops being an account lockout that only a master admin can
 * undo.
 *
 * One row per code rather than an array column on User: consuming a code is
 * then one conditional UPDATE that Postgres serialises for us, instead of a
 * read-modify-write of an array where two simultaneous sign-ins would each
 * write back a copy missing only their own code.
 *
 * `codeHash` holds an HMAC-SHA256 keyed by the instance EncryptionSecret and
 * domain separated by the owning user -- never a code in the clear. It is a
 * plain varchar rather than a `hashed: true` column because the write path's
 * hashing lanes do neither of those things: the salted lane is scrypt (right
 * for a guessable password, pure cost for a 2^50 random code) and the unsalted
 * lane is a bare SHA-256 with no per-user binding. See
 * Common/Server/Utils/TwoFactorBackupCode.ts.
 *
 * The (userId, codeHash) index is the sign-in lookup, which happens while
 * somebody is locked out and waiting. `usedAt` is deliberately not in it: a
 * user holds ten rows, so Postgres filters those in memory for nothing.
 */
export class AddUserTwoFactorBackupCode1789100000000
  implements MigrationInterface
{
  public name: string = "AddUserTwoFactorBackupCode1789100000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "UserTwoFactorBackupCode" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "codeHash" character varying(100) NOT NULL, "usedAt" TIMESTAMP WITH TIME ZONE, "deletedByUserId" uuid, "userId" uuid, CONSTRAINT "PK_8007aa681bcad47b88b906319ed" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_19a5937a4f6bd993383b31f3a2" ON "UserTwoFactorBackupCode" ("userId", "codeHash") `,
    );
    await queryRunner.query(
      `ALTER TABLE "UserTwoFactorBackupCode" ADD CONSTRAINT "FK_b6f9bfb29ab554076a2d8dde717" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    /*
     * CASCADE, not SET NULL. An orphaned row would be a live sign-in
     * credential for an account that no longer exists -- and, with `userId`
     * null, invisible to every query in the service, which all key on the
     * owner.
     */
    await queryRunner.query(
      `ALTER TABLE "UserTwoFactorBackupCode" ADD CONSTRAINT "FK_dd1f93f94cd3a4f39435b56d944" FOREIGN KEY ("userId") REFERENCES "User"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "UserTwoFactorBackupCode" DROP CONSTRAINT "FK_dd1f93f94cd3a4f39435b56d944"`,
    );
    await queryRunner.query(
      `ALTER TABLE "UserTwoFactorBackupCode" DROP CONSTRAINT "FK_b6f9bfb29ab554076a2d8dde717"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_19a5937a4f6bd993383b31f3a2"`,
    );
    await queryRunner.query(`DROP TABLE "UserTwoFactorBackupCode"`);
  }
}
