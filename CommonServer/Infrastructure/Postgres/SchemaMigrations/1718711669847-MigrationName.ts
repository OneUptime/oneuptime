import { MigrationInterface, QueryRunner } from "typeorm";

export class MigrationName1718711669847 implements MigrationInterface {
    public name = 'MigrationName1718711669847'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "Incident" ADD "remediationNotes" text`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "Incident" DROP COLUMN "remediationNotes"`);
    }

}
