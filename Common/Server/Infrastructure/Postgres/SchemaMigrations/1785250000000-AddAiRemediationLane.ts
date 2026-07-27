import { MigrationInterface, QueryRunner } from "typeorm";

export class AddAiRemediationLane1785250000000 implements MigrationInterface {
  public name: string = "AddAiRemediationLane1785250000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "AIRemediationAction" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "aiRunId" uuid NOT NULL, "incidentId" uuid, "alertId" uuid, "actionType" character varying(100) NOT NULL, "title" character varying(100) NOT NULL, "rationale" text NOT NULL, "runbookId" uuid, "runbookAgentId" uuid, "commandScript" text, "status" character varying(100) NOT NULL DEFAULT 'Proposed', "decisionMode" character varying(100) NOT NULL DEFAULT 'RequireApproval', "approvedByUserId" uuid, "approvedAt" TIMESTAMP WITH TIME ZONE, "rejectedByUserId" uuid, "rejectedAt" TIMESTAMP WITH TIME ZONE, "rejectionReason" character varying(500), "executedAt" TIMESTAMP WITH TIME ZONE, "runbookExecutionId" uuid, "errorMessage" character varying(500), "expiresAt" TIMESTAMP WITH TIME ZONE, "deletedByUserId" uuid, CONSTRAINT "PK_f9401ff79acdc396781e70fa674" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_e58ff01e20bb914feaea204241" ON "AIRemediationAction" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_3dce2b886435f9bdb56132843a" ON "AIRemediationAction" ("aiRunId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_48afe0455bd4247976b125c87b" ON "AIRemediationAction" ("incidentId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_893d9310cf8c4affd18813f5a8" ON "AIRemediationAction" ("alertId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_d98e3710854a24848de4fa1178" ON "AIRemediationAction" ("actionType") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_656af7440dd3364f118f19fef0" ON "AIRemediationAction" ("runbookId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_07ca2fce5dc51f520d9a962457" ON "AIRemediationAction" ("status") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_f72abcccd65a4f80126b1e9b2f" ON "AIRemediationAction" ("runbookExecutionId") `,
    );
    await queryRunner.query(
      `ALTER TABLE "Project" ADD "enableAiRemediation" boolean NOT NULL DEFAULT false`,
    );
    await queryRunner.query(
      `ALTER TABLE "Project" ADD "enableAiAutoRemediationOnNonProduction" boolean NOT NULL DEFAULT false`,
    );
    await queryRunner.query(
      `ALTER TABLE "Project" ADD "aiDailyRemediationExecutionLimit" integer`,
    );
    await queryRunner.query(
      `ALTER TABLE "Project" ADD "enableAiInsightEscalation" boolean NOT NULL DEFAULT false`,
    );
    await queryRunner.query(
      `ALTER TABLE "Project" ADD "aiInsightEscalationMinimumSeverity" character varying(100)`,
    );
    await queryRunner.query(
      `ALTER TABLE "Project" ADD "aiInsightEscalationAlertSeverityId" uuid`,
    );
    await queryRunner.query(
      `ALTER TABLE "Project" ADD "aiInsightEscalationOnCallDutyPolicyId" uuid`,
    );
    await queryRunner.query(
      `ALTER TABLE "AIInsight" ADD "escalatedToAlertId" uuid`,
    );
    await queryRunner.query(
      `ALTER TABLE "Runbook" ADD "isCreatedByAi" boolean NOT NULL DEFAULT false`,
    );
    await queryRunner.query(
      `ALTER TABLE "RunbookAgent" ADD "environmentType" character varying(100) NOT NULL DEFAULT 'Production'`,
    );
    await queryRunner.query(
      `ALTER TABLE "RunbookExecution" ADD "triggeredByAiRemediationActionId" uuid`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_d2aad31a62550da9400e5dc727" ON "AIInsight" ("escalatedToAlertId") `,
    );
    await queryRunner.query(
      `ALTER TABLE "Project" ADD CONSTRAINT "FK_2c698165cdd43aeaf7e59409824" FOREIGN KEY ("aiInsightEscalationAlertSeverityId") REFERENCES "AlertSeverity"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "Project" ADD CONSTRAINT "FK_fc310779603a0e24cb789e1a219" FOREIGN KEY ("aiInsightEscalationOnCallDutyPolicyId") REFERENCES "OnCallDutyPolicy"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "AIRemediationAction" ADD CONSTRAINT "FK_e58ff01e20bb914feaea204241b" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "AIRemediationAction" ADD CONSTRAINT "FK_3c4bf01c47bfb2c095aef9c34d6" FOREIGN KEY ("approvedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "AIRemediationAction" ADD CONSTRAINT "FK_0f51c4cf1f82a5b12cb88d4df0b" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "AIRemediationAction" DROP CONSTRAINT "FK_0f51c4cf1f82a5b12cb88d4df0b"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AIRemediationAction" DROP CONSTRAINT "FK_3c4bf01c47bfb2c095aef9c34d6"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AIRemediationAction" DROP CONSTRAINT "FK_e58ff01e20bb914feaea204241b"`,
    );
    await queryRunner.query(
      `ALTER TABLE "Project" DROP CONSTRAINT "FK_fc310779603a0e24cb789e1a219"`,
    );
    await queryRunner.query(
      `ALTER TABLE "Project" DROP CONSTRAINT "FK_2c698165cdd43aeaf7e59409824"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_d2aad31a62550da9400e5dc727"`,
    );
    await queryRunner.query(
      `ALTER TABLE "RunbookExecution" DROP COLUMN "triggeredByAiRemediationActionId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "RunbookAgent" DROP COLUMN "environmentType"`,
    );
    await queryRunner.query(
      `ALTER TABLE "Runbook" DROP COLUMN "isCreatedByAi"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AIInsight" DROP COLUMN "escalatedToAlertId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "Project" DROP COLUMN "aiInsightEscalationOnCallDutyPolicyId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "Project" DROP COLUMN "aiInsightEscalationAlertSeverityId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "Project" DROP COLUMN "aiInsightEscalationMinimumSeverity"`,
    );
    await queryRunner.query(
      `ALTER TABLE "Project" DROP COLUMN "enableAiInsightEscalation"`,
    );
    await queryRunner.query(
      `ALTER TABLE "Project" DROP COLUMN "aiDailyRemediationExecutionLimit"`,
    );
    await queryRunner.query(
      `ALTER TABLE "Project" DROP COLUMN "enableAiAutoRemediationOnNonProduction"`,
    );
    await queryRunner.query(
      `ALTER TABLE "Project" DROP COLUMN "enableAiRemediation"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_f72abcccd65a4f80126b1e9b2f"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_07ca2fce5dc51f520d9a962457"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_656af7440dd3364f118f19fef0"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_d98e3710854a24848de4fa1178"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_893d9310cf8c4affd18813f5a8"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_48afe0455bd4247976b125c87b"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_3dce2b886435f9bdb56132843a"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_e58ff01e20bb914feaea204241"`,
    );
    await queryRunner.query(`DROP TABLE "AIRemediationAction"`);
  }
}
