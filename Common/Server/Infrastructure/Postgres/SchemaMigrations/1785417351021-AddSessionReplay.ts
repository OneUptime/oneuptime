import { MigrationInterface, QueryRunner } from "typeorm";

export class AddSessionReplay1785417351021 implements MigrationInterface {
  public name = "AddSessionReplay1785417351021";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "RumSessionReplayView" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "rumApplicationId" uuid NOT NULL, "sessionId" character varying(100) NOT NULL, "viewedByUserId" uuid, "viewedByApiKeyId" uuid, "viewedAt" TIMESTAMP WITH TIME ZONE NOT NULL, "ipAddress" character varying(100), "userAgent" character varying(500), "secondsWatched" integer NOT NULL DEFAULT '0', "accessReason" character varying(500), "linkedIncidentId" uuid, "linkedExceptionFingerprint" character varying(100), "createdByUserId" uuid, "deletedByUserId" uuid, CONSTRAINT "PK_c731296b4e3a3bc6c553a92795f" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_28e610fcf770d3cc268b8a8197" ON "RumSessionReplayView" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_3341efc216c7e9f8b593d824bb" ON "RumSessionReplayView" ("rumApplicationId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_2ea4dcd898f20102dcb8cbe950" ON "RumSessionReplayView" ("viewedByUserId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_c35c53e0cd828031ed2dac399d" ON "RumSessionReplayView" ("projectId", "viewedByUserId", "viewedAt") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_a269821c17ffd677dd9e9ee0e3" ON "RumSessionReplayView" ("projectId", "sessionId", "viewedAt") `,
    );
    await queryRunner.query(
      `CREATE TABLE "RumSessionErasureRequest" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "rumApplicationId" uuid, "requestType" character varying(100) NOT NULL, "targetValue" character varying(500), "startDate" TIMESTAMP WITH TIME ZONE, "endDate" TIMESTAMP WITH TIME ZONE, "status" character varying(100) NOT NULL DEFAULT 'Pending', "requestedByUserId" uuid, "requestedAt" TIMESTAMP WITH TIME ZONE NOT NULL, "completedAt" TIMESTAMP WITH TIME ZONE, "sessionsDeleted" integer NOT NULL DEFAULT '0', "chunksDeleted" integer NOT NULL DEFAULT '0', "failureReason" character varying(500), "createdByUserId" uuid, "deletedByUserId" uuid, CONSTRAINT "PK_cdf08161eb63f843f3d8c6aa8b8" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_153e1d32a4e87698b683c38d2f" ON "RumSessionErasureRequest" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_5a4f104f01a2ed78423a8b6142" ON "RumSessionErasureRequest" ("rumApplicationId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_6119a02894315ad0062de54aa0" ON "RumSessionErasureRequest" ("projectId", "status", "requestedAt") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_6172682661a1d08cc8ea702b25" ON "RumSessionErasureRequest" ("status", "requestedAt") `,
    );
    await queryRunner.query(
      `CREATE TABLE "RumSessionPin" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "rumApplicationId" uuid NOT NULL, "sessionId" character varying(100) NOT NULL, "pinnedByUserId" uuid, "reason" character varying(500), "incidentId" uuid, "alertId" uuid, "expiresAt" TIMESTAMP WITH TIME ZONE, "materializedAt" TIMESTAMP WITH TIME ZONE, "createdByUserId" uuid, "deletedByUserId" uuid, CONSTRAINT "PK_50e63635a3e6e17d3874e420179" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_29af133735101b0ac1675735d9" ON "RumSessionPin" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_e11889d39de04ba11060708d13" ON "RumSessionPin" ("rumApplicationId") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_0641fefd6347d5204e6afcc01b" ON "RumSessionPin" ("projectId", "rumApplicationId", "sessionId") `,
    );
    await queryRunner.query(
      `ALTER TABLE "Project" ADD "isSessionReplayAllowed" boolean NOT NULL DEFAULT false`,
    );
    await queryRunner.query(
      `ALTER TABLE "RumApplication" ADD "isSessionReplayEnabled" boolean NOT NULL DEFAULT false`,
    );
    await queryRunner.query(
      `ALTER TABLE "RumApplication" ADD "sessionReplayMaskingMode" character varying(100) NOT NULL DEFAULT 'MaskAllText'`,
    );
    await queryRunner.query(
      `ALTER TABLE "RumApplication" ADD "sessionReplayMaskSelectors" jsonb NOT NULL DEFAULT '[]'`,
    );
    await queryRunner.query(
      `ALTER TABLE "RumApplication" ADD "sessionReplayBlockSelectors" jsonb NOT NULL DEFAULT '[]'`,
    );
    await queryRunner.query(
      `ALTER TABLE "RumApplication" ADD "sessionReplayAllowedOrigins" jsonb NOT NULL DEFAULT '[]'`,
    );
    await queryRunner.query(
      `ALTER TABLE "RumApplication" ADD "sessionReplayConsentMode" character varying(100) NOT NULL DEFAULT 'RequireExplicit'`,
    );
    await queryRunner.query(
      `ALTER TABLE "RumApplication" ADD "sessionReplayCaptureTrigger" character varying(100) NOT NULL DEFAULT 'OnErrorOrFrustration'`,
    );
    await queryRunner.query(
      `ALTER TABLE "RumApplication" ADD "sessionReplaySamplePercentage" integer NOT NULL DEFAULT '0'`,
    );
    await queryRunner.query(
      `ALTER TABLE "RumApplication" ADD "sessionReplayCaptureUserIdentity" boolean NOT NULL DEFAULT false`,
    );
    await queryRunner.query(
      `ALTER TABLE "RumApplication" ADD "sessionReplayCaptureGeo" boolean NOT NULL DEFAULT false`,
    );
    await queryRunner.query(
      `ALTER TABLE "RumApplication" ADD "sessionReplayRecordCanvas" boolean NOT NULL DEFAULT false`,
    );
    await queryRunner.query(
      `ALTER TABLE "RumApplication" ADD "sessionReplayRetentionInDays" integer NOT NULL DEFAULT '7'`,
    );
    await queryRunner.query(
      `ALTER TABLE "RumApplication" ADD "sessionReplayMonthlyBudgetInGB" integer`,
    );
    await queryRunner.query(
      `ALTER TABLE "RumApplication" ADD "sessionReplayLastChunkReceivedAt" TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(
      `ALTER TABLE "RumApplication" ADD "sessionReplayBudgetExceededAt" TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "rotation" SET DEFAULT '{"_type":"Recurring","value":{"intervalType":"Day","intervalCount":{"_type":"PositiveNumber","value":1}}}'`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "restrictionTimes" SET DEFAULT '{"_type":"RestrictionTimes","value":{"restictionType":"None","dayRestrictionTimes":null,"weeklyRestrictionTimes":[]}}'`,
    );
    await queryRunner.query(
      `ALTER TABLE "RumSessionReplayView" ADD CONSTRAINT "FK_28e610fcf770d3cc268b8a81973" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "RumSessionReplayView" ADD CONSTRAINT "FK_3341efc216c7e9f8b593d824bb6" FOREIGN KEY ("rumApplicationId") REFERENCES "RumApplication"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "RumSessionReplayView" ADD CONSTRAINT "FK_2ea4dcd898f20102dcb8cbe9500" FOREIGN KEY ("viewedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "RumSessionReplayView" ADD CONSTRAINT "FK_4215567ecaeb1db1ef3d6cc2e6a" FOREIGN KEY ("linkedIncidentId") REFERENCES "Incident"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "RumSessionReplayView" ADD CONSTRAINT "FK_4eba05ce7e0de40ca86c7ed691c" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "RumSessionErasureRequest" ADD CONSTRAINT "FK_153e1d32a4e87698b683c38d2f7" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "RumSessionErasureRequest" ADD CONSTRAINT "FK_5a4f104f01a2ed78423a8b61423" FOREIGN KEY ("rumApplicationId") REFERENCES "RumApplication"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "RumSessionErasureRequest" ADD CONSTRAINT "FK_300b8818e9807028a7cd1f5249d" FOREIGN KEY ("requestedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "RumSessionErasureRequest" ADD CONSTRAINT "FK_6c7c6db492bb0ca7ec8c7da5c6c" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "RumSessionPin" ADD CONSTRAINT "FK_29af133735101b0ac1675735d90" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "RumSessionPin" ADD CONSTRAINT "FK_e11889d39de04ba11060708d13b" FOREIGN KEY ("rumApplicationId") REFERENCES "RumApplication"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "RumSessionPin" ADD CONSTRAINT "FK_87a59a087d7b582e4495986901b" FOREIGN KEY ("pinnedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "RumSessionPin" ADD CONSTRAINT "FK_336ded09ba7bfaab73f0d058508" FOREIGN KEY ("incidentId") REFERENCES "Incident"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "RumSessionPin" ADD CONSTRAINT "FK_e0815e51bbeb69666c0030d2569" FOREIGN KEY ("alertId") REFERENCES "Alert"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "RumSessionPin" ADD CONSTRAINT "FK_b2ead77d56a8e0df5d90749dfb7" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "RumSessionPin" DROP CONSTRAINT "FK_b2ead77d56a8e0df5d90749dfb7"`,
    );
    await queryRunner.query(
      `ALTER TABLE "RumSessionPin" DROP CONSTRAINT "FK_e0815e51bbeb69666c0030d2569"`,
    );
    await queryRunner.query(
      `ALTER TABLE "RumSessionPin" DROP CONSTRAINT "FK_336ded09ba7bfaab73f0d058508"`,
    );
    await queryRunner.query(
      `ALTER TABLE "RumSessionPin" DROP CONSTRAINT "FK_87a59a087d7b582e4495986901b"`,
    );
    await queryRunner.query(
      `ALTER TABLE "RumSessionPin" DROP CONSTRAINT "FK_e11889d39de04ba11060708d13b"`,
    );
    await queryRunner.query(
      `ALTER TABLE "RumSessionPin" DROP CONSTRAINT "FK_29af133735101b0ac1675735d90"`,
    );
    await queryRunner.query(
      `ALTER TABLE "RumSessionErasureRequest" DROP CONSTRAINT "FK_6c7c6db492bb0ca7ec8c7da5c6c"`,
    );
    await queryRunner.query(
      `ALTER TABLE "RumSessionErasureRequest" DROP CONSTRAINT "FK_300b8818e9807028a7cd1f5249d"`,
    );
    await queryRunner.query(
      `ALTER TABLE "RumSessionErasureRequest" DROP CONSTRAINT "FK_5a4f104f01a2ed78423a8b61423"`,
    );
    await queryRunner.query(
      `ALTER TABLE "RumSessionErasureRequest" DROP CONSTRAINT "FK_153e1d32a4e87698b683c38d2f7"`,
    );
    await queryRunner.query(
      `ALTER TABLE "RumSessionReplayView" DROP CONSTRAINT "FK_4eba05ce7e0de40ca86c7ed691c"`,
    );
    await queryRunner.query(
      `ALTER TABLE "RumSessionReplayView" DROP CONSTRAINT "FK_4215567ecaeb1db1ef3d6cc2e6a"`,
    );
    await queryRunner.query(
      `ALTER TABLE "RumSessionReplayView" DROP CONSTRAINT "FK_2ea4dcd898f20102dcb8cbe9500"`,
    );
    await queryRunner.query(
      `ALTER TABLE "RumSessionReplayView" DROP CONSTRAINT "FK_3341efc216c7e9f8b593d824bb6"`,
    );
    await queryRunner.query(
      `ALTER TABLE "RumSessionReplayView" DROP CONSTRAINT "FK_28e610fcf770d3cc268b8a81973"`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "restrictionTimes" SET DEFAULT '{"_type": "RestrictionTimes", "value": {"restictionType": "None", "dayRestrictionTimes": null, "weeklyRestrictionTimes": []}}'`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "rotation" SET DEFAULT '{"_type": "Recurring", "value": {"intervalType": "Day", "intervalCount": {"_type": "PositiveNumber", "value": 1}}}'`,
    );
    await queryRunner.query(
      `ALTER TABLE "RumApplication" DROP COLUMN "sessionReplayBudgetExceededAt"`,
    );
    await queryRunner.query(
      `ALTER TABLE "RumApplication" DROP COLUMN "sessionReplayLastChunkReceivedAt"`,
    );
    await queryRunner.query(
      `ALTER TABLE "RumApplication" DROP COLUMN "sessionReplayMonthlyBudgetInGB"`,
    );
    await queryRunner.query(
      `ALTER TABLE "RumApplication" DROP COLUMN "sessionReplayRetentionInDays"`,
    );
    await queryRunner.query(
      `ALTER TABLE "RumApplication" DROP COLUMN "sessionReplayRecordCanvas"`,
    );
    await queryRunner.query(
      `ALTER TABLE "RumApplication" DROP COLUMN "sessionReplayCaptureGeo"`,
    );
    await queryRunner.query(
      `ALTER TABLE "RumApplication" DROP COLUMN "sessionReplayCaptureUserIdentity"`,
    );
    await queryRunner.query(
      `ALTER TABLE "RumApplication" DROP COLUMN "sessionReplaySamplePercentage"`,
    );
    await queryRunner.query(
      `ALTER TABLE "RumApplication" DROP COLUMN "sessionReplayCaptureTrigger"`,
    );
    await queryRunner.query(
      `ALTER TABLE "RumApplication" DROP COLUMN "sessionReplayConsentMode"`,
    );
    await queryRunner.query(
      `ALTER TABLE "RumApplication" DROP COLUMN "sessionReplayAllowedOrigins"`,
    );
    await queryRunner.query(
      `ALTER TABLE "RumApplication" DROP COLUMN "sessionReplayBlockSelectors"`,
    );
    await queryRunner.query(
      `ALTER TABLE "RumApplication" DROP COLUMN "sessionReplayMaskSelectors"`,
    );
    await queryRunner.query(
      `ALTER TABLE "RumApplication" DROP COLUMN "sessionReplayMaskingMode"`,
    );
    await queryRunner.query(
      `ALTER TABLE "RumApplication" DROP COLUMN "isSessionReplayEnabled"`,
    );
    await queryRunner.query(
      `ALTER TABLE "Project" DROP COLUMN "isSessionReplayAllowed"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_0641fefd6347d5204e6afcc01b"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_e11889d39de04ba11060708d13"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_29af133735101b0ac1675735d9"`,
    );
    await queryRunner.query(`DROP TABLE "RumSessionPin"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_6172682661a1d08cc8ea702b25"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_6119a02894315ad0062de54aa0"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_5a4f104f01a2ed78423a8b6142"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_153e1d32a4e87698b683c38d2f"`,
    );
    await queryRunner.query(`DROP TABLE "RumSessionErasureRequest"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_a269821c17ffd677dd9e9ee0e3"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_c35c53e0cd828031ed2dac399d"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_2ea4dcd898f20102dcb8cbe950"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_3341efc216c7e9f8b593d824bb"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_28e610fcf770d3cc268b8a8197"`,
    );
    await queryRunner.query(`DROP TABLE "RumSessionReplayView"`);
  }
}
