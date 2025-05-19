import { MigrationInterface, QueryRunner } from "typeorm";

export class AddMonitorIdToMonitorTest1747668071582 implements MigrationInterface {

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(
            `ALTER TABLE "MonitorTest" ADD COLUMN "monitorId" uuid NULL`
        );
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(
            `ALTER TABLE "MonitorTest" DROP COLUMN "monitorId"`
        );
    }

}
