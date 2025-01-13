import { MigrationInterface, QueryRunner } from "typeorm";

export class MigrationName1736780194078 implements MigrationInterface {
    public name = 'MigrationName1736780194078'

    public async up(queryRunner: QueryRunner): Promise<void> {
        // drop tables IncidentLog, AlertLog, ScheduledMaintenanceLog
        await queryRunner.query(`DROP TABLE "IncidentLog"`);
        await queryRunner.query(`DROP TABLE "AlertLog"`);
        await queryRunner.query(`DROP TABLE "ScheduledMaintenanceLog"`);
    }

    public async down(_queryRunner: QueryRunner): Promise<void> {
        // do nothing.
    }

}
