import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Generated with npm run generate-postgres-migration, then renumbered after
 * the last registered migration.
 *
 * How long a sign-in to OneUptime lasts, set by a master admin (Admin
 * Dashboard > Settings > Session Length, Types/UserSession/SessionLength):
 * the session length and the idle timeout of every sign-in, in minutes, and
 * SSO sign-ins' own when they have them (useSeparateSsoSessionLengths).
 * Nullable, with no default but the switch's off: every installation keeps
 * today's sign-ins - no limit, and 30 days without use - until a master
 * admin sets one, so nobody is signed out by the upgrade.
 */
export class AddUserSessionLengths1808826400000 implements MigrationInterface {
  public name: string = "AddUserSessionLengths1808826400000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "GlobalConfig" ADD "sessionLengthInMinutes" integer`,
    );
    await queryRunner.query(
      `ALTER TABLE "GlobalConfig" ADD "sessionIdleTimeoutInMinutes" integer`,
    );
    await queryRunner.query(
      `ALTER TABLE "GlobalConfig" ADD "useSeparateSsoSessionLengths" boolean DEFAULT false`,
    );
    await queryRunner.query(
      `ALTER TABLE "GlobalConfig" ADD "ssoSessionLengthInMinutes" integer`,
    );
    await queryRunner.query(
      `ALTER TABLE "GlobalConfig" ADD "ssoSessionIdleTimeoutInMinutes" integer`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "GlobalConfig" DROP COLUMN "ssoSessionIdleTimeoutInMinutes"`,
    );
    await queryRunner.query(
      `ALTER TABLE "GlobalConfig" DROP COLUMN "ssoSessionLengthInMinutes"`,
    );
    await queryRunner.query(
      `ALTER TABLE "GlobalConfig" DROP COLUMN "useSeparateSsoSessionLengths"`,
    );
    await queryRunner.query(
      `ALTER TABLE "GlobalConfig" DROP COLUMN "sessionIdleTimeoutInMinutes"`,
    );
    await queryRunner.query(
      `ALTER TABLE "GlobalConfig" DROP COLUMN "sessionLengthInMinutes"`,
    );
  }
}
