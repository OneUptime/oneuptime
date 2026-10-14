import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Generated with npm run generate-postgres-migration, then renumbered after
 * the last registered migration.
 *
 * A status page's Sign Readers Out After (StatusPage.
 * privateUserSessionLengthInHours): how long a private user stays signed in
 * after signing in, however active they are
 * (Types/StatusPage/PrivateUserSessionLength). Nullable, with no default:
 * every existing page keeps no limit until someone sets one, so nobody is
 * signed out by the upgrade.
 */
export class AddStatusPagePrivateUserSessionLength1801800000000
  implements MigrationInterface
{
  public name: string = "AddStatusPagePrivateUserSessionLength1801800000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "StatusPage" ADD "privateUserSessionLengthInHours" integer`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "StatusPage" DROP COLUMN "privateUserSessionLengthInHours"`,
    );
  }
}
