import { MigrationInterface, QueryRunner } from "typeorm";

export class AddRemindWhileScheduledToScheduledMaintenanceReminderRule1783330000000
  implements MigrationInterface
{
  public name =
    "AddRemindWhileScheduledToScheduledMaintenanceReminderRule1783330000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenanceReminderRule" ADD "remindWhileScheduled" boolean NOT NULL DEFAULT false`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenanceReminderRule" DROP COLUMN "remindWhileScheduled"`,
    );
  }
}
