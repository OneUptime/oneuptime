import { MigrationInterface, QueryRunner } from "typeorm";

export class AddAiRemediationLane1785250000000 implements MigrationInterface {
  public name: string = "AddAiRemediationLane1785250000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "AIRemediationAction" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "aiRunId" uuid NOT NULL, "incidentId" uuid, "alertId" uuid, "actionType" character varying(100) NOT NULL, "intent" character varying(100) NOT NULL DEFAULT 'Remediation', "title" character varying(100) NOT NULL, "rationale" text NOT NULL, "runbookId" uuid, "runbookAgentId" uuid, "commandScript" text, "status" character varying(100) NOT NULL DEFAULT 'Proposed', "decisionMode" character varying(100) NOT NULL DEFAULT 'RequireApproval', "approvedByUserId" uuid, "approvedAt" TIMESTAMP WITH TIME ZONE, "rejectedByUserId" uuid, "rejectedAt" TIMESTAMP WITH TIME ZONE, "rejectionReason" character varying(500), "executedAt" TIMESTAMP WITH TIME ZONE, "runbookExecutionId" uuid, "errorMessage" character varying(500), "expiresAt" TIMESTAMP WITH TIME ZONE, "deletedByUserId" uuid, CONSTRAINT "PK_f9401ff79acdc396781e70fa674" PRIMARY KEY ("_id"))`,
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
      `CREATE TABLE "IncidentAutoRemediationRule" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "name" character varying(100) NOT NULL, "description" character varying(500), "isEnabled" boolean NOT NULL DEFAULT true, "incidentTitlePattern" character varying(500), "incidentDescriptionPattern" character varying(500), "monitorNamePattern" character varying(500), "monitorDescriptionPattern" character varying(500), "autoExecuteCommands" boolean NOT NULL DEFAULT true, "createdByUserId" uuid, "deletedByUserId" uuid, CONSTRAINT "PK_cc56cbb711f4d7a71c4b9f0221a" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_7ecb992fe0cdfdf96f2aea5bf3" ON "IncidentAutoRemediationRule" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_96253b776de6994a0fd51ed3b2" ON "IncidentAutoRemediationRule" ("name") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_09429bd4b2e5a5df7af986af0a" ON "IncidentAutoRemediationRule" ("isEnabled") `,
    );
    await queryRunner.query(
      `CREATE TABLE "AlertAutoRemediationRule" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "name" character varying(100) NOT NULL, "description" character varying(500), "isEnabled" boolean NOT NULL DEFAULT true, "alertTitlePattern" character varying(500), "alertDescriptionPattern" character varying(500), "monitorNamePattern" character varying(500), "monitorDescriptionPattern" character varying(500), "autoExecuteCommands" boolean NOT NULL DEFAULT true, "createdByUserId" uuid, "deletedByUserId" uuid, CONSTRAINT "PK_f4c8343f39aa8e8f2d77c5df6c3" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_b21aa5bf67d182ed656445df12" ON "AlertAutoRemediationRule" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_63a19b70296c69220eb66060e1" ON "AlertAutoRemediationRule" ("name") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_92e642402bf6c3caa45c2702e7" ON "AlertAutoRemediationRule" ("isEnabled") `,
    );
    await queryRunner.query(
      `CREATE TABLE "IncidentAutoRemediationRuleMonitor" ("incidentAutoRemediationRuleId" uuid NOT NULL, "monitorId" uuid NOT NULL, CONSTRAINT "PK_28bf73b45761e8a862d0aa80260" PRIMARY KEY ("incidentAutoRemediationRuleId", "monitorId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_285bc9af48e15d6b51c084cada" ON "IncidentAutoRemediationRuleMonitor" ("incidentAutoRemediationRuleId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_70a0504f813fc9bc3e07a3cb79" ON "IncidentAutoRemediationRuleMonitor" ("monitorId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "IncidentAutoRemediationRuleIncidentSeverity" ("incidentAutoRemediationRuleId" uuid NOT NULL, "incidentSeverityId" uuid NOT NULL, CONSTRAINT "PK_cd0b79110f3873f189ade645782" PRIMARY KEY ("incidentAutoRemediationRuleId", "incidentSeverityId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_fef1a63753726d5a2100ab64a0" ON "IncidentAutoRemediationRuleIncidentSeverity" ("incidentAutoRemediationRuleId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_04d5123e0f85f32727233810bb" ON "IncidentAutoRemediationRuleIncidentSeverity" ("incidentSeverityId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "IncidentAutoRemediationRuleIncidentLabel" ("incidentAutoRemediationRuleId" uuid NOT NULL, "labelId" uuid NOT NULL, CONSTRAINT "PK_b08b1d8cc0be94c307749da9a11" PRIMARY KEY ("incidentAutoRemediationRuleId", "labelId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_5919f2535094bea9a34d2da93d" ON "IncidentAutoRemediationRuleIncidentLabel" ("incidentAutoRemediationRuleId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_dd652c75bb5aa54d5b81614737" ON "IncidentAutoRemediationRuleIncidentLabel" ("labelId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "IncidentAutoRemediationRuleMonitorLabel" ("incidentAutoRemediationRuleId" uuid NOT NULL, "labelId" uuid NOT NULL, CONSTRAINT "PK_3445aff23da7231e69e55594155" PRIMARY KEY ("incidentAutoRemediationRuleId", "labelId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_f6099e540badecb0a21fea504c" ON "IncidentAutoRemediationRuleMonitorLabel" ("incidentAutoRemediationRuleId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_8c0798affedf18f658651661d9" ON "IncidentAutoRemediationRuleMonitorLabel" ("labelId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "AlertAutoRemediationRuleMonitor" ("alertAutoRemediationRuleId" uuid NOT NULL, "monitorId" uuid NOT NULL, CONSTRAINT "PK_5eba5e6495c69a0b883860152e1" PRIMARY KEY ("alertAutoRemediationRuleId", "monitorId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_67b8b3d07d5aa8c6eebc35bab2" ON "AlertAutoRemediationRuleMonitor" ("alertAutoRemediationRuleId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_45184ba41c9f7303d0d9c9b20d" ON "AlertAutoRemediationRuleMonitor" ("monitorId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "AlertAutoRemediationRuleAlertSeverity" ("alertAutoRemediationRuleId" uuid NOT NULL, "alertSeverityId" uuid NOT NULL, CONSTRAINT "PK_702942e2e22abee5d1e25d6f17b" PRIMARY KEY ("alertAutoRemediationRuleId", "alertSeverityId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_87adcc7188e1e82db4aac9be22" ON "AlertAutoRemediationRuleAlertSeverity" ("alertAutoRemediationRuleId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_b1aac3f5abba477a3038cf5953" ON "AlertAutoRemediationRuleAlertSeverity" ("alertSeverityId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "AlertAutoRemediationRuleAlertLabel" ("alertAutoRemediationRuleId" uuid NOT NULL, "labelId" uuid NOT NULL, CONSTRAINT "PK_22d2b3ee5d1be27879733c1b931" PRIMARY KEY ("alertAutoRemediationRuleId", "labelId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_d0c265b6a18df9c156db60d567" ON "AlertAutoRemediationRuleAlertLabel" ("alertAutoRemediationRuleId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_f1b0f225b694a3f9c3226d9f03" ON "AlertAutoRemediationRuleAlertLabel" ("labelId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "AlertAutoRemediationRuleMonitorLabel" ("alertAutoRemediationRuleId" uuid NOT NULL, "labelId" uuid NOT NULL, CONSTRAINT "PK_24b3f4acce7f1731dbd8b1114cc" PRIMARY KEY ("alertAutoRemediationRuleId", "labelId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_e5e00f9faf153fc449f3369489" ON "AlertAutoRemediationRuleMonitorLabel" ("alertAutoRemediationRuleId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_e664c59ceead23cbdae5648b6f" ON "AlertAutoRemediationRuleMonitorLabel" ("labelId") `,
    );
    await queryRunner.query(
      `ALTER TABLE "Project" ADD "enableAiRemediation" boolean NOT NULL DEFAULT false`,
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
      `ALTER TABLE "RunbookAgent" ADD "accessLevel" character varying(100) NOT NULL DEFAULT 'ReadOnly'`,
    );
    await queryRunner.query(
      `ALTER TABLE "RunbookExecution" ADD "triggeredByAiRemediationActionId" uuid`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_d2aad31a62550da9400e5dc727" ON "AIInsight" ("escalatedToAlertId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_3eac54bc21a700d2083059dc58" ON "RunbookExecution" ("triggeredByAiRemediationActionId") `,
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
    await queryRunner.query(
      `ALTER TABLE "IncidentAutoRemediationRule" ADD CONSTRAINT "FK_7ecb992fe0cdfdf96f2aea5bf38" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentAutoRemediationRule" ADD CONSTRAINT "FK_e783a9a1691e02edc4b74f911d9" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentAutoRemediationRule" ADD CONSTRAINT "FK_496f314f3c29026aeb68d9f6e81" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertAutoRemediationRule" ADD CONSTRAINT "FK_b21aa5bf67d182ed656445df123" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertAutoRemediationRule" ADD CONSTRAINT "FK_5452dc96e81587f678cbb02f5ee" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertAutoRemediationRule" ADD CONSTRAINT "FK_76ff5778876a57eaff967f754b4" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentAutoRemediationRuleMonitor" ADD CONSTRAINT "FK_285bc9af48e15d6b51c084cadab" FOREIGN KEY ("incidentAutoRemediationRuleId") REFERENCES "IncidentAutoRemediationRule"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentAutoRemediationRuleMonitor" ADD CONSTRAINT "FK_70a0504f813fc9bc3e07a3cb79a" FOREIGN KEY ("monitorId") REFERENCES "Monitor"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentAutoRemediationRuleIncidentSeverity" ADD CONSTRAINT "FK_fef1a63753726d5a2100ab64a0e" FOREIGN KEY ("incidentAutoRemediationRuleId") REFERENCES "IncidentAutoRemediationRule"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentAutoRemediationRuleIncidentSeverity" ADD CONSTRAINT "FK_04d5123e0f85f32727233810bbf" FOREIGN KEY ("incidentSeverityId") REFERENCES "IncidentSeverity"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentAutoRemediationRuleIncidentLabel" ADD CONSTRAINT "FK_5919f2535094bea9a34d2da93df" FOREIGN KEY ("incidentAutoRemediationRuleId") REFERENCES "IncidentAutoRemediationRule"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentAutoRemediationRuleIncidentLabel" ADD CONSTRAINT "FK_dd652c75bb5aa54d5b816147376" FOREIGN KEY ("labelId") REFERENCES "Label"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentAutoRemediationRuleMonitorLabel" ADD CONSTRAINT "FK_f6099e540badecb0a21fea504c5" FOREIGN KEY ("incidentAutoRemediationRuleId") REFERENCES "IncidentAutoRemediationRule"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentAutoRemediationRuleMonitorLabel" ADD CONSTRAINT "FK_8c0798affedf18f658651661d92" FOREIGN KEY ("labelId") REFERENCES "Label"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertAutoRemediationRuleMonitor" ADD CONSTRAINT "FK_67b8b3d07d5aa8c6eebc35bab24" FOREIGN KEY ("alertAutoRemediationRuleId") REFERENCES "AlertAutoRemediationRule"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertAutoRemediationRuleMonitor" ADD CONSTRAINT "FK_45184ba41c9f7303d0d9c9b20de" FOREIGN KEY ("monitorId") REFERENCES "Monitor"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertAutoRemediationRuleAlertSeverity" ADD CONSTRAINT "FK_87adcc7188e1e82db4aac9be22d" FOREIGN KEY ("alertAutoRemediationRuleId") REFERENCES "AlertAutoRemediationRule"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertAutoRemediationRuleAlertSeverity" ADD CONSTRAINT "FK_b1aac3f5abba477a3038cf59537" FOREIGN KEY ("alertSeverityId") REFERENCES "AlertSeverity"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertAutoRemediationRuleAlertLabel" ADD CONSTRAINT "FK_d0c265b6a18df9c156db60d5678" FOREIGN KEY ("alertAutoRemediationRuleId") REFERENCES "AlertAutoRemediationRule"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertAutoRemediationRuleAlertLabel" ADD CONSTRAINT "FK_f1b0f225b694a3f9c3226d9f03a" FOREIGN KEY ("labelId") REFERENCES "Label"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertAutoRemediationRuleMonitorLabel" ADD CONSTRAINT "FK_e5e00f9faf153fc449f3369489e" FOREIGN KEY ("alertAutoRemediationRuleId") REFERENCES "AlertAutoRemediationRule"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertAutoRemediationRuleMonitorLabel" ADD CONSTRAINT "FK_e664c59ceead23cbdae5648b6f7" FOREIGN KEY ("labelId") REFERENCES "Label"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "AlertAutoRemediationRuleMonitorLabel" DROP CONSTRAINT "FK_e664c59ceead23cbdae5648b6f7"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertAutoRemediationRuleMonitorLabel" DROP CONSTRAINT "FK_e5e00f9faf153fc449f3369489e"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertAutoRemediationRuleAlertLabel" DROP CONSTRAINT "FK_f1b0f225b694a3f9c3226d9f03a"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertAutoRemediationRuleAlertLabel" DROP CONSTRAINT "FK_d0c265b6a18df9c156db60d5678"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertAutoRemediationRuleAlertSeverity" DROP CONSTRAINT "FK_b1aac3f5abba477a3038cf59537"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertAutoRemediationRuleAlertSeverity" DROP CONSTRAINT "FK_87adcc7188e1e82db4aac9be22d"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertAutoRemediationRuleMonitor" DROP CONSTRAINT "FK_45184ba41c9f7303d0d9c9b20de"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertAutoRemediationRuleMonitor" DROP CONSTRAINT "FK_67b8b3d07d5aa8c6eebc35bab24"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentAutoRemediationRuleMonitorLabel" DROP CONSTRAINT "FK_8c0798affedf18f658651661d92"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentAutoRemediationRuleMonitorLabel" DROP CONSTRAINT "FK_f6099e540badecb0a21fea504c5"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentAutoRemediationRuleIncidentLabel" DROP CONSTRAINT "FK_dd652c75bb5aa54d5b816147376"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentAutoRemediationRuleIncidentLabel" DROP CONSTRAINT "FK_5919f2535094bea9a34d2da93df"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentAutoRemediationRuleIncidentSeverity" DROP CONSTRAINT "FK_04d5123e0f85f32727233810bbf"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentAutoRemediationRuleIncidentSeverity" DROP CONSTRAINT "FK_fef1a63753726d5a2100ab64a0e"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentAutoRemediationRuleMonitor" DROP CONSTRAINT "FK_70a0504f813fc9bc3e07a3cb79a"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentAutoRemediationRuleMonitor" DROP CONSTRAINT "FK_285bc9af48e15d6b51c084cadab"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertAutoRemediationRule" DROP CONSTRAINT "FK_76ff5778876a57eaff967f754b4"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertAutoRemediationRule" DROP CONSTRAINT "FK_5452dc96e81587f678cbb02f5ee"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertAutoRemediationRule" DROP CONSTRAINT "FK_b21aa5bf67d182ed656445df123"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentAutoRemediationRule" DROP CONSTRAINT "FK_496f314f3c29026aeb68d9f6e81"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentAutoRemediationRule" DROP CONSTRAINT "FK_e783a9a1691e02edc4b74f911d9"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentAutoRemediationRule" DROP CONSTRAINT "FK_7ecb992fe0cdfdf96f2aea5bf38"`,
    );
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
      `DROP INDEX "public"."IDX_3eac54bc21a700d2083059dc58"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_d2aad31a62550da9400e5dc727"`,
    );
    await queryRunner.query(
      `ALTER TABLE "RunbookExecution" DROP COLUMN "triggeredByAiRemediationActionId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "RunbookAgent" DROP COLUMN "accessLevel"`,
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
      `ALTER TABLE "Project" DROP COLUMN "enableAiRemediation"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_e664c59ceead23cbdae5648b6f"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_e5e00f9faf153fc449f3369489"`,
    );
    await queryRunner.query(
      `DROP TABLE "AlertAutoRemediationRuleMonitorLabel"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_f1b0f225b694a3f9c3226d9f03"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_d0c265b6a18df9c156db60d567"`,
    );
    await queryRunner.query(`DROP TABLE "AlertAutoRemediationRuleAlertLabel"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_b1aac3f5abba477a3038cf5953"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_87adcc7188e1e82db4aac9be22"`,
    );
    await queryRunner.query(
      `DROP TABLE "AlertAutoRemediationRuleAlertSeverity"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_45184ba41c9f7303d0d9c9b20d"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_67b8b3d07d5aa8c6eebc35bab2"`,
    );
    await queryRunner.query(`DROP TABLE "AlertAutoRemediationRuleMonitor"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_8c0798affedf18f658651661d9"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_f6099e540badecb0a21fea504c"`,
    );
    await queryRunner.query(
      `DROP TABLE "IncidentAutoRemediationRuleMonitorLabel"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_dd652c75bb5aa54d5b81614737"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_5919f2535094bea9a34d2da93d"`,
    );
    await queryRunner.query(
      `DROP TABLE "IncidentAutoRemediationRuleIncidentLabel"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_04d5123e0f85f32727233810bb"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_fef1a63753726d5a2100ab64a0"`,
    );
    await queryRunner.query(
      `DROP TABLE "IncidentAutoRemediationRuleIncidentSeverity"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_70a0504f813fc9bc3e07a3cb79"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_285bc9af48e15d6b51c084cada"`,
    );
    await queryRunner.query(`DROP TABLE "IncidentAutoRemediationRuleMonitor"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_92e642402bf6c3caa45c2702e7"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_63a19b70296c69220eb66060e1"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_b21aa5bf67d182ed656445df12"`,
    );
    await queryRunner.query(`DROP TABLE "AlertAutoRemediationRule"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_09429bd4b2e5a5df7af986af0a"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_96253b776de6994a0fd51ed3b2"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_7ecb992fe0cdfdf96f2aea5bf3"`,
    );
    await queryRunner.query(`DROP TABLE "IncidentAutoRemediationRule"`);
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
