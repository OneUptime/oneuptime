import { MigrationInterface, QueryRunner } from "typeorm";

export class MigrationName1778761532493 implements MigrationInterface {
  public name: string = "MigrationName1778761532493";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "RunbookRule" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "name" character varying(100) NOT NULL, "description" character varying(500), "isEnabled" boolean NOT NULL DEFAULT true, "triggerEntityType" character varying(100) NOT NULL, "titlePattern" character varying(500), "descriptionPattern" character varying(500), "createdByUserId" uuid, "deletedByUserId" uuid, CONSTRAINT "PK_6e65547cfb3ac1899a9734cace5" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_e88bbe1493cbbad18200628fc3" ON "RunbookRule" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_060b8716b5167a0d1e3a6de4b7" ON "RunbookRule" ("name") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_f376511df00ec34689c366294f" ON "RunbookRule" ("isEnabled") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_ba93fa738edbc57df29d67cc09" ON "RunbookRule" ("triggerEntityType") `,
    );
    await queryRunner.query(
      `CREATE TABLE "RunbookRuleRunbook" ("runbookRuleId" uuid NOT NULL, "runbookId" uuid NOT NULL, CONSTRAINT "PK_3e7edeb41d329776f6c817df36c" PRIMARY KEY ("runbookRuleId", "runbookId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_89be4cc8e65a2c4f6fdd15fca7" ON "RunbookRuleRunbook" ("runbookRuleId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_ff00bb915fb957df48f629dd62" ON "RunbookRuleRunbook" ("runbookId") `,
    );
    await queryRunner.query(
      `ALTER TABLE "RunbookExecution" ADD "incidentId" uuid`,
    );
    await queryRunner.query(
      `ALTER TABLE "RunbookExecution" ADD "alertId" uuid`,
    );
    await queryRunner.query(
      `ALTER TABLE "RunbookExecution" ADD "scheduledMaintenanceId" uuid`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "rotation" SET DEFAULT '{"_type":"Recurring","value":{"intervalType":"Day","intervalCount":{"_type":"PositiveNumber","value":1}}}'`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "restrictionTimes" SET DEFAULT '{"_type":"RestrictionTimes","value":{"restictionType":"None","dayRestrictionTimes":null,"weeklyRestrictionTimes":[]}}'`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_e7db3e611dbd7ab1d826808031" ON "RunbookExecution" ("incidentId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_75204c7fb1e4318b1a9afa4275" ON "RunbookExecution" ("alertId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_a4929c7886c6d67179ff911dbb" ON "RunbookExecution" ("scheduledMaintenanceId") `,
    );
    await queryRunner.query(
      `ALTER TABLE "RunbookExecution" ADD CONSTRAINT "FK_e7db3e611dbd7ab1d826808031e" FOREIGN KEY ("incidentId") REFERENCES "Incident"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "RunbookExecution" ADD CONSTRAINT "FK_75204c7fb1e4318b1a9afa42753" FOREIGN KEY ("alertId") REFERENCES "Alert"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "RunbookExecution" ADD CONSTRAINT "FK_a4929c7886c6d67179ff911dbb6" FOREIGN KEY ("scheduledMaintenanceId") REFERENCES "ScheduledMaintenance"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "RunbookRule" ADD CONSTRAINT "FK_e88bbe1493cbbad18200628fc36" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "RunbookRule" ADD CONSTRAINT "FK_281b84d05a5ee57c3920bad60d3" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "RunbookRule" ADD CONSTRAINT "FK_444fbc9d451c96124c6e66116e4" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "RunbookRuleRunbook" ADD CONSTRAINT "FK_89be4cc8e65a2c4f6fdd15fca78" FOREIGN KEY ("runbookRuleId") REFERENCES "RunbookRule"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "RunbookRuleRunbook" ADD CONSTRAINT "FK_ff00bb915fb957df48f629dd62a" FOREIGN KEY ("runbookId") REFERENCES "Runbook"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "RunbookRuleRunbook" DROP CONSTRAINT "FK_ff00bb915fb957df48f629dd62a"`,
    );
    await queryRunner.query(
      `ALTER TABLE "RunbookRuleRunbook" DROP CONSTRAINT "FK_89be4cc8e65a2c4f6fdd15fca78"`,
    );
    await queryRunner.query(
      `ALTER TABLE "RunbookRule" DROP CONSTRAINT "FK_444fbc9d451c96124c6e66116e4"`,
    );
    await queryRunner.query(
      `ALTER TABLE "RunbookRule" DROP CONSTRAINT "FK_281b84d05a5ee57c3920bad60d3"`,
    );
    await queryRunner.query(
      `ALTER TABLE "RunbookRule" DROP CONSTRAINT "FK_e88bbe1493cbbad18200628fc36"`,
    );
    await queryRunner.query(
      `ALTER TABLE "RunbookExecution" DROP CONSTRAINT "FK_a4929c7886c6d67179ff911dbb6"`,
    );
    await queryRunner.query(
      `ALTER TABLE "RunbookExecution" DROP CONSTRAINT "FK_75204c7fb1e4318b1a9afa42753"`,
    );
    await queryRunner.query(
      `ALTER TABLE "RunbookExecution" DROP CONSTRAINT "FK_e7db3e611dbd7ab1d826808031e"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_a4929c7886c6d67179ff911dbb"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_75204c7fb1e4318b1a9afa4275"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_e7db3e611dbd7ab1d826808031"`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "restrictionTimes" SET DEFAULT '{"_type": "RestrictionTimes", "value": {"restictionType": "None", "dayRestrictionTimes": null, "weeklyRestrictionTimes": []}}'`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "rotation" SET DEFAULT '{"_type": "Recurring", "value": {"intervalType": "Day", "intervalCount": {"_type": "PositiveNumber", "value": 1}}}'`,
    );
    await queryRunner.query(
      `ALTER TABLE "RunbookExecution" DROP COLUMN "scheduledMaintenanceId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "RunbookExecution" DROP COLUMN "alertId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "RunbookExecution" DROP COLUMN "incidentId"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_ff00bb915fb957df48f629dd62"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_89be4cc8e65a2c4f6fdd15fca7"`,
    );
    await queryRunner.query(`DROP TABLE "RunbookRuleRunbook"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_ba93fa738edbc57df29d67cc09"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_f376511df00ec34689c366294f"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_060b8716b5167a0d1e3a6de4b7"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_e88bbe1493cbbad18200628fc3"`,
    );
    await queryRunner.query(`DROP TABLE "RunbookRule"`);
  }
}
