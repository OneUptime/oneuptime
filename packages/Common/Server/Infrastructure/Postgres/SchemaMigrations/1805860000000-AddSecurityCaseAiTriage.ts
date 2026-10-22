import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Generated with npm run generate-postgres-migration, then renumbered after
 * the last registered migration. The index on AIRun's new column is built
 * online by the next migration (AddAIRunSecurityCaseIndex1805870000000).
 *
 * OneUptime AI triages security cases (SecurityCaseTriageRunner):
 *
 *   - Project.enableAutomaticSecurityCaseTriage: whether a case a detection
 *     opens is triaged on its own. Off for every project that exists, so an
 *     upgrade spends no AI credits unasked; a project created from now on
 *     starts with it on (ProjectService NEW_PROJECT_AI_DEFAULT_COLUMNS).
 *   - SecurityCase.ai*: the triage's read of the case, the priority and
 *     playbook it suggests, its report, when, and whether the case's data
 *     held text written to steer an AI. Written only by OneUptime; empty
 *     until a triage finishes.
 *   - AIRun.triggeredBySecurityCaseId: the case a triage run is about.
 *
 * Nothing to backfill: every new column is empty, and the switch's constant
 * default adds a NOT NULL column without rewriting a row.
 */
export class AddSecurityCaseAiTriage1805860000000 implements MigrationInterface {
  public name: string = "AddSecurityCaseAiTriage1805860000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "Project" ADD "enableAutomaticSecurityCaseTriage" boolean NOT NULL DEFAULT false`,
    );
    await queryRunner.query(
      `ALTER TABLE "SecurityCase" ADD "aiVerdict" character varying(100)`,
    );
    await queryRunner.query(
      `ALTER TABLE "SecurityCase" ADD "aiSuggestedPriority" character varying(100)`,
    );
    await queryRunner.query(
      `ALTER TABLE "SecurityCase" ADD "aiSuggestedPlaybookId" uuid`,
    );
    await queryRunner.query(
      `ALTER TABLE "SecurityCase" ADD "aiTriageReport" text`,
    );
    await queryRunner.query(
      `ALTER TABLE "SecurityCase" ADD "aiTriagedAt" TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(
      `ALTER TABLE "SecurityCase" ADD "aiTriagePromptInjectionSuspected" boolean`,
    );
    await queryRunner.query(
      `ALTER TABLE "AIRun" ADD "triggeredBySecurityCaseId" uuid`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "AIRun" DROP COLUMN "triggeredBySecurityCaseId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "SecurityCase" DROP COLUMN "aiTriagePromptInjectionSuspected"`,
    );
    await queryRunner.query(
      `ALTER TABLE "SecurityCase" DROP COLUMN "aiTriagedAt"`,
    );
    await queryRunner.query(
      `ALTER TABLE "SecurityCase" DROP COLUMN "aiTriageReport"`,
    );
    await queryRunner.query(
      `ALTER TABLE "SecurityCase" DROP COLUMN "aiSuggestedPlaybookId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "SecurityCase" DROP COLUMN "aiSuggestedPriority"`,
    );
    await queryRunner.query(`ALTER TABLE "SecurityCase" DROP COLUMN "aiVerdict"`);
    await queryRunner.query(
      `ALTER TABLE "Project" DROP COLUMN "enableAutomaticSecurityCaseTriage"`,
    );
  }
}
