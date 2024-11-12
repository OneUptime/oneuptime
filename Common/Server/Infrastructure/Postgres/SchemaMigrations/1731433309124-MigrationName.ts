import { MigrationInterface, QueryRunner } from "typeorm";

export class MigrationName1731433309124 implements MigrationInterface {
    public name = 'MigrationName1731433309124'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP INDEX "public"."IDX_fc40ea6a9ad55f29bca4f4a15d"`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE INDEX "IDX_fc40ea6a9ad55f29bca4f4a15d" ON "Alert" ("rootCause") `);
    }

}
