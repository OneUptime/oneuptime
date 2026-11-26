/*
 * Off-hours schedules and the changes OneUptime proposes and makes for
 * savings (#11010): two new tables, an account's environment, and the
 * savings AI rule's columns. Generated against main's schema.
 */
import { MigrationInterface, QueryRunner } from "typeorm";

export class AddCloudSavingsActions1809187711010 implements MigrationInterface {
  public name: string = "AddCloudSavingsActions1809187711010";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "CloudOffHoursSchedule" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "createdByActorType" character varying(100), "createdByActorId" uuid, "lastModifiedAt" TIMESTAMP WITH TIME ZONE, "lastModifiedByActorType" character varying(100), "lastModifiedByActorId" uuid, "lastModifiedByUserId" uuid, "projectId" uuid NOT NULL, "name" character varying(100) NOT NULL, "description" character varying(500), "isEnabled" boolean NOT NULL DEFAULT true, "cloudAccountId" uuid, "tagKey" character varying(500) NOT NULL, "tagValue" character varying(500) NOT NULL, "timezone" character varying(100) NOT NULL DEFAULT 'UTC', "workingDays" jsonb, "startTime" character varying(100) NOT NULL DEFAULT '08:00', "stopTime" character varying(100) NOT NULL DEFAULT '19:00', "stopsInstances" boolean NOT NULL DEFAULT true, "stopsDatabases" boolean NOT NULL DEFAULT true, "lastRunAt" TIMESTAMP WITH TIME ZONE, "lastRunSummary" jsonb, "createdByUserId" uuid, CONSTRAINT "PK_ece8b422fa8b08d5ff184f024c3" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_104580dbf2104bb1ecc3c57be7" ON "CloudOffHoursSchedule" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_0acc04c62c3200ba99e71027bc" ON "CloudOffHoursSchedule" ("isEnabled") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_ea8ee1164817ee2472ebc61704" ON "CloudOffHoursSchedule" ("cloudAccountId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "CloudSavingsAction" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "createdByActorType" character varying(100), "createdByActorId" uuid, "lastModifiedAt" TIMESTAMP WITH TIME ZONE, "lastModifiedByActorType" character varying(100), "lastModifiedByActorId" uuid, "lastModifiedByUserId" uuid, "projectId" uuid NOT NULL, "cloudAccountId" uuid NOT NULL, "cloudConnectionId" uuid, "cloudResourceId" uuid, "cloudOffHoursScheduleId" uuid, "recommendationId" character varying(500), "provider" character varying(100) NOT NULL, "kind" character varying(100) NOT NULL, "status" character varying(100) NOT NULL DEFAULT 'Proposed', "origin" character varying(100) NOT NULL, "environment" character varying(100) NOT NULL DEFAULT 'Unknown', "resourceId" character varying(500) NOT NULL, "resourceName" character varying(100), "resourceType" character varying(100), "region" character varying(100), "fromConfiguration" character varying(100), "toConfiguration" character varying(100), "finalSnapshot" boolean NOT NULL DEFAULT false, "undo" character varying(100) NOT NULL, "monthlySavings" numeric NOT NULL, "currency" character varying(100) NOT NULL, "target" jsonb, "progress" jsonb, "undoProgress" jsonb, "summary" character varying(500), "failureMessage" character varying(500), "nextStepAt" TIMESTAMP WITH TIME ZONE, "requestedByUserId" uuid, "firstApprovedByUserId" uuid, "firstApprovedAt" TIMESTAMP WITH TIME ZONE, "approvedByUserId" uuid, "approvedAt" TIMESTAMP WITH TIME ZONE, "autoRemediationRuleId" uuid, "autoRemediationRuleName" character varying(100), "appliedAt" TIMESTAMP WITH TIME ZONE, "failedAt" TIMESTAMP WITH TIME ZONE, "dismissedByUserId" uuid, "dismissedAt" TIMESTAMP WITH TIME ZONE, "dismissReason" character varying(500), "undoneByUserId" uuid, "undoneAt" TIMESTAMP WITH TIME ZONE, "expiredAt" TIMESTAMP WITH TIME ZONE, "endedAt" TIMESTAMP WITH TIME ZONE, "savedHours" numeric, "measurement" character varying(100), "costBeforeDaily" numeric, "costAfterDaily" numeric, "realisedMonthlySavings" numeric, "measuredAt" TIMESTAMP WITH TIME ZONE, "createdByUserId" uuid, CONSTRAINT "PK_bb1ebbd5ea1330f05fd762fc71e" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_3e4497f3092a3fdf141cd73fe2" ON "CloudSavingsAction" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_1f3965e587aad44994c4814b19" ON "CloudSavingsAction" ("cloudAccountId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_b25fa171f742b8e0d9641ed0a4" ON "CloudSavingsAction" ("cloudResourceId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_bdfebf4a1dffbb3b1b9e00acc4" ON "CloudSavingsAction" ("cloudOffHoursScheduleId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_2998c6c9ec6d48276b3f62c9e4" ON "CloudSavingsAction" ("status") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_81c46de5302ae63532537332a3" ON "CloudSavingsAction" ("nextStepAt") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_d8d499baeee3ed3f2221fcaed6" ON "CloudSavingsAction" ("appliedAt") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_e67381d6add7ca55121c3c0e6a" ON "CloudSavingsAction" ("projectId", "status", "appliedAt") `,
    );
    await queryRunner.query(
      `ALTER TABLE "CloudAccount" ADD "environment" character varying(100) NOT NULL DEFAULT 'Unknown'`,
    );
    await queryRunner.query(
      `ALTER TABLE "AutoRemediationRule" ADD "cloudSavingAutonomy" character varying(100)`,
    );
    await queryRunner.query(
      `ALTER TABLE "AutoRemediationRule" ADD "cloudSavingMonthlyLimit" numeric`,
    );
    await queryRunner.query(
      `ALTER TABLE "AutoRemediationRule" ADD "cloudSavingActionGroups" jsonb`,
    );
    await queryRunner.query(
      `ALTER TABLE "AutoRemediationRule" ADD "cloudSavingEnvironments" jsonb`,
    );
    await queryRunner.query(
      `ALTER TABLE "AutoRemediationRule" ADD "cloudSavingProviders" jsonb`,
    );
    await queryRunner.query(
      `ALTER TABLE "CloudOffHoursSchedule" ADD CONSTRAINT "FK_104580dbf2104bb1ecc3c57be70" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "CloudOffHoursSchedule" ADD CONSTRAINT "FK_ea8ee1164817ee2472ebc617044" FOREIGN KEY ("cloudAccountId") REFERENCES "CloudAccount"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "CloudOffHoursSchedule" ADD CONSTRAINT "FK_92acd975584290f0e5a8598684e" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "CloudSavingsAction" ADD CONSTRAINT "FK_3e4497f3092a3fdf141cd73fe2a" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "CloudSavingsAction" ADD CONSTRAINT "FK_1f3965e587aad44994c4814b196" FOREIGN KEY ("cloudAccountId") REFERENCES "CloudAccount"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "CloudSavingsAction" ADD CONSTRAINT "FK_443578a19c73a3aaa610031170c" FOREIGN KEY ("cloudConnectionId") REFERENCES "CloudConnection"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "CloudSavingsAction" ADD CONSTRAINT "FK_b25fa171f742b8e0d9641ed0a45" FOREIGN KEY ("cloudResourceId") REFERENCES "CloudResource"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "CloudSavingsAction" ADD CONSTRAINT "FK_bdfebf4a1dffbb3b1b9e00acc4b" FOREIGN KEY ("cloudOffHoursScheduleId") REFERENCES "CloudOffHoursSchedule"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "CloudSavingsAction" ADD CONSTRAINT "FK_4daf6631c0c06a14b4bf763def4" FOREIGN KEY ("requestedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "CloudSavingsAction" ADD CONSTRAINT "FK_f9bbbc80d40ba732e51c3133843" FOREIGN KEY ("firstApprovedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "CloudSavingsAction" ADD CONSTRAINT "FK_69121645083933824d549b67429" FOREIGN KEY ("approvedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "CloudSavingsAction" ADD CONSTRAINT "FK_086de42ff13c5203969d96ae9bf" FOREIGN KEY ("dismissedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "CloudSavingsAction" ADD CONSTRAINT "FK_7739249e96a2e60ac95a2c94b99" FOREIGN KEY ("undoneByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "CloudSavingsAction" DROP CONSTRAINT "FK_7739249e96a2e60ac95a2c94b99"`,
    );
    await queryRunner.query(
      `ALTER TABLE "CloudSavingsAction" DROP CONSTRAINT "FK_086de42ff13c5203969d96ae9bf"`,
    );
    await queryRunner.query(
      `ALTER TABLE "CloudSavingsAction" DROP CONSTRAINT "FK_69121645083933824d549b67429"`,
    );
    await queryRunner.query(
      `ALTER TABLE "CloudSavingsAction" DROP CONSTRAINT "FK_f9bbbc80d40ba732e51c3133843"`,
    );
    await queryRunner.query(
      `ALTER TABLE "CloudSavingsAction" DROP CONSTRAINT "FK_4daf6631c0c06a14b4bf763def4"`,
    );
    await queryRunner.query(
      `ALTER TABLE "CloudSavingsAction" DROP CONSTRAINT "FK_bdfebf4a1dffbb3b1b9e00acc4b"`,
    );
    await queryRunner.query(
      `ALTER TABLE "CloudSavingsAction" DROP CONSTRAINT "FK_b25fa171f742b8e0d9641ed0a45"`,
    );
    await queryRunner.query(
      `ALTER TABLE "CloudSavingsAction" DROP CONSTRAINT "FK_443578a19c73a3aaa610031170c"`,
    );
    await queryRunner.query(
      `ALTER TABLE "CloudSavingsAction" DROP CONSTRAINT "FK_1f3965e587aad44994c4814b196"`,
    );
    await queryRunner.query(
      `ALTER TABLE "CloudSavingsAction" DROP CONSTRAINT "FK_3e4497f3092a3fdf141cd73fe2a"`,
    );
    await queryRunner.query(
      `ALTER TABLE "CloudOffHoursSchedule" DROP CONSTRAINT "FK_92acd975584290f0e5a8598684e"`,
    );
    await queryRunner.query(
      `ALTER TABLE "CloudOffHoursSchedule" DROP CONSTRAINT "FK_ea8ee1164817ee2472ebc617044"`,
    );
    await queryRunner.query(
      `ALTER TABLE "CloudOffHoursSchedule" DROP CONSTRAINT "FK_104580dbf2104bb1ecc3c57be70"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AutoRemediationRule" DROP COLUMN "cloudSavingProviders"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AutoRemediationRule" DROP COLUMN "cloudSavingEnvironments"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AutoRemediationRule" DROP COLUMN "cloudSavingActionGroups"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AutoRemediationRule" DROP COLUMN "cloudSavingMonthlyLimit"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AutoRemediationRule" DROP COLUMN "cloudSavingAutonomy"`,
    );
    await queryRunner.query(
      `ALTER TABLE "CloudAccount" DROP COLUMN "environment"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_e67381d6add7ca55121c3c0e6a"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_d8d499baeee3ed3f2221fcaed6"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_81c46de5302ae63532537332a3"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_2998c6c9ec6d48276b3f62c9e4"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_bdfebf4a1dffbb3b1b9e00acc4"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_b25fa171f742b8e0d9641ed0a4"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_1f3965e587aad44994c4814b19"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_3e4497f3092a3fdf141cd73fe2"`,
    );
    await queryRunner.query(`DROP TABLE "CloudSavingsAction"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_ea8ee1164817ee2472ebc61704"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_0acc04c62c3200ba99e71027bc"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_104580dbf2104bb1ecc3c57be7"`,
    );
    await queryRunner.query(`DROP TABLE "CloudOffHoursSchedule"`);
  }
}
