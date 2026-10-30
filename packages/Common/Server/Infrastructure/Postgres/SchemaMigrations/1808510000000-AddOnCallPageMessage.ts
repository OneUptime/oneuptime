import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Generated with npm run check-postgres-schema-drift (the statement TypeORM
 * generates for the model), then renumbered after the last registered
 * migration.
 *
 * A page somebody asks for from Slack or Microsoft Teams, in an incident's
 * or an alert's own channel, is about that incident or alert - no alert is
 * created for it - and carries what they wrote to the people it pages: an
 * execution log gets "pageMessage", which the run's chat message quotes and
 * the people paged read in their notifications (OnCallPersonPage).
 *
 * Nothing to backfill: the column is nullable, and empty on every run there
 * is - no page carried a message of its own before.
 */
export class AddOnCallPageMessage1808510000000 implements MigrationInterface {
  public name: string = "AddOnCallPageMessage1808510000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyExecutionLog" ADD "pageMessage" character varying(500)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyExecutionLog" DROP COLUMN "pageMessage"`,
    );
  }
}
