import { MigrationInterface, QueryRunner } from "typeorm";

export class MigrationName1770833704656 implements MigrationInterface {
    public name = 'MigrationName1770833704656'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "IncidentOnCallDutyPolicy" DROP CONSTRAINT "FK_2d127b6da0e4fab9f905b4d332d"`);
        await queryRunner.query(`ALTER TABLE "IncidentOnCallDutyPolicy" DROP CONSTRAINT "FK_f89b23e3cafd1c6a0bfd42c297d"`);
        await queryRunner.query(`ALTER TABLE "AlertOnCallDutyPolicy" DROP CONSTRAINT "FK_0eca13d28cf4d2349406ddebc5c"`);
        await queryRunner.query(`ALTER TABLE "AlertOnCallDutyPolicy" DROP CONSTRAINT "FK_1ef6702995a8406630f75f06e28"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_f89b23e3cafd1c6a0bfd42c297"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_1ef6702995a8406630f75f06e2"`);
        await queryRunner.query(`ALTER TABLE "IncidentOnCallDutyPolicy" RENAME COLUMN "monitorId" TO "incidentId"`);
        await queryRunner.query(`ALTER TABLE "IncidentOnCallDutyPolicy" RENAME CONSTRAINT "PK_185b450b39a568ea486b69df0df" TO "PK_c0ae7d58a3ace93ff357abd91d5"`);
        await queryRunner.query(`ALTER TABLE "AlertOnCallDutyPolicy" RENAME COLUMN "monitorId" TO "alertId"`);
        await queryRunner.query(`ALTER TABLE "AlertOnCallDutyPolicy" RENAME CONSTRAINT "PK_adaff6d89a87bbe9c3cfb8f70fc" TO "PK_7baefad3d952f3b9aafe53ab422"`);
        await queryRunner.query(`ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "rotation" SET DEFAULT '{"_type":"Recurring","value":{"intervalType":"Day","intervalCount":{"_type":"PositiveNumber","value":1}}}'`);
        await queryRunner.query(`ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "restrictionTimes" SET DEFAULT '{"_type":"RestrictionTimes","value":{"restictionType":"None","dayRestrictionTimes":null,"weeklyRestrictionTimes":[]}}'`);
        await queryRunner.query(`CREATE INDEX "IDX_47b1a29b40fc779495dd7ba407" ON "IncidentOnCallDutyPolicy" ("incidentId") `);
        await queryRunner.query(`CREATE INDEX "IDX_359174b1e315a1600ddee16812" ON "AlertOnCallDutyPolicy" ("alertId") `);
        await queryRunner.query(`ALTER TABLE "IncidentOnCallDutyPolicy" ADD CONSTRAINT "FK_47b1a29b40fc779495dd7ba4076" FOREIGN KEY ("incidentId") REFERENCES "Incident"("_id") ON DELETE CASCADE ON UPDATE CASCADE`);
        await queryRunner.query(`ALTER TABLE "IncidentOnCallDutyPolicy" ADD CONSTRAINT "FK_2d127b6da0e4fab9f905b4d332d" FOREIGN KEY ("onCallDutyPolicyId") REFERENCES "OnCallDutyPolicy"("_id") ON DELETE CASCADE ON UPDATE CASCADE`);
        await queryRunner.query(`ALTER TABLE "AlertOnCallDutyPolicy" ADD CONSTRAINT "FK_359174b1e315a1600ddee168129" FOREIGN KEY ("alertId") REFERENCES "Alert"("_id") ON DELETE CASCADE ON UPDATE CASCADE`);
        await queryRunner.query(`ALTER TABLE "AlertOnCallDutyPolicy" ADD CONSTRAINT "FK_0eca13d28cf4d2349406ddebc5c" FOREIGN KEY ("onCallDutyPolicyId") REFERENCES "OnCallDutyPolicy"("_id") ON DELETE CASCADE ON UPDATE CASCADE`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "AlertOnCallDutyPolicy" DROP CONSTRAINT "FK_0eca13d28cf4d2349406ddebc5c"`);
        await queryRunner.query(`ALTER TABLE "AlertOnCallDutyPolicy" DROP CONSTRAINT "FK_359174b1e315a1600ddee168129"`);
        await queryRunner.query(`ALTER TABLE "IncidentOnCallDutyPolicy" DROP CONSTRAINT "FK_2d127b6da0e4fab9f905b4d332d"`);
        await queryRunner.query(`ALTER TABLE "IncidentOnCallDutyPolicy" DROP CONSTRAINT "FK_47b1a29b40fc779495dd7ba4076"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_359174b1e315a1600ddee16812"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_47b1a29b40fc779495dd7ba407"`);
        await queryRunner.query(`ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "restrictionTimes" SET DEFAULT '{"_type": "RestrictionTimes", "value": {"restictionType": "None", "dayRestrictionTimes": null, "weeklyRestrictionTimes": []}}'`);
        await queryRunner.query(`ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "rotation" SET DEFAULT '{"_type": "Recurring", "value": {"intervalType": "Day", "intervalCount": {"_type": "PositiveNumber", "value": 1}}}'`);
        await queryRunner.query(`ALTER TABLE "AlertOnCallDutyPolicy" RENAME CONSTRAINT "PK_7baefad3d952f3b9aafe53ab422" TO "PK_adaff6d89a87bbe9c3cfb8f70fc"`);
        await queryRunner.query(`ALTER TABLE "AlertOnCallDutyPolicy" RENAME COLUMN "alertId" TO "monitorId"`);
        await queryRunner.query(`ALTER TABLE "IncidentOnCallDutyPolicy" RENAME CONSTRAINT "PK_c0ae7d58a3ace93ff357abd91d5" TO "PK_185b450b39a568ea486b69df0df"`);
        await queryRunner.query(`ALTER TABLE "IncidentOnCallDutyPolicy" RENAME COLUMN "incidentId" TO "monitorId"`);
        await queryRunner.query(`CREATE INDEX "IDX_1ef6702995a8406630f75f06e2" ON "AlertOnCallDutyPolicy" ("monitorId") `);
        await queryRunner.query(`CREATE INDEX "IDX_f89b23e3cafd1c6a0bfd42c297" ON "IncidentOnCallDutyPolicy" ("monitorId") `);
        await queryRunner.query(`ALTER TABLE "AlertOnCallDutyPolicy" ADD CONSTRAINT "FK_1ef6702995a8406630f75f06e28" FOREIGN KEY ("monitorId") REFERENCES "OnCallDutyPolicy"("_id") ON DELETE CASCADE ON UPDATE CASCADE`);
        await queryRunner.query(`ALTER TABLE "AlertOnCallDutyPolicy" ADD CONSTRAINT "FK_0eca13d28cf4d2349406ddebc5c" FOREIGN KEY ("onCallDutyPolicyId") REFERENCES "Alert"("_id") ON DELETE CASCADE ON UPDATE CASCADE`);
        await queryRunner.query(`ALTER TABLE "IncidentOnCallDutyPolicy" ADD CONSTRAINT "FK_f89b23e3cafd1c6a0bfd42c297d" FOREIGN KEY ("monitorId") REFERENCES "OnCallDutyPolicy"("_id") ON DELETE CASCADE ON UPDATE CASCADE`);
        await queryRunner.query(`ALTER TABLE "IncidentOnCallDutyPolicy" ADD CONSTRAINT "FK_2d127b6da0e4fab9f905b4d332d" FOREIGN KEY ("onCallDutyPolicyId") REFERENCES "Incident"("_id") ON DELETE CASCADE ON UPDATE CASCADE`);
    }

}
