import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Generated with npm run generate-postgres-migration, then renumbered after
 * the last registered migration.
 *
 * Metrics gets an AI section (Types/AI/TelemetryAi): OneUptime finds
 * attributes that take too many values, histograms whose buckets do not fit
 * their values, and busy services that send no metrics, and OneUptime AI
 * looks into each and opens a pull request that improves the metric or adds
 * the missing ones.
 *
 *   - Project "enableAutomaticMetricRemediation": the section's switch,
 *     "Improve metrics and add missing ones". Off here for every project
 *     that exists - an upgrade spends no AI credits and opens no pull
 *     request unasked - and turned on for new projects as they are created
 *     (ProjectService NEW_PROJECT_AI_DEFAULT_COLUMNS).
 *
 * A metric AI rule (an AI rule whose triggerEntityType is Metric) matches on
 * the columns profile AI rules added (1807030000000-AddProfileAiRules), so
 * nothing else changes. The column with a constant default is added without
 * rewriting a row.
 */
export class AddMetricAiSwitch1807400000000 implements MigrationInterface {
  public name: string = "AddMetricAiSwitch1807400000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "Project" ADD "enableAutomaticMetricRemediation" boolean NOT NULL DEFAULT false`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "Project" DROP COLUMN "enableAutomaticMetricRemediation"`,
    );
  }
}
