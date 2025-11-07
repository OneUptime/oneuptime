import { MigrationInterface, QueryRunner } from "typeorm";

export class MigrationName1762554602716 implements MigrationInterface {
    public name = 'MigrationName1762554602716'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "User" DROP COLUMN "jwtRefreshToken"`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "User" ADD "jwtRefreshToken" character varying(100)`);
    }

}
