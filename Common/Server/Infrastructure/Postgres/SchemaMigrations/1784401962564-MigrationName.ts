import { MigrationInterface, QueryRunner } from "typeorm";

export class MigrationName1784401962564 implements MigrationInterface {
    public name = 'MigrationName1784401962564'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "MarketingConversion" DROP COLUMN "googleUploadStatus"`);
        await queryRunner.query(`ALTER TABLE "MarketingConversion" DROP COLUMN "googleUploadedAt"`);
        await queryRunner.query(`ALTER TABLE "MarketingConversion" DROP COLUMN "googleUploadError"`);
        await queryRunner.query(`ALTER TABLE "MarketingConversion" DROP COLUMN "googleUploadAttempts"`);
        await queryRunner.query(`ALTER TABLE "MarketingConversion" DROP COLUMN "metaUploadStatus"`);
        await queryRunner.query(`ALTER TABLE "MarketingConversion" DROP COLUMN "metaUploadedAt"`);
        await queryRunner.query(`ALTER TABLE "MarketingConversion" DROP COLUMN "metaUploadError"`);
        await queryRunner.query(`ALTER TABLE "MarketingConversion" DROP COLUMN "metaUploadAttempts"`);
        await queryRunner.query(`ALTER TABLE "MarketingConversion" ADD "uploadState" jsonb`);
        await queryRunner.query(`ALTER TABLE "NetworkDeviceDiscoveryScan" DROP COLUMN "snmpV3AuthKey"`);
        await queryRunner.query(`ALTER TABLE "NetworkDeviceDiscoveryScan" ADD "snmpV3AuthKey" character varying`);
        await queryRunner.query(`ALTER TABLE "NetworkDeviceDiscoveryScan" DROP COLUMN "snmpV3PrivKey"`);
        await queryRunner.query(`ALTER TABLE "NetworkDeviceDiscoveryScan" ADD "snmpV3PrivKey" character varying`);
        await queryRunner.query(`ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "rotation" SET DEFAULT '{"_type":"Recurring","value":{"intervalType":"Day","intervalCount":{"_type":"PositiveNumber","value":1}}}'`);
        await queryRunner.query(`ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "restrictionTimes" SET DEFAULT '{"_type":"RestrictionTimes","value":{"restictionType":"None","dayRestrictionTimes":null,"weeklyRestrictionTimes":[]}}'`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "restrictionTimes" SET DEFAULT '{"_type": "RestrictionTimes", "value": {"restictionType": "None", "dayRestrictionTimes": null, "weeklyRestrictionTimes": []}}'`);
        await queryRunner.query(`ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "rotation" SET DEFAULT '{"_type": "Recurring", "value": {"intervalType": "Day", "intervalCount": {"_type": "PositiveNumber", "value": 1}}}'`);
        await queryRunner.query(`ALTER TABLE "NetworkDeviceDiscoveryScan" DROP COLUMN "snmpV3PrivKey"`);
        await queryRunner.query(`ALTER TABLE "NetworkDeviceDiscoveryScan" ADD "snmpV3PrivKey" text`);
        await queryRunner.query(`ALTER TABLE "NetworkDeviceDiscoveryScan" DROP COLUMN "snmpV3AuthKey"`);
        await queryRunner.query(`ALTER TABLE "NetworkDeviceDiscoveryScan" ADD "snmpV3AuthKey" text`);
        await queryRunner.query(`ALTER TABLE "MarketingConversion" DROP COLUMN "uploadState"`);
        await queryRunner.query(`ALTER TABLE "MarketingConversion" ADD "metaUploadAttempts" integer`);
        await queryRunner.query(`ALTER TABLE "MarketingConversion" ADD "metaUploadError" text`);
        await queryRunner.query(`ALTER TABLE "MarketingConversion" ADD "metaUploadedAt" TIMESTAMP WITH TIME ZONE`);
        await queryRunner.query(`ALTER TABLE "MarketingConversion" ADD "metaUploadStatus" character varying(100)`);
        await queryRunner.query(`ALTER TABLE "MarketingConversion" ADD "googleUploadAttempts" integer`);
        await queryRunner.query(`ALTER TABLE "MarketingConversion" ADD "googleUploadError" text`);
        await queryRunner.query(`ALTER TABLE "MarketingConversion" ADD "googleUploadedAt" TIMESTAMP WITH TIME ZONE`);
        await queryRunner.query(`ALTER TABLE "MarketingConversion" ADD "googleUploadStatus" character varying(100)`);
    }

}
