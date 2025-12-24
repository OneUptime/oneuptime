import { MigrationInterface, QueryRunner } from "typeorm";

export class MigrationName1766606720183 implements MigrationInterface {
    public name = 'MigrationName1766606720183'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "Monitor" ADD "minimumProbeAgreement" integer`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "Monitor" DROP COLUMN "minimumProbeAgreement"`);
    }

}
