import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Investigation rules can wait (issue #5074): "only if the incident is still
 * open after N minutes".
 *
 *   - AIInvestigationRule.onlyIfOpenAfterMinutes - the rule's wait. Empty on
 *     every existing rule, which is no wait: every rule keeps investigating
 *     right away, as it did.
 *   - Incident / Alert.aiInvestigationWaitUntil - while a record waits for
 *     its investigation, when the wait ends. Empty on every existing record.
 *   - AIRun.ruleWaitMinutes - on an investigation a rule made wait, the
 *     wait: such a run never releases auto remediation, which did not wait
 *     for it. Empty on every existing run.
 *
 * Generated with npm run generate-postgres-migration. Every column is
 * nullable with no default, so each is added without rewriting its table;
 * nothing is backfilled. Their indexes are on tables projects already have
 * rows in, so they are built online, in the migration registered right
 * after this one: AddInvestigationRuleWaitIndexes1805040000000.
 */
export class AddInvestigationRuleWait1805030000000
  implements MigrationInterface
{
  public name: string = "AddInvestigationRuleWait1805030000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "Incident" ADD "aiInvestigationWaitUntil" TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(
      `ALTER TABLE "Alert" ADD "aiInvestigationWaitUntil" TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(
      `ALTER TABLE "AIRun" ADD "ruleWaitMinutes" integer`,
    );
    await queryRunner.query(
      `ALTER TABLE "AIInvestigationRule" ADD "onlyIfOpenAfterMinutes" integer`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "AIInvestigationRule" DROP COLUMN "onlyIfOpenAfterMinutes"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AIRun" DROP COLUMN "ruleWaitMinutes"`,
    );
    await queryRunner.query(
      `ALTER TABLE "Alert" DROP COLUMN "aiInvestigationWaitUntil"`,
    );
    await queryRunner.query(
      `ALTER TABLE "Incident" DROP COLUMN "aiInvestigationWaitUntil"`,
    );
  }
}
