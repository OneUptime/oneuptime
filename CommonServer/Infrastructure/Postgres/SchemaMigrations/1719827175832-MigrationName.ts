import { MigrationInterface, QueryRunner } from "typeorm";

export class MigrationName1719827175832 implements MigrationInterface {
    public name = 'MigrationName1719827175832'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "Probe" ADD "connectionStatus" character varying`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "Probe" DROP COLUMN "connectionStatus"`);
    }

}
