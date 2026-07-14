import { MigrationInterface, QueryRunner } from "typeorm";

export class AddFixGuardrailColumns1783970619301 implements MigrationInterface {
  public name = "AddFixGuardrailColumns1783970619301";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "AIAgentTaskPullRequest" DROP CONSTRAINT "FK_e1de7edf3e00ae0d00617086063"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_e1de7edf3e00ae0d0061708606"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AIAgentTaskPullRequest" DROP COLUMN "aiAgentTaskId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "Project" ADD "aiDailyFixTaskLimit" integer`,
    );
    await queryRunner.query(
      `ALTER TABLE "CodeRepository" ADD "maxOpenFixPullRequests" integer`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "rotation" SET DEFAULT '{"_type":"Recurring","value":{"intervalType":"Day","intervalCount":{"_type":"PositiveNumber","value":1}}}'`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "restrictionTimes" SET DEFAULT '{"_type":"RestrictionTimes","value":{"restictionType":"None","dayRestrictionTimes":null,"weeklyRestrictionTimes":[]}}'`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "restrictionTimes" SET DEFAULT '{"_type": "RestrictionTimes", "value": {"restictionType": "None", "dayRestrictionTimes": null, "weeklyRestrictionTimes": []}}'`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "rotation" SET DEFAULT '{"_type": "Recurring", "value": {"intervalType": "Day", "intervalCount": {"_type": "PositiveNumber", "value": 1}}}'`,
    );
    await queryRunner.query(
      `ALTER TABLE "CodeRepository" DROP COLUMN "maxOpenFixPullRequests"`,
    );
    await queryRunner.query(
      `ALTER TABLE "Project" DROP COLUMN "aiDailyFixTaskLimit"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AIAgentTaskPullRequest" ADD "aiAgentTaskId" uuid`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_e1de7edf3e00ae0d0061708606" ON "AIAgentTaskPullRequest" ("aiAgentTaskId") `,
    );
    await queryRunner.query(
      `ALTER TABLE "AIAgentTaskPullRequest" ADD CONSTRAINT "FK_e1de7edf3e00ae0d00617086063" FOREIGN KEY ("aiAgentTaskId") REFERENCES "AIAgentTask"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
  }
}
