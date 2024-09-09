import { MigrationInterface, QueryRunner } from "typeorm";

export class MigrationName1725901024444 implements MigrationInterface {
    public name = 'MigrationName1725901024444'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "ScheduledMaintenanceTemplate" DROP COLUMN "scheduleNextEventAt"`);
        await queryRunner.query(`ALTER TABLE "ScheduledMaintenanceTemplate" ADD "scheduleNextEventAt" TIMESTAMP WITH TIME ZONE`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "ScheduledMaintenanceTemplate" DROP COLUMN "scheduleNextEventAt"`);
        await queryRunner.query(`ALTER TABLE "ScheduledMaintenanceTemplate" ADD "scheduleNextEventAt" boolean NOT NULL`);
    }

}
