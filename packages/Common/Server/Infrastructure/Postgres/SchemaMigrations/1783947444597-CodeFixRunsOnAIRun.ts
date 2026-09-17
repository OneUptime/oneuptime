import { MigrationInterface, QueryRunner } from "typeorm";

export class CodeFixRunsOnAIRun1783947444597 implements MigrationInterface {
  public name = "CodeFixRunsOnAIRun1783947444597";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "AIAgentTaskPullRequest" ADD "aiRunId" uuid`,
    );
    await queryRunner.query(
      `ALTER TABLE "AIRun" ADD "triggeredByTelemetryExceptionId" uuid`,
    );
    await queryRunner.query(`ALTER TABLE "AIRun" ADD "aiAgentId" uuid`);
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "rotation" SET DEFAULT '{"_type":"Recurring","value":{"intervalType":"Day","intervalCount":{"_type":"PositiveNumber","value":1}}}'`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "restrictionTimes" SET DEFAULT '{"_type":"RestrictionTimes","value":{"restictionType":"None","dayRestrictionTimes":null,"weeklyRestrictionTimes":[]}}'`,
    );
    await queryRunner.query(
      `ALTER TABLE "AIAgentTaskPullRequest" DROP CONSTRAINT "FK_e1de7edf3e00ae0d00617086063"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AIAgentTaskPullRequest" ALTER COLUMN "aiAgentTaskId" DROP NOT NULL`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_f7155e112ddac1d0c60767baf0" ON "AIAgentTaskPullRequest" ("aiRunId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_1b64c644c8247682fdedb3e92d" ON "AIRun" ("triggeredByTelemetryExceptionId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_ed7f37e218ed8ba39c5bc79056" ON "AIRun" ("aiAgentId") `,
    );
    await queryRunner.query(
      `ALTER TABLE "AIAgentTaskPullRequest" ADD CONSTRAINT "FK_e1de7edf3e00ae0d00617086063" FOREIGN KEY ("aiAgentTaskId") REFERENCES "AIAgentTask"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "AIAgentTaskPullRequest" DROP CONSTRAINT "FK_e1de7edf3e00ae0d00617086063"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_ed7f37e218ed8ba39c5bc79056"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_1b64c644c8247682fdedb3e92d"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_f7155e112ddac1d0c60767baf0"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AIAgentTaskPullRequest" ALTER COLUMN "aiAgentTaskId" SET NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "AIAgentTaskPullRequest" ADD CONSTRAINT "FK_e1de7edf3e00ae0d00617086063" FOREIGN KEY ("aiAgentTaskId") REFERENCES "AIAgentTask"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "restrictionTimes" SET DEFAULT '{"_type": "RestrictionTimes", "value": {"restictionType": "None", "dayRestrictionTimes": null, "weeklyRestrictionTimes": []}}'`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "rotation" SET DEFAULT '{"_type": "Recurring", "value": {"intervalType": "Day", "intervalCount": {"_type": "PositiveNumber", "value": 1}}}'`,
    );
    await queryRunner.query(`ALTER TABLE "AIRun" DROP COLUMN "aiAgentId"`);
    await queryRunner.query(
      `ALTER TABLE "AIRun" DROP COLUMN "triggeredByTelemetryExceptionId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AIAgentTaskPullRequest" DROP COLUMN "aiRunId"`,
    );
  }
}
