import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * A project chooses where its incident, incident episode, alert, alert
 * episode and scheduled maintenance numbers start - to carry on from the
 * numbers of the tool it moved from (Utils/Project/NextNumber).
 *
 * Project gains one column per kind of number. The next record of a kind
 * gets the higher of its start and the one after the highest number given
 * out (the kind's counter), so a start only moves numbers on.
 *
 * Generated with npm run generate-postgres-migration, then renumbered to a
 * round slot above the registered migrations. Each column is added empty,
 * which Postgres records in the catalog without rewriting a row, so the
 * table keeps taking writes. Empty means no start was chosen: every
 * existing project goes on numbering exactly as before.
 */
export class AddRecordNumbersStartAt1802700000000 implements MigrationInterface {
  public name: string = "AddRecordNumbersStartAt1802700000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "Project" ADD "incidentNumbersStartAt" integer`,
    );
    await queryRunner.query(
      `ALTER TABLE "Project" ADD "incidentEpisodeNumbersStartAt" integer`,
    );
    await queryRunner.query(
      `ALTER TABLE "Project" ADD "alertNumbersStartAt" integer`,
    );
    await queryRunner.query(
      `ALTER TABLE "Project" ADD "alertEpisodeNumbersStartAt" integer`,
    );
    await queryRunner.query(
      `ALTER TABLE "Project" ADD "scheduledMaintenanceNumbersStartAt" integer`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "Project" DROP COLUMN "scheduledMaintenanceNumbersStartAt"`,
    );
    await queryRunner.query(
      `ALTER TABLE "Project" DROP COLUMN "alertEpisodeNumbersStartAt"`,
    );
    await queryRunner.query(
      `ALTER TABLE "Project" DROP COLUMN "alertNumbersStartAt"`,
    );
    await queryRunner.query(
      `ALTER TABLE "Project" DROP COLUMN "incidentEpisodeNumbersStartAt"`,
    );
    await queryRunner.query(
      `ALTER TABLE "Project" DROP COLUMN "incidentNumbersStartAt"`,
    );
  }
}
