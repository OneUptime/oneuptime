import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Written in the form npm run generate-postgres-migration gives, numbered
 * after the last registered migration.
 *
 * An alert or incident on-call rule can let OneUptime AI respond first
 * (OnCallRuleWhenToPage.AfterOneUptimeAI, OnCallPolicyAiHold): when AI may
 * fix what the record is about, the run waits while AI works, for at most
 * the rule's hold time. The four on-call rules each get that hold time; an
 * execution log gets how its hold ended.
 *
 * Nothing to backfill: whenToPage keeps what every rule pages with today,
 * and both columns are nullable - empty is the default hold time on a rule,
 * and no hold on a run.
 */
export class AddOnCallAiFirstResponder1808080000000
  implements MigrationInterface
{
  public name: string = "AddOnCallAiFirstResponder1808080000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyExecutionLog" ADD "aiHoldOutcome" character varying(100)`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertOnCallRule" ADD "aiHoldTimeInMinutes" integer`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertEpisodeOnCallRule" ADD "aiHoldTimeInMinutes" integer`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentOnCallRule" ADD "aiHoldTimeInMinutes" integer`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentEpisodeOnCallRule" ADD "aiHoldTimeInMinutes" integer`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "IncidentEpisodeOnCallRule" DROP COLUMN "aiHoldTimeInMinutes"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentOnCallRule" DROP COLUMN "aiHoldTimeInMinutes"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertEpisodeOnCallRule" DROP COLUMN "aiHoldTimeInMinutes"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertOnCallRule" DROP COLUMN "aiHoldTimeInMinutes"`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyExecutionLog" DROP COLUMN "aiHoldOutcome"`,
    );
  }
}
