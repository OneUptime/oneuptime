import { MigrationInterface, QueryRunner } from "typeorm";
import CaptureSpan from "../../../Utils/Telemetry/CaptureSpan";

export class RenameNotificationRuleTypes1769517677937
  implements MigrationInterface
{
  public name = "RenameNotificationRuleTypes1769517677937";

  @CaptureSpan()
  public async up(queryRunner: QueryRunner): Promise<void> {
    // 1. Update rules with "When on-call policy is executed" and incidentSeverityId (not null)
    //    to "When incident on-call policy is executed"
    await queryRunner.query(
      `UPDATE "UserNotificationRule"
       SET "ruleType" = 'When incident on-call policy is executed'
       WHERE "ruleType" = 'When on-call policy is executed'
       AND "incidentSeverityId" IS NOT NULL`,
    );

    // 2. Update rules with "When on-call policy is executed" and alertSeverityId (not null)
    //    to "When alert on-call policy is executed"
    await queryRunner.query(
      `UPDATE "UserNotificationRule"
       SET "ruleType" = 'When alert on-call policy is executed'
       WHERE "ruleType" = 'When on-call policy is executed'
       AND "alertSeverityId" IS NOT NULL`,
    );

    // 3. Update rules with "When episode on-call policy is executed"
    //    to "When alert episode on-call policy is executed"
    await queryRunner.query(
      `UPDATE "UserNotificationRule"
       SET "ruleType" = 'When alert episode on-call policy is executed'
       WHERE "ruleType" = 'When episode on-call policy is executed'`,
    );
  }

  @CaptureSpan()
  public async down(queryRunner: QueryRunner): Promise<void> {
    // Revert "When incident on-call policy is executed" back to "When on-call policy is executed"
    await queryRunner.query(
      `UPDATE "UserNotificationRule"
       SET "ruleType" = 'When on-call policy is executed'
       WHERE "ruleType" = 'When incident on-call policy is executed'`,
    );

    // Revert "When alert on-call policy is executed" back to "When on-call policy is executed"
    await queryRunner.query(
      `UPDATE "UserNotificationRule"
       SET "ruleType" = 'When on-call policy is executed'
       WHERE "ruleType" = 'When alert on-call policy is executed'`,
    );

    // Revert "When alert episode on-call policy is executed" back to "When episode on-call policy is executed"
    await queryRunner.query(
      `UPDATE "UserNotificationRule"
       SET "ruleType" = 'When episode on-call policy is executed'
       WHERE "ruleType" = 'When alert episode on-call policy is executed'`,
    );
  }
}
