import { MigrationInterface, QueryRunner } from "typeorm";

export class MigrationName1737997557974 implements MigrationInterface {
    public name = 'MigrationName1737997557974'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE INDEX "IDX_4d5e62631b2b63aaecb00950ef" ON "MonitorTest" ("isInQueue") `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP INDEX "public"."IDX_4d5e62631b2b63aaecb00950ef"`);
    }

}
