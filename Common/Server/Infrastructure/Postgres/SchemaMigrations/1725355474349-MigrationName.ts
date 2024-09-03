import { MigrationInterface, QueryRunner } from "typeorm";

export class MigrationName1725355474349 implements MigrationInterface {
    public name = 'MigrationName1725355474349'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "CopilotAction" ADD "copilotActionProp" jsonb`);
        await queryRunner.query(`ALTER TABLE "CopilotAction" ADD "statusMessage" text`);
        await queryRunner.query(`ALTER TABLE "CopilotAction" DROP COLUMN "copilotActionStatus"`);
        await queryRunner.query(`ALTER TABLE "CopilotAction" ADD "copilotActionStatus" character varying(varchar) NOT NULL DEFAULT 'No Action Required'`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "CopilotAction" DROP COLUMN "copilotActionStatus"`);
        await queryRunner.query(`ALTER TABLE "CopilotAction" ADD "copilotActionStatus" character varying NOT NULL`);
        await queryRunner.query(`ALTER TABLE "CopilotAction" DROP COLUMN "statusMessage"`);
        await queryRunner.query(`ALTER TABLE "CopilotAction" DROP COLUMN "copilotActionProp"`);
    }

}
