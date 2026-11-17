import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Generated with npm run generate-postgres-migration (#9186) after AIRun and
 * AIAgentTaskPullRequest gained carriedIncidentIds and carriedAlertIds: the
 * incidents and alerts a Code task, its turns and a pull request OneUptime
 * AI opened from a chat carry without being a fix of one. AIRunOutputReadFilter
 * reads them, so such work about a private incident or alert is read only by
 * those who may read the record.
 *
 * Nullable jsonb with no default: adding them rewrites no row and takes the
 * table's lock only for the instant the catalog changes. They are in no
 * index: the rule reads them on the rows it already reads, one list at a
 * time. LinkCodeWorkToTheRecordsItCarries fills them in for the work that
 * already exists.
 */
export class AddCarriedRecordsToCodeWork1809182700000
  implements MigrationInterface
{
  public name: string = "AddCarriedRecordsToCodeWork1809182700000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "AIAgentTaskPullRequest" ADD "carriedIncidentIds" jsonb`,
    );
    await queryRunner.query(
      `ALTER TABLE "AIAgentTaskPullRequest" ADD "carriedAlertIds" jsonb`,
    );
    await queryRunner.query(
      `ALTER TABLE "AIRun" ADD "carriedIncidentIds" jsonb`,
    );
    await queryRunner.query(`ALTER TABLE "AIRun" ADD "carriedAlertIds" jsonb`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "AIRun" DROP COLUMN "carriedAlertIds"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AIRun" DROP COLUMN "carriedIncidentIds"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AIAgentTaskPullRequest" DROP COLUMN "carriedAlertIds"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AIAgentTaskPullRequest" DROP COLUMN "carriedIncidentIds"`,
    );
  }
}
