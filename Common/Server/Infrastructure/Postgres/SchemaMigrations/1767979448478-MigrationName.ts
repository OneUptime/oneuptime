import { MigrationInterface, QueryRunner } from "typeorm";

export class MigrationName1767979448478 implements MigrationInterface {
    name = 'MigrationName1767979448478'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "TelemetryException" DROP CONSTRAINT "FK_6470c69cb5f53c5899c0483df5f"`);
        await queryRunner.query(`ALTER TABLE "TelemetryUsageBilling" DROP CONSTRAINT "FK_91333210492e5d2f334231468a7"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_6470c69cb5f53c5899c0483df5"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_91333210492e5d2f334231468a"`);
        await queryRunner.query(`ALTER TABLE "TelemetryException" RENAME COLUMN "telemetryServiceId" TO "serviceId"`);
        await queryRunner.query(`ALTER TABLE "TelemetryUsageBilling" RENAME COLUMN "telemetryServiceId" TO "serviceId"`);
        await queryRunner.query(`CREATE TABLE "MetricTypeService" ("metricTypeId" uuid NOT NULL, "serviceId" uuid NOT NULL, CONSTRAINT "PK_21b7a84eea5b71922ac5ccc92e9" PRIMARY KEY ("metricTypeId", "serviceId"))`);
        await queryRunner.query(`CREATE INDEX "IDX_e6b6e365ad502b487cb63d2891" ON "MetricTypeService" ("metricTypeId") `);
        await queryRunner.query(`CREATE INDEX "IDX_c67839207ff53f33eb22648b56" ON "MetricTypeService" ("serviceId") `);
        await queryRunner.query(`ALTER TABLE "Service" ADD "retainTelemetryDataForDays" integer DEFAULT '15'`);
        await queryRunner.query(`ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "rotation" SET DEFAULT '{"_type":"Recurring","value":{"intervalType":"Day","intervalCount":{"_type":"PositiveNumber","value":1}}}'`);
        await queryRunner.query(`ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "restrictionTimes" SET DEFAULT '{"_type":"RestrictionTimes","value":{"restictionType":"None","dayRestrictionTimes":null,"weeklyRestrictionTimes":[]}}'`);
        await queryRunner.query(`CREATE INDEX "IDX_08a0cfa9f184257b1e57da4cf5" ON "TelemetryException" ("serviceId") `);
        await queryRunner.query(`CREATE INDEX "IDX_b9f49cd8318a35757fc843ee90" ON "TelemetryUsageBilling" ("serviceId") `);
        await queryRunner.query(`ALTER TABLE "TelemetryException" ADD CONSTRAINT "FK_08a0cfa9f184257b1e57da4cf50" FOREIGN KEY ("serviceId") REFERENCES "Service"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "TelemetryUsageBilling" ADD CONSTRAINT "FK_b9f49cd8318a35757fc843ee900" FOREIGN KEY ("serviceId") REFERENCES "Service"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "MetricTypeService" ADD CONSTRAINT "FK_e6b6e365ad502b487cb63d28913" FOREIGN KEY ("metricTypeId") REFERENCES "MetricType"("_id") ON DELETE CASCADE ON UPDATE CASCADE`);
        await queryRunner.query(`ALTER TABLE "MetricTypeService" ADD CONSTRAINT "FK_c67839207ff53f33eb22648b567" FOREIGN KEY ("serviceId") REFERENCES "Service"("_id") ON DELETE CASCADE ON UPDATE CASCADE`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "MetricTypeService" DROP CONSTRAINT "FK_c67839207ff53f33eb22648b567"`);
        await queryRunner.query(`ALTER TABLE "MetricTypeService" DROP CONSTRAINT "FK_e6b6e365ad502b487cb63d28913"`);
        await queryRunner.query(`ALTER TABLE "TelemetryUsageBilling" DROP CONSTRAINT "FK_b9f49cd8318a35757fc843ee900"`);
        await queryRunner.query(`ALTER TABLE "TelemetryException" DROP CONSTRAINT "FK_08a0cfa9f184257b1e57da4cf50"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_b9f49cd8318a35757fc843ee90"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_08a0cfa9f184257b1e57da4cf5"`);
        await queryRunner.query(`ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "restrictionTimes" SET DEFAULT '{"_type": "RestrictionTimes", "value": {"restictionType": "None", "dayRestrictionTimes": null, "weeklyRestrictionTimes": []}}'`);
        await queryRunner.query(`ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "rotation" SET DEFAULT '{"_type": "Recurring", "value": {"intervalType": "Day", "intervalCount": {"_type": "PositiveNumber", "value": 1}}}'`);
        await queryRunner.query(`ALTER TABLE "Service" DROP COLUMN "retainTelemetryDataForDays"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_c67839207ff53f33eb22648b56"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_e6b6e365ad502b487cb63d2891"`);
        await queryRunner.query(`DROP TABLE "MetricTypeService"`);
        await queryRunner.query(`ALTER TABLE "TelemetryUsageBilling" RENAME COLUMN "serviceId" TO "telemetryServiceId"`);
        await queryRunner.query(`ALTER TABLE "TelemetryException" RENAME COLUMN "serviceId" TO "telemetryServiceId"`);
        await queryRunner.query(`CREATE INDEX "IDX_91333210492e5d2f334231468a" ON "TelemetryUsageBilling" ("telemetryServiceId") `);
        await queryRunner.query(`CREATE INDEX "IDX_6470c69cb5f53c5899c0483df5" ON "TelemetryException" ("telemetryServiceId") `);
        await queryRunner.query(`ALTER TABLE "TelemetryUsageBilling" ADD CONSTRAINT "FK_91333210492e5d2f334231468a7" FOREIGN KEY ("telemetryServiceId") REFERENCES "TelemetryService"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "TelemetryException" ADD CONSTRAINT "FK_6470c69cb5f53c5899c0483df5f" FOREIGN KEY ("telemetryServiceId") REFERENCES "TelemetryService"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`);
    }

}
