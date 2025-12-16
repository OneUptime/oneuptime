import { MigrationInterface, QueryRunner } from "typeorm";

export class MigrationName1765830758857 implements MigrationInterface {
  public name = "MigrationName1765830758857";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "LlmLog" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "llmProviderId" uuid, "llmProviderName" character varying(100), "llmType" character varying(100), "modelName" character varying(100), "isGlobalProvider" boolean NOT NULL DEFAULT false, "inputTokens" integer NOT NULL DEFAULT '0', "outputTokens" integer NOT NULL DEFAULT '0', "totalTokens" integer NOT NULL DEFAULT '0', "costInUSDCents" integer NOT NULL DEFAULT '0', "wasBilled" boolean NOT NULL DEFAULT false, "status" character varying(100) NOT NULL, "statusMessage" character varying(500), "feature" character varying(100), "requestPrompt" text, "responsePreview" text, "incidentId" uuid, "alertId" uuid, "scheduledMaintenanceId" uuid, "userId" uuid, "requestStartedAt" TIMESTAMP WITH TIME ZONE, "requestCompletedAt" TIMESTAMP WITH TIME ZONE, "durationMs" integer, "deletedByUserId" uuid, CONSTRAINT "PK_807b7f4578f9dcbb1f7aeeb94f8" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_c3c061a924f368e2cc68a23308" ON "LlmLog" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_bfd15354697dc30fedf7a96976" ON "LlmLog" ("llmProviderId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_159d2b07c02788dcac8575bf4a" ON "LlmLog" ("incidentId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_83696b0732c0a3601a9d5d7afe" ON "LlmLog" ("alertId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_19d277440e9b9e3ed4fa46c227" ON "LlmLog" ("scheduledMaintenanceId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_5c6c985581a3f85d84a2987daa" ON "LlmLog" ("userId") `,
    );
    await queryRunner.query(
      `ALTER TABLE "LlmProvider" ADD "costPerMillionTokensInUSDCents" integer NOT NULL DEFAULT '0'`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "rotation" SET DEFAULT '{"_type":"Recurring","value":{"intervalType":"Day","intervalCount":{"_type":"PositiveNumber","value":1}}}'`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "restrictionTimes" SET DEFAULT '{"_type":"RestrictionTimes","value":{"restictionType":"None","dayRestrictionTimes":null,"weeklyRestrictionTimes":[]}}'`,
    );
    await queryRunner.query(
      `ALTER TABLE "LlmLog" ADD CONSTRAINT "FK_c3c061a924f368e2cc68a233083" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "LlmLog" ADD CONSTRAINT "FK_bfd15354697dc30fedf7a96976e" FOREIGN KEY ("llmProviderId") REFERENCES "LlmProvider"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "LlmLog" ADD CONSTRAINT "FK_159d2b07c02788dcac8575bf4a6" FOREIGN KEY ("incidentId") REFERENCES "Incident"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "LlmLog" ADD CONSTRAINT "FK_83696b0732c0a3601a9d5d7afe1" FOREIGN KEY ("alertId") REFERENCES "Alert"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "LlmLog" ADD CONSTRAINT "FK_19d277440e9b9e3ed4fa46c227a" FOREIGN KEY ("scheduledMaintenanceId") REFERENCES "ScheduledMaintenance"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "LlmLog" ADD CONSTRAINT "FK_5c6c985581a3f85d84a2987daae" FOREIGN KEY ("userId") REFERENCES "User"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "LlmLog" ADD CONSTRAINT "FK_bbe2bdcf251d6ef1ea43b666370" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "LlmLog" DROP CONSTRAINT "FK_bbe2bdcf251d6ef1ea43b666370"`,
    );
    await queryRunner.query(
      `ALTER TABLE "LlmLog" DROP CONSTRAINT "FK_5c6c985581a3f85d84a2987daae"`,
    );
    await queryRunner.query(
      `ALTER TABLE "LlmLog" DROP CONSTRAINT "FK_19d277440e9b9e3ed4fa46c227a"`,
    );
    await queryRunner.query(
      `ALTER TABLE "LlmLog" DROP CONSTRAINT "FK_83696b0732c0a3601a9d5d7afe1"`,
    );
    await queryRunner.query(
      `ALTER TABLE "LlmLog" DROP CONSTRAINT "FK_159d2b07c02788dcac8575bf4a6"`,
    );
    await queryRunner.query(
      `ALTER TABLE "LlmLog" DROP CONSTRAINT "FK_bfd15354697dc30fedf7a96976e"`,
    );
    await queryRunner.query(
      `ALTER TABLE "LlmLog" DROP CONSTRAINT "FK_c3c061a924f368e2cc68a233083"`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "restrictionTimes" SET DEFAULT '{"_type": "RestrictionTimes", "value": {"restictionType": "None", "dayRestrictionTimes": null, "weeklyRestrictionTimes": []}}'`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "rotation" SET DEFAULT '{"_type": "Recurring", "value": {"intervalType": "Day", "intervalCount": {"_type": "PositiveNumber", "value": 1}}}'`,
    );
    await queryRunner.query(
      `ALTER TABLE "LlmProvider" DROP COLUMN "costPerMillionTokensInUSDCents"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_5c6c985581a3f85d84a2987daa"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_19d277440e9b9e3ed4fa46c227"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_83696b0732c0a3601a9d5d7afe"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_159d2b07c02788dcac8575bf4a"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_bfd15354697dc30fedf7a96976"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_c3c061a924f368e2cc68a23308"`,
    );
    await queryRunner.query(`DROP TABLE "LlmLog"`);
  }
}
