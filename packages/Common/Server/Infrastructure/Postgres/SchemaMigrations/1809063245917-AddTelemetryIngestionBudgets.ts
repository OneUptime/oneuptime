import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Telemetry ingestion budgets (issue #5917): a daily byte budget and a
 * per-second rate for each signal (logs, traces, metrics, profiles and
 * security events), at three levels - the instance default every project
 * gets (GlobalConfig, with the warning threshold and the daily reset time and
 * time zone beside it), one project's override, set by the master admin
 * (Project), and an ingestion key's own budget (TelemetryIngestionKey).
 *
 * Generated with npm run generate-postgres-migration. Every column is a
 * nullable numeric or varchar with no default, so each is added without
 * rewriting its table, and empty is "no limit": nothing changes until an
 * admin sets a budget.
 */
export class AddTelemetryIngestionBudgets1809063245917
  implements MigrationInterface
{
  public name: string = "AddTelemetryIngestionBudgets1809063245917";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "Project" ADD "logsDailyIngestionBudgetInGB" numeric`,
    );
    await queryRunner.query(
      `ALTER TABLE "Project" ADD "tracesDailyIngestionBudgetInGB" numeric`,
    );
    await queryRunner.query(
      `ALTER TABLE "Project" ADD "metricsDailyIngestionBudgetInGB" numeric`,
    );
    await queryRunner.query(
      `ALTER TABLE "Project" ADD "profilesDailyIngestionBudgetInGB" numeric`,
    );
    await queryRunner.query(
      `ALTER TABLE "Project" ADD "securityEventsDailyIngestionBudgetInGB" numeric`,
    );
    await queryRunner.query(
      `ALTER TABLE "Project" ADD "logsIngestionRateLimitInMBPerSecond" numeric`,
    );
    await queryRunner.query(
      `ALTER TABLE "Project" ADD "tracesIngestionRateLimitInMBPerSecond" numeric`,
    );
    await queryRunner.query(
      `ALTER TABLE "Project" ADD "metricsIngestionRateLimitInMBPerSecond" numeric`,
    );
    await queryRunner.query(
      `ALTER TABLE "Project" ADD "profilesIngestionRateLimitInMBPerSecond" numeric`,
    );
    await queryRunner.query(
      `ALTER TABLE "Project" ADD "securityEventsIngestionRateLimitInMBPerSecond" numeric`,
    );
    await queryRunner.query(
      `ALTER TABLE "GlobalConfig" ADD "logsDailyIngestionBudgetInGB" numeric`,
    );
    await queryRunner.query(
      `ALTER TABLE "GlobalConfig" ADD "tracesDailyIngestionBudgetInGB" numeric`,
    );
    await queryRunner.query(
      `ALTER TABLE "GlobalConfig" ADD "metricsDailyIngestionBudgetInGB" numeric`,
    );
    await queryRunner.query(
      `ALTER TABLE "GlobalConfig" ADD "profilesDailyIngestionBudgetInGB" numeric`,
    );
    await queryRunner.query(
      `ALTER TABLE "GlobalConfig" ADD "securityEventsDailyIngestionBudgetInGB" numeric`,
    );
    await queryRunner.query(
      `ALTER TABLE "GlobalConfig" ADD "logsIngestionRateLimitInMBPerSecond" numeric`,
    );
    await queryRunner.query(
      `ALTER TABLE "GlobalConfig" ADD "tracesIngestionRateLimitInMBPerSecond" numeric`,
    );
    await queryRunner.query(
      `ALTER TABLE "GlobalConfig" ADD "metricsIngestionRateLimitInMBPerSecond" numeric`,
    );
    await queryRunner.query(
      `ALTER TABLE "GlobalConfig" ADD "profilesIngestionRateLimitInMBPerSecond" numeric`,
    );
    await queryRunner.query(
      `ALTER TABLE "GlobalConfig" ADD "securityEventsIngestionRateLimitInMBPerSecond" numeric`,
    );
    await queryRunner.query(
      `ALTER TABLE "GlobalConfig" ADD "telemetryIngestionBudgetWarningPercent" integer`,
    );
    await queryRunner.query(
      `ALTER TABLE "GlobalConfig" ADD "telemetryIngestionBudgetResetTime" character varying(100)`,
    );
    await queryRunner.query(
      `ALTER TABLE "GlobalConfig" ADD "telemetryIngestionBudgetResetTimezone" character varying(100)`,
    );
    await queryRunner.query(
      `ALTER TABLE "TelemetryIngestionKey" ADD "logsDailyIngestionBudgetInGB" numeric`,
    );
    await queryRunner.query(
      `ALTER TABLE "TelemetryIngestionKey" ADD "tracesDailyIngestionBudgetInGB" numeric`,
    );
    await queryRunner.query(
      `ALTER TABLE "TelemetryIngestionKey" ADD "metricsDailyIngestionBudgetInGB" numeric`,
    );
    await queryRunner.query(
      `ALTER TABLE "TelemetryIngestionKey" ADD "profilesDailyIngestionBudgetInGB" numeric`,
    );
    await queryRunner.query(
      `ALTER TABLE "TelemetryIngestionKey" ADD "securityEventsDailyIngestionBudgetInGB" numeric`,
    );
    await queryRunner.query(
      `ALTER TABLE "TelemetryIngestionKey" ADD "logsIngestionRateLimitInMBPerSecond" numeric`,
    );
    await queryRunner.query(
      `ALTER TABLE "TelemetryIngestionKey" ADD "tracesIngestionRateLimitInMBPerSecond" numeric`,
    );
    await queryRunner.query(
      `ALTER TABLE "TelemetryIngestionKey" ADD "metricsIngestionRateLimitInMBPerSecond" numeric`,
    );
    await queryRunner.query(
      `ALTER TABLE "TelemetryIngestionKey" ADD "profilesIngestionRateLimitInMBPerSecond" numeric`,
    );
    await queryRunner.query(
      `ALTER TABLE "TelemetryIngestionKey" ADD "securityEventsIngestionRateLimitInMBPerSecond" numeric`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "TelemetryIngestionKey" DROP COLUMN "securityEventsIngestionRateLimitInMBPerSecond"`,
    );
    await queryRunner.query(
      `ALTER TABLE "TelemetryIngestionKey" DROP COLUMN "profilesIngestionRateLimitInMBPerSecond"`,
    );
    await queryRunner.query(
      `ALTER TABLE "TelemetryIngestionKey" DROP COLUMN "metricsIngestionRateLimitInMBPerSecond"`,
    );
    await queryRunner.query(
      `ALTER TABLE "TelemetryIngestionKey" DROP COLUMN "tracesIngestionRateLimitInMBPerSecond"`,
    );
    await queryRunner.query(
      `ALTER TABLE "TelemetryIngestionKey" DROP COLUMN "logsIngestionRateLimitInMBPerSecond"`,
    );
    await queryRunner.query(
      `ALTER TABLE "TelemetryIngestionKey" DROP COLUMN "securityEventsDailyIngestionBudgetInGB"`,
    );
    await queryRunner.query(
      `ALTER TABLE "TelemetryIngestionKey" DROP COLUMN "profilesDailyIngestionBudgetInGB"`,
    );
    await queryRunner.query(
      `ALTER TABLE "TelemetryIngestionKey" DROP COLUMN "metricsDailyIngestionBudgetInGB"`,
    );
    await queryRunner.query(
      `ALTER TABLE "TelemetryIngestionKey" DROP COLUMN "tracesDailyIngestionBudgetInGB"`,
    );
    await queryRunner.query(
      `ALTER TABLE "TelemetryIngestionKey" DROP COLUMN "logsDailyIngestionBudgetInGB"`,
    );
    await queryRunner.query(
      `ALTER TABLE "GlobalConfig" DROP COLUMN "telemetryIngestionBudgetResetTimezone"`,
    );
    await queryRunner.query(
      `ALTER TABLE "GlobalConfig" DROP COLUMN "telemetryIngestionBudgetResetTime"`,
    );
    await queryRunner.query(
      `ALTER TABLE "GlobalConfig" DROP COLUMN "telemetryIngestionBudgetWarningPercent"`,
    );
    await queryRunner.query(
      `ALTER TABLE "GlobalConfig" DROP COLUMN "securityEventsIngestionRateLimitInMBPerSecond"`,
    );
    await queryRunner.query(
      `ALTER TABLE "GlobalConfig" DROP COLUMN "profilesIngestionRateLimitInMBPerSecond"`,
    );
    await queryRunner.query(
      `ALTER TABLE "GlobalConfig" DROP COLUMN "metricsIngestionRateLimitInMBPerSecond"`,
    );
    await queryRunner.query(
      `ALTER TABLE "GlobalConfig" DROP COLUMN "tracesIngestionRateLimitInMBPerSecond"`,
    );
    await queryRunner.query(
      `ALTER TABLE "GlobalConfig" DROP COLUMN "logsIngestionRateLimitInMBPerSecond"`,
    );
    await queryRunner.query(
      `ALTER TABLE "GlobalConfig" DROP COLUMN "securityEventsDailyIngestionBudgetInGB"`,
    );
    await queryRunner.query(
      `ALTER TABLE "GlobalConfig" DROP COLUMN "profilesDailyIngestionBudgetInGB"`,
    );
    await queryRunner.query(
      `ALTER TABLE "GlobalConfig" DROP COLUMN "metricsDailyIngestionBudgetInGB"`,
    );
    await queryRunner.query(
      `ALTER TABLE "GlobalConfig" DROP COLUMN "tracesDailyIngestionBudgetInGB"`,
    );
    await queryRunner.query(
      `ALTER TABLE "GlobalConfig" DROP COLUMN "logsDailyIngestionBudgetInGB"`,
    );
    await queryRunner.query(
      `ALTER TABLE "Project" DROP COLUMN "securityEventsIngestionRateLimitInMBPerSecond"`,
    );
    await queryRunner.query(
      `ALTER TABLE "Project" DROP COLUMN "profilesIngestionRateLimitInMBPerSecond"`,
    );
    await queryRunner.query(
      `ALTER TABLE "Project" DROP COLUMN "metricsIngestionRateLimitInMBPerSecond"`,
    );
    await queryRunner.query(
      `ALTER TABLE "Project" DROP COLUMN "tracesIngestionRateLimitInMBPerSecond"`,
    );
    await queryRunner.query(
      `ALTER TABLE "Project" DROP COLUMN "logsIngestionRateLimitInMBPerSecond"`,
    );
    await queryRunner.query(
      `ALTER TABLE "Project" DROP COLUMN "securityEventsDailyIngestionBudgetInGB"`,
    );
    await queryRunner.query(
      `ALTER TABLE "Project" DROP COLUMN "profilesDailyIngestionBudgetInGB"`,
    );
    await queryRunner.query(
      `ALTER TABLE "Project" DROP COLUMN "metricsDailyIngestionBudgetInGB"`,
    );
    await queryRunner.query(
      `ALTER TABLE "Project" DROP COLUMN "tracesDailyIngestionBudgetInGB"`,
    );
    await queryRunner.query(
      `ALTER TABLE "Project" DROP COLUMN "logsDailyIngestionBudgetInGB"`,
    );
  }
}
