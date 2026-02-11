import { MigrationInterface, QueryRunner } from "typeorm";

export class MigrationName1770834237090 implements MigrationInterface {
  name = "MigrationName1770834237090";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "IncidentOnCallDutyPolicy" DROP CONSTRAINT "FK_IncidentOnCallDutyPolicy_incidentId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentOnCallDutyPolicy" DROP CONSTRAINT "FK_IncidentOnCallDutyPolicy_onCallDutyPolicyId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertOnCallDutyPolicy" DROP CONSTRAINT "FK_AlertOnCallDutyPolicy_alertId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertOnCallDutyPolicy" DROP CONSTRAINT "FK_AlertOnCallDutyPolicy_onCallDutyPolicyId"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_IncidentOnCallDutyPolicy_onCallDutyPolicyId"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_IncidentOnCallDutyPolicy_incidentId"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_AlertOnCallDutyPolicy_alertId"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_AlertOnCallDutyPolicy_onCallDutyPolicyId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "rotation" SET DEFAULT '{"_type":"Recurring","value":{"intervalType":"Day","intervalCount":{"_type":"PositiveNumber","value":1}}}'`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "restrictionTimes" SET DEFAULT '{"_type":"RestrictionTimes","value":{"restictionType":"None","dayRestrictionTimes":null,"weeklyRestrictionTimes":[]}}'`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_47b1a29b40fc779495dd7ba407" ON "IncidentOnCallDutyPolicy" ("incidentId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_2d127b6da0e4fab9f905b4d332" ON "IncidentOnCallDutyPolicy" ("onCallDutyPolicyId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_359174b1e315a1600ddee16812" ON "AlertOnCallDutyPolicy" ("alertId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_0eca13d28cf4d2349406ddebc5" ON "AlertOnCallDutyPolicy" ("onCallDutyPolicyId") `,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentOnCallDutyPolicy" ADD CONSTRAINT "FK_47b1a29b40fc779495dd7ba4076" FOREIGN KEY ("incidentId") REFERENCES "Incident"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentOnCallDutyPolicy" ADD CONSTRAINT "FK_2d127b6da0e4fab9f905b4d332d" FOREIGN KEY ("onCallDutyPolicyId") REFERENCES "OnCallDutyPolicy"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertOnCallDutyPolicy" ADD CONSTRAINT "FK_359174b1e315a1600ddee168129" FOREIGN KEY ("alertId") REFERENCES "Alert"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertOnCallDutyPolicy" ADD CONSTRAINT "FK_0eca13d28cf4d2349406ddebc5c" FOREIGN KEY ("onCallDutyPolicyId") REFERENCES "OnCallDutyPolicy"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "AlertOnCallDutyPolicy" DROP CONSTRAINT "FK_0eca13d28cf4d2349406ddebc5c"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertOnCallDutyPolicy" DROP CONSTRAINT "FK_359174b1e315a1600ddee168129"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentOnCallDutyPolicy" DROP CONSTRAINT "FK_2d127b6da0e4fab9f905b4d332d"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentOnCallDutyPolicy" DROP CONSTRAINT "FK_47b1a29b40fc779495dd7ba4076"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_0eca13d28cf4d2349406ddebc5"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_359174b1e315a1600ddee16812"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_2d127b6da0e4fab9f905b4d332"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_47b1a29b40fc779495dd7ba407"`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "restrictionTimes" SET DEFAULT '{"_type": "RestrictionTimes", "value": {"restictionType": "None", "dayRestrictionTimes": null, "weeklyRestrictionTimes": []}}'`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "rotation" SET DEFAULT '{"_type": "Recurring", "value": {"intervalType": "Day", "intervalCount": {"_type": "PositiveNumber", "value": 1}}}'`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_AlertOnCallDutyPolicy_onCallDutyPolicyId" ON "AlertOnCallDutyPolicy" ("onCallDutyPolicyId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_AlertOnCallDutyPolicy_alertId" ON "AlertOnCallDutyPolicy" ("alertId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_IncidentOnCallDutyPolicy_incidentId" ON "IncidentOnCallDutyPolicy" ("incidentId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_IncidentOnCallDutyPolicy_onCallDutyPolicyId" ON "IncidentOnCallDutyPolicy" ("onCallDutyPolicyId") `,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertOnCallDutyPolicy" ADD CONSTRAINT "FK_AlertOnCallDutyPolicy_onCallDutyPolicyId" FOREIGN KEY ("onCallDutyPolicyId") REFERENCES "OnCallDutyPolicy"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertOnCallDutyPolicy" ADD CONSTRAINT "FK_AlertOnCallDutyPolicy_alertId" FOREIGN KEY ("alertId") REFERENCES "Alert"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentOnCallDutyPolicy" ADD CONSTRAINT "FK_IncidentOnCallDutyPolicy_onCallDutyPolicyId" FOREIGN KEY ("onCallDutyPolicyId") REFERENCES "OnCallDutyPolicy"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentOnCallDutyPolicy" ADD CONSTRAINT "FK_IncidentOnCallDutyPolicy_incidentId" FOREIGN KEY ("incidentId") REFERENCES "Incident"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
  }
}
