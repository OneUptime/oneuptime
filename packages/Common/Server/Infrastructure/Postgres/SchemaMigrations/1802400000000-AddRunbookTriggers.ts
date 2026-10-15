import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * A runbook runs on its own: on a schedule, or when another tool calls its
 * webhook URL (its Triggers page).
 *
 * Runbook gains the schedule - isScheduleEnabled, scheduleCron read in
 * scheduleTimezone, what a time does while a run is still going
 * (scheduleOverlapPolicy) and what a missed time does
 * (scheduleMissedRunPolicy) - and the scheduler's own scheduleNextRunAt and
 * scheduleQueuedRunAt; and the webhook - isWebhookEnabled and the secret
 * key of its URL (webhookSecretKey). RunbookExecution records what started
 * each run (triggerType, triggerDetails) and the values a webhook call sent
 * (inputs).
 *
 * Generated with npm run generate-postgres-migration, then renumbered to a
 * round slot above the registered migrations (SchemaMigrationsOrdering.test).
 * Every column is added empty or with a constant default, which Postgres
 * records in the catalog without rewriting a row, so both tables keep
 * taking writes. The index the scheduler reads due runs by is built online,
 * in AddRunbookScheduleNextRunIndex1802450000000.
 *
 * Nothing changes for an existing runbook: both triggers start off.
 */
export class AddRunbookTriggers1802400000000 implements MigrationInterface {
  public name: string = "AddRunbookTriggers1802400000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "Runbook" ADD "isScheduleEnabled" boolean NOT NULL DEFAULT false`,
    );
    await queryRunner.query(
      `ALTER TABLE "Runbook" ADD "scheduleCron" character varying(100)`,
    );
    await queryRunner.query(
      `ALTER TABLE "Runbook" ADD "scheduleTimezone" character varying(100)`,
    );
    await queryRunner.query(
      `ALTER TABLE "Runbook" ADD "scheduleOverlapPolicy" character varying(100)`,
    );
    await queryRunner.query(
      `ALTER TABLE "Runbook" ADD "scheduleMissedRunPolicy" character varying(100)`,
    );
    await queryRunner.query(
      `ALTER TABLE "Runbook" ADD "scheduleNextRunAt" TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(
      `ALTER TABLE "Runbook" ADD "scheduleQueuedRunAt" TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(
      `ALTER TABLE "Runbook" ADD "isWebhookEnabled" boolean NOT NULL DEFAULT false`,
    );
    await queryRunner.query(
      `ALTER TABLE "Runbook" ADD "webhookSecretKey" character varying(100)`,
    );
    await queryRunner.query(
      `ALTER TABLE "RunbookExecution" ADD "triggerType" character varying(100)`,
    );
    await queryRunner.query(
      `ALTER TABLE "RunbookExecution" ADD "triggerDetails" jsonb`,
    );
    await queryRunner.query(
      `ALTER TABLE "RunbookExecution" ADD "inputs" jsonb`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "RunbookExecution" DROP COLUMN "inputs"`,
    );
    await queryRunner.query(
      `ALTER TABLE "RunbookExecution" DROP COLUMN "triggerDetails"`,
    );
    await queryRunner.query(
      `ALTER TABLE "RunbookExecution" DROP COLUMN "triggerType"`,
    );
    await queryRunner.query(
      `ALTER TABLE "Runbook" DROP COLUMN "webhookSecretKey"`,
    );
    await queryRunner.query(
      `ALTER TABLE "Runbook" DROP COLUMN "isWebhookEnabled"`,
    );
    await queryRunner.query(
      `ALTER TABLE "Runbook" DROP COLUMN "scheduleQueuedRunAt"`,
    );
    await queryRunner.query(
      `ALTER TABLE "Runbook" DROP COLUMN "scheduleNextRunAt"`,
    );
    await queryRunner.query(
      `ALTER TABLE "Runbook" DROP COLUMN "scheduleMissedRunPolicy"`,
    );
    await queryRunner.query(
      `ALTER TABLE "Runbook" DROP COLUMN "scheduleOverlapPolicy"`,
    );
    await queryRunner.query(
      `ALTER TABLE "Runbook" DROP COLUMN "scheduleTimezone"`,
    );
    await queryRunner.query(`ALTER TABLE "Runbook" DROP COLUMN "scheduleCron"`);
    await queryRunner.query(
      `ALTER TABLE "Runbook" DROP COLUMN "isScheduleEnabled"`,
    );
  }
}
