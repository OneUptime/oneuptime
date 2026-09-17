import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Drops the global UNIQUE constraints on ProjectCallSMSConfig's Twilio
 * credentials. Generated with `npm run generate-postgres-migration` after
 * flipping both columns to `unique: false`; the statements are the generator's,
 * renumbered to sort last and given IF EXISTS (see below).
 *
 * WHY THEY WERE WRONG
 *
 * ProjectCallSMSConfig is tenant-scoped (@TenantColumn("projectId")) and
 * inherently multi-row: a project has as many configs as it has Twilio
 * setups. The constraints came from the InitialMigration, where this table's
 * columns were modelled on GlobalConfig — a singleton table whose every column
 * carries a pointless `unique: true`. On a singleton that is harmless. Here it
 * meant no two rows anywhere in the instance could share a Twilio account.
 *
 * That is not a constraint anybody wants:
 *
 *   - One Twilio account, two numbers. Poland (and several other countries)
 *     requires a Local number for Voice and a Mobile number for SMS, so a
 *     single project legitimately needs two configs on one account. This is
 *     what issue #3020 was reported against.
 *   - Two projects, one account. On a shared instance the FIRST project to
 *     save a given account SID locked every other project out of it, across
 *     the tenant boundary — one tenant could deny another the use of its own
 *     Twilio credentials, and neither could see why.
 *
 * Both surfaced the same way: Postgres raised unique_violation (23505),
 * which is not a OneUptime Exception, so it fell through to the generic
 * handler and reached the client as a bare 500 `{"error":"Server Error"}`
 * with nothing to act on.
 *
 * NOT REPLACED WITH A NARROWER UNIQUE
 *
 * There is no uniqueness to restore at any scope. Reusing one account across
 * configs is the supported case, not an accident to be guarded against. Config
 * identity is `name`, which is already unique per project via
 * @UniqueColumnBy("projectId"). After this migration ProjectCallSMSConfig has
 * no UNIQUE constraint on any credential column, which matches every other
 * tenant-scoped table: theirs are all on slugs, keys and tokens — identifiers
 * that really are global.
 *
 * IF EXISTS
 *
 * Self-hosted operators hit by #3020 were told in the issue thread that the
 * workaround is to drop the constraint by hand. IF EXISTS keeps this migration
 * from failing on those databases. down() cannot be made safe the same way: it
 * will fail if duplicates exist by then, which is correct — silently
 * hard-deleting a project's Twilio config to make room for a constraint would
 * be worse than a failed rollback.
 */
export class DropProjectCallSMSConfigCredentialUniques1786700000000
  implements MigrationInterface
{
  public name: string =
    "DropProjectCallSMSConfigCredentialUniques1786700000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "ProjectCallSMSConfig" DROP CONSTRAINT IF EXISTS "UQ_0886139eac04ad49627e446d477"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ProjectCallSMSConfig" DROP CONSTRAINT IF EXISTS "UQ_2eb1a240d549a7701b6e82d2f94"`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "ProjectCallSMSConfig" ADD CONSTRAINT "UQ_2eb1a240d549a7701b6e82d2f94" UNIQUE ("twilioAuthToken")`,
    );
    await queryRunner.query(
      `ALTER TABLE "ProjectCallSMSConfig" ADD CONSTRAINT "UQ_0886139eac04ad49627e446d477" UNIQUE ("twilioAccountSID")`,
    );
  }
}
