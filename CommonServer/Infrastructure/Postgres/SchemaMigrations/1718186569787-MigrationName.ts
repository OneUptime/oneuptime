import { MigrationInterface, QueryRunner } from 'typeorm';

export class MigrationName1718186569787 implements MigrationInterface {
    public name = 'MigrationName1718186569787';

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(
            `ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "restrictionTimes" SET DEFAULT '{"_type":"RestrictionTimes","value":{"restictionType":"None","dayRestrictionTimes":null,"weeklyRestrictionTimes":[]}}'`
        );
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(
            `ALTER TABLE "CodeRepository" DROP COLUMN "mainBranchName"`
        );
    }
}
