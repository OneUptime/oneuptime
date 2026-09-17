import { MigrationInterface, QueryRunner } from "typeorm";

export class RenameEvaluateOverTimeInCriteriaFilter1769676117342
  implements MigrationInterface
{
  public name = "RenameEvaluateOverTimeInCriteriaFilter1769676117342";

  public async up(queryRunner: QueryRunner): Promise<void> {
    /*
     * Update the monitorSteps JSONB column in Monitor table
     * Replace all occurrences of "eveluateOverTime" with "evaluateOverTime"
     */
    await queryRunner.query(`
      UPDATE "Monitor"
      SET "monitorSteps" = REPLACE("monitorSteps"::text, '"eveluateOverTime"', '"evaluateOverTime"')::jsonb
      WHERE "monitorSteps"::text LIKE '%eveluateOverTime%'
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Rollback: rename evaluateOverTime back to eveluateOverTime
    await queryRunner.query(`
      UPDATE "Monitor"
      SET "monitorSteps" = REPLACE("monitorSteps"::text, '"evaluateOverTime"', '"eveluateOverTime"')::jsonb
      WHERE "monitorSteps"::text LIKE '%evaluateOverTime%'
    `);
  }
}
