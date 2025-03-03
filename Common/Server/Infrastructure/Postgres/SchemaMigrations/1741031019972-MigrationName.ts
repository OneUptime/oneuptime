import { MigrationInterface, QueryRunner } from "typeorm";

export class MigrationName1741031019972 implements MigrationInterface {
    public name = 'MigrationName1741031019972'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "Incident" DROP COLUMN "workspaceSendMessageResponse"`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "Incident" ADD "workspaceSendMessageResponse" jsonb`);
    }

}
