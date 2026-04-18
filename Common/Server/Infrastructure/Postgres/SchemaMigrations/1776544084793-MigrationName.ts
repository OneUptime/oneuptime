import { MigrationInterface, QueryRunner } from "typeorm";

export class MigrationName1776544084793 implements MigrationInterface {
    name = 'MigrationName1776544084793'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "MetricPipelineRule" DROP COLUMN "matchMetricNameRegex"`);
        await queryRunner.query(`ALTER TABLE "MetricPipelineRule" DROP COLUMN "matchAttributeKey"`);
        await queryRunner.query(`ALTER TABLE "MetricPipelineRule" DROP COLUMN "matchAttributeValueRegex"`);
        await queryRunner.query(`ALTER TABLE "MetricPipelineRule" ADD "filterCondition" character varying(100) NOT NULL DEFAULT 'All'`);
        await queryRunner.query(`ALTER TABLE "MetricPipelineRule" ADD "filters" jsonb`);
        await queryRunner.query(`ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "rotation" SET DEFAULT '{"_type":"Recurring","value":{"intervalType":"Day","intervalCount":{"_type":"PositiveNumber","value":1}}}'`);
        await queryRunner.query(`ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "restrictionTimes" SET DEFAULT '{"_type":"RestrictionTimes","value":{"restictionType":"None","dayRestrictionTimes":null,"weeklyRestrictionTimes":[]}}'`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "restrictionTimes" SET DEFAULT '{"_type": "RestrictionTimes", "value": {"restictionType": "None", "dayRestrictionTimes": null, "weeklyRestrictionTimes": []}}'`);
        await queryRunner.query(`ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "rotation" SET DEFAULT '{"_type": "Recurring", "value": {"intervalType": "Day", "intervalCount": {"_type": "PositiveNumber", "value": 1}}}'`);
        await queryRunner.query(`ALTER TABLE "MetricPipelineRule" DROP COLUMN "filters"`);
        await queryRunner.query(`ALTER TABLE "MetricPipelineRule" DROP COLUMN "filterCondition"`);
        await queryRunner.query(`ALTER TABLE "MetricPipelineRule" ADD "matchAttributeValueRegex" character varying(500)`);
        await queryRunner.query(`ALTER TABLE "MetricPipelineRule" ADD "matchAttributeKey" character varying(100)`);
        await queryRunner.query(`ALTER TABLE "MetricPipelineRule" ADD "matchMetricNameRegex" character varying(500)`);
    }

}
