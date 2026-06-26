import { MigrationInterface, QueryRunner } from "typeorm";

export class AttachServiceToScheduledMaintenanceTemplatesAndLabelRules1779742211961
  implements MigrationInterface
{
  public name: string =
    "AttachServiceToScheduledMaintenanceTemplatesAndLabelRules1779742211961";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "ScheduledMaintenanceService" ("scheduledMaintenanceId" uuid NOT NULL, "serviceId" uuid NOT NULL, CONSTRAINT "PK_38132b4d0909d8916d1eeb8d16b" PRIMARY KEY ("scheduledMaintenanceId", "serviceId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_e7cbd165d5e0ced2db28547b7e" ON "ScheduledMaintenanceService" ("scheduledMaintenanceId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_598b15421a03dcaff3a09bf720" ON "ScheduledMaintenanceService" ("serviceId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "IncidentTemplateService" ("incidentTemplateId" uuid NOT NULL, "serviceId" uuid NOT NULL, CONSTRAINT "PK_9bec5d60bc97350e293c484e2b7" PRIMARY KEY ("incidentTemplateId", "serviceId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_5b05e9f29b65ce32619174f71a" ON "IncidentTemplateService" ("incidentTemplateId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_2e77d8c407b9dbf6de94590534" ON "IncidentTemplateService" ("serviceId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "ScheduledMaintenanceTemplateService" ("scheduledMaintenanceTemplateId" uuid NOT NULL, "serviceId" uuid NOT NULL, CONSTRAINT "PK_fd99036c10816b1f11a2048b2a1" PRIMARY KEY ("scheduledMaintenanceTemplateId", "serviceId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_523b5124b7d1c95460a03beac6" ON "ScheduledMaintenanceTemplateService" ("scheduledMaintenanceTemplateId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_79f28e83d4fad7f27b2caff90f" ON "ScheduledMaintenanceTemplateService" ("serviceId") `,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertLabelRule" ADD "inheritLabelsFromServices" boolean NOT NULL DEFAULT false`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentLabelRule" ADD "inheritLabelsFromServices" boolean NOT NULL DEFAULT false`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenanceLabelRule" ADD "inheritLabelsFromServices" boolean NOT NULL DEFAULT false`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "rotation" SET DEFAULT '{"_type":"Recurring","value":{"intervalType":"Day","intervalCount":{"_type":"PositiveNumber","value":1}}}'`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "restrictionTimes" SET DEFAULT '{"_type":"RestrictionTimes","value":{"restictionType":"None","dayRestrictionTimes":null,"weeklyRestrictionTimes":[]}}'`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenanceService" ADD CONSTRAINT "FK_e7cbd165d5e0ced2db28547b7e6" FOREIGN KEY ("scheduledMaintenanceId") REFERENCES "ScheduledMaintenance"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenanceService" ADD CONSTRAINT "FK_598b15421a03dcaff3a09bf720f" FOREIGN KEY ("serviceId") REFERENCES "Service"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentTemplateService" ADD CONSTRAINT "FK_5b05e9f29b65ce32619174f71ad" FOREIGN KEY ("incidentTemplateId") REFERENCES "IncidentTemplate"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentTemplateService" ADD CONSTRAINT "FK_2e77d8c407b9dbf6de945905344" FOREIGN KEY ("serviceId") REFERENCES "Service"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenanceTemplateService" ADD CONSTRAINT "FK_523b5124b7d1c95460a03beac66" FOREIGN KEY ("scheduledMaintenanceTemplateId") REFERENCES "ScheduledMaintenanceTemplate"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenanceTemplateService" ADD CONSTRAINT "FK_79f28e83d4fad7f27b2caff90fa" FOREIGN KEY ("serviceId") REFERENCES "Service"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenanceTemplateService" DROP CONSTRAINT "FK_79f28e83d4fad7f27b2caff90fa"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenanceTemplateService" DROP CONSTRAINT "FK_523b5124b7d1c95460a03beac66"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentTemplateService" DROP CONSTRAINT "FK_2e77d8c407b9dbf6de945905344"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentTemplateService" DROP CONSTRAINT "FK_5b05e9f29b65ce32619174f71ad"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenanceService" DROP CONSTRAINT "FK_598b15421a03dcaff3a09bf720f"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenanceService" DROP CONSTRAINT "FK_e7cbd165d5e0ced2db28547b7e6"`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "restrictionTimes" SET DEFAULT '{"_type": "RestrictionTimes", "value": {"restictionType": "None", "dayRestrictionTimes": null, "weeklyRestrictionTimes": []}}'`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "rotation" SET DEFAULT '{"_type": "Recurring", "value": {"intervalType": "Day", "intervalCount": {"_type": "PositiveNumber", "value": 1}}}'`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenanceLabelRule" DROP COLUMN "inheritLabelsFromServices"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentLabelRule" DROP COLUMN "inheritLabelsFromServices"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertLabelRule" DROP COLUMN "inheritLabelsFromServices"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_79f28e83d4fad7f27b2caff90f"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_523b5124b7d1c95460a03beac6"`,
    );
    await queryRunner.query(`DROP TABLE "ScheduledMaintenanceTemplateService"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_2e77d8c407b9dbf6de94590534"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_5b05e9f29b65ce32619174f71a"`,
    );
    await queryRunner.query(`DROP TABLE "IncidentTemplateService"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_598b15421a03dcaff3a09bf720"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_e7cbd165d5e0ced2db28547b7e"`,
    );
    await queryRunner.query(`DROP TABLE "ScheduledMaintenanceService"`);
  }
}
