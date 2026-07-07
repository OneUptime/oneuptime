import { MigrationInterface, QueryRunner } from "typeorm";

export class MigrationName1783461767405 implements MigrationInterface {
    public name = 'MigrationName1783461767405'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "IncidentReminderRuleLabel" DROP CONSTRAINT "FK_ce1b7a4d3f0e8c2a9b5d6e14f21"`);
        await queryRunner.query(`ALTER TABLE "IncidentReminderRuleLabel" DROP CONSTRAINT "FK_da5c8e6f2b1a4d7c093e5f18a37"`);
        await queryRunner.query(`ALTER TABLE "AlertReminderRuleLabel" DROP CONSTRAINT "FK_bf4d6e8a0c2153749b5c7d9e0f2"`);
        await queryRunner.query(`ALTER TABLE "AlertReminderRuleLabel" DROP CONSTRAINT "FK_cd7e9f1b3a5062748c6d8e0f193"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_ce1b7a4d3f0e8c2a9b5d6e14f21"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_da5c8e6f2b1a4d7c093e5f18a37"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_bf4d6e8a0c2153749b5c7d9e0f2"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_cd7e9f1b3a5062748c6d8e0f193"`);
        await queryRunner.query(`ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "rotation" SET DEFAULT '{"_type":"Recurring","value":{"intervalType":"Day","intervalCount":{"_type":"PositiveNumber","value":1}}}'`);
        await queryRunner.query(`ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "restrictionTimes" SET DEFAULT '{"_type":"RestrictionTimes","value":{"restictionType":"None","dayRestrictionTimes":null,"weeklyRestrictionTimes":[]}}'`);
        await queryRunner.query(`CREATE INDEX "IDX_2c8a45bfcf02645455551c4edd" ON "IncidentReminderRuleLabel" ("incidentReminderRuleId") `);
        await queryRunner.query(`CREATE INDEX "IDX_87d4d1b6ba59d3407d2f9de85a" ON "IncidentReminderRuleLabel" ("labelId") `);
        await queryRunner.query(`CREATE INDEX "IDX_ae5faeec76bb9eae5350efad6f" ON "AlertReminderRuleLabel" ("alertReminderRuleId") `);
        await queryRunner.query(`CREATE INDEX "IDX_5d531edf3ddca07b03d352a60f" ON "AlertReminderRuleLabel" ("labelId") `);
        await queryRunner.query(`ALTER TABLE "IncidentReminderRuleLabel" ADD CONSTRAINT "FK_2c8a45bfcf02645455551c4edda" FOREIGN KEY ("incidentReminderRuleId") REFERENCES "IncidentReminderRule"("_id") ON DELETE CASCADE ON UPDATE CASCADE`);
        await queryRunner.query(`ALTER TABLE "IncidentReminderRuleLabel" ADD CONSTRAINT "FK_87d4d1b6ba59d3407d2f9de85a1" FOREIGN KEY ("labelId") REFERENCES "Label"("_id") ON DELETE CASCADE ON UPDATE CASCADE`);
        await queryRunner.query(`ALTER TABLE "AlertReminderRuleLabel" ADD CONSTRAINT "FK_ae5faeec76bb9eae5350efad6fa" FOREIGN KEY ("alertReminderRuleId") REFERENCES "AlertReminderRule"("_id") ON DELETE CASCADE ON UPDATE CASCADE`);
        await queryRunner.query(`ALTER TABLE "AlertReminderRuleLabel" ADD CONSTRAINT "FK_5d531edf3ddca07b03d352a60f5" FOREIGN KEY ("labelId") REFERENCES "Label"("_id") ON DELETE CASCADE ON UPDATE CASCADE`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "AlertReminderRuleLabel" DROP CONSTRAINT "FK_5d531edf3ddca07b03d352a60f5"`);
        await queryRunner.query(`ALTER TABLE "AlertReminderRuleLabel" DROP CONSTRAINT "FK_ae5faeec76bb9eae5350efad6fa"`);
        await queryRunner.query(`ALTER TABLE "IncidentReminderRuleLabel" DROP CONSTRAINT "FK_87d4d1b6ba59d3407d2f9de85a1"`);
        await queryRunner.query(`ALTER TABLE "IncidentReminderRuleLabel" DROP CONSTRAINT "FK_2c8a45bfcf02645455551c4edda"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_5d531edf3ddca07b03d352a60f"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_ae5faeec76bb9eae5350efad6f"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_87d4d1b6ba59d3407d2f9de85a"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_2c8a45bfcf02645455551c4edd"`);
        await queryRunner.query(`ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "restrictionTimes" SET DEFAULT '{"_type": "RestrictionTimes", "value": {"restictionType": "None", "dayRestrictionTimes": null, "weeklyRestrictionTimes": []}}'`);
        await queryRunner.query(`ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "rotation" SET DEFAULT '{"_type": "Recurring", "value": {"intervalType": "Day", "intervalCount": {"_type": "PositiveNumber", "value": 1}}}'`);
        await queryRunner.query(`CREATE INDEX "IDX_cd7e9f1b3a5062748c6d8e0f193" ON "AlertReminderRuleLabel" ("labelId") `);
        await queryRunner.query(`CREATE INDEX "IDX_bf4d6e8a0c2153749b5c7d9e0f2" ON "AlertReminderRuleLabel" ("alertReminderRuleId") `);
        await queryRunner.query(`CREATE INDEX "IDX_da5c8e6f2b1a4d7c093e5f18a37" ON "IncidentReminderRuleLabel" ("labelId") `);
        await queryRunner.query(`CREATE INDEX "IDX_ce1b7a4d3f0e8c2a9b5d6e14f21" ON "IncidentReminderRuleLabel" ("incidentReminderRuleId") `);
        await queryRunner.query(`ALTER TABLE "AlertReminderRuleLabel" ADD CONSTRAINT "FK_cd7e9f1b3a5062748c6d8e0f193" FOREIGN KEY ("labelId") REFERENCES "Label"("_id") ON DELETE CASCADE ON UPDATE CASCADE`);
        await queryRunner.query(`ALTER TABLE "AlertReminderRuleLabel" ADD CONSTRAINT "FK_bf4d6e8a0c2153749b5c7d9e0f2" FOREIGN KEY ("alertReminderRuleId") REFERENCES "AlertReminderRule"("_id") ON DELETE CASCADE ON UPDATE CASCADE`);
        await queryRunner.query(`ALTER TABLE "IncidentReminderRuleLabel" ADD CONSTRAINT "FK_da5c8e6f2b1a4d7c093e5f18a37" FOREIGN KEY ("labelId") REFERENCES "Label"("_id") ON DELETE CASCADE ON UPDATE CASCADE`);
        await queryRunner.query(`ALTER TABLE "IncidentReminderRuleLabel" ADD CONSTRAINT "FK_ce1b7a4d3f0e8c2a9b5d6e14f21" FOREIGN KEY ("incidentReminderRuleId") REFERENCES "IncidentReminderRule"("_id") ON DELETE CASCADE ON UPDATE CASCADE`);
    }

}
