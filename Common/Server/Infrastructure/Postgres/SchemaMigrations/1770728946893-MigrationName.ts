import { MigrationInterface, QueryRunner } from "typeorm";

export class MigrationName1770728946893 implements MigrationInterface {
    name = 'MigrationName1770728946893'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "IncidentEpisode" ADD "allIncidentsResolvedAt" TIMESTAMP WITH TIME ZONE`);
        await queryRunner.query(`ALTER TABLE "AlertEpisode" ADD "allAlertsResolvedAt" TIMESTAMP WITH TIME ZONE`);
        await queryRunner.query(`ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "rotation" SET DEFAULT '{"_type":"Recurring","value":{"intervalType":"Day","intervalCount":{"_type":"PositiveNumber","value":1}}}'`);
        await queryRunner.query(`ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "restrictionTimes" SET DEFAULT '{"_type":"RestrictionTimes","value":{"restictionType":"None","dayRestrictionTimes":null,"weeklyRestrictionTimes":[]}}'`);
        await queryRunner.query(`CREATE INDEX "IDX_0610406e5c436c20a5068b1006" ON "IncidentEpisode" ("allIncidentsResolvedAt") `);
        await queryRunner.query(`CREATE INDEX "IDX_ea5d1f899fe52445dd6e0d0d55" ON "AlertEpisode" ("allAlertsResolvedAt") `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP INDEX "public"."IDX_ea5d1f899fe52445dd6e0d0d55"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_0610406e5c436c20a5068b1006"`);
        await queryRunner.query(`ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "restrictionTimes" SET DEFAULT '{"_type": "RestrictionTimes", "value": {"restictionType": "None", "dayRestrictionTimes": null, "weeklyRestrictionTimes": []}}'`);
        await queryRunner.query(`ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "rotation" SET DEFAULT '{"_type": "Recurring", "value": {"intervalType": "Day", "intervalCount": {"_type": "PositiveNumber", "value": 1}}}'`);
        await queryRunner.query(`ALTER TABLE "AlertEpisode" DROP COLUMN "allAlertsResolvedAt"`);
        await queryRunner.query(`ALTER TABLE "IncidentEpisode" DROP COLUMN "allIncidentsResolvedAt"`);
    }

}
