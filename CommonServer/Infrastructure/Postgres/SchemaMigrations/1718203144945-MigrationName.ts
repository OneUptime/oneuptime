import { MigrationInterface, QueryRunner } from 'typeorm';

export class MigrationName1718203144945 implements MigrationInterface {
    public name = 'MigrationName1718203144945';

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(
            `ALTER TABLE "CodeRepository" ADD "organizationName" character varying(100) NOT NULL`
        );
        await queryRunner.query(
            `ALTER TABLE "CodeRepository" ADD "repositoryName" character varying(100) NOT NULL`
        );
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(
            `ALTER TABLE "CodeRepository" DROP COLUMN "repositoryName"`
        );
        await queryRunner.query(
            `ALTER TABLE "CodeRepository" DROP COLUMN "organizationName"`
        );
    }
}
