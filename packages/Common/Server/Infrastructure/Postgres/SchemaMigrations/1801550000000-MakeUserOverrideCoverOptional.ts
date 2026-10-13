import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Generated with npm run generate-postgres-migration, then renumbered after
 * the last registered migration.
 *
 * A user override no longer has to name who covers. Without a cover
 * ("routeAlertsToUserId" empty) the override is a skip: while the person is
 * away, each of their turns in a schedule goes to the next person in the
 * rotation who is not away. Existing overrides all name a cover and are
 * unchanged.
 *
 * TypeORM generated the column's foreign key dropped and added again around
 * the change; Postgres does not need that to drop a NOT NULL, and adding the
 * key again would scan the whole table under a lock. The key is left as it
 * is: same name, same definition (the schema drift check agrees).
 *
 * Down: an override without a cover cannot exist in the old schema, so those
 * are deleted before the column is required again.
 */
export class MakeUserOverrideCoverOptional1801550000000
  implements MigrationInterface
{
  public name: string = "MakeUserOverrideCoverOptional1801550000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyUserOverride" ALTER COLUMN "routeAlertsToUserId" DROP NOT NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DELETE FROM "OnCallDutyPolicyUserOverride" WHERE "routeAlertsToUserId" IS NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyUserOverride" ALTER COLUMN "routeAlertsToUserId" SET NOT NULL`,
    );
  }
}
