import { MigrationInterface, QueryRunner } from "typeorm";

export class MigrationName1756293325324 implements MigrationInterface {
    public name = 'MigrationName1756293325324'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "Project" ADD "businessDetails" character varying(500)`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
       
        await queryRunner.query(`ALTER TABLE "Project" DROP COLUMN "businessDetails"`);
       
    }

}
