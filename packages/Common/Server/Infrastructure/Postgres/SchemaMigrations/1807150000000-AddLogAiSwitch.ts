import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Generated with npm run generate-postgres-migration, then renumbered after
 * the last registered migration.
 *
 * Logs gets an AI section (Types/AI/TelemetryAi): OneUptime finds the
 * errors a service logs again and again, the requests that fail without a
 * log line, the logs that carry no trace context and the lines that flood
 * a service's logs, and OneUptime AI looks into each and opens a pull
 * request that fixes the code behind the error, logs what is not logged or
 * logs the noisy line less.
 *
 *   - Project "enableAutomaticLogRemediation": the section's switch, "Find
 *     and fix error, missing and noisy logs". Off here for every project
 *     that exists - an upgrade spends no AI credits and opens no pull
 *     request unasked - and turned on for new projects as they are created
 *     (ProjectService NEW_PROJECT_AI_DEFAULT_COLUMNS).
 *
 * A log AI rule (an AI rule whose triggerEntityType is Log) matches on the
 * columns profile AI rules added (1807030000000-AddProfileAiRules), so
 * nothing else changes. The column with a constant default is added without
 * rewriting a row.
 */
export class AddLogAiSwitch1807150000000 implements MigrationInterface {
  public name: string = "AddLogAiSwitch1807150000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "Project" ADD "enableAutomaticLogRemediation" boolean NOT NULL DEFAULT false`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "Project" DROP COLUMN "enableAutomaticLogRemediation"`,
    );
  }
}
