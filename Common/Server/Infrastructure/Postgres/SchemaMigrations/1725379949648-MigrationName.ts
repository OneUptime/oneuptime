import { MigrationInterface, QueryRunner } from "typeorm";

export class MigrationName1725379949648 implements MigrationInterface {
    public name = 'MigrationName1725379949648'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "CopilotAction" ADD "isPriority" boolean NOT NULL DEFAULT false`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "CopilotAction" DROP COLUMN "isPriority"`);
    }

}
