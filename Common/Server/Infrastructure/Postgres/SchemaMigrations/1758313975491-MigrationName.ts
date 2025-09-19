import { MigrationInterface, QueryRunner } from "typeorm";

export class MigrationName1758313975491 implements MigrationInterface {
    public name = 'MigrationName1758313975491'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "Project" ADD "discountPercent" integer NOT NULL DEFAULT '0'`);
       
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        
        await queryRunner.query(`ALTER TABLE "Project" DROP COLUMN "discountPercent"`);
    }

}
