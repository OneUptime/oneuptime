import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Incident investigations get the cost gates alerts have had since
 * AddAlertInvestigationGating: a per-project severity floor and a
 * re-investigation cooldown.
 *
 * Both columns are nullable and no backfill runs, which is the behaviour
 * decision: an unset floor means every incident is still investigated, so an
 * existing project's coverage does not silently shrink on deploy. The
 * cooldown's default lives in code (30 minutes) and only suppresses repeat
 * work on a monitor that was just investigated.
 */
export class AddIncidentInvestigationGating1785790000000
  implements MigrationInterface
{
  public name = "AddIncidentInvestigationGating1785790000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "Project" ADD "incidentInvestigationMinimumSeverityId" uuid`,
    );
    await queryRunner.query(
      `ALTER TABLE "Project" ADD CONSTRAINT "FK_Project_incidentInvestigationMinimumSeverityId" FOREIGN KEY ("incidentInvestigationMinimumSeverityId") REFERENCES "IncidentSeverity"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "Project" ADD "incidentInvestigationDedupeWindowMinutes" integer`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "Project" DROP COLUMN "incidentInvestigationDedupeWindowMinutes"`,
    );
    await queryRunner.query(
      `ALTER TABLE "Project" DROP CONSTRAINT "FK_Project_incidentInvestigationMinimumSeverityId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "Project" DROP COLUMN "incidentInvestigationMinimumSeverityId"`,
    );
  }
}
