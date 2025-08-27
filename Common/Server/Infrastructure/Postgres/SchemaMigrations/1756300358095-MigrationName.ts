import { MigrationInterface, QueryRunner } from "typeorm";

export class MigrationName1756300358095 implements MigrationInterface {
    public name = 'MigrationName1756300358095'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "Project" ADD "financeAccountingEmail" character varying(100)`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "Project" DROP COLUMN "financeAccountingEmail"`);
    }

}
