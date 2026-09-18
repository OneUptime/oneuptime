import { MigrationInterface, QueryRunner } from "typeorm";

export class MigrationName1747674762672 implements MigrationInterface {
  public name = "MigrationName1747674762672";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "MonitorTest" ADD "monitorId" uuid`);
    await queryRunner.query(
      `CREATE INDEX "IDX_4650119024eca8c91608effb95" ON "MonitorTest" ("monitorId") `,
    );
    await queryRunner.query(
      `ALTER TABLE "MonitorTest" ADD CONSTRAINT "FK_4650119024eca8c91608effb959" FOREIGN KEY ("monitorId") REFERENCES "Monitor"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "MonitorTest" DROP CONSTRAINT "FK_4650119024eca8c91608effb959"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_4650119024eca8c91608effb95"`,
    );
    await queryRunner.query(
      `ALTER TABLE "MonitorTest" DROP COLUMN "monitorId"`,
    );
  }
}
