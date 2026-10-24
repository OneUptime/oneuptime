import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Generated with npm run generate-postgres-migration, then renumbered after
 * the last registered migration.
 *
 * Traces gets an AI section (Types/AI/TelemetryAi): OneUptime finds slow
 * operations, failing operations and missing tracing in a service's
 * traces, and OneUptime AI looks into each and opens a pull request that
 * fixes the code or adds the tracing it lacks.
 *
 *   - Project "enableAutomaticTraceRemediation": the section's switch,
 *     "Find and fix slow and failing operations". Off here for every
 *     project that exists - an upgrade spends no AI credits and opens no
 *     pull request unasked - and turned on for new projects as they are
 *     created (ProjectService NEW_PROJECT_AI_DEFAULT_COLUMNS).
 *
 * A trace AI rule (an AI rule whose triggerEntityType is Trace) matches on
 * the columns profile AI rules added (1807030000000-AddProfileAiRules), so
 * nothing else changes. The column with a constant default is added without
 * rewriting a row.
 */
export class AddTraceAiSwitch1807110000000 implements MigrationInterface {
  public name: string = "AddTraceAiSwitch1807110000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "Project" ADD "enableAutomaticTraceRemediation" boolean NOT NULL DEFAULT false`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "Project" DROP COLUMN "enableAutomaticTraceRemediation"`,
    );
  }
}
