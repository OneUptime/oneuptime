import { MigrationInterface, QueryRunner } from 'typeorm';

export class MigrationName1718100824584 implements MigrationInterface {
    public name = 'MigrationName1718100824584';

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(
            `ALTER TABLE "StatusPageSubscriber" ADD "sendYouHaveSubscribedMessage" boolean NOT NULL DEFAULT true`
        );
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(
            `ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "restrictionTimes" SET DEFAULT '{"_type": "RestrictionTimes", "value": {"restictionType": "None", "dayRestrictionTimes": null, "weeklyRestrictionTimes": []}}'`
        );
    }
}
