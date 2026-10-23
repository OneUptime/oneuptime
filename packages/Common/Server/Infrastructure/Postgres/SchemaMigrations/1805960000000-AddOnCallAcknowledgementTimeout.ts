import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * An on-call policy's acknowledgement timeout (issue #5123): page again when
 * an incident, alert or episode it paged about stays acknowledged without
 * being resolved (Types/OnCallDutyPolicy/OnCallAcknowledgementTimeout).
 *
 *   - OnCallDutyPolicy.acknowledgementTimeoutInMinutes - how long; empty is
 *     off. Empty on every policy there is: acknowledging keeps stopping the
 *     paging for good, as it always did, until somebody sets it.
 *   - OnCallDutyPolicyExecutionLog.acknowledgementTimeoutStartedAt - while a
 *     record is acknowledged, its policy's clock, on the policy's latest run
 *     for it. Empty on every run there is: no clock runs.
 *   - OnCallDutyPolicyExecutionLog.pageAgainNumber - on a run that pages
 *     again, which time. Empty on every run there is.
 *
 * Generated with npm run generate-postgres-migration, then renumbered after
 * the last registered migration. Every column is nullable with no default,
 * so each is added without rewriting its table, and nothing is backfilled.
 * The index the worker reads the running clocks through is on a table that
 * already holds rows, so it is built online, in the migration registered
 * right after this one: AddOnCallAcknowledgementTimeoutIndex1805970000000.
 */
export class AddOnCallAcknowledgementTimeout1805960000000
  implements MigrationInterface
{
  public name: string = "AddOnCallAcknowledgementTimeout1805960000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicy" ADD "acknowledgementTimeoutInMinutes" integer`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyExecutionLog" ADD "acknowledgementTimeoutStartedAt" TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyExecutionLog" ADD "pageAgainNumber" integer`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyExecutionLog" DROP COLUMN "pageAgainNumber"`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyExecutionLog" DROP COLUMN "acknowledgementTimeoutStartedAt"`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicy" DROP COLUMN "acknowledgementTimeoutInMinutes"`,
    );
  }
}
