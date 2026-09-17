import { MigrationInterface, QueryRunner } from "typeorm";

export class MigrationName1786101798351 implements MigrationInterface {
  public name = "MigrationName1786101798351";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "Project" ADD "enableIncidentInstrumentationFixTasks" boolean NOT NULL DEFAULT false`,
    );
    await queryRunner.query(
      `ALTER TABLE "Project" ADD "enableAlertInstrumentationFixTasks" boolean NOT NULL DEFAULT false`,
    );
    await queryRunner.query(
      `ALTER TABLE "Project" ADD "enableAutomaticIncidentCodeFixes" boolean NOT NULL DEFAULT false`,
    );
    await queryRunner.query(
      `ALTER TABLE "Project" ADD "enableAutomaticAlertCodeFixes" boolean NOT NULL DEFAULT false`,
    );
    await queryRunner.query(
      `ALTER TABLE "Project" ADD "incidentAiDailyAutonomousTokenLimit" integer`,
    );
    await queryRunner.query(
      `ALTER TABLE "Project" ADD "alertAiDailyAutonomousTokenLimit" integer`,
    );
    await queryRunner.query(
      `ALTER TABLE "Project" ADD "incidentAiDailyFixTaskLimit" integer`,
    );
    await queryRunner.query(
      `ALTER TABLE "Project" ADD "alertAiDailyFixTaskLimit" integer`,
    );
    await queryRunner.query(
      `ALTER TABLE "Project" ADD "incidentAiMaxConcurrentInvestigations" integer`,
    );
    await queryRunner.query(
      `ALTER TABLE "Project" ADD "alertAiMaxConcurrentInvestigations" integer`,
    );
    await queryRunner.query(
      `UPDATE "Project" SET "enableIncidentInstrumentationFixTasks" = "enableInstrumentationFixTasks", "enableAlertInstrumentationFixTasks" = "enableInstrumentationFixTasks", "enableAutomaticIncidentCodeFixes" = "enableAutomaticCodeFixes", "enableAutomaticAlertCodeFixes" = "enableAutomaticCodeFixes", "incidentAiDailyAutonomousTokenLimit" = "aiDailyAutonomousTokenLimit", "alertAiDailyAutonomousTokenLimit" = "aiDailyAutonomousTokenLimit", "incidentAiDailyFixTaskLimit" = "aiDailyFixTaskLimit", "alertAiDailyFixTaskLimit" = "aiDailyFixTaskLimit", "incidentAiMaxConcurrentInvestigations" = "aiMaxConcurrentInvestigations", "alertAiMaxConcurrentInvestigations" = "aiMaxConcurrentInvestigations"`,
    );
    await queryRunner.query(
      `ALTER TABLE "Project" DROP COLUMN "enableInstrumentationFixTasks"`,
    );
    await queryRunner.query(
      `ALTER TABLE "Project" DROP COLUMN "enableAutomaticCodeFixes"`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "Project" ADD "enableAutomaticCodeFixes" boolean NOT NULL DEFAULT false`,
    );
    await queryRunner.query(
      `ALTER TABLE "Project" ADD "enableInstrumentationFixTasks" boolean NOT NULL DEFAULT false`,
    );
    await queryRunner.query(
      `UPDATE "Project" SET "enableInstrumentationFixTasks" = "enableIncidentInstrumentationFixTasks" OR "enableAlertInstrumentationFixTasks", "enableAutomaticCodeFixes" = "enableAutomaticIncidentCodeFixes" OR "enableAutomaticAlertCodeFixes"`,
    );
    await queryRunner.query(
      `ALTER TABLE "Project" DROP COLUMN "alertAiMaxConcurrentInvestigations"`,
    );
    await queryRunner.query(
      `ALTER TABLE "Project" DROP COLUMN "incidentAiMaxConcurrentInvestigations"`,
    );
    await queryRunner.query(
      `ALTER TABLE "Project" DROP COLUMN "alertAiDailyFixTaskLimit"`,
    );
    await queryRunner.query(
      `ALTER TABLE "Project" DROP COLUMN "incidentAiDailyFixTaskLimit"`,
    );
    await queryRunner.query(
      `ALTER TABLE "Project" DROP COLUMN "alertAiDailyAutonomousTokenLimit"`,
    );
    await queryRunner.query(
      `ALTER TABLE "Project" DROP COLUMN "incidentAiDailyAutonomousTokenLimit"`,
    );
    await queryRunner.query(
      `ALTER TABLE "Project" DROP COLUMN "enableAutomaticAlertCodeFixes"`,
    );
    await queryRunner.query(
      `ALTER TABLE "Project" DROP COLUMN "enableAutomaticIncidentCodeFixes"`,
    );
    await queryRunner.query(
      `ALTER TABLE "Project" DROP COLUMN "enableAlertInstrumentationFixTasks"`,
    );
    await queryRunner.query(
      `ALTER TABLE "Project" DROP COLUMN "enableIncidentInstrumentationFixTasks"`,
    );
  }
}
