import { MigrationInterface, QueryRunner } from "typeorm";

export class MigrationName1762430566091 implements MigrationInterface {
    public name = 'MigrationName1762430566091'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "StatusPagePrivateUser" ADD "jwtRefreshToken" character varying(100)`);    
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "StatusPagePrivateUser" DROP COLUMN "jwtRefreshToken"`);
    }

}
