import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Generated with TypeORM's migration:generate (the statement it generates
 * for the model), then renumbered after the last registered migration.
 *
 * RumApplication.sessionReplayFrustrationSignals (issue #6443): what counts
 * as frustration in an application's recordings - the built-in rules with
 * their numbers, and the application's own signals. A nullable jsonb column
 * with no default, so adding it rewrites nothing and every existing row
 * reads null, which means the built-in rules exactly as the recorder always
 * had them.
 */
export class AddRumApplicationFrustrationSignals1809080410000
  implements MigrationInterface
{
  public name: string = "AddRumApplicationFrustrationSignals1809080410000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "RumApplication" ADD "sessionReplayFrustrationSignals" jsonb`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "RumApplication" DROP COLUMN "sessionReplayFrustrationSignals"`,
    );
  }
}
