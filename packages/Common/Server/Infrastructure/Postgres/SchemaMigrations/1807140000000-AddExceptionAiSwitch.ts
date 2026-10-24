import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Generated with npm run generate-postgres-migration, then renumbered after
 * the last registered migration.
 *
 * Exceptions gets an AI section (Types/AI/TelemetryAi): OneUptime finds new
 * and rising exceptions and the services whose exceptions carry no stack
 * trace, and OneUptime AI looks into each and opens a pull request that
 * fixes the code, improves how the code handles an expected error, or makes
 * the service record stack traces.
 *
 *   - Project "enableAutomaticExceptionRemediation": the section's switch,
 *     "Find and fix new and rising exceptions". Off here for every project
 *     that exists - an upgrade changes nothing about how its exceptions are
 *     handled: AI Insights' own switches still decide that - and turned on
 *     for new projects as they are created (ProjectService
 *     NEW_PROJECT_AI_DEFAULT_COLUMNS).
 *
 * An exception AI rule (an AI rule whose triggerEntityType is Exception)
 * matches on the columns profile AI rules added (1807030000000-
 * AddProfileAiRules), so nothing else changes. The column with a constant
 * default is added without rewriting a row.
 */
export class AddExceptionAiSwitch1807140000000 implements MigrationInterface {
  public name: string = "AddExceptionAiSwitch1807140000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "Project" ADD "enableAutomaticExceptionRemediation" boolean NOT NULL DEFAULT false`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "Project" DROP COLUMN "enableAutomaticExceptionRemediation"`,
    );
  }
}
