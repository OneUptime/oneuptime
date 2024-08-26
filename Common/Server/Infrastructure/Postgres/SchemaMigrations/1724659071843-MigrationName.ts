import { MigrationInterface, QueryRunner } from "typeorm";

export class MigrationName1724659071843 implements MigrationInterface {
    public name = 'MigrationName1724659071843'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "TelemetryException" ADD "occuranceCount" integer NOT NULL DEFAULT '1'`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "TelemetryException" DROP COLUMN "occuranceCount"`);
    }

}
