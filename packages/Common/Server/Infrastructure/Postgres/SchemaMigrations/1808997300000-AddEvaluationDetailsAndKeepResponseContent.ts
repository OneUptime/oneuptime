import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Generated with TypeORM's migration:generate (the statements it generates
 * for the models), then renumbered after the last registered migration.
 *
 * Why a monitor opened an incident or an alert (issue #5774): the criteria
 * that matched, each filter with what the check found, and a short redacted
 * excerpt of the response - Incident.evaluationDetails and
 * Alert.evaluationDetails, written when a monitor opens one. Nullable: an
 * incident or alert opened by hand, or before this migration, has none, and
 * its page shows no evaluation details.
 *
 * Monitor.keepResponseContent says whether a monitor's incidents and alerts
 * keep the response content of the check that opened them. Every monitor
 * keeps it, as before: the constant default gives each existing row true,
 * and on Postgres 11 and later each ADD changes the table's metadata only -
 * no row is rewritten.
 */
export class AddEvaluationDetailsAndKeepResponseContent1808997300000
  implements MigrationInterface
{
  public name: string =
    "AddEvaluationDetailsAndKeepResponseContent1808997300000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "Monitor" ADD "keepResponseContent" boolean NOT NULL DEFAULT true`,
    );
    await queryRunner.query(
      `ALTER TABLE "Incident" ADD "evaluationDetails" jsonb`,
    );
    await queryRunner.query(
      `ALTER TABLE "Alert" ADD "evaluationDetails" jsonb`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "Alert" DROP COLUMN "evaluationDetails"`,
    );
    await queryRunner.query(
      `ALTER TABLE "Incident" DROP COLUMN "evaluationDetails"`,
    );
    await queryRunner.query(
      `ALTER TABLE "Monitor" DROP COLUMN "keepResponseContent"`,
    );
  }
}
