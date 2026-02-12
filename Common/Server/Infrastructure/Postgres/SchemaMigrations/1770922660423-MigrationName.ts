import { MigrationInterface, QueryRunner } from "typeorm";

export class MigrationName1770922660423 implements MigrationInterface {
  public name = "MigrationName1770922660423";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX "public"."IDX_workspace_user_auth_token_workspace_project_id"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_workspace_notification_rule_workspace_project_auth_token_id"`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "rotation" SET DEFAULT '{"_type":"Recurring","value":{"intervalType":"Day","intervalCount":{"_type":"PositiveNumber","value":1}}}'`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "restrictionTimes" SET DEFAULT '{"_type":"RestrictionTimes","value":{"restictionType":"None","dayRestrictionTimes":null,"weeklyRestrictionTimes":[]}}'`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_50f3ab2c779757f0f72733b9f5" ON "WorkspaceUserAuthToken" ("workspaceProjectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_5691297e1b384944dea798b07a" ON "WorkspaceNotificationRule" ("workspaceProjectAuthTokenId") `,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX "public"."IDX_5691297e1b384944dea798b07a"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_50f3ab2c779757f0f72733b9f5"`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "restrictionTimes" SET DEFAULT '{"_type": "RestrictionTimes", "value": {"restictionType": "None", "dayRestrictionTimes": null, "weeklyRestrictionTimes": []}}'`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "rotation" SET DEFAULT '{"_type": "Recurring", "value": {"intervalType": "Day", "intervalCount": {"_type": "PositiveNumber", "value": 1}}}'`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_workspace_notification_rule_workspace_project_auth_token_id" ON "WorkspaceNotificationRule" ("workspaceProjectAuthTokenId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_workspace_user_auth_token_workspace_project_id" ON "WorkspaceUserAuthToken" ("workspaceProjectId") `,
    );
  }
}
