import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Generated with npm run generate-postgres-migration, then renumbered after
 * the last migration master registered meanwhile (1802900000000).
 *
 * "AIRun"."followUpForAlertId": an incident's follow-up check - the one
 * investigation OneUptime AI runs again when an alert opens on the
 * incident's linked infrastructure after its first analysis
 * (Server/Utils/AI/SRE/IncidentFollowUpCheck) - names the alert that made it
 * check again. Every existing run is not one, so the column starts null.
 *
 * A nullable column with no default, which Postgres adds without rewriting
 * or scanning the table.
 */
export class AddAIRunFollowUpForAlert1802950000000
  implements MigrationInterface
{
  public name: string = "AddAIRunFollowUpForAlert1802950000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "AIRun" ADD "followUpForAlertId" uuid`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "AIRun" DROP COLUMN "followUpForAlertId"`,
    );
  }
}
